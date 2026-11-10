# 部署指南 —— Jason Blog Admin（Phase 1）

本指南假设部署形态不变：**同一个 GitHub 仓库、同一个 Vercel 项目、同一个域名**。不新建站点、不新建 Vercel 项目、不改 DNS。

---

## 1. 需要新增的环境变量

只加到 **Vercel → Settings → Environment Variables**（Production；如需在 Preview 使用后台，再加到 Preview）。

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `ADMIN_USERNAME` | ✅ | 管理员账号（建议不含空格） |
| `ADMIN_PASSWORD_HASH` | ✅（或改用一次性初始化） | 密码哈希，**不是明文**；由下方脚本生成 |
| `SESSION_SECRET` | ✅ | 会话签名密钥，≥ 32 字符随机串 |
| `REDIS_URL` | ✅ | 生产已有（Upstash 风格），会话/限流/审计都依赖它；缺失则后台 503 |
| `ADMIN_ENABLE` | — | 默认 `true`；设为 `false` 可整体关闭后台 |
| `ADMIN_INIT_TOKEN` | — | 若不想把哈希写进环境变量，用它做一次性初始化（见 §4） |
| `ADMIN_SESSION_IDLE_MIN` | — | 空闲超时，默认 30（分钟） |
| `ADMIN_SESSION_TTL_HOURS` | — | 绝对有效期，默认 12（小时） |
| `ADMIN_LOGIN_MAX_FAILS` | — | 默认 5 次 |
| `ADMIN_LOGIN_WINDOW_MIN` | — | 默认 15 分钟 |
| `ADMIN_PASSWORD_ALGO` | — | 设为 `bcrypt` 且安装 `bcryptjs` 后，新哈希用 bcrypt（默认 scrypt） |

> ⚠️ **绝对不要**把这些变量写进 `blog.config.js` / `conf/*.config.js` / Notion 配置表：
> `siteConfig()` 会把配置序列化进公开页面的 `__NEXT_DATA__`（审计报告 F-01 已证明该通道存在）。

---

## 2. 生成密码哈希与会话密钥（在本地执行，不联网）

```bash
node scripts/admin-hash-password.mjs "你的强密码" --username=admin
# 输出形如：scrypt$32768$8$1$<salt>$<hash>   （或 $2a$12$… 若启用 bcrypt）

node scripts/admin-gen-secret.mjs
# 输出 48 字节 base64url 随机串
```

把输出分别粘贴到 `ADMIN_PASSWORD_HASH` 与 `SESSION_SECRET`。密码要求：≥12 位、同时含字母与数字、不含用户名。

---

## 3. 首次部署后的验证（5 条命令）

```bash
# 1) 后台入口未登录 → 应 307 到登录页
curl -sI https://blog.20240606.xyz/admin | head -3

# 2) 后台 API 未登录 → 应 401 JSON（不是 HTML）
curl -s -o /dev/null -w '%{http_code}\n' https://blog.20240606.xyz/api/admin/session

# 3) 登录页可访问且不缓存
curl -sI https://blog.20240606.xyz/admin/login | grep -i -E 'HTTP/|cache-control|x-robots-tag|x-frame-options'

# 4) 公开页面不受影响
curl -s -o /dev/null -w '%{http_code}\n' https://blog.20240606.xyz/

# 5) 登录（手动在浏览器打开 /admin/login，用 ADMIN_USERNAME + 密码）
```

预期：

- `/admin` → `307`，`location: /admin/login?next=%2Fadmin`
- `/api/admin/session` → `401`
- `/admin/login` → `200`，`cache-control: private, no-store...`，`x-robots-tag: noindex...`
- `/` → `200`（内容与部署前一致）

---

## 4. 一次性初始化（可选，替代 `ADMIN_PASSWORD_HASH`）

1. 只配置 `ADMIN_USERNAME`、`SESSION_SECRET`、`REDIS_URL`、`ADMIN_INIT_TOKEN`（随机 32+ 字符）。
2. 部署后执行：

```bash
curl -s -X POST https://blog.20240606.xyz/api/admin/init \
  -H 'Content-Type: application/json' \
  -d '{"token":"<ADMIN_INIT_TOKEN>","username":"admin","password":"<强密码>"}'
# 期望：201 {"ok":true,"login":"/admin/login"}
```

3. 初始化成功后再访问同一端点会返回 `409 already_initialized`（入口永久关闭）。
4. 完成后建议删除 `ADMIN_INIT_TOKEN`（不是必须，但更干净）。

---

## 5. Redis 使用说明（重要）

- 复用现有 `REDIS_URL`，不新建实例；后台键空间与现有键严格分离：

```text
admin:sess:<sha256(sid)>    会话（空闲 30min 滑动 / 绝对 12h）
admin:sess:uid:<uid>        该管理员的会话集合（改密时批量失效）
admin:user:<username>       管理员账户（哈希）
admin:bootstrapped          初始化标记
admin:rl:login:<hash>       登录失败计数（15min 窗口）
admin:rl:login:ip:<hash>    登录失败计数（IP 维度）
admin:audit                 审计日志 List（最多 5000 条，90 天 TTL）
```

