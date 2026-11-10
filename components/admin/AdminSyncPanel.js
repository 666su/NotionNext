/**
 * Notion 只读同步面板（Phase 4）
 *
 * 边界（硬性）：
 * - **只读**：只调用 Notion 的查询接口，不创建/修改/删除任何内容，也不写回 Notion；
 * - 手动触发 + 服务端冷却（5 分钟内一次），避免把 Notion 打热；
 * - 失败必须可见：显示错误原因与最近一次失败时间，不静默重试。
 */

import { useState } from 'react'
import Link from 'next/link'
import AdminNotice from './AdminNotice'
import { adminFetch } from '@/lib/admin/client'
import { formatDateTime, fromNow } from './format'
import { useAdminJson } from './useAdminReport'

export default function AdminSyncPanel({ onSynced }) {
  const { data, loading, error, reload } = useAdminJson('/api/admin/sync/status')
  const [syncing, setSyncing] = useState(false)
  const [result, setResult] = useState(null)

  const meta = data?.meta || null
  const lastOk = (data?.log || []).find(item => item?.status === 'ok') || null
  const lastError = (data?.log || []).find(item => item?.status === 'error') || null
  const cooldown = Number(data?.cooldown || 0)

  async function handleSync() {
    setSyncing(true)
    setResult(null)
    try {
      const response = await adminFetch('/api/admin/sync/notion', { method: 'POST', body: {} })
      if (response.ok) {
        setResult({ ok: true, counts: response.data?.counts })
        await reload()
        onSynced?.()
      } else if (response.status === 429) {
        setResult({ ok: false, message: `同步太频繁，请 ${response.data?.retryAfter || cooldown} 秒后再试。` })
      } else {
        setResult({
          ok: false,
          message: response.data?.message || `同步失败（HTTP ${response.status}）。`
        })
        await reload()
      }
    } catch (err) {
      setResult({ ok: false, message: '网络请求失败，请检查部署环境能否访问 Notion。' })
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className='rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0f1115]'>
      <div className='flex flex-wrap items-start justify-between gap-3'>
        <div>
          <h2 className='text-sm font-semibold'>Notion 只读同步</h2>
          <p className='mt-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400'>
            把文章标题 / 分类 / 标签 / slug 同步到后台侧的快照，用于给统计数字配上可读名称。
            <strong className='text-gray-700 dark:text-gray-200'>不会修改 Notion 里的任何内容。</strong>
          </p>
        </div>
        <button
          type='button'
          onClick={() => void handleSync()}
          disabled={syncing || loading || cooldown > 0}
          className='rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'>
          {syncing ? '同步中…（最长约 1 分钟）' : cooldown > 0 ? `冷却中 ${cooldown}s` : '立即同步'}
        </button>
      </div>

      <dl className='mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-4'>
        <div>
          <dt className='text-gray-400 dark:text-gray-500'>上次成功同步</dt>
          <dd className='mt-0.5 text-gray-700 dark:text-gray-200'>
            {meta?.syncedAt ? `${formatDateTime(meta.syncedAt)}（${fromNow(meta.syncedAt)}）` : '尚未同步'}
          </dd>
        </div>
        <div>
          <dt className='text-gray-400 dark:text-gray-500'>文章 / 分类 / 标签</dt>
          <dd className='mt-0.5 tabular-nums text-gray-700 dark:text-gray-200'>
            {meta ? `${meta.count} / ${meta.categories?.length || 0} / ${meta.tags?.length || 0}` : '—'}
          </dd>
        </div>
        <div>
          <dt className='text-gray-400 dark:text-gray-500'>路径映射</dt>
          <dd className='mt-0.5 tabular-nums text-gray-700 dark:text-gray-200'>
            {data?.pathMapSize === undefined ? '—' : `${data.pathMapSize} 条`}
          </dd>
        </div>
        <div>
          <dt className='text-gray-400 dark:text-gray-500'>状态</dt>
          <dd className='mt-0.5 text-gray-700 dark:text-gray-200'>
            {data?.stale === undefined ? '—' : data.stale ? '已过期（> 24h）' : '新鲜'}
          </dd>
        </div>
      </dl>

      {error && (
        <div className='mt-3'>
          <AdminNotice tone='error' title='同步状态不可读'>
            {error}
          </AdminNotice>
        </div>
      )}

      {result && (
        <div className='mt-3'>
          <AdminNotice tone={result.ok ? 'ok' : 'error'} title={result.ok ? '同步完成' : '同步未完成'}>
            {result.ok
              ? `文章 ${result.counts?.articles ?? '—'} 篇、分类 ${result.counts?.categories ?? '—'} 个、标签 ${result.counts?.tags ?? '—'} 个。`
              : result.message}
          </AdminNotice>
        </div>
      )}

      {cooldown > 0 && !result && (
        <div className='mt-3'>
          <AdminNotice tone='info'>
            同步有 5 分钟冷却（防止频繁拉取 Notion）。剩余 {cooldown} 秒。
          </AdminNotice>
        </div>
      )}

      {lastError && (
        <div className='mt-3'>
          <AdminNotice tone='warn' title={`最近一次失败：${formatDateTime(lastError.finishedAt)}`}>
            <span className='font-mono text-[11px]'>{lastError.error}</span>
          </AdminNotice>
        </div>
      )}

      <div className='mt-4 border-t border-gray-100 pt-3 dark:border-gray-800'>
        <p className='mb-2 text-[11px] font-medium text-gray-500 dark:text-gray-400'>最近同步记录</p>
        {(data?.log || []).length === 0 ? (
          <p className='text-xs text-gray-400 dark:text-gray-500'>还没有同步记录</p>
        ) : (
          <ul className='space-y-1 text-[11px] text-gray-600 dark:text-gray-300'>
            {(data?.log || []).slice(0, 5).map((item, index) => (
              <li key={`${item.finishedAt}-${index}`} className='flex flex-wrap gap-2'>
                <span className={item.status === 'ok' ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                  {item.status === 'ok' ? '成功' : '失败'}
                </span>
                <span className='text-gray-500 dark:text-gray-400'>{formatDateTime(item.finishedAt)}</span>
                <span className='text-gray-400 dark:text-gray-500'>
                  {item.status === 'ok'
                    ? `文章 ${item.counts?.articles ?? '—'} 篇 / 耗时 ${item.durationMs ?? '—'}ms`
                    : (item.error || '').slice(0, 80)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {lastOk && (
          <p className='mt-2 text-[11px] text-gray-400 dark:text-gray-500'>
            提示：文章改名或换 slug 后，历史阅读量仍按「路径映射」归到同一篇（映射只增不删）。
          </p>
        )}
      </div>

      <p className='mt-3 text-[11px] text-gray-400 dark:text-gray-500'>
        需要复核口径时看 <Link href='/admin/analytics' className='underline'>流量分析</Link>；分类标签分布见{' '}
        <Link href='/admin/categories' className='underline'>分类与标签</Link>。
      </p>
    </section>
  )
}
