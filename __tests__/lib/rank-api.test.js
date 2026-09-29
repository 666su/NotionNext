/**
 * 新增排行榜与点赞功能 - API 接口端到端测试
 *
 * 直接调用 pages/api/rank/* 的 handler，验证完整的请求-响应链路：
 * 记录浏览 → 读取互动数据 → 点赞 → 榜单输出
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const TMP_DIR = path.join(os.tmpdir(), `rank-api-${process.pid}`)
fs.mkdirSync(TMP_DIR, { recursive: true })
process.env.RANK_STORAGE_PATH = path.join(TMP_DIR, 'rank-data.json')
delete process.env.REDIS_URL

let mockPages = []
const mockConfig = { RANK_SEED_SECRET: 'test-secret' }

jest.mock('@/lib/config', () => ({
  siteConfig: jest.fn((key, fallback) => {
    if (key in mockConfig) return mockConfig[key]
    return fallback
  })
}))

jest.mock('@/lib/db/SiteDataApi', () => ({
  fetchGlobalAllData: jest.fn(() => Promise.resolve({ allPages: mockPages }))
}))

/** 构造 express 风格的 res 替身，用于捕获 handler 输出 */
function mockRes() {
  const res = {}
  res.statusCode = 200
  res.headers = {}
  res.setHeader = (key, value) => {
    res.headers[key] = value
    return res
  }
  res.status = code => {
    res.statusCode = code
    return res
  }
  res.json = payload => {
    res.body = payload
    return res
  }
  return res
}

/** 构造请求替身 */
function mockReq({
  method = 'POST',
  body = {},
  query = {},
  ip = '1.1.1.1'
} = {}) {
  return {
    method,
    body,
    query,
    headers: { 'x-forwarded-for': ip, 'user-agent': 'jest-api-agent' },
    socket: {}
  }
}

const makePost = (id, title, publishDate = '2024-01-01') => ({
  id,
  title,
  slug: `article/${id}`,
  href: `/article/${id}`,
  publishDate,
  publishDay: publishDate,
  type: 'Post'
})

describe('POST /api/rank/view', () => {
  let handler
  let storage

  beforeAll(async () => {
    handler = (await import('@/pages/api/rank/view')).default
    storage = await import('@/lib/rank/storage')
  })

  beforeEach(async () => {
    await storage.clearCounters('views')
    await storage.clearDedupe()
  })

  it('缺少 postId 返回 400', async () => {
    const res = mockRes()
    await handler(mockReq({ body: {} }), res)
    expect(res.statusCode).toBe(400)
    expect(res.body.error).toBeTruthy()
  })

  it('首次浏览返回 counted=true 与当前次数', async () => {
    const res = mockRes()
    await handler(mockReq({ body: { postId: 'post-1' } }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({ ok: true, counted: true, views: 1 })
  })

  it('同一访客重复浏览返回 counted=false 且次数不变', async () => {
    await handler(mockReq({ body: { postId: 'post-1' } }), mockRes())
    const res = mockRes()
    await handler(mockReq({ body: { postId: 'post-1' } }), res)

    expect(res.body.counted).toBe(false)
    expect(res.body.views).toBe(1)
  })

  it('不同访客累计计数', async () => {
    await handler(
      mockReq({ body: { postId: 'post-1' }, ip: '1.1.1.1' }),
      mockRes()
    )
    await handler(
      mockReq({ body: { postId: 'post-1' }, ip: '2.2.2.2' }),
      mockRes()
    )
    const res = mockRes()
    await handler(mockReq({ body: { postId: 'post-1' }, ip: '3.3.3.3' }), res)

    expect(res.body.views).toBe(3)
  })

  it('非 POST 方法返回 405', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'GET' }), res)
    expect(res.statusCode).toBe(405)
  })

  it('响应禁止缓存，保证计数实时', async () => {
    const res = mockRes()
    await handler(mockReq({ body: { postId: 'post-1' } }), res)
    expect(res.headers['Cache-Control']).toBe('no-store')
  })
})

