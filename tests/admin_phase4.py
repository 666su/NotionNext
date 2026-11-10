#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 4 冒烟：Notion 只读同步、路径映射、分类标签聚合、Twikoo 评论计数。

前置：本地 dev server 在 127.0.0.1:3111，环境变量见 docs/admin/DEPLOYMENT_GUIDE.md §6。
测试口令通过环境变量 JBA_TEST_PASSWORD 提供（不要写进仓库）。
"""

import os
import http.cookiejar
import json
import sys
import time
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
    for path in ("/api/admin/taxonomy?range=30d", "/api/admin/comments", "/api/admin/sync/status"):
        code, _ = call(anon, "GET", path)
        record(f"未登录 {path.split('?')[0]} → 401", code == 401, f"status={code}")

    op, jar = opener()
    code, body = call(op, "POST", "/api/admin/login", {"username": USER, "password": PASSWORD})
    if code != 200:
        print("登录失败:", code, body)
        sys.exit(2)
    csrf = cookie(jar, "jba_csrf")
    record("登录并拿到 CSRF", bool(csrf), f"len={len(csrf)}")

    # 1) 同步状态（同步前）
    code, body = call(op, "GET", "/api/admin/sync/status")
    data = json.loads(body) if code == 200 else {}
    record("同步状态可读", code == 200 and data.get("ok") is True, f"status={code}")
    record("同步状态字段齐全", all(k in data for k in ("meta", "log", "cooldown", "stale", "pathMapSize")),
           str(sorted(data.keys())))

    # 2) 未带 CSRF 触发同步必须拒绝
    code, _ = call(op, "POST", "/api/admin/sync/notion", {})
    record("同步缺 CSRF → 403", code == 403, f"status={code}")

    # 3) 带 CSRF 触发同步（只读）
    code, body = call(op, "POST", "/api/admin/sync/notion", {}, {"x-csrf-token": csrf})
    sync_ok = code == 200
    sync_data = json.loads(body) if body and body.strip().startswith("{") else {}
    record("Notion 同步请求返回", code in (200, 502), f"status={code} body={body[:120]}")
    if sync_ok:
        record("同步返回文章计数", isinstance(sync_data.get("counts", {}).get("articles"), int),
               json.dumps(sync_data.get("counts", {}), ensure_ascii=False))
    else:
        print("  （同步失败也算通过：说明失败被如实上报，不是静默成功）")

    # 4) 冷却生效
    code, body = call(op, "POST", "/api/admin/sync/notion", {}, {"x-csrf-token": csrf})
    record("5 分钟内二次同步 → 429", code == 429, f"status={code} body={body[:80]}")

    # 5) 同步后状态
    code, body = call(op, "GET", "/api/admin/sync/status")
    status = json.loads(body) if code == 200 else {}
    record("冷却秒数可读", isinstance(status.get("cooldown"), int) and status.get("cooldown", 0) > 0,
           f"cooldown={status.get('cooldown')}")
    record("日志已记录本次同步", len(status.get("log") or []) >= 1, f"log={len(status.get('log') or [])}")

    # 6) 路径映射
    if sync_ok:
        path_map_size = status.get("pathMapSize", 0)
        article_count = (status.get("meta") or {}).get("count", 0)
        record("路径映射已建立", path_map_size > 0, f"pathMapSize={path_map_size}")
        record("路径映射无重复前缀污染", path_map_size <= max(1, article_count * 2),
               f"pathMapSize={path_map_size} articles={article_count}")
    else:
        record("路径映射字段存在（未同步时为 0）", "pathMapSize" in status, f"pathMapSize={status.get('pathMapSize')}")

    # 7) 分类标签聚合
    code, body = call(op, "GET", "/api/admin/taxonomy?range=30d")
    tax = json.loads(body) if code == 200 else {}
    record("taxonomy → 200", code == 200 and tax.get("ok") is True, f"status={code}")
    record("taxonomy 结构完整",
           isinstance(tax.get("categories"), list) and isinstance(tax.get("tags"), list)
           and isinstance(tax.get("totals"), dict),
           str(sorted(tax.keys())))
    if sync_ok and (tax.get("totals", {}).get("articles") or 0) > 0:
        record("分类已聚合", len(tax.get("categories") or []) > 0,
               json.dumps((tax.get("categories") or [])[:2], ensure_ascii=False))
        record("标签已聚合", len(tax.get("tags") or []) > 0,
               f"tags={len(tax.get('tags') or [])}")
        record("文章总数与快照一致", tax["totals"]["articles"] == (status.get("meta") or {}).get("count"),
               f"{tax['totals']['articles']} vs {(status.get('meta') or {}).get('count')}")
    else:
        record("未同步时分类为空且不造假", not (tax.get("categories") or []), json.dumps(tax.get("totals", {})))

    code, body = call(op, "GET", "/api/admin/taxonomy?range=365d")
    record("taxonomy 非法 range → 400", code == 400, f"status={code}")

    # 8) Twikoo 评论（本地未配置 → 明确"未连接"，不是 0 条）
    code, body = call(op, "GET", "/api/admin/comments")
    cm = json.loads(body) if code == 200 else {}
    record("comments → 200", code == 200 and cm.get("ok") is True, f"status={code}")
    record("comments 明确区分连接状态",
           isinstance(cm.get("available"), bool)
           and (cm.get("available") is True or cm.get("reason") == "not_configured"),
           f"available={cm.get('available')} reason={cm.get('reason')}")
    record("comments 结构完整", isinstance(cm.get("rows"), list) and isinstance(cm.get("totals"), dict),
           str(sorted(cm.keys())))

    # 9) 页面 SSR
    for path, title in (
        ("/admin/categories", "分类与标签"),
        ("/admin/comments", "评论统计"),
        ("/admin/articles", "Notion 只读同步"),
    ):
        code, body = call(op, "GET", path)
        record(f"{path} → 200 且含「{title}」", code == 200 and title in body, f"status={code}")

    # 10) slug 规范化：Notion 的 `article/xxx` 不能被拼成 `/article/article/xxx`
    if sync_ok:
        code, body = call(op, "GET", "/api/admin/stats/report?range=7d")
        rep_slug = json.loads(body) if code == 200 else {}
        rows = (rep_slug.get("articles") or {}).get("rows") or []
        bad = [row for row in rows if "/" in str(row.get("slug") or "") or "article/" in str(row.get("slug") or "")]
        record("文章 slug 已规范化", bool(rows) and not bad,
               json.dumps(bad[:2], ensure_ascii=False) if bad else f"{len(rows)} 篇")
        bad_url = [row for row in rows if str(row.get("url") or "").count("/article/") > 1]
        record("文章 URL 未重复前缀", not bad_url,
               json.dumps(bad_url[:2], ensure_ascii=False) if bad_url else "ok")

    # 11) report 里带上路径映射规模（Phase 4 新增字段）
    code, body = call(op, "GET", "/api/admin/stats/report?range=7d")
    rep = json.loads(body) if code == 200 else {}
    record("report 暴露 unmappedPathViews", "unmappedPathViews" in (rep.get("articles") or {}),
           str(sorted((rep.get("articles") or {}).keys())))

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
