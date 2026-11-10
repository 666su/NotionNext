# SECURITY.md — Jason Blog Admin 安全审计（Phase 0 / 只读）

| 项 | 值 |
| --- | --- |
| 仓库 | `D:\save_files\aDrive\DeepSeek Harness\NotionNext`（NotionNext 4.10.8 定制 fork） |
| 基线 | `main` @ `7c734e7`，remote `github.com/666su/NotionNext` |
| 线上站点 | `https://blog.20240606.xyz`（**本次审计未对线上发起任何请求**） |
| 审计范围 | 鉴权能力、准管理员接口、密钥暴露面、密码学依赖、Session/CSRF/限流、日志隐私、响应头 |
| 方法 | 静态代码阅读 + `grep`/`glob` + 本地 `node` 正则语义验证（不启动服务、不登录、不装依赖、不改生产代码） |
| 排除 | `node_modules/`、`.next/`、`docs/`（既有文档）、`public/`、`legacy` |
| 密钥处理 | 全文不含任何密钥/令牌/哈希值；凡涉及具体值一律 `****`；`.env.local` 只列变量名 |

> **本文件是只读审计结论，不包含任何修复动作。** 所有 "修复建议" 均为 Phase 1 待批准事项。

---

## 0. TL;DR 风险表

严重度定义：**Critical** = 可直接导致管理面失守/凭据泄漏；**High** = 未授权写入、SSRF、凭据可读、可被远程滥用；**Medium** = 违反安全基线、放大其他攻击、隐私风险；**Low** = 加固项/卫生问题。

