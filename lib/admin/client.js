/**
 * 后台前端公用请求工具（浏览器端）
 * - 自动带 CSRF header（双提交 == jba_csrf Cookie）
 * - 统一处理 401（跳登录）与 429（限流）
 */

'use client'

export function getCookie(name) {
  if (typeof document === 'undefined') return ''
  const match = document.cookie.match(
    new RegExp('(?:^|; )' + name.replace(/([.*+?^${}()|[\]\\])/g, '\\$1') + '=([^;]*)')
  )
  return match ? decodeURIComponent(match[1]) : ''
}

export function getCsrfToken() {
  return getCookie('jba_csrf')
}

export async function adminFetch(path, options = {}) {
  const { method = 'GET', body, csrf = true, headers = {} } = options
  const finalHeaders = { ...headers }
  if (body !== undefined) finalHeaders['Content-Type'] = 'application/json'
  if (csrf && method !== 'GET') {
    const token = getCsrfToken()
    if (token) finalHeaders['x-csrf-token'] = token
  }

  const response = await fetch(path, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
    cache: 'no-store'
  })

  let payload = null
  try {
    payload = await response.json()
  } catch (err) {
    payload = null
  }

  if (response.status === 401 && typeof window !== 'undefined') {
    const next = window.location.pathname + window.location.search
    window.location.href = `/admin/login?next=${encodeURIComponent(next)}`
  }

  return { ok: response.ok, status: response.status, data: payload }
}
