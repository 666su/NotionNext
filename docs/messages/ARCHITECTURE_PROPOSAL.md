# ARCHITECTURE PROPOSAL —— Jason Blog Messages

- 目标站点：`https://blog.20240606.xyz`（规范给定；仓库 `blog.config.js:22` 的默认值 `tangly1024.com` **不可用于拼私密链接**，见 §4.5）
- 仓库：`666su/NotionNext`（Next.js 15.5.21 / Pages Router / Vercel / Redis）
- 本文件是 Phase 1 的实施依据；未确认前不写代码。

---

## 1. 设计目标与硬约束

1. **不新建项目、不新建认证、不新建部署**：全部落在现有仓库与 Vercel 项目内。
2. **访客零注册**：昵称必填、邮箱选填；靠"私密会话链接"回访。
3. **凭证与标识分离**：`conversation_id` 公开、`access_token` 秘密；库内只存 HMAC 哈希。
4. **越权不可能发生**：任何"换个 ID 试试"都必须失败（服务端强制绑定）。
5. **私信内容不进 Notion、不进评论、不进统计、不进 sitemap、不进公开导航**。
6. **不影响公开博客**：私信故障时博客照常（`/api/messages/*` 失败不影响页面渲染）。
7. **零新依赖**：`ioredis` 已在，图表/编辑器都用原生 React + Tailwind。

---

## 2. 总体数据流

```text
访客（公开页面）
  └─ <MessageWidget/>  右下 FAB 栈 → 抽屉
       ├─ 首次：昵称/邮箱(可选)/正文 → POST /api/messages/conversations
       │     ← { conversation_id, link }       链接 = /message/<id>#<token>
       └─ 回访：打开 /message/<id>#<token>
             ├─ 读 location.hash → POST /api/messages/access/exchange
             ├─ 服务端校验 → Set-Cookie jbm_sid（HttpOnly）→ 前端 history.replaceState 去掉 hash
             └─ GET  /api/messages/conversations/<id>/messages  （带 Cookie）
                POST /api/messages/conversations/<id>/messages  继续发言

管理员（/admin）
  └─ /admin/messages（复用 adminPageGuard + AdminShell）
       ├─ GET   /api/admin/messages/conversations?status=&q=&page=
       ├─ GET   /api/admin/messages/conversations/<id>
       ├─ POST  /api/admin/messages/conversations/<id>/messages   （CSRF）
       ├─ PATCH /api/admin/messages/conversations/<id>            （CSRF，状态）
       └─ DELETE/api/admin/messages/conversations/<id>            （CSRF，二级确认）
                          ↓
                 Redis  msg:v1:*  （与 stats:v1:* / admin:* 严格分家）
```

---

## 3. 技术选型

| 决策 | 选择 | 理由 | 被否方案 |
| --- | --- | --- | --- |
| 存储 | **现有 Redis（建议独立 Upstash 库）** | 已在生产链路内、Vercel Serverless 可直连、无新账号/依赖 | D1（需 Worker + 新服务 + 跨域调用）、Turso（新依赖 `@libsql/client` + 新账号）、Postgres（同上且免费额度更紧） |
| 会话认证 | **HttpOnly Cookie + HMAC 绑定 convId** | 复用 `respond.js` 的 cookie 序列化能力 | localStorage 存 token（规范禁止） |
| 凭证形式 | 32 字节随机 `base64url` | `randomToken(32)` 已有 | JWT（无必要，需额外库与密钥管理） |
| 凭证存储 | `HMAC-SHA256(token, MESSAGE_TOKEN_SECRET)` | 高熵随机串无需慢哈希；HMAC 防"库被读后彩虹表" | bcrypt/argon2（每次校验 60ms+，对每条消息请求过重） |
| 前端状态 | 组件内 `useState` + 懒加载 | 不引状态库 | Redux/Zustand（过重） |
| 实时性 | 轮询（后台 20s、访客按需） | 规范要求 v1 不做 WS | SSE/WS（Phase 3+） |

**需要新增的 KV 原语**（`lib/kv.js`，ioredis 原生支持，非新依赖）：

```js
kvZadd(key, score, member)   kvZrange(key, start, stop, { rev })
kvZrem(key, member)          kvZcard(key)   // 可选 kvLlen(key)
```

