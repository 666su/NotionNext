# Jason Blog Admin —— 安全审查报告（Phase 0）

- 范围：现有仓库的鉴权面、密钥处理、隐私边界、响应头，以及新 `/admin` 认证的安全要求。
- 约束：**只读**。未修改代码、未安装依赖、未对线上发起攻击性请求、未尝试登录；本文**不含任何密钥值**。
- 明细与逐行证据：[SECURITY.md](_findings/SECURITY.md)（664 行，15 条风险 + 16 条控制项 + 11 项待确认）。
- 结论前置：**现有仓库的鉴权是 fail-open 结构，且已存在 6 个"现在就能被远程利用"的问题**；新后台必须**另起一套 fail-closed** 的认证与存储，不能复用现有模式。

---

## 1. 风险总表

| ID | 严重度 | 问题 | 关键证据 | 现有缺陷 | 处理阶段 |
| --- | --- | --- | --- | --- | --- |
| **F-01** | **Critical（条件触发）** | `RANK_SEED_SECRET` 经 `siteConfig()` 读取，会**优先命中 Notion 配置表**；而 `NOTION_CONFIG` 会整块序列化进每个页面的 `__NEXT_DATA__` → 按"最自然方式"配置 = **公开发布管理令牌** | `lib/rank/index.js:392-398`、`lib/config.js:72-79`、`lib/db/SiteDataApi.js:722`、`pages/_app.js:48,89` | 是 | **P1 必修** |
| **F-02** | High（条件触发） | Notion OAuth 链路把 `clientId:clientSecret` 与 token 响应打进 `console.log`，并把含 `access_token` 的 JSON 塞进 302 跳转的 `?msg=` | `pages/auth/index.js:66,75-77,94`、`pages/api/auth/callback/notion.ts:60-67,108` | 是 | P1（若不用则删） |
| **F-03** | High | `POST /api/push/test` **零鉴权**，可让服务器向**任意 URL** 发起 POST（SSRF），并在缺密钥时自动生成并持久化 VAPID | `pages/api/push/test.js:11-63`、`lib/notify/webpush.js:220-246` | 是 | **P1 必修** |
| **F-04** | High | `POST /api/cache` **fail-open**：`CACHE_REVALIDATION_TOKEN` 未配置时完全不校验 → 任何访客可清缓存 | `pages/api/cache.js:13-16` | 是 | **P1 必修** |
| **F-05** | High | `GET /api/push/subscriptions?subscriberId=…` **零鉴权**返回该订阅者完整 `config`（Telegram bot token / Server 酱 SendKey / WebPush keys） | `pages/api/push/subscriptions.js:12-17`、`lib/notify/storage.js:1-12,158-160` | 是 | **P1 必修** |
| **F-06** | High | `/admin/notify-status` 与 `/api/push/status` **公开可读**，渲染 Redis 配置态、连接错误原文、订阅总数、VAPID 是否存在；`redisError` 可能含连接串信息 | `pages/admin/notify-status.js:61-107,89`、`pages/api/push/status.js:9-55` | 是 | **P1 必修** |
| **F-07** | High（架构性） | 现有鉴权 **fail-open**：`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 缺失即整体降级为"无鉴权"；管理员路由匹配器只覆盖 2 个子路径 | `middleware.ts:66-92,24-27` | 是 | P1（设计输入） |
| **F-08** | Medium | 全站 `Access-Control-Allow-Origin: *` + `Allow-Credentials: true`（矛盾组合）；CSP / X-Frame-Options / HSTS 全被注释 | `next.config.js:337-387`、`vercel.json:5` | 是 | P1（至少 `/admin`） |
| **F-09** | Medium | 评论接口把**明文邮箱、明文 IP、UA** 写进 Notion；另存**无盐 SHA-256** 邮箱哈希（可枚举反查） | `pages/api/notion-comments.js:143-169,54-55` | 是 | P2（Phase 2 前） |
| **F-10** | Medium | 排行榜访客标识 = `sha256(ip|ua)` 无盐截断；点赞去重 TTL 100 年；`rank/view|like` 无限流可刷 | `lib/rank/index.js:105-108,125-135`、`lib/rank/storage.js:27-29` | 是 | P2 |
| **F-11** | Medium | **零 cookie、零 session、零 CSRF、零可用限流**；`lib/middleware/security.js` 整套死代码；`lib/config/env-validation.js` 从未被调用 | 全仓检索 | 是（需新建） | P1（新建） |
| **F-12** | Low | 令牌比较用 `!==`（非常量时间） | `pages/api/revalidate.js:41`、`pages/api/push/send.js:21`、`lib/rank/index.js:397` | 是 | 随手修 |
| **F-13** | Low | `images.dangerouslyAllowSVG: true` + 远程 `**` 白名单 | `next.config.js:233-249` | 是 | 不阻塞 |
| **F-14** | Low | `.dsh-ops/`（含 agent 会话日志）未进 `.gitignore`，存在误提交风险 | `.gitignore` | 是 | 一行修复 |
| **F-15** | Low | `middleware.ts:12` 注释声称排除 `/sign-in`、`/auth`，实际正则不生效 | `middleware.ts:12` | 是 | 记录，不依赖 |

> **F-01 / F-03 / F-04 / F-05 / F-06 现在就可被远程利用，与是否新增 `/admin` 无关**。Phase 0 的只读约束禁止本轮动手，已书面记录，建议 Phase 1 一并修复（§8）。

---

## 2. 现有鉴权面

### 2.1 能否复用 Clerk？—— **不能**

| 理由 | 证据 |
| --- | --- |
| 凭据主权：Clerk 是托管 IdP，管理员密码/会话在第三方云，与"独立账号密码、不依赖第三方登录"冲突 | `package.json:70`；`middleware.ts:1` |
| fail-open：只有 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` 存在时才启用，缺失即 `noAuthMiddleware` **全放行** | `middleware.ts:66` |
| 覆盖不全：`isTenantAdminRoute` 只匹配 `/admin/(.*)/memberships` 与 `/admin/(.*)/domain`，`/admin/notify-status` 从未被保护 | `middleware.ts:24-27,80-87` |
| 模型错位：其"管理员"是 org permission（`org:sys_memberships:manage`），不是"博客管理员" | 同上 |
| 审计不可控：登录/操作日志落第三方，无法满足"管理员操作日志"要求 | — |

