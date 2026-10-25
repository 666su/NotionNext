/**
 * Blog Pet 桌宠全局配置
 *
 * 说明：
 * - 所有可调参数集中在这里，避免散落到各个组件
 * - 角色素材统一放在 public/blog-pet/ 下，替换图片只需改 asset 路径
 * - 仅使用 NEXT_PUBLIC_ 前缀的环境变量，确保客户端可读
 */

export const PET_STORAGE_KEY = 'blog-pet-settings-v1'

/** 自动气泡频率（off 表示关闭自动气泡） */
export const BUBBLE_FREQUENCIES = ['off', 'low', 'standard']

export const PET_CONFIG = {
  // 总开关：NEXT_PUBLIC_BLOG_PET_ENABLE=false 可整体关闭桌宠
  enabled: process.env.NEXT_PUBLIC_BLOG_PET_ENABLE !== 'false',

  // 角色名称与素材
  name: 'Jason 小猫',
  asset: '/blog-pet/catboy-idle.png',
  assetAlt: '戴墨镜的小猫男孩桌宠',

  // 显示尺寸（px）：移动端自动缩小，避免遮挡内容
  size: { desktop: 112, mobile: 84 },
  // 默认位置：距视口右侧 / 底部
  offset: { right: 20, bottom: 20 },
  // 桌宠与视口边缘的最小间距
  edge: 8,

  // 交互
  dragThreshold: 5, // 超过该位移才判定为拖动，避免误触发点击
  longPressMs: 650, // 移动端长按打开菜单
  longPressDragMs: 380, // 鼠标长按左键后进入拖动状态

  // 生命感：呼吸、摆动、偶尔散步、长时间无互动打瞌睡
  idle: { sleepAfter: 75000 },
  wander: {
    interval: [22000, 40000], // 自己走动的间隔区间（ms）
    range: 90, // 单次走动的最大位移（px）
    duration: 1500 // 走过去所需时间，与 CSS 过渡保持一致
  },

  // 悬浮对话框
  dialog: { width: 360, maxHeight: 460, gap: 14 },

  // 文章检索
  search: { limit: 6, maxTitleLength: 46 },
  api: { posts: '/api/blog-pet/posts' },

  // 自动气泡
  bubble: {
    firstDelay: [15000, 30000], // 首次出现延迟区间（ms）
    interval: {
      low: [90000, 150000],
      standard: [30000, 90000]
    },
    visibleFor: 6500, // 单条气泡停留时间
    maxHistory: 15 // 记忆最近多少条，避免重复
  },

  // 欢迎语
  welcome: [
    '你好呀，今天想看看什么内容？',
    '想找 Cloudflare、软路由，还是 DeepSeek Harness 相关的文章？',
    '告诉我关键词，我帮你翻翻博客。'
  ],

  // 文章数据暂不可用时的兜底提示
  fallbackTips: [
    '今天也来读点新东西吧！',
    '博客里有不少折腾记录，随便逛逛？',
    '点我试试，可以帮你找文章。'
  ]
}
