import { SeriesTimeline } from './SeriesTimeline'
import { WritingCalendar } from './WritingCalendar'

/**
 * 新增文章系列展示功能
 * 系列面板：位于文章内容和右侧边栏之间
 * 包含系列时间线 + 写作日历
 */
export const SeriesPanel = ({ posts }) => {
  if (!posts || posts.length === 0) return null

  return (
    <div className='series-panel space-y-6'>
      {/* 系列时间线 */}
      <SeriesTimeline posts={posts} />

      {/* 写作日历 */}
      <WritingCalendar posts={posts} />
    </div>
  )
}
