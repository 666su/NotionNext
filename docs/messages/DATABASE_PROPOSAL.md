# DATABASE PROPOSAL —— Jason Blog Messages

- 存储：**现有 Redis（Upstash 兼容）**，不新建数据库服务、不引入 ORM。
- 前缀：`msg:v1:`（与 `stats:v1:`、`admin:*`、ISR 缓存 `global_data_* / page_block_*` 完全隔离）。
- 规范里给的 `CREATE TABLE` 是**逻辑模型**（原文也注明"实际 SQL 必须根据审计后确定的数据库类型调整"），本文件给出等价的 Redis 落地。

---

## 1. 为什么是 Redis 而不是 SQL

| 维度 | Redis（本方案） | D1 / Turso / Postgres（被否） |
| --- | --- | --- |
| 接入成本 | 已有 `REDIS_URL`，Vercel 内已验证可用 | 需新建服务、新账号、新依赖、跨服务鉴权 |
| 事务 | 单键原子；多键靠"幂等 + 补偿" | 强事务（但私信不需要跨行事务） |
| 查询 | 需要显式索引（本文件给出） | SQL 天然灵活 |
| 规模匹配度 | 个人博客：1 万会话 / 10 万消息 ≈ 40MB，远低于额度 | 能力过剩 |
| 故障域 | 与现有缓存同源（**必须独立实例，见 R1**） | 独立 |

结论：**v1 用 Redis**；若将来私信量级变大（>10 万会话），再评估迁移到 SQL —— 迁移路径见 §9。

---

## 2. 键空间总表

| 键（pattern） | 类型 | TTL | 用途 |
| --- | --- | --- | --- |
| `msg:v1:conv:<cid>` | Hash | 永久（删除时移除） | 会话元数据 |
| `msg:v1:msgs:<cid>` | List | 永久 | 消息（JSON 行，按时间正序） |
| `msg:v1:idx:updated` | ZSet | 永久 | 会话按最后活动时间排序（收件箱主索引） |
| `msg:v1:idx:status:<status>` | Set | 永久 | 按状态筛选 |
| `msg:v1:conv:all` | Set | 永久 | 全部会话 ID（计数 / 备份遍历，替代 SCAN） |
| `msg:v1:idem:<cid>` | Hash | 24h | 幂等：`client_request_id → messageId` |
| `msg:v1:unread` | String | 永久 | 全局未读会话计数（侧边栏徽标） |
| `msg:v1:adminlog` | List | 永久（LTRIM 2000） | 管理员操作日志 |
| `msg:v1:accesslog` | List | 90d | 凭证兑换与限流命中记录 |
| `msg:v1:rl:<bucket>:<id>` | String | 60s–86400s | 限流计数（见 §7） |
| `msg:v1:meta:schema` | Hash | 永久 | `{ version: 1, createdAt }`（迁移标记） |

> 所有时间字段存 **epoch 毫秒整数**（不是 ISO 字符串）：便于 ZSet score 与比较；返回给前端时再转 ISO。

---

## 3. 会话记录（Hash）

`msg:v1:conv:<cid>` 字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 与键名一致的会话 ID（16 字符 base64url） |
| `visitor_name` | string | 昵称（1–40） |
| `visitor_email` | string \| `""` | 选填（≤254），列表接口脱敏返回 |
| `token_hash` | string | `HMAC-SHA256(token, MESSAGE_TOKEN_SECRET)`，base64url |
| `token_issued_at` | int | 创建时间（ms） |
| `token_revoked_at` | int \| `0` | 0 = 有效 |
| `status` | string | `unread` \| `read` \| `processing` \| `resolved` \| `archived` \| `spam` |
| `deleted_at` | int \| `0` | 软删除标记 |
| `created_at` | int | ms |
| `updated_at` | int | 任何字段变更即更新 |
| `last_message_at` | int | 最后一条消息时间（ZSet score 同源） |
| `last_visitor_at` | int | 最后一条访客消息时间 |
| `last_admin_at` | int | 最后一条管理员消息时间 |
| `message_count` | int | `HINCRBY`，避免 `LLEN` 依赖 |
| `visitor_msg_count` | int | 访客消息数 |
| `unread_count` | int | 管理员未读的访客消息数 |
| `resolved_at` / `archived_at` / `spam_at` | int \| `0` | 状态时间戳 |
| `email_opt_in` | `0`/`1` | 预留（v1 不主动发信） |
| `first_path` / `first_referrer` | string | 可选：会话发起页（≤200，仅站点内路径；不存完整 Referer） |

