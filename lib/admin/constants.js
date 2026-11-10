/**
 * 后台常量 —— 纯常量模块，**不得**引入 node 内置模块或 ioredis。
 * 原因：middleware（Edge runtime）会 import 本文件。
 */

export const ADMIN_BASE_PATH = '/admin'
export const ADMIN_LOGIN_PATH = '/admin/login'
export const ADMIN_API_BASE = '/api/admin'
export const ADMIN_LOGIN_API = '/api/admin/login'
export const ADMIN_INIT_API = '/api/admin/init'

// Cookie
export const SESSION_COOKIE = 'jba_sid'
export const CSRF_COOKIE = 'jba_csrf'

// Redis 键空间（与 ISR 缓存 / rank / notify 严格分家）
export const KV_SESSION = 'admin:sess:'
export const KV_SESSION_UID = 'admin:sess:uid:'
export const KV_USER = 'admin:user:'
export const KV_BOOT = 'admin:bootstrapped'
export const KV_LOGIN_FAIL = 'admin:rl:login:'
export const KV_LOGIN_IP = 'admin:rl:login:ip:'
export const KV_AUDIT = 'admin:audit'

// 后台导航（顺序即侧边栏顺序）
export const ADMIN_NAV = [
  { key: 'dashboard', href: '/admin/dashboard', label: '数据总览', group: 'main' },
  { key: 'analytics', href: '/admin/analytics', label: '流量分析', group: 'main' },
  { key: 'visitors', href: '/admin/visitors', label: '访客分析', group: 'main' },
  { key: 'behavior', href: '/admin/behavior', label: '行为分析', group: 'main' },
  { key: 'articles', href: '/admin/articles', label: '文章管理', group: 'content' },
  { key: 'categories', href: '/admin/categories', label: '分类与标签', group: 'content' },
  { key: 'comments', href: '/admin/comments', label: '评论统计', group: 'content' },
  { key: 'digest', href: '/admin/digest', label: '每日总结', group: 'ops' },
  { key: 'seo', href: '/admin/seo', label: 'SEO 分析', group: 'ops' },
  { key: 'health', href: '/admin/health', label: '网站健康', group: 'ops' },
  { key: 'settings', href: '/admin/settings', label: '系统设置', group: 'ops' }
]
