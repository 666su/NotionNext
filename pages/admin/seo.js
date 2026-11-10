/**
 * /admin/seo —— SEO 分析（Phase 5）
 *
 * 本页刻意分成两半：
 *   - **能自证的**：标题长度、摘要缺失、分类/标签、更新时间、robots/sitemap 可访问性 → 真实计算
 *   - **不能自证的**：曝光量 / 点击量 / CTR / 平均排名 → 只可能来自 Search Console，未连接就显示"未连接"
 * 绝不用站内 PV 冒充搜索点击，也不显示任何推测数字。
 */

import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminDataTable from '@/components/admin/AdminDataTable'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminNotice from '@/components/admin/AdminNotice'
import AdminPanel from '@/components/admin/AdminPanel'
import AdminStatCards from '@/components/admin/AdminStatCards'
import { formatDateTime, fromNow } from '@/components/admin/format'
import { useAdminJson } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

export default function SeoPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <SeoContent admin={props.admin} />
}

function SeoContent({ admin }) {
  const { data, loading, error, reload } = useAdminJson('/api/admin/seo')

  const audit = data?.audit || {}
  const summary = audit.summary || {}
  const issues = (audit.rows || []).filter(row => (row.issues || []).length > 0)
  const files = data?.files?.rows || []
  const gsc = data?.gsc || {}

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
      active='seo'
      title='SEO 分析'
      description='本地可自证的自查 + Search Console 的"未连接"状态'
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

        {!data && !error && <AdminNotice tone='info'>正在检查…</AdminNotice>}

        {data && (
          <>
            <AdminNotice tone='warn' title='Search Console：未连接'>
              {gsc.note}
              <br />
              需要以下只读凭证（当前未配置）：
              <span className='ml-1 font-mono text-[11px]'>{(gsc.requiredEnv || []).join('、')}</span>
              <br />
              <strong>本页不会展示曝光量、点击量、CTR 或排名</strong>，也不拿站内 PV 冒充搜索点击。
            </AdminNotice>

            <AdminStatCards
              items={[
                {
                  key: 'total',
                  label: '文章总数（快照）',
                  value: summary.total,
                  hint: data.syncedAt ? `同步于 ${fromNow(data.syncedAt)}` : '尚未同步 Notion'
                },
                {
                  key: 'withIssues',
                  label: '存在建议项的文章',
                  value: summary.withIssues,
                  hint: '下面明细逐条列出'
                },
                {
                  key: 'missingDescription',
                  label: '缺摘要',
                  value: summary.missingDescription,
                  hint: '搜索结果描述会退化为自动截取'
                },
                {
                  key: 'missingSlug',
                  label: '缺 slug',
                  value: summary.missingSlug,
                  hint: 'slug 决定文章 URL，缺失会影响收录'
                }
              ]}
            />

            {!data.syncedAt && (
              <AdminNotice tone='warn' title='尚未同步 Notion 快照'>
                自查需要文章标题与摘要，请到「文章管理」页执行一次只读同步。
              </AdminNotice>
            )}

            <div className='grid gap-4 lg:grid-cols-2'>
              <AdminPanel
                title='robots.txt / sitemap.xml'
                description='同源可访问性探测'
                footnote='只读 GET，缓存 10 分钟；404 通常意味着搜索引擎找不到站点地图。'>
                <AdminDataTable
                  dense
                  emptyText='未探测到（缺少站点地址）'
                  columns={[
                    { key: 'path', label: '文件', mono: true },
                    {
                      key: 'status',
                      label: '状态',
                      align: 'right',
                      format: value => (value === 0 ? '请求失败' : String(value))
                    },
                    { key: 'ms', label: '耗时(ms)', align: 'right' }
                  ]}
                  rows={files}
                />
              </AdminPanel>

              <AdminPanel
                title='结构健康度'
                description='分类 / 标签 / 更新新鲜度'
                footnote='这些都是"内容结构"层面的建议，不等于排名因素权重。'>
                <AdminDataTable
                  dense
                  columns={[
                    { key: 'label', label: '项' },
                    { key: 'value', label: '数量', align: 'right' }
                  ]}
                  rows={[
                    { id: 'noCat', label: '未分类文章', value: summary.missingCategory },
                    { id: 'noTag', label: '无标签文章', value: summary.noTags },
                    { id: 'short', label: '标题偏短', value: summary.shortTitle },
                    { id: 'long', label: '标题偏长（>60 字符）', value: summary.longTitle },
                    { id: 'stale', label: '超过 365 天未更新', value: summary.stale }
                  ]}
                />
              </AdminPanel>
            </div>

            <AdminPanel
              title='逐篇自查明细'
              description={`${issues.length} 篇文章有建议项`}
              footnote='标题长度按字符计（中文按 1 个字符）；摘要来自 Notion 的 summary 字段。'>
              <AdminDataTable
                dense
                maxRows={50}
                emptyText={data.syncedAt ? '没有发现问题，保持即可' : '尚未同步快照'}
                columns={[
                  { key: 'title', label: '文章' },
                  { key: 'titleLength', label: '标题长度', align: 'right' },
                  {
                    key: 'updatedDays',
                    label: '更新于',
                    align: 'right',
                    format: value => (value === null || value === undefined ? '—' : `${value} 天前`)
                  },
                  {
                    key: 'issues',
                    label: '建议',
                    format: value => (Array.isArray(value) ? value.join('；') : '—')
                  }
                ]}
                rows={issues}
              />
            </AdminPanel>

            <AdminPanel
              title='AI 预留'
              description={data.ai?.note}
              footnote='预留位：未接入模型、未生成任何内容，也不会把文章正文发送到第三方。'>
              <div className='flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-300'>
                <span className='rounded border border-gray-300 px-2 py-0.5 dark:border-gray-700'>
                  状态：未启用（{data.ai?.reason || 'not_configured'}）
                </span>
                <span className='text-gray-400 dark:text-gray-500'>
                  启用后计划提供：摘要补全建议、标签建议、标题长度提醒。
                </span>
              </div>
            </AdminPanel>

            <AdminPanel title='口径与边界' description='为什么这里有「未连接」'>
              <ul className='space-y-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300'>
                {(data.notes || []).map(item => (
                  <li key={item}>· {item}</li>
                ))}
                <li>· 站内 PV 是「页面浏览」，与 Google 搜索点击是两套口径，不能相加、不能互相替代。</li>
                <li>· 检查频率：robots/sitemap 与链接检查均缓存 10 分钟，后台刷新不会造成额外负载。</li>
              </ul>
            </AdminPanel>

            <p className='text-[11px] text-gray-400 dark:text-gray-500'>
              检查时间：{formatDateTime(data.generatedAt)}
              {data.files?.cached ? ' · 文件探测来自缓存' : ''}
            </p>
          </>
        )}
      </div>
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/seo' })
  if (guard.redirect) return guard
  return guard
}
