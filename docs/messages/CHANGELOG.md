# CHANGELOG —— Jason Blog Messages

按阶段记录：改了什么、动了哪些文件、新增环境变量、数据库变更、API 变更、回滚方式。

---

## Phase 0 —— 只读审计（2026-11-15）

**产出**（`docs/messages/`）：`PROJECT_SPEC.md`、`AUDIT_REPORT.md`、`ARCHITECTURE_PROPOSAL.md`、
`DATABASE_PROPOSAL.md`、`SECURITY_REVIEW.md`。

关键结论：

- 复用现有 Admin 会话/CSRF/Redis；零新依赖（`@supabase/supabase-js` 已在依赖里）。
- 5 处必须先解决的平台冲突：`/message` 被 `[prefix]/[slug]` 吞掉（404）、私密页会被套博客外壳并加载第三方脚本、
  全站 CORS `*`、右下角被回顶按钮+桌宠占用、私信链接域名会用错。
- 未改任何代码。

## Phase 1 —— 数据层与 API（2026-11-15）

### 存储决策变更（据管理员 2026-11-15 指示）

| 项 | Phase 0 提案 | Phase 1 落地 |
| --- | --- | --- |
| 私信内容 | Redis | **Supabase Postgres（独立 schema `messages`）** |
| Redis 用途 | 全部 | **仅限流计数等可丢状态**（`msg:v1:rl:*`） |
| 隔离方式 | 独立 Redis 库 | **独立 schema + RLS + revoke**（不新建项目、不新建库） |

### 新增文件

**数据库**

| 文件 | 说明 |
| --- | --- |
| `docs/messages/migrations/0001_messages_init.sql` | `create schema messages` + 3 表 + 台账 + 12 个索引 + RLS + revoke |
| `docs/messages/migrations/0001_messages_init.down.sql` | `drop schema messages cascade` |
| `scripts/messages-db.mjs` | 迁移执行器：`inspect/plan/migrate/verify/print/export`，prod 双闸门 |
| `docs/messages/MIGRATIONS.md` | 迁移规程 + 影响分析模板 + 回滚 |
| `docs/messages/DATABASE_SCHEMA.md` | 表/索引/权限/容量/回滚的最终形态 |

**代码（业务）**

| 文件 | 作用 |
| --- | --- |
| `conf/messages.config.js` | 长度、限流、Cookie TTL、单会话上限（非秘密） |
| `lib/messages/config.js` | 读环境变量 + fail-closed 判定 |
| `lib/messages/db.js` | Supabase 客户端单例（`db.schema='messages'`，仅服务端） |
| `lib/messages/tokens.js` | 会话 ID / 访问 token / HMAC / Cookie 签名与校验 |
| `lib/messages/validate.js` | 昵称/邮箱/正文校验、控制字符、同字符串压缩、honeypot、邮箱脱敏 |
| `lib/messages/rate-limit.js` | Redis 计数限流（Redis 故障退化进程内计数） |
| `lib/messages/auth.js` | 访客 Cookie 鉴权（签名 + 过期 + 会话绑定） |
| `lib/messages/respond.js` | 安全头、json、同源校验、Cookie 下发、私密链接拼装 |
| `lib/messages/store.js` | 创建/读取/追加/已读/状态/统计/列表（含幂等与补偿） |

**API（9 个）**

| 方法 | 路径 |
| --- | --- |
| POST | `/api/messages/conversations` |
| POST | `/api/messages/access/exchange` |
| GET | `/api/messages/conversations/[id]` |
| GET/POST | `/api/messages/conversations/[id]/messages` |
| GET | `/api/admin/messages/stats` |
| GET | `/api/admin/messages/conversations` |
| GET/PATCH | `/api/admin/messages/conversations/[id]` |
| POST | `/api/admin/messages/conversations/[id]/messages` |

**测试**

| 文件 | 说明 |
| --- | --- |
| `tests/messages_phase1.py` | 41 项：创建/幂等/校验/honeypot/跨站/兑换/Cookie/越权/限流/管理员全链路 |

### 修改的现有文件

| 文件 | 改动 |
| --- | --- |
| `.env.example` | 追加私信系统变量说明（`MESSAGES_ENABLED`、`SUPABASE_*`、`MESSAGE_TOKEN_SECRET` 等） |
| `.gitignore` | 忽略 `tg机器人.txt`、`*.messages-backup.json`、`messages-export-*.json` |
| `pages/api/cron/digest.js` | 顺带做一次私信库心跳（避免 Supabase FREE 项目 7 天无活动被暂停；不新增 cron） |

