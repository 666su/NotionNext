# 统计与事件口径说明 —— Phase 2

本文是"后台数字从哪来"的唯一权威说明。代码：`lib/analytics/**`、`pages/api/track.js`；汇总接口：`/api/admin/stats/summary`。

---

## 1. 数据流

```text
浏览器（公开页面）
  └─ <Tracker/>（空闲加载，≤3KB）
       ├─ page_view / session_start / article_read / scroll_depth / click 事件
       ├─ 内存队列（≤20 条或 5s）
       └─ navigator.sendBeacon('/api/track')
                │
                ▼
        /api/track（Node）
          ├─ 同源 Origin 校验
          ├─ 限流：120 事件 / 分钟 / IP 指纹
          ├─ 事件校验：白名单 + 字段 + 路径 + 时间窗 ±24h + 体积上限
          ├─ 去重：SETNX stats:v1:evt:{event_id}（1h）
          └─ 维度归类：设备/浏览器/系统/来源/国家（服务端完成）
                │
                ▼
        Redis 日桶（stats:v1:*，全部带 TTL）
                │
                ▼
        /api/admin/stats/summary（管理员）→ 后台页面
```

**失败策略**：`/api/track` 任何异常都返回 **204**，不向客户端解释；客户端失败即丢弃，不循环重试 → 统计服务故障不会影响博客。

---

## 2. 事件契约

```json
{
  "event_id": "32 位随机（客户端）",
  "event_name": "page_view",
  "anonymous_id": "第一方 localStorage 随机 ID",
  "session_id": "sessionStorage，30 分钟无活动轮换",
  "page_path": "/article/cloudflare01",
  "article_id": "Notion page id（可选）",
  "occurred_at": "ISO-8601（允许 ±24h 偏差）",
  "props": {}
}
```

| 事件 | 触发时机 | props |
| --- | --- | --- |
| `page_view` | 每次页面进入 / SPA 路由切换（同路径 1s 内去重） | — |
| `session_start` | 新会话首个事件之前自动补发 | — |
| `article_read` | 路径以 `/article/` 开头时随 page_view 发出 | — |
| `scroll_depth` | 滚动达到 25 / 50 / 75 / 90（每路径每档一次） | `{ depth: 25|50|75|90 }` |
| `article_complete` | 达到完成阈值（Phase 3 接入判定） | — |
| `search` | 站内搜索（Phase 3 组件接入） | `{ query }`（服务端脱敏） |
| `category_click` / `tag_click` | 点击 `/category/*`、`/tag/*` 链接（自动捕获） | `{ path }` |
| `outbound_click` | 点击站外链接（自动捕获） | `{ target_host }` |
| `share_click` | 分享按钮（Phase 3 接入） | `{ target_host }` |
| `comment_submit` | 评论提交成功（Phase 3 接入，**不含内容**） | — |
| `mascot_interaction` | 桌宠交互（桌宠确认上线后接入） | — |

白名单之外的 `event_name` 一律丢弃（不报错、不回显原因）。

---

## 3. 指标口径

| 指标 | 定义 | 实现 |
| --- | --- | --- |
| **PV** | 页面被有效加载并产生一次 `page_view`，重复访问重复计数 | `INCR stats:v1:pv:{day}` |
| **UV** | 统计周期内去重的匿名访客数（**不是真实自然人**） | `PFADD/PFCOUNT stats:v1:uv:{day}`，HLL 误差 ~0.81% |
| **Session** | 连续 30 分钟无活动的访问会话；同一访客一天可有多个 | `SETNX sessseen:{session}:{day}` + `INCR sess:{day}` |
| **实时活跃** | **最近 5 分钟内有事件的会话估算**（不是在线人数） | 最近 5 个 `active:{minute}` 桶 `PFCOUNT` |
| **阅读深度** | 25/50/75/90 四档直方图 | `HINCRBY depth:{day} {bucket}` |
| **文章阅读完成率** | `article_complete` / `article_read`（Phase 3 展示） | 两个事件计数相除 |
| **来源渠道** | direct / internal / search / social / referral | `dim:{day}:src` |
| **国家** | 两位国家码（Vercel 头），无头时为 `unknown` | `dim:{day}:geo` |

**必须区分**：页面停留时间 ≠ 实际阅读时间；Google 搜索点击 ≠ 站内 PV。前端/后台都不得把两者相加或互相替代。

---

## 4. 阈值与保留期

| 项 | 值 | 位置 |
| --- | --- | --- |
| 单请求最多事件 | 20 | `LIMITS.maxEventsPerRequest` |
| 请求体上限 | 8KB（API bodyParser 16KB 兜底） | `LIMITS.maxBodyBytes` |
| 每 IP 每分钟事件 | 120 | `LIMITS.ratePerMinute` |
| 事件时间偏差 | ±24 小时 | `validate.js` |
| 事件去重 TTL | 1 小时 | `TTL.dedupe` |
| 搜索词保留 | 30 天 | `TTL.search` |
| 来源域名保留 | 90 天 | `TTL.refHost` |
| 日桶保留 | 400 天 | `TTL.daily` |

清理**全部依赖 Redis TTL**，不需要 Cron；无 Redis 时会退化为 `REDIS_URL` 缺失 → 采集直接失败（不影响博客），生产必须配置。

---

## 5. 隐私边界（硬性）

- **不采集**：明文 IP、设备指纹、邮箱、手机号、姓名、GPS、评论正文。
- 限流用的 IP 指纹：`sha256(ip|salt)` 前 24 位，只写入 1 分钟窗口键，不进入业务键。
- 搜索词：≤32 字符 + 小写 + 邮箱/手机号正则脱敏后入库。
- 国家：只读请求头，不落 IP、不反查。
- 用户退出：`localStorage.jba_optout = '1'` 即完全停采（SDK 启动时检查）。
- 不跨站追踪、不与第三方共享。

---

## 6. 如何验证（本地 / Preview）

```bash
# 1) 登录后台拿 Cookie（浏览器操作），或直接看接口
curl -s 'https://<domain>/api/admin/stats/summary?range=today' \
  -H 'Cookie: jba_sid=...'

# 2) 打开首页几次，确认 PV/UV 增长
# 3) 确认重复事件不增长：同一 event_id 重发两次
curl -s -X POST 'https://<domain>/api/track' -H 'Content-Type: application/json' \
  -d '{"events":[{"event_id":"test-aaaa0001","event_name":"page_view","anonymous_id":"anon-111111111111","session_id":"sess-111111111111","page_path":"/","occurred_at":"2026-11-09T20:00:00+08:00"}]}'
# 期望：204，且 PV 只 +1（第二次同 id 不再增长）
```

本地自动化：`python tests/analytics_phase2.py`（21 项，含去重/非法事件/跨站/时间窗/UV 去重）。

---

## 7. 与 Phase 3 的衔接

Phase 3 直接使用 `/api/admin/stats/summary` 的返回结构：

```json
{
  "range": "7d",
  "dates": ["20261103", "…"],
  "summary": {
    "pv": 0, "uv": 0, "sessions": 0,
    "byDay": [{ "date": "20261103", "pv": 0, "sessions": 0 }],
    "dims": { "device": {}, "browser": {}, "os": {}, "geo": {}, "source": {} }
  },
  "realtime": { "windowMinutes": 5, "sessions": 0 },
  "topPaths": [{ "path": "/article/…", "views": 0 }],
  "eventCounts": { "page_view": 0 },
  "collectionStartedAt": "ISO-8601 或 null"
}
```

待补：按小时趋势、文章维度趋势、分类/标签聚合（Phase 4 与 Notion 同步结合）。
