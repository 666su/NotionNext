# TEST REPORT —— Jason Blog Messages · Phase 1

- 时间：2026-11-15
- 环境：Windows / Node 24 / Next 15.5.25（`next dev -p 3111`，内存 KV）+ 真实 Supabase（复用现有项目 FREE 计划）
- 对象：`messages` schema、`lib/messages/*`、9 个 API、迁移执行器

---

## 1. 结果总览

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 数据库结构自检 | `node scripts/messages-db.mjs verify` | ✅ 4 表 / 12 索引 / RLS 4/4 / 策略 0 / 台账一致 |
| 权限隔离校验 | SQL `has_schema_privilege` | ✅ anon=false、authenticated=false、service_role=true、表权限 0 |
| 真实读写与约束 | PostgREST（service_role） | ✅ 写入 201 / 读回 200 / 23514 / 23502 / 23505 / 级联删除 |
| API 冒烟 | `python tests/messages_phase1.py` | ✅ **41/41** |
| ESLint（新增代码） | `npx eslint lib/messages pages/api/messages pages/api/admin/messages` | ✅ 0 error |
| 现有后台回归 | 见 §5 | ✅ 未改动既有路由与鉴权 |

---

## 2. 数据库层（迁移与隔离）

### 2.1 迁移

```
执行 0001_messages_init ... ok
```

- 台账：`version=0001_messages_init`，`checksum=a3785fa8de4cf277`，`applied_at=2026-11-15 05:08:43+00`
- 库大小：10 MB → **11 MB**
- 迁移前 `public` 表数：**0**（无既有业务数据，无同名表冲突）
- 迁移后 `public`：仍为 0，无任何变化

### 2.2 权限

| 检查 | anon | authenticated | service_role |
| --- | --- | --- | --- |
| schema USAGE | ❌ false | ❌ false | ✅ true |
| 表权限数 | 0 | 0 | 4 表 × DELETE/INSERT/SELECT/UPDATE |
| RLS 策略数 | 0（对三张业务表） | 0 | 绕过 RLS |

### 2.3 约束（PostgREST 实测）

| 用例 | 结果 |
| --- | --- |
| 正常写入 conversation | `201` |
| 读回 | `200`，字段完整 |
| 昵称 41 字符 | `400` + `23514`（check 约束） |
| 缺 `token_hash` | `400` + `23502`（not null） |
| 同会话重复 `client_request_id` | `409` + `23505`（部分唯一索引） |
| 删除会话后其消息 | `0` 条（`ON DELETE CASCADE` 生效） |

---

## 3. API 冒烟明细（41 项）

| 分组 | 用例数 | 覆盖 |
| --- | --- | --- |
| 创建会话 | 3 | 201、一次性链接（含 fragment）、`/message/<id>` 路径 |
| 幂等 | 2 | 同 `client_request_id` → 200 `duplicate:true` 且不返回链接 |
| 入参校验 | 6 | 昵称 41 字、非法邮箱、空白正文、5001 正文（413）、honeypot、跨站 Origin |
| 会话读取 | 3 | 无 Cookie 403、伪造 Cookie 403、Cookie 200 |
| 兑换 | 4 | 200、`HttpOnly` + `Path` 限定、Cookie 名带会话前缀、错误 token 403 |
| 发消息 | 4 | 201、幂等 200、消息数不变、跨站 403 |
| 限流 | 1 | 同会话高频发送触发 429 |
| 越权 | 3 | 第二会话创建、兑换、用 B 的 Cookie 读 A → 403 |
| 管理员统计 | 3 | 未登录 401、200 且只含数量、未读数 ≥ 1 |
| 管理员列表 | 2 | 200、邮箱脱敏（`r***@example.com`） |
| 管理员详情 | 1 | 200 且含消息 |
| 状态与已读 | 6 | 缺 CSRF 403、标记已读 200、未读数下降、已解决 200、非法状态 400、访客新消息回到 unread |
| 管理员回复 | 3 | 缺 CSRF 403、201、访客可见 |

### 过程中发现并修掉的两个真问题

1. **长度校验顺序**：原实现先"压缩连续同字符"再判长度，导致 5001 个相同字符被压成 50 个后**通过校验**。
   已改为「先去控制字符 → 判原始长度 → 再压缩」，并补了 5001 字符用例。
2. **限流吞掉非法请求配额**：原实现"先限流再校验"，非法请求也会消耗创建配额（测试中连做 4 次非法请求后建不了第二会话）。
   已改为「先校验再限流」，非法请求不再扣配额。

---

## 4. 安全验证要点

