#!/usr/bin/env node
/**
 * 本地 Telegram Bot API 桩（测试专用，不参与生产）
 *
 * 用途：让本地 dev 在不真正发消息给你的手机的前提下，验证
 *   - 推送（sendMessage）是否被调用、payload 长什么样；
 *   - 返回的 message_id 是否被正确写进 messages.tg_links。
 *
 * 用法：
 *   node scripts/telegram-stub.mjs --port=8992
 *   curl http://127.0.0.1:8992/_log      # 看收到的请求
 *   curl -X POST http://127.0.0.1:8992/_reset
 */

import http from 'node:http'

const portArg = process.argv.find(a => a.startsWith('--port='))
const PORT = Number(portArg ? portArg.split('=')[1] : 8992)

let calls = []
let nextMessageId = 1000

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)

  if (req.method === 'GET' && url.pathname === '/_log') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, count: calls.length, calls }, null, 2))
  }

  if (req.method === 'POST' && url.pathname === '/_reset') {
    calls = []
    nextMessageId = 1000
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true }))
  }

  let raw = ''
  req.on('data', chunk => {
    raw += chunk
  })
  req.on('end', () => {
    let body = null
    try {
      body = raw ? JSON.parse(raw) : null
    } catch (err) {
      body = { _raw: raw.slice(0, 500) }
    }

    const isSend = /\/sendMessage$/.test(url.pathname)
    const entry = {
      at: new Date().toISOString(),
      method: req.method,
      path: url.pathname.replace(/\/bot[^/]+\//, '/bot<token>/'),
      chat_id: body?.chat_id ?? null,
      text: body?.text ?? null,
      reply_to_message_id: body?.reply_to_message_id ?? null,
      has_buttons: Boolean(body?.reply_markup)
    }

    if (isSend) {
      nextMessageId += 1
      entry.assigned_message_id = nextMessageId
      calls.push(entry)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      return res.end(
        JSON.stringify({
          ok: true,
          result: { message_id: nextMessageId, chat: { id: body?.chat_id }, text: body?.text }
        })
      )
    }

    calls.push(entry)
    res.writeHead(200, { 'Content-Type': 'application/json' })
    return res.end(JSON.stringify({ ok: true, result: true }))
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[tg-stub] listening on http://127.0.0.1:${PORT}`)
})
