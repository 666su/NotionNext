# Jason Blog Admin —— Phase 0 现有项目审计报告

- **审计对象**：`D:\save_files\aDrive\DeepSeek Harness\NotionNext`（NotionNext 4.10.8 定制 fork，线上站点 <https://blog.20240606.xyz>）
- **审计阶段**：Phase 0（**只读**）。未修改任何生产代码、未安装依赖、未部署、未写入 Notion、未改动 Vercel / Cloudflare / GitHub 配置、未删除任何文件。
- **审计时间**：2026-11-09
- **Git 基线**：分支 `main`，HEAD `7c734e7`（2026-11-04），远端 `https://github.com/666su/NotionNext.git`；审计时工作区已有未提交内容：`.dsh-ops/`、`_project-ai/DELIVERABLES/*.json`（**保持原样，未触碰**）。
- **方法**：静态代码审计（`pages/`、`lib/`、`components/`、`conf/`、`themes/`、`cloudflare/`、构建与 CI 配置）+ 只读线上探测（GET `/`、`/admin`、`/admin/notify-status`、`/dashboard`）+ 一次只读 DNS 查询。全部结论带 `path:line` 证据。
- **明细证据**：本报告的三份支撑材料同目录留档——
  - [架构明细](_findings/ARCHITECTURE.md)（468 行）
  - [数据源明细](_findings/DATA_SOURCES.md)（365 行）
  - [安全明细](_findings/SECURITY.md)（664 行）

