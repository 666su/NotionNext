/**
 * GET /api/admin/comments —— Twikoo 评论数（只读、公开接口）
 *
 * 能拿到：每篇文章的评论数、有评论的文章数、评论最多的文章。
 * 拿不到（刻意）：站点总评论数（只能累加）、待审核数、每日趋势（需自建快照）。
 */

import { readArticleIndex } from '@/lib/admin/sync/notion-sync'
import { fetchCommentCounts, getTwikooEndpoint } from '@/lib/admin/twikoo'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res)
  if (!guard) return null

  if (!getTwikooEndpoint()) {
    return json(res, 200, {
      ok: true,
      available: false,
      reason: 'not_configured',
      rows: [],
      totals: { comments: 0, articlesWithComments: 0 }
    })
  }

  try {
    const { rows: articles } = await readArticleIndex()
    const candidates = articles.slice(0, 100).map(article => ({
      article,
      path: article.slug ? `/article/${article.slug}` : ''
    }))
    const paths = candidates.map(item => item.path).filter(Boolean)

    const { available, reason, counts } = await fetchCommentCounts(paths)

    const rows = candidates
      .map(({ article, path }) => ({
        id: article.id,
        title: article.title,
        path,
        category: article.category || '',
        comments: Number(counts[path] || 0)
      }))
      .filter(row => row.comments > 0)
      .sort((a, b) => b.comments - a.comments)

    return json(res, 200, {
      ok: true,
      available,
      reason: available ? undefined : reason,
      rows,
      totals: {
        comments: rows.reduce((acc, row) => acc + row.comments, 0),
        articlesWithComments: rows.length
      }
    })
  } catch (err) {
    console.error('[admin][comments] failed:', err?.message || err)
    return json(res, 200, {
      ok: true,
      available: false,
      reason: 'request_failed',
      rows: [],
      totals: { comments: 0, articlesWithComments: 0 }
    })
  }
}
