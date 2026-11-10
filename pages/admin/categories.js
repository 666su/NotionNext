/**
 * /admin/categories —— 分类与标签（Phase 4）
 *
 * 数据：GET /api/admin/taxonomy（Notion 快照 + 自建统计）
 * 边界：只读；分类/标签的名称与归属来自 Notion，后台不提供重命名入口（避免与 Notion 双向同步）。
 */

import AdminBarList from '@/components/admin/AdminBarList'
import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminDataTable from '@/components/admin/AdminDataTable'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminNotice from '@/components/admin/AdminNotice'
import AdminPanel from '@/components/admin/AdminPanel'
import AdminRangeTabs from '@/components/admin/AdminRangeTabs'
import AdminStatCards from '@/components/admin/AdminStatCards'
import { formatDateTime, formatNumber, formatPercent } from '@/components/admin/format'
import { useAdminJson, useRangeParam } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

export default function CategoriesPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <CategoriesContent admin={props.admin} />
}

function CategoriesContent({ admin }) {
  const [range, setRange] = useRangeParam('30d')
  const { data, loading, error, reload } = useAdminJson(`/api/admin/taxonomy?range=${range}`)

  const totals = data?.totals || {}
  const categories = data?.categories || []
  const tags = data?.tags || []

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
      active='categories'
      title='分类与标签'
      description='来自 Notion 只读快照，叠加所选时间窗的阅读量'
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

        {!data && !error && <AdminNotice tone='info'>正在读取分类与标签…</AdminNotice>}

        {data && (
          <>
            <AdminStatCards
              items={[
                {
                  key: 'articles',
                  label: '文章总数',
                  value: totals.articles,
                  hint: data.syncedAt ? `同步于 ${formatDateTime(data.syncedAt)}` : '尚未同步'
                },
                { key: 'categories', label: '分类数', value: totals.categories, hint: '不含"未分类"' },
                { key: 'tags', label: '标签数', value: totals.tags, hint: '同名标签不去重合并' },
                {
                  key: 'uncategorized',
                  label: '未分类文章',
                  value: totals.uncategorized,
                  hint: 'Notion 里没有填分类的文章',
                  tone: totals.uncategorized > 0 ? 'warn' : undefined
                }
              ]}
            />

            {!data.syncedAt && (
              <AdminNotice tone='warn' title='尚未执行 Notion 同步'>
                分类与标签来自 Notion 快照。请先到「文章管理」页点一次「立即同步」（只读）。
              </AdminNotice>
            )}

            <AdminPanel
              title='分类分布'
              description={`${categories.length} 个分类 · 按文章数排序`}
              footnote='一篇多分类的文章会分别计入各分类，因此"文章数列之和"可能大于文章总数。PV 走 article_id 与路径双口径。'>
              <AdminDataTable
                dense
                maxRows={30}
                emptyText='暂无分类数据'
                columns={[
                  { key: 'name', label: '分类' },
                  { key: 'articles', label: '文章数', align: 'right' },
                  {
                    key: 'share',
                    label: '占比',
                    align: 'right',
                    format: value => (value === null || value === undefined ? '—' : formatPercent(value, 1))
                  },
                  { key: 'pv', label: 'PV', align: 'right' }
                ]}
                rows={categories}
              />
            </AdminPanel>

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='分类阅读量'
                description='按 PV 排序'
                footnote='PV 是该分类下所有文章阅读量之和（同一篇文章只算一次）。'>
                <AdminBarList
                  limit={12}
                  color='#0ea5e9'
                  rows={[...categories]
                    .filter(row => row.pv > 0)
                    .sort((a, b) => b.pv - a.pv)
                    .map(row => ({ label: row.name, value: row.pv, note: `${row.articles} 篇` }))}
                  emptyText='该时间窗内没有分类阅读数据'
                />
              </AdminPanel>

              <AdminPanel
                title='标签 Top 20'
                description='按文章数排序'
                footnote='标签来自 Notion multi_select；同义标签（如中英文混写）不会被自动合并。'>
                <ul className='flex flex-wrap gap-1.5'>
                  {tags.length === 0 && (
                    <li className='text-xs text-gray-400 dark:text-gray-500'>暂无标签数据</li>
                  )}
                  {tags.slice(0, 20).map(tag => (
                    <li
                      key={tag.name}
                      className='rounded border border-gray-200 px-1.5 py-0.5 text-[11px] text-gray-600 dark:border-gray-700 dark:text-gray-300'>
                      {tag.name}
                      <span className='ml-1 text-gray-400 dark:text-gray-500'>
                        {tag.articles} 篇 / {formatNumber(tag.pv)} PV
                      </span>
                    </li>
                  ))}
                </ul>
              </AdminPanel>
            </div>

            <AdminPanel
              title='全部标签'
              description={`${tags.length} 个标签 · 按文章数排序（最多 50 个）`}
              footnote='如果某个标签文章数很多但 PV 很低，通常说明它只是"归档标签"，不是内容主线。'>
              <AdminDataTable
                dense
                maxRows={50}
                emptyText='暂无标签数据'
                columns={[
                  { key: 'name', label: '标签' },
                  { key: 'articles', label: '文章数', align: 'right' },
                  { key: 'pv', label: 'PV', align: 'right' }
                ]}
                rows={tags}
              />
            </AdminPanel>

            <p className='text-[11px] text-gray-400 dark:text-gray-500'>
              分类与标签只在同步时更新，后台<strong>不回写 Notion</strong>。
              {data.latestPublishedAt
                ? ` 最近一篇文章发布于 ${formatDateTime(new Date(data.latestPublishedAt).toISOString())}。`
                : ''}
            </p>
          </>
        )}
      </div>
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/categories' })
  if (guard.redirect) return guard
  return guard
}
