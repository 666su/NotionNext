/**
 * /admin —— 后台入口
 * 已登录 → /admin/dashboard；未登录 → /admin/login（由守卫统一跳转）
 */

import AdminBlocked from '@/components/admin/AdminBlocked'
import { adminPageGuard } from '@/lib/admin/page-guard'

export default function AdminIndex({ adminBlocked, missing, storeError }) {
  if (adminBlocked) {
    return <AdminBlocked missing={missing} storeError={storeError} />
  }
  return null
}

export async function getServerSideProps(ctx) {
  const guard = await adminPageGuard(ctx, { next: '/admin/dashboard' })
  if (guard.redirect) return guard

  if (guard.props?.adminBlocked) {
    return { props: guard.props }
  }

  return {
    redirect: { destination: '/admin/dashboard', permanent: false }
  }
}
