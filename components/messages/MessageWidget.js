/**
 * 右下角私信入口 + 抽屉（Phase 2）
 *
 * 位置纪律：
 * - 右下角已被「回顶按钮（right-4 bottom-4）」与「桌宠（112px，right/bottom 20）」占用；
 * - 因此入口放在桌宠上方（移动端 bottom 116 / 桌面 148），不与其默认位置重叠；
 * - z-index 40 低于桌宠 55，抽屉打开时抬到 70（盖住桌宠，避免被遮挡）。
 */

import { useCallback, useEffect, useState } from 'react'
import MessageThread from './MessageThread'
import { copyText, errorText, postJson } from './api'

const DRAFT_KEY = 'jbm-draft-v1'
const LAST_KEY = 'jbm-last-conv-v1'

function readDraft() {
  if (typeof window === 'undefined') return { name: '', email: '', content: '' }
  try {
    const raw = window.localStorage.getItem(DRAFT_KEY)
    if (!raw) return { name: '', email: '', content: '' }
    const parsed = JSON.parse(raw)
    return {
      name: String(parsed?.name || ''),
      email: String(parsed?.email || ''),
      content: String(parsed?.content || '')
    }
  } catch (err) {
    return { name: '', email: '', content: '' }
  }
}

function readLastConv() {
  if (typeof window === 'undefined') return ''
  try {
    return String(window.localStorage.getItem(LAST_KEY) || '')
  } catch (err) {
    return ''
  }
}

