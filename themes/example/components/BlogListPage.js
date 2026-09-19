import { siteConfig } from '@/lib/config'
import { useGlobal } from '@/lib/global'
import SmartLink from '@/components/SmartLink'
import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'
import CONFIG from '../config'
import { groupPostsBySeries } from '@/lib/utils/series'
import BlogItem from './BlogItem'
import { LayoutSwitcher, getSavedColumns } from '../../simple/components/LayoutSwitcher'
import { SeriesGroup } from './SeriesGroup'
import { MobileSeriesList } from './MobileSeriesList'
import { useSeriesColumns } from '..'

/**
 * 使用分页插件的博客列表
 * 新增文章系列展示功能：
 * - 桌面端：有 series 的文章按系列分组卡片网格展示，支持 1/2/3 列切换
 * - 移动端：显示为系列手风琴列表，点击展开查看该系列全部文章
 * - 无 series 的文章保持原有样式
 */
export const BlogListPage = props => {
  const { page = 1, posts, postCount } = props
  const { locale, NOTION_CONFIG } = useGlobal()
  const router = useRouter()
  const totalPage = Math.ceil(
    postCount / siteConfig('POSTS_PER_PAGE', null, NOTION_CONFIG)
  )
  const currentPage = +page

  const showPrev = currentPage > 1
  const showNext = page < totalPage
  const pagePrefix = router.asPath
    .split('?')[0]
    .replace(/\/page\/[1-9]\d*/, '')
    .replace(/\/$/, '')
    .replace('.html', '')

  const showPageCover = siteConfig('EXAMPLE_POST_LIST_COVER', null, CONFIG)

  // 从 Context 获取列数控制（由 LayoutBase 管理）
  const { setColumns: setSeriesColumns } = useSeriesColumns()

  // 本地列数状态（用于渲染），同时同步到 LayoutBase
  const [columns, setLocalColumns] = useState(2)

  useEffect(() => {
    const saved = getSavedColumns()
    setLocalColumns(saved)
    setSeriesColumns(saved)
  }, [])

  const handleColumnsChange = col => {
    setLocalColumns(col)
    setSeriesColumns(col)
  }

  // 分组
  const { grouped, ungrouped } = groupPostsBySeries(posts || [])
  const hasSeries = grouped.length > 0

  return (
    <div className={`w-full ${showPageCover ? 'md:pr-2' : 'md:pr-12'} mb-12`}>
      {/* 列数切换按钮（仅桌面端 + 有系列时显示） */}
      {hasSeries && (
        <div className='hidden md:block'>
          <LayoutSwitcher columns={columns} onChange={handleColumnsChange} />
        </div>
      )}

      {/* ===== 移动端：系列手风琴列表 ===== */}
      <div id='posts-wrapper-mobile' className='md:hidden'>
        {hasSeries ? (
          <MobileSeriesList posts={posts} />
        ) : (
          /* 无系列时移动端也用简洁列表 */
          <div className='space-y-2'>
            {(posts || []).map(post => (
              <SmartLink key={post.id} href={post?.href} passHref legacyBehavior>
                <a className='block p-4 rounded-lg border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 shadow-sm hover:shadow-md transition-shadow'>
                  <div className='text-sm text-gray-800 dark:text-gray-100 leading-snug line-clamp-2'>
                    {post?.title}
                  </div>
                  <div className='text-xs text-gray-400 mt-1.5'>
                    {post.date?.start_date || post.createdTime || ''}
                  </div>
                </a>
              </SmartLink>
            ))}
          </div>
        )}
      </div>

      {/* ===== 桌面端：系列卡片网格 + 无系列文章 ===== */}
      <div id='posts-wrapper' className='hidden md:block'>
        {grouped.map(group => (
          <SeriesGroup
            key={group.series}
            series={group.series}
            posts={group.posts}
            columns={columns}
          />
        ))}

        {ungrouped.map(post => (
          <BlogItem key={post.id} post={post} />
        ))}
      </div>

      {/* 分页 */}
      <div className='flex justify-between text-xs'>
        <SmartLink
          href={{
            pathname:
              currentPage - 1 === 1
                ? `${pagePrefix}/`
                : `${pagePrefix}/page/${currentPage - 1}`,
            query: router.query.s ? { s: router.query.s } : {}
          }}
          className={`${showPrev ? 'bg-black dark:bg-hexo-black-gray' : 'bg-gray pointer-events-none invisible'} text-white no-underline py-2 px-3 rounded`}>
          {locale.PAGINATION.PREV}
        </SmartLink>
        <SmartLink
          href={{
            pathname: `${pagePrefix}/page/${currentPage + 1}`,
            query: router.query.s ? { s: router.query.s } : {}
          }}
          className={`${showNext ? 'bg-black dark:bg-hexo-black-gray ' : 'bg-gray pointer-events-none invisible'} text-white no-underline py-2 px-3 rounded`}>
          {locale.PAGINATION.NEXT}
        </SmartLink>
      </div>
    </div>
  )
}
