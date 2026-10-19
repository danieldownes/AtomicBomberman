"""Build HD outline versions of the game UI fonts and a text-free Retro menu background.
Requires Pillow, numpy and fonttools; the menu display font itself is vendored Amarante.
"""
from pathlib import Path
import json, subprocess, base64
import numpy as np
from PIL import Image, ImageFilter
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
ROOT = Path(__file__).resolve().parent.parent
empty = TTGlyphPen(None).glyph()
# FontFace receives bytes so a copy opened directly from disk also has the proper menu font.
(ROOT/'web/data/menufont.js').write_text('window.AB_MENUFONT=' + json.dumps(base64.b64encode((ROOT/'web/data/menu-amarante.ttf').read_bytes()).decode()) + ';\n')
# Preserve the original portrait and spark trail; erase only the old menu labels.
im = Image.open(ROOT/'web/img/mainmenu.png').convert('RGB')
patch = im.crop((340,376,640,406))
for top in [114,150,187,225,261,298,335]: im.paste(patch,(340,top-4))
im.save(ROOT/'web/img/mainmenu-clean.png',optimize=True)

def outline(a, height=32, baseline=27):
    # Trace a smoothed high-resolution mask into closed vector contours.
    scale = 6
    im = Image.fromarray(np.uint8(np.clip(a,0,1)*255)).resize((a.shape[1]*scale,height*scale),Image.Resampling.LANCZOS).filter(ImageFilter.GaussianBlur(1.2))
    im = im.filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.MinFilter(5))
    b = np.asarray(im) > 65; edges = {}
    def edge(p,q): edges.setdefault(p,[]).append(q)
    h,w=b.shape
    for y,x in np.argwhere(b):
        if y==0 or not b[y-1,x]: edge((x,y),(x+1,y))
        if x==w-1 or not b[y,x+1]: edge((x+1,y),(x+1,y+1))
        if y==h-1 or not b[y+1,x]: edge((x+1,y+1),(x,y+1))
        if x==0 or not b[y,x-1]: edge((x,y+1),(x,y))
    pen=TTGlyphPen(None)
    while edges:
        start=next(iter(edges)); p=start; points=[p]
        while True:
            q=edges[p].pop()
            if not edges[p]: del edges[p]
            p=q
            if p==start: break
            points.append(p)
        # Drop collinear points; keep curves independent of screen resolution.
        points=[p for i,p in enumerate(points) if (p[0]-points[i-1][0])*(points[(i+1)%len(points)][1]-p[1]) != (p[1]-points[i-1][1])*(points[(i+1)%len(points)][0]-p[0])]
        if len(points)<3: continue
        cv=lambda p:(round(p[0]*100/scale), round((baseline*scale-p[1])*100/scale))
        pen.moveTo(cv(points[0]))
        for p in points[1:]: pen.lineTo(cv(p))
        pen.closePath()
    return pen.glyph()


# HD UI fonts keep the original advances/layout, with vector outlines instead of scaled bitmap pixels.
all_fonts = json.loads(subprocess.check_output(['node','-e',"const fs=require('fs'),vm=require('vm'),c={window:{}};vm.createContext(c);vm.runInContext(fs.readFileSync('web/data/fonts.js','utf8'),c);process.stdout.write(JSON.stringify(c.window.AB_FONTS));"],cwd=ROOT))
for name, fd in all_fonts.items():
    outlines={'.notdef':empty}; metrics={'.notdef':(600,0)}; cmap={}
    for code,(w,rows) in fd['g'].items():
        a=np.zeros((fd['h'],max(1,w)))
        for y,row in enumerate(rows[:fd['h']]):
            for x in range(w): a[y,x]=1 if row&(1<<(w-1-x)) else 0
        gn='uni%04X'%int(code); cmap[int(code)]=gn
        outlines[gn]=outline(a,fd['h'],fd['h']);metrics[gn]=((w+(1 if name=='font0' else 0))*100,0)
    fb=FontBuilder(fd['h']*100,isTTF=True);fb.setupGlyphOrder(list(outlines));fb.setupCharacterMap(cmap);fb.setupGlyf(outlines);fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=fd['h']*100,descent=0);fb.setupOS2(sTypoAscender=fd['h']*100,sTypoDescender=0,usWinAscent=fd['h']*100,usWinDescent=0)
    fb.setupNameTable({'familyName':'AB '+name,'styleName':'Regular','uniqueFontIdentifier':'ABHD'+name,'fullName':'AB '+name,'psName':'ABHD'+name});fb.setupPost();fb.setupMaxp()
    d=ROOT/'web/hd/fonts';d.mkdir(parents=True,exist_ok=True);fb.save(d/(name+'.ttf'))
