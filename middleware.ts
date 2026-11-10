import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextRequest, NextResponse } from 'next/server'
import type { NextFetchEvent } from 'next/server'
import { checkStrIsNotionId, getLastPartOfUrl } from '@/lib/utils'
import { idToUuid } from 'notion-utils'
import BLOG from './blog.config'
import {
  ADMIN_BASE_PATH,
  ADMIN_LOGIN_PATH,
  SESSION_COOKIE
} from './lib/admin/constants'

/**
 * Clerk 身份验证中间件
 */
export const config = {
  // 这里设置白名单，防止静态资源被拦截
  matcher: ['/((?!.*\\..*|_next|/sign-in|/auth).*)', '/', '/(api|trpc)(.*)']
}

// 限制登录访问的路由
const isTenantRoute = createRouteMatcher([
  '/user/organization-selector(.*)',
  '/user/orgid/(.*)',
  '/dashboard',
  '/dashboard/(.*)'
])

// 限制权限访问的路由
const isTenantAdminRoute = createRouteMatcher([
  '/admin/(.*)/memberships',
  '/admin/(.*)/domain'
])

/**
 * 没有配置权限相关功能的返回
 * @param req
 * @param ev
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unused-vars
const noAuthMiddleware = async (req: NextRequest, ev: any) => {
  // 如果没有配置 Clerk 相关环境变量，返回一个默认响应或者继续处理请求
  if (BLOG['UUID_REDIRECT']) {
    let redirectJson: Record<string, string> = {}
    try {
      const response = await fetch(`${req.nextUrl.origin}/redirect.json`)
      if (response.ok) {
        redirectJson = (await response.json()) as Record<string, string>
      }
    } catch (err) {
      console.error('Error fetching static file:', err)
    }
    let lastPart = getLastPartOfUrl(req.nextUrl.pathname) as string
    if (checkStrIsNotionId(lastPart)) {
      lastPart = idToUuid(lastPart)
    }
    if (lastPart && redirectJson[lastPart]) {
      const redirectToUrl = req.nextUrl.clone()
      redirectToUrl.pathname = '/' + redirectJson[lastPart]
      console.log(
        `redirect from ${req.nextUrl.pathname} to ${redirectToUrl.pathname}`
      )
      return NextResponse.redirect(redirectToUrl, 308)
    }
  }
  return NextResponse.next()
}
/**
 * 鉴权中间件
 */
const authMiddleware = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
  ? clerkMiddleware((auth, req) => {
      const { userId } = auth()
      // 处理 /dashboard 路由的登录保护
      if (isTenantRoute(req)) {
        if (!userId) {
          // 用户未登录，重定向到 /sign-in
          const url = new URL('/sign-in', req.url)
          url.searchParams.set('redirectTo', req.url) // 保存重定向目标
          return NextResponse.redirect(url)
        }
      }

      // 处理管理员相关权限保护
      if (isTenantAdminRoute(req)) {
        auth().protect(has => {
          return (
            has({ permission: 'org:sys_memberships:manage' }) ||
            has({ permission: 'org:sys_domains_manage' })
          )
        })
      }

      // 默认继续处理请求
      return NextResponse.next()
    })
  : noAuthMiddleware

/* ------------------------------------------------------------------ *
 * Jason Blog Admin —— 前置守卫（Edge runtime）
 *
 * 只做"Cookie 存在 + HMAC 签名"的乐观校验（不访问 Redis），用于挡住绝大多数
 * 未登录请求并返回 302 / 401；**权威校验**在页面 GSSP 与每个 /api/admin/*
 * 端点内完成（见 lib/admin/respond.js#requireAdminApi / requireAdminPage）。
 *
 * Edge 限制：本段不得 import ioredis / node:crypto / fs / path。
 * ------------------------------------------------------------------ */

const encoder = new TextEncoder()

function base64urlToBuffer(input: string): ArrayBuffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/')
  const padded =
    normalized.length % 4 === 0
      ? normalized
      : normalized + '='.repeat(4 - (normalized.length % 4))
  const binary = atob(padded)
  const buffer = new ArrayBuffer(binary.length)
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return buffer
}

async function verifySessionCookie(
  raw: string | undefined,
  secret: string
): Promise<boolean> {
  if (!raw || !secret) return false
  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return false
  const sid = raw.slice(0, dot)
  const signature = raw.slice(dot + 1)
  if (!sid || !signature) return false
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    )
    return await crypto.subtle.verify(
      'HMAC',
      key,
      base64urlToBuffer(signature),
      encoder.encode(sid)
    )
  } catch (err) {
    return false
  }
}

function isAdminProtectedPath(pathname: string): boolean {
  const isAdminPage =
    pathname === ADMIN_BASE_PATH || pathname.startsWith(`${ADMIN_BASE_PATH}/`)
  const isAdminApi =
    pathname === '/api/admin' || pathname.startsWith('/api/admin/')
  if (!isAdminPage && !isAdminApi) return false
  // 公开入口：登录页 / 登录接口 / 一次性初始化接口
  if (pathname === ADMIN_LOGIN_PATH || pathname === '/api/admin/login') {
    return false
  }
  if (pathname === '/api/admin/init') return false
  return true
}

async function adminGuard(req: NextRequest): Promise<Response | null> {
  const secret = String(process.env.SESSION_SECRET || '')
  const raw = req.cookies.get(SESSION_COOKIE)?.value
  const valid = await verifySessionCookie(raw, secret)
  if (valid) return null

  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = req.nextUrl.clone()
  url.pathname = ADMIN_LOGIN_PATH
  url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`
  return NextResponse.redirect(url)
}

export default async function middleware(req: NextRequest, ev: NextFetchEvent) {
  if (isAdminProtectedPath(req.nextUrl.pathname)) {
    const denied = await adminGuard(req)
    if (denied) return denied
  }
  return authMiddleware(req, ev)
}
