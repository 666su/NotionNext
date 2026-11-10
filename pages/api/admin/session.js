/**
 * GET /api/admin/session —— 当前会话信息（供后台前端初始化）
 * 只返回非敏感信息：用户名、角色、CSRF token、会话时间、存储后端。
 */

import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res)
  if (!guard) return null

  const { record } = guard.session
  return json(res, 200, {
    ok: true,
    user: { username: record.uid, role: record.role },
    csrfToken: record.csrf,
    session: {
      createdAt: record.createdAt,
      lastSeenAt: record.lastSeenAt,
      expiresAt: record.expiresAt
    },
    store: guard.config.backend,
    warnings: guard.config.warnings
  })
}
