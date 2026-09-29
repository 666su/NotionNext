/**
 * 新增排行榜与点赞功能 - 状态检查
 * GET /api/rank/status
 *
 * 返回：存储后端、榜单条数、开关状态
 * 用于部署后确认 Redis 是否正常接管计数
 */
import { getCounters, getStorageBackend } from '@/lib/rank/storage'
import {
  getListSize,
  isLikeEnabled,
  isRankEnabled,
  isViewEnabled
} from '@/lib/rank'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const [backend, views, likes] = await Promise.all([
      getStorageBackend(),
      getCounters('views'),
      getCounters('likes')
    ])

    return res.status(200).json({
      ok: true,
      enabled: isRankEnabled(),
      viewEnabled: isViewEnabled(),
      likeEnabled: isLikeEnabled(),
      listSize: getListSize(),
      storage: backend,
      redisConfigured: !!(process.env.REDIS_URL || '').trim(),
      seedSecretConfigured: !!(
        process.env.RANK_SEED_SECRET || process.env.REVALIDATION_TOKEN
      ),
      counts: {
        viewedPosts: Object.keys(views).length,
        viewedTotal: Object.values(views).reduce((sum, n) => sum + n, 0),
        likedPosts: Object.keys(likes).length,
        likedTotal: Object.values(likes).reduce((sum, n) => sum + n, 0)
      }
    })
  } catch (e) {
    console.warn('[rank] 状态检查失败:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
