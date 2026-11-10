/**
 * 登录限流（跨实例，Redis 计数）
 *
 * - 维度：用户名（哈希）+ IP（加盐哈希）
 * - 达到阈值后返回冷却剩余秒数；**不做永久锁死**（窗口到期自动恢复）
 * - Redis 不可用时由调用方 fail-closed（拒绝登录），不降级为放行
 */

import { KV_LOGIN_FAIL, KV_LOGIN_IP } from './constants'
import { sha256Hex } from './crypto'
import { kvDel, kvExpire, kvGet, kvIncr, kvTtl } from '@/lib/kv'

function userKey(username) {
  return sha256Hex(String(username || '').toLowerCase()).slice(0, 20)
}

export async function checkLoginLimit({ username, ipHash, config }) {
  const key = KV_LOGIN_FAIL + userKey(username)
  const ipKey = KV_LOGIN_IP + (ipHash || 'unknown')

  const [failureRaw, ipRaw, failureTtl, ipTtl] = await Promise.all([
    kvGet(key),
    kvGet(ipKey),
    kvTtl(key),
    kvTtl(ipKey)
  ])

  const failures = Number(failureRaw || 0)
  const ipFailures = Number(ipRaw || 0)

  if (failures >= config.loginMaxFails) {
    return {
      allowed: false,
      reason: 'account',
      retryAfter: Math.max(1, Number(failureTtl) > 0 ? failureTtl : config.loginWindowSec)
    }
  }

  if (ipFailures >= config.loginIpMax) {
    return {
      allowed: false,
      reason: 'ip',
      retryAfter: Math.max(1, Number(ipTtl) > 0 ? ipTtl : config.loginWindowSec)
    }
  }

  return { allowed: true, reason: '', retryAfter: 0 }
}

export async function recordLoginFailure({ username, ipHash, config }) {
  const key = KV_LOGIN_FAIL + userKey(username)
  const ipKey = KV_LOGIN_IP + (ipHash || 'unknown')

  const next = await kvIncr(key)
  if (next === 1) await kvExpire(key, config.loginWindowSec)

  const ipNext = await kvIncr(ipKey)
  if (ipNext === 1) await kvExpire(ipKey, config.loginWindowSec)

  return { failures: Number(next), ipFailures: Number(ipNext) }
}

export async function resetLoginFailures({ username, ipHash }) {
  await kvDel(KV_LOGIN_FAIL + userKey(username), KV_LOGIN_IP + (ipHash || 'unknown'))
}
