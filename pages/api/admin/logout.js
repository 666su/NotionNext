/**
 * POST /api/admin/logout —— 退出登录
 * 销毁服务端会话 + 清除 Cookie + 写审计。
 */

import { audit } from '@/lib/admin/audit'
import { clientIp, hashIp } from '@/lib/admin/crypto'
import { readJsonBody } from '@/lib/admin/http'
import {
  clearSessionCookie,
  json,
  requireAdminApi,
  setSecurityHeaders
} from '@/lib/admin/respond'
import { destroySession } from '@/lib/admin/session'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res, { csrf: true })
  if (!guard) return null

  await readJsonBody(req)

  try {
    await destroySession(guard.session)
  } catch (err) {
    console.error('[admin][logout] destroy failed:', err?.message || err)
  }

  clearSessionCookie(req, res, guard.config)

  await audit({
    action: 'logout',
    result: 'ok',
    user: guard.session.record.uid,
    ipHash: hashIp(clientIp(req), guard.config.sessionSecret)
  })

  return json(res, 200, { ok: true })
}
