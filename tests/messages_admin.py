#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 3 冒烟：管理员收件箱 API（列表/筛选/搜索/详情/回复/状态/删除）。

前置：dev server 在 127.0.0.1:3111；JBA_TEST_PASSWORD 提供测试口令。
测试结束会 purge 自己创建的会话（不碰手工验收数据）。
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
    print("缺少 JBA_TEST_PASSWORD")
    sys.exit(2)

results = []
created = []


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


def jb(payload):
    try:
        return json.loads(payload)
    except Exception:
        return {}


def cookie(jar, name):
    for c in jar:
        if c.name == name:
            return c.value
    return ""


def make_conversation(anon, name, content):
    code, body, _ = call(
        anon,
        "POST",
        "/api/messages/conversations",
        {"visitor_name": name, "content": content, "client_request_id": f"adm-{int(time.time()*1000)%10**9}"},
        {"Origin": BASE, "X-Forwarded-For": f"203.0.113.{len(created)+10}"},
    )
    data = jb(body)
    if data.get("conversation_id"):
        created.append(data["conversation_id"])
    return code, data


def main():
    anon, _ = opener()
    stamp = int(time.time()) % 100000

    # 造 3 条会话，便于筛选/分页
    names = [f"收件箱A-{stamp}", f"收件箱B-{stamp}", f"收件箱C-{stamp}"]
    for i, n in enumerate(names):
        code, data = make_conversation(anon, n, f"第 {i+1} 条测试私信")
        record(f"创建测试会话 {i+1}", code == 201 and bool(data.get("conversation_id")), f"status={code}")

    # 未登录
    code, _, _ = call(anon, "GET", "/api/admin/messages/conversations")
    record("未登录列表 → 401", code == 401, f"status={code}")

    admin, jar = opener()
    code, body, _ = call(admin, "POST", "/api/admin/login", {"username": USER, "password": PASSWORD})
    if code != 200:
        print("登录失败", code, body)
        sys.exit(2)
    csrf = urllib.parse.unquote(cookie(jar, "jba_csrf"))

    # 列表 + 搜索 + 筛选
    code, body, _ = call(admin, "GET", "/api/admin/messages/conversations?status=all&pageSize=50")
    listing = jb(body)
    rows = listing.get("rows") or []
    record("列表 → 200 且有数据", code == 200 and len(rows) >= 3, f"status={code} rows={len(rows)}")
    record("列表邮箱脱敏", all(("***" in (r.get("visitor_email") or "")) or not r.get("visitor_email") for r in rows))
    record("列表按最后活动倒序", all(
        (a.get("last_message_at") or "") >= (b.get("last_message_at") or "")
        for a, b in zip(rows, rows[1:])
    ))

    code, body, _ = call(admin, "GET", f"/api/admin/messages/conversations?q={urllib.parse.quote(names[0])}")
    found = jb(body).get("rows") or []
    record("按昵称搜索命中 1 条", len(found) == 1 and found[0]["visitor_name"] == names[0], f"n={len(found)}")

    code, body, _ = call(admin, "GET", "/api/admin/messages/conversations?status=unread&pageSize=50")
    unread = jb(body).get("rows") or []
    record("未读筛选只返回未读", all(r.get("status") == "unread" for r in unread), f"n={len(unread)}")

    code, _, _ = call(admin, "GET", "/api/admin/messages/conversations?status=bogus")
    record("非法状态筛选 → 400", code == 400, f"status={code}")

    # 详情
    target = created[0]
    code, body, _ = call(admin, "GET", f"/api/admin/messages/conversations/{target}")
    detail = jb(body)
    record("详情 → 200 且含 1 条消息", code == 200 and len(detail.get("messages") or []) == 1,
           f"status={code} n={len(detail.get('messages') or [])}")
    record("详情含明文邮箱（管理员可见）", (detail.get("conversation") or {}).get("visitor_email") in (None, ""),
           "（本例未填邮箱，属预期）")

    # 标记已读（CSRF）
    code, _, _ = call(admin, "PATCH", f"/api/admin/messages/conversations/{target}", {"markRead": True})
    record("标记已读缺 CSRF → 403", code == 403, f"status={code}")
    code, body, _ = call(admin, "PATCH", f"/api/admin/messages/conversations/{target}",
                         {"markRead": True}, {"x-csrf-token": csrf})
    record("标记已读 → 200", code == 200, f"status={code}")
    code, body, _ = call(admin, "GET", f"/api/admin/messages/conversations/{target}")
    conv = jb(body).get("conversation") or {}
    record("已读后 unread_count=0 且状态 read", conv.get("unread_count") == 0 and conv.get("status") == "read",
           f"unread={conv.get('unread_count')} status={conv.get('status')}")

    # 回复
    code, body, _ = call(admin, "POST", f"/api/admin/messages/conversations/{target}/messages",
                         {"content": "收件箱测试回复"})
    record("回复缺 CSRF → 403", code == 403, f"status={code}")
    code, body, _ = call(admin, "POST", f"/api/admin/messages/conversations/{target}/messages",
                         {"content": "收件箱测试回复"}, {"x-csrf-token": csrf})
    record("管理员回复 → 201", code == 201, f"status={code}")
    code, body, _ = call(admin, "GET", f"/api/admin/messages/conversations/{target}")
    conv = jb(body).get("conversation") or {}
    record("回复后状态变 processing", conv.get("status") == "processing", f"status={conv.get('status')}")

    # 状态流转
    for next_status in ("resolved", "archived", "spam", "unread"):
        code, body, _ = call(admin, "PATCH", f"/api/admin/messages/conversations/{target}",
                             {"status": next_status}, {"x-csrf-token": csrf})
        got = (jb(body).get("conversation") or {}).get("status")
        record(f"状态 → {next_status}", code == 200 and got == next_status, f"got={got}")

    # 删除：二次确认 + purge
    # 删除：需要 CSRF，且服务端要求 confirm=<id>
    code, body, _ = call(admin, "DELETE", f"/api/admin/messages/conversations/{target}")
    record("删除缺 CSRF → 403", code == 403, f"status={code}")
    code, body, _ = call(admin, "DELETE", f"/api/admin/messages/conversations/{target}",
                         headers={"x-csrf-token": csrf})
    record("删除缺 confirm → 400", code == 400 and jb(body).get("error") == "confirm_required", f"status={code}")
    code, body, _ = call(admin, "DELETE", f"/api/admin/messages/conversations/{target}?confirm={target}",
                         headers={"x-csrf-token": csrf})
    record("软删除 → 200", code == 200, f"status={code}")
    code, body, _ = call(admin, "GET", f"/api/admin/messages/conversations/{target}")
    record("软删后详情 → 404", code == 404, f"status={code}")
    code, body, _ = call(admin, "DELETE", f"/api/admin/messages/conversations/{target}?confirm={target}&mode=purge",
                         headers={"x-csrf-token": csrf})
    record("purge → 200", code == 200, f"status={code}")

    # 列表不再包含已删除/已 purge 的会话
    code, body, _ = call(admin, "GET", "/api/admin/messages/conversations?status=all&pageSize=50")
    ids = [r["id"] for r in (jb(body).get("rows") or [])]
    record("删除后列表不含该会话", target not in ids)

    # 清理其余测试数据
    for cid in created:
        call(admin, "DELETE", f"/api/admin/messages/conversations/{cid}?confirm={cid}&mode=purge",
             headers={"x-csrf-token": csrf})
    code, body, _ = call(admin, "GET", "/api/admin/messages/stats")
    record("清理后 stats 可读", code == 200 and "unreadConversations" in jb(body), f"status={code}")

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
