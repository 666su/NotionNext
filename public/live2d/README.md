# Live2D 接入（可选，默认关闭）

桌宠当前使用**动作帧精灵图**（`public/blog-pet/sprites/`），Live2D 是可选能力。
仓库不再内置任何 Live2D 模型与运行时文件，需要时按下面步骤自行放置。

## 启用步骤

1. 把 Cubism 导出的模型放到 `public/live2d/<model>/`，入口为 `model3.json`；
2. 把运行时放到 `public/live2d/vendor/`：
   - `live2dcubismcore.min.js`（Live2D Cubism Core，需遵守其许可）
   - `pixi.min.js`（PIXI 6.5.x）
   - `cubism4.min.js`（pixi-live2d-display 0.4.0）
3. 改 `components/BlogPet/live2dConfig.js`：
   - `modelUrl` 指向你的 `model3.json`
   - `parameters` 按模型的参数 ID 映射
   - `hiddenParts` 填要隐藏的部件（如背景）
4. 设置环境变量 `NEXT_PUBLIC_BLOG_PET_LIVE2D=true`；
5. 刷新页面，模型出现后精灵图自动隐藏。

## 关闭

默认即关闭；或显式设置 `NEXT_PUBLIC_BLOG_PET_LIVE2D=false`。

## 降级

模型 404、运行时脚本超时/报错、模型解析失败，都会自动回退精灵图，
控制台只打印一条 `[blog-pet] Live2D 不可用，回退静态立绘：…`。

## 授权

- Live2D 模型由各自的版权方授权（如需使用官方 Tororo/Hijiki 示例模型，
  请遵守 [Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html)）。
- `live2dcubismcore.min.js` 属 Live2D Cubism SDK 专有运行时，遵循 Live2D SDK 许可，
  **不受本仓库 MIT 许可覆盖**。
- PIXI / pixi-live2d-display 为 MIT。
