/**
 * GET    /api/admin/messages/conversations/[id] —— 会话详情（管理员）
 * PATCH  /api/admin/messages/conversations/[id] —— 状态变更 / 标记已读（需 CSRF）
 * DELETE /api/admin/messages/conversations/[id] —— 删除（需 CSRF + 服务端二次确认）
 *
 * GET 不写库（避免"GET 有副作用"），标记已读走 PATCH { markRead: true }。
 * DELETE 必须带 `?confirm=<完整会话 ID>`；`?mode=purge` 为彻底删除（默认软删）。
 */

import { audit } from '@/lib/admin/audit'
import { clientIp, hashIp } from '@/lib/admin/crypto'
import { requireAdminApi } from '@/lib/admin/respond'
import { json, normalizeConvId, setMessagesHeaders } from '@/lib/messages/respond'
import {
  getConversationDetail,
  markRead,
  purgeConversation,
  softDeleteConversation,
  updateStatus
} from '@/lib/messages/store'

export default async function handler(req, res) {
  setMessagesHeaders(res)

  const convId = normalizeConvId(req.query?.id)
  if (!convId) return json(res, 404, { error: 'not_found' })

  /* ---------------- GET：详情 ---------------- */
  if (req.method === 'GET') {
    const guard = await requireAdminApi(req, res)
    if (!guard) return null
    try {
      const detail = await getConversationDetail(convId)
      if (!detail) return json(res, 404, { error: 'not_found' })
      return json(res, 200, { ok: true, ...detail })
    } catch (err) {
      console.error('[messages][admin-detail] failed:', err?.code || err?.message || err)
      return json(res, 503, { error: 'store_unavailable' })
    }
  }

  /* ---------------- PATCH：状态 / 已读 ---------------- */
  if (req.method === 'PATCH') {
    const guard = await requireAdminApi(req, res, { csrf: true })
    if (!guard) return null

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const wantRead = body.markRead === true
    const nextStatus = typeof body.status === 'string' ? body.status : ''
    if (!wantRead && !nextStatus) return json(res, 400, { error: 'invalid_input' })

    const ipHash = hashIp(clientIp(req), guard.config.sessionSecret)

    try {
      let conversation = null
      if (wantRead) {
        await markRead(convId)
        await audit({
          action: 'messages.mark_read',
          result: 'ok',
          user: guard.session.record.uid,
          ipHash,
          detail: convId
        })
      }
      if (nextStatus) {
        conversation = await updateStatus(convId, nextStatus)
        await audit({
          action: 'messages.status',
          result: 'ok',
          user: guard.session.record.uid,
          ipHash,
          detail: `${convId} → ${nextStatus}`
        })
      }
      if (!conversation) conversation = (await getConversationDetail(convId))?.conversation || null
      return json(res, 200, { ok: true, conversation })
    } catch (err) {
      if (err?.code === 'not_found') return json(res, 404, { error: 'not_found' })
      if (err?.code === 'invalid_status') return json(res, 400, { error: 'invalid_status' })
      console.error('[messages][admin-patch] failed:', err?.code || err?.message || err)
      return json(res, 503, { error: 'store_unavailable' })
    }
  }

  /* ---------------- DELETE：软删 / purge ---------------- */
  if (req.method === 'DELETE') {
    const guard = await requireAdminApi(req, res, { csrf: true })
    if (!guard) return null

    // 服务端二次确认：confirm 必须等于会话 ID
    if (String(req.query?.confirm || '') !== convId) {
      return json(res, 400, { error: 'confirm_required' })
    }

    const mode = req.query?.mode === 'purge' ? 'purge' : 'soft'
    const ipHash = hashIp(clientIp(req), guard.config.sessionSecret)

    try {
      if (mode === 'purge') await purgeConversation(convId)
      else await softDeleteConversation(convId)

      await audit({
        action: mode === 'purge' ? 'messages.purge' : 'messages.delete',
        result: 'ok',
        user: guard.session.record.uid,
        ipHash,
        detail: convId
      })
      return json(res, 200, { ok: true, mode })
    } catch (err) {
      if (err?.code === 'not_found') return json(res, 404, { error: 'not_found' })
      await audit({
        action: mode === 'purge' ? 'messages.purge' : 'messages.delete',
        result: 'error',
        user: guard.session.record.uid,
        ipHash,
        detail: `${convId} ${err?.code || 'store_unavailable'}`
      })
      console.error('[messages][admin-delete] failed:', err?.code || err?.message || err)
      return json(res, 503, { error: 'store_unavailable' })
    }
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE')
  return json(res, 405, { error: 'method_not_allowed' })
}
