#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""既有高危接口修复验证（F-01/03/04/05/06）。仅本地 dev server，不触达生产。"""

import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3111"
results = []


def record(name, ok, detail=""):
    results.append((name, ok))
    print(("PASS " if ok else "FAIL ") + name + ("  | " + detail if detail else ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect()), jar


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
        r = op.open(req, timeout=60)
        return r.getcode(), r.read().decode("utf-8", "ignore"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore"), dict(e.headers)


def main():
    op, _ = opener()

    # F-04 /api/cache fail-open → 现在必须 503
    code, body, _ = call(op, "POST", "/api/cache", {})
    record("F-04 /api/cache 未配置 token → 503", code == 503, f"status={code} body={body[:80]}")

    # F-06 /api/push/status 最小化
    code, body, _ = call(op, "GET", "/api/push/status")
    payload = json.loads(body) if body.strip().startswith("{") else {}
    record("F-06 /api/push/status 公开仅返回 ok", code == 200 and payload == {"ok": True},
           f"status={code} body={body[:100]}")
    record("F-06 不再暴露 redisConfigured/subscriptions",
           not any(k in body for k in ("redisConfigured", "redisError", "subscriptions", "vapidKeys")))

    # F-05 /api/push/subscriptions：格式校验 + 限流
    code, body, _ = call(op, "GET", "/api/push/subscriptions")
    record("F-05 缺 subscriberId → 400", code == 400, f"status={code}")
    code, body, _ = call(op, "GET", "/api/push/subscriptions?subscriberId=../../etc/passwd")
    record("F-05 非法 subscriberId → 400", code == 400, f"status={code} body={body[:60]}")
    code, body, _ = call(
        op, "GET",
        "/api/push/subscriptions?subscriberId=123e4567-e89b-12d3-a456-426614174000",
    )
    record("F-05 合法 UUID → 200（返回空列表）", code == 200, f"status={code} body={body[:60]}")

    # F-03 /api/push/test：跨站 Origin 被拒 + SSRF 目标被拒
    code, body, _ = call(
        op, "POST", "/api/push/test",
        {"channel": "telegram", "config": {"token": "x", "chatId": "1"}},
        {"Origin": "https://evil.example.com"},
    )
    record("F-03 跨站 Origin → 403", code == 403, f"status={code} body={body[:60]}")

    code, body, _ = call(
        op, "POST", "/api/push/test",
        {
            "channel": "webpush",
            "config": {
                "endpoint": "http://169.254.169.254/latest/meta-data/",
                "keys": {"p256dh": "x", "auth": "y"},
            },
        },
        {"Origin": BASE},
    )
    record("F-03 非白名单 endpoint（SSRF）→ 400", code == 400, f"status={code} body={body[:80]}")

    code, body, _ = call(
        op, "POST", "/api/push/test",
        {"channel": "unknown", "config": {}},
        {"Origin": BASE},
    )
    record("F-03 非法渠道 → 400", code == 400, f"status={code}")

    # F-01 rank/seed：无密钥必须 403
    code, body, _ = call(op, "POST", "/api/rank/seed", {"action": "reset", "reset": "views"})
    record("F-01 /api/rank/seed 无密钥 → 403", code == 403, f"status={code} body={body[:60]}")

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
