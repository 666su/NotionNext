# 测试报告 —— Phase 1 / 1.5 / 2 / 3 / 4 / 5 / 6

- 执行时间：2026-11-09
- 执行环境：Windows，Node v24.15.0，Next.js 15.5.25（本地 dev），项目 NotionNext 4.10.8 fork
- 测试对象：本次新增的 `/admin`、`/api/admin/*`、`lib/admin/*`，以及被修改的 `_app.js` / `middleware.ts` / `next.config.js` / `notify-status.js`

---

## 1. 结果总览

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript 类型检查 | `tsc --noEmit` | ✅ 通过（0 error） |
| ESLint（后台相关文件） | `eslint pages/admin lib/admin components/admin pages/api/admin middleware.ts` | ✅ 0 error（1 条既有 warning：`notify-status.js` 用 `<a>` 而非 `<Link>`，为原文件遗留） |
| 冒烟测试 A（认证/鉴权/CSRF/限流） | `python tests/admin_phase1_smoke.py` | ✅ **24/24 通过** |
| 冒烟测试 B（改密/会话失效/审计/公开页回归） | `python tests/admin_phase1_extra.py` | ✅ **13/13 通过** |
| 安全修复验证（F-01/03/04/05/06） | `python tests/security_p0.py` | ✅ **10/10 通过** |
| 统计采集与聚合（Phase 2） | `python tests/analytics_phase2.py` | ✅ **21/21 通过** |
| 既有单元测试回归 | `jest --ci --passWithNoTests` | ✅ 48 个 suite / **367 个用例全部通过** |
| 生产构建 | `cross-env BUILD_MODE=true next build` | ✅ 通过（见 §5） |
| 公开页面回归 | 首页 / 文章 / 分类 / 标签 / 搜索 | 首页已实测 200 且主题正常；其余见 §4 |

---

## 2. 冒烟测试 A 明细（24 项）

| # | 用例 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | 未登录 `GET /admin` | 重定向登录 | ✅ 307 → `/admin/login?next=%2Fadmin` |
| 2 | `GET /admin/login` | 200 | ✅ 200，含“管理员登录” |
| 3 | 登录页响应头 | `no-store` | ✅ `no-store, must-revalidate` |
| 4 | 未登录 `GET /api/admin/session` | 401 JSON | ✅ `401 {"error":"unauthorized"}` |
| 5 | 未登录 API 不泄露数据 | 无 `csrfToken` 等字段 | ✅ |
| 6 | 错误密码 | 401 | ✅ `401 invalid_credentials` |
| 7 | 错误密码不泄露账号存在性 | 统一文案 | ✅ |
| 8 | 正确密码 | 200 + 会话 | ✅ 200，返回 `csrfToken` |
| 9 | 下发会话 Cookie | `jba_sid` 存在 | ✅ 长度 87（32B sid + HMAC） |
| 10 | 下发 CSRF Cookie | `jba_csrf` 存在 | ✅ 长度 32 |
| 11 | 会话 Cookie 属性 | 含 `HttpOnly` | ✅ 另含 `Path=/; Max-Age=43200` |
| 12 | 已登录 `GET /api/admin/session` | 200 | ✅ |
| 13 | 返回 `csrfToken` | 有 | ✅ |
| 14 | 已登录 `GET /admin/dashboard` | 200 | ✅ |
| 15 | Dashboard 渲染 | 含“数据总览” | ✅ |
| 16 | 后台不套主题外壳 | 无主题顶栏标记 | ✅ |
| 17 | `GET /admin/not-a-real-page` | 404（不落入 `[prefix]`） | ✅ 404 |
| 18 | 登出缺 CSRF | 403 | ✅ `403 csrf_failed` |
| 19 | 伪造会话 Cookie | 拒绝 | ✅ 307（签名校验失败） |
| 20 | 带 CSRF 登出 | 200 | ✅ `{"ok":true}` |
| 21 | 登出后访问后台 | 重定向 | ✅ 307 |
| 22–23 | 连续 7 次错误密码 | 触发 429 | ✅ `[401,401,401,401,401,429,429]` |
| 24 | 未登录 `GET /admin/notify-status` | 不再公开 200 | ✅ 307 |

