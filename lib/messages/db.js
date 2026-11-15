/**
 * Supabase 客户端（服务端专用）
 *
 * - 只允许在 Node 侧（API handler / GSSP）使用；
 * - 使用 secret key（service_role），绕过 RLS；**绝不能**用 NEXT_PUBLIC_ 前缀的 key；
 * - 凭据缺失时返回 null，调用方按 503 处理（fail-closed，不影响公开博客）。
 */

import { createClient } from '@supabase/supabase-js'
import { MESSAGES_SCHEMA, readMessagesConfig } from './config'

let client = globalThis.__jbmSupabase || null

export function getMessagesClient() {
  const config = readMessagesConfig()
  if (!config.url || !config.secretKey) return null
  if (client) return client
  client = createClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    db: { schema: MESSAGES_SCHEMA },
    global: { headers: { 'X-Client-Info': 'jason-blog-messages/1' } }
  })
  globalThis.__jbmSupabase = client
  return client
}

/** 供健康检查/后台页：只报"是否配置 + 是否可达"，不返回密钥 */
export function describeMessagesBackend() {
  const config = readMessagesConfig()
  return {
    enabled: config.enabled,
    configured: !!(config.url && config.secretKey && config.tokenSecret),
    missing: config.missing,
    schema: MESSAGES_SCHEMA
  }
}
