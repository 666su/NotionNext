/**
 * Blog Pet 桌宠组件测试
 *
 * 覆盖：默认渲染、点击打开对话、关键词检索与跳转、无结果提示、
 *       右键菜单、隐藏与恢复、Esc 关闭、设置持久化、自动气泡
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import BlogPet from '@/components/BlogPet/BlogPet'
import { PET_STORAGE_KEY } from '@/components/BlogPet/blogPetConfig'

const mockPush = jest.fn()
jest.mock('next/router', () => ({
  useRouter: () => ({ push: mockPush })
}))

// jest.setup.js 会在每个测试后清空 body，portal 会导致卸载时报错；
// 测试环境直接把 portal 退化为内联渲染
jest.mock('react-dom', () => {
  const actual = jest.requireActual('react-dom')
  return { ...actual, createPortal: node => node }
})

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
    title: '本地部署 DeepSeek Harness',
    href: '/article/dsh01',
    summary: '体验属于自己的 AI Agent',
    category: '技术分享',
    tags: ['AI'],
    date: '2026-9-17'
  }
]

function mockFetchSuccess() {
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ ok: true, posts: POSTS })
    })
  )
}

async function renderPet() {
  render(<BlogPet />)
  return screen.findByRole('button', { name: /小猫/ })
}

function clickPet(pet) {
  fireEvent.pointerDown(pet)
  fireEvent.pointerUp(pet)
}

describe('Blog Pet 桌宠', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mockPush.mockClear()
    mockFetchSuccess()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('默认在页面渲染角色立绘', async () => {
    await renderPet()
    expect(screen.getByAltText('戴墨镜的小猫男孩桌宠')).toBeTruthy()
  })

  test('点击桌宠打开对话框并显示欢迎语', async () => {
    const pet = await renderPet()
    clickPet(pet)
    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByLabelText('搜索博客文章')).toBeTruthy()
  })

  test('鼠标长按左键即可拖动桌宠，无需先开自由移动', async () => {
    jest.useFakeTimers()
    const pet = await renderPet()

    const firePointer = (type, props = {}) => {
      const event = new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        ...props
      })
      Object.defineProperty(event, 'pointerType', { value: 'mouse' })
      pet.dispatchEvent(event)
    }

    firePointer('pointerdown', { clientX: 100, clientY: 100, button: 0 })
    act(() => {
      jest.advanceTimersByTime(400)
    })
    firePointer('pointermove', { clientX: 170, clientY: 150 })
    act(() => {
      firePointer('pointerup', { clientX: 170, clientY: 150 })
    })

    const saved = JSON.parse(window.localStorage.getItem(PET_STORAGE_KEY))
    expect(saved.position).toBeTruthy()
    expect(typeof saved.position.x).toBe('number')
    // 拖动不应被当成点击
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('键盘 Enter 也能打开与关闭对话', async () => {
    const pet = await renderPet()
    fireEvent.keyDown(pet, { key: 'Enter' })
    expect(await screen.findByRole('dialog')).toBeTruthy()

    fireEvent.keyDown(pet, { key: 'Enter' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('输入关键词检索到真实文章，点击可跳转', async () => {
    const pet = await renderPet()
    clickPet(pet)

    const input = await screen.findByLabelText('搜索博客文章')
    fireEvent.change(input, { target: { value: 'Cloudflare' } })
    fireEvent.submit(input.closest('form'))

    const card = await screen.findByText('Cloudflare 建站实践')
    fireEvent.click(card)
    expect(mockPush).toHaveBeenCalledWith('/article/Cloudflare02')
  })

  test('检索不到文章时明确提示，不编造内容', async () => {
    const pet = await renderPet()
    clickPet(pet)

    const input = await screen.findByLabelText('搜索博客文章')
    fireEvent.change(input, { target: { value: '区块链' } })
    fireEvent.submit(input.closest('form'))

    expect(
      await screen.findByText(/没有找到相关文章/)
    ).toBeTruthy()
  })

  test('按 Esc 关闭对话框', async () => {
    const pet = await renderPet()
    clickPet(pet)
    await screen.findByRole('dialog')

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('右键打开菜单，隐藏后仍可恢复', async () => {
    const pet = await renderPet()
    fireEvent.contextMenu(pet)

    expect(await screen.findByRole('menu')).toBeTruthy()
    fireEvent.click(screen.getByText('隐藏桌宠'))

    const restore = await screen.findByRole('button', { name: '显示桌宠' })
    const saved = JSON.parse(window.localStorage.getItem(PET_STORAGE_KEY))
    expect(saved.visible).toBe(false)

    fireEvent.click(restore)
    await waitFor(() =>
      expect(screen.getByAltText('戴墨镜的小猫男孩桌宠')).toBeTruthy()
    )
  })

  test('记住上次关闭状态：默认读取本地设置', async () => {
    window.localStorage.setItem(
      PET_STORAGE_KEY,
      JSON.stringify({ visible: false })
    )
    render(<BlogPet />)

    expect(
      await screen.findByRole('button', { name: '显示桌宠' })
    ).toBeTruthy()
    expect(screen.queryByAltText('戴墨镜的小猫男孩桌宠')).toBeNull()
  })

  test('无人交互时会自动冒出文章气泡', async () => {
    jest.useFakeTimers()
    jest.spyOn(Math, 'random').mockReturnValue(0)

    render(<BlogPet />)
    await screen.findByRole('button', { name: /小猫/ })

    act(() => {
      jest.advanceTimersByTime(15000)
    })
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    const bubble = screen.getByRole('status')
    expect(bubble.textContent).toMatch(/Cloudflare|DeepSeek/)
  })
})
