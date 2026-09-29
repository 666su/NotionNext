/**
 * 新增排行榜与点赞功能 - 业务逻辑层
 *
 * 提供：
 *  - 记录文章浏览（带去重）
 *  - 点赞 / 取消点赞
 *  - 查询单篇或一批文章的计数
 *  - 生成左侧栏排行榜数据（查看榜 + 点赞榜，均按从高到低排序）
 *  - 导入历史数据 / 重置计数（管理接口使用）
 *
 * 本模块仅供服务端（API Route）使用
 */
import { siteConfig } from '@/lib/config'
import {
  acquireDedupe,
  clearCounters,
  clearDedupe,
  getCounter,
  getCounters,
  hasDedupe,
  hashIdentity,
  incrCounter,
  mergeCounters,
  releaseDedupe
} from './storage'

// 点赞标记使用的去重域与有效期（100 年，视为永久）
const LIKED_SCOPE = 'liked-by'
const LIKED_TTL = 100 * 365 * 24 * 3600

const RANK_KIND = {
  VIEWS: 'views',
  LIKES: 'likes'
}

// ========== 配置读取 ==========

function toBool(value, fallback = true) {
  if (value === undefined || value === null || value === '') return fallback
  if (typeof value === 'boolean') return value
  const str = String(value).trim().toLowerCase()
  if (str === 'false' || str === '0') return false
  if (str === 'true' || str === '1') return true
  return fallback
}

function toInt(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? Math.trunc(num) : fallback
}

export function isRankEnabled() {
  return toBool(siteConfig('RANK_ENABLE', true), true)
}

export function isViewEnabled() {
  return isRankEnabled() && toBool(siteConfig('RANK_VIEW_ENABLE', true), true)
}

export function isLikeEnabled() {
  return isRankEnabled() && toBool(siteConfig('RANK_LIKE_ENABLE', true), true)
}

export function getListSize() {
  const size = toInt(siteConfig('RANK_LIST_SIZE', 10), 10)
  return Math.min(Math.max(size, 1), 50)
}

function getViewWindowHours() {
  return Math.max(toInt(siteConfig('RANK_VIEW_WINDOW_HOURS', 6), 6), 0)
}

function getMaxCandidates() {
  return Math.min(
    Math.max(toInt(siteConfig('RANK_MAX_CANDIDATES', 500), 500), 20),
    5000
  )
}

// ========== 访客标识 ==========

/**
 * 取客户端 IP（不落库原始 IP，仅参与哈希）
 */
function getClientIp(req) {
  if (!req) return ''
  const forwarded = req.headers?.['x-forwarded-for']
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim()
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return String(forwarded[0]).split(',')[0].trim()
  }
  return (
    req.headers?.['x-real-ip'] ||
    req.socket?.remoteAddress ||
    req.connection?.remoteAddress ||
    ''
  )
}

/**
 * 生成匿名访客标识（IP + UA 的哈希），用于浏览去重，不保存原始 IP
 */
export function getVisitorIdentity(req, extra = '') {
  const ip = getClientIp(req)
  const ua = req?.headers?.['user-agent'] || ''
  return hashIdentity(ip, ua, extra)
}

// ========== 记录浏览 ==========

/**
 * 记录一次文章浏览
 * @returns {Promise<{counted: boolean, views: number|null}>}
 */
export async function recordView(postId, req) {
  if (!isViewEnabled()) return { counted: false, views: null, disabled: true }
  if (!postId) return { counted: false, views: null }

  const windowHours = getViewWindowHours()
  let identity = ''

  if (windowHours > 0) {
    identity = `${postId}:${getVisitorIdentity(req)}`
    const firstTime = await acquireDedupe(
      RANK_KIND.VIEWS,
      identity,
      windowHours * 3600
    )
    if (!firstTime) {
      const counters = await getCounters(RANK_KIND.VIEWS)
      return { counted: false, views: counters[postId] ?? null }
    }
  }

  const views = await incrCounter(RANK_KIND.VIEWS, postId, 1)

  // 计数失败时释放去重标记，避免这次浏览被永久吞掉
  if (views === null && identity) {
    await releaseDedupe(RANK_KIND.VIEWS, identity)
  }

  return { counted: views !== null, views }
}

// ========== 点赞 ==========

/**
 * 点赞开关切换
 * @param {string} postId
 * @param {string} identity 访客标识
 * @param {'like'|'unlike'|'toggle'} action
 * @param {boolean} [liked] 当 action 为 toggle 且传入当前状态时作为期望状态
 * @returns {Promise<{liked: boolean, likes: number|null, changed: boolean}>}
 */
