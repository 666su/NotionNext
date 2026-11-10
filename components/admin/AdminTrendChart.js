/**
 * 折线趋势图（零依赖手写 SVG）
 *
 * series: [{ key, name, color, points: [{ label, value }] }]
 * - 所有序列共用同一套 x 标签（取第一条的 label）
 * - 数值全为 0 时仍画基线，并给出"无数据"说明，不伪造曲线
 * - 无障碍：同时输出一张可读的表格（details 折叠）
 */

import { formatNumber, niceAxisMax } from './format'

const WIDTH = 720
const PADDING = { top: 12, right: 12, bottom: 26, left: 40 }

export default function AdminTrendChart({
  series = [],
  height = 200,
  emptyText = '该时间范围内没有数据',
  valueLabel = '数值'
}) {
  const allPoints = series.flatMap(item => item.points || [])
  const labels = series[0]?.points?.map(point => point.label) || []
  const max = niceAxisMax(Math.max(0, ...allPoints.map(point => Number(point.value) || 0)))
  const isEmpty = allPoints.every(point => !Number(point.value))

  const innerWidth = WIDTH - PADDING.left - PADDING.right
  const innerHeight = height - PADDING.top - PADDING.bottom
  const stepX = labels.length > 1 ? innerWidth / (labels.length - 1) : 0

  const xAt = index => PADDING.left + (labels.length > 1 ? stepX * index : innerWidth / 2)
  const yAt = value => PADDING.top + innerHeight - (Number(value || 0) / max) * innerHeight

  const labelEvery = Math.max(1, Math.ceil(labels.length / 7))
  const ticks = [0, 0.25, 0.5, 0.75, 1]

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className='w-full'
        role='img'
        aria-label={series.map(item => item.name).join(' / ') + ' 趋势'}>
        {ticks.map(ratio => {
          const value = Math.round(max * ratio)
          const y = yAt(value)
          return (
            <g key={ratio}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y}
                y2={y}
                className='stroke-gray-200 dark:stroke-gray-800'
                strokeWidth='1'
                strokeDasharray={ratio === 0 ? '0' : '3 3'}
              />
              <text
                x={PADDING.left - 6}
                y={y + 3}
                textAnchor='end'
                className='fill-gray-400 text-[10px] dark:fill-gray-500'>
                {formatNumber(value)}
              </text>
            </g>
          )
        })}

        {labels.map((label, index) =>
          index % labelEvery === 0 ? (
            <text
              key={`${label}-${index}`}
              x={xAt(index)}
              y={height - 8}
              textAnchor='middle'
              className='fill-gray-400 text-[10px] dark:fill-gray-500'>
              {label}
            </text>
          ) : null
        )}

        {series.map(item => {
          const points = item.points || []
          if (!points.length) return null
          const path = points
            .map((point, index) => `${index === 0 ? 'M' : 'L'} ${xAt(index)} ${yAt(point.value)}`)
            .join(' ')
          return (
            <g key={item.key || item.name}>
              <path d={path} fill='none' stroke={item.color} strokeWidth='2' strokeLinejoin='round' />
              {points.map((point, index) => (
                <circle
                  key={`${item.key || item.name}-${index}`}
                  cx={xAt(index)}
                  cy={yAt(point.value)}
                  r='2.5'
                  fill={item.color}>
                  <title>
                    {`${item.name} · ${point.label}：${formatNumber(point.value)}`}
                  </title>
                </circle>
              ))}
            </g>
          )
        })}
      </svg>

      <div className='mt-1 flex flex-wrap items-center gap-3 text-[11px] text-gray-500 dark:text-gray-400'>
        {series.map(item => (
          <span key={item.key || item.name} className='inline-flex items-center gap-1'>
            <span
              className='inline-block h-2 w-2 rounded-full'
              style={{ backgroundColor: item.color }}
            />
            {item.name}
          </span>
        ))}
        {isEmpty && <span className='text-gray-400 dark:text-gray-500'>· {emptyText}</span>}
      </div>

      {labels.length > 0 && (
        <details className='mt-2 text-[11px] text-gray-500 dark:text-gray-400'>
          <summary className='cursor-pointer select-none'>查看数据表</summary>
          <div className='mt-2 overflow-x-auto'>
            <table className='w-full text-left'>
              <thead>
                <tr className='text-gray-400 dark:text-gray-500'>
                  <th className='py-1 pr-3 font-normal'>时间</th>
                  {series.map(item => (
                    <th key={item.key || item.name} className='py-1 pr-3 font-normal'>
                      {item.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {labels.map((label, index) => (
                  <tr key={`row-${label}-${index}`} className='border-t border-gray-100 dark:border-gray-800'>
                    <td className='py-1 pr-3'>{label}</td>
                    {series.map(item => (
                      <td key={`cell-${item.key || item.name}-${index}`} className='py-1 pr-3 tabular-nums'>
                        {formatNumber(item.points?.[index]?.value)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <span className='sr-only'>纵轴为{valueLabel}</span>
    </div>
  )
}
