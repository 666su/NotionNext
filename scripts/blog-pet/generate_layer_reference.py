"""生成分层参考图：在现有立绘上标注 PSD 拆件区域，交给美术师对照

输出：docs/live2d/layer_reference.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SRC = os.path.join(ROOT, "public", "blog-pet", "catboy-idle.png")
OUT = os.path.join(ROOT, "docs", "live2d", "layer_reference.png")

SCALE = 2
# (layer_id, x0, y0, x1, y1, 颜色)
BOXES = [
    ("EarOuter_L", 198, 42, 305, 155, (236, 72, 153)),
    ("EarOuter_R", 372, 52, 470, 158, (236, 72, 153)),
    ("Head_Base", 200, 95, 472, 300, (59, 130, 246)),
    ("Glasses_Frame", 208, 122, 462, 226, (17, 24, 39)),
    ("EyeWhite_L", 238, 148, 302, 206, (16, 185, 129)),
    ("EyeWhite_R", 340, 148, 404, 206, (16, 185, 129)),
    ("Muzzle_White", 252, 172, 432, 292, (245, 158, 11)),
    ("Nose", 350, 172, 388, 206, (244, 63, 94)),
    ("Mouth_Closed", 342, 212, 398, 248, (139, 92, 246)),
    ("Whiskers_L", 150, 178, 306, 286, (107, 114, 128)),
    ("Whiskers_R", 398, 178, 502, 286, (107, 114, 128)),
    ("Neck_Fill", 250, 276, 424, 336, (20, 184, 166)),
    ("Chest_White", 258, 286, 424, 392, (14, 165, 233)),
    ("Body_Base", 148, 246, 456, 474, (99, 102, 241)),
    ("Paw_Front_L", 246, 386, 326, 476, (34, 197, 94)),
    ("Paw_Front_R", 330, 386, 424, 476, (34, 197, 94)),
    ("Leg_Back_L", 138, 374, 252, 476, (132, 204, 22)),
    ("Tail_Base", 28, 318, 196, 478, (234, 179, 8)),
    ("Collar_Red", 268, 318, 424, 366, (220, 38, 38)),
    ("Bell_Base", 318, 344, 380, 398, (250, 204, 21)),
]


def load_font(size):
    for name in ("arialbd.ttf", "arial.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def main():
    base = Image.open(SRC).convert("RGBA")
    canvas = base.resize((base.width * SCALE, base.height * SCALE), Image.LANCZOS)

    # 浅色底，便于看清标注
    bg = Image.new("RGBA", canvas.size, (244, 246, 250, 255))
    bg.alpha_composite(canvas)
    draw = ImageDraw.Draw(bg, "RGBA")
    font = load_font(15)

    for layer_id, x0, y0, x1, y1, color in BOXES:
        box = [x0 * SCALE, y0 * SCALE, x1 * SCALE, y1 * SCALE]
        draw.rectangle(box, outline=color + (230,), width=2)

        label = layer_id
        text_w = draw.textlength(label, font=font)
        ty = max(2, box[1] - 20)
        tx = min(box[0], bg.width - text_w - 8)
        draw.rectangle(
            [tx - 4, ty - 3, tx + text_w + 4, ty + 17],
            fill=(255, 255, 255, 235),
            outline=color + (255,),
        )
        draw.text((tx, ty), label, font=font, fill=color + (255,))

    bg.convert("RGB").save(OUT, "PNG", optimize=True)
    print("saved:", OUT, bg.size)


if __name__ == "__main__":
    main()
