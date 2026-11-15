# AUDIT REPORT —— Jason Blog Messages · Phase 0 现有项目审计

- 审计时间：2026-11-15
- 审计对象：`D:\save_files\aDrive\DeepSeek Harness\NotionNext`（GitHub `666su/NotionNext`，分支 `main`，HEAD `bb878c2`）
- 审计方式：**只读**。未修改任何代码、主题、数据库、环境变量与部署配置。
- 结论先行：**私信系统可以在本仓库内、复用现有 Admin 会话与 Redis 存储完成**，但有 6 个必须先解决的硬约束（见 §9）。

---

## 1. 运行时与仓库事实

| 项 | 实测值 | 证据 |
| --- | --- | --- |
| 框架 | Next.js **15.5.21**（Pages Router，非 App Router） | `package.json` dependencies |
| React | 18.3.1 | 同上 |
| 项目版本 | NotionNext fork，`4.10.8` | `package.json` |
| 部署 | Vercel（含 `vercel.json`：cleanUrls / trailingSlash / ignoreCommand / **crons 2 条**） | `vercel.json` |
| 数据源 | Notion（只读，`lib/db/SiteDataApi`） | 现有构建日志 |
| 评论 | Twikoo（公开计数接口已接入后台） | `lib/admin/twikoo.js` |
| 存储 | Upstash 风格 Redis（`REDIS_URL`），键前缀严格分区 | `lib/kv.js:1-30` |
| 静态生成 | 57 个页面，全部 `/admin/*`、`/api/admin/*` 为按需 SSR | Phase 6 构建输出 |
| 包管理 | yarn（`yarn.lock` 存在） | 仓库 |

> 重要：项目是 **Pages Router**。私信页面应为 `pages/message/[id].js`，接口为 `pages/api/messages/**`，不要引入 App Router 约定。

---

## 2. 管理员认证与会话（可直接复用）

| 能力 | 实现 | 复用判断 |
| --- | --- | --- |
| 账号密码 | `node:crypto` scrypt（可选 bcrypt），哈希来自 `ADMIN_PASSWORD_HASH` | ✅ 直接复用，不新建账号体系 |
| 会话 | opaque sid + HMAC 签名，Redis `admin:sess:<sha256(sid)>` | ✅ 复用 |
| Cookie | `jba_sid`（HttpOnly/Secure/SameSite=Lax）、`jba_csrf`（可读，双提交） | ✅ 复用 |
| API 守卫 | `requireAdminApi(req,res,{csrf})`：401/403/503 全在服务端判断 | ✅ 私信管理端直接调用 |
| 页面守卫 | `adminPageGuard(ctx)`（GSSP） | ✅ `/admin/messages` 复用 |
| Edge 前置 | `middleware.ts` 仅对 `/admin`、`/api/admin/*` 做乐观拦截 | ✅ 无需改 |
| 审计日志 | Redis List `admin:audit`，5000 条 / 90 天 | ✅ 复用（私信操作追加事件） |
| 限流 | 登录：账号+IP 双维度；推送：通用 `hitRateLimit` | ✅ 泛化后复用 |

证据：`lib/admin/{session,crypto,respond,page-guard,rate-limit,audit}.js`、`pages/api/admin/*`、`middleware.ts:156-168`。

**结论：不新建第二套认证。** 访客侧完全不用管理员体系；管理员侧沿用 `/admin` 会话与 CSRF。

---

## 3. 数据存储现状与能力缺口

现有 `lib/kv.js` 原语（**全部可用**）：

```
get set del incr expire ttl lpush ltrim lrange sadd srem smembers ping
setnx pfadd pfcount hincrby hgetall hset hdel mget
```

**缺口（私信需要但当前没有）**：

| 需要 | 现状 | 影响 | 建议 |
| --- | --- | --- | --- |
| 有序索引（按最后活动时间排序会话） | ❌ 无 `zadd/zrange` | 只能拉全量再内存排序 | 新增 `kvZadd/kvZrange/kvZrem/kvZcard`（ioredis 原生支持，约 40 行） |
| 列表长度 / 按下标读 | ❌ 无 `llen/lindex` | 分页只能 `lrange` | 可用 `lrange` 负索引满足；`llen` 可选新增 |
| 按前缀扫描 | ❌ 无 `scan` | 无法枚举"所有会话" | 用 Set 维护会话 ID 全集，避免 `scan`（Upstash 对 scan 也不友好） |
| 计数自增 | ✅ `kvIncr` | — | 直接复用 |
| 字段删除 | ✅ `kvHdel`（Phase 4 新增） | — | 直接复用 |

> **不建议**在 Upstash 上做 `SCAN`：Upstash REST/HTTP 语义下代价高。改用"显式索引集合"（Set/ZSet）是正确做法。

