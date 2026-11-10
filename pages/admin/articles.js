/**
 * /admin/articles —— 文章管理（Phase 3：阅读数据；Phase 4：Notion 只读同步）
 *
 * 每篇文章把「Notion 快照」与「统计事件」按 article_id / 路径 两条口径合并展示。
 */

import { useMemo, useState } from 'react'
import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminNotice from '@/components/admin/AdminNotice'
import AdminPanel from '@/components/admin/AdminPanel'
import AdminRangeTabs from '@/components/admin/AdminRangeTabs'
import AdminStatCards from '@/components/admin/AdminStatCards'
import AdminSyncPanel from '@/components/admin/AdminSyncPanel'
import { formatDateTime, formatNumber, formatPercent, fromNow } from '@/components/admin/format'
import { useAdminReport, useRangeParam } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

const SORTS = [
  { key: 'pv', label: '按 PV' },
  { key: 'completeRate', label: '按完成率' },
  { key: 'title', label: '按标题' }
]

export default function ArticlesPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <ArticlesContent admin={props.admin} />
}

function ArticlesContent({ admin }) {
  const [range, setRange] = useRangeParam('30d')
  const [sort, setSort] = useState('pv')
  const [keyword, setKeyword] = useState('')
  const { data, loading, error, reload } = useAdminReport(range)

  const rows = useMemo(() => data?.articles?.rows || [], [data])
  const withTraffic = rows.filter(row => row.pv > 0)
  const totalPv = rows.reduce((acc, row) => acc + Number(row.pv || 0), 0)
  const pathOnly = rows.filter(row => row.pathMatched).length

  const visible = useMemo(() => {
    const filtered = keyword
      ? rows.filter(row =>
          `${row.title} ${row.slug} ${row.category}`.toLowerCase().includes(keyword.toLowerCase())
        )
      : rows
    const sorted = [...filtered]
    if (sort === 'title') {
      sorted.sort((a, b) => String(a.title).localeCompare(String(b.title), 'zh-CN'))
    } else if (sort === 'completeRate') {
      sorted.sort((a, b) => Number(b.completeRate || -1) - Number(a.completeRate || -1))
    } else {
      sorted.sort((a, b) => Number(b.pv || 0) - Number(a.pv || 0))
    }
    return sorted
  }, [rows, sort, keyword])

  const actions = (
    <div className='flex flex-wrap items-center gap-2'>
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
      active='articles'
      title='文章管理'
      description='文章阅读数据 · Notion 只读快照（不会回写 Notion）'
      actions={actions}>
      <div className='space-y-5'>
        <AdminSyncPanel onSynced={() => void reload()} />

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
                  key: 'count',
                  label: '文章总数（Notion）',
                  value: data.articles?.count || null,
                  hint: data.articles?.syncedAt
                    ? `同步于 ${formatDateTime(data.articles.syncedAt)}`
                    : '尚未同步 Notion'
                },
                {
                  key: 'withTraffic',
                  label: '有访问的文章',
                  value: withTraffic.length,
                  hint: '所选时间窗内至少 1 次 PV'
                },
                {
                  key: 'pv',
                  label: '文章 PV 合计',
                  value: totalPv,
                  hint: '各文章 PV 求和（含未同步标题的条目）'
                },
                {
                  key: 'categories',
                  label: '分类 / 标签',
                  value: data.articles?.categories?.length || null,
                  hint: `标签 ${formatNumber(data.articles?.tags?.length || 0)} 个`
                }
              ]}
            />

            {!data.articles?.syncedAt && (
              <AdminNotice tone='warn' title='尚未执行 Notion 同步'>
                文章标题、分类、标签需要从 Notion 只读同步一次才能显示。当前列表里的标题取自文章 ID，
                点上方「立即同步」即可（只读，不会修改 Notion 内容）。
              </AdminNotice>
            )}

            {(data.articles?.unmappedPathViews || 0) > 0 && (
              <AdminNotice tone='warn' title='有文章路径无法归属'>
                {formatNumber(data.articles.unmappedPathViews)} 次浏览落在 /article/ 下但未匹配到任何文章快照，
                通常是因为文章已被删除或从未同步。这些浏览计入全站 PV，但不进入文章排行。
              </AdminNotice>
            )}

            {pathOnly > 0 && (
              <AdminNotice tone='info'>
                有 {pathOnly} 篇文章的阅读量来自「路径口径」（页面未上报 article_id，按
                /article/&lt;slug&gt; 反查）。这类文章无法给出 UV 与深度，显示为「—」。
              </AdminNotice>
            )}

            <AdminPanel
              title='文章阅读排行'
              description={`${rows.length} 条记录 · ${sort === 'pv' ? '按 PV 排序' : sort === 'completeRate' ? '按完成率排序' : '按标题排序'}`}
              footnote='PV 取「article_id 口径」与「路径口径」的较大值；UV 为 null 表示该文章没有 article_id 事件，口径上无法去重。'
              actions={
                <div className='flex items-center gap-2'>
                  <input
                    value={keyword}
                    onChange={event => setKeyword(event.target.value)}
                    placeholder='筛选标题 / slug / 分类'
                    className='w-40 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-[#0b0d10]'
                  />
                  <select
                    value={sort}
                    onChange={event => setSort(event.target.value)}
                    className='rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-[#0b0d10]'>
                    {SORTS.map(option => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              }>
              {visible.length === 0 ? (
                <p className='text-xs text-gray-400 dark:text-gray-500'>
                  {rows.length === 0 ? '暂无文章数据' : '没有匹配的文章'}
                </p>
              ) : (
                <div className='overflow-x-auto'>
                  <table className='w-full text-left text-xs'>
                    <thead>
                      <tr className='text-gray-400 dark:text-gray-500'>
                        <th className='border-b border-gray-100 pb-1.5 pr-3 font-normal dark:border-gray-800'>
                          文章
                        </th>
                        <th className='whitespace-nowrap border-b border-gray-100 pb-1.5 pr-3 font-normal dark:border-gray-800'>
                          分类
                        </th>
                        <th className='border-b border-gray-100 pb-1.5 pr-3 text-right font-normal dark:border-gray-800'>
                          PV
                        </th>
                        <th className='border-b border-gray-100 pb-1.5 pr-3 text-right font-normal dark:border-gray-800'>
                          UV
                        </th>
                        <th className='border-b border-gray-100 pb-1.5 pr-3 text-right font-normal dark:border-gray-800'>
                          平均深度
                        </th>
                        <th className='border-b border-gray-100 pb-1.5 text-right font-normal dark:border-gray-800'>
                          完成率
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map(row => (
                        <tr
                          key={row.id}
                          className='border-b border-gray-50 last:border-0 dark:border-gray-800/60'>
                          <td className='max-w-[22rem] py-1.5 pr-3'>
                            {row.url ? (
                              <a
                                href={row.url}
                                target='_blank'
                                rel='noreferrer'
                                className='block truncate hover:underline'
                                title={row.title}>
                                {row.title}
                              </a>
                            ) : (
                              <span className='block truncate' title={row.title}>
                                {row.title}
                              </span>
                            )}
                            {row.slug && (
                              <span className='block truncate font-mono text-[10px] text-gray-400 dark:text-gray-500'>
                                /article/{row.slug}
                              </span>
                            )}
                          </td>
                          <td className='whitespace-nowrap py-1.5 pr-3 text-gray-600 dark:text-gray-300'>
                            {row.category || '—'}
                          </td>
                          <td className='py-1.5 pr-3 text-right tabular-nums'>
                            {formatNumber(row.pv)}
                          </td>
                          <td className='py-1.5 pr-3 text-right tabular-nums'>
                            {row.uv === null || row.uv === undefined ? '—' : formatNumber(row.uv)}
                          </td>
                          <td className='py-1.5 pr-3 text-right tabular-nums'>
                            {row.avgDepth === null || row.avgDepth === undefined
                              ? '—'
                              : `${Math.round(row.avgDepth)}%`}
                          </td>
                          <td className='py-1.5 text-right tabular-nums'>
                            {row.completeRate === null || row.completeRate === undefined
                              ? '—'
                              : formatPercent(row.completeRate, 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </AdminPanel>

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='分类分布（Notion 快照）'
                description='按文章数排序'
                footnote='分类来自 Notion 的 multi_select 字段；改名后需重新同步。'>
                <ul className='space-y-1 text-xs text-gray-600 dark:text-gray-300'>
                  {(data.articles?.categories || []).length === 0 && (
                    <li className='text-gray-400 dark:text-gray-500'>尚未同步</li>
                  )}
                  {(data.articles?.categories || []).slice(0, 20).map(item => (
                    <li key={item.name} className='flex items-center justify-between gap-3'>
                      <span className='truncate'>{item.name || '未分类'}</span>
                      <span className='shrink-0 tabular-nums text-gray-400'>{item.count}</span>
                    </li>
                  ))}
                </ul>
              </AdminPanel>

              <AdminPanel
                title='标签分布（Notion 快照）'
                description='Top 20'
                footnote='标签只统计出现次数，不做同义合并。'>
                <ul className='flex flex-wrap gap-1.5'>
                  {(data.articles?.tags || []).slice(0, 20).map(item => (
                    <li
                      key={item.name}
                      className='rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 dark:border-gray-700 dark:text-gray-300'>
                      {item.name} · {item.count}
                    </li>
                  ))}
                  {(data.articles?.tags || []).length === 0 && (
                    <li className='text-xs text-gray-400 dark:text-gray-500'>尚未同步</li>
                  )}
                </ul>
              </AdminPanel>
            </div>

            <p className='text-[11px] text-gray-400 dark:text-gray-500'>
              数据生成时间：{formatDateTime(data.generatedAt)}
              {data.articles?.syncedAt
                ? ` · 文章快照 ${fromNow(data.articles.syncedAt)}同步`
                : ''}
            </p>
          </>
        )}
      </div>
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/articles' })
  if (guard.redirect) return guard
  return guard
}
