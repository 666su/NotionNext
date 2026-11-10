/**
 * GET /api/admin/sync/status —— 最近一次 Notion 同步状态（Phase 4）
 *
 * 返回：元信息（文章数/分类/标签/路径映射数）、最近 10 条同步日志、冷却剩余秒数、是否"过期"。
 * 只读；真正触发同步的是 POST /api/admin/sync/notion。
 */

import { readArticleIndex, readSyncLog } from '@/lib/admin/sync/notion-sync'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'
import { kvTtl } from '@/lib/kv'

const COOLDOWN_KEY = 'admin:sync:notion:cooldown'
const STALE_MS = 24 * 3600 * 1000

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res)
  if (!guard) return null

  try {
    const [{ meta, pathMap }, log, cooldown] = await Promise.all([
      readArticleIndex(),
      readSyncLog(10),
      kvTtl(COOLDOWN_KEY).catch(() => -2)
    ])

    const syncedAtMs = meta?.syncedAt ? Date.parse(meta.syncedAt) : 0
    return json(res, 200, {
      ok: true,
      meta: meta || null,
      pathMapSize: Object.keys(pathMap || {}).length,
      log,
      cooldown: Number(cooldown) > 0 ? Number(cooldown) : 0,
      stale: !syncedAtMs || Date.now() - syncedAtMs > STALE_MS
    })
  } catch (err) {
    console.error('[admin][sync] status failed:', err?.message || err)
    return json(res, 503, { error: 'sync_store_unavailable' })
  }
}
