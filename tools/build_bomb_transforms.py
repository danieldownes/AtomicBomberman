#!/usr/bin/env python3
"""HD bombs: how each original bomb frame is the biggest one, scaled or leaned.

The CD's bomb animations are one bomb drawn again and again: the regular and remote-trigger bombs
pulse (36 px down to 22 px and back), the jelly bomb leans from side to side, and the dud blinks
"DUD!". The HD remaster redrew every frame separately and the small ones came out wrong (two fuse
caps, clipped edges), so in HD the game draws only the biggest frame, moved by the transform that
turns it into each original frame. This finds those transforms, by fitting the biggest frame onto
each of the others (the original 640x480 frames, from web/data/sprites.js):

  frame's pixel (u', v') relative to its hotspot  =  ( sx*u + kx*v + tx ,  sy*v + ty )
  where (u, v) is the biggest frame's pixel relative to its own hotspot

(a scale, a lean of the top sideways, and a shift), choosing the five numbers that make the two
pictures most alike (least squared difference of the colours, premultiplied by coverage).
It prints the table js/render.js keeps as BOMB_XF.

Usage (from the repository root; numpy, scipy, Pillow):  python tools/build_bomb_transforms.py
"""
import base64, io, json, os, re
import numpy as np
from PIL import Image
from scipy.ndimage import map_coordinates
from scipy.optimize import minimize

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# atlas -> the atlas and frame used as the biggest picture
BASE = {'bombs': ('bombs', 0), 'triganim': ('triganim', 0), 'duds': ('bombs', 0)}


def sprites():
    s = open(os.path.join(ROOT, 'web', 'data', 'sprites.js'), encoding='utf-8').read()
    return json.loads(s[s.index('{'):s.rindex('}') + 1])


def atlas(S, name):
    im = Image.open(io.BytesIO(base64.b64decode(S[name]['src'].split(',', 1)[1]))).convert('RGBA')
    a = np.asarray(im).astype(np.float64) / 255.0
    a[..., :3] *= a[..., 3:4]                 # premultiplied, so uncovered pixels count as nothing
    return a


def cel(a, fr):
    x, y, w, h = fr[:4]
    return a[y:y + h, x:x + w]


def fit(base, bfr, tgt, tfr):
    """the five numbers mapping the base frame onto the target frame (both hotspot-relative)"""
    bw, bh, bhx, bhy = bfr[2], bfr[3], bfr[4], bfr[5]
    tw, th, thx, thy = tfr[2], tfr[3], tfr[4], tfr[5]
    M = 3                                     # compare a few pixels beyond the target frame too
    tpad = np.zeros((th + 2 * M, tw + 2 * M, 4)); tpad[M:M + th, M:M + tw] = tgt
    jj, ii = np.mgrid[0:th + 2 * M, 0:tw + 2 * M]
    up = ii - M - thx + 0.5; vp = jj - M - thy + 0.5      # target pixel centres, hotspot-relative

    def warp(p):
        sx, sy, kx, tx, ty = p
        v = (vp - ty) / sy
        u = (up - tx - kx * v) / sx
        bi = u + bhx - 0.5; bj = v + bhy - 0.5            # base pixel coordinates
        return np.stack([map_coordinates(base[..., c], [bj, bi], order=1, mode='constant', cval=0.0) for c in range(4)], -1)

    def loss(p):
        if p[0] <= 0.2 or p[1] <= 0.2: return 1e9
        return float(((warp(p) - tpad) ** 2).sum())

    s0 = tw / bw, th / bh
    p0 = [s0[0], s0[1], 0.0, -thx + s0[0] * bhx, -thy + s0[1] * bhy]
    best = None
    for kx in (0.0, -0.15, 0.15):             # the jelly frames lean: start from either side as well
        r = minimize(loss, [p0[0], p0[1], kx, p0[3] - kx * (bhy - bh / 2), p0[4]], method='Powell',
                     options={'xtol': 1e-4, 'ftol': 1e-7, 'maxfev': 20000})
        if best is None or r.fun < best.fun: best = r
    p = best.x
    covered = float(tpad[..., 3].sum())
    return [round(float(v), 4) for v in p], best.fun / max(covered, 1)


def tidy(rows, frames):
    """the pulsing frames as one uniform scale each, about one point (hotspot-relative) for the whole
    animation: the fit's small differences between frames would only make the bomb wobble"""
    sc = {f: (rows[f][0] + rows[f][1]) / 2 for f in frames}
    d = sum((1 - sc[f]) ** 2 for f in frames) or 1
    px = sum(rows[f][3] * (1 - sc[f]) for f in frames) / d
    py = sum(rows[f][4] * (1 - sc[f]) for f in frames) / d
    for f in frames: rows[f] = [round(sc[f], 4), round(sc[f], 4), 0.0, round(px * (1 - sc[f]), 4), round(py * (1 - sc[f]), 4)]
    return px, py


def main():
    S = sprites()
    table = {}
    for name, (bname, bf) in BASE.items():
        A, B = atlas(S, name), atlas(S, bname)
        bfr = S[bname]['frames'][bf]
        base = cel(B, bfr)
        rows = []
        for f, fr in enumerate(S[name]['frames']):
            p, err = fit(base, bfr, cel(A, fr), fr)
            rows.append(p)
            print(f'{name:9s} {f:2d}  {fr[2]}x{fr[3]}  sx {p[0]:.3f} sy {p[1]:.3f} lean {p[2]:+.3f} shift {p[3]:+.2f},{p[4]:+.2f}   misfit {err:.3f}')
        table[name] = rows
    for name, frames in (('bombs', range(10)), ('triganim', range(10))):
        px, py = tidy(table[name], frames)
        print(f'{name}: pulses about ({px:+.2f}, {py:+.2f}) from its hotspot')
    # a dud is the biggest bomb as it is (its "DUD!" frame differs only by the lettering, which
    # js/render.js draws over it)
    table['duds'] = [[1.0, 1.0, 0.0, 0.0, 0.0] for _ in S['duds']['frames']]
    print()
    print('  const BOMB_XF = ' + json.dumps(table, separators=(',', ':')) + ';')


if __name__ == '__main__':
    main()
