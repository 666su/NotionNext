# Live2D 桌宠接入说明

本目录归档「灰白猫 Live2D 桌宠」的制作规格（PSD 拆件、Cubism 参数、制作流程）。
网站侧的运行时已经接好，模型文件一到即可自动启用。

## 目录

| 文件 | 用途 |
|---|---|
| `psd_layer_manifest.csv` | 交给角色美术师的 PSD 拆件清单（图层分组、遮挡、补绘要求） |
| `cubism_parameters.json` | 交给 Live2D 建模师的参数、范围、用途与物理分组 |
| `production_pipeline.md` | 从拆件到导出的制作流程与验收标准 |
| `STARTER_README.md` | 起始包原始说明 |

网站侧相关文件：

| 文件 | 作用 |
|---|---|
| `components/BlogPet/Live2DPet.js` | 运行时：探测模型 → 加载 SDK → 渲染 → 参数驱动 → 失败降级 |
| `components/BlogPet/live2dConfig.js` | 模型路径、运行时路径、参数 ID 映射、动作组名 |
| `public/live2d/README.md` | 模型与运行时文件放置说明 |
| `styles/blogPet.css` | `.blog-pet-live2d-canvas` 等样式 |

## 运行架构

```
BlogPet（右下角容器 + 拖拽/点击/菜单）
   └── Live2DPet（canvas，pointer-events: none）
         ├── ensureSdk()：Cubism Core → PIXI 6 → pixi-live2d-display(cubism4)
         └── Live2DModel.from(model3.json)
               ├── 参数：ParamAngleX/Y/Z、ParamEyeBallX/Y、ParamBreath…
               └── 动作：Idle / TapReaction
```

- 交互事件（点击开会话、长按拖动、右键菜单）由外层 `<button>` 处理，canvas 不拦截事件。
- 视线跟随：监听 `pointermove`，换算成 `ParamAngleX/Y`、`ParamEyeBallX/Y`，
  每帧向目标值插值，避免抖动。
- 墨镜上推：右键菜单「墨镜上推」→ `ParamGlassesUp` 在 0/1 之间平滑过渡。
- 参数名来自 `cubism_parameters.json`，在 `live2dConfig.js` 的 `parameters` 里集中映射，
  模型用了不同命名只需改这一处。

## 当前状态

| 项 | 状态 |
|---|---|
| 规格文档（PSD / 参数 / 流程） | 已归档 |
| 网站运行时与降级链路 | 已完成 |
| 动作帧精灵图（13 帧，含看烟花/吃东西） | 已生成，作为 Live2D 就绪前的展示方案 |
| 分层 PSD | 待美术制作 |
| `.moc3` / `.model3.json` | 待 Cubism 导出 |
| 墨镜露眼动作 | 依赖模型参数 `ParamGlassesUp` 与额头补绘图层 |

> 精灵图方案（`SpritePet.js` + `public/blog-pet/sprites/`）与 Live2D 方案共用同一套
> 情绪状态机：`idle / happy / thinking / talking / sleepy / walking / look / eating`。
> 模型到位后，`Live2DPet` 接管渲染，精灵图自动隐藏；模型缺失或运行时不可用时原样回退。

## 验收清单（模型到位后）

1. `curl -I` 模型入口返回 200；
2. 刷新页面，桌宠位置出现 canvas，不再是静态 PNG；
3. 鼠标在页面移动，头部与视线跟随；
4. 呼吸、耳朵、尾巴有轻微摆动（参数在模型里存在才会生效）；
5. 右键「墨镜上推」→ 墨镜上移、露出眼睛，无穿模；
6. 点击桌宠 → 打开对话，同时播放 `TapReaction`；
7. 关掉 `public/live2d/vendor` 任一文件并刷新 → 自动回退 PNG，控制台只有一条警告。
