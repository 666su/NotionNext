# API 文档 —— Jason Blog Admin（Phase 1–6）

- 基础路径：同源 `/api/admin/*`
- 认证方式：服务端 opaque 会话，Cookie `jba_sid`（`HttpOnly; Secure; SameSite=Lax; Path=/`）
- 写操作必须有 CSRF：请求头 `x-csrf-token`，值等于 `jba_csrf` Cookie（双提交）
- 响应：JSON；失败统一 `{ "error": "<code>" }`，**不返回堆栈、不返回内部路径**
- 所有响应带 `Cache-Control: private, no-store` 与 `X-Robots-Tag: noindex`

> 约定：除 `login` / `init` 外，**每个端点都在服务端独立校验会话**，不依赖前端跳转或 middleware。

---

## 1. 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `invalid_credentials` | 登录参数缺失 |
| 400 | `missing_fields` | 必填字段缺失 |
| 400 | `weak_password` | 新密码强度不足（附 `message`） |
| 400 | `current_password_invalid` | 当前密码不正确 |
| 400 | `password_unchanged` | 新密码与当前密码相同 |
| 401 | `unauthorized` | 未登录 / 会话不存在 |
| 401 | `session_expired` | 会话已过期（空闲或绝对有效期） |
| 403 | `csrf_failed` | 缺少或不匹配 CSRF token / Origin 不匹配 |
| 403 | `init_disabled` | 未配置 `ADMIN_INIT_TOKEN` |
| 403 | `invalid_token` | 初始化 token 不匹配 |
| 405 | `method_not_allowed` | 方法不允许（响应头含 `Allow`） |
| 409 | `already_initialized` | 已完成初始化，初始化入口关闭 |
| 429 | `too_many_attempts` | 登录限流（响应头 `Retry-After` + body `retryAfter`） |
| 503 | `admin_unconfigured` | 环境变量缺失（body 含 `missing` 列表） |
| 503 | `admin_disabled` | `ADMIN_ENABLE=false` |
| 503 | `session_store_unavailable` | Redis 不可用（**fail-closed**） |

---

## 2. POST `/api/admin/login`

公开端点。成功后轮换会话、下发两个 Cookie。

**请求**

```json
{ "username": "admin", "password": "********", "next": "/admin/dashboard" }
```

`next` 可选，仅接受以 `/admin` 开头的站内路径（防开放重定向）。

**成功 200**

```json
{
  "ok": true,
  "redirect": "/admin/dashboard",
  "user": { "username": "admin", "role": "admin" },
  "csrfToken": "…"
}
```

`Set-Cookie`：`jba_sid=<sid>.<HMAC>; Path=/; Max-Age=43200; HttpOnly; Secure; SameSite=Lax`，同时下发 `jba_csrf`（非 HttpOnly，供前端读取）。

**失败**

- `401 invalid_credentials`：用户名或密码错误（**不区分账号是否存在**，且用户名不匹配时也跑一次哈希比较）
- `429 too_many_attempts`：默认 5 次/15 分钟/账号、20 次/15 分钟/IP
- `503 admin_unconfigured` / `session_store_unavailable`

---

## 3. POST `/api/admin/logout`

需要会话 + CSRF。

**成功 200** `{ "ok": true }`，同时清除 `jba_sid` 与 `jba_csrf`。

---

## 4. GET `/api/admin/session`

需要会话。

**成功 200**

```json
{
  "ok": true,
  "user": { "username": "admin", "role": "admin" },
  "csrfToken": "…",
  "session": { "createdAt": 0, "lastSeenAt": 0, "expiresAt": 0 },
  "store": "redis",
  "warnings": []
}
```

`store` 为 `redis` 或 `memory`（后者只可能出现在本地开发）。

---

## 5. POST `/api/admin/password`

需要会话 + CSRF。敏感操作，要求提供当前密码。

**请求**

```json
{ "currentPassword": "********", "newPassword": "********" }
```

**成功 200**

```json
{ "ok": true, "relogin": true }
```

副作用：`admin:user:<username>` 更新为新哈希；该管理员**全部会话被删除**（含当前）；响应清除 Cookie。

**失败**

- `400 current_password_invalid`：当前密码错误
- `400 weak_password`：长度 < 12、或未同时包含字母与数字、或包含用户名
- `400 password_unchanged`：新旧相同

---

## 6. POST `/api/admin/init`

公开端点（仅用于一次性初始化）。**仅当存储中还没有管理员记录**时可用。

**请求**

