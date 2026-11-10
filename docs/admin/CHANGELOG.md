# CHANGELOG —— Jason Blog Admin

本文件记录每个阶段的变更、影响范围与已知偏差。按 PROJECT_SPEC 要求，每阶段完成后暂停等待管理员确认。

---

## Phase 6.1 — Telegram 排障能力（2026-11-10）

线上首次发送日报时报 `request_failed`，这个代号太笼统（既可能是网络不通，也可能是环境变量指错）。
本阶段把"发不出去"拆成可操作的原因，并加一个不发消息的自检入口。

| 改动 | 说明 |
| --- | --- |
| `lib/admin/telegram.js` | 新增 `getBotInfo()`（调 `getMe`，不发送消息）；`sendTelegram` 超时 10s→12s；失败细分 `timeout` / `dns_failed` / `connection_refused` / `connection_reset` / `tls_error` / `network_error`；`local_base_in_production` 直接拦下"生产环境仍指向本地桩"的误配 |
| `pages/api/admin/notify/telegram.js` | 新增：`GET ?check=1` 返回机器人用户名与**实际请求域名**（不含 token）；`POST` 发一条测试消息（需 CSRF） |
| `lib/admin/digest.js` | 配置状态增加 `baseHost` / `localBase`，让"请求打到哪"一眼可见 |
| `pages/admin/digest.js` | 新增「测试连接」按钮；本地地址误配时页面顶部直接红字提示；发送失败展示 `detail` |
| `tests/stub_services.py` | Telegram 桩支持 `GET /getMe` |

验证：`tests/admin_phase6.py` → **49/49 通过**（新增自检 200、机器人用户名、请求域名、不含 token、
测试消息缺 CSRF 403、测试消息送达）。

> 现场排查结论：用真实 bot token 在本机直连 `api.telegram.org` 的 `getMe` 与 `sendMessage` 均成功，
> 因此令牌与 chat_id 无误；生产失败只可能是「`TELEGRAM_API_BASE` 残留本地桩地址」或
> 「Vercel Functions 区域访问不到 Telegram」。本阶段让这两种情况在页面上直接可见。

---

## Phase 6 — robots 规则、自动同步、AI 浏览总结、Telegram 日报（2026-11-10）

### 目标

把后台从"能看"推进到"会自己跑"：

1. 补上 `robots.txt`（此前 404），规则写清楚哪些不抓；
2. Notion 同步改为**每日定时**，不再只靠手动点；
3. 新增 **AI 浏览总结**（后台卡片 + 独立日报页）；
4. 每日总结**自动推送到 Telegram**，失败可见、可手动补发。

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `pages/api/robots.js` | 动态生成 robots.txt（Sitemap 域名随站点配置，写不死） |
| `lib/admin/cron-auth.js` | 定时任务鉴权：只认 `Authorization: Bearer $CRON_SECRET`，常量时间比较，未配置即 503 |
| `lib/admin/ai.js` | OpenAI 兼容调用（默认 DeepSeek），提示词强制"只能用给定数字" |
| `lib/admin/telegram.js` | Telegram Bot 发送（HTML 解析、转义、3900 字符截断） |
| `lib/admin/digest.js` | 每日事实汇总 → AI 归纳 → 推送 → 日志 |
| `pages/api/cron/sync-notion.js` | 定时只读同步（5 分钟冷却） |
| `pages/api/cron/digest.js` | 定时生成并推送日报（5 分钟冷却） |
| `pages/api/admin/digest.js` | 后台预览 / 手动推送 / 日志 |
| `pages/api/admin/ai/summary.js` | 所选时间窗的 AI 浏览总结 |
| `components/admin/AdminAiSummary.js` | 仪表盘上的 AI 总结卡片（今日/7 天/30 天） |
| `pages/admin/digest.js` | 「每日总结」页：配置状态、预览、发送、日志 |
| `tests/stub_services.py` | AI / Telegram 本地桩（无需真实密钥即可端到端验证） |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `next.config.js` | `rewrites` 增加 `/robots.txt → /api/robots` |
| `vercel.json` | 新增 `crons`：`0 1 * * *` 同步、`10 1 * * *` 发日报（UTC，即北京时间 09:00 / 09:10） |
| `lib/admin/constants.js` | 导航新增「每日总结」 |
| `lib/analytics/constants.js` | 新增 `stats:v1:digest:log` |
| `pages/admin/dashboard.js` | 顶部接入 AI 浏览总结卡片 |

### robots.txt 规则（为什么这么写）

```text
User-agent: *
Allow: /
Disallow: /admin, /admin/
Disallow: /api/
Disallow: /auth, /auth/, /sign-in, /sign-up, /dashboard, /dashboard/
Disallow: /search/
Sitemap: https://<站点域名>/sitemap.xml
```

- **只封管理面与登录态页面**，正文（`/article/*`、分类、标签）保持可抓取——把所有页面 Disallow 等于自废收录；
- `/search/` 单独封，避免搜索引擎抓取参数化页产生无限组合；
- 不写 `Crawl-delay`（Google 已忽略，写了反而误导）；
- 动态生成而不用 `public/robots.txt`，因为 Sitemap 必须是绝对地址，而域名来自 Notion 配置/环境变量。

### 定时任务的安全设计

