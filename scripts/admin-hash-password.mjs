#!/usr/bin/env node
/**
 * 生成管理员密码哈希（离线运行，不联网、不写文件）
 *
 * 用法：
 *   node scripts/admin-hash-password.mjs "你的密码"
 *   node scripts/admin-hash-password.mjs "你的密码" --username=admin
 *
 * 输出直接粘贴到部署平台的 ADMIN_PASSWORD_HASH。
 * 说明：优先使用 bcrypt（若项目已安装 bcryptjs），否则使用 node:crypto scrypt（零依赖）。
 */

import { hashPassword, validatePasswordStrength } from '../lib/admin/password.js'

const args = process.argv.slice(2)
const password = args.find(arg => !arg.startsWith('--'))
const usernameArg = args.find(arg => arg.startsWith('--username='))
const username = usernameArg ? usernameArg.split('=')[1] : ''

if (!password) {
  console.error('用法: node scripts/admin-hash-password.mjs "你的密码" [--username=admin]')
  process.exit(1)
}

const strengthError = validatePasswordStrength(password, 12, username)
if (strengthError) {
  console.error(`密码不符合要求：${strengthError}`)
  process.exit(1)
}

const start = Date.now()
const hash = await hashPassword(password, 12)
console.log(hash)
console.error(`# 算法=${hash.split('$')[0]} 耗时=${Date.now() - start}ms 长度=${hash.length}`)
