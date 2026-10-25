# Cubism 绑定与导出方案（给 Live2D 建模师）

> 输入：分层 PSD（见 `ARTIST_BRIEF.md`）
> 输出：`grey-white-cat.model3.json` + `.moc3` + 纹理 + `physics3.json` + `motions/`
> 网页侧运行时已就绪（`components/BlogPet/Live2DPet.js`），模型放入
> `public/live2d/grey-white-cat/` 即自动启用。

## 一、参数清单

完整定义见 `cubism_parameters.json`，核心参数：

| 参数 ID | 范围 | 用途 | 主要绑定部件 |
|---|---|---|---|
| `ParamAngleX` | -30 ~ 30 | 头部左右转 | Head / Face / Ears / Glasses |
| `ParamAngleY` | -20 ~ 20 | 头部上下 | Head / Muzzle / Glasses |
| `ParamAngleZ` | -15 ~ 15 | 头部倾斜 | Head 整体 + 配饰补偿 |
| `ParamBodyAngleX` | -10 ~ 10 | 身体左右 | Body / Chest / Paws |
| `ParamBodyAngleZ` | -8 ~ 8 | 身体倾斜 | Body / Tail 根 |
| `ParamEyeLOpen` / `ParamEyeROpen` | 0 ~ 1 | 眨眼（左右独立） | 眼白/虹膜/瞳孔/高光/上眼睑 |
| `ParamEyeBallX` / `Y` | -1 ~ 1 | 视线 | 虹膜 + 瞳孔 |
| `ParamMouthOpenY` | 0 ~ 1 | 张嘴 | `Mouth_Closed` ↔ `Mouth_Open` |
| `ParamMouthForm` | -1 ~ 1 | 嘴角情绪 | 口鼻区形变 |
| `ParamGlassesUp` | 0 ~ 1 | **墨镜上推** | Glasses 整体 + Forehead_Fill |
| `ParamEarL` / `EarR` | -1 ~ 1 | 耳朵动作 | EarOuter/Inner |
| `ParamTail` | -1 ~ 1 | 尾巴摆动 | Tail 变形器 |
| `ParamBreath` | 0 ~ 1 | 呼吸 | Chest / Belly |
| `ParamBell` | -1 ~ 1 | 铃铛摆动 | Bell |
| `ParamPawL` / `PawR` | 0 ~ 1 | 抬爪 | Paw_Front_L/R |

> 网页端只认 `live2dConfig.js` 里 `parameters` 映射的这组 ID；
> 如果建模时改名，同步改那个文件即可，不需要改组件。

## 二、变形器层级

```
Deformer_Root
├── Deformer_Body
│   ├── Body / Chest / Belly / Collar
│   ├── Deformer_Paw_L / Deformer_Paw_R
│   └── Deformer_Tail（3~4 段连续弯曲）
├── Deformer_Head
│   ├── Face（Muzzle / Nose / Mouth / Whiskers）
│   ├── Deformer_Ear_L / Deformer_Ear_R
│   ├── Deformer_Eye_L / Deformer_Eye_R
│   └── Deformer_Glasses
│       ├── Glasses_Frame / Lens / Bridge / Arm
│       └── Forehead_Fill（随 GlassesUp 反向淡出隐藏）
└── Deformer_Bell
```

关键：`Forehead_Fill` 必须在 `Deformer_Glasses` 之下、`Head_Base` 之上；
`ParamGlassesUp=0` 时被墨镜完全遮住，`=1` 时随墨镜上移露出。

## 三、绑定顺序（按这个顺序做最省返工）

1. **头部转动**：`ParamAngleX/Y/Z` → 检查侧脸、耳根、脖子无缺口
2. **身体**：`ParamBodyAngleX/Z` + `ParamBreath`
3. **耳朵 / 尾巴**：先做 30% 幅度，再接物理
4. **眼睛**：`ParamEyeLOpen/R`、`ParamEyeBallX/Y`，在墨镜下方验证
5. **嘴型**：`ParamMouthOpenY` 驱动 `Mouth_Closed`/`Mouth_Open` 交叉淡化
6. **墨镜上推**：`ParamGlassesUp` 驱动 Glasses 变形器 + Forehead_Fill
7. **物理**：耳、尾、铃铛、随动
8. **动作**：Idle 循环 → TapReaction → GlassesUp