| 项 | 做法 |
| --- | --- |
| 鉴权 | `Authorization: Bearer $CRON_SECRET`（Vercel Cron 自动注入） |
| 未配置密钥 | **503 fail-closed**，绝不裸奔 |
| 冷却 | 两个 cron 各有 5 分钟冷却键，重复触发返回 429 |
| 能力 | 只读同步（不写 Notion）；日报只写自己的 Redis 日志 |
| 日志 | 同步沿用 `stats:v1:sync:log`；日报写 `stats:v1:digest:log`（最多 100 条） |

### AI 与 Telegram 的边界

- **AI 只收到聚合数字**：PV/UV/Session、深度分布、搜索词、页面路径、文章标题、来源。
  提示词与测试都验证了：不含匿名 ID、会话 ID、IP、评论正文、文章正文。
- **未配置就明说**：`AI_API_KEY` 缺失时 `ai.ok=false`，日报照样发，只是标题写"原始数据"，
  页面上写"AI 总结未生成（not_configured）"——不拿模板冒充 AI。
- **令牌不出服务端**：`TELEGRAM_BOT_TOKEN` 只在 `lib/admin/telegram.js` 中使用；
  后台接口只返回 `configured`/`missing`，页面拿不到 token。
- **发送失败不静默**：`delivery.reason` 会写进日志，后台页面显示 `× not_configured` / `× upstream_error`。

### 需要配置的环境变量

| 变量 | 必需 | 说明 |
| --- | --- | --- |
| `CRON_SECRET` | 定时任务必需 | 未配置时两个 cron 接口返回 503；Vercel 会以 Bearer 发送 |
| `AI_API_KEY` | 可选 | OpenAI 兼容 key；缺失时日报退化为"原始数据" |
| `AI_BASE_URL` | 可选 | 默认 `https://api.deepseek.com/v1` |
| `AI_MODEL` | 可选 | 默认 `deepseek-chat` |
| `TELEGRAM_BOT_TOKEN` | 推送必需 | 找 @BotFather 创建机器人后获得 |
| `TELEGRAM_CHAT_ID` | 推送必需 | 与机器人对话后取 `chat.id`（也可是群组负数 ID） |
| `TELEGRAM_API_BASE` | 仅测试 | 默认官方 API；本地桩用它指向 127.0.0.1 |

### 自动化验证

`python tests/admin_phase6.py` —— **42 项全部通过**（需要先跑 `tests/stub_services.py` 与本阶段的 dev env）：

robots 200/纯文本/禁后台/禁接口/不误伤正文/带 sitemap 绝对地址/带缓存头、
cron 无令牌与错误令牌 401、cron 同步成功并返回计数、埋点写入、
日报预览含 AI 文本与日期、**提示词不含匿名/会话标识与 IP**、
推送缺 CSRF 403、手动推送送达（桩返回 messageId 12345）、
TG `chat_id`/`parse_mode`/标题/AI 段落正确、cron 推送成功、重复触发 429、
发送日志记录 ai/sent、配置状态不含 token、AI 总结接口 200 且附带事实、未登录 401、
`/admin/digest` 未登录 307 且登录后 200、仪表盘含 AI 卡。

### 已知限制

1. **Vercel Hobby 计划**只允许每日 1 次、最多 2 个 cron；想更频繁需要 Pro 或改用外部调度器打同一个带 Bearer 的地址。
2. **AI 总结基于聚合数字**，不做归因分析（没有渠道成本、没有转化数据，任何"为什么"都只能靠人判断）。
3. **日报默认发昨日**（cron 01:10 UTC 时北京时间 09:10，昨日数据已完整）；也可在页面上选任意日期补发。
4. **Telegram 消息上限 4096 字符**，超长会截断并标注"已截断"。
5. Telegram / AI 的真实连通性只能在配置真实密钥后验证；本阶段用本地桩覆盖了协议与数据形状。

### 回滚

```bash
git checkout -- next.config.js vercel.json lib/admin/constants.js lib/analytics/constants.js pages/admin/dashboard.js
rm -rf pages/api/cron pages/api/robots.js pages/api/admin/digest.js pages/api/admin/ai pages/admin/digest.js
rm -f lib/admin/{cron-auth,ai,telegram,digest}.js components/admin/AdminAiSummary.js
```

删除后：`/robots.txt` 回到 404，定时任务不再存在，仪表盘不再显示 AI 卡；其余功能不受影响。

---

## Phase 5 — 健康检查、失效链接、SEO 自查（2026-11-10）

### 目标

把后台最后两个占位页（网站健康 / SEO 分析）接成**可自证**的检查页：
能自己验证的（HTTP 状态、robots/sitemap、标题长度、摘要缺失）真实计算；
不能自己验证的（GSC 曝光/点击/排名、AI）明确显示"未连接 / 未启用"，**一个数字都不编**。

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `lib/admin/link-check.js` | 同源失效链接检查：并发 4、单次最多 20 条、10 分钟缓存；另含 `probeFiles`（robots/sitemap） |
| `lib/admin/seo-audit.js` | 本地 SEO 自查（标题长度/摘要/分类/标签/更新时间）+ GSC 真实状态 |
| `pages/api/admin/health/site.js` | 站点健康聚合（存储/配置/部署/同步/Twikoo + 两个同源探针，3 分钟缓存） |
| `pages/api/admin/health/links.js` | 失效链接检查端点 |
| `pages/api/admin/seo.js` | SEO 自查端点（审计 + 文件探测 + GSC/AI 状态） |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `lib/admin/health.js` | 探针超时 6s → 8s（本地 `next dev` 首次编译会占满 6s） |
| `lib/admin/sync/notion-sync.js` | 快照新增 `description`（Notion `summary`）与 `hasCover`，供 SEO 自查使用 |
| `components/admin/AdminStatCards.js` | 支持 `display` 文本，状态类指标不再显示 1 / 0 |
| `pages/admin/health.js` | 占位 → 真实健康页（探针表 / 数据链路 / 部署环境 / 失效链接检查） |
| `pages/admin/seo.js` | 占位 → 真实自查页（GSC 未连接 + 本地审计 + robots/sitemap + AI 预留） |

