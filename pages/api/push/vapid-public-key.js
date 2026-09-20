/**
 * 新增推送通知功能 - 获取 VAPID 公钥
 * GET /api/push/vapid-public-key
 * 浏览器订阅时需要的 applicationServerKey
 */
import { getVapidKeys, setVapidKeys } from '@/lib/notify/storage.js'
import { generateVapidKeys } from '@/lib/notify/webpush.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    let keys = await getVapidKeys()

    // 优先使用环境变量中的密钥
    const envPk = process.env.VAPID_PUBLIC_KEY
    const envSk = process.env.VAPID_PRIVATE_KEY
    if (envPk && envSk) {
      keys = { publicKey: envPk, privateKey: envSk }
    } else if (!keys) {
      // 首次访问：自动生成并持久化
      keys = generateVapidKeys()
      await setVapidKeys(keys)
      console.log('[notify] VAPID 密钥已自动生成')
    }

    if (!keys?.publicKey) {
      return res.status(404).json({ error: 'VAPID 未配置' })
    }

    return res.status(200).json({ publicKey: keys.publicKey })
  } catch (e) {
    console.warn('[notify] 获取公钥失败:', e.message)
    return res.status(500).json({ error: e.message })
  }
}
