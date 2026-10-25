"""从桌宠立绘生成动作帧精灵图

用法：
    python scripts/blog-pet/generate_sprites.py

输入：public/blog-pet/catboy-idle.png（透明背景，512×512）
输出：public/blog-pet/sprites/catboy-sprites.png / .webp（横向 13 帧）
      public/blog-pet/sprites/preview.png（深色底预览）

帧序（与 components/BlogPet/blogPetConfig.js 的 sprite.sequences 对应）：
    0 idle_a   1 idle_b   2 happy   3 thinking   4 sleepy
    5 walk_a   6 walk_b   7 talk_a  8 talk_b
    9 look_a  10 look_b  11 eat_a  12 eat_b

「张嘴」是按固定坐标补绘的（口腔 + 舌头 + 上唇高光），只用于说话和吃东西帧；
所有变换都以「底边中点」为锚点，保证脚不会离地。
"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "public", "blog-pet", "catboy-idle.png")
OUT_DIR = os.path.join(ROOT, "public", "blog-pet", "sprites")
CELL = 320
SUPERSAMPLE = 4

# 嘴部坐标（基于 512×512 立绘，实测口鼻位置）
MOUTH_CENTER = (368, 228)

# (名称, 旋转角度, 缩放, 垂直位移px[正数向下], 水平位移px, 张嘴程度 0~1)
FRAMES = [
    ("idle_a", 0.0, 1.0, 0, 0, 0.0),
    ("idle_b", -0.8, 1.012, -7, 0, 0.0),
    ("happy", 2.2, 1.045, -14, 1, 0.25),
    ("thinking", -3.0, 0.995, -3, -2, 0.0),
    ("sleepy", -4.5, 0.985, 8, -2, 0.0),
    ("walk_a", -2.6, 1.005, -3, -2, 0.0),
    ("walk_b", 2.6, 1.005, -8, 2, 0.0),
    ("talk_a", 0.6, 1.006, -2, 0, 0.15),
    ("talk_b", -0.6, 1.016, -7, 0, 0.7),
    ("look_a", -7.0, 1.0, -4, 0, 0.0),
    ("look_b", -8.5, 1.008, -9, 0, 0.0),
    ("eat_a", 1.2, 0.998, 2, -1, 1.0),
    ("eat_b", 2.6, 1.004, -3, 1, 0.25),
]


def with_mouth(base, openness):
    """在口鼻处补绘张开的嘴：越大越明显，0 表示原样"""
    if openness <= 0.02:
        return base
    big = base.resize(
        (base.width * SUPERSAMPLE, base.height * SUPERSAMPLE), Image.LANCZOS
    )
    draw = ImageDraw.Draw(big)
    cx, cy = MOUTH_CENTER[0] * SUPERSAMPLE, MOUTH_CENTER[1] * SUPERSAMPLE

    width = 40 * openness
    height = 26 * openness
    # 口腔
    draw.ellipse(
        [
            cx - width / 2 * SUPERSAMPLE,
            cy - height / 2 * SUPERSAMPLE,
            cx + width / 2 * SUPERSAMPLE,
            cy + height / 2 * SUPERSAMPLE,
        ],
        fill=(58, 40, 42, 255),
    )
    # 舌头
    tongue_w = width * 0.62
    tongue_h = height * 0.42
    draw.ellipse(
        [
            cx - tongue_w / 2 * SUPERSAMPLE,
            cy + height * 0.14 * SUPERSAMPLE,
            cx + tongue_w / 2 * SUPERSAMPLE,
            cy + (height * 0.14 + tongue_h) * SUPERSAMPLE,
        ],
        fill=(226, 122, 138, 255),
    )
    # 上唇高光，让嘴和白色口鼻区衔接自然
    lip_w = width * 0.78
    draw.ellipse(
        [
            cx - lip_w / 2 * SUPERSAMPLE,
            cy - height * 0.52 * SUPERSAMPLE,
            cx + lip_w / 2 * SUPERSAMPLE,
            cy - height * 0.32 * SUPERSAMPLE,
        ],
        fill=(247, 243, 240, 255),
    )
    return big.resize(base.size, Image.LANCZOS)


def make_frame(base, angle, scale, dy, dx, openness):
    """以底边中点为锚点缩放 / 旋转 / 平移"""
    canvas = Image.new("RGBA", base.size, (0, 0, 0, 0))
    w, h = base.size
    ax, ay = w / 2, h

    # 1) 以底边中点缩放
    if abs(scale - 1.0) > 1e-4:
        nw, nh = int(round(w * scale)), int(round(h * scale))
        scaled = base.resize((nw, nh), Image.LANCZOS)
        canvas.paste(
            scaled,
            (int(round(ax - nw / 2)), int(round(ay - nh))),
            scaled,
        )
    else:
        canvas.paste(base, (0, 0), base)

    # 2) 以底边中点旋转（expand 保持画布，避免放大尺寸）
    if abs(angle) > 1e-4:
        canvas = canvas.rotate(
            angle,
            resample=Image.BICUBIC,
            center=(ax, ay),
            expand=False,
        )

    # 3) 平移
    if dx or dy:
        moved = Image.new("RGBA", base.size, (0, 0, 0, 0))
        moved.paste(canvas, (int(round(dx)), int(round(dy))), canvas)
        canvas = moved

    return canvas


def main():
    base = Image.open(SRC).convert("RGBA")
    if base.size != (512, 512):
        base = base.resize((512, 512), Image.LANCZOS)

    os.makedirs(OUT_DIR, exist_ok=True)
    frames = [
        make_frame(with_mouth(base, openness), angle, scale, dy, dx, openness)
        for _, angle, scale, dy, dx, openness in FRAMES
    ]

    sheet = Image.new("RGBA", (CELL * len(frames), CELL), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        cell = frame.resize((CELL, CELL), Image.LANCZOS)
        sheet.paste(cell, (index * CELL, 0), cell)

    out = os.path.join(OUT_DIR, "catboy-sprites.png")
    sheet.save(out, "PNG", optimize=True)
    print("sprites:", out, os.path.getsize(out) // 1024, "KB", sheet.size)

    webp = os.path.join(OUT_DIR, "catboy-sprites.webp")
    sheet.save(webp, "WEBP", quality=90, method=6)
    print("sprites(webp):", webp, os.path.getsize(webp) // 1024, "KB")

    preview = Image.new("RGBA", sheet.size, (16, 18, 24, 255))
    preview.alpha_composite(sheet)
    preview_path = os.path.join(OUT_DIR, "preview.png")
    preview.convert("RGB").save(preview_path, "PNG")
    print("preview:", preview_path)


if __name__ == "__main__":
    main()
