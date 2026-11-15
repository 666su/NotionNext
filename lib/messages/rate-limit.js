/**
 * 私信限流（Redis 计数；Redis 不可用时退化为进程内计数）
 *
 * 规范 §8.1：不能只靠 IP；这里用「加盐哈希后的 IP」作为来源标识，不落明文 IP。
 */

import { clientIp, hashIp } from '@/lib/admin/crypto'
import { kvExpire, kvGet, kvIncr, kvTtl } from '@/lib/kv'
import { readMessagesConfig } from './config'

const memory = globalThis.__jbmRateLimit || (globalThis.__jbmRateLimit = new Map())

function memHit(key, windowSec) {
  const now = Date.now()
  const hit = memory.get(key)
  if (!hit || hit.exp <= now) {
    memory.set(key, { count: 1, exp: now + windowSec * 1000 })
    return 1
  }
  hit.count += 1
  return hit.count
}

function hashedIp(req) {
  const { tokenSecret } = readMessagesConfig()
  const ip = clientIp(req)
  return hashIp(ip, tokenSecret || 'jbm-fallback').slice(0, 24)
}

/**
 * @returns {Promise<{allowed:boolean, count:number, limit:number, retryAfter:number}>}
 */
export async function hitLimit({ bucket, id, limit, windowSec }) {
  const key = `msg:v1:rl:${bucket}:${id}:${windowSec}`
  try {
    const count = Number(await kvIncr(key)) || 0
    if (count === 1) await kvExpire(key, windowSec)
    let retryAfter = windowSec
    if (count > limit) {
      const ttl = Number(await kvTtl(key))
      if (Number.isFinite(ttl) && ttl > 0) retryAfter = ttl
    }
    return { allowed: count <= limit, count, limit, retryAfter }
  } catch (err) {
    // Redis 不可用：退化为进程内计数（尽力而为），并记录一次
    console.warn('[messages][rate] store unavailable, fallback to memory:', err?.message || err)
    const count = memHit(key, windowSec)
    return { allowed: count <= limit, count, limit, retryAfter: windowSec }
  }
}

export function ipId(req) {
  return hashedIp(req)
}

/** 创建会话的三重限制：IP 10 分钟 / IP 当日 / 全站当日 */
export async function checkCreateLimits(req, limits) {
  const ip = hashedIp(req)
  const day = new Date().toISOString().slice(0, 10)
  const checks = [
    { bucket: 'create:ip10m', id: ip, limit: limits.RATE.createPerIp10m, windowSec: 600 },
    { bucket: 'create:ipday', id: ip, limit: limits.RATE.createPerIpDay, windowSec: 86400 },
    { bucket: 'create:globalday', id: day, limit: limits.RATE.createGlobalDay, windowSec: 86400 }
  ]
  for (const check of checks) {
    const result = await hitLimit(check)
    if (!result.allowed) return { allowed: false, retryAfter: result.retryAfter }
  }
  return { allowed: true }
}

/** 访客发消息：每会话 分钟/小时 双限 */
export async function checkSendLimits(convId, limits) {
  const checks = [
    { bucket: 'send:conv1m', id: convId, limit: limits.RATE.sendPerConvMinute, windowSec: 60 },
    { bucket: 'send:conv1h', id: convId, limit: limits.RATE.sendPerConvHour, windowSec: 3600 }
  ]
  for (const check of checks) {
    const result = await hitLimit(check)
    if (!result.allowed) return { allowed: false, retryAfter: result.retryAfter }
  }
  return { allowed: true }
}

/** 凭证兑换：分钟/小时 + 失败封禁 */
export async function checkExchangeLimits(req, limits) {
  const ip = hashedIp(req)
  const checks = [
    { bucket: 'exchange:ip1m', id: ip, limit: limits.RATE.exchangePerIpMinute, windowSec: 60 },
    { bucket: 'exchange:ip1h', id: ip, limit: limits.RATE.exchangePerIpHour, windowSec: 3600 }
  ]
  for (const check of checks) {
    const result = await hitLimit(check)
    if (!result.allowed) return { allowed: false, retryAfter: result.retryAfter }
  }
  return { allowed: true, ip }
}

export async function recordExchangeFailure(ip, limits) {
  return hitLimit({
    bucket: 'exchange:fail',
    id: ip,
    limit: limits.RATE.exchangeFail30m,
    windowSec: 1800
  })
}

export async function isExchangeBlocked(ip, limits) {
  const key = `msg:v1:rl:exchange:fail:${ip}:1800`
  try {
    const raw = await kvGet(key)
    return Number(raw || 0) >= limits.RATE.exchangeFail30m
  } catch (err) {
    return false
  }
}
