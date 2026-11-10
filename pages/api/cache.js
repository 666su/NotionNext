import { cleanCache } from '@/lib/cache/local_file_cache'
import crypto from 'node:crypto'

/**
 * 清理缓存
 * POST /api/cache
 *
 * 安全要求（Phase 1 修复 F-04）：
 * - **fail-closed**：未配置 CACHE_REVALIDATION_TOKEN 时直接 503，绝不"无 token 即放行"。
 * - 常量时间比较，避免时序侧信道。
 */

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8')
  const bufB = Buffer.from(String(b || ''), 'utf8')
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ status: 'error', message: 'Method not allowed' })
  }

  res.setHeader('Cache-Control', 'no-store')

  const token = process.env.CACHE_REVALIDATION_TOKEN
  if (!token) {
    // fail-closed：没有配置密钥就不允许清缓存
    return res.status(503).json({
      status: 'error',
      message: 'CACHE_REVALIDATION_TOKEN 未配置，接口已禁用'
    })
  }

  const provided = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!timingSafeEqual(provided, token)) {
    return res.status(401).json({ status: 'error', message: 'Unauthorized' })
  }

  try {
    cleanCache()
    res.status(200).json({ status: 'success', message: 'Clean cache successful!' })
  } catch (error) {
    console.error('Cache clean error:', error?.message || error)
    res.status(400).json({ status: 'error', message: 'Clean cache failed!' })
  }
}
