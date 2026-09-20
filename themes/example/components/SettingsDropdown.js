import { useState, useEffect, useRef } from 'react'

/**
 * 新增文章系列展示功能 - 桌面端设置
 * 搜索栏旁的设置按钮，下拉面板包含：文字大小、夜间模式、语言切换、通知推送
 */

const FONT_SIZES = [
  { label: '小', value: 0.875 },
  { label: '标准', value: 1 },
  { label: '大', value: 1.125 },
  { label: '特大', value: 1.25 }
]

/** Base64URL → Uint8Array（浏览器 PushManager 需要） */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export const SettingsDropdown = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [fontScale, setFontScale] = useState(1)
  const [isDark, setIsDark] = useState(false)
  const [pushStatus, setPushStatus] = useState('checking') // checking | unsupported | idle | subscribed | error
  const [subInfo, setSubInfo] = useState(null)
  const [testStatus, setTestStatus] = useState('')
  const ref = useRef(null)

  // 初始化：读取已保存的字号
  useEffect(() => {
    try {
      const saved = localStorage.getItem('desktop_font_scale')
      const scale = parseFloat(saved)
      if (scale > 0) {
        setFontScale(scale)
        document.documentElement.style.setProperty('--article-font-scale', String(scale))
      }
    } catch (e) {}
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [])

  // 初始化：检查推送订阅状态
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setPushStatus('unsupported')
      return
    }
    navigator.serviceWorker
      .getRegistration()
      .then(reg => (reg ? reg.pushManager.getSubscription() : null))
      .then(sub => {
        if (sub) {
          setPushStatus('subscribed')
          setSubInfo(JSON.parse(JSON.stringify(sub)))
        } else {
          setPushStatus('idle')
        }
      })
      .catch(() => setPushStatus('error'))
  }, [])

  // 点击外部关闭
  useEffect(() => {
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // 应用字号
  const applyFontScale = scale => {
    setFontScale(scale)
    try {
      localStorage.setItem('desktop_font_scale', String(scale))
    } catch (e) {}
    document.documentElement.style.setProperty('--article-font-scale', String(scale))
  }

  // 切换夜间模式
  const toggleDarkMode = () => {
    const root = document.documentElement
    root.classList.toggle('dark')
    const nowDark = root.classList.contains('dark')
    setIsDark(nowDark)
    try {
      localStorage.setItem('theme', nowDark ? 'dark' : 'light')
    } catch (e) {}
  }

  // ========== 新增推送通知功能：订阅/取消订阅 ==========
  const togglePush = async () => {
    if (pushStatus === 'subscribed') {
      // 取消订阅
      try {
        await subInfo?.unsubscribe?.()
        await fetch('/api/push/subscribe', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subInfo?.endpoint })
        })
        setPushStatus('idle')
        setSubInfo(null)
      } catch (e) {
        console.warn('[notify] 取消订阅失败:', e.message)
      }
      return
    }
    // 订阅推送
    try {
      const reg = await navigator.serviceWorker.register('/sw.js')
      const { publicKey } = await (await fetch('/api/push/vapid-public-key')).json()
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey)
      })
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(JSON.parse(JSON.stringify(sub)))
      })
      setPushStatus('subscribed')
      setSubInfo(JSON.parse(JSON.stringify(sub)))
    } catch (e) {
      console.warn('[notify] 订阅失败:', e.message)
      setPushStatus('error')
    }
  }

  // 发送测试通知
  const sendTestPush = async () => {
    if (!subInfo) return
    setTestStatus('sending')
    try {
      await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscription: subInfo })
      })
      setTestStatus('sent')
      setTimeout(() => setTestStatus(''), 3000)
    } catch (e) {
      setTestStatus('failed')
      setTimeout(() => setTestStatus(''), 3000)
    }
  }

  // 推送状态文本
  const pushLabel = {
    checking: '检测中…',
    unsupported: '浏览器不支持推送',
    idle: '未订阅',
    subscribed: '已订阅 ✅',
    error: '订阅失败'
  }[pushStatus]

  return (
    <div className='relative' ref={ref}>
      {/* 设置按钮 */}
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
          isOpen
            ? 'bg-gray-200 dark:bg-zinc-700 text-gray-800 dark:text-gray-100'
            : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
        }`}
        aria-label='设置'>
        <i
          className={`fas fa-cog text-sm transition-transform duration-300 ${isOpen ? 'rotate-90' : ''}`}>
        </i>
      </button>

      {/* 下拉面板 */}
      {isOpen && (
        <div className='absolute right-0 top-full mt-2 w-56 bg-white dark:bg-zinc-800 rounded-xl shadow-lg border border-gray-100 dark:border-zinc-700 py-3 z-50'>
          {/* 文字大小 */}
          <div className='px-4 pb-3'>
            <div className='text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wider'>
              文字大小
            </div>
            <div className='flex gap-1.5'>
              {FONT_SIZES.map(size => (
                <button
                  key={size.value}
                  onClick={() => applyFontScale(size.value)}
                  className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    Math.abs(fontScale - size.value) < 0.01
                      ? 'bg-blue-500 text-white border-blue-500'
                      : 'bg-transparent text-gray-600 dark:text-gray-300 border-gray-200 dark:border-zinc-600 hover:border-blue-300 dark:hover:border-blue-500'
                  }`}>
                  {size.label}
                </button>
              ))}
            </div>
          </div>

          <div className='border-t border-gray-100 dark:border-zinc-700 mx-4'></div>

          {/* 夜间模式 */}
          <div className='px-4 py-3 flex items-center justify-between'>
            <span className='text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2'>
              <i
                className={`fas ${isDark ? 'fa-sun text-amber-500' : 'fa-moon text-gray-400'} text-xs`}></i>
              {isDark ? '日间模式' : '夜间模式'}
            </span>
            <button
              onClick={toggleDarkMode}
              className={`relative w-10 rounded-full transition-colors duration-300 ${
                isDark ? 'bg-blue-500' : 'bg-gray-300 dark:bg-zinc-600'
              }`}
              style={{ height: '22px' }}
              aria-label='切换主题'>
              <span
                className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform duration-300 flex items-center justify-center ${
                  isDark ? 'translate-x-[18px]' : 'translate-x-0'
                }`}>
                <i
                  className={`fas ${isDark ? 'fa-sun text-amber-500' : 'fa-moon text-gray-400'} text-[8px]`}></i>
              </span>
            </button>
          </div>

          <div className='border-t border-gray-100 dark:border-zinc-700 mx-4'></div>

          {/* 语言 */}
          <div className='px-4 py-3'>
            <div className='text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wider'>
              语言
            </div>
            <div className='flex gap-1.5'>
              <a
                href='/'
                className='flex-1 py-1.5 rounded-md text-xs font-medium text-center bg-blue-500 text-white border border-blue-500'>
                中文
              </a>
              <a
                href='/en'
                className='flex-1 py-1.5 rounded-md text-xs font-medium text-center text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-zinc-600 hover:border-blue-300'>
                EN
              </a>
            </div>
          </div>

          <div className='border-t border-gray-100 dark:border-zinc-700 mx-4'></div>

          {/* 新增推送通知功能：通知推送 */}
          <div className='px-4 py-3'>
            <div className='text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wider'>
              通知推送
            </div>
            <div className='flex items-center justify-between mb-2'>
              <span className='text-xs text-gray-600 dark:text-gray-300 flex items-center gap-1.5'>
                <i className='fas fa-bell text-blue-400 text-[10px]'></i>
                文章更新推送
              </span>
              <span className='text-xs text-gray-400 dark:text-gray-500'>{pushLabel}</span>
            </div>
            <div className='flex gap-1.5'>
              <button
                onClick={togglePush}
                disabled={pushStatus === 'unsupported' || pushStatus === 'checking'}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  pushStatus === 'subscribed'
                    ? 'bg-gray-200 dark:bg-zinc-700 text-gray-700 dark:text-gray-200 border-gray-300 dark:border-zinc-600 hover:bg-red-50 dark:hover:bg-red-900/20 hover:border-red-300 dark:hover:border-red-500'
                    : 'bg-blue-500 text-white border-blue-500 hover:bg-blue-600'
                } ${pushStatus === 'unsupported' || pushStatus === 'checking' ? 'opacity-50 cursor-not-allowed' : ''}`}>
                {pushStatus === 'subscribed' ? '取消订阅' : '订阅推送'}
              </button>
              <button
                onClick={sendTestPush}
                disabled={pushStatus !== 'subscribed'}
                className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  pushStatus === 'subscribed'
                    ? 'bg-transparent text-gray-600 dark:text-gray-300 border-gray-200 dark:border-zinc-600 hover:border-blue-300 dark:hover:border-blue-500'
                    : 'bg-transparent text-gray-300 dark:text-gray-600 border-gray-100 dark:border-zinc-700 opacity-50 cursor-not-allowed'
                }`}>
                {testStatus === 'sent'
                  ? '已发送 ✓'
                  : testStatus === 'failed'
                    ? '发送失败'
                    : testStatus === 'sending'
                      ? '发送中…'
                      : '测试通知'}
              </button>
            </div>
            {pushStatus === 'unsupported' && (
              <div className='text-[10px] text-gray-400 mt-1.5'>
                需使用 Chrome / Edge 等支持 Web Push 的浏览器
              </div>
            )}
            {pushStatus === 'error' && (
              <div className='text-[10px] text-red-400 mt-1.5'>
                订阅失败，请检查站点配置
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
