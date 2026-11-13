"""Add ComfyUI artwork to the cover-template library.

Reads picks from a JSON list of [source_png, id, name, blurb, [genres]], crops each to 2:3,
writes 600x900 art + 264x396 thumb into assets/covers/templates/, MEASURES palette and
type placement from the pixels, and prints the new entries as JSON for merging into
js/data/cover-templates.js (see the merge step in the session notes / merge_templates.mjs).

Run:  python -I tools/build_cover_templates.py picks.json out_entries.json
"""
import json, sys, colorsys
from pathlib import Path
from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "covers" / "templates"
INK, WHITE = "#16161a", "#ffffff"

def lum(rgb):
    r, g, b = [c / 255 for c in rgb]
    f = lambda c: c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)

def hexc(rgb): return "#%02x%02x%02x" % tuple(int(round(c)) for c in rgb)

def region(im, y0, y1):
    box = im.crop((60, int(im.height * y0), im.width - 60, int(im.height * y1))).convert("RGB")
    st = ImageStat.Stat(box.convert("L"))
    return tuple(ImageStat.Stat(box).mean), st.stddev[0]

def accent(im):
    small = im.convert("RGB").resize((64, 96))
    best, score = None, -1
    for px in small.quantize(8).convert("RGB").getcolors(10000):
        n, c = px
        h, s, v = colorsys.rgb_to_hsv(*[x / 255 for x in c])
        sc = n * s * (0.3 + v) if v > 0.2 else 0
        if sc > score: best, score = c, sc
    return hexc(best)

def build(src, tid, name, blurb, genres, idx):
    img = Image.open(src).convert("RGB")
    w, h = img.size
    nw = int(h * 2 / 3)
    if nw <= w:
        l = (w - nw) // 2; img = img.crop((l, 0, l + nw, h))
    else:
        nh = int(w * 3 / 2); t = (h - nh) // 2; img = img.crop((0, t, w, t + nh))
    art = img.resize((600, 900), Image.LANCZOS)
    art.save(OUT / f"{tid}.webp", "WEBP", quality=78, method=6)
    art.resize((264, 396), Image.LANCZOS).save(OUT / "thumbs" / f"{tid}.webp", "WEBP", quality=70, method=6)

    bg = tuple(ImageStat.Stat(art).mean)
    # title bands: the calmest of upper / middle / lower wins (lowest pixel variance)
    bands = {"upper": (0.08, 0.36), "middle": (0.36, 0.64), "lower": (0.60, 0.88)}
    stats = {k: region(art, *v) for k, v in bands.items()}
    pos = min(stats, key=lambda k: stats[k][1])
    mean, sd = stats[pos]
    ink = WHITE if lum(mean) < 0.36 else INK
    layout = {
        "title_position": pos,
        "title_align": ["center", "left"][idx % 3 == 0],
        "type_style": ["display", "serif", "sans", "condensed"][idx % 4],
        "title_case": "upper" if idx % 4 == 3 or idx % 5 == 0 else "none",
        "rule": idx % 2 == 0,
    }
    if sd > 38:  # busy behind the type: add a scrim that opposes the ink
        layout["scrim"] = "dark" if ink == WHITE else "light"
    bmean, _ = region(art, 0.88, 1.0)
    a_ink = WHITE if lum(bmean) < 0.36 else INK
    layout["author_scrim"] = "dark" if a_ink == WHITE else "light"
    return {
        "id": tid, "name": name, "blurb": blurb, "genres": genres,
        "image": f"/assets/covers/templates/{tid}.webp",
        "thumb": f"/assets/covers/templates/thumbs/{tid}.webp",
        "palette": {"background": hexc(bg), "title": ink, "subtitle": ink, "author": a_ink, "accent": accent(art)},
        "layout": layout,
    }

if __name__ == "__main__":
    picks = json.load(open(sys.argv[1], encoding="utf-8"))
    out = [build(*p, i) for i, p in enumerate(picks)]
    json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), indent=2)
    print(len(out), "templates written")
