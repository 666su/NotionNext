'use client'

import { siteConfig } from '@/lib/config'
import { useEffect, useState } from 'react'
import CONFIG from '../config'
import {
  readLocalLiked,
  submitLike,
  useRankInfo,
  writeLocalLiked
} from './rankClient'

/**
 * 新增点赞功能
 * 文章点赞按钮：调用 /api/rank/like 切换点赞状态
 *
 * 变体：
 *  - inline：文章顶部信息栏使用的小号按钮
 *  - block：文章底部使用的大号按钮
 */
export const LikeButton = ({ post, variant = 'inline' }) => {
  const postId = post?.id
  const likeEnable = siteConfig('RANK_LIKE_ENABLE', true, CONFIG)
  const enabled = !!likeEnable && !!postId

  const info = useRankInfo(postId, { enabled })
  const [liked, setLiked] = useState(false)
  const [likes, setLikes] = useState(null)
  const [pending, setPending] = useState(false)
  const [tip, setTip] = useState('')

  // 本地缓存优先，避免刷新后按钮状态闪烁
  // 数据由 ArticleInteraction 统一拉取，这里只订阅共享 store
  useEffect(() => {
    if (!postId) return
    if (readLocalLiked()[postId]) setLiked(true)
  }, [postId])

  // 服务端返回后以服务端为准
  useEffect(() => {
    if (!info) return
    if (typeof info.liked === 'boolean') {
      setLiked(info.liked)
      writeLocalLiked(postId, info.liked)
    }
    if (typeof info.likes === 'number') setLikes(info.likes)
  }, [info, postId])

  if (!enabled) return null

  const handleClick = async () => {
    if (pending) return
    setPending(true)
    setTip('')

    const prevLiked = liked
    const prevLikes = likes
    const nextLiked = !prevLiked

    // 乐观更新
    setLiked(nextLiked)
    if (typeof prevLikes === 'number') {
      // 用 Number() 归一化，避免类型收窄导致的运算类型告警
      setLikes(Math.max(Number(prevLikes) + (nextLiked ? 1 : -1), 0))
    }

    const result = await submitLike(postId, nextLiked ? 'like' : 'unlike')

    if (!result) {
      // 失败回滚
      setLiked(prevLiked)
      setLikes(prevLikes)
      setTip('操作失败')
    } else {
      writeLocalLiked(postId, !!result.liked)
    }

    setPending(false)
  }

  const countText = typeof likes === 'number' ? likes : info ? 0 : '—'

  if (variant === 'block') {
    return (
      <div className='rank-like-block flex flex-col items-center my-10'>
        <button
          type='button'
          onClick={() => {
            void handleClick()
          }}
          disabled={pending}
          aria-pressed={liked}
          aria-label={liked ? '取消点赞' : '点赞'}
          className={`flex items-center gap-2 px-6 py-3 rounded-full border transition-all duration-200 ${
            liked
              ? 'bg-pink-500 border-pink-500 text-white shadow-lg shadow-pink-500/30'
              : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-pink-400 hover:text-pink-500'
          } ${pending ? 'opacity-70 cursor-wait' : 'cursor-pointer'}`}
        >
          <i className={`${liked ? 'fas' : 'far'} fa-heart text-lg`} />
          <span className='text-sm font-medium'>
            {liked ? '已点赞' : '点个赞'}
          </span>
          <span className='text-sm tabular-nums'>{countText}</span>
        </button>
        {tip && <span className='mt-2 text-xs text-red-400'>{tip}</span>}
      </div>
    )
  }

  return (
    <button
      type='button'
      onClick={() => {
        void handleClick()
      }}
      disabled={pending}
      aria-pressed={liked}
      aria-label={liked ? '取消点赞' : '点赞'}
      title={liked ? '取消点赞' : '点赞'}
      className={`mx-2 inline-flex items-center transition-colors ${
        liked ? 'text-pink-500' : 'text-gray-400 hover:text-pink-500'
      } ${pending ? 'opacity-70 cursor-wait' : 'cursor-pointer'}`}
    >
      <i className={`${liked ? 'fas' : 'far'} fa-heart mr-1`} />
      <span className='tabular-nums'>{countText}</span>
    </button>
  )
}

export default LikeButton
