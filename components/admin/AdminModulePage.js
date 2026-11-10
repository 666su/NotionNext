/**
 * 后台二级页面的通用外壳（标题 + 说明 + 内容 + 顶栏操作）
 * 每个模块页只负责传标题与内容，避免重复样板代码。
 */

import AdminShell from './AdminShell'

export default function AdminModulePage({
  admin,
  active,
  title,
  description,
  actions,
  children
}) {
  return (
    <AdminShell
      admin={admin}
      active={active}
      title={title}
      description={description}
      actions={actions}>
      {children}
    </AdminShell>
  )
}