**替代结论**：自建 bcrypt/scrypt + Redis 会话 + CSRF + 限流 + 审计。Clerk 保留给现有会员中心（`/dashboard`），**两者互不干扰**。

### 2.2 现有中间件的真实行为（新守卫必须叠加在外层）

- `matcher: ['/((?!.*\\..*|_next|/sign-in|/auth).*)', '/', '/(api|trpc)(.*)']`（`middleware.ts:12`）——只排除"含点号"的路径；注释中的 `/sign-in`、`/auth` 排除**实际不生效**（F-15）。
- Clerk 分支：`/dashboard` 未登录 → 302 `/sign-in?redirectTo=…`；`/admin/(.*)/memberships|domain` → `auth().protect(...)`。
- noAuth 分支：仅做 `UUID_REDIRECT` 的 308 映射（默认关闭、`public/redirect.json` 不存在）。
- **对后台的含义**：`/admin/*` 会穿过中间件但今天不做任何鉴权 → 新守卫必须**前置**在 `authMiddleware` 之前，并且必须在 Clerk 与 noAuth 两种模式下都成立（生产是否配 Clerk key 未知，见 Q1）。

---

## 3. 未授权 / 弱鉴权接口清单

| 端点 | 现状 | 攻击面（描述，不含利用脚本） | 处置 |
| --- | --- | --- | --- |
| `POST /api/push/test` | **无鉴权** | 任意人可让服务器 POST 到任意 `endpoint`（SSRF）；并可触发 VAPID 自动生成并落库 | 加 `NOTIFY_SECRET` + endpoint 域名白名单（只允许 FCM/Mozilla/WNS 等），禁止自动建 key |
| `POST /api/cache` | **fail-open** | `CACHE_REVALIDATION_TOKEN` 未配置时任何人可清缓存 → 触发源站全量重取（可用作放大/干扰） | `if (!token) return 503` |
| `GET /api/push/subscriptions` | **无鉴权** | 传入 subscriberId 即返回该订阅者的推送配置（含 bot token / SendKey / WebPush keys） | 删除或改为 write-only + 自证 |
| `GET /api/push/status` | **无鉴权** | 返回 Redis 连接态/错误原文/订阅数 | 只返回 `{ok:true}`，错误仅进服务端日志 |
| `GET /admin/notify-status`（页面） | **无鉴权** | 线上实测可读 `storage=redis`、`订阅总数 4`、`VAPID ✅`；`redisError` 原文可能含连接细节 | 迁入新后台鉴权（`/admin/system`）或下线 |
| `POST /api/rank/seed` | `RANK_SEED_SECRET` | 一旦 F-01 成立（密钥进 `__NEXT_DATA__`），计数可被任意重置 | 改为只读 `process.env`，并在 Notion 配置里禁用 `*SECRET*` 键 |
| `POST /api/rank/view|like` | 无鉴权 | 计数可被刷（无限流、去重标识弱） | P2：加 Redis 限流 + 加盐标识 |
| `POST /api/notion-comments` | 无鉴权 | 可写评论到 Notion；并落明文邮箱/IP | P2：加限流 + 脱敏（见 §7） |
| `GET /api/blog-pet/posts` | 无鉴权（只读） | 暴露文章列表（公开信息） | 可复用，无需处理 |
| `GET /api/auth/callback/notion` | 无 | token 进日志/URL（F-02） | 若不用则删除 |

