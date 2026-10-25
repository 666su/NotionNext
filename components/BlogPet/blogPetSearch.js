/**
 * Blog Pet 文章检索（纯前端轻量索引，不依赖大模型）
 *
 * 匹配维度：标题 / 标签 / 分类 / 摘要，多关键词组合加权排序
 * 所有结果都来自真实文章数据，不做任何虚构
 */
import { formatDate, toPlainText } from './blogPetUtils'

const WEIGHT = { title: 6, tag: 4, category: 3, summary: 2 }

function normalizeText(text) {
  return toPlainText(text).toLowerCase()
}

function splitTokens(query) {
  const normalized = normalizeText(query)
  if (!normalized) return []
  return normalized
    .split(/[\s,，、。.!！?？;；:：/\\()[\]{}"'“”‘’]+/)
    .filter(Boolean)
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags
    .map(tag => (typeof tag === 'string' ? tag : tag?.name))
    .filter(Boolean)
    .map(normalizeText)
}

function timeValue(post) {
  const text = formatDate(post?.date)
  return text || ''
}

function compareByDateDesc(a, b) {
  return timeValue(b).localeCompare(timeValue(a))
}

/** 建立轻量索引：把标题/摘要/分类/标签预先归一化，避免每次搜索重复处理 */
export function buildIndex(posts) {
  if (!Array.isArray(posts)) return []
  return posts
    .filter(post => post && post.title && post.href)
    .map(post => ({
      id: post.id,
      title: toPlainText(post.title),
      href: post.href,
      slug: post.slug,
      summary: toPlainText(post.summary),
      category: toPlainText(post.category),
      tags: normalizeTags(post.tags),
      date: formatDate(post.date),
      cover: post.cover || null,
      _title: normalizeText(post.title),
      _summary: normalizeText(post.summary),
      _category: normalizeText(post.category),
      _tags: normalizeTags(post.tags)
    }))
}

/** 关键词检索：返回按相关度降序排列的文章 */
export function searchPosts(index, query, limit = 6) {
  const tokens = splitTokens(query)
  if (!Array.isArray(index) || index.length === 0 || tokens.length === 0) {
    return []
  }

  const whole = normalizeText(query)
  const scored = []

  for (const post of index) {
    let score = 0
    let matchedTokens = 0

    for (const token of tokens) {
      let hit = 0
      if (post._title.includes(token)) hit += WEIGHT.title
      if (post._tags.some(tag => tag.includes(token) || token.includes(tag))) {
        hit += WEIGHT.tag
      }
      if (post._category.includes(token)) hit += WEIGHT.category
      if (post._summary.includes(token)) hit += WEIGHT.summary
      if (hit > 0) {
        matchedTokens += 1
        score += hit
      }
    }

    // 整句命中标题时额外加分，兼顾「最近写的文章」这类连续中文
    if (whole.length >= 2 && post._title.includes(whole)) score += 5
    if (score <= 0) continue
    if (matchedTokens === tokens.length) score += 3

    scored.push({ post, score })
  }

  return scored
    .sort((a, b) => b.score - a.score || compareByDateDesc(a.post, b.post))
    .slice(0, limit)
    .map(item => item.post)
}

/** 最新文章 */
export function latestPosts(index, limit = 6) {
  if (!Array.isArray(index)) return []
  return [...index].sort(compareByDateDesc).slice(0, limit)
}

/** 随机推荐（尽量避开已展示过的文章） */
export function randomPosts(index, limit = 1, excludeIds = []) {
  if (!Array.isArray(index) || index.length === 0) return []
  const pool = index.filter(post => !excludeIds.includes(post.id))
  const source = pool.length > 0 ? pool : index
  const shuffled = [...source]
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled.slice(0, limit)
}

/** 按 href 把榜单数据映射回本地索引（用于「热门文章」） */
export function mapByHref(index, hrefs = []) {
  const map = new Map(index.map(post => [post.href, post]))
  return hrefs.map(href => map.get(href)).filter(Boolean)
}
