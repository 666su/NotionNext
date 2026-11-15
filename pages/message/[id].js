/**
 * /message/[id] —— 访客私密会话页（Phase 2）
 *
 * 特性：
 * - **静态路由优先**于 pages/[prefix]/[slug]，因此不会被文章路由吞掉（Phase 0 的 R2）
 * - `_app.js` 里对 /message/* 走独立分支：不套博客主题、不加载第三方插件、不挂桌宠与统计
 * - 凭证从 URL fragment 读取（不会发给服务器），兑换成功后立刻清掉 hash
 * - 服务端禁止缓存 + noindex（响应头在 GSSP 里设置）
 */

import Head from 'next/head'
import Link from 'next/link'
import { useEffect, useState } from 'react'
import MessageThread from '@/components/messages/MessageThread'

export default function MessagePage({ id }) {
  const [token, setToken] = useState('')
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // fragment 只存在于浏览器；先取出来交给 MessageThread，再由它兑换
    const hash = String(window.location.hash || '').replace(/^#/, '')
    setToken(hash)
    setMounted(true)
  }, [])

  return (
    <div className='flex min-h-screen flex-col bg-gray-50 text-gray-900 dark:bg-[#0b0d10] dark:text-gray-100'>
      <Head>
        <title>私信 · Jason Blog</title>
        <meta name='robots' content='noindex, nofollow, noarchive' />
        <meta name='referrer' content='no-referrer' />
      </Head>

      <header className='border-b border-gray-200 bg-white/80 backdrop-blur dark:border-gray-800 dark:bg-[#0f1115]/80'>
        <div className='mx-auto flex w-full max-w-3xl items-center justify-between gap-3 px-4 py-3'>
          <div className='min-w-0'>
            <p className='truncate text-sm font-semibold'>Jason Blog · 私信</p>
            <p className='text-[11px] text-gray-400 dark:text-gray-500'>私密会话 · 仅你与博主可见</p>
          </div>
          <Link
            href='/'
            className='shrink-0 rounded-md border border-gray-300 px-2.5 py-1.5 text-xs text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'>
            回到博客
          </Link>
        </div>
      </header>

      <main className='mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 py-4'>
        <section className='flex min-h-0 flex-1 flex-col rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0f1115]'>
          {mounted ? (
            <MessageThread conversationId={id} token={token} className='min-h-[60vh]' />
          ) : (
            <p className='py-10 text-center text-xs text-gray-400 dark:text-gray-500'>正在打开会话…</p>
          )}
        </section>

        <p className='mt-3 text-center text-[11px] leading-relaxed text-gray-400 dark:text-gray-500'>
          这条链接就是访问凭证：请勿转发到公开群组；清理浏览器数据后需要重新打开它。
        </p>
      </main>
    </div>
  )
}

export function getServerSideProps(ctx) {
  // 私密页禁止任何缓存与索引（双保险：页面 meta + 响应头）
  ctx.res.setHeader('Cache-Control', 'private, no-store, max-age=0, must-revalidate')
  ctx.res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
  ctx.res.setHeader('Referrer-Policy', 'no-referrer')
  ctx.res.setHeader('X-Content-Type-Options', 'nosniff')
  ctx.res.setHeader('X-Frame-Options', 'DENY')

  return {
    props: {
      id: String(ctx.params?.id || '')
    }
  }
}
