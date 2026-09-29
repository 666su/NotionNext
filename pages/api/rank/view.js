/**
 * 新增排行榜与点赞功能 - 记录文章浏览
 * POST /api/rank/view
 * body: { postId: string }
 *
 * 返回: { ok, counted, views }
 * 同一访客在 RANK_VIEW_WINDOW_HOURS 小时内重复浏览同一篇文章不重复计数
 */
import { isViewEnabled, recordView } from '@/lib/rank'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  if (!isViewEnabled()) {
    return res
      .status(200)
      .json({ ok: true, counted: false, views: null, disabled: true })
  }

  try {
    const postId = req.body?.postId
    if (!postId || typeof postId !== 'string') {
      return res.status(400).json({ error: '缺少 postId' })
    }

    const result = await recordView(postId, req)
    return res.status(200).json({ ok: true, ...result })
  } catch (e) {
    console.warn('[rank] 记录浏览失败:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
