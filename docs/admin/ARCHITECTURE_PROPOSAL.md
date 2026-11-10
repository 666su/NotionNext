# Jason Blog Admin —— 集成式后台架构方案（Phase 0 输出）

- 目标：在**当前 NotionNext 项目内部**（同仓库、同 Vercel 项目、同域名）落地 `/admin` 管理后台，不改主题、不迁路由、不新建站点。
- 依据：本方案全部建立在 [AUDIT_REPORT.md](AUDIT_REPORT.md) 的实测结论之上；与 PROJECT_SPEC 的技术假设不一致处，在 §2 逐条列出并给出理由。
- 状态：**待管理员确认**。确认前不写任何生产代码。

---

## 1. 设计原则

| 原则 | 落地方式 |
| --- | --- |
| 零侵入公开站点 | 只改 `pages/_app.js`（加 admin 分支）、`middleware.ts`（加前置守卫）、`next.config.js`（加 `/admin` headers）；`themes/**`、`pages/[prefix]/**`、`lib/db/**`、`lib/cache/**` 一律只调用不修改 |
| fail-closed | 所有鉴权默认拒绝；环境变量缺失时后台**整体不可用**（返回 500 + 明确日志），而不是"缺 key 就放行"（现有 `middleware.ts:66` 正是 fail-open） |
| 三层鉴权 | ① Edge 中间件（签名校验 + 跳转）→ ② 页面 GSSP（Redis 会话校验）→ ③ 每个 API 端点独立校验（不依赖中间件） |
| 后台不进入缓存 | 所有后台页面 GSSP + `Cache-Control: no-store`；`next.config.js` 对 `/admin/:path*` 追加 `no-store` + `X-Robots-Tag: noindex` |
| 密钥只走 `process.env` | 禁止进 `blog.config.js` / `conf/*.config.js` / Notion 配置表（这些通道会进 `__NEXT_DATA__`，见 SECURITY_REVIEW F-01） |
| 统计不影响博客 | SDK 异步、失败静默、不重试风暴、总包 ≤ 3KB；采集端点异常一律 204 |
| 数据最小化 | 不存明文 IP、不存指纹、不存邮箱/评论正文；国家来自 Vercel 地理头，不反查 IP |

---

## 2. 与 PROJECT_SPEC 假设的偏差（必读）

| PROJECT_SPEC 假设 | 实测结论 | 本方案的处理 |
| --- | --- | --- |
| "Cloudflare Worker + D1 接收统计事件"（5.2） | **不可直接落地**：站点 DNS 在 Vercel（`NS=vercel-dns-017.com`），线上无 `cf-ray`，Cloudflare 只做图片代理；Vercel 函数**不能绑定 D1** | §6 给出三方案对比：**推荐 A（复用已配置的 Upstash Redis）**，C（Supabase）为升级路径，B（Worker+D1）标注为"需要先迁移 zone，暂不采用" |
| "Cloudflare Web Analytics 作为基础数据源"（5.3） | **当前未接入**，且站点不在 CF 代理后，拿不到 CF 边缘数据 | 不接入；若将来迁 CF 再评估 |
| "PV/UV 从现有统计读取" | 首页 HTML 实测**无任何统计脚本**；`rank:views` 只有累计值无日期 | 全部自建采集（§7） |
| 独立管理员账号密码 + Session | 现有鉴权是 Clerk（第三方托管、fail-open） | 自建（§5），Clerk 仅保留原会员中心用途 |
| 建议 SQL 表结构（5.5） | 生产无统计库；Supabase 只用于 Claude 热力图（2 张表，无迁移文件） | 按所选存储映射：A 用 Redis 键空间（§8.1），C 用本方案的 DDL（§8.2），字段语义与 PROJECT_SPEC 一一对应 |

---

## 3. 总体架构

```text
                       用户浏览器
                            │
        ┌───────────────────┴────────────────────┐
        │                                        │
   公开博客页面  /  /posts/*  /category/*      /admin/*  （仅管理员）
        │                                        │
        │ ① <Tracker/> 异步注入（仅公开页）        │ ② middleware 前置守卫（Edge，签名校验）
        ▼                                        ▼
  POST /api/track  （无鉴权、可写、限流）      /admin/login → GSSP 校验 → 建 Redis 会话
        │                                        │
        │ ③ 校验/去重/维度归类/地理头取国家         ▼
        ▼                                   /api/admin/*  （每个端点独立校验会话 + CSRF）
  ┌───────────────────────┐                      │
  │ 统计存储（方案 A：Redis）│◄──── 会话 / 限流 / 审计 同一 Redis 实例（不同键前缀）
  │ stats:v1:*            │                      │
  └───────────────────────┘                      ▼
        ▲                                   ┌────────────────────────────┐
        │ ⑥ 读取聚合（GSSP 内）               │ Notion 只读（复用 fetchGlobalAllData）
        └───────────────────────────────────│ 文章/分类/标签元数据 + 同步日志
                                             └────────────────────────────┘
```