### 安全与频率约束

| 项 | 值 | 原因 |
| --- | --- | --- |
| 探针范围 | 仅本站同源（首页 / 归档 / 快照文章 URL） | 不扫描第三方站点 |
| 单次检查上限 | 链接 20 条（后台默认 10） | 防止把源站打热 |
| 并发 | 4（文件探测 2） | 控制瞬时压力 |
| 缓存 | 健康 3 分钟 / 链接 10 分钟 / 文件 10 分钟 | 后台刷新不产生额外负载 |
| 超时 | 8 秒/请求 | 慢站点不至于拖死后台 |
| 鉴权 | 三个端点均需管理员会话 | 与其它后台 API 一致 |

### 刻意保留的"未连接"

- **Google Search Console**：没有只读凭证、也没有引入 `googleapis` 依赖，因此
  `gsc.connected = false`，页面显示所需环境变量名，**不显示曝光/点击/CTR/排名**，也不拿站内 PV 冒充搜索点击。
- **AI**：`ai.enabled = false`，只作预留位，不生成任何内容、不把正文发往第三方。

### 自动化验证

`python tests/admin_phase5.py` —— **29 项全部通过**：未登录拦截（3 个端点 + 页面 307）、
同步快照、health 字段完整、两个探针有真实状态码、无密钥字段泄露、3 分钟缓存命中、
链接检查 limit 生效且只探测同源路径、汇总字段、10 分钟缓存、SEO 端点 200、
GSC 明确未连接且给出 3 个必需环境变量、响应中不含 impressions/clicks/ctr/position 等伪造指标、
audit 行数与文章总数一致、robots/sitemap 已探测、AI 未启用、两个页面 SSR。

### 顺带发现（未擅自修改）

`/robots.txt` 在本地返回 **404**（`public/robots.txt` 不存在，且 `next-sitemap.config.js` 里
`generateRobotsTxt: false`）。这属于**站点层面的既有配置**，不在本阶段授权范围内，
因此只在健康页如实展示，不做静默改动。建议由管理员决定是否补一个指向 `/sitemap.xml` 的 robots.txt。

### 已知限制

1. 失效链接只覆盖"首页 + 归档 + 快照内文章 URL"，**不解析文章正文里的外链**（那需要抓取页面并解析 HTML，代价与风险都更高）。
2. GSC 与 AI 均为"未连接 / 未启用"；接入需要新增依赖与凭证，需单独批准。
3. 检查结果缓存在**单个实例内存**里，多实例部署时各实例各自探测（低频场景可接受）。

### 回滚

```bash
git checkout -- lib/admin/health.js pages/admin/health.js pages/admin/seo.js components/admin/AdminStatCards.js
git checkout -- lib/admin/sync/notion-sync.js
rm -rf pages/api/admin/health lib/admin/link-check.js lib/admin/seo-audit.js pages/api/admin/seo.js
```

---

## Phase 4 — Notion 只读同步、分类标签、评论计数（2026-11-10）

### 目标

让后台的数字"配得上名字"：文章标题/分类/标签来自 Notion 只读快照，评论数来自 Twikoo 公开计数接口。
**全程只读**：不创建、不修改、不删除、不发布任何 Notion 内容。

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `lib/admin/article-view.js` | 文章维度统一口径：路径 → 文章反查、`article_id` 与路径双口径取较大值 |
| `pages/api/admin/taxonomy.js` | 分类 / 标签聚合（文章数 + 所选时间窗 PV） |
| `components/admin/AdminSyncPanel.js` | 同步面板：立即同步、冷却倒计时、上次成功/失败、最近 5 条日志 |
| `pages/admin/categories.js` | 分类与标签页（占位 → 真实数据） |
| `pages/admin/comments.js` | 评论统计页（占位 → 真实数据 + 能力边界说明） |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `lib/admin/sync/notion-sync.js` | 新增 `stats:v1:pathmap`（path → articleId，**只增不删**）；slug 规范化（Notion 的 `article/xxx` 统一为 `xxx`）；清理历史非法键；返回统一 counts |
| `lib/analytics/constants.js` | 新增 `K.pathMap` |
| `lib/analytics/storage.js` | 新增 `getPathViews(dates)`（不截断的路径 PV，供文章反查） |
| `pages/api/admin/stats/report.js` | 改用 `article-view` 统一口径；新增 `pathMapSize` / `unmappedPathViews` |
| `pages/api/admin/sync/status.js` | 增加 `pathMapSize` / `cooldown` / `stale`（>24h） |
| `pages/admin/articles.js` | 顶部接入同步面板；新增"路径无法归属"提示 |
| `lib/kv.js` | 新增 `kvHdel`（仅用于清理格式非法的历史键） |

