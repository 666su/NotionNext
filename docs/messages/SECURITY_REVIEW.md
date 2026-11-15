# SECURITY REVIEW —— Jason Blog Messages

- 评审对象：私信系统在**现有 NotionNext + Jason Blog Admin** 上的落地方式（Phase 0 设计阶段）。
- 结论：方案可行；风险集中在"凭证生命周期""越权""刷量""与现有平台配置冲突"四类。
- 本文件同时是 **Phase 4 的测试清单**（§7）与**上线前勾选表**（§8）。

---

## 1. 资产与信任边界

| 资产 | 泄露/被篡改的后果 | 保护手段 |
| --- | --- | --- |
| 会话访问凭证 `access_token` | 任何人都能读该访客的私信 | 32 字节随机；库内只存 HMAC；只走 fragment + body |
| 私信正文 | 隐私泄露（最高优先级） | Cookie 鉴权 + 服务端绑定 convId；不进日志/统计/第三方 |
| 访客邮箱 | 隐私泄露 | 选填；列表脱敏；不用于自动发信 |
| 管理员会话 | 全部私信可读 + 可回复 | 复用现有 sid（opaque + HMAC）+ CSRF + 登录限流 |
| 管理员操作日志 | 审计失效 | 单独 List，`LTRIM 2000` |

信任边界：

```text
互联网（不可信）
   │  HTTPS
   ▼
Vercel Edge / middleware（只做乐观判断，**不是**权威鉴权）
   │
Vercel Function（可信执行环境）
   ├─ requireAdminApi → 权威管理员鉴权（Redis 会话）
   ├─ /api/messages/* → 凭证/Cookie 权威校验
   └─ Redis（可信存储，但**必须**视为"可能被淘汰/可能被读"）
```

**原则：Edge 不算安全边界。** 所有权限判断必须在 Node 侧（`pages/api/**` 的 handler 内）重新做一遍 —— 与现有 `lib/admin/respond.js:151-205` 的既有做法一致。

---

## 2. 威胁模型（按"能不能直接变现"排序）

| # | 威胁 | 攻击路径 | 影响 | 现有方案能否挡 |
| --- | --- | --- | --- | --- |
| T1 | **IDOR / 会话枚举** | 改 `/api/messages/conversations/<id>` 的 id，或猜链接 | 读到别人的私信 | ✅ 凭证 + Cookie 双重绑定；id 16 字符随机 |
| T2 | **凭证爆破** | 对 exchange 接口高频试 token | 猜中即读 | ✅ 32 字节随机（2^256）+ 兑换限流 + 失败封禁 |
| T3 | **凭证泄露（链路）** | token 进日志/Referer/截图/浏览器历史 | 他人可读 | ✅ fragment + `Referrer-Policy: no-referrer` + 不进日志 |
| T4 | **刷量 / 垃圾私信** | 脚本批量创建会话 | 塞满收件箱、消耗配额 | ✅ 限流矩阵 + honeypot + 长度/重复检测 |
| T5 | **XSS** | 访客正文含 `<script>` / 事件属性，管理员页面渲染 | 管理员会话被劫持 | ✅ React 文本节点渲染（默认转义）+ 服务端拒绝控制字符；**禁止** `dangerouslySetInnerHTML` |
| T6 | **CSRF（管理员写操作）** | 第三方站点诱导管理员点链接触发 POST | 冒名回复/删会话 | ✅ 现有双提交 CSRF + Origin 校验（`respond.js:126-136`） |
| T7 | **CSRF（访客发消息）** | 借用访客 Cookie 发消息 | 污染会话 | ⚠️ 访客 API 也要做 Origin 校验（v1 必做）；`SameSite=Lax` 已挡大部分 |
| T8 | **重放 / 重复提交** | 网络重试导致重复消息 | 会话混乱 | ✅ `client_request_id` 幂等（24h） |
| T9 | **管理员接口越权** | 未登录直接打 `/api/admin/messages/*` | 全量泄露 | ✅ `requireAdminApi` + middleware 乐观拦截 |
| T10 | **Redis 数据被缓存淘汰** | 私信与 ISR 缓存共库 + LRU | **数据静默丢失** | ❌ 现状不保证（R1）；需独立库或 `noeviction` |
| T11 | **DoS（成本/配额）** | 高频调用 exchange/create 打满 Upstash 配额 | 私信不可用（博客不受影响） | ⚠️ 限流可缓解；无 CDN/WAF 规则时仍有风险 |
| T12 | **第三方脚本窃取** | 私密页加载分析脚本，读 DOM/URL | 凭证/内容外泄 | ✅ 私密页不挂 `ExternalPlugins`；fragment 立即清除 |
| T13 | **浏览器扩展/截图** | 用户侧泄露 | 无法技术防御 | ⚠️ 残余风险，页面明确提示"链接=凭证" |

