/**
 * 新增排行榜与点赞功能 - 业务逻辑测试
 *
 * 覆盖浏览去重、点赞切换、计数查询与排行榜排序
 * lib/rank 会从 @/lib/config 读取配置；siteConfig 依赖 next/router 与 localStorage 等运行时，
 * 这里直接 mock 掉，聚焦排行榜自身的逻辑。
 */

const TMP_DIR = require('path').join(
  require('os').tmpdir(),
  `rank-logic-${process.pid}`
)
require('fs').mkdirSync(TMP_DIR, { recursive: true })
process.env.RANK_STORAGE_PATH = require('path').join(TMP_DIR, 'rank-data.json')
delete process.env.REDIS_URL

jest.mock('@/lib/config', () => ({
  siteConfig: jest.fn((key, fallback) => fallback)
}))

const flush = () => new Promise(resolve => setTimeout(resolve, 0))

describe('浏览计数与去重', () => {
  let rank
  let storage

  beforeAll(async () => {
    rank = await import('@/lib/rank')
    storage = await import('@/lib/rank/storage')
  })

  beforeEach(async () => {
    await storage.clearCounters('views')
    await storage.clearCounters('likes')
    // 去重标记保存在模块内存中，用例之间必须清空以保证隔离
    await storage.clearDedupe()
  })

  const fakeReq = ip => ({
    headers: { 'x-forwarded-for': ip, 'user-agent': 'jest-agent' },
    socket: {}
  })

  it('首次浏览计数，同一访客重复浏览不重复计数', async () => {
    const first = await rank.recordView('post-1', fakeReq('1.1.1.1'))
    expect(first.counted).toBe(true)
    expect(first.views).toBe(1)

    const second = await rank.recordView('post-1', fakeReq('1.1.1.1'))
    expect(second.counted).toBe(false)
    expect(second.views).toBe(1)
  })

  it('不同访客的浏览分别计数', async () => {
    await rank.recordView('post-1', fakeReq('1.1.1.1'))
    await rank.recordView('post-1', fakeReq('2.2.2.2'))
    await rank.recordView('post-1', fakeReq('3.3.3.3'))

    const counters = await storage.getCounters('views')
    expect(counters['post-1']).toBe(3)
  })

  it('同一访客浏览不同文章分别计数', async () => {
    await rank.recordView('post-1', fakeReq('1.1.1.1'))
    await rank.recordView('post-2', fakeReq('1.1.1.1'))

    const counters = await storage.getCounters('views')
    expect(counters['post-1']).toBe(1)
    expect(counters['post-2']).toBe(1)
  })

  it('缺少 postId 时不计数', async () => {
    const result = await rank.recordView('', fakeReq('1.1.1.1'))
    expect(result.counted).toBe(false)
  })

  it('并发浏览同一篇新文章时不会因竞态少计数', async () => {
    // 不同访客并发访问，全部应被计入
    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        rank.recordView('post-concurrent', fakeReq(`10.0.0.${i}`))
      )
    )
    const counters = await storage.getCounters('views')
    expect(counters['post-concurrent']).toBe(10)
  })
})

