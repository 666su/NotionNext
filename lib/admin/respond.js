/**
 * 后台统一响应、Cookie 与鉴权守卫
 *
 * 三层鉴权的第 2 层（页面 GSSP）与第 3 层（每个 API）都在这里实现。
 * 原则：所有失败路径都不得返回任何统计/管理数据；后台响应一律 no-store + noindex。
 */

import { ADMIN_LOGIN_PATH } from './constants'
import { readAdminConfig } from './config'
import { clientIp, hashIp, timingSafeEqualStr } from './crypto'
import { readSession, touchSession } from './session'

/* ------------------------------------------------------------------ *
 * 响应
 * ------------------------------------------------------------------ */

export function setSecurityHeaders(res) {
  if (!res?.setHeader) return
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate')
  res.setHeader('Pragma', 'no-cache')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'DENY')
}

export function json(res, status, body) {
  setSecurityHeaders(res)
  res.status(status).json(body)
  return null
}

export function fail(res, status, code, extra = {}) {
  setSecurityHeaders(res)
  res.status(status).json({ error: code, ...extra })
  return null
}

/* ------------------------------------------------------------------ *
 * Cookie
 * ------------------------------------------------------------------ */

export function parseCookies(req) {
  const header = req?.headers?.cookie || ''
  const out = {}
  String(header)
    .split(';')
    .forEach(part => {
      const idx = part.indexOf('=')
      if (idx < 0) return
      const name = part.slice(0, idx).trim()
      const value = part.slice(idx + 1).trim()
      if (name) out[name] = decodeURIComponent(value)
    })
  return out
}

export function shouldUseSecureCookie(req) {
  if (process.env.NODE_ENV === 'production') return true
  if (process.env.VERCEL) return true
  const proto = String(req?.headers?.['x-forwarded-proto'] || '')
  return proto.split(',')[0].trim() === 'https'
}

