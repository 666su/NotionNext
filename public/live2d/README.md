# Live2D 模型与运行时

当前桌宠默认使用官方示例模型 **Hijiki（黑猫）**，Cubism 4 格式；另有 **Tororo（白猫）** 可通过环境变量切换。

```
public/live2d/
├── hijiki/                     ← 默认模型（黑猫）
├── tororo/                     ← 可选模型（白猫）
│   ├── tororo.model3.json
│   ├── tororo.moc3
│   ├── tororo.physics3.json
│   ├── tororo.pose3.json
│   ├── tororo.cdi3.json
│   ├── tororo.2048/texture_00.png
│   └── motion/*.motion3.json   （Idle / Tap / Flick / FlickUp / FlickDown）
└── vendor/                     ← 运行时（自托管，优先于 CDN）
    ├── live2dcubismcore.min.js
    ├── pixi.min.js             （PIXI 6.5.x）
    └── cubism4.min.js          （pixi-live2d-display 0.4.0）
```

## 授权说明

- **Hijiki / Tororo 模型**：© Live2D Inc.，随 [Live2D Free Material License](https://www.live2d.com/eula/live2d-free-material-license-agreement_en.html) 分发，仅用于本站展示，请勿单独转售或再分发素材。
- **Cubism Core（live2dcubismcore.min.js）**：属 Live2D Cubism SDK 的专有运行时，遵循 Live2D 的 SDK 许可，**不受本仓库 MIT 许可覆盖**。
- **PIXI / pixi-live2d-display**：MIT。

如果要换成自己的模型，把模型目录放进来、改
`components/BlogPet/live2dConfig.js` 的 `modelUrl` 与 `parameters` 映射即可。

## 运行逻辑

1. 页面加载后，桌宠先 `HEAD` 请求 `modelUrl`；
2. 返回 200 才加载 SDK（Core → PIXI → cubism4），随后渲染模型；
3. 模型就位后隐藏精灵图（`public/blog-pet/sprites/*`）；
4. 模型缺失 / 脚本失败 / 解析失败 → 自动回退精灵图，控制台只有一条警告；
5. 切换模型：`NEXT_PUBLIC_BLOG_PET_LIVE2D_MODEL=tororo`（默认 hijiki）；关闭 Live2D：`NEXT_PUBLIC_BLOG_PET_LIVE2D=false`。

## 校验

```powershell
curl.exe -I http://localhost:3000/live2d/tororo/tororo.model3.json   # 200
curl.exe -I http://localhost:3000/live2d/vendor/cubism4.min.js       # 200
```

页面加载后桌宠位置应是 `<canvas class="blog-pet-live2d-canvas">`，
右键菜单不显示「墨镜上推」（Tororo 没有该参数）。

## 换成灰白猫模型时

把 Cubism 导出的模型放到 `public/live2d/grey-white-cat/`，
改 `live2dConfig.modelUrl` 和 `parameters`（灰白猫按 `ParamAngleX` 等命名），
`hiddenParts` 留空。其余无需改动。
