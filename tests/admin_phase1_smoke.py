#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Phase 1 冒烟测试：只针对本地 dev server（默认 http://127.0.0.1:3111）。
用法: python tests/admin_phase1_smoke.py [base_url] [username] [password]
测试口令通过环境变量 JBA_TEST_PASSWORD 提供（不要写进仓库）。
"""

import os
import http.cookiejar
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:3111"
USERNAME = sys.argv[2] if len(sys.argv) > 2 else "admin"
PASSWORD = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("JBA_TEST_PASSWORD", "")

if not PASSWORD:
    print("缺少 JBA_TEST_PASSWORD：请先 export JBA_TEST_PASSWORD=<本地 dev server 的测试口令>")
    sys.exit(2)

results = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + ("  | " + detail if detail else ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def make_opener(follow=False):
    jar = http.cookiejar.CookieJar()
    handlers = [urllib.request.HTTPCookieProcessor(jar)]
    if not follow:
        handlers.append(NoRedirect())
    return urllib.request.build_opener(*handlers), jar


def call(opener, method, path, body=None, headers=None, follow=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if body is not None:
        req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        resp = opener.open(req, timeout=90)
        return resp.getcode(), dict(resp.headers), resp.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "ignore")


def cookie_value(jar, name):
    for c in jar:
        if c.name == name:
            return c.value
    return ""


def main():
    # 1) 未登录访问 /admin
    op, jar = make_opener()
    code, headers, _ = call(op, "GET", "/admin")
    record("GET /admin 未登录 → 重定向登录", code in (302, 303, 307, 308), f"status={code} location={headers.get('Location')}")

    # 2) 登录页可访问
    op, jar = make_opener()
    code, headers, body = call(op, "GET", "/admin/login")
    record("GET /admin/login → 200", code == 200, f"status={code}")
    record("登录页含标题", "管理员登录" in body)
    record(
        "登录页 Cache-Control: no-store",
        "no-store" in (headers.get("Cache-Control") or ""),
        headers.get("Cache-Control", ""),
    )

    # 3) 未登录 API
    op, jar = make_opener()
    code, _, body = call(op, "GET", "/api/admin/session")
    record("GET /api/admin/session 未登录 → 401", code == 401, f"status={code} body={body[:80]}")
    record("未登录 API 不返回数据字段", "csrfToken" not in body)

    # 4) 错误密码
    op, jar = make_opener()
    code, _, body = call(op, "POST", "/api/admin/login", {"username": USERNAME, "password": "wrong-password-123"})
    record("错误密码 → 401", code == 401, f"status={code} body={body[:80]}")
    record("错误密码不泄露账号存在性", "invalid_credentials" in body)

    # 5) 正确密码 + Cookie
    op, jar = make_opener()
    code, headers, body = call(op, "POST", "/api/admin/login", {"username": USERNAME, "password": PASSWORD})
    record("正确密码 → 200", code == 200, f"status={code} body={body[:120]}")
    sid = cookie_value(jar, "jba_sid")
    csrf = cookie_value(jar, "jba_csrf")
    record("下发会话 Cookie(jba_sid)", bool(sid), f"len={len(sid)}")
    record("下发 CSRF Cookie(jba_csrf)", bool(csrf), f"len={len(csrf)}")
    set_cookie = headers.get("Set-Cookie", "")
    record("会话 Cookie 带 HttpOnly", "HttpOnly" in set_cookie, set_cookie[:120])

    # 6) 会话信息
    code, _, body = call(op, "GET", "/api/admin/session")
    ok = code == 200 and USERNAME in body
    record("已登录 GET /api/admin/session → 200", ok, f"status={code}")
    payload = json.loads(body) if body.strip().startswith("{") else {}
    record("返回 csrfToken", bool(payload.get("csrfToken")))

    # 7) 后台页面
    code, headers, body = call(op, "GET", "/admin/dashboard")
    record("已登录 GET /admin/dashboard → 200", code == 200, f"status={code}")
    record("Dashboard 渲染成功", "数据总览" in body)
    record("Dashboard 不含博客顶栏(主题外壳)", "Theme Switch" not in body)

    # 8) /admin/unknown 兜底 404
    code, _, body = call(op, "GET", "/admin/not-a-real-page")
    record("/admin/unknown → 404（不落入 [prefix] 动态路由）", code == 404, f"status={code}")

    # 9) CSRF：缺 header 的写操作被拒
    code, _, body = call(op, "POST", "/api/admin/logout", {})
    record("登出缺 CSRF → 403", code == 403, f"status={code} body={body[:60]}")

    # 10) 伪造 Cookie
    op2, _ = make_opener()
    code, _, _ = call(op2, "GET", "/admin/dashboard", headers={"Cookie": "jba_sid=forged.deadbeef"})
    record("伪造会话 Cookie → 拒绝", code in (302, 307, 401, 403), f"status={code}")

    # 11) 正常登出
    code, _, body = call(op, "POST", "/api/admin/logout", {}, headers={"x-csrf-token": csrf})
    record("带 CSRF 登出 → 200", code == 200, f"status={code} body={body[:60]}")
    code, _, _ = call(op, "GET", "/admin/dashboard")
    record("登出后访问后台 → 重定向", code in (302, 303, 307, 308), f"status={code}")

    # 12) 限流：连续错误密码
    op3, _ = make_opener()
    codes = []
    for i in range(7):
        code, _, _ = call(op3, "POST", "/api/admin/login", {"username": USERNAME, "password": "nope-%d-wrong" % i})
        codes.append(code)
    record("连续失败触发 429", 429 in codes, f"codes={codes}")

    # 13) 未登录访问 /admin/notify-status
    op4, _ = make_opener()
    code, headers, _ = call(op4, "GET", "/admin/notify-status")
    record("/admin/notify-status 未登录 → 不再公开 200", code != 200, f"status={code} location={headers.get('Location')}")

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _, detail in failed:
            print(" - FAILED:", name, detail)
        sys.exit(1)


if __name__ == "__main__":
    main()
