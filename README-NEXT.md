# 博客定制说明 — 666su/NotionNext vs 官方 NotionNext example 主题

> 本文件记录 `666su/NotionNext`（https://blog.20240606.xyz）相对于官方 `tangly1024/NotionNext` 的全部自定义修改。

---

## 📊 总览

| 类别 | 涉及文件数 | 说明 |
|------|-----------|------|
| 🏆 排行榜与点赞 | 11 新增 + 5 修改 | 左侧栏阅读榜/点赞榜（从高到低）+ 文章点赞功能 |
| 🔔 推送通知系统 | 12 新增 + 5 修改 | 全新功能：读者自选 Web Push / Telegram / Server酱 |
| 🔠 文章字号调节 | 4 修改 | 桌面端/移动端独立字号，刷新不跳变 |
| 📅 公告时间线 | 6 修改 | 公告页重构为日期时间线样式 |
| ⚙️ 部署配置 | 3 修改 | Vercel cleanUrls、构建跳过规则等 |
| 👤 个人配置 | 1 修改 | 联系方式、站点信息 |
| 🔄 上游同步 | 1 commit | 同步官方 NotionNext 新功能（系列/写作日历等） |

---

## 🏆 排行榜与点赞（全新功能）

### 功能概述

官方 NotionNext **既没有文章点赞功能，也没有可用的阅读量排行**。本博客新增：

- **左侧双榜单**：文章**阅读榜**（上）与**点赞榜**（下），均按次数**从高到低**排序
- **真实阅读统计**：自建计数，替代官方主题里那个永远不显示数字的不蒜子空 span
- **文章点赞**：顶部信息栏 + 文末大按钮，按访客去重，可取消
- **存储持久化**：Redis（Hash + HINCRBY）+ 文件回退，多实例部署计数一致

> 布局说明：本站启用了 `LAYOUT_SIDEBAR_REVERSE`，视觉**左侧**原本是空白区域。
> 排行榜正好补上这块，与右侧「系列时间线 + 写作日历」左右对称；移动端（< lg）自动隐藏。

### 界面结构

```
┌──────────────────────────────────────────────────────────┐
│  Header / TitleBar                                       │
├───────────────┬────────────────────────┬─────────────────┤
│  ⬅ 视觉左侧    │        文章列表/正文     │  视觉右侧        │
│  🏆 阅读榜     │                        │  📚 系列时间线   │
│   1 文章A 300  │                        │  📅 写作日历     │
│   2 文章B 200  │                        │                 │
│   3 文章C 100  │                        │                 │
│  ───────────  │                        │                 │
│  ❤️ 点赞榜     │                        │                 │
│   1 文章X  90  │                        │                 │
│   2 文章Y  50  │                        │                 │
└───────────────┴────────────────────────┴─────────────────┘
        w-56 / xl:w-64，sticky top-20，lg 以下隐藏
```

### 数据流

```
文章页打开
   │
   ├─ ArticleInteraction ──► GET /api/rank/info?record=1
   │                           ├─ 记录一次浏览（按 IP+UA 去重）
   │                           └─ 返回 { views, likes, liked }
   │        ▲
   │        │ 模块级 store 共享，全页只发一次请求
   │        └────────────┬──────────────┐
   │                     │              │
   │              PostMeta(顶部)   LikeButton(顶部/文末)
   │              阅读量数字        点赞状态与数量
   │
首页/列表页打开
   └─ RankBoard ──► GET /api/rank/top?limit=10
                     └─ 读取计数 + 全站文章 → 排序取前 N → 双榜单
```

### 新增文件（11 个）

