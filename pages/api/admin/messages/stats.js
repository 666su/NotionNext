/**
 * GET /api/admin/messages/stats —— 私信统计（侧边栏徽标用）
 *
 * 复用现有管理员会话；**只返回数量**，不返回任何正文/邮箱/昵称。
 * 前端每 20 秒轮询一次（Q3 决策）。
 */

import { requireAdminApi } from '@/lib/admin/respond'
import { json, setMessagesHeaders } from '@/lib/messages/respond'
import { getStats } from '@/lib/messages/store'

export default async function handler(req, res) {
  setMessagesHeaders(res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res)
  if (!guard) return null

  try {
    const stats = await getStats()
    return json(res, 200, { ok: true, ...stats, generatedAt: new Date().toISOString() })
  } catch (err) {
    console.error('[messages][stats] failed:', err?.code || err?.message || err)
    return json(res, 503, { error: 'store_unavailable' })
  }
}
