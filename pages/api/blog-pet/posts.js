/**
 * Blog Pet 文章索引接口
 * GET /api/blog-pet/posts
 *
 * 返回站点真实文章的精简字段，供桌宠做本地关键词检索
 * 复用全站数据缓存，不额外请求 Notion
 */
import { fetchGlobalAllData } from '@/lib/db/SiteDataApi'

const SUMMARY_MAX = 160

function normalizeTags(tags) {
  if (!Array.isArray(tags)) return []
  return tags
    .map(tag => (typeof tag === 'string' ? tag : tag?.name))
    .filter(Boolean)
    .slice(0, 4)
}

function toPetPost(post) {
  return {
    id: post.id,
    title: post.title || post.name || '未命名',
    href: post.href,
    slug: post.slug,
    summary: String(post.summary || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, SUMMARY_MAX),
    category: post.category || '',
    tags: normalizeTags(post.tags),
    date: post.publishDay || post.date?.start_date || '',
    cover: post.pageCoverThumbnail || post.pageCover || null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method Not Allowed' })
  }

  try {
    const siteData = await fetchGlobalAllData({ from: 'blog-pet' })
    const posts = (siteData?.allPages || [])
      .filter(post => {
        if (!post || !post.id || !post.href) return false
        if (post.type === 'Page' || post.type === 'Notice') return false
        return !String(post.type || '').includes('Menu')
      })
      .map(toPetPost)

    // 文章列表变化低频，允许 CDN 缓存 5 分钟
    res.setHeader(
      'Cache-Control',
      'public, s-maxage=300, stale-while-revalidate=600'
    )
    return res.status(200).json({
      ok: true,
      total: posts.length,
      updatedAt: Date.now(),
      posts
    })
  } catch (e) {
    console.warn('[blog-pet] 生成文章索引失败:', e.message)
    return res.status(500).json({ ok: false, error: '文章索引暂时不可用' })
  }
}
