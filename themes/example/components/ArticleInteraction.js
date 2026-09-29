'use client'

import { siteConfig } from '@/lib/config'
import { useEffect } from 'react'
import CONFIG from '../config'
import LikeButton from './LikeButton'
import { fetchRankInfo } from './rankClient'

/**
 * 新增排行榜与点赞功能
 * 文章互动区：负责记录一次浏览并展示真实阅读量，同时在文末放置点赞按钮
 *
 * 说明：阅读量此前只依赖不蒜子的空 span，站点上并不显示数字；
 * 这里改为使用自建的 /api/rank/info?record=1 接口，失败时静默处理，不影响阅读。
 */
export const ArticleInteraction = ({ post }) => {
  const postId = post?.id
  const viewEnable = siteConfig('RANK_VIEW_ENABLE', true, CONFIG)

  // 本页唯一的互动数据触发点：记录一次浏览并拉取阅读量/点赞数
  // 顶部信息栏与文末点赞按钮都订阅同一份数据，不会重复请求
  useEffect(() => {
    if (!postId) return
    fetchRankInfo(postId, { record: viewEnable })
  }, [postId, viewEnable])

  if (!postId) return null

  return <LikeButton post={post} variant='block' />
}

export default ArticleInteraction