**关键风险**：现有 Redis 实例同时承载 ISR 缓存键（`global_data_*`、`page_block_*`）与统计日志。若该实例配置了 `allkeys-lru` 淘汰策略，**私信可能被缓存淘汰**。这是数据安全问题，不是性能问题 —— 见 §9 R1。

---

## 4. 路由体系与冲突（必须先解决）

现有动态路由：

```
pages/[prefix]/index.js              → /{prefix}
pages/[prefix]/[slug]/index.js       → /{prefix}/{slug}   (ISR, fallback 见 getStaticPathsBase)
pages/[prefix]/[slug]/[...suffix].js → /{prefix}/{slug}/…
```

**冲突结论**：如果没有静态路由，`/message/{id}` 会被 `[prefix]/[slug]` 接管，并在 `getStaticProps` 返回 `notFound: true`（`pages/[prefix]/[slug]/index.js:50`）→ 访问直接 404。

对策（与现有 `/admin` 完全相同的既有做法）：新增静态路由 `pages/message/[id].js`。Next 的静态段优先于动态段，因此：

```
/message/abc      → pages/message/[id].js     ✅
/admin/...        → pages/admin/...           ✅（已是此模式）
```

同时确认不会被 `[prefix]/[slug]/[...suffix]` 抢走（它匹配的是三段以上路径）。

`middleware.ts` matcher 为 `['/((?!.*\..*|_next|/sign-in|/auth).*)', '/', '/(api|trpc)(.*)']`：
`/message/xxx` 与 `/api/messages/*` 都会进入 middleware，但只有 `/admin*` 会触发 `adminGuard`，其余走 `authMiddleware`（无 Clerk 密钥时为 `noAuthMiddleware` → 直接放行）。**不需要改 middleware**。

---

## 5. 全局挂载与"公开页面"污染

`pages/_app.js:90-107`：

```jsx
const isAdminRoute = route.pathname === '/admin' || route.pathname.startsWith('/admin/')
…
{isAdminRoute ? <Component/> : (
  <>
    <GLayout>…</GLayout>
    <ExternalPlugins/>   {/* 第三方脚本 */}
    <BlogPet/>          {/* 桌宠 */}
    <Tracker/>          {/* 自建统计 */}
  </>
)}
```

**结论**：`/message/{id}` 默认会套博客主题布局、加载第三方插件、桌宠与统计 SDK。对私密会话页这是**三重问题**：

1. 主题外壳会把私密页渲染成博客文章样式，且 SEO 组件会写入 `<meta>`；
2. `ExternalPlugins` 可能加载第三方脚本（分析/客服），**私密页不应有第三方脚本**；
3. `Tracker` 会把 `/message/{id}` 记入统计（含路径），等于把"私信页被访问"写进统计库。

对策：新增 `isMessagesRoute` 分支，与 `isAdminRoute` 同级，走**独立最小外壳**（不挂 GLayout/SEO/ExternalPlugins/BlogPet/Tracker）。

---

## 6. 右下角悬浮组件占用情况

| 组件 | 位置/层级 | 是否真实渲染 | 证据 |
| --- | --- | --- | --- |
| 桌宠 BlogPet | `position: fixed; z-index: 55`，坐标由 `defaultPosition()` 计算并持久化 | ✅ 全站公开页渲染 | `styles/blogPet.css:7-9`、`components/BlogPet/BlogPet.js:89-92`、`pages/_app.js:104` |
| 回顶按钮 | `fixed right-4 bottom-4 z-10` | ✅ 主题 example 渲染 | `themes/example/index.js:143` |
| 通知条 | `fixed left-0 bottom-14 z-20` | ✅ | `components/Notification.js:41` |
| 可访问性面板 | `fixed bottom-4 right-4 z-50` | ❌ **未被任何文件引用**（死代码） | `components/Accessibility.js:230`，全仓无 import |
| 主题级样式覆盖 | `#theme-example .fixed.right-4.bottom-4` 在移动端改为 `right/bottom: 0.75rem` | ✅ | `themes/example/style.js:409-413` |

**结论**：右下角已经被"回顶按钮 + 桌宠"占用，且桌宠可拖动、坐标存在 localStorage。私信入口若再叠一个 `fixed bottom-4 right-4`，会：

- 与回顶按钮重叠（同一坐标）；
- 被桌宠遮挡（z 55 > 常规层级）；
- 在移动端与安全区/通知条打架。

对策（不让用户"简单叠加多个悬浮按钮"）：

