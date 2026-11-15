/**
 * 私信系统的运行配置与环境变量（服务端专用）
 *
 * fail-closed：Supabase 凭据或 MESSAGE_TOKEN_SECRET 缺失时，`ready=false`，
 * 所有私信接口返回 503（不影响公开博客）。
 */

import MSG_CONF from '@/conf/messages.config'

export const MESSAGES_SCHEMA = 'messages'

export function readMessagesConfig() {
  const url = String(
    process.env.MESSAGES_SUPABASE_URL || process.env.SUPABASE_URL || ''
  ).trim()
  const secretKey = String(
    process.env.MESSAGES_SUPABASE_SECRET_KEY || process.env.SUPABASE_SECRET_KEY || ''
  ).trim()
  const tokenSecret = String(process.env.MESSAGE_TOKEN_SECRET || '').trim()
  const enabled = String(MSG_CONF.MESSAGES_ENABLED || 'true') !== 'false'

  const missing = []
  if (!url) missing.push('SUPABASE_URL')
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY')
  if (!tokenSecret || tokenSecret.length < 32) missing.push('MESSAGE_TOKEN_SECRET(>=32 字符)')

  return {
    enabled,
    url,
    secretKey,
    tokenSecret,
    ready: enabled && missing.length === 0,
    missing,
    limits: MSG_CONF
  }
}

/** 统一的"私信不可用"响应体（不暴露内部原因） */
export function messagesUnavailable(res, json) {
  return json(res, 503, { error: 'messages_unavailable' })
}
