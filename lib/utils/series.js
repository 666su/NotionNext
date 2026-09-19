/**
 * 新增文章系列展示功能
 * 将文章按 series 字段分组，组内按 number 排序（无 number 时按 date 倒序）
 */

/**
 * 将文章列表按 series 分组
 * @param {Array} posts - 文章数组（需包含 series, number, publishDate 字段）
 * @returns {{ grouped: Array<{series: string, posts: Array}>, ungrouped: Array }}
 *   grouped: 有 series 的文章，按系列分组，系列间按首个文章的 publishDate 倒序
 *   ungrouped: 无 series 的文章，保持原顺序
 */
export function groupPostsBySeries(posts) {
  if (!Array.isArray(posts)) return { grouped: [], ungrouped: [] }

  const seriesMap = new Map()
  const ungrouped = []

  for (const post of posts) {
    // series 存在且非空字符串时归入系列
    if (post.series && typeof post.series === 'string' && post.series.trim()) {
      const key = post.series.trim()
      if (!seriesMap.has(key)) {
        seriesMap.set(key, [])
      }
      seriesMap.get(key).push(post)
    } else {
      ungrouped.push(post)
    }
  }

  // 组内排序：number 存在则按 number 升序，否则按 publishDate 倒序
  const sortWithinGroup = (arr) => {
    const hasNumber = arr.some(p => p.number != null && String(p.number).trim() !== '')
    if (hasNumber) {
      return [...arr].sort((a, b) => {
        const numA = parseFloat(a.number) || Infinity
        const numB = parseFloat(b.number) || Infinity
        if (numA !== numB) return numA - numB
        // number 相同时按日期倒序
        return (b?.publishDate ?? 0) - (a?.publishDate ?? 0)
      })
    }
    return [...arr].sort((a, b) => (b?.publishDate ?? 0) - (a?.publishDate ?? 0))
  }

  const grouped = []
  for (const [series, items] of seriesMap.entries()) {
    const sorted = sortWithinGroup(items)
    grouped.push({ series, posts: sorted })
  }

  // 系列间按组内最新发布时间倒序排列
  grouped.sort((a, b) => {
    const latestA = Math.max(...a.posts.map(p => p.publishDate ?? 0))
    const latestB = Math.max(...b.posts.map(p => p.publishDate ?? 0))
    return latestB - latestA
  })

  return { grouped, ungrouped }
}

/**
 * 获取所有系列名称（去重）
 * @param {Array} posts
 * @returns {string[]}
 */
export function getAllSeriesNames(posts) {
  if (!Array.isArray(posts)) return []
  const names = new Set()
  for (const post of posts) {
    if (post.series && typeof post.series === 'string' && post.series.trim()) {
      names.add(post.series.trim())
    }
  }
  return [...names]
}