- 现有 `global_data_*`、`site_*`、`rank:*`、`notify:data` **不会被读写**。
- **Redis 不可用时后台一律 503**（fail-closed），公开博客不受影响。

---

## 6. 本地开发

```bash
# 本地没有 Redis 时，可显式启用内存后端（生产环境该开关无效）
ADMIN_USERNAME=admin \
ADMIN_PASSWORD_HASH='<上一步生成>' \
SESSION_SECRET='<上一步生成>' \
ADMIN_ALLOW_MEMORY_STORE=true \
npm run dev
```

- `ADMIN_ALLOW_MEMORY_STORE` **只在 `NODE_ENV!==production` 且非 Vercel 构建时**生效；生产永远拒绝。
- 本地登录 → `http://localhost:3000/admin/login`。

---

## 6.5 Phase 6 新增环境变量与定时任务

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `CRON_SECRET` | 定时任务必需 | 未配置时 `/api/cron/*` 一律 503；Vercel Cron 自动以 Bearer 发送 |
| `AI_API_KEY` | 可选 | OpenAI 兼容 key；缺失时日报只发原始数据 |
| `AI_BASE_URL` | 可选 | 默认 `https://api.deepseek.com/v1` |
| `AI_MODEL` | 可选 | 默认 `deepseek-chat` |
| `TELEGRAM_BOT_TOKEN` | 推送必需 | @BotFather 创建机器人后获得 |
| `TELEGRAM_CHAT_ID` | 推送必需 | 给机器人发一条消息后，用 `getUpdates` 取 `chat.id` |

生成 `CRON_SECRET`：

```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

`vercel.json` 已声明：

```json
"crons": [
  { "path": "/api/cron/sync-notion", "schedule": "0 1 * * *" },
  { "path": "/api/cron/digest", "schedule": "10 1 * * *" }
]
```

- 时间是 **UTC**：01:00 / 01:10 UTC = 北京时间 09:00 / 09:10；
- Hobby 计划只允许每日 1 次、最多 2 个任务；需要更频繁请升级或在外部调度器打同一个带 Bearer 的地址；
- 手动冒烟：`curl -H "Authorization: Bearer $CRON_SECRET" https://<域名>/api/cron/digest`；
- 本地验证不想用真实密钥时：`python tests/stub_services.py` + `tests/admin_phase6.py`（桩会记录请求，便于核对发出去的内容）。

---

## 7. 部署顺序建议（安全起见）

1. 合并到分支 → Vercel **Preview** 部署。
2. 在 Preview 的 URL 上完成 §3 的 5 条验证 + 登录/改密全部走通。
3. 配置 Production 环境变量（先不要给别人密码）。
4. 合并到 `main` → Production 部署。
5. 生产上再跑一次 §3，并在 `/admin/settings` 确认审计日志出现 `login.success`。
6. 确认公开站点：首页、任一文章页、分类页、标签页、搜索、评论区、桌宠、移动端。

---

## 8. 回滚

| 场景 | 操作 |
| --- | --- |
| 后台有 bug、公开站点正常 | Vercel 回滚到上一个 Deployment（不影响公开页面） |
| 想立即关闭后台 | 设 `ADMIN_ENABLE=false` → 重新部署；`/admin` 返回 503，公开站点无影响 |
| 密钥泄漏 | 轮换 `SESSION_SECRET`（所有会话立即失效）+ 改密；必要时轮换 `REDIS_URL` |
| 完全移除后台 | 还原 4 个文件（见 `CHANGELOG.md`「回滚方式」），删除后台目录与新增环境变量 |

---

## 9. 构建与 CI 注意事项

- 新增文件全部为 `.js`（Tailwind 的 `content` 只扫 `**/*.js`，用 `.tsx` 会掉样式）。
- 后台页面**禁止** `getStaticProps`：会被 ISR/CDN 缓存，等于把管理页 HTML 发给所有人。
- 未新增依赖（本阶段），因此 `yarn.lock` 无变化，CI 的 lockfile 门禁不受影响。
- CI 会跑 `yarn lint` / `yarn type-check` / `yarn test`；本地已验证 lint 0 error、`tsc --noEmit` 通过。

---

## 10. 尚未配置的东西（Phase 2+ 再说）

| 项 | 阶段 |
| --- | --- |
| 统计接收端点 `/api/track` 与前端 SDK | Phase 2 |
| 统计键空间 `stats:v1:*` 与聚合 | Phase 2/3 |
| Notion 同步（只读）与同步日志 | Phase 4 |
| Twikoo 评论数 | Phase 4 |
| Google Search Console | Phase 5 |
| 站点健康探针 / 失效链接 | Phase 5 |
