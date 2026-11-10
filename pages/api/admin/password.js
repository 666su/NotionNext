/**
 * POST /api/admin/password —— 修改管理员密码
 *
 * - 必须提供当前密码（敏感操作二次确认）
 * - 新密码走强度校验 + bcrypt
 * - 改密成功后**全部会话失效**（含当前），前端需重新登录
 */

import { audit } from '@/lib/admin/audit'
import { clientIp, hashIp } from '@/lib/admin/crypto'
import { readJsonBody } from '@/lib/admin/http'
import {
  hashPassword,
  validatePasswordStrength,
  verifyPassword
} from '@/lib/admin/password'
import {
  clearSessionCookie,
  fail,
  json,
  requireAdminApi,
  setSecurityHeaders
} from '@/lib/admin/respond'
import { destroyUserSessions } from '@/lib/admin/session'
import { resolveAdminUser, saveUser } from '@/lib/admin/store'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res, { csrf: true })
  if (!guard) return null

  const { config, session } = guard
  const username = session.record.uid
  const body = await readJsonBody(req)

  const currentPassword = String(body.currentPassword || '')
  const newPassword = String(body.newPassword || '')

  if (!currentPassword || !newPassword) {
    return fail(res, 400, 'missing_fields')
  }

  let user = null
  try {
    user = await resolveAdminUser(config)
  } catch (err) {
    console.error('[admin][password] user store error:', err?.message || err)
    return fail(res, 503, 'session_store_unavailable')
  }

  if (!user || user.username !== username) {
    return fail(res, 401, 'unauthorized')
  }

  const currentOk = await verifyPassword(currentPassword, user.passwordHash)
  if (!currentOk) {
    await audit({
      action: 'password.change',
      result: 'denied',
      user: username,
      ipHash: hashIp(clientIp(req), config.sessionSecret),
      detail: 'current_password_mismatch'
    })
    return fail(res, 400, 'current_password_invalid')
  }

  const strengthError = validatePasswordStrength(
    newPassword,
    config.passwordMinLength,
    username
  )
  if (strengthError) {
    return fail(res, 400, 'weak_password', { message: strengthError })
  }

  if (newPassword === currentPassword) {
    return fail(res, 400, 'password_unchanged')
  }

  let newHash
  try {
    newHash = await hashPassword(newPassword, config.bcryptCost)
  } catch (err) {
    console.error('[admin][password] hash error:', err?.message || err)
    return fail(res, 500, 'internal')
  }

  try {
    await saveUser({ username, passwordHash: newHash, role: user.role || 'admin' })
    await destroyUserSessions(username)
  } catch (err) {
    console.error('[admin][password] persist error:', err?.message || err)
    return fail(res, 503, 'session_store_unavailable')
  }

  clearSessionCookie(req, res, config)

  await audit({
    action: 'password.change',
    result: 'ok',
    user: username,
    ipHash: hashIp(clientIp(req), config.sessionSecret)
  })

  return json(res, 200, { ok: true, relogin: true })
}
