/**
 * POST /api/admin/messages/conversations/[id]/messages —— 管理员回复（需会话 + CSRF）
 *
 * 回复后：会话 last_message_at 更新；未读/已读 → 处理中；写一条审计。
 * v1 不发邮件；访客通过私密链接查看。
 */

import { audit } from '@/lib/admin/audit'
import { clientIp, hashIp } from '@/lib/admin/crypto'
import { requireAdminApi } from '@/lib/admin/respond'
import { json, normalizeConvId, setMessagesHeaders } from '@/lib/messages/respond'
import { appendMessage } from '@/lib/messages/store'
import { normalizeContent } from '@/lib/messages/validate'
import { readMessagesConfig } from '@/lib/messages/config'

export const config = {
  api: { bodyParser: { sizeLimit: '16kb' } }
}

export default async function handler(req, res) {
  setMessagesHeaders(res)

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const guard = await requireAdminApi(req, res, { csrf: true })
  if (!guard) return null

  const convId = normalizeConvId(req.query?.id)
  if (!convId) return json(res, 404, { error: 'not_found' })

  const cfg = readMessagesConfig()
  const content = normalizeContent(req.body?.content, cfg.limits.MAX_SAME_CHAR_RUN)
  if (!content) return json(res, 400, { error: 'invalid_content' })
  if (content.length > cfg.limits.CONTENT_MAX) return json(res, 413, { error: 'payload_too_large' })

  const clientRequestId = String(req.body?.client_request_id || '').trim().slice(0, 64) || null

  try {
    const { message, duplicated } = await appendMessage({
      convId,
      sender: 'admin',
      content,
      clientRequestId
    })

    await audit({
      action: 'messages.reply',
      result: 'ok',
      user: guard.session.record.uid,
      ipHash: hashIp(clientIp(req), guard.config.sessionSecret),
      detail: `${convId} (${content.length} 字符)`
    })

    return json(res, duplicated ? 200 : 201, { ok: true, message, duplicated })
  } catch (err) {
    if (err?.code === 'not_found') return json(res, 404, { error: 'not_found' })
    if (err?.code === 'conversation_full') return json(res, 413, { error: 'conversation_full' })
    await audit({
      action: 'messages.reply',
      result: 'error',
      user: guard.session.record.uid,
      ipHash: hashIp(clientIp(req), guard.config.sessionSecret),
      detail: err?.code || 'store_unavailable'
    })
    console.error('[messages][admin-reply] failed:', err?.code || err?.message || err)
    return json(res, 503, { error: 'store_unavailable' })
  }
}