| 文件 | 作用 |
|------|------|
| `conf/rank.config.js` | 排行榜与点赞配置（开关 / 条数 / 去重窗口） |
| `lib/rank/storage.js` | 存储层：Redis Hash 自增 + 文件回退 + 去重标记 |
| `lib/rank/index.js` | 业务逻辑：浏览去重、点赞切换、榜单排序、数据导入 |
| `pages/api/rank/view.js` | POST 记录浏览 |
| `pages/api/rank/like.js` | POST 点赞/取消，GET 查询状态 |
| `pages/api/rank/info.js` | GET 单篇互动数据（`record=1` 时顺带计数） |
| `pages/api/rank/top.js` | GET 双榜单数据（按次数降序） |
| `pages/api/rank/seed.js` | POST 导入历史数据 / 重置计数（需令牌） |
| `pages/api/rank/status.js` | GET 存储后端与计数概况（部署自检） |
| `themes/example/components/RankBoard.js` | 左侧双榜单组件 |
| `themes/example/components/LikeButton.js` | 点赞按钮（inline / block 两种形态） |

> 另有 `themes/example/components/rankClient.js`（客户端共享 store）与
> `themes/example/components/ArticleInteraction.js`（文章页互动区），
> 合计 13 个新增文件。

### 修改文件

| 文件 | 改动 |
|------|------|
| `blog.config.js` | 引入 `conf/rank.config` |
| `.env.example` | 补充排行榜相关环境变量说明 |
| `themes/example/index.js` | 左侧栏挂载 `RankBoard`；文章页挂载 `ArticleInteraction` |
| `themes/example/components/PostMeta.js` | 阅读量改为真实数字，并加入点赞按钮 |
| `themes/example/components/LikeButton.js` | 重构为订阅共享 store |
| `themes/example/style.js` | 排行榜样式（滚动条、省略号、点赞回弹） |

### 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `RANK_ENABLE` | `true` | 总开关，关闭后左侧榜单与点赞全部隐藏 |
| `RANK_VIEW_ENABLE` | `true` | 阅读统计与阅读榜开关 |
| `RANK_LIKE_ENABLE` | `true` | 点赞功能与点赞榜开关 |
| `RANK_LIST_SIZE` | `10` | 每个榜单显示条数（1–50） |
| `RANK_VIEW_WINDOW_HOURS` | `6` | 同一访客重复浏览去重窗口；`0` 表示每次都计数 |
| `RANK_MAX_CANDIDATES` | `500` | 参与排行的候选文章上限 |
| `RANK_STORAGE_PATH` | 空 | 未配置 Redis 时的计数文件路径 |
| `RANK_SEED_SECRET` | 空 | 导入历史数据 / 重置计数的管理令牌 |

所有开关都可用 `NEXT_PUBLIC_` 前缀写进环境变量，也可直接在 Notion 配置表里覆盖。

### 关键技术决策

| 问题 | 解决方案 |
|------|---------|
| 阅读量是空壳（不蒜子线上不显示数字） | 自建计数，不再依赖第三方统计 |
| 高并发下自增丢计数 | Redis `HINCRBY` 原子自增；文件回退用进程内串行队列 |
| 刷新页面刷阅读量 | 按 `IP + UA` 哈希去重（不落库原始 IP），默认 6 小时窗口 |
| 连点点赞刷赞数 | 点赞标记存 Redis `SET NX`，前端始终发显式 `like`/`unlike`，接口幂等 |
| 文章页重复请求 | 模块级 store：`ArticleInteraction` 唯一触发，其余组件只订阅 |
| 榜单计算开销 | 结果 `s-maxage=60` 允许 CDN 缓存；计数与文章数据均走已有缓存 |
| 重置后无法再点赞 | `resetCounters` 同步清除 `liked-by` 去重标记（测试覆盖） |
| Vercel 部署丢数据 | 复用现有 `REDIS_URL`（与推送通知同一实例），未配置时回退文件 |

### 使用方式

**导入历史阅读量**（只增不减，可安全重复执行）：

```bash
curl -X POST https://blog.20240606.xyz/api/rank/seed \
  -H 'Content-Type: application/json' \
  -d '{"secret":"你的RANK_SEED_SECRET","action":"import","mode":"max",
       "views":{"文章ID":1234}}'
```

