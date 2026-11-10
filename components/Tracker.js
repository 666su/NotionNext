/**
 * 统计 SDK 挂载点
 * 只在公开页面渲染（由 pages/_app.js 的后台分支排除 /admin）。
 * 空闲时加载，失败静默，不影响首屏。
 */

import { useEffect } from 'react'
import { useRouter } from 'next/router'

export default function Tracker() {
  const router = useRouter()

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    let cancelled = false
    let detach = null

    const boot = () => {
      import('@/lib/analytics/client/tracker')
        .then(mod => {
          if (cancelled) return
          try {
            mod.startTracker()
            const onChange = path => {
              try {
                mod.trackPageView(path)
              } catch (err) {
                /* ignore */
              }
            }
            router.events.on('routeChangeComplete', onChange)
            detach = () => router.events.off('routeChangeComplete', onChange)
          } catch (err) {
            /* 统计失败不打扰用户 */
          }
        })
        .catch(() => {})
    }

    const idle =
      window.requestIdleCallback ||
      (cb => window.setTimeout(cb, 1500))
    idle(boot)

    return () => {
      cancelled = true
      if (detach) detach()
    }
  }, [router])

  return null
}
