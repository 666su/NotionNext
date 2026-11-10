/**
 * 管理员密码哈希
 *
 * - 默认使用 node:crypto 的 scrypt（N=2^15, r=8, p=1，零依赖，Vercel 兼容）。
 * - 若显式设置 ADMIN_PASSWORD_ALGO=bcrypt 且已安装 bcryptjs，则使用 bcrypt（cost 12）。
 * - 校验时按哈希串前缀分派算法，因此两种算法的历史哈希可共存、可平滑迁移。
 * - 明文密码永不落库、永不下发客户端、永不写日志。
 */

import crypto from 'node:crypto'

const SCRYPT_N = 32768
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 64

let bcryptModule
let bcryptWarned = false

function bcryptRequested() {
  return String(process.env.ADMIN_PASSWORD_ALGO || '').toLowerCase() === 'bcrypt'
}

async function loadBcrypt() {
  if (bcryptModule !== undefined) return bcryptModule
  if (!bcryptRequested()) {
    // 未显式启用：不尝试导入，避免打包期 "Module not found" 噪音
    bcryptModule = null
    return bcryptModule
  }
  try {
    const mod = await import('bcryptjs')
    bcryptModule = mod.default || mod
  } catch (err) {
    if (!bcryptWarned) {
      bcryptWarned = true
      console.warn(
        '[admin][password] ADMIN_PASSWORD_ALGO=bcrypt 但 bcryptjs 未安装，回退 scrypt：',
        err?.message || err
      )
    }
    bcryptModule = null
  }
  return bcryptModule
}

export function isBcryptHash(hash) {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(String(hash || ''))
}

export function isScryptHash(hash) {
  return String(hash || '').startsWith('scrypt$')
}

export async function hashPassword(plain, cost = 12) {
  const bcrypt = await loadBcrypt()
  if (bcrypt) return bcrypt.hash(String(plain), cost)

  const salt = crypto.randomBytes(16)
  const derived = crypto.scryptSync(String(plain), salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 64 * 1024 * 1024
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64url')}$${derived.toString('base64url')}`
}

export async function verifyPassword(plain, hash) {
  if (!hash) return false
  const bcrypt = await loadBcrypt()

  if (isBcryptHash(hash)) {
    if (!bcrypt) return false
    try {
      return await bcrypt.compare(String(plain), hash)
    } catch (err) {
      return false
    }
  }

  if (isScryptHash(hash)) {
    try {
      const [, n, r, p, saltB64, hashB64] = String(hash).split('$')
      const salt = Buffer.from(saltB64, 'base64url')
      const expected = Buffer.from(hashB64, 'base64url')
      const derived = crypto.scryptSync(String(plain), salt, expected.length, {
        N: Number(n),
        r: Number(r),
        p: Number(p),
        maxmem: 64 * 1024 * 1024
      })
      return crypto.timingSafeEqual(derived, expected)
    } catch (err) {
      return false
    }
  }

  return false
}

/**
 * 用户名不存在时也跑一次哈希比较，避免通过响应时间判断账号是否存在。
 */
let dummyHashCache = null
export async function burnPasswordTime(plain, cost = 12) {
  if (!dummyHashCache) {
    dummyHashCache = await hashPassword('jba-dummy-password-value', cost)
  }
  await verifyPassword(String(plain || ''), dummyHashCache)
  return false
}

/** 密码强度校验；返回错误信息或 null */
export function validatePasswordStrength(plain, minLength = 12, username = '') {
  const value = String(plain || '')
  if (value.length < minLength) return `密码长度至少 ${minLength} 位`
  if (value.length > 128) return '密码长度不能超过 128 位'
  if (username && value.toLowerCase().includes(String(username).toLowerCase())) {
    return '密码不能包含管理员用户名'
  }
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) {
    return '密码需同时包含字母和数字'
  }
  return null
}
