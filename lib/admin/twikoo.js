/**
 * Twikoo 只读统计（Phase 4）
 *
 * 只调用公开的评论计数事件（GET_COMMENTS_COUNT），**不使用管理员密钥**，
 * 因此拿不到待审核/垃圾评论等管理端数据 —— 这是刻意保留的边界。
 */

import { siteConfig } from '@/lib/config'

export function getTwikooEndpoint() {
  let envId = ''
  try {
    envId = String(siteConfig('COMMENT_TWIKOO_ENV_ID', '') || '').trim()
  } catch (err) {
    envId = ''
  }
  if (!envId) envId = String(process.env.NEXT_PUBLIC_COMMENT_ENV_ID || '').trim()
  if (!envId) return ''
  // 自建域名（含点）直接作为 endpoint；腾讯云环境用 CloudBase 网关
  if (envId.includes('.') || envId.startsWith('http')) {
    return envId.startsWith('http') ? envId : `https://${envId}`
  }
  return `https://${envId}.api.tcloudbasegateway.com/v1/functions/twikoo`
}

/**
 * 批量查询评论数
 * @param {string[]} paths 文章路径（需带前导 /）
 * @returns {Promise<{available:boolean, reason?:string, counts:Record<string, number>}>}
 */
export async function fetchCommentCounts(paths = []) {
  const endpoint = getTwikooEndpoint()
  if (!endpoint) {
    return { available: false, reason: 'not_configured', counts: {} }
  }
  const urls = paths.filter(Boolean).slice(0, 100)
  if (!urls.length) return { available: true, counts: {} }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'GET_COMMENTS_COUNT', urls }),
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) {
      return { available: false, reason: `http_${response.status}`, counts: {} }
    }
    const data = await response.json()
    const counts = {}
    const rows = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : []
    rows.forEach(row => {
      const url = row?.url || row?.path
      if (url) counts[url] = Number(row.count || 0)
    })
    return { available: true, counts }
  } catch (err) {
    console.error('[twikoo] count query failed:', err?.message || err)
    return { available: false, reason: 'request_failed', counts: {} }
  }
}
