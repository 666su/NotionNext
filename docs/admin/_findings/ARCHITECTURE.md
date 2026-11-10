# 架构审计：在 NotionNext 4.10.8 fork 内新增 `/admin` 集成式后台

- 审计阶段：Phase 0（只读）
- 审计对象：`D:\save_files\aDrive\DeepSeek Harness\NotionNext`（NotionNext 4.10.8 定制 fork，站点 <https://blog.20240606.xyz>）
- 审计范围：Next.js/React 版本与路由机制、`pages/` 路由地图、`middleware.ts`、`next.config.js`、主题体系与 `_app` 包裹、可复用组件与依赖、部署形态
- 约束执行情况：未修改任何生产代码、未安装依赖、未部署、未写入 Notion、未改 Vercel/Cloudflare 配置；`.env*` 仅记录变量名，未读取任何值；未遍历 `node_modules/`、`.next/`、`docs/`、`public/`、`legacy/`
- 证据标注方式：`path:line`（行号取自审计时的工作区快照）

---

## 1. TL;DR（结论先行）

1. **路由体系是纯 Pages Router**，项目根目录没有 `app/`，全部路由由 `pages/` 文件树决定；Next 15.5.21 + React 18.3.1，Node 约束 `>=22 <25`。后台必须落在 `pages/admin/**`，不能也不该引入 App Router（`next.config.js` 的 `i18n`/`rewrites`/`_app` 全局包裹都与 Pages Router 强绑定）。
2. **`/admin` 目前是一个"半占用"命名空间**：只有 `pages/admin/notify-status.js` 一个公开、无鉴权的诊断页；`pages/admin/` 目录**没有 `index.js`**，因此 `/admin` 本身和任意 `/admin/<x>` 今天是被 `pages/[prefix]/index.js` 与 `pages/[prefix]/[slug]/index.js` 的动态路由接管，会真实发起 Notion 数据拉取并以博客主题渲染（未命中则 404）。这是第 1 号冲突点。
3. **后台要脱离博客主题，必须改 `pages/_app.js`**：`_app` 无条件用 `GLayout`（主题 `LayoutBase`）包住所有页面，并同时注入 `SEO`、`ExternalPlugins`（统计/广告/挂件）、`BlogPet`（`pages/_app.js:87-98`）。这是唯一必须修改的渲染入口，也是最需要评审的一处改动。
4. **`middleware.ts` 的 matcher 覆盖 `/admin/*`**（只排除含 `.` 的路径与 `_next`），并且**已存在 Clerk 分支**用 `/admin/(.*)/memberships`、`/admin/(.*)/domain` 做组织权限保护（`middleware.ts:24-27`）。新增后台鉴权必须"叠加"在其上，并规避这两个保留子路径。
5. **没有任何 catch-all rewrite 会把 `/admin/*` 打到别处**：`next.config.js` 的 rewrites 只有三类——多语言前缀、`/rss/*`、`/:path*.html` 伪静态（`next.config.js:265-323`）。但 `headers` 对全站（`/:path*{/}?`）下发 `Access-Control-Allow-Origin: *`（`next.config.js:338-351`），后台会一起继承。
6. **没有任何图表库**：`package.json` 依赖里不存在 recharts / echarts / chart.js / d3 之类（`package.json:68-98`）；`components/ui/` 只有一套 Clerk 租户面板组件（`components/ui/dashboard/`，11 个文件）。后台做图表要么纯手写 SVG/CSS，要么付"新增依赖 + 同步 `yarn.lock`"的成本。
7. **生产形态是 Vercel 上的 Node runtime（ISR/SSR 混合），不是 static export**：`output` 仅在 `EXPORT=true` 时变 `export`、在 `NEXT_BUILD_STANDALONE=true` 时变 `standalone`（`next.config.js:190-194`）。因此后台可以用 `getServerSideProps` + API Route，**但绝不能用 `getStaticProps`**（public 页面全是 ISR，会被预渲染与 CDN 缓存）。
8. 附带发现：`.github/workflows/sync.yaml` 保留着对上游 `tangly1024/NotionNext` 的 fork 同步动作，长期维护后台代码有被上游覆盖的风险。

**可行性结论**：在现有项目内新增 `/admin` 后台是可行的，且不需要更换主题、不需要迁移路由方案、不需要新增站点；但必须接受"改 `_app.js` + 改 `middleware.ts`"这两处对公开页面有影响的改动，并严格把后台页面排除在 ISR 之外。

---

## 2. 版本与运行环境

| 项目 | 实际值 | 证据 |
| --- | --- | --- |
| 项目版本 | NotionNext 4.10.8（定制 fork） | `package.json:3` |
| Next.js | **15.5.21**（锁定值，非仅范围） | `package.json:87`；`yarn.lock` `next@^15.5.21 → 15.5.21` |
| React / ReactDOM | **18.3.1** | `package.json:91-92`；`yarn.lock` `react@^18.3.1 → 18.3.1` |
| 路由模式 | **纯 Pages Router**（根目录无 `app/`，无 `use client` 服务端组件语义的 App Router 入口） | 根目录列表无 `app/`；全部路由文件在 `pages/`（见 §3）；`middleware.ts:1` 使用 `next/server` |
| Clerk | `@clerk/nextjs` 5.7.6（v5 的 `clerkMiddleware` + 同步 `auth()`） | `package.json:70`；`yarn.lock`；`middleware.ts:66-91` |
| 包管理器 | yarn 1.22.22（classic），有 `yarn.lock` | `package.json:4`；`yarn.lock` 存在 |
| Node 约束 | `>=22 <25`；`.nvmrc`/`.node-version` 均为 `22`；Docker 基础镜像 `node:22-alpine` | `package.json:7-9`；`.nvmrc:1`；`.node-version:1`；`Dockerfile:4` |
| TypeScript | 5.9.3，`allowJs: true`，`jsx: preserve`，`strict: true` | `package.json:134`；`tsconfig.json:38,48,40` |
| 别名（tsconfig，真实生效） | `@/*`→`./*`、`@/components/*`、`@/hooks/*`、`@/themes/*`、`@/pages/*`、`@/data/*`、`@/lib/*`、`@/styles/*`、`@/blog.config` | `tsconfig.json:4-32` |
| 别名（jsconfig，历史残留） | 多一条 `@/theme/*` → `theme/*`，该目录**不存在**（真实是 `themes/`） | `jsconfig.json:9-16` vs `tsconfig.json:17-19` |
| webpack 别名 | `config.resolve.alias['@'] = path.resolve(__dirname)` | `next.config.js:414` |
| 构建命令 | `build` = `cross-env BUILD_MODE=true next build`；`export`、`bundle-report`、`build-all-in-dev` 独立 | `package.json:20-25` |
| 输出模式 | 默认 `undefined`（运行时 SSR/ISR）；`EXPORT=true`→`export`；`NEXT_BUILD_STANDALONE=true`→`standalone` | `next.config.js:190-194,200`；`Dockerfile:17` |
| 静态页生成超时 | 默认 300s，可由 `STATIC_PAGE_GENERATION_TIMEOUT` 覆盖（60–3600） | `next.config.js:201`；`lib/build/buildEnv.js:5,55-61` |
| lint / 类型检查 | `yarn lint`（next lint）、`yarn type-check`（tsc --noEmit） | `package.json:29,31` |
| 已安装但未声明的别名映射 | `next.config.js` 的 `modularizeImports` 引用了 `@heroicons/react`，但依赖里**没有** heroicons 包（新增代码不要依赖它） | `next.config.js:209-216` vs `package.json:68-98` |

**对后台的含义**

