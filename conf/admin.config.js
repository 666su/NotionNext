/**
 * Jason Blog Admin —— 后台独立配置（不进入 blog.config.js，避免被序列化到公开页面）
 *
 * 说明：
 * 1. 本文件**不要**被 blog.config.js require，否则 ADMIN_* 会随 BLOG 进入 __NEXT_DATA__。
 * 2. 这里只放"非秘密"的调参项；密码哈希、会话密钥等秘密**只能**来自 process.env。
 */
module.exports = {
  // 总开关（关闭后 /admin 与 /api/admin/* 一律 503）
  ADMIN_ENABLE: process.env.ADMIN_ENABLE || 'true',

  // Cookie 名
  ADMIN_COOKIE_NAME: process.env.ADMIN_COOKIE_NAME || 'jba_sid',
  ADMIN_CSRF_COOKIE_NAME: process.env.ADMIN_CSRF_COOKIE_NAME || 'jba_csrf',

  // 会话：空闲超时（分钟）/ 绝对有效期（小时）
  ADMIN_SESSION_IDLE_MIN: Number(process.env.ADMIN_SESSION_IDLE_MIN || 30),
  ADMIN_SESSION_TTL_HOURS: Number(process.env.ADMIN_SESSION_TTL_HOURS || 12),

  // 登录限流
  ADMIN_LOGIN_MAX_FAILS: Number(process.env.ADMIN_LOGIN_MAX_FAILS || 5),
  ADMIN_LOGIN_WINDOW_MIN: Number(process.env.ADMIN_LOGIN_WINDOW_MIN || 15),
  ADMIN_LOGIN_IP_MAX: Number(process.env.ADMIN_LOGIN_IP_MAX || 20),

  // 密码
  ADMIN_BCRYPT_COST: Number(process.env.ADMIN_BCRYPT_COST || 12),
  ADMIN_PASSWORD_MIN_LENGTH: Number(process.env.ADMIN_PASSWORD_MIN_LENGTH || 12),

  // 审计日志
  ADMIN_AUDIT_MAX_ENTRIES: 5000,
  ADMIN_AUDIT_TTL_DAYS: 90
}