关键点：

1. **后台不新建服务**：全部跑在现有 Vercel 项目（Node runtime 页面/API + Edge middleware）。
2. **统计接收端与后台分离**：`/api/track` 是公开可写端点（限流 + 校验），`/api/admin/*` 是鉴权端点，两者**不共享鉴权逻辑**，避免"统计端点被误认为可读后台数据"。
3. **Notion 永远单向只读**：后台不写 Notion（Phase 4 也只做同步读取）。

---

## 4. 目录与文件布局（全部为**新增**，除标注"改"的三个文件）

```text
pages/
├── _app.js                          ← 改：admin 路由分支（唯一影响公开渲染的改动）
├── admin/
│   ├── index.js                     ← 新增：入口（未登录→ /admin/login，已登录→ /admin/dashboard）
│   ├── login.js                     ← 新增：登录页（无侧边栏，独立样式）
│   ├── dashboard.js                 ← 新增
│   ├── analytics.js                 ← 新增
│   ├── visitors.js                  ← 新增
│   ├── behavior.js                  ← 新增
│   ├── articles.js                  ← 新增（含单篇详情抽屉）
│   ├── categories.js                ← 新增（分类 + 标签分析，Tabs）
│   ├── comments.js                  ← 新增
│   ├── seo.js                       ← 新增（未连接状态）
│   ├── health.js                    ← 新增
│   ├── settings.js                  ← 新增（改密、会话管理、统计保留期）
│   ├── notify-status.js             ← 保留路径，Phase 1 为其加鉴权（改）
│   └── [...index].js                ← 新增：/admin/* 未知路径兜底 404（避免落入 [prefix] 动态路由）
│
├── api/
│   ├── track.js                     ← 新增：统计接收（公开、限流、去重）
│   └── admin/
│       ├── login.js                 ← POST：登录（限流 + 失败计数）
│       ├── logout.js                ← POST
│       ├── session.js               ← GET：当前会话信息（供前端判断）
│       ├── password.js              ← POST：改密（旧会话全部失效）
│       ├── overview.js              ← GET：Dashboard 指标
│       ├── timeseries.js            ← GET：趋势（PV/UV/Session）
│       ├── breakdown.js             ← GET：维度分布（来源/设备/浏览器/系统/国家）
│       ├── articles.js              ← GET：文章表现列表 + 排行
│       ├── article/[id].js          ← GET：单篇趋势与阅读深度
│       ├── taxonomy.js              ← GET：分类/标签聚合
│       ├── comments.js              ← GET：Twikoo 评论数（或"不可用"状态）
│       ├── health.js                ← GET：站点/数据源健康
│       ├── audit.js                 ← GET：审计日志
│       └── sync/notion.js           ← POST：手动触发 Notion 同步（限频）
│
components/admin/
├── AdminShell.js                    ← 侧边栏 + 顶栏 + 内容区（脱离主题）
├── AdminGuard.js                    ← 客户端兜底（服务端已鉴权，前端只处理 401 跳转）
├── StatCard.js
├── TimeRangePicker.js               ← 今日/昨日/近7/近30/近90/自定义
├── LineChart.js                     ← 零依赖 SVG 折线（多序列）
├── BarChart.js                      ← 零依赖 SVG 柱状
├── DonutChart.js                    ← conic-gradient 环图
├── DataTable.js                     ← 排序/分页/空状态
├── EmptyState.js / ErrorState.js / LoadingState.js
├── RankList.js                      ← 热门文章等排行
└── Tag.js / Badge.js / Toolbar.js

lib/
├── admin/
│   ├── config.js                    ← 读取 ADMIN_* / SESSION_* 并做"缺失即抛错"校验
│   ├── password.js                  ← bcryptjs 封装（hash/verify，cost=12）
│   ├── session.js                   ← 创建/校验/续期/销毁（Redis；Edge 可用部分是纯 Web Crypto）
│   ├── csrf.js                      ← 双提交令牌 + Origin 校验
│   ├── rate-limit.js                ← Redis 计数限流（登录/改密/同步/track）
│   ├── audit.js                     ← 审计日志（Redis List，90 天）
│   ├── respond.js                   ← 统一 JSON 响应与状态码（401/403/429/500）
│   └── sync/notion-sync.js          ← 文章/分类/标签同步 + 同步日志
└── analytics/
    ├── client/tracker.js            ← 浏览器 SDK（≤3KB，独立 chunk）
    ├── events.js                    ← 事件白名单与字段校验（与 SDK 共享常量）
    ├── ingest.js                    ← 服务端落库（去重、维度归类、地理头）
    ├── aggregate.js                 ← 读取聚合（时间窗/维度）
    └── storage-redis.js             ← 方案 A 的键规范实现

conf/admin.config.js                 ← 新增独立配置（会话时长、限流阈值、保留期、开关）
styles/admin.css                     ← 新增（后台独立样式，`.admin-scope` 作用域）
```

