/**
 * /admin/dashboard —— 数据总览
 *
 * 数据来源：GET /api/admin/stats/report（自建统计 + Notion 只读快照）
 * 纪律：没有数据就显示"未采集/—"，绝不用模拟数字或 0 冒充。
 */

import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminBarChart from '@/components/admin/AdminBarChart'
import AdminAiSummary from '@/components/admin/AdminAiSummary'
import AdminBarList from '@/components/admin/AdminBarList'
import AdminDataTable from '@/components/admin/AdminDataTable'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminNotice from '@/components/admin/AdminNotice'
import AdminPanel from '@/components/admin/AdminPanel'
import AdminRangeTabs from '@/components/admin/AdminRangeTabs'
import AdminStatCards from '@/components/admin/AdminStatCards'
import AdminTrendChart from '@/components/admin/AdminTrendChart'
import { formatDateTime, formatNumber, formatPercent, shortDay } from '@/components/admin/format'
import { useAdminReport, useRangeParam } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

const SOURCE_LABELS = {
  direct: '直接访问',
  internal: '站内跳转',
  search: '搜索引擎',
  social: '社交媒体',
  referral: '外部链接'
}

export default function DashboardPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <DashboardContent admin={props.admin} />
}

function DashboardContent({ admin }) {
  const [range, setRange] = useRangeParam('7d')
  const { data, loading, error, reload, updatedAt } = useAdminReport(range)

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
      active='dashboard'
      title='数据总览'
      description='站点运营概览 · 数据来自自建统计服务与 Notion 只读快照'
      actions={actions}>
      <div className='space-y-5'>
        <AdminAiSummary />

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
                  key: 'todayPv',
                  label: '今日 PV',
                  value: data.cards?.today?.pv,
                  hint: '当日 00:00 起（Asia/Shanghai）'
                },
                {
                  key: 'todayUv',
                  label: '今日 UV',
                  value: data.cards?.today?.uv,
                  hint: '去重匿名访客（HyperLogLog 估算）'
                },
                {
                  key: 'todaySessions',
                  label: '今日 Session',
                  value: data.cards?.today?.sessions,
                  hint: '30 分钟无活动即结束'
                },
                {
                  key: 'realtime',
                  label: '实时活跃（估算）',
                  value: data.realtime?.sessions,
                  hint: `最近 ${data.realtime?.windowMinutes || 5} 分钟内有事件的会话`,
                  tone: 'accent'
                }
              ]}
            />

            <AdminStatCards
              columns={4}
              items={[
                { key: 'yesterdayPv', label: '昨日 PV', value: data.cards?.yesterday?.pv },
                { key: 'yesterdayUv', label: '昨日 UV', value: data.cards?.yesterday?.uv },
                { key: 'pv7', label: '近 7 天 PV', value: data.cards?.pv7 },
                { key: 'pv30', label: '近 30 天 PV', value: data.cards?.pv30 }
              ]}
            />

            <AdminStatCards
              columns={4}
              items={[
                {
                  key: 'uv30',
                  label: '近 30 天 UV',
                  value: data.cards?.uv30,
                  hint: '跨日去重（估算）'
                },
                {
                  key: 'articles',
                  label: '文章总数',
                  value: data.articles?.count || null,
                  hint: data.articles?.syncedAt
                    ? `同步于 ${formatDateTime(data.articles.syncedAt)}`
                    : '尚未同步 Notion'
                },
                {
                  key: 'categories',
                  label: '分类总数',
                  value: data.articles?.categories?.length || null,
                  hint: '来自 Notion 只读同步'
                },
                {
                  key: 'tags',
                  label: '标签总数',
                  value: data.articles?.tags?.length || null,
                  hint: '来自 Notion 只读同步'
                }
              ]}
            />

            {!data.collectionStartedAt && data.summary?.pv === 0 && (
              <AdminNotice tone='warn' title='还没有采集到任何访问数据'>
                统计从首次部署 <code>/api/track</code> 之后才开始，此前的历史流量没有数据来源，不做补算。
                若线上已运行一段时间仍是 0，请检查 <code>REDIS_URL</code> 是否配置在部署环境。
              </AdminNotice>
            )}

            {data.collectionStartedAt && (
              <AdminNotice tone='info'>
                统计自 <strong>{formatDateTime(data.collectionStartedAt)}</strong> 起开始采集；
                此前历史流量无数据来源。所有数字均可在「流量分析」页按口径核对。
              </AdminNotice>
            )}

            {data.hourly?.day ? (
              <AdminPanel
                title='逐小时访问'
                description={`${shortDay(data.hourly.day)} · 按小时（今日选择单日范围时显示）`}
                footnote='小时桶按 Asia/Shanghai 切分。多日范围会自动改为按日趋势。'>
                <AdminBarChart
                  height={190}
                  color='#6366f1'
                  unit=' 次'
                  points={(data.hourly.rows || []).map(row => ({
                    label: `${row.hour}时`,
                    value: row.pv
                  }))}
                  emptyText='该日暂无访问'
                />
              </AdminPanel>
            ) : (
              <AdminPanel
                title='访问趋势'
                description='按日 · PV / UV / Session'
                footnote='UV 为跨日 HLL 去重估算；Session 与 PV 不存在换算关系。'>
                <AdminTrendChart
                  series={[
                    {
                      key: 'pv',
                      name: 'PV',
                      color: '#3b82f6',
                      points: (data.summary?.byDay || []).map(item => ({
                        label: shortDay(item.date),
                        value: item.pv
                      }))
                    },
                    {
                      key: 'uv',
                      name: 'UV',
                      color: '#10b981',
                      points: (data.summary?.byDay || []).map(item => ({
                        label: shortDay(item.date),
                        value: item.uv
                      }))
                    },
                    {
                      key: 'sessions',
                      name: 'Session',
                      color: '#f59e0b',
                      points: (data.summary?.byDay || []).map(item => ({
                        label: shortDay(item.date),
                        value: item.sessions
                      }))
                    }
                  ]}
                  height={200}
                />
              </AdminPanel>
            )}

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='访问来源'
                description='按当日首个页面浏览的 Referer 归类'
                footnote='无 Referer 归为直接访问，不做猜测补全。'>
                <AdminBarList
                  total={data.summary?.pv}
                  rows={Object.entries(data.summary?.dims?.source || {}).map(([key, value]) => ({
                    label: SOURCE_LABELS[key] || key,
                    value
                  }))}
                  color='#6366f1'
                  emptyText='暂无来源数据'
                />
              </AdminPanel>

              <AdminPanel
                title='热门页面'
                description='所选时间窗内 PV 最高的页面'
                footnote='路径为站内相对路径，文章页形如 /article/<slug>。'>
                <AdminDataTable
                  dense
                  maxRows={8}
                  emptyText='暂无页面数据'
                  columns={[
                    { key: 'path', label: '页面', mono: true },
                    { key: 'views', label: 'PV', align: 'right' }
                  ]}
                  rows={data.pages?.pv || []}
                />
              </AdminPanel>
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='文章表现'
                description='按 PV 排序（路径口径与 article_id 口径取较大值）'
                footnote={
                  data.articles?.syncedAt
                    ? `标题来自 Notion 快照（${formatDateTime(data.articles.syncedAt)}）。`
                    : '尚未同步 Notion：标题显示为文章 ID，请在「文章管理」页执行一次同步。'
                }>
                <AdminDataTable
                  dense
                  maxRows={8}
                  emptyText='暂无文章数据'
                  columns={[
                    { key: 'title', label: '文章' },
                    {
                      key: 'pv',
                      label: 'PV',
                      align: 'right',
                      format: value => formatNumber(value)
                    },
                    {
                      key: 'completeRate',
                      label: '完成率',
                      align: 'right',
                      format: value =>
                        value === null || value === undefined ? '—' : formatPercent(value, 0)
                    }
                  ]}
                  rows={(data.articles?.rows || []).filter(row => row.pv > 0)}
                />
              </AdminPanel>

              <AdminPanel
                title='搜索与跳出'
                description='站内搜索次数、入口与退出页面'
                footnote='退出页是"同一会话内最后一次浏览的页面"的近似，不是真正的关闭事件。'>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <div>
                    <p className='mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400'>
                      热门搜索词（{formatNumber(data.search?.total || 0)} 次搜索）
                    </p>
                    <AdminBarList
                      limit={5}
                      rows={(data.search?.terms || []).map(term => ({
                        label: term.term,
                        value: term.count
                      }))}
                      color='#0ea5e9'
                      emptyText='暂无搜索数据'
                    />
                  </div>
                  <div>
                    <p className='mb-1 text-[11px] font-medium text-gray-500 dark:text-gray-400'>
                      入口页面
                    </p>
                    <AdminBarList
                      limit={5}
                      rows={(data.pages?.entry || []).map(row => ({
                        label: row.path,
                        value: row.views,
                        mono: true
                      }))}
                      color='#f97316'
                      emptyText='暂无入口数据'
                    />
                  </div>
                </div>
              </AdminPanel>
            </div>

            <p className='text-[11px] text-gray-400 dark:text-gray-500'>
              数据生成时间：{formatDateTime(data.generatedAt)} · 时区 Asia/Shanghai
              {updatedAt ? ` · 本页刷新于 ${formatDateTime(new Date(updatedAt).toISOString())}` : ''}
            </p>
          </>
        )}
      </div>
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/dashboard' })
  if (guard.redirect) return guard
  return guard
}