export function serializeCookie(req, name, value, options = {}) {
  const {
    maxAge = 0,
    httpOnly = true,
    path = '/',
    sameSite = 'Lax',
    secure = shouldUseSecureCookie(req)
  } = options

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`]
  if (maxAge !== null) parts.push(`Max-Age=${Math.max(0, Math.floor(maxAge))}`)
  if (httpOnly) parts.push('HttpOnly')
  if (secure) parts.push('Secure')
  if (sameSite) parts.push(`SameSite=${sameSite}`)
  return parts.join('; ')
}

export function appendSetCookie(res, cookie) {
  const prev = res.getHeader('Set-Cookie')
  if (!prev) res.setHeader('Set-Cookie', [cookie])
  else if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, cookie])
  else res.setHeader('Set-Cookie', [prev, cookie])
}

export function clearSessionCookie(req, res, config) {
  appendSetCookie(
    res,
    serializeCookie(req, config.cookieName, '', { maxAge: 0 })
  )
  appendSetCookie(
    res,
    serializeCookie(req, config.csrfCookieName, '', {
      maxAge: 0,
      httpOnly: false
    })
  )
}

export function setSessionCookie(req, res, config, token, ttlSec) {
  appendSetCookie(
    res,
    serializeCookie(req, config.cookieName, token, {
      maxAge: ttlSec,
      httpOnly: true
    })
  )
}

export function setCsrfCookie(req, res, config, csrfToken, ttlSec) {
  appendSetCookie(
    res,
    serializeCookie(req, config.csrfCookieName, csrfToken, {
      maxAge: ttlSec,
      httpOnly: false
    })
  )
}

/* ------------------------------------------------------------------ *
 * 鉴权守卫
 * ------------------------------------------------------------------ */

function originAllowed(req) {
  const origin = req?.headers?.origin
  if (!origin) return true // 同源非 CORS 请求可能不带 Origin；CSRF 仍由双提交令牌兜底
  try {
    const url = new URL(String(origin))
    return url.host === String(req.headers.host || '')
  } catch (err) {
    return false
  }
}

function csrfValid(req, session, config) {
  if (!originAllowed(req)) return false
  const header = String(req?.headers?.['x-csrf-token'] || '')
  const cookie = String(parseCookies(req)[config.csrfCookieName] || '')
  const expected = String(session?.record?.csrf || '')
  if (!header || !expected) return false
  return timingSafeEqualStr(header, expected) && timingSafeEqualStr(cookie, expected)
}

/**
 * API 守卫：任何 /api/admin/* 都必须调用。
 * @returns {Promise<{ok:true, session, config}|null>} 失败时已写好响应
 */
export async function requireAdminApi(req, res, options = {}) {
  const { csrf = false } = options
  const config = readAdminConfig()

  if (!config.ready) {
    fail(res, 503, 'admin_unconfigured', { missing: config.missing })
    return null
  }

  const cookies = parseCookies(req)
  const token = cookies[config.cookieName]
  if (!token) {
    fail(res, 401, 'unauthorized')
    return null
  }

  let session
  try {
    session = await readSession(token, config.sessionSecret)
  } catch (err) {
    console.error('[admin][session] read failed:', err?.message || err)
    fail(res, 503, 'session_store_unavailable')
    return null
  }

  if (!session) {
    fail(res, 401, 'unauthorized')
    return null
  }

  try {
    const alive = await touchSession(session, config.sessionIdleSec)
    if (!alive) {
      fail(res, 401, 'session_expired')
      return null
    }
  } catch (err) {
    console.error('[admin][session] touch failed:', err?.message || err)
    fail(res, 503, 'session_store_unavailable')
    return null
  }

  if (csrf && !csrfValid(req, session, config)) {
    fail(res, 403, 'csrf_failed')
    return null
  }

  return { ok: true, session, config }
}

/**
 * 页面守卫（getServerSideProps 用）。
 * @returns {Promise<{ok:true, session, config}|{ok:false, redirect:object}|{ok:false, unconfigured:true, config}>}
 */
export async function requireAdminPage(ctx, options = {}) {
  const config = readAdminConfig()
  const res = ctx?.res

  if (res?.setHeader) setSecurityHeaders(res)

  if (!config.ready) {
    return { ok: false, unconfigured: true, config }
  }

  const token = ctx?.req?.cookies?.[config.cookieName]
  if (!token) {
    return { ok: false, redirect: loginRedirect(ctx, options.next) }
  }

  let session = null
  try {
    session = await readSession(token, config.sessionSecret)
  } catch (err) {
    console.error('[admin][page] session read failed:', err?.message || err)
    return { ok: false, unconfigured: true, config, storeError: true }
  }

  if (!session) {
    return { ok: false, redirect: loginRedirect(ctx, options.next) }
  }

  try {
    const alive = await touchSession(session, config.sessionIdleSec)
    if (!alive) {
      return { ok: false, redirect: loginRedirect(ctx, options.next) }
    }
  } catch (err) {
    console.error('[admin][page] session touch failed:', err?.message || err)
    return { ok: false, unconfigured: true, config, storeError: true }
  }

  return { ok: true, session, config }
}

export function loginRedirect(ctx, nextPath) {
  const target =
    safeNextPath(nextPath) ||
    safeNextPath(ctx?.req?.url) ||
    '/admin/dashboard'
  return {
    destination: `${ADMIN_LOGIN_PATH}?next=${encodeURIComponent(target)}`,
    permanent: false
  }
}

/** 只允许站内后台路径，防开放重定向 */
export function safeNextPath(raw) {
  const value = String(raw || '').trim()
  if (!value.startsWith('/admin')) return ''
  if (value.startsWith('//')) return ''
  if (value.startsWith(ADMIN_LOGIN_PATH)) return ''
  return value
}

/** 给会话记录用的请求指纹（不存明文） */
export function requestFingerprint(req, secret) {
  return {
    ipHash: hashIp(clientIp(req), secret),
    uaHash: (req?.headers?.['user-agent'] || '').slice(0, 200)
  }
}

export { timingSafeEqualStr }
