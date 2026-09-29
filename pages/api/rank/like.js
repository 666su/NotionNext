/**
 * 新增排行榜与点赞功能 - 文章点赞
 * POST /api/rank/like
 * body: { postId: string, action?: 'toggle'|'like'|'unlike' }
 *
 * 返回: { ok, liked, likes, changed }
 * 点赞状态按访客去重，同一访客重复点赞不会重复计数
 */
import {
  getVisitorIdentity,
  isLikeEnabled,
  isLikedBy,
  toggleLike
} from '@/lib/rank'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (!isLikeEnabled()) {
    return res
      .status(200)
      .json({ ok: true, liked: false, likes: null, disabled: true })
  }

  try {
    // GET 从 query 取参，POST 从 body 取参
    const postId = req.method === 'GET' ? req.query?.postId : req.body?.postId
    if (!postId || typeof postId !== 'string') {
      return res.status(400).json({ error: '缺少 postId' })
    }

    const identity = getVisitorIdentity(req, 'like')

    if (req.method === 'GET') {
      const liked = await isLikedBy(postId, identity)
      return res.status(200).json({ ok: true, liked })
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      return res.status(405).json({ error: 'Method Not Allowed' })
    }

    const action = ['like', 'unlike', 'toggle'].includes(req.body?.action)
      ? req.body.action
      : 'toggle'

    const result = await toggleLike(postId, identity, action)
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    console.warn('[rank] 点赞失败:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
