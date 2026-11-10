/**
 * 管理员操作审计日志
 *
 * 存储：Redis List `admin:audit`（LPUSH，LTRIM 5000，TTL 90 天）。
 * 只记录必要字段；**不记录密码、明文 IP、Cookie、token**。
 * 审计失败绝不阻断主流程（catch 后仅告警）。
 */

import { KV_AUDIT } from './constants'
import { kvExpire, kvLpush, kvLrange, kvLtrim } from '@/lib/kv'

const MAX_ENTRIES = 5000
const TTL_SEC = 90 * 24 * 3600

export async function audit({
  action,
  result = 'ok',
  user = '',
  ipHash = '',
  uaHash = '',
  detail = null
}) {
  try {
    const entry = {
      at: new Date().toISOString(),
      action: String(action || 'unknown'),
      result: String(result || 'ok'),
      user: String(user || ''),
      ipHash: String(ipHash || ''),
      uaHash: String(uaHash || ''),
      detail: detail == null ? null : String(detail).slice(0, 500)
    }
    await kvLpush(KV_AUDIT, JSON.stringify(entry))
    await kvLtrim(KV_AUDIT, 0, MAX_ENTRIES - 1)
    await kvExpire(KV_AUDIT, TTL_SEC)
    return true
  } catch (err) {
    console.error('[admin][audit] write failed:', err?.message || err)
    return false
  }
}

export async function readAudit(limit = 50) {
  const max = Math.max(1, Math.min(200, Number(limit) || 50))
  const rows = await kvLrange(KV_AUDIT, 0, max - 1)
  return (rows || [])
    .map(raw => {
      try {
        return JSON.parse(raw)
      } catch (err) {
        return null
      }
    })
    .filter(Boolean)
}
