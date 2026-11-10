/**
 * /admin/comments —— 评论统计（Phase 4）
 *
 * 只调用 Twikoo 的公开计数事件（GET_COMMENTS_COUNT），**不使用管理员密钥**。
 * 因此：能拿到每篇评论数；拿不到待审核/垃圾评论、审核队列、每日评论趋势。
 * 这些边界必须写在页面上，避免把"能看到的数字"误当成"全部真相"。
 */

import AdminBarList from '@/components/admin/AdminBarList'
import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminDataTable from '@/components/admin/AdminDataTable'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminNotice from '@/components/admin/AdminNotice'
import AdminPanel from '@/components/admin/AdminPanel'
import AdminStatCards from '@/components/admin/AdminStatCards'
import { formatNumber } from '@/components/admin/format'
import { useAdminJson } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

const REASON_TEXT = {
  not_configured: '未配置 Twikoo 环境（COMMENT_TWIKOO_ENV_ID），因此无法查询评论数。',
  http_401: 'Twikoo 拒绝了公开计数请求（401）。',
  http_403: 'Twikoo 拒绝了公开计数请求（403）。',
  http_429: 'Twikoo 限流（429），请稍后再试。',
  request_failed: '请求 Twikoo 失败（网络或超时）。'
}

export default function CommentsPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <CommentsContent admin={props.admin} />
}

function CommentsContent({ admin }) {
  const { data, loading, error, reload } = useAdminJson('/api/admin/comments')

  const rows = data?.rows || []
  const totals = data?.totals || {}
  const available = data?.available !== false
  const top = rows[0]
  const average = rows.length ? totals.comments / rows.length : null

  const actions = (
    <button
      type='button'
      onClick={() => void reload()}
      disabled={loading}
      className='rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'>
      {loading ? '刷新中…' : '刷新'}
    </button>
  )

  return (
    <AdminModulePage
      admin={admin}
      active='comments'
      title='评论统计'
      description='Twikoo 公开计数接口（只读，不使用管理员密钥）'
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

        {!data && !error && <AdminNotice tone='info'>正在查询评论数…</AdminNotice>}

        {data && !available && (
          <AdminNotice tone='warn' title='评论数据未连接'>
            {REASON_TEXT[data.reason] || '无法获取评论数。'}
            <br />
            这是一个<strong>边界</strong>而不是故障：后台刻意只使用 Twikoo 的公开计数接口，
            因此看不到待审核、垃圾评论与审核队列。若要管理评论，请去 Twikoo 自带的管理面板。
          </AdminNotice>
        )}

        {data && available && (
          <>
            <AdminStatCards
              items={[
                {
                  key: 'comments',
                  label: '可查询范围内的评论数',
                  value: totals.comments,
                  hint: '最近 100 篇文章的合计'
                },
                {
                  key: 'articles',
                  label: '有评论的文章',
                  value: totals.articlesWithComments,
                  hint: '评论数 > 0 的文章数量'
                },
                {
                  key: 'top',
                  label: '最多评论的文章',
                  value: top ? top.comments : null,
                  hint: top ? top.title : '暂无'
                },
                {
                  key: 'average',
                  label: '有评论文章的平均评论数',
                  value: average === null ? null : Number(average.toFixed(1)),
                  hint: '只在"有评论"的文章间平均'
                }
              ]}
            />

            <AdminPanel
              title='评论数排行'
              description='按评论数降序（只列出有评论的文章）'
              footnote='数据来自 Twikoo 的 GET_COMMENTS_COUNT（公开接口）；文章列表取自 Notion 快照，因此没同步过的文章不会出现。'>
              <AdminDataTable
                dense
                maxRows={50}
                emptyText='暂无带评论的文章'
                columns={[
                  {
                    key: 'title',
                    label: '文章',
                    format: (value, row) => (row.path ? `${value}` : value)
                  },
                  { key: 'category', label: '分类' },
                  { key: 'comments', label: '评论数', align: 'right' }
                ]}
                rows={rows}
              />
            </AdminPanel>

            <AdminPanel
              title='评论分布'
              description='Top 10'
              footnote='评论集中在少数几篇是正常现象：老文章与争议话题更容易积累评论。'>
              <AdminBarList
                limit={10}
                color='#ec4899'
                rows={rows.map(row => ({ label: row.title, value: row.comments }))}
                emptyText='暂无评论'
              />
            </AdminPanel>
          </>
        )}

        <AdminPanel title='这个模块能回答什么、不能回答什么' description='口径边界'>
          <div className='grid gap-4 text-xs sm:grid-cols-2'>
            <div>
              <p className='font-medium text-gray-700 dark:text-gray-200'>能回答</p>
              <ul className='mt-1 space-y-1 text-gray-600 dark:text-gray-300'>
                <li>· 每篇文章有多少条评论</li>
                <li>· 哪些文章评论最多</li>
                <li>· 有多少文章还没有评论</li>
              </ul>
            </div>
            <div>
              <p className='font-medium text-gray-700 dark:text-gray-200'>不能回答（刻意保留的边界）</p>
              <ul className='mt-1 space-y-1 text-gray-600 dark:text-gray-300'>
                <li>· 待审核 / 垃圾评论数量（需要管理员密钥，后台不使用）</li>
                <li>· 每天新增多少评论（需要自建快照，当前未做）</li>
                <li>· 评论内容本身（后台不读取正文）</li>
              </ul>
            </div>
          </div>
          <p className='mt-3 text-[11px] text-gray-400 dark:text-gray-500'>
            当前只查询最近 100 篇文章（Twikoo 单次存在请求数量限制），因此"评论总数"是
            <strong>可查询范围内的合计</strong>，不是全站历史总量。
            合计值：{formatNumber(totals.comments || 0)} 条。
          </p>
        </AdminPanel>
      </div>
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/comments' })
  if (guard.redirect) return guard
  return guard
}
