/**
 * 后台数据页共用的取数 hook
 *
 * - 统一走 /api/admin/stats/report（一次请求拿全，减少往返）
 * - 统一 loading / error / 空状态语义：**失败不显示 0**，而是明确报错
 * - 时间范围与 URL query 同步（?range=7d），可分享、可刷新保持
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/router'
import { adminFetch } from '@/lib/admin/client'

export const REPORT_RANGES = ['today', 'yesterday', '7d', '30d', '90d']

const ERROR_TEXT = {
  stats_store_unavailable: '统计存储暂不可用（Redis 连接失败或未配置），因此无法显示数字。',
  unauthorized: '会话已失效，请重新登录。',
  invalid_range: '时间范围参数不合法。'
}

/** 读取 ?range= 并与 URL 同步 */
export function useRangeParam(fallback = '7d') {
  const router = useRouter()
  const raw = typeof router.query?.range === 'string' ? router.query.range : ''
  const range = REPORT_RANGES.includes(raw) ? raw : fallback

  const setRange = useCallback(
    next => {
      if (!REPORT_RANGES.includes(next)) return
      const query = { ...router.query, range: next }
      router.replace({ pathname: router.pathname, query }, undefined, { shallow: true })
    },
    [router]
  )

  return [range, setRange]
}

/**
 * @param {string} range
 * @returns {{data:object|null, loading:boolean, error:string|null, reload:Function, updatedAt:number}}
 */
export function useAdminReport(range) {
  const [state, setState] = useState({ data: null, loading: true, error: null, updatedAt: 0 })
  const requestId = useRef(0)

  const load = useCallback(async () => {
    const current = ++requestId.current
    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const { ok, status, data } = await adminFetch(
        `/api/admin/stats/report?range=${encodeURIComponent(range)}`
      )
      if (current !== requestId.current) return
      if (!ok || !data?.ok) {
        const code = data?.error || (status === 401 ? 'unauthorized' : 'request_failed')
        setState({
          data: null,
          loading: false,
          error: ERROR_TEXT[code] || `取数失败（HTTP ${status}）。`,
          updatedAt: Date.now()
        })
        return
      }
      setState({ data, loading: false, error: null, updatedAt: Date.now() })
    } catch (err) {
      if (current !== requestId.current) return
      setState({
        data: null,
        loading: false,
        error: '网络请求失败，请稍后重试。',
        updatedAt: Date.now()
      })
    }
  }, [range])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
    }
  }, [load])

  return { ...state, reload: load }
}

/** 通用取数 hook（分类/评论/同步状态等非 report 端点） */
export function useAdminJson(url, { enabled = true } = {}) {
  const [state, setState] = useState({ data: null, loading: !!enabled, error: null })
  const requestId = useRef(0)

  const load = useCallback(async () => {
    if (!enabled) return
    const current = ++requestId.current
    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const { ok, status, data } = await adminFetch(url)
      if (current !== requestId.current) return
      if (!ok) {
        setState({
          data: null,
          loading: false,
          error: ERROR_TEXT[data?.error] || `取数失败（HTTP ${status}）。`
        })
        return
      }
      setState({ data, loading: false, error: null })
    } catch (err) {
      if (current !== requestId.current) return
      setState({ data: null, loading: false, error: '网络请求失败，请稍后重试。' })
    }
  }, [url, enabled])

  useEffect(() => {
    void load()
    return () => {
      requestId.current += 1
    }
  }, [load])

  return { ...state, reload: load }
}