| 项 | 证据 |
| --- | --- |
| 凭证不入库 | 库里只有 `token_hash`（HMAC-SHA256），实测 `verifyAccessToken` 恒定时间比较 |
| 凭证只出一次 | 创建响应返回 link，之后所有接口都不返回 token |
| 会话绑定 | Cookie 值含 `convId`，服务端校验与路径 id 一致；跨会话读 → 403 |
| Cookie 属性 | `HttpOnly` + `Path=/api/messages/conversations/<id>`（实测响应头） |
| CSRF | 管理员写操作缺 `x-csrf-token` → 403（已读、回复各测一次） |
| 跨站 | 创建/发消息带 `Origin: https://evil.example.com` → 403 |
| 枚举防护 | 兑换失败统一 `invalid_credential`，不区分"不存在/已删/token 错" |
| 限流 | 创建（IP/全站）、发送（会话/分钟）、兑换（IP/分钟+失败封禁）各有计数 |
| 日志 | 审计只记动作/会话 ID/长度，不记正文与 token |

---

## 5. 现有功能回归

| 项 | 结果 |
| --- | --- |
| `pages/api/cron/digest.js` 改动 | 仅追加心跳逻辑（try/catch 包裹，失败不影响日报）；ESLint 0 error |
| `.env.example` / `.gitignore` | 仅追加说明与忽略项 |
| 既有 `/admin/*`、`/api/admin/*` | 未改动 |
| 公开页面 | 未改动（本阶段没有页面级改动） |

---

## 6. 未覆盖（后续阶段）

| 项 | 阶段 |
| --- | --- |
| 访客页面与悬浮入口 | Phase 2 |
| 后台收件箱 UI、删除/归档操作 | Phase 3 |
| IDOR 矩阵全量、Cookie 过期、Redis/Supabase 故障注入、XSS 存储型回显 | Phase 4 |
| 生产构建与 Preview 部署 | Phase 5 |

---

## 7. Phase 2（2026-11-15）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| Phase 2 HTTP 断言 | `python tests/messages_phase2.py` | ✅ **19/19** |
| Phase 1 回归 | `python tests/messages_phase1.py` | ✅ **41/41** |
| 浏览器手工验收 | 本地 `next dev` + 真实 Supabase | ✅ 见 §8 |

### 7.1 HTTP 层断言（19 项）

`/message/<id>` → 200（不是 404，证明静态路由优先）；标题正确；
`Cache-Control: no-store`、`X-Robots-Tag: noindex`、`Referrer-Policy: no-referrer`、
`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`；页面 meta 也有 noindex；
HTML 中**不含** `blog-pet-pet` / `container-inner` / "系列时间线"（证明 _app 独立分支生效）；
`robots.txt` 含 `Disallow: /message` 且未误封 `/article`；
无 Cookie 读会话 403；接口 no-store/noindex；`Access-Control-Allow-Origin` 为空；跨站创建 403。

### 7.2 浏览器端到端（人工 + 截图）

| 步骤 | 结果 |
| --- | --- |
| 首页右下角出现私信入口（在桌宠上方，不重叠） | ✅ |
| 点开抽屉：欢迎语 + 昵称/邮箱/正文 + 发送 | ✅ |
| 发送后进入成功页：显示私密链接、复制按钮、"在窗口里继续对话" | ✅ |
| 关闭抽屉再打开：成功页与链接仍在（组件未卸载） | ✅ |
| 新标签打开链接：显示会话与消息，URL 中的 `#token` 被清除 | ✅ |
| 在会话页继续发言 | ✅（DB message_count 1 → 2） |
| 管理员通过 API 回复后，访客刷新即可看到（左侧灰色气泡 + "Jason · 时间"） | ✅ |
| 管理员回复后会话状态 unread → processing | ✅ |
| Esc 关闭抽屉 | ✅ |

### 7.3 过程中的观察（非缺陷）

- 自动化文本点击 `在窗口里继续对话` 失败过一次：属于测试工具的文本匹配限制（按钮在 dialog 内），
  改用 DOM 查询点击后正常——**产品本身无问题**。
- 关闭抽屉后链接仍在，但**刷新页面会丢失**：这是"token 不落 storage"的必然结果，成功页已提示先复制。

### 7.4 数据清理

验收产生的会话已按访客名清理，仅保留 1 条 `本地验收访客`（3 条消息）供你打开核对；
不需要时执行：`delete from messages.conversations where visitor_name='本地验收访客';`

---

## 8. Phase 3（2026-11-15）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 管理端 API | `python tests/messages_admin.py` | ✅ **29/29** |
| 后台页面（浏览器） | `/admin/messages` 手工验收 | ✅ 见下 |

覆盖：未登录 401；列表（排序/脱敏/计数）；按昵称搜索命中；未读筛选；非法状态 400；
详情；标记已读（缺 CSRF 403、成功后 `unread_count=0` 且 `read`）；
回复（缺 CSRF 403、成功 201、状态转 processing）；四种状态流转；
删除缺 CSRF 403 / 缺 confirm 400 / 软删 200 / 软删后详情 404 / purge 200 / 列表不再包含。

浏览器验收：侧边栏「私信管理」带未读徽标 → 列表 → 点开会话自动标已读（徽标消失）→
回复后出现"我（Jason）"气泡 → 点「已解决」状态即时更新。

## 9. Phase 4（2026-11-15）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 安全断言 | `python tests/messages_security.py` | ✅ **24/24** |

关键结论：