### 新增环境变量

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `SUPABASE_URL` | ✅ | 复用现有项目（`https://<ref>.supabase.co`） |
| `SUPABASE_SECRET_KEY` | ✅ | Settings → API Keys → Secret keys（服务端专用，**不可** `NEXT_PUBLIC_`） |
| `MESSAGE_TOKEN_SECRET` | ✅ | ≥32 字节随机；**必须与 `SESSION_SECRET` 不同** |
| `MESSAGES_ENABLED` | 可选 | 默认 `true`；`false` 时全部 503 |
| `MESSAGES_MAX_MESSAGES_PER_CONVERSATION` | 可选 | 默认 2000 |
| `MESSAGES_COOKIE_TTL_SEC` | 可选 | 默认 7 天 |

### 数据库变更（已执行，非生产切流）

1. 创建 schema `messages`（`public` 内 0 张表，未受影响；库大小 10MB → 11MB）。
2. 3 张业务表 + 迁移台账；12 个索引；4 张表 RLS 全开且**策略数 0**。
3. `revoke` anon/authenticated 的 schema USAGE 与表权限；`grant` service_role。
4. 项目 API 配置：`db_schema` 由 `public,graphql_public` 改为 `public,graphql_public,messages`
   （**可一行 PATCH 回退**；暴露 ≠ 可访问，anon 仍被 42501 拒绝）。

### 验证结果

- 结构：4 表 / 12 索引 / RLS 4/4 / 策略 0 / 台账已记（checksum `a3785fa8de4cf277`）
- 隔离：`has_schema_privilege('anon','messages','USAGE') = false`、表权限 0、`service_role = true`
- 功能：写入 201 / 读回 200 / 昵称 41 字 400(23514) / 缺 token_hash 400(23502) / 重复幂等 409(23505) / 级联删除生效
- 接口：`tests/messages_phase1.py` **41/41 通过**

### 回滚

```bash
# 1) 代码
git checkout -- .env.example .gitignore pages/api/cron/digest.js
rm -rf lib/messages pages/api/messages pages/api/admin/messages conf/messages.config.js \
       scripts/messages-db.mjs docs/messages/migrations tests/messages_phase1.py

# 2) 数据库
#    SQL Editor 执行 docs/messages/migrations/0001_messages_init.down.sql
#    （或 node scripts/messages-db.mjs print 确认后手动执行）

# 3) API 暴露（可选）
#    PATCH /v1/projects/<ref>/postgrest  { "db_schema": "public,graphql_public" }
```

回滚后：`messages` schema 不存在、`public` 不变、博客与 `/admin` 不受影响。

### 已知限制（Phase 1 未做）

1. 访客页面 `/message/[id]`、后台页面 `/admin/messages` → Phase 2 / 3。
2. `DELETE` 与软删/purge、后缀清理脚本 → Phase 3。
3. `access_logs` 表尚未写入（兑换失败计数暂走 Redis）→ Phase 4。
4. 会话列表搜索仅按昵称 `ILIKE`；未做全文索引。
5. `conversation_full`（>2000 条）只拒绝新消息，未提供"新建会话"引导 → Phase 2 前端处理。

## Phase 2 —— 访客端：私密会话页 + 悬浮入口（2026-11-15）

### 目标

让访客真的能用：右下角入口 → 填表 → 拿到链接 → 打开链接看回复 → 继续对话。
同时解决 Phase 0 的 **R2（路由被吞）** 与 **R3（私密页被套博客外壳）**。

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `pages/message/[id].js` | 私密会话页（静态路由优先于 `[prefix]/[slug]`；GSSP 设 no-store/noindex） |
| `components/messages/MessageThread.js` | 会话主体：兑换 token → 读会话/消息 → 20s 轮询 → 继续发言 |
| `components/messages/MessageComposer.js` | 输入框（Enter 发送 / Shift+Enter 换行 / 字数 / 发送中禁用） |
| `components/messages/MessageWidget.js` | 右下角悬浮入口 + 抽屉三视图（表单 / 成功 / 会话） |
| `components/messages/api.js` | 请求封装、错误文案、复制、清 hash |
| `tests/messages_phase2.py` | 19 项 HTTP 断言（路由/头部/隔离/robots） |

### 修改的现有文件

| 文件 | 改动 |
| --- | --- |
| `pages/_app.js` | 新增 `isMessagesRoute` 分支（不套 GLayout/SEO/ExternalPlugins/BlogPet/Tracker）；公开页面懒加载挂 `<MessageWidget/>` |
| `pages/api/robots.js` | 追加 `Disallow: /message`、`Disallow: /message/` |
| `next.config.js` | 新增 `/message/:path*` 与 `/api/messages/:path*` 两组安全头；私信接口 `Access-Control-Allow-Origin` 置空（只允许同源） |