- 生产构建不设 `EXPORT` / `NEXT_BUILD_STANDALONE`，即 Vercel 上是普通 Node serverless 形态 → `getServerSideProps`、`pages/api/*`、`middleware` 全部可用。
- 新增页面必须同时通过 `yarn type-check`（`tsconfig.json` 的 `strict`、`exactOptionalPropertyTypes`、`noUncheckedIndexedAccess` 全部开启，写 `.ts`/`.tsx` 会被严格校验；写 `.js` 也受 `checkJs`? —— jsconfig 里 `checkJs: true`，但 tsconfig 未开 `checkJs`，`tsc` 实际按 tsconfig 走）。
- CI 有 `lockfile` 门禁：`yarn install --frozen-lockfile && git diff --exit-code yarn.lock`（`.github/workflows/ci.yml:40-46`）→ 一旦新增依赖，必须同 PR 提交 `yarn.lock`，否则 CI 直接红。

---

## 3. 路由地图（Pages Router，全部来自 `pages/` 文件树）

### 3.1 公开页面

| 路由 | 文件 | 渲染机制 | 主题布局（`DynamicLayout` 传入） | 备注 |
| --- | --- | --- | --- | --- |
| `/` | `pages/index.js` | ISR（`getStaticProps`，`pages/index.js:33`） | `LayoutIndex` | 首页；含 `UUID_REDIRECT` 的客户端分支（`pages/index.js:124`） |
| `/page/[page]` | `pages/page/[page].js` | ISR + `getStaticPaths` | `LayoutPostList` | 分页列表 |
| `/[prefix]` | `pages/[prefix]/index.js` | ISR，`getStaticPaths`（`:126-132`）+ `getStaticProps`（`:134-151`） | `LayoutSlug` | **一级 slug，只匹配"无斜杠"的 slug**（`checkSlugHasNoSlash`）；`notFound: !props.post`（`:149`） |
| `/[prefix]/[slug]` | `pages/[prefix]/[slug]/index.js` | 同上（`:21-52`），复用 `Slug` 组件 | `LayoutSlug` | 二级 slug（`checkSlugHasOneSlash`） |
| `/[prefix]/[slug]/[...suffix]` | `pages/[prefix]/[slug]/[...suffix].js` | 同上（`:22,41`） | `LayoutSlug` | 三级及更深 slug |
| `/category` | `pages/category/index.js` | ISR | `LayoutCategoryIndex` | |
| `/category/[category]` | `pages/category/[category]/index.js` | ISR + paths（`:66`） | `LayoutPostList` | |
| `/category/[category]/page/[page]` | `pages/category/[category]/page/[page].js` | ISR + paths（`:51`） | `LayoutPostList` | |
| `/tag` | `pages/tag/index.js` | ISR | `LayoutTagIndex` | |
| `/tag/[tag]` | `pages/tag/[tag]/index.js` | ISR + paths（`:78`） | `LayoutPostList` | |
| `/tag/[tag]/page/[page]` | `pages/tag/[tag]/page/[page].js` | ISR + paths（`:42`） | `LayoutPostList` | |
| `/search` | `pages/search/index.js` | ISR（`:41`） | `LayoutSearch` | |
| `/search/[keyword]` | `pages/search/[keyword]/index.js` | ISR + paths（`:56`） | `LayoutSearch` | |
| `/search/[keyword]/page/[page]` | `pages/search/[keyword]/page/[page].js` | ISR + paths（`:54`） | `LayoutSearch` | |
| `/series/[series]` | `pages/series/[series]/index.js` | ISR + paths（`:67`） | `LayoutPostList` | **没有 `/series` 索引页** |
| `/archive` | `pages/archive/index.js` | ISR（`:33`） | `LayoutArchive` | |
| `/sitemap.xml` | `pages/sitemap.xml.js` | GSSP（`getServerSideProps`） | 无 | 由 Notion `allPages` 生成（`pages/sitemap.xml.js:18-48`），**不包含** `pages/` 里的静态后台路由 |
| `/404`、`/500` | `pages/404.js`、`pages/500.js` | 404 为 ISR（`:16`） | `Layout404` | |
| `/_error` | `pages/_error.js` | — | — | |

### 3.2 Clerk 相关（已存在，非我们建的）

| 路由 | 文件 | 渲染机制 | 布局 | 说明 |
| --- | --- | --- | --- | --- |
| `/sign-in/[[...index]]` | `pages/sign-in/[[...index]].js` | ISR + `getStaticPaths`（`:17,40`） | `LayoutSignIn` | Clerk 登录 |
| `/sign-up/[[...index]]` | `pages/sign-up/[[...index]].js` | ISR + paths（`:16,39`） | `LayoutSignUp` | Clerk 注册 |
| `/auth`、`/auth/result` | `pages/auth/index.js`、`pages/auth/result.js` | `/auth/result` 为 ISR（`:10`） | `LayoutAuth` | OAuth 回跳 |
| `/dashboard/[[...index]]` | `pages/dashboard/[[...index]].js` | ISR，`getStaticPaths` 显式列出 `[]`/`membership`/`balance`/`user-profile`/`order`/`affiliate`，`fallback: 'blocking'`（`:41-57`） | `LayoutDashboard` | **这不是自建后台**：它是 Clerk 租户/会员中心。数据靠 `resolvePostProps({prefix:'dashboard'})`，布局靠主题导出 `LayoutDashboard`；而 `themes/example` **没有导出** `LayoutDashboard`（`themes/example/index.js:409-419` 只导出 404/Archive/Base/CategoryIndex/Index/PostList/Search/Slug/TagIndex），因此会走 `EmptyPageLayout`（`themes/theme.js:18,147-148`）→ 当前主题下该路由基本是空白页 |

> 结论：**`/dashboard` 与 `/admin` 是两条完全独立的线**。`/dashboard` 是面向终端用户（Clerk 会员）的，`/admin` 是面向站长自己的；不要复用 `/dashboard` 的路径或组件体系（`components/ui/dashboard/*` 全是 Clerk 会员 UI，`components/ui/dashboard/DashboardBody.js:1` 带 `'use client'` 只是历史写法）。

### 3.3 `/admin` 命名空间现状（核心）

| 路由 | 文件 | 渲染机制 | 现状 | 说明 |
| --- | --- | --- | --- | --- |
| `/admin/notify-status` | `pages/admin/notify-status.js` | **GSSP**（`:61-107`） | 公开可访问、**无任何鉴权** | 推送/Redis 状态诊断页；页面内自述路径 `/admin/notify-status`（`:2-3,17`）；直接读 `process.env.REDIS_URL` 并连 ioredis（`:65,75-93`） |
| `/admin` | **无文件** | 被 `pages/[prefix]/index.js` 接管 | **冲突源** | 静态路由优先于动态路由，但 `pages/admin/` 没有 `index.js`，所以 `/admin` 会落进 `/[prefix]`（`prefix = 'admin'`）→ 真实 Notion 拉取 + `LayoutSlug` 渲染 → `notFound` |
| `/admin/<任意单段>` | **无文件** | 被 `pages/[prefix]/[slug]/index.js` 接管 | **冲突源** | 例如 `/admin/settings`、`/admin/foo` 都会走 Notion 查询再 404 |
| `/admin/<a>/<b>` | **无文件** | 被 `pages/[prefix]/[slug]/[...suffix].js` 接管 | 同上 | 三段以上同样落进动态路由 |
| `/api/admin/*` | 尚无 | `pages/api/*` 文件即路由 | 可用 | Pages API 约定：文件名即路径；示例 `pages/api/push/send.js` → `POST /api/push/send`（`pages/api/push/send.js:1-3`） |

### 3.4 API 路由挂载规则

