/**
 * 新增排行榜与点赞功能 - 存储层测试
 *
 * 覆盖文件回退路径（未配置 Redis 时）：
 * 自增、读取、批量导入、清空、去重标记
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

// 必须在导入被测模块前设置，storage.js 在模块作用域读取这些环境变量
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rank-storage-'))
process.env.RANK_STORAGE_PATH = path.join(TMP_DIR, 'rank-data.json')
delete process.env.REDIS_URL

let storage

beforeAll(async () => {
  storage = await import('@/lib/rank/storage')
})

afterAll(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    // 清理失败不影响测试结论
  }
})

beforeEach(async () => {
  await storage.clearCounters('views')
  await storage.clearCounters('likes')
  // 去重标记保存在模块内存中，用例之间必须清空以保证隔离
  await storage.clearDedupe()
})

describe('计数器自增与读取', () => {
  it('未初始化时读取返回 0', async () => {
    expect(await storage.getCounter('views', 'post-a')).toBe(0)
  })

  it('自增后能读回正确的值', async () => {
    await storage.incrCounter('views', 'post-a', 1)
    await storage.incrCounter('views', 'post-a', 1)
    expect(await storage.getCounter('views', 'post-a')).toBe(2)
  })

  it('不同文章互不影响，且 views 与 likes 相互隔离', async () => {
    await storage.incrCounter('views', 'post-a', 3)
    await storage.incrCounter('views', 'post-b', 5)
    await storage.incrCounter('likes', 'post-a', 7)

    const views = await storage.getCounters('views')
    expect(views['post-a']).toBe(3)
    expect(views['post-b']).toBe(5)

    const likes = await storage.getCounters('likes')
    expect(likes['post-a']).toBe(7)
    expect(likes['post-a']).not.toBe(3)
  })

  it('支持负数自增（取消点赞）', async () => {
    await storage.incrCounter('likes', 'post-a', 2)
    expect(await storage.incrCounter('likes', 'post-a', -1)).toBe(1)
  })

  it('缺少参数时返回 null 而不是抛错', async () => {
    expect(await storage.incrCounter('views', '', 1)).toBe(null)
    expect(await storage.incrCounter('unknown', 'post-a', 1)).toBe(null)
  })
})

describe('批量导入 mergeCounters', () => {
  it('mode=set 直接覆盖', async () => {
    await storage.incrCounter('views', 'post-a', 100)
    await storage.mergeCounters('views', { 'post-a': 5 }, 'set')
    expect(await storage.getCounter('views', 'post-a')).toBe(5)
  })

  it('mode=incr 累加', async () => {
    await storage.incrCounter('views', 'post-a', 5)
    await storage.mergeCounters('views', { 'post-a': 10 }, 'incr')
    expect(await storage.getCounter('views', 'post-a')).toBe(15)
  })

  it('mode=max 只增不减，可安全重复导入', async () => {
    await storage.mergeCounters('views', { 'post-a': 50 }, 'max')
    expect(await storage.getCounter('views', 'post-a')).toBe(50)

    // 重复导入相同数据不应翻倍
    await storage.mergeCounters('views', { 'post-a': 50 }, 'max')
    expect(await storage.getCounter('views', 'post-a')).toBe(50)

    // 更小的数据不应覆盖更大的值
    await storage.mergeCounters('views', { 'post-a': 20 }, 'max')
    expect(await storage.getCounter('views', 'post-a')).toBe(50)

    // 更大的数据应更新
    await storage.mergeCounters('views', { 'post-a': 80 }, 'max')
    expect(await storage.getCounter('views', 'post-a')).toBe(80)
  })

  it('过滤非法值（负数、NaN、空键）', async () => {
    const count = await storage.mergeCounters(
      'views',
      { 'post-a': -5, 'post-b': 'abc', '': 10, 'post-c': 3 },
      'set'
    )
    expect(count).toBe(1)
    expect(await storage.getCounter('views', 'post-c')).toBe(3)
    expect(await storage.getCounter('views', 'post-a')).toBe(0)
  })

  it('空对象返回 0 且不报错', async () => {
    expect(await storage.mergeCounters('views', {}, 'set')).toBe(0)
    expect(await storage.mergeCounters('views', null, 'set')).toBe(0)
  })
})

describe('清空计数', () => {
  it('clearCounters 只清空指定类型', async () => {
    await storage.incrCounter('views', 'post-a', 1)
    await storage.incrCounter('likes', 'post-a', 1)

    await storage.clearCounters('views')

    expect(await storage.getCounter('views', 'post-a')).toBe(0)
    expect(await storage.getCounter('likes', 'post-a')).toBe(1)
  })
})

describe('去重标记', () => {
  it('首次占用成功，重复占用失败', async () => {
    expect(await storage.acquireDedupe('views', 'visitor-1', 60)).toBe(true)
    expect(await storage.acquireDedupe('views', 'visitor-1', 60)).toBe(false)
  })

  it('不同访客互不影响', async () => {
    expect(await storage.acquireDedupe('views', 'visitor-1', 60)).toBe(true)
    expect(await storage.acquireDedupe('views', 'visitor-2', 60)).toBe(true)
  })

  it('hasDedupe 是只读的，不会写入标记', async () => {
    expect(await storage.hasDedupe('views', 'visitor-9')).toBe(false)
    // 探测后仍应不存在
    expect(await storage.hasDedupe('views', 'visitor-9')).toBe(false)
  })

  it('releaseDedupe 后可重新占用', async () => {
    await storage.acquireDedupe('views', 'visitor-3', 60)
    expect(await storage.hasDedupe('views', 'visitor-3')).toBe(true)

    await storage.releaseDedupe('views', 'visitor-3')
    expect(await storage.hasDedupe('views', 'visitor-3')).toBe(false)
    expect(await storage.acquireDedupe('views', 'visitor-3', 60)).toBe(true)
  })

  it('ttl 为 0 或缺少身份时不做去重（始终放行）', async () => {
    expect(await storage.acquireDedupe('views', 'visitor-4', 0)).toBe(true)
    expect(await storage.acquireDedupe('views', 'visitor-4', 0)).toBe(true)
    expect(await storage.acquireDedupe('views', '', 60)).toBe(true)
  })

  it('clearDedupe 按范围清空标记', async () => {
    await storage.acquireDedupe('views', 'v1', 60)
    await storage.acquireDedupe('liked-by', 'l1', 60)

    const removed = await storage.clearDedupe('views')
    expect(removed).toBeGreaterThanOrEqual(1)

    // views 范围已清空，可以重新占用
    expect(await storage.acquireDedupe('views', 'v1', 60)).toBe(true)
    // 其它范围不受影响
    expect(await storage.hasDedupe('liked-by', 'l1')).toBe(true)
  })

  it('clearDedupe 不传范围时清空全部', async () => {
    await storage.acquireDedupe('views', 'v1', 60)
    await storage.acquireDedupe('liked-by', 'l1', 60)

    await storage.clearDedupe()

    expect(await storage.hasDedupe('views', 'v1')).toBe(false)
    expect(await storage.hasDedupe('liked-by', 'l1')).toBe(false)
  })

  it('过期的标记会被视为不存在', async () => {
    await storage.acquireDedupe('views', 'visitor-5', 0.001)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(await storage.hasDedupe('views', 'visitor-5')).toBe(false)
  })
})

describe('hashIdentity', () => {
  it('相同输入生成相同标识', () => {
    expect(storage.hashIdentity('1.2.3.4', 'UA')).toBe(
      storage.hashIdentity('1.2.3.4', 'UA')
    )
  })

  it('不同输入生成不同标识', () => {
    expect(storage.hashIdentity('1.2.3.4', 'UA')).not.toBe(
      storage.hashIdentity('5.6.7.8', 'UA')
    )
  })

  it('不包含原始输入（匿名化）', () => {
    const hash = storage.hashIdentity('1.2.3.4', 'Mozilla/5.0')
    expect(hash).not.toContain('1.2.3.4')
    expect(hash).not.toContain('Mozilla')
    expect(hash).toHaveLength(32)
  })
})

describe('存储后端', () => {
  it('未配置 Redis 时回退到文件存储', async () => {
    expect(await storage.getStorageBackend()).toBe('file')
  })
})
