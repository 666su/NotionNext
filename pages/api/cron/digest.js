/**
 * GET /api/cron/digest —— 每日浏览总结推送到 Telegram（Phase 6）
 *
 * 流程：真实统计事实 → （可选）AI 归纳 → Telegram 推送 → 写发送日志。
 * 鉴权：`Authorization: Bearer $CRON_SECRET`（Vercel Cron 自动注入）。
 *
 * 边界：
 * - AI 未配置时**照样发**，只是标题写"原始数据"，日志里 ai=false；
 * - Telegram 未配置时返回 200 + `delivery.ok:false, reason:'not_configured'`，
 *   事实仍然生成（方便在后台预览），但不会假装"已发送"。
 */

import { authorizeCron, CRON_COOLDOWN_SEC } from '@/lib/admin/cron-auth'
import { runDailyDigest } from '@/lib/admin/digest'
import { kvSetnx } from '@/lib/kv'

const COOLDOWN_KEY = 'cron:digest:cooldown'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const auth = authorizeCron(req)
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error })

  try {
    const acquired = await kvSetnx(COOLDOWN_KEY, String(Date.now()), CRON_COOLDOWN_SEC)
    if (!acquired) {
      return res.status(429).json({ error: 'cron_cooldown', retryAfter: CRON_COOLDOWN_SEC })
    }
  } catch (err) {
    console.warn('[cron][digest] cooldown store error:', err?.message || err)
  }

  try {
    const result = await runDailyDigest({ send: true })
    return res.status(200).json({
      ok: true,
      date: result.facts.date,
      pv: result.facts.pv,
      uv: result.facts.uv,
      ai: result.ai,
      delivery: result.delivery,
      computedAt: result.computedAt
    })
  } catch (err) {
    console.error('[cron][digest] failed:', err?.message || err)
    return res.status(503).json({ error: 'digest_failed' })
  }
}