export async function toggleLike(postId, identity, action = 'toggle', liked) {
  if (!isLikeEnabled()) return { liked: false, likes: null, disabled: true }
  if (!postId || !identity) return { liked: false, likes: null, changed: false }

  const likedKey = `${postId}:${identity}`

  // 只读探测当前点赞状态，避免探测本身改变状态
  const alreadyLiked = await hasDedupe(LIKED_SCOPE, likedKey)

  // 目标状态：显式传入 liked 时以它为准，否则取反
  const targetLiked =
    action === 'like'
      ? true
      : action === 'unlike'
        ? false
        : typeof liked === 'boolean'
          ? liked
          : !alreadyLiked

  if (targetLiked === alreadyLiked) {
    const counters = await getCounters(RANK_KIND.LIKES)
    return {
      liked: alreadyLiked,
      likes: counters[postId] ?? null,
      changed: false
    }
  }

  const delta = targetLiked ? 1 : -1

  // 先落标记，再改计数；任一步失败则整体回滚
  const markerOk = targetLiked
    ? await acquireDedupe(LIKED_SCOPE, likedKey, LIKED_TTL)
    : await releaseDedupeAndConfirm(LIKED_SCOPE, likedKey)

  if (!markerOk) {
    const counters = await getCounters(RANK_KIND.LIKES)
    return {
      liked: alreadyLiked,
      likes: counters[postId] ?? null,
      changed: false
    }
  }

  let likes = await incrCounter(RANK_KIND.LIKES, postId, delta)

  if (likes === null) {
    // 计数失败：回滚标记
    if (targetLiked) {
      await releaseDedupe(LIKED_SCOPE, likedKey)
    } else {
      await acquireDedupe(LIKED_SCOPE, likedKey, LIKED_TTL)
    }
    return { liked: alreadyLiked, likes: null, changed: false }
  }

  // 不允许出现负数
  if (likes < 0) {
    likes = await incrCounter(RANK_KIND.LIKES, postId, -likes)
  }

  return { liked: targetLiked, likes, changed: true }
}

/**
 * 释放点赞标记并确认已释放
 */
async function releaseDedupeAndConfirm(scope, identity) {
  await releaseDedupe(scope, identity)
  return !(await hasDedupe(scope, identity))
}

/**
 * 查询单篇文章的计数与当前访客的点赞状态
 * @returns {Promise<{views: number|null, likes: number|null, liked: boolean}>}
 */
export async function getPostInteraction(postId, identity) {
  if (!postId) return { views: null, likes: null, liked: false }

  const [views, likes, liked] = await Promise.all([
    isViewEnabled()
      ? getCounter(RANK_KIND.VIEWS, postId)
      : Promise.resolve(null),
    isLikeEnabled()
      ? getCounter(RANK_KIND.LIKES, postId)
      : Promise.resolve(null),
    isLikeEnabled() && identity
      ? isLikedBy(postId, identity)
      : Promise.resolve(false)
  ])

  return { views, likes, liked }
}

/**
 * 查询某访客对某篇文章是否已点赞（只读，不改变计数）
 */
export async function isLikedBy(postId, identity) {
  if (!postId || !identity) return false
  return hasDedupe(LIKED_SCOPE, `${postId}:${identity}`)
}

// ========== 查询计数 ==========

/**
 * 批量查询文章计数
 * @param {string[]} postIds
 * @returns {Promise<{views: Record<string, number>, likes: Record<string, number>}>}
 */
export async function getCountersForPosts(postIds) {
  const ids = Array.isArray(postIds) ? postIds.filter(Boolean).map(String) : []
  const result = { views: {}, likes: {} }
  if (ids.length === 0) return result

  const pick = counters => {
    const out = {}
    ids.forEach(id => {
      if (counters[id] !== undefined) out[id] = counters[id]
    })
    return out
  }

  const [views, likes] = await Promise.all([
    isViewEnabled() ? getCounters(RANK_KIND.VIEWS) : Promise.resolve({}),
    isLikeEnabled() ? getCounters(RANK_KIND.LIKES) : Promise.resolve({})
  ])

  result.views = pick(views)
  result.likes = pick(likes)
  return result
}

// ========== 排行榜 ==========

/**
 * 从全站文章数据中筛选可参与排行的文章
 */
function pickRankablePosts(allPages) {
  if (!Array.isArray(allPages)) return []
  return allPages.filter(post => {
    if (!post || !post.id) return false
    if (typeof post.type === 'string' && post.type.includes('Menu'))
      return false
    if (post.type === 'Page') return false
    if (!post.href) return false
    return true
  })
}