### 交互与安全细节

- **入口位置**：桌宠占 right/bottom 20、尺寸 112（移动 84）；入口放在其上方
  （桌面 `bottom:148px`、移动 `bottom:116px`，`z-40` < 桌宠 `55`），抽屉打开时抬到 `z-70`。
- **凭证生命周期**：token 只在创建响应与 `#fragment` 中出现；兑换成功立即 `history.replaceState` 清掉 hash；
  抽屉关闭再打开仍能看到链接（组件未卸载），但**刷新页面即丢失**——成功页明确要求先复制保存。
- **草稿**：昵称/邮箱/正文写入 `localStorage`（**不含 token**），关闭抽屉或刷新都不丢输入。
- **继续上次对话**：只存 conversationId；cookie 失效时会落到"链接无效"提示，不会静默失败。
- **错误文案**：403 → "链接无效或已过期"；429 → "太频繁"；5xx → "服务暂不可用，内容已保留"。
- **移动端**：抽屉全宽 82vh + `env(safe-area-inset-bottom)`；入口 44×44。

### 验证

- `tests/messages_phase2.py` → **19/19**（路由 200、5 个安全头、无桌宠/无主题/无导航、robots、接口 403、CORS 收紧）
- `tests/messages_phase1.py` → **41/41**（回归）
- 浏览器手工验收（本地 3111）：入口显示 → 打开抽屉 → 填表发送 → 成功页复制链接 →
  新标签打开 `/message/<id>#token` → 显示消息且 hash 被清 → 继续发言 → 管理员回复后访客刷新可见 →
  Esc 关闭抽屉。截图见 `docs/messages/screenshots/`。

### 已知限制

1. 抽屉里的链接只存在内存：**刷新页面即丢**（设计如此，token 禁止落 storage）；成功页已提示立即复制。
2. 未做"访客主动找回会话"（规范明确 v1 不做）。
3 . 移动端仅按 CSS 断点实现，尚未真机验证（Phase 5 验收项）。
4. 会话状态文案在访客侧只读展示；不支持访客自行关闭/归档（Phase 3 由管理员操作）。

### 回滚

```bash
git checkout -- pages/_app.js pages/api/robots.js next.config.js
rm -f pages/message/[id].js components/messages/*.js tests/messages_phase2.py
rmdir pages/message components/messages 2>/dev/null || true
```

回滚后：`/message/<id>` 回到 404（被 `[prefix]` 吞），首页不再有悬浮入口；接口与数据层不受影响。

---

## Phase 3 —— 管理员收件箱（2026-11-15）

### 目标

在现有后台内提供完整的私信处理界面：列表 / 筛选 / 搜索 / 详情 / 回复 / 状态流转 / 删除（二次确认）。

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `pages/admin/messages.js` | 页面壳（GSSP 守卫 + AdminModulePage） |
| `components/admin/messages/AdminInbox.js` | 收件箱主体：左列表 + 右详情、筛选、搜索、分页、回复、状态、删除 |
| `tests/messages_admin.py` | 29 项管理端 API 断言 |

### 修改的现有文件

| 文件 | 改动 |
| --- | --- |
| `lib/admin/constants.js` | `ADMIN_NAV` 在 content 组新增「私信管理」 |
| `components/admin/AdminShell.js` | 侧边栏未读徽标（20s 轮询 `/api/admin/messages/stats`，隐藏时跳过） |
| `pages/api/admin/messages/conversations/[id]/index.js` | 追加 `DELETE`（CSRF + `confirm` 二次确认 + soft/purge） |
| `lib/messages/store.js` | 新增 `logAccess` / `softDeleteConversation` / `purgeConversation`；`getConversationDetail` 过滤软删；`markRead` 无条件清零未读 |

### 交互要点

- **两级布局**：桌面左列表右详情；移动端列表 ↔ 详情（详情页带「返回」）。
- **筛选**：全部 / 未读 / 已读 / 处理中 / 已解决 / 已归档 / 垃圾，带各状态计数。
- **搜索**：按昵称（`ILIKE`），空结果有明确文案。
- **打开即已读**：只要 `unread_count > 0` 就 PATCH `{ markRead: true }`（不论会话处于 processing/resolved）。
- **状态**：处理中 / 已解决 / 已归档 / 垃圾 / 标未读；访客新消息会把会话拉回 `unread`。
- **删除**：第一次点变「再点一次确认删除」，第二次才发请求；服务端仍要求 `confirm=<id>`；
  额外提供「彻底删除」（purge），供垃圾消息使用。

