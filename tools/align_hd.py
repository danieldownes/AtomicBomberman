#!/usr/bin/env python3
"""Reviewable registration of generated cels, without changing runtime selection.

Reads the original references and the saved imagegen pages. Each whole generated cell is
fitted to its original using colour/coverage correlation, before extracting the sprite.
Outputs candidates and comparisons under output/hd/repair; approval is a separate step.
Requires numpy and Pillow. Usage: python tools/align_hd.py zen [0 18 ...]
"""
import base64
import io
import json
import math
import os
import sys
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'output/hd'
OUT = WORK / 'repair'
OUT.mkdir(parents=True, exist_ok=True)
cache = OUT / 'sprites.json'
if not cache.exists() or any((ROOT / ('web/data/' + n + '.js')).stat().st_mtime > cache.stat().st_mtime for n in ['sprites', 'classic']):
    cache.write_bytes(subprocess.check_output(['node', '-e', "const fs=require('fs'),vm=require('vm'),c={window:{}};vm.createContext(c);for(const n of ['sprites','classic'])vm.runInContext(fs.readFileSync('web/data/'+n+'.js','utf8'),c);process.stdout.write(JSON.stringify(c.window.AB_SPRITES));"], cwd=ROOT))
SPRITES = json.loads(cache.read_text())
JOBS = json.loads((WORK / 'jobs.json').read_text())
PAGES = {}


def original(name):
    return Image.open(io.BytesIO(base64.b64decode(SPRITES[name]['src'].split(',')[1]))).convert('RGBA')


def cell(name, index):
    for job in JOBS:
        if job['kind'] == 'bundle':
            entries = [(e['ani'], e['index']) for e in job['entries']]
        elif job['kind'] == 'atlas':
            entries = [(job['name'], i) for i in range(job['start'], job['start'] + job['count'])]
        else:
            continue
        if (name, index) not in entries:
            continue
        if job['id'] not in PAGES:
            im = Image.open(WORK / (job['id'] + '-generated.png')).convert('RGBA')
            PAGES[job['id']] = im.resize((job['cols'] * job['cw'] * 3, job['rows'] * job['ch'] * 3), Image.Resampling.LANCZOS)
        pos = entries.index((name, index))
        x, y = pos % job['cols'] * job['cw'] * 3, pos // job['cols'] * job['ch'] * 3
        return PAGES[job['id']].crop((x, y, x + job['cw'] * 3, y + job['ch'] * 3)), job
    raise ValueError((name, index))


def features(im):
    a = np.asarray(im, dtype=np.float32) / 255
    a[..., :3] *= a[..., 3:4]
    # Coverage matters, but anatomy (white face / green helmet / grey joints) also matters.
    a[..., 3] *= 0.6
    return a


def register(ref, generated, close_holes=False):
    """Search translation globally and modest independent axis scaling within one cell.

    Zero padded correlation penalizes lost or extra content, including content outside the
    reference. No wraparound, and no original RGB is painted underneath a mismatched pose.
    """
    w, h = ref.size
    target = features(ref)
    target_power = float((target * target).sum())
    best = None
    done = set()

    def try_scale(sx, sy):
        nonlocal best
        dims = (max(2, round(generated.width / 3 * sx)), max(2, round(generated.height / 3 * sy)))
        if dims in done:
            return
        done.add(dims)
        candidate = features(generated.resize(dims, Image.Resampling.LANCZOS))
        hh, ww = candidate.shape[:2]
        shape = (h + hh - 1, w + ww - 1)
        corr = np.zeros(shape, np.float64)
        for ch in range(4):
            corr += np.fft.irfft2(np.fft.rfft2(target[..., ch], s=shape) * np.fft.rfft2(candidate[::-1, ::-1, ch], s=shape), s=shape)
        yy, xx = np.unravel_index(corr.argmax(), shape)
        loss = (target_power + float((candidate * candidate).sum()) - 2 * corr[yy, xx]) / max(1, target_power)
        if best is None or loss < best[0]:
            best = (float(loss), dims[0] / (generated.width / 3), dims[1] / (generated.height / 3), int(xx) - ww + 1, int(yy) - hh + 1)

    for scale in np.arange(0.50, 1.31, 0.10):
        try_scale(scale, scale)
    for step in [0.10, 0.04]:
        _, sx, sy, _, _ = best
        for dx in [-step, 0, step]:
            for dy in [-step, 0, step]:
                try_scale(sx + dx, sy + dy)
    loss, sx, sy, tx, ty = best
    # Keep the generated antialiasing, but constrain coverage near the reference silhouette.
    fitted = generated.transform((w * 3, h * 3), Image.Transform.AFFINE,
                                 (1 / sx, 0, -tx * 3 / sx, 0, 1 / sy, -ty * 3 / sy),
                                 Image.Resampling.BICUBIC)
    mask = ref.getchannel('A')
    if close_holes:
        mask = mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
    mask = mask.resize(fitted.size, Image.Resampling.LANCZOS)
    rgba = np.array(fitted)
    rgba[..., 3] = np.minimum(rgba[..., 3], np.array(mask))
    return Image.fromarray(rgba), dict(loss=round(loss, 4), sx=round(sx, 4), sy=round(sy, 4), tx=tx, ty=ty)


