/**
 * GET /robots.txt（经 next.config 重写，对外仍是 /robots.txt）
 *
 * 规则来源：lib/seo/robots.js —— 与构建期写出的 public/robots.txt **同源**。
 * 背景：项目在 build 阶段会生成 public/robots.txt（静态文件优先于 rewrites），
 * 所以两处必须是同一份规则，否则线上规则会和这里不一致。
 */

import { siteConfig } from '@/lib/config'
import { buildRobotsTxt } from '@/lib/seo/robots'

function resolveOrigin(req) {
  const configured = String(siteConfig('LINK', '') || process.env.NEXT_PUBLIC_SITE_URL || '').trim()
  if (configured) {
    try {
      return new URL(configured).origin
    } catch (err) {
      /* 落回请求头 */
    }
  }
  const proto = String(req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim()
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').trim()
  return host ? `${proto}://${host}` : ''
}

export default function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD')
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const body = buildRobotsTxt({ origin: resolveOrigin(req) })
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400')
  res.status(200).send(body)
}
