/**
 * 新增排行榜与点赞功能 - 数据存储层
 *
 * 数据结构：以文章 id 为键的计数器
 *   views: { [postId]: number }  文章查看次数
 *   likes: { [postId]: number }  文章点赞次数
 *
 * 存储策略：优先 Redis（REDIS_URL），回退本地文件
 * - Redis 使用 Hash + HINCRBY，保证并发自增不丢计数、多实例部署一致
 * - 文件回退使用 JSON + 进程内写队列（仅本地开发等单实例场景）
 *
 * 注意：本模块仅供服务端（API Route）使用，不要被客户端组件引入
 */
import BLOG from '@/blog.config'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const REDIS_URL = BLOG.REDIS_URL || process.env.REDIS_URL || ''

// Redis 中计数器所在 Hash
const HASH_KEY = {
  views: 'rank:views',
  likes: 'rank:likes'
}

// 去重标记 key 前缀（仅 Redis 使用）
const DEDUPE_PREFIX = 'rank:dedupe'

const isVercel = !!process.env.VERCEL
const STORAGE_PATH =
  process.env.RANK_STORAGE_PATH && process.env.RANK_STORAGE_PATH.trim()
    ? process.env.RANK_STORAGE_PATH.trim()
    : isVercel
      ? path.join('/tmp', 'rank-data.json')
      : path.join(process.cwd(), '.next', 'cache', 'rank-data.json')

function defaultData() {
  return { views: {}, likes: {}, updatedAt: 0 }
}

// ========== Redis 连接（懒加载单例，避免构建期建立连接） ==========
let redisClient = null
let redisConnecting = null

async function getRedis() {
  if (!REDIS_URL) return null
  if (redisClient) return redisClient
  if (redisConnecting) return redisConnecting

  redisConnecting = (async () => {
    try {
      const { default: Redis } = await import('ioredis')
      const client = new Redis(REDIS_URL, {
        maxRetriesPerRequest: 2,
        connectTimeout: 5000,
        lazyConnect: true,
        enableOfflineQueue: false
      })
      // 避免连接错误冒泡成 unhandled error
      client.on('error', e => {
        console.warn('[rank] Redis 连接异常:', e.message)
      })
      await client.connect()
      redisClient = client
      return redisClient
    } catch (e) {
      console.warn('[rank] Redis 不可用，回退文件存储:', e.message)
      return null
    } finally {
      redisConnecting = null
    }
  })()

  return redisConnecting
}

// ========== 文件存储 ==========
function readFromFile() {
  try {
    if (fs.existsSync(STORAGE_PATH)) {
      const raw = JSON.parse(fs.readFileSync(STORAGE_PATH, 'utf8'))
      return { ...defaultData(), ...raw }
    }
  } catch (e) {
    console.warn('[rank] 读取文件失败:', e.message)
  }
  return defaultData()
}

function writeToFile(data) {
  try {
    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true })
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(data), 'utf8')
  } catch (e) {
    console.warn('[rank] 写入文件失败:', e.message)
  }
}

// 文件回退时的进程内串行队列，避免并发读改写互相覆盖
let fileQueue = Promise.resolve()

function withFileLock(task) {
  const next = fileQueue.then(task, task)
  fileQueue = next.catch(() => {})
  return next
}

// ========== 计数器读写 ==========

/**
 * 计数器自增
 * @param {'views'|'likes'} kind
 * @param {string} postId
 * @param {number} delta
 * @returns {Promise<number|null>} 自增后的值
 */
export async function incrCounter(kind, postId, delta = 1) {
  if (!postId || !HASH_KEY[kind]) return null

  const redis = await getRedis()
  if (redis) {
    try {
      return await redis.hincrby(HASH_KEY[kind], String(postId), delta)
    } catch (e) {
      console.warn('[rank] Redis 自增失败，回退文件:', e.message)
    }
  }

  return withFileLock(() => {
    const data = readFromFile()
    const current = Number(data[kind]?.[postId]) || 0
    const next = current + delta
    data[kind] = { ...(data[kind] || {}), [postId]: next }
    data.updatedAt = Date.now()
    writeToFile(data)
    return next
  })
}

