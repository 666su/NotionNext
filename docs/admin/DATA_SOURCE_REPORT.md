# Jason Blog Admin —— 数据源可用性报告（Phase 0）

- 目的：回答"后台每个页面背后的数字，到底能不能拿到、要什么凭证、有什么限制"。
- 方法：静态代码审计 + 一次只读 DNS 查询 + 只读 HTTP 探测（详情与行号见 [DATA_SOURCES.md](_findings/DATA_SOURCES.md)）。
- 原则：**没有任何一项是"假设可用"的**。凡未实测/未确认的，标注为"未知"，并列出确认方式。

---

## 1. 总表

| # | 数据源 | 结论 | 需要什么 | 主要限制 | 对应后台页面 |
| --- | --- | --- | --- | --- | --- |
| 1 | **Notion 只读** | ✅ **可用（已实测逻辑）** | `NOTION_PAGE_ID`（**无需 token**） | 无任何流量字段；缓存滞后 90s–10min | 文章管理、分类/标签、全部页面的文章维度 |
| 2 | **自建统计（本方案新建）** | 🔨 **必须新建** | Redis（已有）/ 或 Supabase（待定） | 从上线日开始积累，**没有历史数据** | 总览、流量、访客、行为、文章表现 |
| 3 | **Twikoo 评论** | ⚠️ **部分可用** | `NEXT_PUBLIC_COMMENT_ENV_ID`（腾讯云 envId 或自建域名） | 只有"按文章路径查评论数"；无总数/待审核/趋势 | 评论统计（受限期） |
| 4 | **Cloudflare** | ❌ **当前不可用** | 若要用需 `CF_API_TOKEN` + zone 托管 | 站点不走 CF 代理；Vercel 不能绑 D1；Worker 仅图片代理 | 无（不规划） |
| 5 | **现有统计插件** | ❌ **查询不可用** | 各自第三方账号 | 全部是"前端上报 + 第三方看板"，仓库 0 处查询 API | 仅作对账参考 |
| 6 | **站内 rank 计数** | ⚠️ **有限可用** | 无 | 只有"文章累计去重 PV / 点赞"，无日期维度 | 可作"历史热度"参考，不进主指标 |
| 7 | **Redis（Upstash）** | ✅ **可用（生产已配置）** | `REDIS_URL`（已有） | 与 ISR 缓存/rank/notify 共库，需独立前缀 | 统计、会话、限流、审计的存储 |
| 8 | **Supabase** | ⚠️ **代码存在，统计库未建** | `SUPABASE_URL` + service key | 目前只有 Claude 热力图 2 张表，无迁移 | 方案 C 时才用 |
| 9 | **Google Search Console** | ⏳ **未接入（后期）** | GSC 只读 API + service account | 需域名验证；与站内 PV 来源不同，不可混用 | SEO 页 |
| 10 | **Vercel 部署状态** | ⏳ **未接入（后期）** | Vercel API token（只读） | 仓库不可见项目配置；不伪造状态 | 健康页 |

**一句话**：**今天没有任何一个数据源能回答 PV/UV/Session/来源/设备/国家/阅读深度**——这六类必须自建采集；Notion 能提供文章维度的"是谁"，Twikoo 只能提供"有几条评论"。

---

## 2. Notion：唯一可靠的内容数据源

### 2.1 读取机制（重要：不需要 Notion Integration Token）

| 事实 | 证据 |
| --- | --- |
| 走 `notion-client`（非官方 page API），`authToken` 取 `NOTION_TOKEN_V2`（可空），**不依赖 `NOTION_TOKEN`** | `lib/db/notion/getNotionAPI.js:1,27-31` |
| 站点数据入口 `fetchGlobalAllData({ pageId, from })` | `lib/db/SiteDataApi.js:50` |
| 页面 id 归一：`idToUuid()` | `lib/db/notion/getNotionPost.js:29-39` |
| `NOTION_TOKEN` 只出现在评论写入与翻译脚本，**与站点读取无关** | `pages/api/notion-comments.js:12`；`scripts/translate/*` |
| 数据缓存链：Redis（TTL=revalidate×1.5≈90s）→ 文件 → 内存（生产 10 分钟） | `lib/cache/redis_cache.js:7-9`；`lib/cache/memory_cache.js:4`；`lib/cache/cache_manager.js:134-155` |

**结论**：后台**不需要**新增 Notion 凭证；只需复用 `fetchGlobalAllData()`，并与前台共享同一份缓存（否则会出现"后台 N 篇 / 前台 N-1 篇"的错位）。

