/**
 * 后台未完成初始化时的整页提示（不渲染任何数据）
 */

import Link from 'next/link'

export default function AdminBlocked({ missing = [], storeError = false }) {
  return (
    <div className='flex min-h-screen items-center justify-center bg-gray-100 px-4 dark:bg-[#0b0d10]'>
      <div className='w-full max-w-lg rounded-lg border border-red-300 bg-white p-6 text-sm dark:border-red-700/60 dark:bg-[#0f1115]'>
        <h1 className='text-base font-semibold text-red-700 dark:text-red-300'>
          后台不可用：配置未完成
        </h1>
        <p className='mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300'>
          {storeError
            ? '会话存储（Redis）当前不可用，后台按 fail-closed 策略拒绝访问。请检查 REDIS_URL 与实例状态。'
            : '后台按 fail-closed 策略拒绝访问。请在部署平台补齐下列环境变量后重新部署。'}
        </p>

        {missing.length > 0 && (
          <ul className='mt-3 space-y-1 text-xs text-gray-700 dark:text-gray-300'>
            {missing.map(item => (
              <li key={item}>
                · <code className='rounded bg-gray-100 px-1 dark:bg-gray-800'>{item}</code>
              </li>
            ))}
          </ul>
        )}

        <div className='mt-4 space-y-1 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400'>
          <p>
            · 生成密码哈希：<code>node scripts/admin-hash-password.mjs &quot;你的密码&quot;</code>
          </p>
          <p>
            · 生成会话密钥：<code>node scripts/admin-gen-secret.mjs</code>
          </p>
          <p>· 变量：ADMIN_USERNAME / ADMIN_PASSWORD_HASH / SESSION_SECRET / REDIS_URL</p>
        </div>

        <Link
          href='/'
          className='mt-5 inline-block rounded-md border border-gray-300 px-3 py-1.5 text-xs text-gray-700 dark:border-gray-700 dark:text-gray-200'>
          返回博客首页
        </Link>
      </div>
    </div>
  )
}
