# /admin 数据源审计（Phase 0·只读）

- 项目：NotionNext 4.10.8 定制 fork（站点 https://blog.20240606.xyz）
- 审计对象：`D:\save_files\aDrive\DeepSeek Harness\NotionNext`（HEAD `7c734e7`）
- 审计时间：2026-11-09
- 审计约束：只读。未修改生产代码、未安装依赖、未部署、未写 Notion、未调用任何写接口
- 审计范围：`lib/`、`components/`、`conf/`、`pages/`、`cloudflare/`、`middleware.ts`、`blog.config.js`、`package.json`、`vercel.json`；已排除 `node_modules`、`.next`、`docs`、`public`、`legacy`、`themes`（themes 仅在必要时引用）
- 密钥处理：全篇只出现环境变量**名**，不出现任何值；仓库内 `.env.local` 仅读取了键名（4 个键，值全部打码）

---

## 0. TL;DR

| # | 数据源 | 结论 | 需要的凭证 / 变量名 | 主要限制 |
|---|---|---|---|---|
| 1 | Notion 读取链路 | **可用（只读、已验证）** | 必需：`NOTION_PAGE_ID`；可选：`NOTION_TOKEN_V2`、`API_BASE_URL` | 走 notion-client 非官方 API；无任何统计字段；单页字段够做"文章维度"但不含流量 |
| 2 | Twikoo 评论 | **部分可用** | `NEXT_PUBLIC_COMMENT_ENV_ID`（如为腾讯云是 envId，自建是域名）；后台/审核类需 Twikoo 管理员密码 | 仓库内 0 处服务端调用，只有前端 `window.twikoo`；公开接口按"页面路径数组"查询，无站点级汇总、无待审核、无趋势 |
| 3 | Cloudflare | **不可用（当前形态）** | `CF_API_TOKEN`（若要新建）、zone 托管权限 | worker 只是图片代理；wrangler.toml 无 D1/KV/Queue 绑定；DNS 显示站点走 Vercel 而非 Cloudflare |
| 4 | 现有统计插件 | **部分接入，查询能力全部不可用** | `NEXT_PUBLIC_ANALYTICS_*`、`NEXT_PUBLIC_CLARITY_ID`、`NEXT_PUBLIC_UMAMI_*` 等 | 全是"前端上报 + 第三方看板"；仓库内 0 处查询代码；Vercel Analytics / 不蒜子无开放查询 API |
| 5 | 站内自建计数（rank） | **可用（最成熟的现成数据源）** | 无（写入需客户端调用）；配置 `RANK_*` | 只有"文章累计去重 PV / 点赞数"，无日期维度、无来源/设备/国家 |
| 6 | Redis（Upstash 风格） | **可用（若已配置 `REDIS_URL`）** | `REDIS_URL` | 现被 ISR 缓存 + rank + notify 共用，键无统一命名空间、计数 Hash 无 TTL |
| 7 | Supabase | **代码存在，生产是否启用未知** | `SUPABASE_URL`、`SUPABASE_SECRET_KEY` 或 `SUPABASE_SERVICE_ROLE_KEY` | 只服务 Claude 贡献热力图；无统计表、无 SQL/migration 文件 |
| 8 | 会话/来源/设备/国家/阅读深度 | **不可用（必须新建采集）** | — | 现有任何一层都没有这 5 类数据；Notion/Twikoo/不蒜子/CF Worker 均不提供 |

一句话结论：**这个站目前没有任何一个数据源能直接回答 PV/UV/Session/来源/设备/国家/阅读深度**。能复用的只有 Notion 文章元数据、rank 的文章累计 PV、Twikoo 的单篇评论数、以及存储层已有的 Redis 连接。

---

## 1. Notion 读取链路

### 1.1 结论：走 notion-client 非官方 API，不需要 token

| 事实 | 证据 |
|---|---|
| 唯一的数据读取引擎是 `notion-client` 的 `NotionAPI`（不是官方 SDK） | `lib/db/notion/getNotionAPI.js:1`、`:27-31` |
| 站点数据库页由 `NOTION_PAGE_ID` 指定，支持 `id1,en:id2` 多语言形式 | `blog.config.js:6-8`、`lib/db/notion/getPageProperties.js:252-261`、`next.config.js:20-21` |
| `authToken` 只在配置了 `NOTION_TOKEN_V2` 时注入，否则为 `null`（即"公开页面共享链接"模式） | `lib/db/notion/getNotionAPI.js:30`；`conf/notion.config.js:44` |
| 项目没有在生产读取路径上使用 `NOTION_TOKEN` | 全仓 48 处命中里，`NOTION_TOKEN` 只出现在 `pages/api/notion-comments.js:12` 与 `scripts/translate/*`、`scripts/translate/README.md` |
| `NOTION_PAGE_ID` 是唯一被强制校验的环境变量 | `lib/config/env-validation.js:11-25`、`scripts/dev-tools.js:100` |
| `@notionhq/client` 是真实依赖，但只用于：Notion 评论库、Member 数据补充、翻译脚本 | `package.json:73`；`pages/api/notion-comments.js:1`；`lib/db/notion/memberDataSource.js:6-17`；`scripts/translate/notion-client.js:1-7` |
| 官方 API 补充管道要求 `NOTION_API_TOKEN` + `NOTION_MEMBERS_DATA_SOURCE_ID`（可选功能，不设则不触发） | `lib/db/notion/memberDataSource.js:14-17` |

