/**
 * 后台键值存储层
 *
 * - 生产：Redis（Upstash 兼容 redis:// / rediss://），与 ISR 缓存/rank/notify 共实例但**键前缀独立**。
 * - 本地：仅在 NODE_ENV!=production 且显式 ADMIN_ALLOW_MEMORY_STORE=true 时启用内存后端；
 *         生产环境永远不会走内存分支（见 lib/admin/config.js#allowMemoryStore）。
 *
 * 所有方法统一为 async 接口（内存分支没有 await），便于调用方无条件 await。
 * Redis 不可用时抛错，由调用方按"fail-closed"处理。
 */
/* eslint-disable @typescript-eslint/require-await */

import Redis from 'ioredis'

const memoryStore =
  globalThis.__jbaMemoryKv || (globalThis.__jbaMemoryKv = new Map())
let redisClient = null

export function kvBackendName() {
  return process.env.REDIS_URL ? 'redis' : 'memory'
}

function allowMemory() {
  const prodLike =
    process.env.NODE_ENV === 'production' ||
    !!process.env.VERCEL_ENV ||
    process.env.BUILD_MODE === 'true'
  return !prodLike && String(process.env.ADMIN_ALLOW_MEMORY_STORE || '') === 'true'
}

function getRedis() {
  if (!process.env.REDIS_URL) throw new Error('ADMIN_KV_UNAVAILABLE')
  if (!redisClient) {
    redisClient = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      enableReadyCheck: true,
      retryStrategy: times => Math.min(times * 200, 2000)
    })
    redisClient.on('error', err => {
      // 只记一行，避免刷屏；真正的处理在调用方
      console.error('[admin][redis]', err?.message || 'connection error')
    })
  }
  return redisClient
}

function memGet(key) {
  const hit = memoryStore.get(key)
  if (!hit) return null
  if (hit.exp && hit.exp < Date.now()) {
    memoryStore.delete(key)
    return null
  }
  return hit.value
}

function memSet(key, value, ttlSec) {
  const exp = ttlSec ? Date.now() + ttlSec * 1000 : 0
  memoryStore.set(key, { value: String(value), exp })
}

/* ------------------------------------------------------------------ *
 * 通用接口
 * ------------------------------------------------------------------ */

export async function kvGet(key) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    return memGet(key)
  }
  return getRedis().get(key)
}

export async function kvSet(key, value, ttlSec = 0) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    memSet(key, value, ttlSec)
    return 'OK'
  }
  const client = getRedis()
  if (ttlSec > 0) return client.set(key, value, 'EX', Math.ceil(ttlSec))
  return client.set(key, value)
}

export async function kvDel(...keys) {
  if (!keys.length) return 0
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    let n = 0
    keys.forEach(k => {
      if (memoryStore.delete(k)) n += 1
    })
    return n
  }
  return getRedis().del(...keys)
}

export async function kvIncr(key) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const next = Number(memGet(key) || 0) + 1
    memSet(key, next, 0)
    return next
  }
  return getRedis().incr(key)
}

export async function kvExpire(key, ttlSec) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const hit = memoryStore.get(key)
    if (hit) hit.exp = Date.now() + ttlSec * 1000
    return hit ? 1 : 0
  }
  return getRedis().expire(key, Math.ceil(ttlSec))
}

export async function kvTtl(key) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const hit = memoryStore.get(key)
    if (!hit) return -2
    if (!hit.exp) return -1
    return Math.max(0, Math.ceil((hit.exp - Date.now()) / 1000))
  }
  return getRedis().ttl(key)
}

export async function kvLpush(key, value) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    const list = raw ? JSON.parse(raw) : []
    list.unshift(String(value))
    memSet(key, JSON.stringify(list), 0)
    return list.length
  }
  return getRedis().lpush(key, value)
}

export async function kvLtrim(key, start, stop) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    if (!raw) return 'OK'
    const list = JSON.parse(raw).slice(start, stop === -1 ? undefined : stop + 1)
    memSet(key, JSON.stringify(list), 0)
    return 'OK'
  }
  return getRedis().ltrim(key, start, stop)
}

