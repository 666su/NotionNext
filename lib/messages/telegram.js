/**
 * Telegram 双向通道（Phase 7）
 *
 * 单向之外新增两件事：
 *   1. 访客来私信 → 推到你的 TG，并记下「这条 TG 消息 ↔ 哪个会话」；
 *   2. 你在 TG 里**回复**那条消息 → webhook 反查会话 → 作为管理员回复写回访客。
 *
 * 纪律：
 *   - 只认 TELEGRAM_CHAT_ID 这一个会话（私聊），其它 chat 的 update 一律忽略；
 *   - webhook 必须带 secret_token，且 update_id 去重，重投不重复入库；
 *   - 推送失败绝不影响访客发送（fire-and-forget，只在服务端 warn）。
 */

import { getMessagesClient, MESSAGES_SCHEMA } from './db'

const DEFAULT_API_BASE = 'https://api.telegram.org'

export function readTgConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim()
  const apiBase = String(process.env.TELEGRAM_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()
  return {
    token,
    chatId,
    apiBase,
    webhookSecret,
    enabled: Boolean(token && chatId),
    missing: [!token && 'TELEGRAM_BOT_TOKEN', !chatId && 'TELEGRAM_CHAT_ID'].filter(Boolean)
  }
}

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function siteOrigin() {
  const raw = String(process.env.NEXT_PUBLIC_LINK || process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  if (raw) {
    try {
      return new URL(raw).origin
    } catch (err) {
      /* 忽略 */
    }
  }
  return 'https://blog.20240606.xyz'
}

/** 发一条消息；返回 Telegram 的 message_id（用于建立映射） */
export async function tgSendMessage({ text, replyToMessageId, buttons, disablePreview = true } = {}) {
  const cfg = readTgConfig()
  if (!cfg.enabled) return { ok: false, error: 'not_configured', missing: cfg.missing }

  const body = {
    chat_id: cfg.chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: disablePreview
  }
  if (replyToMessageId) body.reply_to_message_id = replyToMessageId
  if (buttons?.length) {
    body.reply_markup = { inline_keyboard: buttons.map(row => row) }
  }

  try {
    const res = await fetch(`${cfg.apiBase}/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description || `http_${res.status}` }
    }
    return { ok: true, messageId: data.result?.message_id ?? null }
  } catch (err) {
    return { ok: false, error: err?.message || 'network_error' }
  }
}

/** 把「TG 消息」与「私信会话」绑定 */
export async function linkTgMessage({ chatId, tgMessageId, conversationId, sourceMessageId = null, kind = 'notify' }) {
  if (!chatId || !tgMessageId || !conversationId) return false
  try {
    const client = getMessagesClient()
    const { error } = await client.from('tg_links').insert({
      tg_chat_id: Number(chatId),
      tg_message_id: Number(tgMessageId),
      conversation_id: conversationId,
      source_message_id: sourceMessageId,
      kind
    })
    if (error) {
      console.warn('[messages][tg] link failed:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.warn('[messages][tg] link threw:', err?.message || err)
    return false
  }
}

/** 访客消息通知（首条会话消息与后续追问都走这里） */
export async function notifyVisitorMessage({ conversation, message, isFirst = false }) {
  const cfg = readTgConfig()
  if (!cfg.enabled) return { ok: false, error: 'not_configured' }

  const name = conversation?.visitor_name || '访客'
  const raw = String(message?.content || '')
  const preview = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
  const count = Number(conversation?.message_count || 0)

  const lines = [
    isFirst ? '📬 <b>新的私信会话</b>' : '💬 <b>访客追问</b>',
    `来自 <b>${escapeHtml(name)}</b>${count ? ` · 共 ${count} 条` : ''}`,
    '',
    escapeHtml(preview)
  ]
  const text = lines.join('\n')

  const sent = await tgSendMessage({
    text,
    buttons: [
      [
        {
          text: '在后台查看',
          url: `${siteOrigin()}/admin/messages`
        }
      ]
    ]
  })

  if (sent.ok && sent.messageId) {
    await linkTgMessage({
      chatId: cfg.chatId,
      tgMessageId: sent.messageId,
      conversationId: conversation?.id,
      sourceMessageId: message?.id || null
    })
  } else if (!sent.ok) {
    console.warn('[messages][tg] notify failed:', sent.error)
  }
  return sent
}

/** TG 里"回复"某条通知 → 反查会话 */
export async function resolveConversationByReply(chatId, tgMessageId) {
  if (!chatId || !tgMessageId) return null
  try {
    const client = getMessagesClient()
    const { data, error } = await client
      .from('tg_links')
      .select('conversation_id, source_message_id, created_at')
      .eq('tg_chat_id', Number(chatId))
      .eq('tg_message_id', Number(tgMessageId))
      .maybeSingle()
    if (error) {
      console.warn('[messages][tg] resolve failed:', error.message)
      return null
    }
    return data || null
  } catch (err) {
    console.warn('[messages][tg] resolve threw:', err?.message || err)
    return null
  }
}

/**
 * update 去重：第一次见到返回 true，重复返回 false。
 * 用主键冲突做幂等，避免 Telegram 重投导致同一条回复写两次。
 */
export async function claimUpdate(updateId, note = null) {
  if (!updateId) return false
  try {
    const client = getMessagesClient()
    const { error } = await client.from('tg_updates').insert({ update_id: Number(updateId), note })
    if (!error) return true
    if (String(error.code) === '23505' || /duplicate key/i.test(error.message || '')) return false
    console.warn('[messages][tg] claim update failed:', error.message)
    return false
  } catch (err) {
    console.warn('[messages][tg] claim update threw:', err?.message || err)
    return false
  }
}

/** 回执：告诉你这次回复的结果（成功/失败/需要引用） */
export async function sendAck(text, { replyToMessageId } = {}) {
  return tgSendMessage({ text, replyToMessageId })
}

export const TG_SCHEMA_TABLES = { links: 'tg_links', updates: 'tg_updates' }
export { MESSAGES_SCHEMA }
