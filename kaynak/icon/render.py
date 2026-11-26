# Draws the Rung icon and writes every file the brief asks for (docs/gorsel-istekleri.md, section 2).
# The mark is the one in the site's top bar and in the app: two rails and three rungs on a 20-unit grid, the lowest
# rung yellow. Here it sits on a 64-unit square, scaled 2.5 times, with thicker strokes so it reads at 16-48 px.
# No library besides numpy: anti-aliasing from a distance field; PNG and ICO are written by hand.
#
#   python3 kaynak/icon/render.py          (from the repository root)
import os
import struct
import sys
import zlib

import numpy as np

BG = (0x0B, 0x0D, 0x10)
LIGHT = (0xEC, 0xEF, 0xF2)
ACCENT = (0xFF, 0xC2, 0x33)

# The mark on the 64-unit grid: (x1, y1, x2, y2, stroke width, colour), in drawing order (yellow on top).
RAIL_L, RAIL_R, TOP, BOTTOM = 19.5, 44.5, 12.0, 52.0
STROKES = [
    (RAIL_L, TOP, RAIL_L, BOTTOM, 5.0, LIGHT),
    (RAIL_R, TOP, RAIL_R, BOTTOM, 5.0, LIGHT),
    (RAIL_L, 20.75, RAIL_R, 20.75, 5.5, LIGHT),
    (RAIL_L, 32.0, RAIL_R, 32.0, 5.5, LIGHT),
    (RAIL_L, 43.25, RAIL_R, 43.25, 6.5, ACCENT),
]
# Android's adaptive icon keeps only the central 66% safe: the mark is drawn at 75% there (it then spans the
# central 53% of the height) on a transparent background; the background colour comes from app.json.
ADAPTIVE_SCALE = 0.75


def svg():
    parts = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">',
             '<rect width="64" height="64" fill="#0B0D10"/>',
             '<g stroke-linecap="round" fill="none">']
    for x1, y1, x2, y2, w, c in STROKES:
        parts.append('<path d="M%g %gL%g %g" stroke="#%02X%02X%02X" stroke-width="%g"/>' % (x1, y1, x2, y2, c[0], c[1], c[2], w))
    parts.append('</g></svg>')
    return "\n".join(parts) + "\n"


def render(size, background=True, scale=1.0):
    """A size×size RGBA array. scale shrinks the mark around the centre (for the adaptive icon)."""
    unit = 64.0 / size  # one pixel on the grid
    c = (np.arange(size) + 0.5) * unit
    X, Y = np.meshgrid(c, c)
    Xm = 32 + (X - 32) / scale  # grid point in the mark's own units
    Ym = 32 + (Y - 32) / scale
    px = unit / scale
    rgb = np.zeros((size, size, 3))
    alpha = np.zeros((size, size))
    if background:
        rgb[:] = np.array(BG) / 255.0
        alpha[:] = 1.0
    for x1, y1, x2, y2, w, col in STROKES:
        dx, dy = x2 - x1, y2 - y1
        L2 = dx * dx + dy * dy
        t = np.clip(((Xm - x1) * dx + (Ym - y1) * dy) / L2, 0, 1)
        d = np.hypot(Xm - (x1 + t * dx), Ym - (y1 + t * dy)) - w / 2
        a = np.clip(0.5 - d / px, 0, 1)  # one pixel of anti-aliasing
        colv = np.array(col) / 255.0
        out_a = a + alpha * (1 - a)
        with np.errstate(invalid="ignore", divide="ignore"):
            rgb = np.where(out_a[..., None] > 0, (colv * a[..., None] + rgb * alpha[..., None] * (1 - a[..., None])) / out_a[..., None], 0)
        alpha = out_a
    rgba = np.dstack([rgb, alpha])
    return (np.clip(rgba, 0, 1) * 255 + 0.5).astype(np.uint8)


def png_bytes(rgba):
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[y].tobytes() for y in range(h))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def ico_bytes(images):
    """images: [(size, png bytes)]. An ICO with embedded PNGs (valid since Windows Vista and in every browser)."""
    head = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries, blobs = b"", b""
    for size, data in images:
        entries += struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
        blobs += data
        offset += len(data)
    return head + entries + blobs


def main(root):
    def write(path, data):
        full = os.path.join(root, path)
        os.makedirs(os.path.dirname(full), exist_ok=True)
        with open(full, "wb") as f:
            f.write(data)
        print(path, len(data), "bytes")

    write("web/public/rung-icon.svg", svg().encode())
    write("web/app/favicon.ico", ico_bytes([(s, png_bytes(render(s))) for s in (16, 32, 48)]))
    write("web/app/icon.png", png_bytes(render(512)))
    write("web/app/apple-icon.png", png_bytes(render(180)))
    write("web/public/rung-icon.png", png_bytes(render(256)))
    write("app/assets/icon.png", png_bytes(render(1024)))
    write("app/assets/adaptive-icon.png", png_bytes(render(1024, background=False, scale=ADAPTIVE_SCALE)))
    write("app/assets/favicon.png", png_bytes(render(48)))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else ".")