**判定**：本站是"公开 Notion 页面 + notion-client 非官方 API"，因此**读取文章不需要 Notion Integration Token**。若日后要把 Notion 页面设为私有，需要 `NOTION_TOKEN_V2`（cookie 型 token，风险高、易失效）。这条链路的成本是"依赖 Notion 私有 API + 被限流"，代码里为此做了限流与 inflight 去重（`getNotionAPI.js:12-21`、`:59-80`）。

### 1.2 主入口与数据形状

- 全站数据入口：`fetchGlobalAllData({ pageId, from, locale })` — `lib/db/SiteDataApi.js:50-90`
- 实际抓取 + 转换：`getSiteDataByPageId()` → `fetchNotionPageBlocks()` + `convertNotionToSiteData()` — `SiteDataApi.js:116-157`、`:532-746`
- 返回对象（服务端）：`NOTION_CONFIG / notice / siteInfo / allPages / allMembers / allEvents / allNavPages / allLinkPages / collection / collectionQuery / collectionId / collectionView / viewIds / block / schema / tagOptions / categoryOptions / rawMetadata / customNav / customMenu / postCount / pageIds / latestPosts` — `SiteDataApi.js:721-745`
- 返回浏览器前会删掉重量字段：`block / schema / rawMetadata / pageIds / viewIds / collection / collectionQuery / collectionId / collectionView` — `SiteDataApi.js:752-761`

**注意**：本 fork **没有** `getAllPosts` 这个函数（全仓 0 命中）。等价的"全量列表"是 `allPages`，`latestPosts` 只是按更新时间排序的前 N 篇（默认 6，`SiteDataApi.js:704-708`、`:890-902`）。

### 1.3 稳定 page id 是否暴露？—— 是

- `allPages[]` 与 `latestPosts[]` 都保留原始 `id`：清理函数 `cleanPages()` 只过滤 `tagItems`，不动 `id`（`SiteDataApi.js:810-828`）；`CLIENT_POST_SUMMARY_FIELDS` 明确把 `id`、`short_id` 放进客户端摘要白名单（`SiteDataApi.js:183-214`）
- 只有**导航页**被降级为短 id：`shortenIds()` 删除 `id` 并生成 `short_id`（`SiteDataApi.js:770-771`、`:830-841`）；分类/菜单的 `id` 被彻底剥离（`:768-769`、`:843-848`）
- `id` 同时是 rank 计数的主键（`lib/rank/index.js:137`、`lib/rank/storage.js:118-127`），说明它在运行时是稳定且唯一的
- 页面原始 id 是 Notion 的无连字符 uuid；`fetchPageFromNotion()` 用 `idToUuid()` 归一（`lib/db/notion/getNotionPost.js:29-39`）

**给 admin 的建议键**：用 `allPages[].id` 作为文章主键；展示层用 `slug` / `href`；不要用 `title`（可重复、可改）。

### 1.4 字段清单（单页能拿到什么）

来源：`lib/db/notion/getPageProperties.js:29-146`、`SiteDataApi.js:183-214`、`:198-273`。

| 字段 | 类型 / 说明 | 可用性 |
|---|---|---|
| `id` | string，Notion page uuid | ✅ 稳定 |
| `short_id` | string，仅导航页 | ⚠️ 视页面类型 |
| `title` / `name` | string | ✅ |
| `slug` | string，可被 `POST_URL_PREFIX` 规则改写 | ✅ |
| `href` | string，站点相对路径；`PSEUDO_STATIC` 开启时补 `.html` | ✅（不是绝对 URL） |
| `type` | `Post / Page / Notice / Menu / SubMenu / Member / Event` | ✅（`:101-105`、`:169-192` 映射） |
| `status` | `Published / Invisible` | ✅ 只有二值，无 draft/审核态 |
| `publishDate` | **number（ms）**，取 `date.start_date` 或 `created_time` | ✅（`:121-123`） |
| `publishDay` | 格式化字符串 | ✅ |
| `lastEditedDate` | **Date 对象**，取 `last_edited_time` | ✅（`:125-129`） |
| `lastEditedDay` | 格式化字符串 | ✅ |
| `category` | **string（单选取第一个）** | ✅（`:104`） |
| `tags` | **string[]**（`multi_select` 被 `,` 切分成数组） | ✅（`:55-62`） |
| `tagItems` | **`[{ name, color }]`**，color 来自 Notion schema 选项 | ✅（`:137-143`） |
| `series` / `number` | `string[]` / `string`，系列功能 | ✅（`:113-116`） |
| `summary` / `description` / `readTime` / `wordCount` | 由正文或插件生成 | ✅ 视主题与插件 |
| `pageIcon` / `pageCover` / `pageCoverThumbnail` | URL | ✅ |
| `password` | 文章锁（SHA256 摘要） | ⚠️ 存在但不可当统计用 |
| `ext` | 自定义 JSON | ✅ |
| **url（绝对）** | ❌ 无此字段，需前端用 `BLOG.LINK` 拼 | ❌ |
| **PV / UV / 评论数 / 阅读深度** | ❌ Notion 里没有，也不该有 | ❌ |

