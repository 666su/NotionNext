/**
 * GET /api/admin/health/site —— 站点健康探针（Phase 5）
 *
 * 只做**低频、同源、只读**探测：首页 + 归档页（后续可按需扩展）。
 * 结果在进程内缓存 3 分钟，避免后台刷新把源站打热；不得用于外部站点扫描。
 */

import { collectHealth } from '@/lib/admin/health'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'

function resolveOrigin(req) {
  const envUrl = String(
    process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_LINK || ''
  ).trim()
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

  try {
    const data = await collectHealth({ origin })
    return json(res, 200, { ok: true, origin, ...data })
  } catch (err) {
    console.error('[admin][health] failed:', err?.message || err)
    return json(res, 503, { error: 'health_unavailable' })
  }
}