### 2.2 可用字段（单页 → 后台文章表）

| 字段 | 类型 | 后台用途 | 备注 |
| --- | --- | --- | --- |
| `id` | Notion page uuid | **文章主键（唯一关联标识）** | 稳定；`cleanPages()` 不剥离（`SiteDataApi.js:810-828`） |
| `title` / `name` | string | 展示 | 可改，**禁止做关联键** |
| `slug` | string | 路由 | 可改（受 `POST_URL_PREFIX` 规则影响）→ 需 slug 历史映射 |
| `href` | string（相对路径） | 生成 URL | 不是绝对 URL；`PSEUDO_STATIC` 时补 `.html` |
| `type` | `Post / Page / Notice / Menu / …` | 过滤 | 只统计 `Post` |
| `status` | `Published / Invisible` | 只统计 Published | **注意**：定时发布在返回前被改写为 `Invisible`（`SiteDataApi.js:783-798`） |
| `publishDate` | number(ms) | 发布时间 | 来自 Notion `date.start_date` 或 `created_time` |
| `lastEditedDate` | Date | 更新时间（"需更新文章"依据） | — |
| `category` | **string（单选）** | 分类维度 | 不是数组 |
| `tags` | **string[]** | 标签维度 | 纯字符串 |
| `tagItems` | `[{name,color}]` | 标签颜色 | 派生字段 |
| `series` / `number` | `string[]` / `string` | 系列 | — |
| `summary` / `wordCount` / `readTime` | string/number | 摘要、字数 | 视插件 |
| `pageCover` / `pageIcon` | URL | 封面 | — |
| `ext` | JSON | 自定义属性 | — |
| **PV/UV/评论数/阅读深度** | — | — | **Notion 里没有，也不该有** |

### 2.3 关联稳定性设计（对应 PROJECT_SPEC 4.5）

- **主键**：`articles.id = Notion page uuid`。
- **slug 变更**：同步时把 (旧 slug → id) 写入 `stats:v1:slugmap`；统计写入时先用 slug 查映射，查不到才按当前文章表匹配。→ 改名/改 URL 后历史数据仍归到同一篇文章。
- **标题变更**：完全不影响（不作为键）。
- **删除文章**：统计键保留（历史仍有意义），列表以 Notion 现存文章为准；孤儿键在聚合时过滤。
- **分类/标签**：只在同步时更新，不写回 Notion（Phase 4 明确只读）。

---

## 3. Twikoo：能力边界（比预期窄）

| 能力 | 是否可行 | 说明 |
| --- | --- | --- |
| 按文章路径批量取评论数 | ✅ | 公开事件（等价 `GET_COMMENTS_COUNT`），入参是 `urls` 数组；不需要管理员密钥。参考 `components/TwikooCommentCounter.js:38-60` |
| 站点总评论数 | ⚠️ 只能累加 | 公开接口无"整站合计"；需遍历全部 slug 分批查询 + 缓存（有超时/数量上限风险） |
| 待审核 / 垃圾评论数 | ❌ | 只在管理端，需要 Twikoo 管理员密码（**Phase 0/4 都不应持有**） |
| 每日新增评论趋势 | ❌ | 公开接口只返回累计值 → 只能在后台侧"每日快照"自行积累（从上线日开始） |
| 评论者国家/设备 | ❌ | Twikoo 不采集 |
| 评论正文/邮箱 | ❌ **禁止展示** | 违反 PROJECT_SPEC 4.7 与隐私要求 |

**实现建议**：`/api/admin/comments` 用 `allPages[].slug` 拼 `urls`（带前导 `/`）分批（≤50/批）请求 Twikoo 公开查询，结果缓存 10 分钟；页面上明确写"数据来源：Twikoo 公开评论计数；总数为累加估算，趋势自接入日起采集"。

**需要确认**：Twikoo 后端是腾讯云 envId 还是自建域名（`conf/comment.config.js:23`），以及云函数是否允许服务端 to 服务端调用（CORS/来源校验）。

---

## 4. Cloudflare：当前形态与三个明确答案

