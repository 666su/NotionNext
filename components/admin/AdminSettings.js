/**
 * 系统设置：修改密码 + 会话/存储状态 + 审计日志
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { adminFetch } from '@/lib/admin/client'

const ACTION_LABELS = {
  'login.success': '登录成功',
  'login.failure': '登录失败',
  'login.rate_limited': '登录被限流',
  logout: '退出登录',
  'password.change': '修改密码',
  'init.success': '初始化',
  'init.attempt': '初始化尝试'
}

function formatTime(value) {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString('zh-CN', { hour12: false })
  } catch (err) {
    return String(value)
  }
}

export default function AdminSettings({ admin, store, warnings = [] }) {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState(null)
  const [pending, setPending] = useState(false)
  const [entries, setEntries] = useState([])
  const [auditError, setAuditError] = useState('')
  const [auditLoading, setAuditLoading] = useState(true)

  const loadAudit = useCallback(async () => {
    setAuditLoading(true)
    setAuditError('')
    const result = await adminFetch('/api/admin/audit?limit=50')
    if (result.ok && Array.isArray(result.data?.entries)) {
      setEntries(result.data.entries)
    } else if (result.status !== 401) {
      setAuditError('审计日志读取失败' + (result.data?.error ? `（${result.data.error}）` : ''))
    }
    setAuditLoading(false)
  }, [])

  useEffect(() => {
    void loadAudit()
  }, [loadAudit])

  async function handlePasswordChange(event) {
    event.preventDefault()
    if (pending) return

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: '两次输入的新密码不一致' })
      return
    }

    setPending(true)
    setMessage(null)
    const result = await adminFetch('/api/admin/password', {
      method: 'POST',
      body: { currentPassword, newPassword }
    })
    setPending(false)

    if (result.ok) {
      setMessage({
        type: 'ok',
        text: '密码已修改，所有会话已失效，正在跳转登录页…'
      })
      setTimeout(() => {
        void router.replace('/admin/login')
      }, 1200)
      return
    }

    const code = result.data?.error || 'error'
    const textMap = {
      current_password_invalid: '当前密码不正确',
      weak_password: result.data?.message || '新密码强度不足',
      password_unchanged: '新密码不能与当前密码相同',
      csrf_failed: '请求校验失败，请刷新页面后重试',
      session_store_unavailable: '存储不可用，请稍后重试'
    }
    setMessage({ type: 'error', text: textMap[code] || '修改失败，请稍后重试' })
    setCurrentPassword('')
  }

  return (
    <div className='space-y-6'>
      {warnings.length > 0 && (
        <div className='rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200'>
          {warnings.map(item => (
            <p key={item}>· {item}</p>
          ))}
        </div>
      )}

      <section className='rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0f1115]'>
        <h2 className='text-sm font-semibold'>账户</h2>
        <dl className='mt-3 grid gap-2 text-sm sm:grid-cols-2'>
          <div>
            <dt className='text-xs text-gray-500 dark:text-gray-400'>管理员账号</dt>
            <dd className='mt-0.5 font-medium'>{admin?.username || '—'}</dd>
          </div>
          <div>
            <dt className='text-xs text-gray-500 dark:text-gray-400'>会话存储</dt>
            <dd className='mt-0.5 font-medium'>
              {store === 'redis' ? 'Redis（生产）' : '内存（仅本地开发）'}
            </dd>
          </div>
        </dl>
      </section>

      <section className='rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0f1115]'>
        <h2 className='text-sm font-semibold'>修改密码</h2>
        <p className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
          修改成功后，所有已登录会话（含当前）立即失效，需要重新登录。
        </p>

        <form
          onSubmit={event => {
            void handlePasswordChange(event)
          }}
          className='mt-3 grid gap-3 sm:max-w-md'>
          <div>
            <label className='mb-1 block text-xs text-gray-600 dark:text-gray-300'>
              当前密码
            </label>
            <input
              type='password'
              autoComplete='current-password'
              value={currentPassword}
              onChange={event => setCurrentPassword(event.target.value)}
              required
              className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0b0d10]'
            />
          </div>
          <div>
            <label className='mb-1 block text-xs text-gray-600 dark:text-gray-300'>
              新密码（至少 12 位，含字母与数字）
            </label>
            <input
              type='password'
              autoComplete='new-password'
              value={newPassword}
              onChange={event => setNewPassword(event.target.value)}
              required
              className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0b0d10]'
            />
          </div>
          <div>
            <label className='mb-1 block text-xs text-gray-600 dark:text-gray-300'>
              确认新密码
            </label>
            <input
              type='password'
              autoComplete='new-password'
              value={confirmPassword}
              onChange={event => setConfirmPassword(event.target.value)}
              required
              className='w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-[#0b0d10]'
            />
          </div>

          {message && (
            <p
              className={`rounded-md px-3 py-2 text-xs ${
                message.type === 'ok'
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300'
              }`}>
              {message.text}
            </p>
          )}

          <button
            type='submit'
            disabled={pending}
            className='justify-self-start rounded-md bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-60 dark:bg-gray-100 dark:text-gray-900'>
            {pending ? '提交中…' : '修改密码'}
          </button>
        </form>
      </section>

      <section className='rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-[#0f1115]'>
        <div className='flex items-center justify-between'>
          <h2 className='text-sm font-semibold'>审计日志（最近 50 条）</h2>
          <button
            onClick={() => {
              void loadAudit()
            }}
            disabled={auditLoading}
            className='rounded-md border border-gray-300 px-2 py-1 text-xs disabled:opacity-60 dark:border-gray-700'>
            {auditLoading ? '加载中…' : '刷新'}
          </button>
        </div>

        {auditError && (
          <p className='mt-2 text-xs text-red-600 dark:text-red-400'>{auditError}</p>
        )}

        {!auditError && !auditLoading && entries.length === 0 && (
          <p className='mt-3 text-xs text-gray-500 dark:text-gray-400'>
            暂无审计记录。
          </p>
        )}

        {entries.length > 0 && (
          <div className='mt-3 overflow-x-auto'>
            <table className='w-full text-left text-xs'>
              <thead className='text-gray-500 dark:text-gray-400'>
                <tr>
                  <th className='whitespace-nowrap py-1.5 pr-3 font-medium'>时间</th>
                  <th className='whitespace-nowrap py-1.5 pr-3 font-medium'>动作</th>
                  <th className='whitespace-nowrap py-1.5 pr-3 font-medium'>结果</th>
                  <th className='whitespace-nowrap py-1.5 pr-3 font-medium'>账号</th>
                  <th className='whitespace-nowrap py-1.5 font-medium'>IP 指纹</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr
                    key={`${entry.at}-${index}`}
                    className='border-t border-gray-100 dark:border-gray-800'>
                    <td className='whitespace-nowrap py-1.5 pr-3'>
                      {formatTime(entry.at)}
                    </td>
                    <td className='whitespace-nowrap py-1.5 pr-3'>
                      {ACTION_LABELS[entry.action] || entry.action}
                    </td>
                    <td className='whitespace-nowrap py-1.5 pr-3'>
                      {entry.result === 'ok' ? '成功' : '拒绝'}
                    </td>
                    <td className='whitespace-nowrap py-1.5 pr-3'>
                      {entry.user || '—'}
                    </td>
                    <td className='whitespace-nowrap py-1.5 text-gray-400'>
                      {entry.ipHash ? `${entry.ipHash.slice(0, 8)}…` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