> **Tailwind 陷阱**：`tailwind.config.js:5-10` 只扫 `**/*.js`。后台文件统一 `.js`；若必须 `.tsx`，需同时改 `tailwind.config.js`（额外一处生产改动，需审批）。

---

## 5. 认证与访问控制方案

### 5.1 方案选型

| 候选 | 结论 | 理由 |
| --- | --- | --- |
| 复用 Clerk | **不采用** | 凭据托管第三方（与"独立账号密码"冲突）；现有集成 fail-open（`middleware.ts:66`）；`isTenantAdminRoute` 只覆盖两个子路径；权限模型是 org permission；审计日志落第三方 |
| Cloudflare Access | 不采用（可作第二层） | 站点不在 CF 代理后，无前提 |
| **自建 bcryptjs + Redis 会话** | **采用** | 唯一符合"独立账号密码 + 服务端会话 + 可控审计"的路径 |

### 5.2 密码学与依赖

| 项 | 选择 | 说明 |
| --- | --- | --- |
| 密码哈希 | **bcryptjs（cost 12）** | 纯 JS，无 native 构建，Vercel 安全；`@node-rs/argon2` 虽有 native 产物但平台匹配/体积风险高，不作为首选 |
| 依赖成本 | 新增 1 个依赖（`bcryptjs`，约 40KB 服务端-only） | 需同 PR 提交 `yarn.lock`（`.github/workflows/ci.yml:40-46` 会校验）；若管理员不同意新增依赖，退化方案：`node:crypto.scrypt`（N=2^15, r=8, p=1，同样满足"安全 KDF"要求，但不是 Argon2id/bcrypt，需管理员书面确认） |
| 会话标识 | `crypto.randomBytes(32)` → base64url | 不可预测；服务端只存 **SHA-256(token)**，数据库泄露也不可直接复用 |
| Cookie 签名 | HMAC-SHA256(`sid`, `SESSION_SECRET`) | Edge middleware 可用 `crypto.subtle` 校验，无需访问 Redis |
| 常量时间比较 | `crypto.timingSafeEqual` | 修复现有 `!==` 比较（F-12） |

### 5.3 会话模型

```text
Cookie: jba_sid = <sid>.<hmac>   HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200
Redis : admin:sess:<sha256(sid)> = { uid, createdAt, lastSeenAt, expiresAt, ipHash, uaHash }
索引  : admin:sess:uid:<uid> (Set) → 用于"改密后使全部会话失效"
```

| 规则 | 取值 | 配置项 |
| --- | --- | --- |
| 空闲超时 | 30 分钟（每次校验滑动续期，但不超过绝对有效期） | `ADMIN_SESSION_IDLE_MIN` |
| 绝对有效期 | 12 小时 | `ADMIN_SESSION_TTL_HOURS` |
| 登录成功 | **销毁旧会话 → 签发新 sid**（防 Session Fixation） | — |
| 改密成功 | 删除该 uid 全部会话 → 强制重新登录 | — |
| 登出 | Redis DEL + 清除 Cookie | — |
| 会话失效 | 返回 401 JSON（API）/ 302 `/admin/login?next=`（页面） | — |
| 存储 | Redis（Vercel 多实例无状态，**不能用内存**） | 复用 `REDIS_URL` |

### 5.4 三层鉴权

**第 1 层：`middleware.ts` 前置守卫（Edge）**

```ts
// 伪代码：包在现有 authMiddleware 之外，保持 Clerk/noAuth 两分支语义不变
const isAdmin = createRouteMatcher(['/admin(.*)', '/api/admin(.*)'])
const isPublicAdmin = createRouteMatcher(['/admin/login', '/api/admin/login'])
export default function middleware(req, ev) {
  if (isAdmin(req) && !isPublicAdmin(req)) {
    const ok = verifySignedCookie(req.cookies.get('jba_sid'), SESSION_SECRET) // Web Crypto，无 Redis
    if (!ok) return req.nextUrl.pathname.startsWith('/api/')
      ? NextResponse.json({ error: 'unauthorized' }, { status: 401 })
      : NextResponse.redirect(new URL('/admin/login', req.url))
  }
  return authMiddleware(req, ev)
}
```

- Edge 限制：**不得** import `ioredis` / `fs` / `path` / `node:crypto`（用 `crypto.subtle`）。
- 中间件只是"乐观闸门"（挡住绝大多数未登录请求），**不作为安全边界**。

**第 2 层：页面 GSSP**