---

## 3. 逐项控制措施（可实施细节）

### 3.1 凭证

- `access_token = randomToken(32)`（`lib/admin/crypto.js:18`，`crypto.randomBytes`）。
- 库内 `token_hash = HMAC-SHA256(token, MESSAGE_TOKEN_SECRET)`；比较用 `timingSafeEqualStr`。
- **不存明文**、不写日志、不进错误信息、不进统计事件。
- 兑换成功后可选择"旋转 token"（v1 不做，避免用户刷新页面就失效）。

### 3.2 会话 Cookie

```text
name     = jbm_sid
value    = <convId>.<expSec>.<HMAC(convId|expSec, MESSAGE_TOKEN_SECRET)>
HttpOnly = true
Secure   = true（生产；预览环境同样 true）
SameSite = Lax
Max-Age  = 604800（7 天）
Path     = /message/<convId> 与 /api/messages/conversations/<convId>（同名不同 Path）
无 Domain 属性
```

- 服务端校验：HMAC 正确 + `expSec` 未过期 + 签名里的 `convId` **与请求路径里的 id 完全一致**（防"用 A 的 cookie 打 B 的接口"）。
- 伪造 Cookie 只能靠猜 HMAC（需要 `MESSAGE_TOKEN_SECRET`）。
- 过期后：页面提示"链接已失效，请重新打开你保存的私密链接"，不做自动续期。

### 3.3 兑换接口

- 限流：10 次/分/IP、60 次/时/IP；连续失败 10 次封 30 分钟（按 IP 哈希）。
- 失败响应**恒定**为 `403 { error: "invalid_credential" }`，不区分"会话不存在/已删除/token 错"（防枚举）。
- 成功/失败都写 `accesslog`（只记 cid、结果、时间、ipHash 前缀 8 位）。
- 响应不包含 `token`、`token_hash`、`visitor_email` 明文。

### 3.4 访客 API

- 全部走 `POST`/`GET` + JSON；`Content-Type` 必须是 `application/json`（挡表单 CSRF）。
- 同源校验：`Origin` 存在时必须与 `Host` 一致（复用 `respond.js:120-133` 的 `originAllowed` 逻辑，移植到 `lib/messages/respond.js`）。
- 响应头：`Cache-Control: no-store`、`X-Robots-Tag: noindex, nofollow, noarchive`、`Referrer-Policy: no-referrer`。
- 请求体上限 16KB（Next `bodyParser.sizeLimit`），正文 ≤5000 字符。

### 3.5 内容与渲染

- 服务端：`content.trim()`、长度 1–5000、剔除 `\x00-\x08\x0B\x0C\x0E-\x1F`、连续同字符 >50 拒绝、整段重复率 >90% 拒绝（简单启发式）。
- 前端：只用 `{text}` 渲染；**禁止** `dangerouslySetInnerHTML`、禁止把正文拼进 `href`/`style`。
- 链接不自动变成可点击 `<a>`（v1 纯文本）；若要可点击，需白名单 + `rel="noopener noreferrer nofollow"`。

### 3.6 管理员侧

- 复用 `requireAdminApi(req,res,{csrf:true})`；写操作全部需要 `x-csrf-token`。
- 删除必须 `?confirm=<conversation_id>` 二次确认（服务端校验，不只靠前端弹窗）。
- 管理员回复也走同一套长度/控制字符校验。
- 私信模块**不新增管理员权限等级**（v1 单管理员）。

### 3.7 日志与审计

| 日志 | 记录 | 禁止记录 |
| --- | --- | --- |
| `msg:v1:adminlog` | 动作（reply/status/delete）、cid、时间、结果 | 正文、邮箱、token |
| `msg:v1:accesslog` | exchange 成功/失败、cid、ipHash 前 8 位、时间 | token、明文 IP |
| `console.error` | 错误类别（`store_unavailable` 等） | 请求体、token、Cookie 值 |

### 3.8 缓存与索引

