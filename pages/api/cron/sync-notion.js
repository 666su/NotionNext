/**
 * GET /api/cron/sync-notion —— 每日自动同步 Notion（只读）
 *
 * 鉴权：Vercel Cron 自动带 `Authorization: Bearer $CRON_SECRET`；
 * 未配置 CRON_SECRET 时返回 503（fail-closed）。
 *
 * 说明：只读同步，不修改 Notion；与手动同步共用同一份快照与日志，
 * 只是额外加了一个 5 分钟冷却，避免被反复触发。
 */

import { authorizeCron, CRON_COOLDOWN_SEC } from '@/lib/admin/cron-auth'
import { syncNotion } from '@/lib/admin/sync/notion-sync'
import { kvExpire, kvIncr, kvSetnx } from '@/lib/kv'

const COOLDOWN_KEY = 'cron:sync:notion:cooldown'

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
      await kvExpire(COOLDOWN_KEY, CRON_COOLDOWN_SEC).catch(() => null)
      return res.status(429).json({ error: 'cron_cooldown', retryAfter: CRON_COOLDOWN_SEC })
    }
  } catch (err) {
    // 冷却存储不可用时仍然同步（cron 本身低频），但记录一次
    console.warn('[cron][sync] cooldown store error:', err?.message || err)
  }

  const result = await syncNotion({ from: 'cron' })

  if (!result.ok) {
    return res.status(502).json({ error: 'sync_failed', message: result.error })
  }

  return res.status(200).json({
    ok: true,
    source: 'cron',
    counts: result.counts,
    finishedAt: result.finishedAt
  })
}
