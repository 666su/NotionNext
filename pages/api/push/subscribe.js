/**
 * 新增推送通知功能 - 订阅/取消订阅
 * POST /api/push/subscribe   — 保存订阅
 * DELETE /api/push/subscribe  — 取消订阅
 */
import { addSubscription, removeSubscription } from '@/lib/notify/storage'

export default async function handler(req, res) {
  try {
    if (req.method === 'POST') {
      const sub = req.body
      if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
        return res.status(400).json({ error: '订阅信息不完整' })
      }
      await addSubscription(sub)
      return res.status(200).json({ ok: true })
    }

    if (req.method === 'DELETE') {
      const { endpoint } = req.body || {}
      if (!endpoint) {
        return res.status(400).json({ error: '缺少 endpoint' })
      }
      await removeSubscription(endpoint)
      return res.status(200).json({ ok: true })
    }

    res.setHeader('Allow', 'POST, DELETE')
    return res.status(405).json({ error: 'Method Not Allowed' })
  } catch (e) {
    console.warn('[notify] 订阅接口异常:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
