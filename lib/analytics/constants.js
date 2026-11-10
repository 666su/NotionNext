/**
 * 统计常量（纯常量，前后端共用，不得引入 node 内置模块）
 */

/** 事件白名单（服务端强制校验；不在列表内的一律丢弃） */
export const EVENT_NAMES = [
  'page_view',
  'session_start',
  'article_read',
  'scroll_depth',
  'article_complete',
  'search',
  'category_click',
  'tag_click',
  'outbound_click',
  'share_click',
  'comment_submit',
  'mascot_interaction'
]

export const SCROLL_BUCKETS = [25, 50, 75, 90]

/** 键前缀：与 admin / ISR 缓存 / rank / notify 严格分离 */
export const K = {
  pv: 'stats:v1:pv:',
  pvPath: 'stats:v1:pvpath:',
  pvArticle: 'stats:v1:pv:art:',
  uv: 'stats:v1:uv:',
  uvArticle: 'stats:v1:uv:art:',
  sessions: 'stats:v1:sess:',
  sessSeen: 'stats:v1:sessseen:',
  eventCount: 'stats:v1:events:',
  hour: 'stats:v1:hour:',
  entry: 'stats:v1:entry:',
  exit: 'stats:v1:exit:',
  sessLast: 'stats:v1:sesslast:',
  seenVisitor: 'stats:v1:seen:',
  newVisitor: 'stats:v1:new:',
  returningVisitor: 'stats:v1:returning:',
  dim: 'stats:v1:dim:',
  refHost: 'stats:v1:refhost:',
  depth: 'stats:v1:depth:',
  articleDepth: 'stats:v1:adepth:',
  search: 'stats:v1:search:',
  searchQuery: 'stats:v1:searchq:',
  outbound: 'stats:v1:outbound:',
  share: 'stats:v1:share:',
  active: 'stats:v1:active:',
  dedupe: 'stats:v1:evt:',
  rate: 'stats:v1:rl:',
  startedAt: 'stats:v1:meta:started',
  // Phase 4：Notion 只读快照
  articles: 'stats:v1:articles',
  slugmap: 'stats:v1:slugmap',
  // Phase 4：路径 → 文章 ID（只增不删，改名/换 URL 后历史仍可归属）
  pathMap: 'stats:v1:pathmap',
  articleMeta: 'stats:v1:meta:articles',
  syncLog: 'stats:v1:sync:log',
  // Phase 6：每日总结发送日志（最近 100 条）
  digestLog: 'stats:v1:digest:log'
}

/** 保留期（秒） */
export const TTL = {
  dedupe: 3600, // 事件去重 1 小时
  sessionSeen: 1800, // 会话首事件标记 30 分钟
  active: 720, // 实时活跃窗口 12 分钟
  rate: 60, // 限流窗口 1 分钟
  daily: 400 * 24 * 3600, // 日桶 400 天
  search: 30 * 24 * 3600, // 搜索词 30 天
  refHost: 90 * 24 * 3600, // 来源域名 90 天
  seenVisitor: 400 * 24 * 3600 // 新老访客标记 400 天
}

/** 单次请求上限 */
export const LIMITS = {
  maxEventsPerRequest: 20,
  maxBodyBytes: 8192,
  pagePathMaxLength: 200,
  propsMaxBytes: 1024,
  ratePerMinute: 120
}

/** 来源分类 */
export const SOURCE_CHANNELS = ['direct', 'internal', 'search', 'social', 'referral']

export const SEARCH_HOSTS = [
  'google',
  'bing',
  'baidu',
  'duckduckgo',
  'yahoo',
  'sogou',
  'so.com',
  'yandex',
  'ecosia',
  'naver',
  'qwant',
  'startpage'
]

export const SOCIAL_HOSTS = [
  't.co',
  'x.com',
  'twitter.com',
  'facebook.com',
  'instagram.com',
  'weibo.com',
  'zhihu.com',
  'reddit.com',
  't.me',
  'telegram.org',
  'discord.com',
  'linkedin.com',
  'youtube.com',
  'bilibili.com'
]
