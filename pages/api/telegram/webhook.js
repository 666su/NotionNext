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
import { claimUpdate, readTgConfig, resolveConversationByReply, sendAck } from '@/lib/messages/telegram'
import { appendMessage, getConversationDetail, markRead } from '@/lib/messages/store'
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
