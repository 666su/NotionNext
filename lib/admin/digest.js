/**
 * 每日浏览总结（Phase 6）
 *
 * 组成：真实统计事实 → （可选）AI 归纳 → Telegram 推送 → 落一条发送日志。
 * 纪律：
 * - 事实层全部来自自建统计（无数据就是 0，不做同比编造）；
 * - AI 未配置 / 失败时**照样发**，只是把标题写成"原始数据"，并在日志里标记 ai=false；
 * - 推送失败不影响事实生成（返回值里分开表达）。
 */

import { K } from '@/lib/analytics/constants'
import { dateKey } from '@/lib/analytics/classify'
import {
  getArticleStats,
  getDepth,
  getNewVsReturning,
  getPathRanking,
  getPathViews,
  getSearch,
  getSummary,
  getTotals
} from '@/lib/analytics/storage'
import { buildArticlePvMap } from '@/lib/admin/article-view'
import { readArticleIndex } from '@/lib/admin/sync/notion-sync'
import { escapeHtml, readTelegramConfig, sendTelegram } from '@/lib/admin/telegram'
import { readAiConfig, summarizeDigest } from '@/lib/admin/ai'
import { kvLpush, kvLtrim, kvLrange } from '@/lib/kv'

const DIGEST_LOG_MAX = 100

function pad(value) {
  return String(value).padStart(2, '0')
}

/** 日历日加减（不经过本地时区，避免夏令时/时区偏移带来的 off-by-one） */
export function shiftDayKey(dayKey, delta) {
  const y = Number(String(dayKey).slice(0, 4))
  const m = Number(String(dayKey).slice(4, 6)) - 1
  const d = Number(String(dayKey).slice(6, 8))
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return dayKey
  const shifted = new Date(Date.UTC(y, m, d, 12, 0, 0) + delta * 86400000)
  return `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}`
}

const SOURCE_LABELS = {
  direct: '直接访问',
  internal: '站内跳转',
  search: '搜索引擎',
  social: '社交媒体',
  referral: '外部链接'
}

/** 取一天的统计事实（只读，不做任何补算） */
export async function buildDailyFacts(dayKey) {
  const day = /^\d{8}$/.test(String(dayKey || '')) ? String(dayKey) : dateKey(Date.now() - 86400000)
  const prev = shiftDayKey(day, -1)
  const week = Array.from({ length: 7 }, (_, index) => shiftDayKey(day, index - 6))

  const [summary, prevTotals, depth, search, topPaths, articleStats, articleIndex, pathViews, visitors, weekTotals] =
    await Promise.all([
      getSummary([day]),
      getTotals([prev]),
      getDepth([day]),
      getSearch([day], 5),
      getPathRanking([day], 'pv', 5),
      getArticleStats([day], 8),
      readArticleIndex(),
      getPathViews([day]),
      getNewVsReturning([day]),
      Promise.all(week.map(item => getTotals([item])))
    ])

  const { pvByArticle } = buildArticlePvMap({ articleIndex, pathViews, articleStats })
  const titleMap = new Map(articleIndex.rows.map(row => [row.id, row]))
  const topArticles = [...pvByArticle.entries()]
    .map(([id, pv]) => ({
      id,
      title: titleMap.get(id)?.title || `(未同步：${String(id).slice(0, 8)})`,
      pv
    }))
    .filter(item => item.pv > 0)
    .sort((a, b) => b.pv - a.pv)
    .slice(0, 5)

  const sources = Object.entries(summary.dims?.source || {})
    .map(([key, value]) => ({ name: SOURCE_LABELS[key] || key, value }))
    .sort((a, b) => b.value - a.value)

  return {
    date: day,
    prevDate: prev,
    pv: summary.pv,
    uv: summary.uv,
    sessions: summary.sessions,
    prevPv: prevTotals.pv || 0,
    newVisitors: visitors.newVisitors,
    returningVisitors: visitors.returningVisitors,
    depth,
    searchTotal: search.total,
    searchTerms: search.terms,
    topPages: topPaths,
    topArticles,
    sources,
    sparkline: week.map((item, index) => ({ date: item, pv: Number(weekTotals[index]?.pv || 0) })),
    device: summary.dims?.device || {},
    geo: summary.dims?.geo || {},
    articlesSyncedAt: articleIndex.meta?.syncedAt || null
  }
}

function formatDelta(current, previous) {
  const now = Number(current) || 0
  const before = Number(previous) || 0
  if (!before) return now > 0 ? '（前一日无数据）' : ''
  const diff = now - before
  const pct = Math.round((diff / before) * 100)
  if (diff === 0) return '（与前一日持平）'
  return `（较前一日 ${diff > 0 ? '+' : ''}${pct}%）`
}