### 关键设计：路径映射只增不删

Notion 的 `post.slug` 形如 `article/dsh09`（自带目录前缀），页面 URL 是 `/article/dsh09`。
早期实现直接把 slug 拼成 `/article/article/dsh09`，造成路径映射污染（本次已修复并清理）。

- 写入：`/article/<纯 slug>` 与 `post.href` 两条键，均映射到 `articleId`；
- **只增不删**：文章改名或换 slug 后，旧路径的阅读量仍归到同一篇（这就是"改名不丢历史"）；
- 反查顺序：`pathmap` → 当前快照 `url` → 当前快照 `slug`；
- 无法归属的 `/article/*` 浏览单独计数为 `unmappedPathViews`（通常是已删除或从未同步的文章），
  不混进任何文章排行。

### 同步的安全边界

| 约束 | 实现 |
| --- | --- |
| 只读 | 只调用 `fetchGlobalAllData`（与前台同一份缓存），不写 Notion |
| 需要登录 | `requireAdminApi` |
| 需要 CSRF | `{ csrf: true }` |
| 冷却 | 5 分钟（`admin:sync:notion:cooldown`），重复触发返回 `429 sync_too_frequent` + `retryAfter` |
| 失败可见 | 写同步日志（最多 200 条）；后台显示最近失败原因，不静默重试 |
| 超大文章库 | 单次同步全量快照；分类/标签最多各留 200 个 |

### 评论的刻意边界

只使用 Twikoo 的公开计数事件 `GET_COMMENTS_COUNT`，**不使用管理员密钥**：

- 能拿到：每篇评论数、有评论的文章数（最近 100 篇范围内）；
- 拿不到（刻意）：待审核 / 垃圾评论、审核队列、每日评论趋势、评论正文；
- 未配置时显示"未连接"并给出配置项名称，**不显示 0 条**。

### 自动化验证

`python tests/admin_phase4.py` —— **29 项全部通过**：未登录拦截（3 个端点）、CSRF 缺失 403、
同步成功返回 counts、5 分钟冷却 429、日志与冷却可读、路径映射建立且无重复前缀污染、
分类聚合（16 篇 / 2 分类 / 9 标签，与快照一致）、slug 规范化、URL 未重复前缀、
taxonomy 非法 range 400、评论"未连接"语义、三个页面 SSR、report 暴露 `unmappedPathViews`。

另做了一次端到端验证：向 `/article/dsh09` 发 3 次 `page_view`（**不带 article_id**）→
report 正确归到该文章（真实标题、`pathMatched: true`、`uv: null`），
同时 `/article/not-exist-post` 的 1 次浏览计入 `unmappedPathViews`。

### 已知限制

1. **无自动同步**：只有手动触发。建议后续挂一个低频定时任务（如每日 1 次），本期不做。
2. **删除的文章不会从快照移除**（路径映射只增不删是有意的）；文章总数以最近一次同步为准。
3. **评论趋势未做**：Twikoo 公开接口没有时间维度，需要自建每日快照，成本大于收益，暂缓。
4. **分类/标签不自动合并同义词**（如"工具 / Tools"），保持与 Notion 一致。

### 回滚

```bash
git checkout -- pages/admin/articles.js lib/kv.js lib/analytics/constants.js lib/analytics/storage.js   pages/api/admin/stats/report.js pages/api/admin/sync/status.js
rm -f lib/admin/article-view.js pages/api/admin/taxonomy.js components/admin/AdminSyncPanel.js
git checkout -- pages/admin/categories.js pages/admin/comments.js   # 回到占位页
```

---

## Phase 3 — 后台数据页接真实数据（2026-11-10）

### 目标

把 Phase 1 留下的五个占位页（数据总览 / 流量分析 / 访客分析 / 行为分析 / 文章管理）全部改为读取**真实统计**，
并严格区分"未采集（—）"与"确实是 0"。不引入任何图表库：图表全部是零依赖手写 SVG。

### 新增文件（10 个，全部在 `components/admin/`）

| 文件 | 作用 |
| --- | --- |
| `AdminPanel.js` | 区块容器：标题 / 说明 / 右上操作 / **口径脚注**（每个区块强制解释口径） |
| `AdminNotice.js` | 加载 / 错误 / 空数据 / 未连接 / 警示 的统一提示条 |
| `AdminStatCards.js` | 指标卡组（`null` 显示"—"，`0` 显示 0） |
| `AdminRangeTabs.js` | 时间范围切换：今日 / 昨日 / 近 7 / 30 / 90 天，与 `?range=` 同步（可分享、刷新保持） |
| `AdminTrendChart.js` | 多序列折线图 + 网格 + 数据点 tooltip + 折叠数据表（无障碍兜底） |
| `AdminBarChart.js` | 柱状分布图（逐小时 PV、阅读深度直方图） |
| `AdminBarList.js` | 横向排行（维度分布 / 页面 / 来源域名），带占比 |
| `AdminDataTable.js` | 通用数据表（缺失值统一"—"） |
| `format.js` | 数字/百分比/日期/相对时间/**安全除法**/轴刻度取整（纯函数） |
| `useAdminReport.js` | 取数 hook：统一 loading / error / 空状态，401 自动跳登录，`?range` 同步 |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `pages/api/admin/stats/report.js` | **新增**：一次请求返回五个页面所需全部聚合（卡片 / 趋势 / 逐小时 / 排行 / 深度 / 搜索 / 外链 / 事件 / 文章） |
| `pages/admin/dashboard.js` | 占位 → 真实数据总览（11 张卡 + 趋势 + 来源 + 热门页面 + 文章表现） |
| `pages/admin/analytics.js` | 占位 → 流量分析（趋势/逐小时/页面排行/入口退出/来源域名/搜索/外链分享） |
| `pages/admin/visitors.js` | 占位 → 访客分析（UV 趋势 + 设备/浏览器/系统/国家 + 新老访客说明） |
| `pages/admin/behavior.js` | 占位 → 行为分析（深度直方图 + 完成率 + 文章深度表 + 事件计数） |
| `pages/admin/articles.js` | 占位 → 文章阅读排行（筛选/排序 + 分类标签分布 + 同步状态提示） |
| `components/admin/AdminModulePage.js` | 支持顶栏 `actions`（时间范围 + 刷新） |

