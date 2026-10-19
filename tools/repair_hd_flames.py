"""Prepare connected blast references, then slice imagegen results using original flame geometry.

python tools/repair_hd_flames.py prepare | accept
Generate flames-0-3-generated.png and flames-4-generated.png from their matching references.
No bomb sprites, sequences or renderer transforms are changed.
"""
import json
import sys
import numpy as np
from PIL import Image
from align_hd import ROOT, WORK, OUT, SPRITES, original, register

UNIT = 230
S = SPRITES['mflame']
OFFSETS = {'center':(0,0), 'midwest':(-40,0), 'tipwest':(-80,0),
           'mideast':(40,0), 'tipeast':(80,0), 'midnorth':(0,-36),
           'tipnorth':(0,-72), 'midsouth':(0,36), 'tipsouth':(0,72)}


def reference(state):
    page = Image.new('RGBA', (UNIT, UNIT)); entries=[]; atlas=original('mflame')
    for kind, (dx,dy) in OFFSETS.items():
        frame, ox, oy = S['seqs']['flame '+kind+' green'][state]
        x,y,w,h,hx,hy = S['frames'][frame]
        px,py=UNIT//2+dx+ox-hx,UNIT//2+dy+oy-hy
        cel=atlas.crop((x,y,x+w,y+h))
        page.alpha_composite(cel,(px,py))
        entries.append((frame,px,py,w,h))
    return page,entries


if sys.argv[1]=='prepare':
    for job,states,cols in [('flames-0-3',range(4),2),('flames-4',[4],1)]:
        page=Image.new('RGBA',(UNIT*cols,UNIT*cols))
        for j,state in enumerate(states):
            ref,_=reference(state);page.paste(ref,(j%cols*UNIT,j//cols*UNIT))
        page.resize((page.width*3,page.height*3),Image.Resampling.NEAREST).save(OUT/(job+'-reference.png'))
elif sys.argv[1]=='accept':
    folder=OUT/'aligned/mflame';folder.mkdir(exist_ok=True)
    for job,states,cols in [('flames-0-3',range(4),2),('flames-4',[4],1)]:
        im=Image.open(OUT/(job+'-generated.png')).convert('RGBA').resize((UNIT*cols*3,UNIT*cols*3),Image.Resampling.LANCZOS)
        for j,state in enumerate(states):
            cx,cy=j%cols*UNIT*3,j//cols*UNIT*3
            ref,entries=reference(state)
            fitted,stats=register(ref,im.crop((cx,cy,cx+UNIT*3,cy+UNIT*3)),close_holes=True)
            # Glow is already conveyed by generated alpha. All adjacent pieces use the same
            # registered pixels; no independent scaling, brightness, or double RGB silhouette.
            for frame,px,py,w,h in entries:
                fitted.crop((px*3,py*3,(px+w)*3,(py+h)*3)).save(folder/f'{frame}.png')
            print(state,stats)
else:
    raise ValueError('prepare | accept')
