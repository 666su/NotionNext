/**
 * 后台数字格式化（纯函数，前后端都能 import）
 */

export function formatNumber(value) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toLocaleString('zh-CN')
}

export function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return `${num.toFixed(digits)}%`
}

/** shape: 0 → 1 → 无限 */
export function formatRatio(value, digits = 2) {
  if (value === null || value === undefined || value === '') return '—'
  const num = Number(value)
  if (!Number.isFinite(num)) return '—'
  return num.toFixed(digits)
}

/** '20261103' → '11-03' */
export function shortDay(dayKey) {
  const text = String(dayKey || '')
  if (text.length !== 8) return text || '—'
  return `${text.slice(4, 6)}-${text.slice(6, 8)}`
}

/** ISO → 本地时间（Asia/Shanghai 由运行环境决定，避免手写时区） */
export function formatDateTime(iso, fallback = '—') {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return fallback
  return date.toLocaleString('zh-CN', { hour12: false })
}

/** 相对时间：3 分钟前 / 2 小时前 / 3 天前 */
export function fromNow(iso, fallback = '—') {
  if (!iso) return fallback
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return fallback
  const diff = Date.now() - date.getTime()
  if (diff < 0) return '刚刚'
  const minute = 60 * 1000
  if (diff < minute) return '刚刚'
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`
  return `${Math.floor(diff / (24 * 60 * minute))} 天前`
}

/** 安全除法，分母为 0 时返回 null（UI 显示 —，不显示 0/0 的假比例） */
export function safeDivide(numerator, denominator) {
  const a = Number(numerator)
  const b = Number(denominator)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null
  return a / b
}

/**
 * 轴刻度上限：保证取整到 4 的倍数，使 0/¼/½/¾/1 五条网格线都是整数
 * （避免出现 0、1.25、2.5、3.75 这类难读的刻度）
 */
export function niceAxisMax(max) {
  const value = Number(max)
  if (!Number.isFinite(value) || value <= 0) return 4
  if (value <= 40) return Math.max(4, Math.ceil(value / 4) * 4)
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  return Math.ceil(value / (magnitude / 2)) * (magnitude / 2)
}