`pages/api/**` 走 Next file-based API：`pages/api/push/send.js` → `/api/push/send`（`pages/api/push/send.js:3` 注释即示例）。现有 20 个 API：`pages/api/{cache,revalidate,rss,subscribe,notion-comments,user}.{js,ts}`、`pages/api/auth/callback/notion.ts`、`pages/api/blog-pet/posts.js`、`pages/api/claude/contribution-refresh.js`、`pages/api/push/{send,status,subscribe,subscriptions,test,vapid-public-key}.js`、`pages/api/rank/{info,like,seed,status,top,view}.js`。**全部未声明 `export const config = { runtime, maxDuration }`**（全目录 grep 无命中）→ 默认 Node.js runtime，时长上限由 Vercel 计划决定（见 §10）。

---

## 4. `middleware.ts` 分析

### 4.1 matcher 到底匹配/排除了什么

```ts
// middleware.ts:10-13
export const config = {
  matcher: ['/((?!.*\\..*|_next|/sign-in|/auth).*)', '/', '/(api|trpc)(.*)']
}
```

- 第 1 项：`/` 加上"任意不含点号的路径"，但显式排除 `_next`。
- 第 2 项：`/` 本身（冗余，但保证根路径命中）。
- 第 3 项：`/api/*` 与 `/trpc/*` 也在 matcher 内（注意第 1 项因"含点号才排除"并不排除 api，第 3 项是显式补充）。

**实测（正则语义模拟，Node 直接编译该模式）**：

| 请求路径 | 是否进入 middleware | 说明 |
| --- | --- | --- |
| `/admin` | 是 | 无点号 |
| `/admin/login` | 是 | 无点号 |
| `/admin/dashboard` | 是 | 无点号 |
| `/admin/notify-status` | 是 | 无点号 |
| `/images/a.png` | 否 | 命中 `.*\..*` 排除（含点号即排除，这是"静态资源白名单"的实现方式） |
| `/api/push/send` | 是 | 被第 3 项显式纳入（第 1 项也命中） |
| `/_next/static/...` | 否 | `_next` 排除 |
| `/sign-in`、`/sign-in/x`、`/auth`、`/auth/result` | **是（与注释意图不符）** | 负向断言紧跟在首个 `/` 之后，`/sign-in`、`/auth` 两个分支要求此处出现字面 `/`，实际永远不命中 → 这两个"白名单"形同虚设。当前无害（无 Clerk 时走 `NextResponse.next()`；有 Clerk 时 `clerkMiddleware` 自己会处理 `/sign-in`），但**不要指望它做任何排除** |

> 证据性质说明：以上是正则语义验证（`^/((?!.*\..*|_next|/sign-in|/auth).*)$` 对上述路径的真/假值），不是启动 dev server 的运行时验证（Phase 0 不允许起服务/装依赖）。matcher 由 Next 用 path-to-regexp 编译，内联 `(?!...)` 组的语义与正则一致；如需 100% 确认，Phase 1 起本地 `next dev` 后用 `curl -I` 观察一次即可。

### 4.2 两个分支的实际行为

