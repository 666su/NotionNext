#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 1 冒烟：私信数据层 + 访客 API + 管理员 API（Supabase messages schema）。

前置：
  1) dev server 在 127.0.0.1:3111，环境变量含 SUPABASE_URL / SUPABASE_SECRET_KEY /
     MESSAGE_TOKEN_SECRET（见 .dsh-ops/dev-env.sh）
  2) 管理员测试口令通过环境变量 JBA_TEST_PASSWORD 提供
"""

import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:3111"
USER = "admin"
PASSWORD = os.environ.get("JBA_TEST_PASSWORD", "")

if not PASSWORD:
    print("缺少 JBA_TEST_PASSWORD：请先 export JBA_TEST_PASSWORD=<本地测试口令>")
    sys.exit(2)

results = []


def record(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + ("  | " + str(detail) if detail else ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect()), jar


def call(op, method, path, body=None, headers=None, timeout=60):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
    )
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        r = op.open(req, timeout=timeout)
        return r.getcode(), r.read().decode("utf-8", "ignore"), r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore"), e.headers


def jbody(payload):
    try:
        return json.loads(payload)
    except Exception:
        return {}


def cookie(jar, name):
    for c in jar:
        if c.name == name:
            return c.value
    return ""


def rid(prefix="t"):
    return f"{prefix}{int(time.time()*1000)%10**10}"


def main():
    anon, _ = opener()
    stamp = rid()

    # ---------- 1. 创建会话 ----------
    code, body, headers = call(
        anon,
        "POST",
        "/api/messages/conversations",
        {
            "visitor_name": "Phase1 测试访客",
            "visitor_email": "reader@example.com",
            "content": "你好，我想咨询一篇文章里的技术问题。",
            "client_request_id": f"create-{stamp}",
        },
        {"Origin": BASE, "User-Agent": "Mozilla/5.0 Chrome/120"},
    )
    created = jbody(body)
    link = created.get("link") or ""
    conv_id = created.get("conversation_id") or ""
    parsed = urllib.parse.urlsplit(link)
    token = parsed.fragment
    record("创建会话 → 201", code == 201 and created.get("ok") is True, f"status={code}")
    record("返回一次性私密链接（含 fragment）", bool(conv_id) and bool(token), f"id={conv_id} token_len={len(token)}")
    record("链接路径为 /message/<id>", parsed.path == f"/message/{conv_id}", parsed.path)

    # ---------- 2. 创建幂等 ----------
    code, body, _ = call(
        anon,
        "POST",
        "/api/messages/conversations",
        {
            "visitor_name": "Phase1 测试访客",
            "content": "重复提交",
            "client_request_id": f"create-{stamp}",
        },
        {"Origin": BASE},
    )
    dup = jbody(body)
    record("同 client_request_id 重复创建 → 200 且不返回链接",
           code == 200 and dup.get("duplicate") is True and not dup.get("link"), f"status={code}")

    # ---------- 3. 入参校验（不消耗创建配额）----------
    cases = [
        ("昵称 41 字符", {"visitor_name": "a" * 41, "content": "x"}, 400, "invalid_name"),
        ("非法邮箱", {"visitor_name": "ok", "visitor_email": "not-an-email", "content": "x"}, 400, "invalid_email"),
        ("空白正文", {"visitor_name": "ok", "content": "   "}, 400, "invalid_content"),
        ("超长正文 5001", {"visitor_name": "ok", "content": "x" * 5001}, 413, "payload_too_large"),
    ]
    for label, payload, expect_code, expect_error in cases:
        code, body, _ = call(anon, "POST", "/api/messages/conversations", payload, {"Origin": BASE})
        err = jbody(body).get("error")
        record(f"校验：{label} → {expect_code} {expect_error}", code == expect_code and err == expect_error,
               f"status={code} error={err}")

    # honeypot
    code, body, _ = call(anon, "POST", "/api/messages/conversations",
                         {"visitor_name": "bot", "content": "hi", "website": "http://spam"}, {"Origin": BASE})
    record("honeypot 被填 → 400 且不暴露原因", code == 400 and jbody(body).get("error") == "invalid_input",
           f"status={code}")

    # 跨站 Origin
    code, _, _ = call(anon, "POST", "/api/messages/conversations",
                      {"visitor_name": "x", "content": "hi"}, {"Origin": "https://evil.example.com"})
    record("跨站 Origin 创建 → 403", code == 403, f"status={code}")

    # ---------- 4. 无 Cookie 访问会话 ----------
    code, _, _ = call(anon, "GET", f"/api/messages/conversations/{conv_id}")
    record("无 Cookie 读会话 → 403", code == 403, f"status={code}")

    # ---------- 5. 兑换 ----------
    visitor, vjar = opener()
    code, body, headers = call(visitor, "POST", "/api/messages/access/exchange",
                               {"conversation_id": conv_id, "token": token}, {"Origin": BASE})
    set_cookie = " ".join(headers.get_all("Set-Cookie") or [])
    record("凭证兑换 → 200", code == 200 and jbody(body).get("ok") is True, f"status={code}")
    record("下发 HttpOnly + Secure? + Path 限定",
           "HttpOnly" in set_cookie and f"Path=/api/messages/conversations/{conv_id}" in set_cookie,
           set_cookie[:120])
    record("Cookie 名带会话前缀", f"jbm_{conv_id[:10]}=" in set_cookie, set_cookie[:60])

    # 错误凭证
    code, body, _ = call(anon, "POST", "/api/messages/access/exchange",
                         {"conversation_id": conv_id, "token": "A" * 43}, {"Origin": BASE})
    record("错误 token → 403 invalid_credential", code == 403 and jbody(body).get("error") == "invalid_credential",
           f"status={code}")

    # ---------- 6. 用 Cookie 读消息 ----------
    code, body, _ = call(visitor, "GET", f"/api/messages/conversations/{conv_id}/messages")
    msgs = jbody(body).get("messages") or []
    record("Cookie 读消息 → 200 且含 1 条", code == 200 and len(msgs) == 1, f"status={code} n={len(msgs)}")

    # 伪造 Cookie
    code, _, _ = call(anon, "GET", f"/api/messages/conversations/{conv_id}/messages",
                      headers={"Cookie": f"jbm_{conv_id[:10]}={conv_id}.9999999999.forged"})
    record("伪造 Cookie → 403", code == 403, f"status={code}")

    # ---------- 7. 发消息 + 幂等 + 限流 ----------
    code, body, _ = call(visitor, "POST", f"/api/messages/conversations/{conv_id}/messages",
                         {"content": "补充一句：谢谢！", "client_request_id": f"send-{stamp}"},
                         {"Origin": BASE})
    record("访客发消息 → 201", code == 201 and jbody(body).get("ok") is True, f"status={code}")

    code, body, _ = call(visitor, "POST", f"/api/messages/conversations/{conv_id}/messages",
                         {"content": "重复内容", "client_request_id": f"send-{stamp}"}, {"Origin": BASE})
    dup_msg = jbody(body)
    record("同 client_request_id 再发 → 200 duplicated 且不新增",
           code == 200 and dup_msg.get("duplicated") is True, f"status={code}")

    code, body, _ = call(visitor, "GET", f"/api/messages/conversations/{conv_id}/messages")
    n_after_dup = len(jbody(body).get("messages") or [])
    record("幂等后消息数仍为 2", n_after_dup == 2, f"n={n_after_dup}")

    # 跨站发消息
    code, _, _ = call(visitor, "POST", f"/api/messages/conversations/{conv_id}/messages",
                      {"content": "x"}, {"Origin": "https://evil.example.com"})
    record("跨站 Origin 发消息 → 403", code == 403, f"status={code}")

    # 限流：每会话 5 条/分钟
    limited = 0
    for i in range(8):
        code, _, _ = call(visitor, "POST", f"/api/messages/conversations/{conv_id}/messages",
                          {"content": f"限流测试 {i}"}, {"Origin": BASE})
        if code == 429:
            limited += 1
            break
    record("同一会话高频发送触发 429", limited == 1, f"limited={limited}")

    # ---------- 8. 第二会话（越权测试用）----------
    code, body, _ = call(anon, "POST", "/api/messages/conversations",
                         {"visitor_name": "另一个访客", "content": "第二个会话"}, {"Origin": BASE})
    created2 = jbody(body)
    conv2 = created2.get("conversation_id") or ""
    token2 = urllib.parse.urlsplit(created2.get("link") or "").fragment
    record("创建第二会话", code == 201 and bool(conv2), f"status={code}")

    # 用 conv2 的 cookie 访问 conv1
    other, _ = opener()
    code, _, _ = call(other, "POST", "/api/messages/access/exchange",
                      {"conversation_id": conv2, "token": token2}, {"Origin": BASE})
    record("第二会话兑换 → 200", code == 200, f"status={code}")
    code, _, _ = call(other, "GET", f"/api/messages/conversations/{conv_id}/messages")
    record("用 B 会话 Cookie 读 A 会话 → 403（越权被挡）", code == 403, f"status={code}")

    # ---------- 9. 管理员 ----------
    code, _, _ = call(anon, "GET", "/api/admin/messages/stats")
    record("未登录访问管理员统计 → 401", code == 401, f"status={code}")

    admin, ajar = opener()
    code, body, _ = call(admin, "POST", "/api/admin/login", {"username": USER, "password": PASSWORD})
    if code != 200:
        print("管理员登录失败:", code, body)
        sys.exit(2)
    csrf = cookie(ajar, "jba_csrf")
    record("管理员登录成功", bool(csrf), f"csrf_len={len(csrf)}")

    code, body, _ = call(admin, "GET", "/api/admin/messages/stats")
    stats = jbody(body)
    record("统计接口 → 200 且只含数量", code == 200 and "unreadConversations" in stats
           and "content" not in json.dumps(stats), f"status={code} unread={stats.get('unreadConversations')}")
    record("未读数 ≥ 1", (stats.get("unreadConversations") or 0) >= 1, stats.get("unreadConversations"))

    code, body, _ = call(admin, "GET", "/api/admin/messages/conversations?status=all&pageSize=10")
    listing = jbody(body)
    rows = listing.get("rows") or []
    record("收件箱列表 → 200", code == 200 and bool(rows), f"status={code} rows={len(rows)}")
    record("列表邮箱已脱敏", all(("***" in (r.get("visitor_email") or "")) or not r.get("visitor_email") for r in rows),
           rows[0].get("visitor_email") if rows else "")

    code, body, _ = call(admin, "GET", f"/api/admin/messages/conversations/{conv_id}")
    detail = jbody(body)
    record("会话详情 → 200 且含消息", code == 200 and len(detail.get("messages") or []) >= 2,
           f"status={code} n={len(detail.get('messages') or [])}")

    code, _, _ = call(admin, "PATCH", f"/api/admin/messages/conversations/{conv_id}",
                      {"markRead": True})
    record("标记已读缺 CSRF → 403", code == 403, f"status={code}")

    code, body, _ = call(admin, "PATCH", f"/api/admin/messages/conversations/{conv_id}",
                         {"markRead": True}, {"x-csrf-token": csrf})
    record("标记已读 → 200", code == 200, f"status={code}")

    code, body, _ = call(admin, "GET", "/api/admin/messages/stats")
    after = jbody(body)
    record("已读后未读数下降", (after.get("unreadConversations") or 0) < (stats.get("unreadConversations") or 0),
           f"{stats.get('unreadConversations')} → {after.get('unreadConversations')}")

    code, body, _ = call(admin, "POST", f"/api/admin/messages/conversations/{conv_id}/messages",
                         {"content": "收到，我看一下这篇。"})
    record("管理员回复缺 CSRF → 403", code == 403, f"status={code}")

    code, body, _ = call(admin, "POST", f"/api/admin/messages/conversations/{conv_id}/messages",
                         {"content": "收到，我看一下这篇。"}, {"x-csrf-token": csrf})
    record("管理员回复 → 201", code == 201 and jbody(body).get("ok") is True, f"status={code}")

    code, body, _ = call(visitor, "GET", f"/api/messages/conversations/{conv_id}/messages")
    all_msgs = jbody(body).get("messages") or []
    record("访客能看到管理员回复", any(m.get("sender") == "admin" for m in all_msgs), f"n={len(all_msgs)}")

    code, body, _ = call(admin, "PATCH", f"/api/admin/messages/conversations/{conv_id}",
                         {"status": "resolved"}, {"x-csrf-token": csrf})
    record("标记已解决 → 200", code == 200 and (jbody(body).get("conversation") or {}).get("status") == "resolved",
           f"status={code}")

    code, body, _ = call(admin, "PATCH", f"/api/admin/messages/conversations/{conv_id}",
                         {"status": "会炸的值"}, {"x-csrf-token": csrf})
    record("非法状态 → 400 invalid_status", code == 400 and jbody(body).get("error") == "invalid_status",
           f"status={code}")

    # 访客新消息把 resolved 拉回 unread（用第二会话，避开第一会话的发送限流）
    visitor2, _ = opener()
    call(visitor2, "POST", "/api/messages/access/exchange",
         {"conversation_id": conv2, "token": token2}, {"Origin": BASE})
    code2, body2, _ = call(admin, "PATCH", f"/api/admin/messages/conversations/{conv2}",
                           {"status": "resolved"}, {"x-csrf-token": csrf})
    code3, _, _ = call(visitor2, "POST", f"/api/messages/conversations/{conv2}/messages",
                       {"content": "还有个补充问题"}, {"Origin": BASE})
    _, body3, _ = call(admin, "GET", f"/api/admin/messages/conversations/{conv2}")
    status_now = (jbody(body3).get("conversation") or {}).get("status")
    record("访客新消息使已解决会话回到 unread",
           code2 == 200 and code3 == 201 and status_now == "unread",
           f"patch={code2} send={code3} status={status_now}")

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
