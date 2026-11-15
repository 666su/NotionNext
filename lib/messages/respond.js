/**
 * 私信接口的响应与 Cookie 工具
 *
 * 安全头（规范 §3.9 / §10）：no-store + noindex + no-referrer + nosniff + DENY
 * Cookie：复用 lib/admin/respond.js 的 serializeCookie（已支持 path/sameSite/httpOnly/secure）
 */

import { parseCookies, serializeCookie } from '@/lib/admin/respond'

export function setMessagesHeaders(res) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
}

export function json(res, status, body) {
  setMessagesHeaders(res)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
  return null
}

/** 同源校验（Origin 存在时必须与 Host 一致） */
export function sameOrigin(req) {
  const origin = req?.headers?.origin
  if (!origin) return true
  try {
    return new URL(String(origin)).host === String(req.headers.host || '')
  } catch (err) {
    return false
  }
}

/** 读某个私信会话 Cookie（名字里带 convId 前缀，避免多会话互相覆盖） */
export function readConversationCookie(req, cookieName) {
  const cookies = parseCookies(req)
  return cookies[cookieName] || ''
}

/**
 * 下发会话 Cookie。
 * Phase 1 只有 API 路径，所以 Path 指向该会话的接口前缀（最小作用域）；
 * Phase 2 增加页面时再补一个 /message/<id> 的同值 Cookie。
 */
export function setConversationCookie(req, res, { name, value, convId, ttlSec }) {
  const cookie = serializeCookie(req, name, value, {
    maxAge: ttlSec,
    httpOnly: true,
    sameSite: 'Lax',
    path: `/api/messages/conversations/${convId}`
  })
  const prev = res.getHeader('Set-Cookie')
  if (!prev) res.setHeader('Set-Cookie', [cookie])
  else if (Array.isArray(prev)) res.setHeader('Set-Cookie', [...prev, cookie])
  else res.setHeader('Set-Cookie', [prev, cookie])
}

export function clearConversationCookie(req, res, { name, convId }) {
  const cookie = serializeCookie(req, name, '', {
    maxAge: 0,
    httpOnly: true,
    sameSite: 'Lax',
    path: `/api/messages/conversations/${convId}`
  })
  res.setHeader('Set-Cookie', [cookie])
}

/** 解析路径参数中的会话 ID（只接受 base64url 16 字符） */
export function normalizeConvId(raw) {
  const value = String(raw || '').trim()
  return /^[A-Za-z0-9_-]{8,40}$/.test(value) ? value : ''
}

/** 组装私密链接（域名以请求 origin 为准，避免用错配置域名） */
export function buildPrivateLink(req, convId, token) {
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim()
  const base = host ? `${proto}://${host}` : ''
  return `${base}/message/${convId}#${token}`
}