```js
export async function getServerSideProps(ctx) {
  const auth = await requireAdmin(ctx)            // Redis 校验 + 滑动续期
  if (!auth.ok) return redirectToLogin(ctx)       // 302
  ctx.res.setHeader('Cache-Control', 'no-store')
  return { props: { admin: auth.publicUser } }
}
```

**第 3 层：每个 `/api/admin/*` 独立校验**（不依赖中间件）

```js
const auth = await requireAdmin(req)          // 会话 + CSRF（写操作）+ Origin
if (!auth.ok) return res.status(auth.status).json({ error: auth.code })
```

> 这是 PROJECT_SPEC 2.4 的硬要求：**禁止只靠前端隐藏或页面跳转**。任何后台 API 未通过校验一律 401/403，且**不返回任何统计数值**。

### 5.5 登录安全

| 控制 | 实现 | 说明 |
| --- | --- | --- |
| 失败限流 | `admin:rl:login:<ipHash>` 与 `admin:rl:login:<userHash>` 双维度 INCR，TTL 900s | 5 次失败 → 冷却 15 分钟；**冷却仅作用于登录端点**，绝不封禁公开页面 |
| 账号锁死 | **不做永久锁死** | 冷却到期自动恢复（符合 PROJECT_SPEC 2.5） |
| 用户名枚举 | 统一错误文案 + 恒定耗时（即使 user 不存在也跑一次 bcrypt 对比 dummy hash） | — |
| 记录 | 成功/失败都写审计日志（`ipHash`、`uaHash`，不存原始值） | — |
| 初始账号 | 首次登录时若 Redis 无管理员记录 → 用 `ADMIN_USERNAME` + `ADMIN_PASSWORD_HASH`（env）引导写入 | env 只做"引导"，之后以 Redis 为准；改密后 env 值失效 |
| 一次性初始化（可选） | `/admin/login?init=<ADMIN_INIT_TOKEN>` 允许设置一次密码；写入成功后该入口永久拒绝（Redis 标记 `admin:bootstrapped=1`） | 满足 PROJECT_SPEC 2.2"初始化完成后关闭入口" |
| CSRF | 双提交：`admin_csrf` cookie（非 HttpOnly）+ `x-csrf-token` header；写操作全部校验；另校验 `Origin`/`Referer` | 覆盖所有 POST |
| 审计日志 | `admin:audit`（Redis List，LTRIM 5000，TTL 90d）：登录/登出/改密/同步/导出 | 后台"审计日志"页可读 |

### 5.6 安全控制清单（Phase 1 验收对照）

- [ ] 未登录访问 `/admin/*` → 302 `/admin/login?next=...`
- [ ] 未登录访问 `/api/admin/*` → **401 JSON**（不是 HTML 登录页）
- [ ] 伪造/篡改 Cookie → 401（签名校验失败）
- [ ] 会话过期（空闲 30min / 绝对 12h）→ 401 + 跳登录
- [ ] 改密后旧会话立即失效
- [ ] 登出后 Cookie 与服务端记录都清除
- [ ] 登录失败 5 次 → 429 冷却，且公开页面不受影响
- [ ] 写操作缺 CSRF → 403
- [ ] 所有后台响应 `Cache-Control: no-store` + `X-Robots-Tag: noindex`
- [ ] 后台代码中不出现任何 `NEXT_PUBLIC_` 前缀的密钥
- [ ] `SESSION_SECRET`/`ADMIN_PASSWORD_HASH` 缺失时后台返回 500 并打日志（fail-closed），**不降级为放行**
- [ ] 审计日志可查（时间/动作/结果，无原始 IP）

---

## 6. 统计服务与存储方案

### 6.1 三种存储方案对比（实测约束）

| 维度 | **A. 复用 Upstash Redis（推荐）** | B. Cloudflare Worker + D1 | C. Supabase Postgres |
| --- | --- | --- | --- |
| 当前是否就绪 | ✅ 生产已配置（`/admin/notify-status` 实测 `storage=redis`） | ❌ 需 CF 托管 zone + 新子域 + 新 Worker | ⚠️ 依赖已在，但仅用于 Claude 热力图；统计表需新建 |
| Vercel 可否直连 | ✅ `ioredis` 已存在 | ❌ **不能绑 D1**（只能 Workers 写或走 REST） | ✅ HTTPS |
| 多维查询（来源×设备×国家×深度） | 需按"日 × 维度"预聚合（本方案已定义键规范，够用） | SQL 强 | SQL 强 |
| 任意时间窗 | 按日键求和 / HLL 合并（≤90 天约 90×N 次读） | SQL 强 | SQL 强 |
| 地理数据 | 用 Vercel 注入的 `x-vercel-ip-country` 头（**不落 IP**；需 Phase 2 在生产实测确认该头存在，否则该维度显示"未采集"） | 边缘 `request.cf.country` | 同 A |
| 与现有链路冲突 | 中：与 ISR 缓存/rank/notify 共库 → 用独立 `stats:v1:*` 前缀 + TTL 隔离 | 低（旁路） | 低 |
| 成本 | 已在付费/免费额度内；命令数需监控 | D1 免费额度最宽 | 免费 500MB，但闲置会 pause |
| 运维 | Upstash 控制台 | wrangler / CF 控制台 | Supabase Studio |
| 主要风险 | 命令配额、缓存被 eviction | **架构前提不成立** | 跨境写入延迟、service key 泄露面、pause |

