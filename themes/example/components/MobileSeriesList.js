import { useState } from 'react'
import SmartLink from '@/components/SmartLink'
import NotionIcon from '@/components/NotionIcon'
import { siteConfig } from '@/lib/config'
import { groupPostsBySeries } from '@/lib/utils/series'
import { getSeriesTheme } from '@/lib/utils/seriesTheme'
import CONFIG from '../config'

/**
 * 新增文章系列展示功能 - 移动端适配
 * 移动端系列列表：显示系列名称，点击右侧按钮展开该系列全部文章
 * 无 series 的文章直接以简洁列表显示
 */
export const MobileSeriesList = ({ posts }) => {
  if (!posts || posts.length === 0) return null

  const { grouped, ungrouped } = groupPostsBySeries(posts || [])
  const [expandedSeries, setExpandedSeries] = useState(null)

  const toggleSeries = name => {
    setExpandedSeries(prev => (prev === name ? null : name))
  }

  return (
    <div className='mobile-series-list space-y-3'>
      {/* 有系列的文章：手风琴分组 */}
      {grouped.map(group => {
        const theme = getSeriesTheme(group.series)
        const isExpanded = expandedSeries === group.series

        return (
          <div
            key={group.series}
            className='rounded-lg border border-gray-100 dark:border-gray-800 overflow-hidden bg-white dark:bg-gray-900 shadow-sm'>
            {/* 系列头部：点击展开/收起 */}
            <button
              onClick={() => toggleSeries(group.series)}
              className='w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'>
              <div className='flex items-center gap-3 min-w-0'>
                <span className={`inline-flex items-center justify-center w-8 h-8 rounded-md shrink-0 ${theme.bgColor} ${theme.textColor}`}>
                  <i className={theme.icon}></i>
                </span>
                <div className='min-w-0'>
                  <div className='text-sm font-semibold text-gray-800 dark:text-gray-100 truncate'>
                    {group.series}
                  </div>
                  <div className='text-xs text-gray-400 mt-0.5'>
                    {group.posts.length} 篇文章
                  </div>
                </div>
              </div>

              {/* 展开/收起箭头 + 查看全部链接 */}
              <div className='flex items-center gap-2 shrink-0'>
                <SmartLink
                  href={`/series/${encodeURIComponent(group.series)}`}
                  passHref
                  legacyBehavior>
                  <a
                    onClick={e => e.stopPropagation()}
                    className='text-xs text-blue-500 dark:text-blue-400 hover:underline px-2 py-1'>
                    全部
                  </a>
                </SmartLink>
                <i
                  className={`fas fa-chevron-down text-gray-400 text-xs transition-transform duration-200 ${
                    isExpanded ? 'rotate-180' : ''
                  }`}></i>
              </div>
            </button>

            {/* 展开后的文章列表 */}
            {isExpanded && (
              <div className='border-t border-gray-100 dark:border-gray-800 divide-y divide-gray-50 dark:divide-gray-800/50'>
                {group.posts.map(post => (
                  <MobilePostItem key={post.id} post={post} theme={theme} />
                ))}
              </div>
            )}
          </div>
        )
      })}

      {/* 无系列的文章：直接列表 */}
      {ungrouped.length > 0 && (
        <div className='space-y-2 pt-2'>
          {ungrouped.map(post => (
            <MobileUngroupedItem key={post.id} post={post} />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 移动端系列内文章项（紧凑）
 */
const MobilePostItem = ({ post, theme }) => {
  const hasNumber = post.number != null && String(post.number).trim() !== ''

  return (
    <SmartLink href={post?.href} passHref legacyBehavior>
      <a className='block p-4 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors'>
        <div className='flex items-start gap-3'>
          {hasNumber && (
            <span className={`inline-flex items-center justify-center h-6 min-w-[1.5rem] rounded ${theme.colorClasses} text-[11px] font-bold shrink-0 mt-0.5 px-1`}>
              {post.number}
            </span>
          )}
          <div className='min-w-0 flex-1'>
            <div className='text-sm text-gray-800 dark:text-gray-100 leading-snug line-clamp-2'>
              {siteConfig('POST_TITLE_ICON') && <NotionIcon icon={post.pageIcon} />}
              {post?.title}
            </div>
            <div className='text-xs text-gray-400 mt-1 flex items-center gap-3'>
              <span>{post.date?.start_date || post.createdTime || ''}</span>
              {/* 新增文章系列展示功能：显示标签 */}
              {post.tags && post.tags.length > 0 && (
                <span className='flex items-center gap-1'>
                  {post.tags.slice(0, 2).map((tag, i) => {
                    const tagName = typeof tag === 'string' ? tag : tag?.name || ''
                    if (!tagName) return null
                    return (
                      <span key={i}>
                        <i className='fas fa-hashtag text-[9px] mr-0.5'></i>
                        {tagName}
                      </span>
                    )
                  })}
                </span>
              )}
            </div>
          </div>
        </div>
      </a>
    </SmartLink>
  )
}

/**
 * 移动端无系列文章项
 */
const MobileUngroupedItem = ({ post }) => {
  return (
    <SmartLink href={post?.href} passHref legacyBehavior>
      <a className='block p-4 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-shadow'>
        <div className='text-sm text-gray-800 dark:text-gray-100 leading-snug line-clamp-2'>
          {siteConfig('POST_TITLE_ICON') && <NotionIcon icon={post.pageIcon} />}
          {post?.title}
        </div>
        <div className='text-xs text-gray-400 mt-1.5 flex items-center gap-3'>
          <span><i className='far fa-clock mr-1'></i>{post.date?.start_date || post.createdTime || ''}</span>
          {post.category && (
            <span><i className='far fa-folder mr-1'></i>{post.category}</span>
          )}
        </div>
      </a>
    </SmartLink>
  )
}
