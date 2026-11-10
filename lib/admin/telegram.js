/**
 * Telegram 推送（Phase 6）
 *
 * - token **只在服务端使用**，绝不下发到浏览器、绝不写日志；
 * - `TELEGRAM_API_BASE` 可覆盖（默认官方 API），便于用本地桩做端到端测试；
 * - 只发送纯文本/极简 HTML，不发送用户隐私数据（统计里本来就没有 IP / 设备指纹）。
 */

const DEFAULT_BASE = 'https://api.telegram.org'
const MAX_TEXT = 3900 // Telegram 上限 4096，留出余量

export function readTelegramConfig() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  const chatId = String(process.env.TELEGRAM_CHAT_ID || '').trim()
  const baseUrl = String(process.env.TELEGRAM_API_BASE || DEFAULT_BASE).replace(/\/+$/, '')
  return {
    configured: !!token && !!chatId,
    token,
    chatId,
    baseUrl,
    missing: [
      token ? null : 'TELEGRAM_BOT_TOKEN',
      chatId ? null : 'TELEGRAM_CHAT_ID'
    ].filter(Boolean)
  }
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

/**
 * @param {{text:string, disablePreview?:boolean}} payload
 * @returns {Promise<{ok:boolean, reason?:string, status?:number, messageId?:number}>}
 */
export async function sendTelegram({ text, disablePreview = true } = {}) {
  const config = readTelegramConfig()
  if (!config.configured) {
    return { ok: false, reason: 'not_configured', missing: config.missing }
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
      signal: AbortSignal.timeout(10000)
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
        reason: data?.description ? 'upstream_error' : `http_${response.status}`,
        status: response.status
      }
    }

    return {
      ok: true,
      status: response.status,
      messageId: data?.result?.message_id
    }
  } catch (err) {
    console.error('[telegram] request failed:', err?.message || err)
    return { ok: false, reason: 'request_failed' }
  }
}
