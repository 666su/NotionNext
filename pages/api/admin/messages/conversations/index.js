/**
 * GET /api/admin/messages/conversations —— 收件箱列表（管理员）
 *
 * 复用现有管理员会话（requireAdminApi）。支持 status / q / page / pageSize。
 * 邮箱在这里返回脱敏值，避免截图/日志泄露。
 */

import { audit } from '@/lib/admin/audit'
import { clientIp, hashIp } from '@/lib/admin/crypto'
import { requireAdminApi } from '@/lib/admin/respond'
import { json, setMessagesHeaders } from '@/lib/messages/respond'
import { listConversations } from '@/lib/messages/store'
import { maskEmail } from '@/lib/messages/validate'

const ALLOWED_STATUS = ['all', 'unread', 'read', 'processing', 'resolved', 'archived', 'spam']

export default async function handler(req, res) {
  setMessagesHeaders(res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res)
  if (!guard) return null

  const status = String(req.query?.status || 'all')
  if (!ALLOWED_STATUS.includes(status)) return json(res, 400, { error: 'invalid_status' })

  try {
    const result = await listConversations({
      status,
      q: typeof req.query?.q === 'string' ? req.query.q.trim().slice(0, 40) : '',
      page: req.query?.page,
      pageSize: req.query?.pageSize
    })

    return json(res, 200, {
      ok: true,
      status,
      rows: result.rows.map(row => ({
        ...row,
        visitor_email: maskEmail(row.visitor_email)
      })),
      total: result.total,
      page: result.page,
      pageSize: result.pageSize
    })
  } catch (err) {
    await audit({
      action: 'messages.list',
      result: 'error',
      user: guard.session.record.uid,
      ipHash: hashIp(clientIp(req), guard.config.sessionSecret),
      detail: err?.code || 'store_unavailable'
    })
    console.error('[messages][admin-list] failed:', err?.code || err?.message || err)
    return json(res, 503, { error: 'store_unavailable' })
  }
}