**分支选择**：`middleware.ts:66` — `process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 存在 → `clerkMiddleware`，否则 → `noAuthMiddleware`。

- **Clerk 分支**（`middleware.ts:67-91`）
  - `isTenantRoute` 命中 `/user/organization-selector(.*)`、`/user/orgid/(.*)`、`/dashboard`、`/dashboard/(.*)` → 未登录则 302 到 `/sign-in?redirectTo=<原地址>`（`:70-77`）。
  - `isTenantAdminRoute` 命中 **`/admin/(.*)/memberships`、`/admin/(.*)/domain`** → `auth().protect(...)` 要求 `org:sys_memberships:manage` 或 `org:sys_domains_manage` 权限（`:24-27,80-87`）。**这两条已经占用了 `/admin` 前缀下的两个二级路径模式**。
  - 其余 `/admin/*` 不做任何保护，直接 `NextResponse.next()`（`:89-90`）。

- **noAuthMiddleware 分支**（`middleware.ts:36-62`）
  - 仅当 `BLOG.UUID_REDIRECT` 为真时，去 `fetch(${origin}/redirect.json)`（`:41-47`，失败只打 log），然后取路径最后一段做 Notion ID 归一化，命中映射表则 **308 永久重定向**到 `/<目标>`（`:52-59`）。
  - 否则 `NextResponse.next()`。**无任何鉴权语义**。

- **UUID_REDIRECT 现状**：默认 `false`（`blog.config.js:87` `UUID_REDIRECT: process.env.UUID_REDIRECT || false`），且 `public/redirect.json` **文件不存在**（`ls public/redirect.json` → no such file）。即使打开开关，`fetch` 也会 404 并被 catch 吞掉 → 当前等价于"关闭"。
  - 风险提示：若未来开启，`/admin` 的最后一段是 `admin`，只要 `redirect.json` 里存在键 `admin`，`/admin` 会被 308 到别处；`/admin/dashboard` 会被键 `dashboard` 命中。**后台路径与 UUID 重定向字典存在潜在键冲突**。

### 4.3 `/admin` 新路由会不会被拦截或误重定向

- **不会被"拦截"**：noAuthMiddleware 只可能 308 重定向（需 `UUID_REDIRECT` + `redirect.json` 命中）；Clerk 分支对 `/admin/*` 只保护 `memberships`/`domain` 两个模式。所以今天新增 `/admin/dashboard` 能正常到达页面。
- **会被"穿过"**：middleware 在 Edge 上跑，`/admin/*` 每个请求都会过一遍（当前无 Clerk 时几乎零成本；有 Clerk 时会走 Clerk 的会话解析）。
- **会误重定向的唯一现实路径**：`UUID_REDIRECT=true` + `public/redirect.json` 含 `admin`/`dashboard`/`analytics` 等键。

### 4.4 新增 `/admin` 认证中间件应加在哪里、有什么风险

**推荐做法（不新增第二个 middleware 文件）**：在 `middleware.ts` 里包一层"前置守卫"，保持对 Clerk 分支的完全兼容：

```ts
// middleware.ts（示意，3-5 行）
const isAdminRoute = createRouteMatcher(['/admin(.*)'])
const isAdminPublic = createRouteMatcher(['/admin/login(.*)'])
export default function middleware(req: NextRequest, ev: any) {
  if (isAdminRoute(req) && !isAdminPublic(req)) return adminGuard(req) // 自建会话校验
  return authMiddleware(req, ev) // 原逻辑不动
}
```

**必须注意的风险**（按严重度）：

1. **Edge runtime 限制**：middleware 跑在 Edge，不能用 `node:crypto`、`ioredis`、`fs`、`path`；`lib/rank/storage.js`（依赖 `fs`/`ioredis`）这类模块**不能**在 middleware 里 import。会话签名请用 Web Crypto（`crypto.subtle` + HMAC），或把校验下移到 API Route/`getServerSideProps`。
2. **`isTenantAdminRoute` 的保留模式**：`/admin/(.*)/memberships` 与 `/admin/(.*)/domain` 在 Clerk 启用时会被 `auth().protect()` 接管。后台若规划 `memberships` 或 `domain` 子页（例如 `/admin/domain`、`/admin/settings/domain`），会与 Clerk 权限体系撞车 → **后台子路由命名应避开 `memberships` 与 `domain` 这两个段**。
3. **matcher 已覆盖，但 `/admin` 依赖"无点号"**：若后台出现 `/admin/v1.2` 之类含点号的路径，会被 matcher 漏掉（不鉴权）。**后台路由命名禁止使用含 `.` 的段**（文件内也不要有）。
4. **`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 是构建期内联变量**：分支选择在构建期就固定了。本地 `.env.local` 只有 1 个变量（`NOTION_PAGE_ID`，见 §10），所以本地是 noAuth 分支；Vercel 是否配置了 Clerk 键**无法从仓库确认**（见 §10）。这意味着"后台鉴权逻辑"必须在两种模式下都成立，不能只在 Clerk 分支里写。
5. **不要在 middleware 里做 Notion/Redis 网络调用**：会增加每个 `/admin/*` 请求的首字节延迟（Edge 到源站的 RTT），且 `fetch` 到自家 API 会造成 middleware 自调用链（`middleware.ts:41` 现有代码已经是这种反模式，别复制）。

---

## 5. `next.config.js` 对 `/admin` 的影响点

| 配置 | 现状 | 对 `/admin` 的影响 | 证据 |
| --- | --- | --- | --- |
| `output` | `getOutput()`：默认 `undefined`；`EXPORT=true`→`export`；`NEXT_BUILD_STANDALONE=true`→`standalone` | 生产（Vercel）无 `export` → 后台可用 GSSP/API。**若有人在 Vercel 打开 `EXPORT=true`，后台直接不可用**（GSSP/API/middleware 全部不支持） | `next.config.js:190-194,200` |
| `i18n` | 非 export 时启用：`defaultLocale = BLOG.LANG`（默认 `zh-CN`），`locales` 由 `NOTION_PAGE_ID` 里的语言前缀推导（单站点 → `['zh-CN']`） | `/admin` 无前缀即可访问（默认语言无前缀）；多语言配置后 `/zh-CN/admin` 形式的访问会被 rewrite 到 `/admin`（见下条）。客户端语言跳转 `redirectUserLang` 只在 `pathname === '/'` 且配置了多站点时才动作（`lib/utils/lang.js:95-106`）→ **后台不会被自动跳到带语言前缀的地址** | `next.config.js:218-224`；`blog.config.js:11`；`lib/utils/lang.js:99-106` |
| `redirects` | 仅一条 `'/feed' → '/rss/feed.xml'`（permanent），export 时 `undefined` | 与 `/admin` 无关 | `next.config.js:253-263` |
| `rewrites` | ①多语言前缀 `/:locale(zh\|en)/:path* → /:path*`；②`/rss/feed.xml|atom.xml|feed.json → /api/rss`；③伪静态 `/:path*.html → /:path*` | **没有 catch-all 指向别处**；③会把 `/admin/login.html` 重写为 `/admin/login`（无害但会让"伪静态"访问混入后台） | `next.config.js:265-323` |
| `headers` | `/vendor/fontawesome/:path*` 长缓存；`/:path*{/}?` 全站 CORS：`Access-Control-Allow-Credentials: true` + `Allow-Origin: *` + 方法/头白名单 | 后台页面**自动继承 `Allow-Origin: *`**（跨源可发起带凭据请求，虽然浏览器会因 `*`+credentials 组合失效，但语义上是错误配置）；同时后台**没有** `Cache-Control: no-store`、没有 `X-Robots-Tag: noindex` | `next.config.js:324-388`（CORS 段 `:338-351`） |
| `images` | `remotePatterns` 允许任意 http/https 主机；`dangerouslyAllowSVG: true`；`minimumCacheTTL` 7 天 | 后台若用 `next/image` 引外链图片无需白名单；但 SVG 放行是安全面风险 | `next.config.js:225-250` |
| `compress`/`poweredByHeader`/`generateEtags` | `true`/`false`/`true` | 无影响 | `next.config.js:204-206` |
| `experimental` | `scrollRestoration`、`optimizePackageImports: ['@heroicons/react','lodash']` | 无影响（heroicons 未安装，别引入） | `next.config.js:443-448` |
| `webpack` | `resolve.alias['@']`、`lodash.throttle` 替换、客户端 `fs/net/tls/dns/path` 置 false | 后台**不能在客户端组件里 import `fs`/`ioredis`**（会直接编译成 undefined 或报错）；服务端（GSSP/API）可以 | `next.config.js:404-441`（fallback `:431-438`） |
| `exportPathMap` | export 时删掉 `/sitemap.xml`、`/auth` | 仅在 `EXPORT=true` 生效 | `next.config.js:449-458` |
| `publicRuntimeConfig` | `THEMES: themes`（扫描 `themes/` 目录名） | 与后台无关（但后台若想读配置，用 `getConfig().publicRuntimeConfig` 是现有唯一通道） | `next.config.js:459-462`；`themes/theme.js:8` |
| `eslint.ignoreDuringBuilds` | `true` | 构建不会因 lint 失败而中断（lint 在 CI 单独跑） | `next.config.js:197-199` |

### 5.1 缓存 / ISR 会不会把后台静态化

- **公开页面全部是 ISR**（`getStaticProps` + `revalidate: NEXT_REVALIDATE_SECOND`，默认 60s，`blog.config.js:15`）。动态路由的 `fallback` 在非 export 下是 `'blocking'`（`lib/build/staticPaths.js:60-64`），意味着任何未预生成的 slug 会"按需 SSG 并写入 ISR 缓存"。
- **对后台的直接威胁**：如果后台页面误用 `getStaticProps`，构建期就会被预渲染（甚至构建期直接失败，因为构建环境没有会话 Cookie），产物带 `s-maxage` → **CDN 会把"某次生成的 HTML"发给所有人**。这是最危险的一类错误。
- **正确做法**：后台页面一律 `getServerSideProps`（参考唯一先例 `pages/admin/notify-status.js:61`），并显式 `res.setHeader('Cache-Control','no-store')`；后台 API 同样 `no-store`（现有先例：`pages/api/rank/like.js:17` `res.setHeader('Cache-Control','no-store')`）。
- `notify-status` 的 GSSP 会在**每次请求**连 Redis（`pages/admin/notify-status.js:75-93`），无鉴权 → 任何人对该 URL 发请求都能触发一次 Redis 连接并读到"是否配置/连接/订阅数"（不泄漏密钥值）。**这是现存的公开信息面**，后台收口时要一并处理。

---

## 6. 主题体系与 `_app` 包裹关系

### 6.1 主题加载机制

- 主题清单由构建期扫描 `themes/` 子目录得到（`scanSubdirectories`，`next.config.js:14,170-184`），经 `publicRuntimeConfig.THEMES` 暴露（`next.config.js:459-462`），客户端从 `getConfig()?.publicRuntimeConfig` 读（`themes/theme.js:8`）。
- 当前主题：`THEME = process.env.NEXT_PUBLIC_THEME || 'example'`（`blog.config.js:10`）。**`example` 是默认值，即"这个 fork 用 example 主题"。**
- 运行时主题优先级：`URL ?theme=` > Notion 配置 `NOTION_CONFIG.THEME` > `BLOG.THEME`（`pages/_app.js:47-52`；同样逻辑在 `themes/theme.js:179-185` 的 `getCurrentTheme`）。
- 布局解析：`dynamic(() => resolveThemeLayout(theme, 'LayoutBase'|'LayoutSlug'|..., EmptyLayout))`（`themes/theme.js:108-149,192-205,210-243`）。主题包必须是**默认导出或具名导出**对应 `Layout*`；缺失时回退到 `BLOG.THEME`，再回退到 `example`，最后回退到 `EmptyBaseLayout`/`EmptyPageLayout`（`themes/theme.js:17-18,81-86,132-149`）。
- **`layout-map.config.js` 实际是死配置**：`conf/layout-map.config.js:5-31` 定义了 `LAYOUT_MAPPINGS`，`themes/theme.js:1` 引入它，唯一消费者是 `getLayoutNameByPath`（`themes/theme.js:247-251`），而该函数**没有任何调用点**（全仓 grep 仅命中定义处）。真正决定布局的是每个页面里显式传的 `layoutName`。→ 想"给某个路由换布局"不能靠改 `layout-map.config.js`，要么改页面、要么改 `_app`。

### 6.2 `themes/example` 目录组织

```
themes/example/
  index.js          # 导出 Layout404/LayoutArchive/LayoutBase/LayoutCategoryIndex/
                    # LayoutIndex/LayoutPostList/LayoutSearch/LayoutSlug/LayoutTagIndex
                    # 与 THEME_CONFIG（themes/example/index.js:409-419）
  config.js         # 主题默认配置
  style.js          # 主题样式常量
  components/       # 33 个主题私有组件：Header/SideBar/Footer/TitleBar/MenuList/
                    # BlogItem/BlogListPage/Catalog/SearchOverlay/SeriesPanel/
                    # RankBoard/WritingCalendar/... （见目录列表）
```

- 关键：`LayoutBase`（`themes/example/index.js:42`）是**全站外壳**（Header + SideBar + Footer），所有页面布局都嵌在它里面。
- `themes/example` **没有** `LayoutDashboard`/`LayoutSignIn`/`LayoutSignUp`/`LayoutAuth`（导出清单仅 9 个），所以 `/dashboard`、`/sign-in` 在 example 主题下走空布局（§3.2）。

### 6.3 `_app.js` 做了什么（后台是否会被主题包裹：**会**）

```js
// pages/_app.js:87-98（节选）
<GlobalContextProvider {...pageProps}>
  <GLayout {...pageProps}>        {/* 主题 LayoutBase */}
    <SEO {...pageProps} />
    <Component {...pageProps} />  {/* 你的页面 */}
  </GLayout>
  <ExternalPlugins {...pageProps} />
  <BlogPet />