### 6.2 推荐：方案 A（Redis 日桶 + HLL），C 作为升级路径

**采用 A 的理由**（按权重）：

1. **零新增基础设施**：`REDIS_URL` 已在生产配置并被 ISR 缓存/rank/notify 使用，`ioredis` 已是依赖 → 不新增账号、不新增密钥、不新增账单。
2. **满足 Phase 3 全部指标**：PV/UV/Session/来源/设备/浏览器/系统/国家/阅读深度/搜索/实时活跃，本质都是"日 × 维度"的计数，Redis 的 `INCR`/`PFADD`/`HINCRBY` 正好覆盖；任意时间窗 = 按日键求和。
3. **无跨境写延迟**：Upstash 走 TLS 单次 RTT，比 Postgres INSERT 更轻；且可用 `sendBeacon` + 批量 pipeline 降低往返。
4. **不触碰现有语义**：独立 `stats:v1:*` 前缀，不复用 `rank:views`（那是"累计去重 PV"，无日期维度）。

**触发升级到 C 的阈值**（写进 `conf/admin.config.js` 注释与运维文档）：

- 日 PV > 2,000（Upstash 免费档 10k 命令/日的量级）；
- 需要"按会话/访客路径的任意 SQL 分析"或需要保留 > 400 天明细；
- 需要与未来会员/订单数据 join。

**方案 B 不采用的原因**：需要把某个子域委派给 Cloudflare（当前 zone 在 Vercel DNS）、新建 Worker 与采集域名，属于"新增一套基础设施"，与"在现有项目内部集成、不新建站点"的前提冲突；且 Vercel 侧写入只能走公网 REST，反而增加延迟与密钥面。**若将来整站迁到 Cloudflare（橙色云），D1 会是更优选择**——届时只需更换 `lib/analytics/storage-*.js` 实现。

### 6.3 事件契约（服务端强制校验）

```json
{
  "event_id": "01J…（客户端随机，服务端 SETNX 去重 1h）",
  "event_name": "page_view | session_start | article_read | scroll_depth |
                 article_complete | search | category_click | tag_click |
                 outbound_click | share_click | comment_submit | mascot_interaction",
  "anonymous_id": "uuid-v4（localStorage，第一方）",
  "session_id": "uuid-v4（sessionStorage，30 分钟无活动轮换）",
  "page_path": "/posts/example",
  "article_id": "Notion page uuid（可空）",
  "occurred_at": "ISO-8601",
  "props": { "depth": 25, "query": "…（仅 search，≤32 字符，已脱敏）", "target_host": "github.com" }
}
```

服务端校验（`lib/analytics/events.js`）：事件名白名单、字段类型、`page_path` 正则 `^/[^\s]{0,200}$`、`article_id` 必须匹配 uuid、`props` 体积上限、请求体 ≤ 8KB、每 IP 每分钟 ≤ 60 事件、`event_id` 去重。**校验失败静默丢弃并计数，不回显原因**。

### 6.4 关键指标口径（写进代码注释与文档，避免混淆）

| 指标 | 定义 | 实现 |
| --- | --- | --- |
| **PV** | 一次有效 `page_view` 事件（同一页面重复访问重复计数） | `INCR stats:v1:pv:{date}`（+ 文章维度键） |
| **UV** | 统计周期内**去重的匿名访客数**，非真实自然人 | `PFADD stats:v1:uv:{date}`（HyperLogLog，误差 ~0.81%）；跨日合并用 `PFCOUNT k1 k2 …` |
| **Session** | 连续 30 分钟无活动即结束的访问会话 | 客户端 30 分钟滑动窗口生成新 `session_id`；服务端 `INCR stats:v1:sess:{date}`（每个 session 首事件触发一次，`SETNX` 去重） |
| **实时活跃** | **最近 5 分钟内有事件的 Session 估算**（页面必须如此标注） | `PFADD stats:v1:active:{yyyymmddHHmm}`（TTL 12min），查询时 `PFCOUNT` 最近 5 个键 |
| **阅读深度** | 25/50/75/90% 阈值各上报一次的直方图 | `INCR stats:v1:depth:{date}:{25|50|75|90}` |
| **阅读完成率** | 达到 90% 的文章会话占比 | `depth:90` / `article_read` |
| **停留 vs 阅读时间** | **明确区分**：停留 = 页面可见时长；阅读时间 = 可见且发生滚动/交互的时长 | 两者分别上报，不互相换算 |