**为什么用 Hash 而不是一个 JSON blob**：`status`、`unread_count`、`last_message_at`、`message_count` 都需要 `HINCRBY`/`HSET` 单字段原子更新；整块 JSON 会引入读-改-写竞态（两个请求同时回复会互相覆盖）。

---

## 4. 消息记录（List 中的 JSON 行）

`msg:v1:msgs:<cid>` 每条元素：

```json
{
  "id": "m_01J8Z...",
  "sender": "visitor",
  "content": "……",
  "created_at": 1763600000000,
  "read_at": 0,
  "client_request_id": "uuid"
}
```

- `sender ∈ {visitor, admin}`；`read_at` 只对 `visitor` 有意义（管理员看过后写入）。
- 消息 ID：`m_` + `base36(时间戳)` + `_` + `randomToken(6)`，天然按时间有序且可读。
- 写入：`RPUSH`（追加）；读取：`LRANGE key -N -1` 取最近 N 条，分页用 `LRANGE key start stop`。
- **不接受编辑/删除单条消息**（v1 无此需求），因此 List 足够；若将来要单条删除，改用 Hash `msg:v1:msgs:<cid>`（field=消息 ID）即可平滑迁移。
- 单会话上限：**2000 条**（超限拒绝并提示"会话过长，请新建"），防止单键无限增长。

---

## 5. 索引与查询路径

| 需求 | 查询路径 | 复杂度 |
| --- | --- | --- |
| 收件箱（按最后活动倒序，第 1 页 20 条） | `ZREVRANGE msg:v1:idx:updated 0 19` → `MGET/HGETALL` 批量取 20 个会话 | O(log N + 20) |
| 未读筛选 | `SMEMBERS msg:v1:idx:status:unread`（或 ZSet 过滤）→ 取会话 | O(k) |
| 关键词搜索 | **不建全文索引**：拉取最近 500 个会话的 `visitor_name` + 最后一条消息摘要，服务端内存过滤 | O(500) 可接受 |
| 全局未读数 | `GET msg:v1:unread` | O(1) |
| 会话详情 | `HGETALL conv` + `LRANGE msgs` | O(1) + O(页大小) |
| 备份遍历 | `SMEMBERS msg:v1:conv:all` → 逐个读取 | O(N) |

**搜索的取舍**（需要管理员确认）：个人博客会话量小，v1 用"最近 500 条内存过滤"即可；若要求全量搜索，需要额外维护 n-gram 索引（成本高），建议放到 Phase 3+ 再评估。

---

## 6. 写入流程与一致性

### 6.1 创建会话（跨 5 个键）

```text
1. cid = randomToken(12); token = randomToken(32); hash = HMAC(token)
2. HSET msg:v1:conv:<cid> {...}        ← 先写主记录（若后续失败，会话存在但无消息）
3. RPUSH msg:v1:msgs:<cid> <首条消息>
4. HSET conv message_count=1, unread_count=1, last_message_at=now
5. ZADD msg:v1:idx:updated now cid
6. SADD msg:v1:conv:all cid; SADD msg:v1:idx:status:unread cid; INCR msg:v1:unread
7. 返回 cid + link（token 只在此刻出现）
```

