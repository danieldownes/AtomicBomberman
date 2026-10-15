"""Build the port's "Classic" arena: an 8-bit style level theme.

The players and the five power-up icons come from CLASSICS.ANI on the CD (an NES-style sprite set the
original never loads). The arena itself (floor, border, solid blocks, bricks and their break-up
animation, bombs and flames) is drawn here as original pixel art, at 2x scale like a 320x240 game.

Outputs  web/img/field11.png  and  web/data/classic.js (an extra sprite atlas, same format as sprites.js)
usage: build_classic.py web_dir
"""
import sys, os, io, json, base64, math, random
from PIL import Image, ImageDraw

WEB = sys.argv[1]
S = 2                                   # art pixel -> screen pixels
CW, CH, OX, OY = 40, 36, 20, 64
rnd = random.Random(1997)

PAL = {
    'K': (16, 16, 16), 'W': (252, 252, 252),
    'L': (200, 200, 208), 'M': (140, 140, 152), 'N': (112, 112, 124), 'D': (64, 64, 76),        # stone
    'h': (252, 196, 140), 't': (220, 132, 60), 's': (156, 80, 32), 'm': (72, 40, 24),           # brick
    'g': (56, 148, 48), 'G': (44, 124, 40), 'q': (32, 96, 32),                                   # grass
    'r': (216, 40, 0), 'o': (252, 116, 32), 'y': (252, 204, 60), 'w': (255, 248, 220),           # fire
    'b': (36, 36, 44), 'B': (88, 88, 104), 'c': (60, 120, 252), 'C': (140, 188, 252),            # bombs
}

def canvas(w, h): return Image.new('RGBA', (w, h), (0, 0, 0, 0))
def px(im, x, y, c):
    if 0 <= x < im.width and 0 <= y < im.height: im.putpixel((x, y), PAL[c] + (255,) if isinstance(c, str) else c)
def up(im): return im.resize((im.width * S, im.height * S), Image.NEAREST)

# ---------------------------------------------------------------- blocks (20 x 18 art pixels)
def solid_block():
    im = canvas(20, 21)                 # 3 extra rows: drop shadow onto the cell below
    for y in range(18):
        for x in range(20):
            c = 'M'
            if y == 0 or x == 0: c = 'L'
            if y >= 16 or x == 19: c = 'D'
            if 3 <= x <= 16 and 3 <= y <= 13:
                c = 'N' if (x in (3, 16) or y in (3, 13)) else 'M'
                if x == 3 or y == 3: c = 'D'
                if x == 16 or y == 13: c = 'L'
            px(im, x, y, c)
    for (x, y) in [(6, 6), (12, 9), (9, 11), (14, 5)]: px(im, x, y, 'L')
    for y in range(18, 21):
        for x in range(1, 20): px(im, x, y, (0, 0, 0, 90 - (y - 18) * 25))
    return im

def brick_block(seed=0):
    im = canvas(20, 18)
    r = random.Random(seed)
    for y in range(18):
        for x in range(20): px(im, x, y, 'm')
    rows = [(0, 4), (5, 9), (10, 13), (14, 17)]
    for ri, (y0, y1) in enumerate(rows):
        off = 0 if ri % 2 == 0 else 5
        for bx in range(-off, 20, 10):
            x0, x1 = max(0, bx + 1), min(19, bx + 9)
            for y in range(y0, y1 + 1):
                for x in range(x0, x1 + 1):
                    c = 't'
                    if y == y0: c = 'h'
                    elif y == y1 or x == x1: c = 's'
                    elif r.random() < 0.06: c = 's'
                    px(im, x, y, c)
    return im

