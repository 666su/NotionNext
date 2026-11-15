/**
 * 消息输入框（抽屉与私密会话页共用）
 *
 * - Enter 发送，Shift+Enter 换行（移动端不拦截）
 * - 5000 字上限与字数提示
 * - 发送中禁用，防重复提交（由上层生成 client_request_id 复用）
 */

import { useEffect, useRef, useState } from 'react'

const MAX = 5000

export default function MessageComposer({ onSend, disabled, sending, placeholder = '写下你想说的话…' }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const areaRef = useRef(null)

  useEffect(() => {
    if (areaRef.current) {
      areaRef.current.style.height = 'auto'
      areaRef.current.style.height = `${Math.min(160, areaRef.current.scrollHeight)}px`
    }
  }, [value])

  async function submit() {
    const content = value.trim()
    if (!content) {
      setError('消息不能为空')
      return
    }
    if (content.length > MAX) {
      setError(`最多 ${MAX} 字`)
      return
    }
    setError('')
    const ok = await onSend(content)
    if (ok) setValue('')
  }

  return (
    <div className='border-t border-gray-200 pt-3 dark:border-gray-800'>
      <textarea
        ref={areaRef}
        value={value}
        onChange={event => {
          setValue(event.target.value)
          if (error) setError('')
        }}
        onKeyDown={event => {
          if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            if (!disabled && !sending) void submit()
          }
        }}
        rows={2}
        maxLength={MAX + 200}
        placeholder={placeholder}
        aria-label='消息内容'
        className='w-full resize-none rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:bg-[#0b0d10] dark:text-gray-100 dark:focus:border-gray-400'
      />
      <div className='mt-1 flex items-center justify-between gap-2'>
        <span className={`text-[11px] ${error ? 'text-red-600 dark:text-red-400' : 'text-gray-400 dark:text-gray-500'}`}>
          {error || `${value.trim().length} / ${MAX}`}
        </span>
        <button
          type='button'
          onClick={() => void submit()}
          disabled={disabled || sending || !value.trim()}
          className='rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'>
          {sending ? '发送中…' : '发送'}
        </button>
      </div>
    </div>
  )
}
