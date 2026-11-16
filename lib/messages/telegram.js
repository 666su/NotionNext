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
import { logAccess } from './store'

const DEFAULT_API_BASE = 'https://api.telegram.org'

// Telegram 侧超时：webhook 必须在 Vercel 的函数时限内返回，
// 一旦 API base 填错（例如指向不可达地址）会一直挂着，所以这里硬性 4 秒截断。
const TG_TIMEOUT_MS = 4000

export function readTgConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim()
  const apiBase = String(process.env.TELEGRAM_API_BASE || DEFAULT_API_BASE).replace(/\/+$/, '')
  const webhookSecret = String(process.env.TELEGRAM_WEBHOOK_SECRET || '').trim()
  if (process.env.NODE_ENV === 'production' && /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(apiBase)) {
    // 生产环境把 API base 指向本地 = 推送与回执必然失败（通常是本地桩忘了删）
    console.warn('[messages][tg] TELEGRAM_API_BASE 指向本地地址，生产环境请删除该变量：', apiBase)
  }
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

/** 北京时间（TG 里你看的是北京时间，不用自己换算） */
export function formatLocalTime(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('zh-CN', {
      timeZone: 'Asia/Shanghai',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(date)
  } catch (err) {
    return new Date(date).toISOString().slice(5, 16).replace('T', ' ')
  }
}

function siteOrigin() {  const raw = String(process.env.NEXT_PUBLIC_LINK || process.env.NEXT_PUBLIC_SITE_URL || '').trim()
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
export async function tgSendMessage({ text, replyToMessageId, buttons, disablePreview = true, timeoutMs } = {}) {
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

  const budget = Number(timeoutMs) > 0 ? Number(timeoutMs) : TG_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), budget)
  try {
    const res = await fetch(`${cfg.apiBase}/bot${cfg.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.ok) {
      return { ok: false, error: data.description || `http_${res.status}` }
    }
    return { ok: true, messageId: data.result?.message_id ?? null }
  } catch (err) {
    const aborted = err?.name === 'AbortError'
    return { ok: false, error: aborted ? `timeout_${budget}ms` : err?.message || 'network_error' }
  } finally {
    clearTimeout(timer)
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
  if (!cfg.enabled) {
    // 最常见：Vercel 只加了 WEBHOOK_SECRET，漏了 BOT_TOKEN / CHAT_ID
    try {
      await logAccess({
        convId: conversation?.id || null,
        action: 'tg_notify',
        result: `not_configured:${(cfg.missing || []).join('+') || 'unknown'}`.slice(0, 40),
        ipHash: null
      })
    } catch (err) {
      /* 忽略 */
    }
    return { ok: false, error: 'not_configured', missing: cfg.missing }
  }

  const name = conversation?.visitor_name || '访客'
  const email = String(conversation?.visitor_email || '').trim()
  const firstPath = String(conversation?.first_path || '').trim()
  const convCode = String(conversation?.id || '').slice(0, 8)
  const raw = String(message?.content || '')
  const preview = raw.length > 300 ? `${raw.slice(0, 300)}…` : raw
  const count = Number(conversation?.message_count || 0)

  const meta = [`🕒 ${formatLocalTime()}`]
  if (convCode) meta.push(`会话 <code>${escapeHtml(convCode)}</code>`)
  if (count) meta.push(`第 ${count} 条`)

  const lines = [
    isFirst ? '📬 <b>新的私信会话</b>' : '💬 <b>访客追问</b>',
    `👤 <b>${escapeHtml(name)}</b>`,
    meta.join(' · '),
    ...(email ? [`📧 ${escapeHtml(email)}`] : []),
    ...(isFirst && firstPath ? [`🔗 来自 ${escapeHtml(firstPath)}`] : []),
    '',
    escapeHtml(preview),
    '',
    '<i>直接「回复」这条消息 = 回复该访客</i>'
  ]
  const text = lines.join('\n')

  const sent = await tgSendMessage({
    timeoutMs: 2800,
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
    console.warn('[messages][tg] notify failed:', sent.error, sent.missing ? `缺少 ${sent.missing.join('/')}` : '')
    // durable 证据：Vercel 日志会滚掉，写一条 access_logs 便于事后查（不含内容）
    try {
      await logAccess({
        convId: conversation?.id || null,
        action: 'tg_notify',
        result: String(sent.error || 'failed').slice(0, 40),
        ipHash: null
      })
    } catch (err) {
      /* 忽略 */
    }
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
  return tgSendMessage({ text, replyToMessageId, timeoutMs: 3500 })
}

export const TG_SCHEMA_TABLES = { links: 'tg_links', updates: 'tg_updates' }
export { MESSAGES_SCHEMA }
