import { siteConfig } from '@/lib/config'
import SmartLink from '@/components/SmartLink'
import { MenuList } from './MenuList'
import { MobileDrawer } from './MobileDrawer'
import { SettingsDropdown } from './SettingsDropdown'
import Announcement from './Announcement'

/**
 * 页头导航栏
 * 桌面端：导航菜单 + 搜索框 + 设置按钮（字号/夜间模式/语言）
 * 移动端：汉堡菜单 + 搜索图标
 */
export const Header = props => {
  return (
    <>
      {/* 移动端抽屉侧边栏 */}
      <MobileDrawer posts={props.posts} notice={props.notice} />

      <header className='sticky top-0 z-50 w-full border-b bg-gray-100/90 backdrop-blur dark:bg-zinc-900/90' style={{ '--menu-btn-top': '0.375rem' }}>
        <div className='mx-auto flex h-14 md:h-16 max-w-6xl items-center px-3 md:px-6 gap-2 md:gap-0 pl-12 md:pl-6'>

          {/* 左侧：头像 + 名称 */}
          <div className='flex items-center gap-2 md:gap-3 shrink-0'>
            <img
              src='/images.jpg'
              className='w-7 h-7 md:w-9 md:h-9 rounded-full object-cover'
              alt='Jason'
            />

            <SmartLink
              href='/'
              className='text-base md:text-xl font-semibold whitespace-nowrap'
            >
              {siteConfig('TITLE')}
            </SmartLink>
          </div>

          {/* 导航 + 功能区（统一背景） */}
          <div
            className='
              ml-2 md:ml-8
              flex-1
              min-w-0
              flex
              items-center
              justify-between
              rounded-xl
              bg-gray-100
              dark:bg-zinc-900
              px-3 md:px-5
              py-1.5 md:py-2
            '
          >

            {/* 导航：桌面端显示，移动端隐藏 */}
            <div className='hidden md:block flex-1 min-w-0'>
              <MenuList {...props} />
            </div>

            {/* 移动端占位 */}
            <div className='md:hidden flex-1'></div>

            {/* 功能区 */}
            <div className='flex items-center gap-2 md:gap-3 shrink-0'>

              {/* 公告图标：点击跳转到公告文章页 */}
              <Announcement post={props.notice} />

              {/* 搜索：桌面端完整搜索框 */}
              <SmartLink
                href='/search'
                className='
                  hidden md:flex
                  items-center
                  justify-between
                  w-52
                  rounded-lg
                  border
                  border-gray-200
                  bg-white/70
                  dark:bg-zinc-800/80
                  dark:border-zinc-700
                  px-3
                  py-1.5
                  text-sm
                  text-gray-500
                  hover:border-gray-300
                  transition
                  flex-nowrap
                '
              >
                <div className='flex items-center gap-2 whitespace-nowrap'>
                  <i className='fas fa-search' />
                  <span>Search</span>
                </div>
                <kbd
                  className='
                    ml-4
                    shrink-0
                    rounded-md
                    bg-gray-50
                    dark:bg-zinc-700
                    px-2
                    py-0.5
                    text-xs
                    text-gray-400
                    border
                    border-gray-200
                    dark:border-zinc-600
                  '
                >
                  Ctrl K
                </kbd>
              </SmartLink>

              {/* 搜索：移动端仅图标 */}
              <SmartLink
                href='/search'
                className='md:hidden text-gray-500 dark:text-gray-400 hover:text-black dark:hover:text-white transition'
                aria-label='搜索'
              >
                <i className='fas fa-search'></i>
              </SmartLink>

              {/* 设置按钮：桌面端与移动端均显示（字号+夜间模式+语言） */}
              <SettingsDropdown />

            </div>

          </div>

        </div>
      </header>
    </>
  )
}
