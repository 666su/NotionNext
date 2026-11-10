/**
 * GET /api/admin/audit —— 最近的管理员操作审计（脱敏后）
 */

import { readAudit } from '@/lib/admin/audit'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res)
  if (!guard) return null

  const limit = Number(req.query?.limit || 50)
  let entries = []
  try {
    entries = await readAudit(limit)
  } catch (err) {
    console.error('[admin][audit] read failed:', err?.message || err)
    return json(res, 503, { error: 'session_store_unavailable' })
  }

  return json(res, 200, { ok: true, entries })
}
