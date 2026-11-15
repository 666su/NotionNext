# MIGRATIONS —— 私信库迁移规程

> 管理员 2026-11-15 的要求：**迁移由 DSH 执行、用迁移文件管理、先在开发/预览执行验证、
> 不直接改生产；生产迁移须提交 SQL + 影响分析 + 回滚方案，确认后执行。**

本文件就是这套规程，配合 `scripts/messages-db.mjs` 与 `docs/messages/migrations/`。

---

## 1. 为什么是「独立 schema」而不是 new project

- 管理员要求**复用现有 Supabase 项目、不新建项目**。
- 因此隔离手段从"另一个项目"变成"另一个 **schema**"：`messages.*`，与 `public.*` 零耦合。
- 现有业务表（`claude_contribution_events_v1` 等）位于 `public`，本次迁移**不触碰**它们：
  无 `ALTER`、无 `GRANT` 扩散、无共享序列、无外键指向 `public`。
- 回滚极其干净：`drop schema messages cascade` —— 不影响 `public` 的任何对象。

**代价（如实说明）**：同一个数据库实例内，私信与业务表**共享存储容量与连接数**。
所以必须做容量与连接监控（见 §6），并且 `0001` 迁移里对私信的写入量有硬限制
（单会话 ≤2000 条、正文 ≤5000 字符）。

---

## 2. 凭据放置（一次性）

```bash
mkdir -p .dsh-ops                       # 已在 .gitignore 内
cp docs/messages/db-credentials.example.env .dsh-ops/messages-db.env
# 然后编辑 .dsh-ops/messages-db.env，填 SUPABASE_ACCESS_TOKEN 与 SUPABASE_PROJECT_REF
```

- Token 建议用**临时 PAT**，迁移验证完即撤销。
- 脚本**不会打印**这两个值，也不会写进任何日志/输出文件。
- 任何情况下**不要**把 service_role key 或 PAT 发到对话里。

---

## 3. 命令清单

```bash
node scripts/messages-db.mjs inspect            # 只读：库大小 / schema / public 表行数 / 角色 / RLS / 连接
node scripts/messages-db.mjs plan               # 待执行迁移清单（含 checksum）
node scripts/messages-db.mjs migrate --target=dev --dry-run
node scripts/messages-db.mjs migrate --target=dev
node scripts/messages-db.mjs verify             # 表 / RLS / 策略数 / 索引 / 台账 / 权限
node scripts/messages-db.mjs export --target=dev   # 导出 JSON 备份到 .dsh-ops/
node scripts/messages-db.mjs print              # 打印 SQL（不想给 token 时走 SQL Editor 手动执行）
```

`migrate` 的安全闸门：

| 目标 | 要求 |
| --- | --- |
| `--target=dev` | 直接执行（每个迁移包在 `begin; … commit;` 里，失败整体回滚） |
| `--target=prod` | 必须同时满足 `MESSAGES_ALLOW_PROD=1` **且** `--yes`，否则拒绝并打印生产流程 |

---

## 4. 开发/预览验证顺序（本次要走的）

```text
1. inspect                → 记录：DB 总大小、public 表行数基线、连接数
2. plan                   → 确认只有 0001_messages_init 待执行
3. migrate --target=dev   → 创建 messages schema
4. verify                 → 表齐全 / RLS 全 true / 策略数 0 / 索引齐全 / service_role 有权限
5. 代码联调                → lib/messages/* + API 读写；用真实项目但只写 messages.*
6. export --target=dev    → 确认导出的 JSON 结构可用于回灌
7. 记录"迁移后"指标         → DB 大小增量、public 行数是否变化（应为 0）
```

> 说明：因为只有一个 Supabase 项目，"dev/预览"指的是**同一项目内的隔离 schema + 本地/预览代码路径**，
> 不是另一个数据库。生产切流由环境变量开关控制（`MESSAGES_ENABLED`），在管理员确认后才打开。

---

### 3.9 已执行清单（截至 2026-11-15）

