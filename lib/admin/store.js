/**
 * 管理员账户存储
 *
 * 单一管理员（可扩展）：`admin:user:<username>` → Hash（JSON 存字符串，便于审计与迁移）
 * 首次登录时用环境变量 ADMIN_PASSWORD_HASH 引导写入；之后以存储中的哈希为准（改密生效）。
 */

import { KV_BOOT, KV_USER } from './constants'
import { kvGet, kvSet, kvDel } from '@/lib/kv'

export async function getUser(username) {
  if (!username) return null
  const raw = await kvGet(KV_USER + username)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!parsed?.passwordHash) return null
    return parsed
  } catch (err) {
    return null
  }
}

export async function saveUser({ username, passwordHash, role = 'admin' }) {
  const now = new Date().toISOString()
  const existing = await getUser(username)
  const record = {
    username,
    passwordHash,
    role,
    createdAt: existing?.createdAt || now,
    updatedAt: now
  }
  await kvSet(KV_USER + username, JSON.stringify(record))
  return record
}

export async function deleteUser(username) {
  if (!username) return 0
  return kvDel(KV_USER + username)
}

/**
 * 解析当前管理员账户：
 * - 存储里有记录 → 以记录为准（改过密码就用新密码）
 * - 存储里没有但环境变量提供了哈希 → 返回"引导态"账户，登录成功后落库
 */
export async function resolveAdminUser(config) {
  const stored = await getUser(config.username)
  if (stored) return { ...stored, bootstrap: false }
  if (config.passwordHash) {
    return {
      username: config.username,
      passwordHash: config.passwordHash,
      role: 'admin',
      bootstrap: true
    }
  }
  return null
}

export async function markBootstrapped(username) {
  await kvSet(KV_BOOT, JSON.stringify({ username, at: new Date().toISOString() }))
}
