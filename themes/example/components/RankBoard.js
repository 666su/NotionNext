'use client'

import { siteConfig } from '@/lib/config'
import SmartLink from '@/components/SmartLink'
import { useEffect, useRef, useState } from 'react'
import CONFIG from '../config'

/**
 * 新增排行榜功能
 * 左侧空白区域的双榜单：上「文章阅读榜」、下「文章点赞榜」
 * 两个榜单都按次数从高到低排序，数据来自 /api/rank/top
 */

const RANK_META = {
  views: {
    title: '阅读榜',
    icon: 'fas fa-fire',
    iconClass: 'text-orange-500',
    unit: '次',
    accent: 'text-orange-500'
  },
  likes: {
    title: '点赞榜',
    icon: 'fas fa-heart',
    iconClass: 'text-pink-500',
    unit: '赞',
    accent: 'text-pink-500'
  }
}

// 前三名使用奖牌配色
const MEDAL_STYLES = [
  'bg-amber-500 text-white', // 金牌
  'bg-slate-400 text-white', // 银牌
  'bg-orange-400 text-white' // 铜牌
]

const RankBadge = ({ index }) => (
  <span
    className={`flex-shrink-0 w-5 h-5 mr-2 rounded text-[11px] font-semibold flex items-center justify-center ${
      MEDAL_STYLES[index] ||
      'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
    }`}
  >
    {index + 1}
  </span>
)

const RankSkeleton = () => (
  <div className='p-4 space-y-3'>
    {[0, 1, 2, 3, 4].map(i => (
      <div key={i} className='flex items-center'>
        <div className='w-5 h-5 mr-2 rounded bg-gray-100 dark:bg-gray-700' />
        <div className='h-3 flex-1 rounded bg-gray-100 dark:bg-gray-700' />
      </div>
    ))}
  </div>
)

const RankList = ({ kind, items, loading }) => {
  const meta = RANK_META[kind]

  return (
    <aside className='w-full rounded shadow overflow-hidden mb-6'>
      <h3 className='text-sm bg-gray-100 text-gray-700 dark:bg-hexo-black-gray dark:text-gray-200 py-3 px-4 dark:border-hexo-black-gray border-b'>
        <i className={`${meta.icon} mr-2 ${meta.iconClass}`} />
        {meta.title}
      </h3>

      {loading ? (
        <RankSkeleton />
      ) : items.length === 0 ? (
        <div className='p-4 text-xs text-gray-400 dark:text-gray-500'>
          暂无数据，{kind === 'views' ? '多来逛逛吧' : '快来抢首赞'}
        </div>
      ) : (
        <div className='p-3'>
          <ul className='space-y-1'>
            {items.map((item, index) => (
              <li key={item.id || item.href || index}>
                <SmartLink
                  href={item.href}
                  className='flex items-center py-1.5 px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group'
                >
                  <RankBadge index={index} />
                  <span className='flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200 group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors truncate'>
                    {item.title}
                  </span>
                  <span
                    className={`flex-shrink-0 ml-2 text-xs tabular-nums ${meta.accent}`}
                  >
                    {kind === 'views' ? item.views : item.likes}
                  </span>
                </SmartLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </aside>
  )
}

export const RankBoard = () => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const mounted = useRef(true)

  // 总开关与分项开关
  const rankEnable = siteConfig('RANK_ENABLE', true, CONFIG)
  const viewEnable = siteConfig('RANK_VIEW_ENABLE', true, CONFIG)
  const likeEnable = siteConfig('RANK_LIKE_ENABLE', true, CONFIG)
  const listSize = Number(siteConfig('RANK_LIST_SIZE', 10, CONFIG)) || 10

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (!rankEnable || (!viewEnable && !likeEnable)) {
      setLoading(false)
      return
    }

    const controller = new AbortController()

    const load = async () => {
      try {
        const res = await fetch(`/api/rank/top?limit=${listSize}`, {
          signal: controller.signal
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!mounted.current) return
        setData({
          views: Array.isArray(json?.views) ? json.views : [],
          likes: Array.isArray(json?.likes) ? json.likes : []
        })
      } catch (e) {
        if (e?.name === 'AbortError') return
        if (mounted.current) setFailed(true)
      } finally {
        if (mounted.current) setLoading(false)
      }
    }

    load()
    return () => controller.abort()
  }, [rankEnable, viewEnable, likeEnable, listSize])

  if (!rankEnable) return null
  if (failed && !data) return null

  const views = data?.views || []
  const likes = data?.likes || []

  return (
    <div className='rank-board space-y-6'>
      {viewEnable && <RankList kind='views' items={views} loading={loading} />}
      {likeEnable && <RankList kind='likes' items={likes} loading={loading} />}
    </div>
  )
}

export default RankBoard
