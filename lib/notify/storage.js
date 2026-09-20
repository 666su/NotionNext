/**
 * 新增推送通知功能 - 订阅数据存储
 *
 * 存储结构：
 * {
 *   vapidKeys: { publicKey, privateKey } | null,
 *   subscriptions: [{ endpoint, keys: {p256dh, auth}, subscribedAt }],
 *   lastNotified: { [postId]: lastEditedDate }
 * }
 *
 * 存储策略：
 * - 优先使用 Redis（REDIS_URL 环境变量，持久化，生产推荐）
 * - 回退到本地文件（开发环境 /tmp 或 .next/cache）
 */
import fs from 'fs'
import path from 'path'
import Redis from 'ioredis'

const isVercel = !!process.env.VERCEL
const STORAGE_PATH =
  process.env.NOTIFY_STORAGE_PATH ||
  (isVercel
    ? path.join('/tmp', 'notify-data.json')
    : path.join(process.cwd(), '.next', 'cache', 'notify-data.json'))
const REDIS_URL = process.env.REDIS_URL || ''
const REDIS_KEY = 'notify:data'

function defaultData() {
  return { vapidKeys: null, subscriptions: [], lastNotified: {} }
}

// ========== 文件存储 ==========

async function readFromFile() {
  try {
    if (fs.existsSync(STORAGE_PATH)) {
      return { ...defaultData(), ...JSON.parse(fs.readFileSync(STORAGE_PATH, 'utf8')) }
    }
  } catch (e) {
    console.warn('[notify] 读取文件失败:', e.message)
  }
  return defaultData()
}

async function writeToFile(data) {
  try {
    fs.mkdirSync(path.dirname(STORAGE_PATH), { recursive: true })
    fs.writeFileSync(STORAGE_PATH, JSON.stringify(data, null, 2), 'utf8')
  } catch (e) {
    console.warn('[notify] 写入文件失败:', e.message)
  }
}

// ========== Redis 存储 ==========

async function readFromRedis() {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true
  })
  try {
    await redis.connect()
    const raw = await redis.get(REDIS_KEY)
    return raw ? { ...defaultData(), ...JSON.parse(raw) } : defaultData()
  } catch {
    return null
  } finally {
    redis.disconnect()
  }
}

async function writeToRedis(data) {
  const redis = new Redis(REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 3000,
    lazyConnect: true
  })
  try {
    await redis.connect()
    await redis.set(REDIS_KEY, JSON.stringify(data))
    await redis.expire(REDIS_KEY, 365 * 24 * 3600)
    return true
  } catch (e) {
    console.warn('[notify] Redis 写入失败:', e.message)
    return false
  } finally {
    redis.disconnect()
  }
}

// ========== 统一读写接口 ==========

export async function readData() {
  if (REDIS_URL) {
    const data = await readFromRedis()
    if (data) return data
  }
  return readFromFile()
}

export async function writeData(data) {
  if (REDIS_URL) {
    const ok = await writeToRedis(data)
    if (ok) return
  }
  await writeToFile(data)
}

// ========== 订阅操作 ==========

export async function addSubscription(subscription) {
  const data = await readData()
  const exists = data.subscriptions.find(s => s.endpoint === subscription.endpoint)
  if (exists) return false
  data.subscriptions.push({
    endpoint: subscription.endpoint,
    keys: subscription.keys || {},
    subscribedAt: Date.now()
  })
  await writeData(data)
  return true
}

export async function removeSubscription(endpoint) {
  const data = await readData()
  const before = data.subscriptions.length
  data.subscriptions = data.subscriptions.filter(s => s.endpoint !== endpoint)
  if (data.subscriptions.length !== before) {
    await writeData(data)
    return true
  }
  return false
}

export async function getSubscriptions() {
  const data = await readData()
  return data.subscriptions
}

// ========== 推送标记 ==========

export async function getLastNotified() {
  const data = await readData()
  return data.lastNotified || {}
}

export async function setLastNotified(map) {
  const data = await readData()
  data.lastNotified = map
  await writeData(data)
}

// ========== VAPID 密钥 ==========

export async function getVapidKeys() {
  const data = await readData()
  return data.vapidKeys
}

export async function setVapidKeys(keys) {
  const data = await readData()
  data.vapidKeys = keys
  await writeData(data)
}
