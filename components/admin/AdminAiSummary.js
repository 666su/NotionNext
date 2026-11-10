/**
 * AI 浏览总结卡片（Phase 6）
 *
 * 只消费聚合数字：不把访客标识、评论、正文发给模型。
 * 未配置模型时依然展示事实数据，并明确写出"AI 未配置"，不用模板假装是总结。
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import AdminNotice from './AdminNotice'
import { formatDateTime, formatNumber } from './format'
import { useAdminJson } from './useAdminReport'

const RANGES = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '近 7 天' },
  { key: '30d', label: '近 30 天' }
]

export default function AdminAiSummary() {
  const [range, setRange] = useState('today')
  const [url, setUrl] = useState('/api/admin/ai/summary?range=today')
  const { data, loading, error, reload } = useAdminJson(url)

  useEffect(() => {
    setUrl(`/api/admin/ai/summary?range=${range}`)
  }, [range])

  const facts = data?.facts || {}
  const ai = data?.ai || {}

  return (
    <section className='rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0f1115]'>
      <div className='flex flex-wrap items-start justify-between gap-2'>
        <div>
          <h2 className='text-sm font-semibold'>AI 浏览总结</h2>
          <p className='mt-0.5 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400'>
            把所选时间窗的聚合数字交给模型归纳，只发送数字，不发送访客标识与文章正文。
          </p>
        </div>
        <div className='flex items-center gap-2'>
          <div className='inline-flex items-center gap-1 rounded-md border border-gray-200 p-1 dark:border-gray-800'>
            {RANGES.map(item => (
              <button
                key={item.key}
                type='button'
                onClick={() => setRange(item.key)}
                disabled={loading}
                className={`rounded px-2 py-1 text-xs transition-colors disabled:opacity-50 ${
                  range === item.key
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}>
                {item.label}
              </button>
            ))}
          </div>
          <button
            type='button'
            onClick={() => void reload()}
            disabled={loading}
            className='rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'>
            {loading ? '生成中…' : '重新生成'}
          </button>
        </div>
      </div>

      {error && (
        <div className='mt-3'>
          <AdminNotice tone='error' title='取数失败'>
            {error}
          </AdminNotice>
        </div>
      )}

      {data && (
        <>
          <div className='mt-3 grid gap-2 text-xs sm:grid-cols-4'>
            {[
              { label: 'PV', value: facts.pv },
              { label: 'UV', value: facts.uv },
              { label: 'Session', value: facts.sessions },
              { label: '站内搜索', value: facts.searchTotal }
            ].map(item => (
              <div key={item.label} className='rounded border border-gray-100 px-2 py-1.5 dark:border-gray-800'>
                <p className='text-[11px] text-gray-400 dark:text-gray-500'>{item.label}</p>
                <p className='mt-0.5 text-sm font-semibold tabular-nums'>{formatNumber(item.value)}</p>
              </div>
            ))}
          </div>

          <div className='mt-3 rounded-md border border-gray-100 bg-gray-50 p-3 text-xs leading-relaxed text-gray-700 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-200'>
            {ai.ok ? (
              ai.text
                .split('\n')
                .filter(Boolean)
                .map((line, index) => <p key={index} className='mt-1 first:mt-0'>{line}</p>)
            ) : (
              <div className='space-y-1'>
                <p className='font-medium text-amber-700 dark:text-amber-300'>
                  AI 总结未生成（{ai.reason || 'not_configured'}）
                </p>
                <p className='text-gray-500 dark:text-gray-400'>
                  原因通常是未配置模型凭据。配置 <code>AI_API_KEY</code>（可选{' '}
                  <code>AI_BASE_URL</code> / <code>AI_MODEL</code>）后重新生成即可；上面的数字是真实统计，不受影响。
                </p>
              </div>
            )}
          </div>

          <p className='mt-2 text-[11px] text-gray-400 dark:text-gray-500'>
            模型：{ai.model || '—'} · 生成于 {formatDateTime(data.generatedAt)} ·{' '}
            <Link href='/admin/digest' className='underline'>
              每日自动推送（Telegram）
            </Link>
          </p>
        </>
      )}

      {!data && !error && <p className='mt-3 text-xs text-gray-400 dark:text-gray-500'>正在生成…</p>}
    </section>
  )
}
