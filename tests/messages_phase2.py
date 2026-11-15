#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 2 冒烟：私密会话页、路由优先级、隐私头部、与博客外壳的隔离。

只做 HTTP 层可验证的部分（浏览器交互部分由人工/截图验收）：
  - /message/<id> 必须是 200（不能被 [prefix]/[slug] 吞成 404）
  - 页面与接口都必须 no-store / noindex / no-referrer / nosniff / DENY
  - 私密页**不包含**博客主题外壳与桌宠（_app 的独立分支）
  - robots.txt 包含 Disallow: /message
"""

import http.cookiejar
import os
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3111"
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
        data=body.encode() if isinstance(body, str) and body is not None else None,
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


def hdr(headers, name):
    return " ".join(headers.get_all(name) or []) if hasattr(headers, "get_all") else (headers.get(name) or "")


def main():
    anon, _ = opener()
    fake_id = "abcdefghijklmnop"

    # ---------- 1. 路由优先级 ----------
    code, html, headers = call(anon, "GET", f"/message/{fake_id}")
    record("/message/<id> → 200（未被文章路由吞掉）", code == 200, f"status={code}")
    record("页面标题正确", "私信 · Jason Blog" in html, html[:80].replace("\n", " "))

    # ---------- 2. 隐私响应头 ----------
    record("Cache-Control 含 no-store", "no-store" in hdr(headers, "Cache-Control"), hdr(headers, "Cache-Control"))
    record("X-Robots-Tag 含 noindex", "noindex" in hdr(headers, "X-Robots-Tag"), hdr(headers, "X-Robots-Tag"))
    record("Referrer-Policy = no-referrer", hdr(headers, "Referrer-Policy") == "no-referrer", hdr(headers, "Referrer-Policy"))
    record("X-Content-Type-Options = nosniff", "nosniff" in hdr(headers, "X-Content-Type-Options"))
    record("X-Frame-Options = DENY", "DENY" in hdr(headers, "X-Frame-Options"), hdr(headers, "X-Frame-Options"))
    record("页面 meta 也有 noindex", 'name="robots"' in html and "noindex" in html)

    # ---------- 3. 与博客外壳隔离 ----------
    record("私密页不渲染桌宠（无 blog-pet 标记）", "blog-pet-pet" not in html)
    record("私密页不套主题布局（无 container-inner）", "container-inner" not in html)
    record("私密页没有博客导航（无“系列时间线”）", "系列时间线" not in html)

    # ---------- 4. robots ----------
    code, robots, _ = call(anon, "GET", "/robots.txt")
    record("robots.txt → 200", code == 200, f"status={code}")
    record("robots 封禁 /message", "Disallow: /message" in robots, "")
    record("robots 未误封文章", "Disallow: /article" not in robots)

    # ---------- 5. 接口头与鉴权回归 ----------
    code, body, headers = call(anon, "GET", f"/api/messages/conversations/{fake_id}")
    record("无 Cookie 读会话 → 403", code == 403, f"status={code}")
    record("接口 no-store", "no-store" in hdr(headers, "Cache-Control"), hdr(headers, "Cache-Control"))
    record("接口 noindex", "noindex" in hdr(headers, "X-Robots-Tag"))
    record("接口 CORS 已收紧（ACAO 为空）", hdr(headers, "Access-Control-Allow-Origin") == "",
           repr(hdr(headers, "Access-Control-Allow-Origin")))

    code, body, headers = call(anon, "POST", "/api/messages/conversations",
                               '{"visitor_name":"x","content":"y"}',
                               {"Origin": "https://evil.example.com"})
    record("跨站创建仍被挡（403）", code == 403, f"status={code}")

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
