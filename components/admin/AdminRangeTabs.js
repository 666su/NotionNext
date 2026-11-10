/**
 * 时间范围切换（今日 / 昨日 / 近 7 / 30 / 90 天）
 *
 * 与 URL query 同步（shallow），便于把某个时间窗直接分享给自己或别人。
 */

const DEFAULT_RANGES = [
  { key: 'today', label: '今日' },
  { key: 'yesterday', label: '昨日' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' },
  { key: '90d', label: '近 90 天' }
]

export default function AdminRangeTabs({ value, onChange, ranges = DEFAULT_RANGES, disabled }) {
  return (
    <div
      className='inline-flex flex-wrap items-center gap-1 rounded-md border border-gray-200 p-1 dark:border-gray-800'
      role='tablist'
      aria-label='统计时间范围'>
      {ranges.map(range => {
        const active = range.key === value
        return (
          <button
            key={range.key}
            type='button'
            role='tab'
            aria-selected={active}
            disabled={disabled}
            onClick={() => onChange?.(range.key)}
            className={`rounded px-2.5 py-1 text-xs transition-colors disabled:opacity-50 ${
              active
                ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
            }`}>
            {range.label}
          </button>
        )
      })}
    </div>
  )
}