**数据结构要点（回答提问）**：
- 分类是**单选字符串**（`category`），不是数组；`categoryOptions` 才是 `{ name, color, count }` 数组，且 `id` 被剥离（`getAllCategories.js:38-46`、`SiteDataApi.js:843-848`）
- 标签：`tags` 是**纯字符串数组**；带 color 的是派生字段 `tagItems`（`getPageProperties.js:137-143`）和 `tagOptions`（`getAllTags.js:42-70`，`{ name, color, count, source }`，`id` 与 `source` 在返回前被删，`SiteDataApi.js:850-857`）
- `status` 只有 `Published / Invisible` 两态；"定时发布"是在返回前把不在时间窗内的页面**改写**成 `Invisible`（`SiteDataApi.js:783-798`）——admin 统计"已发布"时必须以这个改写后的值为准

### 1.5 缓存层会不会造成"统计 vs 元数据"不一致？—— 会，且是真实风险

| 机制 | 证据 | 后果 |
|---|---|---|
| 缓存键：`global_data_<locale>_<pageId>`、`site_<pageId>` | `SiteDataApi.js:103-110`、`:119` | admin 若自建缓存键，会和前台两套数据 |
| 缓存链按"先命中先返回"：redis → file → memory | `lib/cache/cache_manager.js:214-228`、`:157-181` | 三处 TTL 不同，实际新鲜度取决于哪层先命中 |
| Redis TTL = `NEXT_REVALIDATE_SECOND × 1.5`（默认 60 → 90s） | `lib/cache/redis_cache.js:7-9` | 有 Redis 时元数据最多滞后 90s |
| memory TTL：生产 10 分钟 | `lib/cache/memory_cache.js:4` | **没有 Redis 时，生产元数据最多滞后 10 分钟**，远超 `REVALIDATE_SECOND=60` |
| 写入只写"第一个成功的后端" | `cache_manager.js:134-155` | 有 Redis 时 memory 永不写入，行为随配置变化 |
| 本地文件缓存条目**不过期** | `lib/cache/local_file_cache.js:55-79`（`expireTime` 仅在传 `customCacheTime` 时才有） | 本地/构建期数据可能长期陈旧，直到 `cleanCache()` |
| 拉取失败不缓存（防污染） | `SiteDataApi.js:82-84`、`:98-101`、`:133-136` | 好设计，但意味着"偶发失败"时前后台可能同时抖动 |

**结论**：admin 后台**必须复用 `fetchGlobalAllData()`（或 `/api/blog-pet/posts`）读同一份缓存**，不要自己再拉一次 Notion；否则会出现"后台显示 N 篇、前台列表 N-1 篇""统计的数字归属的 slug 与线上不一致"这类问题。另外 rank 计数用的是写入时的 `postId`，文章被删除后计数会变孤儿——admin 展示时需要左连接过滤。

---

## 2. Twikoo 评论：能力边界

### 2.1 现状（全部是客户端）

| 事实 | 证据 |
|---|---|
| 评论区初始化：加载 CDN 脚本 → `window.twikoo.init({ envId, el, lang })`，1s 轮询直到成功 | `components/Twikoo.js:12-54` |
| 评论数：`window.twikoo.getCommentsCount({ envId, urls: posts.map(p=>p.slug), includeReply: true })` | `components/TwikooCommentCounter.js:38-60` |
| 评论数展示位是空 `<span>`，靠 `document.querySelectorAll` 回填 DOM | `TwikooCommentCount.js:14-19`、`TwikooCommentCounter.js:62-81` |
| "最近评论"组件是空的 | `TwikooRecentComments.js:8-10`（`return null`，注释 `TODO`） |
| 配置：envId / count 开关 / CDN 固定 `twikoo@1.7.9` | `conf/comment.config.js:23-28` |
| 只有 `COMMENT_TWIKOO_ENV_ID` 非空时才挂载评论区 | `components/Comment.js:22`、`:118-121` |
| 全仓 **没有** 服务端 Twikoo 调用，也没有 `twikoo` npm 依赖（纯 CDN） | `package.json`（无 twikoo）；`grep -i twikoo` 140 命中全部落在 components/conf/docs |

潜在缺陷（供 admin 侧注意，不改代码）：`TwikooCommentCount.js:11` 是 `JSON.parse(siteConfig('COMMENT_TWIKOO_COUNT_ENABLE'))`，当该值是布尔 `false/true` 时会抛错；`comment.config.js:24-25` 的默认值是 `false`（布尔）。也就是说这个开关在有主题引入该组件时可能直接抛异常。

### 2.2 能安全做到什么

- **能**：服务端只读调用 Twikoo 云函数的**公开查询事件**（`GET_COMMENTS_COUNT` 语义），入参是"文章路径数组"，返回每篇的 `count`。这等价于把 `TwikooCommentCounter` 的逻辑搬到服务端，**不需要管理员密钥**，只需要 `COMMENT_TWIKOO_ENV_ID`（腾讯云 envId 或自建域名）。
- **能**：在 admin 里做"每篇文章评论数 + 有评论文章数 + 评论最多的 N 篇"。数据源就用 `allPages[].slug`（注意 slug 必须带前导 `/`，组件里已经这么处理，`TwikooCommentCounter.js:39-41`）。
- **能（更低风险）**：如果 Twikoo 后端是自建（Docker + MongoDB/Redis），直接给 admin 一个**只读**数据库账号跑聚合 SQL，比走云函数更可靠。

### 2.3 明确做不到

