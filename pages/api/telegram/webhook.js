/**
 * POST /api/telegram/webhook —— Telegram 更新入口（Phase 7）
 *
 * 只做一件事：你在 TG 里「回复」某条私信通知 → 把内容作为管理员回复写回对应会话。
 *
 * 安全与健壮性：
 *   - 必须带 `X-Telegram-Bot-Api-Secret-Token`（= TELEGRAM_WEBHOOK_SECRET），否则 403；
 *   - 只接受 TELEGRAM_CHAT_ID 这个会话，其它 chat 一律 200 忽略（不泄露任何信息）；
 *   - `update_id` 幂等：Telegram 重投不会写两条；
 *   - 未引用的普通消息不写入，只回提示，避免误发；
 *   - 任何异常都返回 200（避免 Telegram 无限重试），失败原因写服务端日志 + 回执。
 */

import { audit } from '@/lib/admin/audit'
import { readMessagesConfig } from '@/lib/messages/config'
import { claimUpdate, escapeHtml, readTgConfig, resolveConversationByReply, sendAck } from '@/lib/messages/telegram'
import {
  appendMessage,
  findByShortId,
  getConversationDetail,
  listConversations,
  markRead,
  updateStatus
} from '@/lib/messages/store'
import { validateMessagePayload } from '@/lib/messages/validate'

const MAX_ACK_TEXT = 60

function clip(text, max = MAX_ACK_TEXT) {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'method_not_allowed' })
  }

  const cfg = readTgConfig()
  if (!cfg.webhookSecret) {
    console.error('[messages][tg] webhook 未配置 TELEGRAM_WEBHOOK_SECRET')
    return res.status(503).json({ ok: false, error: 'webhook_not_configured' })
  }

  const secret = String(req.headers['x-telegram-bot-api-secret-token'] || '')
  if (secret !== cfg.webhookSecret) {
    return res.status(403).json({ ok: false, error: 'forbidden' })
  }

  const update = req.body && typeof req.body === 'object' ? req.body : null
  if (!update) return res.status(400).json({ ok: false, error: 'invalid_update' })

  const message = update.message || update.edited_message || null
  if (!message) return res.status(200).json({ ok: true, ignored: 'no_message' })

  const chatId = String(message.chat?.id || '')
  if (!cfg.chatId || chatId !== String(cfg.chatId)) {
    return res.status(200).json({ ok: true, ignored: 'chat_not_allowed' })
  }

  const text = String(message.text || '').trim()
  if (!text) return res.status(200).json({ ok: true, ignored: 'no_text' })

  // ---- TG 指令：/help /list /close <短码> ----
  if (text.startsWith('/')) {
    const result = await handleCommand(text, message)
    return res.status(200).json({ ok: true, command: result })
  }

  const replyToId = message.reply_to_message?.message_id
  if (!replyToId) {
    await sendAck('用「回复」引用某条私信通知再发内容，我才知道发给谁。')
    return res.status(200).json({ ok: true, ignored: 'not_a_reply' })
  }

  const claimed = await claimUpdate(update.update_id, 'reply')
  if (!claimed) return res.status(200).json({ ok: true, duplicate: true })

  const link = await resolveConversationByReply(chatId, replyToId)
  if (!link?.conversation_id) {
    await sendAck('这条通知找不到对应会话（可能已被删除）。请到后台处理。', {
      replyToMessageId: message.message_id
    })
    return res.status(200).json({ ok: true, ignored: 'unknown_link' })
  }

  const { limits } = readMessagesConfig()
  const checked = validateMessagePayload({ content: text }, limits)
  if (!checked.ok) {
    const reason = checked.error === 'payload_too_large' ? '内容太长' : '内容不合规'
    await sendAck(`${reason}，没有发送。`, { replyToMessageId: message.message_id })
    return res.status(200).json({ ok: true, error: checked.error })
  }

  try {
    await appendMessage({
      convId: link.conversation_id,
      sender: 'admin',
      content: checked.value.content
    })

    const detail = await getConversationDetail(link.conversation_id)
    const name = detail?.conversation?.visitor_name || '访客'

    // 你已经在 TG 里看并回了这条 → 未读数归零，后台徽标不会一直亮着
    try {
      await markRead(link.conversation_id)
    } catch (err) {
      console.warn('[messages][tg] markRead failed:', err?.message || err)
    }

    await sendAck(`✅ 已发给 ${name}\n「${clip(checked.value.content)}」`, {
      replyToMessageId: message.message_id
    })

    await audit({
      action: 'messages.tg_reply',
      result: 'ok',
      user: 'telegram',
      ipHash: '',
      detail: link.conversation_id
    })

    return res.status(200).json({ ok: true, delivered: true, conversation_id: link.conversation_id })
  } catch (err) {
    const code = err?.code || 'store_unavailable'
    console.error('[messages][tg] reply failed:', code, err?.message || '')
    await audit({
      action: 'messages.tg_reply',
      result: 'error',
      user: 'telegram',
      ipHash: '',
      detail: `${link.conversation_id} ${code}`
    })
    const hint =
      code === 'conversation_full'
        ? '这个会话消息已满 2000 条，无法再写。'
        : code === 'not_found'
          ? '会话已删除或不可写。'
          : '写入失败，请稍后重试或在后台处理。'
    await sendAck(hint, { replyToMessageId: message.message_id })
    return res.status(200).json({ ok: false, error: code })
  }
}

