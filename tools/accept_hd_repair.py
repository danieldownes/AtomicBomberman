"""Align a newly generated small repair sheet into review candidates; does not enable it."""
import json
import sys
from PIL import Image
from align_hd import OUT, SPRITES, original, register

job_id = sys.argv[1]
job = json.loads((OUT / (job_id + '.json')).read_text())
unit = job['unit']
page = Image.open(OUT / (job_id + '-generated.png')).convert('RGBA')
page = page.resize((job['cols'] * unit * 3, job['rows'] * unit * 3), Image.Resampling.LANCZOS)
records = []
for j, e in enumerate(job['entries']):
    x, y, w, h = SPRITES[e['name']]['frames'][e['frame']][:4]
    ref = original(e['name']).crop((x, y, x+w, y+h))
    full_ref = Image.new('RGBA', (unit, unit)); full_ref.paste(ref, (e['x'], e['y']))
    cx, cy = j % job['cols'] * unit * 3, j // job['cols'] * unit * 3
    generated = page.crop((cx, cy, cx + unit * 3, cy + unit * 3))
    fitted, stats = register(full_ref, generated)
    fitted = fitted.crop((e['x'] * 3, e['y'] * 3, (e['x']+w)*3, (e['y']+h)*3))
    folder = OUT / 'aligned' / e['name']; folder.mkdir(parents=True, exist_ok=True)
    fitted.save(folder / (str(e['frame']) + '.png'))
    records.append(dict(**e, **stats))
    print(e['name'], e['frame'], stats)
(OUT / (job_id + '-results.json')).write_text(json.dumps(records, indent=2))
