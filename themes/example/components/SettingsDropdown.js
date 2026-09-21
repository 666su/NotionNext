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
  // 帮助弹窗：null | 'telegram' | 'serverchan' | 'webpush'
  const [helpChannel, setHelpChannel] = useState(null)

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
          <div className='flex gap-1'>
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
            <div className='flex gap-1.5'>
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
            <div className='text-xs font-semibold text-gray-400 dark:text-gray-500 mb-2 uppercase tracking-wider'>语言</div>
            <div className='flex gap-1.5'>
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
                      <button onClick={() => setHelpChannel(ch)} className='text-[10px] text-gray-400 hover:text-blue-400 transition-colors' title='配置指南'>
                        <i className='fas fa-circle-question'></i>
                      </button>
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

      {/* 新增推送通知功能：帮助弹窗 */}
      {helpChannel && (
        <div className='fixed inset-0 z-[100] flex items-center justify-center p-4' onClick={() => setHelpChannel(null)}>
          <div className='absolute inset-0 bg-black/50 backdrop-blur-sm'></div>
          <div className='relative bg-white dark:bg-zinc-800 rounded-xl shadow-2xl max-w-md w-full max-h-[80vh] overflow-y-auto p-5' onClick={e => e.stopPropagation()}>
            <button onClick={() => setHelpChannel(null)} className='absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200'>
              <i className='fas fa-times'></i>
            </button>
            {helpChannel === 'telegram' && (
              <div className='space-y-3'>
                <div className='flex items-center gap-2 mb-1'>
                  <i className='fas fa-paper-plane text-blue-500'></i>
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-100'>Telegram 通知配置指南</h3>
                </div>
                <div className='text-xs text-gray-600 dark:text-gray-300 space-y-2'>
                  <div className='bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 space-y-1.5'>
                    <div className='font-medium text-blue-700 dark:text-blue-300'>第 1 步：创建机器人</div>
                    <ol className='list-decimal list-inside space-y-0.5 text-gray-600 dark:text-gray-300'>
                      <li>在 Telegram 搜索 <b>@BotFather</b> 并点击开始</li>
                      <li>发送 <code>/newbot</code>，按提示取个名字</li>
                      <li>创建完成后会收到一段 <b>Token</b>，形如 <code>123456:ABC-DEF...</code></li>
                      <li>复制这个 Token 填入下方「Bot Token」</li>
                    </ol>
                  </div>
                  <div className='bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 space-y-1.5'>
                    <div className='font-medium text-blue-700 dark:text-blue-300'>第 2 步：获取 Chat ID</div>
                    <ol className='list-decimal list-inside space-y-0.5 text-gray-600 dark:text-gray-300'>
                      <li>先给刚创建的机器人发送任意消息（或 <code>/start</code>）</li>
                      <li>在浏览器打开 <code>https://api.telegram.org/bot&lt;你的Token&gt;/getUpdates</code></li>
                      <li>在返回的 JSON 里找到 <code>{'{"chat":{"id":123456789}}'}</code></li>
                      <li>复制这个 <b>Chat ID</b> 填入下方「Chat ID」</li>
                    </ol>
                    <div className='text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-zinc-700 rounded px-2 py-1 mt-1'>
                      或者搜索 <b>@userinfobot</b> 发送 /start 也能获取自己的 Chat ID
                    </div>
                  </div>
                </div>
              </div>
            )}
            {helpChannel === 'serverchan' && (
              <div className='space-y-3'>
                <div className='flex items-center gap-2 mb-1'>
                  <i className='fas fa-weixin text-green-500'></i>
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-100'>Server酱（微信）配置指南</h3>
                </div>
                <div className='text-xs text-gray-600 dark:text-gray-300 space-y-2'>
                  <div className='bg-green-50 dark:bg-green-900/20 rounded-lg p-3 space-y-1.5'>
                    <div className='font-medium text-green-700 dark:text-green-300'>第 1 步：注册账号</div>
                    <ol className='list-decimal list-inside space-y-0.5 text-gray-600 dark:text-gray-300'>
                      <li>打开 <a href='https://sct.ftqq.com' target='_blank' rel='noopener' className='text-blue-500 hover:underline'>https://sct.ftqq.com</a></li>
                      <li>用微信扫码登录（免费）</li>
                    </ol>
                  </div>
                  <div className='bg-green-50 dark:bg-green-900/20 rounded-lg p-3 space-y-1.5'>
                    <div className='font-medium text-green-700 dark:text-green-300'>第 2 步：获取 SendKey</div>
                    <ol className='list-decimal list-inside space-y-0.5 text-gray-600 dark:text-gray-300'>
                      <li>登录后在首页可以看到 <b>SendKey</b>，形如 <code>SCTxxxxxxxx</code></li>
                      <li>复制 SendKey 填入下方「SendKey」</li>
                      <li>点击「测试」发送一条测试通知到微信</li>
                    </ol>
                  </div>
                  <div className='text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-zinc-700 rounded px-2 py-1'>
                    Server酱会将通知推送到你的微信「服务通知」，需关注 Server酱推送 公众号
                  </div>
                </div>
              </div>
            )}
            {helpChannel === 'webpush' && (
              <div className='space-y-3'>
                <div className='flex items-center gap-2 mb-1'>
                  <i className='fas fa-bell text-indigo-500'></i>
                  <h3 className='text-base font-semibold text-gray-800 dark:text-gray-100'>浏览器推送指南</h3>
                </div>
                <div className='text-xs text-gray-600 dark:text-gray-300 space-y-2'>
                  <div className='bg-indigo-50 dark:bg-indigo-900/20 rounded-lg p-3 space-y-1.5'>
                    <div className='font-medium text-indigo-700 dark:text-indigo-300'>订阅步骤</div>
                    <ol className='list-decimal list-inside space-y-0.5 text-gray-600 dark:text-gray-300'>
                      <li>打开「浏览器推送」开关，浏览器会弹出授权请求</li>
                      <li>点击「允许」即可订阅成功</li>
                      <li>发布新文章时，手机/电脑会收到系统通知</li>
                    </ol>
                  </div>
                  <div className='bg-gray-100 dark:bg-zinc-700 rounded-lg p-3 space-y-1'>
                    <div className='font-medium text-gray-700 dark:text-gray-200'>注意事项</div>
                    <ul className='list-disc list-inside space-y-0.5 text-gray-500 dark:text-gray-400'>
                      <li>支持 Chrome / Edge 浏览器（手机和电脑）</li>
                      <li>Firefox 和 Safari 暂不支持</li>
                      <li>如果之前拒绝过授权，需在浏览器设置里重新允许</li>
                      <li>手机 Chrome 设置路径：菜单 → 设置 → 网站设置 → 通知</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
