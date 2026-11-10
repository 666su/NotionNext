/**
 * /admin/health —— 网站健康（Phase 5）
 *
 * 三层信息：
 *   1) 后台自身依赖（会话/统计存储、配置、部署环境）
 *   2) 站点探针（同源首页 / 归档页的真实 HTTP 状态与耗时，低频 + 3 分钟缓存）
 *   3) 失效链接检查（同源、最多 20 条、10 分钟缓存，手动触发）
 *
 * 纪律：探测失败就显示失败，不显示"正常"；缓存命中要明确标注。
 */

import { useState } from 'react'
import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminDataTable from '@/components/admin/AdminDataTable'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminNotice from '@/components/admin/AdminNotice'
import AdminPanel from '@/components/admin/AdminPanel'
import AdminStatCards from '@/components/admin/AdminStatCards'
import { formatDateTime, fromNow } from '@/components/admin/format'
import { useAdminJson } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

export default function HealthPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <HealthContent admin={props.admin} />
}

function HealthContent({ admin }) {
  const { data, loading, error, reload } = useAdminJson('/api/admin/health/site')
  const [linksUrl, setLinksUrl] = useState('')
  const links = useAdminJson(linksUrl, { enabled: !!linksUrl })

  const probes = data?.probes || []
  const notion = data?.notion || {}

  const actions = (
    <button
      type='button'
      onClick={() => void reload()}
      disabled={loading}
      className='rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'>
      {loading ? '检查中…' : '重新检查'}
    </button>
  )

  return (
    <AdminModulePage
      admin={admin}
      active='health'
      title='网站健康'
      description='后台依赖、站点探针与失效链接（低频、同源、只读）'
      actions={actions}>
      <div className='space-y-5'>
        {error && (
          <AdminNotice
            tone='error'
            title='健康检查失败'
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

        {!data && !error && <AdminNotice tone='info'>正在探测…</AdminNotice>}

        {data && (
          <>
            <AdminStatCards
              items={[
                {
                  key: 'store',
                  label: '会话 / 统计存储',
                  display: data.store?.reachable ? '正常' : '不可达',
                  tone: data.store?.reachable ? 'default' : 'warn',
                  hint: `${data.store?.backend || '—'} · ${data.store?.reachable ? '可达' : '后台按 fail-closed 拒绝登录'}`
                },
                {
                  key: 'admin',
                  label: '后台配置',
                  display: data.admin?.ready ? '已就绪' : '未完成',
                  tone: data.admin?.ready ? 'default' : 'warn',
                  hint: data.admin?.ready ? '环境变量齐全' : `缺少：${(data.admin?.missing || []).join('、') || '未知'}`
                },
                {
                  key: 'notion',
                  label: 'Notion 同步',
                  display: notion.lastSyncAt ? '已同步' : '未同步',
                  tone: notion.lastSyncAt ? 'default' : 'warn',
                  hint: notion.lastSyncAt ? `上次 ${fromNow(notion.lastSyncAt)}` : '尚未同步'
                },
                {
                  key: 'twikoo',
                  label: 'Twikoo',
                  display: data.twikoo?.configured ? '已配置' : '未配置',
                  tone: data.twikoo?.configured ? 'default' : 'warn',
                  hint: data.twikoo?.configured ? '可查询公开评论计数' : '评论页会显示「未连接」'
                }
              ]}
            />

            {data.cached && (
              <AdminNotice tone='info'>
                本次结果来自缓存（3 分钟有效），检查时间：{formatDateTime(data.checkedAt)}。
              </AdminNotice>
            )}

            <AdminPanel
              title='站点探针'
              description={`同源 GET 探测 · ${data.origin || '—'}`}
              footnote='只探测本站首页与归档页，不扫描第三方站点；重定向（3xx）视为可访问。'>
              <AdminDataTable
                dense
                emptyText='没有探针结果'
                columns={[
                  { key: 'url', label: 'URL', mono: true },
                  {
                    key: 'status',
                    label: '状态码',
                    align: 'right',
                    format: (value, row) =>
                      value === 0 ? '请求失败' : `${value}${row.ok ? '' : '（异常）'}`
                  },
                  { key: 'ms', label: '耗时(ms)', align: 'right' },
                  {
                    key: 'error',
                    label: '错误',
                    format: value => value || '—'
                  }
                ]}
                rows={probes}
              />
            </AdminPanel>

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='数据链路'
                description='统计采集与 Notion 同步的实际状态'
                footnote='采集起始时间是第一次成功写入 /api/track 的时刻；此前没有数据来源。'>
                <AdminDataTable
                  dense
                  columns={[
                    { key: 'label', label: '项' },
                    { key: 'value', label: '状态' }
                  ]}
                  rows={[
                    {
                      id: 'collect',
                      label: '统计采集起始',
                      value: data.stats?.collectionStartedAt
                        ? formatDateTime(data.stats.collectionStartedAt)
                        : '尚未采集到任何事件'
                    },
                    {
                      id: 'syncOk',
                      label: '最近成功同步',
                      value: notion.lastSyncAt ? formatDateTime(notion.lastSyncAt) : '—'
                    },
                    {
                      id: 'syncCounts',
                      label: '上次同步规模',
                      value: notion.lastSyncCounts
                        ? `文章 ${notion.lastSyncCounts.articles ?? '—'} / 分类 ${notion.lastSyncCounts.categories ?? '—'} / 标签 ${notion.lastSyncCounts.tags ?? '—'}`
                        : '—'
                    }
                  ]}
                />
                {notion.lastError && (
                  <div className='mt-3'>
                    <AdminNotice tone='warn' title={`最近一次同步失败：${formatDateTime(notion.lastErrorAt)}`}>
                      <span className='font-mono text-[11px]'>{notion.lastError}</span>
                    </AdminNotice>
                  </div>
                )}
              </AdminPanel>

              <AdminPanel
                title='部署环境'
                description='只读取平台注入的环境标识，不含任何密钥'
                footnote='本地开发时这些值多为 unknown，属正常。'>
                <AdminDataTable
                  dense
                  columns={[
                    { key: 'label', label: '项' },
                    { key: 'value', label: '值' }
                  ]}
                  rows={[
                    { id: 'env', label: '运行环境', value: data.deployment?.env || 'unknown' },
                    { id: 'region', label: '区域', value: data.deployment?.region || '—' },
                    { id: 'commit', label: '提交', value: data.deployment?.commit || '—' },
                    { id: 'url', label: '部署域名', value: data.deployment?.url || '—' }
                  ]}
                />
                {(data.admin?.warnings || []).length > 0 && (
                  <div className='mt-3'>
                    <AdminNotice tone='warn' title='配置提醒'>
                      <ul className='mt-1 space-y-0.5'>
                        {(data.admin.warnings || []).map(item => (
                          <li key={item}>· {item}</li>
                        ))}
                      </ul>
                    </AdminNotice>
                  </div>
                )}
              </AdminPanel>
            </div>

            <AdminPanel
              title='失效链接检查'
              description='首页、归档页与快照内文章 URL（同源、最多 20 条）'
              footnote='只读 GET，不提交表单；结果缓存 10 分钟，避免频繁探测源站。'
              actions={
                <button
                  type='button'
                  onClick={() => setLinksUrl(`/api/admin/health/links?limit=10`)}
                  disabled={links.loading}
                  className='rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'>
                  {links.loading ? '检查中…' : '检查 10 条'}
                </button>
              }>
              {links.error && (
                <AdminNotice tone='error' title='检查失败'>
                  {links.error}
                </AdminNotice>
              )}
              {!linksUrl && !links.error && (
                <p className='text-xs text-gray-400 dark:text-gray-500'>
                  点右上角「检查 10 条」开始。检查是手动的：不给每个访客或每次刷新增加额外请求。
                </p>
              )}
              {links.data && (
                <>
                  <p className='mb-2 text-[11px] text-gray-500 dark:text-gray-400'>
                    共 {links.data.targets} 条 · 正常 {links.data.summary?.ok} · 失效{' '}
                    {links.data.summary?.broken} · 请求失败 {links.data.summary?.errors} · 重定向{' '}
                    {links.data.summary?.redirects}
                    {links.data.cached ? ' · 来自缓存' : ''}
                  </p>
                  <AdminDataTable
                    dense
                    emptyText='没有可检查的链接'
                    columns={[
                      { key: 'path', label: '路径', mono: true },
                      {
                        key: 'status',
                        label: '状态',
                        align: 'right',
                        format: (value, row) => (value === 0 ? '请求失败' : String(value))
                      },
                      { key: 'ms', label: '耗时(ms)', align: 'right' }
                    ]}
                    rows={links.data.rows || []}
                  />
                </>
              )}
            </AdminPanel>
          </>
        )}
      </div>
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/health' })
  if (guard.redirect) return guard
  return guard
}
