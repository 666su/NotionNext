/**
 * 新增排行榜功能 - 榜单排序测试
 *
 * 需求关键点：两个榜单都按次数「从高到低」排序
 * 这里 mock 掉 Notion 数据源，只验证榜单生成与排序逻辑
 */

const path = require('path')
const os = require('os')
const fs = require('fs')

const TMP_DIR = path.join(os.tmpdir(), `rank-board-${process.pid}`)
fs.mkdirSync(TMP_DIR, { recursive: true })
process.env.RANK_STORAGE_PATH = path.join(TMP_DIR, 'rank-data.json')
delete process.env.REDIS_URL

// 可调的假文章数据
let mockPages = []
const mockConfig = { RANK_LIST_SIZE: 10 }

jest.mock('@/lib/config', () => ({
  siteConfig: jest.fn((key, fallback) => {
    if (key in mockConfig) return mockConfig[key]
    return fallback
  })
}))

jest.mock('@/lib/db/SiteDataApi', () => ({
  fetchGlobalAllData: jest.fn(async () => ({ allPages: mockPages }))
}))

const makePost = (id, title, publishDate = '') => ({
  id,
  title,
  slug: `article/${id}`,
  href: `/article/${id}`,
  publishDate,
  publishDay: publishDate,
  type: 'Post'
})

describe('排行榜排序', () => {
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
    mockConfig.RANK_LIST_SIZE = 10
  })

  it('阅读榜按查看次数从高到低排序', async () => {
    mockPages = [
      makePost('p-low', '低阅读', '2024-01-01'),
      makePost('p-high', '高阅读', '2024-01-02'),
      makePost('p-mid', '中阅读', '2024-01-03')
    ]

    await storage.mergeCounters(
      'views',
      { 'p-low': 5, 'p-high': 100, 'p-mid': 42 },
      'set'
    )

    const board = await rank.buildRankBoard()
    expect(board.views.map(item => item.id)).toEqual([
      'p-high',
      'p-mid',
      'p-low'
    ])
    expect(board.views.map(item => item.views)).toEqual([100, 42, 5])
  })

  it('点赞榜按点赞次数从高到低排序', async () => {
    mockPages = [
      makePost('a', 'A', '2024-01-01'),
      makePost('b', 'B', '2024-01-02'),
      makePost('c', 'C', '2024-01-03')
    ]

    await storage.mergeCounters('likes', { a: 2, b: 30, c: 11 }, 'set')

    const board = await rank.buildRankBoard()
    expect(board.likes.map(item => item.id)).toEqual(['b', 'c', 'a'])
    expect(board.likes.map(item => item.likes)).toEqual([30, 11, 2])
  })

  it('两个榜单互不影响（阅读榜不按点赞排序）', async () => {
    mockPages = [
      makePost('x', 'X', '2024-01-01'),
      makePost('y', 'Y', '2024-01-02')
    ]

    // x 阅读多、点赞少；y 反之
    await storage.mergeCounters('views', { x: 100, y: 1 }, 'set')
    await storage.mergeCounters('likes', { x: 1, y: 100 }, 'set')

    const board = await rank.buildRankBoard()
    expect(board.views.map(i => i.id)).toEqual(['x', 'y'])
    expect(board.likes.map(i => i.id)).toEqual(['y', 'x'])
  })

  it('次数相同时按发布时间较新优先，且排序稳定', async () => {
    mockPages = [
      makePost('old', '旧文章', '2024-01-01'),
      makePost('new', '新文章', '2025-06-01'),
      makePost('mid', '中间', '2024-08-01')
    ]

    await storage.mergeCounters('views', { old: 10, new: 10, mid: 10 }, 'set')

    const board = await rank.buildRankBoard()
    expect(board.views.map(i => i.id)).toEqual(['new', 'mid', 'old'])
  })

  it('默认不返回零计数的文章', async () => {
    mockPages = [
      makePost('has', '有数据', '2024-01-01'),
      makePost('none', '无数据', '2024-01-02')
    ]

    await storage.mergeCounters('views', { has: 3 }, 'set')

    const board = await rank.buildRankBoard()
    expect(board.views.map(i => i.id)).toEqual(['has'])
    expect(board.views.find(i => i.id === 'none')).toBeUndefined()
  })

  it('limit 参数限制每个榜单的条数', async () => {
    mockPages = Array.from({ length: 8 }, (_, i) =>
      makePost(`p${i}`, `文章${i}`, '2024-01-01')
    )
    const views = {}
    mockPages.forEach((post, i) => {
      views[post.id] = i + 1
    })
    await storage.mergeCounters('views', views, 'set')

    const board = await rank.buildRankBoard({ limit: 3 })
    expect(board.views).toHaveLength(3)
    // 取的是最大的三个，从高到低
    expect(board.views.map(i => i.views)).toEqual([8, 7, 6])
  })

  it('RANK_LIST_SIZE 配置生效', async () => {
    mockConfig.RANK_LIST_SIZE = 2
    mockPages = Array.from({ length: 5 }, (_, i) =>
      makePost(`q${i}`, `Q${i}`, '2024-01-01')
    )
    const likes = {}
    mockPages.forEach((post, i) => {
      likes[post.id] = (i + 1) * 10
    })
    await storage.mergeCounters('likes', likes, 'set')

    const board = await rank.buildRankBoard()
    expect(board.likes).toHaveLength(2)
    expect(board.likes.map(i => i.likes)).toEqual([50, 40])
  })

  it('榜单条目包含跳转所需的 href 与标题', async () => {
    mockPages = [makePost('one', '唯一文章', '2024-01-01')]
    await storage.mergeCounters('views', { one: 7 }, 'set')

    const board = await rank.buildRankBoard()
    expect(board.views[0]).toMatchObject({
      id: 'one',
      title: '唯一文章',
      href: '/article/one',
      views: 7
    })
  })

  it('过滤 Menu 与 Page 类型，避免导航页进入榜单', async () => {
    mockPages = [
      makePost('post-1', '正常文章', '2024-01-01'),
      { ...makePost('menu-1', '菜单', '2024-01-02'), type: 'Menu' },
      { ...makePost('page-1', '独立页面', '2024-01-03'), type: 'Page' }
    ]

    await storage.mergeCounters(
      'views',
      { 'post-1': 1, 'menu-1': 999, 'page-1': 888 },
      'set'
    )

    const board = await rank.buildRankBoard()
    expect(board.views.map(i => i.id)).toEqual(['post-1'])
  })

  it('全站无计数数据时返回空榜单而不是报错', async () => {
    mockPages = [makePost('p', 'P', '2024-01-01')]
    const board = await rank.buildRankBoard()
    expect(board.views).toEqual([])
    expect(board.likes).toEqual([])
    expect(board.enabled).toBeTruthy()
  })

  it('没有文章数据时也安全返回', async () => {
    mockPages = []
    const board = await rank.buildRankBoard()
    expect(board.views).toEqual([])
    expect(board.likes).toEqual([])
  })
})

