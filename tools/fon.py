import struct, sys, json
from PIL import Image
def load(fn):
    b=open(fn,'rb').read()
    n,h,u=struct.unpack_from('<III',b,0)
    tab=[struct.unpack_from('<II',b,20+8*i) for i in range(n)]
    base=20+8*n
    glyphs={}
    for c,(w,off) in enumerate(tab):
        if w==0: continue
        bpr=(w+7)//8
        rows=[]
        for y in range(h):
            row=b[base+off+y*bpr: base+off+(y+1)*bpr]
            bits=''.join(f'{x:08b}' for x in row)[:w]
            rows.append(bits)
        glyphs[c]=(w,rows)
    return h,glyphs
if __name__=='__main__':
    out={}
    for fn in sys.argv[1:]:
        h,g=load(fn)
        s='The Quick Brown Fox 0123456789 !?%:() Atomic Bomberman'
        W=sum(g.get(ord(ch),(4,None))[0]+1 for ch in s)
        im=Image.new('L',(W,h),0); x=0
        for ch in s:
            w,rows=g.get(ord(ch),(4,None))
            if rows:
                for y,r in enumerate(rows):
                    for i,bit in enumerate(r):
                        if bit=='1': im.putpixel((x+i,y),255)
            x+=w+1
        im=im.resize((W*3,h*3)); im.save(f'/home/claude/out/{fn}.png')
        out[fn]={'h':h,'g':{c:[w,[int(r,2) if r else 0 for r in rows]] for c,(w,rows) in g.items()}}
        print(fn,h,len(g))