**硬性禁止清单（新后台不得复制这些模式）**：

1. 不得用 `siteConfig()` / `NOTION_CONFIG` / `blog.config.js` 读取任何密钥。
2. 不得"未配置密钥就放行"。
3. 不得把 token 放进查询串或日志。
4. 不得用 `!==` 比较令牌（用 `timingSafeEqual`）。
5. 不得在未鉴权页面渲染内部错误原文。

---

## 4. 密钥与暴露面

### 4.1 三条"配置 → `__NEXT_DATA__`"的泄漏通道（新后台必须回避）

1. `siteConfig(key)` 会先读 `global.NOTION_CONFIG[key]`（`lib/config.js:72-79`）。
2. `convertNotionToSiteData()` 把整个 `NOTION_CONFIG` 放进 props（`lib/db/SiteDataApi.js:722`）。
3. `pages/_app.js:48,89` 把 `pageProps` 传给布局 → Next 序列化 `__NEXT_DATA__`。

**结论**：任何写进 Notion 配置表的键都会进入每个页面的 HTML。`ADMIN_PASSWORD_HASH` / `SESSION_SECRET` **只能**来自 `process.env`，且**不得**以 `NEXT_PUBLIC_` 前缀声明。

### 4.2 现状核对

| 项 | 结论 |
| --- | --- |
| `.env.local` | 只有 1 个变量名（`NOTION_PAGE_ID`）；**生产配置在 Vercel，仓库不可见** |
| `.gitignore` | 已忽略 `.env*`（但**未**忽略 `.dsh-ops/`，F-14） |
| 硬编码密钥 | 未发现真实密钥；命中的都是示例/占位（如 `conf/comment.config.js:66-69` 的 Gitalk `client_secret` 走 `NEXT_PUBLIC_`，属"已公开"类） |
| `NEXT_PUBLIC_` 误用 | 现有配置大量使用 `NEXT_PUBLIC_`（统计/评论 ID 等）→ 新后台**必须**区分"公开配置"与"秘密配置" |

### 4.3 新增密钥清单（只放服务端）

```env
ADMIN_USERNAME=            # 非秘密，但也不下发客户端
ADMIN_PASSWORD_HASH=       # bcrypt 哈希（秘密）
SESSION_SECRET=            # 32+ 字节随机（秘密）
ADMIN_INIT_TOKEN=          # 可选：一次性初始化（用完即弃）
ADMIN_SESSION_IDLE_MIN=30
ADMIN_SESSION_TTL_HOURS=12
```

规则：①CI 增加"构建产物扫描"（`grep -r 'ADMIN_PASSWORD_HASH\|SESSION_SECRET' .next/static` 命中即失败）；②任何文档/日志不打印值；③轮换步骤写进运维文档。

---

## 5. 密码学与依赖现状

| 项 | 现状 | 结论 |
| --- | --- | --- |
| `lib/utils/password.js` | 已有密码工具（用于文章锁，SHA-256 类摘要） | **不可用于管理员密码**（非慢哈希） |
| `js-md5` / `js-sha256` | 用于指纹/邮件打码等 | 不用于口令 |
| argon2 / bcrypt | **均无依赖** | 需新增 |
| `jose` / `cookie` | 只是 Next 的**传递依赖**，`package.json` 未声明 | 不能直接 `import`；要么显式声明，要么自己实现（推荐自己做 HMAC + 手写 Cookie 解析，零依赖） |
| `zod` | 已在 devDependencies | 可用于请求体校验（若要在生产用需移到 dependencies） |

**推荐**：`bcryptjs`（cost 12，纯 JS、无 native 构建、Vercel 兼容）。备选 `node:crypto.scrypt`（零依赖，N=2^15/r=8/p=1），但需管理员确认"非 Argon2id/bcrypt"的偏差可接受。`@node-rs/argon2` 因原生产物平台匹配与体积风险不推荐。

