/**
 * 推送通知功能配置
 * 所有密钥类配置仅从环境变量读取（不放 Notion 配置表，避免泄露）
 */
module.exports = {
  // 总开关（true 时启用推送）
  NOTIFY_ENABLE: process.env.NOTIFY_ENABLE || false,

  // Web Push（浏览器推送）VAPID 密钥
  // 留空则首次运行时自动生成本地密钥对并持久化存储
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:admin@localhost',

  // Telegram 机器人
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  // Server酱（微信推送）
  SERVERCHAN_SENDKEY: process.env.SERVERCHAN_SENDKEY || '',

  // 通用 Webhook（企业微信 / 钉钉 / 自定义机器人）
  PUSH_WEBHOOK_URL: process.env.PUSH_WEBHOOK_URL || '',

  // 手动触发推送的密钥（默认复用 REVALIDATION_TOKEN）
  NOTIFY_SECRET:
    process.env.NOTIFY_SECRET || process.env.REVALIDATION_TOKEN || ''
}
