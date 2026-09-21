/**
 * 新增推送通知功能 - 订阅数据存储（读者端自选通知方式）
 *
 * 订阅结构：
 * {
 *   id: 'uuid',
 *   subscriberId: 'random-uuid',   // 客户端 localStorage 生成
 *   channel: 'telegram'|'serverchan'|'webpush',
 *   config: { token, chatId } | { sendKey } | { endpoint, keys },
 *   enabled: true,
 *   subscribedAt: timestamp
 * }
 *
 * 存储策略：优先 Redis（REDIS_URL），回退本地文件
 */
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
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
  return { subscriptions: [], lastNotified: {}, vapidKeys: null }
}

function genId() {
  return crypto.randomUUID()
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
  let redis = null
  try {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true })
    await redis.connect()
    const raw = await redis.get(REDIS_KEY)
    return raw ? { ...defaultData(), ...JSON.parse(raw) } : defaultData()
  } catch {
    return null
  } finally {
    if (redis) redis.disconnect()
  }
}

async function writeToRedis(data) {
  let redis = null
  try {
    redis = new Redis(REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 3000, lazyConnect: true })
    await redis.connect()
    await redis.set(REDIS_KEY, JSON.stringify(data))
    await redis.expire(REDIS_KEY, 365 * 24 * 3600)
    return true
  } catch (e) {
    console.warn('[notify] Redis 写入失败:', e.message)
    return false
  } finally {
    if (redis) redis.disconnect()
  }
}

// ========== 统一读写 ==========
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

// ========== 订阅 CRUD ==========

/**
 * 新增或更新订阅（按 subscriberId + channel 唯一）
 */
export async function upsertSubscription({ subscriberId, channel, config, enabled }) {
  if (!subscriberId || !channel) throw new Error('缺少 subscriberId 或 channel')
  const data = await readData()
  const existing = data.subscriptions.find(
    s => s.subscriberId === subscriberId && s.channel === channel
  )
  if (existing) {
    existing.config = config
    existing.enabled = enabled !== false
    await writeData(data)
    return existing
  }
  const sub = {
    id: genId(),
    subscriberId,
    channel,
    config,
    enabled: enabled !== false,
    subscribedAt: Date.now()
  }
  data.subscriptions.push(sub)
  await writeData(data)
  return sub
}

/**
 * 删除订阅
 */
export async function removeSubscription(subscriberId, channel) {
  if (!subscriberId || !channel) return false
  const data = await readData()
  const before = data.subscriptions.length
  data.subscriptions = data.subscriptions.filter(
    s => !(s.subscriberId === subscriberId && s.channel === channel)
  )
  if (data.subscriptions.length !== before) {
    await writeData(data)
    return true
  }
  return false
}

/**
 * 获取某读者的所有订阅
 */
export async function getSubscriptionsByUser(subscriberId) {
  const data = await readData()
  return data.subscriptions.filter(s => s.subscriberId === subscriberId)
}

/**
 * 获取所有已启用订阅（用于推送分发）
 */
export async function getAllEnabledSubscriptions() {
  const data = await readData()
  return data.subscriptions.filter(s => s.enabled && s.config)
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
