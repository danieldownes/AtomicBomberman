#!/usr/bin/env python3
"""Find HD animation frames that don't match the original: a different pose, a doubled head or fuse
cap, a second rim, a part in the wrong place.

Each HD frame (web/hd/atlases/<name>.webp, 3x) is scaled back down to the original size and compared
with the CD's frame (web/data/sprites.js): both slightly blurred, so the remaster's new surface detail
doesn't count, only where things are. The score is how different the most different tenth of the
frame is (colour and coverage, 0..1). It finds candidates; a person (or a model) looking at the
side-by-side pictures judges. Atlases left out of the pack (ORIGINAL in tools/build_hd.cjs) are
checked too while their .webp is in web/hd/atlases, so a regenerated one can be checked before it
goes back in.

Usage (from the repository root; numpy, scipy, Pillow with WebP):
  python tools/check_hd_cels.py                 rank every HD frame: output/hd/check-cels.txt, and the
                                                60 worst side by side in output/hd/check-cels.png
  python tools/check_hd_cels.py --worst 120     the same, drawing the 120 worst
  python tools/check_hd_cels.py zen kick        every frame of those atlases, original above HD:
                                                output/hd/check-<name>.png, with each frame's score
"""
import base64, io, json, os, statistics, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
OUT = os.path.join(ROOT, 'output', 'hd')
SCALE = 3


def js_object(path, marker):
    s = open(os.path.join(WEB, path), encoding='utf-8').read()
    i = s.index(marker); j = s.index('{', i)
    return json.loads(s[j:s.rindex('}') + 1])


def premul(im, fx='none'):
    a = np.asarray(im.convert('RGBA')).astype(np.float64) / 255.0
    # the HD pack bakes the game's 'glow' (flames: brightness becomes coverage) and 'shadow'
    # (translucent) treatments into its frames (tools/build_hd.cjs); do the same to the original
    if fx == 'glow': a[..., 3] *= np.power(np.minimum(1, a[..., :3].max(-1) * 255 / 150), 0.85)
    if fx == 'shadow': a[..., 3] *= 110 / 255
    a[..., :3] *= a[..., 3:4]
    return a


class Atlas:
    def __init__(self, name, meta, src, scale, left_out, kept):
        self.name, self.meta, self.scale, self.left_out, self.kept = name, meta, scale, left_out, kept
        self.retro_im = Image.open(io.BytesIO(base64.b64decode(meta['src'].split(',', 1)[1]))).convert('RGBA')
        self.hd_im = Image.open(os.path.join(WEB, src)).convert('RGBA')
        self.retro = premul(self.retro_im, meta.get('fx', 'none'))

    def score(self, f):
        x, y, w, h = self.meta['frames'][f][:4]; k = self.scale
        if w < 2 or h < 2: return None
        o = self.retro[y:y + h, x:x + w]
        d = premul(self.hd_im.crop((x * k, y * k, (x + w) * k, (y + h) * k))).reshape(h, k, w, k, 4).mean(axis=(1, 3))
        ob = np.stack([gaussian_filter(o[..., c], 1.0) for c in range(4)], -1)
        db = np.stack([gaussian_filter(d[..., c], 1.0) for c in range(4)], -1)
        diff = np.abs(ob - db).max(axis=-1)
        mask = np.maximum(ob[..., 3], db[..., 3]) > 0.05
        if mask.sum() < 4: return None
        v = np.sort(diff[mask])
        return float(v[int(len(v) * 0.9):].mean())

    def pair(self, f, box):
        """the original (sharp pixels) and the HD frame, scaled to fit box (w, h)"""
        x, y, w, h = self.meta['frames'][f][:4]; k = self.scale
        s = min(box[0] / w, box[1] / h, 3); size = (max(1, int(w * s)), max(1, int(h * s)))
        r = self.retro_im.crop((x, y, x + w, y + h)).resize(size, Image.NEAREST)
        d = self.hd_im.crop((x * k, y * k, (x + w) * k, (y + h) * k)).resize(size, Image.LANCZOS)
        return [paper(r), paper(d)]


def paper(img):
    bg = Image.new('RGBA', img.size, (150, 140, 120, 255)); bg.alpha_composite(img)
    return bg.convert('RGB')