Redis 单命令原子、多命令非原子。失败窗口（步骤 2 之后崩溃）会产生"空会话"：**用补偿修复**——`GET /api/admin/messages/stats` 时顺带清理 `message_count=0 且 created_at > 10 分钟前` 的会话（幂等、低风险）。不引入 Lua 脚本，保持可读性与可测试性。

### 6.2 追加消息（访客或管理员）

```text
1. 校验会话存在、未删除、status != spam
2. 幂等：HEXISTS msg:v1:idem:<cid> client_request_id → 命中则直接返回已有 messageId
3. RPUSH msgs；HSET conv message_count+1、last_message_at、last_visitor_at/last_admin_at
4. 访客消息：HINCRBY unread_count 1；status ∈ {read,resolved,archived,processing} → status=unread；
   SADD idx:status:unread；SREM 旧状态；INCR msg:v1:unread（仅当 unread_count 从 0→1）
5. ZADD idx:updated now cid
6. HSET idem client_request_id messageId（TTL 24h）
```

### 6.3 标记已读（管理员打开详情）

```text
1. 读 msgs，找出 sender=visitor 且 read_at=0 的条目
2. 逐条重写该行（LSet）或直接重写整个区间（v1 用"读最近 200 条 → 重写"）
3. HSET conv unread_count=0；status: unread → read；SREM idx:status:unread；SADD idx:status:read
4. DECR msg:v1:unread
```

> `LSet` 需要新增原语 `kvLset`；或用"读改写 List"（200 条内可接受）。**建议同时新增 `kvLset` 与 `kvLlen`**（两行包装）。

---

## 7. 限流键（全部走 `kvIncr + kvExpire`）

| 键 | 窗口 | 阈值（初值） |
| --- | --- | --- |
| `msg:v1:rl:create:ip:<hashIp>` | 600s / 86400s | 3 / 10 |
| `msg:v1:rl:create:global:<yyyymmdd>` | 86400s | 200 |
| `msg:v1:rl:send:conv:<cid>:1m` | 60s | 5 |
| `msg:v1:rl:send:conv:<cid>:1h` | 3600s | 30 |
| `msg:v1:rl:exchange:ip:<hashIp>:1m` | 60s | 10 |
| `msg:v1:rl:exchange:ip:<hashIp>:1h` | 3600s | 60 |
| `msg:v1:rl:exchange:fail:<hashIp>` | 1800s | 10（超限封 30 分钟） |

`<hashIp> = hashIp(clientIp(req), MESSAGE_TOKEN_SECRET)` —— 与 `lib/admin/crypto.js:38` 同一实现，**不落明文 IP**。

---

## 8. 容量、保留期与配额

| 项 | 估算 | 说明 |
| --- | --- | --- |
| 单会话元数据 | ≈ 1.2KB | Hash |
| 单条消息 | ≈ 0.35KB（500 字中文） | JSON |
| 1 万会话 × 8 条 | ≈ 40MB | 含索引 |
| Upstash 免费额度 | 256MB / 500K 命令/月 | 1 万会话读写下仍在额度内 |

保留期：

| 数据 | 策略 |
| --- | --- |
| 正常会话/消息 | 长期保留，管理员可删 |
| `spam` 会话 | 建议 30 天后可一键清理（`mode=purge`） |
| `accesslog` | 90 天（写入即 `EXPIRE`） |
| `adminlog` | 2000 条（`LTRIM`） |
| `idem` | 24h |

---

## 9. 备份、导出与迁移

### 9.1 备份（v1 必须提供）

- Upstash 付费档自带每日备份；免费档没有 → **提供 `scripts/messages-export.mjs`**：
  `SMEMBERS msg:v1:conv:all` → 逐会话 `HGETALL + LRANGE` → 输出单个 JSON（含 schema 版本号）到本地或指定路径。
- 导出文件**不得进入 Git**（加入 `.gitignore`：`*.messages-backup.json`）。
- 建议每月手动导一次；Phase 5 部署指南里写进运维步骤。

### 9.2 删除策略

