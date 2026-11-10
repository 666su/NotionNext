/**
 * 文章维度的统一口径（Phase 3/4 共用）
 *
 * 背景：文章阅读量有两个来源
 *   1. 页面主动上报 `article_id`（K.pv:art:<day>）
 *   2. 只上报了路径（K.pvpath:<day>），需要用 Notion 快照 + 持久化 pathMap 反查
 *
 * 两条口径取**较大值**，既不会重复累加，也不会因为某天开始才注入 article_id 而"历史归零"。
 */

/** 路径 → 文章（/article/<slug> 与快照 url 两种形态都认；pathMap 优先） */
export function buildPathIndex(rows = [], pathMap = {}) {
  const bySlug = new Map()
  const byUrl = new Map()
  rows.forEach(row => {
    if (row?.slug) bySlug.set(row.slug, row)
    if (row?.url) byUrl.set(row.url, row)
  })
  return { bySlug, byUrl, pathMap: pathMap || {} }
}

export function resolveArticleForPath(path, index) {
  if (!path) return null
  const clean = String(path).split('?')[0].split('#')[0]

  // 1) 持久化路径映射（只增不删：改名/换 slug 后旧路径仍能归属）
  const mappedId = index?.pathMap?.[clean]
  if (mappedId) return { id: mappedId }

  // 2) 当前快照的 url / slug 兜底
  if (index?.byUrl?.has(clean)) return index.byUrl.get(clean)
  const prefix = '/article/'
  if (clean.startsWith(prefix)) {
    const slug = clean.slice(prefix.length).replace(/\/$/, '')
    if (index?.bySlug?.has(slug)) return index.bySlug.get(slug)
  }
  return null
}

/**
 * 路径 PV → 文章 PV
 * @returns {{pvByArticle: Map<string, number>, unmappedPathViews: number}}
 */
export function buildArticlePvMap({ articleIndex, pathViews, articleStats = [] }) {
  const index = buildPathIndex(articleIndex?.rows || [], articleIndex?.pathMap || {})
  const pvByArticle = new Map()

  // 路径口径
  let unmappedPathViews = 0
  Object.entries(pathViews || {}).forEach(([path, views]) => {
    const article = resolveArticleForPath(path, index)
    if (!article) {
      if (String(path).startsWith('/article/')) unmappedPathViews += Number(views) || 0
      return
    }
    pvByArticle.set(article.id, (pvByArticle.get(article.id) || 0) + (Number(views) || 0))
  })

  // article_id 口径（取较大值）
  articleStats.forEach(stat => {
    if (!stat?.articleId) return
    const byPath = pvByArticle.get(stat.articleId) || 0
    pvByArticle.set(stat.articleId, Math.max(byPath, Number(stat.pv) || 0))
  })

  return { pvByArticle, unmappedPathViews }
}
