# 灰白猫桌宠 · 分层 PSD 制作交接说明（给角色美术师）

> 目标：产出可直接导入 Live2D Cubism Editor 的分层 PSD，使桌宠具备
> 头部转动、眨眼、张嘴、耳朵/尾巴摆动、**墨镜上推露眼**等动作。

## 一、角色基准

以博客现有头像 `public/images.jpg` 为唯一视觉基准，可参考已风格化的立绘
`public/blog-pet/catboy-idle.png`：

- 圆润灰白猫，短腿、厚脸颊、蓬松尾巴
- 灰色头顶与背部，白色鼻口区、胸口与爪子
- 粉色耳内、粉色鼻头
- 黑色墨镜（带蓝白反光）
- 红色项圈 + 金色铃铛（角色识别标志）

画风：二次元、轻拟人、干净平涂 + 少量渐变，**不要**写实厚涂。

## 二、画布与格式

| 项 | 要求 |
|---|---|
| 画布 | 3000 × 3000 px（正方形，角色居中偏下，底部留 ~6% 空间放阴影） |
| 颜色模式 | RGB / 8 bit，sRGB |
| 背景 | **透明**，不要把白底、地面投影合并进角色图层 |
| 格式 | `.psd`，图层保留、不合并、不栅格化文字/形状层 |
| 命名 | 使用 `psd_layer_manifest.csv` 里的图层 ID（英文），分组用同名 Group |

## 三、必须做到的三个硬性要求

这三条决定后面能不能“摘墨镜看烟花”，请优先保证：

1. **眼睛必须完整绘制，且与墨镜分属不同图层。**
   眼白、虹膜、瞳孔、高光、上眼睑各自独立；墨镜默认盖在眼睛上方，
   **不得**把眼睛和墨镜画在同一层，也不要用“闭眼贴图”冒充眼睛。
2. **墨镜下方需要额头补绘层（`Forehead_Fill`）。**
   墨镜推上去后露出的额头毛色与纹理要单独画一层，否则推起时会露底/穿帮。
3. **头部左右转动需要侧面补绘。**
   脸颊外侧、耳根、脖颈在旋转后会露出，必须补画（可多留 10–15% 余量）。

## 四、图层结构（按此顺序分组）

> 分区示意：docs/live2d/layer_reference.png（在现有立绘上用框标注了各部件大致范围，
> 只表示位置关系，不代表最终拆分精度）。

严格按 `psd_layer_manifest.csv` 的 `group` + `layer_id` 组织，顺序自上而下：

```
FX            （阴影，可选）
Sunglasses    Glasses_Frame / Lens_L / Lens_R / Bridge / Arm_L / Arm_R / Highlight_L / Highlight_R
Head          Forehead_Fill / Head_Base / Head_Grey_Cap / Cheek_Grey_L / Cheek_Grey_R
Ears          EarOuter_L/R / EarInner_L/R
Eyes          EyeWhite_L/R / Iris_L/R / Pupil_L/R / EyeHighlight_L/R / UpperLid_L/R
Face          Muzzle_White / Nose / Mouth_Closed / Mouth_Open / Whiskers_L/R
Body          Body_Base / Body_BackGrey / Chest_White / Belly_White / Neck_Fill
Legs          Leg_Back_L/R / Paw_Front_L/R
Tail          Tail_Base / Tail_GreyPatch / Tail_WhiteTip
Accessory     Collar_Red / Bell_Base / Bell_Highlight / Bell_Hole
Canvas        （透明画布，不放内容）
```

命名可以用团队约定，但**必须**在交付时给出一份 `图层名 ↔ CSV ID` 对照表，
否则绑定阶段要逐个猜。

## 五、交付物

1. `GreyWhiteCat.psd`（分层，3000×3000）
2. 每层导出的 PNG（可选，便于快速核对；放 `layers/` 目录）
3. `layer-map.csv`：实际图层名 → 清单 ID 的对照
4. 一张合成预览 PNG（透明背景 + 深色底各一张）
5. 一段 10 秒内的录屏或 3 张截图：墨镜推起前 / 推起中 / 推起后

## 六、验收清单

- [ ] 画布 3000×3000、透明背景、sRGB
- [ ] 所有 `psd_layer_manifest.csv` 中标记为必填的图层都存在
- [ ] 眼睛 5 类部件（眼白/虹膜/瞳孔/高光/眼睑）左右独立
- [ ] `Forehead_Fill` 存在，且颜色与周围额头毛色连续
- [ ] 墨镜的镜框、镜片、高光、镜腿可分别选中
- [ ] 头部、身体、尾巴、耳朵、前爪、铃铛都能单独选中
- [ ] 头转 ±30° 时没有透明缺口（用变形预览临时验证即可）
- [ ] 图层名与 `layer-map.csv` 一致

## 七、常见返工点

| 现象 | 原因 | 修正 |
|---|---|---|
| 墨镜推起后额头空一块 | 缺 `Forehead_Fill` 或未与头顶衔接 | 补绘并让边缘与 `Head_Grey_Cap` 有 20px 重叠 |
| 眨眼时眼睛变形 | 眼白与虹膜合层 | 拆分图层，眼睑单独一层 |
| 头转时脖子露底 | 缺 `Neck_Fill` / 侧面补绘 | 补画脖颈与耳根 |
| 尾巴摆动撕裂 | 尾尖与尾巴主体无重叠 | 白尾尖要与灰尾有 30px 以上重叠 |
| 墨镜边缘有白边 | 抠图时残留底色 | 用蒙版修边，不要用魔棒直接删 |

## 八、相关文件

- 图层清单：`docs/live2d/psd_layer_manifest.csv`
- 参数与绑定：`docs/live2d/cubism_parameters.json`、`docs/live2d/CUBISM_BINDING.md`
- 制作流程与验收：`docs/live2d/production_pipeline.md`
- 网页接入：`docs/live2d/INTEGRATION.md`
- PSD 自检脚本：`python scripts/blog-pet/check_psd_layers.py --psd GreyWhiteCat.psd`
