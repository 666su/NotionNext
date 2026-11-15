/**
 * 访客会话鉴权（Cookie）
 *
 * Cookie 名带会话前缀（jbm_<convId 前 10 位>），值 = <convId>.<exp>.<HMAC>。
 * 校验两件事：签名有效 + 过期未到 + 签名里的 convId 与请求路径里的 id 一致。
 */

import { readMessagesConfig } from './config'
import { normalizeConvId, readConversationCookie } from './respond'
import { cookieNameFor, verifyCookieValue } from './tokens'

/**
 * @returns {{ok:true, convId:string} | {ok:false, status:number, error:string}}
 */
export function requireConversation(req, rawId) {
  const convId = normalizeConvId(rawId)
  if (!convId) return { ok: false, status: 404, error: 'not_found' }

  const config = readMessagesConfig()
  if (!config.ready) return { ok: false, status: 503, error: 'messages_unavailable' }

  const name = cookieNameFor(convId)
  const raw = readConversationCookie(req, name)
  const verified = verifyCookieValue(raw, config.tokenSecret)
  if (!verified || verified.convId !== convId) {
    return { ok: false, status: 403, error: 'invalid_credential' }
  }
  return { ok: true, convId }
}
