/**
 * GET  /api/messages/conversations/[id]/messages —— 消息列表（需 Cookie）
 * POST /api/messages/conversations/[id]/messages —— 访客继续发言（需 Cookie + 同源 + 限流）
 *
 * 幂等：body.client_request_id 相同 → 返回已存在的那条，不重复写入。
 */

import { requireConversation } from '@/lib/messages/auth'
import { readMessagesConfig } from '@/lib/messages/config'
import { json, sameOrigin } from '@/lib/messages/respond'
import { checkSendLimits } from '@/lib/messages/rate-limit'
import { appendMessage, getConversation, listMessages } from '@/lib/messages/store'
import { notifyVisitorMessage } from '@/lib/messages/telegram'
import { validateMessagePayload } from '@/lib/messages/validate'

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } }
}

export default async function handler(req, res) {
  const auth = requireConversation(req, req.query?.id)
  if (!auth.ok) return json(res, auth.status, { error: auth.error })

  if (req.method === 'GET') {
    try {
      const messages = await listMessages(auth.convId, { limit: req.query?.limit })
      return json(res, 200, { ok: true, messages })
    } catch (err) {
      console.error('[messages][list] failed:', err?.code || err?.message || err)
      return json(res, 503, { error: 'store_unavailable' })
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  if (!sameOrigin(req)) return json(res, 403, { error: 'cross_origin_denied' })

  const cfg = readMessagesConfig()
  if (!cfg.ready) return json(res, 503, { error: 'messages_unavailable' })

  const limit = await checkSendLimits(auth.convId, cfg.limits)
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter || 60))
    return json(res, 429, { error: 'rate_limited', retryAfter: limit.retryAfter })
  }

  const parsed = validateMessagePayload(req.body, cfg.limits)
  if (!parsed.ok) {
    return json(res, parsed.error === 'payload_too_large' ? 413 : 400, { error: parsed.error })
  }

  try {
    const { message, duplicated } = await appendMessage({
      convId: auth.convId,
      sender: 'visitor',
      content: parsed.value.content,
      clientRequestId: parsed.value.clientRequestId
    })
    if (!duplicated) {
      // TG 通知：响应前 await（Vercel 响应后会冻结函数），失败不影响访客
      try {
        const conv = await getConversation(auth.convId)
        await notifyVisitorMessage({ conversation: conv, message, isFirst: false })
      } catch (err) {
        console.warn('[messages][tg] notify threw:', err?.message || err)
      }
    }

    return json(res, duplicated ? 200 : 201, { ok: true, message, duplicated })
  } catch (err) {
    if (err?.code === 'not_found') return json(res, 404, { error: 'not_found' })
    if (err?.code === 'conversation_full') return json(res, 413, { error: 'conversation_full' })
    if (err?.code === 'invalid_input') return json(res, 400, { error: 'invalid_input' })
    console.error('[messages][send] failed:', err?.code || err?.message || err)
    return json(res, 503, { error: 'store_unavailable' })
  }
}
