"""Relabel the main menu picture for the port: "Start Network Game" -> "Campaign Mode" and
"Join Network Game" -> "Network Game". The menu text is part of MAINMENU.PCX, so the new labels are
assembled from letters cut out of the picture itself (C is G without its bar, d is a mirrored b,
g is a mirrored p with a foot). usage: build_menu_image.py web/img/mainmenu.png out.png"""
import sys
import numpy as np
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = np.array(Image.open(src).convert('RGB')).astype(float)
R, G, B = im[..., 0], im[..., 1], im[..., 2]
alpha = np.clip((np.minimum(R, G) - B - 30) / 170, 0, 1)
TOPS = [114, 150, 187, 225, 261, 298, 335]
H = 32
SEGS = {
    1: [(358, 369), (374, 381), (384, 393), (398, 406), (409, 416), (430, 443), (448, 459), (463, 470), (472, 490), (493, 505), (509, 517), (520, 531), (545, 559), (563, 573), (577, 593), (597, 608)],
    2: [(357, 368), (372, 385), (389, 393), (398, 408), (423, 436), (441, 452), (456, 463), (465, 483), (486, 498), (502, 510), (513, 524), (538, 552), (556, 566), (570, 586), (590, 601)],
    3: [(358, 377), (381, 391), (396, 403), (406, 410), (415, 427), (431, 441), (445, 454)],
    4: [(357, 373), (377, 387), (390, 403), (407, 417), (422, 429), (443, 454), (458, 470), (475, 490), (495, 505), (508, 519), (523, 530), (534, 549), (553, 563), (568, 578)],
    5: [(358, 377), (381, 391), (396, 400), (405, 409), (414, 424), (428, 439), (452, 473), (476, 485), (490, 500), (505, 515), (519, 529), (534, 538)],
}
def glyph(line, i, pad=1):
    x0, x1 = SEGS[line][i]
    y0 = TOPS[line] - 3
    a = alpha[y0:y0 + H, x0 - pad:x1 + pad].copy()
    rgb = im[y0:y0 + H, x0 - pad:x1 + pad].copy()
    return [a, rgb]
def mirror(g): return [g[0][:, ::-1].copy(), g[1][:, ::-1].copy()]

TEXT = np.array([248, 232, 8], float)
L = {'a': glyph(1, 2), 'm': glyph(1, 14), 'p': glyph(3, 1), 'i': glyph(2, 2), 'n': glyph(2, 3), 'M': glyph(5, 6),
     'o': glyph(2, 1), 'e': glyph(1, 15), 'b': glyph(4, 1), 'G': glyph(1, 12)}
# C: the G's inward bar sits in the right half, middle rows; clear it
C = [L['G'][0].copy(), L['G'][1].copy()]
h, w = C[0].shape
inner = C[0][:, w // 2:]
cols = np.where(inner.max(0) > 0.5)[0]
# remove pixels right of the bowl's inner edge in the lower middle band
for y in range(h):
    row = C[0][y]
    if 0.42 * h < y < 0.86 * h:
        # keep the left stroke: first run of ink from the left
        x = 0
        while x < w and row[x] < 0.5: x += 1
        while x < w and row[x] >= 0.5: x += 1
        row[x + 1:] = 0
L['C'] = C
L['d'] = mirror(L['b'])
# g: a mirrored p (stem on the right, descender) plus a foot to the left at the bottom
q = mirror(L['p'])
a = q[0]; hh, ww = a.shape
ys = np.where(a.max(1) > 0.5)[0]; ybot = ys.max()
stem = np.where(a[ybot] > 0.5)[0]
for y in range(ybot - 2, ybot + 1):
    a[y, max(0, stem.min() - 6):stem.max() + 1] = np.maximum(a[y, max(0, stem.min() - 6):stem.max() + 1], 1.0 if y < ybot else 0.6)
L['g'] = q

def compose(base_rgb, y_top, x_start, word):
    x = x_start
    gap = {'t': 2, 'r': 2}
    prev = None
    for ch in word:
        if ch == ' ': x += 13; prev = None; continue
        if prev: x += gap.get(prev, 4)
        a, rgb = L[ch]
        hh, ww = a.shape
        y0 = y_top - 3
        reg = base_rgb[y0:y0 + hh, x:x + ww]
        aa = a[:, :, None]
        col = np.where(aa >= 0.85, rgb, TEXT[None, None, :])
        base_rgb[y0:y0 + hh, x:x + ww] = reg * (1 - aa) + col * aa
        x += ww - 2
        prev = ch
    return x

out = im.copy()
# replace the two lines with starfield taken from below the menu, minus its brighter/coloured stars
patch = im[377:377 + 30, 340:640].copy()
lum = patch.max(2)
base = np.median(patch.reshape(-1, 3), axis=0)
bright = (lum > 110) | (patch[..., 0] > patch[..., 2] + 10)
patch[bright] = base
for top in (TOPS[1], TOPS[2]):
    out[top - 4:top - 4 + 30, 340:640] = patch
compose(out, TOPS[1], 358, 'Campaign Mode')
# "Network Game" is the end of "Join Network Game", moved left
y0 = TOPS[2] - 4
seg = im[y0:y0 + 30, 420:606]
sa = alpha[y0:y0 + 30, 420:606][:, :, None]
dstx = 358 - 3
reg = out[y0:y0 + 30, dstx:dstx + seg.shape[1]]
out[y0:y0 + 30, dstx:dstx + seg.shape[1]] = reg * (1 - sa) + seg * sa
Image.fromarray(np.clip(out, 0, 255).astype('uint8')).save(dst, optimize=True)
print('ok')
