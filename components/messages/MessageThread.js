/**
 * 私密会话视图（抽屉与 /message/[id] 页共用）
 *
 * 生命周期：兑换 token（若有）→ 读会话 → 读消息 → 可继续发言（20 秒轮询一次）
 * 安全：token 只在内存里用一次；兑换成功后立刻清掉 URL hash；不写 localStorage。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import MessageComposer from './MessageComposer'
import { clearHash, errorText, formatTime, getJson, postJson } from './api'

const STATUS_LABEL = {
  unread: '未读',
  read: '已读',
  processing: '处理中',
  resolved: '已解决',
  archived: '已归档',
  spam: '垃圾'
}

function makeRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

export default function MessageThread({
  conversationId,
  token = '',
  onReady,
  onSent,
  className = '',
  pollMs = 20000
}) {
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const [conversation, setConversation] = useState(null)
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const pendingId = useRef('')
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const loadMessages = useCallback(async () => {
    const res = await getJson(`/api/messages/conversations/${conversationId}/messages?limit=100`)
    if (!res.ok) return res
    if (mounted.current) setMessages(res.data?.messages || [])
    return res
  }, [conversationId])

  const bootstrap = useCallback(async () => {
    setPhase('loading')
    setError('')

    // 1) 有 token 先兑换（token 只在这一次请求体里出现）
    if (token) {
      const exchanged = await postJson('/api/messages/access/exchange', {
        conversation_id: conversationId,
        token
      })
      clearHash()
      if (!exchanged.ok) {
        if (mounted.current) {
          setPhase('error')
          setError(errorText(exchanged.data?.error, exchanged.status))
        }
        return
      }
    }

    // 2) 读会话
    const conv = await getJson(`/api/messages/conversations/${conversationId}`)
    if (!conv.ok) {
      if (mounted.current) {
        setPhase('error')
        setError(errorText(conv.data?.error, conv.status))
      }
      return
    }
    if (mounted.current) setConversation(conv.data?.conversation || null)

    // 3) 读消息
    const list = await loadMessages()
    if (!list.ok) {
      if (mounted.current) {
        setPhase('error')
        setError(errorText(list.data?.error, list.status))
      }
      return
    }
    if (mounted.current) {
      setPhase('ready')
      onReady?.(conv.data?.conversation || null)
    }
  }, [conversationId, token, loadMessages, onReady])

  useEffect(() => {
    void bootstrap()
    // 只在会话/凭证变化时重新引导
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, token])

  // 轮询：只在 ready 且页面可见时拉取
  useEffect(() => {
    if (phase !== 'ready') return undefined
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void loadMessages()
    }, Math.max(8000, pollMs))
    return () => clearInterval(timer)
  }, [phase, pollMs, loadMessages])

  async function handleSend(content) {
    setSending(true)
    setSendError('')
    if (!pendingId.current) pendingId.current = makeRequestId()
    const res = await postJson(`/api/messages/conversations/${conversationId}/messages`, {
      content,
      client_request_id: pendingId.current
    })
    setSending(false)

    if (!res.ok) {
      // 保留 pendingId：重试时复用，服务端按幂等处理
      setSendError(errorText(res.data?.error, res.status))
      return false
    }
    pendingId.current = ''
    await loadMessages()
    onSent?.(res.data?.message || null)
    return true
  }

  if (phase === 'loading') {
    return (
      <div className={`flex items-center justify-center py-10 text-xs text-gray-400 dark:text-gray-500 ${className}`}>
        正在打开会话…
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div className={`space-y-3 py-6 text-center ${className}`}>
        <p className='text-sm font-medium text-red-700 dark:text-red-300'>无法打开会话</p>
        <p className='mx-auto max-w-sm text-xs leading-relaxed text-gray-600 dark:text-gray-300'>{error}</p>
        <p className='text-[11px] text-gray-400 dark:text-gray-500'>
          私密链接就是访问凭证，请从你保存的链接重新打开。
        </p>
      </div>
    )
  }

  return (
    <div className={`flex min-h-0 flex-col ${className}`}>
      <div className='flex items-center justify-between gap-2 border-b border-gray-200 pb-2 dark:border-gray-800'>
        <div className='min-w-0'>
          <p className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>
            {conversation?.visitor_name || '访客'}
          </p>
          <p className='text-[11px] text-gray-400 dark:text-gray-500'>
            {messages.length} 条消息 · {STATUS_LABEL[conversation?.status] || conversation?.status || '—'}
          </p>
        </div>
        {conversation?.status === 'resolved' && (
          <span className='shrink-0 rounded bg-green-50 px-1.5 py-0.5 text-[11px] text-green-700 dark:bg-green-900/20 dark:text-green-300'>
            已解决
          </span>
        )}
      </div>

      <div className='min-h-0 flex-1 space-y-3 overflow-y-auto py-3'>
        {messages.length === 0 && (
          <p className='py-6 text-center text-xs text-gray-400 dark:text-gray-500'>还没有消息</p>
        )}
        {messages.map(message => {
          const mine = message.sender === 'visitor'
          return (
            <div key={message.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
              <div className='max-w-[85%]'>
                <div
                  className={`whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm leading-relaxed ${
                    mine
                      ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                      : 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100'
                  }`}>
                  {message.content}
                </div>
                <p className={`mt-1 text-[10px] text-gray-400 dark:text-gray-500 ${mine ? 'text-right' : ''}`}>
                  {mine ? '我' : 'Jason'} · {formatTime(message.created_at)}
                </p>
              </div>
            </div>
          )
        })}
      </div>

      {sendError && (
        <p className='mb-2 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:bg-red-900/20 dark:text-red-300'>
          {sendError}
        </p>
      )}

      <MessageComposer onSend={handleSend} sending={sending} />
    </div>
  )
}
