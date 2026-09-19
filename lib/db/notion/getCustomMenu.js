function normalizeSourceSlug(slug) {
  if (typeof slug !== 'string') {
    return ''
  }

  const normalized = slug.trim()
  if (
    !normalized ||
    normalized === '#' ||
    /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(normalized)
  ) {
    return ''
  }

  return normalized.replace(/^\/+|\/+$/g, '')
}

export function getSourcePageSlugs(collectionData) {
  return new Map(
    collectionData
      .filter(page => page?.type === 'Page' && page?.slug)
      .map(page => [page.id, page.slug])
  )
}

function getPageHrefBySourceSlug(collectionData, sourcePageSlugs) {
  const pageHrefBySourceSlug = new Map()
  const ambiguousSlugs = new Set()

  collectionData.forEach(page => {
    if (page?.type !== 'Page' || page?.status !== 'Published' || !page?.href) {
      return
    }

    const sourceSlug = normalizeSourceSlug(sourcePageSlugs?.get(page.id))
    if (!sourceSlug || ambiguousSlugs.has(sourceSlug)) {
      return
    }

    const existingHref = pageHrefBySourceSlug.get(sourceSlug)
    if (existingHref && existingHref !== page.href) {
      pageHrefBySourceSlug.delete(sourceSlug)
      ambiguousSlugs.add(sourceSlug)
      return
    }

    pageHrefBySourceSlug.set(sourceSlug, page.href)
  })

  return pageHrefBySourceSlug
}

export function getCustomMenu({ collectionData, sourcePageSlugs }) {
  const pageHrefBySourceSlug = getPageHrefBySourceSlug(
    collectionData,
    sourcePageSlugs
  )
  const menuPages = collectionData.filter(
    post =>
      post.status === 'Published' &&
      (post?.type === 'Menu' || post?.type === 'SubMenu')
  )

  // 新增文章系列展示功能：构建 slug → series 的映射，用于自动修正导航链接
  // 如果 Menu 的 slug 指向一篇有 series 的文章，则自动改为指向 /series/[series]
  const postSeriesByHref = new Map()
  collectionData.forEach(page => {
    if (
      page?.type === 'Post' &&
      page?.status === 'Published' &&
      page?.href &&
      page?.series &&
      typeof page.series === 'string' &&
      page.series.trim()
    ) {
      postSeriesByHref.set(page.href, page.series.trim())
    }
  })

  const menus = []
  if (menuPages && menuPages.length > 0) {
    menuPages.forEach(e => {
      e.show = true
      const sourceSlug = normalizeSourceSlug(e.slug)
      if (sourceSlug && pageHrefBySourceSlug.has(sourceSlug)) {
        e.href = pageHrefBySourceSlug.get(sourceSlug)
      }

      // 新增文章系列展示功能：
      // 如果菜单指向的是一篇有 series 的文章，自动重定向到系列列表页
      // 这样一级导航 = 分类入口，而非单篇文章
      if (e.href && postSeriesByHref.has(e.href)) {
        const seriesName = postSeriesByHref.get(e.href)
        e.href = `/series/${encodeURIComponent(seriesName)}`
      }

      if (e.type === 'Menu') {
        menus.push(e)
      } else if (e.type === 'SubMenu') {
        const parentMenu = menus[menus.length - 1]
        if (parentMenu) {
          if (parentMenu.subMenus) {
            parentMenu.subMenus.push(e)
          } else {
            parentMenu.subMenus = [e]
          }
        }
      }
    })
  }
  return menus
}