| 操作 | 行为 |
| --- | --- |
| 归档 | `status=archived`，数据不动 |
| 软删除 | `deleted_at=now`；列表与访客接口均不可见；数据保留以便误删恢复 |
| 彻底删除（purge） | 删除 `conv / msgs / idem`，`ZREM idx:updated`，`SREM` 两个 Set，修正 `unread` 计数 |
| spam 清理 | 对 `status=spam 且 spam_at < now-30d` 批量 purge（脚本，不自动跑） |

**顺序保证**：先删索引（让它在列表里消失）→ 再删主记录 → 最后删消息列表。中断最多留下"孤儿 msgs 键"，由导出/巡检脚本发现（`SMEMBERS conv:all` 里没有对应 conv 的 `msgs:*` 才可能是孤儿；由于无法 SCAN，孤儿键只能通过记录在 `adminlog` 里的 cid 定位并清理）。

### 9.3 迁移到 SQL（未来）

`msg:v1:meta:schema = { version: 1 }` 作为迁移锚点；导出 JSON 的字段名与 SQL 列名一一对应（`visitor_name / visitor_email / status / …`），可直接 `INSERT`。反向（SQL → Redis）同理。

---

## 10. 需要新增的 KV 原语（唯一非"纯新增文件"的改动）

`lib/kv.js` 追加（ioredis 已支持，非新依赖）：

```js
kvZadd(key, score, member)          // zadd
kvZrange(key, start, stop, { rev }) // zrange / zrevrange
kvZrem(key, member)                 // zrem
kvZcard(key)                        // zcard
kvLset(key, index, value)           // lset（标记已读时用）
kvLlen(key)                         // llen（可选，message_count 已冗余）
```

内存后端（`ADMIN_ALLOW_MEMORY_STORE=true` 的开发/测试模式）需要同步实现这 6 个函数，否则本地测试无法跑通。这是 Phase 1 的第一件事。

---

## 11. 与规范 SQL 的字段对照

| 规范 `conversations` | 本方案 Hash 字段 | 说明 |
| --- | --- | --- |
| `id` | `id` | 同 |
| `visitor_name` | `visitor_name` | 同 |
| `visitor_email` | `visitor_email` | 空字符串代替 NULL |
| `access_token_hash` | `token_hash` | HMAC-SHA256 |
| `status` | `status` | 增加 `deleted_at` 软删 |
| `created_at` / `updated_at` | 同名（ms 整数） | 统一 UTC 毫秒 |
| `last_message_at` | 同名 | 同时作 ZSet score |
| `resolved_at` / `archived_at` | 同名 | — |

| 规范 `messages` | 本方案 List JSON | 说明 |
| --- | --- | --- |
| `id` | `id` | `m_<base36 ts>_<rand6>` |
| `conversation_id` | 由键名承载 | 不冗余存储 |
| `sender_type` | `sender` | `visitor` / `admin` |
| `content` | `content` | 纯文本 |
| `created_at` | `created_at` | ms |
| `read_at` | `read_at` | 0 = 未读 |
| `client_request_id` | `client_request_id` | 幂等 |

`conversation_access_logs` → `msg:v1:accesslog`（List，90 天 TTL）。
`message_rate_limits` → `msg:v1:rl:*`（Ttl 计数键，见 §7）。

---

## 12. 本阶段结论

1. 数据层**不需要新建数据库**，但**强烈建议新建一个独立 Upstash 库**专放 `msg:v1:*`（避免缓存淘汰策略影响私信）。
2. 需要新增 **6 个 KV 原语**（含内存后端实现），这是 Phase 1 的第一步。
3. 会话用 Hash + 消息用 List + 两个索引（ZSet/Set）+ 幂等 Hash，足以覆盖规范里的全部查询需求；**唯一取舍是"搜索只覆盖最近 500 会话"**，需要管理员确认可接受。
4. 备份靠导出脚本（免费档无自动备份），删除走"软删 → purge"两段式。
