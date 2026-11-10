/**
 * 指标卡片组
 *
 * items: [{ key, label, value, hint, suffix, tone, display }]
 * value 为 null/undefined 时显示 "—"（表示"未采集/不可用"），0 会显示 0。
 * 状态类指标（正常/异常）用 display 直接给文本，避免出现难以理解的 1 / 0。
 */

import { formatNumber } from './format'

const TONES = {
  default: 'text-gray-900 dark:text-gray-100',
  muted: 'text-gray-400 dark:text-gray-500',
  accent: 'text-blue-700 dark:text-blue-300',
  warn: 'text-amber-700 dark:text-amber-300'
}

export default function AdminStatCards({ items = [], columns = 4 }) {
  const gridClass =
    columns === 3
      ? 'sm:grid-cols-2 lg:grid-cols-3'
      : columns === 2
        ? 'sm:grid-cols-2'
        : 'sm:grid-cols-2 lg:grid-cols-4'

  return (
    <section className={`grid gap-3 ${gridClass}`}>
      {items.map(item => {
        const isMissing = item.value === null || item.value === undefined
        return (
          <div
            key={item.key}
            className='rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0f1115]'>
            <p className='text-xs text-gray-500 dark:text-gray-400'>{item.label}</p>
            <p
              className={`mt-2 text-2xl font-semibold tabular-nums ${TONES[item.tone] || TONES.default}`}>
              {item.display !== undefined
                ? item.display
                : isMissing
                  ? '—'
                  : formatNumber(item.value)}
              {!isMissing && item.suffix ? (
                <span className='ml-1 text-xs font-normal text-gray-400'>{item.suffix}</span>
              ) : null}
            </p>
            {item.hint && (
              <p className='mt-1 text-[11px] leading-tight text-gray-400 dark:text-gray-500'>
                {item.hint}
              </p>
            )}
          </div>
        )
      })}
    </section>
  )
}