describe('GET /api/rank/info', () => {
  let handler
  let storage

  beforeAll(async () => {
    handler = (await import('@/pages/api/rank/info')).default
    storage = await import('@/lib/rank/storage')
  })

  beforeEach(async () => {
    await storage.clearCounters('views')
    await storage.clearCounters('likes')
    await storage.clearDedupe()
  })

  it('缺少 postId 返回 400', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'GET', query: {} }), res)
    expect(res.statusCode).toBe(400)
  })

  it('record=1 时同时完成计数与数据返回（文章页只发一次请求）', async () => {
    const res = mockRes()
    await handler(
      mockReq({ method: 'GET', query: { postId: 'post-1', record: '1' } }),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      ok: true,
      views: 1,
      likes: 0,
      liked: false
    })
  })

  it('不带 record 参数时只读取，不计数', async () => {
    await handler(
      mockReq({ method: 'GET', query: { postId: 'post-1' } }),
      mockRes()
    )
    const counters = await storage.getCounters('views')
    expect(counters['post-1']).toBeUndefined()
  })

  it('返回当前访客的点赞状态', async () => {
    const likeHandler = (await import('@/pages/api/rank/like')).default
    await likeHandler(
      mockReq({ body: { postId: 'post-1', action: 'like' } }),
      mockRes()
    )

    const res = mockRes()
    await handler(mockReq({ method: 'GET', query: { postId: 'post-1' } }), res)
    expect(res.body.liked).toBe(true)
    expect(res.body.likes).toBe(1)
  })
})

describe('POST /api/rank/like', () => {
  let handler
  let storage

  beforeAll(async () => {
    handler = (await import('@/pages/api/rank/like')).default
    storage = await import('@/lib/rank/storage')
  })

  beforeEach(async () => {
    await storage.clearCounters('likes')
    await storage.clearDedupe()
  })

  it('默认动作是 toggle：首次点赞成功', async () => {
    const res = mockRes()
    await handler(mockReq({ body: { postId: 'post-1' } }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body).toMatchObject({
      ok: true,
      liked: true,
      likes: 1,
      changed: true
    })
  })

  it('action=like 幂等，重复请求不增加计数', async () => {
    await handler(
      mockReq({ body: { postId: 'post-1', action: 'like' } }),
      mockRes()
    )
    const res = mockRes()
    await handler(mockReq({ body: { postId: 'post-1', action: 'like' } }), res)

    expect(res.body.likes).toBe(1)
    expect(res.body.changed).toBe(false)
  })

  it('action=unlike 取消点赞', async () => {
    await handler(
      mockReq({ body: { postId: 'post-1', action: 'like' } }),
      mockRes()
    )
    const res = mockRes()
    await handler(
      mockReq({ body: { postId: 'post-1', action: 'unlike' } }),
      res
    )

    expect(res.body.liked).toBe(false)
    expect(res.body.likes).toBe(0)
  })

  it('非法 action 回退为 toggle', async () => {
    const res = mockRes()
    await handler(mockReq({ body: { postId: 'post-1', action: 'hack' } }), res)
    expect(res.body.liked).toBe(true)
  })

  it('缺少 postId 返回 400', async () => {
    const res = mockRes()
    await handler(mockReq({ body: {} }), res)
    expect(res.statusCode).toBe(400)
  })

  it('GET 用于查询点赞状态', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'GET', query: { postId: 'post-1' } }), res)
    expect(res.body).toMatchObject({ ok: true, liked: false })
  })

  it('不同访客的点赞分别计数', async () => {
    await handler(
      mockReq({ body: { postId: 'post-1' }, ip: '1.1.1.1' }),
      mockRes()
    )
    const res = mockRes()
    await handler(mockReq({ body: { postId: 'post-1' }, ip: '2.2.2.2' }), res)

    expect(res.body.likes).toBe(2)
  })
})

describe('GET /api/rank/top', () => {
  let handler
  let storage

  beforeAll(async () => {
    handler = (await import('@/pages/api/rank/top')).default
    storage = await import('@/lib/rank/storage')
  })

  beforeEach(async () => {
    await storage.clearCounters('views')
    await storage.clearCounters('likes')
    await storage.clearDedupe()
  })

  it('返回按次数从高到低排序的双榜单', async () => {
    mockPages = [
      makePost('p1', '文章一'),
      makePost('p2', '文章二'),
      makePost('p3', '文章三')
    ]
    await storage.mergeCounters('views', { p1: 10, p2: 50, p3: 30 }, 'set')
    await storage.mergeCounters('likes', { p1: 8, p2: 2, p3: 5 }, 'set')

    const res = mockRes()
    await handler(mockReq({ method: 'GET', query: {} }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.views.map(i => i.id)).toEqual(['p2', 'p3', 'p1'])
    expect(res.body.likes.map(i => i.id)).toEqual(['p1', 'p3', 'p2'])
  })

  it('支持 limit 查询参数', async () => {
    mockPages = Array.from({ length: 6 }, (_, i) => makePost(`n${i}`, `N${i}`))
    const views = {}
    mockPages.forEach((post, i) => {
      views[post.id] = (i + 1) * 5
    })
    await storage.mergeCounters('views', views, 'set')

    const res = mockRes()
    await handler(mockReq({ method: 'GET', query: { limit: '2' } }), res)

    expect(res.body.views).toHaveLength(2)
    expect(res.body.views.map(i => i.views)).toEqual([30, 25])
  })

  it('允许 CDN 缓存以降低榜单计算开销', async () => {
    mockPages = []
    const res = mockRes()
    await handler(mockReq({ method: 'GET', query: {} }), res)
    expect(res.headers['Cache-Control']).toContain('s-maxage')
  })

  it('非 GET 方法返回 405', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'POST', query: {} }), res)
    expect(res.statusCode).toBe(405)
  })
})

