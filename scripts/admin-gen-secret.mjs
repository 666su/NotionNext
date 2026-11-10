#!/usr/bin/env node
/**
 * 生成后台所需的安全随机密钥（离线运行）
 *
 * 用法：
 *   node scripts/admin-gen-secret.mjs            # 生成 SESSION_SECRET
 *   node scripts/admin-gen-secret.mjs 48         # 指定字节数
 */

import crypto from 'node:crypto'

const bytes = Number(process.argv[2] || 48)
const size = Number.isFinite(bytes) && bytes >= 32 ? Math.min(bytes, 96) : 48
console.log(crypto.randomBytes(size).toString('base64url'))
