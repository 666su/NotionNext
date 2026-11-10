/**
 * GET /api/admin/stats/summary?range=today|yesterday|7d|30d|90d
 *
 * 统计汇总（Phase 2 的"对账"接口，也是 Phase 3 数据页的基础）。
 * 需要管理员会话。日期基准时区 Asia/Shanghai。
 */

import { K } from '@/lib/analytics/constants'
import { dateKey, recentDateKeys } from '@/lib/analytics/classify'
import {
  getActiveSessions,
  getEventCounts,
  getSummary,
  getTopPaths
} from '@/lib/analytics/storage'
import {
  json,
  requireAdminApi,
  setSecurityHeaders
} from '@/lib/admin/respond'
import { kvGet } from '@/lib/kv'

const RANGES = {
  today: 1,
  yesterday: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90
}

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res)
  if (!guard) return null

  const range = String(req.query?.range || 'today')
  if (!RANGES[range]) {
    return json(res, 400, { error: 'invalid_range' })
  }

  const now = Date.now()
  const dates =
    range === 'yesterday'
      ? [dateKey(now - 86400000)]
      : recentDateKeys(RANGES[range]).reverse()

  try {
    const summary = await getSummary(dates)
    const today = dateKey(now)
    const [realtime, topPaths, eventCounts, startedAt] = await Promise.all([
      getActiveSessions(5),
      getTopPaths(today, 10),
      getEventCounts(today),
      kvGet(K.startedAt)
    ])

    return json(res, 200, {
      ok: true,
      range,
      dates,
      summary,
      realtime,
      topPaths,
      eventCounts,
      collectionStartedAt: startedAt || null
    })
  } catch (err) {
    console.error('[admin][stats] summary failed:', err?.message || err)
    return json(res, 503, { error: 'stats_store_unavailable' })
  }
}
