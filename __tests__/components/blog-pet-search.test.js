/**
 * Blog Pet 检索、设置与坐标工具的单元测试
 */
import {
  buildIndex,
  latestPosts,
  mapByHref,
  randomPosts,
  searchPosts
} from '@/components/BlogPet/blogPetSearch'
import {
  DEFAULT_SETTINGS,
  sanitizeSettings
} from '@/components/BlogPet/blogPetSettings'
import {
  clampPosition,
  defaultPosition,
  truncate
} from '@/components/BlogPet/blogPetUtils'

const POSTS = [
  {
    id: 'p1',
    title: 'Cloudflare 建站实践',
    href: '/article/Cloudflare02',
    summary: '用 NotionNext 和 Vercel 搭建个人博客',
    category: '技术分享',
    tags: ['建站', 'Cloudflare'],
    date: '2026-8-7'
  },
  {
    id: 'p2',
    title: '从购买机场节点到搭建代理环境',
    href: '/article/proxy01',
    summary: '软路由与代理链路的基础配置',
    category: '技术分享',
    tags: ['软路由'],
    date: '2026-9-2'
  },
  {
    id: 'p3',
    title: '本地部署 DeepSeek Harness',
    href: '/article/dsh01',
    summary: '体验属于自己的 AI Agent',
    category: '技术分享',
    tags: ['AI', '开发'],
    date: '2026-9-17'
  }
]

describe('Blog Pet 检索', () => {
  const index = buildIndex(POSTS)

  test('标题命中权重高于摘要', () => {
    const found = searchPosts(index, 'Cloudflare', 6)
    expect(found[0].id).toBe('p1')
  })

  test('标签与分类也能命中', () => {
    expect(searchPosts(index, '软路由', 6)[0].id).toBe('p2')
    expect(searchPosts(index, '技术分享', 6).length).toBe(3)
  })

  test('多关键词组合时优先返回同时命中的文章', () => {
    const found = searchPosts(index, 'AI Agent', 6)
    expect(found[0].id).toBe('p3')
  })

  test('无匹配时返回空数组，不编造文章', () => {
    expect(searchPosts(index, '区块链', 6)).toEqual([])
    expect(searchPosts(index, '   ', 6)).toEqual([])
  })

  test('结果数量受 limit 限制', () => {
    expect(searchPosts(index, '技术分享', 2).length).toBe(2)
  })

  test('最新文章按日期倒序', () => {
    const found = latestPosts(index, 2)
    expect(found.map(post => post.id)).toEqual(['p3', 'p2'])
  })

  test('随机推荐会避开已展示文章', () => {
    const found = randomPosts(index, 2, ['p1', 'p2'])
    expect(found.map(post => post.id)).toEqual(['p3'])
  })

  test('按 href 映射榜单数据', () => {
    const found = mapByHref(index, ['/article/dsh01', '/nope'])
    expect(found).toHaveLength(1)
    expect(found[0].id).toBe('p3')
  })

  test('索引会过滤掉缺少标题或链接的脏数据', () => {
    const dirty = buildIndex([...POSTS, { id: 'x', title: '', href: '' }, null])
    expect(dirty).toHaveLength(3)
  })
})

describe('Blog Pet 设置', () => {
  test('缺失数据回落到默认值', () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(sanitizeSettings('broken')).toEqual(DEFAULT_SETTINGS)
  })

  test('非法频率与坐标被修正', () => {
    const settings = sanitizeSettings({
      bubbleFrequency: 'insane',
      position: { x: 'abc', y: 12 },
      freeMove: 'yes'
    })
    expect(settings.bubbleFrequency).toBe('standard')
    expect(settings.position).toBeNull()
    expect(settings.freeMove).toBe(false)
  })

  test('合法字段被保留', () => {
    const settings = sanitizeSettings({
      visible: false,
      freeMove: true,
      bubbleFrequency: 'low',
      position: { x: 100, y: 200 }
    })
    expect(settings.visible).toBe(false)
    expect(settings.freeMove).toBe(true)
    expect(settings.bubbleFrequency).toBe('low')
    expect(settings.position).toEqual({ x: 100, y: 200 })
  })
})

describe('Blog Pet 坐标与文本工具', () => {
  const viewport = { width: 1000, height: 800 }
  const size = 112

  test('默认位置在右下角且留出边距', () => {
    const pos = defaultPosition(size, viewport, { right: 20, bottom: 20 }, 8)
    expect(pos.x).toBe(viewport.width - size - 20)
    expect(pos.y).toBe(viewport.height - size - 20)
  })

  test('越界坐标会被夹紧，桌宠保持完整可见', () => {
    const tooFar = clampPosition({ x: 5000, y: -200 }, size, viewport, 8)
    expect(tooFar.x).toBe(viewport.width - size - 8)
    expect(tooFar.y).toBe(8)
  })

  test('长摘要会被截断', () => {
    const text = truncate('a'.repeat(100), 10)
    expect(text).toBe('aaaaaaaaaa…')
  })
})
