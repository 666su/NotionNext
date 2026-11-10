/**
 * 统计写入与聚合读取
 *
 * 存储形态（方案 A：复用生产已配置的 Upstash Redis）：
 * 全部按「日 / 小时 × 维度」落桶，读取时按时间窗求和 / HLL 合并，不需要 Cron 聚合任务。
 * 键前缀 `stats:v1:*` 与 ISR 缓存、rank、notify 严格分离；所有键写时带 TTL。
 */

import {
  kvExpire,
  kvGet,
  kvHgetall,
  kvHincrby,
  kvIncr,
  kvMget,
  kvPfadd,
  kvPfcount,
  kvSet,
  kvSetnx
} from '@/lib/kv'
import { K, TTL, LIMITS } from './constants'
import { classifySource, dateKey, minuteKey } from './classify'

async function incr(key, ttl = TTL.daily) {
  const value = await kvIncr(key)
  if (value === 1) await kvExpire(key, ttl)
  return value
}

async function hincr(key, field, ttl = TTL.daily) {
  const value = await kvHincrby(key, field, 1)
  if (value === 1) await kvExpire(key, ttl)
  return value
}

/**
 * 写入事件（已通过 validateEvent 规范化）
 * @returns {Promise<{written:number, duplicates:number}>}
 */
export async function recordEvents({ events, meta = {} }) {
  let written = 0
  let duplicates = 0

  for (const event of events) {
    const day = dateKey(event.occurredAt)
    const minute = minuteKey(event.occurredAt)
    const hour = minute.slice(8, 10)

    // 1) 事件去重（event_id 唯一，1 小时窗口）
    const first = await kvSetnx(K.dedupe + event.eventId, '1', TTL.dedupe)
    if (!first) {
      duplicates += 1
      continue
    }

    // 2) 会话首事件 → 会话计数 + 入口页
    const sessionFlag = `${K.sessSeen}${event.sessionId}:${day}`
    const isNewSession = await kvSetnx(sessionFlag, '1', TTL.sessionSeen)

    // 3) 事件计数（按事件名）
    await hincr(K.eventCount + day, event.name)

    // 4) 实时活跃（最近 12 分钟窗口，HLL 去重会话）
    await kvPfadd(K.active + minute, event.sessionId)
    await kvExpire(K.active, TTL.active)

    // 5) 页面浏览相关
    if (event.name === 'page_view') {
      const path = event.pagePath

      if (isNewSession) {
        await incr(K.sessions + day)
        await hincr(K.entry + day, path)
      }

      // 退出页近似：同一会话内从 A 跳到 B 时，把 A 记作一次"离开页"
      const lastKey = K.sessLast + event.sessionId
      const previous = await kvGet(lastKey)
      if (previous && previous !== path) {
        await hincr(K.exit + day, previous)
      }
      await kvSet(lastKey, path, TTL.sessionSeen)

      await incr(K.pv + day)
      await hincr(K.hour + day, hour)
      await hincr(K.pvPath + day, path)

      // 新访客 / 回访（按匿名 ID 首次出现判定）
      const visitorKey = K.seenVisitor + event.anonymousId
      const isNewVisitor = await kvSetnx(visitorKey, '1', TTL.seenVisitor)
      await incr(isNewVisitor ? K.newVisitor + day : K.returningVisitor + day)

      await kvPfadd(K.uv + day, event.anonymousId)
      await kvExpire(K.uv + day, TTL.daily)

      if (event.articleId) {
        await hincr(K.pvArticle + day, event.articleId)
        const artUvKey = `${K.uvArticle}${day}:${event.articleId}`
        await kvPfadd(artUvKey, event.anonymousId)
        await kvExpire(artUvKey, TTL.daily)
      }

      const { channel, host } = classifySource(meta.referrerHost, meta.selfHost)
      await hincr(`${K.dim}${day}:src`, channel)
      if (host) await hincr(K.refHost + day, host, TTL.refHost)
      await hincr(`${K.dim}${day}:dev`, meta.device || 'unknown')
      await hincr(`${K.dim}${day}:br`, meta.browser || 'unknown')
      await hincr(`${K.dim}${day}:os`, meta.os || 'unknown')
      await hincr(`${K.dim}${day}:geo`, meta.country || 'unknown')
    }

    if (event.name === 'scroll_depth') {
      await hincr(K.depth + day, String(event.depth))
      if (event.articleId) {
        await hincr(K.articleDepth + day, `${event.articleId}|${event.depth}`)
      }
    }

    if (event.name === 'article_complete') {
      await hincr(K.depth + day, 'complete')
      if (event.articleId) {
        await hincr(K.articleDepth + day, `${event.articleId}|complete`)
      }
    }

    if (event.name === 'search') {
      await incr(K.search + day)
      if (event.searchQuery) {
        await hincr(K.searchQuery + day, event.searchQuery, TTL.search)
      }
    }

    if (event.name === 'outbound_click' && event.targetHost) {
      await hincr(K.outbound + day, event.targetHost)
    }

    if (event.name === 'share_click' && event.targetHost) {
      await hincr(K.share + day, event.targetHost)
    }

    written += 1
  }

  return { written, duplicates }
}

