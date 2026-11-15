/**
 * 访客端私信的最小请求封装（浏览器侧）
 *
 * 约定：所有请求都 same-origin + credentials，绝不把 token 放进 query。
 */

export async function postJson(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    credentials: 'same-origin',
    cache: 'no-store'
  })
  let data = null
  try {
    data = await response.json()
  } catch (err) {
    data = null
  }
  return { ok: response.ok, status: response.status, data }
}

export async function getJson(path) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store'
  })
  let data = null
  try {
    data = await response.json()
  } catch (err) {
    data = null
  }
  return { ok: response.ok, status: response.status, data }
}

export function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  return date.toLocaleString('zh-CN', {
    hour12: false,
    ...(sameDay ? { hour: '2-digit', minute: '2-digit' } : { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  })
}

/** 复制到剪贴板（带 http 环境的兜底） */
export async function copyText(text) {
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch (err) {
    /* 落回下面的兜底 */
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch (err) {
    return false
  }
}

/** 清掉 URL 上的 #token（兑换后立即执行） */
export function clearHash() {
  if (typeof window === 'undefined') return
  if (!window.location.hash) return
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch (err) {
    /* 忽略 */
  }
}

export const ERROR_TEXT = {
  invalid_credential: '这个私密链接无效，或已经过期了。请重新打开你保存的那条链接。',
  not_found: '这个会话不存在，可能已被删除。',
  rate_limited: '操作太频繁了，请稍后再试。',
  invalid_name: '昵称需要 1–40 个字符。',
  invalid_email: '邮箱格式看起来不对。',
  invalid_content: '消息内容不能为空。',
  payload_too_large: '内容太长了（最多 5000 字）。',
  conversation_full: '这个会话消息太多了，请新建一个会话。',
  messages_unavailable: '私信服务暂时不可用，请稍后再试。',
  messages_disabled: '私信功能当前已关闭。',
  store_unavailable: '服务暂时不可用，内容已保留，请稍后重试。',
  network: '网络异常，请检查连接后重试。'
}

export function errorText(code, status) {
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code]
  if (status === 403) return ERROR_TEXT.invalid_credential
  if (status === 429) return ERROR_TEXT.rate_limited
  if (status >= 500) return ERROR_TEXT.store_unavailable
  return '发生了未知错误，请稍后重试。'
}
