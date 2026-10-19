"""Pack visually approved cels as retained, reproducible HD atlas sources.

This is an explicit selection, never an automatic score threshold. Run after registration
and visual review. Existing unselected cels, logical rectangles and hotspots are preserved.
The runtime catalog is rebuilt separately with node tools/build_hd.cjs manifest.
"""
import json
import numpy as np
from PIL import Image, ImageDraw
from align_hd import ROOT, WORK, OUT, SPRITES, original

APPROVED = ['aliens1', 'applbite', 'nuckblow', 'corner0', 'corner1', 'corner2', 'corner3',
            'xplode1', 'xplode9', 'xplode13', 'kfont']
TARGET = WORK / 'repairs'
TARGET.mkdir(exist_ok=True)


def wall():
    im = Image.open(OUT / 'aliens-wall-generated.png').convert('RGBA')
    # Ignore nearly transparent generation dust when finding the tile's actual footprint.
    box = im.getchannel('A').point(lambda a: 255 if a > 128 else 0).getbbox()
    im = im.crop(box)
    folder = OUT / 'aligned/tiles6'; folder.mkdir(exist_ok=True)
    for i in [1, 2]:
        w, h = SPRITES['tiles6']['frames'][i][2:4]
        im.resize((w * 3, h * 3), Image.Resampling.LANCZOS).save(folder / f'{i}.png')


def conveyors():
    """Scalable rectangles: one shared bevel/material, exact original stripe phases.

    No independently generated pattern per state. Read the original panel boundaries and
    colours, then render the same rounded-lighting material at 3x for every stripe.
    """
    atlas = original('conveyor')
    folder = OUT / 'aligned/conveyor'; folder.mkdir(exist_ok=True)
    for i, (x, y, w, h, *_) in enumerate(SPRITES['conveyor']['frames']):
        ref = np.array(atlas.crop((x, y, x+w, y+h)))
        horizontal = i < 10
        line = ref[h//2, :, :3] if horizontal else ref[:, w//2, :3]
        im = Image.new('RGBA', (w*3, h*3), '#e5f1ff')
        dr = ImageDraw.Draw(im)
        start = 0
        for end in range(1, len(line)+1):
            if end < len(line) and np.array_equal(line[start], line[end]):
                continue
            colour = line[start].astype(float)
            if colour.min() < 240:
                # The shading is stationary across the belt; only the phase changes.
                for p in range((h if horizontal else w)*3-6):
                    t = p/max(1, (h if horizontal else w)*3-7)
                    rgb = tuple(np.clip(colour*(1-.18*t)+18*(1-t), 0, 255).astype(int))
                    if horizontal:
                        dr.line((start*3, p+3, end*3-1, p+3), fill=rgb+(255,))
                    else:
                        dr.line((p+3, start*3, p+3, end*3-1), fill=rgb+(255,))
            start = end
        dr.rectangle((0, 0, w*3-1, h*3-1), outline='#fafcff', width=1)
        im.save(folder / f'{i}.png')


def pack(name, indices, method):
    # Start with the shipped atlas so partial repairs cannot affect unrelated frames.
    src = TARGET / (name + '.png')
    if not src.exists():
        src = ROOT / 'web/hd/atlases' / (name + '.webp')
    atlas = Image.open(src).convert('RGBA')
    for index in indices:
        x, y, w, h = SPRITES[name]['frames'][index][:4]
        cel = Image.open(OUT / 'aligned' / name / f'{index}.png').convert('RGBA')
        if cel.size != (w*3, h*3):
            raise ValueError(f'{name}/{index}: incorrect dimensions')
        # Replace RGBA, including transparent pixels. Alpha-over would retain the old ghosts.
        atlas.paste(cel, (x*3, y*3))
    atlas.save(TARGET / (name + '.png'))
    return dict(source=f'repairs/{name}.png', frames=indices, method=method)


if __name__ == '__main__':
    wall(); conveyors()
    repairs = {name: pack(name, list(range(len(SPRITES[name]['frames']))),
                         'Whole-cell registration of saved imagegen output; individually reviewed')
               for name in APPROVED}
    repairs['xplode13']['method'] += '; cels 27,32,33,40 replaced with a padded four-cel imagegen sheet'
    for name, frames in [('extras', [4]), ('misc', [2, 11, 12, 13, 14, 15])]:
        repairs[name] = pack(name, frames, 'Registered imagegen output; reviewed teleport/ring/TV/whitebox repairs')
    repairs['tiles6'] = pack('tiles6', [1, 2], 'New imagegen reflective metal wall; no leaf, stem or veins')
    repairs['conveyor'] = pack('conveyor', list(range(18)), 'Shared procedural bevel and original stripe phases')
    repairs['mflame'] = pack('mflame', list(range(45)), 'Five connected imagegen blasts, sliced at original frame rectangles and offsets')
    (WORK / 'repairs.json').write_text(json.dumps(dict(version=1, atlases=repairs), indent=2)+'\n')
    print(f'Approved {sum(len(r["frames"]) for r in repairs.values())} cels in {len(repairs)} atlases')
