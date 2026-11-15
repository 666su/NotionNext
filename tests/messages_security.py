#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 4 安全冒烟：越权 / 伪造与过期 Cookie / 重放 / XSS / 限流 / 枚举 / 访问审计。

前置：dev server 在 127.0.0.1:3111；JBA_TEST_PASSWORD 提供测试口令；
      本机 .dsh-ops/dev-env.sh 提供 MESSAGE_TOKEN_SECRET（仅用于伪造过期 Cookie 的签名）。

测试结束会 purge 自己创建的会话。
"""

import base64
import hashlib
import hmac
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "http://127.0.0.1:3111"
USER = "admin"
PASSWORD = os.environ.get("JBA_TEST_PASSWORD", "")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

if not PASSWORD:
    print("缺少 JBA_TEST_PASSWORD")
    sys.exit(2)


def read_env(path, key):
    try:
        with open(path, encoding="utf-8", errors="ignore") as handle:
            for line in handle:
                m = re.match(rf"^\s*(?:export\s+)?{key}\s*=\s*(.*)$", line)
                if m:
                    return m.group(1).strip().strip("'\"")
    except Exception:
        pass
    return ""


TOKEN_SECRET = read_env(os.path.join(ROOT, ".dsh-ops", "dev-env.sh"), "MESSAGE_TOKEN_SECRET")
SUPA_TOKEN = read_env(os.path.join(ROOT, ".dsh-ops", "messages-db.env"), "SUPABASE_ACCESS_TOKEN")
SUPA_URL = read_env(os.path.join(ROOT, ".dsh-ops", "messages-db.env"), "SUPABASE_URL")
SUPA_REF = (re.match(r"https://([a-z0-9]+)\.supabase\.co", SUPA_URL or "") or [None, ""])[1]

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


def jb(p):
    try:
        return json.loads(p)
    except Exception:
        return {}


def cookie(jar, name):
    for c in jar:
        if c.name == name:
            return c.value
    return ""


def sql(query):
    if not (SUPA_TOKEN and SUPA_REF):
        return None
    req = urllib.request.Request(
        f"https://api.supabase.com/v1/projects/{SUPA_REF}/database/query",
        data=json.dumps({"query": query}).encode(),
        method="POST",
        headers={"Authorization": f"Bearer {SUPA_TOKEN}", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as exc:
        print("  (SQL 查询失败:", exc, ")")
        return None


def b64url(raw):
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def sign_cookie(conv_id, exp_sec):
    payload = f"{conv_id}|{exp_sec}"
    sig = b64url(hmac.new(TOKEN_SECRET.encode(), payload.encode(), hashlib.sha256).digest())
    return f"{conv_id}.{exp_sec}.{sig}"


def create(anon, name, content, ip="198.51.100.7", extra=None):
    payload = {"visitor_name": name, "content": content,
               "client_request_id": f"sec-{int(time.time()*1000000)%10**9}"}
    if extra:
        payload.update(extra)
    code, body, _ = call(anon, "POST", "/api/messages/conversations", payload,
                         {"Origin": BASE, "X-Forwarded-For": ip})
    data = jb(body)
    if data.get("conversation_id"):
        created.append(data["conversation_id"])
    return code, data


def main():
    anon, _ = opener()

    # ---------- 1. 未登录矩阵 ----------
    for path in ("/api/messages/conversations/abcdefghijklmnop",
                 "/api/messages/conversations/abcdefghijklmnop/messages"):
        code, _, _ = call(anon, "GET", path)
        record(f"未登录 {path.replace('abcdefghijklmnop', '<id>')} → 403", code == 403, f"status={code}")
    for path in ("/api/admin/messages/stats", "/api/admin/messages/conversations"):
        code, _, _ = call(anon, "GET", path)
        record(f"未登录 {path} → 401", code == 401, f"status={code}")

    # ---------- 2. 两个会话 + 兑换 ----------
    code, a = create(anon, "安全A", "会话 A 的第一条")
    code2, b = create(anon, "安全B", "会话 B 的第一条", ip="198.51.100.8")
    record("创建会话 A/B", code == 201 and code2 == 201, f"{code}/{code2}")
    cid_a, tok_a = a.get("conversation_id"), urllib.parse.urlsplit(a.get("link") or "").fragment
    cid_b, tok_b = b.get("conversation_id"), urllib.parse.urlsplit(b.get("link") or "").fragment

    va, _ = opener()
    code, _, _ = call(va, "POST", "/api/messages/access/exchange",
                      {"conversation_id": cid_a, "token": tok_a}, {"Origin": BASE})
    record("A 兑换成功", code == 200, f"status={code}")

    vb, _ = opener()
    code, _, _ = call(vb, "POST", "/api/messages/access/exchange",
                      {"conversation_id": cid_b, "token": tok_b}, {"Origin": BASE})
    record("B 兑换成功", code == 200, f"status={code}")

    # ---------- 3. IDOR ----------
    code, _, _ = call(va, "GET", f"/api/messages/conversations/{cid_b}/messages")
    record("A 的 Cookie 读 B 的会话 → 403（IDOR 被挡）", code == 403, f"status={code}")
    code, _, _ = call(va, "POST", f"/api/messages/conversations/{cid_b}/messages",
                      {"content": "越权写入"}, {"Origin": BASE})
    record("A 的 Cookie 向 B 发消息 → 403", code == 403, f"status={code}")

    # ---------- 4. 伪造 / 篡改 / 过期 Cookie ----------
    name_a = f"jbm_{cid_a[:10]}"
    code, _, _ = call(anon, "GET", f"/api/messages/conversations/{cid_a}/messages",
                      headers={"Cookie": f"{name_a}={cid_a}.9999999999.forged"})
    record("伪造签名 → 403", code == 403, f"status={code}")

    # 把签名里的 convId 换成 B（签名对不上）
    code, _, _ = call(anon, "GET", f"/api/messages/conversations/{cid_a}/messages",
                      headers={"Cookie": f"{name_a}={cid_b}.9999999999.deadbeef"})
    record("Cookie 内 convId 与实际不符 → 403", code == 403, f"status={code}")

    if TOKEN_SECRET:
        past = int(time.time()) - 3600
        expired = sign_cookie(cid_a, past)
        code, _, _ = call(anon, "GET", f"/api/messages/conversations/{cid_a}/messages",
                          headers={"Cookie": f"{name_a}={expired}"})
        record("签名正确但已过期 → 403", code == 403, f"status={code}")
        future = int(time.time()) + 600
        valid = sign_cookie(cid_a, future)
        code, _, _ = call(anon, "GET", f"/api/messages/conversations/{cid_a}/messages",
                          headers={"Cookie": f"{name_a}={valid}"})
        record("手工签发的合法 Cookie → 200（证明校验只认签名+过期）", code == 200, f"status={code}")
    else:
        record("跳过过期 Cookie 用例（缺 MESSAGE_TOKEN_SECRET）", True, "skipped")

    # ---------- 5. 重放与幂等 ----------
    before = len(jb(call(va, "GET", f"/api/messages/conversations/{cid_a}/messages")[1]).get("messages") or [])
    rid = f"replay-{int(time.time())}"
    for _ in range(3):
        code, body, _ = call(va, "POST", f"/api/messages/conversations/{cid_a}/messages",
                             {"content": "重放测试", "client_request_id": rid}, {"Origin": BASE})
    after = len(jb(call(va, "GET", f"/api/messages/conversations/{cid_a}/messages")[1]).get("messages") or [])
    record("同 request_id 连发 3 次只落 1 条", after == before + 1, f"{before} → {after}")

    # ---------- 6. XSS（存原文、不执行） ----------
    payload = '<img src=x onerror="alert(1)"><script>alert(2)</script>'
    code, body, _ = call(va, "POST", f"/api/messages/conversations/{cid_a}/messages",
                         {"content": payload}, {"Origin": BASE})
    stored = (jb(body).get("message") or {}).get("content") or ""
    record("XSS 原文按纯文本存储（未被转义/截断）", code == 201 and stored == payload, f"status={code}")

    # 管理端页面 SSR 不应包含该内容（页面只渲染外壳，内容由 React 文本节点输出）
    admin, jar = opener()
    call(admin, "POST", "/api/admin/login", {"username": USER, "password": PASSWORD})
    csrf = urllib.parse.unquote(cookie(jar, "jba_csrf"))
    code, html, _ = call(admin, "GET", "/admin/messages")
    record("管理页 SSR 不含访客正文（避免任何 HTML 注入面）", payload not in html, f"status={code}")

    code, body, _ = call(admin, "GET", f"/api/admin/messages/conversations/{cid_a}")
    detail = jb(body)
    contents = [m.get("content") for m in detail.get("messages") or []]
    record("管理端 API 原样返回（前端负责转义）", payload in contents, f"n={len(contents)}")

    # ---------- 7. 限流与来源维度 ----------
    ip = "198.51.100.200"
    codes = []
    for i in range(5):
        code, _ = create(anon, f"限流{i}", f"限流测试 {i}", ip=ip)
        codes.append(code)
    record("同 IP 创建第 4 次被限流（3/10min）", 429 in codes, f"codes={codes}")

    code, other = create(anon, "换IP", "换一个来源应当放行", ip="198.51.100.201")
    record("换来源 IP 可继续创建（证明限流维度是 IP 哈希）", code == 201, f"status={code}")

    # ---------- 8. 兑换爆破封禁 ----------
    probe, _ = opener()
    codes = []
    for i in range(12):
        code, _, _ = call(probe, "POST", "/api/messages/access/exchange",
                          {"conversation_id": cid_a, "token": "A" * 43},
                          {"Origin": BASE, "X-Forwarded-For": "198.51.100.222"})
        codes.append(code)
        if code == 429:
            break
    record("连续错误 token 触发 429 封禁", 429 in codes, f"codes={codes[-4:]}")

    # ---------- 9. 枚举与输入边界 ----------
    code, _, _ = call(anon, "GET", "/api/messages/conversations/zzzzzzzzzzzzzzzz/messages")
    record("不存在的会话 id → 403（不泄露存在性）", code == 403, f"status={code}")
    code, _, _ = call(va, "POST", f"/api/messages/conversations/{cid_a}/messages",
                      {"content": "x" * 5001}, {"Origin": BASE})
    record("5001 字符 → 413", code == 413, f"status={code}")

    # 控制字符被剔除
    code, body, _ = call(vb, "POST", f"/api/messages/conversations/{cid_b}/messages",
                         {"content": "abc\u0000\u0007def"}, {"Origin": BASE})
    stored = (jb(body).get("message") or {}).get("content") or ""
    record("控制字符被剔除", code == 201 and stored == "abcdef", f"status={code} stored={stored!r}")

    # ---------- 10. 访问审计落库 ----------
    rows = sql("select count(*) as n from messages.access_logs;")
    if rows:
        n = rows[0].get("n")
        record("access_logs 已记录兑换尝试", int(n) > 0, f"rows={n}")
    else:
        record("跳过 access_logs 校验（无 SQL 凭据）", True, "skipped")

    # ---------- 清理 ----------
    for cid in created:
        call(admin, "DELETE", f"/api/admin/messages/conversations/{cid}?confirm={cid}&mode=purge",
             headers={"x-csrf-token": csrf})

    total = len(results)
    failed = [r for r in results if not r[1]]
    print("\n==== 结果: %d/%d 通过 ====" % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(" - FAILED:", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
