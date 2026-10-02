"""Make the Paper theme's texture: static/textures/paper.webp.

A seamless 1024px tile (shown at 512 CSS px, so it stays sharp on 2x
screens) of neutral grey around 50%, laid over a note with hard-light: what
is lighter than mid-grey lightens the note's colour, darker darkens it.

What makes it read as paper rather than noise:
  - formation: the cloudy, clumpy distribution of fibres you see holding a
    sheet to the light (several scales of periodic noise, slightly skewed);
  - fibres: thousands of short, gently curving strands at random angles,
    a few long ones, some lighter and some darker than the sheet;
  - tooth: the fine surface grain;
  - sizing: very slow unevenness across the sheet;
  - foxing: a handful of faint, soft age spots ("light distress").
Every noise is periodic (filtered in the frequency domain) and every fibre
is drawn wrapped around the tile's edges, so the tile repeats without seams.

Run: python scripts/make-paper.py   (numpy + Pillow)
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

N = 1024
rng = np.random.default_rng(20261002)


def pnoise(scale_px: float, seed: int) -> np.ndarray:
    """Periodic gaussian-filtered noise, unit std; features ~scale_px wide."""
    r = np.random.default_rng(seed)
    white = r.standard_normal((N, N))
    f = np.fft.fft2(white)
    k = np.fft.fftfreq(N)
    kx, ky = np.meshgrid(k, k)
    sigma = 1.0 / (2 * math.pi * scale_px)
    f *= np.exp(-(kx**2 + ky**2) / (2 * sigma**2))
    out = np.real(np.fft.ifft2(f))
    return (out - out.mean()) / out.std()


def fibres(count: int, length: tuple[float, float], width: tuple[float, float], seed: int) -> np.ndarray:
    """Curved strands, drawn at 2x and reduced (antialiased), wrapped."""
    r = np.random.default_rng(seed)
    S = N * 2
    img = Image.new("L", (S, S), 0)
    d = ImageDraw.Draw(img)
    for _ in range(count):
        x, y = r.uniform(0, S), r.uniform(0, S)
        ang = r.uniform(0, math.pi)
        L = r.lognormal(math.log(length[0]), 0.5)
        L = min(L, length[1]) * 2
        w = r.uniform(*width) * 2
        val = int(r.uniform(90, 255))
        steps = 6
        pts = []
        turn = r.normal(0, 0.18)
        for i in range(steps + 1):
            pts.append((x, y))
            ang += turn + r.normal(0, 0.08)
            x += math.cos(ang) * L / steps
            y += math.sin(ang) * L / steps
        for ox in (-S, 0, S):
            for oy in (-S, 0, S):
                xs = [p[0] + ox for p in pts]
                ys = [p[1] + oy for p in pts]
                if max(xs) < 0 or min(xs) > S or max(ys) < 0 or min(ys) > S:
                    continue
                d.line(list(zip(xs, ys)), fill=val, width=max(1, int(round(w))), joint="curve")
    img = img.filter(ImageFilter.GaussianBlur(0.6)).resize((N, N), Image.LANCZOS)
    a = np.asarray(img, dtype=np.float32) / 255.0
    return a


# -- formation: clumpy, a little skewed so it isn't plain fog
# (No large scales: they repeat visibly from tile to tile, and the note's own
# light and shade already vary it slowly.)
form = 0.5 * pnoise(7, 1) + 0.5 * pnoise(18, 2)
form = np.tanh(form * 0.9)

# -- fibres: many short, fewer long; lighter and darker families
light_f = fibres(4200, (16, 80), (0.8, 1.5), 11)
dark_f = fibres(2000, (14, 60), (0.7, 1.3), 12)
long_f = fibres(220, (70, 200), (0.9, 1.6), 13)

# -- tooth and sizing
tooth = pnoise(0.8, 4)
sizing = pnoise(40, 5)  # gentle, and small enough not to read as a repeat

# -- foxing: a few faint soft spots
fox = np.zeros((N, N), dtype=np.float64)
yy, xx = np.mgrid[0:N, 0:N]
for _ in range(9):
    cx, cy = rng.uniform(0, N, 2)
    rad = rng.uniform(4, 14)
    dx = np.minimum(np.abs(xx - cx), N - np.abs(xx - cx))
    dy = np.minimum(np.abs(yy - cy), N - np.abs(yy - cy))
    fox += np.exp(-(dx**2 + dy**2) / (2 * rad**2)) * rng.uniform(0.5, 1.0)

v = (
    0.16 * form
    + 0.18 * tooth
    + 1.25 * light_f
    - 0.40 * dark_f
    + 0.70 * long_f
    + 0.06 * sizing
    - 0.7 * fox
)
v = v - v.mean()
v = v / v.std()
# Inverted (the user's call, 2026-10-02): the fibres read as darker strands
# in the sheet and the formation's clumps as lighter patches.
v = -v
grey = np.clip(128 + v * 26, 0, 255).astype(np.uint8)

out_dir = os.path.join(os.path.dirname(__file__), "..", "static", "textures")
os.makedirs(out_dir, exist_ok=True)
path = os.path.join(out_dir, "paper.webp")
Image.fromarray(grey, "L").convert("RGB").save(path, "WEBP", quality=82, method=6)
print(path, os.path.getsize(path), "bytes; mean", grey.mean().round(1), "std", grey.std().round(1))
