/**
 * 定时任务鉴权（Phase 6）
 *
 * Vercel Cron 会在请求里带 `Authorization: Bearer $CRON_SECRET`。
 * 约定：
 * - 未配置 `CRON_SECRET` → **一律 503**（fail-closed，绝不裸奔）；
 * - 只接受 Authorization 头（不放到 query，避免被日志/Referer 泄露）；
 * - 常量时间比较。
 */

import { timingSafeEqual } from 'node:crypto'

export function readCronSecret() {
  return String(process.env.CRON_SECRET || '').trim()
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''))
  const right = Buffer.from(String(b || ''))
  if (!left.length || left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * @returns {{ok:boolean, status?:number, error?:string}}
 */
export function authorizeCron(req) {
  const secret = readCronSecret()
  if (!secret) return { ok: false, status: 503, error: 'cron_not_configured' }

  const header = String(req.headers.authorization || '')
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
  if (!token) return { ok: false, status: 401, error: 'unauthorized' }
  if (!safeEqual(token, secret)) return { ok: false, status: 401, error: 'unauthorized' }
  return { ok: true }
}

/** 简易冷却：防止同一实例被反复触发（cron 本身是低频的） */
export const CRON_COOLDOWN_SEC = 300
