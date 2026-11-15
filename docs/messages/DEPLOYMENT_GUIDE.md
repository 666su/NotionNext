# DEPLOYMENT GUIDE —— Jason Blog Messages

- 仓库：`666su/NotionNext`（Next.js Pages Router / Vercel）
- 数据库：复用现有 Supabase 项目，schema `messages`
- 本文件覆盖：Phase 1 上线所需的全部步骤；Phase 2/3 的页面部署见各自阶段文档

---

## 1. 环境变量（Vercel → Settings → Environment Variables）

| 变量 | 必需 | 值来源 | 备注 |
| --- | --- | --- | --- |
| `SUPABASE_URL` | ✅ | 项目 Dashboard → Data API | `https://<ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | ✅ | Settings → API Keys → **Secret keys** | 服务端专用；**绝不可**加 `NEXT_PUBLIC_` |
| `MESSAGE_TOKEN_SECRET` | ✅ | `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"` | ≥32 字节；**必须与 `SESSION_SECRET` 不同** |
| `MESSAGES_ENABLED` | 可选 | `true`（默认） | `false` 时所有 `/api/messages/*` 返回 503 |
| `MESSAGES_MAX_MESSAGES_PER_CONVERSATION` | 可选 | 默认 `2000` | 单会话上限 |
| `MESSAGES_COOKIE_TTL_SEC` | 可选 | 默认 `604800`（7 天） | 私密 Cookie 有效期 |

> 三个环境（Production / Preview / Development）建议**都配**，否则 Preview 上私信接口会 503。
> 密钥只填在 Vercel 与本地 `.dsh-ops/` 文件里，**不要**贴到聊天或提交到仓库。

---

## 2. 数据库（一次性，已由 DSH 在开发阶段执行）

```bash
# 凭据放本地（gitignored）
mkdir -p .dsh-ops
cp docs/messages/db-credentials.example.env .dsh-ops/messages-db.env
# 填 SUPABASE_ACCESS_TOKEN / SUPABASE_URL / SUPABASE_SECRET_KEY

node scripts/messages-db.mjs inspect          # 只读：库大小 / public 表 / 角色 / 连接数
node scripts/messages-db.mjs plan             # 待执行迁移
node scripts/messages-db.mjs migrate --target=dev
node scripts/messages-db.mjs verify           # 表 / RLS / 策略数 / 索引 / 台账 / 权限
```

生产迁移（若需重跑或新增迁移）必须：提交 SQL + 影响分析 + 回滚方案 → 管理员确认 →
`MESSAGES_ALLOW_PROD=1 node scripts/messages-db.mjs migrate --target=prod --yes`。

**平台配置**：Settings → API → Exposed schemas 需包含 `messages`
（等价于 `PATCH /v1/projects/<ref>/postgrest { "db_schema": "public,graphql_public,messages" }`）。
回退：改回 `public,graphql_public`。

---

## 3. 部署步骤（Phase 1）

1. 合并到分支 → 推到 GitHub。
2. Vercel 自动创建 **Preview** 部署；先只配 Preview 的环境变量。
3. Preview 验证（见 §4）。
4. 确认后把环境变量加到 Production，再合并 `main`。
5. 生产验证（同 §4）。

---

## 4. 上线后自检（3 分钟）

```bash
# 1) 未登录访问管理员接口应为 401（不是 200，也不是 500）
curl -s -o /dev/null -w "%{http_code}\n" https://<域名>/api/admin/messages/stats

# 2) 未登录访问访客接口应为 403（不是 404——404 说明路由没部署上）
curl -s -o /dev/null -w "%{http_code}\n" https://<域名>/api/messages/conversations/abcdefghijklmnop

# 3) 创建接口跨站应被挡（403）
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://<域名>/api/messages/conversations \
  -H 'Content-Type: application/json' -H 'Origin: https://evil.example.com' \
  -d '{"visitor_name":"x","content":"x"}'

# 4) 正常创建（应返回 201 + link 含 fragment）
curl -s -X POST https://<域名>/api/messages/conversations \
  -H 'Content-Type: application/json' -H 'Origin: https://<域名>' \
  -d '{"visitor_name":"自检","content":"上线自检消息"}' | head -c 300
```

后台侧：`/admin/messages/stats`（登录后）应返回数字；`unreadConversations ≥ 1` 表示自检消息已入库。
**记得把自检产生的会话删掉**（Phase 3 提供删除；当前可用 SQL `delete from messages.conversations where visitor_name='自检'`）。

---

## 5. 监控与容量