- `/message/*` 与 `/api/messages/*` 一律 `no-store`；**不允许**被 CDN/ISR 缓存。
- 页面 **禁止** 使用 `getStaticProps`（会静态化并可能被缓存）→ 用 `getServerSideProps` 或纯客户端渲染。
- `robots.txt` 增加 `Disallow: /message`；sitemap 不包含（已确认 `pages/sitemap.xml.js:32` 只列 Notion 页面）。
- 页面 `<meta name="robots" content="noindex,nofollow">`（双保险，与响应头一致）。

### 3.9 与现有平台配置的冲突（必须在 Phase 1 修掉）

| 冲突 | 证据 | 处理 |
| --- | --- | --- |
| 全站 `Access-Control-Allow-Origin: *` + `credentials: true` | `next.config.js:342-356` | 为 `/api/messages/:path*` 覆盖为同源（或删除 ACAO） |
| 全站无 CSP / nosniff / HSTS | `next.config.js:357-381`（注释掉） | 至少给 `/message/:path*` 加 `nosniff` + `X-Frame-Options: DENY` |
| `/message/*` 会被 `[prefix]/[slug]` 接管 | `pages/[prefix]/[slug]/index.js:50` | 新增静态路由 `pages/message/[id].js` |
| 私密页默认挂载第三方插件与统计 | `pages/_app.js:103-106` | 新增 `isMessagesRoute` 分支 |
| 链接域名默认值不是本站 | `blog.config.js:22` | 用请求 origin 拼链接 |

---

## 4. 隐私设计（对应规范 §9）

| 要求 | 落地 |
| --- | --- |
| 邮箱选填、不公开 | 存 Hash 字段；列表接口返回 `a***@b.com`；导出脚本保留原文（备份用） |
| 不采集明文 IP | 只存 `hashIp(ip, secret)` 的前 8 位用于限流排查 |
| 私信不进统计 | `/message/*` 不挂 Tracker |
| 不进公开搜索 | `noindex` + robots + sitemap 不含 |
| 不写普通日志 | 见 §3.7 |
| 数据保留 | 正常长期；spam 30 天可清；accesslog 90 天 |

---

## 5. 现有系统的既有弱点（本次不修，但需登记）

| 项 | 说明 | 建议 |
| --- | --- | --- |
| 全站 CORS `*` | 见 §3.9 | Phase 1 只覆盖私信路径；全站收紧另开任务 |
| 无 CSP | 第三方脚本可执行 | 私信页不加载第三方已足够；全站 CSP 单独评估 |
| `/admin` 登录是"账号密码 + 无 2FA" | 一旦密码泄露后果最大 | 建议后续加 TOTP（不在本项目范围） |
| Upstash 免费档无自动备份 | 见 DATABASE §9 | 提供导出脚本 + 月度手动备份 |
| 图标/字体走公共 CDN | 隐私影响小 | 不改 |

---

## 6. 攻击面清单（新代码引入）

```text
公开可写端点（必须限流 + 校验）：
  POST /api/messages/conversations
  POST /api/messages/access/exchange
  POST /api/messages/conversations/[id]/messages      （需 Cookie）

公开可读端点（需 Cookie）：
  GET  /api/messages/conversations/[id]
  GET  /api/messages/conversations/[id]/messages

公开页面：
  GET  /message/[id]                                   （需 Cookie 才能看内容；无 Cookie 只显示"请打开完整链接"）

管理员端点（全部 requireAdminApi）：
  GET/POST/PATCH/DELETE /api/admin/messages/**
```

---

## 7. Phase 4 测试矩阵（与规范 §13 对齐）

