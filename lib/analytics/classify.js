/**
 * 维度归类：设备 / 浏览器 / 系统 / 来源 / 日期分桶
 *
 * 全部在服务端完成，客户端只负责上报 UA/Referer 原始信息。
 * 不做指纹、不保留原始 UA 字符串。
 */

import { SEARCH_HOSTS, SOCIAL_HOSTS } from './constants'

function match(ua, regex) {
  return regex.test(ua)
}

export function classifyDevice(uaRaw) {
  const ua = String(uaRaw || '')
  if (!ua) return 'unknown'
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua)) return 'tablet'
  if (/Mobile|Android|iPhone|iPod|Windows Phone/i.test(ua)) return 'mobile'
  return 'desktop'
}

export function classifyBrowser(uaRaw) {
  const ua = String(uaRaw || '')
  if (!ua) return 'unknown'
  if (match(ua, /Edg\//)) return 'edge'
  if (match(ua, /OPR\/|Opera/)) return 'opera'
  if (match(ua, /Chrome\/|CriOS\//)) return 'chrome'
  if (match(ua, /Firefox\/|FxiOS\//)) return 'firefox'
  if (match(ua, /Safari\//)) return 'safari'
  return 'other'
}

export function classifyOs(uaRaw) {
  const ua = String(uaRaw || '')
  if (!ua) return 'unknown'
  if (/Windows NT/i.test(ua)) return 'windows'
  if (/Android/i.test(ua)) return 'android'
  if (/iPhone|iPad|iPod/i.test(ua)) return 'ios'
  if (/Mac OS X/i.test(ua)) return 'macos'
  if (/Linux/i.test(ua)) return 'linux'
  return 'other'
}

/**
 * 来源分类。referrerHost 由客户端上报 document.referrer 的 host（可为空）。
 */
export function classifySource(referrerHost, selfHost) {
  const host = String(referrerHost || '').toLowerCase().trim()
  const self = String(selfHost || '').toLowerCase().trim()
  if (!host) return { channel: 'direct', host: '' }
  if (self && (host === self || host.endsWith(`.${self}`))) {
    return { channel: 'internal', host }
  }
  const hit = list =>
    list.some(
      item =>
        host === item ||
        host.endsWith(`.${item}`) ||
        host.startsWith(`${item}.`) ||
        host.includes(`.${item}.`)
    )
  if (hit(SEARCH_HOSTS)) return { channel: 'search', host }
  if (hit(SOCIAL_HOSTS)) return { channel: 'social', host }
  return { channel: 'referral', host: host.slice(0, 100) }
}

const DATE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
})

const MINUTE_FMT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false
})

/** 统计基准时区固定为 Asia/Shanghai（与站点 locale 一致） */
export function dateKey(ms) {
  return DATE_FMT.format(new Date(ms || Date.now())).replace(/-/g, '')
}

/** 分钟桶：YYYYMMDDHHmm */
export function minuteKey(ms) {
  const parts = MINUTE_FMT.formatToParts(new Date(ms || Date.now()))
  const pick = type => (parts.find(p => p.type === type) || {}).value || '00'
  return `${pick('year')}${pick('month')}${pick('day')}${pick('hour')}${pick('minute')}`
}

/** 生成最近 N 天的 dateKey 列表（含今天，倒序） */
export function recentDateKeys(days) {
  const list = []
  const now = Date.now()
  for (let i = 0; i < days; i += 1) {
    list.push(dateKey(now - i * 86400000))
  }
  return list
}

/** 站点自身 host（用于识别站内来源） */
export function selfHostFromHeaders(headers = {}) {
  const host = String(headers.host || '')
  return host.split(':')[0].toLowerCase()
}