### `report` 接口口径

```json
{
  "ok": true, "range": "7d", "dates": ["20261104", "…"],
  "generatedAt": "ISO", "collectionStartedAt": "ISO 或 null",
  "cards": { "today": {…}, "yesterday": {…}, "pv7": 0, "pv30": 0, "uv30": 0 },
  "summary": { "pv": 0, "uv": 0, "sessions": 0, "byDay": [], "dims": { "device": {}, "browser": {}, "os": {}, "geo": {}, "source": {} } },
  "hourly": { "day": "20261110 或 null（多日范围）", "rows": [{ "hour": "00", "pv": 0 }] },
  "depth": { "d25": 0, "d50": 0, "d75": 0, "d90": 0, "complete": 0 },
  "search": { "total": 0, "terms": [{ "term": "", "count": 0 }] },
  "referrers": [{ "host": "", "views": 0 }],
  "pages": { "pv": [], "entry": [], "exit": [] },
  "events": { "page_view": 0 },
  "realtime": { "windowMinutes": 5, "sessions": 0 },
  "visitors": { "newVisitors": 0, "returningVisitors": 0, "total": 0 },
  "outboundShare": { "outbound": [], "share": [] },
  "articles": { "syncedAt": null, "count": 0, "categories": [], "tags": [], "rows": [] }
}
```

口径要点：

1. **PV / UV / Session 三者不等价**，页面上每个区块都写明定义，不做换算拼接。
2. **UV 是 HLL 估算**（误差约 0.81%），不是真实人数；跨日 UV 由各日 HLL 合并，不等于各行相加。
3. **文章维度双口径**：`article_id`（页面主动上报）与 `/article/<slug>` 路径（按 Notion 快照反查）取**较大值**，
   并用 `pathMatched` 标注来源；路径口径拿不到 UV/深度时返回 `null`，页面显示"—"而不是 0。
4. **逐小时只对单日有意义**：多日范围 `hourly.day = null`，页面自动切回按日趋势。
5. **失败不伪装成 0**：存储不可用返回 503 `stats_store_unavailable`，页面显示错误条 + 重试，不显示 0。

### 自动化验证

`python tests/admin_phase3.py` —— **34 项全部通过**：未登录拦截、非法 range、埋点写入、PV/UV/Session 对账、
维度归类、逐小时 24 桶合计、路径排行、深度直方图、搜索词脱敏与大小写、事件计数、外链/分享、卡片、采集起始时间、
文章维度（PV/UV/完成率）、跨时间窗不串数据、五个页面 SSR、占位文案已移除。

### 已知限制

1. **自定义时间范围未做**：固定 5 档（今日/昨日/7/30/90 天）。加自定义需要同时改键扫描策略，单独评估。
2. **"新访客 / 回访"统计单位是 PV 不是人数**：页面文案已明确写清，避免被读成 UV。
3. **退出页是近似值**：只统计"会话内换页"，真正关闭标签页无法可靠捕获。
4. **没有 Notion 同步时**，文章标题显示为 `(未同步：<id 前 8 位>)`，属预期行为（Phase 4 提供同步入口）。
5. 所有数据都是客户端取数（GSSP 只做鉴权）——管理页**禁止**被 ISR/CDN 缓存，因此不做服务端预取。

### 回滚

```bash
git checkout -- pages/admin/dashboard.js pages/admin/analytics.js pages/admin/visitors.js   pages/admin/behavior.js pages/admin/articles.js components/admin/AdminModulePage.js
rm -f pages/api/admin/stats/report.js components/admin/{AdminPanel,AdminNotice,AdminStatCards,AdminRangeTabs,AdminTrendChart,AdminBarChart,AdminBarList,AdminDataTable,format,useAdminReport}.js
```
删除后五个页面回到 Phase 1 的占位说明（不会 500）。

---

## 安全补丁 1.5 —— 既有高危接口修复（2026-11-09）

> 这些是 Phase 0 审计发现的**既有代码**问题（F-01/03/04/05/06），与是否新增后台无关，但在后台接管 `/admin` 之前必须先修。