---

## 3. 冒烟测试 B 明细（13 项）

| # | 用例 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | 旧密码登录 | 200 | ✅ |
| 2 | 审计日志可读 | 200 且含 `login.success` | ✅ |
| 3 | 审计不含明文 IP | 无 `127.0.0.1` | ✅ 只有 `ipHash` |
| 4 | 改密缺 CSRF | 403 | ✅ |
| 5 | 改密当前密码错误 | 400 | ✅ `current_password_invalid` |
| 6 | 弱密码 | 400 | ✅ `weak_password` +“至少 12 位” |
| 7 | 改密成功 | 200 | ✅ `{"ok":true,"relogin":true}` |
| 8 | 改密后旧会话 | 失效 | ✅ 401 |
| 9 | 旧密码 | 登录失败 | ✅ 401 |
| 10 | 新密码 | 登录成功 | ✅ 200 |
| 11 | 首页仍可访问 | 200 | ✅ 200（55KB，主题正常渲染） |
| 12 | 首页仍渲染博客主题 | 含站点标识 | ✅ |
| 13 | 登录页 | 200 | ✅ |

---

## 3.5 安全修复验证（P0，10 项）

| # | 用例 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | `POST /api/cache` 未配置 token | 503 | ✅ `503 CACHE_REVALIDATION_TOKEN 未配置` |
| 2 | `GET /api/push/status` 未带密钥 | 200 且仅 `{ok:true}` | ✅ |
| 3 | 同上不暴露内部字段 | 无 `redisConfigured/redisError/subscriptions/vapidKeys` | ✅ |
| 4 | `/api/push/subscriptions` 缺 id | 400 | ✅ |
| 5 | 非法 subscriberId（路径穿越样式） | 400 | ✅ `subscriberId 格式不正确` |
| 6 | 合法 UUID | 200 空列表 | ✅ |
| 7 | `/api/push/test` 跨站 Origin | 403 | ✅ |
| 8 | `/api/push/test` 非白名单 endpoint（169.254.169.254） | 400（SSRF 堵死） | ✅ |
| 9 | `/api/push/test` 非法渠道 | 400 | ✅ |
| 10 | `/api/rank/seed` 无密钥 | 403 | ✅ |

---

## 3.6 Phase 2 统计验证（21 项）

| # | 用例 | 预期 | 实际 |
| --- | --- | --- | --- |
| 1 | 管理员登录 | 200 | ✅ |
| 2 | 批量 3 条 page_view | 204 | ✅ |
| 3 | 汇总接口可读 | 200 | ✅ |
| 4 | PV = 3 | 3 | ✅ |
| 5 | UV = 2（同匿名 ID 去重） | 2 | ✅ |
| 6 | Session = 1（同会话只计一次） | 1 | ✅ |
| 7 | 设备维度归类 | 有值 | ✅ `{desktop:3}` |
| 8 | 来源维度（google → search） | search ≥1 | ✅ `{search:3}` |
| 9 | 路径排行含文章路径 | 命中 | ✅ `/article/cloudflare01:2` |
| 10 | 事件计数 page_view=3 | 3 | ✅ |
| 11 | 重复 event_id → 204 | 204 | ✅ |
| 12 | 重复事件未增加 PV | 仍为 3 | ✅ |
| 13 | 非法事件名 → 204 | 204 | ✅ |
| 14 | 非法事件未写入 | PV 不变 | ✅ |
| 15 | 深度 + 搜索事件 → 204 | 204 | ✅ |
| 16 | scroll_depth 已计数 | 1 | ✅ |
| 17 | search 已计数（含邮箱脱敏词） | 2 | ✅ |
| 18 | 跨站 Origin → 204 | 204 | ✅ |
| 19 | 跨站数据未计入 | PV 仍 3 | ✅ |
| 20 | 未登录汇总 → 401 | 401 | ✅ |
| 21 | 昨日窗口可读且 PV=0 | 0 | ✅ |

---

## 4. 回归测试（公开站点）

