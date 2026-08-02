import { siteConfig } from '@/lib/config'
import SmartLink from '@/components/SmartLink'
import { MenuList } from './MenuList'
import DarkModeButton from '@/components/DarkModeButton'

export const Header = props => {
  return (
    <header className='sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur dark:bg-black/80'>
      <div className='mx-auto flex h-14 max-w-6xl items-center justify-between px-6'>

        {/* 左侧 Logo + 头像 */}
        <div className='flex items-center gap-3'>

          <img
            src='/images.jpg'
            className='w-8 h-8 rounded-full'
            alt='avatar'
          />

          <SmartLink
            href='/'
            className='text-xl font-semibold whitespace-nowrap'>
            {siteConfig('TITLE')}
          </SmartLink>

        </div>


        {/* 中间导航 */}
        <div className='flex-1 flex justify-center'>
          <MenuList {...props} />
        </div>


        {/* 右侧功能 */}
        <div className='flex items-center gap-3'>

          <DarkModeButton />

          <SmartLink
            href='/search'
            className='text-gray-600 hover:text-black dark:text-gray-300'>
            <i className='fas fa-search' />
          </SmartLink>

        </div>


      </div>
    </header>
  )
}