```json
{ "token": "<ADMIN_INIT_TOKEN>", "username": "admin", "password": "********" }
```

**成功 201** `{ "ok": true, "login": "/admin/login" }`

**失败**

- `403 init_disabled`：未配置 `ADMIN_INIT_TOKEN`
- `403 invalid_token`：token 不匹配（常量时间比较）
- `409 already_initialized`：已有记录，入口永久关闭
- `400 username_not_allowed`：用户名与 `ADMIN_USERNAME` 不一致
- `400 weak_password`：强度不足

> 初始化成功后，该入口因"已有记录"而永久返回 409，符合"初始化完成后关闭入口"的要求。

---

## 7. GET `/api/admin/audit?limit=50`

需要会话。返回最近的操作记录（新 → 旧），最多 200 条。

**成功 200**

```json
{
  "ok": true,
  "entries": [
    {
      "at": "2026-11-09T10:00:00.000Z",
      "action": "login.success",
      "result": "ok",
      "user": "admin",
      "ipHash": "…(24 位，无法反查)",
      "uaHash": "…(16 位)",
      "detail": null
    }
  ]
}
```

记录的 action：`login.success`、`login.failure`、`login.rate_limited`、`logout`、`password.change`、`init.success`、`init.attempt`。

**不记录**：密码、明文 IP、Cookie、token、请求体。

---

## 8. 页面路由（GSSP 鉴权）

| 路径 | 说明 |
| --- | --- |
| `/admin` | 已登录 → `/admin/dashboard`；未登录 → `/admin/login?next=/admin` |
| `/admin/login` | 登录页；已登录直接跳转；配置缺失时整页提示并返回 503 |
| `/admin/dashboard` | 数据总览（Phase 3 接数据） |
| `/admin/analytics` `/visitors` `/behavior` | 占位（未接入真实数据，无模拟值） |
| `/admin/articles` `/categories` | Phase 3/4 已接入真实数据（含 Notion 只读同步入口） |
| `/admin/comments` | Phase 4 接入 Twikoo 公开计数 |
| `/admin/seo` `/admin/health` | Phase 5 接入 |
| `/admin/comments` | 占位（Twikoo 能力边界说明） |
| `/admin/seo` | 未连接（GSC） |
| `/admin/health` | 真实探测：Redis 可达性、配置状态、会话策略 |
| `/admin/settings` | 改密、会话/存储、审计日志 |
| `/admin/notify-status` | 原公开诊断页，现需登录 |
| `/admin/*`（其他） | 鉴权后 404（不会落入 `[prefix]` 动态路由） |

所有页面：`getServerSideProps`（**禁止 `getStaticProps`**），响应 `Cache-Control: no-store`、`X-Robots-Tag: noindex`、`X-Frame-Options: DENY`。

---

## 9. middleware 前置守卫（Edge）

- 覆盖：`/admin`、`/admin/*`、`/api/admin`、`/api/admin/*`
- 放行：`/admin/login`、`/api/admin/login`、`/api/admin/init`
- 逻辑：Cookie 存在 → Web Crypto 校验 HMAC 签名 → 通过则继续；否则页面 302 `/admin/login?next=…`，API 返回 `401 {"error":"unauthorized"}`（JSON，不返回 HTML）
- **仅乐观闸门**：权威校验在 GSSP 与每个 API 内（Redis 会话校验）

---

## 10. POST `/api/track`（公开采集端点）

无鉴权、可写、强校验。**任何失败都返回 `204`**（不向客户端解释原因）。

**请求**

```json
{
  "events": [
    {
      "event_id": "32 位随机",
      "event_name": "page_view",
      "anonymous_id": "第一方匿名 ID",
      "session_id": "会话 ID",
      "page_path": "/article/example",
      "article_id": "可选，Notion page id",
      "occurred_at": "ISO-8601",
      "props": {}
    }
  ],
  "referrer_host": "www.google.com"
}
```

也可只发单个事件对象（不带 `events` 数组）。

**响应**

| 状态 | 含义 |
| --- | --- |
| 204 | 已接收（无论写入成功、被去重、校验失败、被限流） |
| 405 | 非 POST |
| — | 其它任何情况都不返回错误体 |

**限制**：单请求 ≤20 条事件、body ≤8KB、每 IP 120 事件/分钟、`occurred_at` ±24h、`page_path` ≤200 字符、`props` ≤1KB。

**去重**：`event_id` 相同的事件在 1 小时内只计一次。

---

## 11. GET `/api/admin/stats/summary`

