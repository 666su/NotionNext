/**
 * 推送通知状态检查
 * GET /api/push/status
 *
 * 返回：存储后端（Redis/文件）、订阅数、VAPID 状态
 */
import Redis from 'ioredis'
import { readData } from '@/lib/notify/storage'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const result = {
    storage: 'file',
    redisConfigured: !!process.env.REDIS_URL,
    redisConnected: false,
    redisError: null,
    subscriptions: 0,
    vapidKeys: false,
    isVercel: !!process.env.VERCEL
  }

  // 尝试连接 Redis
  if (result.redisConfigured) {
    const redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true
    })
    try {
      await redis.connect()
      await redis.ping()
      result.redisConnected = true
      result.storage = 'redis'
    } catch (e) {
      result.redisError = e.message
    } finally {
      redis.disconnect()
    }
  }

  // 读取数据
  try {
    const data = await readData()
    result.subscriptions = data.subscriptions.length
    result.vapidKeys = !!data.vapidKeys
  } catch (e) {
    result.readError = e.message
  }

  return res.status(200).json(result)
}
