/**
 * POST /api/messages/access/exchange —— 用 fragment 里的 token 兑换私密 Cookie
 *
 * 规范 §4.4：
 * - 只接受 POST（token 不进 URL、不进访问日志）；
 * - 校验失败统一返回 invalid_credential（不区分"不存在/已删/token 错"）；
 * - 成功后下发 HttpOnly Cookie，作用域限于该会话的接口路径。
 */

import { readMessagesConfig } from '@/lib/messages/config'
import {
  clearConversationCookie,
  json,
  normalizeConvId,
  sameOrigin,
  setConversationCookie
} from '@/lib/messages/respond'
import {
  checkExchangeLimits,
  isExchangeBlocked,
  recordExchangeFailure
} from '@/lib/messages/rate-limit'
import { getConversationForExchange, logAccess } from '@/lib/messages/store'
import { cookieNameFor, signCookieValue, verifyAccessToken } from '@/lib/messages/tokens'

export const config = {
  api: { bodyParser: { sizeLimit: '4kb' } }
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

  const convId = normalizeConvId(req.body?.conversation_id)
  const token = String(req.body?.token || '').trim()

  const limit = await checkExchangeLimits(req, cfg.limits)
  if (!limit.allowed) {
    res.setHeader('Retry-After', String(limit.retryAfter || 60))
    return json(res, 429, { error: 'rate_limited', retryAfter: limit.retryAfter })
  }

  if (convId && limit.ip && (await isExchangeBlocked(limit.ip, cfg.limits))) {
    res.setHeader('Retry-After', '1800')
    return json(res, 429, { error: 'rate_limited', retryAfter: 1800 })
  }

  if (!convId || !token) {
    if (convId) clearConversationCookie(req, res, { name: cookieNameFor(convId), convId })
    return json(res, 403, { error: 'invalid_credential' })
  }

  try {
    const conv = await getConversationForExchange(convId)
    const valid =
      !!conv &&
      !conv.deleted_at &&
      conv.status !== 'spam' &&
      verifyAccessToken(token, conv.token_hash, cfg.tokenSecret)

    if (!valid) {
      if (limit.ip) await recordExchangeFailure(limit.ip, cfg.limits)
      await logAccess({ convId, action: 'exchange', result: 'invalid_credential', ipHash: limit.ip })
      return json(res, 403, { error: 'invalid_credential' })
    }

    await logAccess({ convId, action: 'exchange', result: 'ok', ipHash: limit.ip })

    const expSec = Math.floor(Date.now() / 1000) + cfg.limits.COOKIE_TTL_SEC
    const name = cookieNameFor(convId)
    setConversationCookie(req, res, {
      name,
      convId,
      ttlSec: cfg.limits.COOKIE_TTL_SEC,
      value: signCookieValue(convId, expSec, cfg.tokenSecret)
    })

    return json(res, 200, {
      ok: true,
      conversation_id: convId,
      status: conv.status,
      expires_in: cfg.limits.COOKIE_TTL_SEC
    })
  } catch (err) {
    console.error('[messages][exchange] failed:', err?.code || err?.message || err)
    return json(res, 503, { error: 'store_unavailable' })
  }
}