需要管理员会话。日期基准时区 `Asia/Shanghai`。

**查询参数**：`range=today|yesterday|7d|30d|90d`（默认 `today`）

**成功 200**

```json
{
  "ok": true,
  "range": "7d",
  "dates": ["20261103", "…"],
  "summary": {
    "pv": 0,
    "uv": 0,
    "sessions": 0,
    "byDay": [{ "date": "20261103", "pv": 0, "sessions": 0 }],
    "dims": { "device": {}, "browser": {}, "os": {}, "geo": {}, "source": {} }
  },
  "realtime": { "windowMinutes": 5, "sessions": 0 },
  "topPaths": [{ "path": "/article/…", "views": 0 }],
  "eventCounts": { "page_view": 0 },
  "collectionStartedAt": "2026-11-09T12:00:00.000Z"
}
```

- `uv` 为 HyperLogLog 估算（误差 ~0.81%），跨日合并计算。
- `realtime` 是"最近 5 分钟活跃会话估算"，**不是在线人数**。
- 未登录 → `401`；存储不可用 → `503 stats_store_unavailable`；非法 range → `400 invalid_range`。

---

## 12. GET `/api/admin/stats/report`

Phase 3 五个数据页共用的聚合接口（一次请求拿全，减少往返）。需要管理员会话。

**查询参数**：`range=today|yesterday|7d|30d|90d`（默认 `today`）

**成功 200**（字段含义见 `CHANGELOG.md` Phase 3「report 接口口径」）

```json
{
  "ok": true,
  "range": "7d",
  "dates": ["20261104", "…"],
  "generatedAt": "2026-11-10T02:49:37.000Z",
  "collectionStartedAt": "2026-11-09T12:00:00.000Z",
  "cards": { "today": { "pv": 0, "uv": 0, "sessions": 0 }, "yesterday": {}, "pv7": 0, "pv30": 0, "uv30": 0 },
  "summary": { "pv": 0, "uv": 0, "sessions": 0, "byDay": [], "dims": {} },
  "hourly": { "day": "20261110 或 null（多日范围）", "rows": [{ "hour": "00", "pv": 0 }] },
  "depth": { "d25": 0, "d50": 0, "d75": 0, "d90": 0, "complete": 0 },
  "search": { "total": 0, "terms": [] },
  "referrers": [{ "host": "google.com", "views": 0 }],
  "pages": { "pv": [], "entry": [], "exit": [] },
  "events": { "page_view": 0 },
  "realtime": { "windowMinutes": 5, "sessions": 0 },
  "visitors": { "newVisitors": 0, "returningVisitors": 0, "total": 0 },
  "outboundShare": { "outbound": [], "share": [] },
  "articles": {
    "syncedAt": null, "count": 0, "categories": [], "tags": [],
    "rows": [
      {
        "id": "…", "title": "(未同步：xxxxxxxx)", "slug": "", "url": "", "category": "", "tags": [],
        "pv": 0, "uv": null, "avgDepth": null, "completeRate": null, "pathMatched": false
      }
    ]
  }
}
```

- **文章双口径**：`article_id` 与 `/article/<slug>` 路径取较大值；`uv`/`avgDepth`/`completeRate` 在路径口径下为 `null`（页面显示"—"）。
- **不伪造 0**：存储不可用 → `503 stats_store_unavailable`；非法 range → `400 invalid_range`；未登录 → `401 unauthorized`。
- 与 §11 的 `summary` 接口并存，`summary` 保留给对账脚本使用。

---

## 13. GET `/api/admin/taxonomy?range=30d`

分类 / 标签聚合（Phase 4）。只读快照 + 自建统计，**不回写 Notion**。

```json
{
  "ok": true,
  "range": "30d",
  "dates": ["20261012", "…"],
  "syncedAt": "2026-11-10T03:12:02.000Z",
  "totals": { "articles": 16, "categories": 2, "tags": 9, "uncategorized": 0, "pv": 0 },
  "categories": [{ "name": "技术分享", "articles": 15, "pv": 0, "share": 93.8 }],
  "tags": [{ "name": "工具", "articles": 15, "pv": 0, "share": 93.8 }],
  "latestPublishedAt": 1762387200000
}
```

- `share` 为"文章数 ÷ 文章总数"的百分比（一篇多分类的文章会分别计入各分类）。
- 未同步时 `categories` / `tags` 为空数组、`syncedAt` 为 `null`，**不造假**。
- 非法 range → `400 invalid_range`；存储不可用 → `503 stats_store_unavailable`。