/* ------------------------------------------------------------------ *
 * 读取
 * ------------------------------------------------------------------ */

function sum(values) {
  return values.reduce((acc, cur) => acc + Number(cur || 0), 0)
}

function mergeHashes(list) {
  const merged = {}
  list.forEach(hash => {
    Object.entries(hash || {}).forEach(([field, value]) => {
      merged[field] = (merged[field] || 0) + Number(value || 0)
    })
  })
  return merged
}

function toSortedRows(hash, limit = 20) {
  return Object.entries(hash || {})
    .map(([name, value]) => ({ name, value: Number(value) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, Math.max(1, Math.min(200, limit)))
}

async function readDims(dates, dim) {
  const hashes = await Promise.all(
    dates.map(day => kvHgetall(`${K.dim}${day}:${dim}`))
  )
  return mergeHashes(hashes)
}

async function readHashSeries(dates, prefix) {
  const hashes = await Promise.all(dates.map(day => kvHgetall(prefix + day)))
  return mergeHashes(hashes)
}

/** 全站汇总（PV/UV/Session/维度） */
export async function getSummary(dates) {
  const [pvValues, sessValues, uvByDay] = await Promise.all([
    kvMget(dates.map(day => K.pv + day)),
    kvMget(dates.map(day => K.sessions + day)),
    Promise.all(dates.map(day => kvPfcount(K.uv + day)))
  ])

  const [device, browser, os, geo, source] = await Promise.all([
    readDims(dates, 'dev'),
    readDims(dates, 'br'),
    readDims(dates, 'os'),
    readDims(dates, 'geo'),
    readDims(dates, 'src')
  ])

  const byDay = dates.map((day, index) => ({
    date: day,
    pv: Number(pvValues[index] || 0),
    uv: Number(uvByDay[index] || 0),
    sessions: Number(sessValues[index] || 0)
  }))

  return {
    pv: sum(pvValues),
    sessions: sum(sessValues),
    uv: await kvPfcount(dates.map(day => K.uv + day)),
    byDay,
    dims: { device, browser, os, geo, source }
  }
}

/** 逐小时 PV（单日） */
export async function getHourly(day) {
  const hash = await kvHgetall(K.hour + day)
  const rows = []
  for (let hour = 0; hour < 24; hour += 1) {
    const key = String(hour).padStart(2, '0')
    rows.push({ hour: key, pv: Number(hash[key] || 0) })
  }
  return rows
}

/** 路径排行（合计 / 入口 / 退出） */
export async function getPathRanking(dates, kind = 'pv', limit = 20) {
  const prefix =
    kind === 'entry' ? K.entry : kind === 'exit' ? K.exit : K.pvPath
  return toSortedRows(await readHashSeries(dates, prefix), limit).map(row => ({
    path: row.name,
    views: row.value
  }))
}

/** 全部路径的 PV（不截断，供文章维度反查用） */
export async function getPathViews(dates) {
  return readHashSeries(dates, K.pvPath)
}

/** 来源域名排行 */
export async function getReferrers(dates, limit = 15) {
  return toSortedRows(await readHashSeries(dates, K.refHost), limit).map(row => ({
    host: row.name,
    views: row.value
  }))
}

/** 阅读深度直方图 */
export async function getDepth(dates) {
  const hash = await readHashSeries(dates, K.depth)
  return {
    d25: Number(hash['25'] || 0),
    d50: Number(hash['50'] || 0),
    d75: Number(hash['75'] || 0),
    d90: Number(hash['90'] || 0),
    complete: Number(hash.complete || 0)
  }
}

/** 搜索：次数 + 热门词 */
export async function getSearch(dates, limit = 15) {
  const [counts, terms] = await Promise.all([
    kvMget(dates.map(day => K.search + day)),
    readHashSeries(dates, K.searchQuery)
  ])
  return {
    total: sum(counts),
    terms: toSortedRows(terms, limit).map(row => ({
      term: row.name,
      count: row.value
    }))
  }
}

/** 外链与分享 */
export async function getOutboundShare(dates) {
  const [outbound, share] = await Promise.all([
    readHashSeries(dates, K.outbound),
    readHashSeries(dates, K.share)
  ])
  return {
    outbound: toSortedRows(outbound, 10).map(r => ({ host: r.name, count: r.value })),
    share: toSortedRows(share, 10).map(r => ({ channel: r.name, count: r.value }))
  }
}

/** 新老访客 */
export async function getNewVsReturning(dates) {
  const [newValues, returningValues] = await Promise.all([
    kvMget(dates.map(day => K.newVisitor + day)),
    kvMget(dates.map(day => K.returningVisitor + day))
  ])
  const fresh = sum(newValues)
  const returning = sum(returningValues)
  return { newVisitors: fresh, returningVisitors: returning, total: fresh + returning }
}

/** 事件计数（合计） */
export async function getEventCountsTotal(dates) {
  return readHashSeries(dates, K.eventCount)
}

/** 单日事件计数（兼容旧接口） */
export async function getEventCounts(day) {
  return kvHgetall(K.eventCount + day)
}

/** 实时活跃会话估算：最近 N 分钟 */
export async function getActiveSessions(minutes = 5) {
  const now = Date.now()
  const keys = []
  for (let i = 0; i < minutes; i += 1) {
    keys.push(K.active + minuteKey(now - i * 60000))
  }
  const count = await kvPfcount(keys)
  return { windowMinutes: minutes, sessions: count }
}

/** 单日路径排行（兼容旧接口） */
export async function getTopPaths(day, limit = 20) {
  const hash = await kvHgetall(K.pvPath + day)
  return toSortedRows(hash, limit).map(row => ({
    path: row.name,
    views: row.value
  }))
}

/**
 * 文章维度汇总（与 Notion 快照 join 前的原始数据）
 * @returns {Array<{articleId, pv, uv}>}
 */
export async function getArticleStats(dates, limit = 100) {
  const hashes = await Promise.all(dates.map(day => kvHgetall(K.pvArticle + day)))
  const merged = mergeHashes(hashes)
  const rows = Object.entries(merged)
    .map(([articleId, pv]) => ({ articleId, pv: Number(pv) }))
    .sort((a, b) => b.pv - a.pv)
    .slice(0, limit)

  const withUv = await Promise.all(
    rows.map(async row => {
      const keys = dates.map(day => `${K.uvArticle}${day}:${row.articleId}`)
      let uv = 0
      try {
        uv = await kvPfcount(keys)
      } catch (err) {
        uv = 0
      }
      return { ...row, uv: Number(uv) || 0 }
    })
  )
  return withUv
}

/** 单篇文章的逐日 PV（趋势） */
export async function getArticleTrend(articleId, dates) {
  const hashes = await Promise.all(dates.map(day => kvHgetall(K.pvArticle + day)))
  return dates.map((day, index) => ({
    date: day,
    pv: Number((hashes[index] || {})[articleId] || 0)
  }))
}

/** 文章维度阅读深度（field = articleId|bucket） */
export async function getArticleDepth(dates) {
  const hash = await readHashSeries(dates, K.articleDepth)
  const result = {}
  Object.entries(hash).forEach(([field, value]) => {
    const idx = field.lastIndexOf('|')
    if (idx <= 0) return
    const articleId = field.slice(0, idx)
    const bucket = field.slice(idx + 1)
    if (!result[articleId]) result[articleId] = {}
    result[articleId][bucket] = Number(value)
  })
  return result
}

/** 只取三个总数（卡片用，避免拉维度） */
export async function getTotals(dates) {
  const [pvValues, sessValues, uv] = await Promise.all([
    kvMget(dates.map(day => K.pv + day)),
    kvMget(dates.map(day => K.sessions + day)),
    kvPfcount(dates.map(day => K.uv + day))
  ])
  return { pv: sum(pvValues), uv, sessions: sum(sessValues) }
}

export { LIMITS }
