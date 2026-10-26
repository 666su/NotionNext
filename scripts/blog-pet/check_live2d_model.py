"""校验交付的 Live2D 模型是否满足本站桌宠的接入要求

用法：
    python scripts/blog-pet/check_live2d_model.py --dir public/live2d/cat_boss

检查：
- model3.json 能否解析
- Moc / Textures / Physics / Pose / DisplayInfo 引用的文件是否存在
- motions 引用的文件是否存在
- 动作组是否覆盖本站需要的 Idle / Tap（可选 click_glasses / click_collar）
- 是否配置了 HitAreas（点击墨镜/项圈交互）
- 参数命名是否包含本站 runtime 映射的那几个（PARAM_* 或 Param*）
"""
import argparse
import json
import os
import sys

REQUIRED_MOTION_GROUPS = ["Idle", "Tap"]
OPTIONAL_MOTION_GROUPS = ["click_glasses", "click_collar", "GlassesUp", "Happy", "Sleepy", "LookUp", "Eat"]
PARAM_CANDIDATES = {
    "angleX": ["ParamAngleX", "PARAM_ANGLE_X"],
    "angleY": ["ParamAngleY", "PARAM_ANGLE_Y"],
    "eyeL": ["ParamEyeLOpen", "PARAM_EYE_L_OPEN"],
    "eyeR": ["ParamEyeROpen", "PARAM_EYE_R_OPEN"],
    "mouthOpen": ["ParamMouthOpenY", "PARAM_MOUTH_OPEN_Y"],
    "breath": ["ParamBreath", "PARAM_BREATH"],
}


def check_file(base, rel, label, problems):
    if not rel:
        return
    path = os.path.join(base, rel)
    if os.path.isfile(path):
        size = os.path.getsize(path)
        print(f"  OK   {label}: {rel} ({size // 1024} KB)")
    else:
        problems.append(f"{label} 引用文件不存在：{rel}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True, help="模型目录，例如 public/live2d/cat_boss")
    args = parser.parse_args()

    base = args.dir
    model_json = None
    for name in os.listdir(base) if os.path.isdir(base) else []:
        if name.endswith(".model3.json"):
            model_json = name
            break

    if not model_json:
        print(f"[FAIL] {base} 下没有 *.model3.json")
        return 1

    path = os.path.join(base, model_json)
    with open(path, encoding="utf-8-sig") as handle:
        try:
            model = json.load(handle)
        except json.JSONDecodeError as error:
            print(f"[FAIL] {model_json} 不是合法 JSON：{error}")
            return 1

    print(f"[INFO] 模型入口：{model_json}")
    problems = []
    refs = model.get("FileReferences", {})

    print("\n=== 文件引用 ===")
    check_file(base, refs.get("Moc"), "Moc", problems)
    check_file(base, refs.get("Physics"), "Physics", problems)
    check_file(base, refs.get("Pose"), "Pose", problems)
    check_file(base, refs.get("DisplayInfo"), "DisplayInfo", problems)
    for texture in refs.get("Textures", []) or []:
        check_file(base, texture, "Texture", problems)

    print("\n=== 动作组 ===")
    motions = refs.get("Motions", {}) or {}
    for group in REQUIRED_MOTION_GROUPS:
        if group in motions:
            print(f"  OK   {group}（{len(motions[group])} 个动作）")
            for entry in motions[group]:
                check_file(base, entry.get("File"), f"{group}", problems)
        else:
            problems.append(f"缺少必需动作组：{group}")
    for group in OPTIONAL_MOTION_GROUPS:
        if group in motions:
            print(f"  OK   {group}（可选，已提供）")
            for entry in motions[group]:
                check_file(base, entry.get("File"), group, problems)

    print("\n=== 点击命中区 ===")
    hit_areas = model.get("HitAreas", [])
    if hit_areas:
        for area in hit_areas:
            name = area.get("Name", "?")
            motion = area.get("Motion") or area.get("Motions") or []
            print(f"  OK   {name} -> {motion or '（未映射动作，将只触发默认反馈）'}")
    else:
        print("  WARN 未配置 HitAreas：点击墨镜/项圈不会有专属动作")

    groups = model.get("Groups", [])
    blink = any(g.get("Name") == "EyeBlink" for g in groups)
    print(f"  {'OK' if blink else 'WARN'} 眨眼参数组 EyeBlink{'已配置' if blink else '未配置'}")

    print("\n=== 参数命名提示 ===")
    print("  本站 runtime 默认映射以下参数（live2dConfig.js 可改）：")
    for key, candidates in PARAM_CANDIDATES.items():
        print(f"    {key}: {' / '.join(candidates)}")
    print("  若模型使用其他命名，改 live2dConfig.js 的 parameters 即可，不必改代码。")

    print("\n=== 结果 ===")
    if problems:
        for problem in problems:
            print(f"[FAIL] {problem}")
        return 1
    print("[PASS] 模型结构满足接入要求，可以放入 public/live2d/ 并启用。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
