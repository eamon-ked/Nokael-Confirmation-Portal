"""Rasterises the Android launcher icon (green "N" on navy) into the PWA icon PNGs.

Pure standard library, so it runs anywhere python3 does. The glyph path is copied
from app/src/main/res/drawable/ic_launcher_foreground.xml (108x108 viewport).
"""
import struct
import zlib
from pathlib import Path

NAVY = (0x0F, 0x17, 0x2A)
GREEN = (0x22, 0xC5, 0x5E)
# M34,32 h9.5 l21,28.5 V32 H74 v44 h-9.5 l-21,-28.5 V76 H34 z
GLYPH = [(34, 32), (43.5, 32), (64.5, 60.5), (64.5, 32), (74, 32), (74, 76), (64.5, 76), (43.5, 47.5), (43.5, 76), (34, 76)]
SS = 4  # supersamples per axis


def inside(x, y):
    hit = False
    j = len(GLYPH) - 1
    for i, (xi, yi) in enumerate(GLYPH):
        xj, yj = GLYPH[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            hit = not hit
        j = i
    return hit


def render(size, glyph_scale):
    """glyph_scale < 1 shrinks the glyph toward the centre (maskable safe zone)."""
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            cover = 0
            for sy in range(SS):
                for sx in range(SS):
                    # Map pixel -> 108 viewport, scaled about the centre.
                    vx = ((px + (sx + 0.5) / SS) / size * 108 - 54) / glyph_scale + 54
                    vy = ((py + (sy + 0.5) / SS) / size * 108 - 54) / glyph_scale + 54
                    cover += inside(vx, vy)
            a = cover / (SS * SS)
            row += bytes(round(n * (1 - a) + g * a) for n, g in zip(NAVY, GREEN))
        rows.append(bytes(row))
    raw = b"".join(rows)

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )


out = Path(__file__).resolve().parent.parent / "public" / "icons"
out.mkdir(parents=True, exist_ok=True)
for name, size, scale in [
    ("icon-192.png", 192, 1.3),
    ("icon-512.png", 512, 1.3),
    ("maskable-512.png", 512, 1.0),
    ("apple-touch-icon.png", 180, 1.3),
]:
    (out / name).write_bytes(render(size, scale))
    print("wrote", name)
