/**
 * 柱状图（零依赖手写 SVG）
 *
 * points: [{ label, value }]
 * 适合 24 小时这种离散分桶；连续时间趋势请用 AdminTrendChart。
 */

import { formatNumber, niceAxisMax } from './format'

const WIDTH = 720
const PADDING = { top: 12, right: 8, bottom: 26, left: 40 }

export default function AdminBarChart({
  points = [],
  height = 180,
  color = '#3b82f6',
  emptyText = '暂无数据',
  unit = ''
}) {
  const values = points.map(point => Number(point.value) || 0)
  const max = niceAxisMax(Math.max(0, ...values))
  const innerWidth = WIDTH - PADDING.left - PADDING.right
  const innerHeight = height - PADDING.top - PADDING.bottom
  const slot = points.length ? innerWidth / points.length : innerWidth
  const barWidth = Math.max(2, slot * 0.62)
  const isEmpty = values.every(value => value === 0)
  const labelEvery = Math.max(1, Math.ceil(points.length / 12))

  return (
    <div>
      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className='w-full'
        role='img'
        aria-label='柱状分布图'>
        <line
          x1={PADDING.left}
          x2={WIDTH - PADDING.right}
          y1={PADDING.top + innerHeight}
          y2={PADDING.top + innerHeight}
          className='stroke-gray-200 dark:stroke-gray-800'
        />
        {[0, 0.5, 1].map(ratio => {
          const y = PADDING.top + innerHeight - innerHeight * ratio
          return (
            <text
              key={ratio}
              x={PADDING.left - 6}
              y={y + 3}
              textAnchor='end'
              className='fill-gray-400 text-[10px] dark:fill-gray-500'>
              {formatNumber(max * ratio)}
            </text>
          )
        })}

        {points.map((point, index) => {
          const value = Number(point.value) || 0
          const barHeight = (value / max) * innerHeight
          const x = PADDING.left + slot * index + (slot - barWidth) / 2
          const y = PADDING.top + innerHeight - barHeight
          return (
            <g key={`${point.label}-${index}`}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(value > 0 ? 2 : 0, barHeight)}
                rx='1.5'
                fill={color}>
                <title>{`${point.label}：${formatNumber(value)}${unit}`}</title>
              </rect>
              {index % labelEvery === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={height - 8}
                  textAnchor='middle'
                  className='fill-gray-400 text-[10px] dark:fill-gray-500'>
                  {point.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {isEmpty && <p className='mt-1 text-[11px] text-gray-400 dark:text-gray-500'>· {emptyText}</p>}
    </div>
  )
}
