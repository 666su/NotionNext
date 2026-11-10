/**
 * Notion 只读同步（Phase 4）
 *
 * 只读取、只写统计侧快照：**绝不修改 / 创建 / 删除 / 发布 Notion 内容**。
 * 复用前台同一份缓存（fetchGlobalAllData），避免"后台 N 篇、前台 N-1 篇"的错位。
 *
 * 产物：
 *   stats:v1:articles         Hash：articleId → JSON 快照（标题/slug/分类/标签/时间/状态）
 *   stats:v1:slugmap          Hash：slug → articleId（改名/改 URL 后历史仍可归属）
 *   stats:v1:pathmap          Hash：path → articleId（**只增不删**，历史路径永久可归属）
 *   stats:v1:meta:articles    文章总数、分类/标签计数、同步时间
 *   stats:v1:sync:log         List：同步日志（最多 200 条）
 */

import { K } from '@/lib/analytics/constants'
import {
  kvGet,
  kvHdel,
  kvHgetall,
  kvHset,
  kvLpush,
  kvLrange,
  kvLtrim,
  kvSet
} from '@/lib/kv'

const SYNC_LOG_MAX = 200

/** NotionNext 的 post.slug 形如 `article/dsh09`（自带目录前缀），这里统一成纯 slug */
function normalizeSlug(post) {
  const raw = String(post?.slug || '').trim()
  if (!raw) return ''
  return raw.replace(/^\/+/, '').replace(/^article\//, '')
}

function normalizeTags(post) {
  const tags = Array.isArray(post?.tags) ? post.tags : []
  return tags
    .map(tag => (typeof tag === 'string' ? tag : tag?.name || ''))
    .filter(Boolean)
    .slice(0, 30)
}

export async function logSync(entry) {
  try {
    await kvLpush(K.syncLog, JSON.stringify(entry))
    await kvLtrim(K.syncLog, 0, SYNC_LOG_MAX - 1)
  } catch (err) {
    console.error('[sync] log failed:', err?.message || err)
  }
}

export async function readSyncLog(limit = 10) {
  const rows = await kvLrange(K.syncLog, 0, Math.max(0, limit - 1))
  return (rows || [])
    .map(raw => {
      try {
        return JSON.parse(raw)
      } catch (err) {
        return null
      }
    })
    .filter(Boolean)
}

/**
 * 执行同步
 * @returns {Promise<{ok:boolean, counts:object, finishedAt:string, error?:string}>}
 */
export async function syncNotion({ from = 'admin' } = {}) {
  const startedAt = new Date().toISOString()
  const started = Date.now()

  try {
    const { fetchGlobalAllData } = await import('@/lib/db/SiteDataApi')
    const data = await fetchGlobalAllData({ from })
    const pages = Array.isArray(data?.allPages) ? data.allPages : []
    const posts = pages.filter(post => post && post.type === 'Post')

    const articleFields = {}
    const slugFields = {}
    const pathFields = {}
    const categoryCounter = {}
    const tagCounter = {}

    for (const post of posts) {
      if (!post?.id) continue
      const category = post.category || ''
      const tags = normalizeTags(post)
      const slug = normalizeSlug(post)
      if (category) categoryCounter[category] = (categoryCounter[category] || 0) + 1
      tags.forEach(tag => {
        tagCounter[tag] = (tagCounter[tag] || 0) + 1
      })

      articleFields[post.id] = JSON.stringify({
        id: post.id,
        title: post.title || post.name || '(无标题)',
        slug,
        url: post.href || (slug ? `/article/${slug}` : ''),
        category,
        tags,
        status: post.status || '',
        description: String(post.summary || post.description || '').slice(0, 300),
        hasCover: !!(post.pageCover || post.pageCoverThumbnail),
        publishedAt: post.publishDate || null,
        updatedAt: post.lastEditedDate || null,
        syncedAt: startedAt
      })

      if (slug) {
        slugFields[slug] = post.id
        pathFields[`/article/${slug}`] = post.id
      }
      if (post.href) pathFields[post.href] = post.id
    }

    await kvHset(K.articles, articleFields)
    if (Object.keys(slugFields).length) await kvHset(K.slugmap, slugFields)
    // 路径映射只增不删：文章改名/换 slug 后，旧路径的阅读量仍能归到同一篇文章
    if (Object.keys(pathFields).length) await kvHset(K.pathMap, pathFields)

    // 清理格式非法的历史键（例如旧版本把 `article/dsh09` 拼成 `/article/article/dsh09`）
    try {
      const existing = await kvHgetall(K.pathMap)
      const broken = Object.keys(existing || {}).filter(path => path.startsWith('/article/article/'))
      if (broken.length) await kvHdel(K.pathMap, broken)
    } catch (err) {
      console.warn('[sync] pathmap cleanup skipped:', err?.message || err)
    }

    const meta = {
      count: Object.keys(articleFields).length,
      categories: Object.entries(categoryCounter)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
      tags: Object.entries(tagCounter)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 200),
      syncedAt: startedAt,
      durationMs: Date.now() - started
    }
    await kvSet(K.articleMeta, JSON.stringify(meta))

    await logSync({
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'ok',
      source: 'notion',
      counts: { articles: meta.count, categories: meta.categories.length, tags: meta.tags.length },
      durationMs: Date.now() - started
    })

    return {
      ok: true,
      // 统一给前端/日志用的计数口径（与 logSync 里的 counts 保持一致）
      counts: {
        articles: meta.count,
        categories: meta.categories.length,
        tags: meta.tags.length
      },
      meta,
      finishedAt: new Date().toISOString()
    }
  } catch (err) {
    const message = err?.message || String(err)
    await logSync({
      startedAt,
      finishedAt: new Date().toISOString(),
      status: 'error',
      source: 'notion',
      error: message.slice(0, 500),
      durationMs: Date.now() - started
    })
    console.error('[sync][notion] failed:', message)
    return { ok: false, error: message, finishedAt: new Date().toISOString() }
  }
}

export async function readArticleIndex() {
  const [raw, metaRaw, pathRaw] = await Promise.all([
    kvHgetall(K.articles),
    kvGet(K.articleMeta),
    kvHgetall(K.pathMap).catch(() => ({}))
  ])

  const rows = Object.values(raw || {})
    .map(value => {
      try {
        return JSON.parse(value)
      } catch (err) {
        return null
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.publishedAt || 0) - (a.publishedAt || 0))

  let meta = null
  if (metaRaw) {
    try {
      meta = JSON.parse(metaRaw)
    } catch (err) {
      meta = null
    }
  }
  return { rows, meta, pathMap: pathRaw || {} }
}
