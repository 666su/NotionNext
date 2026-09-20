/**
 * 新增推送通知功能 - 获取读者当前订阅列表
 * GET /api/push/subscriptions?subscriberId=xxx
 */
import { getSubscriptionsByUser } from '@/lib/notify/storage'

export default async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method Not Allowed' })
    }
    const { subscriberId } = req.query
    if (!subscriberId) {
      return res.status(400).json({ error: '缺少 subscriberId' })
    }
    const subs = await getSubscriptionsByUser(subscriberId)
    return res.status(200).json({ subscriptions: subs })
  } catch (e) {
    return res.status(500).json({ error: e.message })
  }
}
