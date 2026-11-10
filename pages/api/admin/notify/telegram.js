/**
 * GET/POST /api/admin/notify/telegram —— Telegram 连通性自检与测试消息（Phase 6.1）
 *
 * GET  ?check=1 → 调 getMe，确认"令牌有效 + 网络通"，**不发送任何消息**
 * POST         → 发一条测试消息（需要 CSRF），用于确认 chat_id 与机器人关系
 *
 * 只返回状态与错误代号，**绝不返回 token**。
 */

import { getBotInfo, readTelegramConfig, sendTelegram } from '@/lib/admin/telegram'
import { json, requireAdminApi, setSecurityHeaders } from '@/lib/admin/respond'

export default async function handler(req, res) {
  setSecurityHeaders(res)

  if (req.method === 'GET') {
    const guard = await requireAdminApi(req, res)
    if (!guard) return null

    const config = readTelegramConfig()
    const bot = await getBotInfo()
    return json(res, 200, {
      ok: true,
      config: {
        configured: config.configured,
        missing: config.missing,
        baseHost: config.baseHost,
        localBase: config.localBase,
        chatIdMasked: config.chatId
          ? `${config.chatId.slice(0, 3)}***${config.chatId.slice(-2)}`
          : null
      },
      bot
    })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res, { csrf: true })
  if (!guard) return null

  const text = String(req.body?.text || '')
  const body =
    text ||
    [
      '🔔 <b>Telegram 测试消息</b>',
      '如果你看到这条，说明后台 → Telegram 的链路是通的。',
      `时间：${new Date().toLocaleString('zh-CN', { hour12: false })}`
    ].join('\n')

  const delivery = await sendTelegram({ text: body })
  return json(res, delivery.ok ? 200 : 502, {
    ok: delivery.ok,
    delivery,
    hint: delivery.ok
      ? null
      : delivery.reason === 'local_base_in_production'
        ? '环境变量 TELEGRAM_API_BASE 指向了本地地址：生产环境请删除该变量，改用官方 api.telegram.org。'
        : delivery.reason === 'request_failed'
          ? `请求发不出去（${delivery.detail || 'unknown'}）：多为函数区域网络不通，建议把 Vercel Functions 区域改为 iad1。`
          : null
  })
}
