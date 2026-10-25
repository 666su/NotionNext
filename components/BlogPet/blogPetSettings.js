/**
 * Blog Pet 设置：默认值、校验与本地持久化
 */
import { BUBBLE_FREQUENCIES, PET_STORAGE_KEY } from './blogPetConfig'
import { readStorage, writeStorage } from './blogPetUtils'

export const DEFAULT_SETTINGS = {
  visible: true, // 桌宠是否显示
  freeMove: false, // 是否允许拖动
  autoBubble: true, // 自动气泡
  bubbleFrequency: 'standard', // off | low | standard
  animation: true, // 待机动画
  position: null // 上次保存的坐标 { x, y }，null 表示默认右下角
}

/** 校验坐标，非法值一律回落为 null */
function normalizePosition(position) {
  if (!position || typeof position !== 'object') return null
  const x = Number(position.x)
  const y = Number(position.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  return { x, y }
}

/** 把任意输入收敛为合法设置，缺失/损坏时使用默认值 */
export function sanitizeSettings(raw) {
  const input = raw && typeof raw === 'object' ? raw : {}
  return {
    visible: input.visible !== false,
    freeMove: input.freeMove === true,
    autoBubble: input.autoBubble !== false,
    bubbleFrequency: BUBBLE_FREQUENCIES.includes(input.bubbleFrequency)
      ? input.bubbleFrequency
      : DEFAULT_SETTINGS.bubbleFrequency,
    animation: input.animation !== false,
    position: normalizePosition(input.position)
  }
}

export function loadSettings() {
  return sanitizeSettings(readStorage(PET_STORAGE_KEY))
}

export function saveSettings(settings) {
  const next = sanitizeSettings(settings)
  writeStorage(PET_STORAGE_KEY, next)
  return next
}
