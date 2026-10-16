"""Convert the original .ANI sprite files, .PCX backgrounds and .FON fonts for the web port.

Outputs:
  web/data/sprites.js  - window.AB_SPRITES = { aniName: {src, recolor, frames, seqs} }
  web/data/fonts.js    - window.AB_FONTS   = { fontN: {h, g:{charCode:[w,[rowbits...]]}} }
  web/img/*.png        - backgrounds / misc pictures from DATA/RES/*.PCX
"""
import sys, os, json, base64, io, glob, struct
sys.path.insert(0, os.path.dirname(__file__))
from export_ani import export
from fon import load as load_font
from PIL import Image

RAW, WEB = sys.argv[1], sys.argv[2]
ANI = os.path.join(RAW, 'DATA/ANI')

master = []
for l in open(os.path.join(ANI, 'MASTER.ALI'), 'rb').read().decode('latin1').splitlines():
    l = l.strip()
    if l.startswith('-'): master.append(l[1:].split('.')[0].lower())
# not in MASTER.ALI (never loaded by the original): the port uses the idle animations and the classic sprites
extra = ['classics', 'zen', 'headwipe', 'applbite', 'nuckblow']
KEYOUT = {'classics': (252, 84, 176)}   # 8-bit frames whose pink background was never keyed
RECOLOR = set(['walk', 'stand', 'kick', 'bombs', 'mflame', 'flame', 'triganim', 'duds', 'bombwalk', 'bpickup', 'punch'] +
              [f'pup{i}' for i in range(1, 5)] + [f'punbomb{i}' for i in range(1, 5)] + [f'bwalk{i}' for i in range(1, 5)] +
              [f'xplode{i}' for i in range(1, 18)] + [f'corner{i}' for i in range(8)] +
              ['classics', 'zen', 'headwipe', 'applbite', 'nuckblow'])

# enhanced-graphics treatment per atlas: 'glow' = fire rendered on black (luminance -> alpha),
# 'soft' = feather/matte silhouette edges, 'shadow' = translucent, 'none' = full-cell tiles/icons
FX = {'mflame': 'glow', 'flame': 'glow', 'shadow': 'shadow'}
SOFT = set(RECOLOR) | {'misc', 'aliens1', 'kface', 'hurry', 'kfont', 'bfont', 'classics', 'zen', 'headwipe', 'applbite', 'nuckblow'}
out = {}
total = 0
for name in master + extra:
    path = os.path.join(ANI, name.upper() + '.ANI')
    if not os.path.exists(path): continue
    atlas, meta = export(path)
    if name in KEYOUT:
        k = KEYOUT[name]; px = atlas.load()
        for yy in range(atlas.height):
            for xx in range(atlas.width):
                if px[xx, yy][:3] == k: px[xx, yy] = (0, 0, 0, 0)
        meta['key'] = list(k)
    buf = io.BytesIO(); atlas.save(buf, 'PNG', optimize=True)
    total += buf.tell()
    seqs = {}
    for sname, states in meta['seqs'].items():
        seqs[sname] = [sum(([s[0], s[1], s[2]] for s in st['s']), []) for st in states]
    out[name] = {'src': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode(),
                 'recolor': name in RECOLOR, 'frames': meta['frames'], 'seqs': seqs, 'size': list(atlas.size),
                 'key': meta['key'], 'fx': FX.get(name, 'soft' if name in SOFT else 'none')}
os.makedirs(os.path.join(WEB, 'data'), exist_ok=True)
with open(os.path.join(WEB, 'data/sprites.js'), 'w') as f:
    f.write('// Sprite atlases decoded from the original CHFILEANI (.ANI) files. Generated - do not edit.\n')
    f.write('// frames: [x, y, w, h, hotspotX, hotspotY]  seqs: name -> [[frame, dx, dy, ...], ...]\n')
    f.write('window.AB_SPRITES = ' + json.dumps(out, separators=(',', ':')) + ';\n')
print('sprites', len(out), 'png bytes', total)

fonts = {}
for i in (0, 1, 6):
    h, g = load_font(os.path.join(RAW, f'FONT{i}.FON'))
    fonts[f'font{i}'] = {'h': h, 'g': {c: [w, [int(r, 2) if r else 0 for r in rows]] for c, (w, rows) in g.items()}}
with open(os.path.join(WEB, 'data/fonts.js'), 'w') as f:
    f.write('// Bitmap fonts decoded from FONT0/1/6.FON. Rows are bit masks, MSB = leftmost pixel.\n')
    f.write('window.AB_FONTS = ' + json.dumps(fonts, separators=(',', ':')) + ';\n')

os.makedirs(os.path.join(WEB, 'img'), exist_ok=True)
n = 0
for p in glob.glob(os.path.join(RAW, 'DATA/RES/*.PCX')):
    im = Image.open(p).convert('RGB')
    im.save(os.path.join(WEB, 'img', os.path.basename(p)[:-4].lower() + '.png'), optimize=True); n += 1
print('pcx', n)

# the Aliens arena's floor (FIELD6.PCX) is much brighter than the sprites on it: darken its 15 x 11
# playing area (AB.OX/OY = 20/64, cells 40 x 36) by half, leaving the frame around it as it is
from PIL import ImageEnhance
f6 = os.path.join(WEB, 'img', 'field6.png')
if os.path.exists(f6):
    im = Image.open(f6).convert('RGB'); box = (20, 64, 20 + 15 * 40, 64 + 11 * 36)
    im.paste(ImageEnhance.Brightness(im.crop(box)).enhance(0.5), box); im.save(f6, optimize=True)

# menu cursor: BOMBDUDE.PCX with black keyed out
im = Image.open(os.path.join(RAW, 'DATA/RES/BOMBDUDE.PCX')).convert('RGBA')
px = im.load()
for y in range(im.height):
    for x in range(im.width):
        r, g, b, a = px[x, y]
        if r < 8 and g < 8 and b < 8: px[x, y] = (0, 0, 0, 0)
im = im.crop(im.getbbox())
im.save(os.path.join(WEB, 'img', 'bombdude_a.png'))
print('cursor', im.size)
