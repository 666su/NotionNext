# 🔄 更新日志 — 666su/NotionNext 自定义改动

> 本文件记录所有与官方 NotionNext 不同的自定义修改，按日期倒序排列。
> 以后每次更新请在此追加记录，方便与上游同步时对照。

---

## 更新规范

每次自定义修改时，在此文档**顶部**（最新日期）追加一条记录：

```markdown
## YYYY-MM-DD 标题

### 涉及文件
- `path/to/file.js` — 改动说明

### 上游冲突风险
- 高/中/低 — 说明原因
```

与上游同步时，按本文件逐条检查是否被覆盖。

---

## 2026-09-21 文档与修复

### 文档更新

| 文件 | 改动 |
|------|------|
| `README.md` | 重写为个人博客项目页，替换官方简介 |
| `README-NEXT.md` | 扩充为完整定制说明（架构图、故障排除、技术决策） |
| `UPDATE-NOTES.md` | **新增**：本文件，记录所有自定义改动 |

### Bug 修复

| 文件 | 问题 | 修复 |
|------|------|------|
| `lib/notify/webpush.js` | JWT ES256 签名格式错误（DER vs Raw r\|\|s） | 添加 `derToRawSignature()` 转换函数 |
| `lib/notify/storage.js` | VAPID 密钥每次部署变化 → 403 | 添加内存缓存，同一进程内密钥永远一致 |
| `themes/example/components/SettingsDropdown.js` | 浏览器复用旧订阅 → 403 | 每次订阅前强制取消旧订阅 |
| `lib/notify/webpush.js` | Crypto-Key 缺少 `p256=` 前缀 → 400 | `Crypto-Key: p256=${publicKey}` |
| `themes/example/components/SettingsDropdown.js` | VAPID 密钥更换后按钮灰色 | 自动取消旧订阅再重新订阅 |
| `lib/notify/storage.js` | ioredis 顶层导入导致构建崩溃 | `await import('ioredis')` 懒加载 |
| `pages/admin/notify-status.js` | 构建时 Redis 连接报错 | 添加 `BUILD_MODE` 检查跳过 |

### 上游冲突风险：🟡 中

- `webpush.js` 是全新文件，无冲突
- `storage.js` 是全新文件，无冲突
- `SettingsDropdown.js` 修改较多，同步上游时需注意

---

## 2026-09-20 推送通知系统 v1

### 新增文件

| 文件 | 说明 |
|------|------|
| `lib/notify/webpush.js` | Web Push 原生实现（VAPID + RFC 8291，零依赖） |
| `lib/notify/storage.js` | 存储抽象层（Redis + 文件回退） |
| `lib/notify/channels.js` | 各渠道发送器（Telegram / Server酱 / Web Push / Webhook） |
| `lib/notify/index.js` | 推送调度（检测新文章 → 遍历订阅者 → 按渠道分发） |
| `conf/notify.config.js` | 推送配置（NOTIFY_ENABLE / VAPID / Webhook / Secret） |
| `pages/api/push/vapid-public-key.js` | GET VAPID 公钥 |
| `pages/api/push/subscribe.js` | POST/DELETE 订阅管理 |
| `pages/api/push/subscriptions.js` | GET 订阅查询 |
| `pages/api/push/test.js` | POST 测试通知 |
| `pages/api/push/send.js` | POST 手动触发推送 |
| `pages/api/push/status.js` | GET 状态检查 |
| `pages/admin/notify-status.js` | 状态检查页面 |
| `public/sw.js` | Service Worker（接收推送 + 点击跳转） |

### 修改文件

| 文件 | 改动 |
|------|------|
| `blog.config.js` | 添加 `...require('./conf/notify.config')` |
| `.env.example` | 添加推送相关环境变量说明 |
| `lib/db/SiteDataApi.js` | 添加 `checkAndNotify` 调用 |
| `themes/example/components/SettingsDropdown.js` | 通知设置 UI（三种渠道 + 内联配置指南 + 测试按钮） |

### 上游冲突风险：🟢 低

- 推送系统全部是全新文件，不影响官方代码
- `SettingsDropdown.js` 修改较多，同步时需手动合并

---

## 2026-09-19 文章字号调节 + 公告时间线 + 上游同步

### 🔠 文章字号调节

| 文件 | 改动 |
|------|------|
| `pages/_document.js` | 添加 `fontScaleScript` 预加载脚本（避免刷新闪烁） |
| `themes/example/style.js` | 添加 `--article-font-scale` CSS 变量及 `.notion` 基准字号缩放 |
| `themes/example/components/SettingsDropdown.js` | 字号滑块（12-24px，桌面/移动端独立） |
| `themes/example/components/Header.js` | 字号快捷按钮（A- / A / A+） |

