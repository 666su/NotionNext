/**
 * 后台登录表单
 * - 未配置时只展示"缺少哪些环境变量"，不提供任何登录入口
 * - 失败统一文案；429 显示冷却剩余时间
 */

import { useState } from 'react'
import { useRouter } from 'next/router'

export default function AdminLogin({
  configured,
  configProblem,
  missing = [],
  nextPath = ''
}) {
  const router = useRouter()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    if (pending) return
    setError('')
    setPending(true)
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ username, password, next: nextPath })
      })
      const data = await response.json().catch(() => null)

      if (response.ok && data?.ok) {
        router.replace(data.redirect || '/admin/dashboard')
        return
      }

      if (response.status === 429) {
        const seconds = Number(data?.retryAfter || 0)
        const minutes = seconds > 60 ? Math.ceil(seconds / 60) : 0
        setError(
          minutes
            ? `尝试次数过多，请在约 ${minutes} 分钟后重试`
            : '尝试次数过多，请稍后重试'
        )
        return
      }
      if (response.status === 503) {
        setError('后台存储或配置不可用，请检查部署环境变量')
        return
      }
      setError('用户名或密码不正确')
    } catch (err) {
      setError('网络错误，请稍后重试')
    } finally {
      setPending(false)
    }
  }

  return (
    <div className='flex min-h-screen items-center justify-center bg-gray-100 px-4 dark:bg-[#0b0d10]'>
      <div className='w-full max-w-sm'>
        <div className='mb-6 text-center'>
          <div className='mx-auto mb-3 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-gray-900 text-sm font-bold text-white dark:bg-gray-100 dark:text-gray-900'>
            J
          </div>
          <h1 className='text-lg font-semibold text-gray-900 dark:text-gray-100'>
            Jason Blog Admin
          </h1>
          <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
            管理员登录 · 公开页面不受影响
          </p>
        </div>

        {!configured ? (
          <div className='rounded-lg border border-red-300 bg-white p-4 text-sm dark:border-red-700/60 dark:bg-[#0f1115]'>
            <p className='font-medium text-red-700 dark:text-red-300'>
              后台尚未完成初始化
            </p>
            <p className='mt-2 text-xs leading-relaxed text-gray-600 dark:text-gray-300'>
              {configProblem}
            </p>
            {missing.length > 0 && (
              <ul className='mt-2 space-y-1 text-xs text-gray-600 dark:text-gray-400'>
                {missing.map(item => (
                  <li key={item}>
                    · <code className='rounded bg-gray-100 px-1 dark:bg-gray-800'>{item}</code>
                  </li>
                ))}
              </ul>
            )}
            <p className='mt-3 text-[11px] leading-relaxed text-gray-500 dark:text-gray-500'>
              提示：用 <code>node scripts/admin-hash-password.mjs &quot;密码&quot;</code> 生成
              ADMIN_PASSWORD_HASH；用 <code>node scripts/admin-gen-secret.mjs</code> 生成
              SESSION_SECRET。
            </p>
          </div>
        ) : (
          <form
            onSubmit={event => {
              void handleSubmit(event)
            }}
            className='space-y-3 rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-[#0f1115]'>
            <div>
              <label
                htmlFor='admin-username'
                className='mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300'>
                管理员账号
              </label>
              <input
                id='admin-username'
                name='username'
                autoComplete='username'
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:bg-[#0b0d10] dark:text-gray-100 dark:focus:border-gray-400'
                value={username}
                onChange={event => setUsername(event.target.value)}
                required
              />
            </div>

            <div>
              <label
                htmlFor='admin-password'
                className='mb-1 block text-xs font-medium text-gray-600 dark:text-gray-300'>
                密码
              </label>
              <input
                id='admin-password'
                name='password'
                type='password'
                autoComplete='current-password'
                className='w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus:border-gray-900 dark:border-gray-700 dark:bg-[#0b0d10] dark:text-gray-100 dark:focus:border-gray-400'
                value={password}
                onChange={event => setPassword(event.target.value)}
                required
              />
            </div>

            {error && (
              <p
                role='alert'
                className='rounded-md bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300'>
                {error}
              </p>
            )}

            <button
              type='submit'
              disabled={pending}
              className='w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200'>
              {pending ? '登录中…' : '登录'}
            </button>

            <p className='text-[11px] leading-relaxed text-gray-400 dark:text-gray-500'>
              登录失败会触发限流（默认 5 次 / 15 分钟）；成功与失败均记入审计日志。
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
