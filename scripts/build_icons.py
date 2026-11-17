"""Draws the League Layer logo ("Sheet": two tilted Ls, the second a thin edge under the first).

Run after changing the shapes or colors: writes icons/logo.svg (the source), icons/favicon.svg (the
16 px cut with no background, also inline in index.html's <link rel="icon">), the three PNGs and icons/og.png
(the picture a shared link shows: index.html's og:image). Needs Pillow.
"""
from math import hypot
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

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


def svg(shapes):
    polys = "".join(
        f'<polygon points="{" ".join(f"{x:.2f},{y:.2f}".replace(".00", "") for x, y in s)}" fill="{c}"/>'
        for s, c in zip(shapes, (MAIN, EDGE)))
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {SIZE} {SIZE}">'
            f'<rect width="{SIZE}" height="{SIZE}" fill="{TILE}"/>{polys}</svg>\n')


def favicon(shapes):
    """Just the two Ls, filling the tab's icon. The first follows the tab's color: white would vanish on a light tab."""
    main, edge = (" ".join(f"{x},{y}" for x, y in s) for s in shapes)
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="6 9.5 52 52">'
            f'<style>.a{{fill:{TILE}}}@media (prefers-color-scheme:dark){{.a{{fill:{MAIN}}}}}</style>'
            f'<polygon class="a" points="{main}"/><polygon fill="{EDGE}" points="{edge}"/></svg>\n')


def png(shapes, size, name):
    big = size * 8  # drawn large, then scaled down for smooth edges
    img = Image.new("RGB", (big, big), TILE)
    draw = ImageDraw.Draw(img)
    for s, c in zip(shapes, (MAIN, EDGE)):
        draw.polygon([(x * big / SIZE, y * big / SIZE) for x, y in s], fill=c)
    img.resize((size, size), Image.LANCZOS).save(ICONS / name, optimize=True)


FONT = ICONS.parent / "fonts" / "inter-latin.woff2"  # the site's own Inter (a variable font: weight 100-900)
CARD, LINE, SOFT, ORANGE, THEM = "#1f2531", "#2c3443", "#a3adbd", "#f97316", "#4b5567"


def inter(px, weight):
    f = ImageFont.truetype(str(FONT), px)
    f.set_variation_by_axes([weight])
    return f


def og_image(name="og.png"):
    """The picture a shared link shows (Discord, iMessage, Reddit, X...): 1200 x 630, the mark, the name and what the
    site does on the left, a matchup's categories on the right. Drawn twice as large, then scaled down."""
    W, H, S = 1200, 630, 2
    img = Image.new("RGB", (W * S, H * S), TILE)
    d = ImageDraw.Draw(img)
    z = lambda *v: [round(x * S) for x in v]

    # the mark, 3.2 px a unit, its top left corner at (80, 84)
    k, ox, oy = 3.2, 80 - 8 * 3.2, 84 - 20 * 3.2
    for s, c in zip(SHEET, (MAIN, EDGE)):
        d.polygon([(S * (ox + x * k), S * (oy + y * k)) for x, y in s], fill=c)
    d.text(z(78, 212), "League Layer", font=inter(84 * S, 700), fill=MAIN)
    for i, line in enumerate(("Plan your fantasy basketball", "or hockey week")):
        d.text(z(80, 330 + i * 52), line, font=inter(40 * S, 450), fill=SOFT)
    d.text(z(80, 506), "Free for Fantrax, ESPN and Sleeper leagues", font=inter(26 * S, 500), fill=EDGE)

    # a matchup's categories: yours orange, theirs grey
    x0, y0, x1, y1 = 700, 72, 1120, 558
    d.rounded_rectangle(z(x0, y0, x1, y1), radius=20 * S, fill=CARD, outline=LINE, width=2 * S)
    d.text(z(x0 + 28, y0 + 28), "This week", font=inter(24 * S, 600), fill=MAIN)
    d.text(z(x0 + 28, y0 + 62), "Win odds", font=inter(20 * S, 450), fill=SOFT)
    pct = inter(40 * S, 700)
    d.text((S * (x1 - 28) - d.textlength("68%", font=pct), S * (y0 + 30)), "68%", font=pct, fill=ORANGE)
    d.line(z(x0, y0 + 104, x1, y0 + 104), fill=LINE, width=2 * S)
    cats = [("PTS", .92, .80), ("REB", .70, .86), ("AST", .88, .62), ("3PM", .74, .66), ("STL", .55, .72),
            ("BLK", .64, .40), ("TO", .46, .60), ("FG%", .81, .77), ("FT%", .70, .84)]
    label, bx, bw = inter(19 * S, 600), x0 + 96, x1 - 28 - (x0 + 96)
    for i, (cat, you, them) in enumerate(cats):
        y = y0 + 126 + i * 40
        d.text(z(x0 + 28, y + 2), cat, font=label, fill=SOFT)
        d.rounded_rectangle(z(bx, y + 2, bx + bw * you, y + 12), radius=5 * S, fill=ORANGE)
        d.rounded_rectangle(z(bx, y + 16, bx + bw * them, y + 26), radius=5 * S, fill=THEM)
    img.resize((W, H), Image.LANCZOS).save(ICONS / name, optimize=True)


def main():
    home = in_safe_zone(SHEET)
    (ICONS / "logo.svg").write_text(svg(home), encoding="utf-8")
    (ICONS / "favicon.svg").write_text(favicon(SHEET_16), encoding="utf-8")
    png(home, 192, "icon-192.png")
    png(home, 512, "icon-512.png")
    png(home, 180, "apple-touch-icon.png")
    og_image()


if __name__ == "__main__":
    main()
