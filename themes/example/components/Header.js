import { siteConfig } from '@/lib/config'
import DarkModeButton from '@/components/DarkModeButton'
import SmartLink from '@/components/SmartLink'
import { MenuList } from './MenuList'


export const Header = props => {
  return (
    <header className='sticky top-0 z-50 w-full border-b bg-white/80 backdrop-blur dark:bg-black/80'>

      <div className='mx-auto flex h-14 max-w-6xl items-center justify-between px-6'>


        {/* 左侧：头像 + 名称 */}
        <div className='flex items-center gap-3'>

          <img
            src='/images.jpg'
            className='w-9 h-9 rounded-full'
            alt='Jason'
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
        <div className='flex items-center gap-4'>


          {/* 语言 */}
          <SmartLink
            href='/'
            className='text-sm hover:text-blue-500'>
            English
          </SmartLink>



          {/* 夜间模式 */}
          <DarkModeButton />



          {/* 搜索 */}
          <SmartLink
            href='/search'
            className='hidden md:flex items-center gap-2 
            border rounded-md px-3 py-1.5
            text-sm text-gray-500
            hover:border-gray-400'>

            <i className='fas fa-search' />

            <span>
              Search
            </span>

            <kbd
              className='px-1.5 py-0.5 text-xs 
              border rounded bg-gray-100 
              dark:bg-gray-800'>
              Ctrl K
            </kbd>

          </SmartLink>



        </div>


      </div>

    </header>
  )
}
