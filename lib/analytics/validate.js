/**
 * 统计事件校验（服务端唯一入口）
 *
 * 原则：**不相信浏览器上报的任何内容**。校验失败一律返回 reason 并丢弃，
 * 不回显细节给客户端（避免成为探测工具）。
 */

import { EVENT_NAMES, LIMITS, SCROLL_BUCKETS } from './constants'

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/
const ARTICLE_RE = /^[0-9a-fA-F-]{8,64}$/
const PATH_RE = /^\/[^\s]{0,200}$/

function normalizeTimestamp(value) {
  if (value == null) return Date.now()
  const num = typeof value === 'number' ? value : Date.parse(String(value))
  if (!Number.isFinite(num)) return NaN
  return num
}

export function validateEvent(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'not_object' }
  }

  const name = String(raw.event_name || '')
  if (!EVENT_NAMES.includes(name)) return { ok: false, reason: 'event_name' }

  const eventId = String(raw.event_id || '')
  if (!ID_RE.test(eventId)) return { ok: false, reason: 'event_id' }

  const anonymousId = String(raw.anonymous_id || '')
  if (!ID_RE.test(anonymousId)) return { ok: false, reason: 'anonymous_id' }

  const sessionId = String(raw.session_id || '')
  if (!ID_RE.test(sessionId)) return { ok: false, reason: 'session_id' }

  const pagePath = String(raw.page_path || '')
  if (!PATH_RE.test(pagePath) || pagePath.length > LIMITS.pagePathMaxLength) {
    return { ok: false, reason: 'page_path' }
  }

  const articleRaw = raw.article_id == null ? '' : String(raw.article_id)
  if (articleRaw && !ARTICLE_RE.test(articleRaw)) {
    return { ok: false, reason: 'article_id' }
  }

  const occurredAt = normalizeTimestamp(raw.occurred_at)
  if (!Number.isFinite(occurredAt)) return { ok: false, reason: 'occurred_at' }
  // 只接受 ±24 小时内的时钟，避免历史/未来数据污染日桶
  if (Math.abs(Date.now() - occurredAt) > 24 * 3600 * 1000) {
    return { ok: false, reason: 'occurred_at_skew' }
  }

  let props = raw.props
  if (props == null) props = {}
  if (typeof props !== 'object' || Array.isArray(props)) {
    return { ok: false, reason: 'props' }
  }
  let propsJson
  try {
    propsJson = JSON.stringify(props)
  } catch (err) {
    return { ok: false, reason: 'props' }
  }
  if (propsJson.length > LIMITS.propsMaxBytes) {
    return { ok: false, reason: 'props_too_large' }
  }

  const event = {
    eventId,
    name,
    anonymousId,
    sessionId,
    pagePath,
    articleId: articleRaw || '',
    occurredAt,
    props
  }

  if (name === 'scroll_depth') {
    const depth = Number(props.depth)
    if (!SCROLL_BUCKETS.includes(depth)) return { ok: false, reason: 'depth' }
    event.depth = depth
  }

  if (name === 'search') {
    const query = String(props.query || '')
    // 长度限制 + 基础脱敏（邮箱/手机号/连续数字串）
    event.searchQuery = query
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]')
      .replace(/\+?\d[\d\s-]{6,}\d/g, '[number]')
      .trim()
      .slice(0, 32)
      .toLowerCase()
  }

  if (name === 'outbound_click' || name === 'share_click') {
    const host = String(props.target_host || '')
      .toLowerCase()
      .slice(0, 100)
    event.targetHost = /^[a-z0-9.-]+$/.test(host) ? host : ''
  }

  return { ok: true, event }
}

/** 单请求批量校验：最多 20 条 */
export function validateBatch(payload) {
  const rawList = Array.isArray(payload?.events)
    ? payload.events
    : payload && payload.event_name
      ? [payload]
      : []

  const accepted = []
  const rejected = []
  for (const item of rawList.slice(0, LIMITS.maxEventsPerRequest)) {
    const result = validateEvent(item)
    if (result.ok) accepted.push(result.event)
    else rejected.push(result.reason)
  }
  return { accepted, rejected, total: rawList.length }
}
