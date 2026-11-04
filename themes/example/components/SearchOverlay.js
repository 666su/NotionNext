'use client'

import SmartLink from '@/components/SmartLink'
import { useEffect, useMemo, useRef, useState } from 'react'

const normalize = value =>
  value === undefined || value === null ? '' : String(value).toLowerCase()

const matchPost = (post, keyword) => {
  if (!keyword) return true
  const fields = [
    post?.title,
    post?.summary,
    post?.description,
    post?.category,
    post?.series
  ]
  if (Array.isArray(post?.tagItems)) {
    fields.push(...post.tagItems.map(tag => tag?.name))
  }
  if (Array.isArray(post?.tags)) {
    fields.push(...post.tags.map(tag => (typeof tag === 'string' ? tag : tag?.name)))
  }
  return fields
    .filter(Boolean)
    .some(field => normalize(field).includes(keyword))
}

/**
 * 悬浮搜索面板：点击顶部搜索后弹出，不跳转页面、不挤动文章列表。
 * 数据直接来自页面已加载的文章列表，不额外请求接口。
 */
export const SearchOverlay = ({ open, onClose, posts }) => {
  const [keyword, setKeyword] = useState('')
  const inputRef = useRef(null)

  const normalizedKeyword = keyword.trim().toLowerCase()
  const results = useMemo(() => {
    const source = Array.isArray(posts) ? posts : []
    if (!normalizedKeyword) return source.slice(0, 6)
    return source.filter(post => matchPost(post, normalizedKeyword)).slice(0, 20)
  }, [posts, normalizedKeyword])

  // 打开时聚焦输入框并锁定背景滚动；关闭时恢复
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus(), 30)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      clearTimeout(timer)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // 关闭后清空关键词
  useEffect(() => {
    if (!open) setKeyword('')
  }, [open])

  // ESC 关闭
  useEffect(() => {
    if (!open) return
    const onKeyDown = e => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const goFirst = e => {
    if (e.key !== 'Enter') return
    const first = results[0]
    if (first?.href) window.location.href = first.href
  }

  return (
    <div className='fixed inset-0 z-[100]'>
      {/* 遮罩 */}
      <div
        className='absolute inset-0 bg-black/40 backdrop-blur-sm'
        onClick={onClose}
        aria-hidden='true'
      />

      {/* 悬浮面板 */}
      <div
        role='dialog'
        aria-modal='true'
        aria-label='搜索文章'
        className='relative mx-auto mt-16 md:mt-24 w-[92vw] max-w-2xl overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900'>
        <div className='flex items-center gap-3 border-b border-gray-100 px-4 py-3 dark:border-zinc-800'>
          <i className='fas fa-search text-sm text-gray-400' />
          <input
            ref={inputRef}
            type='search'
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={goFirst}
            placeholder='搜索文章（标题 / 摘要 / 标签 / 分类）'
            aria-label='搜索文章'
            className='w-full bg-transparent text-sm text-gray-700 outline-none placeholder-gray-400 dark:text-gray-200'
          />
          <button
            type='button'
            onClick={onClose}
            className='shrink-0 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 hover:text-gray-600 dark:border-zinc-700 dark:hover:text-gray-200'
            aria-label='关闭搜索'>
            ESC
          </button>
        </div>

        <div className='max-h-[60vh] overflow-y-auto p-2'>
          {!normalizedKeyword && (
            <div className='px-3 pb-2 pt-1 text-xs text-gray-400'>
              最近文章
            </div>
          )}
          {results.length === 0 && (
            <div className='px-3 py-8 text-center text-sm text-gray-400'>
              没有匹配的文章，换个关键词试试
            </div>
          )}
          {results.map(post => (
            <SmartLink
              key={post.id || post.href}
              href={post.href}
              onClick={onClose}
              className='block rounded-lg px-3 py-2.5 transition-colors hover:bg-gray-100 dark:hover:bg-zinc-800'>
              <div className='text-sm font-medium text-gray-700 dark:text-gray-200'>
                {post.title}
              </div>
              <div className='mt-0.5 flex items-center gap-2 text-[11px] text-gray-400'>
                {post.category && <span>{post.category}</span>}
                {post.publishDay && <span>{post.publishDay}</span>}
                {Array.isArray(post.tagItems) && post.tagItems.length > 0 && (
                  <span className='truncate'>
                    {post.tagItems.slice(0, 3).map(tag => `#${tag.name}`).join(' ')}
                  </span>
                )}
              </div>
            </SmartLink>
          ))}
        </div>
      </div>
    </div>
  )
}