| 风险 | 文件 | 改法 |
| --- | --- | --- |
| **F-01** 管理令牌可能随 Notion 配置进 `__NEXT_DATA__` | `lib/rank/index.js` | `verifySecret` 改为**只读 `process.env`**（`RANK_SEED_SECRET` / `REVALIDATION_TOKEN`），并加常量时间比较；不再走 `siteConfig()` |
| **F-03** `/api/push/test` 零鉴权 + SSRF | `pages/api/push/test.js` | 同源 Origin 校验、按 IP 限流（5 次/分钟）、Web Push `endpoint` 域名白名单（FCM / Mozilla / WNS / Apple）、配置体积上限、**取消自动生成 VAPID**、错误只回通用文案 |
| **F-04** `/api/cache` fail-open | `pages/api/cache.js` | 未配置 `CACHE_REVALIDATION_TOKEN` 直接 **503**；Bearer 比较改常量时间 |
| **F-05** `/api/push/subscriptions` 可读他人推送配置 | `pages/api/push/subscriptions.js` | 按 IP 限流（30 次/分钟）、`no-store` + `no-referrer`、只回必要字段、`subscriberId` 必须 UUID 形态、错误统一文案 |
| **F-06** `/api/push/status`、`/admin/notify-status` 公开回显内部状态 | `pages/api/push/status.js`、`pages/admin/notify-status.js` | 默认只回 `{ok:true}`，细节需 `x-notify-secret`；`redisError` 只进服务端日志；诊断页纳入后台鉴权 |
| **F-02** OAuth 把 secret / token 打进日志与 URL | `pages/auth/index.js`、`pages/api/auth/callback/notion.ts` | 删除 secret/code/token 日志，只记 workspace 与 botId；跳转 URL 不再携带 token JSON；错误只记 message |

新增：`lib/notify/constants.js`、`lib/notify/rate-limit.js`（推送侧限流，Redis 优先、内存兜底）。

### 补充（2026-11-10）：单元测试对齐

F-01 把排行榜导入令牌改为**只读 `process.env`**，但 `__tests__/lib/rank-api.test.js` 仍按旧行为
（令牌来自 `siteConfig`）构造用例，导致 4 个用例失败（`/api/rank/seed` 返回 403）。
已在测试文件里显式设置 `process.env.RANK_SEED_SECRET = 'test-secret'`（与生产一致的口径），
现在 48 个 suite / 367 个用例全部通过。**这不是放宽校验，而是让测试跟上安全修复。**

**行为影响**：`/api/cache` 需要配 `CACHE_REVALIDATION_TOKEN` 才能用；`/api/push/test` 的 Web Push 只接受浏览器厂商网关 endpoint；`/api/push/status` 默认不再返回内部状态。推送设置面板（`themes/example/components/SettingsDropdown.js`）**未改动**，功能保持不变。

---

## Phase 2 — 统计基础设施（2026-11-09）

### 目标

建立**可核对、隐私最小化**的采集链路：前端 SDK → `/api/track`（校验/去重/限流）→ Redis 日桶 → 管理端汇总接口。

### 新增文件

| 文件 | 作用 |
| --- | --- |
| `lib/analytics/constants.js` | 事件白名单、键前缀、TTL、上限、来源分类清单 |
| `lib/analytics/validate.js` | 事件校验（名称/ID/路径/时间窗/体积/深度/搜索词脱敏） |
| `lib/analytics/classify.js` | 设备/浏览器/系统/来源归类，Asia/Shanghai 日桶与分钟桶 |
| `lib/analytics/storage.js` | 落桶写入 + 时间窗聚合读取（PV/UV/Session/维度/排行/实时） |
| `lib/analytics/client/tracker.js` | 浏览器 SDK（匿名 ID、30 分钟会话、批量 `sendBeacon`、失败静默） |
| `components/Tracker.js` | 空闲加载挂载点（仅公开页面） |
| `pages/api/track.js` | 公开采集端点（同源校验、限流 120/min、去重、204 静默） |
| `pages/api/admin/stats/summary.js` | 管理端汇总（today/yesterday/7d/30d/90d + 实时 + 路径排行 + 事件计数） |
| `lib/kv.js` | 通用键值层（由 `lib/admin/kv.js` 迁出，补 `setnx/pfadd/pfcount/hincrby/hgetall/mget`） |

### 修改文件

| 文件 | 改动 |
| --- | --- |
| `pages/_app.js` | 公开页面挂载 `<Tracker />`（后台分支不挂载） |
| `lib/admin/{respond,session,rate-limit,audit,store}.js`、`pages/admin/health.js` | kv 模块路径调整（行为不变） |

### 键规范（全部在 `stats:v1:*`，与 ISR 缓存 / rank / notify 分离）

```text
stats:v1:pv:{day}                 全站日 PV（INCR）
stats:v1:pvpath:{day}             路径 → PV（Hash）
stats:v1:pv:art:{day}             文章 → PV（Hash）
stats:v1:uv:{day}                 日 UV（HyperLogLog）
stats:v1:uv:art:{day}:{articleId} 文章日 UV（HLL）
stats:v1:sess:{day}               日 Session
stats:v1:dim:{day}:{src|dev|br|os|geo}   维度桶（Hash）
stats:v1:depth:{day}              阅读深度直方图（25/50/75/90/complete）
stats:v1:adepth:{day}             文章×深度（field = articleId|bucket）
stats:v1:events:{day}             事件名计数
stats:v1:search:{day} / searchq:{day}    搜索次数 / 搜索词（30 天）
stats:v1:outbound:{day} / share:{day}    外链域名 / 分享渠道
stats:v1:active:{yyyymmddHHmm}    实时活跃（HLL，12 分钟）
stats:v1:evt:{eventId}            事件去重（1 小时）
stats:v1:rl:{ipHash}:{minute}     采集限流
```

