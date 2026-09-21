/**
 * 推送通知状态检查页面
 * /admin/notify-status
 */
import Redis from 'ioredis'
import { readData } from '@/lib/notify/storage'
import BLOG from '@/blog.config'

var tdStyle = { padding: 6, borderBottom: '1px solid #eee' }

export default function NotifyStatusPage({ status }) {
  var ok = status.redisConnected || !status.redisConfigured
  return (
    <div style={{ padding: '40px', fontFamily: 'monospace', maxWidth: 800, margin: '0 auto', fontSize: 14, lineHeight: 1.8 }}>
      <h2 style={{ borderBottom: '1px solid #ccc', paddingBottom: 10 }}>🔔 推送通知状态</h2>
      <p style={{ color: '#666', marginTop: 0 }}>
        访问路径：<code>/admin/notify-status</code>
      </p>

      <div style={{ background: ok ? '#f0fff0' : '#fff5f5', padding: 20, borderRadius: 8, border: '2px solid ' + (ok ? '#4caf50' : '#f44336') }}>
        <h3 style={{ margin: '0 0 10px' }}>{ok ? '✅ 运行正常' : '❌ 需要配置'}</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <tr><td style={tdStyle}>存储后端</td><td style={tdStyle}><code>{status.storage}</code></td></tr>
            <tr><td style={tdStyle}>Redis 已配置</td><td style={tdStyle}>{status.redisConfigured ? '✅ 是' : '❌ 否'}</td></tr>
            <tr><td style={tdStyle}>Redis 已连接</td><td style={tdStyle}>{status.redisConnected ? '✅ 是' : '❌ 否'}</td></tr>
            {status.redisError && <tr><td style={tdStyle}>Redis 错误</td><td style={{ padding: 6, borderBottom: '1px solid #eee', color: '#f44336' }}><code>{status.redisError}</code></td></tr>}
            <tr><td style={tdStyle}>订阅总数</td><td style={tdStyle}>{status.subscriptions} 个</td></tr>
            <tr><td style={tdStyle}>VAPID 密钥</td><td style={tdStyle}>{status.vapidKeys ? '✅ 存在' : '❌ 不存在'}</td></tr>
            <tr><td style={tdStyle}>部署环境</td><td style={tdStyle}>{status.isVercel ? 'Vercel' : '本地'}</td></tr>
          </tbody>
        </table>
      </div>

      {!ok && (
        <div style={{ marginTop: 20, padding: 15, background: '#fff3cd', borderRadius: 8, border: '1px solid #ffc107' }}>
          <h4 style={{ margin: '0 0 8px' }}>⚠️ 配置 Redis 步骤</h4>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            <li>打开 <a href='https://console.upstash.com' target='_blank'>Upstash Console</a> 注册（免费）</li>
            <li>创建 Redis 数据库，复制连接串</li>
            <li>在 Vercel → Settings → Environment Variables 添加：<code>REDIS_URL</code></li>
            <li>重新部署后刷新此页面</li>
          </ol>
        </div>
      )}

      <p style={{ marginTop: 20, fontSize: 12, color: '#999' }}>
        博客：<a href='/'>{BLOG.TITLE || 'NotionNext'}</a> · 
        生成时间：{new Date().toLocaleString('zh-CN')}
      </p>
    </div>
  )
}

export async function getServerSideProps() {
  var status = {
    storage: 'file',
    redisConfigured: !!process.env.REDIS_URL,
    redisConnected: false,
    redisError: null,
    subscriptions: 0,
    vapidKeys: false,
    isVercel: !!process.env.VERCEL
  }

  if (status.redisConfigured) {
    var redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 3000,
      lazyConnect: true
    })
    try {
      await redis.connect()
      await redis.ping()
      status.redisConnected = true
      status.storage = 'redis'
    } catch (e) {
      status.redisError = e.message
    } finally {
      redis.disconnect()
    }
  }

  try {
    var data = await readData()
    status.subscriptions = data.subscriptions.length
    status.vapidKeys = !!data.vapidKeys
  } catch (e) {
    status.readError = e.message
  }

  return { props: { status: status } }
}