### 修复的两个真问题

1. **未读数永久挂住**：原 `markRead` 只在 `status='unread'` 时清零 `unread_count`，
   导致 processing/resolved 会话的徽标永远不清 → 改为无条件清零，状态再单独按需转 read。
2. **软删后详情仍可读**：`getConversationDetail` 未过滤 `deleted_at` → 已补 `.is('deleted_at', null)`。

### 验证

`python tests/messages_admin.py` → **29/29**（列表/搜索/筛选/详情/已读/回复/四种状态/删除需 CSRF 与 confirm/软删后 404/purge/列表不再包含）。

---

## Phase 4 —— 安全与异常加固（2026-11-15）

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `tests/messages_security.py` | 24 项安全断言（越权/伪造/过期/重放/XSS/限流/枚举/审计） |

### 增强

| 位置 | 改动 |
| --- | --- |
| `pages/api/messages/access/exchange.js` | 兑换成功/失败都写 `messages.access_logs`（不含 token、不含明文 IP） |
| `lib/messages/store.js` | 新增 `logAccess`（失败只在服务端 warn，不影响主流程） |

### 验证矩阵（24/24）

| 类别 | 用例 | 结果 |
| --- | --- | --- |
| 未登录 | 访客接口 403 ×2、管理接口 401 ×2 | ✅ |
| IDOR | A 的 Cookie 读/写 B 的会话 | ✅ 403 |
| 伪造 | 随机签名 / Cookie 内 convId 与实际不符 | ✅ 403 |
| 过期 | 用真实密钥签一个过去时间 → 403；合法未来时间 → 200（证明只认签名+过期） | ✅ |
| 重放 | 同 `client_request_id` 连发 3 次 → 只落 1 条 | ✅ |
| XSS | `<img onerror>` + `<script>` 原样存为纯文本；管理页 SSR 不含正文；管理 API 原样返回（前端转义） | ✅ |
| 限流 | 同 IP 第 4 次创建 → 429；换 IP 放行（证明按 IP 哈希） | ✅ |
| 爆破 | 连续错误 token → 429 封禁 | ✅ |
| 枚举 | 不存在的会话 id → 403（不泄露存在性） | ✅ |
| 边界 | 5001 字符 → 413；控制字符被剔除 | ✅ |
| 审计 | `access_logs` 记录兑换尝试 | ✅ |

### 未覆盖（如实标注）

1. **Redis / Supabase 故障注入**：本地 dev 用内存 KV，且 Supabase 不可用时不便模拟；
   代码路径是 `throw → 503 store_unavailable`，已按 fail-closed 实现，但未做故障演练。
2. **邮件、附件、验证码**：规范列为二期，未实现。
3. **token 轮换脚本**：轮换 `MESSAGE_TOKEN_SECRET` 会让所有 `token_hash` 失效，
   需要"批量重签"脚本，留到后续。

### 回滚

```bash
git checkout -- lib/admin/constants.js components/admin/AdminShell.js   pages/api/admin/messages/conversations/[id]/index.js lib/messages/store.js
rm -rf pages/admin/messages.js components/admin/messages tests/messages_admin.py tests/messages_security.py
```

---

## Phase 5 —— 备份、构建验证与收尾（2026-11-15）

| 项 | 结果 |
| --- | --- |
| 生产构建 | `BUILD_MODE=true next build` → 见下方说明（Windows 文件锁导致的 EBUSY 属环境问题，重试通过） |
| 备份脚本 | `node scripts/messages-db.mjs backup` 实测：导出 1 会话 / 4 消息，字段完整（含 token_hash、邮箱、正文） |
| 清理脚本 | 新增 `cleanup`（默认 dry-run）：spam >30 天、软删 >90 天；实测 dry-run 输出正确 |
| 回归 | Phase 1–4 四个套件 **113 项全过** |
| 构建产物 | `/message/[id]`、`/admin/messages`、8 条 `/api/messages*` 路由均在 pages-manifest |

### 新增/修改

| 文件 | 改动 |
| --- | --- |
| `scripts/messages-db.mjs` | 新增 `cleanup`（--apply 才删除）与 `backup`（等价 export，默认 target=prod） |
| `docs/messages/DEPLOYMENT_GUIDE.md` | 新增 §8 备份与清理、§9 值班检查 |

### 未执行（需管理员在场/授权）