### 口径（写进代码注释与文档）

- **PV**：一次有效 `page_view`，重复访问重复计数。
- **UV**：日 HyperLogLog 去重（误差 ~0.81%），跨日合并用 `PFCOUNT`。
- **Session**：30 分钟无活动即新会话；服务端用 `SETNX sessseen:{session}:{day}` 保证只计一次。
- **实时活跃**：最近 5 个分钟桶的 HLL 合并，UI 必须标注“估算”。
- **阅读深度**：25/50/75/90 各上报一次；`article_complete` 单独计数。
- **保留期**：去重 1h / 搜索词 30d / 来源域名 90d / 日桶 400d（写时设 TTL，无需 Cron）。

### 隐私

- 不采集/不落库：明文 IP、设备指纹、邮箱、手机号、评论正文。
- 限流用 `sha256(ip|salt)` 前 24 位，仅 1 分钟窗口键；不写业务表。
- 搜索词：≤32 字符、小写、邮箱/手机号正则脱敏后才入库。
- 国家：只读 Vercel `x-vercel-ip-country`，不反查 IP。
- 退出：`localStorage.jba_optout=1` 即完全停采。

### 已知限制

1. `article_id` 目前需页面主动设置 `window.__JBA_PAGE__ = { articleId }`；Phase 4 Notion 同步后再统一注入，当前文章维度统计以 `page_path` 为准。
2. 搜索、评论提交、分类/标签点击中，除 `<a href="/category/…">`、`<a href="/tag/…">` 自动捕获外，其余需组件显式调用 `trackEvent()`（Phase 3 接入）。
3. 桌宠事件等桌宠功能确认上线后再接入。
4. Redis 真实实例下的往返与配额需在 Preview/生产验证（本地用内存后端跑通逻辑）。

---

## Phase 1 — 后台基础框架与认证（2026-11-09）

### 目标

在现有 NotionNext 项目内部建立 **`/admin` 受保护入口**：独立管理员账号密码、服务端会话、CSRF、登录限流、审计日志、改密、初始化流程、后台外壳。**不改主题、不迁路由、不新建站点、不触碰公开页面逻辑。**

### 新增文件

**配置与常量**

| 文件 | 作用 |
| --- | --- |
| `conf/admin.config.js` | 后台独立调参（会话时长、限流阈值、Cookie 名、bcrypt cost）。**不被 `blog.config.js` require**，避免进入公开页面 `__NEXT_DATA__` |
| `lib/admin/constants.js` | 纯常量（路径、Cookie 名、Redis 前缀、导航表）。Edge middleware 也会 import，故不依赖 node 内置模块 |

**认证与安全内核**

| 文件 | 作用 |
| --- | --- |
| `lib/admin/config.js` | 读取并校验 `ADMIN_*` / `SESSION_SECRET` / `REDIS_URL`；**fail-closed**（缺失即后台不可用） |
| `lib/admin/crypto.js` | sha256 / HMAC / 随机 token / 常量时间比较 / IP 加盐哈希 / 取客户端 IP |
| `lib/admin/password.js` | 密码哈希与校验（默认 scrypt，可选 bcrypt），强度校验，防时序探测的 dummy 比较 |
| `lib/admin/kv.js` | 键值层：生产 Redis（`ioredis`）；本地开发可显式启用内存后端（生产永不启用） |
| `lib/admin/session.js` | opaque 会话：创建 / 校验 / 滑动续期 / 销毁 / 按用户批量失效 |
| `lib/admin/respond.js` | 统一响应与安全头、Cookie 读写、API 守卫、页面守卫、开放重定向防护 |
| `lib/admin/rate-limit.js` | 登录失败限流（账号 + IP 双维度，Redis 计数，跨实例） |
| `lib/admin/audit.js` | 审计日志（Redis List，5000 条上限，90 天 TTL） |
| `lib/admin/store.js` | 管理员账户存储 + 环境变量引导 |
| `lib/admin/http.js` | 请求体解析与通用小工具 |
| `lib/admin/page-guard.js` | 页面 GSSP 的统一守卫封装 |
| `lib/admin/client.js` | 浏览器端 fetch 封装（CSRF header、401 跳转） |

**API（6 个）**

| 端点 | 作用 |
| --- | --- |
| `POST /api/admin/login` | 登录（限流、统一失败文案、会话轮换、下发 Cookie） |
| `POST /api/admin/logout` | 登出（需 CSRF） |
| `GET /api/admin/session` | 当前会话信息（用户名/角色/CSRF/时间） |
| `POST /api/admin/password` | 改密（需当前密码 + CSRF，成功后全部会话失效） |
| `POST /api/admin/init` | 一次性初始化（仅当无账户记录，且 `ADMIN_INIT_TOKEN` 匹配） |
| `GET /api/admin/audit` | 审计日志（最近 N 条） |

**页面（12 个）**

`pages/admin/index.js`（入口）、`login.js`、`dashboard.js`、`settings.js`，以及 Phase 3–5 的模块占位页：`analytics.js`、`visitors.js`、`behavior.js`、`articles.js`、`categories.js`、`comments.js`、`seo.js`、`health.js`，再加 `[...index].js` 兜底 404。

**组件（6 个）**