### 📅 公告时间线

| 文件 | 改动 |
|------|------|
| `themes/example/components/NoticeTimeline.js` | **新增**：时间线组件（日期分组 + 连接线条） |
| `themes/example/components/Announcement.js` | 从简单列表重构为时间线布局 |
| `themes/example/index.js` | 引入 `NoticeTimeline` 组件 |
| `themes/example/style.js` | 添加时间线样式（连接线、日期标签、响应式） |
| `themes/example/components/Header.js` | 导航栏添加公告图标跳转 |
| `lib/db/SiteDataApi.js` | 公告数据按日期排序 |
| `lib/db/notion/getPageProperties.js` | 公告属性增强 |
| `pages/index.js` | 首页公告集成 |

### 🔄 上游同步

同步官方 NotionNext 新功能：

| 功能 | 涉及文件 |
|------|---------|
| 文章系列（Series） | `lib/utils/series.js`、`pages/series/[series]/index.js`、`SeriesPanel.js`、`SeriesTimeline.js`、`SeriesGroup.js` |
| 写作日历 | `WritingCalendar.js` |
| 导航菜单增强 | `MenuList.js`、`MobileDrawer.js` |
| 博客列表优化 | `BlogListPage.js` |
| 主题切换器 | `LayoutSwitcher.js` |

### 上游冲突风险：🟡 中

- `Header.js`、`Announcement.js`、`style.js` 修改较多
- 同步上游时需逐文件检查

---

## 2026-09-02 BlogItem 微调

| 文件 | 改动 |
|------|------|
| `themes/example/components/BlogItem.js` | 1 行改动 |

### 上游冲突风险：🟢 低

---

## 2026-08-05 部署配置

| 文件 | 改动 |
|------|------|
| `vercel.json` | 添加 `cleanUrls: true`、`trailingSlash: false`、构建跳过规则 `[skip-version]` |

### 上游冲突风险：🟢 低

- `vercel.json` 是配置文件，同步时直接覆盖即可

---

## 文件冲突矩阵

同步上游时，按以下优先级处理：

### 🟢 低风险（可直接覆盖）

| 文件 | 说明 |
|------|------|
| `vercel.json` | 覆盖后重新添加 cleanUrls 配置 |
| `.env.example` | 覆盖后重新添加推送环境变量 |
| `blog.config.js` | 覆盖后重新添加 `require('./conf/notify.config')` |

### 🟡 中风险（需手动合并）

| 文件 | 冲突点 |
|------|--------|
| `themes/example/components/Header.js` | 字号按钮 + 公告图标 |
| `themes/example/components/SettingsDropdown.js` | 通知设置 + 字号调节 |
| `themes/example/components/Announcement.js` | 时间线重构 |
| `themes/example/style.js` | 字号变量 + 时间线样式 |
| `themes/example/index.js` | NoticeTimeline 引入 |
| `lib/db/SiteDataApi.js` | checkAndNotify 调用 |
| `pages/index.js` | 公告集成 |
| `pages/_document.js` | fontScaleScript |

### 🔴 高风险（需仔细检查）

| 文件 | 冲突点 |
|------|--------|
| `lib/db/notion/getPageProperties.js` | 公告属性增强 |

### 🟢 无冲突（全新文件）

| 文件 | 说明 |
|------|------|
| `lib/notify/*` | 推送通知系统 |
| `conf/notify.config.js` | 推送配置 |
| `pages/api/push/*` | 推送 API |
| `pages/admin/notify-status.js` | 状态页面 |
| `public/sw.js` | Service Worker |
| `themes/example/components/NoticeTimeline.js` | 时间线组件 |

---

## 同步上游操作步骤

```bash
# 1. 添加上游远程
git remote add upstream https://github.com/tangly1024/NotionNext.git

# 2. 获取上游最新代码
git fetch upstream

# 3. 创建同步分支
git checkout -b sync-upstream

# 4. 合并上游 main
git merge upstream/main

# 5. 按本文件逐文件检查冲突
#    - 🟢 低风险：直接接受上游版本，然后重新添加自定义配置
#    - 🟡 中风险：手动合并，保留自定义功能
#    - 🟢 无冲突：全新文件不会被覆盖

# 6. 测试构建
yarn build

# 7. 合并到 main
git checkout main
git merge sync-upstream

# 8. 推送
git push origin main

# 9. 在本文件追加同步记录
```

---

*最后更新：2026-09-21*