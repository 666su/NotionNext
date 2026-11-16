/**
 * 私信数据访问（Supabase / schema=messages）
 *
 * 约定：
 * - 所有函数都在服务端调用；`token_hash` 只在兑换时读取，绝不返回给前端；
 * - 错误统一抛 MessagesError(code, status)，由 API 层转成 JSON；
 * - 创建会话与追加消息都做幂等（创建走 Redis 去重，消息走唯一索引）。
 */

import { createHash } from 'node:crypto'
import { kvGet, kvSet } from '@/lib/kv'
import { readMessagesConfig } from './config'
import { getMessagesClient } from './db'
import { accessToken, conversationId, hashAccessToken, messageId } from './tokens'

export class MessagesError extends Error {
  constructor(code, status = 400) {
    super(code)
    this.code = code
    this.status = status
  }
}

/** 对外的会话字段（不含 token_hash） */
const PUBLIC_COLUMNS = [
  'id',
  'visitor_name',
  'visitor_email',
  'status',
  'created_at',
  'updated_at',
  'last_message_at',
  'last_visitor_at',
  'last_admin_at',
  'message_count',
  'unread_count',
  'resolved_at',
  'archived_at',
  'spam_at'
].join(',')

const MESSAGE_COLUMNS = 'id,conversation_id,sender,content,created_at,read_at'

function db() {
  const client = getMessagesClient()
  if (!client) throw new MessagesError('messages_unavailable', 503)
  return client
}

function failFrom(error, fallback = 'store_unavailable') {
  const code = String(error?.code || '')
  if (code === '23505') throw new MessagesError('already_exists', 409)
  if (code === '23514' || code === '22001' || code === '23502') {
    throw new MessagesError('invalid_input', 400)
  }
  console.error('[messages][db]', code || 'error', String(error?.message || '').slice(0, 160))
  throw new MessagesError(fallback, 503)
}

/* ------------------------------------------------------------------ *
 * 创建会话
 * ------------------------------------------------------------------ */

export async function createConversation({
  name,
  email,
  content,
  clientRequestId,
  firstPath,
  ipHash
}) {
  const { tokenSecret, limits } = readMessagesConfig()
  const client = db()

  const id = conversationId()
  const token = accessToken()
  const tokenHash = hashAccessToken(token, tokenSecret)
  const mid = messageId()
  const createKey =
    clientRequestId && ipHash
      ? createHash('sha256').update(`${ipHash}|${clientRequestId}`).digest('hex').slice(0, 40)
      : null

  // 一次往返：建会话 + 写首条消息 + 幂等判定（0003 迁移里的 plpgsql 函数）
  const { data, error } = await client.rpc('create_conversation_fast', {
    p_id: id,
    p_name: name,
    p_email: email || null,
    p_token_hash: tokenHash,
    p_create_key: createKey,
    p_first_path: firstPath ? String(firstPath).slice(0, 200) : null,
    p_message_id: mid,
    p_content: String(content || '').slice(0, limits.CONTENT_MAX),
    p_client_request_id: clientRequestId || null
  })
  if (error) failFrom(error)

  const row = Array.isArray(data) ? data[0] : data
  if (!row?.conv_id) throw new MessagesError('store_unavailable', 503)

  if (row.is_duplicate) {
    // 重复提交：出于安全，私密链接只在首次创建时返回
    return { id: row.conv_id, token: null, duplicate: true, messageId: null }
  }

  return { id: row.conv_id, token, duplicate: false, messageId: mid }
}

/* ------------------------------------------------------------------ *
 * 读取
 * ------------------------------------------------------------------ */

/** 对外可见会话摘要（不含 token_hash / 不含邮箱明文） */
export async function getConversation(id) {
  const client = db()
  const { data, error } = await client
    .from('conversations')
    .select(PUBLIC_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) failFrom(error)
  return data || null
}

/** 兑换专用：取 token_hash（只在服务端内部使用） */
export async function getConversationForExchange(id) {
  const client = db()
  const { data, error } = await client
    .from('conversations')
    .select('id,status,token_hash,deleted_at,spam_at')
    .eq('id', id)
    .maybeSingle()
  if (error) failFrom(error)
  return data || null
}