/**
 * 读取某一类计数器的全部数据
 * @param {'views'|'likes'} kind
 * @returns {Promise<Record<string, number>>}
 */
export async function getCounters(kind) {
  if (!HASH_KEY[kind]) return {}

  const redis = await getRedis()
  if (redis) {
    try {
      const raw = await redis.hgetall(HASH_KEY[kind])
      const result = {}
      Object.entries(raw || {}).forEach(([key, value]) => {
        const num = Number(value)
        if (Number.isFinite(num)) result[key] = num
      })
      return result
    } catch (e) {
      console.warn('[rank] Redis 读取失败，回退文件:', e.message)
    }
  }

  return { ...(readFromFile()[kind] || {}) }
}

/**
 * 读取单篇文章的计数
 * @returns {Promise<number|null>}
 */
export async function getCounter(kind, postId) {
  if (!HASH_KEY[kind] || !postId) return null

  const redis = await getRedis()
  if (redis) {
    try {
      const raw = await redis.hget(HASH_KEY[kind], String(postId))
      const num = Number(raw)
      return Number.isFinite(num) ? num : 0
    } catch (e) {
      console.warn('[rank] Redis 读取失败，回退文件:', e.message)
    }
  }

  const value = readFromFile()[kind]?.[postId]
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

/**
 * 批量写入计数器（用于导入历史数据）
 * @param {'views'|'likes'} kind
 * @param {Record<string, number>} map
 * @param {'set'|'incr'|'max'} mode
 */
export async function mergeCounters(kind, map, mode = 'set') {
  if (!HASH_KEY[kind] || !map || typeof map !== 'object') return 0

  const entries = Object.entries(map)
    .map(([postId, value]) => [String(postId), Number(value)])
    .filter(([postId, value]) => postId && Number.isFinite(value) && value >= 0)

  if (entries.length === 0) return 0

  const redis = await getRedis()
  if (redis) {
    try {
      const pipeline = redis.pipeline()
      for (const [postId, value] of entries) {
        if (mode === 'incr') {
          pipeline.hincrby(HASH_KEY[kind], postId, value)
        } else if (mode === 'max') {
          // 仅当新值更大时写入
          pipeline.eval(
            `local cur = tonumber(redis.call('HGET', KEYS[1], ARGV[1]) or '0')
             if tonumber(ARGV[2]) > cur then redis.call('HSET', KEYS[1], ARGV[1], ARGV[2]) end
             return 1`,
            1,
            HASH_KEY[kind],
            postId,
            value
          )
        } else {
          pipeline.hset(HASH_KEY[kind], postId, value)
        }
      }
      await pipeline.exec()
      return entries.length
    } catch (e) {
      console.warn('[rank] Redis 批量写入失败，回退文件:', e.message)
    }
  }

  return withFileLock(() => {
    const data = readFromFile()
    const target = { ...(data[kind] || {}) }
    for (const [postId, value] of entries) {
      if (mode === 'incr') {
        target[postId] = (Number(target[postId]) || 0) + value
      } else if (mode === 'max') {
        target[postId] = Math.max(Number(target[postId]) || 0, value)
      } else {
        target[postId] = value
      }
    }
    data[kind] = target
    data.updatedAt = Date.now()
    writeToFile(data)
    return entries.length
  })
}

/**
 * 清空某一类计数器
 */
export async function clearCounters(kind) {
  if (!HASH_KEY[kind]) return false

  const redis = await getRedis()
  if (redis) {
    try {
      await redis.del(HASH_KEY[kind])
      return true
    } catch (e) {
      console.warn('[rank] Redis 清空失败，回退文件:', e.message)
    }
  }

  return withFileLock(() => {
    const data = readFromFile()
    data[kind] = {}
    data.updatedAt = Date.now()
    writeToFile(data)
    return true
  })
}

// ========== 去重标记 ==========

// 文件回退时的进程内去重缓存： Map<key, expireAt>
const memoryDedupe = new Map()

function sweepMemoryDedupe() {
  const now = Date.now()
  if (memoryDedupe.size < 5000) return
  for (const [key, expireAt] of memoryDedupe) {
    if (expireAt <= now) memoryDedupe.delete(key)
  }
}

/**
 * 尝试占用一个去重标记
 * @param {string} scope 业务范围，例如 'views'
 * @param {string} identity 访客身份标识
 * @param {number} ttlSeconds 有效期（秒）
 * @returns {Promise<boolean>} true 表示首次占用成功（应计数）
 */
export async function acquireDedupe(scope, identity, ttlSeconds) {
  if (!identity || !ttlSeconds || ttlSeconds <= 0) return true

  const key = `${DEDUPE_PREFIX}:${scope}:${identity}`

  const redis = await getRedis()
  if (redis) {
    try {
      const result = await redis.set(
        key,
        '1',
        'EX',
        Math.ceil(ttlSeconds),
        'NX'
      )
      return result === 'OK'
    } catch (e) {
      console.warn('[rank] Redis 去重失败，回退内存:', e.message)
    }
  }

  const now = Date.now()
  const exist = memoryDedupe.get(key)
  if (exist && exist > now) return false
  memoryDedupe.set(key, now + ttlSeconds * 1000)
  sweepMemoryDedupe()
  return true
}

/**
 * 只读探测某个去重标记是否存在（不写入、不改变状态）
 * @returns {Promise<boolean>}
 */
export async function hasDedupe(scope, identity) {
  if (!identity) return false
  const key = `${DEDUPE_PREFIX}:${scope}:${identity}`

  const redis = await getRedis()
  if (redis) {
    try {
      return (await redis.exists(key)) === 1
    } catch (e) {
      console.warn('[rank] Redis 探测失败，回退内存:', e.message)
    }
  }

  const expireAt = memoryDedupe.get(key)
  if (!expireAt) return false
  if (expireAt <= Date.now()) {
    memoryDedupe.delete(key)
    return false
  }
  return true
}

/**
 * 释放去重标记（用于计数失败时回滚）
 */
export async function releaseDedupe(scope, identity) {
  if (!identity) return
  const key = `${DEDUPE_PREFIX}:${scope}:${identity}`
  const redis = await getRedis()
  if (redis) {
    try {
      await redis.del(key)
      return
    } catch (e) {
      // 忽略，继续清理内存标记
    }
  }
  memoryDedupe.delete(key)
}

/**
 * 清空某个范围的全部去重标记
 *
 * 用途：重置点赞计数时必须同时清除「已点赞」标记，
 * 否则计数归零后访客仍然处于已点赞状态，无法重新点赞。
 *
 * @param {string} [scope] 留空则清空所有范围
 * @returns {Promise<number>} 清理的标记数量（Redis 下为估算值）
 */
export async function clearDedupe(scope) {
  const pattern = scope ? `${DEDUPE_PREFIX}:${scope}:*` : `${DEDUPE_PREFIX}:*`

  const redis = await getRedis()
  if (redis) {
    try {
      let removed = 0
      let cursor = '0'
      do {
        const [nextCursor, keys] = await redis.scan(
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          200
        )
        cursor = nextCursor
        if (keys.length > 0) {
          await redis.del(...keys)
          removed += keys.length
        }
      } while (cursor !== '0')
      return removed
    } catch (e) {
      console.warn('[rank] Redis 清理去重标记失败，回退内存:', e.message)
    }
  }

  // 内存回退：按前缀匹配清理
  const prefix = scope ? `${DEDUPE_PREFIX}:${scope}:` : `${DEDUPE_PREFIX}:`
  let removed = 0
  for (const key of [...memoryDedupe.keys()]) {
    if (key.startsWith(prefix)) {
      memoryDedupe.delete(key)
      removed++
    }
  }
  return removed
}

// ========== 工具 ==========

/**
 * 由访客特征生成不可逆的匿名标识，用于去重，不保存原始 IP
 */
export function hashIdentity(...parts) {
  const raw = parts.filter(Boolean).join('|')
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 32)
}

/**
 * 当前存储后端，用于状态接口
 */
export async function getStorageBackend() {
  const redis = await getRedis()
  return redis ? 'redis' : 'file'
}
