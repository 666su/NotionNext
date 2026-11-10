/**
 * 推送接口的轻量限流（防枚举 / 防滥用）
 *
 * 有 REDIS_URL 时用 Redis（跨实例）；否则退化为进程内 Map（仅尽力而为）。
 * 注意：这不是安全边界，只是提高暴力尝试的成本。
 */

import { KV_PUSH_RL } from './constants'

const memoryCounters =
  globalThis.__notifyRateLimit || (globalThis.__notifyRateLimit = new Map())

async function incrRedis(key, windowSec) {
  const { default: Redis } = await import('ioredis')
  const client = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true
  })
  try {
    await client.connect()
    const count = await client.incr(key)
    if (count === 1) await client.expire(key, windowSec)
    return count
  } finally {
    client.disconnect()
  }
}

function incrMemory(key, windowSec) {
  const now = Date.now()
  const hit = memoryCounters.get(key)
  if (!hit || hit.exp < now) {
    memoryCounters.set(key, { count: 1, exp: now + windowSec * 1000 })
    return 1
  }
  hit.count += 1
  return hit.count
}

/**
 * @returns {Promise<{allowed: boolean, count: number, limit: number}>}
 */
export async function hitRateLimit({ bucket, id, limit, windowSec }) {
  const safeId = String(id || 'unknown')
    .replace(/[^a-zA-Z0-9:_-]/g, '')
    .slice(0, 64)
  const key = `${KV_PUSH_RL}${bucket}:${safeId}`

  let count
  if (process.env.REDIS_URL) {
    try {
      count = await incrRedis(key, windowSec)
    } catch (err) {
      count = incrMemory(key, windowSec)
    }
  } else {
    count = incrMemory(key, windowSec)
  }

  return { allowed: count <= limit, count, limit }
}