- ❌ **站点总评论数**：公开接口按 url 列表查询，没有"整站合计"事件；只能"遍历全部 slug 累加"，且上限受 Twikoo 单次 urls 数量与云函数超时限制，必须分批 + 缓存。
- ❌ **待审核数 / 垃圾评论数**：审核态只在管理端，需要 Twikoo 管理员密码（`TWIKOO_ADMIN` 一类密钥）；这属于"后台管理能力"，Phase 0 不应该碰。
- ❌ **趋势（每日新增评论）**：公开接口返回累计值，没有时间序列。只能在 admin 侧自建"每日快照"，从上线日开始积累。
- ❌ **评论者国家 / 设备 / 阅读深度**：Twikoo 不采集这些。
- ⚠️ 跨域与来源限制：云函数侧有 CORS 与来源校验策略，服务端调用要么走同域代理，要么确认允许 server-to-server。

---

## 3. Cloudflare：形态与 DNS 实测

### 3.1 仓库里的 Cloudflare 只有"图片代理"

| 事实 | 证据 |
|---|---|
| 只有一个 worker：`notion-image-proxy` | `cloudflare/notion-image-proxy/wrangler.toml:1-3` |
| 绑定只有一个自定义域名路由，**没有** `[[d1_databases]]`、`[[kv_namespaces]]`、`[[queues]]`、`[vars]`、`[analytics_engine_datasets]` | `wrangler.toml:1-7`（全文 7 行） |
| worker 只允许 `/image/` 与 `/images/`，只做 GET/HEAD | `worker.mjs:11-17`、`:74-76` |
| 用 `caches.default` + `cf.cacheEverything`，边缘 7 天 / 浏览器 1 天 | `worker.mjs:2-3`、`:19-45`、`:48-53` |
| 无任何写存储 / 无任何日志上报 / 无 Analytics Engine | `worker.mjs:1-76`（全文无 `env.`、无 `fetch` 到自有端点） |
| 部署方式：`npx wrangler deploy`，需要 Workers Scripts 编辑权限 + zone 权限 | `README.md:5-23` |
| 下游开关：`NEXT_PUBLIC_NOTION_HOST` 指向 worker 域名 | `README.md:18-22` |

### 3.2 域名是否走 Cloudflare？DNS 实测（只读，一次，本地 hub，0 credits）

命令：`python C:/Users/48699/.dsh/search-hub/hub.py --dns blog.20240606.xyz`（account: doh）

```
source: doh
A     : 775d7c98c2b21617.vercel-dns-017.com. , 216.198.79.1 , 64.29.17.1
AAAA  : 775d7c98c2b21617.vercel-dns-017.com.
MX    : 775d7c98c2b21617.vercel-dns-017.com.
TXT   : 775d7c98c2b21617.vercel-dns-017.com.
NS    : 775d7c98c2b21617.vercel-dns-017.com.
```

判读：
- `NS = vercel-dns-017.com` + A 记录落在 Vercel anycast 段（`216.198.79.1` / `64.29.17.1`）+ 解析链出现 `*.vercel-dns-017.com` CNAME 目标 ⟹ **`blog.20240606.xyz` 由 Vercel 托管 DNS 并直连 Vercel 边缘**。
- **没有**出现 Cloudflare 的典型代理地址段（`104.x` / `172.67.x`），也没有 `cdn.tangly1024.com` 与本仓库的关联证据。
- 因此"Notion + GitHub + Vercel + Cloudflare"里的 Cloudflare，目前**只是一条可选的图片代理旁路**，不是流量的入口层。这意味着：**没有 Cloudflare 边缘日志、没有 Cloudflare Web Analytics、没有 `CF-IPCountry`、也没有 Worker 能拦到的请求**。
- 需要保留的谨慎：DNS over HTTPS 的返回把 CNAME 目标混进了 A/NS 段，属于解析器展示习惯差异；"是否另有一层 CF 代理"最终只能由 Cloudflare 账号面板确认（见第 8 节）。

### 3.3 三个具体问题的答案

1. **Vercel 函数能不能绑 D1？——不能。** D1 只能通过 Workers/Pages Functions 的 `env.DB` binding 访问；Vercel 的 Node/Edge Runtime 没有这个 binding。Vercel 侧要用 D1，只能走 Cloudflare 的 HTTP REST API（`/accounts/{id}/d1/database/{db}/query`）+ `CF_API_TOKEN`，等于多一跳公网 + 额外鉴权。
2. **Worker 能不能独立部署？——能，且已经具备条件。** 现在就是独立脚本 + `main = worker.mjs`，`npx wrangler deploy` 即可；新增一个"统计采集"worker 不会影响图片代理，但需要新的路由域名（或同域路径前缀）。
3. **自定义域名路由怎么走？** `wrangler.toml` 用的是 `custom_domain = true`，要求该域名（或父 zone）**托管在同一个 Cloudflare 账号**。当前 `20240606.xyz` 的子域委派给 Vercel DNS，所以：
   - 方案 a：只给新 worker 一个**新子域**（如 `stats.20240606.xyz`）并把该子域委派给 Cloudflare —— 可以，但要把 NS 记录加到 Vercel DNS；
   - 方案 b：把整个 zone 迁到 Cloudflare（会影响 Vercel 域名与证书，属于高风险迁移，不建议在 Phase 1 做）；
   - 方案 c：不绑域名，直接用 `*.workers.dev` 子域上报（最省事，但跨域 + 国内可达性要实测）。

---

## 4. 既有统计插件：真实可用性

### 4.1 逐项判断