`AdminShell.js`（侧边栏 + 顶栏 + 深色适配 + 移动端抽屉）、`AdminLogin.js`、`AdminSettings.js`、`AdminModulePage.js`、`AdminBlocked.js`（配置缺失整页提示）、`PlaceholderPanel.js`（**不展示模拟数据**的统一占位）。

**脚本与测试**

`scripts/admin-hash-password.mjs`（离线生成哈希）、`scripts/admin-gen-secret.mjs`（生成 SESSION_SECRET）、`tests/admin_phase1_smoke.py`（24 项）、`tests/admin_phase1_extra.py`（13 项）。

### 修改的现有文件（仅 4 个）

| 文件 | 改动 | 影响面 |
| --- | --- | --- |
| `pages/_app.js` | 增加 `isAdminRoute` 分支：`/admin/*` 不渲染 `LayoutBase` / `SEO` / `ExternalPlugins` / `BlogPet`，但保留 `GlobalContextProvider`（Clerk hooks 前提） | **唯一影响公开页面渲染的文件**：默认分支逐行未变 |
| `middleware.ts` | 在 `authMiddleware` 之前加 Admin 守卫（Edge：Cookie 存在性 + HMAC 签名校验）；Clerk/noAuth 两分支语义完全保留 | 仅对 `/admin/*`、`/api/admin/*` 生效；公开路径代码未改 |
| `next.config.js` | `headers()` 追加 `/admin`、`/admin/:path*`、`/api/admin/:path*` 的 `Cache-Control: no-store`、`X-Robots-Tag: noindex`、`X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy` | 只新增规则；原有全站 CORS 规则未改 |
| `pages/admin/notify-status.js` | GSSP 增加后台鉴权（此前公开可读 Redis 状态与订阅数） | 该页由公开变为需登录，属安全修复 |

### 行为变化（对现有博客的影响）

- 公开页面：**无变化**（首页/文章/分类/标签/搜索/系列/归档/评论/桌宠/导航均未改代码；测试中首页 200 且主题正常渲染）。
- `pages/admin/notify-status`：从"任何人可读"变为"需管理员登录"。
- `pages/admin/**` 与 `/admin`: 从 404 变为受保护后台。
- 未改动：`themes/**`、`pages/[prefix]/**`、`lib/db/**`、`lib/cache/**`、`vercel.json`、`.github/**`、Notion 数据、Vercel/Cloudflare 配置。

### 已知偏差（需管理员确认）

1. **密码算法**：默认使用 `node:crypto` **scrypt**（N=2^15, r=8, p=1），而非 PROJECT_SPEC 字面要求的 Argon2id。
   - 原因：`bcryptjs` 依赖安装在本机被 yarn 解析阻塞，且没有 lockfile 变更的授权；Argon2id 需要 native 依赖。
   - 现状：实现按哈希前缀分派算法，**bcrypt 可直接启用**（设 `ADMIN_PASSWORD_ALGO=bcrypt` 并安装 `bcryptjs` 后，新哈希自动使用 bcrypt cost 12；旧 scrypt 哈希仍可校验）。
   - 若必须严格使用 bcrypt/Argon2id，请在 Phase 1 验收时批准新增依赖，我做一次依赖 + lockfile 的受控提交。
2. **统计存储**：Phase 1 只使用 Redis 存会话/限流/审计，**尚未建立统计键空间**（Phase 2）。
3. **占位页面**：Analytics / Visitors / Behavior / Articles / Categories / Comments / SEO 目前是"未接入真实数据"的说明页，**不含任何模拟数值**（按 PROJECT_SPEC 要求）。
4. **未修复的既有安全问题**：已在「安全补丁 1.5」中修复 F-01/02/03/04/05/06（见上方表格）。剩余低危项（`images.dangerouslyAllowSVG`、全站 CORS `*`、`.dsh-ops/` 未进 `.gitignore`）仍待处理，属 Phase 2 之后的小项。
5. **全站 CORS `*`** 未改：改动会影响现有嵌入/订阅等行为，Phase 1 只给 `/admin` 加了安全头；后续可单列。
6. **已知可被滥用的点（低风险）**：账号维度限流是"5 次/15 分钟"，攻击者若知道用户名，可反复触发把你挡在登录页 15 分钟（DoS 而非越权）。缓解：IP 维度并行计数、窗口短、阈值可在 Vercel 调整；Phase 2 可加指数退避或验证码。

### 回滚方式

```bash
# 新增文件全部可删除；仅 4 个文件需要还原
git checkout -- pages/_app.js middleware.ts next.config.js pages/admin/notify-status.js
rm -rf pages/admin pages/api/admin lib/admin components/admin conf/admin.config.js scripts/admin-*.mjs tests/admin_phase1_*.py
# 生产侧：删除新增环境变量即可让后台回到 503（fail-closed），公开站点不受影响
```

---

## Phase 0 — 现有项目只读审计（2026-11-09）

- 产出：`AUDIT_REPORT.md`、`ARCHITECTURE_PROPOSAL.md`、`DATA_SOURCE_REPORT.md`、`SECURITY_REVIEW.md`，以及 `_findings/` 三份明细（共 2742 行）。
- 未改动任何生产代码；仅新增 `docs/admin/`。
- 关键结论：纯 Pages Router（Next 15.5.21）；`/admin` 半占用；`_app` 包裹全部页面；middleware fail-open；Cloudflare 不在请求链路（Worker+D1 方案需替代）；现有统计插件全部不可查询；6 个现存可远程利用的安全问题。
