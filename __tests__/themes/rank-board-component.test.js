/**
 * 新增排行榜功能 - 组件渲染测试
 *
 * 验证左侧排行榜在页面上的实际呈现：
 * 上下两个榜单、名称正确、条目按次数从高到低展示
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import { RankBoard } from '@/themes/example/components/RankBoard'

jest.mock('@/lib/config', () => ({
  siteConfig: jest.fn((key, fallback) => fallback)
}))

jest.mock('@/components/SmartLink', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  )
}))

const BOARD = {
  ok: true,
  updatedAt: Date.now(),
  enabled: { views: true, likes: true },
  views: [
    { id: 'v1', title: '阅读第一', href: '/article/v1', views: 300, likes: 1 },
    { id: 'v2', title: '阅读第二', href: '/article/v2', views: 200, likes: 2 },
    { id: 'v3', title: '阅读第三', href: '/article/v3', views: 100, likes: 3 }
  ],
  likes: [
    { id: 'l1', title: '点赞第一', href: '/article/l1', views: 5, likes: 90 },
    { id: 'l2', title: '点赞第二', href: '/article/l2', views: 4, likes: 50 }
  ]
}

describe('RankBoard 左侧排行榜', () => {
  beforeEach(() => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(BOARD)
      })
    )
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  it('渲染上下两个榜单：阅读榜与点赞榜', async () => {
    render(<RankBoard />)

    await waitFor(() => {
      expect(screen.getByText('阅读榜')).toBeInTheDocument()
    })
    expect(screen.getByText('点赞榜')).toBeInTheDocument()
  })

  it('阅读榜标题在点赞榜之前（上下排列）', async () => {
    const { container } = render(<RankBoard />)
    await waitFor(() => expect(screen.getByText('阅读榜')).toBeInTheDocument())

    const headings = [...container.querySelectorAll('h3')].map(
      el => el.textContent
    )
    const viewIndex = headings.findIndex(t => t.includes('阅读榜'))
    const likeIndex = headings.findIndex(t => t.includes('点赞榜'))

    expect(viewIndex).toBeGreaterThanOrEqual(0)
    expect(likeIndex).toBeGreaterThan(viewIndex)
  })

  it('条目按次数从高到低展示', async () => {
    const { container } = render(<RankBoard />)
    await waitFor(() =>
      expect(screen.getByText('阅读第一')).toBeInTheDocument()
    )

    const lists = container.querySelectorAll('.rank-board aside')
    const viewList = lists[0]

    const titles = [...viewList.querySelectorAll('li a')].map(a =>
      a.textContent.trim()
    )
    // 依次为 阅读第一(300) → 阅读第二(200) → 阅读第三(100)
    expect(titles[0]).toContain('阅读第一')
    expect(titles[1]).toContain('阅读第二')
    expect(titles[2]).toContain('阅读第三')
  })

  it('显示每篇文章对应的次数', async () => {
    const { container } = render(<RankBoard />)
    await waitFor(() =>
      expect(screen.getByText('阅读第一')).toBeInTheDocument()
    )

    const viewList = container.querySelectorAll('.rank-board aside')[0]
    const text = viewList.textContent
    expect(text).toContain('300')
    expect(text).toContain('200')
    expect(text).toContain('100')
  })

  it('点赞榜展示点赞数而不是阅读数', async () => {
    const { container } = render(<RankBoard />)
    await waitFor(() =>
      expect(screen.getByText('点赞第一')).toBeInTheDocument()
    )

    const likeList = container.querySelectorAll('.rank-board aside')[1]
    const text = likeList.textContent
    expect(text).toContain('90')
    expect(text).toContain('50')
    // 点赞榜不应显示这些文章的阅读数（5、4）
    expect(text).not.toContain('90 5')
  })

  it('条目链接指向对应文章', async () => {
    const { container } = render(<RankBoard />)
    await waitFor(() =>
      expect(screen.getByText('阅读第一')).toBeInTheDocument()
    )

    const firstLink = container.querySelector('.rank-board aside li a')
    expect(firstLink.getAttribute('href')).toBe('/article/v1')
  })

  it('展示排名序号 1/2/3', async () => {
    const { container } = render(<RankBoard />)
    await waitFor(() =>
      expect(screen.getByText('阅读第一')).toBeInTheDocument()
    )

    const badges = [
      ...container
        .querySelectorAll('.rank-board aside')[0]
        .querySelectorAll('li span')
    ].map(el => el.textContent)

    expect(badges).toContain('1')
    expect(badges).toContain('2')
    expect(badges).toContain('3')
  })

  it('榜单为空时显示占位文案而不是空白', async () => {
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ...BOARD, views: [], likes: [] })
      })
    )

    render(<RankBoard />)
    // 上下两个榜单都为空，各自显示占位文案
    await waitFor(() => {
      expect(screen.getAllByText(/暂无数据/)).toHaveLength(2)
    })
    expect(screen.getByText(/多来逛逛吧/)).toBeInTheDocument()
    expect(screen.getByText(/快来抢首赞/)).toBeInTheDocument()
  })

  it('接口失败时静默降级，不渲染破损的榜单', async () => {
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')))

    const { container } = render(<RankBoard />)
    await waitFor(() => {
      expect(container.querySelector('.rank-board')).toBeNull()
    })
  })

  it('请求榜单接口时带上配置的条数', async () => {
    render(<RankBoard />)
    await waitFor(() => expect(global.fetch).toHaveBeenCalled())

    const url = global.fetch.mock.calls[0][0]
    expect(url).toContain('/api/rank/top')
    expect(url).toContain('limit=')
  })
})
