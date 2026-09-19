/**
 * 新增文章系列展示功能
 * 根据系列名称自动生成独特的图标和配色方案
 * 同一系列名始终得到相同的图标和颜色（基于字符串哈希）
 */

// 可用的系列图标池（FontAwesome 5 类图标）
const SERIES_ICONS = [
  'fas fa-rocket',
  'fas fa-network-wired',
  'fas fa-toolbox',
  'fas fa-brain',
  'fas fa-cloud',
  'fas fa-shield-alt',
  'fas fa-code',
  'fas fa-database',
  'fas fa-paint-brush',
  'fas fa-bolt',
  'fas fa-globe',
  'fas fa-cube',
  'fas fa-microchip',
  'fas fa-server',
  'fas fa-satellite',
  'fas fa-fingerprint'
]

// 配色方案：[背景色, 文字色, 深色背景, 深色文字]
const SERIES_COLORS = [
  // blue
  ['bg-blue-50', 'text-blue-600', 'dark:bg-blue-900/30', 'dark:text-blue-400'],
  // green
  ['bg-green-50', 'text-green-600', 'dark:bg-green-900/30', 'dark:text-green-400'],
  // purple
  ['bg-purple-50', 'text-purple-600', 'dark:bg-purple-900/30', 'dark:text-purple-400'],
  // orange
  ['bg-orange-50', 'text-orange-600', 'dark:bg-orange-900/30', 'dark:text-orange-400'],
  // pink
  ['bg-pink-50', 'text-pink-600', 'dark:bg-pink-900/30', 'dark:text-pink-400'],
  // teal
  ['bg-teal-50', 'text-teal-600', 'dark:bg-teal-900/30', 'dark:text-teal-400'],
  // indigo
  ['bg-indigo-50', 'text-indigo-600', 'dark:bg-indigo-900/30', 'dark:text-indigo-400'],
  // red
  ['bg-red-50', 'text-red-600', 'dark:bg-red-900/30', 'dark:text-red-400'],
  // cyan
  ['bg-cyan-50', 'text-cyan-600', 'dark:bg-cyan-900/30', 'dark:text-cyan-400'],
  // amber
  ['bg-amber-50', 'text-amber-600', 'dark:bg-amber-900/30', 'dark:text-amber-400']
]

/**
 * 简单字符串哈希（djb2 变体），确保同一名总得到相同结果
 */
function hashString(str) {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0xffffffff
  }
  return Math.abs(hash)
}

/**
 * 获取系列的视觉主题（图标 + 配色）
 * @param {string} seriesName - 系列名称
 * @returns {{ icon: string, colorClasses: string, bgColor: string, textColor: string }}
 */
export function getSeriesTheme(seriesName) {
  if (!seriesName || typeof seriesName !== 'string') {
    return {
      icon: 'fas fa-layer-group',
      colorClasses: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
      bgColor: 'bg-gray-100 dark:bg-gray-800',
      textColor: 'text-gray-600 dark:text-gray-300'
    }
  }

  const hash = hashString(seriesName.trim())
  const icon = SERIES_ICONS[hash % SERIES_ICONS.length]
  const colors = SERIES_COLORS[(hash >> 4) % SERIES_COLORS.length]

  return {
    icon,
    colorClasses: `${colors[0]} ${colors[1]} ${colors[2]} ${colors[3]}`,
    bgColor: `${colors[0]} ${colors[2]}`,
    textColor: `${colors[1]} ${colors[3]}`
  }
}
