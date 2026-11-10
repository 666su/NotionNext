/**
 * POST /api/admin/sync/notion —— 手动触发 Notion 只读同步
 *
 * 约束：
 * - 需要管理员会话 + CSRF
 * - 限频：同一实例 5 分钟内只允许一次（避免反复拉 Notion）
 * - 只读 Notion，绝不修改内容
 */

import { logSync, syncNotion } from '@/lib/admin/sync/notion-sync'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'
import { kvIncr, kvTtl } from '@/lib/kv'

const COOLDOWN_SEC = 300
const COOLDOWN_KEY = 'admin:sync:notion:cooldown'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res, { csrf: true })
  if (!guard) return null

  let ttl = 0
  try {
    ttl = Number(await kvTtl(COOLDOWN_KEY)) || 0
  } catch (err) {
    ttl = 0
  }
  if (ttl > 0) {
    return json(res, 429, { error: 'sync_too_frequent', retryAfter: ttl })
  }

  try {
    await kvIncr(COOLDOWN_KEY)
    const { kvExpire } = await import('@/lib/kv')
    await kvExpire(COOLDOWN_KEY, COOLDOWN_SEC)
  } catch (err) {
    console.warn('[sync] cooldown store error:', err?.message || err)
  }

  const result = await syncNotion({ from: 'admin' })

  if (!result.ok) {
    await logSync({
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: 'error',
      source: 'notion',
      error: result.error?.slice(0, 500) || 'unknown'
    })
    return json(res, 502, { error: 'sync_failed', message: result.error })
  }

  return json(res, 200, { ok: true, counts: result.counts, finishedAt: result.finishedAt })
}
