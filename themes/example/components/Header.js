import { siteConfig } from '@/lib/config'
import SmartLink from '@/components/SmartLink'
import { MenuList } from './MenuList'

export const Header = props => {
  return (
    <header
      className='sticky top-0 z-50 w-full 
      border-b bg-white/80 backdrop-blur 
      dark:bg-black/80'
    >

      <div 
        className='mx-auto flex h-14 max-w-6xl 
        items-center justify-between px-6'
      >

        {/* Logo */}
        <SmartLink
          href='/'
          className='text-xl font-semibold whitespace-nowrap'
        >
          {siteConfig('TITLE')}
        </SmartLink>


        {/* Menu */}
        <nav>
          <MenuList {...props}/>
        </nav>


        {/* Right */}
        <div className='flex items-center gap-3'>

        </div>


      </div>

    </header>
  )
}
