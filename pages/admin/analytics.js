/**
 * /admin/analytics —— 流量分析（Phase 3）
 *
 * PV / UV / Session 的时间变化、页面排行、来源结构与搜索词。
 * 口径：PV 可重复计数；UV 为 HLL 去重估算；Session 30 分钟静默即结束。三者不等价。
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
import AdminTrendChart from '@/components/admin/AdminTrendChart'
import {
  formatDateTime,
  formatNumber,
  formatPercent,
  safeDivide,
  shortDay
} from '@/components/admin/format'
import { useAdminReport, useRangeParam } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

const SOURCE_LABELS = {
  direct: '直接访问',
  internal: '站内跳转',
  search: '搜索引擎',
  social: '社交媒体',
  referral: '外部链接'
}

const RANGE_TEXT = {
  today: '今日（00:00 起）',
  yesterday: '昨日（全天）',
  '7d': '近 7 个自然日',
  '30d': '近 30 个自然日',
  '90d': '近 90 个自然日'
}

export default function AnalyticsPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <AnalyticsContent admin={props.admin} />
}

function AnalyticsContent({ admin }) {
  const [range, setRange] = useRangeParam('7d')
  const { data, loading, error, reload } = useAdminReport(range)

  const pv = data?.summary?.pv
  const uv = data?.summary?.uv
  const sessions = data?.summary?.sessions
  const direct = data?.summary?.dims?.source?.direct
  const directShare = safeDivide(direct, pv)
  const pagesPerVisitor = safeDivide(pv, uv)
  const pagesPerSession = safeDivide(pv, sessions)

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
      active='analytics'
      title='流量分析'
      description='PV / UV / Session 的时间变化与来源结构'
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
                { key: 'pv', label: 'PV（页面浏览）', value: pv, hint: RANGE_TEXT[range] },
                {
                  key: 'uv',
                  label: 'UV（去重访客）',
                  value: uv,
                  hint: 'HyperLogLog 估算，误差约 0.81%'
                },
                { key: 'sessions', label: 'Session', value: sessions, hint: '30 分钟无活动即结束' },
                {
                  key: 'direct',
                  label: '直接访问占比',
                  value: directShare === null ? null : Math.round(directShare * 100),
                  suffix: '%',
                  hint: '无 Referer 的访问'
                }
              ]}
            />

            <AdminStatCards
              columns={4}
              items={[
                {
                  key: 'pvPerUv',
                  label: '人均 PV',
                  value: pagesPerVisitor === null ? null : Number(pagesPerVisitor.toFixed(2)),
                  hint: 'PV ÷ UV，仅作参考'
                },
                {
                  key: 'pvPerSession',
                  label: '每 Session 页面数',
                  value: pagesPerSession === null ? null : Number(pagesPerSession.toFixed(2)),
                  hint: 'PV ÷ Session'
                },
                {
                  key: 'search',
                  label: '站内搜索次数',
                  value: data.search?.total,
                  hint: '搜索事件计数'
                },
                {
                  key: 'realtime',
                  label: '实时活跃（估算）',
                  value: data.realtime?.sessions,
                  hint: '最近 5 分钟有事件的会话'
                }
              ]}
            />

            {data.hourly?.day ? (
              <AdminPanel
                title='逐小时访问'
                description={`${RANGE_TEXT[range]} · 按小时`}
                footnote='小时桶按 Asia/Shanghai 切分；单日窗口才有意义，因此切到多日范围时会改为按日趋势。'>
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
                description={`${RANGE_TEXT[range]} · 按日`}
                footnote='每个点代表一个自然日（Asia/Shanghai）；跨日 UV 为 HLL 合并估算，不等于各日 UV 之和。'>
                <AdminTrendChart
                  height={220}
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
                />
              </AdminPanel>
            )}

            <AdminPanel
              title='页面访问排行'
              description='所选时间窗内 PV 最高的页面'
              footnote='路径是页面实际路径；带查询参数的访问会归到同一路径。'>
              <AdminDataTable
                dense
                maxRows={20}
                emptyText='暂无页面访问数据'
                columns={[
                  { key: 'path', label: '页面路径', mono: true },
                  { key: 'views', label: 'PV', align: 'right' },
                  {
                    key: 'share',
                    label: '占比',
                    align: 'right',
                    format: (_value, row) => {
                      const ratio = safeDivide(row.views, pv)
                      return ratio === null ? '—' : formatPercent(ratio * 100, 1)
                    }
                  }
                ]}
                rows={data.pages?.pv || []}
              />
            </AdminPanel>

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='入口页面'
                description='会话的第一个页面'
                footnote='同一会话只记一次入口。'>
                <AdminBarList
                  limit={10}
                  color='#22c55e'
                  rows={(data.pages?.entry || []).map(row => ({
                    label: row.path,
                    value: row.views,
                    mono: true
                  }))}
                  emptyText='暂无入口数据'
                />
              </AdminPanel>

              <AdminPanel
                title='退出页面'
                description='会话内最后一次浏览'
                footnote='近似值：只统计"会话内换页"的场景，真正关闭标签页无法可靠捕获。'>
                <AdminBarList
                  limit={10}
                  color='#f97316'
                  rows={(data.pages?.exit || []).map(row => ({
                    label: row.path,
                    value: row.views,
                    mono: true
                  }))}
                  emptyText='暂无退出数据'
                />
              </AdminPanel>
            </div>

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='来源渠道'
                description='按 Referer 归类'
                footnote='无 Referer = 直接访问；站内跳转单列，不计入外部来源。'>
                <AdminBarList
                  total={pv}
                  color='#6366f1'
                  rows={Object.entries(data.summary?.dims?.source || {}).map(([key, value]) => ({
                    label: SOURCE_LABELS[key] || key,
                    value
                  }))}
                  emptyText='暂无来源数据'
                />
              </AdminPanel>

              <AdminPanel
                title='来源域名'
                description='外部来源的具体域名（Top 15）'
                footnote='仅记录域名，不记录完整 URL 与查询参数。'>
                <AdminBarList
                  limit={15}
                  color='#8b5cf6'
                  rows={(data.referrers || []).map(row => ({
                    label: row.host,
                    value: row.views
                  }))}
                  emptyText='暂无外部来源'
                />
              </AdminPanel>
            </div>

            <AdminPanel
              title='站内搜索'
              description={`共 ${formatNumber(data.search?.total || 0)} 次搜索`}
              footnote='搜索词已脱敏（邮箱/手机号替换、长度 ≤32、小写），保留 30 天。'>
              <AdminDataTable
                dense
                maxRows={15}
                emptyText='暂无搜索数据'
                columns={[
                  { key: 'term', label: '搜索词' },
                  { key: 'count', label: '次数', align: 'right' }
                ]}
                rows={data.search?.terms || []}
              />
            </AdminPanel>

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='外链点击'
                description='点击跳转到站外'
                footnote='只记录目标域名，不记录被点击的完整 URL。'>
                <AdminBarList
                  rows={(data.outboundShare?.outbound || []).map(row => ({
                    label: row.host,
                    value: row.count
                  }))}
                  color='#0ea5e9'
                  emptyText='暂无外链点击'
                />
              </AdminPanel>

              <AdminPanel
                title='分享行为'
                description='分享按钮点击'
                footnote='分享点击 ≠ 分享成功：平台是否真正发布我们无法确认。'>
                <AdminBarList
                  rows={(data.outboundShare?.share || []).map(row => ({
                    label: row.channel,
                    value: row.count
                  }))}
                  color='#ec4899'
                  emptyText='暂无分享点击'
                />
              </AdminPanel>
            </div>

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
  const guard = await adminPageGuard(ctx, { next: '/admin/analytics' })
  if (guard.redirect) return guard
  return guard
}
