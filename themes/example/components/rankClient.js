'use client'

import { useEffect, useState } from 'react'

/**
 * 新增排行榜与点赞功能 - 客户端数据层
 *
 * 设计：文章页上「顶部阅读量」「顶部点赞按钮」「文末点赞按钮」需要同一份数据。
 * 这里用一个模块级 store 做请求去重与状态同步：
 *  - ArticleInteraction 是唯一的「触发方」，负责带 record=1 请求一次（顺带记录浏览）
 *  - PostViews / LikeButton 是「订阅方」，只读 store，不再发请求
 * 这样一篇文章详情页只会产生一次互动数据请求，且两处按钮状态永远一致。
 */

const infoCache = new Map() // postId -> { views, likes, liked, recorded }
const inflight = new Map() // postId -> Promise
const listeners = new Map() // postId -> Set<Function>
const recordedOnce = new Set() // 本次会话已记录过浏览的文章

function notify(postId) {
  const set = listeners.get(postId)
  if (!set) return
  const data = infoCache.get(postId)
  set.forEach(cb => {
    try {
      cb(data)
    } catch {
      // 单个订阅者异常不影响其它订阅者
    }
  })
}

export function getRankInfo(postId) {
  return infoCache.get(postId) || null
}

export function setRankInfo(postId, patch) {
  if (!postId || !patch) return
  const next = { ...(infoCache.get(postId) || {}), ...patch }
  infoCache.set(postId, next)
  notify(postId)
}

export function subscribeRankInfo(postId, cb) {
  if (!postId || typeof cb !== 'function') return () => {}
  if (!listeners.has(postId)) listeners.set(postId, new Set())
  listeners.get(postId).add(cb)
  return () => {
    const set = listeners.get(postId)
    if (!set) return
    set.delete(cb)
    if (set.size === 0) listeners.delete(postId)
  }
}

/**
 * 拉取文章互动数据（同一时间同一篇文章只发一个请求）
 * @param {string} postId
 * @param {{record?: boolean}} options record=true 时同时记录一次浏览
 */
export async function fetchRankInfo(postId, { record = false } = {}) {
  if (!postId) return null

  if (inflight.has(postId)) return inflight.get(postId)

  const shouldRecord = record && !recordedOnce.has(postId)
  if (shouldRecord) recordedOnce.add(postId)

  const promise = (async () => {
    try {
      const url = `/api/rank/info?postId=${encodeURIComponent(postId)}${
        shouldRecord ? '&record=1' : ''
      }`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()

      const patch = {}
      if (typeof json?.views === 'number') patch.views = json.views
      if (typeof json?.likes === 'number') patch.likes = json.likes
      if (typeof json?.liked === 'boolean') patch.liked = json.liked
      if (shouldRecord) patch.recorded = true

      setRankInfo(postId, patch)
      return getRankInfo(postId)
    } catch (e) {
      // 请求失败允许下次重试记录
      if (shouldRecord) recordedOnce.delete(postId)
      console.warn('[rank] 读取互动数据失败:', e?.message)
      return infoCache.get(postId) || null
    } finally {
      inflight.delete(postId)
    }
  })()

  inflight.set(postId, promise)
  return promise
}

/**
 * 提交点赞/取消点赞
 * @returns {Promise<{liked: boolean, likes: number}|null>}
 */
export async function submitLike(postId, action) {
  if (!postId) return null
  try {
    const res = await fetch('/api/rank/like', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId, action })
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    if (json?.disabled) return null

    const patch = {}
    if (typeof json?.liked === 'boolean') patch.liked = json.liked
    if (typeof json?.likes === 'number') patch.likes = json.likes
    setRankInfo(postId, patch)
    return getRankInfo(postId)
  } catch (e) {
    console.warn('[rank] 点赞失败:', e?.message)
    return null
  }
}

// 本地记录已点赞的文章，刷新后按钮状态不闪烁
const LOCAL_KEY = 'rank_liked_posts'

export function readLocalLiked() {
  if (typeof window === 'undefined') return {}
  try {
    return JSON.parse(window.localStorage.getItem(LOCAL_KEY) || '{}')
  } catch {
    return {}
  }
}

export function writeLocalLiked(postId, liked) {
  if (typeof window === 'undefined' || !postId) return
  try {
    const map = readLocalLiked()
    if (liked) {
      map[postId] = 1
    } else {
      delete map[postId]
    }
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(map))
  } catch {
    // localStorage 不可用时忽略
  }
}

/**
 * 订阅文章互动数据的 Hook（只订阅，不发请求）
 * @param {string} postId
 * @param {{enabled?: boolean}} options
 */
export function useRankInfo(postId, { enabled = true } = {}) {
  const [info, setInfo] = useState(() => getRankInfo(postId))

  useEffect(() => {
    if (!enabled || !postId) return
    // postId 变化时先同步一次已有缓存，避免显示上一篇的数据
    setInfo(getRankInfo(postId))
    const unsubscribe = subscribeRankInfo(postId, setInfo)
    return unsubscribe
  }, [postId, enabled])

  return info
}