export async function listMessages(convId, { limit = 30 } = {}) {
  const client = db()
  const size = Math.max(1, Math.min(100, Number(limit) || 30))
  const { data, error } = await client
    .from('messages')
    .select(MESSAGE_COLUMNS)
    .eq('conversation_id', convId)
    .order('created_at', { ascending: true })
    .limit(size)
  if (error) failFrom(error)
  return data || []
}

/* ------------------------------------------------------------------ *
 * 追加消息
 * ------------------------------------------------------------------ */

export async function appendMessage({ convId, sender, content, clientRequestId }) {
  const { limits } = readMessagesConfig()
  const client = db()
  const now = new Date().toISOString()

  const { data: conv, error: convError } = await client
    .from('conversations')
    .select('id,status,message_count,deleted_at')
    .eq('id', convId)
    .maybeSingle()
  if (convError) failFrom(convError)
  if (!conv || conv.deleted_at) throw new MessagesError('not_found', 404)
  if (conv.status === 'spam') throw new MessagesError('not_found', 404)
  if (Number(conv.message_count || 0) >= limits.MAX_MESSAGES_PER_CONVERSATION) {
    throw new MessagesError('conversation_full', 413)
  }

  const mid = messageId()
  const { data: inserted, error: insertError } = await client
    .from('messages')
    .insert({
      id: mid,
      conversation_id: convId,
      sender,
      content,
      created_at: now,
      client_request_id: clientRequestId || null
    })
    .select(MESSAGE_COLUMNS)
    .maybeSingle()

  if (insertError) {
    // 幂等：同一 (conversation_id, client_request_id) 已存在 → 返回原消息
    if (String(insertError.code) === '23505' && clientRequestId) {
      const { data: existing } = await client
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', convId)
        .eq('client_request_id', clientRequestId)
        .maybeSingle()
      if (existing) return { message: existing, duplicated: true }
    }
    failFrom(insertError)
  }

  const patch = {
    updated_at: now,
    last_message_at: now,
    message_count: Number(conv.message_count || 0) + 1
  }
  if (sender === 'visitor') {
    patch.last_visitor_at = now
    patch.unread_count = 1 // 简化：有新访客消息即视为未读（管理员读后归零）
  } else {
    patch.last_admin_at = now
  }

  // 访客新消息 → 已解决/已归档/已读/处理中 全部回到 unread
  if (sender === 'visitor' && conv.status !== 'unread') patch.status = 'unread'
  // 管理员回复 → 未读/已读 视为处理中
  if (sender === 'admin' && ['unread', 'read'].includes(conv.status)) patch.status = 'processing'

  const { error: patchError } = await client.from('conversations').update(patch).eq('id', convId)
  if (patchError) {
    // 消息已写入，只更新失败：不回滚消息（用户已发出），记录后由后台统计修正
    console.error('[messages][db] counter update failed:', String(patchError.message || '').slice(0, 160))
  }

  return { message: inserted, duplicated: false }
}

/* ------------------------------------------------------------------ *
 * 管理员：未读统计 / 列表 / 状态
 * ------------------------------------------------------------------ */

export async function getStats() {
  const client = db()

  const { count: unreadConversations, error: unreadError } = await client
    .from('conversations')
    .select('id', { count: 'exact', head: true })
    .gt('unread_count', 0)
    .is('deleted_at', null)
  if (unreadError) failFrom(unreadError)

  const { data: statusRows, error: statusError } = await client
    .from('conversations')
    .select('status')
    .is('deleted_at', null)
    .limit(5000)
  if (statusError) failFrom(statusError)

  const byStatus = {}
  ;(statusRows || []).forEach(row => {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1
  })

  return {
    unreadConversations: Number(unreadConversations || 0),
    total: (statusRows || []).length,
    byStatus
  }
}

export async function listConversations({ status, q, page = 1, pageSize = 20 } = {}) {
  const client = db()
  const size = Math.max(1, Math.min(50, Number(pageSize) || 20))
  const current = Math.max(1, Number(page) || 1)
  const from = (current - 1) * size
  const to = from + size - 1

  let query = client
    .from('conversations')
    .select(PUBLIC_COLUMNS, { count: 'exact' })
    .is('deleted_at', null)

  if (status && status !== 'all') query = query.eq('status', status)
  if (q) query = query.ilike('visitor_name', `%${String(q).slice(0, 40)}%`)

  const { data, error, count } = await query
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(from, to)
  if (error) failFrom(error)

  return { rows: data || [], total: Number(count || 0), page: current, pageSize: size }
}