| 版本 | 文件 | 内容 | 状态 |
| --- | --- | --- | --- |
| 0001 | `0001_messages_init.sql` | schema `messages` + conversations/messages/access_logs/schema_migrations + 12 索引 + RLS | ✅ 已应用（checksum `a3785fa8de4cf277`） |
| 0002 | `0002_tg_links.sql` | `tg_links`（TG 消息 ↔ 会话）+ `tg_updates`（update_id 幂等）+ 3 索引 | ✅ 已应用（2026-11-15，Phase 7） |

0002 的回滚：`node scripts/messages-db.mjs print` 取 `.down.sql` 内容后在 SQL Editor 执行，
只删这两张表，会话与消息不受影响（回滚后请同时 `node scripts/messages-tg-webhook.mjs delete`）。

---

## 5. 生产迁移：必须提交的四样东西

每次生产迁移都要在 PR/消息里给出：

1. **SQL**：`node scripts/messages-db.mjs print` 的完整输出（含 checksum）。
2. **影响分析**：见 §6 模板，逐项实测填写。
3. **回滚方案**：对应的 `.down.sql` + 执行命令 + 回滚后的验证点。
4. **验证点**：迁移后跑哪些查询、期望什么结果；业务侧做哪些冒烟（发一条私信、后台回一条）。

---

## 6. 影响分析模板（0001 已填，迁移前后需各测一次）

| 维度 | 迁移前 | 迁移后 | 判定 |
| --- | --- | --- | --- |
| `public` 表数量 | 记录 | 必须不变 | 不变=通过 |
| `public` 各表行数 | 记录 | 必须不变 | 不变=通过 |
| 数据库总大小 | 记录 | 增量应 < 5MB（空表+索引） | 记录增量 |
| 连接数峰值 | 记录 | 迁移期间 +1~2 | 无异常 |
| 新增 schema | 无 `messages` | 有 `messages` | 预期 |
| 全局角色/权限 | 不变 | 仅 revoke `messages` schema 的 anon/authenticated | 不扩散到 public |
| RLS 策略 | — | `messages` 三张表策略数 = 0 | 预期（service_role 绕过 RLS） |
| 既有扩展 | 记录 | 不变（0001 不装扩展） | 不变=通过 |

**已知风险与对策**

| 风险 | 对策 |
| --- | --- |
| 免费项目 7 天无活动被 paused | 复用现有 Vercel Cron，每日一次 `select 1` 心跳；`/admin/health` 显示私信库状态 |
| 与业务表共享 500MB 额度 | 写入硬限制 + `inspect` 记录 `pg_database_size`，超 70% 告警 |
| service_role key 泄露 | 只放服务端环境变量；`NEXT_PUBLIC_*` 绝不使用；迁移用临时 PAT |
| 迁移期间锁表 | 0001 只建新对象，不 `ALTER` 既有表；执行窗口避开定时任务（cron 在 01:00/01:10 UTC） |
| 多语句一次提交被 API 拒绝 | 已在 runner 里包 `begin; … commit;`；若 Management API 不支持多语句，改 `print` + SQL Editor 逐段执行 |

---

## 7. 回滚

```bash
# 1) 先备份（有数据时）
node scripts/messages-db.mjs export --target=prod --out=.dsh-ops/pre-rollback.json

# 2) 执行 down（等价于 drop schema messages cascade）
#    方式 A：SQL Editor 粘贴 0001_messages_init.down.sql
#    方式 B：runner 执行（推荐，带台账检查）
node scripts/messages-db.mjs migrate --target=prod --yes   # 需先停用 MESSAGES_ENABLED

# 3) 验证：messages schema 不存在、public 仍完好、博客与 /admin 正常
node scripts/messages-db.mjs inspect
```

回滚后代码侧只需关闭 `MESSAGES_ENABLED`（或还原 Phase 1 的提交），公开博客不受影响。

---

## 8. 命名与版本约定

- 文件名：`NNNN_<snake_case>.sql`，回滚同名 `.down.sql`。
- 一个迁移只做一件事；**禁止**在迁移里改 `public`。
- 已应用的迁移**不再修改**（改了 checksum 会与台账不一致）；要修正就加新迁移。
- `messages.schema_migrations` 记录 `version + checksum + applied_at`，由 runner 写入。
