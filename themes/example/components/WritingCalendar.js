import { useMemo, useState } from 'react'

/**
 * 新增文章系列展示功能
 * 写作日历：默认显示最近一个月，可切换月份/年份
 * GitHub 风格小格子热力图，不显示日期数字
 */
export const WritingCalendar = ({ posts }) => {
  const now = new Date()
  const [viewYear, setViewYear] = useState(now.getFullYear())
  const [viewMonth, setViewMonth] = useState(now.getMonth()) // 0-based

  const yearOptions = useMemo(() => {
    const years = []
    for (let y = now.getFullYear(); y >= now.getFullYear() - 1; y--) {
      years.push(y)
    }
    return years
  }, [])

  const monthNames = ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']

  const { daysInMonth, firstDayOfWeek, dateCountMap, totalThisMonth } = useMemo(() => {
    if (!posts || posts.length === 0) return { daysInMonth: 0, firstDayOfWeek: 0, dateCountMap: {}, totalThisMonth: 0 }

    const countMap = {}
    for (const post of posts) {
      const dateStr = post?.date?.start_date
      if (dateStr && typeof dateStr === 'string') {
        countMap[dateStr] = (countMap[dateStr] || 0) + 1
      }
    }

    const dim = new Date(viewYear, viewMonth + 1, 0).getDate()
    const fdow = new Date(viewYear, viewMonth, 1).getDay()

    let total = 0
    for (let d = 1; d <= dim; d++) {
      const key = formatDateKey(new Date(viewYear, viewMonth, d))
      if (countMap[key]) total += countMap[key]
    }

    return { daysInMonth: dim, firstDayOfWeek: fdow, dateCountMap: countMap, totalThisMonth: total }
  }, [posts, viewYear, viewMonth])

  if (!posts || posts.length === 0) return null

  const getCellClass = (day) => {
    const date = new Date(viewYear, viewMonth, day)
    if (date > now) return 'cal-cell-future'
    const key = formatDateKey(date)
    const count = dateCountMap[key] || 0
    if (count === 0) return 'cal-cell-empty'
    if (count === 1) return 'cal-cell-1'
    if (count === 2) return 'cal-cell-2'
    return 'cal-cell-3'
  }

  const prevMonth = () => {
    if (viewMonth === 0) {
      setViewMonth(11)
      setViewYear(y => y - 1)
    } else {
      setViewMonth(m => m - 1)
    }
  }

  const nextMonth = () => {
    if (viewMonth === 11) {
      setViewMonth(0)
      setViewYear(y => y + 1)
    } else {
      setViewMonth(m => m + 1)
    }
  }

  const isCurrentMonth = viewYear === now.getFullYear() && viewMonth === now.getMonth()
  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1)
  const leadingBlanks = firstDayOfWeek

  return (
    <aside className='w-full rounded shadow overflow-hidden mb-6'>
      <h3 className='text-sm bg-gray-100 text-gray-700 dark:bg-hexo-black-gray dark:text-gray-200 py-3 px-4 dark:border-hexo-black-gray border-b flex items-center justify-between'>
        <span><i className='fas fa-calendar-alt mr-2'></i>写作日历</span>
        <span className='text-xs font-normal text-gray-400'>{totalThisMonth} 篇</span>
      </h3>

      <div className='p-3'>
        {/* 月份导航 */}
        <div className='flex items-center justify-between mb-3'>
          <button
            onClick={prevMonth}
            className='cal-nav-btn w-7 h-7 flex items-center justify-center rounded hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400 transition-colors'
            aria-label='上个月'>
            <i className='fas fa-chevron-left text-xs'></i>
          </button>

          <div className='flex items-center gap-1'>
            <select
              value={viewYear}
              onChange={e => setViewYear(parseInt(e.target.value))}
              className='cal-select text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer'>
              {yearOptions.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
            <select
              value={viewMonth}
              onChange={e => setViewMonth(parseInt(e.target.value))}
              className='cal-select text-xs bg-transparent border border-gray-200 dark:border-gray-700 rounded px-1 py-0.5 text-gray-600 dark:text-gray-300 cursor-pointer'>
              {monthNames.map((name, i) => (
                <option key={i} value={i}>{name}</option>
              ))}
            </select>
          </div>

          <button
            onClick={nextMonth}
            disabled={isCurrentMonth}
            className={`cal-nav-btn w-7 h-7 flex items-center justify-center rounded transition-colors ${
              isCurrentMonth
                ? 'text-gray-300 dark:text-gray-600 cursor-not-allowed'
                : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400'
            }`}
            aria-label='下个月'>
            <i className='fas fa-chevron-right text-xs'></i>
          </button>
        </div>

        {/* 星期头 */}
        <div className='grid grid-cols-7 gap-[3px] mb-1'>
          {['日', '一', '二', '三', '四', '五', '六'].map(d => (
            <div key={d} className='text-center text-[10px] text-gray-400 dark:text-gray-500 h-4 leading-4'>
              {d}
            </div>
          ))}
        </div>

        {/* 小格子网格（无日期数字） */}
        <div className='grid grid-cols-7 gap-[3px]'>
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`b-${i}`} className='aspect-square'></div>
          ))}
          {days.map(day => {
            const date = new Date(viewYear, viewMonth, day)
            const title = `${viewYear}-${String(viewMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
            const count = date > now ? 0 : (dateCountMap[formatDateKey(date)] || 0)
            return (
              <div
                key={day}
                title={`${title}${count > 0 ? ` · ${count} 篇` : ''}`}
                className={`aspect-square rounded-[2px] ${getCellClass(day)}`}
              ></div>
            )
          })}
        </div>

        {/* 图例 */}
        <div className='flex items-center justify-end gap-1 mt-3 text-[10px] text-gray-400'>
          <span>少</span>
          <div className='w-3 h-3 rounded-[2px] cal-cell-empty'></div>
          <div className='w-3 h-3 rounded-[2px] cal-cell-1'></div>
          <div className='w-3 h-3 rounded-[2px] cal-cell-2'></div>
          <div className='w-3 h-3 rounded-[2px] cal-cell-3'></div>
          <span>多</span>
        </div>
      </div>
    </aside>
  )
}

function formatDateKey(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
