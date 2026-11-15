# API DOCUMENTATION —— Jason Blog Messages（Phase 1）

- 基础路径：`/api/messages/*`（访客）、`/api/admin/messages/*`（管理员）
- 访客鉴权：HttpOnly Cookie（`jbm_<convId 前 10 位>`），由兑换接口下发
- 管理员鉴权：**复用现有** `requireAdminApi`（会话 + 写操作 CSRF）
- 统一响应：JSON；错误只回 `{ error: "<code>" }`，不返回堆栈/键名/token
- 统一响应头：`Cache-Control: private, no-store`、`X-Robots-Tag: noindex, nofollow, noarchive`、
  `Referrer-Policy: no-referrer`、`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`

---

## 1. 错误码

| HTTP | code | 含义 |
| --- | --- | --- |
| 400 | `invalid_input` | 请求体不合法 / honeypot 命中（不区分） |
| 400 | `invalid_name` | 昵称长度不在 1–40 |
| 400 | `invalid_email` | 邮箱格式错（>254 或缺 @/域名） |
| 400 | `invalid_content` | 正文为空 |
| 400 | `invalid_request_id` | `client_request_id` 含非法字符 |
| 400 | `invalid_status` | 管理员传了不认识的状态 |
| 403 | `invalid_credential` | 兑换失败 / Cookie 无效（不区分原因） |
| 403 | `cross_origin_denied` | Origin 与 Host 不一致 |
| 403 | `csrf_failed` | 管理员写操作缺 CSRF |
| 404 | `not_found` | 会话不存在（或已软删） |
| 405 | `method_not_allowed` | 方法不允许（带 `Allow` 头） |
| 409 | `already_exists` | 唯一约束冲突（未预期的重复） |
| 413 | `payload_too_large` | 正文 > 5000 字符 |
| 413 | `conversation_full` | 单会话 > 2000 条 |
| 429 | `rate_limited` | 限流；带 `Retry-After` 与 `retryAfter` |
| 503 | `messages_disabled` | `MESSAGES_ENABLED=false` |
| 503 | `messages_unavailable` | 凭据缺失（fail-closed） |
| 503 | `store_unavailable` | 数据库异常 |

---

## 2. 访客侧

### 2.1 `POST /api/messages/conversations`

创建会话。**无需登录**；限流：IP 3 次/10 分钟、10 次/天；全站 200 次/天。

**请求**

```json
{
  "visitor_name": "Jason Reader",
  "visitor_email": "reader@example.com",
  "content": "你好，我想咨询一篇文章里的技术问题。",
  "client_request_id": "create-20261115-1",
  "website": "",
  "first_path": "/article/dsh09"
}
```

- `visitor_email` 可省略或 `null`；`website` 是 honeypot（**必须为空**）
- `client_request_id` 可选（8–64 位 `[A-Za-z0-9_-]`），用于防重复创建

**成功 201**

```json
{
  "ok": true,
  "conversation_id": "7b-y-1FDFQ_2tkkF",
  "link": "https://blog.20240606.xyz/message/7b-y-1FDFQ_2tkkF#<43 字符 token>",
  "duplicate": false
}
```

> **token 只在这里出现一次**，库内只有 HMAC。响应头 `no-store`，不可缓存。

**幂等命中 200**

```json
{ "ok": true, "conversation_id": "…", "link": null, "duplicate": true, "message": "…链接只在首次创建时显示一次…" }
```

### 2.2 `POST /api/messages/access/exchange`

用 fragment 里的 token 兑换 Cookie。限流：IP 10 次/分钟、60 次/小时；失败 10 次封 30 分钟。

**请求**

```json
{ "conversation_id": "7b-y-1FDFQ_2tkkF", "token": "<43 字符>" }
```

**成功 200**（并下发 Cookie）

```json
{ "ok": true, "conversation_id": "7b-y-1FDFQ_2tkkF", "status": "unread", "expires_in": 604800 }
```

`Set-Cookie: jbm_7b-y-1FDFQ=<convId>.<expSec>.<HMAC>; Path=/api/messages/conversations/<convId>; Max-Age=604800; HttpOnly; Secure; SameSite=Lax`

**失败 403**：`{ "error": "invalid_credential" }`（不区分"不存在/已删/token 错"）

### 2.3 `GET /api/messages/conversations/[id]`

需 Cookie。返回摘要（不含邮箱、不含 token）。

