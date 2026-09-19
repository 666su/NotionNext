import BLOG from '@/blog.config'
import { siteConfig } from '@/lib/config'
import { fetchGlobalAllData } from '@/lib/db/SiteDataApi'
import { DynamicLayout } from '@/themes/theme'
import { groupPostsBySeries, getAllSeriesNames } from '@/lib/utils/series'

/**
 * 新增文章系列展示功能
 * 系列文章列表页：/series/[series]
 * 显示该系列下所有文章，按 number 排序
 */
export default function SeriesPage(props) {
  const theme = siteConfig('THEME', BLOG.THEME, props.NOTION_CONFIG)
  return <DynamicLayout theme={theme} layoutName='LayoutPostList' {...props} />
}

export async function getStaticProps({ params: { series }, locale }) {
  const from = 'series-props'
  let props = await fetchGlobalAllData({ from, locale })

  // 过滤已发布的 Post 类型文章
  props.posts = props.allPages?.filter(
    page => page.type === 'Post' && page.status === 'Published'
  )

  // 新增文章系列展示功能：筛选属于该系列的文章
  const targetSeries = decodeURIComponent(series)
  props.posts = (props.posts || []).filter(
    post => post.series && post.series.trim() === targetSeries
  )

  // 按 number 排序（无 number 则按日期倒序）
  const hasNumber = props.posts.some(p => p.number != null && String(p.number).trim() !== '')
  if (hasNumber) {
    props.posts.sort((a, b) => {
      const numA = parseFloat(a.number) || Infinity
      const numB = parseFloat(b.number) || Infinity
      if (numA !== numB) return numA - numB
      return (b?.publishDate ?? 0) - (a?.publishDate ?? 0)
    })
  } else {
    props.posts.sort((a, b) => (b?.publishDate ?? 0) - (a?.publishDate ?? 0))
  }

  props.postCount = props.posts.length
  delete props.allPages

  // 传递系列名称给前端组件
  props = { ...props, series: targetSeries }

  return {
    props,
    revalidate: process.env.EXPORT
      ? undefined
      : siteConfig(
          'NEXT_REVALIDATE_SECOND',
          BLOG.NEXT_REVALIDATE_SECOND,
          props.NOTION_CONFIG
        )
  }
}

export async function getStaticPaths() {
  const from = 'series-paths'
  const data = await fetchGlobalAllData({ from })
  const allPosts = (data?.allPages || []).filter(
    page => page.type === 'Post' && page.status === 'Published'
  )
  const seriesNames = getAllSeriesNames(allPosts)

  return {
    paths: seriesNames.map(name => ({
      params: { series: encodeURIComponent(name) }
    })),
    fallback: true
  }
}
