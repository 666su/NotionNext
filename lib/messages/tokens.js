/**
 * 会话标识、访问凭证与私密 Cookie 的签名/校验
 *
 * 规则（规范 §5）：
 * - conversation_id 公开；access_token 秘密；库内只存 HMAC(token, MESSAGE_TOKEN_SECRET)
 * - Cookie 里放 <convId>.<expSec>.<HMAC(convId|expSec)>，服务端校验签名与过期
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

const B64URL = /^[A-Za-z0-9_-]+$/

export function randomTokenUrl(bytes = 32) {
  return randomBytes(bytes).toString('base64url')
}

export function conversationId() {
  return randomTokenUrl(12) // 16 字符
}

export function accessToken() {
  return randomTokenUrl(32) // 43 字符
}

export function hmac(value, secret) {
  return createHmac('sha256', String(secret)).update(String(value)).digest('base64url')
}

export function hashAccessToken(token, secret) {
  return hmac(`access:${token}`, secret)
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (!left.length || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/** 校验访问凭证：恒定时间比较，不区分"不存在"与"不匹配"（调用方统一返回 invalid_credential） */
export function verifyAccessToken(token, tokenHash, secret) {
  if (!token || !tokenHash) return false
  if (!B64URL.test(String(token))) return false
  return safeEqual(hashAccessToken(token, secret), tokenHash)
}

export function cookieNameFor(convId) {
  const prefix = String(convId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 10)
  return `jbm_${prefix}`
}

export function signCookieValue(convId, expSec, secret) {
  const payload = `${convId}|${expSec}`
  return `${convId}.${expSec}.${hmac(payload, secret)}`
}

/** @returns {{convId:string, expSec:number}|null} */
export function verifyCookieValue(raw, secret) {
  const value = String(raw || '')
  const parts = value.split('.')
  if (parts.length !== 3) return null
  const [convId, expRaw, sig] = parts
  if (!B64URL.test(convId) || !/^\d{1,12}$/.test(expRaw)) return null
  const expSec = Number(expRaw)
  if (!Number.isFinite(expSec) || expSec * 1000 <= Date.now()) return null
  if (!safeEqual(sig, hmac(`${convId}|${expSec}`, secret))) return null
  return { convId, expSec }
}

export function messageId() {
  const ts = Date.now().toString(36)
  return `m_${ts}_${randomTokenUrl(6)}`
}
