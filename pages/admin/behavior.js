/**
 * /admin/behavior —— 行为分析（Phase 3）
 *
 * 阅读深度、完成率、搜索、外链与分享、事件计数。
 * 口径提醒：滚动深度是"页面滚到了哪一档"，不等于阅读时长，也不等于读懂。
 */

import AdminBarChart from '@/components/admin/AdminBarChart'
import AdminBarList from '@/components/admin/AdminBarList'
import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminDataTable from '@/components/admin/AdminDataTable'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminNotice from '@/components/admin/AdminNotice'
import AdminPanel from '@/components/admin/AdminPanel'
import AdminRangeTabs from '@/components/admin/AdminRangeTabs'
import AdminStatCards from '@/components/admin/AdminStatCards'
import { formatDateTime, formatNumber, formatPercent, safeDivide } from '@/components/admin/format'
import { useAdminReport, useRangeParam } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

const EVENT_LABELS = {
  page_view: '页面浏览',
  session_start: '会话开始',
  article_read: '文章阅读',
  scroll_depth: '滚动深度',
  article_complete: '读完文章',
  search: '站内搜索',
  category_click: '分类点击',
  tag_click: '标签点击',
  outbound_click: '外链点击',
  share_click: '分享点击',
  comment_submit: '评论提交',
  mascot_interaction: '桌宠交互'
}

export default function BehaviorPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <BehaviorContent admin={props.admin} />
}