---

## 4. 私密链接与访问凭证（本方案的安全核心）

### 4.1 标识与凭证

```text
conversation_id = randomToken(12)          // 16 字符 base64url，公开
access_token    = randomToken(32)          // 43 字符 base64url，秘密，仅创建时返回一次
access_token_hash = HMAC-SHA256(token, MESSAGE_TOKEN_SECRET)   // 库内只存这个
```

- 库内字段 `token_hash`、`token_issued_at`；**不存明文 token**。
- 校验用 `timingSafeEqualStr`（已有），避免时序侧信道。
- `MESSAGE_TOKEN_SECRET` 与 `SESSION_SECRET` **必须是不同的值**（新环境变量，≥32 字节）。

### 4.2 链接形态

```text
https://blog.20240606.xyz/message/<conversation_id>#<access_token>
```

- **token 只放在 fragment**：浏览器不会把 fragment 发给服务器，因此不会进入 Vercel/CDN 的 access log 与 `Referer`。
- **禁止** `?token=` 形式（会进日志）。
- 页面加载后立即 `history.replaceState(null, '', '/message/<id>')` 清掉 fragment。

### 4.3 兑换流程（防重放）

```text
POST /api/messages/access/exchange
{ "conversation_id": "abc…", "token": "…" }
```

服务端：

1. 速率限制：同 IP（加盐哈希）每分钟 10 次、每小时 60 次；失败计数超阈值后指数退避（按 IP）。
2. 读会话记录 → 比较 `HMAC(token)` 与 `token_hash`（常量时间）。
3. 校验会话未被删除、未被标记 spam、`token_revoked_at` 为空。
4. 签发 Cookie：`<convId>.<expEpochSec>.<HMAC(convId|exp)>`（与 sid 同样的签名思路，见 `lib/admin/session.js:27-40`）。
5. 返回 `{ ok:true, conversation:{ id, visitor_name, status } }`，不返回 token、不返回 token_hash。
6. 写一条 `msg:v1:accesslog`（只记 `convId`、动作、结果、时间；**不记 token、不记明文 IP**）。

失败一律 `403 { error: "invalid_credential" }`，不区分"会话不存在"与"凭证不对"（防枚举）。

### 4.4 Cookie 作用域：三个方案与决策

| 方案 | 做法 | 优点 | 缺点 |
| --- | --- | --- | --- |
| A（推荐） | 同名不同 Path 两个 Cookie：`Path=/message/<id>`（页面）+ `Path=/api/messages/conversations/<id>`（接口） | 作用域最小；不同会话互不干扰 | 同一 token 在浏览器里出现两次 |
| B | 单 Cookie `Path=/`，名字含会话短 ID：`jbm_<id8>` | 简单 | 每个请求都带上所有会话的 cookie（数量随会话增长） |
| C | 单 Cookie `jbm_sid` `Path=/message` + API 用 `Referer` 校验 | 少一个 cookie | API 不在此 Path 下，拿不到 cookie → 不可行 |

**决策：采用 A。** 若实现时发现 Next/Vercel 对"同名不同 Path"的行为有偏差，退回 B（并在文档记录原因）。

Cookie 属性：`HttpOnly; Secure; SameSite=Lax; Max-Age=7d; Path=…`（不使用 `Domain`，主机级隔离）。

> `SameSite=Lax` 允许"从外部链接点进来"时带上 cookie；私密链接一般是从聊天工具点开的，`Strict` 会导致首次跳转丢 cookie。若验收时确认无此问题，可收紧为 `Strict`。

### 4.5 链接域名必须用请求 origin

`blog.config.js:22` 的 `LINK` 默认是 `tangly1024.com`，若部署环境没配 `NEXT_PUBLIC_LINK`，拼出来的链接会指向别人的域名。**规则**：

```js
origin = process.env.NEXT_PUBLIC_LINK（若与请求 host 一致）
      || `${x-forwarded-proto}://${x-forwarded-host || host}`
