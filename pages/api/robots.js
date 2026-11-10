/**
 * GET /robots.txt（经 next.config 重写，对外仍是 /robots.txt）
 *
 * 为什么不用 public/robots.txt：
 *   Sitemap 必须写绝对地址，而站点域名来自 Notion 配置/环境变量，静态文件写不死。
 *
 * 规则要点：
 * - 只禁止管理面、接口、登录态页面；正文与文章目录保持可抓取（否则等于自残收录）；
 * - 保留 Crawl-delay 不写（Google 已忽略，写了反而误导）；
 * - 带上 sitemap 全量地址，避免搜索引擎只靠外链发现。
 */

import { siteConfig } from '@/lib/config'

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

  const origin = resolveOrigin(req)

  const lines = [
    '# 由 /api/robots 动态生成；如需改动规则，修改 pages/api/robots.js',
    'User-agent: *',
    'Allow: /',
    '',
    '# 管理后台与接口：不索引、不抓取',
    'Disallow: /admin',
    'Disallow: /admin/',
    'Disallow: /api/',
    '',
    '# 登录/账号相关页面（无搜索价值，且会带个性化内容）',
    'Disallow: /auth',
    'Disallow: /auth/',
    'Disallow: /sign-in',
    'Disallow: /sign-up',
    'Disallow: /dashboard',
    'Disallow: /dashboard/',
    '',
    '# 站内搜索结果页：避免抓取参数化页造成无限组合',
    'Disallow: /search/',
    ''
  ]

  if (origin) lines.push(`Sitemap: ${origin}/sitemap.xml`)

  const body = `${lines.join('\n')}\n`
  res.setHeader('Content-Type', 'text/plain; charset=utf-8')
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400')
  res.status(200).send(body)
}
