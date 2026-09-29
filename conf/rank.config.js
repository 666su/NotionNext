/**
 * 排行榜与点赞功能配置
 *
 * 新增功能：
 * 1. 文章查看次数排行榜（左侧栏上半部分）
 * 2. 文章点赞次数排行榜（左侧栏下半部分）
 * 3. 文章点赞按钮
 *
 * 数据存储：优先 Redis（REDIS_URL），回退本地文件
 */
module.exports = {
  // 总开关：关闭后左侧排行榜与点赞按钮都不显示
  RANK_ENABLE: process.env.NEXT_PUBLIC_RANK_ENABLE || true,

  // 查看次数统计开关（关闭后不记录浏览、不显示查看榜）
  RANK_VIEW_ENABLE: process.env.NEXT_PUBLIC_RANK_VIEW_ENABLE || true,

  // 点赞功能开关（关闭后不显示点赞按钮与点赞榜）
  RANK_LIKE_ENABLE: process.env.NEXT_PUBLIC_RANK_LIKE_ENABLE || true,

  // 排行榜每一边显示的条数
  RANK_LIST_SIZE: process.env.NEXT_PUBLIC_RANK_LIST_SIZE || 10,

  // 同一访客在同一篇文章上的重复浏览去重窗口（小时）
  // 设为 0 表示不去重，每次刷新都计数
  RANK_VIEW_WINDOW_HOURS: process.env.NEXT_PUBLIC_RANK_VIEW_WINDOW_HOURS || 6,

  // 榜单接口每次最多返回的候选文章数（受 Notion 数据量影响，不宜过大）
  RANK_MAX_CANDIDATES: process.env.NEXT_PUBLIC_RANK_MAX_CANDIDATES || 500,

  // 存储文件路径（仅在未配置 Redis 时使用）；留空则使用默认路径
  RANK_STORAGE_PATH: process.env.RANK_STORAGE_PATH || '',

  // 管理接口令牌：用于导入历史数据 / 重置计数
  // 留空则回退使用 REVALIDATION_TOKEN
  RANK_SEED_SECRET: process.env.RANK_SEED_SECRET || ''
}
