import SmartLink from '@/components/SmartLink'

/**
 * 公告 - 导航栏图标按钮
 * 点击跳转到 Notion 中 type=Notice 的公告文章页面
 */
const Announcement = ({ post }) => {
  if (!post || Object.keys(post).length === 0) {
    return null
  }

  // 新增文章系列展示功能：公告跳转链接（slug 无效时隐藏图标）
  const href = post?.href
  const isValidHref = href && href !== '#' && !href.endsWith('/#') && !href.startsWith('http')

  if (!isValidHref) return null

  return (
    <SmartLink
      href={href}
      passHref
      legacyBehavior>
      <a
        className='flex items-center justify-center w-9 h-9 rounded-lg text-blue-500 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors'
        title='公告'
        aria-label='公告'>
        <i className='fas fa-bullhorn text-sm'></i>
      </a>
    </SmartLink>
  )
}
export default Announcement