| 指标 | 阈值 | 怎么看 |
| --- | --- | --- |
| 数据库大小 | < 70% 额度（FREE 500MB） | Supabase → Settings → Usage；或 `node scripts/messages-db.mjs inspect` |
| 连接数 | < 60 的 80% | `inspect` 第 7 节 |
| 私信写入失败 | > 0 次/小时 | Vercel → Functions → Logs 搜 `[messages][db]` |
| 限流命中 | 突增说明被刷 | 日志搜 `[messages][rate]` |
| 项目休眠 | FREE 计划 7 天无活动 | 已挂每日 cron 心跳（`/api/cron/digest` 顺带 `select`） |

容量不足时：写入会返回 `503 store_unavailable`，**不会静默丢弃**（规范要求）。

---

## 6. 回滚

```bash
# 代码（Phase 1 范围）
git checkout -- .env.example .gitignore pages/api/cron/digest.js
rm -rf lib/messages pages/api/messages pages/api/admin/messages conf/messages.config.js \
       scripts/messages-db.mjs docs/messages/migrations tests/messages_phase1.py

# 数据库
#   Supabase SQL Editor 执行 docs/messages/migrations/0001_messages_init.down.sql
#   （drop schema messages cascade；public 不受影响）

# API 暴露（可选，彻底移除痕迹）
#   PATCH /v1/projects/<ref>/postgrest { "db_schema": "public,graphql_public" }
```

回滚后自检：`/`、`/article/*`、`/admin` 均正常；`/api/messages/*` 变 404（路由已删）。

---

## 7. 凭据轮换

| 凭据 | 轮换方式 | 影响 |
| --- | --- | --- |
| `SUPABASE_SECRET_KEY` | Settings → API Keys → 新建 secret → 更新 Vercel → 删旧 key | 旧 key 立即失效，需重新部署 |
| `MESSAGE_TOKEN_SECRET` | 生成新值 → 更新 Vercel | **所有已有私密 Cookie 失效**（访客需重新点开链接兑换）；库内 `token_hash` 用旧密钥生成，**会全部验签失败** → 轮换前必须先批量重签或接受访客重新建会话，见下方说明 |
| `SUPABASE_ACCESS_TOKEN`（迁移用） | 用完即在 Account → Access Tokens 撤销 | 只影响本机迁移脚本 |

> ⚠️ `MESSAGE_TOKEN_SECRET` 轮换是**破坏性操作**：现有会话的 `token_hash` 无法用新密钥验证。
> 正确做法（Phase 4 提供脚本）：先用旧密钥校验并重签所有 `token_hash`，再切换环境变量。
> 在此之前，轮换等价于"所有访客失去访问权，需要新建会话"。

---

## 8. 备份与清理（Phase 5）

```bash
# 备份（默认 target=prod，输出到 .dsh-ops/，文件名带时间戳）
node scripts/messages-db.mjs backup

# 只导某一天/某一批（示例：dev 环境，最多 500 个会话）
node scripts/messages-db.mjs export --target=dev --limit=500 --out=.dsh-ops/backup-dev.json

# 清理预演（默认 dry-run，只统计不删除）
node scripts/messages-db.mjs cleanup --spamDays=30 --deletedDays=90

# 真正执行清理
node scripts/messages-db.mjs cleanup --spamDays=30 --deletedDays=90 --apply
```

要点：

- 备份文件含 `visitor_email`、消息正文与 `token_hash`（恢复访问权需要它）——**必须当机密对待**，
  已加入 `.gitignore`（`messages-export-*.json`、`*.messages-backup.json`）。
- `cleanup` 只删「spam 超过 N 天」与「软删超过 N 天」的会话；正常会话永远不会被自动清理。
- 删除是不可逆的：**先 `backup`，再 `cleanup --apply`**。
- 免费档没有自动备份，建议每月手动跑一次 `backup` 并把文件放到本地加密盘。

## 9. 私信上线后的值班检查

| 频率 | 动作 |
| --- | --- |
| 每天 | `/admin/messages` 看未读；`/admin/health` 看存储与探针 |
| 每周 | `node scripts/messages-db.mjs inspect` 看库大小与连接数（<70% 额度） |
| 每月 | `backup` + 检查 `.dsh-ops/` 备份文件是否可读 |
| 每季 | `cleanup`（dry-run 先看） |
| 变更前 | 任何 `MESSAGE_TOKEN_SECRET` 轮换前先读 `DEPLOYMENT_GUIDE §7`（会让所有 token_hash 失效） |