def run(name, indices):
    atlas = original(name)
    folder = OUT / 'aligned' / name
    folder.mkdir(parents=True, exist_ok=True)
    records = []
    for index in indices:
        x, y, w, h = SPRITES[name]['frames'][index][:4]
        ref = atlas.crop((x, y, x + w, y + h))
        generated, job = cell(name, index)
        full_ref = Image.new('RGBA', (job['cw'], job['ch']))
        full_ref.paste(ref, (4, 4))
        fitted, stats = register(full_ref, generated)
        fitted = fitted.crop((12, 12, (w + 4) * 3, (h + 4) * 3))
        fitted.save(folder / (str(index) + '.png'))
        records.append(dict(frame=index, **stats))
        print(name, index, stats, flush=True)
    (folder / 'scores.json').write_text(json.dumps(records, indent=2))
    gallery(name, indices)


def gallery(name, indices=None):
    """Refresh comparisons from saved candidates, including newly generated replacements."""
    atlas = original(name)
    folder = OUT / 'aligned' / name
    indices = indices or sorted(int(p.stem) for p in folder.glob('*.png'))
    scores = {r['frame']: r for r in json.loads((folder / 'scores.json').read_text())}
    for report in OUT.glob('*-results.json'):
        for r in json.loads(report.read_text()):
            if r['name'] == name:
                scores[r['frame']] = r
    for start in range(0, len(indices), 48):
        subset = indices[start:start + 48]
        sheet = Image.new('RGB', (1536, math.ceil(len(subset) / 6) * 145 + 25), '#202831')
        dr = ImageDraw.Draw(sheet)
        dr.text((6, 5),name + ': original LEFT / registered candidate RIGHT; not enabled yet',fill='white')
        for j, index in enumerate(subset):
            x, y, w, h = SPRITES[name]['frames'][index][:4]
            a = atlas.crop((x, y, x + w, y + h))
            b = Image.open(folder / (str(index) + '.png'))
            scale = min(3, 120 / w, 117 / h)
            dims = (max(1, int(w * scale)), max(1, int(h * scale)))
            a = a.resize(dims, Image.Resampling.NEAREST)
            b = b.resize(dims, Image.Resampling.LANCZOS)
            ox, oy = j % 6 * 256, j // 6 * 145 + 25
            dr.text((ox + 3, oy), f'{index} loss {scores[index]["loss"]:.3f}', fill='#ffe39a')
            for im, px in [(a, ox + 2), (b, ox + 130)]:
                bg = Image.new('RGBA', dims, '#66616a'); bg.alpha_composite(im)
                sheet.paste(bg.convert('RGB'), (px, oy + 19))
        sheet.save(OUT / (name + '-aligned-' + str(start // 48 + 1) + '.png'))


if __name__ == '__main__':
    if sys.argv[1] == '--gallery':
        for name in sys.argv[2:]:
            gallery(name)
        sys.exit(0)
    name = sys.argv[1]
    indices = [int(i) for i in sys.argv[2:]] or list(range(len(SPRITES[name]['frames'])))
    run(name, indices)