| 插件 | 是否接入 | 代码位置 | 有无可编程查询 API | 判定 |
|---|---|---|---|---|
| Vercel Analytics | 条件接入，默认**关**（`ANALYTICS_VERCEL` 默认 `false`） | `conf/analytics.config.js:5`；`components/ExternalPlugins.js:35`、`:251`、`:536-538`（dynamic import `@vercel/analytics/react`）；依赖 `package.json:76` | ❌ 无公开查询 API。只有 Vercel 看板，且 Web Analytics 需在项目里开启 | **不可用**（只能看板，不能进 admin） |
| 不蒜子（Busuanzi） | 默认**开**（配置默认 `true`），但是否渲染取决于主题有没有放容器 | `conf/analytics.config.js:6-7`；`components/Busuanzi.js:15-22`；`components/AnalyticsBusuanzi.js:5-17`；`lib/plugins/busuanzi.js:102` | ⚠️ 只有一个 JSONP：`//busuanzi.ibruce.info/busuanzi?jsonpCallback=...`，返回 `site_pv / page_pv / site_uv`（`busuanzi.js:110`） | **部分可用但不可依赖**：无鉴权/无 SLA/无官方 API 文档；只有"全站 PV/UV + 当前页 PV"三个标量，**无日期、无来源、无设备、无国家** |
| 51LA | 条件接入（需 `ID` + `CK` 同时存在） | `components/LA51.js:7-18`；`ExternalPlugins.js:273`、`:572` | ❌ 仓库内只有 `LA.init(...)` 上报 | **不可用**（需 51LA 后台，且其开放接口需企业资质/密钥） |
| Ackee | 条件接入 | `components/Ackee.js:7-48`、`:58+`；`ExternalPlugins.js:249`、`:542` | ⚠️ Ackee 自身有 GraphQL API，但需自建实例 + API Key，仓库内 0 处调用 | **不可用（现状）** |
| Google Analytics (gtag) | 条件接入（需 `ANALYTICS_GOOGLE_ID`） | `components/Gtag.js:9-23`；`lib/plugins/gtag.js:2-17`；`ExternalPlugins.js:250` | ⚠️ GA4 有官方 Data API，但需 service account + 属性 ID，仓库内 0 处调用 | **不可用（现状）**；若日后要接，是唯一有"正规查询 API"的第三方 |
| Microsoft Clarity | 条件接入（需 `CLARITY_ID`） | `conf/analytics.config.js:34`；`ExternalPlugins.js:307-326` | ❌ 无公开查询 API（只有看板 + 有限导出） | **不可用** |
| Umami | 条件接入（需 `UMAMI_ID`） | `conf/analytics.config.js:36-37`；`ExternalPlugins.js:453-455` | ⚠️ Umami 有 `/api/` 但需登录 token | **不可用（现状）** |
| Matomo | 条件接入（需 host + siteId） | `conf/analytics.config.js:17-18`；`ExternalPlugins.js:481` | ⚠️ Matomo 有 Reporting API（需 token） | **不可用（现状）** |
| `components/Vercel.js` | 存在，但**不是统计组件** | `components/Vercel.js:1-42` | — | 只是 Vercel logo（`<a href="https://vercel.com...">` + SVG），与统计数据无关 |

### 4.2 关键结论

1. **没有任何一个第三方统计能在服务端被查询**：仓库里 0 处调用 GA4 Data API / Umami API / Ackee GraphQL / Matomo API。
2 `ANALYTICS_VERCEL` 与 `ANALYTICS_BUSUANZI_ENABLE` 都是 `siteConfig(...)` 读取，会被 **Notion 配置页 `NOTION_CONFIG` 覆盖**（`ExternalPlugins.js:35`、`:50-53`）。所以"生产上到底开了哪几个"**无法从仓库判断**（见第 8 节）。
3. 即使全部开启，能拿到的也只是"第三方看板里的数"，**不能进 admin**，也无法与 `post.id` 关联（不蒜子只按 URL 计，GA 事件未打通）。
4. 因此 **PV/UV/Session/来源/设备/国家/阅读深度 必须由本站自建采集**；现有插件最多作为"对账参考"。

---

## 5. 存储能力与方案对比

### 5.1 现有存储盘点（全部实证）

| 组件 | 位置 | 实际用的东西 | 键 / TTL |
|---|---|---|---|
| ISR 缓存链 | `lib/cache/cache_manager.js:214-228` | redis → file → memory | — |
| Redis 缓存 | `lib/cache/redis_cache.js:5-31` | `ioredis`（真实使用） | 键来自 `cache_manager`（`global_data_*`、`site_*`）；TTL = `REVALIDATE×1.5`（默认 90s） |
| Vercel Runtime Cache | `lib/cache/vercel_cache.js:1-25` | `@vercel/functions` 的 `getCache()` | ttl 参数；**`delCache` 不支持**（`:18-22` 只 warn） |
| 本地文件缓存 | `lib/cache/local_file_cache.js:7`、`:55-79` | `fs` + 原子 rename | **无过期**（除非传 `customCacheTime`） |
| rank 计数 | `lib/rank/storage.js:19-36`、`:118-139`、`:146-165` | `ioredis` Hash 优先，回退 JSON 文件 | `rank:views`、`rank:likes`（Hash，**无 TTL**）；去重 `rank:dedupe:*`（TTL = 去重窗口 / 点赞 100 年） |
| 推送订阅 | `lib/notify/storage.js:20-27`、`:74-89` | `ioredis` 单键 JSON，回退文件 | `notify:data`，TTL 365 天（`:81`） |
| Supabase | `lib/server/claude/contributionStore.js:2-21`、`:156-165` | `@supabase/supabase-js`（真实使用） | 表 `claude_contribution_events_v1`、`claude_contribution_snapshots_v1`；env `SUPABASE_URL` + `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` |
| 是否有 SQL/migration 文件 | 全仓无 `migrations/`、无 `.sql` | — | **表结构只能从代码推断，无 schema 版本管理** |
| D1 / KV / Upstash SDK | 无 | — | 只有 `ioredis` 直连 Redis URL（Upstash 兼容 redis:// 协议） |

