/**
 * Telegram 推送（Phase 6 / 6.1）
 *
 * - token **只在服务端使用**，绝不下发到浏览器、绝不写日志；
 * - `TELEGRAM_API_BASE` 可覆盖（默认官方 API），便于用本地桩做端到端测试；
 * - 只发送纯文本/极简 HTML，不发送用户隐私数据（统计里本来就没有 IP / 设备指纹）。
 *
 * Phase 6.1 增强：失败原因细分到可操作的程度，并提供 getMe 连通性自检。
 */

const DEFAULT_BASE = 'https://api.telegram.org'
const MAX_TEXT = 3900 // Telegram 上限 4096，留出余量

export function readTelegramConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim()
  const baseUrl = String(process.env.TELEGRAM_API_BASE || DEFAULT_BASE).replace(/\/+$/, '')
  let baseHost = baseUrl
  try {
    baseHost = new URL(baseUrl).host
  } catch (err) {
    baseHost = baseUrl
  }
  return {
    configured: !!token && !!chatId,
    token,
    chatId,
    baseUrl,
    baseHost,
    // 只有测试环境才应该出现本地/内网地址
    localBase: /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/i.test(baseHost),
    missing: [
      token ? null : 'TELEGRAM_BOT_TOKEN',
      chatId ? null : 'TELEGRAM_CHAT_ID'
    ].filter(Boolean)
  }
}

function isProductionLike() {
  return process.env.NODE_ENV === 'production' || !!process.env.VERCEL_ENV
}

/** HTML 转义（parse_mode=HTML 只允许少量标签） */
export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function clamp(text) {
  const value = String(text || '')
  return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT - 20)}\n…（已截断）` : value
}

/** 把底层错误压成一个可操作的代号（不含 token、不含完整 URL） */
function describeError(err) {
  const code = String(err?.code || err?.name || '').toUpperCase()
  if (code.includes('TIMEOUT') || code.includes('ABORT')) return 'timeout'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'dns_failed'
  if (code === 'ECONNREFUSED') return 'connection_refused'
  if (code === 'ECONNRESET') return 'connection_reset'
  if (code.includes('CERT')) return 'tls_error'
  return 'network_error'
}

/**
 * 连通性自检：GET /getMe（不发送任何消息）
 * @returns {Promise<{ok:boolean, username?:string, id?:number, reason?:string, detail?:string}>}
 */
export async function getBotInfo() {
  const config = readTelegramConfig()
  if (!config.token) return { ok: false, reason: 'not_configured', missing: config.missing }
  if (config.localBase && isProductionLike()) {
    return { ok: false, reason: 'local_base_in_production', detail: config.baseHost }
  }

  try {
    const response = await fetch(`${config.baseUrl}/bot${config.token}/getMe`, {
      method: 'GET',
      signal: AbortSignal.timeout(8000),
      cache: 'no-store'
    })
    let data = null
    try {
      data = await response.json()
    } catch (err) {
      data = null
    }
    if (!response.ok || data?.ok === false) {
      return {
        ok: false,
        reason: 'upstream_error',
        detail: String(data?.description || `http_${response.status}`).slice(0, 120)
      }
    }
    return {
      ok: true,
      id: data?.result?.id,
      username: data?.result?.username,
      status: response.status
    }
  } catch (err) {
    console.error('[telegram] getMe failed:', err?.code || err?.name || err?.message || err)
    return { ok: false, reason: 'request_failed', detail: describeError(err) }
  }
}

/**
 * @param {{text:string, disablePreview?:boolean}} payload
 * @returns {Promise<{ok:boolean, reason?:string, detail?:string, status?:number, messageId?:number}>}
 */
export async function sendTelegram({ text, disablePreview = true } = {}) {
  const config = readTelegramConfig()
  if (!config.configured) {
    return { ok: false, reason: 'not_configured', missing: config.missing }
  }
  if (config.localBase && isProductionLike()) {
    // 最常见的误配：把本地测试桩的地址带到了生产
    return { ok: false, reason: 'local_base_in_production', detail: config.baseHost }
  }
  if (!String(text || '').trim()) return { ok: false, reason: 'empty_text' }

  try {
    const response = await fetch(`${config.baseUrl}/bot${config.token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: clamp(text),
        parse_mode: 'HTML',
        disable_web_page_preview: disablePreview
      }),
      signal: AbortSignal.timeout(12000)
    })

    let data = null
    try {
      data = await response.json()
    } catch (err) {
      data = null
    }

    if (!response.ok || data?.ok === false) {
      console.error('[telegram] send failed:', response.status, data?.description || '')
      return {
        ok: false,
        reason: 'upstream_error',
        detail: String(data?.description || `http_${response.status}`).slice(0, 160),
        status: response.status
      }
    }

    return {
      ok: true,
      status: response.status,
      messageId: data?.result?.message_id
    }
  } catch (err) {
    console.error('[telegram] request failed:', err?.code || err?.name || err?.message || err)
    return { ok: false, reason: 'request_failed', detail: describeError(err) }
  }
}