---

## 14. GET `/api/admin/sync/status`

Notion 同步状态（Phase 4）。

```json
{
  "ok": true,
  "meta": { "count": 16, "categories": [], "tags": [], "syncedAt": "…", "durationMs": 64 },
  "pathMapSize": 16,
  "log": [{ "startedAt": "…", "finishedAt": "…", "status": "ok", "counts": { "articles": 16 } }],
  "cooldown": 126,
  "stale": false
}
```

- `stale = true` 表示从未同步或上次成功同步超过 24 小时；
- `cooldown` 是同步冷却剩余秒数（0 表示可立即同步）。

---

## 15. POST `/api/admin/sync/notion`

触发 Notion **只读**同步（Phase 4）。需要会话 + CSRF。

- 成功 `200`：`{ "ok": true, "counts": { "articles": 16, "categories": 2, "tags": 9 }, "finishedAt": "…" }`
- 冷却中 `429`：`{ "error": "sync_too_frequent", "retryAfter": 300 }`
- 缺 CSRF `403 csrf_failed`
- Source 不可用 `502`：`{ "error": "sync_failed", "message": "…" }`，同时写入同步日志
- **不会修改 Notion 的内容**：只读取文章列表并写入统计侧快照（`stats:v1:articles` / `pathmap` / `meta`）

---

## 16. GET `/api/admin/comments`

Twikoo 公开评论计数（Phase 4）。**不使用管理员密钥**，因此没有待审核/垃圾评论数据。

```json
{
  "ok": true,
  "available": true,
  "rows": [{ "id": "…", "title": "…", "path": "/article/x", "category": "技术分享", "comments": 3 }],
  "totals": { "comments": 12, "articlesWithComments": 4 }
}
```

未配置 Twikoo 时返回 `available: false, reason: "not_configured"`（HTTP 仍为 200）——
这是"未连接"，不是"0 条评论"。

---

## 17. GET `/api/admin/health/site`

站点健康（Phase 5）。3 分钟进程内缓存。

```json
{
  "ok": true,
  "origin": "https://example.com",
  "checkedAt": "…",
  "cached": false,
  "probes": [{ "url": "https://example.com/", "status": 200, "ok": true, "ms": 515 }],
  "store": { "backend": "redis", "reachable": true },
  "admin": { "ready": true, "missing": [], "warnings": [] },
  "stats": { "collectionStartedAt": "…" },
  "notion": { "lastSyncAt": "…", "lastSyncCounts": {}, "lastErrorAt": null, "lastError": null },
  "twikoo": { "configured": true },
  "deployment": { "env": "production", "commit": "abc1234", "url": "…", "region": "iad1" }
}
```

站点地址优先取 `NEXT_PUBLIC_SITE_URL` / `NEXT_PUBLIC_LINK`，否则用请求头推导；
无法确定时返回 `503 origin_unavailable`。

---

## 18. GET `/api/admin/health/links?limit=10`

失效链接检查（Phase 5）。只探测**同源**路径，`limit` 上限 20，10 分钟缓存。

```json
{
  "ok": true,
  "checkedAt": "…",
  "cached": false,
  "origin": "https://example.com",
  "targets": 10,
  "rows": [{ "path": "/article/x", "status": 200, "ok": true, "redirect": false, "ms": 320 }],
  "summary": { "ok": 9, "broken": 1, "errors": 0, "redirects": 0 }
}
```

`status = 0` 表示请求失败/超时（与 404 区分）；重定向（3xx）算可访问但单独计数。

---

## 19. GET `/api/admin/seo`

本地 SEO 自查（Phase 5）。

```json
{
  "ok": true,
  "generatedAt": "…",
  "syncedAt": "…",
  "audit": {
    "rows": [{ "id": "…", "title": "…", "slug": "x", "titleLength": 12, "updatedDays": 3, "issues": [] }],
    "summary": { "total": 16, "withIssues": 2, "missingSlug": 0, "missingDescription": 0, "shortTitle": 2, "longTitle": 0, "stale": 0 }
  },
  "files": { "rows": [{ "path": "/robots.txt", "status": 404, "ok": false, "ms": 120 }], "cached": false },
  "gsc": {
    "connected": false,
    "configured": false,
    "reason": "not_configured",
    "requiredEnv": ["GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL", "GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY", "GOOGLE_SEARCH_CONSOLE_SITE_URL"],
    "note": "尚未配置只读凭证…"
  },
  "ai": { "enabled": false, "reason": "not_configured" }
}
```