补充事实：
- 生产环境（Vercel）下 `enableLocalCache = isBuildPhase || !BLOG.isProd`（`cache_manager.js:20`），`BLOG.isProd` 由 `VERCEL_ENV==='production'` 决定（`conf/dev.config.js:21`）⟹ **生产运行时不用文件缓存**，只有"有 Redis → Redis / 没 Redis → memory（10min）"。
- rank/notify 在 Vercel 无 Redis 时回退到 `/tmp`（`rank/storage.js:30-36`、`notify/storage.js:20-25`）——**`/tmp` 在 Vercel 是每实例临时的，多实例之间不共享，重启即丢**。这一点对"统计"是致命的，所以只要上统计就必须有真后端。
- `pages/admin/notify-status.js:45-49` 页面本身在教用户"去 Upstash 建库、把连接串填 `REDIS_URL`" ⟹ **项目的既定 Redis 方案就是 Upstash**。

### 5.2 能否复用现有 Redis 存统计？—— 能，但要新建命名空间

可以复用的部分：`ioredis` 依赖、连接方式、`REDIS_URL` 已在 `conf/dev.config.js:12` 统一读取、Vercel 上可用（Upstash 走 TLS `rediss://`，`env-validation.js:57-61` 有校验）。

不能直接复用的部分：
- 现有键**没有任何统一前缀**（`global_data_*` / `site_*` / `rank:*` / `notify:data`），直接塞统计键会与其他模块混淆；
- `rank:views` 语义是"文章累计去重 PV"，**无 TTL、无日期维度**，往里 `HINCRBY` 会污染排行榜；
- Redis 实例同时承担 ISR 缓存（默认 90s TTL、体积大），统计写入会与缓存争内存，免费档可能触发 eviction 把缓存打掉。

建议的键规范（若选 Redis）：
```
stats:v1:pv:{yyyymmdd}:{postId}        # 日 PV，INCR，TTL 400d
stats:v1:uv:{yyyymmdd}:{postId}        # 日 UV，靠 SETNX 去重键 stats:v1:seen:{yyyymmdd}:{visitorHash}
stats:v1:session:{sessionId}           # Hash，TTL 30min（滑窗）
stats:v1:dim:{yyyymmdd}:{dim}:{value}  # 维度桶：referrer/device/country
stats:v1:depth:{yyyymmdd}:{bucket}     # 阅读深度直方图
```
同时必须与 `rank:*`、`global_data_*` 明确分家，并给所有统计键设 TTL。

### 5.3 三方案对比

| 维度 | 方案 A：复用 Upstash Redis | 方案 B：新建 Cloudflare D1 + Worker | 方案 C：Supabase Postgres |
|---|---|---|---|
| 落地成本 | **最低**：依赖已在、连接已在、只需新增采集端点与键规范 | 中：要新建 worker、新域名路由、CORS、鉴权；D1 schema 与迁移 | 中：依赖已在（`package.json:74`）、但要建表/RLS/迁移脚本 |
| 查询能力 | 弱：只有计数器/ZSet/日桶，多维交叉分析要预聚合，任意时间窗要自己写 | **强**：SQL，天然适配"来源×设备×国家×深度"的任意切分 | **强**：SQL + 视图 + RLS，最好做"以后还想加会员/订单"的场景 |
| 地理/设备信息 | 需自己从 `x-forwarded-for` 反查国家（无库，需外部 IP 库或 Vercel 地理头） | 边缘自带 `request.cf.country` / `cf.asn`，**零成本拿到国家/城市** | 同 A，靠 Vercel 侧头信息 |
| 运行位置约束 | Vercel 函数可直连（HTTPS/TLS） | **Vercel 函数不能绑 D1**，只能 Workers 写或走 REST API | Vercel 函数可直连（HTTPS） |
| 与现有链路冲突 | 高：与 ISR 缓存、rank、notify 共库 | 低：完全旁路 | 低：独立库（但和 Claude 贡献表共库，需分 schema） |
| 成本（免费档） | Upstash 免费档按命令数计（10k cmd/日量级），统计写入会很快吃满 | D1 免费档 5GB / 500 万行读每日，**最宽松** | Supabase 免费 500MB + 项目会 pause，写入延迟跨境 |
| 主要风险 | 命令数超限 / 键无 TTL 导致内存膨胀 / 缓存被 eviction | 域名路由需 CF 托管 zone（当前 DNS 在 Vercel，见 3.2） | 每 PV 一次跨境 INSERT 的延迟；service role key 泄露面；免费档 pause |
| 运维可见性 | `redis-cli` / Upstash 控制台 | `wrangler d1 execute` / CF 控制台 | Supabase Studio SQL |
| 适合的流量量级 | 小站（≤10 万 PV/月） | 任意（边缘写入） | 小到中站 |

**建议（详见第 7 节给 lead 的结论）**：主存储选 **方案 C（Supabase Postgres）**，把"多维明细 + 任意时间窗"的需求交给 SQL；用 Redis 仅做热路径缓冲（可选）。若明确"只做日粒度看板、且不想新增数据库"，退化为方案 A。若未来把 zone 迁到 Cloudflare，再迁到方案 B 最划算。