| 页面 | 方法 | 结果 |
| --- | --- | --- |
| 首页 `/` | 本地 dev 实际请求 | ✅ 200，HTML 含博客标题/主题结构 |
| 主题外壳未受影响 | 检查 `_app` 默认分支 | ✅ 仅新增分支，默认渲染路径逐行未变 |
| 外部插件/桌宠 | 代码未改，仅后台分支跳过 | ✅ 公开页仍挂载 |
| `notify-status` | 行为变化：公开 → 需登录 | ⚠️ **预期变更**（安全修复） |
| 文章/分类/标签/搜索/评论 | 未改相关代码 | 代码级无影响；建议上线后人工点一遍（见 §6） |

> 说明：`next dev` 下访问文章页会触发 Notion 实时拉取，耗时较长；本次以 `tsc`/lint/构建与首页实测作为主要门禁，文章页回归列入上线前人工清单。

---

## 5. 生产构建

```bash
cross-env BUILD_MODE=true next build
```

**结果：✅ 通过（exit 0）**，生成 57 个静态页面，中间件编译成功（81.7 kB）。

关键路由表（节选，“ƒ = 按需 SSR”，符合要求）：

```text
├ ƒ /admin                    1.19 kB
├ ƒ /admin/dashboard          1.61 kB
├ ƒ /admin/login              2.06 kB
├ ƒ /admin/settings           5.09 kB
├ ƒ /admin/health             4.05 kB
├ ƒ /admin/[...index]         1.32 kB
├ ƒ /admin/notify-status      1.47 kB
├ ƒ /api/admin/login|logout|session|password|init|audit
├ ƒ /api/admin/stats/summary
├ ƒ /api/track
ƒ Middleware                 81.7 kB
```

- 所有 `/admin/*` 与 `/api/admin/*` 均为 **`ƒ`（Dynamic, server-rendered）**，**没有**出现 `○ (Static)` 或 `● (SSG)` → 确认没有误用 `getStaticProps`，不会被 CDN 预热/缓存。
- 公开页面仍为原有形态（`○ /404`、`○ /500` 等），路由数量与部署前一致。
- 构建期存在一条**既有**警告 `Attempted import error: 'useContext' is not exported from 'react'`，已在 `next.config.js` 的 `ignoreWarnings` 中列为已知项，与本阶段改动无关。

> 首次构建曾在 Windows 上因 `.next` 文件被占用（`EBUSY`，与并发 dev server / 杀毒扫描有关）失败一次；清理后重试通过。Vercel（Linux）环境不存在该问题。

---

## 6. 上线前人工清单（建议在 Vercel Preview 上执行）

- [ ] 首页、任一文章页、分类页、标签页、搜索页、归档页、系列页均正常
- [ ] 评论区（Twikoo）可加载并可提交（或至少不报错）
- [ ] 桌宠正常显示
- [ ] 暗色模式切换正常
- [ ] 移动端（375px）后台侧边栏可展开/收起，登录可用
- [ ] `/admin` 未登录跳转、登录后进入 Dashboard、登出后失效
- [ ] `/admin/settings` 改密 → 被踢出 → 新密码登录成功
- [ ] 审计日志出现 `login.success` / `login.failure` / `password.change`
- [ ] `/api/admin/session` 未登录返回 401 JSON（不是 HTML）
- [ ] `/admin/*` 响应头含 `cache-control: no-store`、`x-robots-tag: noindex`
- [ ] `sitemap.xml` 中不出现 `/admin`

---

## 7. 已知未覆盖项（诚实声明）

| 项 | 原因 | 计划 |
| --- | --- | --- |
| Redis 真实实例下的端到端 | 本地无 `REDIS_URL`，使用内存后端（仅开发） | Preview/生产验证（§6） |
| 多实例并发限流 | 需真实 Redis | Phase 2 联调时验证 |
| Auth 单元测试（jest） | 本阶段以端到端冒烟为主 | Phase 2 补 jest 用例 |
| 生产构建产物检查 | 见 §5 | 本次构建输出 |
| 恶意输入模糊测试 | 未做 | Phase 2 安全测试补充 |

