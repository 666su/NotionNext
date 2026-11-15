/**
 * 后台外壳：左侧导航 + 顶栏 + 内容区
 * 只用于 /admin/*；由 pages/_app.js 的后台分支保证不被博客主题包裹。
 */

import Link from 'next/link'
import { useRouter } from 'next/router'
import { useEffect, useMemo, useState } from 'react'
import { ADMIN_NAV } from '@/lib/admin/constants'
import { adminFetch } from '@/lib/admin/client'

const GROUP_LABELS = {
  main: '数据',
  content: '内容管理',
  ops: '运营与系统'
}

export default function AdminShell({
  admin,
  active,
  title,
  description,
  actions,
  children
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const [unreadMessages, setUnreadMessages] = useState(0)

  // 私信未读徽标：20 秒轮询一次轻量统计（Q3 决策）；页面隐藏时跳过
  useEffect(() => {
    let cancelled = false
    async function poll() {
      try {
        const res = await adminFetch('/api/admin/messages/stats')
        if (!cancelled && res.ok && res.data?.ok) {
          setUnreadMessages(Number(res.data.unreadConversations) || 0)
        }
      } catch (err) {
        /* 徽标失败不影响后台使用 */
      }
    }
    void poll()
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void poll()
    }, 20000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const groups = useMemo(() => {
    const order = ['main', 'content', 'ops']
    return order
      .map(group => ({
        group,
        label: GROUP_LABELS[group],
        items: ADMIN_NAV.filter(item => item.group === group)
      }))
      .filter(g => g.items.length)
  }, [])

  async function handleLogout() {
    setLoggingOut(true)
    try {
      await adminFetch('/api/admin/logout', { method: 'POST', body: {} })
    } catch (err) {
      // 忽略网络错误：仍然回到登录页
    }
    router.replace('/admin/login')
  }

  return (
    <div className='min-h-screen bg-gray-50 text-gray-900 dark:bg-[#0b0d10] dark:text-gray-100'>
      {/* 移动端遮罩 */}
      {open && (
        <button
          aria-label='关闭菜单'
          className='fixed inset-0 z-30 bg-black/40 md:hidden'
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-60 transform border-r border-gray-200 bg-white transition-transform duration-200 dark:border-gray-800 dark:bg-[#0f1115] md:translate-x-0 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}>
        <div className='flex h-14 items-center gap-2 border-b border-gray-200 px-4 dark:border-gray-800'>
          <span className='inline-flex h-6 w-6 items-center justify-center rounded bg-gray-900 text-xs font-bold text-white dark:bg-gray-100 dark:text-gray-900'>
            J
          </span>
          <span className='truncate text-sm font-semibold'>Jason Blog Admin</span>
        </div>

        <nav className='space-y-6 overflow-y-auto p-3'>
          {groups.map(({ group, label, items }) => (
            <div key={group}>
              {label && (
                <p className='mb-1 px-2 text-[11px] font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500'>
                  {label}
                </p>
              )}
              <ul className='space-y-0.5'>
                {items.map(item => {
                  const isActive = item.key === active
                  return (
                    <li key={item.key}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className={`flex items-center rounded-md px-2.5 py-2 text-sm transition-colors ${
                          isActive
                            ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                        }`}>
                        <span className='flex-1 truncate'>{item.label}</span>
                        {item.key === 'messages' && unreadMessages > 0 && (
                          <span
                            aria-label={`${unreadMessages} 条未读私信`}
                            className={`ml-1 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                              isActive
                                ? 'bg-white/20 text-white dark:bg-gray-900/20 dark:text-gray-900'
                                : 'bg-red-500 text-white'
                            }`}>
                            {unreadMessages > 99 ? '99+' : unreadMessages}
                          </span>
                        )}
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className='absolute inset-x-0 bottom-0 border-t border-gray-200 p-3 text-[11px] text-gray-400 dark:border-gray-800 dark:text-gray-500'>
          仅管理员可访问 · 所有操作均记入审计日志
        </div>
      </aside>

      <div className='md:pl-60'>
        <header className='sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-gray-200 bg-white/90 px-4 backdrop-blur dark:border-gray-800 dark:bg-[#0f1115]/90'>
          <button
            className='rounded-md border border-gray-200 px-2 py-1 text-sm md:hidden dark:border-gray-700'
            onClick={() => setOpen(true)}>
            菜单
          </button>
          <div className='min-w-0 flex-1'>
            <h1 className='truncate text-sm font-semibold'>{title}</h1>
            {description && (
              <p className='truncate text-[11px] text-gray-500 dark:text-gray-400'>
                {description}
              </p>
            )}
          </div>
          <div className='flex items-center gap-2'>
            {actions}
            <span className='hidden text-xs text-gray-500 sm:inline dark:text-gray-400'>
              {admin?.username || 'admin'}
            </span>
            <button
              onClick={() => {
                void handleLogout()
              }}
              disabled={loggingOut}
              className='rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'>
              {loggingOut ? '退出中…' : '退出登录'}
            </button>
          </div>
        </header>

        <main className='w-full px-4 py-6 md:px-8'>{children}</main>
      </div>
    </div>
  )
}