---

## 6. `pages/api/*` 全量端点清单（19 个）

图例：鉴权 = ✅必须 / ⚠️可选（未配置变量时等于无鉴权）/ ❌无。

| 路径 | 方法 | 用途 | 鉴权 | 能否作为统计接入点 |
|---|---|---|---|---|
| `/api/rank/view` | POST | 记录一次文章浏览（含访客去重） | ❌ | **能**：现成的 PV 写入点（`pages/api/rank/view.js:11-37`） |
| `/api/rank/info` | GET | 单篇 views/likes/liked；`record=1` 时顺带记 PV | ❌ | **能**：文章页已经在用（`rank/info.js:31-33`、`themes/example/components/rankClient.js:71`） |
| `/api/rank/top` | GET | 查看榜 / 点赞榜（CDN 60s） | ❌ | **能**：文章表现排行（`rank/top.js:16-25`） |
| `/api/rank/status` | GET | 存储后端 + 计数汇总（总浏览/总点赞） | ❌ | **能**：目前唯一"总览"接口（`rank/status.js:31-48`） |
| `/api/rank/like` | GET/POST | 点赞状态 / 切换 | ❌ | 能（点赞维度） |
| `/api/rank/seed` | POST | 导入/重置计数 | ✅ `x-rank-secret` 或 body.secret（`rank.config.js:36`、`rank/index.js:392-398`） | ❌ 管理口 |
| `/api/push/status` | GET | Redis 连通性 + 订阅数 + VAPID | ❌ | **能（参考）**：数据同步状态的一部分（`push/status.js:9-50`） |
| `/api/push/send` | POST | 手动推送新文章 | ✅ `NOTIFY_SECRET` 或 `REVALIDATION_TOKEN`（`push/send.js:16-23`） | ❌ |
| `/api/push/subscribe` | POST/DELETE | 订阅增删 | ❌（靠 `subscriberId` 自证） | ❌ |
| `/api/push/subscriptions` | GET | 按 subscriberId 查订阅 | ❌ | ❌ |
| `/api/push/test` | POST | 测试推送（telegram/serverchan/webpush） | ❌（**无任何密钥校验**，`push/test.js:11-45`） | ❌（安全风险点，见 §6.1） |
| `/api/push/vapid-public-key` | GET | 生成/返回 VAPID 公钥 | ❌ | ❌ |
| `/api/revalidate` | POST | 按需 ISR（单页/批量/全站） | ✅ `REVALIDATION_TOKEN`（未配置返回 503，`revalidate.js:28-43`） | ❌（但可作"数据同步"动作按钮，需鉴权） |
| `/api/cache` | POST | 清本地文件缓存 | ⚠️ `CACHE_REVALIDATION_TOKEN`（**未配置时完全开放**，`cache.js:13-16`） | ❌ |
| `/api/blog-pet/posts` | GET | 文章索引（id/title/slug/category/tags/date/cover） | ❌ | **能**：已缓存 300s 的"文章维度只读源"（`blog-pet/posts.js:37-59`） |
| `/api/notion-comments` | GET/POST | Notion 评论读写 | GET ❌；POST 有校验+IP 限流（`notion-comments.js:99-131`）；写需 `NOTION_TOKEN`+`NOTION_COMMENT_DATABASE_ID` | **部分能**：GET 按 `postId` 读评论，**无站点级汇总**（`notion-comments.js:100-111`） |
| `/api/rss` | GET | RSS | ❌ | ❌ |
| `/api/subscribe` | POST | Mailchimp 邮件订阅 | ❌ | ❌ |
| `/api/claude/contribution-refresh` | GET/POST | 标记贡献热力图缓存脏 + 有限 revalidate | ✅ `CLAUDE_CONTRIBUTION_TRIGGER_TOKEN`（缺失 503，`contribution-refresh.js:27-38`） | ❌ |

### 6.1 顺带发现的安全问题（只记录，不在 Phase 0 修）

1. `/admin/*` **当前没有通用鉴权**：`middleware.ts:24-27` 只保护 `/admin/(.*)/memberships` 与 `/admin/(.*)/domain`，而 Clerk 仅在 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 存在时启用，否则走 `noAuthMiddleware` 直接放行（`middleware.ts:66-92`）。已存在的 `/admin/notify-status` 就是裸奔页面，且会显示订阅数。
2. `/api/push/status` 无鉴权返回"订阅总数 + Redis 地址是否配置"，属于信息泄露。
3. `/api/push/test` 无鉴权即可让服务器向任意 Telegram/ServerChan 目标发消息（`push/test.js:28-40`），可被滥用。
4. `/api/cache` 在没配 `CACHE_REVALIDATION_TOKEN` 时任何人都能 POST 清缓存（`cache.js:13-19`）。

**对新 `/admin` 的直接影响**：不能沿用现有的"路径级裸奔"模式。建议 `/admin` 自带一层 token/密码校验（在 `middleware.ts` 或每个 API 里），且所有新统计接口默认 `cache-control: no-store` + 鉴权。

---

## 7. 给 lead 的结论摘要