```

请求 origin 优先，配置值只作兜底；两者不一致时**以请求 origin 为准**（否则用户点开必然 404）。

### 4.6 链接丢失

v1 明确不提供找回：不按昵称、不按邮箱、不按 ID 猜测。页面上必须写明"这个链接就是凭证，丢了找不回来"。

---

## 5. 数据模型（概览）

键前缀统一 `msg:v1:`，与 `stats:v1:` / `admin:*` / ISR 缓存键**完全隔离**。字段级设计见 `DATABASE_PROPOSAL.md`。

```text
msg:v1:conv:<cid>                Hash   会话元数据（昵称/邮箱/status/时间/token_hash/计数）
msg:v1:msgs:<cid>                List   消息（RPUSH JSON，按时间正序）
msg:v1:idx:updated               ZSet   会话按最后活动时间（score=ms）→ 收件箱排序
msg:v1:idx:status:<status>       Set    按状态索引
msg:v1:conv:all                  Set    会话全集（用于计数，避免 SCAN）
msg:v1:adminlog                  List   管理员操作日志（最多 2000）
msg:v1:accesslog                 List   凭证兑换记录（最多 2000，TTL 90d）
msg:v1:rl:*                      String 限流计数（短 TTL）
```

容量估算（个人博客）：1 万会话 × 平均 8 条 × 0.4KB ≈ 32MB；远低于 Upstash 免费 256MB。

---

## 6. API 设计

### 6.1 访客侧（`/api/messages/*`）

| 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- |
| POST | `/api/messages/conversations` | 无（限流 + honeypot） | 创建会话并返回**一次性**链接 |
| POST | `/api/messages/access/exchange` | 无（限流） | fragment token → HttpOnly cookie |
| GET | `/api/messages/conversations/[id]` | Cookie | 会话摘要（昵称/状态/未读） |
| GET | `/api/messages/conversations/[id]/messages?after=&limit=` | Cookie | 消息分页（默认 30，最大 100） |
| POST | `/api/messages/conversations/[id]/messages` | Cookie + 同源 | 访客继续发言（幂等头 `Idempotency-Key`） |

创建请求体：

```json
{
  "visitor_name": "…", "visitor_email": "…|null", "content": "…",
  "client_request_id": "uuid-v4", "website": ""   // honeypot，必须为空
}
```

创建响应（**唯一一次**返回 token）：

```json
{ "ok": true, "conversation_id": "…", "link": "https://…/message/<id>#<token>", "expires_hint": null }
```

### 6.2 管理员侧（`/api/admin/messages/*`）

全部经 `requireAdminApi`；写操作 `{ csrf: true }`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/messages/conversations?status=&q=&page=&pageSize=&sort=` | 列表（默认按最后活动倒序） |
| GET | `/api/admin/messages/conversations/[id]` | 详情（含消息） |
| POST | `/api/admin/messages/conversations/[id]/messages` | 回复（CSRF） |
| PATCH | `/api/admin/messages/conversations/[id]` | `status` / `markRead` / `markUnread` |
| DELETE | `/api/admin/messages/conversations/[id]` | 删除（`?mode=soft|purge`，默认 soft） |
| GET | `/api/admin/messages/stats` | 未读数、各状态计数（给侧边栏徽标） |

### 6.3 错误码（统一）

| HTTP | code | 场景 |
| --- | --- | --- |
| 400 | `invalid_input` | 字段缺失/超长/邮箱格式错/空白 |
| 400 | `invalid_email` | 邮箱格式 |
| 403 | `invalid_credential` | 兑换失败（不区分原因） |
| 403 | `csrf_failed` | 管理员写操作缺 CSRF |
| 404 | `not_found` | 会话不存在（管理员侧） |
| 409 | `already_exists` | 幂等键重复（返回原结果而非报错） |
| 413 | `payload_too_large` | 正文超过 5000 字符 |
| 429 | `rate_limited` | 附 `retryAfter` |
| 503 | `store_unavailable` | Redis 不可用（fail-closed，不影响博客） |

**所有错误都不返回内部堆栈、不返回 Redis 键名、不区分"凭证错"与"不存在"。**

---

## 7. 前端：访客组件

### 7.1 路由分支（必须先做）

`pages/_app.js` 增加：

```js
const isMessagesRoute = route.pathname === '/message' || route.pathname.startsWith('/message/')
```

命中时**不挂** `GLayout / SEO / ExternalPlugins / BlogPet / Tracker`，只渲染一个极简外壳（自带返回首页链接）。

### 7.2 悬浮入口

- 组件：`components/messages/MessageWidget.js`，`dynamic(..., { ssr:false })` 懒加载（不阻塞首屏）。
- 位置：并入回顶按钮的容器 `themes/example/index.js:143`，改为竖排：

```text
   [私信]   ← 新增
   [回顶]   ← 已存在
```

- 桌宠避让：`defaultPosition()` 增加 `avoid` 参数（右下 56px 让位），**不改桌宠本体逻辑**，只在其配置里加一个常量。
- 移动端：`env(safe-area-inset-bottom)` 内边距；入口 44×44 触达区；打开时抽屉占满宽度 100%、高度 80vh。
- 主题：沿用 Tailwind `dark:` 变量，与后台同一套灰阶（`bg-white dark:bg-[#0f1115]`）。

### 7.3 抽屉的三个视图

| 视图 | 触发 | 内容 |
| --- | --- | --- |
| 表单 | 无 localStorage 会话记录，且未持有 cookie | 昵称 / 邮箱（选填）/ 正文 / 发送 |
| 成功 | 创建成功 | 大号"复制私密链接"按钮 + 强烈警告（一次性展示） |
| 会话 | 已兑换 cookie | 消息气泡 + 输入框 + 发送；只读自己这一条会话 |

**不能**把 token 存进 localStorage/sessionStorage；抽屉关闭只保留"输入草稿"（内存 + `sessionStorage` 存**草稿文本**，不含 token）。

### 7.4 发送状态机

`idle → validating → sending → success | error(code)`，`sending` 期间按钮禁用并生成 `client_request_id`（UUID）；重试复用同一 ID（服务端幂等）。

失败文案（不暴露内部）：400→"内容不合法"、413→"太长了"、429→"发送太频繁，请 N 秒后重试"、5xx→"服务暂时不可用，内容已保留"。

---

## 8. 后台：私信管理页

- 路由：`pages/admin/messages.js`（GSSP + `adminPageGuard`）。
- 导航：`lib/admin/constants.js` 的 `ADMIN_NAV` 在 `content` 组新增 `{ key:'messages', href:'/admin/messages', label:'私信管理' }`（是否带未读徽标见决策 Q3）。
- 布局：左侧列表（320px）+ 右侧会话，复用 `AdminShell/AdminPanel/AdminDataTable/AdminNotice`；移动端切换为"列表 → 详情"两级。
- 状态机（`status`）：`unread → read → processing → resolved`；`archived`、`spam` 为旁路。访客发新消息时：`resolved/archived → unread`（自动重开），并 `last_message_at` 更新。
- 已读：消息级 `read_at`（访客消息被管理员查看时批量写入）+ 会话级 `unread_count`。
- 轮询：页面可见时 20s 一次 `GET /stats`（轻量），列表只在筛选条件变化或有新消息时刷新；`document.hidden` 时暂停。

---

## 9. 防滥用矩阵

| 面 | 规则（初值，可配） | 实现 |
| --- | --- | --- |
| 创建会话 | 每 IP 哈希 3 次/10 分钟、10 次/天；全站 200 次/天 | `kvIncr` + TTL |
| 访客发消息 | 每会话 5 条/分钟、30 条/小时 | `kvIncr` + TTL |
| 凭证兑换 | 每 IP 10 次/分钟、60 次/小时；连续失败 10 次封 30 分钟 | `kvIncr` + `kvExpire` |
| 管理员回复 | 不额外限流（已登录），只做长度校验 | — |
| honeypot | 表单隐藏字段 `website` 必须为空 | 服务端校验 |
| 内容 | 1–5000 字符；去首尾空白；控制字符 `<0x20`（除 `\n\t`）剔除；连续同字符 >50 拒绝 | `lib/messages/validate.js` |
| 幂等 | `client_request_id` 唯一，重复请求返回首次结果 | 会话内 Hash `msg:v1:idem:<cid>` |
| 验证码 | v1 不启用；保留字段与开关 | `conf/messages.config.js` |

限流键一律 `hashIp(ip, MESSAGE_TOKEN_SECRET)` 派生，**不落明文 IP**（`lib/admin/crypto.js:38-44` 已有）。

---

## 10. 隐私边界（硬性）

- 不采集：明文 IP、设备指纹、GPS、浏览器指纹。
- 邮箱：选填；仅管理员可见；**不用于自动发信**；列表接口默认脱敏（`a***@b.com`）。
- 消息正文：仅访客本人（cookie）+ 管理员可见；不写日志、不进统计、不进 Notion。
- 访问凭证：不落日志、不出现在错误信息、不进统计（Tracker 不挂载）。
- 第三方脚本：私密页不加载 `ExternalPlugins`。
- 页面头：`noindex, nofollow, noarchive` + `no-store` + `Referrer-Policy: no-referrer`。
- `robots.txt` 追加 `Disallow: /message`（`pages/api/robots.js`）。

---

## 11. 需要管理员确认的 3 个决策点

| # | 问题 | 建议 | 影响 |
| --- | --- | --- | --- |
| Q1 | Redis 是否新建**独立实例/库**专放 `msg:v1:*`？ | **是**（免费额度内，最稳） | 若不建：必须确认现有实例 `maxmemory-policy = noeviction`，否则私信可能被淘汰 |
| Q2 | 访客消息保留期 | **长期保留 + 管理员可删；spam 30 天** | 涉及存储与合规 |
| Q3 | 侧边栏是否显示未读徽标（每 20s 轮询一次 `/stats`） | **显示**（体验必要，成本很低） | 不显示则需手动刷新才知道有新私信 |

另有 2 个实现细节默认值（不改也可，说明一下）：

- `MESSAGE_TOKEN_SECRET` 新环境变量（≥32 字节），与会话密钥分开；
- 私密 Cookie 有效期 **7 天**（到期需重新点开链接兑换）。

---

## 12. 分阶段计划

| 阶段 | 内容 | 交付物 | 验收点 |
| --- | --- | --- | --- |
| **Phase 0**（本次） | 审计 + 方案 | 本目录 4 份文档 | 管理员确认 §11 的 Q1–Q3 |
| Phase 1 | KV 原语、`lib/messages/*`、访客 5 个 API、限流、头部与 robots | 代码 + `tests/messages_phase1.py` | 创建/兑换/发消息/越权/限流全部通过；公开博客 0 回归 |
| Phase 2 | `/message/[id]` 页面、`_app` 分支、右下 FAB、抽屉三视图、移动端、桌宠避让 | 组件 + 页面 + `tests/messages_phase2.py` | 首次发送→复制链接→新窗口打开→刷新保持→继续对话 |
| Phase 3 | `/admin/messages` 收件箱、回复、状态机、搜索筛选、删除确认 | 页面 + 4 个管理 API + 测试 | 回复后访客可见；未读数正确；状态与筛选正确 |
| Phase 4 | 安全加固与异常：IDOR、CSRF、XSS、重放、伪造 Cookie、Redis 故障、凭证枚举 | `tests/messages_security.py` + 报告 | 全部按 §13 清单通过 |
| Phase 5 | 预览部署、备份、回归、切换生产 | `DEPLOYMENT_GUIDE.md` | Preview 全绿 + 管理员确认 |

---

## 13. 影响面与回滚

**改动文件（预计）**

```
新增：pages/message/[id].js
新增：pages/admin/messages.js
新增：pages/api/messages/**             （5 个）
新增：pages/api/admin/messages/**       （4 个）
新增：lib/messages/{store,tokens,validate,rate-limit,respond}.js
新增：components/messages/{MessageWidget,MessageThread,Composer}.js
新增：conf/messages.config.js
修改：lib/kv.js（+4 个 zset 原语）
修改：lib/admin/constants.js（+1 导航项）
修改：pages/_app.js（+1 路由分支）
修改：next.config.js（+2 组安全头）
修改：pages/api/robots.js（+1 行 Disallow）
```

**回滚**：删除上述新增文件 + 还原 5 个修改文件（`git checkout -- lib/kv.js lib/admin/constants.js pages/_app.js next.config.js pages/api/robots.js`）；Redis 键整体前缀 `msg:v1:*`，可一次性删除；不影响任何公开页面与既有后台。

**故障隔离**：私信所有失败路径都返回 JSON 错误，页面级降级为"组件不渲染"；`_app` 分支只按路径前缀判断，异常时不影响其他路由。
