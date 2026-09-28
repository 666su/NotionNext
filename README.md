[![English](https://img.shields.io/badge/English-2f81f7?style=for-the-badge)](README.md)
[![简体中文](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-8b949e?style=for-the-badge)](README.zh-CN.md)

<div align="center">

# 📝 666su's Blog

**A personal blog built on NotionNext**

[🌐 Live Site](https://blog.20240606.xyz) · [📋 Customization Guide](./README-NEXT.md)

```
Next.js 15 + Notion API + Vercel
```

</div>

---

## ✨ Highlights

This blog is a fork of [NotionNext](https://github.com/tangly1024/NotionNext) that adds several
features on top of the official `example` theme.

### 🔔 Push Notifications

**Not available in upstream NotionNext.** A reader-configurable notification system built from scratch:

- **Web Push** — desktop notifications via a native VAPID + RFC 8291 implementation (zero dependencies)
- **Telegram** — delivered through the Bot API; readers supply their own Bot Token and Chat ID
- **Server酱** — WeChat delivery; readers supply their own SendKey
- **Storage** — Redis persistence (Upstash) with a file fallback, surviving redeploys
- **Security** — every key is supplied by the reader and never passes through the site owner

> Readers pick a channel in the settings panel, paste their own key, and it works immediately.

### 🔠 Article Font Size

- Independent desktop / mobile font-size control (12–24px)
- No flash on page reload (preload script in `_document.js`)
- Scales through a CSS variable on the `.notion` base font size

### 📅 Announcement Timeline

- The announcement page is restructured as a dated timeline
- Grouped by date and joined by a connecting line
- One-click jump from the navbar announcement icon

### ⚙️ Deployment Tweaks

- Vercel `cleanUrls` + `trailingSlash: false`
- Build-skip rule `[skip-version]`
- Lazy `ioredis` loading to avoid build crashes

---

## 📊 Differences from Upstream NotionNext

| Feature | Official `example` | This blog |
|---------|--------------------|-----------|
| Push notifications | ❌ None | ✅ Web Push / Telegram / Server酱 |
| Font size control | ❌ None | ✅ Independent desktop/mobile |
| Announcement style | Plain list | Dated timeline |
| Storage | None | Redis + file fallback |
| Deployment | Standard | cleanUrls + skip rule |

📖 See [README-NEXT.md](./README-NEXT.md) for the full comparison.

---

## 🚀 Quick Start

```bash
# 1. Fork this repository on GitHub
# 2. Deploy to Vercel
# 3. Configure environment variables (see .env.example)

# Local development
nvm use 22
npm i -g yarn
yarn
yarn dev
```

---

## 🔧 Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NOTION_PAGE_ID` | ✅ | Notion page ID |
| `NEXT_PUBLIC_LINK` | ✅ | Blog URL |
| `NOTIFY_ENABLE` | ❌ | Master switch for push (default false) |
| `REDIS_URL` | ❌ | Upstash Redis (recommended in production) |
| `VAPID_PUBLIC_KEY` | ❌ | Web Push VAPID public key (auto-generated when empty) |
| `VAPID_PRIVATE_KEY` | ❌ | Web Push VAPID private key |
| `NEXT_PUBLIC_THEME` | ❌ | Theme (default `example`) |

See [`.env.example`](./.env.example) for the complete list.

---

## 📁 Project Structure

```
├── conf/                    # Configuration
│   ├── notify.config.js     # 🆕 Push notification config
│   ├── contact.config.js    # Contact details
│   └── ...
├── lib/
│   ├── notify/              # 🆕 Push notification core
│   │   ├── webpush.js       # VAPID + RFC 8291 encryption
│   │   ├── storage.js       # Redis + file storage
│   │   ├── channels.js      # Per-channel senders
│   │   └── index.js         # Dispatch
│   └── ...
├── pages/
│   ├── api/push/            # 🆕 Push API
│   │   ├── vapid-public-key.js
│   │   ├── subscribe.js
│   │   ├── test.js
│   │   ├── send.js
│   │   ├── subscriptions.js
│   │   └── status.js
│   ├── admin/
│   │   └── notify-status.js # 🆕 Status page
│   └── ...
├── public/
│   └── sw.js                # 🆕 Service Worker
├── themes/example/          # example theme
│   ├── components/
│   │   ├── SettingsDropdown.js  # 🆕 Notification settings + font size
│   │   ├── NoticeTimeline.js    # 🆕 Announcement timeline
│   │   ├── Announcement.js      # Rebuilt as a timeline
│   │   └── ...
│   └── style.js             # Font-size / timeline styles
├── README.md                # This file (English)
├── README.zh-CN.md          # 简体中文
├── README-NEXT.md           # 🆕 Customization guide
├── vercel.json              # cleanUrls config
└── .env.example             # Env template
```

---

## 🛠 Tech Stack

- **Framework** — [Next.js 15](https://nextjs.org)
- **Styling** — [Tailwind CSS](https://tailwindcss.com/)
- **Rendering** — [react-notion-x](https://github.com/NotionX/react-notion-x)
- **Storage** — [Upstash Redis](https://upstash.com) (free tier: 100K commands/day)
- **Push** — Web Push API + Telegram Bot API + Server酱
- **Hosting** — [Vercel](https://vercel.com)

---

## 🔐 Security

- ✅ No hardcoded keys / tokens / passwords
- ✅ All sensitive configuration comes from environment variables
- ✅ `.env.local`, `.next/` and `*.pem` are gitignored
- ✅ VAPID keys are stored in Redis and never committed

---

## 👤 Author

| Item | Link |
|------|------|
| Blog | https://blog.20240606.xyz |
| GitHub | https://github.com/666su |
| Telegram | https://t.me/Suxun1912 |
| Bilibili | https://space.bilibili.com/1561087564 |

---

## 📄 License

The MIT License.

Based on [NotionNext](https://github.com/tangly1024/NotionNext).
