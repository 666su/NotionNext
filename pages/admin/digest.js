/**
 * /admin/digest —— 每日总结（Phase 6）
 *
 * 三块内容：
 *   1) 配置状态：AI / Telegram / CRON_SECRET 是否就绪（只显示"是否配置"，不显示任何密钥）
 *   2) 预览与手动推送：选一天生成文本，确认无误再发；也可直接发
 *   3) 最近发送日志：成功/失败、是否带 AI、消息长度
 *
 * 定时任务在 vercel.json（每日 01:00 UTC 同步 Notion、01:10 UTC 发总结）。
 */

import { useCallback, useEffect, useState } from 'react'
import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminDataTable from '@/components/admin/AdminDataTable'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminNotice from '@/components/admin/AdminNotice'
import AdminPanel from '@/components/admin/AdminPanel'
import AdminStatCards from '@/components/admin/AdminStatCards'
import AdminSyncPanel from '@/components/admin/AdminSyncPanel'
import { formatDateTime, formatNumber } from '@/components/admin/format'
import { adminFetch } from '@/lib/admin/client'
import { useAdminJson } from '@/components/admin/useAdminReport'
import { adminPageGuard } from '@/lib/admin/page-guard'

function todayKey() {
  const date = new Date()
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

function yesterdayKey() {
  const date = new Date(Date.now() - 86400000)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`
}

/** Telegram 用 HTML；页面里显示成纯文本更可读（只去掉我们自己的 <b> 标签） */
function toPlainText(html) {
  return String(html || '')
    .replace(/<\/?b>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

export default function DigestPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return <DigestContent admin={props.admin} />
}

function DigestContent({ admin }) {
  const { data: status, loading: statusLoading, error: statusError, reload: reloadStatus } =
    useAdminJson('/api/admin/digest?log=1')

  const [day, setDay] = useState(yesterdayKey())
  const [preview, setPreview] = useState(null)
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState(null)

  const config = status?.config || {}
  const aiReady = config.ai?.configured === true
  const tgReady = config.telegram?.configured === true

  const loadPreview = useCallback(async () => {
    setPreviewing(true)
    setResult(null)
    const response = await adminFetch(`/api/admin/digest?dayKey=${encodeURIComponent(day)}`)
    setPreviewing(false)
    if (!response.ok) {
      setResult({ ok: false, message: `预览失败（HTTP ${response.status}）` })
      return
    }
    setPreview(response.data)
  }, [day])

  useEffect(() => {
    void loadPreview()
    // 只在进入页面与切日期时拉一次预览；后续由按钮触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day])

  async function handleSend() {
    setSending(true)
    setResult(null)
    const response = await adminFetch('/api/admin/digest', {
      method: 'POST',
      body: { dayKey: day, send: true }
    })
    setSending(false)
    if (response.status === 429) {
      setResult({ ok: false, message: '60 秒内只能手动推送一次，请稍后再试。' })
      return
    }
    if (!response.ok) {
      setResult({ ok: false, message: `发送失败（HTTP ${response.status}）` })
      return
    }
    setResult({
      ok: response.data?.delivery?.ok === true,
      message:
        response.data?.delivery?.ok === true
          ? `已发送到 Telegram（消息 ID ${response.data.delivery.messageId ?? '—'}，${response.data.ai?.ok ? '含 AI 总结' : '原始数据'}）。`
          : `未发送：${response.data?.delivery?.reason || 'not_configured'}（文本已生成，可先预览）`
    })
    await reloadStatus()
  }

  const actions = (
    <button
      type='button'
      onClick={() => void reloadStatus()}
      disabled={statusLoading}
      className='rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'>
      {statusLoading ? '刷新中…' : '刷新状态'}
    </button>
  )

  return (
    <AdminModulePage
      admin={admin}
      active='digest'
      title='每日总结'
      description='AI 归纳 + Telegram 推送（每日定时，也可手动发送）'
      actions={actions}>
      <div className='space-y-5'>
        {statusError && (
          <AdminNotice tone='error' title='状态不可读'>
            {statusError}
          </AdminNotice>
        )}

        <AdminStatCards
          columns={3}
          items={[
            {
              key: 'ai',
              label: 'AI 模型',
              display: aiReady ? '已配置' : '未配置',
              tone: aiReady ? 'default' : 'warn',
              hint: aiReady ? `模型 ${config.ai?.model || '—'}` : '设置 AI_API_KEY 后可用'
            },
            {
              key: 'tg',
              label: 'Telegram',
              display: tgReady ? '已配置' : '未配置',
              tone: tgReady ? 'default' : 'warn',
              hint: tgReady
                ? '机器人令牌与会话 ID 均已就绪'
                : `缺少：${(config.telegram?.missing || []).join('、') || 'TELEGRAM_BOT_TOKEN、TELEGRAM_CHAT_ID'}`
            },
            {
              key: 'cron',
              label: '定时任务密钥',
              display: config.cronSecretConfigured ? '已配置' : '未配置',
              tone: config.cronSecretConfigured ? 'default' : 'warn',
              hint: config.cronSecretConfigured
                ? 'Vercel Cron 会带 Bearer 调用'
                : '未配置 CRON_SECRET 时定时接口一律 503'
            }
          ]}
        />

        {!tgReady && (
          <AdminNotice tone='warn' title='Telegram 还没接通'>
            请在部署平台（Vercel → Settings → Environment Variables）配置{' '}
            <code>TELEGRAM_BOT_TOKEN</code> 与 <code>TELEGRAM_CHAT_ID</code>，重新部署后本页会变成「已配置」。
            <br />
            这里的页面只是入口：<strong>令牌不会显示、也不会下发到浏览器</strong>，所有推送都在服务端完成。
          </AdminNotice>
        )}

        <AdminPanel
          title='推送内容预览'
          description='默认取昨日的真实统计；只发数字与文章标题，不包含访客标识、评论或正文'
          footnote='AI 未配置时仍会发送，只是标题标明"原始数据"；推送失败会写进下方日志，不会静默丢弃。'
          actions={
            <div className='flex flex-wrap items-center gap-2'>
              <input
                type='date'
                value={`${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}`}
                onChange={event => {
                  const value = String(event.target.value || '').replace(/-/g, '')
                  if (/^\d{8}$/.test(value)) setDay(value)
                }}
                className='rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-[#0b0d10]'
              />
              <button
                type='button'
                onClick={() => setDay(todayKey())}
                className='rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800'>
                今日
              </button>
              <button
                type='button'
                onClick={() => setDay(yesterdayKey())}
                className='rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800'>
                昨日
              </button>
              <button
                type='button'
                onClick={() => void loadPreview()}
                disabled={previewing}
                className='rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800'>
                {previewing ? '生成中…' : '重新生成'}
              </button>
              <button
                type='button'
                onClick={() => void handleSend()}
                disabled={sending || !preview}
                className='rounded bg-gray-900 px-2.5 py-1 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900'>
                {sending ? '发送中…' : tgReady ? '立即发送到 Telegram' : '生成（未配置 TG）'}
              </button>
            </div>
          }>
          {result && (
            <div className='mb-3'>
              <AdminNotice tone={result.ok ? 'ok' : 'error'}>{result.message}</AdminNotice>
            </div>
          )}

          {preview ? (
            <>
              <div className='mb-2 flex flex-wrap items-center gap-2 text-[11px] text-gray-500 dark:text-gray-400'>
                <span>日期 {preview.day}</span>
                <span>· PV {formatNumber(preview.facts?.pv)}</span>
                <span>· UV {formatNumber(preview.facts?.uv)}</span>
                <span>· Session {formatNumber(preview.facts?.sessions)}</span>
                <span>
                  · AI {preview.ai?.ok ? `已生成（${preview.ai?.model || '—'}）` : `未生成（${preview.ai?.reason || 'not_configured'}）`}
                </span>
              </div>
              <pre className='max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-gray-100 bg-gray-50 p-3 text-[11px] leading-relaxed text-gray-700 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-200'>
                {toPlainText(preview.text)}
              </pre>
              <p className='mt-2 text-[11px] text-gray-400 dark:text-gray-500'>
                以上是 Telegram 实际会收到的文本（已去掉加粗标签，方便阅读；实际发送使用 HTML 解析模式）。
              </p>
            </>
          ) : (
            <p className='text-xs text-gray-400 dark:text-gray-500'>
              {previewing ? '正在生成预览…' : '暂无预览'}
            </p>
          )}
        </AdminPanel>

        <AdminPanel
          title='发送日志'
          description='最近 10 次（含定时任务与手动）'
          footnote='日志只记录规模与结果，不记录任何令牌或聊天内容。'>
          <AdminDataTable
            dense
            emptyText='还没有发送记录'
            columns={[
              { key: 'at', label: '时间', format: value => formatDateTime(value) },
              { key: 'date', label: '统计日', mono: true },
              { key: 'pv', label: 'PV', align: 'right' },
              { key: 'uv', label: 'UV', align: 'right' },
              {
                key: 'ai',
                label: 'AI',
                format: value => (value ? '✓' : `× ${'原始数据'}`)
              },
              {
                key: 'sent',
                label: '推送',
                format: (value, row) => (value ? '✓' : `× ${row.sendReason || ''}`)
              },
              { key: 'chars', label: '字数', align: 'right' }
            ]}
            rows={(status?.log || []).map((row, index) => ({ ...row, id: `${row.at}-${index}` }))}
          />
        </AdminPanel>

        <AdminSyncPanel />

        <AdminPanel title='怎么安排定时' description='部署侧的配置，代码里已经写好'>
          <ul className='space-y-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300'>
            <li>
              · <code>vercel.json</code> 已声明两个定时任务：<code>01:00 UTC</code> 同步 Notion、
              <code>01:10 UTC</code> 发每日总结（北京时间 09:00 / 09:10）。
            </li>
            <li>
              · 两个接口都要求 <code>Authorization: Bearer $CRON_SECRET</code>；未配置{' '}
              <code>CRON_SECRET</code> 时返回 503（不会被外人触发）。
            </li>
            <li>· Vercel Hobby 计划只允许每日 1 次、最多 2 个任务；Pro 计划可以调更密。</li>
            <li>
              · 想手动跑一次：<code>curl -H &quot;Authorization: Bearer $CRON_SECRET&quot; https://&lt;域名&gt;/api/cron/digest</code>。
            </li>
          </ul>
        </AdminPanel>
      </div>
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/digest' })
  if (guard.redirect) return guard
  return guard
}
