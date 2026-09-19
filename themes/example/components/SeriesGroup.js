import LazyImage from '@/components/LazyImage'
import NotionIcon from '@/components/NotionIcon'
import SmartLink from '@/components/SmartLink'
import { siteConfig } from '@/lib/config'
import { getSeriesTheme } from '@/lib/utils/seriesTheme'
import CONFIG from '../config'

/**
 * 新增文章系列展示功能
 * Example 主题系列分组组件
 * 每个系列自动分配独特的图标和配色
 */
export const SeriesGroup = ({ series, posts, columns = 2 }) => {
  if (!posts || posts.length === 0) return null

  // 获取该系列的视觉主题（图标 + 配色）
  const theme = getSeriesTheme(series)

  return (
    <div className='series-group mb-12'>
      {/* 系列名称标题：独特图标 + 配色 */}
      <div className='series-group-header mb-6 pb-3 border-b-2 border-gray-200 dark:border-gray-700'>
        <h2 className='text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100 flex items-center gap-3'>
          <span className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${theme.bgColor} ${theme.textColor}`}>
            <i className={theme.icon}></i>
          </span>
          {series}
          <span className='text-sm font-normal text-gray-400 ml-2'>
            {posts.length} 篇
          </span>
        </h2>
      </div>

      {/* 文章卡片网格 */}
      <div
        className={`series-grid grid gap-6 ${
          columns === 1
            ? 'grid-cols-1'
            : columns === 3
              ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
              : 'grid-cols-1 sm:grid-cols-2'
        }`}>
        {posts.map(post => (
          <SeriesCard key={post.id} post={post} size={columns} theme={theme} />
        ))}
      </div>
    </div>
  )
}

/**
 * Example 主题系列内文章卡片
 * 编号徽章使用系列专属配色和图标
 */
const SeriesCard = ({ post, size, theme }) => {
  const showCover =
    size === 1 &&
    siteConfig('EXAMPLE_POST_LIST_COVER', null, CONFIG) &&
    post?.pageCoverThumbnail

  // 根据列数自适应摘要行数
  const summaryClamp = size === 1 ? 'line-clamp-none' : size === 2 ? 'line-clamp-4' : 'line-clamp-3'
  const titleSize = size === 1 ? 'text-lg' : size === 2 ? 'text-base' : 'text-sm'
  const cardPadding = size === 3 ? 'p-3' : 'p-4'

  const hasNumber = post.number != null && String(post.number).trim() !== ''

  return (
    <div className='series-card bg-white dark:bg-gray-900 rounded-lg border border-gray-100 dark:border-gray-800 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden h-full flex flex-col'>
      {/* 封面图（仅一列大卡片显示） */}
      {showCover && (
        <div className='overflow-hidden h-44'>
          <SmartLink href={post?.href} passHref legacyBehavior>
            <LazyImage
              src={post?.pageCoverThumbnail}
              className='w-full h-full object-cover hover:scale-105 transition-transform duration-300'
            />
          </SmartLink>
        </div>
      )}

      <div className={`${cardPadding} flex flex-col flex-1`}>
        {/* 序号徽章 + 标题 */}
        <h3 className='mb-2 leading-snug'>
          <SmartLink
            href={post?.href}
            className={`text-black dark:text-gray-100 ${titleSize} font-semibold no-underline hover:underline`}>
            {hasNumber && (
              <span className={`series-badge inline-flex items-center justify-center h-[1.4em] min-w-[1.4em] mr-2 rounded-md ${theme.colorClasses} text-[0.75em] font-bold px-1 leading-none`}>
                <i className={`${theme.icon} mr-0.5 leading-none`}></i>
                <span>{post.number}</span>
              </span>
            )}
            {siteConfig('POST_TITLE_ICON') && <NotionIcon icon={post.pageIcon} />}
            {post?.title}
          </SmartLink>
        </h3>

        {/* 摘要 */}
        {post.summary && (
          <p className={`text-sm text-gray-500 dark:text-gray-400 ${summaryClamp} mb-3 flex-1`}>
            {post.summary}
          </p>
        )}

        {/* 底部信息 */}
        <div className='flex items-center justify-between text-xs text-gray-400 dark:text-gray-500 mt-auto pt-2 border-t border-gray-50 dark:border-gray-800'>
          <span>
            <i className='far fa-clock mr-1'></i>
            {post.date?.start_date || post.createdTime || ''}
          </span>
          <div className='flex items-center gap-3'>
            {/* 新增文章系列展示功能：显示文章标签 */}
            {post.tags && post.tags.length > 0 && (
              <div className='flex items-center gap-1 flex-wrap'>
                {post.tags.slice(0, 3).map((tag, i) => {
                  const tagName = typeof tag === 'string' ? tag : tag?.name || ''
                  if (!tagName) return null
                  return (
                    <SmartLink
                      key={i}
                      href={`/tag/${encodeURIComponent(tagName)}`}
                      className='hover:underline'>
                      <i className='fas fa-hashtag mr-0.5 text-[10px]'></i>
                      {tagName}
                    </SmartLink>
                  )
                })}
                {post.tags.length > 3 && (
                  <span className='text-gray-300 dark:text-gray-600'>+{post.tags.length - 3}</span>
                )}
              </div>
            )}
            {post.category && (
              <SmartLink
                href={`/category/${post.category}`}
                className='hover:underline'>
                <i className='far fa-folder mr-1'></i>
                {post.category}
              </SmartLink>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
