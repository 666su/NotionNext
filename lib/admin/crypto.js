/**
 * 后台加密工具（Node runtime 专用）
 */

import crypto from 'node:crypto'

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex')
}

export function hmacBase64url(secret, data) {
  return crypto
    .createHmac('sha256', String(secret))
    .update(String(data))
    .digest('base64url')
}

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url')
}

/** 常量时间字符串比较（长度不同也走一次完整比较） */
export function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8')
  const bufB = Buffer.from(String(b || ''), 'utf8')
  const len = Math.max(bufA.length, bufB.length, 1)
  const padA = Buffer.alloc(len)
  const padB = Buffer.alloc(len)
  bufA.copy(padA)
  bufB.copy(padB)
  return crypto.timingSafeEqual(padA, padB) && bufA.length === bufB.length
}

/**
 * IP 脱敏：只用于限流与审计关联，不落库明文 IP。
 * 加盐后取前 24 位十六进制，无法反查。
 */
export function hashIp(ip, secret) {
  if (!ip) return ''
  return sha256Hex(`${ip}|${secret || 'jba'}`).slice(0, 24)
}

/** 从请求里取客户端 IP（Vercel 走 x-forwarded-for） */
export function clientIp(req) {
  const forwarded = req?.headers?.['x-forwarded-for']
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const ip =
    String(raw || '').split(',')[0].trim() ||
    req?.socket?.remoteAddress ||
    ''
  return ip.replace(/^::ffff:/, '')
}
