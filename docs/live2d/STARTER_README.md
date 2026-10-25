# 灰白猫 Live2D 桌宠 — 制作与接入起始包

本包是**制作规格与网页接入脚手架**，不是已经绑定完成的 Live2D 模型。

## 目录
- `spec/psd_layer_manifest.csv`：建议 PSD 图层清单、分组、遮挡与备注
- `spec/cubism_parameters.json`：建议 Cubism 参数、范围、用途与物理分组
- `docs/production_pipeline.md`：美术拆件、Cubism 建模、验收清单
- `web/index.html`：网站右下角桌宠容器示例
- `web/pet.css`：定位、尺寸、交互样式
- `web/pet.js`：Cubism SDK 接入占位脚手架
- `web/model-config.example.json`：模型路径配置示例

## 重要限制
当前包不包含 `.psd`、`.moc3`、`.model3.json`、`.physics3.json`、`.motion3.json` 或纹理图集，因为这些文件必须由实际绘制、Cubism Editor 建模/绑定和导出产生。`pet.js` 是接入结构示例，不会在缺少 Cubism SDK 和有效模型文件时凭空运行 Live2D。

## 推荐制作规格
- 角色画布：建议 3000 × 3000 px，透明背景，按实际构图调整
- PSD：RGB，8 bit，透明背景，所有部件命名清楚
- Cubism：建议先完成正面，再制作 Angle X/Y/Z；露眼动作应先独立验证
- 网站：默认宽 220–280 CSS px，高度自动；移动端可缩小
- 资源：优先由网站静态资源目录托管；按 Cubism SDK for Web 当前版本接入

## 开始使用
1. 把 `spec/psd_layer_manifest.csv` 交给角色美术师，作为拆件清单。
2. 把 `spec/cubism_parameters.json` 交给 Live2D 建模师，作为参数命名基准；可按团队规范调整。
3. 由建模师在 Cubism Editor 中创建模型、物理和动作并导出。
4. 按 `web/model-config.example.json` 修改模型资源路径，再根据所用 SDK 版本完成 `web/pet.js` 中的初始化适配。
