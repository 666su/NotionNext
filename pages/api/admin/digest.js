/**
 * GET/POST /api/admin/digest —— 每日总结的预览与手动推送（Phase 6）
 *
 * GET  ?dayKey=20261109   → 只生成，不发（预览）
 * POST { dayKey?, send? } → 生成并（可选）推送；需要 CSRF
 * GET  ?log=1             → 最近发送日志 + 配置状态
 *
 * 注意：token 只在服务端使用；接口只返回"是否配置"，不返回任何密钥。
 */

import { formatDigestText, readDigestConfig, readDigestLog, runDailyDigest } from '@/lib/admin/digest'
import { buildDailyFacts } from '@/lib/admin/digest'
import { summarizeDigest } from '@/lib/admin/ai'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'

const COOLDOWN_KEY = 'admin:digest:cooldown'
const COOLDOWN_SEC = 60

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method === 'GET') {
    const guard = await requireAdminApi(req, res)
    if (!guard) return null

    if (req.query?.log) {
      const [log, config] = await Promise.all([readDigestLog(10), Promise.resolve(readDigestConfig())])
      return json(res, 200, { ok: true, log, config })
    }

    try {
      const dayKey = typeof req.query?.dayKey === 'string' ? req.query.dayKey : undefined
      const facts = await buildDailyFacts(dayKey)
      const ai = await summarizeDigest(facts)
      return json(res, 200, {
        ok: true,
        day: facts.date,
        facts,
        ai: { ok: !!ai.ok, reason: ai.reason || null, model: ai.model || null },
        text: formatDigestText(facts, ai),
        config: readDigestConfig()
      })
    } catch (err) {
      console.error('[admin][digest] preview failed:', err?.message || err)
      return json(res, 503, { error: 'digest_unavailable' })
    }
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res, { csrf: true })
  if (!guard) return null

  // 轻量冷却：手动推送 60 秒内只允许一次，避免误点刷屏
  try {
    const { kvSetnx } = await import('@/lib/kv')
    const acquired = await kvSetnx(COOLDOWN_KEY, String(Date.now()), COOLDOWN_SEC)
    if (!acquired) {
      return json(res, 429, { error: 'digest_too_frequent', retryAfter: COOLDOWN_SEC })
    }
  } catch (err) {
    console.warn('[admin][digest] cooldown store error:', err?.message || err)
  }

  try {
    const dayKey = typeof req.body?.dayKey === 'string' ? req.body.dayKey : undefined
    const send = req.body?.send !== false
    const result = await runDailyDigest({ dayKey, send })
    return json(res, 200, {
      ok: true,
      day: result.facts.date,
      pv: result.facts.pv,
      uv: result.facts.uv,
      ai: result.ai,
      delivery: result.delivery,
      text: result.text
    })
  } catch (err) {
    console.error('[admin][digest] send failed:', err?.message || err)
    return json(res, 503, { error: 'digest_failed' })
  }
}
