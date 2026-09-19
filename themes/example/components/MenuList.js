import { siteConfig } from '@/lib/config'
import { useGlobal } from '@/lib/global'
import CONFIG from '../config'
import { MenuItemDrop } from './MenuItemDrop'

/**
 * 导航菜单列表
 * 新增移动端适配：
 * - 移动端水平滚动（不折行），隐藏滚动条
 * - 桌面端保持原有布局
 */
export const MenuList = props => {
  const { customNav, customMenu } = props
  const { locale } = useGlobal()

  let links = [
    {
      id: 1,
      icon: 'fas fa-search',
      name: locale.NAV.SEARCH,
      href: '/search',
      show: siteConfig('EXAMPLE_MENU_SEARCH', null, CONFIG)
    },
    {
      id: 2,
      icon: 'fas fa-archive',
      name: locale.NAV.ARCHIVE,
      href: '/archive',
      show: siteConfig('EXAMPLE_MENU_ARCHIVE', null, CONFIG)
    },
    {
      id: 3,
      icon: 'fas fa-folder',
      name: locale.COMMON.CATEGORY,
      href: '/category',
      show: siteConfig('EXAMPLE_MENU_CATEGORY', null, CONFIG)
    },
    {
      id: 4,
      icon: 'fas fa-tag',
      name: locale.COMMON.TAGS,
      href: '/tag',
      show: siteConfig('EXAMPLE_MENU_TAG', null, CONFIG)
    }
  ]

  if (customNav) {
    links = links.concat(customNav)
  }

  // 如果 开启自定义菜单，则不再使用 Page生成菜单。
  if (siteConfig('CUSTOM_MENU')) {
    links = customMenu
  }

  if (!links || links.length === 0) {
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
