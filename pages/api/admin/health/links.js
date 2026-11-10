/**
 * GET /api/admin/health/links?limit=10 —— 本站失效链接检查（Phase 5）
 *
 * 只探测同源页面（首页 / 归档 / 快照里的文章 URL），不扫描第三方站点。
 */

import { checkLinks } from '@/lib/admin/link-check'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'

function resolveOrigin(req) {
  const envUrl = String(process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_LINK || '').trim()
  if (envUrl) {
    try {
      return new URL(envUrl).origin
    } catch (err) {
      /* 落回请求头 */
    }
  }
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim()
  return host ? `${proto}://${host}` : ''
}

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res)
  if (!guard) return null

  const origin = resolveOrigin(req)
  if (!origin) return json(res, 503, { error: 'origin_unavailable' })

  const limit = Math.max(1, Math.min(20, Number(req.query?.limit) || 10))

  try {
    const data = await checkLinks({ origin, limit })
    return json(res, 200, { ok: true, ...data })
  } catch (err) {
    console.error('[admin][health][links] failed:', err?.message || err)
    return json(res, 503, { error: 'link_check_unavailable' })
  }
}