/** 生成发往 Telegram 的 HTML 文本 */
export function formatDigestText(facts, aiResult) {
  const lines = []
  lines.push(`📊 <b>站点日报 · ${facts.date}</b>`)
  lines.push('')
  lines.push(
    `<b>PV</b> ${facts.pv}${formatDelta(facts.pv, facts.prevPv)} · <b>UV</b> ${facts.uv} · <b>Session</b> ${facts.sessions}`
  )
  lines.push(`首次访客浏览 ${facts.newVisitors} · 回访浏览 ${facts.returningVisitors}`)
  lines.push('')

  if (facts.topPages.length) {
    lines.push('<b>热门页面</b>')
    facts.topPages.forEach(row => lines.push(`· ${escapeHtml(row.path)} — ${row.views}`))
    lines.push('')
  }

  if (facts.topArticles.length) {
    lines.push('<b>热门文章</b>')
    facts.topArticles.slice(0, 3).forEach(row => lines.push(`· ${escapeHtml(row.title)} — ${row.pv}`))
    lines.push('')
  }

  const depth = facts.depth || {}
  const depthTotal =
    Number(depth.d25 || 0) + Number(depth.d50 || 0) + Number(depth.d75 || 0) + Number(depth.d90 || 0)
  if (depthTotal > 0) {
    lines.push(
      `<b>阅读深度</b> 25% ${depth.d25 || 0} · 50% ${depth.d50 || 0} · 75% ${depth.d75 || 0} · 90% ${depth.d90 || 0} · 读完 ${depth.complete || 0}`
    )
  }

  if (facts.searchTotal > 0) {
    const terms = facts.searchTerms.map(item => `${item.term}(${item.count})`).join('、')
    lines.push(`<b>站内搜索</b> ${facts.searchTotal} 次${terms ? `：${escapeHtml(terms)}` : ''}`)
  }

  if (facts.sources.length) {
    lines.push(`<b>来源</b> ${facts.sources.map(item => `${item.name} ${item.value}`).join(' · ')}`)
  }

  lines.push('')
  if (aiResult?.ok) {
    lines.push('🤖 <b>AI 浏览总结</b>')
    lines.push(escapeHtml(aiResult.text))
  } else {
    lines.push(`🤖 AI 总结未生成（${escapeHtml(aiResult?.reason || 'not_configured')}），以上为原始数据。`)
  }

  if (!facts.pv) {
    lines.push('')
    lines.push('⚠️ 当天没有采集到任何页面浏览，可能是流量为零或采集链路异常。')
  }

  return lines.join('\n')
}

export async function logDigest(entry) {
  try {
    await kvLpush(K.digestLog, JSON.stringify(entry))
    await kvLtrim(K.digestLog, 0, DIGEST_LOG_MAX - 1)
  } catch (err) {
    console.error('[digest] log failed:', err?.message || err)
  }
}

export async function readDigestLog(limit = 10) {
  try {
    const rows = await kvLrange(K.digestLog, 0, Math.max(0, limit - 1))
    return (rows || [])
      .map(raw => {
        try {
          return JSON.parse(raw)
        } catch (err) {
          return null
        }
      })
      .filter(Boolean)
  } catch (err) {
    return []
  }
}

/**
 * 生成 + （可选）推送
 * @param {{dayKey?:string, send?:boolean, force?:boolean}} options
 */
export async function runDailyDigest({ dayKey, send = true } = {}) {
  const startedAt = new Date().toISOString()
  const facts = await buildDailyFacts(dayKey)
  const ai = await summarizeDigest(facts)
  const text = formatDigestText(facts, ai)

  let delivery = { ok: false, reason: 'not_sent' }
  if (send) {
    delivery = await sendTelegram({ text })
  }

  const entry = {
    at: startedAt,
    date: facts.date,
    pv: facts.pv,
    uv: facts.uv,
    sessions: facts.sessions,
    ai: !!ai.ok,
    aiReason: ai.ok ? null : ai.reason,
    sent: !!delivery.ok,
    sendReason: delivery.ok ? null : delivery.reason,
    messageId: delivery.messageId || null,
    chars: text.length
  }
  await logDigest(entry)

  return {
    ok: true,
    facts,
    text,
    ai: { ok: !!ai.ok, reason: ai.reason || null, model: ai.model || null },
    delivery,
    computedAt: new Date().toISOString()
  }
}

/** 配置自检（给后台页面用，不返回任何密钥） */
export function readDigestConfig() {
  const ai = readAiConfig()
  const tg = readTelegramConfig()
  return {
    ai: {
      configured: ai.configured,
      model: ai.model,
      baseUrl: ai.baseUrl
    },
    telegram: {
      configured: tg.configured,
      missing: tg.missing,
      baseHost: tg.baseHost,
      localBase: tg.localBase
    },
    cronSecretConfigured: !!String(process.env.CRON_SECRET || '').trim()
  }
}
