/**
 * 统计 SDK（浏览器端）
 *
 * 约束（PROJECT_SPEC 六）：
 * - 异步、空闲加载；失败静默；不产生无限重试
 * - 匿名 ID（第一方 localStorage），不使用 IP / 指纹 / 邮箱
 * - Session：30 分钟无活动即新会话
 * - 支持 SPA 路由切换；同一路径 1 秒内不重复上报
 * - 总包保持轻量（无第三方依赖）
 */

const AID_KEY = 'jba_aid'
const SESSION_KEY = 'jba_sid'
const SESSION_TS_KEY = 'jba_ts'
const OPTOUT_KEY = 'jba_optout'
const SESSION_IDLE_MS = 30 * 60 * 1000
const FLUSH_INTERVAL_MS = 5000
const MAX_QUEUE = 20

const state = {
  started: false,
  queue: [],
  timer: null,
  lastPath: '',
  lastPathAt: 0,
  scrollFlags: new Set(),
  bound: false
}

function randId(bytes = 16) {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID().replace(/-/g, '').slice(0, 32)
    }
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      const buf = new Uint8Array(bytes)
      crypto.getRandomValues(buf)
      return Array.from(buf, b => b.toString(16).padStart(2, '0')).join('')
    }
  } catch (err) {
    /* ignore */
  }
  return `f${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`.slice(0, 32)
}

function readStore(store, key) {
  try {
    return store.getItem(key) || ''
  } catch (err) {
    return ''
  }
}

function writeStore(store, key, value) {
  try {
    store.setItem(key, value)
  } catch (err) {
    /* 隐私模式下可能抛错，忽略 */
  }
}

function anonymousId() {
  let id = readStore(window.localStorage, AID_KEY)
  if (!id) {
    id = randId()
    writeStore(window.localStorage, AID_KEY, id)
  }
  return id
}

function sessionId() {
  const now = Date.now()
  const last = Number(readStore(window.sessionStorage, SESSION_TS_KEY) || 0)
  let id = readStore(window.sessionStorage, SESSION_KEY)
  let fresh = false
  if (!id || !last || now - last > SESSION_IDLE_MS) {
    id = randId()
    fresh = true
    writeStore(window.sessionStorage, SESSION_KEY, id)
  }
  writeStore(window.sessionStorage, SESSION_TS_KEY, String(now))
  return { id, fresh }
}

function push(event) {
  if (state.queue.length >= MAX_QUEUE) state.queue.shift()
  state.queue.push(event)
}

function emit(name, props = {}, extra = {}) {
  const session = sessionId()
  if (session.fresh && name !== 'session_start') {
    push({
      event_id: randId(),
      event_name: 'session_start',
      anonymous_id: anonymousId(),
      session_id: session.id,
      page_path: window.location.pathname,
      occurred_at: new Date().toISOString()
    })
  }
  push({
    event_id: randId(),
    event_name: name,
    anonymous_id: anonymousId(),
    session_id: session.id,
    page_path: window.location.pathname,
    article_id: extra.articleId || currentArticleId(),
    occurred_at: new Date().toISOString(),
    props
  })
  scheduleFlush()
}

function currentArticleId() {
  try {
    return (window.__JBA_PAGE__ && window.__JBA_PAGE__.articleId) || ''
  } catch (err) {
    return ''
  }
}

function scheduleFlush() {
  if (state.timer) return
  state.timer = window.setTimeout(() => {
    state.timer = null
    flush()
  }, FLUSH_INTERVAL_MS)
}

export function flush() {
  if (!state.queue.length) return
  const events = state.queue.splice(0, state.queue.length)
  const body = JSON.stringify({
    events,
    referrer_host: referrerHost()
  })
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' })
      const ok = navigator.sendBeacon('/api/track', blob)
      if (ok) return
    }
  } catch (err) {
    /* fallthrough */
  }
  try {
    fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      credentials: 'same-origin'
    }).catch(() => {})
  } catch (err) {
    /* 静默丢弃，不重试 */
  }
}

function referrerHost() {
  try {
    if (!document.referrer) return ''
    return new URL(document.referrer).hostname.toLowerCase()
  } catch (err) {
    return ''
  }
}

function onScroll() {
  const doc = document.documentElement
  if (!doc) return
  const total = doc.scrollHeight - window.innerHeight
  if (total <= 0) return
  const percent = Math.min(100, Math.round((window.scrollY / total) * 100))
  ;[25, 50, 75, 90].forEach(bucket => {
    const key = `${window.location.pathname}:${bucket}`
    if (percent >= bucket && !state.scrollFlags.has(key)) {
      state.scrollFlags.add(key)
      emit('scroll_depth', { depth: bucket })
    }
  })
}

function onClick(event) {
  const anchor = event.target && event.target.closest ? event.target.closest('a') : null
  if (!anchor) return
  const href = anchor.getAttribute('href') || ''
  if (!href) return

  if (href.startsWith('/category/')) {
    emit('category_click', { path: href.slice(0, 200) })
    return
  }
  if (href.startsWith('/tag/')) {
    emit('tag_click', { path: href.slice(0, 200) })
    return
  }
  try {
    const url = new URL(anchor.href, window.location.origin)
    if (url.origin !== window.location.origin) {
      emit('outbound_click', { target_host: url.hostname.slice(0, 100) })
    }
  } catch (err) {
    /* ignore */
  }
}

function bindGlobalListeners() {
  if (state.bound) return
  state.bound = true
  window.addEventListener('scroll', onScroll, { passive: true })
  document.addEventListener('click', onClick, true)
  window.addEventListener('pagehide', flush)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush()
  })
}

/** 上报一次页面浏览（SPA 路由切换时也要调用） */
export function trackPageView(path) {
  if (!state.started) return
  const now = Date.now()
  if (path === state.lastPath && now - state.lastPathAt < 1000) return
  state.lastPath = path
  state.lastPathAt = now
  emit('page_view')
  if (path.startsWith('/article/')) {
    emit('article_read')
  }
}

/** 供搜索/评论/桌宠等组件在后续阶段调用 */
export function trackEvent(name, props = {}) {
  if (!state.started) return
  emit(name, props)
}

export function startTracker() {
  if (state.started || typeof window === 'undefined') return
  try {
    if (readStore(window.localStorage, OPTOUT_KEY) === '1') return
  } catch (err) {
    /* ignore */
  }
  state.started = true
  bindGlobalListeners()
  sessionId()
  trackPageView(window.location.pathname)
}
