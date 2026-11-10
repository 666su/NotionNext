/**
 * /admin/visitors —— 访客分析（Phase 3）
 *
 * 只看集合特征：国家/地区、设备、浏览器、系统、新老访客。
 * 硬边界：不采 IP、不采 GPS、不做设备指纹；维度缺失时显示"未采集"，不猜。
 */

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
  formatPercent,
  safeDivide,
  shortDay
} from '@/components/admin/format'
import { useAdminReport, useRangeParam } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

const DEVICE_LABELS = { desktop: '桌面', mobile: '手机', tablet: '平板', unknown: '未采集' }
const BROWSER_LABELS = {
  chrome: 'Chrome',
  edge: 'Edge',
  firefox: 'Firefox',
  safari: 'Safari',
  opera: 'Opera',
  ie: 'IE',
  unknown: '未采集'
}
const OS_LABELS = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
  android: 'Android',
  ios: 'iOS',
  unknown: '未采集'
}

function withLabels(hash, labels) {
  return Object.entries(hash || {})
    .map(([key, value]) => ({
      label: labels[key] || key.toUpperCase(),
      value,
      note: key === 'unknown' ? '该请求没有可用的归类信息' : undefined
    }))
    .sort((a, b) => b.value - a.value)
}

export default function VisitorsPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <VisitorsContent admin={props.admin} />
}

function VisitorsContent({ admin }) {
  const [range, setRange] = useRangeParam('7d')
  const { data, loading, error, reload } = useAdminReport(range)

  const visitors = data?.visitors || {}
  const returningShare = safeDivide(visitors.returningVisitors, visitors.total)

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
      active='visitors'
      title='访客分析'
      description='匿名访客的地理与设备特征（不采集 IP、不采集 GPS）'
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
                  key: 'uv',
                  label: 'UV（去重访客）',
                  value: data.summary?.uv,
                  hint: '统计周期内去重的匿名 ID'
                },
                {
                  key: 'new',
                  label: '首次访客 PV',
                  value: visitors.newVisitors,
                  hint: '匿名 ID 第一次出现时产生的浏览'
                },
                {
                  key: 'returning',
                  label: '回访访客 PV',
                  value: visitors.returningVisitors,
                  hint: '同一匿名 ID 再次访问产生的浏览'
                },
                {
                  key: 'returningShare',
                  label: '回访 PV 占比',
                  value: returningShare === null ? null : Math.round(returningShare * 100),
                  suffix: '%',
                  hint: '回访 PV ÷（首次 + 回访）'
                }
              ]}
            />

            <AdminNotice tone='info' title='关于「首次访客 / 回访」的说明'>
              判定依据是浏览器本地的匿名 ID（localStorage），统计单位是<strong>页面浏览</strong>而不是不重复人数：
              同一个新访客连看 3 页，会记 3 次「首次访客 PV」。清缓存、换设备、无痕模式都会被当成新访客，
              因此这些数字只能当趋势参考，不等于真实人数；UV 本身也不是真实自然人数量。
            </AdminNotice>

            <AdminPanel
              title='UV 趋势'
              description='按日去重访客数（HyperLogLog 估算）'
              footnote='跨日 UV 是各日 HLL 合并后的估算值，不等于各行相加。'>
              <AdminTrendChart
                height={200}
                series={[
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

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='设备类型'
                description='来自 User-Agent 归类（服务端完成）'
                footnote='归类在服务端进行，客户端不上报设备指纹。'>
                <AdminBarList
                  total={data.summary?.pv}
                  color='#3b82f6'
                  rows={withLabels(data.summary?.dims?.device, DEVICE_LABELS)}
                  emptyText='暂无设备数据'
                />
              </AdminPanel>

              <AdminPanel
                title='浏览器'
                description='来自 User-Agent 归类'
                footnote='同内核浏览器可能被归到同一类（例如国产浏览器的 Chromium 内核）。'>
                <AdminBarList
                  total={data.summary?.pv}
                  color='#8b5cf6'
                  rows={withLabels(data.summary?.dims?.browser, BROWSER_LABELS)}
                  emptyText='暂无浏览器数据'
                />
              </AdminPanel>

              <AdminPanel
                title='操作系统'
                description='来自 User-Agent 归类'
                footnote='未识别的一律归入「未采集」，不做猜测。'>
                <AdminBarList
                  total={data.summary?.pv}
                  color='#0ea5e9'
                  rows={withLabels(data.summary?.dims?.os, OS_LABELS)}
                  emptyText='暂无操作系统数据'
                />
              </AdminPanel>

              <AdminPanel
                title='国家 / 地区'
                description='只读部署平台注入的国家头（两位代码）'
                footnote='不记录 IP、不反查 IP；平台未注入该头时全部显示「未采集」。'>
                <AdminBarList
                  total={data.summary?.pv}
                  color='#22c55e'
                  rows={withLabels(data.summary?.dims?.geo, { unknown: '未采集' })}
                  emptyText='未采集到地理信息'
                />
              </AdminPanel>
            </div>

            <AdminPanel
              title='访客结构明细'
              description='首次 / 回访与 UV、PV 的对照'
              footnote='PV 与 UV 的口径不同，不能相除当作「人均阅读时长」。'>
              <AdminDataTable
                dense
                columns={[
                  { key: 'label', label: '指标' },
                  { key: 'value', label: '数值', align: 'right' },
                  { key: 'note', label: '说明' }
                ]}
                rows={[
                  { id: 'uv', label: 'UV（去重访客）', value: data.summary?.uv, note: 'HLL 估算' },
                  {
                    id: 'new',
                    label: '首次访客 PV',
                    value: visitors.newVisitors,
                    note: '匿名 ID 首次出现时的浏览'
                  },
                  {
                    id: 'returning',
                    label: '回访访客 PV',
                    value: visitors.returningVisitors,
                    note: '同一匿名 ID 再次访问的浏览'
                  },
                  {
                    id: 'sessions',
                    label: 'Session',
                    value: data.summary?.sessions,
                    note: '30 分钟静默即新会话'
                  },
                  {
                    id: 'pv',
                    label: 'PV',
                    value: data.summary?.pv,
                    note: '页面浏览总数'
                  },
                  {
                    id: 'share',
                    label: '回访 PV 占比',
                    value: returningShare === null ? '—' : formatPercent(returningShare * 100, 1),
                    note: '回访 PV ÷ 全部 PV'
                  }
                ]}
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
  const guard = await adminPageGuard(ctx, { next: '/admin/visitors' })
  if (guard.redirect) return guard
  return guard
}
