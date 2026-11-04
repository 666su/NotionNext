/**
 * 导航数据构建（桌面 MenuList 与移动 Drawer 共用）单元测试
 */
import {
  buildNavLinks,
  filterDrawerNavLinks
} from '@/themes/example/components/navLinks'
import { siteConfig } from '@/lib/config'

jest.mock('@/lib/config', () => ({
  siteConfig: jest.fn()
}))

const locale = {
  NAV: { SEARCH: '搜索', ARCHIVE: '归档' },
  COMMON: { CATEGORY: '分类', TAGS: '标签' }
}

const setFlags = ({ customMenu = true, builtin = false } = {}) => {
  siteConfig.mockImplementation(key => {
    if (key === 'CUSTOM_MENU') return customMenu
    if (typeof key === 'string' && key.startsWith('EXAMPLE_MENU_')) {
      return builtin
    }
    return null
  })
}

describe('buildNavLinks', () => {
  it('CUSTOM_MENU 开启时使用 customMenu，并保留一级/二级结构', () => {
    setFlags({ customMenu: true })
    const customMenu = [
      { name: '资源链接', href: '/links', show: true },
      {
        name: '软件教程',
        href: '/#',
        show: true,
        subMenus: [
          { title: '项目部署', href: '/archive', show: true },
          { title: '分类', href: '/category/%E6%8A%80%E6%9C%AF%E5%88%86%E4%BA%AB' }
        ]
      }
    ]

    const links = buildNavLinks({ locale, customMenu })

    expect(links.map(link => link.name)).toEqual(['资源链接', '软件教程'])
    expect(links[1].subMenus).toHaveLength(2)
    expect(links[1].subMenus[1].href).toBe(
      '/category/%E6%8A%80%E6%9C%AF%E5%88%86%E4%BA%AB'
    )
  })

  it('CUSTOM_MENU 关闭时回退内置入口 + customNav', () => {
    setFlags({ customMenu: false, builtin: true })
    const customNav = [{ name: '友链', href: '/links', show: true }]

    const links = buildNavLinks({ locale, customNav })

    expect(links.map(link => link.href)).toEqual([
      '/search',
      '/archive',
      '/category',
      '/tag',
      '/links'
    ])
  })

  it('内置入口开关关闭时不出现对应项', () => {
    setFlags({ customMenu: false, builtin: false })

    const links = buildNavLinks({ locale })

    expect(links).toHaveLength(4)
    expect(links.every(link => link.show === false)).toBe(true)
  })

  it('数据为空或参数缺失时不报错，返回空数组', () => {
    setFlags({ customMenu: true })

    expect(buildNavLinks({ locale })).toEqual([])
    expect(buildNavLinks()).toEqual([])
    expect(buildNavLinks({ locale, customMenu: [] })).toEqual([])
  })
})

describe('filterDrawerNavLinks', () => {
  it('过滤隐藏项和与抽屉固定入口重复的链接', () => {
    const links = [
      { name: '回到首页', href: '/', show: true },
      { name: '关于我', href: '/about', show: true },
      { name: '关于我(重复)', href: '/about/', show: true },
      { name: '隐藏项', href: '/hidden', show: false },
      {
        name: '技术分享',
        href: '/category/%E6%8A%80%E6%9C%AF%E5%88%86%E4%BA%AB',
        show: true
      }
    ]

    const result = filterDrawerNavLinks(links)

    expect(result).toHaveLength(1)
    // 已编码的中文分类链接原样保留，不做二次编码
    expect(result[0].href).toBe('/category/%E6%8A%80%E6%9C%AF%E5%88%86%E4%BA%AB')
  })

  it('原始中文 slug 原样返回，交给 SmartLink 处理', () => {
    const result = filterDrawerNavLinks([
      { name: '技术分享', href: '/category/技术分享', show: true }
    ])

    expect(result[0].href).toBe('/category/技术分享')
  })

  it('空数据返回空数组', () => {
    expect(filterDrawerNavLinks()).toEqual([])
    expect(filterDrawerNavLinks(null)).toEqual([])
    expect(filterDrawerNavLinks([])).toEqual([])
  })
})