</GlobalContextProvider>
```

- `GLayout` = `getBaseLayoutByTheme(theme)`（`pages/_app.js:78-84`），即主题的 `LayoutBase` → **后台必然被博客 Header/SideBar/Footer 包裹**。
- 同时无条件注入：`SEO`（`pages/_app.js:91`，会写入 `title`/`og:*`/canonical）、`ExternalPlugins`（`:94`，统计/广告/挂件，含 Vercel Analytics 动态导入 `components/ExternalPlugins.js:536`）、`BlogPet`（`:95`）。这些在后台页面上是纯污染（上报访问量、加载第三方脚本、露出桌宠）。
- 全局样式：`pages/_app.js:2-8` 引入 `globals.css`（含 `@tailwind base/components/utilities`，`styles/globals.css:1-3`）、`react-notion-x/src/styles.css`、`styles/notion.css`、`styles/blogPet.css`。→ 后台页面**天然拥有 Tailwind 能力**（好事），但也带着 Notion 正文样式（需用作用域/重置隔离）。
- `pages/_document.js` 在 `<head>` 里注入深色模式脚本，直接给 `<html>` 加 `dark`/`light` class（`pages/_document.js` 的 `darkModeScript`），**在 `_app` 之前执行**，后台无法避免 → 后台样式需要同时适配 `.dark`（Tailwind `darkMode: 'class'`，`tailwind.config.js:11`）。
- `_app` **没有任何基于 `router.pathname` 的分支**（全文 110 行，无 `pathname` 判断）→ 这就是必须改动的那一处。

### 6.4 如何让 `/admin` 完全脱离博客主题样式而不影响公开页面

**推荐（最小侵入，仅 1 处改动）**：在 `pages/_app.js` 里按路径前缀分流，后台渲染自己的 `AdminShell`，跳过 `GLayout`/`SEO`/`ExternalPlugins`/`BlogPet`：

```js
// pages/_app.js（示意）
const isAdmin = route.pathname === '/admin' || route.pathname.startsWith('/admin/')
{isAdmin ? <Component {...pageProps} /> : <GLayout ...>...</GLayout>}
```

要点与代价：

- **保留 `GlobalContextProvider`**：`lib/global.js` 顶层 `import { useUser } from '@clerk/nextjs'`（`lib/global.js:8`），且 `_app:101-105` 在 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 存在时用 `ClerkProvider` 包裹整棵树。移除 Provider 会破坏 Clerk hooks 的前提 → 后台保留 `GlobalContextProvider`（它只做语言/主题/暗色上下文，无数据拉取副作用），但**移除 `GLayout`/`SEO`/`ExternalPlugins`/`BlogPet`**。
- **隔离样式的两种可靠手段**（可并用）：
  1. 后台根节点套一个 `.admin-scope` 容器，配合 `styles/globals.css` 或 `styles/admin.css` 里的 `@layer base` 重置（不要用 CSS-in-JS 全局覆盖，容易泄漏到公开页）。
  2. 若要与博客样式彻底隔离，可在 `pages/_document.js` 层做条件（**不建议**：`_document` 只在服务端渲染一次，且改动影响所有页面 SEO/字体预加载）。
- **不要**为了脱离主题而去改 `themes/example/*`：`LayoutBase` 是全站外壳，改它等于改公开页面。
- **Tailwind 扫描范围**（关键陷阱）：`tailwind.config.js:5-10` 的 `content` 只包含 `./pages/**/*.js`、`./components/**/*.js`、`./layouts/**/*.js`、`./themes/**/*.js`。
  - 只要后台文件是 **`.js`**，就会被自动扫描（`pages/admin/**`、`components/admin/**` 均已覆盖）→ **无需改 tailwind 配置**。
  - 若后台用 **`.tsx`/`.ts`**，Tailwind **不会**扫描 → 类名被 purge，样式全丢。此时必须扩展 `content`（或统一写 `.js`）。**建议后台统一 `.js`**，与项目现状一致（现存 TS 仅 `pages/api/user.ts`、`pages/api/auth/callback/notion.ts`、`components/BeiAnGongAn.tsx`、`hooks/useWindowSize.ts` 等少数文件）。
  - `./layouts/**/*.js` 目录不存在（历史残留），说明 content 配置已有一处过时项，但不是我们的改动目标。

---

## 7. 现有可复用组件与依赖

### 7.1 `components/ui/` 现状

**只有一套东西**：`components/ui/dashboard/`（11 个文件）——`DashboardBody.js`、`DashboardHeader.js`、`DashboardMenuList.js`、`DashboardUser.js`、`DashboardSignOutButton.js`、`DashboardItem{Home,Membership,Balance,Order,Affliate}.js`、`DashboardButton.js`。
它们是 Clerk 会员中心的 UI（`components/ui/dashboard/DashboardBody.js:1-20` 用 `dynamic()` 懒加载各 Item），**与后台需求不同源**，但可以借鉴其"壳 + 菜单 + 内容区"的组织方式。**没有**通用 Button/Table/Card 抽象。

### 7.2 可直接复用的能力（服务端）

| 能力 | 模块 | 说明 |
| --- | --- | --- |
| 全站数据 / 文章解析 | `lib/db/SiteDataApi.js`（`fetchGlobalAllData`、`resolvePostProps`） | `resolvePostProps` 会先拉全站数据再按 slug 匹配（`lib/db/SiteDataApi.js:413-445`）；后台列文章/文章统计可直接用 `fetchGlobalAllData` |
| 缓存层（memory / file / redis） | `lib/cache/cache_manager.js`、`local_file_cache`、`redis_cache`、`file_lock` | `ENABLE_CACHE` 默认在 build/export/dev 开启（`conf/dev.config.js:16-19`）；`REDIS_URL` 存在则用 Redis（`conf/dev.config.js:12`） |
| 站点配置读取 | `lib/config.js`（`siteConfig`） | 支持 Notion 表格配置覆盖（`lib/config.js:40-70` 的 key 白名单） |
| 推送订阅存储 | `lib/notify/storage.js`（`readData`/`writeData`/`upsertSubscription`/`getVapidKeys`…`:92-202`） | 后台可规划"订阅者列表"页 |
| 排行榜/点赞/阅读数 | `lib/rank/{index,storage}.js` + `pages/api/rank/*` | Redis Hash `rank:views`/`rank:likes`（`lib/rank/storage.js:22-25`）；Vercel 上文件回退写 `/tmp`（`lib/rank/storage.js:31-36`，**注意 `/tmp` 不可持久**） |
| API 鉴权范式（3 种现成写法） | `pages/api/revalidate.js:28-41`（Bearer `REVALIDATION_TOKEN`）、`pages/api/cache.js:12-15`（Bearer `CACHE_REVALIDATION_TOKEN`）、`pages/api/push/send.js:16-21`（`x-notify-secret` 或 body.secret） | 后台 API 建议沿用"环境变量 secret + timing-safe 比较"的既有风格，或升级为 Cookie 会话 |
| 图标 | `@tabler/icons-react`（`package.json:75`）、`remixicon-react`（`:97`） | 后台图标首选 tabler |
| 无头交互组件 | `@headlessui/react`（`:71`）、`react-hotkeys-hook`（`:94`）、`gsap`（`:82`） | 弹层/菜单/快捷键可直接用 |
| Clerk 客户端 hooks | `lib/global.js:46-52`（`useUser` 条件调用） | 若后台想复用 Clerk 登录态 |
| 统计上报 | `components/ExternalPlugins.js:536`（`@vercel/analytics` 动态 import）、`components/AnalyticsBusuanzi.js`、`components/Gtag.js`、`components/Busuanzi.js` | **后台要"关掉"它们**（见 §6.4） |

### 7.3 图表依赖：**完全没有**

- `package.json:68-98` 的 dependencies 里无任何图表库；全仓 grep `recharts|echarts|chart.js|d3-|victory|nivo|apexcharts` **零命中**。
- 新增成本（三选一，建议按顺序）：
  1. **零依赖手写**：柱状/折线用内联 `<svg>` 或 Tailwind `div` 宽度条；环形用 `conic-gradient`。后台数据量小（几十个点），完全够用，**0 KB 依赖、0 行 lockfile 变化、不触发 CI lockfile 门禁**。
  2. **新增轻量库**（如 recharts ~较大、或 uPlot ~较小）：需 `yarn add` + 提交 `yarn.lock`（`.github/workflows/ci.yml:40-46` 会校验），并接受 bundle 体积增长（可用 `yarn bundle-report`，`package.json:25`）。**Phase 0 明确禁止装依赖，Phase 1 若要装需单独审批**。
  3. CDN 引 ECharts：会引入外部脚本，与现有 `CUSTOM_EXTERNAL_JS` 机制（`blog.config.js:57`）风格一致，但后台加载第三方 CDN 有可用性/供应链风险。**不推荐**。
- 结论：**Phase 1 用方案 1**，把"图表库"作为可选增量单独立项。

### 7.4 `_app` 里的全局 Provider / Analytics 注入对后台的影响（明确结论）

| 注入项 | 对后台的影响 | 建议 |
| --- | --- | --- |
| `GlobalContextProvider`（`pages/_app.js:89`） | 提供语言/主题/暗色上下文；无数据拉取；Clerk `useUser` 在非 Clerk 环境退化为静态对象（`lib/global.js:46-52`） | **保留**（移除会破坏 hooks 前提） |
| `GLayout`（主题 `LayoutBase`） | 后台被博客 Header/SideBar/Footer 包裹 | **后台跳过** |
| `SEO`（`:91`） | 给后台写 title/og/canonical；可能被搜索引擎收录 | **后台跳过**，自己写 `<Head>` + `noindex` |
| `ExternalPlugins`（`:94`） | 加载 Vercel Analytics/Busuanzi/AdSense/挂件；后台访问会污染统计数据 | **后台跳过** |
| `BlogPet`（`:95`） | 桌宠动画覆盖在后台 UI 上 | **后台跳过** |
| `ClerkProvider`（`:101-105`） | 仅当 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 存在时包裹 | **保留**（后台可能要用其登录态） |
| `AppErrorBoundary`（`:29-35,88`） | 后台渲染错误会显示博客的英文错误页 | 可保留；后台建议自带错误边界 |
| `useAdjustStyle()`（`:44`） | 全局样式微调 hook（`hooks/useAdjustStyle.js`） | 保留无害 |
| `pages/_document.js` 的 darkMode 脚本 | 后台继承 `.dark`/`.light` class | 后台 CSS 必须适配深色 |

---

## 8. 部署形态

| 部署目标 | 配置 | 说明 |
| --- | --- | --- |
| **Vercel（主）** | `vercel.json`：`cleanUrls: true`、`trailingSlash: false`、`ignoreCommand`（commit message 含 `[skip-version]` 时跳过构建）、`headers: []` | `vercel.json:1-6`。`trailingSlash:false` → `/admin/` 会 301 到 `/admin`（后台链接一律不要带尾斜杠）。`cleanUrls:true` 在 Next 框架预设下主要影响静态资源层（`.html` 去扩展名），对 Pages 路由基本是 no-op，但**无法从仓库确认 Vercel 项目面板里是否还叠加了其它设置**（见 §10） |
| | Functions：`pages/api/**` → Node.js runtime（未声明 `runtime`/`maxDuration`） | 全目录 grep 无 `export const config` → 默认 Node，时长/内存受计划限制（Hobby/Pro 上限不同，仓库内无声明） |
| | 页面：ISR（`revalidate` 默认 60s，`blog.config.js:15`）+ 按需 `fetch` | 后台页面必须 GSSP 以绕开 CDN 缓存 |
| **Docker** | `Dockerfile`：`node:22-alpine` 多阶段，`ENV NEXT_BUILD_STANDALONE=true`，`CMD ["node","server.js"]` | `Dockerfile:4,17,48`；`.dockerignore` 只忽略 `.next*`（`.dockerignore:1`）→ 构建镜像会带上 `docs/`、`test-results/` 等，后台文档文件也会进镜像（体积/合规留意） |
| **Netlify（备用）** | `netlify.toml`：`command = yarn run build`、`publish = .next`、`NODE_VERSION = "22"`、插件 `@netlify/plugin-nextjs` | `netlify.toml:1-9`；`@netlify/plugin-nextjs` 在 devDependencies（`package.json:103`） |
| **Cloudflare（仅图片代理，独立于 Next 应用）** | `cloudflare/notion-image-proxy/`：`worker.mjs`（独立 Worker，`caches.default` + 7 天边缘缓存，`worker.mjs:1-30`）、`wrangler.toml`/`.example`（自定义域名绑定 `cdn.example.com`）、`README.md` | 该 Worker **不在** Next 构建链路里，靠 `npx wrangler deploy` 独立发布；Next 侧只通过 `NEXT_PUBLIC_NOTION_HOST`（`conf/image.config.js:8`）指向代理域名。**Cloudflare 目前不参与 `/admin` 的请求路径**（除非另有 Cloudflare 代理站点，见 §10） |
| **Netlify Functions（旁路）** | `functions/api/docs-chat.ts` | 仅 Netlify 部署用；默认 CORS 白名单是 `notionnext.tangly1024.com`（`functions/api/docs-chat.ts:30`），与本 fork 域名无关 |
| **CI/CD** | `.github/workflows/ci.yml`（lint/type-check/test/lockfile/docs-site）、`docker-ghcr.yaml`（GHCR 镜像）、`sync.yaml`（上游同步）、`pushUrl.yml`、`codeql-analysis.yml` 等 | `.github/workflows/` 共 11 个 workflow |

### 8.1 Vercel Node runtime 与 Cloudflare Worker 的边界

- **跑在 Vercel（Node.js）**：所有 `pages/**`（含 ISR 生成、GSSP 执行）、所有 `pages/api/**`、`middleware.ts`（**Edge runtime**，注意：middleware 不在 Node 里跑）。
- **跑在 Cloudflare Worker**：只有 `cloudflare/notion-image-proxy/worker.mjs`（图片反向代理 + 边缘缓存），**与被审计的 Next 应用无代码级耦合**，也不共享环境变量。
- **结论**：`/admin` 的全部逻辑（页面 + API + 鉴权）都会落在 Vercel 的 Node/Edge 上，**不要**规划"用 Cloudflare Worker 承载后台"——那等于新建一个项目，与"在现有项目内部"的前提冲突。

### 8.2 region / runtime / maxDuration 约束现状

- 仓库内**没有任何** `export const config = { runtime: 'edge'|'nodejs', maxDuration: N }` 或 `regions` 声明（grep 全 `pages/` 无命中）。
- → 全部 API 走 Vercel 默认 Node runtime、默认区域（跟随项目设置）、默认时长上限。**具体上限只能去 Vercel 控制台看**（Hobby 与 Pro 不同）。
- 对后台设计的约束：**任何单个 API 请求不要设计成"拉全站 Notion 数据 + 聚合"**。`fetchGlobalAllData` 已经在 `resolvePostProps` 里被用于整站数据（`lib/db/SiteDataApi.js:426`），Notion API 慢时极易撞上函数时长上限；后台聚合应走缓存（`lib/cache/*`）+ 分页，或预计算写入 Redis。

---

## 9. 新增 `/admin` 的具体建议与冲突清单

### 9.1 推荐目录与文件布局

```
pages/
  admin/
    index.js            # /admin → 未登录 302 到 /admin/login；已登录 302 到 /admin/dashboard
    login.js            # /admin/login（公开；middleware 允许）
    dashboard.js        # /admin/dashboard（概览：文章数/评论数/订阅数/访问趋势）
    analytics.js        # /admin/analytics（访问趋势、Top 文章、来源）
    content.js          # /admin/content（文章/页面列表，只读优先）
    comments.js         # /admin/comments（Twikoo 评论概览，只读）
    notify-status.js    # 已存在，保留路径（见 §9.3）
    [...index].js       # 兜底：未知 /admin/* 直接渲染后台 404（防落入 [prefix]/[slug]）
  api/
    admin/
      login.js          # POST：校验口令 → 下发 HttpOnly 会话 Cookie
      logout.js
      stats.js          # GET：概览数据（服务端聚合 + 缓存）
      analytics.js      # GET：时间序列数据
lib/
  admin/
    auth.js             # 会话签发/校验（Edge 可用的 Web Crypto HMAC；不要在 middleware 里 import fs/ioredis）
    guard.js            # GSSP 侧统一守卫：requireAdmin(ctx) → redirect 或返回 props
    data.js             # 数据聚合（复用 lib/db/SiteDataApi、lib/rank、lib/notify/storage）
    format.js           # 数字/日期格式化
components/
  admin/
    AdminShell.js       # 侧边导航 + 顶栏 + 内容槽（替代主题 LayoutBase）
    AdminNav.js
    StatCard.js
    TrendChart.js       # 零依赖 SVG 折线/柱状
    DataTable.js        # 轻量表格（排序/分页）
    EmptyState.js
styles/
  admin.css             # 可选：后台专属样式（.admin-scope 作用域内）
```

约定（务必遵守，否则会出现"样式莫名丢失/鉴权莫名失效"）：

1. **后台文件统一 `.js`** → 复用现有 Tailwind `content` globs（`tailwind.config.js:5-10`），无需改配置。
2. **路由段禁止包含 `.`**（会被 middleware matcher 的 `.*\..*` 排除，导致不鉴权）；**禁止使用 `memberships`、`domain` 两个段**（被 Clerk `isTenantAdminRoute` 占用，`middleware.ts:24-27`）。
3. **禁止在 `/admin` 下使用 `getStaticProps`**（会被 ISR/CDN 缓存）；统一 `getServerSideProps` + `Cache-Control: no-store`。
4. **禁止在客户端组件里 `import` `fs`/`ioredis`/`lib/rank/storage`**（`next.config.js:431-438` 把 `fs/net/tls/dns/path` 在客户端置 false）。
5. **`labels`/文案**：项目支持多语言（`lib/utils/lang.js`），后台可先只写中文。

### 9.2 与现有动态路由的冲突风险（按严重度排序）

| # | 冲突 | 触发条件 | 现状证据 | 处理建议 |
| --- | --- | --- | --- | --- |
| **C1** | **`/admin` 裸路径被 `/[prefix]` 抢走** | 只要 `pages/admin/index.js` 不存在 | `pages/admin/` 下仅有 `notify-status.js`；`pages/[prefix]/index.js:126-151` 用 `checkSlugHasNoSlash` 收所有一级 slug，非 export 下 `fallback:'blocking'`（`lib/build/staticPaths.js:60-64`） | **新增 `pages/admin/index.js`**（静态路由优先于动态路由，一旦存在即抢占成功）。上线前用 `curl -I /admin` 验证不再出现 Notion 日志 |
| **C2** | **未知 `/admin/*` 落入 `[prefix]/[slug]`** | 访问不存在的后台子路径（书签/手输/旧链接） | `pages/[prefix]/[slug]/index.js:21-52`、`pages/[prefix]/[slug]/[...suffix].js:22-41` | 增加 `pages/admin/[...index].js` 兜底 404（不要在兜底里做鉴权放行判断），或在 middleware 里把未匹配的 `/admin/*` rewrite 到 `/admin/404` |
| **C3** | **`/admin/(.*)/memberships`、`/admin/(.*)/domain` 已被 Clerk 占用** | Vercel 配了 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 且访问这两个段 | `middleware.ts:24-27,80-87`（`auth().protect()` 校验 `org:sys_memberships:manage`/`org:sys_domains_manage`） | 后台子路由**永不使用** `memberships`/`domain` 段；若未来必须用，需先在 middleware 里把后台守卫前置，再决定是否跳过 Clerk 保护 |
| **C4** | **`/admin/notify-status` 命名冲突（不是路径冲突，是"语义/安全冲突"）** | 新后台接管 `/admin` 后，该页仍是 GSSP + 无鉴权 | `pages/admin/notify-status.js:1-3,61-107` | **保留路径**（它已在页面内自述该地址、可能有外部引用），但：①给它加与后台一致的 `requireAdmin`（或至少要求 secret query）；②`_app` 的 admin 分支要覆盖它（会一起脱离主题，页面本身用纯内联样式，不受影响）；③若坚持"后台内所有 /admin/* 必须鉴权"，则新 middleware 守卫把 `/admin/notify-status` 也算进去，登录前只放行 `/admin/login` |
| **C5** | **UUID 重定向字典可能命中后台路径** | `UUID_REDIRECT=true` 且 `public/redirect.json` 含 `admin`/`dashboard`/`analytics` 键 | `middleware.ts:38-59`；`blog.config.js:87`；`public/redirect.json` 不存在 | 保持 `UUID_REDIRECT` 关闭；若必须开，`redirect.json` 里不要出现后台路径段 |
| **C6** | **Notion 站点里存在 slug 为 `admin` 的页面** | 站点内容侧 | 无法离线确认（见 §10） | 新增 `pages/admin/index.js` 后 `C1` 消失；但 sitemap 仍会输出该 slug（`pages/sitemap.xml.js:18-48` 由 Notion `allPages` 生成）→ 建议在 Notion 侧确认/改名 |
| **C7** | **`vercel.json` 的 `trailingSlash:false` + `cleanUrls:true`** | 访问 `/admin/` 或 `/admin/login.html` | `vercel.json:2-3`；`next.config.js:318-321`（`/:path*.html → /:path*`） | 后台内部链接不带尾斜杠；不为后台提供 `.html` 入口 |
| **C8** | **全站 CORS 头被后台继承** | 任意请求 | `next.config.js:338-351` | Phase 1 在 `next.config.js` 的 `headers()` 里为 `/admin/:path*` 追加 `Cache-Control: no-store`、`X-Robots-Tag: noindex`、并覆盖 `Access-Control-Allow-Origin`（`headers` 后写的规则优先生效） |

### 9.3 与 `notify-status` 的命名冲突处理建议（明确）

- **不要删除、不要改路径**：`pages/admin/notify-status.js:2-3` 的注释与页面正文（`:17`）都把 `/admin/notify-status` 当作契约地址，且 `README`/外部文档可能有引用（`docs/` 未纳入本次审计范围，见 §10）。
- **要做的三件事**：
  1. 纳入后台鉴权边界（加守卫），避免"后台已上锁、旁边留个公开诊断页"。
  2. 让它继续用 `getServerSideProps`（已经是），并在后台统一加上 `Cache-Control: no-store`。
  3. 视觉上与后台统一（可选）：它目前是内联样式 + 无 Tailwind 类（`pages/admin/notify-status.js:8,14`），在 `_app` admin 分支下不会裂版。
- **命名规范**：后台新页一律"名词短语"（`dashboard`/`analytics`/`content`/`comments`），避免与 `notify-status` 这类"功能诊断"页混在同一层级语义里；诊断类页面统一用 `*-status` 后缀。

### 9.4 哪些现有文件必须改 / 哪些绝对不能碰

**必须改（Phase 1 的最小改动集）**

| 文件 | 改什么 | 为什么必须 | 风险 |
| --- | --- | --- | --- |
| `pages/_app.js` | 增加"是否 admin 路由"分支：跳过 `GLayout`/`SEO`/`ExternalPlugins`/`BlogPet`，保留 `GlobalContextProvider`(+`ClerkProvider`) | 否则后台被主题外壳与统计脚本包裹（§6.3） | **唯一的"公开页面共享受影响"改动**：逻辑写错会让全站页面丢布局。必须只按 `pathname` 前缀判断，且默认分支保持原样 |
| `middleware.ts` | 在 `authMiddleware` 之前加 admin 守卫；保持 Clerk/noAuth 两分支原语义 | 后台鉴权必须在此层做（Edge 侧拦截成本最低、能挡住 API） | matcher 已覆盖 `/admin/*`；**注意 Edge 限制**与 §4.4 的 5 条风险；改动错误会让公开站点 302/500 |

**建议改（可选，安全性/规范性收益明显）**

| 文件 | 建议 | 证据 |
| --- | --- | --- |
| `next.config.js` | 为 `/admin/:path*` 追加 `Cache-Control: no-store` + `X-Robots-Tag: noindex`，并覆盖全站 CORS 头 | `next.config.js:324-403` |
| `pages/admin/notify-status.js` | 加鉴权 + `no-store` | `pages/admin/notify-status.js:61-107` |
| `package.json` + `yarn.lock` | **仅当**决定引入图表库时；必须同 PR 提交 lockfile | `package.json:68-98`；`.github/workflows/ci.yml:40-46` |
| `tailwind.config.js` | **仅当**后台文件用 `.tsx` 时才需要扩展 `content`；统一 `.js` 则无需改 | `tailwind.config.js:5-10` |

**绝对不能碰（改了就影响公开站点或生产链路）**

| 文件/目录 | 原因 |
| --- | --- |
| `themes/**`（尤其 `themes/example/index.js` 的 `LayoutBase`、`themes/theme.js`） | 主题是全站渲染内核，`LayoutBase` 是公开页面的外壳（`themes/example/index.js:42`） |
| `pages/[prefix]/**`、`pages/page/**`、`pages/category/**`、`pages/tag/**`、`pages/search/**`、`pages/series/**`、`pages/archive/**`、`pages/index.js`、`pages/404.js`、`pages/500.js`、`pages/_error.js`、`pages/sitemap.xml.js` | 公开路由与 SEO 产出；改动会波及线上文章 URL 与 sitemap |
| `pages/dashboard/[[...index]].js`、`pages/sign-in/**`、`pages/sign-up/**`、`pages/auth/**`、`components/ui/dashboard/**` | Clerk 会员体系，与后台无关；动它会破坏现有登录/会员流程 |
| `lib/db/**`、`lib/cache/**`、`lib/rank/storage.js`、`lib/notify/storage.js` | 数据层被全站复用；后台应"调用"而不是"修改" |
| `lib/global.js`、`pages/_document.js` | 全局上下文与文档外壳；`_document` 的改动会影响全站字体预加载/暗色模式 |
| `blog.config.js`、`conf/*.config.js`（除新增独立配置文件） | 全站配置入口（`blog.config.js:34-54` 展开 conf）；后台配置应自建 `conf/admin.config.js` 并由 `_app`/后台自身引用，**不要往 `blog.config.js` 里塞** |
| `vercel.json`、`netlify.toml`、`Dockerfile`、`.github/workflows/ci.yml`、`next-sitemap.config.js` | 部署与 CI 契约；Phase 0 明令禁止修改 |
| `cloudflare/notion-image-proxy/**` | 独立 Worker，与本任务无关 |

---

## 10. 未确认项（只能在 Vercel / Cloudflare / Notion 控制台或运行时确认）

1. **Clerk 是否在生产启用**：分支取决于 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`（`middleware.ts:66`）。仓库内 `.env.local` **只有 1 个变量（`NOTION_PAGE_ID`）**，无 Clerk 键 → 本地必为 `noAuthMiddleware`；Vercel 上是否配置**无法从仓库判断**。→ 必须在 Vercel 项目 → Settings → Environment Variables 确认（只看键名）。
2. **Vercel 项目级设置是否覆盖 `vercel.json`**：`cleanUrls`/`trailingSlash` 在 Next 框架预设下的实际生效情况、是否在面板里另有 Redirect/Header 规则（`vercel.json:5` 的 `headers: []` 是空的）、是否开启 Vercel Web Analytics / Speed Insights 注入。仓库内不可见。
3. **Functions 的 region / maxDuration / 内存上限**：仓库未声明（全 `pages/api` 无 `export const config`）→ 取决于 Vercel 计划与项目设置。后台若要聚合 Notion 数据，需按实际上限设计分页与缓存。
4. **Cloudflare 是否作为站点前置代理**（橙色云）而非仅图片 Worker：若 `blog.20240606.xyz` 走了 Cloudflare 代理，则 Cloudflare 的 Page Rules/Cache Rules **可能缓存 `/admin/*` 的 HTML**，这层缓存我们完全不可见，需要在 Cloudflare 面板确认并显式 Bypass `/admin*`。
5. **Notion 站点是否已有 slug 为 `admin` / `dashboard` 的页面**：会影响 sitemap 与历史 URL（`pages/sitemap.xml.js:18-48` 由 Notion `allPages` 生成），需在 Notion 侧查。
6. **`public/redirect.json` 在生产是否存在**：本地不存在；若生产存在且含 `admin` 类键，`UUID_REDIRECT` 一旦开启会重定向后台路径（`middleware.ts:38-59`）。
7. **`docs/` 下是否已有 admin 相关规划文档**：按本次约束未读取 `docs/`，若存在旧方案可能与本文档冲突，建议 Phase 1 开始前由人工比对一次。
8. **Twikoo 后端的实际部署位置**（腾讯云 envId 还是 Vercel 域名，`conf/comment.config.js:23`）：决定 `/admin/comments` 是"服务端拉 Twikoo API"还是"仅前端嵌入"；同时 Twikoo 管理端口令体系与我们的后台鉴权是两套，需要确认是否要单点登录。
9. **`ENABLE_CACHE` / `REDIS_URL` 在生产是否配置**（`conf/dev.config.js:12-19`）：决定后台聚合数据能否持久化（Vercel 上文件缓存与 `/tmp` 都不可靠，`lib/rank/storage.js:31-36`）。
10. **上游 fork 同步策略**：`.github/workflows/sync.yaml` 会从 `tangly1024/NotionNext` 同步到 `main`。若后台代码放在 `pages/`、`components/`、`lib/` 等上游同名路径，未来同步可能产生冲突或覆盖。→ 建议：后台代码尽量集中在**上游不存在的新目录**（`lib/admin/`、`components/admin/`、`pages/admin/`），并减少对 `_app.js`/`middleware.ts` 的改动体积；同步前先跑 `git diff` 人工复核。