---

## 6. Session / CSRF / 限流（现状为零）

| 能力 | 现状 | 方案 |
| --- | --- | --- |
| Cookie | 全仓 0 处服务端 Cookie 会话 | `jba_sid`：`HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=43200`（可选 `__Host-` 前缀） |
| Session 存储 | 无 | Redis `admin:sess:<sha256(sid)>`（TTL 空闲 30min / 绝对 12h）+ `admin:sess:uid:<uid>` Set（改密时批量失效） |
| 登录态校验 | 无 | 三层：Edge 签名校验 → 页面 GSSP → 每个 API 独立校验 |
| CSRF | 无 | 双提交（`admin_csrf` cookie + `x-csrf-token`）+ Origin/`Sec-Fetch-Site` 校验；写操作一律 POST |
| 限流 | 唯一实现是评论接口的**进程内 Map**（多实例无效） | Redis `INCR/EXPIRE`：登录 5 次/15min/账号 + 20 次/h/IP；后台写接口 60 次/min/会话；`/api/track` 60 事件/min/IP |
| 日志 | 无审计 | `admin:audit` List（LTRIM 5000，TTL 90d），只记 `ipHash`/`uaHash` |

**为什么内存限流不够**：Vercel Serverless 多实例、冷启动后 Map 清空 → 攻击者可绕过。必须用 Redis（生产已配置）。

> 修正一处审计笔记：`REDIS_URL` **确实**接通了缓存层——`conf/dev.config.js:12` 定义 `REDIS_URL`，`blog.config.js:34-54` 展开 conf，因此 `BLOG.REDIS_URL` 有效，`lib/cache/redis_cache.js:5` 会创建客户端。这意味着 **ISR 页面缓存与未来的统计数据共用同一 Redis 实例** → 统计键必须独立前缀 + TTL，避免挤掉缓存（见方案 §6.7）。

---

## 7. 日志与隐私

### 7.1 已存在的问题

| 问题 | 证据 | 影响 |
| --- | --- | --- |
| OAuth 打印 `clientId:clientSecret` 与完整 token 响应 | `pages/auth/index.js:66,75-77,94`；`pages/api/auth/callback/notion.ts:108` | 秘密进入 Vercel 日志（可被日志导出/第三方读取） |
| 评论接口写明文邮箱/IP/UA 到 Notion | `pages/api/notion-comments.js:143-169` | 违反最小化采集；Notion 侧可见 |
| 无盐 SHA-256 邮箱哈希 | 同上 `:54-55` | 邮箱可被枚举反查 |
| `redisError` 原文外发 | `pages/admin/notify-status.js:89`；`pages/api/push/status.js` | 泄漏连接细节 |
| rank 标识 `sha256(ip|ua)` 无盐 | `lib/rank/index.js:105-108` | 可被离线碰撞/关联 |

### 7.2 新统计 SDK 的隐私红线（可执行）

- ❌ 不采集/不落库：明文 IP、设备指纹、邮箱、手机号、姓名、精确 GPS、评论正文。
- ✅ 匿名 ID：`crypto.randomUUID()` 存 `localStorage`（第一方）；Session ID 独立。
- ✅ 国家：只读 Vercel 的 `x-vercel-ip-country` 头，**不反查、不存原始 IP**；如需限流，用"日盐 + IP"的短 TTL 哈希（1 小时后自动消失）。
- ✅ 搜索词：≤32 字符、trim、邮箱/手机正则脱敏；TTL 30 天。
- ✅ 保留期：明细/去重 1h；搜索词 30d；日桶 400d；提供清理任务（TTL 天然满足）。
- ✅ 尊重退出：`localStorage.jba_optout=1` 或 `?no-track` 即完全停采。

---

## 8. 响应头与传输安全

| 现状 | 问题 |
| --- | --- |
| `next.config.js:338-351` 全站 `ACAO: *` + `Credentials: true` | 语义矛盾；后台继承 |
| 无 CSP / X-Frame-Options / HSTS，相关段被注释（`next.config.js:391-401`） | 后台可被 iframe 嵌套（点击劫持） |
| `vercel.json` 的 `headers: []` | 无项目级补充 |

**`/admin` 目标响应头**（写进 `next.config.js` 的 `headers()`，规则更具体者优先）：

```text
Cache-Control: private, no-store, max-age=0
X-Robots-Tag: noindex, nofollow
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'
Access-Control-Allow-Origin: <同源，移除 *>
```

---

## 9. 新增管理员认证必须具备的安全控制（Phase 1 验收清单）

