/**
 * 新增排行榜与点赞功能 - 排行榜数据
 * GET /api/rank/top?limit=10
 *
 * 返回: { ok, views: [...], likes: [...], updatedAt, enabled }
 * 两个榜单均按计数从高到低排序
 */
import { buildRankBoard } from '@/lib/rank'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const limit = req.query?.limit ? Number(req.query.limit) : undefined
    const board = await buildRankBoard({ limit })

    // 榜单属于低频变化数据，允许 CDN 缓存 60 秒，过期后后台刷新
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=60, stale-while-revalidate=300'
    )
    return res.status(200).json({ ok: true, ...board })
  } catch (e) {
    console.warn('[rank] 生成排行榜失败:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
