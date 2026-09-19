import { useState, useEffect } from 'react'
import SmartLink from '@/components/SmartLink'
import { siteConfig } from '@/lib/config'
import { groupPostsBySeries } from '@/lib/utils/series'
import { getSeriesTheme } from '@/lib/utils/seriesTheme'

/**
 * 抽屉式侧边栏（从左侧滑出）
 * 包含：回到首页、系列全集（默认展开）、关于我
 */

export const MobileDrawer = ({ posts, notice }) => {
  const [isOpen, setIsOpen] = useState(false)
  const [expandedSeries, setExpandedSeries] = useState(null)
  const [seriesSectionOpen, setSeriesSectionOpen] = useState(true)

  const { grouped } = groupPostsBySeries(posts || [])

  // 抽屉打开时锁定背景滚动
  useEffect(() => {
    if (isOpen) {
      document.body.classList.add('drawer-open')
    } else {
      document.body.classList.remove('drawer-open')
    }
    return () => document.body.classList.remove('drawer-open')
  }, [isOpen])

  const closeDrawer = () => setIsOpen(false)
  const toggleSeries = (name) => setExpandedSeries(prev => (prev === name ? null : name))

  return (
    <>
      {/* 汉堡菜单按钮：桌面端+移动端都显示 */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className='mobile-menu-btn fixed left-2 z-[60] w-9 h-9 flex items-center justify-center rounded-lg bg-gray-100/90 dark:bg-zinc-800/90 backdrop-blur shadow-md border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors'
        style={{ top: 'var(--menu-btn-top, 0.5rem)' }}
        aria-label='打开菜单'>
        <i className={`fas ${isOpen ? 'fa-times' : 'fa-bars'} text-base`}></i>
      </button>

      {/* 遮罩层 */}
      <div
        className={`fixed inset-0 z-[65] bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={closeDrawer}>
      </div>

      {/* 抽屉面板 */}
      <div
        className={`fixed top-0 left-0 z-[70] h-full w-[280px] max-w-[85vw] bg-white dark:bg-gray-900 shadow-xl transform transition-transform duration-300 ease-in-out overflow-y-auto flex flex-col ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
        role='dialog'
        aria-modal='true'>

        {/* 抽屉头部 */}
        <div className='flex items-center justify-between p-4 border-b border-gray-100 dark:border-gray-800 shrink-0'>
          <div className='flex items-center gap-3 min-w-0'>
            <img src='/images.jpg' className='w-10 h-10 rounded-full object-cover shrink-0' alt='avatar' />
            <div className='min-w-0'>
              <div className='text-sm font-semibold text-gray-800 dark:text-gray-100 truncate'>
                {siteConfig('TITLE')}
              </div>
              <div className='text-xs text-gray-400 truncate'>
                {siteConfig('SUBTITLE', '')}
              </div>
            </div>
          </div>
          <button
            onClick={closeDrawer}
            className='w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors shrink-0'
            aria-label='关闭菜单'>
            <i className='fas fa-times'></i>
          </button>
        </div>

        {/* 抽屉内容 */}
        <nav className='flex-1 overflow-y-auto p-4 space-y-1'>

          {/* 1. 回到首页 */}
          <SmartLink href='/' passHref legacyBehavior>
            <a
              onClick={closeDrawer}
              className='flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'>
              <i className='fas fa-home w-5 text-center text-gray-400'></i>
              回到首页
            </a>
          </SmartLink>

          {/* 2. 系列全集 */}
          {grouped.length > 0 && (
            <div className='pt-2'>
              <button
                onClick={() => setSeriesSectionOpen(prev => !prev)}
                className='w-full flex items-center justify-between px-3 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wider hover:text-gray-600 dark:hover:text-gray-300 transition-colors'>
                <span>系列全集</span>
                <i className={`fas fa-chevron-down text-[10px] transition-transform duration-200 ${seriesSectionOpen ? '' : '-rotate-90'}`}></i>
              </button>

              {seriesSectionOpen && (
                <div className='space-y-1 mt-1'>
                  {grouped.map(group => {
                    const theme = getSeriesTheme(group.series)
                    const isExpanded = expandedSeries === group.series

                    return (
                      <div key={group.series}>
                        <button
                          onClick={() => toggleSeries(group.series)}
                          className='w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'>
                          <span className='flex items-center gap-2.5 min-w-0'>
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded ${theme.bgColor} ${theme.textColor} shrink-0`}>
                              <i className={`${theme.icon} text-[10px]`}></i>
                            </span>
                            <span className='truncate'>{group.series}</span>
                            <span className='text-xs text-gray-400 shrink-0'>{group.posts.length}</span>
                          </span>
                          <i className={`fas fa-chevron-down text-[10px] text-gray-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}></i>
                        </button>

                        {isExpanded && (
                          <div className='ml-4 pl-3 border-l-2 border-gray-100 dark:border-gray-800 space-y-0.5 py-1'>
                            {group.posts.map(post => (
                              <SmartLink
                                key={post.id}
                                href={post?.href}
                                passHref
                                legacyBehavior>
                                <a
                                  onClick={closeDrawer}
                                  className='block px-3 py-2 rounded-md text-[13px] text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100 transition-colors leading-snug line-clamp-2'>
                                  {post.number != null && String(post.number).trim() !== '' && (
                                    <span className={`inline-block w-5 text-right mr-1.5 font-mono text-[11px] ${theme.textColor.split(' ')[0]}`}>
                                      {post.number}
                                    </span>
                                  )}
                                  {post?.title}
                                </a>
                              </SmartLink>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {/* 3. 关于我 */}
          <div className='pt-2'>
            <SmartLink href='/about' passHref legacyBehavior>
              <a
                onClick={closeDrawer}
                className='flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'>
                <i className='fas fa-user w-5 text-center text-gray-400'></i>
                关于我
              </a>
            </SmartLink>
          </div>

        </nav>

        {/* 抽屉底部：版权 */}
        <div className='shrink-0 border-t border-gray-100 dark:border-gray-800 p-3'>
          <span className='text-[10px] text-gray-400 block text-center'>
            © {new Date().getFullYear()} {siteConfig('TITLE')}
          </span>
        </div>

      </div>
    </>
  )
}
