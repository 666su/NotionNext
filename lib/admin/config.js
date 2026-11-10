/**
 * 后台配置读取与校验（服务端专用）
 *
 * 设计原则：**fail-closed**。配置缺失时后台整体不可用，绝不"缺 key 就放行"。
 */

import ADMIN_CONF from '@/conf/admin.config'

const MIN_SECRET_LENGTH = 32

/** 允许的密码哈希格式：bcrypt（首选）或 scrypt（零依赖兜底） */
export function isSupportedHash(hash) {
  const value = String(hash || '')
  const bcrypt = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value)
  const scrypt = /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/.test(value)
  return bcrypt || scrypt
}

function isProdLike() {
  return (
    process.env.NODE_ENV === 'production' ||
    !!process.env.VERCEL_ENV ||
    process.env.BUILD_MODE === 'true'
  )
}

export function allowMemoryStore() {
  // 仅本地开发显式开启；生产永远 false（即使误配也忽略）
  return (
    !isProdLike() &&
    String(process.env.ADMIN_ALLOW_MEMORY_STORE || '').toLowerCase() === 'true'
  )
}

/**
 * @returns {{
 *   ready: boolean,
 *   code: string,
 *   missing: string[],
 *   warnings: string[],
 *   enabled: boolean,
 *   username: string,
 *   passwordHash: string,
 *   sessionSecret: string,
 *   initToken: string,
 *   redisUrl: string,
 *   backend: 'redis'|'memory'|'none',
 *   sessionIdleSec: number,
 *   sessionTtlSec: number,
 *   bcryptCost: number,
 *   passwordMinLength: number,
 *   loginMaxFails: number,
 *   loginWindowSec: number,
 *   loginIpMax: number,
 *   cookieName: string,
 *   csrfCookieName: string
 * }}
 */
export function readAdminConfig() {
  const missing = []
  const warnings = []

  const enabled = String(ADMIN_CONF.ADMIN_ENABLE) !== 'false'
  const username = String(process.env.ADMIN_USERNAME || '').trim()
  const passwordHash = String(process.env.ADMIN_PASSWORD_HASH || '').trim()
  const sessionSecret = String(process.env.SESSION_SECRET || '').trim()
  const initToken = String(process.env.ADMIN_INIT_TOKEN || '').trim()
  const redisUrl = String(process.env.REDIS_URL || '').trim()
  const backend = redisUrl ? 'redis' : allowMemoryStore() ? 'memory' : 'none'

  if (!enabled) missing.push('ADMIN_ENABLE=开启')
  if (!username) missing.push('ADMIN_USERNAME')
  if (!passwordHash && !initToken) missing.push('ADMIN_PASSWORD_HASH')
  if (passwordHash && !isSupportedHash(passwordHash)) {
    missing.push('ADMIN_PASSWORD_HASH(格式非法：需 bcrypt 或 scrypt)')
  }
  // bcrypt 哈希需要显式启用算法并安装 bcryptjs；否则登录必然失败（避免静默锁死）
  if (
    passwordHash &&
    /^\$2[aby]\$/.test(passwordHash) &&
    String(process.env.ADMIN_PASSWORD_ALGO || '').toLowerCase() !== 'bcrypt'
  ) {
    missing.push(
      'ADMIN_PASSWORD_ALGO=bcrypt（检测到 bcrypt 哈希：需显式启用该算法并安装 bcryptjs）'
    )
  }
  if (!sessionSecret) {
    missing.push('SESSION_SECRET')
  } else if (sessionSecret.length < MIN_SECRET_LENGTH) {
    missing.push(`SESSION_SECRET(长度需 ≥ ${MIN_SECRET_LENGTH})`)
  }
  if (backend === 'none') missing.push('REDIS_URL')
  if (backend === 'memory') {
    warnings.push('当前使用内存会话存储（仅限本地开发），生产必须配置 REDIS_URL')
  }

  return {
    ready: missing.length === 0,
    code: !enabled ? 'disabled' : missing.length ? 'unconfigured' : 'ready',
    missing,
    warnings,
    enabled,
    username,
    passwordHash,
    sessionSecret,
    initToken,
    redisUrl,
    backend,
    sessionIdleSec: Math.max(60, Number(ADMIN_CONF.ADMIN_SESSION_IDLE_MIN || 30) * 60),
    sessionTtlSec: Math.max(
      600,
      Number(ADMIN_CONF.ADMIN_SESSION_TTL_HOURS || 12) * 3600
    ),
    bcryptCost: Number(ADMIN_CONF.ADMIN_BCRYPT_COST || 12),
    passwordMinLength: Number(ADMIN_CONF.ADMIN_PASSWORD_MIN_LENGTH || 12),
    loginMaxFails: Number(ADMIN_CONF.ADMIN_LOGIN_MAX_FAILS || 5),
    loginWindowSec: Number(ADMIN_CONF.ADMIN_LOGIN_WINDOW_MIN || 15) * 60,
    loginIpMax: Number(ADMIN_CONF.ADMIN_LOGIN_IP_MAX || 20),
    cookieName: ADMIN_CONF.ADMIN_COOKIE_NAME,
    csrfCookieName: ADMIN_CONF.ADMIN_CSRF_COOKIE_NAME
  }
}

/** 后台不可用时给管理员看的说明（不含任何密钥值） */
export function describeAdminConfigProblem(config) {
  if (config.code === 'disabled') {
    return '后台已被 ADMIN_ENABLE=false 关闭。'
  }
  return `后台未完成初始化，缺少或不合法的配置项：${config.missing.join('、')}。请在部署平台（Vercel → Settings → Environment Variables）补齐后重新部署。`
}
