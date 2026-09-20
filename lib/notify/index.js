/**
 * 新增推送通知功能 - 推送调度（遍历所有订阅者，按各自渠道分发）
 */
import {
  getLastNotified,
  setLastNotified,
  getAllEnabledSubscriptions,
  removeSubscription,
  getVapidKeys,
  setVapidKeys
} from './storage.js'
import { sendTelegram, sendServerChan, sendWebPush, sendWebhook, buildMessage } from './channels.js'
import { generateVapidKeys } from './webpush.js'

const isBuildPhase =
  process.env.npm_lifecycle_event === 'build' || process.env.npm_lifecycle_event === 'export'

/**
 * 检测新文章，遍历所有订阅者按各自渠道推送
 */
export async function checkAndNotify(allPages) {
  try {
    if (!process.env.NOTIFY_ENABLE) return null
    if (isBuildPhase) return null

    const posts = (allPages || []).filter(
      p => p && p.type === 'Post' && p.status === 'Published'
    )
    if (posts.length === 0) return null

    const last = await getLastNotified()
    const firstRun = Object.keys(last).length === 0
    const now = Date.now()
    const sevenDays = 7 * 24 * 3600 * 1000

    const changed = posts.filter(p => {
      const cur = p.lastEditedDate || p.date?.start_date || ''
      const prev = last[p.id]
      if (prev) return prev !== cur
      if (firstRun) {
        const pubDate = p.publishDate || p.date?.start_date
        if (pubDate && now - new Date(pubDate).getTime() > sevenDays) return false
      }
      return true
    })

    if (changed.length === 0) return null

    const siteUrl = process.env.NEXT_PUBLIC_LINK || ''
    const siteTitle = process.env.NEXT_PUBLIC_TITLE || ''

    console.log(`[notify] 检测到 ${changed.length} 篇新文章，开始推送...`)

    // 获取所有已启用订阅
    const subs = await getAllEnabledSubscriptions()

    // 加载或生成 VAPID 密钥（Web Push 用）
    let vapidKeys = await getVapidKeys()
    const envPk = process.env.VAPID_PUBLIC_KEY
    const envSk = process.env.VAPID_PRIVATE_KEY
    if (envPk && envSk) {
      vapidKeys = { publicKey: envPk, privateKey: envSk }
    } else if (!vapidKeys) {
      vapidKeys = generateVapidKeys()
      await setVapidKeys(vapidKeys)
    }
    const vapidSubject = process.env.VAPID_SUBJECT || 'mailto:admin@localhost'

    const results = []
    for (const post of changed) {
      const msg = buildMessage(post, siteTitle, siteUrl)
      const postResults = { post: msg.title }

      for (const sub of subs) {
        let result
        switch (sub.channel) {
          case 'telegram':
            result = await sendTelegram(msg, sub.config)
            break
          case 'serverchan':
            result = await sendServerChan(msg, sub.config)
            break
          case 'webpush':
            result = await sendWebPush(sub, msg, vapidKeys, vapidSubject)
            // 清理过期订阅
            if (result.statusCode === 404 || result.statusCode === 410) {
              await removeSubscription(sub.subscriberId, sub.channel)
            }
            break
          default:
            result = { ok: false, reason: `未知渠道: ${sub.channel}` }
        }
        postResults[`sub_${sub.id}`] = { channel: sub.channel, ...result }
      }

      // 博主侧 Webhook（可选）
      postResults.webhook = await sendWebhook(msg)
      results.push(postResults)
    }

    // 更新标记
    const next = { ...last }
    for (const p of posts) {
      next[p.id] = p.lastEditedDate || p.date?.start_date || String(Date.now())
    }
    await setLastNotified(next)

    console.log('[notify] 推送完成:', JSON.stringify(results))
    return results
  } catch (e) {
    console.warn('[notify] 推送异常:', e.message)
    return null
  }
}

export async function notifyNow(allPages) {
  return checkAndNotify(allPages)
}
