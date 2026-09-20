/**
 * 新增推送通知功能 - 订阅管理
 * POST /api/push/subscribe   — 新增/更新订阅
 * DELETE /api/push/subscribe  — 删除订阅
 */
import { upsertSubscription, removeSubscription } from '@/lib/notify/storage'

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const { subscriberId, channel, config, enabled } = req.body
      if (!subscriberId || !channel) {
        return res.status(400).json({ error: '缺少 subscriberId 或 channel' })
      }
      const sub = await upsertSubscription({ subscriberId, channel, config, enabled })
      return res.status(200).json({ ok: true, id: sub.id })
    }

    if (req.method === 'DELETE') {
      const { subscriberId, channel } = req.body || {}
      if (!subscriberId || !channel) {
        return res.status(400).json({ error: '缺少 subscriberId 或 channel' })
      }
      await removeSubscription(subscriberId, channel)
      return res.status(200).json({ ok: true })
    }

    res.setHeader('Allow', 'POST, DELETE')
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (e) {
    console.warn('[notify] 订阅接口异常:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
