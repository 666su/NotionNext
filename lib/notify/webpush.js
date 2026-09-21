/**
 * 新增推送通知功能 - Web Push 原生实现
 *
 * 使用 Node.js 内置 crypto 模块实现：
 * - VAPID 密钥生成（EC P-256）
 * - VAPID JWT 签名（ES256）
 * - RFC 8291 消息加密（HKDF-SHA256 + AES-128-GCM）
 *
 * 零外部依赖，兼容 Node 18+
 */
import crypto from 'crypto'

// ========== Base64URL 编解码 ==========

const b64url = buf =>
  Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

const b64urlDecode = str => {
  let s = String(str).replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Buffer.from(s, 'base64')
}

// ========== VAPID 密钥生成 ==========

/**
 * 生成 VAPID 密钥对
 * - publicKey: 65 字节非压缩点（base64url，作为 applicationServerKey 发给浏览器）
 * - privateKey: PKCS8 PEM 字符串（服务端签名用）
 */
export function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
  })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const pubPoint = spki.subarray(spki.length - 65)
  const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  return {
    publicKey: b64url(pubPoint),
    privateKey: privPem
  }
}

// ========== VAPID JWT 签名 ==========

/**
 * DER 签名 → 原始 r||s 格式（JWT ES256 要求）
 * DER: 0x30 <len> 0x02 <rLen> <r> 0x02 <sLen> <s>
 * Raw: <r (32 bytes)> <s (32 bytes)>
 */
function derToRawSignature(derSig) {
  let offset = 0
  if (derSig[offset] !== 0x30) throw new Error('无效的 DER 签名格式')
  offset++
  if (derSig[offset] & 0x80) {
    const lenBytes = derSig[offset] & 0x7f
    offset += 1 + lenBytes
  } else {
    offset++
  }

  // r
  if (derSig[offset] !== 0x02) throw new Error('无效的 DER 签名: r')
  const rLen = derSig[offset + 1]
  const r = derSig.subarray(offset + 2, offset + 2 + rLen)
  offset += 2 + rLen

  // s
  if (derSig[offset] !== 0x02) throw new Error('无效的 DER 签名: s')
  const sLen = derSig[offset + 1]
  const s = derSig.subarray(offset + 2, offset + 2 + sLen)

  // 补齐到 32 字节
  const rPadded = Buffer.alloc(32)
  const sPadded = Buffer.alloc(32)
  r.copy(rPadded, 32 - r.length)
  s.copy(sPadded, 32 - s.length)

  return Buffer.concat([rPadded, sPadded])
}

function signVapidJwt({ privateKeyPem, subject, origin }) {
  const key = crypto.createPrivateKey({ key: privateKeyPem, type: 'pkcs8', format: 'pem' })
  const header = { typ: 'JWT', alg: 'ES256' }
  const payload = {
    aud: origin,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: subject
  }
  const unsigned = b64url(JSON.stringify(header)) + '.' + b64url(JSON.stringify(payload))
  const derSig = crypto.sign('sha256', Buffer.from(unsigned), key)
  const rawSig = derToRawSignature(derSig)
  return `${unsigned}.${b64url(rawSig)}`
}

// ========== DER 编码辅助 ==========

function derLen(len) {
  if (len < 0x80) return Buffer.from([len])
  const buf = []
  let tmp = len
  while (tmp > 0) {
    buf.unshift(tmp & 0xff)
    tmp >>= 8
  }
  return Buffer.concat([Buffer.from([0x80 | buf.length]), ...buf])
}

/**
 * 从 65 字节非压缩点构建 SPKI DER
 * SubjectPublicKeyInfo: SEQUENCE { SEQUENCE { OID ecPublicKey, OID prime256v1 }, BIT STRING { point } }
 */
function buildSpkiDer(pubPoint) {
  const oidEc = Buffer.from([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])
  const oidP256 = Buffer.from([
    0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07
  ])
  const algo = Buffer.concat([oidEc, oidP256])
  const algoSeq = Buffer.concat([Buffer.from([0x30]), derLen(algo.length), algo])
  const bitString = Buffer.concat([
    Buffer.from([0x03]),
    derLen(pubPoint.length + 1),
    Buffer.from([0x00]),
    pubPoint
  ])
  const body = Buffer.concat([algoSeq, bitString])
  return Buffer.concat([Buffer.from([0x30]), derLen(body.length), body])
}

// ========== RFC 8291 消息加密 ==========

/**
 * 加密推送载荷
 * @param {Buffer} payload  明文 JSON
 * @param {string} p256dh   接收方公钥（base64url，65 字节）
 * @param {string} auth     认证密钥（base64url，16 字节）
 * @returns {Buffer} 加密后的消息体（header + ciphertext + tag）
 */
