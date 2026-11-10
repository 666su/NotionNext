/**
 * 后台页面统一的 GSSP 守卫封装
 * 返回 Next 的 props / redirect 对象；页面只需判断 redirect 与 adminBlocked。
 */

import { requireAdminPage } from './respond'

export async function adminPageGuard(ctx, options = {}) {
  const guard = await requireAdminPage(ctx, options)

  if (guard.ok) {
    const { record } = guard.session
    return {
      props: {
        admin: { username: record.uid, role: record.role },
        csrfToken: record.csrf,
        store: guard.config.backend,
        warnings: guard.config.warnings || []
      }
    }
  }

  if (guard.unconfigured) {
    if (ctx?.res?.setHeader) {
      ctx.res.statusCode = 503
    }
    return {
      props: {
        adminBlocked: true,
        missing: guard.config?.missing || [],
        warnings: guard.config?.warnings || [],
        storeError: !!guard.storeError
      }
    }
  }

  return { redirect: guard.redirect }
}