```json
{
  "ok": true,
  "conversation": { "id": "…", "visitor_name": "…", "status": "unread", "message_count": 2, "created_at": "…", "last_message_at": "…", "resolved_at": null }
}
```

### 2.4 `GET /api/messages/conversations/[id]/messages?limit=30`

需 Cookie。按时间正序返回，`limit` 1–100。

```json
{ "ok": true, "messages": [{ "id": "m_…", "conversation_id": "…", "sender": "visitor", "content": "…", "created_at": "…", "read_at": null }] }
```

### 2.5 `POST /api/messages/conversations/[id]/messages`

需 Cookie + 同源。限流：同会话 5 条/分钟、30 条/小时。

```json
{ "content": "补充一句", "client_request_id": "send-20261115-1" }
```

- 新消息 201；同 `client_request_id` 重复 → 200 `{ duplicated: true }` 且不新增
- 正文 1–5000 字符（**先判长度再压缩同字符串**）
- 访客发言会把 `resolved/archived/read/processing` 拉回 `unread`

---

## 3. 管理员侧（全部复用现有管理员会话）

### 3.1 `GET /api/admin/messages/stats`

侧边栏徽标用。**只返回数量**，不含任何正文/昵称/邮箱。

```json
{ "ok": true, "unreadConversations": 3, "total": 12, "byStatus": { "unread": 3, "resolved": 5 }, "generatedAt": "…" }
```

前端建议 20 秒轮询一次；`document.hidden` 时暂停。

### 3.2 `GET /api/admin/messages/conversations?status=&q=&page=&pageSize=`

- `status`：`all|unread|read|processing|resolved|archived|spam`（默认 `all`）
- `q`：按昵称模糊匹配（≤40 字符）
- `page` 默认 1；`pageSize` 默认 20，上限 50
- 排序：`last_message_at desc nulls last`
- **邮箱脱敏**：`r***@example.com`

```json
{ "ok": true, "status": "all", "rows": [{ "id": "…", "visitor_name": "…", "visitor_email": "r***@example.com", "status": "unread", "message_count": 5, "unread_count": 1, "last_message_at": "…" }], "total": 4, "page": 1, "pageSize": 20 }
```

### 3.3 `GET /api/admin/messages/conversations/[id]`

返回 `{ conversation, messages }`（消息上限 100 条）。**GET 不写库**。

### 3.4 `PATCH /api/admin/messages/conversations/[id]`（需 CSRF）

```json
{ "markRead": true }          // 或
{ "status": "resolved" }      // 或两者同时
```

- `markRead`：把该会话所有未读的访客消息写 `read_at`；`unread_count` 归零；`unread → read`
- `status`：`unread|read|processing|resolved|archived|spam`
- 写一条 `admin:audit`（`messages.mark_read` / `messages.status`）

### 3.5 `POST /api/admin/messages/conversations/[id]/messages`（需 CSRF）

```json
{ "content": "收到，我看一下这篇。", "client_request_id": "reply-1" }
```

- 回复后会话 `last_message_at` 更新；`unread/read → processing`
- 写一条 `admin:audit`（`messages.reply`，只记长度，不记正文）

### 3.6 `DELETE /api/admin/messages/conversations/[id]`（需 CSRF）

**服务端强制二次确认**：必须带 `?confirm=<完整会话 ID>`，前端弹窗只是体验。

| 参数 | 说明 |
| --- | --- |
| `confirm` | 必须与会话 ID 完全一致，否则 `400 confirm_required` |
| `mode` | 缺省 `soft`（写 `deleted_at`，对管理员与访客均不可见）；`purge` 彻底删除（消息级联删除） |

成功：`{ "ok": true, "mode": "soft" }`；审计写 `messages.delete` / `messages.purge`。

### 3.7 未读徽标

`AdminShell` 每 20 秒轮询一次 `/api/admin/messages/stats`（页面隐藏时跳过），
只取 `unreadConversations` 显示在侧边栏「私信管理」后面（>99 显示 99+）。

---

## 4. 尚未实现（后续阶段，明确标注）

| 能力 | 阶段 |
| --- | --- |
| 访客页面 `/message/[id]` | ✅ Phase 2 |
| 后台页面 `/admin/messages` | ✅ Phase 3 |
| IP 失败写 `access_logs` 表 | Phase 4 |
| 验证码 / 附件 / 实时 | Phase 2+ 之后 |
