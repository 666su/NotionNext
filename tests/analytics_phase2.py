#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 2 冒烟：/api/track 采集、去重、维度、聚合对账。"""

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
        raw = r.read().decode("utf-8", "ignore")
        return r.getcode(), raw
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore")


def cookie(jar, name):
    for c in jar:
        if c.name == name:
            return c.value
    return ""


def ev(name, **kw):
    e = {
        "event_id": kw.pop("event_id"),
        "event_name": name,
        "anonymous_id": kw.pop("anonymous_id", "anon-aaaaaaaaaaaa"),
        "session_id": kw.pop("session_id", "sess-aaaaaaaaaaaa"),
        "page_path": kw.pop("page_path", "/article/cloudflare01"),
        "occurred_at": kw.pop("occurred_at", time.strftime("%Y-%m-%dT%H:%M:%S+08:00")),
        "props": kw.pop("props", {}),
    }
    e.update(kw)
    return e


def main():
    op, jar = opener()
    code, _ = call(op, "POST", "/api/admin/login", {"username": USER, "password": PASSWORD})
    record("管理员登录", code == 200, f"status={code}")

    # 1) 三条 page_view：2 个访客、1 个会话
    batch = {
        "events": [
            ev("page_view", event_id="evt-aaaa0001", anonymous_id="anon-111111111111"),
            ev("page_view", event_id="evt-aaaa0002", anonymous_id="anon-111111111111",
               page_path="/article/cloudflare01"),
            ev("page_view", event_id="evt-aaaa0003", anonymous_id="anon-222222222222",
               page_path="/category/tech"),
        ],
        "referrer_host": "www.google.com",
    }
    code, body = call(op, "POST", "/api/track", batch, {"Origin": BASE})
    record("批量 page_view → 204", code == 204, f"status={code} body={body[:60]}")

    time.sleep(0.4)
    code, body = call(op, "GET", "/api/admin/stats/summary?range=today")
    data = json.loads(body) if code == 200 else {}
    summary = data.get("summary", {})
    record("汇总接口可读", code == 200, f"status={code}")
    record("PV = 3", summary.get("pv") == 3, f"pv={summary.get('pv')}")
    record("UV = 2（按匿名 ID 去重）", summary.get("uv") == 2, f"uv={summary.get('uv')}")
    record("Session = 1", summary.get("sessions") == 1, f"sessions={summary.get('sessions')}")

    dims = summary.get("dims", {})
    record("设备维度已归类", bool(dims.get("device")), json.dumps(dims.get("device", {}))[:80])
    record("来源维度含 search", dims.get("source", {}).get("search", 0) >= 1, json.dumps(dims.get("source", {}))[:80])
    record(
        "路径排行含文章路径",
        any(item.get("path") == "/article/cloudflare01" for item in data.get("topPaths", [])),
        str(data.get("topPaths", []))[:120],
    )
    record("事件计数 page_view=3", str(data.get("eventCounts", {}).get("page_view")) == "3",
           str(data.get("eventCounts", {})))

    # 2) 重复 event_id 不再计数
    dup = {"events": [ev("page_view", event_id="evt-aaaa0001", anonymous_id="anon-111111111111")]}
    code, _ = call(op, "POST", "/api/track", dup, {"Origin": BASE})
    record("重复事件 → 204", code == 204, f"status={code}")
    code, body = call(op, "GET", "/api/admin/stats/summary?range=today")
    record("重复事件未增加 PV", json.loads(body)["summary"]["pv"] == 3,
           f"pv={json.loads(body)['summary']['pv']}")

    # 3) 非法事件被丢弃
    bad = {"events": [ev("not_an_event", event_id="evt-bbbb0001")]}
    code, _ = call(op, "POST", "/api/track", bad, {"Origin": BASE})
    record("非法事件名 → 204（不报错）", code == 204, f"status={code}")
    code, body = call(op, "GET", "/api/admin/stats/summary?range=today")
    record("非法事件未写入", json.loads(body)["summary"]["pv"] == 3,
           f"pv={json.loads(body)['summary']['pv']}")

    # 4) 阅读深度 + 搜索
    extra = {
        "events": [
            ev("scroll_depth", event_id="evt-cccc0001", props={"depth": 50}),
            ev("search", event_id="evt-cccc0002", props={"query": "cloudflare 教程"}),
            ev("search", event_id="evt-cccc0003", props={"query": "test@example.com"}),
        ],
        "referrer_host": "",
    }
    code, _ = call(op, "POST", "/api/track", extra, {"Origin": BASE})
    record("深度/搜索事件 → 204", code == 204, f"status={code}")
    time.sleep(0.3)
    code, body = call(op, "GET", "/api/admin/stats/summary?range=today")
    counts = json.loads(body).get("eventCounts", {})
    record("scroll_depth 已计数", str(counts.get("scroll_depth")) == "1", str(counts))
    record("search 已计数", str(counts.get("search")) == "2", str(counts))

    # 5) 跨站 Origin 不写入
    cross = {"events": [ev("page_view", event_id="evt-dddd0001", anonymous_id="anon-333333333333")]}
    code, _ = call(op, "POST", "/api/track", cross, {"Origin": "https://evil.example.com"})
    record("跨站 Origin → 204 但不写入", code == 204, f"status={code}")
    code, body = call(op, "GET", "/api/admin/stats/summary?range=today")
    record("跨站数据未计入", json.loads(body)["summary"]["pv"] == 3,
           f"pv={json.loads(body)['summary']['pv']}")

    # 6) 未登录读汇总 → 401
    op2, _ = opener()
    code, _ = call(op2, "GET", "/api/admin/stats/summary?range=today")
    record("未登录汇总 → 401", code == 401, f"status={code}")

    # 7) 时间窗正确
    code, body = call(op, "GET", "/api/admin/stats/summary?range=yesterday")
    record("昨日窗口可读（PV=0）", code == 200 and json.loads(body)["summary"]["pv"] == 0,
           f"status={code}")

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
