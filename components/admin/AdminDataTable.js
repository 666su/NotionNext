/**
 * 通用数据表
 *
 * columns: [{ key, label, align, mono, width, format(value, row) }]
 * rows: 任意对象数组；空数组时只显示 emptyText
 * 值缺失（null/undefined）统一显示 "—"，与"0"区分开。
 */

import { formatNumber } from './format'

const ALIGN = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center'
}

export default function AdminDataTable({
  columns = [],
  rows = [],
  emptyText = '暂无数据',
  dense = false,
  maxRows,
  caption
}) {
  const visible = maxRows ? rows.slice(0, maxRows) : rows

  if (!visible.length) {
    return <p className='text-xs text-gray-400 dark:text-gray-500'>{emptyText}</p>
  }

  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-full text-left text-xs'>
        {caption && <caption className='sr-only'>{caption}</caption>}
        <thead>
          <tr className='text-gray-400 dark:text-gray-500'>
            {columns.map(column => (
              <th
                key={column.key}
                scope='col'
                style={column.width ? { width: column.width } : undefined}
                className={`whitespace-nowrap border-b border-gray-100 pb-1.5 pr-3 font-normal dark:border-gray-800 ${
                  ALIGN[column.align] || ALIGN.left
                }`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((row, index) => (
            <tr
              key={row.id || row.key || index}
              className='border-b border-gray-50 last:border-0 dark:border-gray-800/60'>
              {columns.map(column => {
                const raw = row[column.key]
                const text =
                  column.format
                    ? column.format(raw, row)
                    : raw === null || raw === undefined || raw === ''
                      ? '—'
                      : typeof raw === 'number'
                        ? formatNumber(raw)
                        : raw
                return (
                  <td
                    key={column.key}
                    className={`${dense ? 'py-1' : 'py-1.5'} pr-3 ${
                      ALIGN[column.align] || ALIGN.left
                    } ${column.mono ? 'font-mono text-[11px]' : ''} ${
                      column.align === 'right' ? 'tabular-nums' : ''
                    } text-gray-700 dark:text-gray-300`}>
                    {text}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {maxRows && rows.length > maxRows && (
        <p className='mt-2 text-[11px] text-gray-400 dark:text-gray-500'>
          仅显示前 {maxRows} 条，共 {rows.length} 条。
        </p>
      )}
    </div>
  )
}
