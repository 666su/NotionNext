/**
 * Live2D 运行时配置
 *
 * 约定：
 * - 模型目录：public/live2d/grey-white-cat/（Cubism Editor 导出的全部文件）
 * - 运行时优先使用 public/live2d/vendor/ 下自托管脚本，缺失时回退 CDN
 * - 模型文件不存在时，桌宠自动降级为静态立绘（public/blog-pet/catboy-idle.png）
 *
 * 说明：Cubism Core（live2dcubismcore.min.js）由 Live2D 官方发布，
 * 使用前需在 https://www.live2d.com/ 同意其许可协议，本仓库不内置该文件。
 */

export const LIVE2D_CONFIG = {
  enabled: process.env.NEXT_PUBLIC_BLOG_PET_LIVE2D !== 'false',

  // Cubism Editor 导出的模型配置入口
  modelUrl: '/live2d/grey-white-cat/grey-white-cat.model3.json',

  // 自托管运行时（推荐：把三个文件放到这里，避免外网依赖）
  vendor: {
    core: '/live2d/vendor/live2dcubismcore.min.js',
    pixi: '/live2d/vendor/pixi.min.js',
    display: '/live2d/vendor/cubism4.min.js'
  },

  // 回退 CDN（仅当 vendor 文件缺失时使用）
  cdn: {
    core: 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js',
    pixi: 'https://cdn.jsdelivr.net/npm/pixi.js@6.5.10/dist/browser/pixi.min.js',
    display: 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.4.0/dist/cubism4.min.js'
  },

  // 脚本加载超时（ms），超时即降级，不影响页面
  scriptTimeout: 12000,

  // 渲染基准尺寸（CSS 尺寸由桌宠尺寸决定，canvas 分辨率按 2 倍取）
  resolutionScale: 2,

  // 模型自适应：按最长边缩放到画布比例，底边居中站立
  fitRatio: 0.96,
  anchor: { x: 0.5, y: 1 },

  // Cubism 参数绑定（与 docs/live2d/cubism_parameters.json 保持一致）
  parameters: {
    angleX: 'ParamAngleX',
    angleY: 'ParamAngleY',
    angleZ: 'ParamAngleZ',
    bodyAngleZ: 'ParamBodyAngleZ',
    eyeL: 'ParamEyeLOpen',
    eyeR: 'ParamEyeROpen',
    eyeBallX: 'ParamEyeBallX',
    eyeBallY: 'ParamEyeBallY',
    mouthOpen: 'ParamMouthOpenY',
    mouthForm: 'ParamMouthForm',
    breath: 'ParamBreath',
    glassesUp: 'ParamGlassesUp',
    earL: 'ParamEarL',
    earR: 'ParamEarR',
    tail: 'ParamTail',
    bell: 'ParamBell'
  },

  // 动作组名（Cubism Editor 里导出的 motions 名称）
  motions: {
    idle: 'Idle',
    tap: 'TapReaction'
  }
}
