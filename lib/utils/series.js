/**
 * 新增文章系列展示功能
 * 将文章按 series 字段分组，组内按 number 排序（无 number 时按 date 倒序）
 */

/**
 * 归一化 series 值。
 * Notion 属性类型可能是 text(rich_text) 也可能被改成 select / multi_select（下拉选择）。
 * getPageProperties 对 select/multi_select 返回数组，这里统一收敛为字符串，
 * 否则 typeof post.series === 'string' 判断会失败、post.series.trim() 会抛错。
 * @param {*} value
 * @returns {string} 归一化后的系列名，空值返回 ''
 */
export function normalizeSeriesName(value) {
  if (value == null) return ''
  if (Array.isArray(value)) {
    return value.map(v => normalizeSeriesName(v)).find(v => v) || ''
  }
  return typeof value === 'string' ? value.trim() : String(value).trim()
}

/**
 * 归一化 series 值为系列名数组（去重、去空）。
 * 用于 multi_select（下拉多选）场景：一篇文章可同时属于多个系列，
 * 此时文章会出现在它所属的每个系列分组中。
 * text / select 类型只返回一个元素，行为与 normalizeSeriesName 一致。
 * @param {*} value
 * @returns {string[]}
 */
export function normalizeSeriesNames(value) {
  if (value == null) return []
  const list = Array.isArray(value) ? value : [value]
  const names = []
  for (const item of list) {
    const name = normalizeSeriesName(item)
    if (name && !names.includes(name)) {
      names.push(name)
    }
  }
  return names
}

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
    // 兼容 text / select / multi_select 三种属性类型
    // multi_select（下拉多选）可含多个系列，文章会出现在其所属的每个系列中
    const keys = normalizeSeriesNames(post?.series)
    if (keys.length) {
      for (const key of keys) {
        if (!seriesMap.has(key)) {
          seriesMap.set(key, [])
        }
        seriesMap.get(key).push(post)
      }
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
    for (const name of normalizeSeriesNames(post?.series)) {
      names.add(name)
    }
  }
  return [...names]
}
