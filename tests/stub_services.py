#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 6 的本地桩服务：OpenAI 兼容 AI + Telegram Bot API。

用途：在没有真实密钥的情况下，端到端验证"AI 总结 → Telegram 推送"这条链路，
包括请求体里到底发了什么（用来证明没有把访客标识/评论发给模型）。

用法：python tests/stub_services.py
  - AI：http://127.0.0.1:8991/v1/chat/completions
  - TG：http://127.0.0.1:8992/bot<token>/sendMessage
收到请求时把 JSON 落到 .dsh-ops/stub-ai.json / stub-tg.json，供测试断言。
"""

import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE_DIR, ".dsh-ops")
AI_OUT = os.path.join(OUT_DIR, "stub-ai.json")
TG_OUT = os.path.join(OUT_DIR, "stub-tg.json")

AI_REPLY = (
    "今日整体流量平稳，PV 与 UV 的差距说明多数访客只看了少数页面。"
    "热门页面集中在首页与一篇长文，说明入口仍然依赖首页推荐。"
    "站内搜索量很低，暂时不足以判断关键词偏好。"
    "建议：把那篇长文加到首页显眼位置，观察一周后的 PV 变化。"
)


def save(path, payload):
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)


class AiHandler(BaseHTTPRequestHandler):
    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "ignore")
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            payload = {"_raw": raw}
        save(AI_OUT, {"path": self.path, "headers": dict(self.headers), "body": payload})
        body = json.dumps(
            {
                "id": "stub-chat-1",
                "model": payload.get("model", "stub-model"),
                "choices": [{"index": 0, "message": {"role": "assistant", "content": AI_REPLY}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 60},
            },
            ensure_ascii=False,
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


class TgHandler(BaseHTTPRequestHandler):
    def do_GET(self):  # noqa: N802
        # /bot<token>/getMe —— 连通性自检
        body = json.dumps(
            {"ok": True, "result": {"id": 424242, "is_bot": True, "username": "stub_bot"}},
            ensure_ascii=False,
        ).encode()
        save(TG_OUT + ".getme", {"path": self.path})
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode("utf-8", "ignore")
        try:
            payload = json.loads(raw or "{}")
        except json.JSONDecodeError:
            payload = {"_raw": raw}
        save(TG_OUT, {"path": self.path, "body": payload})
        body = json.dumps(
            {"ok": True, "result": {"message_id": 12345, "date": 1762732800, "text": payload.get("text", "")}},
            ensure_ascii=False,
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def serve(handler, port):
    server = ThreadingHTTPServer(("127.0.0.1", port), handler)
    server.serve_forever()


if __name__ == "__main__":
    threading.Thread(target=serve, args=(AiHandler, 8991), daemon=True).start()
    print("AI stub on http://127.0.0.1:8991/v1", flush=True)
    print("TG stub on http://127.0.0.1:8992", flush=True)
    serve(TgHandler, 8992)