def brick_break(base, state, n=9):
    """state 0..n-1: the brick flashes, cracks and crumbles into embers."""
    im = canvas(20, 18)
    f = state / (n - 1)
    r = random.Random(42)
    for y in range(18):
        for x in range(20):
            p = base.getpixel((x, y))
            if p[3] == 0: continue
            keep = r.random()
            if keep < f * 1.15: continue
            k = min(1, f * 1.6)
            fire = PAL['o'] if (x + y + state) % 3 else PAL['y']
            col = tuple(int(p[i] * (1 - k) + fire[i] * k) for i in range(3))
            if state == 1: col = tuple(min(255, c + 70) for c in col)
            # crumbling pieces fall a little
            dy = int(f * f * 5 * (0.5 + (x % 3) * 0.3))
            if 0 <= y + dy < 18: px(im, x, y + dy, col + (255,))
    if 2 <= state <= 6:
        for _ in range(6):
            px(im, r.randrange(20), r.randrange(18), 'w')
    return im

# ---------------------------------------------------------------- bombs (20 x 18)
def bomb(state, body='b', shine='B'):
    im = canvas(20, 18)
    rad = [6.6, 7.1, 7.5, 7.1][state % 4]
    cx, cy = 9.5, 10.5
    for y in range(18):
        for x in range(20):
            d = math.hypot(x - cx, y - cy)
            if d <= rad: px(im, x, y, 'K' if d > rad - 1 else body)
    for (x, y) in [(6, 7), (7, 7), (6, 8)]: px(im, x, y, 'W')
    px(im, 8, 7, shine); px(im, 7, 9, shine)
    # fuse cap and fuse
    for (x, y) in [(12, 3), (13, 3), (12, 4), (13, 4)]: px(im, x, y, 'B')
    for (x, y) in [(14, 2), (15, 1)]: px(im, x, y, 'h')
    spark = [('w', 'y'), ('y', 'o'), ('o', 'r'), ('y', 'w')][state % 4]
    px(im, 16, 0, spark[0]); px(im, 17, 1, spark[1]); px(im, 15, 0, spark[1]); px(im, 16, 2 - state % 2, spark[0])
    return im

def trigger_mark(im):
    for (x, y) in [(9, 9), (10, 9), (11, 9), (10, 10), (10, 11), (10, 12)]: px(im, x, y, 'r')
    return im

# ---------------------------------------------------------------- flames (20 x 18)
THICK = [4, 7, 10, 7, 4]
def band(im, horizontal, t, x0, x1, round_lo=False, round_hi=False):
    c0 = (9 if horizontal else 10) - t / 2
    for layer, col in enumerate(['r', 'o', 'y', 'w']):
        tt = t - layer * 2
        if tt <= 0: break
        lo, hi = c0 + layer, c0 + layer + tt
        for a in range(x0, x1):
            ins = 0
            if round_lo and a < x0 + tt / 2: ins = (x0 + tt / 2 - a)
            if round_hi and a >= x1 - tt / 2: ins = (a - (x1 - tt / 2 - 1))
            for b in range(int(math.floor(lo + ins * 0.6)), int(math.ceil(hi - ins * 0.6))):
                if horizontal: px(im, a, b, col)
                else: px(im, b, a, col)

def flame(kind, state):
    im = canvas(20, 18)
    t = THICK[state]
    if kind == 'center':
        band(im, True, t, 0, 20); band(im, False, t, 0, 18)
        r = t / 2 + 1
        for y in range(18):
            for x in range(20):
                d = math.hypot(x - 9.5, y - 8.5)
                if d < r: px(im, x, y, 'y' if d > r - 2 else 'w')
    elif kind == 'midwest' or kind == 'mideast': band(im, True, t, 0, 20)
    elif kind == 'midnorth' or kind == 'midsouth': band(im, False, t, 0, 18)
    elif kind == 'tipwest': band(im, True, t, 3, 20, round_lo=True)
    elif kind == 'tipeast': band(im, True, t, 0, 17, round_hi=True)
    elif kind == 'tipnorth': band(im, False, t, 3, 18, round_lo=True)
    elif kind == 'tipsouth': band(im, False, t, 0, 15, round_hi=True)
    return im

