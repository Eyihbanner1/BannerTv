"""Build the BannerTV Prism Play brand files: SVG logos, PNG render jobs, tokens.

Usage: python3 -I brandgen.py <urbanist-bold.ttf> <out-dir>
"""
import json
import os
import sys

import uharfbuzz as hb
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

FONT, OUT = sys.argv[1], sys.argv[2]
font = TTFont(FONT)
glyphs = font.getGlyphSet()
UPM = font["head"].unitsPerEm
CAP = font["OS/2"].sCapHeight
hbfont = hb.Font(hb.Face(hb.Blob.from_file_path(FONT)))

# Palette. Dark is the TV default; "on light" is for web pages, docs and print.
DARK = {"top": "#C9B5FF", "bottom": "#7B4DFF", "left": "#4B23C8", "ink": "#F1EDFF", "accent": "#A98BFF"}
LIGHT = {"top": "#9C7BFF", "bottom": "#6A3BF0", "left": "#3D1AA8", "ink": "#0B0815", "accent": "#5B2FE0"}
NIGHT, TILE = "#0B0815", "#1B1430"

TRACKING = -36  # font units per glyph, about -0.018em
SPLIT = 6  # "Banner" is clusters 0-5, "TV" is 6-7
W_OVER_H = 58 / 72  # prism width to height
INNER = 20 / 58  # where the three facets meet, as a fraction of width
OPTICAL = 0.42  # point of the width that sits on the centre line


def f(n):
    return f"{n:.2f}".rstrip("0").rstrip(".")


def prism(x, y, h, c, opacity=None):
    """Three-facet play prism with its bounding box at (x, y), height h."""
    w = h * W_OVER_H
    a, b, tip, p = (x, y), (x, y + h), (x + w, y + h / 2), (x + w * INNER, y + h / 2)
    pts = lambda *ps: " ".join(f"{f(px)} {f(py)}" for px, py in ps)
    op = f' opacity="{opacity}"' if opacity is not None else ""
    # The full shape goes down first in the bottom colour so facet edges never show the background.
    return (
        f"<g{op}>"
        f'<path fill="{c["bottom"]}" d="M{pts(a, tip, b)}Z"/>'
        f'<path fill="{c["top"]}" d="M{pts(a, tip, p)}Z"/>'
        f'<path fill="{c["left"]}" d="M{pts(a, p, b)}Z"/>'
        "</g>"
    )


def prism_mono(x, y, h, gap):
    w = h * W_OVER_H
    a, b, tip, p = (x, y), (x, y + h), (x + w, y + h / 2), (x + w * INNER, y + h / 2)
    pts = lambda *ps: " ".join(f"{f(px)} {f(py)}" for px, py in ps)
    return (
        '<defs><mask id="facets" maskUnits="userSpaceOnUse">'
        '<rect x="-10" y="-10" width="200" height="200" fill="#fff"/>'
        f'<path d="M{pts(p, a)}M{pts(p, b)}M{pts(p, tip)}" stroke="#000" stroke-width="{f(gap)}"/>'
        "</mask></defs>"
        f'<path fill="currentColor" mask="url(#facets)" d="M{pts(a, tip, b)}Z"/>'
    )


def wordmark(size, c):
    """'BannerTV' as outlines with the pen at (0, 0) on the baseline. Returns svg and ink box."""
    buf = hb.Buffer()
    buf.add_str("BannerTV")
    buf.guess_segment_properties()
    hb.shape(hbfont, buf, {"kern": True, "liga": True})
    s = size / UPM
    x = 0
    parts = {False: [], True: []}
    x0 = y0 = float("inf")
    x1 = y1 = float("-inf")
    for info, pos in zip(buf.glyph_infos, buf.glyph_positions):
        name = font.getGlyphName(info.codepoint)
        gx, gy = x + pos.x_offset, pos.y_offset
        pen = SVGPathPen(glyphs, ntos=f)
        glyphs[name].draw(TransformPen(pen, (s, 0, 0, -s, gx * s, -gy * s)))
        parts[info.cluster >= SPLIT].append(pen.getCommands())
        bp = BoundsPen(glyphs)
        glyphs[name].draw(bp)
        if bp.bounds:
            bx0, by0, bx1, by1 = bp.bounds
            x0, x1 = min(x0, (gx + bx0) * s), max(x1, (gx + bx1) * s)
            y0, y1 = min(y0, -(gy + by1) * s), max(y1, -(gy + by0) * s)
        x += pos.x_advance + TRACKING
    svg = f'<path fill="{c["ink"]}" d="{"".join(parts[False])}"/><path fill="{c["accent"]}" d="{"".join(parts[True])}"/>'
    return svg, (x0, y0, x1, y1)


def doc(vb_w, vb_h, body, title, vb_x=0, vb_y=0):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{f(vb_x)} {f(vb_y)} {f(vb_w)} {f(vb_h)}" '
        f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>\n'
    )


