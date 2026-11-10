#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 1 附加冒烟：改密 / 会话失效 / 审计日志 / 公开页面回归。"""

import os
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3111"
USER = "admin"
OLD = os.environ.get("JBA_TEST_PASSWORD", "")
NEW = "JasonBlog-2026-Rotated"

if not PASSWORD:
    print("缺少 JBA_TEST_PASSWORD：请先 export JBA_TEST_PASSWORD=<本地 dev server 的测试口令>")
    sys.exit(2)

results = []


def record(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + ("  | " + detail if detail else ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def opener(follow=False):
    jar = http.cookiejar.CookieJar()
    handlers = [urllib.request.HTTPCookieProcessor(jar)]
    if not follow:
        handlers.append(NoRedirect())
    return urllib.request.build_opener(*handlers), jar


def call(op, method, path, body=None, headers=None):
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
        r = op.open(req, timeout=120)
        return r.getcode(), dict(r.headers), r.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read().decode("utf-8", "ignore")


def cookie(jar, name):
    for c in jar:
        if c.name == name:
            return c.value
    return ""


def login(password):
    op, jar = opener()
    code, _, body = call(op, "POST", "/api/admin/login", {"username": USER, "password": password})
    return code, op, jar, body


def main():
    # 登录
    code, op, jar, body = login(OLD)
    record("旧密码可登录", code == 200, f"status={code}")
    csrf = cookie(jar, "jba_csrf")

    # 审计日志
    code, _, body = call(op, "GET", "/api/admin/audit?limit=10")
    record("审计日志可读", code == 200 and "login.success" in body, f"status={code}")
    record("审计不含明文 IP", "ipHash" in body and "127.0.0.1" not in body)

    # 改密：无 CSRF 应被拒
    code, _, _ = call(op, "POST", "/api/admin/password", {"currentPassword": OLD, "newPassword": NEW})
    record("改密缺 CSRF → 403", code == 403, f"status={code}")

    # 改密：当前密码错
    code, _, body = call(op, "POST", "/api/admin/password",
                         {"currentPassword": "wrong", "newPassword": NEW},
                         {"x-csrf-token": csrf})
    record("改密当前密码错误 → 400", code == 400, f"status={code} body={body[:60]}")

    # 改密：弱密码
    code, _, body = call(op, "POST", "/api/admin/password",
                         {"currentPassword": OLD, "newPassword": "short"},
                         {"x-csrf-token": csrf})
    record("弱密码 → 400", code == 400, f"status={code} body={body[:80]}")

    # 改密：成功
    code, _, body = call(op, "POST", "/api/admin/password",
                         {"currentPassword": OLD, "newPassword": NEW},
                         {"x-csrf-token": csrf})
    record("改密成功 → 200", code == 200, f"status={code} body={body[:60]}")

    # 旧会话立即失效
    code, _, _ = call(op, "GET", "/api/admin/session")
    record("改密后旧会话失效（401/307）", code in (401, 307, 302), f"status={code}")

    # 旧密码不能登录
    code, _op_old, _jar_old, _ = login(OLD)
    record("旧密码已失效 → 401", code == 401, f"status={code}")

    # 新密码可登录
    code, op2, jar2, _ = login(NEW)
    record("新密码可登录 → 200", code == 200, f"status={code}")

    # 公开页面回归
    op3, _ = opener(follow=True)
    try:
        code, headers, body = call(op3, "GET", "/")
        record("首页仍可访问（200）", code == 200, f"status={code} len={len(body)}")
        record("首页仍渲染博客主题", "Jason" in body or "<title" in body)
    except Exception as e:
        record("首页仍可访问（200）", False, str(e)[:120])

    # 登录页不受影响
    code, _, body = call(op3, "GET", "/admin/login")
    record("登录页 200", code == 200, f"status={code}")

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
