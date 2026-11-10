/**
 * POST /api/track —— 统计事件接收（公开、可写、限流）
 *
 * 设计原则：
 * - **绝不影响博客**：任何异常都返回 204，前端不重试风暴。
 * - 不信任客户端：事件名/字段/路径/大小/时间窗全部服务端校验。
 * - 不落明文 IP：只用于短窗口限流（加盐哈希 + 1 分钟窗口键）。
 * - 不接受跨站批量写入：CORS 未开放，且要求同源 Origin（若浏览器提供）。
 */

import { LIMITS } from '@/lib/analytics/constants'
import { K } from '@/lib/analytics/constants'
import {
  classifyBrowser,
  classifyDevice,
  classifyOs,
  selfHostFromHeaders
} from '@/lib/analytics/classify'
import { recordEvents } from '@/lib/analytics/storage'
import { validateBatch } from '@/lib/analytics/validate'
import { hashIp, clientIp } from '@/lib/admin/crypto'
import { kvExpire, kvIncr, kvSetnx } from '@/lib/kv'

export const config = {
  api: {
    bodyParser: { sizeLimit: '16kb' }
  }
}

function noContent(res) {
  res.status(204).end()
  return null
}

function sameOrigin(req) {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(String(origin)).host === String(req.headers.host || '')
  } catch (err) {
    return false
  }
}

async function rateLimited(req) {
  try {
    const ip = clientIp(req)
    const bucket = Math.floor(Date.now() / 60000)
    const key = `${K.rate}${hashIp(ip, 'track')}:${bucket}`
    const count = await kvIncr(key)
    if (count === 1) await kvExpire(key, 90)
    return { limited: count > LIMITS.ratePerMinute }
  } catch (err) {
    // 统计链路 fail-open：限流存储异常时放行，记录一次
    console.warn('[analytics] rate limit unavailable:', err?.message || err)
    return { limited: false }
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  if (!sameOrigin(req)) return noContent(res)

  const { limited } = await rateLimited(req)
  if (limited) return noContent(res)

  let payload = req.body
  if (typeof payload === 'string') {
    if (Buffer.byteLength(payload, 'utf8') > LIMITS.maxBodyBytes) return noContent(res)
    try {
      payload = JSON.parse(payload)
    } catch (err) {
      return noContent(res)
    }
  }
  if (!payload || typeof payload !== 'object') return noContent(res)

  const { accepted } = validateBatch(payload)
  if (!accepted.length) return noContent(res)

  const ua = req.headers['user-agent'] || ''
  const country = String(req.headers['x-vercel-ip-country'] || '')
    .toUpperCase()
    .slice(0, 2)
  const referrerHost = String(payload.referrer_host || '')
    .toLowerCase()
    .slice(0, 100)

  try {
    await recordEvents({
      events: accepted,
      meta: {
        ua,
        device: classifyDevice(ua),
        browser: classifyBrowser(ua),
        os: classifyOs(ua),
        country,
        referrerHost: /^[a-z0-9.-]+$/.test(referrerHost) ? referrerHost : '',
        selfHost: selfHostFromHeaders(req.headers)
      }
    })
    // 记录"采集起始时间"，供后台标注数据从何时开始
    await kvSetnx(K.startedAt, new Date().toISOString())
  } catch (err) {
    // 存储异常不影响博客，也不向客户端暴露细节
    console.error('[analytics] ingest failed:', err?.message || err)
  }

  return noContent(res)
}
