# Live2D 模型接入目录

桌宠会先探测本目录下的模型配置：

```
public/live2d/
├── grey-white-cat/
│   ├── grey-white-cat.model3.json   ← 入口，放置后自动启用 Live2D
│   ├── grey-white-cat.moc3
│   ├── grey-white-cat.physics3.json
│   ├── textures/
│   ├── motions/
│   └── expressions/
└── vendor/                          ← 运行时（可自托管，优先于 CDN）
    ├── live2dcubismcore.min.js
    ├── pixi.min.js
    └── cubism4.min.js
```

## 1. 放模型

用 Cubism Editor 导出「嵌入用」模型，把整个导出目录放到
`public/live2d/grey-white-cat/`，确保入口文件名与 `components/BlogPet/live2dConfig.js`
里的 `modelUrl` 一致（默认 `/live2d/grey-white-cat/grey-white-cat.model3.json`）。

只要这个 JSON 能通过 HTTP 访问（200），刷新页面后桌宠会自动从静态立绘切换成
Live2D；不需要改任何代码。

## 2. 放运行时（推荐自托管）

| 文件 | 来源 | 说明 |
|---|---|---|
| `live2dcubismcore.min.js` | Live2D 官方 Cubism Core | **需先在 live2d.com 同意其许可协议**，本仓库不内置 |
| `pixi.min.js` | `pixi.js@6.5.x` 的 `dist/browser/pixi.min.js` | MIT |
| `cubism4.min.js` | `pixi-live2d-display@0.4.0` 的 `dist/cubism4.min.js` | MIT |

三个文件都存在时完全离线可用；缺任意一个会尝试 CDN 兜底
（`live2dConfig.js` 里的 `cdn` 字段）。

> 版本对应关系：`pixi-live2d-display@0.4.0` 的 peer 依赖是 PIXI 6，
> 不要换成 PIXI 7，否则运行时初始化会失败。

## 3. 降级行为

以下任一情况都会**自动回退到静态立绘** `public/blog-pet/catboy-idle.png`，
不会出现空白桌宠，也不会向控制台抛未捕获异常：

- `model3.json` 不存在（404）
- 运行时脚本加载失败或超时（默认 12 秒）
- 模型解析失败（缺 moc3、纹理路径错误等）

控制台会打印一条 `[blog-pet] Live2D 不可用，回退静态立绘：…` 的警告，便于排查。

## 4. 校验

```powershell
# 模型入口可访问
curl.exe -I http://localhost:3000/live2d/grey-white-cat/grey-white-cat.model3.json
# 运行时脚本可访问
curl.exe -I http://localhost:3000/live2d/vendor/pixi.min.js
```

页面加载后，桌宠按钮内应出现 `<canvas class="blog-pet-live2d-canvas">`，
右键菜单里多出「墨镜上推」一项。
