/**
 * GET /api/admin/stats/report?range=today|yesterday|7d|30d|90d
 *
 * 后台数据页共用的聚合报告（一次请求拿全，减少往返）。
 * 需要管理员会话；日期基准时区 Asia/Shanghai。
 *
 * 取数纪律：
 * - 缺失一律返回 null / 空数组，由前端显示"未采集"，**不补 0**掩盖问题；
 * - 文章维度同时接受 `article_id`（页面主动上报）与 `/article/<slug>` 路径（按 Notion 快照反查），
 *   两条口径取较大值，并在 `pathMatched` 标注来源，避免"改了上报方式就归零"。
 */

import { K } from '@/lib/analytics/constants'
import { dateKey, recentDateKeys } from '@/lib/analytics/classify'
import {
  getActiveSessions,
  getArticleDepth,
  getArticleStats,
  getDepth,
  getEventCountsTotal,
  getHourly,
  getNewVsReturning,
  getOutboundShare,
  getPathRanking,
  getPathViews,
  getReferrers,
  getSearch,
  getSummary,
  getTotals
} from '@/lib/analytics/storage'
import { buildArticlePvMap } from '@/lib/admin/article-view'
import { readArticleIndex } from '@/lib/admin/sync/notion-sync'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'
import { kvGet } from '@/lib/kv'

const RANGE_DAYS = { today: 1, yesterday: 1, '7d': 7, '30d': 30, '90d': 90 }

function depthScore(buckets = {}) {
  // 用四档占比的加权平均近似"平均阅读深度"（不是停留时间）
  const total =
    Number(buckets['25'] || 0) +
    Number(buckets['50'] || 0) +
    Number(buckets['75'] || 0) +
    Number(buckets['90'] || 0)
  if (!total) return null
  const weighted =
    Number(buckets['25'] || 0) * 25 +
    Number(buckets['50'] || 0) * 50 +
    Number(buckets['75'] || 0) * 75 +
    Number(buckets['90'] || 0) * 90
  return Math.round((weighted / total) * 10) / 10
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
  if (!RANGE_DAYS[range]) return json(res, 400, { error: 'invalid_range' })

  const now = Date.now()
  const today = dateKey(now)
  const yesterday = dateKey(now - 86400000)
  const dates =
    range === 'yesterday' ? [yesterday] : recentDateKeys(RANGE_DAYS[range]).reverse()
  const isSingleDay = range === 'today' || range === 'yesterday'
  const hourlyDay = range === 'yesterday' ? yesterday : today

  try {
    const [
      summary,
      hourlyRows,
      depth,
      search,
      referrers,
      pvPages,
      entryPages,
      exitPages,
      events,
      realtime,
      visitors,
      outboundShare,
      todayTotals,
      yesterdayTotals,
      pv7,
      pv30,
      uv30,
      articleStatsRaw,
      articleDepth,
      articleIndex,
      collectionStartedAt,
      pathViews
    ] = await Promise.all([
      getSummary(dates),
      getHourly(hourlyDay),
      getDepth(dates),
      getSearch(dates, 15),
      getReferrers(dates, 15),
      getPathRanking(dates, 'pv', 20),
      getPathRanking(dates, 'entry', 10),
      getPathRanking(dates, 'exit', 10),
      getEventCountsTotal(dates),
      getActiveSessions(5),
      getNewVsReturning(dates),
      getOutboundShare(dates),
      getTotals([today]),
      getTotals([yesterday]),
      getTotals(recentDateKeys(7)),
      getTotals(recentDateKeys(30)),
      getTotals(recentDateKeys(30)),
      getArticleStats(dates, 50),
      getArticleDepth(dates),
      readArticleIndex(),
      kvGet(K.startedAt),
      getPathViews(dates)
    ])

    const { pvByArticle, unmappedPathViews } = buildArticlePvMap({
      articleIndex,
      pathViews,
      articleStats: articleStatsRaw
    })

    const articleMap = new Map(articleIndex.rows.map(row => [row.id, row]))
    const statMap = new Map(articleStatsRaw.map(stat => [stat.articleId, stat]))
    const ids = new Set([...articleMap.keys(), ...statMap.keys(), ...pvByArticle.keys()])

    const articles = [...ids]
      .map(id => {
        const meta = articleMap.get(id)
        const stat = statMap.get(id)
        const buckets = articleDepth[id] || {}
        const complete = Number(buckets.complete || 0)
        const reads = Number(buckets['25'] || 0)
        const pv = pvByArticle.get(id) || 0
        return {
          id,
          title: meta?.title || `(未同步：${String(id).slice(0, 8)})`,
          slug: meta?.slug || '',
          url: meta?.url || '',
          category: meta?.category || '',
          tags: meta?.tags || [],
          pv,
          // 路径口径拿不到 UV（HLL 键按 article_id 存），此时返回 null 由 UI 显示 "—"
          uv: stat ? Number(stat.uv) || 0 : null,
          avgDepth: depthScore(buckets),
          completeRate: reads > 0 ? Math.min(100, Math.round((complete / reads) * 100)) : null,
          pathMatched: !stat && pv > 0
        }
      })
      .sort((a, b) => b.pv - a.pv || String(a.title).localeCompare(String(b.title), 'zh-CN'))
      .slice(0, 100)

    return json(res, 200, {
      ok: true,
      range,
      dates,
      generatedAt: new Date().toISOString(),
      collectionStartedAt: collectionStartedAt || null,
      cards: {
        today: todayTotals,
        yesterday: yesterdayTotals,
        pv7: pv7.pv,
        pv30: pv30.pv,
        uv30: uv30.uv
      },
      summary,
      hourly: { day: isSingleDay ? hourlyDay : null, rows: isSingleDay ? hourlyRows : [] },
      depth,
      search,
      referrers,
      pages: { pv: pvPages, entry: entryPages, exit: exitPages },
      events,
      realtime,
      visitors,
      outboundShare,
      articles: {
        syncedAt: articleIndex.meta?.syncedAt || null,
        count: articleIndex.meta?.count || articleIndex.rows.length,
        categories: articleIndex.meta?.categories || [],
        tags: articleIndex.meta?.tags || [],
        pathMapSize: Object.keys(articleIndex.pathMap || {}).length,
        unmappedPathViews,
        rows: articles
      }
    })
  } catch (err) {
    console.error('[admin][stats] report failed:', err?.message || err)
    return json(res, 503, { error: 'stats_store_unavailable' })
  }
}