**重置计数**：

```bash
curl -X POST https://blog.20240606.xyz/api/rank/seed \
  -H 'Content-Type: application/json' \
  -d '{"secret":"你的RANK_SEED_SECRET","action":"reset","reset":"likes"}'
```

**部署自检**（确认 Redis 是否接管计数）：

```bash
curl https://blog.20240606.xyz/api/rank/status
# => {"storage":"redis","redisConnected":true,"counts":{...}}
```

### 测试覆盖

| 测试文件 | 用例数 | 覆盖内容 |
|---------|-------|---------|
| `__tests__/lib/rank-storage.test.js` | 21 | 自增、批量导入三种模式、清空、去重标记、匿名哈希 |
| `__tests__/lib/rank.test.js` | 17 | 浏览去重、并发计数、点赞幂等与取消、计数隔离 |
| `__tests__/lib/rank-board.test.js` | 15 | **排序从高到低**、并列时按时间、limit、过滤菜单页 |
| `__tests__/lib/rank-api.test.js` | 30 | 6 个接口的完整请求-响应链路与错误分支 |
| `__tests__/themes/rank-board-component.test.js` | 10 | 组件渲染：上下排列、降序展示、空态与接口失败降级 |
| **合计** | **93** | |

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

### 新增文件（26 个）

```
# 🏆 排行榜与点赞（新增）
conf/rank.config.js                    # 排行榜与点赞配置
lib/rank/storage.js                    # 计数存储（Redis Hash + 文件回退）
lib/rank/index.js                      # 业务逻辑（浏览去重/点赞/榜单排序）
pages/api/rank/view.js                 # 记录浏览 API
pages/api/rank/like.js                 # 点赞 API
pages/api/rank/info.js                 # 单篇互动数据 API
pages/api/rank/top.js                  # 双榜单数据 API
pages/api/rank/seed.js                 # 历史数据导入 / 重置 API
pages/api/rank/status.js               # 排行榜状态自检 API
themes/example/components/RankBoard.js         # 左侧双榜单组件
themes/example/components/LikeButton.js        # 点赞按钮
themes/example/components/rankClient.js        # 互动数据客户端 store
themes/example/components/ArticleInteraction.js # 文章互动区
__tests__/lib/rank-storage.test.js             # 存储层测试
__tests__/lib/rank.test.js                     # 业务逻辑测试
__tests__/lib/rank-board.test.js               # 榜单排序测试
__tests__/lib/rank-api.test.js                 # 接口端到端测试
__tests__/themes/rank-board-component.test.js  # 组件渲染测试

# 🔔 推送通知
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

### 修改文件（18 个）

```
blog.config.js                         # 引入 notify.config + rank.config
themes/example/components/PostMeta.js  # 阅读量改为真实数字 + 点赞按钮
.env.example                           # 排行榜环境变量说明
themes/example/index.js                # 左侧栏挂载 RankBoard + 文章互动区
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

### 排行榜相关

| 现象 | 原因与处理 |
|------|-----------|
| 榜单一直是空的 | 计数从上线后从零开始累计。用 `/api/rank/seed` 导入历史数据可立即出榜 |
| `/api/rank/status` 显示 `storage:"file"` | 未配置 `REDIS_URL`，计数写本地文件；Vercel 上文件不持久，建议配置 Redis |
| 刷新页面阅读量不涨 | 属正常去重（默认 6 小时）。改 `RANK_VIEW_WINDOW_HOURS=0` 可关闭去重 |
| 想隐藏某个榜单 | 把 `RANK_VIEW_ENABLE` 或 `RANK_LIKE_ENABLE` 设为 `false`；整体隐藏用 `RANK_ENABLE=false` |
| 移动端看不到榜单 | 设计如此：榜单在 `lg` 以上才显示，避免挤占小屏阅读空间 |

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