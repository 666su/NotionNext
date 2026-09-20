/**
 * 新增推送通知功能 - 推送调度入口
 *
 * checkAndNotify(allPages)：
 *   检测是否有新发布或更新的文章，有则推送到所有已启用渠道。
 *   使用 lastNotified 标记避免重复推送；首次启用时只推送最近 7 天内的文章。
 */
import { getLastNotified, setLastNotified } from './storage.js'
import { sendTelegram, sendServerChan, sendWebhook, sendWebPush, buildMessage } from './channels.js'

const isBuildPhase =
  process.env.npm_lifecycle_event === 'build' || process.env.npm_lifecycle_event === 'export'

/**
 * 检测新文章并推送
 * @param {Array} allPages  fetchGlobalAllData 返回的 allPages
 * @returns {Promise<Array|null>} 推送结果或 null（无新文章）
 */
export async function checkAndNotify(allPages) {
  try {
    // 总开关检查
    if (!process.env.NOTIFY_ENABLE) return null
    // 构建阶段不推送
    if (isBuildPhase) return null

    const posts = (allPages || []).filter(
      p => p && p.type === 'Post' && p.status === 'Published'
    )
    if (posts.length === 0) return null

    // 获取推送标记
    const last = await getLastNotified()
    const firstRun = Object.keys(last).length === 0
    const now = Date.now()
    const sevenDays = 7 * 24 * 3600 * 1000

    // 找出新发布或已更新的文章
    const changed = posts.filter(p => {
      const cur = p.lastEditedDate || p.date?.start_date || ''
      const prev = last[p.id]
      if (prev) return prev !== cur
      // 首次运行：仅推送最近 7 天内发布/更新的文章
      if (firstRun) {
        const pubDate = p.publishDate || p.date?.start_date
        if (pubDate && now - new Date(pubDate).getTime() > sevenDays) return false
      }
      return true
    })

    if (changed.length === 0) return null

    const siteTitle = process.env.NEXT_PUBLIC_TITLE || ''
    const siteUrl = process.env.NEXT_PUBLIC_LINK || ''

    console.log(`[notify] 检测到 ${changed.length} 篇新文章/更新，开始推送...`)

    const results = []
    for (const post of changed) {
      const msg = buildMessage(post, siteTitle, siteUrl)
      const postResults = {
        post: post.title,
        webpush: await sendWebPush(msg),
        telegram: await sendTelegram(msg),
        serverchan: await sendServerChan(msg),
        webhook: await sendWebhook(msg)
      }
      results.push(postResults)
    }

    // 更新所有文章的标记（包含未推送的旧文章，避免下次重复触发）
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

/**
 * 手动触发推送（供 API 路由调用）
 */
export async function notifyNow(allPages) {
  return checkAndNotify(allPages)
}