const NL = String.fromCharCode(10)

const HELP_TEXT = [
  '<b>私信机器人指令</b>',
  '/list —— 看待处理（未读）会话',
  '/close &lt;短码&gt; —— 把某会话标记为已解决',
  '',
  '回复某条私信通知 = 回复那位访客。'
].join(NL)

async function handleCommand(text, message) {
  const [rawCmd, ...rest] = text.trim().split(/\s+/)
  const cmd = rawCmd.toLowerCase().replace(/@[\w_]+$/, '')
  const replyTo = { replyToMessageId: message.message_id }

  if (cmd === '/help' || cmd === '/start') {
    await sendAck(HELP_TEXT, replyTo)
    return 'help'
  }

  if (cmd === '/list') {
    const [unread, processing] = await Promise.all([
      listConversations({ status: 'unread', page: 1, pageSize: 8 }),
      listConversations({ status: 'processing', page: 1, pageSize: 8 })
    ])
    const rows = [...(unread.rows || []), ...(processing.rows || [])]
      .sort((a, b) => String(b.last_message_at || '').localeCompare(String(a.last_message_at || '')))
      .slice(0, 8)
    if (!rows.length) {
      await sendAck('现在没有待处理的私信 🎉', replyTo)
      return 'list_empty'
    }
    const lines = rows.map((row, index) => {
      const code = String(row.id).slice(0, 8)
      const name = escapeHtml(row.visitor_name || '访客')
      const count = row.message_count || 0
      return `${index + 1}. <b>${name}</b> · ${count} 条 · <code>${code}</code>`
    })
    await sendAck(
      [`<b>待处理 ${rows.length} 个会话</b>`, ...lines, '', '结案：<code>/close 短码</code>'].join(NL),
      replyTo
    )
    return 'list'
  }

  if (cmd === '/close') {
    const code = String(rest[0] || '').trim()
    if (!code) {
      await sendAck('用法：<code>/close 短码</code>（短码可用 /list 查看）', replyTo)
      return 'close_no_arg'
    }
    const conv = await findByShortId(code)
    if (!conv) {
      await sendAck(`找不到唯一匹配 <code>${escapeHtml(code)}</code> 的会话，请用 /list 里的短码。`, replyTo)
      return 'close_not_found'
    }
    await updateStatus(conv.id, 'resolved')
    await markRead(conv.id)
    await sendAck(`✅ 已把 <b>${escapeHtml(conv.visitor_name || '访客')}</b>（${String(conv.id).slice(0, 8)}）标记为已解决`, replyTo)
    await audit({ action: 'messages.tg_close', result: 'ok', user: 'telegram', ipHash: '', detail: conv.id })
    return 'closed'
  }

  await sendAck(`不认识的指令 ${escapeHtml(cmd)}${NL}${NL}${HELP_TEXT}`, replyTo)
  return 'unknown'
}