- **统计存储建议**：Supabase Postgres（方案 C）。理由：admin 要的是"来源/设备/国家/阅读深度"的多维明细与任意时间窗，只有 SQL 能低成本支持；`@supabase/supabase-js` 已是生产依赖且有服务端封装范式（`lib/server/claude/contributionStore.js`），不需要新依赖；Redis 已被 ISR 缓存 + rank + notify 三家共用，塞统计会互相踩。
- **风险**：每 PV 一次跨境 HTTPS 写入的延迟（需批量/采样 + `after()` 异步化）；Supabase 免费档会 pause；service role key 只能服务端持有；若生产未配置 `SUPABASE_*`，这等于一条全新依赖链（需先确认）。
- **降级路线**：只想做日粒度看板 → 复用 Upstash Redis 的日桶键（`stats:v1:*`，全部带 TTL）；将来把 zone 迁到 Cloudflare → 换 D1 + 边缘采集，可零成本拿 `cf.country`。

---

## 8. 无法确认项（需要人工/带凭据核实）

| # | 待确认 | 为什么确认不了 | 影响 |
|---|---|---|---|
| 1 | 生产环境变量清单与真实取值（`REDIS_URL`、`REVALIDATION_TOKEN`、`NOTION_TOKEN_V2`、`SUPABASE_*`、`NEXT_PUBLIC_COMMENT_ENV_ID`、`NEXT_PUBLIC_ANALYTICS_*`、`NEXT_PUBLIC_THEME`） | 仓库里 `.env.local` 只有 4 个键（`NOTION_PAGE_ID`、`NEXT_PUBLIC_LINK` 等，值已打码）；其余在 Vercel Settings 里，只读审计无法读取 | 直接决定"Redis 是否可用""Twikoo 是否启用""存储选型是否要新建" |
| 2 | Twikoo 后端形态（腾讯云 envId vs 自建域名）与版本 | 只有 `COMMENT_TWIKOO_ENV_ID` 的读取代码，没有值 | 决定能否服务端只读拉评论数，以及是否需要自建只读 DB 账号 |
| 3 | image-proxy worker 是否真的部署、`cdn.tangly1024.com` 是否被本 fork 使用 | `wrangler.toml:5-7` 仍是上游示例域；仓库内无 `NEXT_PUBLIC_NOTION_HOST` 的实际配置 | 决定"Cloudflare 是否已在链路里"这件事的最终结论 |
| 4 | 是否有 Cloudflare 账号层面未被仓库体现的配置（代理开关、Web Analytics、WAF） | DNS 只能看到"当前解析到 Vercel"，看不到 CF 账号资产 | 决定能否走"边缘采集 + D1"路线 |
| 5 | 站点当前实际主题 | `blog.config.js:10` 默认 `example`，但 `NOTION_CONFIG.THEME` 会覆盖（`SiteDataApi.js:636`、`:643`） | 决定 `ExternalPlugins` / `Busuanzi` / rank 组件是否真的被渲染（影响"现成数据源"是否存在） |
| 6 | Vercel 计划与 Analytics 是否开启 | 需要在 Vercel 控制台确认 | 决定 Vercel Analytics 能否作为对账参考 |
| 7 | 真实流量规模（PV/月、独立 IP 数） | 无任何现有统计可导出 | 决定存储档位与是否需要采样 |
| 8 | Twikoo 的公开查询事件在服务端的实际可用性（CORS/超时/单次 urls 上限） | 仓库内 0 处服务端调用，属于外部依赖行为 | 需要在 Phase 1 用只读探针实测（不改生产） |
| 9 | Supabase 那两张 `claude_contribution_*` 表的真实 schema | 无 migration/SQL 文件，只能从代码推断字段 | 若要复用同一 Supabase 项目，需先拿到 `information_schema` |

---

## 附录 A：本次审计用到的关键文件

```
lib/db/SiteDataApi.js                     # 全站数据装配 + 缓存键 + 返回前清理
lib/db/notion/getNotionAPI.js             # notion-client 单例 + 限流 + inflight 去重
lib/db/notion/getPageProperties.js        # 属性 → 字段（category/tags/tagItems/日期）
lib/db/notion/getAllTags.js / getAllCategories.js / getAllPageIds.js
lib/db/notion/getNotionPost.js            # 单页抓取（href/slug 路由用）
lib/db/notion/memberDataSource.js         # 官方 API 补充（NOTION_API_TOKEN）
lib/cache/{cache_manager,redis_cache,vercel_cache,local_file_cache,memory_cache}.js
lib/rank/{index,storage}.js               # 文章 PV/点赞：Redis Hash + /tmp 回退
lib/notify/storage.js                     # 订阅：notify:data + 365d TTL
lib/server/claude/contributionStore.js    # Supabase 唯一真实用法
components/Twikoo*.js、components/ExternalPlugins.js、components/Comment.js
components/{Vercel,AnalyticsBusuanzi,Busuanzi,LA51,Ackee,Gtag}.js
conf/{comment,analytics,rank,dev,notion}.config.js
cloudflare/notion-image-proxy/{worker.mjs,wrangler.toml,README.md}
pages/api/**（19 个端点）、middleware.ts、vercel.json、package.json
```

## 附录 B：复现命令（只读）

```bash
# DNS（只读，一次）
PYTHONUTF8=1 "C:/Users/48699/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe" \
  "C:/Users/48699/.dsh/search-hub/hub.py" --dns blog.20240606.xyz

# 代码检索示例
grep -rn "NOTION_TOKEN" --include=*.js lib pages conf scripts
grep -rn "ioredis" --include=*.js lib pages
ls -la cloudflare/notion-image-proxy
```

> 本文档为 Phase 0 只读审计产物，未对仓库做任何代码改动。后续 Phase 1 的采集端点、admin 页面与鉴权方案，需基于第 7 节的存储选型单独设计。
