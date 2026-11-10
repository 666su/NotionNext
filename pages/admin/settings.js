/**
 * /admin/settings —— 系统设置（账户 / 改密 / 审计日志）
 */

import AdminBlocked from '@/components/admin/AdminBlocked'
import AdminModulePage from '@/components/admin/AdminModulePage'
import AdminSettings from '@/components/admin/AdminSettings'
import { adminPageGuard } from '@/lib/admin/page-guard'

export default function SettingsPage(props) {
  if (props.adminBlocked) {
    return <AdminBlocked missing={props.missing} storeError={props.storeError} />
  }

  return (
    <AdminModulePage
      admin={props.admin}
      active='settings'
      title='系统设置'
      description='管理员账户、密码与会话；所有敏感操作都会写入审计日志'>
      <AdminSettings
        admin={props.admin}
        store={props.store}
        warnings={props.warnings}
      />
    </AdminModulePage>
  )
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/settings' })
  if (guard.redirect) return guard
  return guard
}
