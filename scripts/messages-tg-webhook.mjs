#!/usr/bin/env node
/**
 * Telegram Webhook 管理（Phase 7）
 *
 *   node scripts/messages-tg-webhook.mjs info
 *   node scripts/messages-tg-webhook.mjs set --url=https://blog.20240606.xyz/api/telegram/webhook
 *   node scripts/messages-tg-webhook.mjs delete
 *   node scripts/messages-tg-webhook.mjs test            # 发一条测试消息
 *   node scripts/messages-tg-webhook.mjs pending         # 看未处理 update 数
 *
 * 凭据优先级：process.env → .dsh-ops/dev-env.sh
 * 需要的变量：TELEGRAM_BOT_TOKEN（必需）、TELEGRAM_CHAT_ID（test 用）、
 *            TELEGRAM_WEBHOOK_SECRET（set 必需）、TELEGRAM_API_BASE（可选，默认官方）
 *
 * 安全：脚本**不会**打印 token 与 secret，只打印是否已配置与长度。
 */

import fs from 'node:fs'
import path from 'node:path'

const ENV_FILES = [
  path.join(process.cwd(), '.dsh-ops', 'tg-prod.env'), // 生产真实 bot（优先）
  path.join(process.cwd(), '.dsh-ops', 'dev-env.sh') // 本地测试桩
]

function parseEnvFile(file, key) {
  try {
    const text = fs.readFileSync(file, 'utf8')
    // 兼容三种写法：K=V / export K=V / set K=V（Windows cmd）
    const m = text.match(new RegExp(`^\\s*(?:export\\s+|set\\s+)?${key}\\s*=\\s*(.*)$`, 'm'))
    if (!m) return ''
    return m[1].trim().replace(/^['"]|['"]$/g, '')
  } catch (err) {
    return ''
  }
}

function readEnvFile(key) {
  const explicit = args.env ? String(args.env) : ''
  // 只用一个来源，避免"生产 token + 本地 API base"混用：tg-prod.env 存在就只用它
  const file = explicit
    ? path.resolve(process.cwd(), explicit)
    : ENV_FILES.find(item => fs.existsSync(item)) || ENV_FILES[1]
  return parseEnvFile(file, key)
}

function env(key) {
  return String(process.env[key] || readEnvFile(key) || '').trim()
}

const args = Object.fromEntries(
  process.argv.slice(3).map(item => {
    const m = item.match(/^--([^=]+)=?(.*)$/)
    return m ? [m[1], m[2] || true] : [item, true]
  })
)

const command = process.argv[2] || 'info'
const token = env('TELEGRAM_BOT_TOKEN')
const chatId = env('TELEGRAM_CHAT_ID')
const secret = env('TELEGRAM_WEBHOOK_SECRET')
const apiBase = (env('TELEGRAM_API_BASE') || 'https://api.telegram.org').replace(/\/+$/, '')

if (!token) {
  console.error('缺少 TELEGRAM_BOT_TOKEN（环境变量或 .dsh-ops/dev-env.sh）')
  process.exit(2)
}

async function call(method, payload) {
  const res = await fetch(`${apiBase}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {})
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, ok: Boolean(data.ok), data }
}

async function main() {
  if (command === 'info') {
    const { ok, data } = await call('getWebhookInfo')
    console.log(`API base: ${apiBase}`)
    console.log(`token: ${token.slice(0, 4)}…(${token.length} 字符) · secret: ${secret ? '已配置' : '未配置'}`)
    if (!ok) return console.log('getWebhookInfo 失败:', data)
    const info = data.result || {}
    console.log('url:', info.url || '(未设置)')
    console.log('pending_update_count:', info.pending_update_count ?? 0)
    console.log('last_error:', info.last_error_message || '(无)')
    console.log('max_connections:', info.max_connections ?? '(默认)')
    return
  }

  if (command === 'set') {
    const url = args.url
    if (!url) {
      console.error('用法：set --url=https://<域名>/api/telegram/webhook')
      process.exit(2)
    }
    if (!secret) {
      console.error('缺少 TELEGRAM_WEBHOOK_SECRET：不接受无签名来源，请先配置再 set')
      process.exit(2)
    }
    if (!String(url).startsWith('https://')) {
      console.error('Telegram 只接受 https 的 webhook 地址')
      process.exit(2)
    }
    const { ok, data } = await call('setWebhook', {
      url,
      secret_token: secret,
      allowed_updates: ['message', 'edited_message'],
      drop_pending_updates: false
    })
    console.log(ok ? '✅ webhook 已设置' : '❌ 设置失败', data.ok ? '' : data)
    return
  }

  if (command === 'delete') {
    const { ok, data } = await call('deleteWebhook', { drop_pending_updates: false })
    console.log(ok ? '✅ webhook 已删除' : '❌ 删除失败', data.ok ? '' : data)
    return
  }

  if (command === 'pending') {
    const { ok, data } = await call('getWebhookInfo')
    if (!ok) return console.log('失败:', data)
    console.log('pending_update_count:', data.result?.pending_update_count ?? 0)
    console.log('last_error:', data.result?.last_error_message || '(无)')
    return
  }

  if (command === 'test') {
    if (!chatId) {
      console.error('缺少 TELEGRAM_CHAT_ID')
      process.exit(2)
    }
    const { ok, data } = await call('sendMessage', {
      chat_id: chatId,
      text: '<b>私信通道自检</b>\n如果你看到这条，说明 bot → 你的会话是通的。\n接下来访客来信会自动推到这里，直接「回复」就能回给他。',
      parse_mode: 'HTML',
      disable_web_page_preview: true
    })
    console.log(ok ? `✅ 已发送，message_id=${data.result?.message_id}` : '❌ 发送失败', data.ok ? '' : data)
    return
  }

  console.log('未知命令：' + command)
  console.log('可用：info | set --url=... | delete | test | pending')
}

main().catch(err => {
  console.error('执行失败:', err?.message || err)
  process.exit(1)
})
