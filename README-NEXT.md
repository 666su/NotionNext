# 博客定制说明 — 666su/NotionNext vs 官方 NotionNext example 主题

> 本文件记录 `666su/NotionNext`（https://blog.20240606.xyz）相对于官方 `tangly1024/NotionNext` 的全部自定义修改。

---

## 📊 总览

| 类别 | 涉及文件数 | 说明 |
|------|-----------|------|
| 🔔 推送通知系统 | 12 新增 + 5 修改 | 全新功能：读者自选 Web Push / Telegram / Server酱 |
| 🔠 文章字号调节 | 4 修改 | 桌面端/移动端独立字号，刷新不跳变 |
| 📅 公告时间线 | 6 修改 | 公告页重构为日期时间线样式 |
| ⚙️ 部署配置 | 3 修改 | Vercel cleanUrls、构建跳过规则等 |
| 👤 个人配置 | 1 修改 | 联系方式、站点信息 |
| 🔄 上游同步 | 1 commit | 同步官方 NotionNext 新功能（系列/写作日历等） |

---

## 🔔 推送通知系统（全新功能）

### 功能概述

官方 NotionNext **无推送通知功能**。本博客新增完整的推送系统：

- **读者自选**：读者在设置面板选择通知方式，配置自己的密钥
- **三种渠道**：Web Push（浏览器桌面通知）、Telegram、Server酱（微信）
- **存储持久化**：Redis（Upstash 免费层）+ 文件回退，部署不丢失
- **安全设计**：所有密钥由读者自己配置，不经过博主

