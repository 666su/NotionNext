#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 5 冒烟：站点健康探针、失效链接检查、本地 SEO 自查与 GSC/AI 的"未连接"边界。

前置：本地 dev server 在 127.0.0.1:3111，环境变量见 docs/admin/DEPLOYMENT_GUIDE.md §6。
测试口令通过环境变量 JBA_TEST_PASSWORD 提供（不要写进仓库）。
"""

import os
import http.cookiejar
import json
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3111"
USER = "admin"
PASSWORD = os.environ.get("JBA_TEST_PASSWORD", "")

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


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect()), jar


def call(op, method, path, body=None, headers=None, timeout=240):
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
        return r.getcode(), r.read().decode("utf-8", "ignore")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")


def cookie(jar, name):
    for c in jar:
        if c.name == name:
            return c.value
    return ""


def main():
    anon, _ = opener()
    for path in ("/api/admin/health/site", "/api/admin/health/links?limit=5", "/api/admin/seo"):
        code, _ = call(anon, "GET", path)
        record(f"未登录 {path.split('?')[0]} → 401", code == 401, f"status={code}")
    code, _ = call(anon, "GET", "/admin/health")
    record("未登录 /admin/health → 307", code in (307, 308), f"status={code}")

    op, jar = opener()
    code, body = call(op, "POST", "/api/admin/login", {"username": USER, "password": PASSWORD})
    if code != 200:
        print("登录失败:", code, body)
        sys.exit(2)
    csrf = cookie(jar, "jba_csrf")

    # 先同步一次，让 SEO 自查有快照可用（只读）
    code, body = call(op, "POST", "/api/admin/sync/notion", {}, {"x-csrf-token": csrf})
    record("同步快照（供 SEO 自查）", code in (200, 429, 502), f"status={code}")

    # 1) 站点健康
    code, body = call(op, "GET", "/api/admin/health/site")
    health = json.loads(body) if code == 200 else {}
    record("health/site → 200", code == 200 and health.get("ok") is True, f"status={code}")
    record(
        "health 字段完整",
        all(k in health for k in ("probes", "store", "admin", "stats", "notion", "twikoo", "deployment")),
        str(sorted(health.keys())),
    )
    probes = health.get("probes") or []
    record("至少两个同源探针", len(probes) >= 2, f"probes={len(probes)}")
    record(
        "探针字段完整且有真实状态码",
        all({"url", "status", "ok", "ms"} <= set(p.keys()) for p in probes)
        and all(isinstance(p.get("status"), int) and p["status"] > 0 for p in probes),
        json.dumps(probes, ensure_ascii=False)[:180],
    )
    record("存储可达为布尔", isinstance(health.get("store", {}).get("reachable"), bool),
           str(health.get("store")))
    record("没有泄露密钥字段", not any("secret" in k.lower() or "password" in k.lower() for k in health.keys()),
           str(sorted(health.keys())))

    # 开发模式下路由首次编译会重置模块状态，允许重试几次再判定缓存
    health_cached = False
    health_detail = ""
    for _ in range(3):
        code, body = call(op, "GET", "/api/admin/health/site")
        again = json.loads(body) if code == 200 else {}
        health_detail = f"cached={again.get('cached')}"
        if again.get("cached") is True:
            health_cached = True
            break
    record("3 分钟内命中缓存", health_cached, health_detail)

    # 2) 失效链接检查
    code, body = call(op, "GET", "/api/admin/health/links?limit=5")
    links = json.loads(body) if code == 200 else {}
    record("health/links → 200", code == 200 and links.get("ok") is True, f"status={code}")
    rows = links.get("rows") or []
    record("limit 生效（≤5 条）", 0 < len(rows) <= 5, f"rows={len(rows)} targets={links.get('targets')}")
    record(
        "链接行字段完整",
        all({"path", "status", "ok"} <= set(r.keys()) for r in rows) and all(str(r["path"]).startswith("/") for r in rows),
        json.dumps(rows[:2], ensure_ascii=False),
    )
    record("汇总字段完整", all(k in (links.get("summary") or {}) for k in ("ok", "broken", "errors", "redirects")),
           str(links.get("summary")))
    record("只探测同源路径（无外部域名）",
           all(not str(r["path"]).startswith("http") for r in rows), "ok")
    # 开发模式下路由首次编译会重置模块状态，因此允许重试几次再判定缓存
    cache_hit = False
    detail = ""
    for _ in range(3):
        code, body = call(op, "GET", "/api/admin/health/links?limit=5")
        again_links = json.loads(body) if code == 200 else {}
        detail = f"cached={again_links.get('cached')}"
        if again_links.get("cached") is True:
            cache_hit = True
            break
    record("链接检查 10 分钟内命中缓存", cache_hit, detail)

    # 3) SEO 自查 + GSC 未连接
    code, body = call(op, "GET", "/api/admin/seo")
    seo = json.loads(body) if code == 200 else {}
    record("seo → 200", code == 200 and seo.get("ok") is True, f"status={code}")
    gsc = seo.get("gsc") or {}
    record("GSC 明确未连接", gsc.get("connected") is False, f"connected={gsc.get('connected')} reason={gsc.get('reason')}")
    record("GSC 给出所需环境变量", len(gsc.get("requiredEnv") or []) == 3, str(gsc.get("requiredEnv")))
    lowered = json.dumps(seo, ensure_ascii=False).lower()
    record("不含任何伪造搜索指标",
           not any(word in lowered for word in ('"impressions"', '"clicks"', '"ctr"', '"position"')),
           "ok")
    audit = seo.get("audit") or {}
    summary = audit.get("summary") or {}
    record("audit 结构完整", all(k in summary for k in ("total", "withIssues", "missingDescription", "missingSlug")),
           str(sorted(summary.keys())))
    record("audit 行数等于文章总数", len(audit.get("rows") or []) == summary.get("total"),
           f"rows={len(audit.get('rows') or [])} total={summary.get('total')}")
    record("逐篇建议为数组", all(isinstance(r.get("issues"), list) for r in (audit.get("rows") or [])[:5]),
           "ok")
    files = (seo.get("files") or {}).get("rows") or []
    record("robots/sitemap 已探测",
           {f.get("path") for f in files} >= {"/robots.txt", "/sitemap.xml"},
           json.dumps(files, ensure_ascii=False))
    record("AI 预留未启用", (seo.get("ai") or {}).get("enabled") is False,
           json.dumps(seo.get("ai") or {}, ensure_ascii=False))

    # 4) 页面 SSR
    for path, title in (("/admin/health", "网站健康"), ("/admin/seo", "SEO 分析")):
        code, body = call(op, "GET", path)
        record(f"{path} → 200 且含「{title}」", code == 200 and title in body, f"status={code}")

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