> **禁止**：把未采集到的指标计算成 0 并展示为"真实数据"。无数据 → 显示空状态（见 §9）。

### 6.5 写入路径（不拖慢博客）

```text
page_view 触发
  → tracker.js：内存队列（≤20 条或 5s flush，取先到者）
  → navigator.sendBeacon('/api/track', blob)   // 页面卸载也能送达
  → 失败：仅一次指数退避重试，再失败丢弃（**不循环重试**）
/api/track
  → 校验 → 去重 → 维度归类 → pipeline 写 Redis（MULTI，1 次 RTT）
  → 任何异常：return 204（绝不影响博客）
```

`tracker.js` 约束：`next/dynamic({ ssr:false })` 挂载，`requestIdleCallback` 延后初始化；gzip 后 ≤ 3KB；**仅公开页面加载**（`_app` 的 admin 分支天然排除后台，后台自身不上报）。

### 6.6 聚合与清理

- **聚合 = 读时求和**：Phase 3 的图表直接对"日键"做 `MGET`/`PFCOUNT` 合并（近 90 天最多 90×维度 次读，可接受）；不需要 Cron。
- **清理 = TTL**：明细/去重键 1h；搜索词 30 天；日桶 400 天；实时键 12 分钟。
- **可选**：每日快照（`stats:v1:snapshot:{date}` 存一份 JSON 汇总）便于长期保留聚合结果，成本 1 次写。
- 若将来切到 Supabase（C）：保留同一套聚合读取接口，仅替换 `storage-*.js` 实现 + 增加"夜间批量写入/清理"任务。

### 6.7 配额与失败模式

| 场景 | 行为 |
| --- | --- |
| Redis 不可用 | `/api/track` 返回 204；后台统计页显示"存储不可用"错误态；登录接口返回 503（fail-closed） |
| 命令配额超限 | 记录一次告警日志 + 后台"健康"页显示配额提示；不影响博客 |
| 刷量 | 每 IP 60 事件/分钟 + `event_id` 去重 + `anonymous_id` 频次阈值；超限丢弃并计数 |
| 键膨胀 | 全部键带 TTL；`stats:v1:*` 与 ISR 缓存键空间隔离，避免挤掉缓存 |

---

## 7. 统计 SDK 设计

| 要求（PROJECT_SPEC 六） | 实现 |
| --- | --- |
| 不明显增加加载时间 | 独立 chunk + `requestIdleCallback` + `sendBeacon`；≤3KB gzip；首屏不阻塞 |
| 支持 Next.js 客户端路由 | 监听 `router.events.routeChangeComplete`，按 `(path, articleId)` 去重（同一路径 1s 内只报一次） |
| 重复上报防护 | 客户端 `event_id` + 服务端 `SETNX`；SPA 回退/前进不重复计 |
| 网络失败不影响博客 | 全程 try/catch，`sendBeacon` 失败即丢弃；不弹窗、不阻塞 |
| 匿名标识 | `jba_aid` = `crypto.randomUUID()`（localStorage，第一方）；**不使用 IP/指纹/邮箱** |
| Session | `sessionStorage` 保存 `session_id` + `lastActivity`；>30 分钟新会话并补发 `session_start` |
| 隐私 | 提供 `?no-track`/`localStorage.jba_optout=1` 关闭；`Do Not Track` 尊重（可选开关） |
| 搜索词 | 仅存 ≤32 字符、去首尾空白、邮箱/手机号正则脱敏后的文本；TTL 30 天 |
| 评论 | 只上报 `comment_submit` 事件，**不含正文/邮箱/昵称** |
| 桌宠 | `mascot_interaction` 事件在桌宠上线后接入；当前代码里 `components/BlogPet/` 存在但需确认线上是否启用 |

---

## 8. 数据模型

### 8.1 方案 A：Redis 键规范（主实现）

