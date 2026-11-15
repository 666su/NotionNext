/**
 * 私信系统调参（非秘密，可提交）
 *
 * 秘密（SUPABASE_SECRET_KEY / MESSAGE_TOKEN_SECRET）只能来自 process.env。
 */

module.exports = {
  // 总开关：false 时所有 /api/messages/* 返回 503
  MESSAGES_ENABLED: process.env.MESSAGES_ENABLED || 'true',

  // 字段限制（规范 §4.2）
  NAME_MIN: 1,
  NAME_MAX: 40,
  EMAIL_MAX: 254,
  CONTENT_MIN: 1,
  CONTENT_MAX: 5000,

  // 单会话消息上限（防单键/单表无限增长）
  MAX_MESSAGES_PER_CONVERSATION: Number(
    process.env.MESSAGES_MAX_MESSAGES_PER_CONVERSATION || 2000
  ),

  // 私密 Cookie
  COOKIE_PREFIX: 'jbm_', // 完整名 = jbm_<convId 前 10 位>
  COOKIE_TTL_SEC: Number(process.env.MESSAGES_COOKIE_TTL_SEC || 7 * 24 * 3600),

  // 限流（规范 §8.1 的初值）
  RATE: {
    createPerIp10m: 3,
    createPerIpDay: 10,
    createGlobalDay: 200,
    sendPerConvMinute: 5,
    sendPerConvHour: 30,
    exchangePerIpMinute: 10,
    exchangePerIpHour: 60,
    exchangeFail30m: 10
  },

  // 内容防护
  MAX_SAME_CHAR_RUN: 50,
  EMAIL_RE: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
}
