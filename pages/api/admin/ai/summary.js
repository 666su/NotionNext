/**
 * GET /api/admin/ai/summary?range=today|yesterday|7d|30d
 *
 * "AI 浏览总结"：把所选时间窗的真实统计喂给模型，生成中文要点 + 一条建议。
 *
 * 三条硬约束：
 * 1. 未配置 AI key → `ai.ok:false, reason:'not_configured'`，页面照样显示事实，不伪造总结；
 * 2. 提示词要求"只能使用给定数字"，且温度 0.3；
 * 3. 只发聚合数字给模型，**不发**任何访客标识、IP、评论正文或文章正文。
 */

import { dateKey, recentDateKeys } from '@/lib/analytics/classify'
import {
  getArticleStats,
  getDepth,
  getEventCountsTotal,
  getPathRanking,
  getPathViews,
  getSearch,
  getSummary
} from '@/lib/analytics/storage'
import { buildArticlePvMap } from '@/lib/admin/article-view'
import { readArticleIndex } from '@/lib/admin/sync/notion-sync'
import { completeChat, readAiConfig } from '@/lib/admin/ai'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'

const RANGE_DAYS = { today: 1, yesterday: 1, '7d': 7, '30d': 30 }

const SYSTEM = [
  '你是个人博客的运营分析助手。',
  '规则：',
  '1. 只能使用给出的数字，不得编造或外推；',
  '2. 数字为 0 或缺失时直接说"暂无数据"；',
  '3. 输出 3-5 句中文要点 + 最后 1 条可执行建议；',
  '4. 不要输出标题、表格、代码块，纯短句。'
].join('\n')

const SOURCE_LABELS = {
  direct: '直接访问',
  internal: '站内跳转',
  search: '搜索引擎',
  social: '社交媒体',
  referral: '外部链接'
}

function rangeLabel(range) {
  return { today: '今日', yesterday: '昨日', '7d': '近 7 天', '30d': '近 30 天' }[range] || range
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
  const dates =
    range === 'yesterday' ? [dateKey(now - 86400000)] : recentDateKeys(RANGE_DAYS[range]).reverse()

  try {
    const [summary, depth, search, topPages, articleStats, articleIndex, pathViews, events] =
      await Promise.all([
        getSummary(dates),
        getDepth(dates),
        getSearch(dates, 5),
        getPathRanking(dates, 'pv', 5),
        getArticleStats(dates, 8),
        readArticleIndex(),
        getPathViews(dates),
        getEventCountsTotal(dates)
      ])

    const { pvByArticle } = buildArticlePvMap({ articleIndex, pathViews, articleStats })
    const titleMap = new Map(articleIndex.rows.map(row => [row.id, row]))
    const topArticles = [...pvByArticle.entries()]
      .map(([id, pv]) => ({ id, title: titleMap.get(id)?.title || '(未同步)', pv }))
      .filter(item => item.pv > 0)
      .sort((a, b) => b.pv - a.pv)
      .slice(0, 3)

    const sources = Object.entries(summary.dims?.source || {})
      .map(([key, value]) => ({ name: SOURCE_LABELS[key] || key, value }))
      .sort((a, b) => b.value - a.value)

    const facts = {
      range,
      label: rangeLabel(range),
      dates,
      pv: summary.pv,
      uv: summary.uv,
      sessions: summary.sessions,
      depth,
      searchTotal: search.total,
      searchTerms: search.terms,
      topPages,
      topArticles,
      sources,
      articlesSyncedAt: articleIndex.meta?.syncedAt || null,
      events: Object.entries(events || {})
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6)
    }

    const aiConfig = readAiConfig()
    let ai = { ok: false, reason: aiConfig.configured ? 'skipped' : 'not_configured', model: aiConfig.model }

    if (aiConfig.configured) {
      const prompt = [
        `时间范围：${facts.label}（${facts.dates.join('~')}）`,
        `PV ${facts.pv}，UV ${facts.uv}，Session ${facts.sessions}`,
        `阅读深度 25/50/75/90/读完：${depth.d25}/${depth.d50}/${depth.d75}/${depth.d90}/${depth.complete}`,
        `站内搜索 ${search.total} 次；热词：${search.terms.map(t => `${t.term}(${t.count})`).join('、') || '无'}`,
        `热门页面：${topPages.map(p => `${p.path} ${p.views}`).join('；') || '无'}`,
        `热门文章：${topArticles.map(a => `${a.title} ${a.pv}`).join('；') || '无'}`,
        `来源：${sources.map(s => `${s.name} ${s.value}`).join('；') || '无'}`
      ].join('\n')

      const result = await completeChat({ system: SYSTEM, user: prompt, maxTokens: 320 })
      ai = { ok: !!result.ok, reason: result.reason || null, model: result.model || aiConfig.model, text: result.text }
    }

    return json(res, 200, {
      ok: true,
      generatedAt: new Date().toISOString(),
      ai: { configured: aiConfig.configured, ...ai },
      facts
    })
  } catch (err) {
    console.error('[admin][ai] summary failed:', err?.message || err)
    return json(res, 503, { error: 'stats_store_unavailable' })
  }
}