```text
# 计数器（TTL 400d）
stats:v1:pv:{yyyymmdd}                      # 全站日 PV
stats:v1:pv:{yyyymmdd}:{articleId}          # 文章日 PV
stats:v1:sess:{yyyymmdd}                     # 日 Session 数
stats:v1:dim:{yyyymmdd}:{src|dev|os|br|geo}:{value}   # 维度桶（值枚举化）
stats:v1:depth:{yyyymmdd}:{25|50|75|90}      # 阅读深度直方图
stats:v1:search:{yyyymmdd}                   # 搜索次数
stats:v1:searchq:{yyyymmdd}  (Hash, 30d)     # 搜索词 → 次数（已脱敏）
stats:v1:outbound:{yyyymmdd}  (Hash)         # 外链域名 → 次数
stats:v1:share:{yyyymmdd}  (Hash)            # 分享渠道 → 次数

# 去重 / 实时（短 TTL）
stats:v1:evt:{event_id}          (1h)        # 事件去重
stats:v1:sessseen:{sessionId}    (30m)       # Session 首事件标记
stats:v1:active:{yyyymmddHHmm}   (12m)       # 实时活跃 HLL
stats:v1:uv:{yyyymmdd}           (400d)      # 全站日 UV（HLL）
stats:v1:uv:{yyyymmdd}:{articleId} (400d)    # 文章日 UV（HLL）

# 文章索引（无 TTL，随同步更新）
stats:v1:art:{articleId}   (Hash)  # title/slug/url/category/tags/publishedAt/updatedAt/syncedAt
stats:v1:slugmap           (Hash)  # 历史 slug → articleId（保证改名/改 URL 不丢历史）
```

**映射 PROJECT_SPEC 5.5**：`articles`→`stats:v1:art:*` + `stats:v1:slugmap`；`analytics_events`→去重键 + 日桶（明细不长期保存，符合 §七 保留 30–90 天要求）；`analytics_daily`→`stats:v1:pv|uv|sess:{date}`；`article_daily_stats`→`stats:v1:pv|uv:{date}:{articleId}` + `depth`；`traffic_sources`/`geo_daily_stats`→`stats:v1:dim:*`；`search_events`→`stats:v1:searchq:*`（哈希 + 脱敏，不存原始 query）；`data_sync_logs`→`stats:v1:sync:log`（List，200 条）；`admin_users`→`admin:user:{username}`（Hash）；`admin_sessions`→`admin:sess:*`；`admin_audit_logs`→`admin:audit`（List）。

### 8.2 方案 C：Postgres（升级路径，DDL 摘要）

```sql
create table articles (
  id text primary key,                 -- = notion page id（稳定关联）
  notion_id text unique not null,
  slug text, url text, title text not null,
  category text, tags text[],
  published_at timestamptz, updated_at timestamptz, sync_at timestamptz
);
create table analytics_events (        -- 明细保留 60 天，靠定时清理
  id text primary key, event_name text not null, article_id text,
  session_id text, anonymous_id text, page_path text,
  occurred_at timestamptz not null, dims jsonb
);
create index on analytics_events (occurred_at);
create index on analytics_events (article_id, occurred_at);
create table analytics_daily (
  date date not null, page_path text not null,
  views int default 0, visitors int default 0, sessions int default 0,
  primary key (date, page_path)
);
create table article_daily_stats (
  date date not null, article_id text not null,
  views int default 0, visitors int default 0, avg_read_depth real default 0,
  primary key (date, article_id)
);
create table traffic_sources (date date, source text, medium text, visitors int);
create table geo_daily_stats (date date, country_code text, visitors int);
create table search_events (id text primary key, query_hash text, occurred_at timestamptz);
create table data_sync_logs (id text primary key, source text, started_at timestamptz,
  finished_at timestamptz, status text, error_message text);
create table admin_users (id text primary key, username text unique not null,
  password_hash text not null, role text not null, created_at timestamptz, updated_at timestamptz);
create table admin_sessions (id text primary key, user_id text not null,
  expires_at timestamptz not null, created_at timestamptz);
create table admin_audit_logs (id text primary key, user_id text, action text not null,
  resource text, created_at timestamptz);
```

约束：`articles.notion_id` 唯一索引；`analytics_daily` / `article_daily_stats` 复合主键；`admin_sessions.expires_at` 索引；所有迁移脚本入库 `docs/admin/migrations/*.sql` 并可回滚。

---

## 9. UI 与交互约定

- **外壳**：左侧固定侧边栏（数据总览 / 流量 / 访客 / 行为 / 内容管理〔文章·分类·标签〕/ 评论 / SEO / 健康 / 设置），顶栏显示站点名 + 当前管理员 + 退出。
- **主题**：桌面优先，`md` 以下侧边栏折叠为抽屉；深色跟随 `_document` 注入的 `.dark` class（Tailwind `dark:`）。
- **时间筛选**：今日 / 昨日 / 近 7 天 / 近 30 天 / 近 90 天 / 自定义，**每个指标卡标注统计周期**。
- **状态**：加载（骨架屏）、空（说明"尚无数据，统计自 X 时刻开始采集"）、错误（可重试）、未连接（SEO/GSC 等显示"未连接"，**不伪造**）。
- **明确标注**：实时活跃写"最近 5 分钟活跃会话估算"，不写"在线人数"；UV 写"匿名访客估算"。
- **图表**：零依赖 SVG（`LineChart`/`BarChart`/`DonutChart`），≤90 个数据点，避免引入图表库。

---

