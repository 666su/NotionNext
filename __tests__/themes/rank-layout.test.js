/**
 * 新增排行榜功能 - 左侧栏布局回归测试
 *
 * 关键不变量（易被重构悄悄破坏）：
 *   容器在 LAYOUT_SIDEBAR_REVERSE=true 时使用 flex-row-reverse，
 *   此时 **DOM 最后一个元素** 落在视觉最左。
 *   系列面板是原布局里最右的一块，排在 DOM 第一；
 *   排行榜要出现在视觉左侧空白区，就必须排在它后面（DOM 最后）。
 *
 * 若有人把 RankBoard 挪回 DOM 最前，本测试会失败。
 */
import fs from 'fs'
import path from 'path'

const SOURCE = fs.readFileSync(
  path.join(process.cwd(), 'themes/example/index.js'),
  'utf8'
)

/** 取出 container-wrapper 内部的 JSX，避免匹配到页面其它位置 */
function containerInner() {
  const start = SOURCE.indexOf("id='container-wrapper'")
  expect(start).toBeGreaterThan(-1)

  // 从 wrapper 开始，截取到 article-wrapper 或页脚为止
  const rest = SOURCE.slice(start)
  const end = rest.indexOf('<Footer')
  return end > -1 ? rest.slice(0, end) : rest
}

describe('左侧排行榜的 DOM 位置', () => {
  it('容器在 LAYOUT_SIDEBAR_REVERSE 下启用 flex-row-reverse', () => {
    expect(SOURCE).toContain("LAYOUT_SIDEBAR_REVERSE ? 'flex-row-reverse' : ''")
  })

  it('RankBoard 与 SeriesPanel 同时挂在 container-wrapper 内', () => {
    const inner = containerInner()
    expect(inner).toContain('<RankBoard')
    expect(inner).toContain('<SeriesPanel')
  })

  it('RankBoard 排在 SeriesPanel 之后 → flex-row-reverse 下落在视觉最左', () => {
    const inner = containerInner()
    const seriesIndex = inner.indexOf('<SeriesPanel')
    const rankIndex = inner.indexOf('<RankBoard')

    expect(seriesIndex).toBeGreaterThan(-1)
    expect(rankIndex).toBeGreaterThan(-1)
    // 后者才是视觉左侧
    expect(rankIndex).toBeGreaterThan(seriesIndex)
  })

  it('主内容区夹在两个侧栏之间 → 反向渲染后居中', () => {
    const inner = containerInner()
    const seriesIndex = inner.indexOf('<SeriesPanel')
    const contentIndex = inner.indexOf('transition-all duration-300')
    const rankIndex = inner.indexOf('<RankBoard')

    expect(contentIndex).toBeGreaterThan(-1)
    // DOM 顺序：系列面板 → 内容 → 排行榜
    expect(contentIndex).toBeGreaterThan(seriesIndex)
    expect(rankIndex).toBeGreaterThan(contentIndex)

    // 反向渲染后的视觉顺序：左=排行榜，中=内容，右=系列面板
    // （即需求要求的「左侧空白区放排行榜」）
  })

  it('关闭反向布局时用 order-first 兜底，榜单仍在左侧', () => {
    expect(SOURCE).toContain("LAYOUT_SIDEBAR_REVERSE ? '' : 'order-first'")
  })

  it('榜单侧栏与系列面板同宽同定位，保持左右对称', () => {
    const inner = containerInner()
    // 两个侧栏都应使用这一组类名
    const matches = inner.match(
      /hidden lg:block w-56 xl:w-64 flex-shrink-0 sticky top-20/g
    )
    expect(matches).not.toBeNull()
    expect(matches.length).toBeGreaterThanOrEqual(2)
  })

  it('榜单在移动端隐藏，不挤占小屏阅读空间', () => {
    const inner = containerInner()
    expect(inner).toContain('hidden lg:block')
  })

  it('受 RANK_ENABLE 开关控制', () => {
    expect(SOURCE).toContain("siteConfig('RANK_ENABLE', true)")
  })

  it('全宽模式下不渲染侧栏', () => {
    const inner = containerInner()
    const rankBlock = inner.slice(inner.indexOf('<RankBoard') - 300)
    expect(rankBlock).toContain('!fullWidth')
  })
})

describe('文章页互动区位置', () => {
  it('ArticleInteraction 位于正文之后、评论区之前', () => {
    const slugStart = SOURCE.indexOf('const LayoutSlug')
    const slugSection = SOURCE.slice(slugStart)

    const notionIndex = slugSection.indexOf('<NotionPage')
    const interactionIndex = slugSection.indexOf('<ArticleInteraction')
    const commentIndex = slugSection.indexOf('<Comment')

    expect(notionIndex).toBeGreaterThan(-1)
    expect(interactionIndex).toBeGreaterThan(notionIndex)
    expect(commentIndex).toBeGreaterThan(interactionIndex)
  })
})

describe('配置接线', () => {
  it('blog.config.js 引入 rank.config', () => {
    const config = fs.readFileSync(
      path.join(process.cwd(), 'blog.config.js'),
      'utf8'
    )
    expect(config).toContain("require('./conf/rank.config')")
  })

  it('rank.config 的默认值符合需求（双榜开启、按次数降序取前 10）', async () => {
    const rankConfig = (await import('@/conf/rank.config')).default
    expect(rankConfig.RANK_ENABLE).toBe(true)
    expect(rankConfig.RANK_VIEW_ENABLE).toBe(true)
    expect(rankConfig.RANK_LIKE_ENABLE).toBe(true)
    expect(rankConfig.RANK_LIST_SIZE).toBe(10)
  })
})
