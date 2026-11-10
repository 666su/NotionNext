/**
 * 本地 SEO 自查（Phase 5）
 *
 * 只用**已有数据**做检查：Notion 快照里的标题/描述/分类/标签/时间 + 同源探测到的 robots/sitemap。
 * 不猜测、不编造曝光量或排名 —— 那些只可能来自 Google Search Console，未连接就是未连接。
 */

const TITLE_MIN = 8
const TITLE_MAX = 60
const STALE_DAYS = 365

function daysSince(timestamp) {
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || ts <= 0) return null
  return Math.floor((Date.now() - ts) / 86400000)
}

/**
 * @param {Array<object>} rows Notion 快照行
 * @returns {{rows: Array, summary: object}}
 */
export function auditArticles(rows = []) {
  const issues = []
  let missingSlug = 0
  let missingCategory = 0
  let noTags = 0
  let missingDescription = 0
  let shortTitle = 0
  let longTitle = 0
  let stale = 0

  const audited = rows.map(row => {
    const flags = []
    const title = String(row.title || '')
    const slug = String(row.slug || '')
    const description = String(row.description || '')
    const tags = Array.isArray(row.tags) ? row.tags : []
    const updatedDays = daysSince(row.updatedAt)

    if (!slug) {
      flags.push('缺 slug（无法生成稳定 URL）')
      missingSlug += 1
    }
    if (!row.category) {
      flags.push('未分类')
      missingCategory += 1
    }
    if (!tags.length) {
      flags.push('无标签')
      noTags += 1
    }
    if (!description.trim()) {
      flags.push('缺摘要（搜索结果描述会退化为自动截取）')
      missingDescription += 1
    }
    if (title.length > 0 && title.length < TITLE_MIN) {
      flags.push(`标题偏短（${title.length} 字符）`)
      shortTitle += 1
    }
    if (title.length > TITLE_MAX) {
      flags.push(`标题偏长（${title.length} 字符，可能被截断）`)
      longTitle += 1
    }
    if (updatedDays !== null && updatedDays > STALE_DAYS) {
      flags.push(`超过 ${STALE_DAYS} 天未更新（${updatedDays} 天）`)
      stale += 1
    }

    flags.forEach(flag => issues.push({ id: row.id, title, flag }))

    return {
      id: row.id,
      title,
      slug,
      url: row.url || (slug ? `/article/${slug}` : ''),
      category: row.category || '',
      tags: tags.length,
      titleLength: title.length,
      descriptionLength: description.trim().length,
      updatedDays,
      issues: flags
    }
  })

  return {
    rows: audited.sort((a, b) => b.issues.length - a.issues.length),
    summary: {
      total: rows.length,
      withIssues: audited.filter(row => row.issues.length > 0).length,
      missingSlug,
      missingCategory,
      noTags,
      missingDescription,
      shortTitle,
      longTitle,
      stale
    }
  }
}

/** GSC 的真实状态：本阶段只做"未连接"的诚实表达，不伪造搜索数据 */
export function readGscStatus() {
  const env = process.env
  const hasServiceAccount =
    !!env.GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL && !!env.GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY
  const siteUrl = env.GOOGLE_SEARCH_CONSOLE_SITE_URL || ''
  const configured = hasServiceAccount && !!siteUrl

  return {
    connected: false,
    configured,
    reason: configured ? 'not_implemented' : 'not_configured',
    siteUrl: siteUrl || null,
    requiredEnv: [
      'GOOGLE_SEARCH_CONSOLE_CLIENT_EMAIL',
      'GOOGLE_SEARCH_CONSOLE_PRIVATE_KEY',
      'GOOGLE_SEARCH_CONSOLE_SITE_URL'
    ],
    note: configured
      ? '凭证已配置，但本阶段未引入 googleapis 依赖与只读调用实现；页面不会显示任何推测数字。'
      : '尚未配置只读凭证；曝光量 / 点击量 / CTR / 平均排名一律显示"未连接"。'
  }
}
