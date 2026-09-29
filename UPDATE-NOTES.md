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

## 2026-09-29 新增左侧排行榜与文章点赞功能

### 背景

官方 NotionNext **既没有文章点赞功能，也没有可用的阅读量排行**。本博客左侧（启用
`LAYOUT_SIDEBAR_REVERSE` 后的空白区）此前一直空着，右侧则是系列时间线 + 写作日历，
左右不对称。

本次在这块空白区新增**上下两个榜单**，均按次数**从高到低**排序：

- **阅读榜**（上）— 文章查看次数
- **点赞榜**（下）— 文章点赞次数

点赞功能是排行榜有数据的前提，因此一并实现。同时，原主题顶部的阅读量是一个
不蒜子空 `span`（线上根本不显示数字），本次替换为真实的自建计数。

### 界面结构

```
┌───────────────────────────────────────────────────────┐
│  Header / TitleBar                                    │
├──────────────┬─────────────────────┬──────────────────┤
│  🏆 阅读榜    │                     │  📚 系列时间线    │
│   1 文章A 300 │      文章列表/正文    │  📅 写作日历      │
│   2 文章B 200 │                     │                  │
│  ──────────  │                     │                  │
│  ❤️ 点赞榜    │                     │                  │
│   1 文章X  90 │                     │                  │
└──────────────┴─────────────────────┴──────────────────┘
   DOM 最后一项 → flex-row-reverse 下落在视觉最左
```

### 涉及文件

**新增（13 个）**

| 文件 | 作用 |
|------|------|
| `conf/rank.config.js` | 配置：开关 / 条数 / 去重窗口 |
| `lib/rank/storage.js` | 存储层：Redis Hash 自增 + 文件回退 + 去重标记 |
| `lib/rank/index.js` | 业务逻辑：浏览去重、点赞切换、榜单排序、数据导入 |
| `pages/api/rank/view.js` | POST 记录浏览 |
| `pages/api/rank/like.js` | POST 点赞/取消，GET 查询状态 |
| `pages/api/rank/info.js` | GET 单篇互动数据（`record=1` 时顺带计数） |
| `pages/api/rank/top.js` | GET 双榜单数据（按次数降序） |
| `pages/api/rank/seed.js` | POST 导入历史数据 / 重置计数（需令牌） |
| `pages/api/rank/status.js` | GET 存储后端与计数概况（部署自检） |
| `themes/example/components/RankBoard.js` | 左侧双榜单组件 |
| `themes/example/components/LikeButton.js` | 点赞按钮（inline / block） |
| `themes/example/components/rankClient.js` | 互动数据客户端共享 store |
| `themes/example/components/ArticleInteraction.js` | 文章页互动区（唯一计数触发点） |

**测试（6 个）**

| 文件 | 用例数 | 覆盖 |
|------|-------|------|
| `__tests__/lib/rank-storage.test.js` | 21 | 自增、三种导入模式、清空、去重标记、匿名哈希 |
| `__tests__/lib/rank.test.js` | 17 | 浏览去重、并发计数、点赞幂等与取消、计数隔离 |
| `__tests__/lib/rank-board.test.js` | 15 | **降序排序**、并列按时间、limit、过滤菜单页 |
| `__tests__/lib/rank-api.test.js` | 30 | 6 个接口的完整请求-响应与错误分支 |
| `__tests__/themes/rank-board-component.test.js` | 10 | 组件渲染：上下排列、降序、空态与失败降级 |
| `__tests__/themes/rank-layout.test.js` | 12 | **布局不变量**：榜单在左、系列面板在右 |

**修改（6 个）**

| 文件 | 改动 |
|------|------|
| `blog.config.js` | 引入 `conf/rank.config` |
| `.env.example` | 补充排行榜环境变量说明 |
| `themes/example/index.js` | 左侧栏挂载 `RankBoard`；文章页挂载 `ArticleInteraction` |
| `themes/example/components/PostMeta.js` | 阅读量改为真实数字（移除不蒜子空 span）+ 点赞按钮 |
| `themes/example/style.js` | 排行榜样式（滚动条、标题省略、点赞回弹） |
| `README-NEXT.md` | 新增功能说明章节 |

### 配置项

| 配置 | 默认值 | 说明 |
|------|--------|------|
| `RANK_ENABLE` | `true` | 总开关 |
| `RANK_VIEW_ENABLE` | `true` | 阅读统计与阅读榜 |
| `RANK_LIKE_ENABLE` | `true` | 点赞功能与点赞榜 |
| `RANK_LIST_SIZE` | `10` | 每个榜单条数（1–50） |
| `RANK_VIEW_WINDOW_HOURS` | `6` | 同访客重复浏览去重窗口，`0` 为不去重 |
| `RANK_MAX_CANDIDATES` | `500` | 参与排行的候选文章上限 |
| `RANK_STORAGE_PATH` | 空 | 未配 Redis 时的计数文件路径 |
| `RANK_SEED_SECRET` | 空 | 导入历史数据 / 重置计数的管理令牌 |

### 关键技术决策

| 问题 | 方案 |
|------|------|
| 左侧空白区的定位 | 容器是 `flex-row-reverse`（`LAYOUT_SIDEBAR_REVERSE` 恒真），**DOM 最后一个元素在视觉最左**；榜单挂到内容之后，并留 `order-first` 兜底 |
| 阅读量是空壳 | 自建计数，不再依赖第三方统计 |
| 高并发丢计数 | Redis `HINCRBY` 原子自增；文件回退用进程内串行队列 |
| 刷新刷阅读量 | 按 `IP + UA` 哈希去重（不落库原始 IP），默认 6 小时 |
| 连点刷赞 | 标记存 Redis `SET NX`，前端发显式 `like`/`unlike`，接口幂等 |
| 文章页重复请求 | 模块级 store：`ArticleInteraction` 唯一触发，其余组件只订阅 |
| 榜单计算开销 | 结果 `s-maxage=60` 允许 CDN 缓存 |
| 重置后无法再点赞 | `resetCounters` 同步清除 `liked-by` 去重标记 |

### 注意事项

- **必须配 `REDIS_URL`**（可复用推送通知的同一实例）。未配置时计数写本地文件，
  在 Vercel 上不会持久化。
- 计数**从上线后从零累计**。需要历史数据时用 `/api/rank/seed`，
  且应先设 `RANK_SEED_SECRET`：

  ```bash
  curl -X POST https://blog.20240606.xyz/api/rank/seed \
    -H 'Content-Type: application/json' \
    -d '{"secret":"你的密钥","action":"import","mode":"max",
         "views":{"文章ID":1234}}'
  ```

  `mode:"max"` 只增不减，可安全重复执行。

- 榜单在 `lg` 以上显示，移动端自动隐藏，避免挤占小屏阅读空间。
- 部署自检：`curl https://你的域名/api/rank/status`，`storage` 应为 `redis`。

### 上游冲突风险

- **中** — `themes/example/index.js` 是上游主题文件，本次在其
  `container-wrapper` 内新增了 `RankBoard`、并在文章页新增 `ArticleInteraction`；
  同步上游时需重新应用这两处挂载。
- **中** — `themes/example/components/PostMeta.js` 移除了上游的不蒜子空 `span`，
  同步上游时不要把该行覆盖回来（否则阅读量会重新变成空壳）。
- **低** — `lib/rank/`、`pages/api/rank/`、`conf/rank.config.js`、
  `themes/example/components/Rank*.js` 等均为本仓库独有，上游无同名文件。
- **低** — `blog.config.js` 仅新增一行 `...require('./conf/rank.config')`。

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