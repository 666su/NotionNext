#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 6 冒烟：robots 规则、定时同步、AI 浏览总结、Telegram 推送。

前置：
  1) `python tests/stub_services.py`（AI 8991 / TG 8992 桩）
  2) 本地 dev server 在 127.0.0.1:3111，环境变量见 docs/admin/DEPLOYMENT_GUIDE.md §6
测试口令通过环境变量 JBA_TEST_PASSWORD 提供（不要写进仓库）。
"""

import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3111"
USER = "admin"
PASSWORD = os.environ.get("JBA_TEST_PASSWORD", "")
CRON_SECRET = "cron-secret-phase6-test-0123456789"

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AI_STUB = os.path.join(BASE_DIR, ".dsh-ops", "stub-ai.json")
TG_STUB = os.path.join(BASE_DIR, ".dsh-ops", "stub-tg.json")

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
        return r.getcode(), r.read().decode("utf-8", "ignore"), dict(r.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "ignore"), dict(e.headers)


def cookie(jar, name):
    for c in jar:
        if c.name == name:
            return c.value
    return ""


def read_stub(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return None


def today_key():
    return time.strftime("%Y%m%d")


def main():
    anon, _ = opener()

    # 1) robots.txt（由 /api/robots 动态生成）
    code, body, headers = call(anon, "GET", "/robots.txt")
    ctype = str(headers.get("Content-Type") or headers.get("content-type") or "")
    record("robots.txt → 200", code == 200, f"status={code}")
    record("robots.txt 是纯文本", "text/plain" in ctype, ctype)
    record("robots 禁止后台", "Disallow: /admin" in body, body.split("\n")[3] if body else "")
    record("robots 禁止接口", "Disallow: /api/" in body)
    record("robots 允许文章抓取（没误伤正文）", "Disallow: /article" not in body)
    record("robots 带 sitemap 绝对地址", "Sitemap: http" in body,
           " ".join([x for x in body.splitlines() if x.startswith("Sitemap")]))
    record("robots 带缓存头", "max-age" in str(headers.get("Cache-Control") or headers.get("cache-control") or ""))

    # 2) 定时接口鉴权
    code, _, _ = call(anon, "GET", "/api/cron/digest")
    record("cron/digest 无令牌 → 401", code == 401, f"status={code}")
    code, _, _ = call(anon, "GET", "/api/cron/digest", headers={"Authorization": "Bearer wrong"})
    record("cron/digest 错误令牌 → 401", code == 401, f"status={code}")
    code, _, _ = call(anon, "GET", "/api/cron/sync-notion", headers={"Authorization": "Bearer wrong"})
    record("cron/sync-notion 错误令牌 → 401", code == 401, f"status={code}")

    # 3) 定时同步（只读）
    code, body, _ = call(anon, "GET", "/api/cron/sync-notion", headers={"Authorization": f"Bearer {CRON_SECRET}"})
    sync = json.loads(body) if body.strip().startswith("{") else {}
    record("cron 同步可执行", code in (200, 429), f"status={code}")
    if code == 200:
        record("cron 同步返回计数", isinstance(sync.get("counts", {}).get("articles"), int),
               json.dumps(sync.get("counts", {}), ensure_ascii=False))

    # 4) 登录 + 造一点真实流量
    op, jar = opener()
    code, body, _ = call(op, "POST", "/api/admin/login", {"username": USER, "password": PASSWORD})
    if code != 200:
        print("登录失败:", code, body)
        sys.exit(2)
    csrf = cookie(jar, "jba_csrf")

    now = time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime())
    events = [
        {
            "event_id": "p6-evt-0001",
            "event_name": "page_view",
            "anonymous_id": "anon-p6-000001",
            "session_id": "sess-p6-000001",
            "page_path": "/article/dsh09",
            "occurred_at": now,
            "props": {},
        },
        {
            "event_id": "p6-evt-0002",
            "event_name": "page_view",
            "anonymous_id": "anon-p6-000002",
            "session_id": "sess-p6-000002",
            "page_path": "/",
            "occurred_at": now,
            "props": {},
        },
        {
            "event_id": "p6-evt-0003",
            "event_name": "search",
            "anonymous_id": "anon-p6-000001",
            "session_id": "sess-p6-000001",
            "page_path": "/",
            "occurred_at": now,
            "props": {"query": "dsh 插件"},
        },
    ]
    code, _, _ = call(op, "POST", "/api/track", {"events": events}, {"Origin": BASE})
    record("埋点写入 → 204", code == 204, f"status={code}")
    time.sleep(0.6)

    # 5) 后台预览（AI 总结）
    code, body, _ = call(op, "GET", f"/api/admin/digest?dayKey={today_key()}")
    preview = json.loads(body) if body.strip().startswith("{") else {}
    record("digest 预览 → 200", code == 200 and preview.get("ok") is True, f"status={code}")
    record("预览含 AI 总结", preview.get("ai", {}).get("ok") is True,
           json.dumps(preview.get("ai") or {}, ensure_ascii=False))
    record("预览文本含 PV 与日期", "PV" in (preview.get("text") or "") and today_key() in (preview.get("text") or ""),
           (preview.get("text") or "")[:80].replace("\n", " "))
    # 与其他阶段共用同一实例时，今日 PV 只增不减，因此断言"至少包含本次 2 次"
    record("预览事实包含本次埋点", (preview.get("facts", {}).get("pv") or 0) >= 2,
           f"pv={preview.get('facts', {}).get('pv')}")

    # 6) 发给模型的内容不含隐私标识
    ai_stub = read_stub(AI_STUB)
    prompt = ""
    if ai_stub:
        for message in ai_stub.get("body", {}).get("messages", []):
            prompt += str(message.get("content") or "")
    record("AI 桩收到请求", bool(ai_stub), "ok" if ai_stub else "missing")
    record("提示词不含访客/会话标识", ("anon-" not in prompt) and ("sess-" not in prompt),
           prompt[:60].replace("\n", " "))
    record("提示词不含明文 IP", "127.0.0.1" not in prompt)

    # 7) 手动推送：缺 CSRF 必须拒绝
    code, _, _ = call(op, "POST", "/api/admin/digest", {"dayKey": today_key(), "send": True})
    record("推送缺 CSRF → 403", code == 403, f"status={code}")

    # 8) 手动推送（走 TG 桩）
    code, body, _ = call(
        op,
        "POST",
        "/api/admin/digest",
        {"dayKey": today_key(), "send": True},
        {"x-csrf-token": csrf},
    )
    sent = json.loads(body) if body.strip().startswith("{") else {}
    record("手动推送 → 200", code == 200 and sent.get("ok") is True, f"status={code}")
    record("Telegram 送达（桩）", sent.get("delivery", {}).get("ok") is True,
           json.dumps(sent.get("delivery") or {}, ensure_ascii=False))
    record("返回消息 ID", sent.get("delivery", {}).get("messageId") == 12345,
           str(sent.get("delivery", {}).get("messageId")))

    tg_stub = read_stub(TG_STUB)
    tg_body = (tg_stub or {}).get("body", {})
    record("TG 桩收到消息", bool(tg_stub), "ok" if tg_stub else "missing")
    record("TG chat_id 正确", str(tg_body.get("chat_id")) == "987654321", str(tg_body.get("chat_id")))
    record("TG 使用 HTML 解析模式", tg_body.get("parse_mode") == "HTML", str(tg_body.get("parse_mode")))
    record("TG 文本含日报标题", "站点日报" in str(tg_body.get("text") or ""),
           str(tg_body.get("text") or "")[:60].replace("\n", " "))
    record("TG 文本含 AI 段落", "AI 浏览总结" in str(tg_body.get("text") or ""))

    # 9) 定时推送 + 冷却
    code, body, _ = call(anon, "GET", "/api/cron/digest", headers={"Authorization": f"Bearer {CRON_SECRET}"})
    cron = json.loads(body) if body.strip().startswith("{") else {}
    record("cron/digest → 200", code == 200 and cron.get("ok") is True, f"status={code}")
    record("cron 推送成功", cron.get("delivery", {}).get("ok") is True,
           json.dumps(cron.get("delivery") or {}, ensure_ascii=False))
    code, body, _ = call(anon, "GET", "/api/cron/digest", headers={"Authorization": f"Bearer {CRON_SECRET}"})
    record("cron 重复触发 → 429", code == 429, f"status={code}")

    # 10) 发送日志
    code, body, _ = call(op, "GET", "/api/admin/digest?log=1")
    log = json.loads(body) if body.strip().startswith("{") else {}
    rows = log.get("log") or []
    record("日志可读", code == 200 and len(rows) >= 1, f"rows={len(rows)}")
    record("日志记录 AI 与送达状态",
           bool(rows) and rows[0].get("sent") is True and rows[0].get("ai") is True,
           json.dumps(rows[0], ensure_ascii=False) if rows else "")
    record("配置状态不含密钥", "token" not in json.dumps(log.get("config") or {}).lower(),
           json.dumps(log.get("config") or {}, ensure_ascii=False))

    # 11) AI 浏览总结接口
    code, body, _ = call(op, "GET", "/api/admin/ai/summary?range=today")
    ai_sum = json.loads(body) if body.strip().startswith("{") else {}
    record("ai/summary → 200", code == 200 and ai_sum.get("ok") is True, f"status={code}")
    record("ai/summary 有总结文本", ai_sum.get("ai", {}).get("ok") is True)
    record("ai/summary 附带事实", (ai_sum.get("facts", {}).get("pv") or 0) >= 2,
           f"pv={ai_sum.get('facts', {}).get('pv')}")
    code, _, _ = call(anon, "GET", "/api/admin/ai/summary?range=today")
    record("ai/summary 未登录 → 401", code == 401, f"status={code}")

    # 11.5) Telegram 连通性自检（getMe）与测试消息
    code, body, _ = call(anon, "GET", "/api/admin/notify/telegram?check=1")
    record("自检接口未登录 → 401", code == 401, f"status={code}")

    code, body, _ = call(op, "GET", "/api/admin/notify/telegram?check=1")
    check = json.loads(body) if body.strip().startswith("{") else {}
    record("getMe 自检 → 200", code == 200 and check.get("ok") is True, f"status={code}")
    record("自检返回机器人用户名", (check.get("bot") or {}).get("ok") is True,
           json.dumps(check.get("bot") or {}, ensure_ascii=False))
    record("自检暴露请求域名（便于发现本地桩残留）",
           bool((check.get("config") or {}).get("baseHost")),
           str((check.get("config") or {}).get("baseHost")))
    record("自检不返回 token",
           "stub-bot-token" not in body and "424242:" not in body,
           "ok")

    code, _, _ = call(op, "POST", "/api/admin/notify/telegram", {"text": "hi"})
    record("测试消息缺 CSRF → 403", code == 403, f"status={code}")
    code, body, _ = call(op, "POST", "/api/admin/notify/telegram", {"text": "hi"},
                         {"x-csrf-token": csrf})
    test_msg = json.loads(body) if body.strip().startswith("{") else {}
    record("测试消息 → 200 且送达", code == 200 and test_msg.get("ok") is True,
           json.dumps(test_msg.get("delivery") or {}, ensure_ascii=False))

    # 12) 页面
    code, _, _ = call(anon, "GET", "/admin/digest")
    record("未登录 /admin/digest → 307", code in (307, 308), f"status={code}")
    code, body, _ = call(op, "GET", "/admin/digest")
    record("/admin/digest → 200 且含「每日总结」", code == 200 and "每日总结" in body, f"status={code}")
    code, body, _ = call(op, "GET", "/admin/dashboard")
    record("仪表盘含 AI 浏览总结入口", code == 200 and "AI 浏览总结" in body, f"status={code}")

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
