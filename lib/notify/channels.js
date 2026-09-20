/**
 * 新增推送通知功能 - 各渠道发送器
 * 支持：Telegram 机器人 / Server酱（微信）/ 企业微信·钉钉·自定义 Webhook
 */

const TELEGRAM_API = 'https://api.telegram.org/bot'
const SERVERCHAN_API = 'https://sctapi.ftqq.com'

/**
 * 构造通知消息
 * @param {object} post  文章数据
 * @param {string} siteTitle  站点标题
 * @param {string} siteUrl    站点根地址
 */
export function buildMessage(post, siteTitle, siteUrl) {
  const title = post.title || '博客更新'
  const url = `${siteUrl}${post.href || '/'}`
  const summary = (post.summary || post.description || '').slice(0, 200)
  return { title, url, summary }
}

// ========== Telegram 机器人 ==========

export async function sendTelegram({ title, url, summary }) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    return { ok: false, reason: '未配置 TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID' }
  }
  try {
    const text = `📢 博客更新：${title}\n🔗 ${url}${summary ? `\n\n${summary}` : ''}`
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

// ========== Server酱（微信推送）==========

export async function sendServerChan({ title, url, summary }) {
  const key = process.env.SERVERCHAN_SENDKEY
  if (!key) {
    return { ok: false, reason: '未配置 SERVERCHAN_SENDKEY' }
  }
  try {
    const desp = `[${title}](${url})${summary ? `\n\n${summary}` : ''}`
    const params = new URLSearchParams({ title: `📢 ${title}`, desp })
    const res = await fetch(`${SERVERCHAN_API}/${key}.send`, {
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

// ========== Webhook（企业微信 / 钉钉 / 自定义）==========

export async function sendWebhook({ title, url, summary }) {
  const hookUrl = process.env.PUSH_WEBHOOK_URL
  if (!hookUrl) {
    return { ok: false, reason: '未配置 PUSH_WEBHOOK_URL' }
  }
  try {
    const textContent = `📢 博客更新：${title}\n🔗 ${url}${summary ? `\n\n${summary}` : ''}`
    let payload
    let successCheck

    // 企业微信群机器人
    if (hookUrl.includes('qyapi.weixin.qq.com')) {
      payload = { msgtype: 'text', text: { content: textContent } }
      successCheck = json => json.errcode === 0
    } else if (hookUrl.includes('oapi.dingtalk.com')) {
      // 钉钉自定义机器人
      payload = { msgtype: 'text', text: { content: textContent } }
      successCheck = json => json.errcode === 0
    } else {
      // 自定义 Webhook：发送通用 JSON
      payload = { title, url, content: summary, source: 'notion-next' }
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

// ========== Web Push（浏览器推送）==========

export async function sendWebPush({ title, url, summary }) {
  const { getVapidKeys, setVapidKeys } = await import('./storage.js')
  const { generateVapidKeys, sendWebPushAll } = await import('./webpush.js')

  // 加载或生成 VAPID 密钥
  let keys = await getVapidKeys()
  const envPk = process.env.VAPID_PUBLIC_KEY
  const envSk = process.env.VAPID_PRIVATE_KEY
  if (envPk && envSk) {
    keys = { publicKey: envPk, privateKey: envSk }
  } else if (!keys) {
    keys = generateVapidKeys()
    await setVapidKeys(keys)
    console.log('[notify] VAPID 密钥已自动生成并存储')
  }

  const payload = {
    title,
    body: summary || `点击查看详情：${title}`,
    url
  }
  const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@localhost'
  return sendWebPushAll(payload, keys, vapidSubject).then(result => ({
    ok: true,
    sent: result.sent,
    removed: result.removed
  }))
}
