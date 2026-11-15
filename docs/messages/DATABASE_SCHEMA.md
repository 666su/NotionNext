# DATABASE SCHEMA —— 私信库（PostgreSQL / Supabase）

- 实例：复用现有 Supabase 项目（FREE 计划，PG 17.11）
- **独立 schema**：`messages`（`public` 内 0 张表，互不影响）
- 迁移：`docs/messages/migrations/0001_messages_init.sql`（回滚：同名 `.down.sql`）
- 迁移台账：`messages.schema_migrations`（`version + checksum + applied_at`）

---

## 1. 表

### 1.1 `messages.conversations`

| 列 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | text | PK | 16 字符 base64url（`randomBytes(12)`） |
| `visitor_name` | text | NOT NULL, 1–40 字符 | 访客昵称 |
| `visitor_email` | text | ≤254，可空 | 选填；**列表接口脱敏返回** |
| `token_hash` | text | NOT NULL, ≥32 | `HMAC-SHA256("access:"+token, MESSAGE_TOKEN_SECRET)` |
| `status` | text | NOT NULL, CHECK 六值 | `unread/read/processing/resolved/archived/spam` |
| `created_at` | timestamptz | NOT NULL, default now() | UTC |
| `updated_at` | timestamptz | NOT NULL, default now() | 触发器自动维护 |
| `last_message_at` | timestamptz | — | 收件箱排序键（ZSet 等价物） |
| `last_visitor_at` / `last_admin_at` | timestamptz | — | 双方最后发言时间 |
| `message_count` | integer | NOT NULL default 0 | 单会话上限 2000 |
| `unread_count` | integer | NOT NULL default 0 | 管理员未读数（0/1 语义） |
| `resolved_at` / `archived_at` / `spam_at` | timestamptz | — | 状态时间戳 |
| `deleted_at` | timestamptz | — | 软删除；所有查询 `is null` 过滤 |
| `first_path` | text | ≤200 | 会话发起页（站内路径） |
| `meta` | jsonb | NOT NULL default '{}' | 预留扩展 |

### 1.2 `messages.messages`

| 列 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `id` | text | PK | `m_<base36 ts>_<rand6>` |
| `conversation_id` | text | NOT NULL, FK → conversations(id) **ON DELETE CASCADE** | 删会话连带删消息 |
| `sender` | text | NOT NULL, CHECK(`visitor`\|`admin`) | — |
| `content` | text | NOT NULL, CHECK 1–5000 | 纯文本 |
| `created_at` | timestamptz | NOT NULL | UTC |
| `read_at` | timestamptz | — | 仅访客消息有意义 |
| `client_request_id` | text | — | 幂等键；同会话内唯一 |

### 1.3 `messages.access_logs`

| 列 | 类型 | 说明 |
| --- | --- | --- |
| `id` | bigint identity | PK |
| `conversation_id` | text | 可空（兑换失败时可能没有有效 id） |
| `action` | text | `exchange` 等 |
| `result` | text | `ok` / `invalid_credential` / `rate_limited` |
| `ip_hash` | text | 加盐哈希前 8–24 位，**不含明文 IP** |
| `created_at` | timestamptz | 90 天保留（后续加清理任务） |

> 表已建，Phase 1 尚未写入（兑换失败计数目前走 Redis）。Phase 4 安全加固时补写入。

### 1.4 `messages.schema_migrations`

`version`(PK) / `checksum` / `applied_at`，由 `scripts/messages-db.mjs` 写入。

---

## 2. 索引

| 表 | 索引 | 用途 |
| --- | --- | --- |
| conversations | `conversations_inbox_idx (last_message_at desc nulls last) WHERE deleted_at IS NULL` | 收件箱排序 |
| conversations | `conversations_status_idx (status) WHERE deleted_at IS NULL` | 状态筛选 |
| conversations | `conversations_created_idx (created_at desc)` | 时间排序 |
| conversations | `conversations_spam_idx (spam_at) WHERE status='spam' AND deleted_at IS NULL` | 30 天垃圾清理巡检 |
| messages | `messages_conv_created_idx (conversation_id, created_at)` | 会话内分页 |
| messages | `messages_created_idx (created_at desc)` | 全局审计 |
| messages | `messages_idem_idx UNIQUE (conversation_id, client_request_id) WHERE client_request_id IS NOT NULL` | 幂等（部分唯一索引，NULL 不参与） |
| messages | `messages_unread_idx (conversation_id) WHERE read_at IS NULL AND sender='visitor'` | 标记已读 |
| access_logs | `access_logs_created_idx` / `access_logs_conv_idx` | 审计查询 |

---

## 3. 权限与 RLS（实测结果）

| 检查 | 结果 |
| --- | --- |
| 4 张表 RLS | 全部 `relrowsecurity = true` |
| 策略数量 | **0**（anon/authenticated 没有任何策略） |
| `anon` / `authenticated` schema USAGE | `false`（已被 revoke） |
| `anon`/`authenticated` 表权限数 | 0 |
| `service_role` schema USAGE + 表 CRUD | `true` / SELECT,INSERT,UPDATE,DELETE |

> 结论：即使 `messages` schema 已加入 PostgREST 的 Exposed schemas（**A 方案**），
> 拿 anon key 也只会得到 `42501 permission denied`；真正的访问只可能来自服务端的 service_role。

---

## 4. 与规范 SQL 的差异（已告知）

| 规范 | 实现 | 原因 |
| --- | --- | --- |
| `TEXT` 存时间字符串 | `timestamptz` | 时区正确、可索引排序、避免字符串比较 |
| 无 `deleted_at` | 增加软删除列 | 支持"删除需二次确认 + 可恢复" |
| 无 `unread_count` | 增加计数器 | 徽标轮询只需 count，不必扫消息 |
| `conversation_id` 外键无级联 | `ON DELETE CASCADE` | 删会话不留孤儿消息 |
| `client_request_id` 普通唯一 | **部分唯一索引** | 允许 NULL（不传幂等键时不冲突） |

---

## 5. 容量与保留（FREE 计划实测基线）

| 项 | 值 |
| --- | --- |
| 迁移前库大小 | 10 MB |
| 迁移后库大小 | 11 MB（+1 MB，空表 + 索引） |
| 免费额度 | 500 MB |
| 单会话上限 | 2000 条消息 |
| 单条上限 | 5000 字符 |
| 保留策略 | 正常长期；spam 30 天后可清理；access_logs 90 天 |
| 休眠风险 | FREE 项目 7 天无活动会暂停 → 已挂到每日 cron 心跳（`/api/cron/digest` 顺带 `select`） |

---

## 6. 回滚

```bash
# 选项 A：SQL Editor 执行
docs/messages/migrations/0001_messages_init.down.sql   # drop schema messages cascade

# 选项 B：runner（会先检查台账）
node scripts/messages-db.mjs print   # 确认内容
```

回滚后：`messages` schema 不存在；`public` 与既有服务完全不受影响；代码侧关闭 `MESSAGES_ENABLED` 即可。