> 本报告的结论 **优先于 PROJECT_SPEC.md 中的技术假设**。PROJECT_SPEC 里"Notion + GitHub + Vercel + Cloudflare + Twikoo"这条链中，**Cloudflare 目前并不在请求路径上**（见 §3.2），因此"Worker + D1 接收统计"的默认方案**在当前架构下不可直接落地**，替代方案见 [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §6。

---

## 1. TL;DR（十条结论）

1. **技术栈是纯 Pages Router**：Next.js **15.5.21**、React 18.3.1、Node `>=22 <25`、yarn 1.22.22；根目录**没有** `app/`。后台必须落在 `pages/admin/**`，**不允许**也不必要迁到 App Router。
2. **`/admin` 今天是一个"半占用"命名空间**：只有 `pages/admin/notify-status.js` 一个**公开、无鉴权**的诊断页；`pages/admin/index.js` **不存在**，所以 `/admin` 及其子路径当前被 `pages/[prefix]/index.js`、`pages/[prefix]/[slug]/index.js` 这些动态路由接管（会真实拉 Notion 数据后 404）。线上实测：`/admin` → **404**，`/admin/notify-status` → **200**。
3. **生产不是静态导出**：`output` 仅在 `EXPORT=true` / `NEXT_BUILD_STANDALONE=true` 时才切换（`next.config.js:190-194`），Vercel 上是普通 Node serverless（ISR + SSR 混合）。→ 后台可以用 `getServerSideProps` + API Route，**绝不能用 `getStaticProps`**（公开页面全是 ISR，会被 CDN 缓存）。
4. **唯一必须改的渲染入口是 `pages/_app.js`**：它无条件用主题 `LayoutBase` 包住所有页面，并注入 `SEO` / `ExternalPlugins`（统计、广告、挂件）/ `BlogPet`（`pages/_app.js:87-98`）。后台要独立外观，必须在这里加"按 `pathname` 分流"的分支——这是**唯一一处会影响公开页面渲染的改动**。
5. **`middleware.ts` 是 fail-open 结构**：仅当 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 存在时才启用 Clerk 分支，否则 `noAuthMiddleware` 全放行（`middleware.ts:66`）；且已有的"管理员路由"只匹配 `/admin/(.*)/memberships` 与 `/admin/(.*)/domain`（`middleware.ts:24-27`）。→ 新后台**必须自建 fail-closed 守卫**，不能沿用这套语义。
6. **Cloudflare 不在请求链路上**：DNS 解析到 Vercel（`NS=vercel-dns-017.com`，A `216.198.79.1` / `64.29.17.1`），线上响应头 `server: Vercel` 且**无 `cf-ray`**。仓库里唯一的 Cloudflare 产物是独立的图片反向代理 Worker（`cloudflare/notion-image-proxy/`，`wrangler.toml` 无 D1/KV 绑定）。→ **Vercel 函数无法绑定 D1**；也没有 `CF-IPCountry`、边缘日志、Cloudflare Web Analytics 可用。
7. **站点当前没有任何"可查询"的流量数据源**：首页 HTML 实测**没有**任何统计脚本（无 Vercel Analytics、无不蒜子、无 Umami/Clarity/GA/51LA）；`rank:views` 只有"文章累计去重 PV"、无日期维度；Twikoo 只有前端 CDN 调用、无服务端统计能力。→ **PV/UV/Session/来源/设备/国家/阅读深度必须自建采集**。
8. **已有可复用的服务端资产**：Notion 只读链路（`notion-client`，**无需 token**，只要 `NOTION_PAGE_ID`）、Redis（生产已配置，`/admin/notify-status` 实测 `storage=redis`）、`lib/cache` 三级缓存、`ioredis`、`@supabase/supabase-js`（仅用于 Claude 贡献热力图）、无头组件与图标库。**没有**图表库、**没有** cookie/session/CSRF 基础设施。
9. **发现 6 个"现在就能被远程利用"的问题**（与是否新增后台无关）：`RANK_SEED_SECRET` 经 `siteConfig()` **可能被公开到 `__NEXT_DATA__`**、`/api/push/test` 零鉴权 SSRF、`/api/cache` fail-open、`/api/push/subscriptions` 零鉴权泄露 bot token、`/admin/notify-status` 与 `/api/push/status` 公开回显 Redis 状态（实测可读到订阅总数 4、VAPID 存在、`storage=redis`）、OAuth 回调把 token 打进日志与跳转 URL。详见 [SECURITY_REVIEW.md](SECURITY_REVIEW.md)。
10. **可行**：在现有项目内落地集成式后台 **不需要**换主题、不需要迁移路由、不需要新建站点、不需要第二套 Vercel 项目；代价是接受 `pages/_app.js` + `middleware.ts` 两处受控改动，并严格把后台排除在 ISR/CDN 缓存之外。

---

## 2. 当前项目真实结构

### 2.1 版本与运行环境

| 项 | 实际值 | 证据 |
| --- | --- | --- |
| 项目版本 | NotionNext **4.10.8**（定制 fork） | `package.json:3` |
| Next.js | **15.5.21**（`yarn.lock` 锁定） | `package.json:87` |
| React / ReactDOM | **18.3.1** | `package.json:91-92` |
| 路由模式 | **纯 Pages Router**（无 `app/`） | 根目录无 `app/`；`pages/` 下 47 个页面文件 |
| Node | `>=22 <25`，`.nvmrc`/`.node-version` = 22 | `package.json:7-9`；`Dockerfile:4` |
| TypeScript | 5.9.3，`strict: true`，`allowJs: true` | `package.json:134`；`tsconfig.json` |
| 别名 | `@/*` → `./*`（`@/lib`、`@/components`、`@/themes`…） | `tsconfig.json:4-32`；`next.config.js:414` |
| 当前主题 | `example`（`THEME` 默认值） | `blog.config.js:10`；`themes/example/` |
| 页面 / API 规模 | 47 个页面文件；**21 个 API 路由文件** | `find pages -name '*.js'`；`find pages/api` |
| 构建 | `build` = `cross-env BUILD_MODE=true next build` | `package.json:20` |
| 质量门禁 | `yarn lint`、`yarn type-check`、`yarn test`、lockfile 校验 | `.github/workflows/ci.yml:18-46` |

### 2.2 路由地图（Pages Router，按实际文件）

| 路由 | 文件 | 渲染 | 说明 |
| --- | --- | --- | --- |
| `/` | `pages/index.js` | ISR | 首页（`latestPosts` + 侧栏） |
| `/[prefix]` | `pages/[prefix]/index.js` | ISR，`fallback: 'blocking'` | 一级 slug：菜单页 / 关于页 / **当前会吞掉 `/admin`** |
| `/[prefix]/[slug]` | `pages/[prefix]/[slug]/index.js` | ISR | 文章详情页 |
| `/[prefix]/[slug]/[...suffix]` | `pages/[prefix]/[slug]/[...suffix].js` | ISR | 三级以上后缀 |
| `/page/[page]` | `pages/page/[page].js` | ISR | 首页分页 |
| `/category`、`/category/[category]` | `pages/category/**` | ISR | 分类 |
| `/tag`、`/tag/[tag]` | `pages/tag/**` | ISR | 标签 |
| `/search`、`/search/[keyword]` | `pages/search/**` | ISR | 站内搜索（客户端过滤） |
| `/series`、`/series/[series]` | `pages/series/**` | ISR | 系列 |
| `/archive` | `pages/archive/index.js` | ISR | 归档 |
| `/dashboard` | `pages/dashboard/[[...index]].js` | ISR（预渲染） | Clerk 会员中心（**与后台无关**） |
| `/sign-in`、`/sign-up`、`/auth` | 同名目录 | 客户端 | Clerk 登录 / OAuth 回跳 |
| **`/admin/notify-status`** | `pages/admin/notify-status.js` | **GSSP** | **公开、无鉴权**的推送/Redis 诊断页 |
| **`/admin`**、**`/admin/<x>`** | **无文件** | 被 `[prefix]` 系列接管 | 线上 `/admin` 实测 404 |
| `/api/*` | `pages/api/**`（21 个文件） | Node runtime | 见 §2.4 |

### 2.3 目录结构（与本任务相关的部分）

```text
NotionNext/
├── pages/                    # 全部路由（Pages Router）
│   ├── _app.js               # 全局外壳：主题 Layout + SEO + 插件 + 桌宠（必须改）
│   ├── _document.js          # <head> 注入暗色脚本（不改）
│   ├── [prefix]/...          # 动态文章/菜单路由（绝对不碰）
│   ├── admin/notify-status.js# 占位中的 /admin 命名空间
│   └── api/                  # 21 个 API 路由
├── lib/
│   ├── db/SiteDataApi.js     # 全站数据入口（fetchGlobalAllData / resolvePostProps）
│   ├── db/notion/*           # notion-client 封装、字段解析
│   ├── cache/*               # redis / file / memory / vercel 四级缓存
│   ├── rank/*                # 排行榜与点赞（Redis Hash + 文件回退）
│   ├── notify/*              # Web Push 订阅存储（Redis 单键）
│   ├── config.js             # siteConfig()：Notion 表格配置可覆盖 BLOG 配置
│   ├── middleware/security.js# 死代码（从未被引用）
│   └── utils/*               # 通用工具（password.js、errorHandler、...）
├── components/               # 80+ 组件（含 BlogPet/、ui/dashboard/ 会员中心）
├── themes/example/           # 当前主题（LayoutBase = 全站外壳）
├── conf/*.config.js          # blog.config.js 的拆分配置
├── cloudflare/notion-image-proxy/  # 独立 Worker（图片代理，不在 Next 构建内）
├── cloudflare/…/wrangler.toml      # 无 D1 / KV / Queue 绑定
├── .github/workflows/        # 11 个 workflow（CI、CodeQL、上游 sync、GHCR…）
└── docs/                     # 上游文档站（VitePress）
```

### 2.4 现有 API 面（21 个文件）

`pages/api/` 下：`cache`、`revalidate`、`rss`、`subscribe`、`notion-comments`、`user`、`auth/callback/notion`、`blog-pet/posts`、`claude/contribution-refresh`、`push/{send,status,subscribe,subscriptions,test,vapid-public-key}`、`rank/{info,like,seed,status,top,view}`。

- **全部未声明** `export const config = { runtime, maxDuration }` → 默认 Node runtime，时长上限取决于 Vercel 计划（仓库不可见）。
- 鉴权现状：只有 `revalidate`（Bearer `REVALIDATION_TOKEN`）、`cache`（Bearer `CACHE_REVALIDATION_TOKEN`，**未配置则放行**）、`push/send`（`x-notify-secret`）、`rank/seed`（`RANK_SEED_SECRET`）四处有"共享密钥"式校验，其余无鉴权。逐项结论见 [SECURITY_REVIEW.md](SECURITY_REVIEW.md) §2。

---

## 3. 部署与线上实况（只读探测）

### 3.1 实测结果

| 请求 | 状态 | 关键响应头 | 判读 |
| --- | --- | --- | --- |
| `GET /` | 200 | `server: Vercel`、`x-vercel-cache: STALE`、**无 `cf-ray`** | 直连 Vercel，页面走 ISR/CDN |
| `GET /admin` | **404** | `x-vercel-cache: MISS` | 无后台，且被动态路由接管后 notFound |
| `GET /admin/notify-status` | **200** | `x-vercel-cache: MISS` | 公开可读；页面内渲染出 `storage=redis`、`Redis 已配置 ✅`、`订阅总数 4`、`VAPID ✅` |
| `GET /dashboard` | 200 | `x-vercel-cache: PRERENDER` | 预渲染的会员中心外壳 |
| `GET /` 的 HTML | — | 无任何统计脚本 | 实测无 Vercel Analytics / 不蒜子 / Umami / Clarity / GA / 51LA |

### 3.2 Cloudflare 的真实位置

- DNS：`blog.20240606.xyz` → `NS=vercel-dns-017.com`，A 记录 `216.198.79.1` / `64.29.17.1`（Vercel anycast）。
- 响应头无 `cf-ray`、`server` 为 Vercel ⟹ **没有 Cloudflare 前置代理**。
- 仓库里 Cloudflare 的唯一产物是 `cloudflare/notion-image-proxy/`：独立 Worker（`worker.mjs` 用 `caches.default` 缓存 7 天），`wrangler.toml` **没有 D1/KV/Queue 绑定**，通过 `npx wrangler deploy` 独立发布，与 Next 应用**无代码耦合**。

**结论**：PROJECT_SPEC 5.2 的"Cloudflare Worker + D1 + Cron Triggers"方案在当前架构下**不能直接落地**——Vercel 的 Node/Edge Runtime 没有 D1 binding，若要用 D1 必须①新开 Cloudflare 账号/zone、②把某个子域委派给 Cloudflare、③Vercel 侧通过公网 REST 访问 D1。这三点都属于"新增一套基础设施"，需要管理员明确批准（详见方案文档 §6）。

### 3.3 已确认可用的运行资源

| 资源 | 证据 | 用途 |
| --- | --- | --- |
| Vercel Node serverless（ISR + SSR + API） | `next.config.js:190-200`；线上 `x-vercel-cache` | 后台页面/API 的宿主 |
| **Redis（Upstash 风格，已配置）** | `/admin/notify-status` 实测 `storage=redis`、`redisConnected` | ISR 缓存、`rank:*`、`notify:data`；**可扩展为统计与会话存储** |
| `ioredis` | `package.json:80`；`lib/cache/redis_cache.js`、`lib/rank/storage.js` | 上述 Redis 的客户端 |
| `@supabase/supabase-js` | `package.json:74`；`lib/server/claude/contributionStore.js:2` | 目前只服务 Claude 贡献热力图（2 张表），**无统计表、无迁移文件** |
| Notion 只读数据 | `lib/db/notion/getNotionAPI.js`；`NOTION_PAGE_ID` | 文章/分类/标签元数据（**无需 token**） |

---

## 4. 与后台强相关的四条硬约束

### 4.1 渲染：所有页面都被主题外壳包裹

`pages/_app.js:87-98` 无条件渲染 `GlobalContextProvider → GLayout(主题 LayoutBase) → SEO + Component → ExternalPlugins + BlogPet`。
且 `pages/_document.js` 在 `<head>` 注入暗色模式脚本（给 `<html>` 加 `dark`/`light`），后台无法避免，**后台样式必须同时适配深色**。

→ 后台必须新增"`pathname` 以 `/admin` 开头"的分支：保留 `GlobalContextProvider`/`ClerkProvider`（否则 `lib/global.js` 的 Clerk hooks 前提被破坏），跳过 `GLayout`、`SEO`、`ExternalPlugins`、`BlogPet`。

### 4.2 缓存：后台不能静态化，也不能自建第二份 Notion 缓存

- 公开页面 `revalidate` 默认 60s（`blog.config.js:15`），动态路由 `fallback: 'blocking'`。
- 缓存链 redis（TTL = `REVALIDATE×1.5` ≈ 90s）→ file → memory（生产 **10 分钟**，`lib/cache/memory_cache.js:4`），且只写"第一个成功的后端"（`lib/cache/cache_manager.js:134-155`）。
- → 后台页面一律 **GSSP + `Cache-Control: no-store`**；后台读文章元数据**必须复用** `fetchGlobalAllData()` / `/api/blog-pet/posts`，否则会出现"后台 N 篇、前台 N-1 篇"的错位。

### 4.3 样式：Tailwind 只扫 `.js`

`tailwind.config.js:5-10` 的 `content` 只含 `./pages/**/*.js`、`./components/**/*.js`、`./layouts/**/*.js`、`./themes/**/*.js`。

→ 后台文件**统一用 `.js`**（与项目现状一致）。若用 `.tsx`，类名会被 purge，必须同时改 `tailwind.config.js`（多一处生产配置改动）。项目**没有任何图表库**（recharts/echarts/chart.js/d3 全仓零命中），Phase 1 建议零依赖手写 SVG。

### 4.4 响应头与缓存策略

- `next.config.js:338-351` 对全站下发 `Access-Control-Allow-Origin: *` + `Allow-Credentials: true`（矛盾组合），后台会继承。
- 后台**没有** `no-store`、**没有** `X-Robots-Tag: noindex`、**没有** CSP/X-Frame-Options（相关段被注释掉 `next.config.js:391-401`）。
- → Phase 1 需为 `/admin/:path*` 单独追加 `Cache-Control: no-store` + `X-Robots-Tag: noindex` + 收紧 CORS（`headers` 后写规则优先）。

---

## 5. 可复用模块清单

| 能力 | 复用什么 | 复用方式 | 注意 |
| --- | --- | --- | --- |
| Notion 全站数据 | `lib/db/SiteDataApi.js`（`fetchGlobalAllData`、`getSiteDataByPageId`） | 服务端直接调用，拿 `allPages`（`id/slug/title/type/status/publishDate/lastEditedDate/category/tags/tagItems`） | 必须复用同一缓存；`status` 已被"定时发布"逻辑改写 |
| 文章详情 | `fetchPageFromNotion`（`lib/db/notion/getNotionPost.js`） | 健康检查/单篇刷新 | 输入做 `idToUuid` 归一 |
| 缓存读写 | `lib/cache/cache_manager.js`、`redis_cache.js` | 后台聚合结果可复用同一 Redis | 不要写 `global_data_*` 键空间 |
| Redis 客户端 | `ioredis` + `REDIS_URL` | 会话、限流、统计日桶 | 生产已配置；`/tmp` 回退在 Vercel **不可靠** |
| 排行榜/阅读数 | `lib/rank/*`、`/api/rank/*` | 可作为"历史累计 PV"的参考值 | 无日期维度；标识是无盐 `sha256(ip|ua)` |
| 推送订阅 | `lib/notify/storage.js` | 未来"订阅者"页 | 单键 JSON，TTL 365d |
| 图标 / 无头组件 | `@tabler/icons-react`、`@headlessui/react`、`react-hotkeys-hook` | 后台 UI 直接使用 | 不要引 heroicons（未安装却被 `modularizeImports` 引用） |
| 错误边界 / 工具 | `lib/utils/errorHandler.js`、`lib/utils/formatDate.js` | 后台复用 | — |

---

## 6. 需要新增的模块（Phase 1 起）

| 模块 | 位置（建议） | 作用 |
| --- | --- | --- |
| 管理员认证 | `lib/admin/auth.js`、`lib/admin/session.js`、`lib/admin/rate-limit.js`、`lib/admin/audit.js` | 密码校验（bcryptjs）、Redis 会话、CSRF、失败限流、审计日志 |
| 后台 API | `pages/api/admin/**` | 登录/登出/改密/概览/明细/同步/健康，**每个端点独立校验会话** |
| 后台页面 | `pages/admin/{index,login,dashboard,analytics,visitors,behavior,articles,categories,comments,seo,health,settings}.js` | 12 个入口，全部 GSSP |
| 后台 UI | `components/admin/**`（含 `AdminShell`、`StatCard`、`DataTable`、`LineChart`(SVG)、`BarChart`、`EmptyState`） | 侧边栏 + 内容区，脱离主题样式 |
| 统计 SDK | `lib/analytics/client/tracker.js`（浏览器）+ `pages/api/track.js`（接收） | 匿名 ID、会话、事件、批量、失败静默 |
| 统计存储 | Redis `stats:v1:*`（方案 A）或 Supabase 表（方案 C） | 见方案文档 §6 |
| 数据同步 | `lib/admin/sync/notion-sync.js`、`pages/api/admin/sync/notion.js` | 文章/分类/标签快照 + `data_sync_logs` |
| 配置 | `conf/admin.config.js`（**新增独立文件**，不塞进 `blog.config.js`） | 会话时长、限流阈值、统计保留期 |

---

## 7. 兼容性问题与风险登记（按严重度）

| # | 风险 | 触发条件 | 影响面 | 处理 |
| --- | --- | --- | --- | --- |
| **R1** | `/admin` 裸路径被 `[prefix]` 动态路由接管 | 无 `pages/admin/index.js` | 后台入口 404 + 每次访问触发 Notion 拉取 | **Phase 1 第一件事**：新增 `pages/admin/index.js`（静态路由优先）+ `pages/admin/[...index].js` 兜底 |
| **R2** | `_app.js` 改动写错导致全站丢布局 | 分支条件写错 | **整个公开站点** | 只按 `pathname.startsWith('/admin')` 判断；默认分支原样保留；上线前跑全站回归 |
| **R3** | 后台页面误用 `getStaticProps` 被 CDN 缓存 | 编码错误 | 统计/会话数据泄漏给所有访客 | 后台统一 GSSP + `no-store`；CI 加一条 grep 守卫 |
| **R4** | Clerk 分支与后台守卫相撞 | Vercel 配了 Clerk key 且访问 `/admin/(.*)/memberships|domain` | 后台页被 403 | 后台子路由**禁用** `memberships`/`domain` 两段；守卫包裹在 `authMiddleware` 外 |
| **R5** | `UUID_REDIRECT` 开启后重定向后台路径 | `UUID_REDIRECT=true` 且 `redirect.json` 含 `admin` 等键 | 后台入口 308 跳走 | 保持关闭；若开，字典里禁用后台路径段 |
| **R6** | 行为统计 SDK 拖慢公开页面 | 同步加载/阻塞渲染 | 首屏性能、LCP | 异步 `requestIdleCallback` + `sendBeacon` + 采样 + 总包体 ≤ 3KB |
| **R7** | 统计写入打满 Upstash 命令配额 / 触发缓存 eviction | 方案 A 且写入量大 | ISR 缓存被挤掉 → 全站变慢 | 事件合并批量写、日桶 TTL、失败静默、配额监控（见方案文档 §6.4） |
| **R8** | 上游 fork 同步覆盖后台代码 | `.github/workflows/sync.yaml` 从 `tangly1024/NotionNext` 同步 | 代码丢失 | 后台代码集中在 `pages/admin/**`、`lib/admin/**`、`components/admin/**`（上游不存在）；同步前人工 diff |
| **R9** | 现有公开泄露面被误认为"已受 /admin 保护" | 只加页面鉴权、不动旧接口 | 信息泄露继续存在 | Phase 1 一并修复 F-01/F-03/F-04/F-05/F-06 |
| **R10** | 新增依赖触发 CI lockfile 门禁 | `yarn add` 未提交 `yarn.lock` | CI 红、无法合并 | 依赖变更与 lockfile 同一 PR 提交；能不加就不加（图表手写 SVG） |

---

## 8. 环境变量清单

### 8.1 生产已存在（由代码/线上探测推断，**值不可见**）

| 变量 | 用途 | 证据 |
| --- | --- | --- |
| `NOTION_PAGE_ID` | 站点数据源 page id | `.env.local`（唯一变量名）；`blog.config.js:9` |
| `REDIS_URL` | Upstash Redis 连接串 | `/admin/notify-status` 实测 `storage=redis`；`conf/dev.config.js:12` |
| `NEXT_PUBLIC_LINK` / `NEXT_PUBLIC_THEME` 等公开配置 | 站点信息 | `blog.config.js`；`components/ExternalPlugins.js` |
| Twikoo envId（`NEXT_PUBLIC_COMMENT_ENV_ID`） | 评论区 | **未确认**（HTML 中未出现 twikoo 脚本，需在 Vercel 侧核对） |

### 8.2 需新增（Phase 1 起，**只能放服务端**）

```env
ADMIN_USERNAME=            # 管理员账号（唯一）
ADMIN_PASSWORD_HASH=       # bcrypt 哈希，禁止明文
SESSION_SECRET=            # 会话签名密钥，32+ 字节随机
ADMIN_SESSION_IDLE_MIN=30  # 空闲超时（可配置）
ADMIN_SESSION_TTL_HOURS=12 # 绝对有效期
ADMIN_TRUST_PROXY=         # 是否信任 x-forwarded-for（Vercel 下为 true）
ANALYTICS_WRITE_KEY=       # 可选：/api/track 的写入侧限流标识
```

### 8.3 需管理员确认是否已在 Vercel 配置

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`（决定 middleware 走哪条分支）、`CACHE_REVALIDATION_TOKEN`、`RANK_SEED_SECRET`、`REVALIDATION_TOKEN`、`SUPABASE_URL` / `SUPABASE_SECRET_KEY`、`NEXT_PUBLIC_COMMENT_ENV_ID`、`ENABLE_CACHE`。

**规则**：新增密钥**一律不得**放进 `blog.config.js` / `conf/*.config.js` / Notion 配置表——因为这些通道最终会被序列化进页面 `__NEXT_DATA__`（见 [SECURITY_REVIEW.md](SECURITY_REVIEW.md) F-01）。

---

## 9. 阶段计划与验收（Phase 0 之后的执行顺序）

| 阶段 | 目标 | 关键改动文件 | 验收点（摘要） |
| --- | --- | --- | --- |
| **Phase 1** 基础框架与认证 | `/admin` 可登录、受保护、可退出、可改密 | 新增 `pages/admin/**`、`pages/api/admin/**`、`lib/admin/**`；改 `pages/_app.js`、`middleware.ts`、`next.config.js`（headers） | 未登录 `/admin` → 302 `/admin/login`；未登录 API → 401 JSON；错误密码失败并计数；改密后旧会话失效；公开页面零回归 |
| **Phase 2** 统计基础设施 | 事件采集、去重、会话、聚合、清理 | 新增 `pages/api/track.js`、`lib/analytics/**`；`components/Tracker`（动态注入，仅公开页） | 真实访问产生 page_view；SPA 切换不重复；重复 `event_id` 被去重；错误不重试；无明文 IP 落库 |
| **Phase 3** 后台统计页面 | Dashboard / Analytics / Visitors / Behavior / Articles | 新增后台页面与 `/api/admin/stats/*` | 时间筛选准确；PV/UV/Session 口径可核对；空状态不造假 |
| **Phase 4** 外部数据源 | Notion 同步、Twikoo 评论数、同步日志 | 新增 `lib/admin/sync/**`、`/api/admin/sync/*` | Page ID 关联稳定；改名不丢历史；同步失败可见 |
| **Phase 5** SEO / 健康 / 运营 | GSC、健康检查、失效链接、AI 预留 | 新增 `/api/admin/health/*` 等 | 未连接显示"未连接"；检查频率可控；外部失败不影响其他模块 |

每个阶段结束都必须提交：变更说明 + 测试结果 + 风险说明，然后**停下等管理员确认**。

---

## 10. 未确认项（需管理员提供或去控制台核对）

1. **Vercel 是否配置了 Clerk key** → 决定 `middleware.ts` 生产分支；仓库不可见。
2. **Vercel 项目面板是否叠加了 Redirect / Header / Cron 规则**（`vercel.json` 的 `headers` 是空数组）。
3. **Functions 的 region / maxDuration / 内存上限**（仓库内无任何 `export const config`）。
4. **Cloudflare 账号是否托管该 zone**（DNS 在 Vercel，但账号归属无法从仓库判断）。
5. **Notion 站点是否已存在 slug 为 `admin` / `dashboard` 的页面**（会影响 sitemap 与历史 URL）。
6. **Twikoo 后端形态**：腾讯云 envId 还是自建域名？决定评论统计走云函数还是只读数据库。
7. **`RANK_SEED_SECRET` 是否已经填进 Notion 配置表**（若是，需立刻轮换并改配置通道——F-01）。
8. **真实流量量级**（月 PV 量级决定统计存储选 Redis 还是 SQL）。
9. **是否允许 Phase 1 新增依赖**（`bcryptjs`；不含图表库）。
10. `docs/` 下是否已有 admin 相关旧方案（本次审计未展开 `docs/` 业务文档）。

---

## 11. 审计产物索引

```text
docs/admin/
├── AUDIT_REPORT.md              ← 本文件
├── ARCHITECTURE_PROPOSAL.md      ← 集成式后台架构、认证、统计服务方案
├── DATA_SOURCE_REPORT.md         ← 每个数据源的可用性/凭证/限制
├── SECURITY_REVIEW.md            ← 风险清单、控制清单、必修项
└── _findings/                    ← Phase 0 明细证据（审计工作底稿，可保留）
    ├── ARCHITECTURE.md
    ├── DATA_SOURCES.md
    └── SECURITY.md
```

> 说明：`_findings/.write-probe` 是协作者创建目录时遗留的 0 字节探针文件（当前沙箱 ACL 拒绝删除），请在 Phase 1 首次提交前删除。
> `docs/admin/PROJECT_SPEC.md` 按 PROJECT_SPEC 第 14 节要求，将在 Phase 1 与实现代码一同入库（Phase 0 交付物为上述四份报告）。

---

**Phase 0 到此结束。未收到管理员明确确认前，不进入 Phase 1，不修改任何生产代码。**
