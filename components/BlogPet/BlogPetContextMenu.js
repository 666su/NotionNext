/**
 * Blog Pet 右键菜单（桌面端右键 / 移动端长按）
 * 只拦截桌宠自身的右键，不影响文章正文的复制与链接菜单
 */
'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { getViewport } from './blogPetUtils'

const FREQUENCY_LABELS = [
  { key: 'off', label: '关闭' },
  { key: 'low', label: '低频' },
  { key: 'standard', label: '标准' }
]

export function BlogPetContextMenu({ menu, settings, onAction, onClose }) {
  const menuRef = useRef(null)
  const [pos, setPos] = useState({ left: menu.x, top: menu.y })

  // 菜单在视口边缘自动收拢，避免被裁切
  useLayoutEffect(() => {
    if (!menu.open || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const viewport = getViewport()
    const edge = 8
    setPos({
      left: Math.max(edge, Math.min(menu.x, viewport.width - rect.width - edge)),
      top: Math.max(edge, Math.min(menu.y, viewport.height - rect.height - edge))
    })
  }, [menu.open, menu.x, menu.y])

  useEffect(() => {
    if (!menu.open) return undefined
    const handleKey = event => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [menu.open, onClose])

  if (!menu.open) return null

  const toggleItem = (key, label, value) => (
    <button
      type='button'
      role='menuitemcheckbox'
      aria-checked={value}
      className='blog-pet-menu-item'
      onClick={() => onAction(key, !value)}
    >
      <span>{label}</span>
      <span className='blog-pet-menu-state'>{value ? '开' : '关'}</span>
    </button>
  )

  return (
    <div
      ref={menuRef}
      className='blog-pet-menu'
      style={{ left: pos.left, top: pos.top }}
      role='menu'
      aria-label='桌宠功能菜单'
      onContextMenu={event => event.preventDefault()}
    >
      <button
        type='button'
        role='menuitem'
        className='blog-pet-menu-item'
        onClick={() => onAction('dialog')}
      >
        <span>打开对话</span>
        <span className='blog-pet-menu-state'>↗</span>
      </button>

      {toggleItem('freeMove', '自由移动', settings.freeMove)}
      {toggleItem('autoBubble', '自动气泡', settings.autoBubble)}

      <div className='blog-pet-menu-row' role='group' aria-label='气泡频率'>
        <span className='blog-pet-menu-row-label'>气泡频率</span>
        <div className='blog-pet-menu-segment'>
          {FREQUENCY_LABELS.map(item => (
            <button
              key={item.key}
              type='button'
              className={`blog-pet-menu-segment-btn ${
                settings.bubbleFrequency === item.key ? 'is-active' : ''
              }`}
              onClick={() => onAction('bubbleFrequency', item.key)}
              aria-pressed={settings.bubbleFrequency === item.key}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {toggleItem('animation', '桌宠动画', settings.animation)}

      <button
        type='button'
        role='menuitem'
        className='blog-pet-menu-item'
        onClick={() => onAction('resetPosition')}
      >
        <span>重置位置</span>
      </button>

      <button
        type='button'
        role='menuitem'
        className='blog-pet-menu-item'
        onClick={() => onAction('about')}
      >
        <span>关于桌宠</span>
      </button>

      <button
        type='button'
        role='menuitem'
        className='blog-pet-menu-item is-danger'
        onClick={() => onAction('hide')}
      >
        <span>隐藏桌宠</span>
      </button>
    </div>
  )
}

export default BlogPetContextMenu
