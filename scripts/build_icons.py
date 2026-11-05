"""Draws the League Layer logo ("Sheet": two tilted Ls, the second a thin edge under the first).

Run after changing the shapes or colors: writes icons/logo.svg (the source), icons/favicon.svg (the
16 px cut, also inline in index.html's <link rel="icon">) and the three PNGs. Needs Pillow.
"""
from math import hypot
from pathlib import Path

from PIL import Image, ImageDraw

ICONS = Path(__file__).resolve().parent.parent / "icons"
TILE, MAIN, EDGE = "#161a22", "#ffffff", "#7f8a9c"  # the "Ink" palette
SIZE = 64  # 4 units = 1 pixel at 16 px
SAFE_R = 0.4 * SIZE  # a phone's crop never cuts inside this circle

# (8, 4) across and down is 2 px and 1 px at 16 px, so the slopes make even pixel stairs
SHEET = [[(36, 40), (56, 30), (44, 24), (36, 28), (20, 20), (8, 26)],
         [(8, 30), (36, 44), (56, 34), (56, 40), (36, 50), (8, 36)]]
# Browser tabs: a wider gap, or the two shapes run together at 16 px
SHEET_16 = [[(36, 37), (56, 27), (46, 22), (36, 27), (18, 18), (8, 23)],
            [(8, 31), (36, 45), (56, 35), (56, 43), (36, 53), (8, 39)]]


def enclosing(points):
    """Smallest circle around the points (Badoiu-Clarkson)."""
    cx, cy = SIZE / 2, SIZE / 2
    for i in range(1, 4000):
        far = max(points, key=lambda p: hypot(p[0] - cx, p[1] - cy))
        cx += (far[0] - cx) / (i + 1)
        cy += (far[1] - cy) / (i + 1)
    return cx, cy, max(hypot(p[0] - cx, p[1] - cy) for p in points)


def in_safe_zone(shapes):
    """The mark moved and scaled to just fill the circle every crop keeps."""
    cx, cy, r = enclosing([p for s in shapes for p in s])
    k = SAFE_R / r
    return [[(SIZE / 2 + (x - cx) * k, SIZE / 2 + (y - cy) * k) for x, y in s] for s in shapes]


def svg(shapes, radius=0):
    corner = f' rx="{radius}"' if radius else ""
    polys = "".join(
        f'<polygon points="{" ".join(f"{x:.2f},{y:.2f}".replace(".00", "") for x, y in s)}" fill="{c}"/>'
        for s, c in zip(shapes, (MAIN, EDGE)))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">'
            f'<rect width="{SIZE}" height="{SIZE}"{corner} fill="{TILE}"/>{polys}</svg>\n')


def png(shapes, size, name):
    big = size * 8  # drawn large, then scaled down for smooth edges
    img = Image.new("RGB", (big, big), TILE)
    draw = ImageDraw.Draw(img)
    for s, c in zip(shapes, (MAIN, EDGE)):
        draw.polygon([(x * big / SIZE, y * big / SIZE) for x, y in s], fill=c)
    img.resize((size, size), Image.LANCZOS).save(ICONS / name, optimize=True)


def main():
    home = in_safe_zone(SHEET)
    (ICONS / "logo.svg").write_text(svg(home), encoding="utf-8")
    (ICONS / "favicon.svg").write_text(svg(SHEET_16, radius=12), encoding="utf-8")
    png(home, 192, "icon-192.png")
    png(home, 512, "icon-512.png")
    png(home, 180, "apple-touch-icon.png")


if __name__ == "__main__":
    main()
