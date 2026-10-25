/**
 * Blog Pet 悬浮对话框：欢迎语、搜索输入、文章推荐卡片、快捷查询
 */
'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { PET_CONFIG } from './blogPetConfig'
import { clamp, getViewport, truncate } from './blogPetUtils'

export function BlogPetDialog({
  open,
  anchorRect,
  messages,
  results,
  searching,
  error,
  quickDisabled,
  onClose,
  onSubmit,
  onQuickAction,
  onOpenArticle
}) {
  const dialogRef = useRef(null)
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [style, setStyle] = useState({})

  // 跟随桌宠定位：优先显示在上方，空间不足时翻到下方，并限制在视口内
  useLayoutEffect(() => {
    if (!open) return undefined

    const place = () => {
      const viewport = getViewport()
      const el = dialogRef.current
      if (!el) return
      if (viewport.width < 640) {
        setStyle({})
        return
      }
      const { width, maxHeight, gap } = PET_CONFIG.dialog
      const height = el.offsetHeight || maxHeight
      const anchor = anchorRect || { left: 0, top: 0, width: 0, height: 0 }
      const fitsAbove = anchor.top - gap - height >= 8
      const top = fitsAbove
        ? anchor.top - gap - height
        : Math.min(anchor.top + anchor.height + gap, viewport.height - height - 8)
      const left = clamp(
        anchor.left + anchor.width / 2 - width / 2,
        8,
        Math.max(8, viewport.width - width - 8)
      )
      setStyle({ left, top, width })
    }

    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [open, anchorRect, results.length, messages.length])

  // 打开时聚焦输入框，方便直接打字
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus?.(), 80)
    return () => clearTimeout(timer)
  }, [open])

  if (!open) return null

  const handleSubmit = event => {
    event.preventDefault()
    const value = query.trim()
    if (!value || searching) return
    onSubmit(value)
    setQuery('')
  }

  return (
    <div
      ref={dialogRef}
      className='blog-pet-dialog'
      style={style}
      role='dialog'
      aria-label='博客助手对话'
    >
      <header className='blog-pet-dialog-header'>
        <div className='blog-pet-dialog-title'>
          <strong>{PET_CONFIG.name}</strong>
          <span>博客小助手</span>
        </div>
        <button
          type='button'
          className='blog-pet-dialog-close'
          onClick={onClose}
          aria-label='关闭对话'
        >
          ×
        </button>
      </header>

      <div className='blog-pet-dialog-body'>
        <div className='blog-pet-messages'>
          {messages.map(message => (
            <p
              key={message.id}
              className={`blog-pet-message is-${message.role}`}
            >
              {message.text}
            </p>
          ))}
          {searching && (
            <p className='blog-pet-message is-pet'>正在翻找文章…</p>
          )}
        </div>

        {error && (
          <p className='blog-pet-hint is-error'>
            文章索引暂时不可用，稍后再试试，或直接点「最新」。
          </p>
        )}

        {!error && results.length > 0 && (
          <ul className='blog-pet-results'>
            {results.map(post => (
              <li key={post.id || post.href}>
                <button
                  type='button'
                  className='blog-pet-result-card'
                  onClick={() => onOpenArticle(post)}
                >
                  <span className='blog-pet-result-title'>{post.title}</span>
                  {post.summary && (
                    <span className='blog-pet-result-summary'>
                      {truncate(post.summary, 72)}
                    </span>
                  )}
                  <span className='blog-pet-result-meta'>
                    {[post.category, (post.tags || [])[0], post.date]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className='blog-pet-quick'>
        <button
          type='button'
          onClick={() => onQuickAction('latest')}
          disabled={quickDisabled}
        >
          最新
        </button>
        <button
          type='button'
          onClick={() => onQuickAction('random')}
          disabled={quickDisabled}
        >
          随机
        </button>
        <button
          type='button'
          onClick={() => onQuickAction('hot')}
          disabled={quickDisabled}
        >
          热门
        </button>
      </div>

      <form className='blog-pet-input' onSubmit={handleSubmit}>
        <input
          ref={inputRef}
          type='text'
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder='输入关键词，如 Cloudflare、部署、DeepSeek'
          aria-label='搜索博客文章'
          maxLength={60}
        />
        <button type='submit' disabled={!query.trim() || searching}>
          发送
        </button>
      </form>
    </div>
  )
}

export default BlogPetDialog