| 类别 | 用例 | 期望 |
| --- | --- | --- |
| 凭证 | 正确 token 兑换 | 200 + Set-Cookie（HttpOnly/Secure/Lax/最小 Path） |
| 凭证 | 错误 token | 403 `invalid_credential`，无差异信息 |
| 凭证 | 空 token / 超长 token | 403，且不写日志正文 |
| 越权 | 用 A 的 Cookie 请求 B 的会话 | 403（HMAC 里的 cid 与路径不符） |
| 越权 | 不带 Cookie 请求会话 | 403 |
| Cookie | 伪造 `jbm_sid=abc.9999999999.deadbeef` | 403 |
| Cookie | 过期 exp | 403，前端提示"链接已失效" |
| CSRF | 管理员 POST 缺 `x-csrf-token` | 403 `csrf_failed` |
| CSRF | 访客 POST 带 `Origin: https://evil.com` | 403 |
| XSS | 正文 `<img src=x onerror=alert(1)>` | 存为纯文本；管理员页显示为文字；无脚本执行 |
| 注入 | 正文含 Redis 命令/JSON 特殊字符 | 正常存储与回显（无命令拼接） |
| 重放 | 同 `client_request_id` 连发 3 次 | 只落 1 条消息，3 次返回同 messageId |
| 刷量 | 同会话 1 分钟发 6 条 | 第 6 条 429 + `retryAfter` |
| 刷量 | 同 IP 10 分钟创建 4 个会话 | 第 4 个 429 |
| 兑换爆破 | 同 IP 连续 10 次错误 token | 第 11 次 429/403（封禁生效） |
| 长度 | 5001 字符正文 | 413 `payload_too_large` |
| 空白 | 纯空格正文 | 400 `invalid_input` |
| 邮箱 | `not-an-email` | 400 `invalid_email` |
| 幂等 | 创建会话重复提交（同 client_request_id） | 返回同一会话，不重复建 |
| 存储故障 | 关闭 Redis（或指向坏地址） | 503 `store_unavailable`；**公开博客仍 200** |
| 缓存 | `curl -I /message/x` | `Cache-Control: private, no-store` |
| 头部 | `curl -I /message/x` | 含 `X-Robots-Tag: noindex`、`Referrer-Policy: no-referrer` |
| robots | `GET /robots.txt` | 含 `Disallow: /message` |
| 回归 | 首页/文章/分类/标签/搜索/Twikoo/桌宠/现有 admin | 全部与改动前一致 |

自动化方式：延续现有 `tests/*.py` 风格（真实 HTTP + 内存 KV 后端），新文件 `tests/messages_phase1.py` / `phase2` / `admin` / `security`。

---

## 8. 上线前勾选表

- [ ] `MESSAGE_TOKEN_SECRET` 已配置，且与 `SESSION_SECRET` **不同**
- [ ] 私信使用**独立** Redis 库，或已确认 `maxmemory-policy=noeviction`
- [ ] `/message/*`、`/api/messages/*` 返回 `no-store` + `noindex` + `no-referrer` + `nosniff` + `DENY`
- [ ] `/api/messages/*` 的 CORS 已收紧（不再是 `*`）
- [ ] `robots.txt` 含 `Disallow: /message`
- [ ] 私密页不加载 `ExternalPlugins`、不挂 `Tracker`
- [ ] 兑换接口有限流与失败封禁
- [ ] 越权矩阵（§7）全部通过
- [ ] 公开博客回归（首页/文章/分类/标签/搜索/评论/桌宠/移动端）全部通过
- [ ] 备份脚本可跑通，且导出的 JSON 不进 Git
- [ ] 回滚演练：删新增文件 + 还原 5 个修改文件后，`/admin` 与博客均正常

---

## 9. 残余风险（接受或后续处理）

| 风险 | 可能性 | 影响 | 处理 |
| --- | --- | --- | --- |
| 访客把链接发到公开群 → 他人可读 | 中 | 隐私泄露 | 页面强提示；未来可加"访客二次确认/设备绑定" |
| 用户设备被恶意扩展/木马 | 低 | 凭证被读 | 无法防御；缩短 Cookie 有效期可缓解 |
| 管理员密码泄露 | 低 | 全量私信 | 现有登录限流；建议后续加 TOTP |
| Redis 单点故障 | 低 | 私信暂不可用 | fail-closed + 明确错误；博客不受影响 |
| 免费额度被打满（DoS） | 中 | 私信不可用 | 限流；必要时加 Vercel/Cloudflare 速率规则 |

---

## 10. 结论

1. 方案的**安全边界清楚**：Edge 只做乐观拦截，Node 侧做权威鉴权；凭证与标识分离、库内只存 HMAC。
2. **必须先修 5 处平台冲突**（§3.9），否则会出现"页面 404 / 被统计 / 被第三方脚本加载 / 链接域名错 / CORS 误导"这类真实的低级泄露。
3. 6 类高风险（T1/T2/T4/T5/T6/T10）都有明确对策；**T10（Redis 淘汰）是唯一需要管理员决策的**（独立库 or `noeviction`）。
4. Phase 4 的测试矩阵已经写好，可以直接落成 `tests/messages_security.py`。
