import { useCallback, useEffect, useState } from 'react'

const STORAGE_KEY = 'simple_home_columns'
const VALID_COLUMNS = [1, 2, 3]
const DEFAULT_COLUMNS = 2

/**
 * 新增文章系列展示功能
 * 首页布局列数切换按钮（1列 / 2列 / 3列）
 * - 使用 React state 控制，不刷新页面
 * - localStorage 保存用户选择
 * - 移动端自动降为单列（CSS 处理）
 */
export const LayoutSwitcher = ({ columns, onChange }) => {
  // 从 localStorage 读取初始值
  const [activeCol, setActiveCol] = useState(columns || DEFAULT_COLUMNS)

  useEffect(() => {
    if (columns && columns !== activeCol) {
      setActiveCol(columns)
    }
  }, [columns])

  const handleClick = useCallback(
    col => {
      if (!VALID_COLUMNS.includes(col)) return
      setActiveCol(col)
      try {
        localStorage.setItem(STORAGE_KEY, String(col))
      } catch (e) {
        // SSR 或隐私模式下忽略
      }
      onChange?.(col)
    },
    [onChange]
  )

  const buttons = [
    { value: 1, icon: 'fa-bars', label: '一列' },
    { value: 2, icon: 'fa-table-columns', label: '两列' },
    { value: 3, icon: 'fa-table-cells-large', label: '三列' }
  ]

  return (
    <div className='layout-switcher flex items-center gap-1 mb-6'>
      {buttons.map(btn => (
        <button
          key={btn.value}
          onClick={() => handleClick(btn.value)}
          title={btn.label}
          aria-label={`切换为${btn.label}布局`}
          className={`layout-switcher-btn w-8 h-8 flex items-center justify-center rounded text-sm transition-all duration-200 ${
            activeCol === btn.value
              ? 'bg-blue-500 text-white shadow-sm'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          }`}>
          <i className={`fas ${btn.icon}`}></i>
        </button>
      ))}
    </div>
  )
}

/**
 * 从 localStorage 读取保存的列数（用于服务端渲染时初始化）
 * @returns {number}
 */
export function getSavedColumns() {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS
  try {
    const val = parseInt(localStorage.getItem(STORAGE_KEY), 10)
    return VALID_COLUMNS.includes(val) ? val : DEFAULT_COLUMNS
  } catch {
    return DEFAULT_COLUMNS
  }
}
