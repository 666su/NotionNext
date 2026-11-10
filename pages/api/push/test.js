/**
 * 推送通知 - 发送测试消息
 * POST /api/push/test  { channel, config }
 *
 * 用途：读者用**自己填写的**渠道配置发一条测试消息，验证配置是否可用。
 *
 * 安全加固（Phase 1 修复 F-03）：
 * - 只接受同源请求（浏览器发出的跨站请求会带不同 Origin，直接拒绝）
 * - 按 IP 限流（5 次 / 分钟）
 * - Web Push 的 endpoint 必须属于已知推送服务域名（防 SSRF 打到任意 URL）
 * - 不再自动生成/写入 VAPID 密钥（避免被匿名请求篡改全局状态）
 * - 错误只返回通用文案，细节仅进服务端日志
 */

import crypto from 'node:crypto'
import { sendTelegram, sendServerChan } from '@/lib/notify/channels'
import { sendWebPushTo } from '@/lib/notify/webpush'
import { getVapidKeys } from '@/lib/notify/storage'
import { hitRateLimit } from '@/lib/notify/rate-limit'

const CHANNELS = new Set(['telegram', 'serverchan', 'webpush'])

/** 允许的 Web Push 服务域名（浏览器厂商推送网关） */
const PUSH_HOST_SUFFIXES = [
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'notify.windows.com',
  'wns.windows.com',
  'push.apple.com',
  'push.services.mozilla.com'
]

function isAllowedPushEndpoint(endpoint) {
  try {
    const url = new URL(String(endpoint))
    if (url.protocol !== 'https:') return false
    const host = url.hostname.toLowerCase()
    return PUSH_HOST_SUFFIXES.some(
      suffix => host === suffix || host.endsWith(`.${suffix}`)
    )
  } catch (err) {
    return false
  }
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true // 非浏览器客户端（如 curl）不带 Origin
  try {
    return new URL(origin).host === String(req.headers.host || '')
  } catch (err) {
    return false
  }
}

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
    .update(`${ip}|notify-test`)
    .digest('hex')
    .slice(0, 24)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  if (!sameOrigin(req)) {
    return res.status(403).json({ error: '请求来源不被允许' })
  }

  let limit
  try {
    limit = await hitRateLimit({
      bucket: 'push-test',
      id: ipHash(clientIp(req)),
      limit: 5,
      windowSec: 60
    })
  } catch (err) {
    limit = { allowed: true }
  }
  if (!limit.allowed) {
    return res.status(429).json({ error: '请求过于频繁，请稍后再试' })
  }

  try {
    const { channel, config } = req.body || {}
    if (!channel || !config || typeof config !== 'object') {
      return res.status(400).json({ error: '缺少 channel 或 config' })
    }
    if (!CHANNELS.has(channel)) {
      return res.status(400).json({ error: '不支持的渠道' })
    }
    // 限制配置体积，避免超大请求体
    if (JSON.stringify(config).length > 4096) {
      return res.status(413).json({ error: '配置过大' })
    }

    const msg = {
      title: '🔔 测试通知',
      url: process.env.NEXT_PUBLIC_LINK || '/',
      summary: '博客推送设置成功！你将收到新文章更新通知。'
    }

    if (channel === 'telegram') {
      const result = await sendTelegram(msg, config)
      return result.ok
        ? res.status(200).json({ ok: true, message: '测试通知已发送' })
        : res.status(400).json({ error: 'Telegram 发送失败，请检查 Token 与 Chat ID' })
    }

    if (channel === 'serverchan') {
      const result = await sendServerChan(msg, config)
      return result.ok
        ? res.status(200).json({ ok: true, message: '测试通知已发送' })
        : res.status(400).json({ error: 'Server 酱发送失败，请检查 SendKey' })
    }

    // Web Push：endpoint 必须属于已知推送服务域名
    const { endpoint, keys } = config
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'Web Push 订阅信息不完整' })
    }
    if (!isAllowedPushEndpoint(endpoint)) {
      return res.status(400).json({ error: 'Web Push endpoint 不被允许' })
    }

    let vapidKeys = await getVapidKeys()
    const envPk = process.env.VAPID_PUBLIC_KEY
    const envSk = process.env.VAPID_PRIVATE_KEY
    if (envPk && envSk) {
      vapidKeys = { publicKey: envPk, privateKey: envSk }
    }
    if (!vapidKeys) {
      // 不再代为生成并落库：配置缺失时明确报错
      return res.status(503).json({ error: 'VAPID 密钥未配置，无法发送测试推送' })
    }

    await sendWebPushTo(
      { endpoint, keys },
      { title: msg.title, body: msg.summary, url: msg.url },
      vapidKeys,
      process.env.VAPID_SUBJECT
    )
    return res.status(200).json({ ok: true, message: '测试通知已发送' })
  } catch (err) {
    console.warn('[notify] 测试推送失败:', err?.message || err)
    return res.status(500).json({ error: '测试推送失败，请稍后重试' })
  }
}
