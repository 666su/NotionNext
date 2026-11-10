/**
 * 横向条形排行（用于维度分布 / 页面排行 / 来源域名）
 *
 * rows: [{ label, value, note, href }]
 * - 相对最大值画条，不造假归一化
 * - 无数据时只显示 emptyText，不显示 0 条空骨架
 */

import Link from 'next/link'
import { formatNumber, formatPercent, safeDivide } from './format'

export default function AdminBarList({
  rows = [],
  emptyText = '暂无数据',
  total,
  unit = '',
  color = '#3b82f6',
  limit = 20
}) {
  const visible = rows.slice(0, limit)
  if (!visible.length) {
    return <p className='text-xs text-gray-400 dark:text-gray-500'>{emptyText}</p>
  }

  const denominator = Number.isFinite(Number(total))
    ? Number(total)
    : visible.reduce((acc, row) => acc + (Number(row.value) || 0), 0)
  const max = Math.max(1, ...visible.map(row => Number(row.value) || 0))

  return (
    <ul className='space-y-2'>
      {visible.map((row, index) => {
        const value = Number(row.value) || 0
        const width = Math.max(1, Math.round((value / max) * 100))
        const share = safeDivide(value, denominator)
        return (
          <li key={`${row.label}-${index}`}>
            <div className='flex items-baseline justify-between gap-3 text-xs'>
              <span
                className={`min-w-0 truncate ${
                  row.mono ? 'font-mono text-[11px]' : ''
                } text-gray-700 dark:text-gray-300`}
                title={row.label}>
                {row.href ? (
                  <Link href={row.href} className='hover:underline'>
                    {row.label}
                  </Link>
                ) : (
                  row.label
                )}
              </span>
              <span className='shrink-0 tabular-nums text-gray-500 dark:text-gray-400'>
                {formatNumber(value)}
                {unit}
                {share !== null && (
                  <span className='ml-1.5 text-gray-400 dark:text-gray-500'>
                    {formatPercent(share * 100, 0)}
                  </span>
                )}
              </span>
            </div>
            <div className='mt-1 h-1.5 w-full overflow-hidden rounded bg-gray-100 dark:bg-gray-800'>
              <div className='h-full rounded' style={{ width: `${width}%`, backgroundColor: color }} />
            </div>
            {row.note && (
              <p className='mt-0.5 text-[11px] text-gray-400 dark:text-gray-500'>{row.note}</p>
            )}
          </li>
        )
      })}
    </ul>
  )
}
