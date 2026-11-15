/**
 * robots.txt 规则（唯一来源）
 *
 * 为什么抽出来：项目在构建阶段会用 lib/utils/robots.txt.js **写一份 public/robots.txt**
 * （Vercel 上会生效，静态文件优先于 rewrites），而 /api/robots 是动态兜底。
 * 两处必须同源，否则会出现"线上 robots 是上游模板、后台 SEO 页却显示我们的规则"。
 */

export function buildRobotsTxt({ origin = '' } = {}) {
  const base = String(origin || '').replace(/\/+$/, '')

  const lines = [
    '# 由 lib/seo/robots.js 生成（/api/robots 与构建期 public/robots.txt 共用同一份规则）',
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
    '# 私密会话页：任何情况下都不该被索引',
    'Disallow: /message',
    'Disallow: /message/',
    '',
    '# 站内搜索结果页：避免抓取参数化页造成无限组合',
    'Disallow: /search/',
    ''
  ]

  if (base) {
    lines.push(`Host: ${base}`)
    lines.push(`Sitemap: ${base}/sitemap.xml`)
  }

  return `${lines.join('\n')}\n`
}
