import SmartLink from '@/components/SmartLink'
import { groupPostsBySeries } from '@/lib/utils/series'
import { getSeriesTheme } from '@/lib/utils/seriesTheme'

/**
 * 新增文章系列展示功能
 * 侧边栏系列时间线：按每个系列首篇文章的日期排序，显示系列名称
 * 每个系列使用独特的图标和配色
 */
export const SeriesTimeline = ({ posts }) => {
  if (!posts || posts.length === 0) return null

  const { grouped } = groupPostsBySeries(posts)
  if (grouped.length === 0) return null

  // 按系列内最早发布时间排序（从旧到新）
  const sortedGroups = [...grouped].sort((a, b) => {
    const earliestA = Math.min(...a.posts.map(p => p.publishDate ?? 0))
    const earliestB = Math.min(...b.posts.map(p => p.publishDate ?? 0))
    return earliestA - earliestB
  })

  return (
    <aside className='w-full rounded shadow overflow-hidden mb-6'>
      <h3 className='text-sm bg-gray-100 text-gray-700 dark:bg-hexo-black-gray dark:text-gray-200 py-3 px-4 dark:border-hexo-black-gray border-b'>
        <i className='fas fa-layer-group mr-2'></i>
        系列时间线
      </h3>

      <div className='p-4'>
        <div className='relative pl-4'>
          {/* 垂直时间线 */}
          <div className='absolute left-[7px] top-2 bottom-2 w-px bg-gray-200 dark:bg-gray-700'></div>

          <ul className='space-y-3'>
            {sortedGroups.map(group => {
              const earliestPost = group.posts.reduce((earliest, p) =>
                (p.publishDate ?? 0) < (earliest.publishDate ?? 0) ? p : earliest
              )
              const dateStr = earliestPost?.date?.start_date || earliestPost?.publishDay || ''
              const theme = getSeriesTheme(group.series)

              return (
                <li key={group.series} className='relative'>
                  {/* 时间线圆点：使用系列专属颜色 */}
                  <span className={`absolute -left-4 top-1.5 w-3 h-3 rounded-full border-2 border-white dark:border-gray-900 ${theme.bgColor.split(' ')[0]} ${theme.textColor.split(' ')[0]}`}></span>

                  <SmartLink
                    href={`/series/${encodeURIComponent(group.series)}`}
                    passHref
                    legacyBehavior>
                    <a className='block group'>
                      <div className='text-xs text-gray-400 dark:text-gray-500 mb-0.5 flex items-center gap-1.5'>
                        <i className={`${theme.icon} text-[10px] ${theme.textColor.split(' ')[0]}`}></i>
                        {dateStr}
                      </div>
                      <div className='text-sm text-gray-700 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 group-hover:underline transition-colors leading-snug'>
                        {group.series}
                      </div>
                      <div className='text-xs text-gray-400 dark:text-gray-500 mt-0.5'>
                        {group.posts.length} 篇
                      </div>
                    </a>
                  </SmartLink>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </aside>
  )
}
