/**
 * AI 文本生成（Phase 6）
 *
 * 走 **OpenAI 兼容** 的 chat/completions 接口，默认指向 DeepSeek。
 * 设计原则：
 * - 未配置 key 时**不调用**、不伪造，返回 `{ ok:false, reason:'not_configured' }`；
 * - 提示词强制"只能使用给定数字"，避免模型编造；
 * - 超时 20 秒，失败只返回错误类别，不把上游报错原文丢给页面。
 */

const DEFAULT_BASE = 'https://api.deepseek.com/v1'
const DEFAULT_MODEL = 'deepseek-chat'
const TIMEOUT_MS = 20000

export function readAiConfig() {
  const apiKey = String(
    process.env.AI_API_KEY || process.env.DEEPSEEK_API_KEY || ''
  ).trim()
  const baseUrl = String(process.env.AI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, '')
  const model = String(process.env.AI_MODEL || DEFAULT_MODEL).trim()
  return {
    configured: !!apiKey,
    apiKey,
    baseUrl,
    model
  }
}

/**
 * @param {{ system: string, user: string, maxTokens?: number }} prompt
 * @returns {Promise<{ok:boolean, text?:string, model?:string, reason?:string}>}
 */
export async function completeChat({ system, user, maxTokens = 400 } = {}) {
  const config = readAiConfig()
  if (!config.configured) return { ok: false, reason: 'not_configured' }

  try {
    const response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user }
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
        stream: false
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })

    if (!response.ok) {
      console.error('[ai] upstream status:', response.status)
      return { ok: false, reason: `upstream_${response.status}` }
    }

    const data = await response.json()
    const text = String(data?.choices?.[0]?.message?.content || '').trim()
    if (!text) return { ok: false, reason: 'empty_response' }
    return { ok: true, text, model: config.model }
  } catch (err) {
    console.error('[ai] request failed:', err?.message || err)
    return { ok: false, reason: 'request_failed' }
  }
}

const SYSTEM_PROMPT = [
  '你是个人博客的运营分析助手。',
  '规则（必须遵守）：',
  '1. 只能使用用户提供的数字，绝对不要编造或推测任何未给出的数据；',
  '2. 如果某个数字为 0 或缺失，就直接说"暂无数据"，不要美化；',
  '3. 用中文输出 3-5 句要点，最后给 1 条具体、可执行的建议；',
  '4. 不要输出 Markdown 标题、表格或代码块，纯文本短句。'
].join('\n')

/**
 * 把统计事实压缩成给模型的输入（只给事实，不给指令性描述）
 */
export function buildDigestPrompt(facts) {
  const lines = [
    `日期：${facts.date}（Asia/Shanghai）`,
    `PV：${facts.pv}，UV：${facts.uv}，Session：${facts.sessions}`,
    `前一日 PV：${facts.prevPv === null ? '无数据' : facts.prevPv}`,
    `首次访客浏览：${facts.newVisitors}，回访浏览：${facts.returningVisitors}`,
    `阅读深度（25/50/75/90/读完）：${facts.depth.d25}/${facts.depth.d50}/${facts.depth.d75}/${facts.depth.d90}/${facts.depth.complete}`,
    `站内搜索次数：${facts.searchTotal}`,
    `热门页面：${facts.topPages.map(p => `${p.path} ${p.views}`).join('；') || '无'}`,
    `热门文章：${facts.topArticles.map(a => `${a.title} ${a.pv}`).join('；') || '无'}`,
    `来源：${facts.sources.map(s => `${s.name} ${s.value}`).join('；') || '无'}`,
    `搜索词：${facts.searchTerms.map(t => `${t.term} ${t.count}`).join('；') || '无'}`,
    `近 7 天 PV：${facts.sparkline.map(item => item.pv).join(',')}`
  ]
  return lines.join('\n')
}

export async function summarizeDigest(facts) {
  return completeChat({
    system: SYSTEM_PROMPT,
    user: buildDigestPrompt(facts),
    maxTokens: 400
  })
}
