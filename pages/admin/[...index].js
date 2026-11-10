/**
 * /admin/* 未匹配路径的兜底
 *
 * 目的：避免未定义的 /admin/xxx 落入 pages/[prefix]/[slug] 动态路由
 * （那会真实拉取 Notion 数据并按博客主题渲染）。这里先鉴权，再返回 404。
 */

import Link from 'next/link'
import AdminBlocked from '@/components/admin/AdminBlocked'
import { adminPageGuard } from '@/lib/admin/page-guard'

export default function AdminCatchAll(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }
  return (
    <div className='flex min-h-screen flex-col items-center justify-center gap-3 bg-gray-50 px-4 dark:bg-[#0b0d10]'>
      <p className='text-sm font-medium text-gray-800 dark:text-gray-100'>
        页面不存在
      </p>
      <p className='text-xs text-gray-500 dark:text-gray-400'>
        该后台路径尚未实现。
      </p>
      <Link
        href='/admin/dashboard'
        className='rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200'>
        返回数据总览
      </Link>
    </div>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx)
  if (guard.redirect) return guard
  if (guard.props?.adminBlocked) return { props: guard.props }

  if (ctx.res) ctx.res.statusCode = 404
  return { props: {} }
}
