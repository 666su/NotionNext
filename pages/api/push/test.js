/**
 * 新增推送通知功能 - 发送测试推送
 * POST /api/push/test  { subscription }
 * 向指定的订阅发送一条测试通知（设置面板"发送测试通知"按钮用）
 */
import { sendWebPushTo } from '@/lib/notify/webpush'
import { getVapidKeys, setVapidKeys } from '@/lib/notify/storage'
import { generateVapidKeys } from '@/lib/notify/webpush'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const sub = req.body?.subscription
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return res.status(400).json({ error: '订阅信息不完整' })
    }

    // 获取或生成 VAPID 密钥
    let keys = await getVapidKeys()
    const envPk = process.env.VAPID_PUBLIC_KEY
    const envSk = process.env.VAPID_PRIVATE_KEY
    if (envPk && envSk) {
      keys = { publicKey: envPk, privateKey: envSk }
    } else if (!keys) {
      keys = generateVapidKeys()
      await setVapidKeys(keys)
    }

    const payload = {
      title: '🔔 测试通知',
      body: '博客推送设置成功！你将收到新文章更新通知。',
      url: '/'
    }

    await sendWebPushTo(sub, payload, keys, process.env.VAPID_SUBJECT)
    return res.status(200).json({ ok: true, message: '测试通知已发送' })
  } catch (e) {
    console.warn('[notify] 测试推送失败:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