def mark_svg(c):
    h = 72
    return doc(100, 100, prism(50 - OPTICAL * h * W_OVER_H, 14, h, c), "BannerTV")


def mono_svg():
    h = 72
    return doc(100, 100, prism_mono(50 - OPTICAL * h * W_OVER_H, 14, h, 3.6), "BannerTV")


def lockup_horizontal(c, size=100):
    cap = CAP * size / UPM
    h = 1.5 * cap
    w = h * W_OVER_H
    gap = 0.42 * h
    text, (x0, y0, x1, y1) = wordmark(size, c)
    ox = w + gap - x0
    top = -cap / 2 - h / 2
    m = 0.5 * cap
    left, right = -m, ox + x1 + m
    t, b = min(top, y0) - m, max(top + h, y1) + m
    body = prism(0, top, h, c) + f'<g transform="translate({f(ox)} 0)">{text}</g>'
    return doc(right - left, b - t, body, "BannerTV", left, t)


def lockup_stacked(c, size=100):
    cap = CAP * size / UPM
    h = 3.0 * cap
    w = h * W_OVER_H
    text, (x0, y0, x1, y1) = wordmark(size, c)
    tw = x1 - x0
    cx = max(tw, w) / 2
    baseline = h + 1.1 * cap + cap
    body = prism(cx - OPTICAL * w, 0, h, c) + f'<g transform="translate({f(cx - tw / 2 - x0)} {f(baseline)})">{text}</g>'
    m = 0.5 * cap
    return doc(max(tw, w) + 2 * m, baseline + y1 + 2 * m, body, "BannerTV", -m, -m)


def icon_svg(n, bg=TILE, scale=0.5):
    h = n * scale
    w = h * W_OVER_H
    body = f'<rect width="{n}" height="{n}" fill="{bg}"/>' + prism(n / 2 - OPTICAL * w, (n - h) / 2, h, DARK)
    return doc(n, n, body, "BannerTV")


def glow(id_, cx="50%", cy="46%", r="60%"):
    return (
        f'<defs><radialGradient id="{id_}" cx="{cx}" cy="{cy}" r="{r}">'
        f'<stop offset="0" stop-color="{TILE}"/><stop offset="1" stop-color="{NIGHT}"/></radialGradient></defs>'
        f'<rect width="1920" height="1080" fill="url(#{id_})"/>'
    )


def splash_svg():
    size = 128
    cap = CAP * size / UPM
    h = 3.0 * cap
    text, (x0, y0, x1, y1) = wordmark(size, DARK)
    total = h + 1.1 * cap + cap
    top = (1080 - total) / 2
    baseline = top + total
    body = (
        glow("g")
        + prism(960 - OPTICAL * h * W_OVER_H, top, h, DARK)
        + f'<g transform="translate({f(960 - (x1 - x0) / 2 - x0)} {f(baseline)})">{text}</g>'
    )
    return doc(1920, 1080, body, "BannerTV")


def launcher_svg():
    h = 980
    body = glow("g", "62%", "50%", "70%") + prism(1060, 50, h, DARK, opacity=0.22)
    return doc(1920, 1080, body, "BannerTV")


def write(rel, text):
    path = os.path.join(OUT, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        fh.write(text)
    return path


logo = {
    "logo/bannertv-mark.svg": mark_svg(DARK),
    "logo/bannertv-mark-on-light.svg": mark_svg(LIGHT),
    "logo/bannertv-mark-mono.svg": mono_svg(),
    "logo/bannertv-lockup-horizontal.svg": lockup_horizontal(DARK),
    "logo/bannertv-lockup-horizontal-on-light.svg": lockup_horizontal(LIGHT),
    "logo/bannertv-lockup-stacked.svg": lockup_stacked(DARK),
    "logo/bannertv-lockup-stacked-on-light.svg": lockup_stacked(LIGHT),
}
for rel, text in logo.items():
    write(rel, text)

# PNG jobs, rendered by render.js. Sources live outside the brand folder.
jobs = [
    {"svg": icon_svg(80), "w": 80, "h": 80, "out": "webos/icon_80.png"},
    {"svg": icon_svg(130), "w": 130, "h": 130, "out": "webos/icon_130.png"},
    {"svg": splash_svg(), "w": 1920, "h": 1080, "out": "webos/splash_1920x1080.png"},
    {"svg": icon_svg(400), "w": 400, "h": 400, "out": "store/icon_400.png"},
    {"svg": launcher_svg(), "w": 1920, "h": 1080, "out": "store/launcher_bg_1920x1080.png"},
    {"svg": mark_svg(DARK), "w": 512, "h": 512, "out": "logo/png/bannertv-mark-512.png", "transparent": True},
]
print(json.dumps(jobs))
