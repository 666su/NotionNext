/**
 * GET/POST /api/telegram/diag —— Telegram 连通性诊断（需 webhook secret）
 *
 * 用途：部署在 Vercel 上时，判断"发不出去"到底是
 *   ① 变量没配、② DNS/TCP 不通、③ TLS 卡住、④ Telegram 返回错误、⑤ 太慢超过超时。
 *
 * 鉴权：请求头 X-Telegram-Bot-Api-Secret-Token 必须等于 TELEGRAM_WEBHOOK_SECRET。
 * 返回：只报告阶段耗时与 Telegram 的 description，**不返回 token/secret**。
 */

import { readTgConfig } from '@/lib/messages/telegram'

const STAGES = [
  ['dns', 'DNS 解析'],
  ['tcp', 'TCP 连接'],
  ['tls', 'TLS 握手'],
  ['ttfb', '等待首字节'],
  ['body', '读取响应']
]

async function probe(url, timeoutMs) {
  const started = Date.now()
  const marks = {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, { signal: controller.signal, cache: 'no-store' })
    marks.ttfb = Date.now() - started
    const text = await res.text()
    marks.body = Date.now() - started
    let json = null
    try {
      json = JSON.parse(text)
    } catch (err) {
      json = null
    }
    return {
      ok: res.ok,
      status: res.status,
      elapsedMs: Date.now() - started,
      marks,
      description: json?.description || null,
      result: json?.result ? { id: json.result.id, username: json.result.username } : null
    }
  } catch (err) {
    return {
      ok: false,
      status: 0,
      elapsedMs: Date.now() - started,
      marks,
      error: err?.name === 'AbortError' ? `timeout_${timeoutMs}ms` : `${err?.name || 'Error'}: ${err?.message || ''}`.slice(0, 160)
    }
  } finally {
    clearTimeout(timer)
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Robots-Tag', 'noindex, nofollow')

  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ ok: false, error: 'method_not_allowed' })
  }

  const cfg = readTgConfig()
  if (!cfg.webhookSecret) return res.status(503).json({ ok: false, error: 'webhook_not_configured' })

  const secret = String(req.headers['x-telegram-bot-api-secret-token'] || '')
  if (secret !== cfg.webhookSecret) return res.status(403).json({ ok: false, error: 'forbidden' })

  const timeoutMs = Math.min(9000, Math.max(1500, Number(req.query?.timeout) || 8000))
  const base = `${cfg.apiBase}/bot${cfg.token || 'x'}/getMe`

  const report = {
    ok: true,
    env: {
      hasToken: Boolean(cfg.token),
      hasChatId: Boolean(cfg.chatId),
      apiBase: cfg.apiBase,
      isLocalApiBase: /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(cfg.apiBase),
      nodeEnv: process.env.NODE_ENV,
      region: process.env.VERCEL_REGION || null
    },
    stages: STAGES.map(([key, label]) => ({ key, label })),
    probes: []
  }

  if (!cfg.token) {
    report.ok = false
    report.error = 'token_missing'
    return res.status(200).json(report)
  }

  report.probes.push({ name: 'telegram_getMe', ...(await probe(base, timeoutMs)) })
  report.probes.push({
    name: 'control_cloudflare',
    ...(await probe('https://www.cloudflare.com/cdn-cgi/trace', timeoutMs))
  })

  return res.status(200).json(report)
}