**语义保证**：响应里不会出现 `impressions` / `clicks` / `ctr` / `position` 等字段——
这些只可能来自 Search Console，未连接就是未连接。

---

## 20. GET `/robots.txt`（由 `/api/robots` 生成）

公开、无鉴权。`next.config.js` 把 `/robots.txt` 重写到该端点。

```
User-agent: *
Allow: /
Disallow: /admin
Disallow: /admin/
Disallow: /api/
Disallow: /auth
Disallow: /auth/
Disallow: /sign-in
Disallow: /sign-up
Disallow: /dashboard
Disallow: /dashboard/
Disallow: /search/
Sitemap: https://<站点域名>/sitemap.xml
```

`Content-Type: text/plain; charset=utf-8`，`Cache-Control: public, max-age=3600, s-maxage=86400`。
域名优先取 `siteConfig('LINK')`，缺失时用请求头推导。

---

## 21. GET `/api/cron/sync-notion`

Vercel Cron：`0 1 * * *`（UTC）。鉴权 `Authorization: Bearer $CRON_SECRET`。

| 情况 | 响应 |
| --- | --- |
| 成功 | `200 { ok:true, source:"cron", counts:{articles,categories,tags}, finishedAt }` |
| 未配置 `CRON_SECRET` | `503 { error:"cron_not_configured" }` |
| 令牌缺失/错误 | `401 { error:"unauthorized" }` |
| 5 分钟内重复 | `429 { error:"cron_cooldown", retryAfter:300 }` |
| Notion 不可用 | `502 { error:"sync_failed", message }`（同时写入同步日志） |

---

## 22. GET `/api/cron/digest`

Vercel Cron：`10 1 * * *`（UTC）＝北京时间 09:10。鉴权同上。

```json
{
  "ok": true,
  "date": "20261109",
  "pv": 0, "uv": 0,
  "ai": { "ok": true, "reason": null, "model": "deepseek-chat" },
  "delivery": { "ok": true, "status": 200, "messageId": 12345 },
  "computedAt": "…"
}
```

- Telegram 未配置时 `delivery.ok=false, reason="not_configured"`，HTTP 仍 200（事实已生成）；
- 重复触发 5 分钟内 → `429 cron_cooldown`。

---

## 23. GET / POST `/api/admin/digest`

需要管理员会话；POST 需要 CSRF。

| 请求 | 说明 |
| --- | --- |
| `GET /api/admin/digest?dayKey=20261109` | 生成预览（不发送），返回 `facts` / `ai` / `text` |
| `GET /api/admin/digest?log=1` | 返回最近 10 条发送日志 + 配置状态（不含任何令牌） |
| `POST { dayKey?, send? }` | 生成并发送；`send:false` 只生成。60 秒内重复 → `429 digest_too_frequent` |

---

## 24. GET `/api/admin/ai/summary?range=today|yesterday|7d|30d`

AI 浏览总结（需要管理员会话）。

```json
{
  "ok": true,
  "ai": { "configured": true, "ok": true, "reason": null, "model": "deepseek-chat", "text": "…" },
  "facts": { "range": "today", "pv": 5, "uv": 4, "sessions": 4, "depth": {}, "searchTotal": 2, "topPages": [], "topArticles": [], "sources": [] }
}
```

`ai.configured=false` 时不会发起任何模型请求，`ai.ok=false, reason="not_configured"`，
前端必须继续展示 `facts`（事实数据不受影响）。

---

## 25. Phase 1.5 对既有公开接口的行为变更

| 端点 | 变更 |
| --- | --- |
| `POST /api/cache` | 未配置 `CACHE_REVALIDATION_TOKEN` → **503**（原为放行）；Bearer 比较改常量时间 |
| `POST /api/push/test` | 新增同源校验（跨站 403）、每 IP 5 次/分钟、Web Push endpoint 域名白名单、配置体积上限、不再自动生成 VAPID（缺密钥返回 503） |
| `GET /api/push/status` | 默认只回 `{ok:true}`；细节需 `x-notify-secret` |
| `GET /api/push/subscriptions` | 每 IP 30 次/分钟、`subscriberId` 必须 UUID 形态、只回必要字段、`no-store`/`no-referrer` |
| `POST /api/rank/seed` | 令牌**只从环境变量读取**（不再受 Notion 配置表影响） |

推送设置面板（`SettingsDropdown.js`）未改动，功能与交互保持原样。
