/**
 * 新增排行榜与点赞功能 - 单篇文章互动数据
 * GET /api/rank/info?postId=xxx
 *
 * 返回: { ok, views, likes, liked }
 *  - liked 表示当前访客是否已点赞
 *  - 携带 record=1 时同时记录一次浏览（用于文章详情页）
 */
import {
  getPostInteraction,
  getVisitorIdentity,
  isViewEnabled,
  recordView
} from '@/lib/rank'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const postId = req.query?.postId
    if (!postId || typeof postId !== 'string') {
      return res.status(400).json({ error: '缺少 postId' })
    }

    // 先记录浏览（内部已做去重），再读取计数
    if (req.query?.record === '1' && isViewEnabled()) {
      await recordView(postId, req)
    }

    const identity = getVisitorIdentity(req, 'like')
    const data = await getPostInteraction(postId, identity)

    return res.status(200).json({ ok: true, ...data })
  } catch (e) {
    console.warn('[rank] 读取互动数据失败:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
