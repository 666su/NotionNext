/**
 * GET /api/admin/seo —— 本地 SEO 自查（Phase 5）
 *
 * 只返回**能自证**的数据：
 *   - 文章快照的标题长度 / 摘要缺失 / 分类 / 标签 / 更新时间（本地可算）
 *   - robots.txt 与 sitemap.xml 的同源可访问性（真实探测）
 *   - Google Search Console 的"未连接"状态（不含任何模拟数字）
 */

import { probeFiles } from '@/lib/admin/link-check'
import { auditArticles, readGscStatus } from '@/lib/admin/seo-audit'
import { readArticleIndex } from '@/lib/admin/sync/notion-sync'
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

  try {
    const [{ rows, meta }, filesResult] = await Promise.all([
      readArticleIndex(),
      origin ? probeFiles({ origin }) : Promise.resolve({ files: [], cached: false })
    ])

    const audit = auditArticles(rows)

    return json(res, 200, {
      ok: true,
      origin: origin || null,
      generatedAt: new Date().toISOString(),
      syncedAt: meta?.syncedAt || null,
      audit,
      files: { rows: filesResult.files, cached: filesResult.cached },
      gsc: readGscStatus(),
      ai: {
        enabled: false,
        reason: 'not_configured',
        note: 'AI 摘要 / 标签建议为预留位：未接入模型，不生成任何内容。'
      },
      notes: [
        '本页只做"能自证"的检查，不展示曝光量、点击量、CTR、排名 —— 那些只可能来自 Search Console。',
        '标题长度以字符计数（中文按 1 个字符），60 字符以上在搜索结果中可能被截断。',
        '摘要缺失时，搜索引擎会自行截取正文，通常效果更差。'
      ]
    })
  } catch (err) {
    console.error('[admin][seo] failed:', err?.message || err)
    return json(res, 503, { error: 'seo_audit_unavailable' })
  }
}