| ID | 严重度 | 结论（一句话） | 关键证据 | 本项目范围 | Phase 1 处理 |
| --- | --- | --- | --- | --- | --- |
| F-01 | **Critical**（条件触发） | 排行榜管理令牌 `RANK_SEED_SECRET` 经 `siteConfig()` 读取，会优先命中写入 Notion 配置表的同名键；而 `NOTION_CONFIG` 会被序列化进每个页面的 `__NEXT_DATA__` → 按"最自然方式"配置即等于把管理令牌公开发布 | `lib/rank/index.js:392-398`、`lib/config.js:72-79`、`lib/db/SiteDataApi.js:722`、`pages/_app.js:48,89` | 是（现有代码缺陷） | 是，**P1 必修** |
| F-02 | **High**（条件触发） | Notion OAuth 链路把 `clientId:clientSecret` 与完整 token 响应打进 `console.log`，并把含 `access_token` 的 JSON 塞进 302 跳转的 `?msg=` 查询串 | `pages/auth/index.js:66,75-77,94`、`pages/api/auth/callback/notion.ts:60-67,108`、`pages/auth/result.js:28` | 是 | 是（先隔离：关闭/删除该链路或脱敏） |
| F-03 | **High** | `POST /api/push/test` 零鉴权，可让服务器向**任意 URL** 发起 POST（SSRF），并在无密钥时自动生成并持久化 VAPID 密钥 | `pages/api/push/test.js:11-63`、`lib/notify/webpush.js:220-246`、`lib/notify/storage.js` | 是 | 是（加鉴权 + endpoint 白名单） |
| F-04 | **High** | `POST /api/cache` **fail-open**：`CACHE_REVALIDATION_TOKEN` 未配置时完全不校验，任何访客都能清空缓存 | `pages/api/cache.js:13-16` | 是 | 是（改为 fail-closed） |
| F-05 | **High** | `GET /api/push/subscriptions?subscriberId=...` 零鉴权返回该订阅者的完整 `config`（Telegram bot token / Server 酱 SendKey / WebPush endpoint+keys） | `pages/api/push/subscriptions.js:12-17`、`lib/notify/storage.js:1-12,158-160` | 是 | 是（改为"凭 subscriberId 自证的写操作"或加管理鉴权） |
| F-06 | **High** | `/admin/notify-status` 与 `/api/push/status` 公开可读，渲染 Redis 配置态、连接错误原文、订阅总数、VAPID 是否存在；`redisError` 可能回显 `REDIS_URL`（含口令） | `pages/admin/notify-status.js:61-107,89`、`pages/api/push/status.js:9-55` | 是 | 是（删除或纳入管理鉴权） |
| F-07 | **High**（架构性） | 现有鉴权是 **fail-open** 结构：`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 缺失即整体降级为"无鉴权"；且管理员路由匹配器只覆盖两个子路径，`/admin/notify-status` 从来没被保护过 | `middleware.ts:66-92,24-27` | 是 | 是（新 /admin 必须 fail-closed） |
| F-08 | **Medium** | 全站响应头 `Access-Control-Allow-Origin: *` + `Allow-Credentials: true`（矛盾组合），且 CSP / X-Frame-Options / HSTS 全部被注释掉；`vercel.json` 的 `headers` 为空数组 | `next.config.js:337-387`、`vercel.json:5`、`lib/middleware/security.js:254-271`（死代码） | 是 | 是（至少给 /admin 加） |
| F-09 | **Medium** | 评论接口把**明文邮箱**、**明文 IP**、User-Agent 写进 Notion 数据库；同时另存一份**无盐 SHA-256** 邮箱哈希（可枚举反查） | `pages/api/notion-comments.js:143,145-147,153-157,164-169,54-55` | 是 | 是（隐私边界，见 §6） |
| F-10 | **Medium** | 排行榜访客标识 = `sha256(ip|ua|scope)` 无盐截断 32 hex，且点赞去重 TTL 设为 100 年；rank 的写接口（view/like）无任何限流，计数可被刷 | `lib/rank/index.js:105-108,125-135`、`lib/rank/storage.js:27-29,424-427`、`pages/api/rank/view.js:11-36`、`pages/api/rank/like.js:16-45` | 是 | 可延后（P2），但新 /admin 统计复用时必须先修 |
| F-11 | **Medium** | 完全不存在的安全基础设施：**零 cookie、零 session、零 CSRF token、零可用限流**；`lib/middleware/security.js` 整套中间件是死代码；`lib/config/env-validation.js` 从未被执行 | 见 §5 全部证据 | 是（需新建） | 是（Phase 1 直接新建，不复用） |
| F-12 | **Low** | 令牌比较均用 `!==`（非常量时间），理论上可时序侧信道 | `pages/api/revalidate.js:41`、`pages/api/push/send.js:21`、`lib/rank/index.js:397`、`pages/api/claude/contribution-refresh.js:36` | 是 | 否（随手改） |
| F-13 | **Low** | `images.dangerouslyAllowSVG: true` + `remotePatterns` 允许 `http|https / **`，等于同源代理任意站点的 SVG | `next.config.js:233-249` | 是 | 否（有 `images.contentSecurityPolicy` 缓解） |
| F-14 | **Low** | `microformats`：`.dsh-ops/` 未进 `.gitignore`（内含 agent 会话日志 `panel/*.ndjson`、Notion 读取脚本），有误提交风险；`env-validation.js` 的"敏感信息泄露检查"因此永远不跑 | `.gitignore`（无 `.dsh-ops` 条目）、`git check-ignore` 结果为 NOT IGNORED、`lib/config/env-validation.js:178-193` | 是 | 是（一行 gitignore） |
| F-15 | **Low** | `middleware.ts:12` 注释声称排除 `/sign-in`、`/auth`，本地正则验证显示这两个排除项**实际不生效**（只有"含点号"的排除生效） | `middleware.ts:12`（附 §1.1 验证） | 是 | 否（记录，避免后续误依赖） |

**一句话结论：** 现有仓库没有可复用的管理员鉴权，且已存在 3 个未授权可写/可读的接口族（push、cache、rank）；新增 `/admin` 必须**从零建 fail-closed 的鉴权层**，并把现有弱模式列为"禁止复用清单"。

---

## 1. 现有鉴权能力：能否复用 Clerk 做管理员认证

### 1.1 `middleware.ts` 的真实行为（含本地正则验证）

关键结构：

```
middleware.ts:10-13   export const config = { matcher: ['/((?!.*\..*|_next|/sign-in|/auth).*)', '/', '/(api|trpc)(.*)'] }
middleware.ts:16-21   isTenantRoute      → /user/organization-selector, /user/orgid/*, /dashboard, /dashboard/*
middleware.ts:24-27   isTenantAdminRoute → /admin/(.*)/memberships, /admin/(.*)/domain
middleware.ts:36-62   noAuthMiddleware   → 仅在 BLOG.UUID_REDIRECT 为真时做 redirect.json 跳转，其余直接 NextResponse.next()
middleware.ts:66-92   authMiddleware = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? clerkMiddleware(...) : noAuthMiddleware
```

三点要读清楚：

1. **开关是"环境变量存在与否"**（`:66`）。未配置 Clerk Key（`.env.local` 现状即未配置）→ 导出的是 `noAuthMiddleware`，它**不做任何鉴权**，只处理 `UUID_REDIRECT`（默认 false，`blog.config.js:87`）。
2. **`/admin` 的保护范围极窄**（`:24-27`）：只匹配 `/admin/*/memberships` 与 `/admin/*/domain`。也就是说**现存 `pages/admin/notify-status.js` 从设计上就不在任何鉴权分支内**（见 §2.4）。
3. **matcher 的排除项与注释不符**。我用本地 `node` 以 `^<matcher>/?$` 复现（未启动 Next）：

   ```
   /admin                true
   /admin/notify-status  true
   /api/push/status      true
   /sign-in              true     ← 注释说要排除，实际匹配
   /auth/result          true     ← 同上
   /images/a.png         false    ← 只有"含点号"的排除生效
   ```

   即 `middleware` 会在这两个路径上执行（今天无害：`noAuthMiddleware` 直接放行）。**风险在于**：若 Phase 1 把鉴权判断写进 middleware，`/admin/login`、`/admin/auth/*` 这类"必须放行"的路径如果照抄这条注释去排除，**会不生效并把登录页自己锁死**。→ 结论：**新 /admin 的门禁不要依赖这条 matcher 的排除语义**，改用 `matcher: ['/admin/:path*', '/api/admin/:path*']` 这样的显式白名单，放行判断写在函数体内。

> 验证方法说明：`/((?!…).*)` 由 Next 用 `path-to-regexp` 编译，我未在此环境中运行 dev server（约束禁止），因此以上是 **regex 语义级**结论，属于强指示而非线上实测。Phase 1 落地前建议用一次本地 `next dev` 复核。

### 1.2 `@clerk/nextjs` 全量引用点

| 文件:行 | 用法 | 是否进入客户端 bundle |
| --- | --- | --- |
| `middleware.ts:1` | `clerkMiddleware`, `createRouteMatcher` | 否（Edge） |
| `pages/api/user.ts:1,12` | `getAuth(req)` | 否 |
| `pages/_app.js:23,25-28` | `zhCN`（静态导入）+ `ClerkProvider`（`dynamic` 导入） | **是**（`@clerk/localizations` 静态进包） |
| `components/ui/dashboard/DashboardSignOutButton.js:1` | `SignOutButton` | 是 |
| `components/ui/dashboard/DashboardUser.js:1` | `UserProfile` | 是 |
| `lib/global.js:8` | `useUser` | 是 |
| `themes/gitbook/{components/Header.js:5,index.js:16}` | `SignInButton/SignedOut/UserButton/SignIn/SignUp` | 是 |
| `themes/magzine/{components/Header.js:6,index.js:14}` | 同上 | 是 |
| `themes/proxio/{components/Header.js:5,index.js:33}` | 同上 | 是 |
| `themes/starter/{components/Header.js:5,index.js:33}` | 同上 | 是 |

### 1.3 相关页面与 API 现状

| 入口 | 现状 | 证据 |
| --- | --- | --- |
| `/sign-in` | 纯静态壳：`getStaticProps` 取 Notion 数据 → `DynamicLayout layoutName='LayoutSignIn'`，**页面自身无任何鉴权逻辑**；真正拦截发生在 middleware | `pages/sign-in/[[...index]].js:12-48` |
| `/sign-up` | 同构（catch-all，同样走 `LayoutSignUp`） | `pages/sign-up/`（与 sign-in 同构） |
| `/dashboard` | 同上，`LayoutDashboard`；保护仍只靠 middleware 的 `isTenantRoute` | `pages/dashboard/[[...index]].js:13-39` |
| `/api/user.ts` | 唯一"标准"受保护 API：`getAuth(req)` 取不到 `userId` 就 401 —— **但它的鉴权完全来自 Clerk**，Clerk 未配置时 `getAuth` 恒返回空 → 永远 401（fail-closed，这点是对的） | `pages/api/user.ts:10-23` |
| `/api/auth/callback/notion.ts` | Notion OAuth 回调：把 `clientId:clientSecret` 的 base64 用作 Basic 认证（正确做法），**但** 结果被拼进 `msg=` 重定向 + `console.log` 完整响应 | `:87-90,60-67,108` |
| `/auth`、`/auth/result` | 旧版 OAuth 展示页；`/auth` 在 `getServerSideProps` 里打印 `clientId:clientSecret` | `pages/auth/index.js:66,75-77,94`；`pages/auth/result.js:28` |

### 1.4 结论：**不能复用 Clerk 做管理员认证**

理由（按重要性排序）：

1. **凭据主权与可用性不符需求。** 需求是"独立管理员账号密码"。Clerk 是托管 IdP：账号、密码、登录会话都在 Clerk 云端。用它等于把管理员登录的可用性绑定到第三方（Clerk 故障、配额、区域网络问题 → 后台不可登录），且"独立账号密码"实际变成"Clerk 托管的 email+password 策略"，与"不依赖第三方登录"直接冲突。
2. **现有 Clerk 集成是 fail-open 架构，不适合承载最高权限面。** `middleware.ts:66` 用"环境变量是否存在"决定是否鉴权。这意味着：Key 被误删、部署到未配 Key 的环境、或本地/预览环境 → **所有"受保护"路由瞬间变公开**。把唯一管理员门禁建立在这种开关上是不可接受的设计。
3. **覆盖面不足以保护 `/admin`。** `isTenantAdminRoute`（`:24-27`）只覆盖两个子路径；`/admin`、`/admin/notify-status`、以及将来 `/admin/overview` 等**一律不受保护**。要用 Clerk 就得改 matcher，而 matcher 的排除语义本身有坑（§1.1）。
4. **权限模型错位。** 现有"管理员"判断是 organization permission（`:81-86` 的 `org:sys_memberships:manage` / `org:sys_domains_manage`），这是**团队/组织多租户模型**，不是"单管理员 + 审计日志"。
5. **审计与合规不可控。** 需求包含审计日志（谁、何时、从哪、做了什么）。Clerk 的登录事件在第三方侧，导出/留存策略不由我们决定；我们要的是**自己的 append-only 审计表**。
6. **对现有博客是可见回归风险。** `@clerk/localizations` 已静态进入 `_app.js:23`，`ClerkProvider` 也在 `_app.js:26-28`；多个主题 Header 引了 `SignInButton`。继续加深 Clerk 依赖会把后台登录 UI/Provider 压进公开 bundle，与"不得影响现有博客"目标相反。

**替代方案与各自风险：**

| 方案 | 说明 | 风险 | 判定 |
| --- | --- | --- | --- |
| **A. 自建：Argon2id/scrypt + 服务端 Session + CSRF + 限流**（推荐） | `/admin/login` → 校验 `ADMIN_PASSWORD_HASH` → 生成 opaque session id 存 Redis → `HttpOnly; Secure; SameSite=Lax` cookie；写操作双提交 CSRF | 自研容易漏（cookie 属性、CSRF、session 固定、时序比较）；必须按 §8.1 清单逐条验收 | **主选** |
| B. HTTP Basic（`ADMIN_USER` + `ADMIN_PASSWORD_HASH`） | 最省代码 | 无登出/无会话、浏览器自动附加凭据 → 跨站表单型 CSRF 仍可打；无审计粒度；代理/Vercel 日志可能记录 `Authorization` | 仅作内网应急 |
| C. 复用现有静态 token（`REVALIDATION_TOKEN`/`RANK_SEED_SECRET` 模式） | 与现有"准管理员"接口一致 | **共享口令**：无法审计到人、无法单独吊销、一旦泄漏全失守；且 `siteConfig()` 通道会把令牌漏到客户端（F-01） | **禁止** |
| D. 平台层保护（Vercel Deployment/Password Protection） | 零代码 | 需付费档；粒度为"整站/preview"，不能只护 `/admin`；无应用级审计 | 可作纵深第二层 |
| E. Cloudflare Access（Zero Trust）前置 `/admin` | 强身份 + 边缘拦截 | 依赖域名确实走 CF 代理（**待确认**）；需外部 IdP；不能替代应用层 session/CSRF/审计 | 可作纵深第二层 |

---

## 2. 现存"准管理员"接口暴露面（本审计重点）

### 2.1 全量端点清单与鉴权状况

| 端点 | 方法 | 鉴权实现 | 结论 | 证据 |
| --- | --- | --- | --- | --- |
| `/api/rank/seed` | POST | `verifySecret(body.secret \|\| x-rank-secret)`；未配置密钥时 `return false`（**fail-closed**） | 实现形态正确，但**密钥来源有泄漏通道**（F-01） | `pages/api/rank/seed.js:26-37`；`lib/rank/index.js:392-398` |
| `/api/rank/status` | GET | 无鉴权 | 泄露 `seedSecretConfigured`、`redisConfigured`、存储后端、计数规模 | `pages/api/rank/status.js:19-45` |
| `/api/rank/view`、`/api/rank/like`、`/api/rank/top`、`/api/rank/info` | POST/GET | 无鉴权、**无限流**（业务上是公开互动接口） | 计数可被刷；写入无节流 | `pages/api/rank/view.js:11-36`、`like.js:16-45` |
| `/api/revalidate` | POST | `Bearer <REVALIDATION_TOKEN>` 或 `body.token`；未配置时 503（**fail-closed**） | 形态正确；比较用 `!==`（F-12）；`error.message` 回显 | `pages/api/revalidate.js:20-45` |
| `/api/cache` | POST | `if (token && auth !== Bearer token) 401` → **token 未配置时直接放行** | **fail-open（F-04）** | `pages/api/cache.js:9-16` |
| `/api/push/test` | POST | **完全无鉴权** | **SSRF + 可用作外发放大器（F-03）** | `pages/api/push/test.js:11-63` |
| `/api/push/subscriptions` | GET | 无鉴权，仅要求 `subscriberId` | **返回订阅凭据（F-05）** | `pages/api/push/subscriptions.js:12-17` |
| `/api/push/subscribe` | POST/DELETE | 无鉴权 | 任意写入/删除订阅记录（数据污染、配额消耗） | `pages/api/push/subscribe.js:9-26` |
| `/api/push/vapid-public-key` | GET | 无鉴权 | 首次访问即**自动生成并持久化** VAPID 密钥（未授权写） | `pages/api/push/vapid-public-key.js:14-33` |
| `/api/push/status` | GET | 无鉴权 | 同 F-06：Redis 状态/错误原文/订阅数/VAPID 存在性 | `pages/api/push/status.js:9-55` |
| `/api/push/send` | POST | `NOTIFY_SECRET \|\| REVALIDATION_TOKEN`，未配置 503（**fail-closed**） | 形态正确 | `pages/api/push/send.js:14-23` |
| `/api/claude/contribution-refresh` | GET/POST | `CLAUDE_CONTRIBUTION_TRIGGER_TOKEN`，未配置 503（**fail-closed**） | 形态正确；**令牌可从 query 传**（`:3-12`）→ 会落进访问日志/Referer | `pages/api/claude/contribution-refresh.js:3-38` |
| `/api/blog-pet/posts` | GET | 无鉴权（**设计如此**：公开文章索引） | 可接受：仅返回已发布文章的标题/摘要/封面 | `pages/api/blog-pet/posts.js:37-63` |
| `/api/subscribe` | POST | 无鉴权、无限流 | 匿名触发服务端向 Mailchimp 写入邮箱（邮件列表污染/配额） | `pages/api/subscribe.js:8-21` |
| `/api/notion-comments` | GET/POST | POST 有"内存 IP 限流 5/min + 内容校验"，**无 CSRF、无验证码** | 公开写入口（业务如此），但落盘 PII（F-09）；内存 Map 无上限 | `pages/api/notion-comments.js:25-44,117-131,143-169` |
| `/api/rss` | GET | 无鉴权（公开 feed） | 可接受 | `pages/api/rss.js:96` |
| `/api/user` | GET | Clerk `getAuth` | fail-closed，但依赖第三方 | `pages/api/user.ts:10-23` |

### 2.2 逐个分析（重点 4 个）

#### (A) `POST /api/rank/seed` — 令牌来源是真正的漏洞点（Critical，条件触发）

```js
// lib/rank/index.js:392-398
export function verifySecret(token) {
  const expected =
    (siteConfig('RANK_SEED_SECRET', '') || '').trim() ||
    (siteConfig('REVALIDATION_TOKEN', '') || '').trim()
  if (!expected) return false
  return String(token || '').trim() === expected
}
```

`siteConfig()` 的取值顺序是：**Notion 配置表 `NOTION_CONFIG` → extendConfig → `blog.config.js` → default**（`lib/config.js:66-79,111-119`）。注意它**不读 `process.env`**（少数 key 例外，见 `lib/config.js:24-62`）——所以 `RANK_SEED_SECRET` 想生效，只有两条路：

1. 放到 `blog.config.js`（当前没有，`blog.config.js` 全文无此键）；
2. **放到 Notion 的 Config 页面里一个名为 `RANK_SEED_SECRET` 的键**（这是 NotionNext 的常规做法，也是这里最"自然"的做法）。

而 `NOTION_CONFIG` 会被原样放进每页 props：

```js
// lib/db/SiteDataApi.js:721-723
return { NOTION_CONFIG, notice, siteInfo, allPages, ... }
```

→ 进入 `pages/_app.js:48`（`pageProps?.NOTION_CONFIG?.THEME`）与 `:89`（`<GlobalContextProvider {...pageProps}>`），最终出现在**每个页面的 `__NEXT_DATA__` 与全局 Context** 中。

**后果链**：管理员按提示把 `RANK_SEED_SECRET` 填进 Notion 配置表 → 该值随任意一次页面访问以明文出现在 HTML 里 → 任何人都能 `POST /api/rank/seed` 执行 `action=reset`（清空全站阅读/点赞计数）或 `action=import, mode=set`（任意改写计数）。

同一通道还有一个**已存在的、明确的"客户端可见秘密"**（可直接对照）：

```js
// conf/comment.config.js:66-69
COMMENT_GITALK_CLIENT_ID:     process.env.NEXT_PUBLIC_COMMENT_GITALK_CLIENT_ID || '',
COMMENT_GITALK_CLIENT_SECRET: process.env.NEXT_PUBLIC_COMMENT_GITALK_CLIENT_SECRET || '',
```

`NEXT_PUBLIC_` 前缀 = 编译期内联进客户端 bundle（`.env.example:139` 就是让用户填这个）。Gitalk 的 `client_secret` 放前端是历史设计缺陷，**当前是否配置未知**（`.env.local` 未包含），一旦配置即等价于公开该 OAuth 应用凭据。

#### (B) `POST /api/push/test` — 零鉴权 SSRF（High，无条件）

```js
// pages/api/push/test.js:42-60
if (channel === 'webpush') {
  const { endpoint, keys } = config            // ← 全部来自请求 body
  ...
  if (envPk && envSk) keys2 = { publicKey: envPk, privateKey: envSk }
  else if (!keys2) { keys2 = generateVapidKeys(); await setVapidKeys(keys2) }  // ← 未授权写存储
  await sendWebPushTo({ endpoint, keys }, {...}, keys2, process.env.VAPID_SUBJECT)
}
```

```js
// lib/notify/webpush.js:236-246
const res = await fetch(endpoint, { method: 'POST', headers: {...}, body })
```

`endpoint` 完全由调用者提供且**没有任何 origin 白名单/内网地址过滤** → 服务端会向任意 URL 发起带自定义头与二进制 body 的 POST。失败时错误信息里带 `res.status`：`_push 发送失败: ${res.status} ${res.statusText}`（`:252`），而 `pages/api/push/test.js:66` 又把 `e.message` 回给调用方 → **带状态码的盲 SSRF**（可作为端口/路径探测器）。

同时 `channel: 'telegram' | 'serverchan'` 分支会把请求体里的 `token/sendKey` 拼进固定外网地址（`lib/notify/channels.js:4-5,22,40`），不算 SSRF，但可被当作**匿名外发请求中转**使用。

#### (C) `POST /api/cache` — fail-open（High，条件触发）

```js
// pages/api/cache.js:13-16
const token = process.env.CACHE_REVALIDATION_TOKEN
if (token && req.headers.authorization !== `Bearer ${token}`) {   // ← token 为空时整段跳过
  return res.status(401).json({ status: 'error', message: 'Unauthorized' })
}
cleanCache()
```

对比同仓库 `pages/api/revalidate.js:29-34`、`push/send.js:17-19`、`claude/contribution-refresh.js:28-33` 都是"未配置 → 503 fail-closed"。**只有 cache.js 是 fail-open**，属于典型的复制粘贴漏判。后果：匿名者可反复清缓存 → 每次访问都回源 Notion → 延迟与配额成本上升（也可用于放大既有慢查询）。

#### (D) `GET /api/push/subscriptions` — 零鉴权读取订阅凭据（High）

```js
// pages/api/push/subscriptions.js:12-17
const { subscriberId } = req.query
const subs = await getSubscriptionsByUser(subscriberId)
return res.status(200).json({ subscriptions: subs })
```

`subscriberId` 是**客户端 localStorage 生成的随机 UUID**（`lib/notify/storage.js:7`），返回的 `subs[]` 里 `config` 是明文：

```
telegram   → { token: '<bot token>', chatId }
serverchan → { sendKey }
webpush    → { endpoint, keys: { p256dh, auth } }
```

利用前提是拿到某人的 `subscriberId`（UUID 难枚举）→ 定级 High 而非 Critical；但**接口零鉴权、无速率限制、返回完整凭据**是明确的设计缺陷，且与 F-03 组合时（`/api/push/subscribe` 可匿名写入）会污染 `notify:data` 单一 Redis 大 key。

### 2.3 `/admin/notify-status` 与 `/api/push/status`：无需登录的信息泄露

```js
// pages/admin/notify-status.js:61  —— 无任何鉴权判断
export async function getServerSideProps() {
```

页面把以下内容**直接渲染给任何访客**（`:26-38`）：

| 渲染项 | 行号 | 敏感度 |
| --- | --- | --- |
| 存储后端（`file`/`redis`） | `:30` | 低 |
| Redis 是否配置 | `:31` | 低 |
| Redis 是否连通 | `:32` | 低 |
| **Redis 错误原文** | `:33,89` | **中→高**：`e.message` 可能包含主机名；该文件 `:74` 自己注释了"避免 ERR_INVALID_URL"，说明错误文本**会带出连接的 URL**，而 `REDIS_URL` 的形态是 `rediss://default:<password>@host:port` |
| 订阅总数 | `:34,99` | 低 |
| VAPID 密钥是否存在 | `:35,100` | 低 |
| 是否 Vercel / 是否构建中 | `:36,62,70` | 低 |

`/api/push/status`（`:9-55`）是同一份数据的 JSON 版，**且不跳过构建期**，任何人 `GET` 都能拿到 `redisError`、`readError` 原文。

> 结论：这条信息泄露本身不致命，但它是**攻击者侦察的第一站**（确认后端是 Redis 还是文件、是否有订阅者、是否在 Vercel），并且**错误原文可能直接泄漏 Redis 口令**。定性：High（因为存在凭据回显的可能性）。

### 2.4 新增 `/admin` 时如何避免复用这些弱模式（硬性禁止清单）

| # | 禁止 | 反面教材 | 正确做法 |
| --- | --- | --- | --- |
| 1 | **禁止 fail-open**：任何"未配置就跳过校验"的分支 | `pages/api/cache.js:14` | 未配置 `SESSION_SECRET`/`ADMIN_PASSWORD_HASH` → **503 拒绝服务**，并让 `/admin` 显示"未配置"，绝不放行 |
| 2 | **禁止把管理密钥放进 `siteConfig()`/Notion 配置表** | `lib/rank/index.js:393-395` + F-01 | 只从 `process.env.ADMIN_*` 读；`lib/admin/*` 顶部加运行时守卫（`typeof window !== 'undefined' && throw`）+ CI 断言 `ADMIN_*` 不出现在 `.next/static` |
| 3 | **禁止共享口令/静态 token 当管理员凭据** | `REVALIDATION_TOKEN`、`RANK_SEED_SECRET` | 独立账号 + Argon2id 哈希 + 服务端 session；token 只用于机器对机器 |
| 4 | **禁止把 token 从 query 读** | `claude/contribution-refresh.js:3-12` | 只在 `Authorization` 头或 cookie 中传输；日志脱敏 |
| 5 | **禁止无鉴权的"诊断/状态"页** | `pages/admin/notify-status.js:61`、`api/push/status.js` | 状态页挂在 `/admin/system` 之后；对外只暴露 `{"ok":true}` |
| 6 | **禁止在响应里回显 `e.message`** | `api/*` 多处（`push/test.js:66`、`notify-status.js:89`） | 固定文案 + 服务端日志记录内部错误 id |
| 7 | **禁止把"动作"接口暴露成 GET** | `rank/info?record=1`、`push/vapid-public-key` | 有副作用一律 POST + CSRF token |
| 8 | **禁止依赖注释里的 matcher 排除语义** | `middleware.ts:12`（§1.1） | 显式 matcher + 函数体内白名单判断 |
| 9 | 每个管理端点必须：鉴权 → CSRF → 限流 → 审计 → 业务 | — | 见 §8.1 |

---

## 3. 密钥与配置暴露面

### 3.1 服务端变量 vs `NEXT_PUBLIC_` 变量（真实暴露面）

全仓库 `process.env.*` 引用共 **359 个唯一键**（`grep` 统计，排除 `node_modules`/`.next`/`docs`/`public`/`themes`）。

- **会进客户端 bundle 的**：所有 `NEXT_PUBLIC_*`（`blog.config.js` 与 `conf/*.config.js` 中被静态引用的那些）。`next.config.js` 的 `publicRuntimeConfig` 只暴露 `THEMES`（`:459-462`），没有别的运行期注入。
- **不会进客户端的**（Next 在 client bundle 中替换为 `undefined`）：`REVALIDATION_TOKEN`、`REDIS_URL`、`NOTION_TOKEN`、`MAILCHIMP_API_KEY`、`ALGOLIA_ADMIN_APP_KEY`、`SUPABASE_SECRET_KEY/SERVICE_ROLE_KEY`、`VAPID_PRIVATE_KEY`、`CLAUDE_CONTRIBUTION_TRIGGER_TOKEN`、`OAUTH_CLIENT_SECRET`、`DEEPSEEK_API_KEY`、`GLM_API_KEY`、`BING_API_KEY`、`BAIDU_TOKEN` 等。

> ⚠️ 唯一但重要的例外：**`blog.config.js` 是"客户端也会 import 的模块"**（`pages/_app.js:19`、各主题组件都 `import BLOG from '@/blog.config'`）。它在 `:16` 把 `REVALIDATION_TOKEN` 放进了 `BLOG` 对象：
>
> ```js
> // blog.config.js:16
> REVALIDATION_TOKEN: process.env.REVALIDATION_TOKEN || '',
> ```
>
> 目前**不会泄漏值**（`process.env.REVALIDATION_TOKEN` 在 client 侧被替换为 `undefined`），但这是一条**只差一步的泄漏通道**：一旦有人把它改成 `NEXT_PUBLIC_REVALIDATION_TOKEN`，或在 `next.config.js` 里加 `env: { ... }`，或把这个文件当"配置单一出口"继续堆服务端变量，机密就会直接进入公开 JS。→ **新 /admin 的 `ADMIN_*` 绝不写入 `blog.config.js`。**

### 3.2 `.env.local` 与 `.gitignore` 现状

`.env.local` 只含 **2 个条目、1 个有效**（**值一律不输出**）：

| 变量名 | 状态 |
| --- | --- |
| `NOTION_PAGE_ID` | 已设置（值 `****`） |
| `NEXT_PUBLIC_LINK` | 被注释掉（`#`） |

`.gitignore` 覆盖情况（`:31-36`）：

```
.env.local
.env.docs.local
.env.development.local
.env.test.local
.env.production.local
.env
```

验证结果：

- `git ls-files | grep -iE '^\.env'` → 仅 `.env.docs.example`、`.env.example`（都是"只有变量名 + 注释"的模板，无值）。
- `git check-ignore -v .env.local` → 命中 `.gitignore:33`。
- `git log --all -- .env.local` → **无历史**（从未被提交）。
- ✅ 结论：`.env*` 忽略规则基本完整。**唯一缺口**：`.env.*.local` 的通用写法未覆盖（例如有人建 `.env.staging.local` 会被漏掉），建议补一条 `.env.*.local`。
- ⚠️ `.dsh-ops/`（未跟踪、**未被忽略**）包含 `panel/*.ndjson`（agent 会话完整转录）与 `notion-*.json`（站点数据快照）→ F-14，建议加进 `.gitignore`。

### 3.3 硬编码密钥排查结果

执行了三类模式（排除 `node_modules`/`.next`/`.git`/`docs`/`.vitepress`）：

| 模式 | 结果 |
| --- | --- |
| `(secret\|password\|apikey\|api_key\|access_token\|private_key\|token)\s*[:=]\s*['"][A-Za-z0-9_\-.]{12,}['"]` | **0 命中** |
| `sk-…` / `pk_(test\|live)_…` / `ghp_…` / `AKIA…` / `ntn_…` / `secret_…` | **0 命中** |
| `.dsh-ops/`、`scripts/`、`pushUrl.py` 内的 token 关键字 | 仅命中 `notion-menu-backup.json` 里的**字段名** `"password"`（Notion 页面属性名，非值）与 agent 会话日志文本；**无实际凭据** |

✅ **仓库源码中没有硬编码的密钥/令牌。** 所有真实凭据都应来自 Vercel 环境变量（这符合预期）。

### 3.4 "配置 → `__NEXT_DATA__`" 的三条泄漏通道（新 /admin 必须回避）

| 通道 | 机制 | 证据 |
| --- | --- | --- |
| ① Notion 配置表 | `siteConfig()` 优先读 `NOTION_CONFIG`，而它整块进 props | `lib/config.js:72-79` → `lib/db/SiteDataApi.js:722` → `pages/_app.js:48,89` |
| ② `blog.config.js` | 客户端也会 import 这个模块 | `pages/_app.js:19`；`blog.config.js:16`（当前 inert） |
| ③ `NEXT_PUBLIC_*` 前缀 | 编译期内联 | `conf/comment.config.js:66-69`、`.env.example:139,147,156,206` |

### 3.5 接入 `ADMIN_PASSWORD_HASH` / `SESSION_SECRET` 时的改动清单（"不漏到 bundle"）

| # | 文件 | 动作 | 理由 |
| --- | --- | --- | --- |
| 1 | `lib/admin/serverEnv.js`（**新建**） | 唯一的服务端凭据读入口：`readAdminEnv()`；顶部 `if (typeof window !== 'undefined') throw new Error('server-only')`；启动即校验（缺失 → 抛错/503） | 单一收口，便于审计与 CI 守卫 |
| 2 | `blog.config.js` | **不改**（明确禁止加入 `ADMIN_*`） | 该文件进客户端（§3.1） |
| 3 | `next.config.js` | 不改 `env`；**不**往 `publicRuntimeConfig` 加任何东西；仅新增 `/admin` 的 headers（见 §7.3） | 避免把秘密注进客户端 |
| 4 | `lib/config/env-validation.js` | 修 `:121` 的 `validateEnvironmentVariables()`：目前**没有任何调用点**（grep 只命中自身），需在 `next.config.js` 构建期与 `readAdminEnv()` 里各调一次，并补 `ADMIN_*` 规则 | 让"未配置"在构建期就失败，而不是运行期 fail-open |
| 5 | `.env.example` | 追加 `ADMIN_USERNAME=`、`ADMIN_PASSWORD_HASH=`、`SESSION_SECRET=`、`ADMIN_SESSION_TTL_HOURS=`（**只写变量名/占位说明**） | 文档化，且不泄漏 |
| 6 | `.gitignore` | 追加 `.env.*.local`（已有 `.env.local`）；追加 `.dsh-ops/` | 参见 F-14 |
| 7 | `middleware.ts` | 不改现有 Clerk 分支；新 `/admin` 门禁用**独立 matcher 白名单**，只做"cookie 存在性 + 签名粗校验"（Edge 无 node crypto/ioredis），真正校验放在 API/SSR 层 | Edge 运行时限制 |
| 8 | 新增 `scripts/check-admin-secrets.js` | CI 阶段扫描 `.next/static/**/*.js`，命中 `ADMIN_`/`SESSION_SECRET` 字面量即 fail | **可验证的防泄漏门禁**（比"注意一下"可靠） |
| 9 | `vercel.json` | 若走 Vercel，`ADMIN_*` 只配在 Production/Preview（**不要**配到 Development 暴露给 fork 的 PR 构建） | fork/PR 构建会执行代码 |

---

## 4. 密码学与依赖现状

### 4.1 `lib/utils/password.js` 是什么算法

**不是**认证用的密码存储，而是**文章"加锁"功能的摘要工具**：

| 导出 | 行号 | 用途 |
| --- | --- | --- |
| `sha256Digest(str)` | `:5` | `js-sha256`，产出 64 hex，用于"文章密码摘要"比对 |
| `isSHA256Digest` | `:8-9` | 判断字段是否已是 64 hex |
| `isMd5Digest` | `:12-13` | 兼容旧版 `md5(slug+明文)` 的 32 hex |
| `getPasswordStoragePath` / `getPasswordQuery` | `:19-68` | **把密码放进 `localStorage` 与 URL query** |

调用链：`lib/db/notion/getPageProperties.js:266-271`（同步时把明文密码转成 SHA-256 摘要）→ `pages/[prefix]/index.js:48`（客户端 `sha256Digest(passInput)` 比对）。

**评估（对新增管理员的直接影响）**：

- 这是**无盐、单轮 SHA-256** + **客户端校验** + **密码存 localStorage / URL query**。作为"文章访问口令"可以接受（威胁模型是"防随手看"），但**绝不能作为管理员密码方案**复制。
- 反例要写进 Phase 1 评审：不要在 /admin 复用 `sha256Digest`；管理员必须 Argon2id/bcrypt + 服务端校验 + `timingSafeEqual`。

### 4.2 `js-md5` / `js-sha256` 的用途

| 依赖 | 用途 | 证据 |
| --- | --- | --- |
| `js-sha256` | ① 文章密码摘要（`lib/utils/password.js:1,5`）② 原创存证内容哈希（`lib/utils/originalityProof.js:1`） | 见左 |
| `js-md5` | ① 文章锁旧版摘要（`themes/nobelium/components/ArticleInfo.js:4`、`themes/plog/...`）② 文章 URL/`slug` 后缀（`pages/[prefix]/index.js:15`）③ Supabase 事件 id `e_${md5(...)}`（`lib/server/claude/contributionStore.js:1,51`） | 见左 |

**不是**"邮件打码"用途（评论里没有 md5；邮箱用的是 `node:crypto` 的 SHA-256，`pages/api/notion-comments.js:54-55`）。两者都不能用于口令哈希（MD5/SHA-256 均无工作因子）。

### 4.3 依赖盘点

| 需要的库 | package.json | node_modules | 说明 |
| --- | --- | --- | --- |
| `argon2` | ❌ 无 | ❌ 无 | — |
| `bcrypt` / `bcryptjs` | ❌ 无 | ❌ 无 | `ls -d node_modules/*bcrypt*` 为空 |
| `@node-rs/argon2` | ❌ 无 | ❌ 无 | native 预编译包 |
| `jose` | ❌ **未声明** | ✅ `5.10.0` | 是 Next.js 的**传递依赖**，直接 `import 'jose'` 属"幽灵依赖"，yarn 提升策略变化即断 |
| `iron-session` | ❌ 无 | ❌ 无 | — |
| `cookie` | ❌ **未声明** | ✅ `0.7.0` | 同上（传递依赖） |
| `next-auth` | ❌ 无 | ❌ 无 | — |
| `ioredis` | ✅ `^5.11.1`（`package.json:83`） | ✅ | 现有 Redis 客户端，可直接复用作 session/限流/审计存储 |
| `@supabase/supabase-js` | ✅ `^2.110.8`（`:74`） | ✅ | 已有一套 Supabase 写入范式（`lib/server/claude/contributionStore.js`） |
| Node 内置 | — | Node `v24.15.0`（本机）；`package.json:8` 要求 `>=22 <25` | `node:crypto` 提供 `scrypt`/`timingSafeEqual`/`randomBytes`/`createHmac` |

其它相关：`memory-cache ^0.2.0`（仅用于页面数据缓存，`lib/cache/memory_cache.js:1`）、`js-md5 ^0.9.2`、`js-sha256 ^0.11.1`。

### 4.4 Argon2id / bcrypt 在 Vercel Serverless 的可行性

| 方案 | 可行性 | 优点 | 真实风险 |
| --- | --- | --- | --- |
| **`@node-rs/argon2`**（native，Rust/NAPI 预编译） | 中 | 真 Argon2id；API 干净；自带 `hash/verify` | 需要匹配平台的预编译二进制（Vercel = Linux x64 gnu glibc）；**Windows 本地开发 / Docker(Alpine musl) / CI 需各自二进制**，缺二进制时会退回源码编译（需要 rust 工具链 → 构建失败）；`yarn.lock` / 体积增加；Serverless 冷启动首次 `require` native 模块有小成本；仓库 `engines` 锁 `>=22 <25`，预编译是否覆盖 Node 22/24 ABI 需实测 |
| **`bcryptjs`**（纯 JS） | 高 | 零构建风险、跨平台、无 ABI 问题；`cost=10~12` 在 serverless 约 60–200ms（登录场景可接受） | 纯 JS 慢（同一 cost 比 native 慢 3–5×）；只支持 bcrypt（72 字节截断）；CPU 时间计入函数时长 |
| **`hash-wasm`**（WASM Argon2id） | 高 | 真 Argon2id + 纯 WASM（无 native 编译）；Node/Edge 都可跑 | WASM 包体（~50–100KB）进 serverless bundle；需确认是否被打进 client（服务端专用则无影响）；API 略底层 |
| **`node:crypto` `scrypt`** | **最高**（零依赖） | 内置、无新依赖、无构建风险；`scryptSync(pw, salt, 64, {N:2^15,r:8,p:1})`；配 `timingSafeEqual` | 不是 Argon2id（需求写的是"Argon2id/bcrypt"）；参数需自己定；`maxmem` 要显式放宽（N=2^15 需 ~32MB，默认 `maxmem` 32MB 刚好卡线） |
| Vercel Edge Runtime | ❌ 不可 | — | 无 `node:crypto` 的 scrypt/native 模块；Edge 只能 Web Crypto（PBKDF2/HMAC）。**所以密码校验必须在 Node runtime 的 API Route，不要在 middleware 里做** |

**推荐（按优先级）：**

1. **主选：`@node-rs/argon2`（Argon2id, memoryCost 19–64MiB / timeCost 2–3 / parallelism 1）**，前提是 Phase 1 先做一次**构建可行性验证**：在 Vercel 上跑一个最小函数 `hash()` + `verify()`，确认预编译二进制与 Node 22/24 ABI 匹配、冷启动 <300ms。验证不通过就立刻切方案 2/3。
2. **备选 A：`bcryptjs`（cost ≥ 12）**——零风险、稳定，登录频率低（单管理员）时性能完全够；只是"Argon2id"这个措辞要跟管理员对齐。
3. **备选 B：`hash-wasm` 的 Argon2id**——既要 Argon2id 又不想碰 native 时的折中。
4. **零依赖兜底：`node:crypto.scrypt`**——如果"禁止安装依赖"这条在 Phase 1 仍然生效，这是唯一可立即落地的强 KDF（配 `timingSafeEqual`），但需在文档里显式记录"这是 scrypt 而非 Argon2id"的偏差。
5. **同时必须显式声明** `jose` 与 `cookie`（或自己用 `node:crypto` 做 HMAC cookie），**不要依赖它们的传递存在**（F-11 的一半）。

> 另外：无论选哪个，`ADMIN_PASSWORD_HASH` 只存**哈希**（含算法前缀，如 `$argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>`）；`SESSION_SECRET` ≥ 32 字节随机（`openssl rand -base64 48` 一类），且**与密码哈希分开**。

---

## 5. Session / CSRF / 限流基础设施现状

### 5.1 现状：基本上是"零"

| 能力 | 现状 | 证据 |
| --- | --- | --- |
| Cookie / 会话 | **全仓库没有任何 `Set-Cookie`、`res.cookies`、`req.cookies` 写入** | `grep -rn "Set-Cookie\|res.cookies\|cookies.set"` → 0 命中 |
| Session 库 | 无 `next-auth`/`iron-session`（`package.json` 无）；`jose`/`cookie` 仅传递存在 | §4.3 |
| CSRF | 无 token 生成/校验；`next.config.js:350` 虽在 `Access-Control-Allow-Headers` 里列了 `X-CSRF-Token`，但**没有任何代码读取它** | `next.config.js:348-351` |
| 限流（生产可用） | **没有一处生效**：`lib/middleware/security.js` 的 `rateLimitMiddleware`(:35-77) / `securityHeadersMiddleware`(:254-271) / `requestLogMiddleware`(:277-300) 全部**无调用点**（grep 只命中自身与 `scripts/final-validation.js:80` 的清单） | 见左 |
| 限流（内存） | `lib/utils/validation.js:371-378` 的 `globalRateLimiter`（进程内 Map + 5 分钟清理）同样**无调用点** | 同上 |
| 限流（实际在用） | 只有评论接口自己的 `Map`：`pages/api/notion-comments.js:16,34-44`，窗口 60s、默认 5 次、**Map 无上限、无清理**（IP 越多内存越涨，且多实例各自计数） | 见左 |
| 计数器/原子操作 | Redis 侧只有 `HINCRBY`（`lib/rank/storage.js:9` 注释）；**没有 `INCR`+`EXPIRE` 的限流模式** | 见左 |
| 存储后端 | Redis 优先、文件回退（`lib/rank/storage.js:8-36`、`lib/notify/storage.js:14-27`）；Vercel 上文件回退写 `/tmp`（**实例重建即丢**） | 见左 |
| 平台资源 | Cloudflare 只有一个图片代理 Worker，**wrangler.toml 无 D1/KV/R2 绑定**；仓库无 `@vercel/kv` | `cloudflare/notion-image-proxy/wrangler.toml`（全文 6 行，无 `[[d1_databases]]`/`[[kv_namespaces]]`） |

补充一个**现存配置 bug**（会误导容量规划）：

```js
// lib/cache/cache_manager.js:21
const hasRedis = !!BLOG.REDIS_URL          // ← blog.config.js 里并没有 REDIS_URL 这个键
// lib/cache/redis_cache.js:5
export const redisClient = BLOG.REDIS_URL ? new Redis(BLOG.REDIS_URL) : {}
```

`blog.config.js`（90 行）中**不存在 `REDIS_URL`**，所以页面级 Redis 缓存实际**永远不会启用**；而 `notify`/`rank` 走的是 `process.env.REDIS_URL`（`lib/notify/storage.js:26`、`lib/rank/storage.js:19`）→ 能连。→ 结论：**"REDIS_URL 是否真的在生产配置了"必须确认**（见 §8.3），不要假设缓存层是 Redis。

### 5.2 为什么内存限流在 Vercel 上不够

1. **多实例**：Serverless 每个并发实例独立内存 → 攻击者并发 N 条请求会被分发到 M 个实例，实际阈值 ≈ `limit × M`。
2. **生命周期不可控**：实例冻结/回收即清零，慢速攻击（低频但持续）完全绕过。
3. **冷启动即放行**：攻击者可利用"新实例"刷窗口。
4. **无法跨端点聚合**：登录、找回、写操作共享配额才能防撞库；内存实现做不到。
5. **内存泄漏**：`pages/api/notion-comments.js:16` 的 Map 无上限，本身就是可被利用的 DoS 面。
6. **可伪造来源**：`pages/api/notion-comments.js:25-32`、`lib/middleware/security.js:14-28`、`lib/rank/index.js:85-91` 都用 `x-forwarded-for` 第一段——在 Vercel 前置代理下该头由平台重写（可信），但**若将来在 CF Worker 或其他代理后再接一层，就会变成可伪造** → 限流键与 rank 去重都可被绕过。设计上应优先用平台保证的头（如 `x-vercel-forwarded-for`/`x-real-ip`）并显式校验，不要盲信客户端可写的头。

### 5.3 六种限流/会话存储方案的**真实**限制

| 方案 | 适用 | 真实限制 | 结论 |
| --- | --- | --- | --- |
| **A. 进程内存**（现有 `RateLimiter`） | 本地开发、单实例 Docker | 多实例失效、冷启动清零、无跨端点聚合、Map 膨胀 | ❌ 不能用于 /admin 登录限流 |
| **B. Redis（`REDIS_URL`，现有 `ioredis`）** | **Vercel + 已在用** | 需确认是否已配置；跨区延迟（Upstash 免费档 ~10–50ms/命令，登录路径可接受，但审计日志要异步写）；Upstash 免费额度按命令计费；**故障时若 fail-open 等于没限流**（必须 fail-closed 或降级到"更严格"策略） | ✅ **主选**（session + 限流 + 审计索引三合一） |
| **C. Vercel KV**（= Upstash REST） | 无 `ioredis` 更好 | 需新增依赖 `@vercel/kv`（要装依赖，Phase 0 禁止）；功能是 Redis 子集；同样按命令计费 | 🟡 备选（等价能力，代码更简单） |
| **D. Cloudflare KV**（Workers 侧） | 已有 Worker | 目前**没有 KV 绑定**（wrangler.toml 无 `kv_namespaces`）；KV 最终一致（写后读可能读到旧值 → 限流计数不准）；Vercel 侧要通过 HTTP 调 Worker，多一跳 + 需要额外鉴权 | ❌ 不建议作为限流主存储 |
| **E. Cloudflare D1**（SQLite） | 审计日志归档 | **完全没有资源绑定**；D1 有写入速率与单库大小限制；跨 Vercel↔CF 需自建鉴权 API；且它不在仓库现有部署形态里 | ❌ Phase 1 不引入 |
| **F. Supabase（已在依赖里）** | **审计日志 / session 表** | 需建表 + RLS 策略；每请求一次 HTTP（~30–80ms）；service-role key 权限过大（一旦 SSRF/日志泄漏 = 全库）；免费档有行数/带宽限制 | 🟡 **审计日志可选**（append-only 表很合适），**session 不建议**（延迟敏感） |

**推荐组合（Phase 1）：**

- **Session**：Redis（`SESSION:<sid>` → JSON，TTL 8–12h，滑动续期），opaque 随机 id（32B），`HttpOnly; Secure; SameSite=Lax; Path=/admin`。
- **限流**：Redis `INCR` + `EXPIRE`（或 `SET k v NX EX`），键 = `login:ip:<ip>`、`login:user:<name>`、`admin:write:<sub>`；失败时 **fail-closed**（Redis 不可用 → 拒绝登录并告警，绝不放开）。
- **审计**：Redis List（近期，`LPUSH` + `LTRIM` 保留 N 条）+ 可选 Supabase 表（长期）。**审计写入失败不得阻断业务，但必须落 `console.error` 并计数。**
- **CSRF**：双提交（`__Host-admin_csrf` 随机值 cookie + 请求头/表单字段），服务端 `timingSafeEqual` 比对，配合 `SameSite=Lax` + 全部写操作 POST + `Origin`/`Sec-Fetch-Site` 校验。

---

## 6. 日志与隐私

### 6.1 日志里**已经**打印的敏感数据

| 位置 | 打印内容 | 严重度 |
| --- | --- | --- |
| `pages/auth/index.js:75-77` | `` `请求Code换取Token ${clientId}:${clientSecret} -- ${redirectUri}` `` → **OAuth client_secret 明文进日志** | **High**（条件：`OAUTH_CLIENT_ID/SECRET` 已配置时） |
| `pages/auth/index.js:94` | `console.log('Token response', response.data)` → **access_token** | **High** |
| `pages/auth/index.js:46,41` | `JSON.stringify(params.data)` → workspace 信息 + 授权用户 email | Medium |
| `pages/auth/index.js:66` | `console.log('Auth', code)` → 授权码（一次性，但可被重放窗口利用） | Low |
| `pages/api/auth/callback/notion.ts:108` | `console.log('OAuth身份信息', response.data)` → **access_token** | **High** |
| `pages/api/auth/callback/notion.ts:60-67` | `msg: '成功了' + JSON.stringify(params.data)` 塞进 302 URL → **access_token 进入浏览器历史 / Referer / 平台访问日志 / 代理日志**，且 `pages/auth/result.js:28` 会把 `router.query.msg` 渲染到页面 | **High** |
| `lib/middleware/security.js:290,294,296` | 打印 IP + UA + **`req.body` 全文**（"死代码"，但一旦有人启用就是灾难） | 若启用则 High |
| `pages/api/notion-comments.js:182` | `console.error(error)` → Notion SDK 错误对象可能含请求体（评论内容/邮箱） | Medium |
| `scripts/translate/diagnose.js:12` | `token 末尾: …${token.slice(-6)}` → 打印令牌尾部 6 位 | Low（脚本，非运行时） |

**建议基线（Phase 1 强制）**：日志字段白名单（`ts, level, event, path, method, status, durMs, requestId, sessionIdPrefix`）；**禁止**记录 IP 原文、`Authorization`、cookie、body、email；需要定位"谁"时只记 `sessionId` 前缀（8 位）+ 用户名。审计日志另走独立通道（§5.3）。

### 6.2 现有数据的隐私画像

| 数据 | 存储位置 | 含个人信息？ | 证据 |
| --- | --- | --- | --- |
| 评论 | Notion 数据库 | **是**：`Author` = **明文邮箱**；`IpAddress` = **明文 IP**；`UserAgent` = 明文 UA；`EmailHash` = **无盐 SHA-256**（可对已知邮箱穷举反查）；`Nickname` 明文 | `pages/api/notion-comments.js:143,145-147,153-157,164-169` |
| 排行榜去重 | Redis（或 `/tmp` 文件） | **是（准标识符）**：`sha256(ip\|ua\|scope)[:32]`，**无盐**，跨天稳定；点赞去重 TTL **100 年**（`LIKED_TTL = 100*365*24*3600`）→ 长期可关联同一访客 | `lib/rank/index.js:105-108,125-135`；`lib/rank/storage.js:27-29,424-427` |
| 推送订阅 | Redis 单 key `notify:data`；Vercel 上文件回退 `/tmp/notify-data.json` | **是**：`config` 含 Telegram bot token / SendKey / WebPush `endpoint`（= 浏览器推送服务地址，可关联用户设备）；`subscriberId` 是设备级 UUID | `lib/notify/storage.js:1-12,20-27` |
| Twikoo 评论 | **第三方（Twikoo 自建/云函数）**，仓库只在 `NEXT_PUBLIC_COMMENT_ENV_ID` 注入前端 | 不在本仓库内；合规责任在 Twikoo 实例侧（**待确认是否启用**） | `conf/comment.config.js`（`NEXT_PUBLIC_COMMENT_*`） |
| 邮件订阅 | Mailchimp | 邮箱在第三方；服务端仅转发 | `lib/plugins/mailchimp.js:8-34` |
| Session/审计 | **不存在** | — | §5.1 |

**给新增 /admin 的直接结论**：

1. **不要复用** `hashIdentity()` 做管理员/访客标识：它无盐、短截断、跨用途同构 → 一旦用于管理员操作归属，等于把"谁做的"变成弱 ID。
2. 新增"统计/访客分析"时，**禁止**把 IP、指纹（canvas/UA 组合）、邮箱落盘。允许的只有：**日聚合计数**、`sha256(salt + ip)` 且 **salt 每日轮换**（用于当天去重，跨天不可关联）。
3. 管理员**审计日志**必须含：`ts, actor(管理员用户名), action, target, result, ip_prefix(/24 或 /48 截断), sessionIdPrefix, requestId`；**不含**完整 IP、不含请求体中的密码/邮箱。

### 6.3 新增统计 SDK 的隐私红线（可执行）

| 红线 | 说明 |
| --- | --- |
| ❌ 明文 IP | 存储层任何形式不做明文 IP；只看聚合 |
| ❌ 设备指纹 | 不拼 canvas/WebGL/字体/时区做稳定 ID |
| ❌ 邮箱明文进统计表 | 邮箱只允许存哈希（**加盐**），且只有评论模块需要 |
| ❌ 把 `subscriberId` 当用户 ID 跨功能关联 | 它是"某浏览器"，不是"某人" |
| ✅ | 只存 `date`、`path`、`refHost`、`country`（如订阅地理聚合）、`count` |
| ✅ | 提供"删除我的数据"入口（至少评论邮箱/IP 可人工清理，文档化流程） |

---

## 7. 响应头与传输安全

### 7.1 现状

```js
// next.config.js:324-402  （headers 只在这些条件下生效：process.env.EXPORT 未设置）
source: '/:path*{/}?'
  Access-Control-Allow-Credentials : 'true'      // :341
  Access-Control-Allow-Origin      : '*'         // :342
  Access-Control-Allow-Methods     : 'GET,OPTIONS,PATCH,DELETE,POST,PUT'  // :344-346
  Access-Control-Allow-Headers     : 'X-CSRF-Token, X-Requested-With, ...'  // :348-351
  // 下面全部被注释掉：X-Frame-Options / X-Content-Type-Options / X-XSS-Protection
  // Referrer-Policy / Permissions-Policy / HSTS / CSP            // :352-376
```

- **CSP：无（站点级）**。唯一存在的 CSP 是给 `next/image` 优化响应用的：`next.config.js:249` `"default-src 'self'; script-src 'none'; sandbox;"`（只作用于 `/_next/image` 返回体）。
- **`X-Frame-Options`：无** → 全站（含将来的 `/admin`）可被第三方 iframe 嵌入 → **点击劫持**。
- **HSTS：无**。`vercel.json:1-6` 的 `headers` 是**空数组**。
- **Vercel 默认**：Vercel 会终止 TLS 并默认 `https` 可达（`http` → 301，取决于域名设置），但**不会**自动注入 HSTS / X-Frame-Options / CSP / nosniff；`X-Vercel-Cache`、`X-Matched-Path` 等平台头会存在。→ 也就是说：**当前站点没有任何安全响应头承诺，"是否强制 HTTPS"依赖 Vercel 域名设置（待确认）**。
- **已做对的一点**：`poweredByHeader: false`（`next.config.js:205`）。
- **死代码**：`lib/middleware/security.js:254-271` 的 `securityHeadersMiddleware()` 写得很完整（含 `removeHeader('X-Powered-By')`），但**从未被调用**（§5.1）。

两个具体缺陷：

1. `ACAO: *` 与 `Allow-Credentials: true` **同时出现**。浏览器规范下这个组合会被拒绝（credentials 请求不能用 `*`），所以当前"实际上没生效"；但它是**错误配置**：一旦有人为了"修好 CORS"把 `*` 改成反射 `Origin`，就立刻变成"任意站点带 cookie 读接口"的严重漏洞。且 `opts.credentials` 的默认值同样是 `false`（`lib/middleware/security.js:229`），两处风格不一致。
2. `images.dangerouslyAllowSVG: true`（`:248`）+ `remotePatterns: http/https / **`（`:233-242`）= 可用 `/_next/image?url=https://evil/x.svg` 让**本站域名**返回攻击者 SVG。当前由 `images.contentSecurityPolicy`（`:249`）缓解直接打开时的脚本执行，但仍可用于钓鱼页/绕过部分图片白名单。→ 建议改成显式域名白名单（Notion 域 + 自有 CDN）。

### 7.2 对 `/admin` 单独加 `no-store` / `noindex` 的可行做法

| 做法 | 实现 | 优点 | 限制 |
| --- | --- | --- | --- |
| **①（推荐）`next.config.js` headers 精确匹配** | 新增 `{ source: '/admin/:path*', headers: [ {Cache-Control: 'private, no-store, max-age=0, must-revalidate'}, {X-Robots-Tag: 'noindex, nofollow, noarchive'}, {X-Frame-Options: 'DENY'}, {X-Content-Type-Options: 'nosniff'}, {Referrer-Policy: 'no-referrer'}, {Content-Security-Policy: "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"} ] }` | 零运行时代价；对静态优化与 SSR 都生效；和现有 `:338` 的通配条目**按 order 更具体优先**（Next 取"最后一个匹配"的行为需实测确认，建议把 `/admin` 条目放在通配**之后**） | 需要**实测**确认与 `'/:path*{/}?'` 的覆盖顺序；`Cache-Control` 无法覆盖已经 `getStaticProps` 的页面（所以 `/admin` 页面本身必须是 SSR 或 client-only，不要给 `revalidate`） |
| ② SSR 内 `res.setHeader` | 在 `/admin/*` 的 `getServerSideProps` 里设 | 最可靠（与页面同生共死） | 每个页面都要写；纯静态页不可用 |
| ③ `vercel.json` headers | 若部署形态是 Vercel | 平台层生效、CDN 也遵守 | 与 `next.config.js` 重复维护；本地/其他平台不生效 |
| ④ `robots.txt` + meta | `lib/utils/robots.txt.js` 里加 `Disallow: /admin` + 页面 `<meta name="robots" content="noindex">` | 便宜 | `robots.txt` 只是"请勿抓取"，**不是访问控制**；meta 对已抓取无效 |

**重要**：**`noindex` 不是安全控制**。真正的门禁是 §8.1 的鉴权；`no-store` 是为了"登出后浏览器/中间缓存不回放管理页面"，必须与 `Cache-Control: private, no-store` 一起，并确保 Vercel 侧 `s-maxage` 不缓存 `/admin`（CDN 缓存管理页是最常见的越权读取方式）。

---

## 8. 结论

### 8.1 新增管理员认证**必须具备**的安全控制清单（逐条可勾选）

> 验收方式：每条都能用"一条命令或一次点击"证明，不接受"应该没问题"。

- [ ] **C1 独立凭据，fail-closed**：`ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH` 缺失/格式非法 → `/admin` 与 `/api/admin/*` 一律 503 并显示"未配置"，**任何分支都不得放行**（禁止复制 `pages/api/cache.js:14` 的写法）。
- [ ] **C2 强 KDF + 服务端校验**：Argon2id（或 bcrypt cost ≥12，或 scrypt N=2^15）；`timingSafeEqual` 比较；密码只在服务端校验，**绝不下发哈希/明文到客户端**。
- [ ] **C3 服务端 Session（opaque）**：32 字节随机 id；存 Redis（TTL 8–12h，滑动续期，上限 1 绝对 TTL 24h）；**不要**把用户信息放进 cookie（JWT-in-cookie 也要 `HttpOnly` + 签名）。
- [ ] **C4 Cookie 属性齐全**：`HttpOnly; Secure; SameSite=Lax; Path=/admin; __Host-` 前缀（用 `__Host-` 时不得设 `Domain`）。
- [ ] **C5 Session 固定防护**：登录成功后**重新生成** session id；登出/改密删除该 id；支持"登出所有设备"。
- [ ] **C6 CSRF**：双提交 token（cookie + header/字段，`timingSafeEqual`）+ 所有写操作 POST + 校验 `Origin`/`Sec-Fetch-Site`；`SameSite=Lax` 作为第二层，不作为唯一层。
- [ ] **C7 登录限流（跨实例）**：Redis `INCR/EXPIRE`；维度 = IP + 用户名 + 全局；阈值示例 5 次/15 分钟/账号、20 次/小时/IP；触发后**指数退避**并返回统一错误（不区分"用户不存在/密码错"）；Redis 不可用 → 拒绝登录（fail-closed）。
- [ ] **C8 通用写接口限流**：每个 `/api/admin/*` 独立配额（如 60 次/分钟/会话），并用 `SET NX EX` 去重幂等键防重复提交。
- [ ] **C9 审计日志（append-only）**：登录成功/失败、登出、所有写操作、权限拒绝；字段见 §6.2；**不记密码/完整 IP/cookie**；保留期 ≥ 90 天；提供查询与导出。
- [ ] **C10 会话与权限最小化**：单管理员也要有"会话绑定 UA 摘要/签发时间"校验；敏感动作（改密、清缓存、发布）要求**二次确认**（重新输密码或短时 elevate token）。
- [ ] **C11 响应头隔离**：`/admin` 单独下发 `Cache-Control: private, no-store` + `X-Robots-Tag: noindex` + `X-Frame-Options: DENY` + `frame-ancestors 'none'` + `nosniff` + `Referrer-Policy: no-referrer`；CSP 先 `Content-Security-Policy-Report-Only` 起步，再切强制。
- [ ] **C12 错误不回显内部信息**：所有 `/api/admin/*` 失败统一 `{error: 'internal'}` + `requestId`；`e.message`/堆栈只进服务端日志（禁止复制 `pages/api/push/test.js:66`、`pages/admin/notify-status.js:89`）。
- [ ] **C13 秘密只走环境变量 + 防泄漏门禁**：`ADMIN_*`/`SESSION_SECRET` 不出现在 `blog.config.js`、`siteConfig()`、`NEXT_PUBLIC_*`；CI 脚本扫描 `.next/static/**`，命中即构建失败（§3.5 #8）。
- [ ] **C14 令牌比较常量时间 + 不落 URL**：`timingSafeEqual`；token 只在 header/cookie；日志脱敏（`****`）。
- [ ] **C15 现有弱接口先隔离**：Phase 1 上线 `/admin` 之前，`/api/cache`、`/api/push/test`、`/api/push/subscriptions`、`/api/push/status`、`/admin/notify-status` 必须已修或已下线（§8.2）。
- [ ] **C16 可验证**：为 C1/C3/C6/C7/C9 各写至少 1 个自动化测试（顺序检查 401/403/429、cookie 属性、CSRF 缺失被拒、审计落库）。

### 8.2 现有仓库中**必须先修 / 先隔离**的问题

| 优先级 | 问题 | 是否本项目范围 | 建议时机 | 最小动作 |
| --- | --- | --- | --- | --- |
| P0-1 | **F-01** `RANK_SEED_SECRET` 经 `siteConfig()` 可从 Notion 配置泄漏到 `__NEXT_DATA__` | ✅ 是（既有代码设计缺陷） | **Phase 1 一并修**（且新 /admin 绝不复用该模式） | 让 `verifySecret` 只读 `process.env.RANK_SEED_SECRET`；在 Notion 配置里**不要**放任何名为 `*SECRET*`/`*TOKEN*` 的键（建议加构建期检查） |
| P0-2 | **F-04** `/api/cache` fail-open | ✅ 是 | **Phase 1 一并修** | `if (!token) return 503` |
| P0-3 | **F-03** `/api/push/test` 零鉴权 SSRF | ✅ 是 | **Phase 1 一并修** | 加 `NOTIFY_SECRET` 鉴权（沿用 `push/send.js:16-23` 的 fail-closed 形态）+ `endpoint` 必须匹配 `https://*.push.services.mozilla.com|fcm.googleapis.com|notify.windows.com|...` 白名单；禁止自动 `setVapidKeys`（`:52`） |
| P0-4 | **F-05** `/api/push/subscriptions` 零鉴权读凭据 | ✅ 是 | **Phase 1 一并修** | 删除该端点或改为"必须提交 `subscriberId` 的 write-only 接口 + 速率限制 + 不返回 `config`" |
| P0-5 | **F-06** `/admin/notify-status`、`/api/push/status` 公开 | ✅ 是 | **Phase 1 一并修**（`/admin/notify-status` 会与新 `/admin` 命名空间冲突，必须处理） | 迁移到 `/admin/system` 并纳入新鉴权；`/api/push/status` 只返回 `{ok:true}` 或直接删除（`redisError` 原文一律不外发） |
| P1-1 | **F-02** OAuth 链路把 secret/token 写日志与 URL | ✅ 是（若启用 OAuth） | **Phase 1 一并修**（若确认未使用则直接删） | 删 `pages/auth/index.js:75-77,94`、`pages/api/auth/callback/notion.ts:108`；`msg` 只回 `{ok:true}`；`access_token` 绝不进 query |
| P1-2 | **F-07** Clerk fail-open + matcher 语义陷阱 | ✅ 是（架构约束） | Phase 1（作为新门禁的设计输入） | 新 `/admin` 走独立 matcher + 函数体白名单；把"Key 缺失 = 已登录"这类逻辑全部禁止 |
| P1-3 | **F-08** 无安全响应头 + CORS 通配 | ✅ 是 | Phase 1（至少 `/admin` 范围） | 给 `/admin` 加 §7.2 头；全站的 `ACAO:*`+`credentials:true` 至少拆掉其中一项 |
| P1-4 | **F-11** 零限流基础设施 | ✅ 是 | Phase 1（新建，不复用死代码） | 新建 `lib/admin/rateLimit.js`（Redis），**不要**启用 `lib/middleware/security.js`（它会把 `req.body` 打进日志，见 §6.1） |
| P2-1 | **F-09/F-10** 评论 PII、rank 弱标识 | ✅ 是 | Phase 2（但要写进 Phase 1 的"统计/隐私契约"） | 评论：IP 只存 `/24` 或哈希+日盐；邮箱只存加盐哈希；rank：加盐 + 缩短 TTL |
| P2-2 | **F-12/F-13/F-14/F-15** | ✅ 是 | 随手修（不阻塞） | `timingSafeEqual`；图片域名白名单；`.gitignore` 加 `.dsh-ops/` 与 `.env.*.local`；补 matcher 注释/实现一致 |

> 注：**F-01 / F-03 / F-04 / F-05 / F-06 都是"现在就可以被远程利用"的问题**，与是否新增 /admin 无关。它们**不需要**等 Phase 1 —— 但因为 Phase 0 的约束（只读、禁止改生产代码），本轮**只记录不动手**。

### 8.3 待管理员确认项（我无法从仓库判断，需要你回答/去控制台看）

| # | 待确认 | 为什么关键 | 怎么确认 |
| --- | --- | --- | --- |
| Q1 | **Vercel 上是否配置了 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY`？** | 决定 middleware 现在是"死"的还是"活的"；也决定 `/dashboard` 是否已在用 Clerk | Vercel → Settings → Environment Variables |
| Q2 | **是否配置了 `CACHE_REVALIDATION_TOKEN`？** | 未配置 = `/api/cache` 现在对全世界开放（F-04） | 同上 |
| Q3 | **是否配置了 `REVALIDATION_TOKEN` / `NOTIFY_SECRET` / `RANK_SEED_SECRET` / `CLAUDE_CONTRIBUTION_TRIGGER_TOKEN`？** 若 `RANK_SEED_SECRET` 被填进了 **Notion 配置表**，请立即视为已泄漏 | 决定 F-01 是"理论"还是"正在发生"；也决定 rank 计数是否可能被随意重置 | 环境变量 + Notion 的 Config 页面（搜 `SECRET`/`TOKEN` 键名） |
| Q4 | **`REDIS_URL` 是否真的配置了？**（注意 `lib/cache/cache_manager.js:21` 读的是 `BLOG.REDIS_URL`，而 `blog.config.js` 没这个键 → 页面缓存实际没走 Redis） | 决定 session/限流/审计能不能用 Redis；也决定 notify 数据是持久化还是写 `/tmp` 即丢 | 环境变量 + 打开 `/api/push/status` 看 `storage` 字段（**这是只读 GET，但请你自己决定是否访问**） |
| Q5 | **`OAUTH_CLIENT_ID/SECRET` 是否配置、`/auth` 链路是否在用？** | F-02 是真泄漏还是死代码；决定"直接删除"还是"脱敏保留" | 环境变量 + 搜索是否有外部链接指向 `/auth` |
| Q6 | **域名 `blog.20240606.xyz` 是否走 Cloudflare 代理？**（本轮约束禁止对线上发请求，故未做 DNS/TLS 查询） | 决定能否用 Cloudflare Access 作纵深第二层；也影响 `x-forwarded-for` 可信度与限流键 | Cloudflare 控制台 / DNS 记录（可让 data-auditor 的 `--dns` 结论补充） |
| Q7 | **Vercel 计划与函数区域**（Hobby/Pro？`maxDuration` 上限？） | 决定登录 + Argon2 能否在 10s 内完成、审计日志能否同步写；Hobby 的行为对冷启动更敏感 | Vercel 项目设置 |
| Q8 | **是否允许 Phase 1 新增依赖？**（`@node-rs/argon2` / `bcryptjs` / `hash-wasm`，以及显式声明 `jose`/`cookie`） | 直接决定密码方案（§4.4）；若仍禁止装依赖，只能选 `node:crypto.scrypt` 并接受"非 Argon2id"偏差 | 你的决定 |
| Q9 | **审计日志存哪：Redis（近期）+ Supabase（长期）？还是只用 Redis？** | 决定是否要建 Supabase 表与 RLS 策略（`SUPABASE_SECRET_KEY` 已存在，权限很大） | 你的决定 |
| Q10 | **`/api/push/*`、rank、notify 这些"准管理员"功能是否仍在使用？** | 若不用，Phase 1 直接下线比逐个加固更快更安全（F-03/F-05/F-06 一并消失） | 你的决定 |
| Q11 | **新 `/admin` 的 URL 是否就定在 `/admin`？** 现存 `pages/admin/notify-status.js` 已占用该命名空间，新页面需与之共存或替换 | 影响路由设计与 Phase 1 的冲突处理 | 你的决定 |

---

## 附录 A：本次审计执行过的只读命令（可复现）

```bash
# 结构
find pages/api pages/auth pages/admin pages/sign-in pages/sign-up pages/dashboard -type f
git rev-parse --short HEAD          # 7c734e7
# Clerk 引用点
grep -rn "@clerk" --include=*.js --include=*.ts --exclude-dir=node_modules --exclude-dir=.next .
# 密钥面
grep -rniE "(secret|password|apikey|api_key|access_token|private_key|token)\s*[:=]\s*['\"][A-Za-z0-9_\-\.]{12,}['\"]" ...
grep -rnE "(sk-[A-Za-z0-9]{20,}|pk_(test|live)_|ghp_|AKIA|ntn_|secret_)" ...      # 0 命中
# 会话/限流
grep -rn "Set-Cookie|res.cookies|cookies.set" ...                                   # 0 命中
grep -rn "middleware/security|securityHeadersMiddleware|requestLogMiddleware" ...   # 仅死代码
# 依赖
ls -d node_modules/*argon* node_modules/*bcrypt*                                     # 均不存在
node -p "require('./node_modules/jose/package.json').version"                        # 5.10.0（传递依赖）
# .env 卫生
git ls-files | grep -iE '^\.env'        # 只有 .env.example / .env.docs.example
git check-ignore -v .env.local          # 命中 .gitignore:33
git log --all -- .env.local             # 无历史
git check-ignore -v .dsh-ops            # NOT IGNORED（F-14）
```

**未执行**（受 Phase 0 约束）：任何 `curl`/HTTP 请求、任何登录尝试或弱口令猜测、任何 `yarn install`、任何 `next build/dev`、任何文件修改（除本文件）。

---

*本文件为 Phase 0 只读审计产物。所有结论均可用上文 `file:line` 复核；若与代码实际不符，以代码为准并请回报给 lead。*