1. **并入既有右侧竖排栈**：在回顶按钮所在容器内新增一个入口，纵向排列（私信在上、回顶在下），共用 `z-10` 容器；
2. 桌宠默认坐标在右下，需要给私信入口留出"避让区"，或把入口放在**右上/左下**？——不建议，用户已习惯右下；
3. 更稳的做法：把入口做成**右下角竖排 FAB 组**（私信 / 回顶），并给桌宠的 `defaultPosition` 传一个 `avoidBottomRight` 参数（桌面端把桌宠默认位置左移 56px）。这需要读 `components/BlogPet/blogPetConfig.js` 的 `offset/edge` 实现细节（Phase 2 处理）。

---

## 7. Cookie 能力（决定私密链接方案）

`lib/admin/respond.js:65-86` 的 `serializeCookie` 已支持：`maxAge / httpOnly / path / sameSite / secure`，值经 `encodeURIComponent`。

**结论**：可以做"最小 Path"的会话 Cookie，例如 `Path=/message/<convId>`。但**注意**：Cookie 的 Path 作用域同时决定它会不会被 API 请求带上 —— `/api/messages/conversations/<id>` 与 `/message/<id>` 是两个不同前缀，因此需要**同名不同 Path 的两个 Cookie**，或退化为 `Path=/`。三种方案的取舍见 `ARCHITECTURE_PROPOSAL.md §4.4`。

`shouldUseSecureCookie()` 在 `NODE_ENV=production` 或 `VERCEL` 环境下恒为 `true`，预览环境同样安全。

---

## 8. 头部、CORS 与缓存现状（安全相关）

`next.config.js:342-356` 有一条**全站规则**：

```js
{ source: '/:path*{/}?', headers: [
  { key: 'Access-Control-Allow-Credentials', value: 'true' },
  { key: 'Access-Control-Allow-Origin', value: '*' },
  { key: 'Access-Control-Allow-Methods', value: 'GET,OPTIONS,PATCH,DELETE,POST,PUT' },
  ...
]}
```

问题：

1. `*` 与 `credentials: true` 组合本身被浏览器拒绝（带凭据的跨域读取会失败），所以现状不是"可利用的越权"，但它是**误导性配置**；私信 API 必须显式覆盖为同源或限定来源。
2. 全站没有 `X-Content-Type-Options` / HSTS / CSP（都被注释掉了，`next.config.js:357-381`）。
3. 只有 `/admin`、`/admin/:path*`、`/api/admin/:path*` 三组规则带 `no-store` + `X-Robots-Tag`（`next.config.js:397-437`）。**`/message/*` 与 `/api/messages/*` 目前没有任何专用头**。

对策：Phase 1 在 `headers()` 追加两组规则（`/message/:path*`、`/api/messages/:path*`）：`no-store` + `X-Robots-Tag: noindex, nofollow, noarchive` + `Referrer-Policy: no-referrer` + `X-Frame-Options: DENY` + `X-Content-Type-Options: nosniff`，并把 CORS 收紧为 `Access-Control-Allow-Origin: <同源>` 或直接移除该路径的 ACAO。

`/robots.txt` 由 `pages/api/robots.js` 动态生成（Phase 6 新增），当前**没有** `Disallow: /message`，需要补一条。

`sitemap`：`pages/sitemap.xml.js:32` 只枚举 Notion 页面，**不会**收录 `/message/*`（无需改动，但要写进验收）。

---

## 9. 风险清单（按严重度）

| # | 风险 | 严重度 | 证据/说明 | 对策 |
| --- | --- | --- | --- | --- |
| R1 | 私信与 ISR 缓存共用 Redis，可能被 `allkeys-lru` 淘汰 | **高** | `lib/kv.js` 与缓存共用同一 `REDIS_URL` | 优先新建**独立 Upstash 数据库**专放 `msg:v1:*`；若共库必须确认 `noeviction` 策略，并在 Phase 5 检查 |
| R2 | `/message/{id}` 被 `[prefix]/[slug]` 吞掉成 404 | 高 | `pages/[prefix]/[slug]/index.js:50` | 新增静态 `pages/message/[id].js` |
| R3 | 私密页被套博客外壳 → 第三方脚本 + 统计入库 + SEO meta | 高 | `pages/_app.js:90-107` | 新增 `isMessagesRoute` 分支 |
| R4 | 全站 CORS `*` + `credentials:true` 覆盖私信 API | 中 | `next.config.js:342-356` | 显式覆盖 `/api/messages/*` 头部 |
| R5 | 右下角三个悬浮元素争抢位置 | 中 | §6 | 并入竖排 FAB 栈 + 桌宠避让 |
| R6 | 无 zset 原语 → 会话列表要全量内存排序 | 中 | `lib/kv.js` | 新增 4 个 zset 包装函数 |
| R7 | 私密链接域名可能拼错 | 中 | `blog.config.js:22` 默认 `tangly1024.com`；实际站点 `blog.20240606.xyz`（规范给出） | 链接一律用请求 origin（`x-forwarded-host`）或显式 `NEXT_PUBLIC_LINK`，二者不一致时以请求 origin 为准 |
| R8 | Redis 单点故障 → 私信不可用 | 中 | 无本地兜底 | 服务端 fail-closed + 明确错误码；Redis 故障不得影响公开博客 |
| R9 | 无 CSP；第三方插件可在私密页执行 | 中 | `next.config.js` 注释掉 | 私密页不加载 ExternalPlugins（R3 对策已覆盖） |
| R10 | 访问凭证可能进入访问日志 | 中 | 平台默认记录 path（不含 fragment，但 query 会记） | 凭证只走 fragment + POST body；禁止 `?token=` |
| R11 | 现有审计日志 `admin:audit` 5000 条上限 | 低 | `conf/admin.config.js` | 私信操作单独写 `msg:v1:adminlog`，不挤占登录审计 |

