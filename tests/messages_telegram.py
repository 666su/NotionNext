#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Phase 7 冒烟：Telegram 双向通道（推送映射 + 回复路由 + 幂等 + 鉴权）。

前置：
  1. dev server 在 127.0.0.1:3111，且环境里有
     TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID / TELEGRAM_WEBHOOK_SECRET；
  2. TELEGRAM_API_BASE 指向本地桩（node scripts/telegram-stub.mjs --port=8992）；
  3. JBA_TG_SECRET = 服务端的 TELEGRAM_WEBHOOK_SECRET（测试用，不落盘）。

测试结束会 purge 自己创建的会话与 tg 映射。
"""

import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request

BASE = 'http://127.0.0.1:3111'
STUB = 'http://127.0.0.1:8992'
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SECRET = os.environ.get('JBA_TG_SECRET', '')
PASSWORD = os.environ.get('JBA_TEST_PASSWORD', '')

results = []
created = []


def record(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS ' if ok else 'FAIL ') + name + ('  | ' + str(detail) if detail else ''))


def read_env(path, key):
    try:
        with open(path, encoding='utf-8', errors='ignore') as handle:
            for line in handle:
                m = re.match(rf'^\s*(?:export\s+)?{key}\s*=\s*(.*)$', line)
                if m:
                    return m.group(1).strip().strip("'\"")
    except Exception:
        pass
    return ''


CHAT_ID = read_env(os.path.join(ROOT, '.dsh-ops', 'dev-env.sh'), 'TELEGRAM_CHAT_ID')
SUPA_TOKEN = read_env(os.path.join(ROOT, '.dsh-ops', 'messages-db.env'), 'SUPABASE_ACCESS_TOKEN')
SUPA_URL = read_env(os.path.join(ROOT, '.dsh-ops', 'messages-db.env'), 'SUPABASE_URL')
SUPA_REF = (re.match(r'https://([a-z0-9]+)\.supabase\.co', SUPA_URL or '') or [None, ''])[1]


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k):
        return None


def opener():
    jar = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar), NoRedirect()), jar


def call(op, method, url, body=None, headers=None, timeout=60):
    req = urllib.request.Request(
        url, data=json.dumps(body).encode() if body is not None else None, method=method
    )
    if body is not None:
        req.add_header('Content-Type', 'application/json')
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    try:
        r = op.open(req, timeout=timeout)
        return r.getcode(), r.read().decode('utf-8', 'ignore')
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode('utf-8', 'ignore')


def jb(p):
    try:
        return json.loads(p)
    except Exception:
        return {}


def sql(query):
    if not (SUPA_TOKEN and SUPA_REF):
        return None
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{SUPA_REF}/database/query',
        data=json.dumps({'query': query}).encode(),
        method='POST',
        headers={'Authorization': f'Bearer {SUPA_TOKEN}', 'Content-Type': 'application/json'}
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode())
    except Exception as exc:
        print('  (SQL 失败:', exc, ')')
        return None


def stub_log():
    code, body = call(opener()[0], 'GET', STUB + '/_log')
    return jb(body).get('calls') or [] if code == 200 else []


def stub_reset():
    call(opener()[0], 'POST', STUB + '/_reset')


def webhook(op, update, secret=None):
    headers = {'Content-Type': 'application/json'}
    if secret is not False:
        headers['X-Telegram-Bot-Api-Secret-Token'] = secret if secret is not None else SECRET
    return call(op, 'POST', BASE + '/api/telegram/webhook', update, headers)


def main():
    if not SECRET:
        print('缺少 JBA_TG_SECRET')
        sys.exit(2)
    if not CHAT_ID:
        print('缺少 TELEGRAM_CHAT_ID')
        sys.exit(2)

    anon, _ = opener()
    stub_reset()

    # ---------- 1. 创建会话 → 应推送并发起映射 ----------
    code, body = call(anon, 'POST', BASE + '/api/messages/conversations', {
        'visitor_name': 'TG桥接测试',
        'content': '这条应该出现在 TG 里，然后我在 TG 里回复它。',
        'client_request_id': f'tg-{int(time.time())}'
    }, {'Origin': BASE, 'X-Forwarded-For': '203.0.113.77'})
    data = jb(body)
    cid = data.get('conversation_id')
    if cid:
        created.append(cid)
    record('创建会话 → 201', code == 201 and bool(cid), f'status={code}')
    time.sleep(1.2)  # 通知是异步的

    calls = stub_log()
    sends = [c for c in calls if c.get('path', '').endswith('/sendMessage') and c.get('assigned_message_id')]
    record('推送 1 条到 TG', len(sends) == 1, f'sends={len(sends)}')
    notify = sends[0] if sends else {}
    record('推送带昵称与会话短码', 'TG桥接测试' in (notify.get('text') or ''), (notify.get('text') or '')[:40].replace('\n', ' '))
    record('推送带后台按钮', notify.get('has_buttons') is True)
    tg_msg_id = notify.get('assigned_message_id')

    rows = sql(f"select tg_chat_id, tg_message_id, conversation_id from messages.tg_links where conversation_id = '{cid}';") if cid else None
    record('映射表已记录', bool(rows) and str(rows[0].get('tg_message_id')) == str(tg_msg_id), rows)

    # ---------- 2. 鉴权 ----------
    code, _ = webhook(anon, {'update_id': 1, 'message': {'message_id': 1, 'chat': {'id': int(CHAT_ID)}, 'text': 'x'}}, secret='wrong')
    record('错误 secret → 403', code == 403, f'status={code}')
    code, _ = webhook(anon, {'update_id': 2, 'message': {'message_id': 1, 'chat': {'id': int(CHAT_ID)}, 'text': 'x'}}, secret=False)
    record('缺少 secret 头 → 403', code == 403, f'status={code}')

    # ---------- 3. 陌生 chat 忽略 ----------
    stub_reset()
    code, body = webhook(anon, {'update_id': 3, 'message': {'message_id': 5, 'chat': {'id': 424242}, 'text': 'hi'}})
    record('陌生 chat → 200 忽略', code == 200 and jb(body).get('ignored') == 'chat_not_allowed', jb(body))
    record('陌生 chat 不产生回执', len(stub_log()) == 0, f'calls={len(stub_log())}')

    # ---------- 4. 没有引用 → 不当回复 ----------
    stub_reset()
    code, body = webhook(anon, {'update_id': 4, 'message': {'message_id': 6, 'chat': {'id': int(CHAT_ID)}, 'text': '随便说一句'}})
    record('未引用消息 → ignored', code == 200 and jb(body).get('ignored') == 'not_a_reply', jb(body))
    acks = stub_log()
    record('并回了提示', len(acks) == 1 and '回复' in (acks[0].get('text') or ''), (acks[0].get('text') or '')[:30])

    # ---------- 5. 引用通知 → 写入管理员回复 ----------
    stub_reset()
    code, body = webhook(anon, {
        'update_id': 1001,
        'message': {
            'message_id': 7,
            'chat': {'id': int(CHAT_ID)},
            'text': 'TG 侧回复：这是通过 Telegram 直接回的。',
            'reply_to_message': {'message_id': tg_msg_id, 'text': '原通知'}
        }
    })
    record('引用通知 → delivered', code == 200 and jb(body).get('delivered') is True, jb(body))

    rows = sql(f"select sender, content from messages.messages where conversation_id = '{cid}' and sender = 'admin';") if cid else None
    record('管理员回复已入库', bool(rows) and '通过 Telegram' in (rows[0].get('content') or ''), rows)

    acks = [c for c in stub_log() if '/sendMessage' in (c.get('path') or '')]
    record('回执带 ✅ 与访客昵称', bool(acks) and '✅' in (acks[-1].get('text') or '') and 'TG桥接测试' in (acks[-1].get('text') or ''), (acks[-1].get('text') or '')[:40])

    conv = sql(f"select status, unread_count from messages.conversations where id = '{cid}';") if cid else None
    record('会话状态变 processing 且未读清零', bool(conv) and conv[0].get('status') in ('processing', 'read') and int(conv[0].get('unread_count') or 0) == 0, conv)

    # ---------- 6. update 幂等 ----------
    before = len(sql(f"select id from messages.messages where conversation_id = '{cid}' and sender = 'admin';") or [])
    code, body = webhook(anon, {
        'update_id': 1001,  # 同一个 update_id
        'message': {'message_id': 8, 'chat': {'id': int(CHAT_ID)}, 'text': '重复投递', 'reply_to_message': {'message_id': tg_msg_id}}
    })
    after = len(sql(f"select id from messages.messages where conversation_id = '{cid}' and sender = 'admin';") or [])
    record('重复 update 不重复写入', jb(body).get('duplicate') is True and before == after, f'{before}→{after}')

    # ---------- 7. 引用不存在的通知 ----------
    stub_reset()
    code, body = webhook(anon, {
        'update_id': 1002,
        'message': {'message_id': 9, 'chat': {'id': int(CHAT_ID)}, 'text': '找不到', 'reply_to_message': {'message_id': 99999999}}
    })
    record('引用未知通知 → ignored', code == 200 and jb(body).get('ignored') == 'unknown_link', jb(body))
    record('并提示找不到', any('找不到' in (c.get('text') or '') for c in stub_log()))

    # ---------- 8. 内容过长 ----------
    stub_reset()
    code, body = webhook(anon, {
        'update_id': 1003,
        'message': {'message_id': 10, 'chat': {'id': int(CHAT_ID)}, 'text': 'x' * 5001, 'reply_to_message': {'message_id': tg_msg_id}}
    })
    record('超长内容被拒（不写入）', code == 200 and jb(body).get('error') == 'payload_too_large', jb(body))

    # ---------- 清理 ----------
    admin, jar = opener()
    if PASSWORD:
        call(admin, 'POST', BASE + '/api/admin/login', {'username': 'admin', 'password': PASSWORD})
        csrf = ''
        for c in jar:
            if c.name == 'jba_csrf':
                csrf = urllib.parse.unquote(c.value)
        for item in created:
            call(admin, 'DELETE', f'{BASE}/api/admin/messages/conversations/{item}?confirm={item}&mode=purge',
                 headers={'X-CSRF-Token': csrf})
    for item in created:
        sql(f"delete from messages.conversations where id = '{item}';")
    sql('delete from messages.tg_updates where update_id in (1001,1002,1003);')

    total = len(results)
    failed = [r for r in results if not r[1]]
    print('\n==== 结果: %d/%d 通过 ====' % (total - len(failed), total))
    if failed:
        for name, _ in failed:
            print(' - FAILED:', name)
        sys.exit(1)


if __name__ == '__main__':
    import urllib.parse  # noqa: E402  (用于 quote，放在末尾避免顶部顺序噪声)
    main()