| 问题 | 答案 | 证据 |
| --- | --- | --- |
| 站点是否走 Cloudflare 代理？ | **没有**。DNS `NS=vercel-dns-017.com`，A `216.198.79.1` / `64.29.17.1`；线上无 `cf-ray` | DNS 只读查询 + 响应头 |
| Vercel 函数能否绑 D1？ | **不能**。D1 只能通过 Workers/Pages Functions 的 `env.DB` binding 访问 | 平台机制 |
| Worker 能否独立部署？ | **能**，但需要新的域名/路由；当前 `wrangler.toml` 仅 `custom_domain`（`cloudflare/notion-image-proxy/wrangler.toml`，无 D1/KV） | 仓库文件 |
| 能否拿到 `CF-IPCountry` / 边缘日志 / Cloudflare Web Analytics？ | **都不能**（不在链路） | 同上 |

**替代**：国家维度改用 Vercel 注入的 `x-vercel-ip-country`（服务端读取，不落 IP）；Vercel Web Analytics 与 Speed Insights **无公开查询 API**，不能作为后台数据源。

---

## 5. 现有统计插件：逐项结论

| 插件 | 是否接入 | 有查询 API？ | 能否进后台 |
| --- | --- | --- | --- |
| Vercel Analytics | 条件接入，默认关（`conf/analytics.config.js:5`）；首页实测未加载 | ❌ 无公开查询 API | ❌ |
| 不蒜子 | 配置默认 true，但需主题放容器 | ⚠️ 仅 JSONP 返回 `site_pv/page_pv/site_uv` | ⚠️ 仅"全站 PV/UV 标量"参考，无日期/维度 |
| 51LA | 条件接入（需 ID+CK） | ❌ | ❌ |
| Ackee | 条件接入 | ⚠️ 自身有 GraphQL，仓库 0 调用 | ❌（现状） |
| Google Analytics | 条件接入（需 ID） | ⚠️ GA4 Data API 需 service account | ❌（现状，后期可选） |
| Clarity | 条件接入 | ❌ | ❌ |
| Umami | 条件接入 | ⚠️ 需登录 token | ❌（现状） |
| Matomo | 条件接入 | ⚠️ Reporting API 需 token | ❌（现状） |
| `components/Vercel.js` | 存在 | — | 只是 Vercel logo，非统计 |

**关键**：这些配置都由 `siteConfig()` 读取，会被 **Notion 配置表覆盖**，所以"生产到底开了哪几个"**仓库不可见**，需在 Vercel 环境变量与 Notion 配置页核对。

---

## 6. 存储与缓存能力盘点

| 组件 | 实际使用 | 键 / TTL | 能否承载统计 |
| --- | --- | --- | --- |
| Redis（Upstash 风格） | ✅ 生产已配置（`/admin/notify-status` 实测 `storage=redis`） | ISR 缓存键、`rank:views`/`rank:likes`（无 TTL）、`notify:data`（365d） | ✅ **可**（独立 `stats:v1:*` 前缀 + TTL） |
| Vercel Runtime Cache | `lib/cache/vercel_cache.js` | `@vercel/functions` `getCache()`；不支持 del | ❌（不可持久） |
| 本地文件缓存 | 仅 build/dev；生产 `enableLocalCache=false` | 无过期 | ❌（Vercel 多实例不共享） |
| `/tmp` 回退（rank/notify） | 无 Redis 时 | 每实例临时 | ❌ **对统计致命** |
| Supabase | 仅 `lib/server/claude/contributionStore.js`（2 张表） | 无迁移脚本 | ✅ 新建表后可用（方案 C） |
| D1 / KV | 无 | — | ❌（架构不可达） |

**结论**：统计**必须**有真后端；生产已具备 Redis，是零新增成本的选择（见 [ARCHITECTURE_PROPOSAL.md](ARCHITECTURE_PROPOSAL.md) §6）。

---

## 7. API 接入点清单（21 个端点）

