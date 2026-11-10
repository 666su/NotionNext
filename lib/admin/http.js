/**
 * 后台 API 的小工具（服务端专用）
 */

export function readJsonBody(req, maxBytes = 8192) {
  // Next.js 默认已解析 body；这里兼容字符串与未解析的情况
  let body = req?.body
  if (typeof body === 'string') {
    if (Buffer.byteLength(body, 'utf8') > maxBytes) return {}
    try {
      body = body ? JSON.parse(body) : {}
    } catch (err) {
      body = {}
    }
  }
  if (!body || typeof body !== 'object') return {}
  return body
}

export function methodNotAllowed(res, allowed = ['POST']) {
  res.setHeader('Allow', allowed.join(', '))
  res.status(405).json({ error: 'method_not_allowed' })
  return null
}

export function safeTrim(value, maxLength = 256) {
  return String(value == null ? '' : value)
    .trim()
    .slice(0, maxLength)
}
