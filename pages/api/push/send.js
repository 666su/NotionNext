/**
 * 新增推送通知功能 - 手动触发推送
 * POST /api/push/send  { secret }
 * 用于手动检测新文章并推送（也可通过 Vercel Cron 定期调用）
 */
import { notifyNow } from '@/lib/notify'
import { fetchGlobalAllData } from '@/lib/db/SiteDataApi'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    // 密钥校验
    const expected = process.env.NOTIFY_SECRET || process.env.REVALIDATION_TOKEN || ''
    if (!expected) {
      return res.status(503).json({ error: '未配置 NOTIFY_SECRET 或 REVALIDATION_TOKEN' })
    }
    const secret = req.body?.secret || req.headers['x-notify-secret']
    if (secret !== expected) {
      return res.status(403).json({ error: '密钥无效' })
    }

    // 获取最新文章数据
    const { allPages } = await fetchGlobalAllData({ from: 'push-manual' })
    const results = await notifyNow(allPages)

    if (!results || results.length === 0) {
      return res.status(200).json({ ok: true, message: '没有需要推送的新文章', results: [] })
    }

    return res.status(200).json({ ok: true, results })
  } catch (e) {
    console.warn('[notify] 手动推送异常:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