export async function kvLrange(key, start, stop) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    if (!raw) return []
    return JSON.parse(raw).slice(start, stop === -1 ? undefined : stop + 1)
  }
  return getRedis().lrange(key, start, stop)
}

export async function kvSadd(key, member) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    const set = new Set(raw ? JSON.parse(raw) : [])
    set.add(String(member))
    memSet(key, JSON.stringify([...set]), 0)
    return 1
  }
  return getRedis().sadd(key, member)
}

export async function kvSrem(key, member) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    const set = new Set(raw ? JSON.parse(raw) : [])
    set.delete(String(member))
    memSet(key, JSON.stringify([...set]), 0)
    return 1
  }
  return getRedis().srem(key, member)
}

export async function kvSmembers(key) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    return raw ? JSON.parse(raw) : []
  }
  return getRedis().smembers(key)
}

export async function kvPing() {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) return false
    return true
  }
  try {
    const pong = await getRedis().ping()
    return pong === 'PONG'
  } catch (err) {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * 统计所需扩展原语
 * ------------------------------------------------------------------ */

/** SET NX（去重）：返回 true 表示"首次写入" */
export async function kvSetnx(key, value, ttlSec = 0) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    if (memGet(key) !== null) return false
    memSet(key, value, ttlSec)
    return true
  }
  const client = getRedis()
  const result =
    ttlSec > 0
      ? await client.set(key, value, 'EX', Math.ceil(ttlSec), 'NX')
      : await client.set(key, value, 'NX')
  return result === 'OK'
}

/** HyperLogLog：加入元素 */
export async function kvPfadd(key, ...values) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    const set = new Set(raw ? JSON.parse(raw) : [])
    values.flat().forEach(v => set.add(String(v)))
    memSet(key, JSON.stringify([...set]), 0)
    return 1
  }
  return getRedis().pfadd(key, ...values.flat())
}

/** HyperLogLog：估算基数（支持多键合并） */
export async function kvPfcount(...keys) {
  const list = keys.flat().filter(Boolean)
  if (!list.length) return 0
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const set = new Set()
    list.forEach(key => {
      const raw = memGet(key)
      if (raw) JSON.parse(raw).forEach(v => set.add(v))
    })
    return set.size
  }
  return getRedis().pfcount(...list)
}

/** Hash 字段自增 */
export async function kvHincrby(key, field, by = 1) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    const hash = raw ? JSON.parse(raw) : {}
    hash[field] = Number(hash[field] || 0) + Number(by)
    memSet(key, JSON.stringify(hash), 0)
    return hash[field]
  }
  return getRedis().hincrby(key, field, by)
}

/** Hash 全量读取 */
export async function kvHgetall(key) {
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    return raw ? JSON.parse(raw) : {}
  }
  return getRedis().hgetall(key)
}

/** Hash 批量写入（field → value，单次往返） */
export async function kvHset(key, fields) {
  const entries = Object.entries(fields || {})
  if (!entries.length) return 0
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    const hash = raw ? JSON.parse(raw) : {}
    entries.forEach(([field, value]) => {
      hash[field] = String(value)
    })
    memSet(key, JSON.stringify(hash), 0)
    return entries.length
  }
  return getRedis().hset(key, ...entries.flat())
}

/** Hash 字段删除（用于清理格式非法的历史键；正常流程不应删除业务映射） */
export async function kvHdel(key, fields) {
  const list = (Array.isArray(fields) ? fields : [fields]).filter(Boolean)
  if (!list.length) return 0
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    const raw = memGet(key)
    const hash = raw ? JSON.parse(raw) : {}
    list.forEach(field => {
      delete hash[field]
    })
    memSet(key, JSON.stringify(hash), 0)
    return list.length
  }
  return getRedis().hdel(key, ...list)
}

/** 批量 GET（顺序与入参一致，缺失为 null） */
export async function kvMget(keys) {
  const list = keys.filter(Boolean)
  if (!list.length) return []
  if (!process.env.REDIS_URL) {
    if (!allowMemory()) throw new Error('ADMIN_KV_UNAVAILABLE')
    return list.map(key => memGet(key))
  }
  return getRedis().mget(...list)
}
