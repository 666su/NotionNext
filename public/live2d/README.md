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

## 模型交付自检

拿到模型后先跑：

```bash
python scripts/blog-pet/check_live2d_model.py --dir public/live2d/cat_boss
```

会检查：`model3.json` 是否合法、moc3/纹理/物理/动作文件是否齐全、
是否包含 `Idle` 与 `Tap` 动作组、是否配置了点击命中区（墨镜/项圈）、
是否有眨眼参数组，并列出本站 runtime 需要的参数名。

## 点击命中区约定

模型 `model3.json` 里的 `HitAreas` 采用：

```json
"HitAreas": [
  { "Name": "glasses", "Motion": ["click_glasses"] },
  { "Name": "collar",  "Motion": ["click_collar"] }
]
```

本站 runtime 会在点击命中时播放对应动作组；没有命中区则退化为打开对话。