| 项 | 原因 |
| --- | --- |
| 建立开发分支 | 你要求先不推送；分支策略由你定 |
| 预览部署 | 需 Vercel 操作，本阶段只做本地构建验证 |
| 生产环境变量配置 | 需要你在 Vercel 填 3 个变量（见 DEPLOYMENT_GUIDE §1） |
| 移动端真机测试 | 本地只做了 CSS 断点与桌面浏览器验证 |

---

## Phase 6 —— 上线修订（2026-11-15 晚，线上回归后）

> 触发：上线后你实测页面，发现入口位置、后台留白、图表尺寸、robots 与域名四类问题。
> 本节按提交顺序记录，全部已部署验证。

### 6.1 修复清单

| 提交 | 问题 | 修法 |
| --- | --- | --- |
| `42b7269` | 线上 `/robots.txt` 是**上游模板**（`Host: preview.tangly1024.com`），我们的规则被盖掉 | 根因是构建期 `generateRobotsTxt()` 会写 `public/robots.txt`，**静态文件优先于 rewrites**。抽出 `lib/seo/robots.js` 作为唯一规则来源，构建期与 `/api/robots` 共用 |
| `42b7269` | 私信入口的悬浮按钮挡视线 | 新增 `MessageTrigger` 放到页头（设置齿轮左侧），悬浮按钮改为**仅移动端**显示（`md:hidden`） |
| `79ec70f` | 后台内容区写死 `max-w-6xl`（1152px），2500px 屏两侧各空 ~650px | `AdminShell` main 改全宽 + `px-4 / md:px-8`；会话气泡与回复框补 `max-w-3xl` 居中 |
| `9e2709d` | 页头私信图标与齿轮视觉不齐（18px SVG vs 36px 盒里的 14px FA） | 改用 FontAwesome + `flex h-9 w-9` 盒模型，与设置按钮完全一致 |
| `fb92421` | 图标语义（三个点的气泡）不直观 | 换成纸飞机 `fa-paper-plane` |
| `8117c31` | 后台全宽后图表被**等比放大 3 倍**（SVG 固定 viewBox + `w-full`） | `AdminTrendChart` / `AdminBarChart` 增加 `maxWidth`（默认 880）容器并居中 |
| `8b50d26` | 图表限宽后宽屏仍显空 | 数据总览改两列：趋势图 2/3 + 访问来源 1/3，热门页面与文章表现并排，搜索与跳出整行 |

### 6.2 生产验证（`https://blog.20240606.xyz`）

| 检查 | 结果 |
| --- | --- |
| 首页 / 文章页 canonical | `https://blog.20240606.xyz…` ✅ |
| sitemap `<loc>` / RSS `<link>` | 同域 ✅ |
| robots | `Host` / `Sitemap` 正确，含 `Disallow: /message` ✅ |
| `/message/<id>` | 200，五个安全头齐全 ✅ |
| 未登录接口 | 管理端 401 / 访客端 403 ✅ |
| 创建 → 兑换 → 读 → 发 | 201 / 200 / 200 / 201，Cookie `HttpOnly; Secure; Path=/api/messages/conversations/<id>` ✅ |
| 测试数据 | 已按访客名从生产库清理 ✅ |

### 6.3 配置坑（务必记住）

1. **站点域名有两个来源，优先级不同**：
   - `NEXT_PUBLIC_LINK`（Vercel 环境变量）→ 只影响构建期脚本（robots 生成）。
   - **Notion「配置中心」的 `LINK` → 决定页面 canonical / og:url / sitemap / RSS**，优先级更高。
   两处都要填，且都必须是 `https://blog.20240606.xyz`。
2. 手填域名出过事故：一度误填 `blog.2024`**`20606`**`.xyz`（多一个 `20`，DNS 不存在），
   导致 canonical/sitemap 全部指向死域名。**改完必须用 `curl` 核对字符串**。
3. `NEXT_PUBLIC_LINK` 在 Vercel 必须是 **Config** 类型（前缀会被打进前端 bundle，Vercel 拒绝存成 Secret）；
   真正的密钥（`SUPABASE_SECRET_KEY` / `MESSAGE_TOKEN_SECRET` / `SESSION_SECRET`）必须 Secret 且**绝不能**带 `NEXT_PUBLIC_`。
4. 静态文件优先于 rewrites：任何想在 `/robots.txt` 这类路径上做动态输出的改动，
   都要先确认构建期没有生成同名文件。

### 6.4 仍未做（不影响当前使用）

1. `MESSAGE_TOKEN_SECRET` 轮换脚本（批量重签 `token_hash`）。
2. 移动端真机验证（目前只做了 CSS 断点与桌面浏览器）。
3. Redis / Supabase 故障演练（代码路径是 fail-closed → 503，但未实测注入）。

---