# ---------------------------------------------------------------- field (320 x 240 art)
def field():
    im = canvas(320, 240)
    for y in range(240):
        for x in range(320): px(im, x, y, 'K')
    ax0, ay0, aw, ah = OX // S, OY // S, 15 * CW // S, 11 * CH // S
    for y in range(ah):
        for x in range(aw):
            cy, cx = y // (CH // S), x // (CW // S)
            c = 'g' if (cx + cy) % 2 == 0 else 'G'
            lx, ly = x % (CW // S), y % (CH // S)
            if (lx * 7 + ly * 13 + cx * 5 + cy * 3) % 23 == 0: c = 'q'
            px(im, ax0 + x, ay0 + y, c)
    # stone border made of half-height blocks
    blk = solid_block().crop((0, 0, 20, 18)).resize((10, 10), Image.NEAREST)
    for bx in range(0, 320, 10):
        for by in (22, 230):
            im.alpha_composite(blk, (bx, by))
    for by in range(32, 230, 10):
        for bx in (0, 310):
            im.alpha_composite(blk, (bx, by))
    # HUD panel
    d = ImageDraw.Draw(im)
    d.rectangle([3, 3, 316, 21], fill=(0, 0, 0, 255), outline=PAL['M'] + (255,))
    d.rectangle([4, 4, 315, 20], outline=PAL['D'] + (255,))
    return up(im)

# ---------------------------------------------------------------- atlas
frames, seqs, tiles = [], {}, []
def add(img, hx, hy):
    frames.append([img, hx, hy]); return len(frames) - 1
def seq(name, states): seqs[name] = states

sb = up(solid_block()); seq('tile 11 solid', [[add(sb, 20, 35), 0, 0]])
bb_art = brick_block(3); bb = up(bb_art); seq('tile 11 brick', [[add(bb, 20, 35), 0, 0]])
seq('flame brick 11', [[add(up(brick_break(bb_art, s)), 20, 35), 0, 0] for s in range(9)])
for name, body, mark in [('nes bomb', 'b', False), ('nes bomb trigger', 'b', True), ('nes bomb jelly', 'c', False)]:
    ids = []
    for s in range(4):
        im = bomb(s, body, 'C' if body == 'c' else 'B')
        if mark: trigger_mark(im)
        ids.append(add(up(im), 20, 35))
    seq(name, [[ids[i], 0, 0] for i in [0, 0, 1, 1, 2, 2, 3, 3]])
for kind in ['center', 'midwest', 'mideast', 'midnorth', 'midsouth', 'tipwest', 'tipeast', 'tipnorth', 'tipsouth']:
    seq('nes flame ' + kind, [[add(up(flame(kind, s)), 20, 35), 0, 17] for s in range(5)])

# pack into one row-wrapped atlas
W, x, y, rowh, pos = 1024, 0, 0, 0, []
for im, hx, hy in frames:
    if x + im.width > W: x = 0; y += rowh + 1; rowh = 0
    pos.append((x, y)); x += im.width + 1; rowh = max(rowh, im.height)
atlas = canvas(W, y + rowh)
meta = []
for (im, hx, hy), (x, y) in zip(frames, pos):
    atlas.alpha_composite(im, (x, y)); meta.append([x, y, im.width, im.height, hx, hy])
buf = io.BytesIO(); atlas.save(buf, 'PNG', optimize=True)
flat = {k: [sum(([a, b, c] for a, b, c in [st]), []) for st in v] for k, v in seqs.items()}
out = {'classicarena': {'src': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode(), 'recolor': False,
                        'frames': meta, 'seqs': flat, 'size': list(atlas.size), 'key': [0, 0, 0], 'fx': 'none'}}
with open(os.path.join(WEB, 'data', 'classic.js'), 'w') as f:
    f.write('// "Classic" arena theme: original 8-bit pixel art drawn by tools/build_classic.py. Generated - do not edit.\n')
    f.write('Object.assign(window.AB_SPRITES, ' + json.dumps(out, separators=(',', ':')) + ');\n')
field().convert('RGB').save(os.path.join(WEB, 'img', 'field11.png'), optimize=True)
print('frames', len(frames), 'atlas', atlas.size, 'bytes', buf.tell())