---

## 8. 构建结论

生产构建通过（exit 0），57 个静态页面生成成功，所有 `/admin/*`、`/api/admin/*`、`/api/track` 均为按需 SSR（`ƒ`），不存在被静态化/缓存的页面；middleware 编译成功。首次失败为 Windows 文件占用（`EBUSY`）导致的环境问题，重试通过。

已知构建噪音：`lib/admin/password.js` 里的**可选** `bcryptjs` 动态导入会产生一条 “Module not found” 警告（不影响产物与运行，未安装该依赖时自动走 scrypt）。若日后批准安装 `bcryptjs`，该警告自动消失。

---

## 9. Phase 3（2026-11-10）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 后台数据页冒烟 | `python tests/admin_phase3.py` | ✅ **34/34 通过** |
| ESLint（后台相关文件） | `npx eslint pages/admin components/admin lib/admin lib/analytics` | ✅ 0 error（1 条既有 warning：`notify-status.js` 使用 `<a>`） |
| 页面实测 | 浏览器登录后逐一打开五页 | ✅ 数据真实渲染，无控制台报错 |

Phase 3 用例要点：未登录 401/307 → 非法 range 400 → 埋点写入 204 → PV=3 / UV=2 / Session=2 对账 →
设备与来源维度归类 → 逐小时 24 桶合计相等 → 路径排行首位 → 深度 25% 档与读完 → 搜索词小写且已脱敏 →
事件计数 → 外链与分享 → 今日卡片与近 7 天 PV → 采集起始时间 → 实时活跃为整数估算 →
文章维度 PV/UV/完成率 → 昨日窗口为 0（不串数据）→ 五个页面 SSR 200 → 占位文案已移除。

环境说明：本地 `next dev`（内存 KV）+ 环境变量见 `docs/admin/DEPLOYMENT_GUIDE.md` §6；
测试账号为**本地开发专用**口令，生产环境由 `ADMIN_PASSWORD_HASH` 决定，与此无关。

---

## 10. Phase 4（2026-11-10）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 同步与聚合冒烟 | `python tests/admin_phase4.py` | ✅ **29/29 通过** |
| ESLint（后台相关文件） | `npx eslint pages/admin components/admin lib/admin lib/analytics pages/api/admin` | ✅ 0 error |

Phase 4 用例要点：三个端点未登录 401 → 登录拿 CSRF → 同步状态字段 → 缺 CSRF 403 →
同步返回 `counts.articles` → 5 分钟冷却 429 → 冷却/日志可读 → 路径映射建立且无重复前缀污染 →
分类/标签聚合与快照一致 → slug 规范化（`article/dsh09` → `dsh09`）→ URL 无 `/article/article/` →
taxonomy 非法 range 400 → 评论"未连接"语义 → 三个页面 SSR → report 暴露 `unmappedPathViews`。

端到端补充验证（手工）：`/article/dsh09` 发 3 次不带 `article_id` 的 `page_view`，
report 归到正确文章（真实标题、`pathMatched: true`、`uv: null`）；不存在路径的 1 次浏览计入 `unmappedPathViews`。
本地 Notion 同步实测结果：16 篇文章 / 2 个分类 / 9 个标签 / 16 条路径映射，耗时 64–85 ms（命中本地缓存）。

---

## 11. Phase 5（2026-11-10）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 健康与 SEO 冒烟 | `python tests/admin_phase5.py` | ✅ **29/29 通过** |
| ESLint（后台相关文件） | `npx eslint pages/admin pages/api/admin lib/admin components/admin` | ✅ 0 error |

Phase 5 用例要点：三个端点未登录 401 + 页面 307 → 同步快照 → health 字段完整 →
两个同源探针返回真实状态码 → 无密钥字段泄露 → 3 分钟缓存命中 → 链接检查 limit 生效、
只探测同源路径、汇总字段正确 → 10 分钟缓存命中 → SEO 端点 200 →
GSC `connected=false` 且给出 3 个必需环境变量 → 响应中不含 impressions/clicks/ctr/position →
audit 行数与文章总数一致 → robots/sitemap 已探测 → AI 未启用 → 两个页面 SSR。