def atlases():
    sprites = js_object('data/sprites.js', 'AB_SPRITES')
    manifest = js_object('hd/manifest.js', 'AB_HD_MANIFEST')
    original = manifest.get('original', {})
    out = {}
    for name, meta in sprites.items():
        a = manifest['atlases'].get(name)
        src = a['src'] if a else 'hd/atlases/' + name + '.webp'
        if not os.path.exists(os.path.join(WEB, src)): continue
        kept = original.get(name) if isinstance(original.get(name), list) else []
        out[name] = Atlas(name, meta, src, a['scale'] if a else SCALE, not a, kept)
    return out


def rank(show):
    A = atlases(); rows = []
    for at in A.values():
        for f in range(len(at.meta['frames'])):
            if f in at.kept: continue
            s = at.score(f)
            if s is not None: rows.append((s, at.name, f))
    rows.sort(reverse=True)
    os.makedirs(OUT, exist_ok=True)
    with open(os.path.join(OUT, 'check-cels.txt'), 'w') as t:
        for s, name, f in rows:
            fr = A[name].meta['frames'][f]
            t.write(f'{s:.3f}  {name} {f}  {fr[2]}x{fr[3]}{"  (left out of the pack)" if A[name].left_out else ""}\n')
    print('frames compared:', len(rows))
    print('\nby atlas (median score, worst):')
    by = {}
    for s, name, f in rows: by.setdefault(name, []).append(s)
    for name in sorted(by, key=lambda n: -statistics.median(by[n])):
        print(f'  {name:14s} {len(by[name]):4d} frames  median {statistics.median(by[name]):.3f}  worst {max(by[name]):.3f}{"  (left out)" if A[name].left_out else ""}')
    CW, CH, cols = 260, 150, 4
    n = min(show, len(rows)); sheet = Image.new('RGB', (CW * cols, CH * ((n + cols - 1) // cols)), (40, 40, 48))
    dr = ImageDraw.Draw(sheet)
    for i, (s, name, f) in enumerate(rows[:n]):
        ox, oy = (i % cols) * CW, (i // cols) * CH
        r, d = A[name].pair(f, (120, 120))
        sheet.paste(r, (ox + 6, oy + 22)); sheet.paste(d, (ox + 132, oy + 22))
        dr.text((ox + 6, oy + 4), f'{name} {f}  {s:.2f}', fill=(255, 230, 120))
    path = os.path.join(OUT, 'check-cels.png'); sheet.save(path)
    print('\nworst', n, 'side by side (original left, HD right):', os.path.relpath(path, ROOT))


def sheets(names):
    A = atlases(); os.makedirs(OUT, exist_ok=True)
    for name in names:
        if name not in A: print(name + ': no HD atlas in web/hd/atlases'); continue
        at = A[name]; n = len(at.meta['frames'])
        CW, CH, cols = 96, 100, 12
        im = Image.new('RGB', (CW * cols, (CH * 2 + 6) * ((n + cols - 1) // cols)), (40, 40, 48)); dr = ImageDraw.Draw(im)
        scores = []
        for f in range(n):
            s = at.score(f); scores.append(s or 0)
            ox, oy = (f % cols) * CW, (f // cols) * (CH * 2 + 6)
            r, d = at.pair(f, (CW - 6, CH - 14))
            im.paste(r, (ox + 3, oy + 12)); im.paste(d, (ox + 3, oy + 12 + CH))
            tag = ' kept' if f in at.kept else ''
            dr.text((ox + 3, oy + 1), f'{f}  {s:.2f}{tag}' if s is not None else str(f), fill=(255, 230, 120))
        path = os.path.join(OUT, 'check-' + name + '.png'); im.save(path)
        worst = sorted(range(n), key=lambda f: -scores[f])[:8]
        print(f'{name}: {n} frames, median {statistics.median(scores):.3f}, worst ' + ', '.join(f'{f} ({scores[f]:.2f})' for f in worst)
              + ('  (left out of the pack)' if at.left_out else '') + '\n  ' + os.path.relpath(path, ROOT))


if __name__ == '__main__':
    args = sys.argv[1:]
    if args and args[0] == '--worst': rank(int(args[1]))
    elif args: sheets(args)
    else: rank(60)
