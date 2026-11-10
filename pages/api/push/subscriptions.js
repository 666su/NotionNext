/**
 * 推送通知 - 读取读者自己的订阅列表
 * GET /api/push/subscriptions?subscriberId=xxx
 *
 * 安全加固（Phase 1 修复 F-05）：
 * - 按 IP 限流（30 次 / 分钟），提高枚举成本
 * - `Cache-Control: no-store` + `Referrer-Policy: no-referrer`，避免 id 经共享缓存/Referer 外泄
 * - 只回传必要字段，不额外回显 subscriberId
 * - 错误统一文案，不把内部异常抛给调用方
 *
 * 说明：subscriberId 是浏览器本地生成的 UUID v4（122 位随机），
 * 在本设计里充当"持有即证明"的自证令牌。由于公开页面 UI 依赖该接口回填配置，
 * 本阶段不做破坏性改造（如需更强隔离，应在后续改为 POST + 一次性签名）。
 */
import crypto from 'node:crypto'
import { getSubscriptionsByUser } from '@/lib/notify/storage'
import { hitRateLimit } from '@/lib/notify/rate-limit'

function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for']
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded
  return (
    String(raw || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown'
  ).replace(/^::ffff:/, '')
}

function ipHash(ip) {
  return crypto
    .createHash('sha256')
    .update(`${ip}|notify-subs`)
    .digest('hex')
    .slice(0, 24)
}

const KEPT_FIELDS = ['channel', 'enabled', 'config', 'createdAt', 'updatedAt']

function sanitize(sub) {
  const out = {}
  for (const key of KEPT_FIELDS) {
    if (sub && sub[key] !== undefined) out[key] = sub[key]
  }
  return out
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  let limit
  try {
    limit = await hitRateLimit({
      bucket: 'push-subs',
      id: ipHash(clientIp(req)),
      limit: 30,
      windowSec: 60
    })
  } catch (err) {
    limit = { allowed: true }
  }
  if (!limit.allowed) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' })
  }

  const { subscriberId } = req.query
  if (!subscriberId || typeof subscriberId !== 'string') {
    return res.status(400).json({ error: '缺少 subscriberId' })
  }
  // 只接受 UUID 形态，拒绝任意字符串（降低被当作通用查询入口的可能）
  if (!/^[0-9a-fA-F-]{16,64}$/.test(subscriberId)) {
    return res.status(400).json({ error: 'subscriberId 格式不正确' })
  }

  try {
    const subs = await getSubscriptionsByUser(subscriberId)
    return res.status(200).json({
      subscriptions: Array.isArray(subs) ? subs.map(sanitize) : []
    })
  } catch (err) {
    console.error('[notify][subscriptions] read error:', err?.message || err)
    return res.status(500).json({ error: '读取订阅失败' })
  }
}
