"""Create a small, widely padded reference for a replacement HD cel or up to four cels."""
import json
import sys
from pathlib import Path
from PIL import Image
from align_hd import OUT, SPRITES, original

name, *arguments = sys.argv[1:]
indices = [int(i) for i in arguments]
if not 1 <= len(indices) <= 4:
    raise ValueError('Use between one and four cels per reference')
meta = SPRITES[name]
unit = max(max(meta['frames'][i][2:4]) for i in indices) + 40
cols = 1 if len(indices) == 1 else 2
rows = (len(indices) + cols - 1) // cols
ref = Image.new('RGBA', (unit * cols, unit * rows))
atlas = original(name)
entries = []
for j, index in enumerate(indices):
    x, y, w, h = meta['frames'][index][:4]
    dx, dy = (unit - w) // 2, (unit - h) // 2
    ref.paste(atlas.crop((x, y, x+w, y+h)), (j % cols * unit + dx, j // cols * unit + dy))
    entries.append(dict(name=name, frame=index, x=dx, y=dy, width=w, height=h))
job_id = name + '-' + '-'.join(map(str, indices))
ref.resize((unit * cols * 6, unit * rows * 6), Image.Resampling.NEAREST).save(OUT / (job_id + '-reference.png'))
(OUT / (job_id + '.json')).write_text(json.dumps(dict(id=job_id, unit=unit, cols=cols, rows=rows, entries=entries), indent=2))
print(OUT / (job_id + '-reference.png'))
