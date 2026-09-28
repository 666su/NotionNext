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

## 2026-09-28 README 改为中英双语，默认展示英文

### 背景

仓库根目录的 `README.md` 此前是纯中文，而 GitHub 默认展示它。
参考作者其他开源项目（`dsh-desktop`）的做法，改为
**英文为默认（`README.md`）+ 中文（`README.zh-CN.md`）**，
两个文件顶部各放一对 badge 按钮互相跳转，当前语言高亮为蓝色。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `README.md` | **重写为英文**（GitHub 默认展示这一份），顶部加中英切换 badge |
| `README.zh-CN.md` | **新增**：原中文内容迁移至此，顶部加中英切换 badge |
| `README_EN.md` | 上游官方英文说明，仅修正其自身语言切换链接 `./README.md` → `./README.zh-CN.md` |

### 切换按钮写法

```markdown
[![English](https://img.shields.io/badge/English-2f81f7?style=for-the-badge)](README.md)
[![简体中文](https://img.shields.io/badge/%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87-8b949e?style=for-the-badge)](README.zh-CN.md)
```

当前语言用 `2f81f7`（蓝），另一种语言用 `8b949e`（灰），进入页面即可看出所处语言版本。

### 注意事项

- **与上游约定相反**：上游 `README.md` 是中文、`README_EN.md` 是英文。
  本仓库按需求改为英文默认，同步上游时**不要**把上游的 `README.md` 直接覆盖回来。
- `README_EN.md` 是上游文件且目前无人链接，保留仅作参考；
  本仓库真正的英文说明是 `README.md`。
- badge 文字里的中文需 URL 编码（`%E7%AE%80%E4%BD%93%E4%B8%AD%E6%96%87` = 简体中文），否则部分环境不显示。

### 上游冲突风险

- **高** — `README.md` 是与上游差异最大的文件之一（上游为中文），
  每次同步上游都需重新应用英文版；建议同步后立即检查该文件语言。
- **低** — `README.zh-CN.md` 为本仓库独有，上游不存在同名文件。
- **低** — `README_EN.md` 仅 1 行链接改动。

---

## 2026-09-28 修复 series 属性改为 Notion 下拉类型后列表排版错乱

### 问题现象

Notion 数据库中 `series` 属性由 **text(rich_text)** 改成 **tags/下拉选择**（select / multi_select）后：

- 首页/文章列表的**系列分组全部失效**，所有文章退化成普通单列列表（排版错乱）
- 分类切换按钮（LayoutSwitcher 1/2/3 列）消失（`hasSeries` 恒为 false）
- `/series/[series]` 详情页 `getStaticProps` 抛出 `TypeError: post.series.trim is not a function` → 页面 500
- `/series/*` 静态路径全部丢失（`getAllSeriesNames` 返回空）

### 根因

`lib/db/notion/getPageProperties.js` 对 `select`/`multi_select` 类型执行
`getTextContent(val).split(',')`，返回的是**数组**；而 text 类型返回**字符串**。
自定义的系列功能代码里到处写着 `typeof post.series === 'string'` 和 `post.series.trim()`，
属性类型一改就全部失配 —— 系列被当成“无系列”文章，导致上述所有现象。

> 线上实测（2026-09-28 抓取 `blog.20240606.xyz` 的 `__NEXT_DATA__`）：
> `posts[].series` 已经是 `["Cloudflare建站实践"]` 这样的**数组**，
> 而 `.next/cache` 中旧数据仍是字符串，确认是 Notion 属性类型变更所致。

### 涉及文件

| 文件 | 改动 |
|------|------|
| `lib/utils/series.js` | **新增** `normalizeSeriesName()` / `normalizeSeriesNames()` 归一化工具；`groupPostsBySeries`、`getAllSeriesNames` 改用归一化，移除 `typeof === 'string'` 硬判断；支持 multi_select 多值（一篇可属多个系列） |
| `lib/db/notion/getPageProperties.js` | 在属性解析后统一收敛：`series` → 字符串数组、`number` → 字符串，兼容 text/select/multi_select 三种类型 |
| `lib/db/notion/getCustomMenu.js` | 菜单自动跳转系列页的 `typeof page.series === 'string'` 判断改为 `normalizeSeriesName()` |
| `pages/series/[series]/index.js` | `post.series.trim() === target` 改为 `normalizeSeriesNames(post.series).includes(target)`，修复 TypeError |
| `__tests__/lib/utils/series.test.js` | **新增**：覆盖 text / select / multi_select（含多值）兼容性与系列分组回归 |

### 兼容性

- 原来的 **text(rich_text)** 类型行为完全不变（字符串经归一化后仍是同一系列名）
- 现在 select / multi_select / text **三种类型都能正常工作**
- multi_select 多选时，文章会出现在它所属的**每个**系列分组中

### 验证

- **改前/改后对照构建**（同一份线上数据，先 `git stash` 跑原始代码再跑修复代码）：

  | 检查项 | 修复前 | 修复后 |
  |--------|--------|--------|
  | 首页 `/series/` 链接数 | 0 | **4** |
  | 侧栏「系列全集」区块 | 缺失 | ✓ 存在 |
  | 系列时间线条目 | 缺失 | ✓ 4 条 |
  | 预渲染 `/series/*` 页面数 | 0 | **4** |

- 修复后 `next build` 退出码 0，4 个系列页全部预渲染成功：
  `Cloudflare建站实践`(2 篇)、`软路由折腾系列`(2 篇)、`开源工具推荐`(1 篇)、`DeepSeek Harness`(2 篇)，
  7 篇文章全部归组、无遗漏。
- `jest` 全量 **39 套 / 220 个测试通过**（含本次新增 13 个），`tsc --noEmit` 无报错。

> 附注：对照构建显示首页 SSR 首屏输出骨架屏（`themes/theme.js` 的 `next/dynamic`
> 在 SSR 阶段渲染 `IndexLayoutLoading`），改前改后均存在，与本次改动无关。

### 上游冲突风险

- **高** — `getPageProperties.js` 本就是与上游差异最大的文件之一（此前已标红），
  本次在其属性解析段落新增 2 行归一化逻辑，同步上游时需重新应用。
- **中** — `lib/utils/series.js`、`pages/series/[series]/index.js`、`getCustomMenu.js` 属自研系列功能，上游无对应实现，不会冲突。

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