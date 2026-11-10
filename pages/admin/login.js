/**
 * /admin/login —— 管理员登录
 * 已登录直接跳转；未配置时只展示缺少哪些环境变量。
 */

import AdminLogin from '@/components/admin/AdminLogin'
import { describeAdminConfigProblem, readAdminConfig } from '@/lib/admin/config'
import { safeNextPath, setSecurityHeaders } from '@/lib/admin/respond'
import { readSession } from '@/lib/admin/session'

export default function AdminLoginPage({
  configured,
  configProblem,
  missing,
  nextPath
}) {
  return (
    <AdminLogin
      configured={configured}
      configProblem={configProblem}
      missing={missing}
      nextPath={nextPath}
    />
  )
}

export async function getServerSideProps(ctx) {
  setSecurityHeaders(ctx.res)

  const config = readAdminConfig()
  const nextPath = safeNextPath(ctx.query?.next) || ''

  if (!config.ready) {
    if (ctx.res) ctx.res.statusCode = 503
    return {
      props: {
        configured: false,
        configProblem: describeAdminConfigProblem(config),
        missing: config.missing,
        nextPath
      }
    }
  }

  const token = ctx.req?.cookies?.[config.cookieName]
  if (token) {
    try {
      const session = await readSession(token, config.sessionSecret)
      if (session) {
        return {
          redirect: {
            destination: nextPath || '/admin/dashboard',
            permanent: false
          }
        }
      }
    } catch (err) {
      console.error('[admin][login-page] session read failed:', err?.message || err)
    }
  }

  return {
    props: { configured: true, configProblem: '', missing: [], nextPath }
  }
}