describe('POST /api/rank/seed（历史数据导入）', () => {
  let handler
  let storage

  beforeAll(async () => {
    handler = (await import('@/pages/api/rank/seed')).default
    storage = await import('@/lib/rank/storage')
  })

  beforeEach(async () => {
    await storage.clearCounters('views')
    await storage.clearCounters('likes')
    await storage.clearDedupe()
  })

  it('令牌错误返回 403', async () => {
    const res = mockRes()
    await handler(
      mockReq({ body: { secret: 'wrong', views: { p1: 100 } } }),
      res
    )
    expect(res.statusCode).toBe(403)
  })

  it('缺少令牌返回 403', async () => {
    const res = mockRes()
    await handler(mockReq({ body: { views: { p1: 100 } } }), res)
    expect(res.statusCode).toBe(403)
  })

  it('令牌正确时可导入历史阅读量', async () => {
    const res = mockRes()
    await handler(
      mockReq({ body: { secret: 'test-secret', views: { p1: 1234, p2: 56 } } }),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(res.body.result.views).toBe(2)
    expect(await storage.getCounter('views', 'p1')).toBe(1234)
    expect(await storage.getCounter('views', 'p2')).toBe(56)
  })

  it('mode=max 重复导入不会把数值翻倍', async () => {
    await handler(
      mockReq({
        body: { secret: 'test-secret', mode: 'max', views: { p1: 500 } }
      }),
      mockRes()
    )
    await handler(
      mockReq({
        body: { secret: 'test-secret', mode: 'max', views: { p1: 500 } }
      }),
      mockRes()
    )

    expect(await storage.getCounter('views', 'p1')).toBe(500)
  })

  it('支持通过请求头传令牌', async () => {
    const req = mockReq({ body: { views: { p1: 7 } } })
    req.headers['x-rank-secret'] = 'test-secret'
    const res = mockRes()
    await handler(req, res)

    expect(res.statusCode).toBe(200)
    expect(await storage.getCounter('views', 'p1')).toBe(7)
  })

  it('action=reset 可重置指定计数', async () => {
    await storage.mergeCounters('views', { p1: 99 }, 'set')
    await storage.mergeCounters('likes', { p1: 9 }, 'set')

    const res = mockRes()
    await handler(
      mockReq({
        body: { secret: 'test-secret', action: 'reset', reset: 'likes' }
      }),
      res
    )

    expect(res.statusCode).toBe(200)
    expect(await storage.getCounter('likes', 'p1')).toBe(0)
    // 只重置点赞，阅读量保留
    expect(await storage.getCounter('views', 'p1')).toBe(99)
  })

  it('重置点赞后访客可以重新点赞（清除已点赞标记）', async () => {
    const likeHandler = (await import('@/pages/api/rank/like')).default
    await likeHandler(
      mockReq({ body: { postId: 'post-1', action: 'like' } }),
      mockRes()
    )
    expect(await storage.getCounter('likes', 'post-1')).toBe(1)

    await handler(
      mockReq({
        body: { secret: 'test-secret', action: 'reset', reset: 'likes' }
      }),
      mockRes()
    )

    const res = mockRes()
    await likeHandler(
      mockReq({ body: { postId: 'post-1', action: 'like' } }),
      res
    )
    expect(res.body.liked).toBe(true)
    expect(res.body.likes).toBe(1)
  })

  it('非 POST 方法返回 405', async () => {
    const res = mockRes()
    await handler(mockReq({ method: 'GET' }), res)
    expect(res.statusCode).toBe(405)
  })
})

describe('GET /api/rank/status', () => {
  it('返回存储后端与计数概况', async () => {
    const handler = (await import('@/pages/api/rank/status')).default
    const storage = await import('@/lib/rank/storage')
    await storage.mergeCounters('views', { s1: 3 }, 'set')

    const res = mockRes()
    await handler(mockReq({ method: 'GET' }), res)

    expect(res.statusCode).toBe(200)
    expect(res.body.storage).toBe('file')
    expect(res.body.counts.viewedPosts).toBeGreaterThanOrEqual(1)
  })
})
