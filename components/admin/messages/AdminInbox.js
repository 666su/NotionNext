/**
 * /admin/messages 收件箱（Phase 3）
 *
 * 布局：左列表 + 右详情（移动端两级切换）。
 * 复用的既有能力：管理员 Session / CSRF（adminFetch）、AdminShell 外壳、审计（服务端）。
 * 状态：unread / read / processing / resolved / archived / spam；访客新消息会把会话拉回 unread。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import AdminNotice from '@/components/admin/AdminNotice'
import { adminFetch } from '@/lib/admin/client'
import { formatDateTime } from '@/components/admin/format'

const FILTERS = [
  { key: 'all', label: '全部' },
  { key: 'unread', label: '未读' },
  { key: 'read', label: '已读' },
  { key: 'processing', label: '处理中' },
  { key: 'resolved', label: '已解决' },
  { key: 'archived', label: '已归档' },
  { key: 'spam', label: '垃圾' }
]

const STATUS_META = {
  unread: { label: '未读', cls: 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300' },
  read: { label: '已读', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300' },
  processing: { label: '处理中', cls: 'bg-amber-50 text-amber-700 dark:bg-amber-900/20 dark:text-amber-300' },
  resolved: { label: '已解决', cls: 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300' },
  archived: { label: '已归档', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
  spam: { label: '垃圾', cls: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-200' }
}

function StatusChip({ status }) {
  const meta = STATUS_META[status] || { label: status, cls: 'bg-gray-100 text-gray-600' }
  return <span className={`rounded px-1.5 py-0.5 text-[11px] ${meta.cls}`}>{meta.label}</span>
}

export default function AdminInbox() {
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [list, setList] = useState({ rows: [], total: 0, pageSize: 20 })
  const [stats, setStats] = useState(null)
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [toast, setToast] = useState(null)
  const [reply, setReply] = useState('')
  const [confirmDelete, setConfirmDelete] = useState('')
  const listRef = useRef(null)

  const flash = useCallback((tone, text) => {
    setToast({ tone, text })
    setTimeout(() => setToast(null), 3200)
  }, [])

  const loadStats = useCallback(async () => {
    const res = await adminFetch('/api/admin/messages/stats')
    if (res.ok && res.data?.ok) setStats(res.data)
  }, [])

  const loadList = useCallback(async () => {
    setLoadingList(true)
    const params = new URLSearchParams({ status, page: String(page), pageSize: '20' })
    if (q.trim()) params.set('q', q.trim())
    const res = await adminFetch(`/api/admin/messages/conversations?${params.toString()}`)
    setLoadingList(false)
    if (!res.ok) {
      setError('列表加载失败，请稍后重试。')
      return
    }
    setError('')
    setList({
      rows: res.data?.rows || [],
      total: res.data?.total || 0,
      pageSize: res.data?.pageSize || 20
    })
  }, [status, page, q])

  const loadDetail = useCallback(
    async id => {
      if (!id) return
      setLoadingDetail(true)
      const res = await adminFetch(`/api/admin/messages/conversations/${id}`)
      setLoadingDetail(false)
      if (!res.ok) {
        setDetail(null)
        setError('会话加载失败或已被删除。')
        return
      }
      setError('')
      setDetail(res.data)
    },
    []
  )

  useEffect(() => {
    void loadList()
  }, [loadList])

  useEffect(() => {
    void loadStats()
  }, [loadStats])

  // 20 秒轮询：列表 + 未读数；页面隐藏时跳过（Q3 决策）
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void loadStats()
      if (!selected) void loadList()
    }, 20000)
    return () => clearInterval(timer)
  }, [loadStats, loadList, selected])

  // 选中会话：拉详情并标记已读
  useEffect(() => {
    if (!selected) return
    setDetail(null)
    setConfirmDelete('')
    setReply('')
    void loadDetail(selected)
  }, [selected, loadDetail])

  const currentUnread = Number(detail?.conversation?.unread_count || 0)
  useEffect(() => {
    // 只要还有未读数就标记已读（不论会话处于 processing / resolved 等状态）
    if (!selected || currentUnread <= 0) return
    let cancelled = false
    ;(async () => {
      await adminFetch(`/api/admin/messages/conversations/${selected}`, {
        method: 'PATCH',
        body: { markRead: true }
      })
      if (cancelled) return
      await loadDetail(selected)
      await loadList()
      await loadStats()
    })()
    return () => {
      cancelled = true
    }
  }, [selected, currentUnread, loadDetail, loadList, loadStats])

  async function changeStatus(next) {
    if (!selected) return
    setBusy(`status:${next}`)
    const res = await adminFetch(`/api/admin/messages/conversations/${selected}`, {
      method: 'PATCH',
      body: { status: next }
    })
    setBusy('')
    if (!res.ok) {
      flash('error', '状态更新失败')
      return
    }
    flash('ok', `已标记为「${STATUS_META[next]?.label || next}」`)
    await loadDetail(selected)
    await loadList()
    await loadStats()
  }

  async function sendReply() {
    const content = reply.trim()
    if (!content) return
    setBusy('reply')
    const res = await adminFetch(`/api/admin/messages/conversations/${selected}/messages`, {
      method: 'POST',
      body: { content }
    })
    setBusy('')
    if (!res.ok) {
      flash('error', res.data?.error === 'conversation_full' ? '会话消息已满' : '回复失败，请重试')
      return
    }
    setReply('')
    flash('ok', '已回复')
    await loadDetail(selected)
    await loadList()
  }

  async function remove(mode) {
    if (!selected) return
    if (confirmDelete !== selected) {
      setConfirmDelete(selected)
      return
    }
    setBusy(`delete:${mode}`)
    const res = await adminFetch(
      `/api/admin/messages/conversations/${selected}?confirm=${encodeURIComponent(selected)}&mode=${mode}`,
      { method: 'DELETE' }
    )
    setBusy('')
    setConfirmDelete('')
    if (!res.ok) {
      flash('error', res.data?.error === 'confirm_required' ? '需要二次确认' : '删除失败')
      return
    }
    flash('ok', mode === 'purge' ? '已彻底删除' : '已删除（可恢复）')
    setSelected('')
    setDetail(null)
    await loadList()
    await loadStats()
  }

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil((list.total || 0) / (list.pageSize || 20))),
    [list.total, list.pageSize]
  )

  const rows = list.rows

  return (
    <div className='space-y-3'>
      {toast && (
        <div
          className={`rounded-md border px-3 py-2 text-xs ${
            toast.tone === 'ok'
              ? 'border-green-300 bg-green-50 text-green-800 dark:border-green-800/60 dark:bg-green-900/20 dark:text-green-200'
              : 'border-red-300 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-200'
          }`}>
          {toast.text}
        </div>
      )}

      {error && (
        <AdminNotice tone='error' title='出错了'>
          {error}
        </AdminNotice>
      )}

      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div className='flex flex-wrap items-center gap-1'>
          {FILTERS.map(item => {
            const count = item.key === 'all' ? stats?.total : stats?.byStatus?.[item.key]
            const active = status === item.key
            return (
              <button
                key={item.key}
                type='button'
                onClick={() => {
                  setStatus(item.key)
                  setPage(1)
                  setSelected('')
                }}
                className={`rounded px-2 py-1 text-xs transition-colors ${
                  active
                    ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                    : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}>
                {item.label}
                {typeof count === 'number' && count > 0 && item.key !== 'all' ? (
                  <span className={`ml-1 ${active ? 'opacity-80' : 'text-gray-400'}`}>{count}</span>
                ) : null}
              </button>
            )
          })}
        </div>

        <div className='flex items-center gap-2'>
          <input
            value={q}
            onChange={event => {
              setQ(event.target.value)
              setPage(1)
            }}
            placeholder='搜索昵称'
            className='w-44 rounded border border-gray-300 px-2 py-1 text-xs dark:border-gray-700 dark:bg-[#0b0d10]'
          />
          <button
            type='button'
            onClick={() => {
              void loadList()
              void loadStats()
            }}
            disabled={loadingList}
            className='rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:hover:bg-gray-800'>
            {loadingList ? '刷新中…' : '刷新'}
          </button>
        </div>
      </div>

      <div className='grid min-h-[26rem] gap-3 md:grid-cols-[20rem_1fr]'>
        {/* 左：列表 */}
        <section
          className={`${selected ? 'hidden md:block' : ''} max-h-[70vh] overflow-y-auto rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-[#0f1115]`}
          ref={listRef}>
          {rows.length === 0 && !loadingList && (
            <p className='p-4 text-xs text-gray-400 dark:text-gray-500'>
              {status === 'all' ? '还没有访客私信' : '这个状态下没有会话'}
            </p>
          )}
          <ul>
            {rows.map(row => {
              const active = row.id === selected
              const unread = Number(row.unread_count || 0) > 0
              return (
                <li key={row.id}>
                  <button
                    type='button'
                    onClick={() => setSelected(row.id)}
                    className={`w-full border-b border-gray-100 px-3 py-2.5 text-left transition-colors last:border-0 dark:border-gray-800 ${
                      active ? 'bg-gray-50 dark:bg-gray-800/60' : 'hover:bg-gray-50 dark:hover:bg-gray-800/40'
                    }`}>
                    <div className='flex items-center justify-between gap-2'>
                      <span className={`truncate text-sm ${unread ? 'font-semibold' : 'font-normal'} text-gray-900 dark:text-gray-100`}>
                        {row.visitor_name || '访客'}
                      </span>
                      <span className='shrink-0 text-[10px] text-gray-400 dark:text-gray-500'>
                        {formatDateTime(row.last_message_at || row.created_at)}
                      </span>
                    </div>
                    <div className='mt-1 flex items-center gap-1.5'>
                      <StatusChip status={row.status} />
                      <span className='text-[10px] text-gray-400 dark:text-gray-500'>
                        {row.message_count || 0} 条
                      </span>
                      {row.visitor_email && (
                        <span className='truncate text-[10px] text-gray-400 dark:text-gray-500'>
                          {row.visitor_email}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>

          {totalPages > 1 && (
            <div className='flex items-center justify-between border-t border-gray-100 px-3 py-2 text-[11px] text-gray-500 dark:border-gray-800 dark:text-gray-400'>
              <button
                type='button'
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className='rounded px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800'>
                上一页
              </button>
              <span>
                {page} / {totalPages}（共 {list.total}）
              </span>
              <button
                type='button'
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className='rounded px-1.5 py-0.5 hover:bg-gray-100 disabled:opacity-40 dark:hover:bg-gray-800'>
                下一页
              </button>
            </div>
          )}
        </section>

        {/* 右：详情 */}
        <section className={`${selected ? '' : 'hidden md:block'} flex min-h-[26rem] flex-col rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-[#0f1115]`}>
          {!selected && (
            <div className='flex flex-1 items-center justify-center p-6 text-xs text-gray-400 dark:text-gray-500'>
              从左侧选择一个会话
            </div>
          )}

          {selected && loadingDetail && !detail && (
            <div className='flex flex-1 items-center justify-center p-6 text-xs text-gray-400'>正在加载…</div>
          )}

          {selected && detail && (
            <>
              <header className='flex flex-wrap items-start justify-between gap-2 border-b border-gray-100 px-3 py-2.5 dark:border-gray-800'>
                <div className='min-w-0'>
                  <div className='flex items-center gap-2'>
                    <button
                      type='button'
                      onClick={() => setSelected('')}
                      className='rounded border border-gray-300 px-1.5 py-0.5 text-[11px] md:hidden dark:border-gray-700'>
                      返回
                    </button>
                    <p className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
                      {detail.conversation.visitor_name}
                    </p>
                    <StatusChip status={detail.conversation.status} />
                  </div>
                  <p className='mt-0.5 text-[11px] text-gray-400 dark:text-gray-500'>
                    创建 {formatDateTime(detail.conversation.created_at)} · 最后活动{' '}
                    {formatDateTime(detail.conversation.last_message_at)} · 邮箱{' '}
                    {detail.conversation.visitor_email || '未提供'}
                  </p>
                </div>

                <div className='flex flex-wrap items-center gap-1'>
                  {['processing', 'resolved', 'archived', 'spam'].map(next => (
                    <button
                      key={next}
                      type='button'
                      onClick={() => void changeStatus(next)}
                      disabled={busy.startsWith('status') || detail.conversation.status === next}
                      className='rounded border border-gray-300 px-2 py-0.5 text-[11px] hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800'>
                      {STATUS_META[next].label}
                    </button>
                  ))}
                  <button
                    type='button'
                    onClick={() => void changeStatus('unread')}
                    disabled={busy.startsWith('status')}
                    className='rounded border border-gray-300 px-2 py-0.5 text-[11px] hover:bg-gray-100 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800'>
                    标未读
                  </button>
                  <button
                    type='button'
                    onClick={() => void remove('soft')}
                    disabled={busy.startsWith('delete')}
                    className={`rounded border px-2 py-0.5 text-[11px] disabled:opacity-40 ${
                      confirmDelete === selected
                        ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-200'
                        : 'border-gray-300 hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800'
                    }`}>
                    {confirmDelete === selected ? '再点一次确认删除' : '删除'}
                  </button>
                  {confirmDelete === selected && (
                    <button
                      type='button'
                      onClick={() => void remove('purge')}
                      disabled={busy.startsWith('delete')}
                      className='rounded border border-red-500 px-2 py-0.5 text-[11px] text-red-700 hover:bg-red-50 disabled:opacity-40 dark:text-red-300 dark:hover:bg-red-900/30'>
                      彻底删除
                    </button>
                  )}
                </div>
              </header>

              <div className='flex-1 space-y-3 overflow-y-auto px-3 py-3'>
                {(detail.messages || []).map(message => {
                  const mine = message.sender === 'admin'
                  return (
                    <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                      <div className='max-w-[80%]'>
                        <div
                          className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed ${
                            mine
                              ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                              : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
                          }`}>
                          {message.content}
                        </div>
                        <p className={`mt-1 text-[10px] text-gray-400 ${mine ? 'text-right' : ''}`}>
                          {mine ? '我（Jason）' : detail.conversation.visitor_name} ·{' '}
                          {formatDateTime(message.created_at)}
                          {!mine && message.read_at ? ' · 已读' : ''}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className='border-t border-gray-100 p-3 dark:border-gray-800'>
                <textarea
                  value={reply}
                  onChange={event => setReply(event.target.value)}
                  rows={3}
                  maxLength={5000}
                  placeholder='输入回复…（访客通过他的私密链接查看）'
                  className='w-full resize-none rounded-md border border-gray-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:bg-[#0b0d10] dark:text-gray-100'
                />
                <div className='mt-1 flex items-center justify-between'>
                  <span className='text-[11px] text-gray-400'>{reply.trim().length} / 5000</span>
                  <button
                    type='button'
                    onClick={() => void sendReply()}
                    disabled={busy === 'reply' || !reply.trim()}
                    className='rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900'>
                    {busy === 'reply' ? '发送中…' : '发送回复'}
                  </button>
                </div>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
