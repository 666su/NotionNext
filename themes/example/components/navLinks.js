import { siteConfig } from '@/lib/config'
import CONFIG from '../config'

/**
 * 统一构建导航数据，供桌面端 MenuList 与移动端 MobileDrawer 共用。
 *
 * 数据优先级（与原 MenuList 逻辑保持一致，不新增数据源、不额外请求 Notion）：
 * 1. 内置入口：搜索 / 归档 / 分类 / 标签，是否显示由 EXAMPLE_MENU_* 控制
 * 2. customNav：Notion 中 type=Page 的页面（旧方案）
 * 3. CUSTOM_MENU=true 时，完全使用 customMenu（Notion 中 type=Menu / SubMenu 的菜单）
 *
 * 注意：href 原样返回，这里不做任何 URL 编码/解码。
 * 中文分类名可能以原始中文（/category/技术分享）或已编码形式
 * （/category/%E6%8A%80%E6%9C%AF%E5%88%86%E4%BA%AB）存在，
 * 统一交给 SmartLink / 浏览器处理，避免出现双重编码。
 */
export const buildNavLinks = ({ locale, customNav, customMenu } = {}) => {
  const NAV = locale?.NAV || {}
  const COMMON = locale?.COMMON || {}

  let links = [
    {
      id: 1,
      icon: 'fas fa-search',
      name: NAV.SEARCH || 'Search',
      href: '/search',
      show: siteConfig('EXAMPLE_MENU_SEARCH', null, CONFIG)
    },
    {
      id: 2,
      icon: 'fas fa-archive',
      name: NAV.ARCHIVE || 'Archive',
      href: '/archive',
      show: siteConfig('EXAMPLE_MENU_ARCHIVE', null, CONFIG)
    },
    {
      id: 3,
      icon: 'fas fa-folder',
      name: COMMON.CATEGORY || 'Category',
      href: '/category',
      show: siteConfig('EXAMPLE_MENU_CATEGORY', null, CONFIG)
    },
    {
      id: 4,
      icon: 'fas fa-tag',
      name: COMMON.TAGS || 'Tags',
      href: '/tag',
      show: siteConfig('EXAMPLE_MENU_TAG', null, CONFIG)
    }
  ]

  if (customNav) {
    links = links.concat(customNav)
  }

  // 如果 开启自定义菜单，则覆盖 Page 生成的菜单
  if (siteConfig('CUSTOM_MENU')) {
    links = customMenu
  }

  return Array.isArray(links) ? links : []
}

/**
 * 移动端抽屉里已经固定保留了「回到首页」「关于我」入口，
 * 这里把重复 href 的自定义项过滤掉，避免同一条导航出现两次。
 * 只按 href 做精确匹配，不做任何猜测性映射。
 */
export const RESERVED_NAV_HREFS = ['/', '/about']

const normalizeHref = href => {
  if (typeof href !== 'string') return ''
  const trimmed = href.trim()
  if (!trimmed || trimmed === '/') return trimmed
  return trimmed.replace(/\/+$/, '')
}

/**
 * 过滤出适合在抽屉中渲染的导航项：
 * - 去掉 show=false 的项（内置入口的开关）
 * - 去掉与抽屉固定入口重复的项
 * 无数据或数据异常时返回空数组，调用方无需额外判空。
 */
export const filterDrawerNavLinks = (
  links,
  reservedHrefs = RESERVED_NAV_HREFS
) => {
  const reserved = new Set((reservedHrefs || []).map(normalizeHref))
  return (Array.isArray(links) ? links : []).filter(
    link => link && link.show !== false && !reserved.has(normalizeHref(link?.href))
  )
}
