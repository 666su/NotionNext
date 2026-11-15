/**
 * 输入校验（服务端权威；前端校验只是体验）
 *
 * 规范 §4.2 / §8.4：
 * - 昵称 1–40、邮箱选填且合法（≤254）、正文 1–5000
 * - 去首尾空白、拒绝空白、剔除非法控制字符、拒绝异常重复
 * - 只支持纯文本（不接受 HTML/Markdown）
 *
 * 注意：正文长度上限必须在「压缩连续同字符」之前判断，
 * 否则 5001 个相同字符会被压成 50 个而绕过校验。
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/** 去控制字符（保留 \n \t），CRLF 归一为 LF */
export function stripControl(raw) {
  return String(raw == null ? '' : raw)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(CONTROL_CHARS, '')
}

/** 压缩超长同字符串（刷屏式 "哈哈哈…" 只保留前 N 个） */
export function collapseRuns(text, maxSameCharRun = 50) {
  return String(text || '').replace(/(.)\1{9,}/gu, (match, ch) =>
    ch.repeat(Math.min(match.length, maxSameCharRun))
  )
}

export function normalizeContent(raw, maxSameCharRun = 50) {
  return collapseRuns(stripControl(raw), maxSameCharRun).trim()
}

export function isValidEmail(value) {
  const email = trimText(value)
  if (!email) return true // 选填
  if (email.length > 254) return false
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)
}

/**
 * 创建会话的入参校验
 * @returns {{ok:true, value:object} | {ok:false, error:string}}
 */
export function validateCreatePayload(body, limits) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_input' }
  }

  // honeypot：隐藏字段被填写 → 上层按 invalid_input 返回，不告诉机器人"你看穿了"
  const honeypot = trimText(body.website || body.url || '')
  if (honeypot) return { ok: false, error: 'spam_detected' }

  const name = trimText(body.visitor_name)
  if (name.length < limits.NAME_MIN || name.length > limits.NAME_MAX) {
    return { ok: false, error: 'invalid_name' }
  }

  const emailRaw = trimText(body.visitor_email)
  if (!isValidEmail(emailRaw)) return { ok: false, error: 'invalid_email' }

  const rawContent = stripControl(body.content).trim()
  if (rawContent.length < limits.CONTENT_MIN) return { ok: false, error: 'invalid_content' }
  if (rawContent.length > limits.CONTENT_MAX) return { ok: false, error: 'payload_too_large' }
  const content = collapseRuns(rawContent, limits.MAX_SAME_CHAR_RUN).trim()

  const clientRequestId = trimText(body.client_request_id).slice(0, 64)
  if (clientRequestId && !/^[A-Za-z0-9_-]{8,64}$/.test(clientRequestId)) {
    return { ok: false, error: 'invalid_request_id' }
  }

  return {
    ok: true,
    value: {
      name,
      email: emailRaw || null,
      content,
      clientRequestId: clientRequestId || null
    }
  }
}

/** 追加消息的入参校验（访客与管理员共用） */
export function validateMessagePayload(body, limits) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'invalid_input' }
  }

  const rawContent = stripControl(body.content).trim()
  if (rawContent.length < limits.CONTENT_MIN) return { ok: false, error: 'invalid_content' }
  if (rawContent.length > limits.CONTENT_MAX) return { ok: false, error: 'payload_too_large' }
  const content = collapseRuns(rawContent, limits.MAX_SAME_CHAR_RUN).trim()

  const clientRequestId = trimText(body.client_request_id).slice(0, 64)
  if (clientRequestId && !/^[A-Za-z0-9_-]{8,64}$/.test(clientRequestId)) {
    return { ok: false, error: 'invalid_request_id' }
  }
  return { ok: true, value: { content, clientRequestId: clientRequestId || null } }
}

/** 邮箱脱敏（列表接口用）：a***@b.com */
export function maskEmail(email) {
  const value = trimText(email)
  if (!value) return null
  const at = value.indexOf('@')
  if (at <= 0) return '***'
  const name = value.slice(0, at)
  const domain = value.slice(at + 1)
  return `${name.slice(0, 1)}***@${domain}`
}