describe('配置开关', () => {
  let rank

  beforeAll(async () => {
    rank = await import('@/lib/rank')
  })

  it('默认全部开启', () => {
    expect(rank.isRankEnabled()).toBe(true)
    expect(rank.isViewEnabled()).toBe(true)
    expect(rank.isLikeEnabled()).toBe(true)
  })

  it('总开关关闭时，子开关一并关闭', () => {
    mockConfig.RANK_ENABLE = false
    expect(rank.isRankEnabled()).toBe(false)
    expect(rank.isViewEnabled()).toBe(false)
    expect(rank.isLikeEnabled()).toBe(false)
    delete mockConfig.RANK_ENABLE
  })

  it('仅关闭点赞时，阅读统计仍然可用', () => {
    mockConfig.RANK_LIKE_ENABLE = false
    expect(rank.isLikeEnabled()).toBe(false)
    expect(rank.isViewEnabled()).toBe(true)
    delete mockConfig.RANK_LIKE_ENABLE
  })

  it('listSize 有合理边界（1-50）', () => {
    mockConfig.RANK_LIST_SIZE = 999
    expect(rank.getListSize()).toBe(50)

    mockConfig.RANK_LIST_SIZE = 0
    expect(rank.getListSize()).toBe(1)

    mockConfig.RANK_LIST_SIZE = 10
    expect(rank.getListSize()).toBe(10)
  })
})
