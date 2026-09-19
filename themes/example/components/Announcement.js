import { useState, useEffect } from 'react'
import { useGlobal } from '@/lib/global'
import dynamic from 'next/dynamic'

const NotionPage = dynamic(() => import('@/components/NotionPage'))

/**
 * 公告模块 - 顶部横幅样式
 * 新增：可叉掉，宽度随内容和列数自适应
 */
const Announcement = ({ post, columns = 1 }) => {
  const [visible, setVisible] = useState(false)

  // 用公告内容的 hash 作为 key，更新内容后重新显示
  const noticeKey = post ? (post.title || '').slice(0, 20) + '_' + (post.lastEditedDate || '') : ''

  useEffect(() => {
    if (!post || Object.keys(post).length === 0) return
    try {
      const dismissed = localStorage.getItem('dismissed_notice')
      if (dismissed !== noticeKey) {
        setVisible(true)
      }
    } catch (e) {
      setVisible(true)
    }
  }, [noticeKey])

  if (!post || Object.keys(post).length === 0 || !visible) {
    return <></>
  }

  const dismiss = () => {
    setVisible(false)
    try {
      localStorage.setItem('dismissed_notice', noticeKey)
    } catch (e) {}
  }

  // 开发模式：点击公告可重置（方便测试）
  const handleBannerClick = () => {
    if (process.env.NODE_ENV === 'development') {
      try {
        localStorage.removeItem('dismissed_notice')
        setVisible(true)
      } catch (e) {}
    }
  }

  // 根据列数决定最大宽度（与内容区一致）
  const maxW = columns === 3 ? 'max-w-none' : columns === 2 ? 'max-w-5xl' : 'max-w-4xl'

  return (
    <div className='w-full mb-4 px-4'>
      <div className={`mx-auto ${maxW} transition-all duration-300`}>
        <div className='relative inline-block rounded-lg border border-blue-100 dark:border-blue-900 bg-blue-50 dark:bg-blue-950/30 px-4 py-3 shadow-sm align-top cursor-pointer' onClick={handleBannerClick}>
          {/* 叉掉按钮 */}
          <button
            onClick={dismiss}
            className='absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors'
            aria-label='关闭公告'>
            <i className='fas fa-times text-xs'></i>
          </button>

          <div className='flex items-start gap-3 pr-8'>
            <i className='fas fa-bullhorn text-blue-500 dark:text-blue-400 mt-1 text-sm shrink-0'></i>
            <div className='min-w-0 announcement-banner-content'>
              <NotionPage post={post} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
export default Announcement
