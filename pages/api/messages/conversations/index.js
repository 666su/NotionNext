/**
 * POST /api/messages/conversations —— 创建私密会话（公开、限流）
 *
 * 成功返回**唯一一次**的私密链接（token 只在响应里出现一次，库内只存 HMAC）。
 */

import { readMessagesConfig } from '@/lib/messages/config'
import { buildPrivateLink, json, sameOrigin } from '@/lib/messages/respond'
import { checkCreateLimits, ipId } from '@/lib/messages/rate-limit'
import { createConversation } from '@/lib/messages/store'
import { notifyVisitorMessage } from '@/lib/messages/telegram'
import { validateCreatePayload } from '@/lib/messages/validate'

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } }
}

export default async function handler(req, res) {
  const cfg = readMessagesConfig()
  if (!cfg.enabled) return json(res, 503, { error: 'messages_disabled' })
  if (!cfg.ready) return json(res, 503, { error: 'messages_unavailable' })

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }
  if (!sameOrigin(req)) return json(res, 403, { error: 'cross_origin_denied' })

  // 先校验再限流：非法请求不消耗用户配额（也不会碰数据库）
  const parsed = validateCreatePayload(req.body, cfg.limits)
  if (!parsed.ok) {
    // honeypot 命中时也回 invalid_input，避免告诉机器人"你看穿了"
    const status = parsed.error === 'payload_too_large' ? 413 : 400
    return json(res, status, { error: parsed.error === 'spam_detected' ? 'invalid_input' : parsed.error })
  }

  const limit = await checkCreateLimits(req, cfg.limits)
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter || 60))
    return json(res, 429, { error: 'rate_limited', retryAfter: limit.retryAfter })
  }

  try {
    const result = await createConversation({
      ...parsed.value,
      ipHash: ipId(req),
      firstPath: typeof req.body?.first_path === 'string' ? req.body.first_path : null
    })

    if (result.duplicate) {
      return json(res, 200, {
        ok: true,
        conversation_id: result.id,
        link: null,
        duplicate: true,
        message: '该请求已创建过会话；出于安全考虑，私密链接只在首次创建时显示一次。'
      })
    }

    // TG 通知：Vercel 会在响应后冻结函数，所以必须"响应前 await"（内部 2.8s 超时兜底）
    try {
      await notifyVisitorMessage({
      conversation: {
        id: result.id,
        visitor_name: parsed.value.name,
        visitor_email: parsed.value.email || null,
        first_path: typeof req.body?.first_path === 'string' ? req.body.first_path : null,
        message_count: 1
      },
        message: { id: result.messageId, content: parsed.value.content },
        isFirst: true
      })
    } catch (err) {
      console.warn('[messages][tg] notify threw:', err?.message || err)
    }

    return json(res, 201, {
      ok: true,
      conversation_id: result.id,
      link: buildPrivateLink(req, result.id, result.token),
      duplicate: false
    })
  } catch (err) {
    if (err?.code === 'invalid_input') return json(res, 400, { error: 'invalid_input' })
    console.error('[messages][create] failed:', err?.code || err?.message || err)
    return json(res, 503, { error: 'store_unavailable' })
  }
}