| 端点 | 方法 | 用途 | 现状鉴权 | 对后台的意义 |
| --- | --- | --- | --- | --- |
| `/api/track` | POST | **待新建**统计接收 | — | 采集入口 |
| `/api/cache` | POST | 清缓存 | Bearer `CACHE_REVALIDATION_TOKEN`，**未配置则放行（fail-open）** | 不可复用为后台能力 |
| `/api/revalidate` | POST | 按需 revalidate | Bearer `REVALIDATION_TOKEN` | 后台"刷新文章"可复用其逻辑（不直接调用） |
| `/api/rss` | GET | RSS | 无 | 无关 |
| `/api/subscribe` | POST | 邮件订阅 | 无（外部服务） | 无关 |
| `/api/notion-comments` | POST | Notion 评论写入 | 无（含邮箱/IP 写入） | 隐私风险，见 SECURITY |
| `/api/user` | GET | Clerk 当前用户 | Clerk | 与后台无关 |
| `/api/auth/callback/notion` | GET | Notion OAuth 回调 | 无 | 泄露风险（F-02） |
| `/api/blog-pet/posts` | GET | 桌宠取文章列表 | 无（只读） | **可复用**为文章列表来源 |
| `/api/claude/contribution-refresh` | POST | 刷新贡献热力图 | 共享密钥 | 无关 |
| `/api/push/send` | POST | 发送推送 | `x-notify-secret` | 无关 |
| `/api/push/status` | GET | 推送状态 | **无** | 信息泄露（F-06） |
| `/api/push/subscribe` | POST | 订阅 | 无 | 无关 |
| `/api/push/subscriptions` | GET | 查订阅 | **无** | 泄露 bot token（F-05） |
| `/api/push/test` | POST | 测试推送 | **无** | SSRF（F-03） |
| `/api/push/vapid-public-key` | GET | 公钥 | 无 | 无关 |
| `/api/rank/info` | GET | 排行榜信息 | 无 | 可作"历史热度"参考 |
| `/api/rank/like` | POST | 点赞 | 无（有限流？无） | 无关 |
| `/api/rank/seed` | POST | 导入历史计数 | `RANK_SEED_SECRET` | 密钥可能公开（F-01） |
| `/api/rank/status` | GET | 榜单状态 | 无 | 无关 |
| `/api/rank/top` | GET | Top N | 无 | 同上 |
| `/api/rank/view` | POST | 记一次浏览 | 无 | **不与新统计混用**（无日期维度） |

---

## 8. 数据同步策略（Phase 4）

| 项 | 设计 |
| --- | --- |
| 触发方式 | 手动（后台按钮，限频 1 次/5 分钟）+ 首次访问时惰性同步；**不引入 Cron**（Vercel 免费档 Cron 限制多） |
| 读取 | 复用 `fetchGlobalAllData()`（与前台同缓存）→ 避免重复拉 Notion |
| 写入 | 只写 `stats:v1:art:*`（文章快照）+ `stats:v1:slugmap` + `stats:v1:sync:log` |
| 字段 | `id/slug/href/title/type/status/publishDate/lastEditedDate/category/tags/syncedAt` |
| 幂等 | 以 `id` upsert；`slug` 变化时追加映射 |
| 失败 | 记 `sync:log`（status/error），后台"健康"页显示最近一次同步时间与错误 |
| 只读约束 | **绝不写 Notion**；无删除/发布/编辑能力 |

---

## 9. 明确"做不到"的清单（防止后期造假）

| 需求 | 结论 | 原因 |
| --- | --- | --- |
| 历史 PV/UV（接入前） | ❌ 无法提供 | 从未采集；第三方看板无查询 API |
| 精确在线人数 | ❌ 不存在 | 只能给"最近 5 分钟活跃会话估算" |
| 真实自然人 UV | ❌ 不存在 | 匿名 ID 会被清缓存/换设备重置 |
| 评论待审核数 | ❌ 需 Twikoo 管理员密钥 | 本方案不持有 |
| 评论者国家/设备 | ❌ | Twikoo 不采集 |
| Google 搜索点击 | ⏳ Phase 5 才有 | 需 GSC 授权；且**与站内 PV 是两套口径，不可混算** |
| Vercel 部署状态 | ⏳ 需 Vercel token | 无 token 时显示"未连接" |
| 页面停留 = 阅读时间 | ❌ 不等价 | 两者分开上报，不换算 |

---

## 10. 待确认项（数据源相关）

1. Twikoo 后端形态与是否允许服务端调用。
2. 生产是否配置 `SUPABASE_URL` / `SUPABASE_SECRET_KEY`（决定方案 C 可行性）。
3. Cloudflare 账号是否托管 `20240606.xyz`（决定未来能否上 D1）。
4. 是否已在 Vercel/Notion 配置页开启任何第三方统计（决定"对账参考"是否存在）。
5. 真实流量量级（决定 Redis 命令配额是否够）。

---

**结论**：内容侧（Notion）已就绪且零成本；流量与行为侧必须自建；评论侧只能做"有限统计"；Cloudflare 侧当前不可用。所有"不可用"项都必须在后台 UI 上以"未连接/无数据"呈现，**不得用静态模拟数据填充**。
