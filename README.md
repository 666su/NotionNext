<div align="center">

# 📝 666su's Blog

**基于 NotionNext 的个性化博客**

[🌐 博客首页](https://blog.20240606.xyz) · [📋 定制说明](./README-NEXT.md)

```
Next.js 15 + Notion API + Vercel
```

</div>

---

## ✨ 核心特色

本博客基于 [NotionNext](https://github.com/tangly1024/NotionNext) 二次开发，在官方 example 主题基础上新增了多项功能：

### 🔔 推送通知系统

**官方 NotionNext 无此功能。** 全新实现的读者自选通知系统：

- **Web Push**：浏览器桌面通知，使用 VAPID + RFC 8291 原生实现（零依赖）
- **Telegram**：通过 Bot API 推送，读者配置自己的 Bot Token + ChatID
- **Server酱**：微信消息推送，读者配置自己的 SendKey
- **存储**：Redis 持久化（Upstash）+ 文件回退，部署不丢失
- **安全**：所有密钥由读者自己配置，不经过博主

> 读者在设置面板自选通知方式，填入自己的密钥，即开即用。

### 🔠 文章字号调节

- 桌面端 / 移动端独立字号控制（12-24px）
- 刷新页面不闪烁（`_document.js` 预加载脚本）
- 基于 `.notion` 基准字号 CSS 变量缩放

### 📅 公告时间线

- 公告页重构为日期时间线样式
- 按日期分组，连接线展示
- 导航栏公告图标一键跳转

### ⚙️ 部署优化

- Vercel `cleanUrls` + `trailingSlash: false`
- 构建跳过规则 `[skip-version]`
- ioredis 懒加载避免构建崩溃

---

## 📊 与官方 NotionNext 的区别

| 功能 | 官方 example | 本博客 |
|------|-------------|--------|
| 推送通知 | ❌ 无 | ✅ Web Push / Telegram / Server酱 |
| 字号调节 | ❌ 无 | ✅ 桌面/移动端独立 |
| 公告样式 | 简单列表 | 日期时间线 |
| 存储 | 无 | Redis + 文件回退 |
| 部署 | 标准 | cleanUrls + 跳过规则 |

📖 完整对比说明见 [README-NEXT.md](./README-NEXT.md)

---

## 🚀 快速开始

```bash
# 1. Fork 本仓库到 GitHub
# 2. 部署到 Vercel
# 3. 配置环境变量（.env.example 有完整说明）

# 本地开发
nvm use 22
npm i -g yarn
yarn
yarn dev
```

---

## 🔧 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `NOTION_PAGE_ID` | ✅ | Notion 页面 ID |
| `NEXT_PUBLIC_LINK` | ✅ | 博客链接 |
| `NOTIFY_ENABLE` | ❌ | 推送总开关（默认 false） |
| `REDIS_URL` | ❌ | Upstash Redis（推荐生产使用） |
| `VAPID_PUBLIC_KEY` | ❌ | Web Push VAPID 公钥（留空自动生成） |
| `VAPID_PRIVATE_KEY` | ❌ | Web Push VAPID 私钥 |
| `NEXT_PUBLIC_THEME` | ❌ | 主题（默认 example） |

完整列表见 [`.env.example`](./.env.example)

---

## 📁 目录结构

```
├── conf/                    # 配置目录
│   ├── notify.config.js     # 🆕 推送通知配置
│   ├── contact.config.js    # 联系方式配置
│   └── ...
├── lib/
│   ├── notify/              # 🆕 推送通知核心
│   │   ├── webpush.js       # VAPID + RFC 8291 加密
│   │   ├── storage.js       # Redis + 文件存储
│   │   ├── channels.js      # 各渠道发送器
│   │   └── index.js         # 推送调度
│   └── ...
├── pages/
│   ├── api/push/            # 🆕 推送 API
│   │   ├── vapid-public-key.js
│   │   ├── subscribe.js
│   │   ├── test.js
│   │   ├── send.js
│   │   ├── subscriptions.js
│   │   └── status.js
│   ├── admin/
│   │   └── notify-status.js # 🆕 状态检查页面
│   └── ...
├── public/
│   └── sw.js                # 🆕 Service Worker
├── themes/example/          # example 主题
│   ├── components/
│   │   ├── SettingsDropdown.js  # 🆕 通知设置 + 字号调节
│   │   ├── NoticeTimeline.js    # 🆕 公告时间线
│   │   ├── Announcement.js      # 重构为时间线
│   │   └── ...
│   └── style.js             # 字号/时间线样式
├── README.md                # 本文件
├── README-NEXT.md           # 🆕 定制说明文档
├── vercel.json              # cleanUrls 配置
└── .env.example             # 环境变量模板
```

---

## 🛠 技术栈

- **框架**：[Next.js 15](https://nextjs.org)
- **样式**：[Tailwind CSS](https://www.tailwindcss.cn/)
- **渲染**：[react-notion-x](https://github.com/NotionX/react-notion-x)
- **存储**：[Upstash Redis](https://upstash.com)（免费层 100K 命令/天）
- **推送**：Web Push API + Telegram Bot API + Server酱
- **部署**：[Vercel](https://vercel.com)

---

## 🔐 安全

- ✅ 无硬编码密钥 / Token / 密码
- ✅ 所有敏感配置通过环境变量传入
- ✅ `.env.local`、`.next/`、`*.pem` 已 gitignore
- ✅ VAPID 密钥存储在 Redis，不提交到 Git

---

## 👤 博主信息

| 项目 | 链接 |
|------|------|
| 博客 | https://blog.20240606.xyz |
| GitHub | https://github.com/666su |
| Telegram | https://t.me/Suxun1912 |
| B站 | https://space.bilibili.com/1561087564 |

---

## 📄 License

The MIT License.

基于 [NotionNext](https://github.com/tangly1024/NotionNext) 二次开发。