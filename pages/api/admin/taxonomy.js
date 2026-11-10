/**
 * GET /api/admin/taxonomy?range=7d|30d|90d|today|yesterday
 *
 * 分类 / 标签聚合（Phase 4）：文章数 + 所选时间窗内的 PV。
 * 只读 Notion 快照 + 自建统计，**不回写 Notion**。
 *
 * 口径：
 * - 文章数为快照内的条目数（一篇多标签会被每个标签各计一次）；
 * - PV 走「article_id 与路径口径取较大值」，与文章页一致；
 * - 未分类文章单列，不并进任何分类。
 */

import { buildArticlePvMap } from '@/lib/admin/article-view'
import { readArticleIndex } from '@/lib/admin/sync/notion-sync'
import { dateKey, recentDateKeys } from '@/lib/analytics/classify'
import { getArticleStats, getPathViews } from '@/lib/analytics/storage'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'

const RANGE_DAYS = { today: 1, yesterday: 1, '7d': 7, '30d': 30, '90d': 90 }
const UNCATEGORIZED = '未分类'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res)
  if (!guard) return null

  const range = String(req.query?.range || '30d')
  if (!RANGE_DAYS[range]) return json(res, 400, { error: 'invalid_range' })

  const now = Date.now()
  const dates =
    range === 'yesterday' ? [dateKey(now - 86400000)] : recentDateKeys(RANGE_DAYS[range]).reverse()

  try {
    const [articleIndex, articleStats, pathViews] = await Promise.all([
      readArticleIndex(),
      getArticleStats(dates, 200),
      getPathViews(dates)
    ])

    const { pvByArticle } = buildArticlePvMap({ articleIndex, pathViews, articleStats })
    const rows = articleIndex.rows

    const categoryMap = new Map()
    const tagMap = new Map()
    let latestPublishedAt = null

    rows.forEach(article => {
      const pv = pvByArticle.get(article.id) || 0
      const category = article.category || UNCATEGORIZED

      const cat = categoryMap.get(category) || { name: category, articles: 0, pv: 0 }
      cat.articles += 1
      cat.pv += pv
      categoryMap.set(category, cat)

      const tags = Array.isArray(article.tags) ? article.tags : []
      tags.forEach(tag => {
        const current = tagMap.get(tag) || { name: tag, articles: 0, pv: 0 }
        current.articles += 1
        current.pv += pv
        tagMap.set(tag, current)
      })

      if (article.publishedAt) {
        const ts = Number(article.publishedAt)
        if (Number.isFinite(ts) && (!latestPublishedAt || ts > latestPublishedAt)) {
          latestPublishedAt = ts
        }
      }
    })

    const toRows = map =>
      [...map.values()]
        .map(row => ({
          ...row,
          share: rows.length ? Math.round((row.articles / rows.length) * 1000) / 10 : null
        }))
        .sort((a, b) => b.articles - a.articles || b.pv - a.pv)

    const categories = toRows(categoryMap)
    const tags = toRows(tagMap)

    return json(res, 200, {
      ok: true,
      range,
      dates,
      syncedAt: articleIndex.meta?.syncedAt || null,
      totals: {
        articles: rows.length,
        categories: categories.filter(row => row.name !== UNCATEGORIZED).length,
        tags: tags.length,
        uncategorized: categoryMap.get(UNCATEGORIZED)?.articles || 0,
        pv: [...pvByArticle.values()].reduce((acc, value) => acc + value, 0)
      },
      categories,
      tags,
      latestPublishedAt
    })
  } catch (err) {
    console.error('[admin][taxonomy] failed:', err?.message || err)
    return json(res, 503, { error: 'stats_store_unavailable' })
  }
}
