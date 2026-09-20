/**
 * 新增推送通知功能 - 各渠道发送器（读者自选，配置由读者自己填写）
 */
const TELEGRAM_API = 'https://api.telegram.org/bot'
const SERVERCHAN_API = 'https://sctapi.ftqq.com'

/**
 * 构造通知消息
 */
export function buildMessage(post, siteTitle, siteUrl) {
  const title = post.title || '博客更新'
  const url = `${siteUrl}${post.href || '/'}`
  const summary = (post.summary || post.description || '').slice(0, 200)
  return { title, url, summary }
}

// ========== Telegram ==========
export async function sendTelegram(msg, { token, chatId }) {
  if (!token || !chatId) return { ok: false, reason: '缺少 token 或 chatId' }
  try {
    const text = `📢 博客更新：${msg.title}\n🔗 ${msg.url}${msg.summary ? `\n\n${msg.summary}` : ''}`
    const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true })
    })
    const json = await res.json().catch(() => ({}))
    return { ok: json.ok === true, reason: json.description }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

// ========== Server酱（微信）==========
export async function sendServerChan(msg, { sendKey }) {
  if (!sendKey) return { ok: false, reason: '缺少 SendKey' }
  try {
    const desp = `[${msg.title}](${msg.url})${msg.summary ? `\n\n${msg.summary}` : ''}`
    const params = new URLSearchParams({ title: `📢 ${msg.title}`, desp })
    const res = await fetch(`${SERVERCHAN_API}/${sendKey}.send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })
    const json = await res.json().catch(() => ({}))
    return { ok: json.code === 0, reason: json.message || `HTTP ${json.code}` }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}

// ========== Web Push（浏览器）==========
export async function sendWebPush(subscription, msg, vapidKeys, vapidSubject) {
  const { sendWebPushTo } = await import('./webpush.js')
  try {
    await sendWebPushTo(
      { endpoint: subscription.config.endpoint, keys: subscription.config.keys },
      { title: msg.title, body: msg.summary || msg.title, url: msg.url },
      vapidKeys,
      vapidSubject
    )
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e.message, statusCode: e.statusCode }
  }
}

// ========== 博主侧 Webhook（可选，博主在 Vercel 配置）==========
export async function sendWebhook(msg) {
  const hookUrl = process.env.PUSH_WEBHOOK_URL
  if (!hookUrl) return { ok: false, reason: '未配置' }
  try {
    const textContent = `📢 博客更新：${msg.title}\n🔗 ${msg.url}${msg.summary ? `\n\n${msg.summary}` : ''}`
    let payload
    let successCheck
    if (hookUrl.includes('qyapi.weixin.qq.com')) {
      payload = { msgtype: 'text', text: { content: textContent } }
      successCheck = j => j.errcode === 0
    } else if (hookUrl.includes('oapi.dingtalk.com')) {
      payload = { msgtype: 'text', text: { content: textContent } }
      successCheck = j => j.errcode === 0
    } else {
      payload = { title: msg.title, url: msg.url, content: msg.summary, source: 'notion-next' }
      successCheck = () => true
    }
    const res = await fetch(hookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const json = await res.json().catch(() => ({}))
    return { ok: successCheck(json), reason: json.errmsg || json.message || res.statusText }
  } catch (e) {
    return { ok: false, reason: e.message }
  }
}
