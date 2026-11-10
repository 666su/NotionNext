#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 3 冒烟：后台五个数据页 + /api/admin/stats/report 聚合口径。

前置：本地 dev server（内存 KV）已启动在 127.0.0.1:3111，
环境变量见 docs/admin/DEPLOYMENT_GUIDE.md §6。
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

ARTICLE_ID = "aaaaaaaa-0000-4000-8000-000000000001"
ARTICLE_PATH = "/article/p3-smoke-post"

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


def call(op, method, path, body=None, headers=None, timeout=180):
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


def login(op):
    code, body = call(op, "POST", "/api/admin/login", {"username": USER, "password": PASSWORD})
    if code != 200:
        print("登录失败:", code, body)
        sys.exit(2)


def now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())


def ev(name, event_id, anon="anon-p3-000001", sess="sess-p3-000001", path="/", props=None, article=None):
    item = {
        "event_id": event_id,
        "event_name": name,
        "anonymous_id": anon,
        "session_id": sess,
        "page_path": path,
        "occurred_at": now_iso(),
        "props": props or {},
    }
    if article:
        item["article_id"] = article
    return item


def main():
    # 0) 未登录：接口与页面都必须拦住
    anon, _ = opener()
    code, _ = call(anon, "GET", "/api/admin/stats/report?range=today")
    record("未登录 report → 401", code == 401, f"status={code}")
    code, _ = call(anon, "GET", "/admin/analytics")
    record("未登录 /admin/analytics → 307", code in (307, 308), f"status={code}")

    op, jar = opener()
    login(op)

    # 1) 参数校验
    code, body = call(op, "GET", "/api/admin/stats/report?range=365d")
    record("非法 range → 400", code == 400, f"status={code} body={body[:80]}")

    # 2) 埋点：一批真实事件
    events = [
        ev("page_view", "p3-evt-0001"),
        ev("page_view", "p3-evt-0002", path=ARTICLE_PATH, article=ARTICLE_ID),
        ev("page_view", "p3-evt-0003", anon="anon-p3-000002", sess="sess-p3-000002", path=ARTICLE_PATH, article=ARTICLE_ID),
        ev("search", "p3-evt-0004", props={"query": "Smoke Test"}),
        ev("scroll_depth", "p3-evt-0005", path=ARTICLE_PATH, props={"depth": 25}, article=ARTICLE_ID),
        ev("article_complete", "p3-evt-0006", path=ARTICLE_PATH, article=ARTICLE_ID),
        ev("outbound_click", "p3-evt-0007", props={"target_host": "example.com"}),
        ev("share_click", "p3-evt-0008", props={"target_host": "x.com"}),
    ]
    code, _ = call(
        op,
        "POST",
        "/api/track",
        {"events": events, "referrer_host": "google.com"},
        {"Origin": BASE, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36"},
    )
    record("批量事件写入 → 204", code == 204, f"status={code}")
    time.sleep(1.2)

    # 3) report 核心口径
    code, body = call(op, "GET", "/api/admin/stats/report?range=today")
    ok = code == 200 and json.loads(body).get("ok") is True
    record("report?range=today → 200", ok, f"status={code}")
    data = json.loads(body) if ok else {}

    summary = data.get("summary", {})
    record("PV=3", summary.get("pv") == 3, f"pv={summary.get('pv')}")
    record("UV=2（HLL 去重）", summary.get("uv") == 2, f"uv={summary.get('uv')}")
    record("Session=2", summary.get("sessions") == 2, f"sessions={summary.get('sessions')}")

    dims = summary.get("dims", {})
    record("维度已归类（设备）", dims.get("device", {}).get("desktop") == 3, json.dumps(dims.get("device", {})))
    record("来源已归类（search）", dims.get("source", {}).get("search") == 3, json.dumps(dims.get("source", {})))

    by_day = summary.get("byDay", [])
    record("byDay 为单日窗口", len(by_day) == 1 and by_day[0].get("pv") == 3, json.dumps(by_day))

    hourly = data.get("hourly", {})
    hourly_sum = sum(row.get("pv", 0) for row in hourly.get("rows", []))
    record("逐小时 24 桶且合计=3", len(hourly.get("rows", [])) == 24 and hourly_sum == 3,
           f"day={hourly.get('day')} sum={hourly_sum}")

    pages = data.get("pages", {}).get("pv", [])
    top = pages[0] if pages else {}
    record("路径排行首位为文章页", top.get("path") == ARTICLE_PATH and top.get("views") == 2, json.dumps(top, ensure_ascii=False))

    depth = data.get("depth", {})
    record("深度 25% 档=1", depth.get("d25") == 1, json.dumps(depth))
    record("读完=1", depth.get("complete") == 1, json.dumps(depth))

    search = data.get("search", {})
    terms = [row.get("term") for row in search.get("terms", [])]
    record("搜索计数=1 且词已小写", search.get("total") == 1 and "smoke test" in terms,
           f"total={search.get('total')} terms={terms}")

    events_count = data.get("events", {})
    record("事件计数完整", events_count.get("page_view") == 3 and events_count.get("search") == 1,
           json.dumps(events_count))

    outbound = data.get("outboundShare", {})
    record("外链域名已记录", any(row.get("host") == "example.com" for row in outbound.get("outbound", [])),
           json.dumps(outbound.get("outbound", [])))
    record("分享渠道已记录", any(row.get("channel") == "x.com" for row in outbound.get("share", [])),
           json.dumps(outbound.get("share", [])))

    cards = data.get("cards", {})
    record("今日卡片 PV=3", cards.get("today", {}).get("pv") == 3, json.dumps(cards.get("today")))
    record("近 7 天 PV=3", cards.get("pv7") == 3, f"pv7={cards.get('pv7')}")

    record("采集起始时间已记录", bool(data.get("collectionStartedAt")), str(data.get("collectionStartedAt")))
    record("实时活跃为估算值", isinstance(data.get("realtime", {}).get("sessions"), int),
           str(data.get("realtime")))

    articles = data.get("articles", {})
    rows = articles.get("rows", [])
    hit = [row for row in rows if row.get("id") == ARTICLE_ID]
    record("文章维度已聚合", bool(hit) and hit[0].get("pv") == 2, json.dumps(hit[:1], ensure_ascii=False))
    record("文章 UV 可用", bool(hit) and hit[0].get("uv") == 2, json.dumps(hit[:1], ensure_ascii=False))
    record("文章完成率已计算", bool(hit) and hit[0].get("completeRate") == 100,
           json.dumps(hit[:1], ensure_ascii=False))

    # 4) 时间窗互不串数据
    code, body = call(op, "GET", "/api/admin/stats/report?range=yesterday")
    y = json.loads(body) if code == 200 else {}
    record("昨日 PV=0（不串数据）", y.get("summary", {}).get("pv") == 0, f"pv={y.get('summary', {}).get('pv')}")
    record("昨日无逐小时明细", y.get("hourly", {}).get("day") is not None and
           all(row.get("pv") == 0 for row in y.get("hourly", {}).get("rows", [])),
           json.dumps(y.get("hourly", {}))[:80])

    # 5) 五个页面必须服务端渲染且带真实标题
    pages_expected = [
        ("/admin/dashboard", "数据总览"),
        ("/admin/analytics", "流量分析"),
        ("/admin/visitors", "访客分析"),
        ("/admin/behavior", "行为分析"),
        ("/admin/articles", "文章管理"),
    ]
    for path, title in pages_expected:
        code, body = call(op, "GET", path)
        record(f"{path} → 200 且含「{title}」", code == 200 and title in body, f"status={code} len={len(body)}")

    # 6) 页面不允许出现模拟数字占位说明
    code, body = call(op, "GET", "/admin/analytics")
    record("不再有「尚未接入真实数据」占位", "尚未接入真实数据" not in body)

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
