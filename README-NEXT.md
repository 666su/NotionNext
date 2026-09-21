# 博客定制说明 — 666su/NotionNext vs 官方 example 主题

> 本文件记录 `666su/NotionNext`（https://blog.20240606.xyz）相对于官方 `tangly1024/NotionNext` 的全部自定义修改。

---

## 📊 总览

| 类别 | 涉及文件数 | 说明 |
|------|-----------|------|
| 🔔 推送通知系统 | 12 | 全新功能：读者自选 Web Push / Telegram / Server酱 |
| 🔠 文章字号调节 | 4 | 桌面端/移动端独立字号，刷新不跳变 |
| 📅 公告时间线 | 6 | 公告页重构为日期时间线样式 |
| ⚙️ 部署配置 | 3 | Vercel cleanUrls、构建跳过规则等 |
| 👤 个人配置 | 1 | 联系方式、站点信息 |
| 🔄 上游同步 | 1 | 同步官方 NotionNext 新功能（系列/写作日历等） |

---

## 🔔 推送通知系统（全新功能）

官方 NotionNext **无推送通知功能**。本博客新增完整的推送系统，读者可在设置面板自选通知方式并配置自己的密钥，博主无需提供任何 Token。

### 新增文件

| 文件 | 作用 |
|------|------|
| `lib/notify/webpush.js` | Web Push 原生实现（零依赖）：VAPID 密钥生成、JWT ES256 签名、RFC 8291 消息加密 |
| `lib/notify/storage.js` | 存储抽象层：Redis（懒加载 ioredis）+ 文件回退，VAPID 密钥内存缓存 |
| `lib/notify/channels.js` | 各渠道发送器：Telegram Bot API、Server酱、Web Push、博主侧 Webhook |
| `lib/notify/index.js` | 推送调度：检测新文章 → 遍历所有订阅者 → 按渠道分发 |
| `pages/api/push/vapid-public-key.js` | GET 获取 VAPID 公钥（浏览器订阅用） |
| `pages/api/push/subscribe.js` | POST/DELETE 新增/删除订阅 |
| `pages/api/push/subscriptions.js` | GET 查询读者订阅列表 |
| `pages/api/push/test.js` | POST 测试通知（用读者自己的配置） |
| `pages/api/push/send.js` | POST 手动触发推送（需密钥） |
| `pages/api/push/status.js` | GET 检查 Redis 连接、订阅数、VAPID 状态 |
| `pages/admin/notify-status.js` | 状态检查页面（管理员可见） |
| `public/sw.js` | Service Worker：接收推送 + 点击通知跳转 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `blog.config.js` | 添加 `...require('./conf/notify.config')` 引入推送配置 |
| `conf/notify.config.js` | **新增**：`NOTIFY_ENABLE`、VAPID 密钥、Webhook URL、通知密钥 |
| `.env.example` | 添加推送相关环境变量说明（VAPID、Redis、Webhook 等） |
| `lib/db/SiteDataApi.js` | 添加 `checkAndNotify` 调用，构建完成后检测新文章并推送 |
| `themes/example/components/SettingsDropdown.js` | 通知设置 UI：三种渠道开关 + 内联配置指南 + 测试按钮 |

### 技术要点

- **Web Push**：使用 Node.js 内置 `crypto` 模块实现 VAPID + RFC 8291 加密，零外部依赖
- **存储**：优先 Redis（`rediss://` TLS），回退本地文件（`.next/cache/notify-data.json`）
- **密钥安全**：读者自己的 Telegram Token / Server酱 SendKey 存储在 Redis，不经过博主
- **ioredis 懒加载**：`await import('ioredis')` 避免 Vercel 构建时 URL 解析崩溃
- **VAPID 缓存**：内存缓存确保同一进程内密钥永远一致，防止 403

---

## 🔠 文章字号调节

官方 NotionNext **无字号调节功能**。本博客在设置面板添加桌面端/移动端独立字号控制。

### 修改文件