function toRankItem(post, views, likes) {
  return {
    id: post.id,
    short_id: post.short_id,
    title: post.title || post.name || '未命名',
    href: post.href,
    slug: post.slug,
    category: post.category,
    date: post.publishDay,
    icon: post.pageIcon || post.icon,
    cover: post.pageCoverThumbnail || post.pageCover || null,
    views: views[post.id] || 0,
    likes: likes[post.id] || 0
  }
}

/**
 * 对文章按计数从高到低排序后取前 limit 条（计数相同时按发布时间较新优先）
 */
function rankTop(posts, counters, limit) {
  return posts
    .map(post => ({ post, count: counters[post.id] || 0 }))
    .filter(item => item.count > 0)
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count
      return String(b.post.publishDate || '').localeCompare(
        String(a.post.publishDate || '')
      )
    })
    .slice(0, limit)
    .map(item => item.post)
}

/**
 * 生成左侧栏排行榜数据
 * @param {object} options
 * @param {number} [options.limit] 每个榜单条数
 * @param {number} [options.pageSize] 每页扫描的文章数（用于分页扫描全站计数）
 * @param {number} [options.pageStart] 起始页
 * @returns {Promise<{views: any[], likes: any[], updatedAt: number, enabled: {views: boolean, likes: boolean}}>}
 */
export async function buildRankBoard({ limit, pageSize, pageStart = 0 } = {}) {
  const listSize = limit
    ? Math.min(Math.max(toInt(limit, 10), 1), 50)
    : getListSize()
  const enabled = { views: isViewEnabled(), likes: isLikeEnabled() }
  const empty = { views: [], likes: [], updatedAt: Date.now(), enabled }

  if (!enabled.views && !enabled.likes) return empty

  // 懒加载，避免把 Notion 相关依赖带进无关的打包路径
  const { fetchGlobalAllData } = await import('@/lib/db/SiteDataApi')
  const siteData = await fetchGlobalAllData({ from: 'rank-board' })

  const candidates = pickRankablePosts(siteData?.allPages).slice(
    0,
    getMaxCandidates()
  )
  if (candidates.length === 0) return empty

  const counters = await getCountersForPosts(candidates.map(post => post.id))

  const viewPosts = enabled.views
    ? rankTop(candidates, counters.views, listSize)
    : []
  const likePosts = enabled.likes
    ? rankTop(candidates, counters.likes, listSize)
    : []

  return {
    views: viewPosts.map(post =>
      toRankItem(post, counters.views, counters.likes)
    ),
    likes: likePosts.map(post =>
      toRankItem(post, counters.views, counters.likes)
    ),
    updatedAt: Date.now(),
    enabled
  }
}

// ========== 管理操作 ==========

/**
 * 校验管理令牌
 */
export function verifySecret(token) {
  const expected =
    (siteConfig('RANK_SEED_SECRET', '') || '').trim() ||
    (siteConfig('REVALIDATION_TOKEN', '') || '').trim()
  if (!expected) return false
  return String(token || '').trim() === expected
}

/**
 * 导入历史计数
 * @param {object} payload { views?: {postId: number}, likes?: {postId: number}, mode?: 'set'|'incr'|'max' }
 */
export async function importCounters(payload = {}) {
  const mode = ['set', 'incr', 'max'].includes(payload.mode)
    ? payload.mode
    : 'set'
  const result = {}

  if (payload.views && typeof payload.views === 'object') {
    result.views = await mergeCounters(RANK_KIND.VIEWS, payload.views, mode)
  }
  if (payload.likes && typeof payload.likes === 'object') {
    result.likes = await mergeCounters(RANK_KIND.LIKES, payload.likes, mode)
  }

  result.mode = mode
  return result
}

/**
 * 重置计数
 * @param {'views'|'likes'|'all'} kind
 */
export async function resetCounters(kind = 'all') {
  const result = {}
  if (kind === 'views' || kind === 'all') {
    result.views = await clearCounters(RANK_KIND.VIEWS)
    // 一并清空浏览去重标记，否则访客在去重窗口内不会再被计数
    result.viewsDedupe = await clearDedupe(RANK_KIND.VIEWS)
  }
  if (kind === 'likes' || kind === 'all') {
    result.likes = await clearCounters(RANK_KIND.LIKES)
    // 关键：点赞数归零后必须清除已点赞标记，否则访客无法重新点赞
    result.likesDedupe = await clearDedupe(LIKED_SCOPE)
  }
  return result
}
