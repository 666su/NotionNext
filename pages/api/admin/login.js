/**
 * POST /api/admin/login —— 管理员登录
 *
 * 安全要点：
 * - 统一失败文案，不泄露账号是否存在
 * - 双维度限流（账号 + IP），Redis 不可用时 fail-closed（503）
 * - 登录成功：轮换会话、下发 HttpOnly Cookie + CSRF Cookie、写审计
 */

import { audit } from '@/lib/admin/audit'
import { readAdminConfig } from '@/lib/admin/config'
import { clientIp, hashIp } from '@/lib/admin/crypto'
import { readJsonBody, safeTrim } from '@/lib/admin/http'
import {
  burnPasswordTime,
  verifyPassword
} from '@/lib/admin/password'
import {
  checkLoginLimit,
  recordLoginFailure,
  resetLoginFailures
} from '@/lib/admin/rate-limit'
import {
  fail,
  json,
  safeNextPath,
  setCsrfCookie,
  setSecurityHeaders,
  setSessionCookie
} from '@/lib/admin/respond'
import { createSession } from '@/lib/admin/session'
import {
  markBootstrapped,
  resolveAdminUser,
  saveUser
} from '@/lib/admin/store'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const config = readAdminConfig()
  if (!config.ready) {
    return json(res, 503, {
      error: 'admin_unconfigured',
      missing: config.missing
    })
  }

  const body = await readJsonBody(req)
  const username = safeTrim(body.username, 64)
  const password = String(body.password || '')
  const nextPath = safeNextPath(body.next)

  if (!username || !password) {
    return json(res, 400, { error: 'invalid_credentials' })
  }

  const ipHash = hashIp(clientIp(req), config.sessionSecret)

  // 1) 限流（Redis 不可用 → fail-closed）
  let limit
  try {
    limit = await checkLoginLimit({ username, ipHash, config })
  } catch (err) {
    console.error('[admin][login] rate limit store error:', err?.message || err)
    return json(res, 503, { error: 'session_store_unavailable' })
  }

  if (!limit.allowed) {
    await audit({
      action: 'login.rate_limited',
      result: 'denied',
      user: username,
      ipHash,
      detail: limit.reason
    })
    res.setHeader('Retry-After', String(limit.retryAfter))
    return json(res, 429, {
      error: 'too_many_attempts',
      retryAfter: limit.retryAfter
    })
  }

  // 2) 账号解析 + 校验（用户名不匹配也走一次哈希，避免时序差异）
  let user = null
  let storeError = false
  try {
    user = await resolveAdminUser(config)
  } catch (err) {
    console.error('[admin][login] user store error:', err?.message || err)
    storeError = true
  }

  if (storeError) {
    return json(res, 503, { error: 'session_store_unavailable' })
  }

  const usernameMatches =
    !!user && user.username.toLowerCase() === username.toLowerCase()

  let passwordOk = false
  if (usernameMatches && user?.passwordHash) {
    passwordOk = await verifyPassword(password, user.passwordHash)
  } else {
    await burnPasswordTime(password, config.bcryptCost)
  }

  if (!usernameMatches || !passwordOk) {
    try {
      await recordLoginFailure({ username, ipHash, config })
    } catch (err) {
      console.error('[admin][login] failure counter error:', err?.message || err)
    }
    await audit({
      action: 'login.failure',
      result: 'denied',
      user: username,
      ipHash
    })
    // 统一文案与状态码
    return json(res, 401, { error: 'invalid_credentials' })
  }

  // 3) 引导态：把环境变量里的哈希落库（之后改密以存储为准）
  try {
    if (user.bootstrap) {
      await saveUser({
        username: user.username,
        passwordHash: user.passwordHash,
        role: user.role || 'admin'
      })
      await markBootstrapped(user.username)
    }
    await resetLoginFailures({ username, ipHash })
  } catch (err) {
    console.warn('[admin][login] bootstrap/reset warn:', err?.message || err)
  }

  // 4) 建会话（登录成功必然轮换旧会话）
  let session
  try {
    session = await createSession({
      username: user.username,
      role: user.role || 'admin',
      secret: config.sessionSecret,
      idleSec: config.sessionIdleSec,
      ttlSec: config.sessionTtlSec,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] || ''
    })
  } catch (err) {
    console.error('[admin][login] session create error:', err?.message || err)
    return json(res, 503, { error: 'session_store_unavailable' })
  }

  // 旧 Cookie 由新的 Set-Cookie 覆盖（登录成功即轮换会话）
  setSessionCookie(req, res, config, session.token, config.sessionTtlSec)
  setCsrfCookie(req, res, config, session.csrfToken, config.sessionTtlSec)

  await audit({
    action: 'login.success',
    result: 'ok',
    user: user.username,
    ipHash
  })

  return json(res, 200, {
    ok: true,
    redirect: nextPath || '/admin/dashboard',
    user: { username: user.username, role: user.role || 'admin' },
    csrfToken: session.csrfToken
  })
}
