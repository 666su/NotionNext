/**
 * 失效链接检查（Phase 5）
 *
 * 约束（重要）：
 * - 只探测**同源**页面（本站自己的 URL），绝不扫描第三方站点；
 * - 每次最多 20 个 URL，并发 4，结果缓存 10 分钟 —— 避免把源站打热；
 * - 只读 GET（手动跟随重定向判定），不提交任何数据。
 */

import { readArticleIndex } from '@/lib/admin/sync/notion-sync'

const CACHE_TTL_MS = 10 * 60 * 1000
const MAX_TARGETS = 20
const CONCURRENCY = 4
const STATIC_PATHS = ['/', '/archive']
const cache = new Map()

function normalizePath(path) {
  if (!path) return ''
  const value = String(path).trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).pathname + (new URL(value).search || '')
    } catch (err) {
      return ''
    }
  }
  return value.startsWith('/') ? value : `/${value}`
}

async function probe(origin, path) {
  const url = `${origin}${path}`
  const started = Date.now()
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'x-link-check': 'jason-blog-admin' }
    })
    const status = response.status
    return {
      path,
      status,
      ok: status >= 200 && status < 400,
      redirect: status >= 300 && status < 400,
      ms: Date.now() - started
    }
  } catch (err) {
    return {
      path,
      status: 0,
      ok: false,
      ms: Date.now() - started,
      error: err?.message || 'request_failed'
    }
  }
}

async function runPool(tasks, size) {
  const results = []
  let index = 0
  const workers = new Array(Math.min(size, tasks.length)).fill(0).map(async () => {
    while (index < tasks.length) {
      const current = index
      index += 1
      results[current] = await tasks[current]()
    }
  })
  await Promise.all(workers)
  return results
}

/**
 * @param {{origin:string, limit?:number, includeArticles?:boolean}} options
 */
export async function checkLinks({ origin, limit = 10 } = {}) {
  const size = Math.max(1, Math.min(MAX_TARGETS, Number(limit) || 10))
  const key = `${origin}|${size}`
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ...hit.data, cached: true }
  }

  let articlePaths = []
  try {
    const { rows } = await readArticleIndex()
    articlePaths = rows
      .map(row => normalizePath(row.url || (row.slug ? `/article/${row.slug}` : '')))
      .filter(Boolean)
  } catch (err) {
    articlePaths = []
  }

  const targets = [...new Set([...STATIC_PATHS, ...articlePaths])].slice(0, size)
  const rows = await runPool(
    targets.map(path => () => probe(origin, path)),
    CONCURRENCY
  )

  const broken = rows.filter(row => !row.ok && (row.status === 404 || row.status === 410))
  const errors = rows.filter(row => row.status === 0)

  const data = {
    checkedAt: new Date().toISOString(),
    origin,
    targets: targets.length,
    rows,
    summary: {
      ok: rows.filter(row => row.ok).length,
      broken: broken.length,
      errors: errors.length,
      redirects: rows.filter(row => row.redirect).length
    },
    notes: [
      '只检查本站同源页面，不扫描第三方链接。',
      '每次最多 20 个 URL、并发 4、结果缓存 10 分钟。',
      '重定向算"可访问"，但在表格里单独标注，便于发现失效的旧链接。'
    ]
  }

  cache.set(key, { at: Date.now(), data })
  return { ...data, cached: false }
}

const FILE_CACHE_TTL_MS = 10 * 60 * 1000
const fileCache = new Map()

/**
 * 探测同源的静态 SEO 文件（robots.txt / sitemap.xml）
 * 只读 GET，10 分钟缓存；失败不抛错，按"不可用"返回。
 */
export async function probeFiles({ origin, paths = ['/robots.txt', '/sitemap.xml'] } = {}) {
  const key = `${origin}|${paths.join(',')}`
  const hit = fileCache.get(key)
  if (hit && Date.now() - hit.at < FILE_CACHE_TTL_MS) {
    return { files: hit.data, cached: true }
  }
  const files = await runPool(
    paths.map(path => async () => {
      const result = await probe(origin, path)
      return { path, status: result.status, ok: result.ok, ms: result.ms, error: result.error }
    }),
    2
  )
  fileCache.set(key, { at: Date.now(), data: files })
  return { files, cached: false }
}