function BehaviorContent({ admin }) {
  const [range, setRange] = useRangeParam('7d')
  const { data, loading, error, reload } = useAdminReport(range)

  const depth = data?.depth || {}
  const reads = Number(depth.d25 || 0)
  const complete = Number(depth.complete || 0)
  const completeRate = safeDivide(complete, reads)
  const depthTotal =
    Number(depth.d25 || 0) + Number(depth.d50 || 0) + Number(depth.d75 || 0) + Number(depth.d90 || 0)
  const weightedDepth = safeDivide(
    Number(depth.d25 || 0) * 25 +
      Number(depth.d50 || 0) * 50 +
      Number(depth.d75 || 0) * 75 +
      Number(depth.d90 || 0) * 90,
    depthTotal
  )

  const outboundTotal = (data?.outboundShare?.outbound || []).reduce(
    (acc, row) => acc + Number(row.count || 0),
    0
  )
  const shareTotal = (data?.outboundShare?.share || []).reduce(
    (acc, row) => acc + Number(row.count || 0),
    0
  )

  const articleRows = (data?.articles?.rows || [])
    .filter(row => row.avgDepth !== null || row.completeRate !== null)
    .slice(0, 20)

  const actions = (
    <div className='flex items-center gap-2'>
      <AdminRangeTabs value={range} onChange={setRange} disabled={loading} />
      <button
        type='button'
        onClick={() => void reload()}
        disabled={loading}
        className='rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'>
        {loading ? '刷新中…' : '刷新'}
      </button>
    </div>
  )

  return (
    <AdminModulePage
      admin={admin}
      active='behavior'
      title='行为分析'
      description='阅读深度、完成率、搜索与外链行为'
      actions={actions}>
      <div className='space-y-5'>
        {error && (
          <AdminNotice
            tone='error'
            title='取数失败'
            action={
              <button
                type='button'
                onClick={() => void reload()}
                className='rounded border border-red-300 px-2 py-0.5 text-[11px] hover:bg-red-100 dark:border-red-700 dark:hover:bg-red-900/30'>
                重试
              </button>
            }>
            {error}
          </AdminNotice>
        )}

        {!data && !error && <AdminNotice tone='info'>正在读取统计数据…</AdminNotice>}

        {data && (
          <>
            <AdminStatCards
              items={[
                {
                  key: 'completeRate',
                  label: '文章完成率',
                  value: completeRate === null ? null : Math.round(completeRate * 100),
                  suffix: '%',
                  hint: '读完 ÷ 开始阅读（25% 档）'
                },
                {
                  key: 'avgDepth',
                  label: '平均滚动深度',
                  value: weightedDepth === null ? null : Math.round(weightedDepth),
                  suffix: '%',
                  hint: '四档加权平均，非阅读时长'
                },
                {
                  key: 'outbound',
                  label: '外链点击',
                  value: outboundTotal,
                  hint: '点击站外链接的总次数'
                },
                {
                  key: 'share',
                  label: '分享点击',
                  value: shareTotal,
                  hint: '分享按钮点击（不等于发布成功）'
                }
              ]}
            />

            <AdminPanel
              title='阅读深度分布'
              description='滚动到 25% / 50% / 75% / 90% 的次数，以及读完次数'
              footnote='同一篇文章在同一档只上报一次；四档是"到达过"的计数，因此天然递减。滚动深度 ≠ 阅读时长。'>
              <AdminBarChart
                height={190}
                color='#22c55e'
                unit=' 次'
                emptyText='暂无阅读深度数据（需要文章页产生滚动事件）'
                points={[
                  { label: '25%', value: depth.d25 },
                  { label: '50%', value: depth.d50 },
                  { label: '75%', value: depth.d75 },
                  { label: '90%', value: depth.d90 },
                  { label: '读完', value: depth.complete }
                ]}
              />
            </AdminPanel>

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='文章阅读深度'
                description='按平均深度排序（最多 20 篇）'
                footnote='平均深度由该文章的深度事件加权得出；没有深度事件的文章不会出现在这里。'>
                <AdminDataTable
                  dense
                  maxRows={20}
                  emptyText='暂无文章深度数据'
                  columns={[
                    { key: 'title', label: '文章' },
                    {
                      key: 'avgDepth',
                      label: '平均深度',
                      align: 'right',
                      format: value =>
                        value === null || value === undefined ? '—' : `${Math.round(value)}%`
                    },
                    {
                      key: 'completeRate',
                      label: '完成率',
                      align: 'right',
                      format: value =>
                        value === null || value === undefined ? '—' : formatPercent(value, 0)
                    }
                  ]}
                  rows={articleRows}
                />
              </AdminPanel>

              <AdminPanel
                title='站内搜索'
                description={`共 ${formatNumber(data.search?.total || 0)} 次`}
                footnote='搜索词脱敏后保留 30 天；"搜了但没有结果"当前无法判定。'>
                <AdminBarList
                  limit={10}
                  color='#0ea5e9'
                  rows={(data.search?.terms || []).map(row => ({
                    label: row.term,
                    value: row.count
                  }))}
                  emptyText='暂无搜索数据'
                />
              </AdminPanel>
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='外链去向'
                description='点击跳出的目标域名'
                footnote='只记录域名，不记录完整 URL。'>
                <AdminBarList
                  limit={10}
                  color='#f97316'
                  rows={(data.outboundShare?.outbound || []).map(row => ({
                    label: row.host,
                    value: row.count
                  }))}
                  emptyText='暂无外链点击'
                />
              </AdminPanel>

              <AdminPanel
                title='分享渠道'
                description='分享按钮点击分布'
                footnote='我方只能看到"点了分享"，是否成功发布取决于第三方平台。'>
                <AdminBarList
                  limit={10}
                  color='#ec4899'
                  rows={(data.outboundShare?.share || []).map(row => ({
                    label: row.channel,
                    value: row.count
                  }))}
                  emptyText='暂无分享点击'
                />
              </AdminPanel>
            </div>

            <AdminPanel
              title='事件计数'
              description='所选时间窗内各类事件的总次数'
              footnote='事件来自 /api/track 白名单；计数包含所有页面，不区分具体路径。'>
              <AdminDataTable
                dense
                maxRows={20}
                emptyText='暂无事件数据'
                columns={[
                  {
                    key: 'name',
                    label: '事件',
                    format: value => EVENT_LABELS[value] || value
                  },
                  { key: 'value', label: '次数', align: 'right' }
                ]}
                rows={Object.entries(data.events || {})
                  .map(([name, value]) => ({ id: name, name, value }))
                  .sort((a, b) => b.value - a.value)}
              />
            </AdminPanel>

            <p className='text-[11px] text-gray-400 dark:text-gray-500'>
              数据生成时间：{formatDateTime(data.generatedAt)} · 时区 Asia/Shanghai
            </p>
          </>
        )}
      </div>
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/behavior' })
  if (guard.redirect) return guard
  return guard
}