实测数据（本地 dev，16 篇文章）：`/` 与 `/archive` 探针 200（约 0.8s）；
链接检查 10 条中 3 条请求失败（本地 `next dev` 首次编译超时，非线上行为）；
SEO 自查给出 2 篇"标题偏短"（"域名注册与规划" 7 字符、"模板说明" 4 字符）；
`/robots.txt` 404、`/sitemap.xml` 200 —— 前者是站点既有配置问题，已在健康页如实展示。

---

## 12. 阶段三~五全量回归（2026-11-10）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| TypeScript | `tsc --noEmit` | ✅ 0 error |
| ESLint（后台相关） | `npx eslint pages/admin pages/api/admin lib/admin lib/analytics components/admin` | ✅ 0 error（1 条既有 warning） |
| 单元测试 | `npx jest --ci --passWithNoTests` | ✅ **48 suite / 367 用例全部通过** |
| Phase 3 冒烟 | `python tests/admin_phase3.py` | ✅ 34/34 |
| Phase 4 冒烟 | `python tests/admin_phase4.py` | ✅ 29/29 |
| Phase 5 冒烟 | `python tests/admin_phase5.py` | ✅ 29/29 |
| 生产构建 | `cross-env BUILD_MODE=true next build` | ✅ exit 0，57 个静态页生成成功 |

构建产物核对：所有 `/admin/*` 与 `/api/admin/*` 均为 **ƒ（按需 SSR）**，没有被静态化或被 CDN 缓存；
新增端点 `stats/report`、`taxonomy`、`seo`、`health/site`、`health/links`、`sync/status`、`sync/notion` 全部出现在路由表。

构建噪音（既有，不影响产物）：`lib/admin/password.js` 的可选 `bcryptjs` 动态导入仍产生一条
"Module not found" 警告；`next.config` 的 `publicRuntimeConfig` 有废弃提示。二者均非本阶段引入。

---

## 13. Phase 6（2026-11-10）

| 项目 | 命令 | 结果 |
| --- | --- | --- |
| 日报与定时冒烟 | `python tests/admin_phase6.py`（先跑 `tests/stub_services.py`） | ✅ **42/42 通过** |
| 阶段 3–6 全量 | 四个脚本按序在同一实例上执行 | ✅ 34 + 29 + 29 + 42 = **134 项全部通过** |
| ESLint（新增文件） | `npx eslint pages/api/cron pages/api/robots.js lib/admin ...` | ✅ 0 error |

Phase 6 用例要点：robots 200 且为纯文本、禁后台/禁接口、未误伤 `/article`、带 sitemap 绝对地址与缓存头；
cron 无令牌/错令牌 401、cron 同步返回计数；埋点写入；日报预览含 AI 文本；**提示词不含 `anon-` / `sess-` / 明文 IP**；
推送缺 CSRF 403、手动推送送达并拿到 `messageId`；TG 请求的 `chat_id` / `parse_mode=HTML` / 标题 / AI 段落正确；
cron 推送成功、重复触发 429；发送日志记录 `ai`/`sent`；配置状态不含 token；
AI 总结接口 200 且附带事实、未登录 401；`/admin/digest` 307/200；仪表盘含 AI 卡。

桩服务说明：`tests/stub_services.py` 在 8991（OpenAI 兼容）与 8992（Telegram）起两个本地 HTTP 服务，
返回与真实 API 同形状的响应，并把收到的请求落盘到 `.dsh-ops/stub-*.json`——
因此**没有真实密钥也能验证协议、鉴权、隐私边界与失败路径**。真实连通性需在配置真实密钥后再验一次。

构建核对（Phase 6 后重跑）：`cross-env BUILD_MODE=true next build` → exit 0，57 个静态页生成成功；
`pages-manifest` 中确认新增 `/api/robots`、`/api/cron/sync-notion`、`/api/cron/digest`、
`/api/admin/digest`、`/api/admin/ai/summary`、`/admin/digest` 六个路由，均为按需 SSR。
