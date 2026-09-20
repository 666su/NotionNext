/**
 * 新增推送通知功能 - 发送测试通知
 * POST /api/push/test  { channel, config }
 * 用读者自己填的配置发送测试，验证渠道是否可用
 */
import { sendTelegram, sendServerChan } from '@/lib/notify/channels'
import { sendWebPushTo } from '@/lib/notify/webpush'
import { getVapidKeys, setVapidKeys } from '@/lib/notify/storage'
import { generateVapidKeys } from '@/lib/notify/webpush'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const { channel, config } = req.body
    if (!channel || !config) {
      return res.status(400).json({ error: '缺少 channel 或 config' })
    }

    const msg = {
      title: '🔔 测试通知',
      url: process.env.NEXT_PUBLIC_LINK || '/',
      summary: '博客推送设置成功！你将收到新文章更新通知。'
    }

    if (channel === 'telegram') {
      const result = await sendTelegram(msg, config)
      return result.ok
        ? res.status(200).json({ ok: true, message: '测试通知已发送' })
        : res.status(400).json({ error: result.reason })
    }

    if (channel === 'serverchan') {
      const result = await sendServerChan(msg, config)
      return result.ok
        ? res.status(200).json({ ok: true, message: '测试通知已发送' })
        : res.status(400).json({ error: result.reason })
    }

    if (channel === 'webpush') {
      // Web Push 测试需要完整的订阅信息
      const { endpoint, keys } = config
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return res.status(400).json({ error: 'Web Push 订阅信息不完整' })
      }
      let keys2 = await getVapidKeys()
      const envPk = process.env.VAPID_PUBLIC_KEY
      const envSk = process.env.VAPID_PRIVATE_KEY
      if (envPk && envSk) keys2 = { publicKey: envPk, privateKey: envSk }
      else if (!keys2) { keys2 = generateVapidKeys(); await setVapidKeys(keys2) }

      await sendWebPushTo(
        { endpoint, keys },
        { title: msg.title, body: msg.summary, url: msg.url },
        keys2,
        process.env.VAPID_SUBJECT
      )
      return res.status(200).json({ ok: true, message: '测试通知已发送' })
    }

    return res.status(400).json({ error: `不支持的渠道: ${channel}` })
  } catch (e) {
    console.warn('[notify] 测试推送失败:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
