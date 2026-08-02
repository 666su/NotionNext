import { siteConfig } from '@/lib/config'
import DarkModeButton from '@/components/DarkModeButton'
import SmartLink from '@/components/SmartLink'
import { MenuList } from './MenuList'

export const Header = props => {
  return (
    <header className='sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur dark:bg-black/80'>
      <div className='mx-auto flex h-16 max-w-6xl items-center px-6'>

        {/* 左侧：头像 + 名称 */}
        <div className='flex items-center gap-3 shrink-0'>
          <img
            src='/images.jpg'
            className='w-9 h-9 rounded-full object-cover'
            alt='Jason'
          />

          <SmartLink
            href='/'
            className='text-xl font-semibold whitespace-nowrap'
          >
            {siteConfig('TITLE')}
          </SmartLink>
        </div>

        {/* 导航 + 功能区（统一背景） */}
        <div
          className='
            ml-8
            flex-1
            flex
            items-center
            justify-between
            rounded-xl
            bg-gray-100
            dark:bg-zinc-900
            px-5
            py-2
          '
        >

          {/* 导航 */}
          <MenuList {...props} />

          {/* 功能区 */}
          <div className='flex items-center gap-5'>

            {/* 语言 */}
            <SmartLink
              href='/'
              className='text-sm text-gray-600 hover:text-black dark:text-gray-300 dark:hover:text-white transition'
            >
              EN
            </SmartLink>

            {/* 夜间模式 */}
            <DarkModeButton />

            {/* 搜索 */}
            <SmartLink
              href='/search'
              className='
                hidden md:flex
                items-center
                justify-between
                w-56
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

          </div>

        </div>

      </div>
    </header>
  )
}
