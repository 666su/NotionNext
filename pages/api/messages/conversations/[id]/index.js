/**
 * GET /api/messages/conversations/[id] —— 当前会话摘要（需 Cookie）
 *
 * 只返回该访客自己的会话；不返回邮箱、不返回 token。
 */

import { requireConversation } from '@/lib/messages/auth'
import { json } from '@/lib/messages/respond'
import { getConversation } from '@/lib/messages/store'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return json(res, 405, { error: 'method_not_allowed' })
  }

  const auth = requireConversation(req, req.query?.id)
  if (!auth.ok) return json(res, auth.status, { error: auth.error })

  try {
    const conv = await getConversation(auth.convId)
    if (!conv) return json(res, 404, { error: 'not_found' })
    return json(res, 200, {
      ok: true,
      conversation: {
        id: conv.id,
        visitor_name: conv.visitor_name,
        status: conv.status,
        message_count: conv.message_count,
        created_at: conv.created_at,
        last_message_at: conv.last_message_at,
        resolved_at: conv.resolved_at
      }
    })
  } catch (err) {
    console.error('[messages][get] failed:', err?.code || err?.message || err)
    return json(res, 503, { error: 'store_unavailable' })
  }
}
