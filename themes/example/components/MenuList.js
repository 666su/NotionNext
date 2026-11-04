import { useGlobal } from '@/lib/global'
import { MenuItemDrop } from './MenuItemDrop'
import { buildNavLinks } from './navLinks'

/**
 * 导航菜单列表
 * 新增移动端适配：
 * - 移动端水平滚动（不折行），隐藏滚动条
 * - 桌面端保持原有布局
 * 导航数据统一由 navLinks.js 构建，与移动端 MobileDrawer 共用同一份数据。
 */
export const MenuList = props => {
  const { customNav, customMenu } = props
  const { locale } = useGlobal()

  const links = buildNavLinks({ locale, customNav, customMenu })

  if (links.length === 0) {
    return null
  }

  return (
    <nav className='w-full bg-transparent px-0 relative z-20'>
      <div className='mx-auto max-w-6xl md:flex justify-between items-center text-sm md:text-md md:justify-start overflow-x-auto menu-scroll-hide'>
        <ul className='flex flex-nowrap md:flex-wrap justify-start items-stretch md:items-start gap-1 md:gap-0 whitespace-nowrap'>
          {links.map((link, index) => (
            <MenuItemDrop key={index} link={link} />
          ))}
        </ul>
      </div>
    </nav>
  )
}
