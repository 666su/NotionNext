/**
 * 推送通知功能配置
 * 读者在设置面板自选通知方式并配置自己的密钥
 * 博主只需开启总开关；可选配置全局 Webhook
 */
module.exports = {
  // 总开关（true 时启用推送检测）
  NOTIFY_ENABLE: process.env.NOTIFY_ENABLE || false,

  // Web Push VAPID 密钥（留空则自动生成并持久化）
  // 生产环境建议设置 REDIS_URL 确保密钥持久化
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:admin@localhost',

  // 博主侧 Webhook（可选，博主在 Vercel 配置）
  // 企业微信 / 钉钉 / 自定义机器人
  PUSH_WEBHOOK_URL: process.env.PUSH_WEBHOOK_URL || '',

  // 手动触发推送的密钥
  NOTIFY_SECRET:
    process.env.NOTIFY_SECRET || process.env.REVALIDATION_TOKEN || ''
}