export function encryptPayload(payload, p256dh, auth) {
  const uaPublic = b64urlDecode(p256dh)
  const authSecret = b64urlDecode(auth)

  // 1. 生成临时 ECDH 密钥对
  const { publicKey: ephPub, privateKey: ephPriv } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
  })
  const ephPubPoint = ephPub.export({ type: 'spki', format: 'der' }).subarray(-65)

  // 2. ECDH 共享密钥
  const uaKeyObj = crypto.createPublicKey({
    key: buildSpkiDer(uaPublic),
    format: 'der',
    type: 'spki'
  })
  const sharedSecret = crypto.diffieHellman({ privateKey: ephPriv, publicKey: uaKeyObj })

  // 3. HKDF 密钥派生
  const salt = crypto.randomBytes(16)

  const authInfo = Buffer.concat([
    Buffer.from('Content-Encoding: auth\0', 'utf8'),
    authSecret,
    sharedSecret
  ])

  const prkAuth = Buffer.from(
    crypto.hkdfSync('sha256', authInfo, salt, Buffer.from('Content-Encoding: auth\0'), 32)
  )

  const ikm = Buffer.from(
    crypto.hkdfSync('sha256', sharedSecret, prkAuth, Buffer.from('Content-Encoding: auth\0'), 32)
  )

  const prk = Buffer.from(
    crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 32)
  )

  // 4. key_info → CEK + nonce
  const keyInfo = Buffer.concat([
    Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'),
    Buffer.from('P-256\0', 'utf8'),
    Buffer.from([65]),
    ephPubPoint,
    Buffer.from('Web Push: info\0', 'utf8'),
    uaPublic
  ])

  const prfInput = Buffer.from(crypto.hkdfSync('sha256', prk, Buffer.alloc(0), keyInfo, 28))
  const cek = prfInput.subarray(0, 16)
  const nonce = prfInput.subarray(16, 28)

  // 5. AES-128-GCM 加密
  const aad = Buffer.concat([Buffer.from('Web Push: info\0', 'utf8'), uaPublic])
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce)
  const ciphertext = Buffer.concat([cipher.update(payload), cipher.final()])
  const tag = cipher.getAuthTag()

  // 6. 组装消息体
  const header = Buffer.concat([
    salt,
    Buffer.from([0x00, 0x00, 0x10, 0x00]), // rs = 4096
    Buffer.from([65]),                      // id_len
    ephPubPoint
  ])

  return Buffer.concat([header, ciphertext, tag])
}

// ========== 发送 Web Push ==========

/**
 * 向单个订阅发送推送
 * @param {object} subscription  { endpoint, keys: { p256dh, auth } }
 * @param {object} payload       { title, body, url }
 * @param {object} vapidKeys     { publicKey, privateKey }
 * @param {string} vapidSubject  VAPID subject (mailto:...)
 * @returns {Promise<boolean>}  是否成功
 * @throws {Error} 发送失败时抛出，statusCode 为 404/410 表示订阅过期
 */
export async function sendWebPushTo(subscription, payload, vapidKeys, vapidSubject) {
  const { endpoint, keys } = subscription
  if (!endpoint || !keys?.p256dh || !keys?.auth) {
    throw new Error('订阅信息不完整')
  }

  const payloadBuf = Buffer.from(JSON.stringify(payload))
  const body = encryptPayload(payloadBuf, keys.p256dh, keys.auth)

  const origin = new URL(endpoint).origin
  const jwt = signVapidJwt({
    privateKeyPem: vapidKeys.privateKey,
    subject: vapidSubject || 'mailto:admin@localhost',
    origin
  })

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      Authorization: `WebPush vapid="${jwt}"`,
      'Crypto-Key': `p256=${vapidKeys.publicKey}`,
      'Urgency': 'normal',
      'Ttl': '3600'
    },
    body
  })

  if (res.status === 404 || res.status === 410) {
    throw Object.assign(new Error('订阅已过期'), { statusCode: res.status })
  }
  if (!res.ok) {
    throw new Error(`Push 发送失败: ${res.status} ${res.statusText}`)
  }
  return true
}

/**
 * 向所有订阅者广播推送
 * @returns {{ sent: number, removed: number }}
 */
export async function sendWebPushAll(payload, vapidKeys, vapidSubject) {
  const { getSubscriptions, removeSubscription } = await import('./storage.js')
  const subs = await getSubscriptions()
  let sent = 0
  let removed = 0

  for (const sub of subs) {
    try {
      await sendWebPushTo(sub, payload, vapidKeys, vapidSubject)
      sent++
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await removeSubscription(sub.endpoint)
        removed++
      } else {
        console.warn('[notify] WebPush 发送失败:', e.message)
      }
    }
  }
  return { sent, removed }
}
