/**
 * 推送通知状态检查
 * GET /api/push/status
 *
 * 安全加固（Phase 1 修复 F-06）：
 * - 默认只返回 `{ ok: true }`，不暴露存储后端、订阅数、VAPID 状态、错误原文
 * - 需要细节时，携带 `x-notify-secret`（= NOTIFY_SECRET 或 REVALIDATION_TOKEN）才会返回
 * - `redisError` 一律不外发，只进服务端日志
 */
import { readData } from '@/lib/notify/storage'
import crypto from 'node:crypto'

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8')
  const bufB = Buffer.from(String(b || ''), 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

function authorized(req) {
  const expected = process.env.NOTIFY_SECRET || process.env.REVALIDATION_TOKEN || ''
  if (!expected) return false
  const provided = String(req.headers['x-notify-secret'] || '')
  return timingSafeEqual(provided, expected)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  if (!authorized(req)) {
    return res.status(200).json({ ok: true })
  }

  const result = {
    storage: 'file',
    redisConfigured: !!process.env.REDIS_URL,
    redisConnected: false,
    subscriptions: 0,
    vapidKeys: false,
    isVercel: !!process.env.VERCEL
  }

  if (result.redisConfigured) {
    let redis = null
    try {
      const { default: Redis } = await import('ioredis')
      redis = new Redis(process.env.REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 3000,
        lazyConnect: true
      })
      await redis.connect()
      await redis.ping()
      result.redisConnected = true
      result.storage = 'redis'
    } catch (err) {
      // 错误原文只进日志，不回给调用方
      console.error('[notify][status] redis error:', err?.message || err)
    } finally {
      if (redis) redis.disconnect()
    }
  }

  try {
    const data = await readData()
    result.subscriptions = data.subscriptions.length
    result.vapidKeys = !!data.vapidKeys
  } catch (err) {
    console.error('[notify][status] read error:', err?.message || err)
  }

  return res.status(200).json(result)
}