describe('点赞与取消点赞', () => {
  let rank
  let storage

  beforeAll(async () => {
    rank = await import('@/lib/rank')
    storage = await import('@/lib/rank/storage')
  })

  beforeEach(async () => {
    await storage.clearCounters('likes')
    await storage.clearDedupe()
  })

  it('首次点赞使计数 +1 并记录状态', async () => {
    const result = await rank.toggleLike('post-1', 'visitor-a')
    expect(result.liked).toBe(true)
    expect(result.likes).toBe(1)
    expect(result.changed).toBe(true)
  })

  it('同一访客重复点赞不重复计数（like 是幂等的）', async () => {
    await rank.toggleLike('post-1', 'visitor-a', 'like')

    // 连点两次「点赞」不应把计数加两次
    const second = await rank.toggleLike('post-1', 'visitor-a', 'like')

    expect(second.liked).toBe(true)
    expect(second.likes).toBe(1)
    expect(second.changed).toBe(false)
    expect(await storage.getCounter('likes', 'post-1')).toBe(1)
  })

  it('重复取消点赞不产生负数', async () => {
    await rank.toggleLike('post-1', 'visitor-a', 'like')
    await rank.toggleLike('post-1', 'visitor-a', 'unlike')

    const second = await rank.toggleLike('post-1', 'visitor-a', 'unlike')
    expect(second.liked).toBe(false)
    expect(second.changed).toBe(false)
    expect(await storage.getCounter('likes', 'post-1')).toBe(0)
  })

  it('取消点赞使计数 -1 并可再次点赞', async () => {
    await rank.toggleLike('post-1', 'visitor-a')
    const unlike = await rank.toggleLike('post-1', 'visitor-a', 'unlike')
    expect(unlike.liked).toBe(false)
    expect(unlike.likes).toBe(0)

    const likeAgain = await rank.toggleLike('post-1', 'visitor-a', 'like')
    expect(likeAgain.liked).toBe(true)
    expect(likeAgain.likes).toBe(1)
  })

  it('未点赞时取消点赞不产生负数', async () => {
    const result = await rank.toggleLike('post-1', 'visitor-a', 'unlike')
    expect(result.changed).toBe(false)
    expect(await storage.getCounter('likes', 'post-1')).toBe(0)
    expect(result.likes === null || result.likes === 0).toBe(true)
  })

  it('多个访客点赞累加', async () => {
    await rank.toggleLike('post-1', 'visitor-a')
    await rank.toggleLike('post-1', 'visitor-b')
    await rank.toggleLike('post-1', 'visitor-c')

    expect(await storage.getCounter('likes', 'post-1')).toBe(3)
  })

  it('toggle 不传 liked 时按当前状态取反', async () => {
    const first = await rank.toggleLike('post-1', 'visitor-a', 'toggle')
    expect(first.liked).toBe(true)

    const second = await rank.toggleLike('post-1', 'visitor-a', 'toggle')
    expect(second.liked).toBe(false)
    expect(second.likes).toBe(0)
  })

  it('isLikedBy 只读探测，不改变计数', async () => {
    expect(await rank.isLikedBy('post-1', 'visitor-a')).toBe(false)
    expect(await storage.getCounter('likes', 'post-1')).toBe(0)

    await rank.toggleLike('post-1', 'visitor-a')
    expect(await rank.isLikedBy('post-1', 'visitor-a')).toBe(true)
    expect(await storage.getCounter('likes', 'post-1')).toBe(1)
  })

  it('缺少 postId 或访客标识时不改变状态', async () => {
    const noPost = await rank.toggleLike('', 'visitor-a')
    expect(noPost.changed).toBe(false)

    const noVisitor = await rank.toggleLike('post-1', '')
    expect(noVisitor.changed).toBe(false)

    expect(await storage.getCounter('likes', 'post-1')).toBe(0)
  })

  it('并发点赞同一访客只计一次', async () => {
    await Promise.all(
      Array.from({ length: 5 }, () =>
        rank.toggleLike('post-1', 'visitor-race', 'like')
      )
    )
    expect(await storage.getCounter('likes', 'post-1')).toBe(1)
  })
})

describe('批量查询与互动数据', () => {
  let rank
  let storage

  beforeAll(async () => {
    rank = await import('@/lib/rank')
    storage = await import('@/lib/rank/storage')
  })

  beforeEach(async () => {
    await storage.clearCounters('views')
    await storage.clearCounters('likes')
    await storage.clearDedupe()
  })

  it('getCountersForPosts 只返回请求的文章', async () => {
    await storage.incrCounter('views', 'post-1', 5)
    await storage.incrCounter('views', 'post-2', 3)
    await storage.incrCounter('views', 'post-3', 9)

    const result = await rank.getCountersForPosts(['post-1', 'post-3'])
    expect(result.views).toEqual({ 'post-1': 5, 'post-3': 9 })
    expect(result.views['post-2']).toBeUndefined()
  })

  it('空数组返回空对象', async () => {
    expect(await rank.getCountersForPosts([])).toEqual({ views: {}, likes: {} })
    expect(await rank.getCountersForPosts(null)).toEqual({
      views: {},
      likes: {}
    })
  })

  it('getPostInteraction 返回阅读数、点赞数与点赞状态', async () => {
    await storage.incrCounter('views', 'post-1', 12)
    const info = await rank.getPostInteraction('post-1', 'visitor-a')
    expect(info.views).toBe(12)
    expect(info.likes).toBe(0)
    expect(info.liked).toBe(false)
  })

  it('getPostInteraction 缺少 postId 时安全返回', async () => {
    const info = await rank.getPostInteraction('', 'visitor-a')
    expect(info).toEqual({ views: null, likes: null, liked: false })
  })
})

describe('点踩数据不相互污染', () => {
  let rank
  let storage

  beforeAll(async () => {
    rank = await import('@/lib/rank')
    storage = await import('@/lib/rank/storage')
  })

  it('点赞不会增加阅读量，浏览不会增加点赞数', async () => {
    await storage.clearCounters('views')
    await storage.clearCounters('likes')
    await storage.clearDedupe()

    await rank.toggleLike('post-1', 'visitor-a')
    expect(await storage.getCounter('views', 'post-1')).toBe(0)

    await rank.recordView('post-1', {
      headers: { 'x-forwarded-for': '9.9.9.9', 'user-agent': 'jest' },
      socket: {}
    })
    expect(await storage.getCounter('likes', 'post-1')).toBe(1)
  })
})