- [ ] **C1 fail-closed**：`ADMIN_*`/`SESSION_SECRET` 缺失或非法 → 503 + 明确日志，**任何分支都不放行**
- [ ] **C2 强 KDF**：bcrypt cost ≥12（或 scrypt）；`timingSafeEqual`；哈希/明文永不下发客户端
- [ ] **C3 opaque 服务端 Session**：32 字节随机；Redis 存 hash；Cookie 只放不透明 id
- [ ] **C4 Cookie 属性**：`HttpOnly; Secure; SameSite=Lax; Path=/admin`
- [ ] **C5 防固定**：登录成功轮换 sid；登出/改密删除；支持"登出所有设备"
- [ ] **C6 CSRF**：双提交 + Origin 校验；`SameSite=Lax` 仅作第二层
- [ ] **C7 登录限流（跨实例）**：Redis 计数；统一错误文案；Redis 不可用 → 拒绝登录
- [ ] **C8 写接口限流 + 幂等键**：`SET NX EX` 防重复提交
- [ ] **C9 审计日志**：append-only，90 天，无密码/完整 IP/cookie
- [ ] **C10 敏感操作二次确认**：改密、清缓存、触发同步要求重新输密码或短时提权
- [ ] **C11 响应头隔离**：§8 全套头
- [ ] **C12 错误不回显**：统一 `{error:'internal', requestId}`；细节只进服务端日志
- [ ] **C13 密钥只走 env + 构建产物扫描**
- [ ] **C14 常量时间比较 + token 不入 URL**
- [ ] **C15 现有弱接口先隔离**（`/api/cache`、`push/test`、`push/subscriptions`、`push/status`、`/admin/notify-status`）
- [ ] **C16 自动化测试**：C1/C3/C6/C7/C9 各有可执行用例（401/403/429/cookie 属性/CSRF 拒绝/审计落库）

---

## 10. 修复优先级与时机

| 优先级 | 项 | 何时 |
| --- | --- | --- |
| **P0** | F-01（`verifySecret` 只读 env；Notion 配置禁 `*SECRET*` 键）、F-04（fail-closed）、F-03（鉴权 + endpoint 白名单）、F-05（删除/改 write-only）、F-06（`notify-status` 纳入鉴权、`push/status` 只回 ok） | **Phase 1 一并**（都在 `/admin` 上线前完成） |
| **P1** | F-02（删日志/URL 泄漏）、F-07（新门禁 fail-closed）、F-08（`/admin` 头）、F-11（新建会话/限流/CSRF） | Phase 1 |
| **P2** | F-09（评论 PII 脱敏）、F-10（rank 加盐 + 限流） | Phase 2 前 |
| **P3** | F-12、F-13、F-14、F-15 | 随手修 |

---

## 11. 待管理员确认（安全相关）

1. **Q1** Vercel 是否配置 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`（决定 middleware 分支）。
2. **Q2** `CACHE_REVALIDATION_TOKEN` 是否配置（未配置 = `/api/cache` 正在对全世界开放）。
3. **Q3** `RANK_SEED_SECRET` / `REVALIDATION_TOKEN` 是否已配置；**是否被填进 Notion 配置表**（若是，立刻视为已泄漏并轮换）。
4. **Q4** `REDIS_URL` 是否配置（已由线上 `/admin/notify-status` 间接证实为"是"，但建议在 Vercel 侧确认）。
5. **Q5** `/api/push/*`、rank、notify、`/auth` 这些功能是否仍在使用（若不使用，**下线比加固更快**）。
6. **Q6** 是否允许 Phase 1 新增依赖（`bcryptjs`；`zod` 移到 dependencies）。
7. **Q7** 审计日志存储：仅 Redis，还是 Redis + Supabase 长期归档。

---

## 12. 结论

1. **不能复用现有鉴权**（Clerk fail-open + 模型错位）→ 必须自建 fail-closed 的一整套。
2. **最危险的不是新后台，而是现有 6 个公开弱点**（F-01/03/04/05/06）——建议在 Phase 1 与后台一起修，且新后台**绝不复制**这些模式。
3. **密钥通道只有一个正确选择**：`process.env` + 构建产物扫描；任何 `siteConfig()`/`NEXT_PUBLIC_`/Notion 配置表路径都会被序列化到页面。
4. **基础设施从零开始**：零 cookie/session/CSRF/限流；Redis 已在生产可用，是唯一现实的会话与限流后端。
5. 安全是 Phase 1 的**唯一验收主线**：功能可以少，控制不能缺。
