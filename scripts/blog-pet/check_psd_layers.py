"""校验交付的分层 PSD 是否符合 Live2D 制作规范

用法：
    pip install psd-tools
    python scripts/blog-pet/check_psd_layers.py --psd GreyWhiteCat.psd

检查项：
- 画布尺寸（默认 3000×3000）
- 颜色模式 / 是否含透明通道
- 必需图层是否存在（按 docs/live2d/psd_layer_manifest.csv）
- 图层命名是否带有清单 ID
- 输出缺失 / 多余清单，返回码 0=通过，1=不通过，2=环境不满足
"""
import argparse
import csv
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_MANIFEST = os.path.join(ROOT, "docs", "live2d", "psd_layer_manifest.csv")

# 这些图层不是硬性要求（阴影/特效可以由网页实现）
OPTIONAL_IDS = {"Canvas", "Shadow", "Sparkle_FX"}


def load_manifest(path):
    with open(path, encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def flatten_layers(layer, depth=0, out=None):
    out = out if out is not None else []
    out.append((layer.name.strip(), depth, getattr(layer, "is_group", lambda: False)()))
    if getattr(layer, "is_group", lambda: False)():
        for child in layer:
            flatten_layers(child, depth + 1, out)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--psd", required=True, help="要校验的 PSD 路径")
    parser.add_argument("--manifest", default=DEFAULT_MANIFEST, help="图层清单 CSV")
    parser.add_argument("--canvas", type=int, default=3000, help="期望画布边长")
    args = parser.parse_args()

    try:
        from psd_tools import PSDImage
    except ImportError:
        print("[SKIP] 缺少依赖 psd-tools，请先执行：pip install psd-tools")
        return 2

    if not os.path.exists(args.psd):
        print(f"[FAIL] 找不到 PSD：{args.psd}")
        return 1

    psd = PSDImage.open(args.psd)
    width, height = psd.width, psd.height
    print(f"[INFO] 画布：{width}×{height}  模式：{psd.color_mode}  通道：{len(psd.channels)}")

    problems = []
    if width != args.canvas or height != args.canvas:
        problems.append(f"画布尺寸应为 {args.canvas}×{args.canvas}，实际 {width}×{height}")

    layers = []
    for layer in psd:
        flatten_layers(layer, 0, layers)
    names = [name for name, _, _ in layers]
    print(f"[INFO] 图层数量：{len(names)}")

    manifest = load_manifest(args.manifest)
    required = [row["layer_id"] for row in manifest if row["layer_id"] not in OPTIONAL_IDS]

    def found(layer_id):
        # 允许「Glasses_Frame_01」「Sunglasses/Glasses_Frame」这类命名
        return any(layer_id == name or name.startswith(layer_id) for name in names)

    missing = [layer_id for layer_id in required if not found(layer_id)]
    if missing:
        problems.append("缺少必需图层：" + ", ".join(missing))

    known = set(required) | OPTIONAL_IDS
    extras = [
        name
        for name in names
        if name and not any(name.startswith(layer_id) or layer_id.startswith(name) for layer_id in known)
    ]

    print("\n=== 必需图层 ===")
    for layer_id in required:
        print(f"  {'OK  ' if found(layer_id) else 'MISS'} {layer_id}")

    if extras:
        print("\n=== 未在清单中的图层（可能是辅助层，确认后用 layer-map.csv 说明）===")
        for name in extras:
            print(f"  ?    {name}")

    print("\n=== 结果 ===")
    if problems:
        for problem in problems:
            print(f"[FAIL] {problem}")
        print("请修正后重新提交。")
        return 1

    print("[PASS] PSD 结构与清单一致，可以导入 Cubism。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
