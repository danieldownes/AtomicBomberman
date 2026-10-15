import sys, struct, glob, json, os, base64, io
sys.path.insert(0,'/home/claude/tools')
from anilib import *
from PIL import Image

def rgb555(v): return (((v>>10)&31)*255//31, ((v>>5)&31)*255//31, (v&31)*255//31)

def frame_image(c, pal=None):
    w,h=c['w'],c['h']
    if c['type']==4:
        px,_=rle16(c['data'], w*h)
        px=px[:w*h]+[c['keyb']]*(w*h-len(px))
        key=c['keyb']
        im=Image.new('RGBA',(w,h)); im.putdata([(0,0,0,0) if v==key else rgb555(v)+(255,) for v in px]); return im
    elif c['type']==11:
        # 8-bit paletted, palette in c['pal'] (1024 bytes BGRA?)
        p=c['pal']; data=c['data']
        # try RLE8 TGA style
        out=[]; i=0
        while len(out)<w*h and i<len(data):
            k=data[i]; i+=1; n=(k&0x7f)+1
            if k&0x80: out+= [data[i]]*n; i+=1
            else: out+= list(data[i:i+n]); i+=n
        out=out[:w*h]+[0]*(w*h-len(out))
        cols=[(p[j*4+2],p[j*4+1],p[j*4],255) for j in range(256)]
        im=Image.new('RGBA',(w,h)); im.putdata([(0,0,0,0) if v==c['keyb'] else cols[v] for v in out]); return im
    raise ValueError('type')

def pack(rects, maxw=1024):
    # simple shelf packer; rects: list of (idx,w,h) -> positions
    order=sorted(rects, key=lambda r:-r[2]); x=y=0; shelf=0; pos={}; W=0
    for idx,w,h in order:
        if x+w>maxw: x=0; y+=shelf+1; shelf=0
        pos[idx]=(x,y); x+=w+1; shelf=max(shelf,h); W=max(W,x)
    return pos, W, y+shelf

def export(fn):
    b=open(fn,'rb').read()
    fr,sq,misc=parse(b)
    imgs=[]; meta=[]
    for f in fr:
        c=f.get('cimg')
        if not c: imgs.append(None); meta.append(None); continue
        im=frame_image(c)
        bb=im.getbbox()
        if bb is None: bb=(0,0,1,1)
        crop=im.crop(bb)
        imgs.append(crop); meta.append((bb[0],bb[1],c['hx'],c['hy'],f['name']))
    rects=[(i,im.width,im.height) for i,im in enumerate(imgs) if im is not None]
    pos,W,H=pack(rects)
    atlas=Image.new('RGBA',(max(W,1),max(H,1)))
    frames=[]
    for i,im in enumerate(imgs):
        if im is None: frames.append(None); continue
        x,y=pos[i]; atlas.paste(im,(x,y))
        bx,by,hx,hy,name=meta[i]
        frames.append([x,y,im.width,im.height,hx-bx,hy-by])
    seqs={}
    for s in sq:
        st=[]
        for S in s['states']:
            dur=struct.unpack_from('<h',S['head'],0)[0]
            fb=S['fram']; n=struct.unpack_from('<H',fb,0)[0]
            subs=[list(struct.unpack_from('<Hhh',fb,2+10*i)) for i in range(n)]
            st.append({'d':dur,'s':subs})
        name=s['name']
        k=name; j=2
        while k in seqs: k=f'{name}#{j}'; j+=1
        seqs[k]=st
    # most common key colour (for edge matting in the port's "enhanced graphics" mode)
    import collections
    kc = collections.Counter(f['cimg']['keyb'] for f in fr if f.get('cimg') and f['cimg']['type'] == 4)
    key = rgb555(kc.most_common(1)[0][0]) if kc else (0, 0, 0)
    return atlas, {'frames':frames,'seqs':seqs,'key':list(key)}

if __name__=='__main__':
    src=sys.argv[1]; outdir=sys.argv[2]; os.makedirs(outdir,exist_ok=True)
    names=sys.argv[3:]
    allmeta={}
    for n in names:
        atlas,meta=export(os.path.join(src,n.upper()+'.ANI'))
        atlas.save(os.path.join(outdir,n.lower()+'.png'), optimize=True)
        allmeta[n.lower()]=meta
        print(n, atlas.size, len(meta['frames']), len(meta['seqs']))
    json.dump(allmeta, open(os.path.join(outdir,'ani.json'),'w'))