## 10. 对现有博客零影响的保证（逐条可验证）

| 验证项 | 方法 |
| --- | --- |
| 首页/文章/分类/标签/搜索/归档/系列 | 上线前后同一组 URL 的 HTML 结构 diff（去掉时间戳/nonce）；状态码与 `x-vercel-cache` 一致 |
| 评论（Twikoo） | 文章页评论区仍能加载 CDN 并提交（人工冒烟） |
| 桌宠 / 主题切换 / 暗色 | 首页交互冒烟 |
| SEO | `sitemap.xml`、`robots.txt`、`rss`、canonical/og 不变；`/admin*` 不出现在 sitemap 与 robots 的 Allow 列表 |
| 构建 | `yarn lint`、`yarn type-check`、`yarn test`、`yarn build`、lockfile 校验全绿 |
| 后台不可被缓存/收录 | `curl -I /admin/dashboard` → `cache-control: no-store`、`x-robots-tag: noindex`；CDN 命中 MISS |
| 统计不拖慢 | Lighthouse / `perf:baseline` 前后对比，LCP 波动在噪声内；`tracker.js` ≤3KB |

---

## 11. 阶段计划（每阶段结束后暂停待确认）

| 阶段 | 交付 | 必改文件 | 验收要点 |
| --- | --- | --- | --- |
| **Phase 1** | 登录/登出/改密、会话、限流、审计、后台外壳、空 Dashboard | 新增 `pages/admin/**`、`pages/api/admin/**`、`lib/admin/**`、`components/admin/**`；改 `_app.js`、`middleware.ts`、`next.config.js` | §5.6 全部勾选；公开页面 0 回归；构建全绿 |
| **Phase 2** | 采集端点、SDK、去重、会话、维度归类、清理 | 新增 `pages/api/track.js`、`lib/analytics/**`、`components/Tracker` | 真实访问产生数据；SPA 不重复；无明文 IP；Redis 故障不影响博客 |
| **Phase 3** | Dashboard / Analytics / Visitors / Behavior / Articles 五页接真实数据 | 后台页面 + `/api/admin/{overview,timeseries,breakdown,articles}` | 口径可核对（PV/UV/Session 与原始事件对账）；时间窗不串数据 |
| **Phase 4** | Notion 同步（只读）、分类标签聚合、Twikoo 评论数、同步日志 | `lib/admin/sync/**`、`/api/admin/sync/notion`、`/api/admin/taxonomy`、`/api/admin/comments` | Page ID 稳定关联；改名不丢历史；同步失败可见 |
| **Phase 5** | GSC、健康检查、失效链接、AI 预留 | `/api/admin/health/*`、SEO 页 | 未连接不伪造；检查频率可控 |

---

## 12. 需要管理员确认的 6 项决策

1. **统计存储**：采用方案 A（复用现有 Upstash Redis，推荐）还是方案 C（Supabase Postgres）？
2. **新增依赖**：是否允许 Phase 1 引入 `bcryptjs`（+ `yarn.lock`）？若不允许，改用 `node:crypto.scrypt`（需确认"非 Argon2id/bcrypt"可接受）。
3. **生产环境真实配置**：Vercel 是否配了 `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`、`RANK_SEED_SECRET`、`CACHE_REVALIDATION_TOKEN`、`SUPABASE_*`？（决定守卫分支与 F-01 处置）
4. **Twikoo 形态**：腾讯云 envId 还是自建？决定 `/admin/comments` 走云函数只读还是数据库只读。
5. **Cloudflare 归属**：是否愿意为统计新建子域并委派给 Cloudflare？（若"否"，方案 B 永久排除）
6. **数据保留期**：明细 60 天 / 日桶 400 天 / 搜索词 30 天，是否接受？

---

## 13. 风险登记（与 AUDIT_REPORT §7 对应）

| 风险 | 缓解 |
| --- | --- |
| `_app.js` 改动影响全站 | 分支只判断 `pathname`；默认路径代码逐行不变；上线前全站回归 |
| 后台页面被缓存 | GSSP + `no-store` + `X-Robots-Tag`；CI 加 grep 守卫（禁止 `getStaticProps` 出现在 `pages/admin/`） |
| Redis 配额/eviction | 独立前缀 + TTL + 批量 pipeline + 健康页配额提示 + 达阈值迁 C |
| 现有公开泄露面（F-01/03/04/05/06） | Phase 1 一并修复（详见 SECURITY_REVIEW §8.2） |
| 上游 fork 同步覆盖 | 后台代码集中在上游不存在的目录；同步前人工 diff |
| 统计 SDK 影响性能 | 空闲加载 + 3KB 上限 + 采样开关 + 前后性能对比 |

---

**下一步**：等待管理员对 §12 六项决策给出答复并明确"进入 Phase 1"。未确认前不产生任何生产代码改动。
