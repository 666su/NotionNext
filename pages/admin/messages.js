/**
 * /admin/messages —— 私信管理（Phase 3）
 *
 * 复用现有后台：GSSP 守卫 + AdminShell 外壳 + adminFetch（带 CSRF）。
 * 不做邮件通知；访客通过自己的私密链接查看回复。
 */

import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminInbox from '@/components/admin/messages/AdminInbox'
import { adminPageGuard } from '@/lib/admin/page-guard'

export default function AdminMessagesPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }

  return (
    <AdminModulePage
      admin={props.admin}
      active='messages'
      title='私信管理'
      description='访客私信收件箱 · 回复后访客通过自己的私密链接查看'>
      <AdminInbox />
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/messages' })
  if (guard.redirect) return guard
  return guard
}