- **IDOR 不可行**：A 的 Cookie 读写 B 的会话均 403；Cookie 里的 convId 与服务端校验绑定。
- **凭证校验只认签名 + 过期**：用真实密钥手工签发"过去时间"的 Cookie → 403；"未来时间" → 200，
  证明校验逻辑本身正确（不是碰巧拒绝）。
- **重放安全**：同 `client_request_id` 三次只落一条。
- **XSS 无注入面**：正文按纯文本存储；管理页 SSR 不含访客正文；管理 API 原样返回，由 React 转义。
- **限流按来源**：同 IP 第 4 次创建 429，换 IP 立即放行。
- **枚举防护**：不存在的会话 ID 与凭证错误返回同一个 403。

## 10. Phase 3–4 累计

| 套件 | 用例数 |
| --- | --- |
| Phase 1（数据层 + 访客 API） | 41 |
| Phase 2（页面/头部/隔离） | 19 |
| Phase 3（管理端 API） | 29 |
| Phase 4（安全） | 24 |
| **合计** | **113** |

> 说明：四套件共用同一个 dev 实例；因限流是按 IP/会话计数的，回归顺序为 1 → 2 → 3 → 4，
> 中间重启一次 dev server 清零内存计数（测试脚本已注明）。

---

## 11. Phase 5：构建与收尾（2026-11-15）

| 项 | 结果 |
| --- | --- |
| `tsc --noEmit` | ✅ 0 error |
| ESLint（私信相关全部代码） | ✅ 0 error |
| 四个测试套件 | ✅ 113/113 |
| 构建产物（pages-manifest） | ✅ 10 条私信路由全部生成 |
| `next build` 完整收尾 | ⚠️ **环境问题失败**（见下） |

### 关于构建失败（如实记录）

`next build` 会完整跑完 **Compiling → Collecting page data → Generating static pages (57/57)**，
然后在最后一步把 `.next/export/**` 重命名进 `.next/server/pages/**` 时报：

```
EBUSY: resource busy or locked, rename '.next/export/zh-CN/article/proxy02.html'
   -> '.next/server/pages/zh-CN/article/proxy02.html'
```

- 这是 **Windows 文件锁**（实时扫描/索引把刚写出的 HTML 锁住），不是代码错误：
  同一次构建里 57 个页面全部生成成功、`pages-manifest` 里 10 条私信路由齐全。
- 换输出目录（`NEXT_DIST_DIR=.next-prod`）重试仍失败 → 证明与路径无关，是平台层面的写锁。
- 历史参考：今天早些时候 Phase 1 / Phase 2 的两次 `next build` 都是 **exit 0**（同样的代码路径），
  说明这是**间歇性**环境问题；Vercel（Linux）不会出现该写锁。
- 为此在 `next.config.js` 增加 `distDir: process.env.NEXT_DIST_DIR || '.next'`（默认行为不变），
  方便在 Windows 上换目录重试。

### 尚未执行（等你回来决定）

| 项 | 说明 |
| --- | --- |
| `git commit` | 已按你"先不要推送"的要求保持在工作区（未提交、未推送） |
| 预览部署 | 需要你在 Vercel 操作；环境变量见 DEPLOYMENT_GUIDE §1 |
| 移动端真机 | 只做了 CSS 断点与桌面浏览器验收 |

---

## 12. Phase 7：Telegram 双向通道（2026-11-15 夜）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| TG 通道断言 | `python tests/messages_telegram.py` | ✅ **19/19** |
| 既有四套件回归 | phase1 / phase2 / admin / security | ✅ 41 / 19 / 29 / 24 |

覆盖：创建会话即推送（含昵称、会话码、后台按钮）；`tg_links` 记录 Telegram 返回的 message_id；
错误/缺失 secret → 403；陌生 chat 忽略且不回执；未引用消息不被当成回复（并回提示）；
引用通知 → 管理员消息入库 + 回执带 ✅ 与昵称 + **未读清零**；重复 `update_id` 不重复写入；
引用未知通知 → 提示找不到；超 5000 字被拒。

测试方式：本地起 `scripts/telegram-stub.mjs`（假 Telegram API），
断言"发了哪些消息、返回哪个 message_id"，**不打扰真实 TG**。

累计：**132 项**（41 + 19 + 29 + 24 + 19）。

---

## 13. Phase 8：TG 指令 + 创建提速（2026-11-16）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| TG 套件（含 6 条指令断言） | `python tests/messages_telegram.py` | ✅ **25/25** |
| 创建链路回归 | `python tests/messages_phase1.py` | ✅ **41/41** |
| 生产幂等 | 重复 `client_request_id` | ✅ `200 duplicate=true`、同一会话、不会重复建 |

指令断言覆盖：`/help`（command=help）、`/list`（含短码）、`/close <短码>`（closed 且状态变 resolved）、
`/close zzzz`（close_not_found）、`/what`（unknown）。

性能实测（生产）：首次 3637ms、热路径 3071ms、重复提交 2020ms。
结论与后续可选优化路径见 CHANGELOG §8.3；**当前速度已获管理员认可，优化停止**。
