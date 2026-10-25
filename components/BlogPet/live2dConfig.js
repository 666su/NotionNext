/**
 * Live2D 运行时配置
 *
 * 当前使用官方示例模型 Hijiki（黑猫，© Live2D Inc.，Free Material License）。
 * 换成自己的模型时：把模型目录放到 public/live2d/<model>/，改这里的 modelUrl
 * 和 parameters 映射即可（参数 ID 因模型而异）。
 *
 * 说明：Cubism Core（live2dcubismcore.min.js）由 Live2D 官方发布，
 * 使用需遵守其许可协议；本仓库自托管在 public/live2d/vendor/ 下。
 */

export const LIVE2D_CONFIG = {
  enabled: process.env.NEXT_PUBLIC_BLOG_PET_LIVE2D !== 'false',

  // Cubism 4 模型入口；NEXT_PUBLIC_BLOG_PET_LIVE2D_MODEL=tororo 可切回白猫
  modelUrl:
    process.env.NEXT_PUBLIC_BLOG_PET_LIVE2D_MODEL === 'tororo'
      ? '/live2d/tororo/tororo.model3.json'
      : '/live2d/hijiki/hijiki.model3.json',

  // 自托管运行时（优先，避免外网依赖）
  vendor: {
    core: '/live2d/vendor/live2dcubismcore.min.js',
    pixi: '/live2d/vendor/pixi.min.js',
    display: '/live2d/vendor/cubism4.min.js'
  },

  // 回退 CDN（vendor 缺失时）
  cdn: {
    core: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
    pixi: 'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js',
    display: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js'
  },

  scriptTimeout: 12000,
  resolutionScale: 2,

  // 底边居中，按最长边自适应
  fitRatio: 0.92,
  anchor: { x: 0.5, y: 1 },

  // 模型里不需要显示的部件（只隐藏背景；SKETCH 是线稿，不能隐藏）
  hiddenParts: ['PARTS_01_BACKGROUND'],

  // Hijiki / Tororo 使用 PARAM_* 大写命名；换成别的模型时改这里
  parameters: {
    angleX: 'PARAM_ANGLE_X',
    angleY: 'PARAM_ANGLE_Y',
    angleZ: 'PARAM_ANGLE_Z',
    bodyAngleZ: 'PARAM_BODY_ANGLE_X',
    eyeL: 'PARAM_EYE_L_OPEN',
    eyeR: 'PARAM_EYE_R_OPEN',
    eyeBallX: 'PARAM_EYE_BALL_X',
    eyeBallY: 'PARAM_EYE_BALL_Y',
    mouthOpen: 'PARAM_MOUTH_OPEN_Y',
    mouthForm: 'PARAM_MOUTH_FORM',
    breath: 'PARAM_BREATH',
    earL: 'PARAM_EAR_L',
    earR: 'PARAM_EAR_R',
    tail: 'PARAM_TAIL',
    bell: '',
    glassesUp: ''
  },

  // 动作组名（Hijiki / Tororo 共用：Idle / Tap / FlickUp / FlickDown / Flick）
  motions: {
    idle: 'Idle',
    tap: 'Tap'
  }
}
