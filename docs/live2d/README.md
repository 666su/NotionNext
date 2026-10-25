# Live2D 桌宠规格索引

本项目桌宠的 Live2D 制作与接入资料。按角色分工查阅：

| 角色 | 先看 | 再读 |
|---|---|---|
| 角色美术师 | [`ARTIST_BRIEF.md`](./ARTIST_BRIEF.md) | [`layer_reference.png`](./layer_reference.png)（分区示意图）、[`psd_layer_manifest.csv`](./psd_layer_manifest.csv)、[`production_pipeline.md`](./production_pipeline.md) |
| Live2D 建模师 | [`CUBISM_BINDING.md`](./CUBISM_BINDING.md) | [`cubism_parameters.json`](./cubism_parameters.json) |
| 前端 / 维护者 | [`INTEGRATION.md`](./INTEGRATION.md) | [`../../public/live2d/README.md`](../../public/live2d/README.md) |

## 当前进度

| 阶段 | 状态 |
|---|---|
| 网页运行时（自动切换 + 降级） | ✅ 已完成 |
| 动作帧精灵图（无模型时的展示） | ✅ 已生成 13 帧 |
| 分层 PSD | ⏳ 待美术交付 |
| Cubism 绑定 / moc3 | ⏳ 待建模交付 |
| 墨镜上推 / 眨眼 / 张嘴 | ⏳ 依赖模型参数 |

## 交付物放置位置

```
public/live2d/
├── grey-white-cat/          ← Cubism 导出的模型（model3.json 为入口）
└── vendor/                  ← 运行时：core / pixi / cubism4
```

模型 JSON 一出现，网页自动从精灵图切换到 Live2D，无需改代码。

## 自检命令

```bash
# 分层 PSD 结构校验（需 pip install psd-tools）
python scripts/blog-pet/check_psd_layers.py --psd GreyWhiteCat.psd

# 动作帧重新生成
python scripts/blog-pet/generate_sprites.py
```
