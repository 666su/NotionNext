/**
 * Blog Pet 通用工具：坐标边界、随机、存储、环境判断
 */

export const isBrowser = typeof window !== 'undefined'

/** 限制在 [min, max] 区间内 */
export function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** 当前视口尺寸，SSR 下返回安全默认值 */
export function getViewport() {
  if (!isBrowser) return { width: 1280, height: 800 }
  return {
    width: window.innerWidth || 1280,
    height: window.innerHeight || 800
  }
}

/** 按视口宽度返回桌宠显示尺寸 */
export function getPetSize(viewportWidth, size) {
  return viewportWidth < 768 ? size.mobile : size.desktop
}

/**
 * 把坐标限制在视口内，保证桌宠完整可见
 * @param {{x:number,y:number}} pos 目标坐标（左上角）
 * @param {number} petSize 桌宠边长
 * @param {{width:number,height:number}} viewport
 * @param {number} edge 与视口边缘的最小间距
 */
export function clampPosition(pos, petSize, viewport, edge = 8) {
  const maxX = Math.max(edge, viewport.width - petSize - edge)
  const maxY = Math.max(edge, viewport.height - petSize - edge)
  return {
    x: clamp(Number(pos?.x), edge, maxX),
    y: clamp(Number(pos?.y), edge, maxY)
  }
}

/** 默认位置：右下角 */
export function defaultPosition(petSize, viewport, offset, edge = 8) {
  return clampPosition(
    {
      x: viewport.width - petSize - offset.right,
      y: viewport.height - petSize - offset.bottom
    },
    petSize,
    viewport,
    edge
  )
}

/** 安全读取 localStorage 中的 JSON */
export function readStorage(key) {
  if (!isBrowser) return null
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

/** 安全写入 localStorage */
export function writeStorage(key, value) {
  if (!isBrowser) return
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // 隐私模式或配额不足时静默失败，不影响主流程
  }
}

/** 区间随机整数 */
export function randomInt(min, max) {
  const lo = Math.min(min, max)
  const hi = Math.max(min, max)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}

/** 从数组中随机取一项，尽量避开排除项 */
export function pickRandom(list, exclude = []) {
  if (!Array.isArray(list) || list.length === 0) return null
  const fresh = list.filter(item => !exclude.includes(item))
  const pool = fresh.length > 0 ? fresh : list
  return pool[Math.floor(Math.random() * pool.length)]
}

/** 是否偏好减少动效 */
export function prefersReducedMotion() {
  if (!isBrowser || typeof window.matchMedia !== 'function') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** 去掉富文本/HTML 痕迹，得到纯文本 */
export function toPlainText(text) {
  if (text === null || text === undefined) return ''
  return String(text)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 截断文本 */
export function truncate(text, max) {
  const value = toPlainText(text)
  if (value.length <= max) return value
  return value.slice(0, max) + '…'
}

/** 格式化文章日期（兼容 2026-9-6 与 ISO 字符串） */
export function formatDate(input) {
  const value = toPlainText(input)
  if (!value) return ''
  const match = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (match) return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
  return value
}
