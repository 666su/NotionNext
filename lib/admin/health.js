/**
 * 网站健康检查（Phase 5）
 *
 * 只做**低频、同源、只读**探测：不对第三方站点扫描，不对每个访客触发。
 * 结果在进程内缓存 3 分钟，避免后台刷新把源站打热。
 */

import { K } from '@/lib/analytics/constants'
import { readAdminConfig } from '@/lib/admin/config'
import { readSyncLog } from '@/lib/admin/sync/notion-sync'
import { getTwikooEndpoint } from '@/lib/admin/twikoo'
import { kvGet, kvPing } from '@/lib/kv'

const CACHE_TTL_MS = 3 * 60 * 1000
let cache = { at: 0, data: null }

async function probe(url) {
  const started = Date.now()
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: { 'x-health-check': 'jason-blog-admin' }
    })
    return {
      url,
      status: response.status,
      ok: response.status >= 200 && response.status < 400,
      ms: Date.now() - started
    }
  } catch (err) {
    return {
      url,
      status: 0,
      ok: false,
      ms: Date.now() - started,
      error: err?.message || 'request_failed'
    }
  }
}

export async function collectHealth({ origin }) {
  if (cache.data && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ...cache.data, cached: true }
  }

  const config = readAdminConfig()

  const [redisOk, statsStartedAt, syncLog, home, archive] = await Promise.all([
    kvPing(),
    kvGet(K.startedAt).catch(() => null),
    readSyncLog(5).catch(() => []),
    probe(`${origin}/`),
    probe(`${origin}/archive`)
  ])

  const lastSync = syncLog.find(item => item?.status === 'ok') || null
  const lastError = syncLog.find(item => item?.status === 'error') || null

  const data = {
    checkedAt: new Date().toISOString(),
    probes: [home, archive],
    store: {
      backend: config.backend,
      reachable: redisOk
    },
    admin: {
      ready: config.ready,
      missing: config.missing,
      warnings: config.warnings
    },
    stats: {
      collectionStartedAt: statsStartedAt || null
    },
    notion: {
      lastSyncAt: lastSync?.finishedAt || null,
      lastSyncCounts: lastSync?.counts || null,
      lastErrorAt: lastError?.finishedAt || null,
      lastError: lastError?.error || null
    },
    twikoo: {
      configured: !!getTwikooEndpoint()
    },
    deployment: {
      env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
      commit: (process.env.VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null,
      url: process.env.VERCEL_URL || null,
      region: process.env.VERCEL_REGION || null
    }
  }

  cache = { at: Date.now(), data }
  return { ...data, cached: false }
}
