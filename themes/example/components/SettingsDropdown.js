import { useState, useEffect, useRef } from 'react'

/**
 * 新增文章系列展示功能 - 桌面端设置
 * 下拉面板：文字大小、夜间模式、语言、通知推送（读者自选渠道）
 */

const FONT_SIZES = [
  { label: '小', value: 0.875 },
  { label: '标准', value: 1 },
  { label: '大', value: 1.125 },
  { label: '特大', value: 1.25 }
]

/** Base64URL → Uint8Array */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

/** 生成或读取 subscriberId */
function getSubscriberId() {
  let id = localStorage.getItem('notify_subscriber_id')
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem('notify_subscriber_id', id)
  }
  return id
}

/** 渠道配置 */
const CHANNELS = {
  webpush: { label: '浏览器推送', icon: 'fa-bell', desc: '手机/电脑浏览器通知' },
  telegram: { label: 'Telegram', icon: 'fa-paper-plane', desc: '需 @BotFather 创建机器人' },
  serverchan: { label: 'Server酱', icon: 'fa-weixin', desc: '微信通知，填 SendKey' }
}

export const SettingsDropdown = () => {
  const [isOpen, setIsOpen] = useState(false)
  const [fontScale, setFontScale] = useState(1)
  const [isDark, setIsDark] = useState(false)
  const ref = useRef(null)

  // 通知订阅状态
  const [subscriberId, setSubscriberId] = useState('')
  const [channels, setChannels] = useState({
    webpush: { enabled: false, config: null, status: '' },
    telegram: { enabled: false, config: { token: '', chatId: '' }, status: '' },
    serverchan: { enabled: false, config: { sendKey: '' }, status: '' }
  })
  const [saving, setSaving] = useState(false)
  const [testResult, setTestResult] = useState({})

  // 初始化字号 + 暗色
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

  // 初始化通知订阅
  useEffect(() => {
    if (typeof window === 'undefined') return
    const id = getSubscriberId()
    setSubscriberId(id)
    // 加载已有订阅
    fetch(`/api/push/subscriptions?subscriberId=${id}`)
      .then(r => r.json())
      .then(data => {
        if (data.subscriptions) {
          const next = { ...channels }
          for (const sub of data.subscriptions) {
            next[sub.channel] = { enabled: sub.enabled, config: sub.config, status: '' }
          }
          setChannels(next)
        }
      })
      .catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 点击外部关闭
  useEffect(() => {
    const handler = e => {
      if (ref.current && !ref.current.contains(e.target)) setIsOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const applyFontScale = scale => {
    setFontScale(scale)
    try { localStorage.setItem('desktop_font_scale', String(scale)) } catch (e) {}
    document.documentElement.style.setProperty('--article-font-scale', String(scale))
  }

  const toggleDarkMode = () => {
    document.documentElement.classList.toggle('dark')
    setIsDark(document.documentElement.classList.contains('dark'))
    try { localStorage.setItem('theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light') } catch (e) {}
  }

  // ========== 通知推送操作 ==========

  const updateChannel = (ch, patch) => {
    setChannels(prev => ({ ...prev, [ch]: { ...prev[ch], ...patch } }))
  }

  const toggleChannel = async ch => {
    const enabled = !channels[ch].enabled
    updateChannel(ch, { enabled, status: '' })

    if (ch === 'webpush' && enabled) {
      // Web Push 立即订阅
      try {
        const reg = await navigator.serviceWorker.register('/sw.js')
        const { publicKey } = await (await fetch('/api/push/vapid-public-key')).json()
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        })
        const config = JSON.parse(JSON.stringify(sub))
        updateChannel('webpush', { config })
        await saveSubscription('webpush', config, true)
        updateChannel('webpush', { status: '已订阅 ✅' })
      } catch (e) {
        updateChannel('webpush', { enabled: false, status: `订阅失败: ${e.message}` })
      }
    } else if (enabled && (ch === 'telegram' || ch === 'serverchan')) {
      // 先保存空配置占位
      const currentConfig = channels[ch].config
      await saveSubscription(ch, currentConfig, true)
      updateChannel(ch, { status: '请填写配置后保存' })
    } else if (!enabled) {
      // 关闭渠道
      await deleteSubscription(ch)
      updateChannel(ch, { status: '' })
    }
  }

  const saveSubscription = async (channel, config, enabled) => {
    if (!subscriberId) return
    setSaving(true)
    try {
      await fetch('/api/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriberId, channel, config, enabled })
      })
    } catch (e) {
      console.warn('[notify] 保存失败:', e.message)
    }
    setSaving(false)
  }

  const deleteSubscription = async channel => {
    if (!subscriberId) return
    try {
      await fetch('/api/push/subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriberId, channel })
      })
    } catch (e) {
      console.warn('[notify] 删除失败:', e.message)
    }
  }

  const saveChannelConfig = async ch => {
    const config = channels[ch].config
    if (ch === 'telegram' && (!config.token || !config.chatId)) {
      updateChannel(ch, { status: '请填写 Token 和 Chat ID' })
      return
    }
    if (ch === 'serverchan' && !config.sendKey) {
      updateChannel(ch, { status: '请填写 SendKey' })
      return
    }
    await saveSubscription(ch, config, true)
    updateChannel(ch, { status: '已保存 ✅' })
    setTimeout(() => updateChannel(ch, { status: '' }), 3000)
  }

  const testChannel = async ch => {
    const config = channels[ch].config
    if (ch === 'telegram' && (!config?.token || !config?.chatId)) {
      updateChannel(ch, { status: '请先填写配置' })
      return
    }
    if (ch === 'serverchan' && !config?.sendKey) {
      updateChannel(ch, { status: '请先填写 SendKey' })
      return
    }
    if (ch === 'webpush' && !config?.endpoint) {
      updateChannel(ch, { status: '请先订阅' })
      return
    }
    updateChannel(ch, { status: '发送中…' })
    try {
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel: ch, config })
      })
      const data = await res.json()
      updateChannel(ch, { status: data.ok ? '测试成功 ✅' : `失败: ${data.error}` })
    } catch (e) {
      updateChannel(ch, { status: `失败: ${e.message}` })
    }
    setTimeout(() => updateChannel(ch, { status: '' }), 4000)
  }

  // 渲染渠道配置表单
  const renderChannelForm = ch => {
    const chData = channels[ch]
    if (!chData.enabled) return null

    if (ch === 'telegram') {
      return (
        <div className='mt-2 space-y-1.5'>
          <input
            type='text'
            placeholder='Bot Token（@BotFather 获取）'
            value={chData.config.token}
            onChange={e => updateChannel('telegram', { config: { ...chData.config, token: e.target.value } })}
            className='w-full px-2 py-1 rounded text-xs border border-gray-200 dark:border-zinc-600 bg-transparent text-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-400'
          />
          <input
            type='text'
            placeholder='Chat ID（发送 /start 给机器人获取）'
            value={chData.config.chatId}
            onChange={e => updateChannel('telegram', { config: { ...chData.config, chatId: e.target.value } })}
            className='w-full px-2 py-1 rounded text-xs border border-gray-200 dark:border-zinc-600 bg-transparent text-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-400'
          />
          <div className='flex gap-1'>
            <button onClick={() => saveChannelConfig('telegram')} disabled={saving} className='flex-1 py-1 rounded text-[10px] font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50'>
              保存
            </button>
            <button onClick={() => testChannel('telegram')} className='flex-1 py-1 rounded text-[10px] font-medium border border-gray-200 dark:border-zinc-600 text-gray-600 dark:text-gray-300 hover:border-blue-300'>
              测试
            </button>
          </div>
        </div>
      )
    }

    if (ch === 'serverchan') {
      return (
        <div className='mt-2 space-y-1.5'>
          <input
            type='text'
            placeholder='SendKey（https://sck.ftqq.com）'
            value={chData.config.sendKey}
            onChange={e => updateChannel('serverchan', { config: { sendKey: e.target.value } })}
            className='w-full px-2 py-1 rounded text-xs border border-gray-200 dark:border-zinc-600 bg-transparent text-gray-700 dark:text-gray-200 focus:outline-none focus:border-blue-400'
          />
          <div className=''>
            <button onClick={() => saveChannelConfig('serverchan')} disabled={saving} className='flex-1 py-1 rounded text-[10px] font-medium bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50'>
              保存
            </button>
            <button onClick={() => testChannel('serverchan')} className='flex-1 py-1 rounded text-[10px] font-medium border border-gray-200 dark:border-zinc-600 text-gray-600 dark:text-gray-300 hover:border-blue-300'>
              测试
            </button>
          </div>
        </div>
      )
    }

    // webpush
    return (
      <div className='mt-1.5'>
        {chData.config ? (
          <span className='text-[10px] text-green-500'>✅ 已订阅浏览器推送</span>
        ) : (
          <span className='text-[10px] text-gray-400'>点击开关即订阅</span>
        )}
        {chData.config && (
          <button onClick={() => testChannel('webpush')} className='ml-2 text-[10px] text-blue-400 hover:underline'>
            测试通知
          </button>
        )}
      </div>
    )
  }

  return (
    <div className='relative' ref={ref}>
      <button
        onClick={() => setIsOpen(prev => !prev)}
        className={`flex items-center justify-center w-9 h-9 rounded-lg transition-colors ${
          isOpen ? 'bg-gray-200 dark:bg-zinc-700 text-gray-800 dark:text-gray-100' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-zinc-800'
        }`}
        aria-label='设置'>
        <i className={`fas fa-cog text-sm transition-transform duration-300 ${isOpen ? 'rotate-90' : ''}`}></i>
      </button>

      {isOpen && (
        <div className='absolute right-0 top-full mt-2 w-60 bg-white dark:bg-zinc-800 rounded-xl shadow-lg border border-gray-100 dark:border-zinc-700 py-3 z-50 max-h-[80vh] overflow-y-auto'>
          {/* 文字大小 */}
          <div className='px-4 pb-3'>
            <div className='text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wider'>文字大小</div>
            <div className=''>
              {FONT_SIZES.map(size => (
                <button key={size.value} onClick={() => applyFontScale(size.value)} className={`flex-1 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                  Math.abs(fontScale - size.value) < 0.01
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-transparent text-gray-600 dark:text-gray-300 border-gray-200 dark:border-zinc-600 hover:border-blue-300'
                }`}>{size.label}</button>
              ))}
            </div>
          </div>

          <div className='border-t border-gray-100 dark:border-zinc-700 mx-4'></div>

          {/* 夜间模式 */}
          <div className='px-4 py-3 flex items-center justify-between'>
            <span className='text-sm text-gray-700 dark:text-gray-200 flex items-center gap-2'>
              <i className={`fas ${isDark ? 'fa-sun text-amber-500' : 'fa-moon text-gray-400'} text-xs`}></i>
              {isDark ? '日间模式' : '夜间模式'}
            </span>
            <button onClick={toggleDarkMode} className={`relative w-10 rounded-full transition-colors duration-300 ${isDark ? 'bg-blue-500' : 'bg-gray-300 dark:bg-zinc-600'}`} style={{ height: '22px' }}>
              <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white shadow transition-transform duration-300 flex items-center justify-center ${isDark ? 'translate-x-[18px]' : 'translate-x-0'}`}>
                <i className={`fas ${isDark ? 'fa-sun text-amber-500' : 'fa-moon text-gray-400'} text-[8px]`}></i>
              </span>
            </button>
          </div>

          <div className='border-t border-gray-100 dark:border-zinc-700 mx-4'></div>

          {/* 语言 */}
          <div className='px-4 py-3'>
            <div className=''>语言</div>
            <div className=''>
              <a href='/' className='flex-1 py-1.5 rounded-md text-xs font-medium text-center bg-blue-500 text-white border border-blue-500'>中文</a>
              <a href='/en' className='flex-1 py-1.5 rounded-md text-xs font-medium text-center text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-zinc-600 hover:border-blue-300'>EN</a>
            </div>
          </div>

          <div className='border-t border-gray-100 dark:border-zinc-700 mx-4'></div>

          {/* 新增推送通知功能：通知推送 */}
          <div className='px-4 py-3'>
            <div className='text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wider'>通知推送</div>
            {Object.entries(CHANNELS).map(([ch, meta]) => {
              const chData = channels[ch]
              return (
                <div key={ch} className='mb-2'>
                  <div className='flex items-center justify-between'>
                    <span className='text-xs text-gray-700 dark:text-gray-200 flex items-center gap-1.5'>
                      <i className={`fas ${meta.icon} text-[10px] text-blue-400`}></i>
                      {meta.label}
                    </span>
                    <button
                      onClick={() => toggleChannel(ch)}
                      className={`relative w-8 rounded-full transition-colors duration-300 ${chData.enabled ? 'bg-blue-500' : 'bg-gray-300 dark:bg-zinc-600'}`}
                      style={{ height: '18px' }}>
                      <span className={`absolute top-0.5 left-0.5 w-[14px] h-[14px] rounded-full bg-white shadow transition-transform duration-300 ${chData.enabled ? 'translate-x-[14px]' : 'translate-x-0'}`}></span>
                    </button>
                  </div>
                  {chData.status && (
                    <div className={`text-[10px] mt-0.5 ${chData.status.includes('失败') || chData.status.includes('填写') ? 'text-red-400' : 'text-gray-400'}`}>
                      {chData.status}
                    </div>
                  )}
                  {renderChannelForm(ch)}
                </div>
              )
            })}
            <div className='text-[10px] text-gray-400 mt-1'>{subscriberId ? `订阅者ID: ${subscriberId.slice(0, 8)}…` : ''}</div>
          </div>
        </div>
      )}
    </div>
  )
}