export async function getConversationDetail(id) {
  const client = db()
  const { data: conv, error } = await client
    .from('conversations')
    .select(`${PUBLIC_COLUMNS}`)
    .eq('id', id)
    .is('deleted_at', null) // 软删后对管理员也不可见（purge 才是彻底删）
    .maybeSingle()
  if (error) failFrom(error)
  if (!conv) return null
  const messages = await listMessages(id, { limit: 100 })
  return { conversation: conv, messages }
}

const STATUSES = ['unread', 'read', 'processing', 'resolved', 'archived', 'spam']

export async function updateStatus(id, status) {
  if (!STATUSES.includes(status)) throw new MessagesError('invalid_status', 400)
  const client = db()
  const now = new Date().toISOString()
  const patch = { status, updated_at: now }
  if (status === 'resolved') patch.resolved_at = now
  if (status === 'archived') patch.archived_at = now
  if (status === 'spam') patch.spam_at = now
  if (status === 'unread') patch.unread_count = 1
  if (status === 'read') patch.unread_count = 0

  const { data, error } = await client
    .from('conversations')
    .update(patch)
    .eq('id', id)
    .is('deleted_at', null)
    .select(PUBLIC_COLUMNS)
    .maybeSingle()
  if (error) failFrom(error)
  if (!data) throw new MessagesError('not_found', 404)
  return data
}

export async function markRead(id) {
  const client = db()
  const now = new Date().toISOString()

  const { error: msgError } = await client
    .from('messages')
    .update({ read_at: now })
    .eq('conversation_id', id)
    .eq('sender', 'visitor')
    .is('read_at', null)
  if (msgError) failFrom(msgError)

  // 未读数**无条件**归零（否则 processing/resolved 会话会永远挂着未读徽标）
  const { error: clearError } = await client
    .from('conversations')
    .update({ unread_count: 0, updated_at: now })
    .eq('id', id)
  if (clearError) failFrom(clearError)

  // 只有 unread 才顺带变成 read；processing/resolved 等状态保持不变
  const { error: statusError } = await client
    .from('conversations')
    .update({ status: 'read' })
    .eq('id', id)
    .eq('status', 'unread')
  if (statusError) failFrom(statusError)

  return true
}

/* ------------------------------------------------------------------ *
 * 访问审计（Phase 4：兑换成功/失败都记一条，不含 token 与明文 IP）
 * ------------------------------------------------------------------ */

export async function logAccess({ convId, action, result, ipHash }) {
  try {
    const client = db()
    await client.from('access_logs').insert({
      conversation_id: convId || null,
      action: String(action || 'unknown').slice(0, 40),
      result: String(result || 'unknown').slice(0, 40),
      ip_hash: ipHash ? String(ipHash).slice(0, 24) : null
    })
  } catch (err) {
    console.warn('[messages][access] log failed:', err?.message || err)
  }
}

/* ------------------------------------------------------------------ *
 * 删除：软删（可恢复）与彻底删除（purge）
 * ------------------------------------------------------------------ */

export async function softDeleteConversation(id) {
  const client = db()
  const now = new Date().toISOString()
  const { data, error } = await client
    .from('conversations')
    .update({ deleted_at: now, updated_at: now, unread_count: 0 })
    .eq('id', id)
    .is('deleted_at', null)
    .select('id')
    .maybeSingle()
  if (error) failFrom(error)
  if (!data) throw new MessagesError('not_found', 404)
  return true
}

/** 彻底删除：先删索引性字段（行本身），消息由外键级联删除 */
export async function purgeConversation(id) {
  const client = db()
  const { error } = await client.from('conversations').delete().eq('id', id)
  if (error) failFrom(error)
  return true
}

/**
 * 按会话短码（id 前缀）查找，用于 TG 指令 /close <短码>。
 * 只有唯一命中才返回，0 个或多个都返回 null，避免结案结错。
 */
export async function findByShortId(prefix) {
  const clean = String(prefix || '').trim()
  if (!/^[A-Za-z0-9_-]{4,16}$/.test(clean)) return null
  const client = db()
  const { data, error } = await client
    .from('conversations')
    .select(PUBLIC_COLUMNS)
    .like('id', `${clean}%`)
    .is('deleted_at', null)
    .limit(2)
  if (error) failFrom(error)
  if (!data || data.length !== 1) return null
  return data[0]
}