## 四、墨镜上推的实现要点

- `ParamGlassesUp = 0`：墨镜在原位，`Forehead_Fill` 透明度 0（被遮住也不可见）
- `ParamGlassesUp = 1`：Glasses 变形器整体上移约头高的 18%，略微缩小并倾斜 8°；
  镜腿向后收，`Forehead_Fill` 透明度 1
- 中间值必须做**中间关键形**，否则 0→1 过渡会出现镜腿穿模
- 眼睛在 `GlassesUp ≥ 0.6` 时才建议开始眨眼（否则墨镜后面眨眼看不见，白费性能）
- 墨镜推起后，`Forehead_Fill` 与 `Head_Grey_Cap` 的边缘需保持连续

## 五、物理设置

| 组 | 输入 | 建议 |
|---|---|---|
| 耳朵 | `ParamAngleX/Y`、`ParamEarL/R` | 幅度小、延迟短，避免抖 |
| 尾巴 | `ParamBodyAngleX/Z` | 2~3 段摆动，延迟递进 |
| 铃铛 | 身体移动 | 摆角小、频率低，防止高频抖动 |
| 头发/脸颊毛 | 头部转动 | 可选，幅度 ≤ 5° |

## 六、动作组（`.motion3.json`）

| 组名 | 触发 | 内容 |
|---|---|---|
| `Idle` | 常驻循环 | 呼吸 + 轻微摆头 + 尾巴/耳朵微动，3~4 秒循环 |
| `TapReaction` | 点击桌宠 | 抬头 + 耳朵竖起 + 张嘴，约 0.8 秒 |
| `GlassesUp` | 菜单「墨镜上推」 | 0→1 的墨镜推移，约 1 秒 |
| `Happy` | 检索成功 / 投喂 | 小幅弹跳 + 耳朵动 |
| `Sleepy` | 长时间无操作 | 头下沉、呼吸变慢 |
| `LookUp` | 看烟花 | 抬头仰望 + 眼睛高光 |
| `Eat` | 喂小鱼干 | 低头 + 张嘴咀嚼循环 |

网页端通过 `live2dConfig.motions` 映射组名：`idle` / `tap`；
其余动作可以在 `Live2DPet` 里按状态机调用 `model.motion('组名')`。

## 七、导出设置

- 纹理图集：2048×2048（超过 2048 需确认目标设备显存）
- 导出格式：`.moc3` + `.model3.json` + `physics3.json` + `motions/*.motion3.json`
- 模型名：`grey-white-cat`（与 `live2dConfig.modelUrl` 一致）
- 画布锚点：底边居中（网页按最长边自适应缩放，不需要在 Cubism 里预留画布边距）
- 建议先导出低配版（关闭物理、单纹理）验证网页链路，再导完整版

## 八、交付后网页验收（我来跑）

1. 模型放到 `public/live2d/grey-white-cat/`，刷新页面
2. 桌宠位置出现 canvas，不再是精灵图
3. 鼠标移动 → 头部/视线跟随（`ParamAngleX/Y`、`ParamEyeBallX/Y`）
4. 点击 → 打开对话 + 播放 `TapReaction`
5. 右键「墨镜上推」→ 墨镜上移露眼，无穿模
6. 右键「看烟花」→ 仰望动作 + 烟花
7. 右键「喂小鱼干」→ 张嘴咀嚼
8. 断网/删模型 → 自动回退精灵图，控制台只有一条警告

## 九、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 网页不显示模型 | `.model3.json` 路径或纹理路径错 | 用 `curl -I` 逐个确认返回 200 |
| 模型很小/很大 | 导出画布比例差异 | 网页按最长边自适应，若仍异常调 `live2dConfig.fitRatio` |
| 墨镜推起有缺口 | 缺 `Forehead_Fill` 或关键形不足 | 回 Cubism 补中间形 |
| 眨眼无效果 | 墨镜遮住且未设 `GlassesUp` 条件 | 按第四节处理 |
| 抖得厉害 | 物理幅度/频率过高 | 降幅度、加阻尼 |