| 文件 | 改动 |
|------|------|
| `pages/_document.js` | 添加 `fontScaleScript`：页面加载时预应用已保存字号，避免刷新闪烁 |
| `themes/example/style.js` | 添加 `--article-font-scale` CSS 变量及 `.notion` 基准字号缩放规则 |
| `themes/example/components/SettingsDropdown.js` | 添加字号滑块（12-24px），桌面/移动端独立 |
| `themes/example/components/Header.js` | 添加字号快捷调节按钮（A- / A / A+） |

---

## 📅 公告时间线

官方 NotionNext 的公告页是简单列表。本博客重构为**日期时间线**样式。

### 修改文件

| 文件 | 改动 |
|------|------|
| `themes/example/components/Announcement.js` | 重构：从简单列表改为时间线布局 |
| `themes/example/components/NoticeTimeline.js` | **新增**：时间线组件（日期分组 + 连接线条） |
| `themes/example/index.js` | 引入 `NoticeTimeline` 组件 |
| `themes/example/style.js` | 添加时间线样式（连接线、日期标签、响应式） |
| `themes/example/components/Header.js` | 导航栏添加公告图标跳转 |
| `lib/db/SiteDataApi.js` | 公告数据按日期排序 |
| `pages/index.js` | 首页公告集成 |

---

## ⚙️ 部署配置

| 文件 | 改动 |
|------|------|
| `vercel.json` | 添加 `cleanUrls: true`、`trailingSlash: false`、构建跳过规则 `[skip-version]` |
| `.gitignore` | 确认 `.env.local`、`.next/`、`*.pem`、`.vercel` 等敏感文件已排除 |

---

## 👤 个人配置

| 文件 | 改动 |
|------|------|
| `conf/contact.config.js` | 配置个人联系方式（邮箱、GitHub、Telegram、B站） |

> ⚠️ 这些是博主公开联系方式，非敏感信息。如需修改，在 `conf/contact.config.js` 中更改或设置对应环境变量。

---

## 🔄 上游同步

`update NotionNext features` 提交同步了官方 NotionNext 的以下新功能：

- 文章系列（Series）展示
- 写作日历（WritingCalendar）
- 导航菜单增强（MenuList、MobileDrawer）
- 系列面板（SeriesPanel、SeriesTimeline、SeriesGroup）
- 博客列表优化（BlogListPage）
- 主题切换器（LayoutSwitcher）

---

## 🔐 安全审计结果

| 检查项 | 状态 | 说明 |
|--------|------|------|
| 硬编码 API Key / Token | ✅ 未发现 | 所有密钥通过环境变量传入 |
| 硬编码密码 / 连接串 | ✅ 未发现 | Redis/Notion 连接均使用 `process.env` |
| VAPID 私钥泄露 | ✅ 未发现 | 私钥存储在 Redis 或文件缓存（已 gitignore） |
| `.env.local` 泄露 | ✅ 已排除 | `.gitignore` 包含 `.env.local`、`.env` |
| 敏感文件提交 | ✅ 已排除 | `.next/`、`*.pem`、`.vercel` 均已 gitignore |
| 个人联系方式 | ℹ️ 公开信息 | `conf/contact.config.js` 含博主公开联系方式（邮箱/GitHub/Telegram/B站） |

---

## 📁 文件变更统计

### 新增文件（13 个）

```
lib/notify/webpush.js
lib/notify/storage.js
lib/notify/channels.js
lib/notify/index.js
conf/notify.config.js
pages/api/push/vapid-public-key.js
pages/api/push/subscribe.js
pages/api/push/subscriptions.js
pages/api/push/test.js
pages/api/push/send.js
pages/api/push/status.js
pages/admin/notify-status.js
public/sw.js
themes/example/components/NoticeTimeline.js
```

### 修改文件（15 个）

```
blog.config.js
.env.example
lib/db/SiteDataApi.js
lib/db/notion/getPageProperties.js
pages/index.js
pages/_document.js
themes/example/components/SettingsDropdown.js
themes/example/components/Header.js
themes/example/components/Announcement.js
themes/example/components/Footer.js
themes/example/index.js
themes/example/style.js
conf/contact.config.js
vercel.json
conf/layout-map.config.js
```

---

*最后更新：2026-09-21*