### 架构

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│   浏览器    │     │   Next.js API     │     │  推送服务    │
│             │     │                  │     │              │
│ 设置面板    │────▶│ /api/push/*      │────▶│ Telegram     │
│ (订阅/配置) │     │  - vapid-public- │     │ Server酱     │
│             │◀────│  - subscribe     │◀────│ Web Push     │
│ Service     │     │  - subscriptions │     │ (FCM/Mozilla)│
│ Worker      │     │  - test          │     │              │
│ (接收通知)  │     │  - send          │     └──────────────┘
└─────────────┘     │  - status        │
                    │                  │     ┌──────────────┐
                    │ lib/notify/      │────▶│  Redis       │
                    │  - webpush.js    │     │  (Upstash)   │
                    │  - storage.js    │     │  订阅 + 密钥 │
                    │  - channels.js   │     └──────────────┘
                    │  - index.js      │
                    └──────────────────┘
```

### 新增文件（12 个）

#### `lib/notify/webpush.js` — Web Push 原生实现

**零外部依赖**，使用 Node.js 内置 `crypto` 模块实现：

- VAPID 密钥生成（EC P-256 曲线）
- VAPID JWT 签名（ES256，DER → Raw r||s 转换）
- RFC 8291 消息加密（HKDF-SHA256 + AES-128-GCM）

```javascript
// VAPID JWT 签名（核心修复点）
function signVapidJwt({ privateKeyPem, subject, origin }) {
  const key = crypto.createPrivateKey({ key: privateKeyPem, type: 'pkcs8', format: 'pem' })
  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: subject
  }
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload))
  const derSig = crypto.sign('sha256', Buffer.from(unsigned), key)
  const rawSig = derToRawSignature(derSig)  // DER → Raw r||s（64字节）
  return `${unsigned}.${b64url(rawSig)}`
}
```

#### `lib/notify/storage.js` — 存储抽象层

- **Redis**：懒加载 `await import('ioredis')`，避免 Vercel 构建时 URL 解析崩溃
- **文件回退**：`.next/cache/notify-data.json`（已 gitignore）
- **VAPID 内存缓存**：确保同一进程内密钥永远一致，防止 403

```javascript
// VAPID 密钥内存缓存
let vapidKeysCache = null

export async function getVapidKeys() {
  if (vapidKeysCache) return vapidKeysCache
  const envPk = process.env.VAPID_PUBLIC_KEY
  const envSk = process.env.VAPID_PRIVATE_KEY
  if (envPk && envSk) {
    vapidKeysCache = { publicKey: envPk, privateKey: envSk }
    return vapidKeysCache
  }
  const data = await readData()
  if (data.vapidKeys) {
    vapidKeysCache = data.vapidKeys
    return vapidKeysCache
  }
  return null
}
```

#### `lib/notify/channels.js` — 各渠道发送器

- **Telegram**：`https://api.telegram.org/bot{token}/sendMessage`
- **Server酱**：`https://sctapi.ftqq.com/{SendKey}.send`
- **Web Push**：调用 `webpush.js` 的 `sendWebPushTo()`
- **博主 Webhook**：企业微信 / 钉钉 / 自定义机器人

#### `lib/notify/index.js` — 推送调度

```
检测新文章 → 获取所有已启用订阅 → 按渠道分发 → 清理过期订阅 → 更新标记
```

#### `pages/api/push/` — 6 个 API 端点

| 端点 | 方法 | 作用 |
|------|------|------|
| `/api/push/vapid-public-key` | GET | 获取 VAPID 公钥（浏览器订阅用） |
| `/api/push/subscribe` | POST | 新增/更新订阅 |
| `/api/push/subscribe` | DELETE | 删除订阅 |
| `/api/push/subscriptions` | GET | 查询读者订阅列表 |
| `/api/push/test` | POST | 测试通知（用读者自己的配置） |
| `/api/push/send` | POST | 手动触发推送（需密钥） |
| `/api/push/status` | GET | 检查 Redis 连接、订阅数、VAPID 状态 |

#### `pages/admin/notify-status.js` — 状态检查页面

- Redis 连接状态
- 订阅数量
- VAPID 密钥状态
- 配置步骤指引（Redis 未连接时）

#### `public/sw.js` — Service Worker

```javascript
// 接收推送 → 显示系统通知
self.addEventListener('push', event => {
  const data = event.data?.json() || { title: '博客更新', body: '', url: '/' }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/favicon.ico',
      data: { url: data.url },
      tag: data.url,
      renotify: true
    })
  )
})

// 点击通知 → 打开文章
self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  // 聚焦已有窗口或打开新窗口
})
```

#### `conf/notify.config.js` — 推送配置

```javascript
module.exports = {
  NOTIFY_ENABLE: process.env.NOTIFY_ENABLE || false,
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || '',
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || '',
  VAPID_SUBJECT: process.env.VAPID_SUBJECT || 'mailto:admin@localhost',
  PUSH_WEBHOOK_URL: process.env.PUSH_WEBHOOK_URL || '',
  NOTIFY_SECRET: process.env.NOTIFY_SECRET || process.env.REVALIDATION_TOKEN || ''
}
```

### 修改文件（5 个）

| 文件 | 改动 |
|------|------|
| `blog.config.js` | 添加 `...require('./conf/notify.config')` |
| `.env.example` | 添加推送相关环境变量说明 |
| `lib/db/SiteDataApi.js` | 添加 `checkAndNotify` 调用 |
| `themes/example/components/SettingsDropdown.js` | 通知设置 UI |

### 关键技术决策

| 问题 | 解决方案 |
|------|---------|
| ioredis 构建时 URL 解析崩溃 | `await import('ioredis')` 懒加载 |
| VAPID 密钥每次部署变化 → 403 | 内存缓存 + Redis 持久化 |
| JWT ES256 签名格式错误 → 403 | DER → Raw r||s 转换 |
| Crypto-Key 缺少 p256= 前缀 → 400 | `p256=${publicKey}` |
| 浏览器复用旧订阅 → 403 | 每次订阅前强制取消旧订阅 |
| Vercel 部署丢失数据 | Redis 持久化 + 文件回退 |

---

## 🔠 文章字号调节

### 功能概述

官方 NotionNext **无字号调节功能**。本博客在设置面板添加桌面端/移动端独立字号控制。

### 实现方式

```
┌─────────────────────────────────────────┐
│  settings → localStorage                │
│  desktop_font_scale / mobile_font_scale  │
├─────────────────────────────────────────┤
│  _document.js                           │
│  预加载脚本：读取 localStorage → 设置    │
│  CSS 变量 --article-font-scale           │
│  （避免刷新闪烁）                        │
├─────────────────────────────────────────┤
│  style.js                               │
│  .notion { font-size: calc(...) }       │
│  基于 --article-font-scale 缩放          │
├─────────────────────────────────────────┤
│  Header.js + SettingsDropdown.js        │
│  滑块 UI（12-24px）                     │
│  快捷按钮（A- / A / A+）                │
└─────────────────────────────────────────┘
```

### 修改文件

| 文件 | 改动 |
|------|------|
| `pages/_document.js` | 添加 `fontScaleScript` 预加载脚本 |
| `themes/example/style.js` | 添加 `--article-font-scale` CSS 变量 |
| `themes/example/components/SettingsDropdown.js` | 字号滑块 UI |
| `themes/example/components/Header.js` | 字号快捷按钮 |

---

## 📅 公告时间线

### 功能概述

官方 NotionNext 的公告页是简单列表。本博客重构为**日期时间线**样式。

### 修改文件

| 文件 | 改动 |
|------|------|
| `themes/example/components/NoticeTimeline.js` | **新增**：时间线组件 |
| `themes/example/components/Announcement.js` | 重构为时间线布局 |
| `themes/example/index.js` | 引入 `NoticeTimeline` |
| `themes/example/style.js` | 时间线样式（连接线、日期标签） |
| `themes/example/components/Header.js` | 导航栏公告图标 |
| `lib/db/SiteDataApi.js` | 公告数据按日期排序 |
| `pages/index.js` | 首页公告集成 |

---

## ⚙️ 部署配置

### `vercel.json`

```json
{
  "cleanUrls": true,
  "trailingSlash": false,
  "ignoreCommand": "case \"$VERCEL_GIT_COMMIT_MESSAGE\" in *\"[skip-version]\"*) exit 0;; *) exit 1;; esac"
}
```

- `cleanUrls`：去掉 URL 中的 `.html` 后缀
- `trailingSlash: false`：不使用尾部斜杠
- `ignoreCommand`：提交信息含 `[skip-version]` 时跳过构建

---

## 👤 个人配置

### `conf/contact.config.js`

```javascript
CONTACT_EMAIL: 'jason@20240606.xyz'
CONTACT_GITHUB: 'https://github.com/666su'
CONTACT_TELEGRAM: 'https://t.me/Suxun1912'
CONTACT_BILIBILI: 'https://space.bilibili.com/1561087564'
```

> 这些是博主公开联系方式，非敏感信息。

---

## 🔐 安全审计

### 检查结果

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 硬编码 API Key / Token | ✅ 未发现 | 所有密钥通过 `process.env` 传入 |
| 硬编码密码 / 连接串 | ✅ 未发现 | Redis/Notion 连接均用环境变量 |
| VAPID 私钥泄露 | ✅ 未发现 | 私钥存储在 Redis 或 `.next/cache/`（已 gitignore） |
| `.env.local` 泄露 | ✅ 已排除 | `.gitignore` 包含 `.env.local`、`.env` |
| 敏感文件提交 | ✅ 已排除 | `.next/`、`*.pem`、`.vercel` 均已 gitignore |
| 个人联系方式 | ℹ️ 公开信息 | `conf/contact.config.js` 含博主公开联系方式 |

### `.gitignore` 关键条目

```
/.next/              # 构建缓存（含 notify-data.json）
.env.local           # 本地环境变量
.env                 # 环境变量
*.pem                # 私钥文件
.vercel              # Vercel 配置
```

---

## 📁 文件变更统计

### 新增文件（13 个）

```
lib/notify/webpush.js                  # Web Push 原生实现
lib/notify/storage.js                  # 存储抽象层
lib/notify/channels.js                 # 各渠道发送器
lib/notify/index.js                    # 推送调度
conf/notify.config.js                  # 推送配置
pages/api/push/vapid-public-key.js     # VAPID 公钥 API
pages/api/push/subscribe.js            # 订阅管理 API
pages/api/push/subscriptions.js        # 订阅查询 API
pages/api/push/test.js                 # 测试通知 API
pages/api/push/send.js                 # 手动推送 API
pages/api/push/status.js               # 状态检查 API
pages/admin/notify-status.js           # 状态检查页面
public/sw.js                           # Service Worker
themes/example/components/NoticeTimeline.js  # 公告时间线组件
```

### 修改文件（15 个）

```
blog.config.js                         # 引入 notify.config
.env.example                           # 添加推送环境变量说明
lib/db/SiteDataApi.js                  # 添加 checkAndNotify
lib/db/notion/getPageProperties.js     # 公告数据排序
pages/index.js                         # 首页公告集成
pages/_document.js                     # 字号预加载脚本
themes/example/components/SettingsDropdown.js  # 通知设置 + 字号调节
themes/example/components/Header.js    # 字号按钮 + 公告图标
themes/example/components/Announcement.js     # 公告时间线重构
themes/example/components/Footer.js    # 同步上游修改
themes/example/index.js                # 引入 NoticeTimeline
themes/example/style.js                # 字号 + 时间线样式
conf/contact.config.js                 # 个人联系方式
vercel.json                            # cleanUrls 配置
conf/layout-map.config.js              # 同步上游修改
```

---

## 🔄 上游同步记录

`update NotionNext features` 提交同步了官方 NotionNext 的以下新功能：

- 文章系列（Series）展示
- 写作日历（WritingCalendar）
- 导航菜单增强（MenuList、MobileDrawer）
- 系列面板（SeriesPanel、SeriesTimeline、SeriesGroup）
- 博客列表优化（BlogListPage）
- 主题切换器（LayoutSwitcher）

---

## 🛠 故障排除

### 常见问题

| 问题 | 原因 | 解决方案 |
|------|------|---------|
| 构建时 `ERR_INVALID_URL` | ioredis 顶层导入 | 已修复：`await import('ioredis')` 懒加载 |
| 构建时 `ECONNRESET` | Redis URL 格式错误 | 使用 `rediss://`（带 s），不要包含 `redis-cli` 前缀 |
| Web Push 400 Bad Request | Crypto-Key 缺少 `p256=` | 已修复：`p256=${publicKey}` |
| Web Push 403 Forbidden | JWT 签名格式错误 | 已修复：DER → Raw r||s 转换 |
| 订阅数据部署后丢失 | Vercel 文件系统临时 | 已修复：Redis 持久化 |
| 浏览器推送按钮灰色 | VAPID 密钥更换 | 已修复：每次订阅前强制取消旧订阅 |
| `/api/push/status` 404 | middleware 重定向 | 改用 `/admin/notify-status` 页面 |

### Redis 配置

```
# Upstash Console → Connect → 复制 Connection URL
rediss://default:xxx@your-db.upstash.io:6379

# 注意：
# 1. 必须是 rediss://（带 s，TLS）
# 2. 不要包含 redis-cli --tls -u 前缀
# 3. 不要包含空格
```

---

*最后更新：2026-09-21*