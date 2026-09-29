/**
 * 新增排行榜与点赞功能 - 历史数据导入 / 计数管理
 * POST /api/rank/seed
 *
 * 请求头或 body 中需要携带管理令牌（RANK_SEED_SECRET，未配置时回退 REVALIDATION_TOKEN）
 *
 * body:
 * {
 *   secret: string,
 *   action?: 'import' | 'reset',
 *   mode?: 'set' | 'incr' | 'max',        // import 时的写入方式，默认 set
 *   views?: { [postId]: number },          // 历史查看数
 *   likes?: { [postId]: number },          // 历史点赞数
 *   reset?: 'views' | 'likes' | 'all'      // action=reset 时指定重置范围
 * }
 *
 * 示例（导入历史阅读量，只增不减）：
 *   curl -X POST /api/rank/seed -H 'Content-Type: application/json' \
 *     -d '{"secret":"xxx","action":"import","mode":"max","views":{"postId":123}}'
 */
import { importCounters, resetCounters, verifySecret } from '@/lib/rank'

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  const token = req.body?.secret || req.headers?.['x-rank-secret']
  if (!verifySecret(token)) {
    return res.status(403).json({
      error:
        '令牌无效。请在环境变量中配置 RANK_SEED_SECRET，或在请求头 x-rank-secret 中携带'
    })
  }

  try {
    const action = req.body?.action === 'reset' ? 'reset' : 'import'

    if (action === 'reset') {
      const kind = ['views', 'likes', 'all'].includes(req.body?.reset)
        ? req.body.reset
        : 'all'
      const result = await resetCounters(kind)
      return res.status(200).json({ ok: true, action, reset: kind, result })
    }

    const result = await importCounters({
      views: req.body?.views,
      likes: req.body?.likes,
      mode: req.body?.mode
    })

    return res.status(200).json({ ok: true, action, result })
  } catch (e) {
    console.warn('[rank] 数据导入失败:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