export default function MessageWidget() {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState('form') // form | success | thread
  const [form, setForm] = useState({ name: '', email: '', content: '' })
  const [honeypot, setHoneypot] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [link, setLink] = useState('')
  const [conversationId, setConversationId] = useState('')
  const [token, setToken] = useState('')
  const [copied, setCopied] = useState(false)
  const [lastConv, setLastConv] = useState('')

  // 首屏恢复草稿与上次会话（只存 id 与草稿，不存 token）
  useEffect(() => {
    setForm(readDraft())
    setLastConv(readLastConv())
  }, [])

  // 草稿持久化（防关闭抽屉丢输入）
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    } catch (err) {
      /* 隐私模式忽略 */
    }
  }, [form])

  // 页头入口（MessageTrigger）派发事件 → 打开抽屉
  useEffect(() => {
    function onOpen() {
      setOpen(true)
    }
    window.addEventListener('jbm:open', onOpen)
    return () => window.removeEventListener('jbm:open', onOpen)
  }, [])

  // Esc 关闭
  useEffect(() => {
    if (!open) return undefined
    function onKey(event) {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const validate = useCallback(() => {
    const name = form.name.trim()
    const email = form.email.trim()
    const content = form.content.trim()
    if (name.length < 1 || name.length > 40) return '昵称需要 1–40 个字符'
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return '邮箱格式看起来不对'
    if (!content) return '消息不能为空'
    if (content.length > 5000) return '消息最多 5000 字'
    return ''
  }, [form])

  async function handleSubmit() {
    const problem = validate()
    if (problem) {
      setError(problem)
      return
    }
    setSending(true)
    setError('')
    const res = await postJson('/api/messages/conversations', {
      visitor_name: form.name.trim(),
      visitor_email: form.email.trim() || null,
      content: form.content.trim(),
      client_request_id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      website: honeypot
    })
    setSending(false)

    if (!res.ok || !res.data?.ok) {
      setError(errorText(res.data?.error, res.status))
      return
    }

    const createdLink = res.data.link || ''
    const cid = res.data.conversation_id || ''
    setLink(createdLink)
    setConversationId(cid)
    // token 只在内存里留到兑换完成
    const hashIndex = createdLink.indexOf('#')
    setToken(hashIndex >= 0 ? createdLink.slice(hashIndex + 1) : '')
    setView('success')
    setForm(prev => ({ ...prev, content: '' }))
    try {
      window.localStorage.setItem(LAST_KEY, cid)
    } catch (err) {
      /* 忽略 */
    }
    setLastConv(cid)
  }

  async function handleCopy() {
    const ok = await copyText(link)
    setCopied(ok)
    if (ok) setTimeout(() => setCopied(false), 2000)
  }

  function openThread() {
    setView('thread')
    setToken(token)
  }

  function resetToForm() {
    setView('form')
    setToken('')
    setLink('')
    setConversationId('')
  }

  return (
    <>
      {!open && (
        <button
          type='button'
          aria-label='打开私信窗口'
          aria-expanded={false}
          onClick={() => setOpen(true)}
          className='fixed right-4 bottom-[116px] z-40 flex h-11 w-11 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-700 shadow-lg transition-colors hover:bg-gray-50 md:hidden dark:border-gray-700 dark:bg-[#0f1115] dark:text-gray-200 dark:hover:bg-gray-800'>
          <svg viewBox='0 0 24 24' aria-hidden='true' className='h-5 w-5' fill='none' stroke='currentColor' strokeWidth='1.8'>
            <path d='M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-4 4v-4.2A2.5 2.5 0 0 1 4 13.5z' strokeLinecap='round' strokeLinejoin='round' />
          </svg>
        </button>
      )}

      {open && (
        <>
          <button
            type='button'
            aria-label='关闭私信窗口'
            onClick={() => setOpen(false)}
            className='fixed inset-0 z-[60] bg-black/20 backdrop-blur-[1px] md:bg-transparent md:backdrop-blur-0'
          />
          <section
            role='dialog'
            aria-modal='true'
            aria-label='私信'
            className='fixed inset-x-0 bottom-0 z-[70] flex h-[82vh] flex-col rounded-t-xl border border-gray-200 bg-white shadow-2xl md:inset-x-auto md:right-4 md:bottom-4 md:h-[560px] md:w-[380px] md:rounded-xl dark:border-gray-700 dark:bg-[#0f1115]'
            style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
            <header className='flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3 dark:border-gray-800'>
              <div className='min-w-0'>
                <p className='text-sm font-semibold text-gray-900 dark:text-gray-100'>给 Jason 发私信</p>
                <p className='text-[11px] text-gray-400 dark:text-gray-500'>无需注册 · 邮箱选填</p>
              </div>
              <button
                type='button'
                onClick={() => setOpen(false)}
                aria-label='关闭'
                className='rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200'>
                <svg viewBox='0 0 24 24' className='h-4 w-4' fill='none' stroke='currentColor' strokeWidth='2'>
                  <path d='M6 6l12 12M18 6L6 18' strokeLinecap='round' />
                </svg>
              </button>
            </header>

            <div className='flex min-h-0 flex-1 flex-col overflow-hidden px-4 py-3'>
              {view === 'form' && (
                <div className='flex min-h-0 flex-1 flex-col'>
                  <p className='mb-3 text-xs leading-relaxed text-gray-600 dark:text-gray-300'>
                    技术问题、文章反馈、合作建议都欢迎。发送后会得到一条<strong>私密链接</strong>，
                    只有拿到链接的人才能看到这段对话。
                  </p>

                  {error && (
                    <p role='alert' className='mb-2 rounded bg-red-50 px-2 py-1.5 text-[11px] text-red-700 dark:bg-red-900/20 dark:text-red-300'>
                      {error}
                    </p>
                  )}

                  <label className='mb-1 block text-[11px] text-gray-500 dark:text-gray-400' htmlFor='jbm-name'>
                    昵称（必填）
                  </label>
                  <input
                    id='jbm-name'
                    value={form.name}
                    onChange={event => setForm(prev => ({ ...prev, name: event.target.value }))}
                    maxLength={40}
                    className='mb-2 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:bg-[#0b0d10] dark:text-gray-100'
                  />

                  <label className='mb-1 block text-[11px] text-gray-500 dark:text-gray-400' htmlFor='jbm-email'>
                    邮箱（选填）
                  </label>
                  <input
                    id='jbm-email'
                    type='email'
                    value={form.email}
                    onChange={event => setForm(prev => ({ ...prev, email: event.target.value }))}
                    maxLength={254}
                    placeholder='仅用于以后联系，不会公开'
                    className='mb-2 w-full rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:bg-[#0b0d10] dark:text-gray-100'
                  />

                  {/* honeypot：真人看不见，机器人会填 */}
                  <input
                    tabIndex={-1}
                    autoComplete='off'
                    aria-hidden='true'
                    value={honeypot}
                    onChange={event => setHoneypot(event.target.value)}
                    name='website'
                    className='pointer-events-none absolute left-[-9999px] h-0 w-0 opacity-0'
                  />

                  <label className='mb-1 block text-[11px] text-gray-500 dark:text-gray-400' htmlFor='jbm-content'>
                    消息内容
                  </label>
                  <textarea
                    id='jbm-content'
                    value={form.content}
                    onChange={event => setForm(prev => ({ ...prev, content: event.target.value }))}
                    rows={6}
                    maxLength={5000}
                    className='min-h-0 flex-1 resize-none rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:bg-[#0b0d10] dark:text-gray-100'
                  />

                  <div className='mt-2 flex items-center justify-between gap-2'>
                    <span className='text-[11px] text-gray-400 dark:text-gray-500'>
                      {form.content.trim().length} / 5000
                    </span>
                    <button
                      type='button'
                      onClick={() => void handleSubmit()}
                      disabled={sending}
                      className='rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900'>
                      {sending ? '发送中…' : '发送私信'}
                    </button>
                  </div>

                  {lastConv && (
                    <button
                      type='button'
                      onClick={() => {
                        setConversationId(lastConv)
                        setToken('')
                        setView('thread')
                      }}
                      className='mt-2 text-[11px] text-gray-400 underline hover:text-gray-600 dark:hover:text-gray-300'>
                      继续上次的对话
                    </button>
                  )}
                </div>
              )}

              {view === 'success' && (
                <div className='flex min-h-0 flex-1 flex-col'>
                  <p className='text-sm font-semibold text-green-700 dark:text-green-400'>私信已发送</p>
                  <p className='mt-1 text-xs leading-relaxed text-gray-600 dark:text-gray-300'>
                    你的专属私密会话已创建。<strong>这个链接就是凭证</strong>，请保存好；不要公开分享，
                    丢失后无法找回。
                  </p>

                  <div className='mt-3 break-all rounded-md border border-gray-200 bg-gray-50 p-2 font-mono text-[11px] text-gray-700 dark:border-gray-800 dark:bg-gray-900/40 dark:text-gray-200'>
                    {link}
                  </div>

                  <div className='mt-2 flex flex-wrap gap-2'>
                    <button
                      type='button'
                      onClick={() => void handleCopy()}
                      className='rounded-md bg-gray-900 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900'>
                      {copied ? '已复制' : '复制私密链接'}
                    </button>
                    <button
                      type='button'
                      onClick={openThread}
                      className='rounded-md border border-gray-300 px-2.5 py-1.5 text-xs hover:bg-gray-100 dark:border-gray-700 dark:hover:bg-gray-800'>
                      在窗口里继续对话
                    </button>
                  </div>

                  <p className='mt-3 text-[11px] leading-relaxed text-gray-400 dark:text-gray-500'>
                    提示：换浏览器或清理缓存后，需要重新打开这条链接（会重新验证一次）。
                  </p>
                </div>
              )}

              {view === 'thread' && conversationId && (
                <MessageThread
                  conversationId={conversationId}
                  token={token}
                  className='min-h-0 flex-1'
                  onReady={() => setToken('')}
                />
              )}
            </div>
          </section>
        </>
      )}
    </>
  )
}