---

## 10. 可复用 / 需新增 一览

**直接复用（0 依赖、0 新服务）**

- 管理员认证 / 会话 / CSRF / 页面守卫 / 审计
- Redis（`lib/kv.js`）+ 限流思路（`lib/notify/rate-limit.js`）
- 加密原语：`sha256Hex` / `randomToken(32)` / `timingSafeEqualStr` / `hashIp`（`lib/admin/crypto.js`）
- 后台外壳与组件：`AdminShell` / `AdminModulePage` / `AdminPanel` / `AdminDataTable` / `AdminNotice` / `useAdminReport`
- 测试手法：`tests/*.py` 走真实 HTTP + 内存 KV（Phase 6 已有 134 项先例）

**需要新增**

| 类型 | 内容 | 规模 |
| --- | --- | --- |
| 页面 | `pages/message/[id].js`（访客私密会话）、`pages/admin/messages.js`（收件箱） | 2 |
| API | `pages/api/messages/{conversations,access/exchange}`、`pages/api/messages/conversations/[id]/{messages}`、`pages/api/admin/messages/...` | 5–7 |
| lib | `lib/messages/{store,tokens,validate,rate-limit,respond}.js` | 4–5 |
| 组件 | `components/messages/{MessageWidget,MessageThread,Composer}.js` | 3–4 |
| KV 原语 | `kvZadd / kvZrange / kvZrem / kvZcard`（+ 可选 `kvLlen`） | 1 文件 |
| 配置 | `conf/messages.config.js`（长度、限流、TTL） | 1 |
| 环境变量 | `MESSAGE_TOKEN_SECRET`（≥32 字节，凭证 HMAC 用） | 1 |

**不新增**：数据库服务、ORM、WebSocket 服务、新的认证体系、新的 Vercel 项目、新的依赖包（`ioredis` 已在）。

---

## 11. 对现有博客的影响面评估

| 区域 | 是否改动 | 说明 |
| --- | --- | --- |
| 公开页面渲染 | 仅 `_app.js` 增加一个路由分支 | 默认分支逐行不变，回归成本可控 |
| 主题 `themes/**` | **不改** | 右下角入口用独立组件，挂 `_app` 的公开分支 |
| 文章/分类/标签/搜索 | 不改 | 静态路由优先，不影响 `[prefix]` |
| Twikoo 评论 | 不改 | 私信与评论完全分离 |
| 现有 Admin | 只加一个导航项 + 一个页面 | 复用现有 shell |
| 统计 | 私信页排除 Tracker | 避免"私信被读"进入统计 |
| 构建 | 新增路由，构建时间略增 | 文章页仍是 ISR，不受影响 |

---

## 12. 结论与建议

1. **技术选型：复用 Redis（独立库/独立前缀），不引入 D1 或 Turso。** 理由：现有链路已在 Vercel 内可用、无需新账号与新依赖；私信量级（个人博客）远低于 Redis 上限。代价是要补 4 个 zset 原语，且必须解决 R1 的淘汰策略问题。
2. **私密链接用 `fragment + POST 兑换 + HttpOnly Cookie`**，Cookie 作用域取"页面 + API 两个最小 Path"（详见架构文档 §4）。
3. **必须新增 `pages/message/[id].js` 与 `_app` 分支**，否则要么 404（R2），要么泄露到统计与第三方脚本（R3）。
4. 悬浮入口**不要独立浮在右下**，并入回顶按钮所在的竖排栈，并给桌宠一个避让参数。
5. 本阶段未改任何代码；下一步需要管理员确认 3 个决策点（见 `ARCHITECTURE_PROPOSAL.md §11`）后再进入 Phase 1。
