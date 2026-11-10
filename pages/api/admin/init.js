/**
 * POST /api/admin/init —— 一次性管理员初始化
 *
 * 适用场景：不想把哈希写进环境变量时，用 ADMIN_INIT_TOKEN 完成一次性初始化。
 * 规则：
 * - 仅在"尚无管理员记录"时可用（初始化后永久返回 409）
 * - token 只从服务端环境变量读取，常量时间比较
 * - 初始化成功后立即关闭入口（存储里已有记录）
 */

import { audit } from '@/lib/admin/audit'
import { readAdminConfig } from '@/lib/admin/config'
import { clientIp, hashIp, timingSafeEqualStr } from '@/lib/admin/crypto'
import { readJsonBody, safeTrim } from '@/lib/admin/http'
import {
  hashPassword,
  validatePasswordStrength
} from '@/lib/admin/password'
import { fail, json, setSecurityHeaders } from '@/lib/admin/respond'
import { getUser, markBootstrapped, saveUser } from '@/lib/admin/store'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const config = readAdminConfig()
  if (config.code === 'disabled') {
    return fail(res, 503, 'admin_disabled')
  }
  if (!config.username) {
    return fail(res, 503, 'admin_unconfigured', { missing: config.missing })
  }
  if (!config.initToken) {
    return fail(res, 403, 'init_disabled')
  }

  const body = await readJsonBody(req)
  const token = safeTrim(body.token, 256)
  const username = safeTrim(body.username, 64) || config.username
  const password = String(body.password || '')

  if (!token || !password) {
    return fail(res, 400, 'missing_fields')
  }
  if (username !== config.username) {
    return fail(res, 400, 'username_not_allowed')
  }

  // 常量时间比较（长度不同也完整比较）
  if (!timingSafeEqualStr(token, config.initToken)) {
    await audit({
      action: 'init.attempt',
      result: 'denied',
      user: username,
      ipHash: hashIp(clientIp(req), config.sessionSecret || 'jba')
    })
    return fail(res, 403, 'invalid_token')
  }

  let existing = null
  try {
    existing = await getUser(username)
  } catch (err) {
    console.error('[admin][init] store error:', err?.message || err)
    return fail(res, 503, 'session_store_unavailable')
  }
  if (existing) {
    return fail(res, 409, 'already_initialized')
  }

  const strengthError = validatePasswordStrength(
    password,
    config.passwordMinLength || 12,
    username
  )
  if (strengthError) {
    return fail(res, 400, 'weak_password', { message: strengthError })
  }

  try {
    const passwordHash = await hashPassword(password, config.bcryptCost || 12)
    await saveUser({ username, passwordHash, role: 'admin' })
    await markBootstrapped(username)
  } catch (err) {
    console.error('[admin][init] persist error:', err?.message || err)
    return fail(res, 503, 'session_store_unavailable')
  }

  await audit({
    action: 'init.success',
    result: 'ok',
    user: username,
    ipHash: hashIp(clientIp(req), config.sessionSecret || 'jba')
  })

  return json(res, 201, { ok: true, login: '/admin/login' })
}
