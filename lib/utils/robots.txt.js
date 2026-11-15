import fs from 'fs'
import { buildRobotsTxt } from '@/lib/seo/robots'

/**
 * 构建期生成 public/robots.txt
 *
 * 注意：Vercel 上静态文件优先于 rewrites，所以这份**必须写对**（以前是写上游模板域名）。
 * 规则唯一来源：lib/seo/robots.js（/api/robots 用的是同一个函数）。
 * 域名优先取 NEXT_PUBLIC_LINK，其次 siteInfo.link；都没有时只输出通用规则，
 * 不写 Host/Sitemap，避免把错误域名写进 robots。
 */
export function generateRobotsTxt(props) {
  const { siteInfo } = props || {}
  const origin = String(process.env.NEXT_PUBLIC_LINK || siteInfo?.link || '').trim()
  const content = buildRobotsTxt({ origin })

  try {
    fs.mkdirSync('./public', { recursive: true })
    fs.writeFileSync('./public/robots.txt', content)
  } catch (error) {
    // Vercel 运行环境只读；构建阶段可写。写不了就交给 /api/robots 兜底。
  }
}
