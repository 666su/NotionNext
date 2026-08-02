import { siteConfig } from '@/lib/config'
import SmartLink from '@/components/SmartLink'
import { MenuList } from './MenuList'

export const Header = props => {
  return (
    <header className='sticky top-0 z-50 w-full border-b bg-white dark:bg-black'>
      <div className='mx-auto flex h-16 max-w-6xl items-center justify-between px-6'>

        {/* 左侧 Logo */}
        <SmartLink
          href='/'
          className='text-2xl font-bold whitespace-nowrap'>
          {siteConfig('TITLE')}
        </SmartLink>

        {/* 中间菜单 */}
        <div className='flex-1 flex justify-center'>
          <MenuList {...props} />
        </div>

        {/* 右侧（以后放搜索、夜间模式） */}
        <div className='w-32 flex justify-end'>
        </div>

      </div>
    </header>
  )
}
