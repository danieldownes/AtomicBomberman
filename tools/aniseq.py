import struct, sys
def rd(b,pos):
    sig=b[pos:pos+4].decode('latin1'); ln,cid=struct.unpack_from('<IH',b,pos+4)
    return sig,ln,cid,pos+10,pos+10+ln
b=open(sys.argv[1],'rb').read()
ln,_=struct.unpack_from('<IH',b,10); pos=16; end=16+ln
frames=[]
while pos<end:
    sig,ln,cid,ds,de=rd(b,pos)
    if sig=='FRAM':
        p=ds; name=None; hd=None
        while p<de:
            s2,l2,c2,d2s,d2e=rd(b,p)
            if s2=='FNAM': name=b[d2s:d2e].rstrip(b'\0').decode('latin1')
            if s2=='HEAD': hd=b[d2s:d2e].hex()
            if s2=='CIMG':
                w,h,hx,hy=struct.unpack_from('<HHHH',b,d2s+12)
                typ=struct.unpack_from('<H',b,d2s)[0]
            p=d2e
        frames.append(name); print('FRAME',len(frames)-1,name,hd,'type',typ,w,h,hx,hy)
    elif sig=='SEQ ':
        p=ds
        while p<de:
            s2,l2,c2,d2s,d2e=rd(b,p)
            if s2=='HEAD':
                nm=b[d2s:d2e].split(b'\0')[0].decode('latin1'); print('SEQ',repr(nm), 'tail', b[d2s+64:d2e].hex())
            elif s2=='STAT':
                q=d2s
                while q<d2e:
                    s3,l3,c3,d3s,d3e=rd(b,q)
                    if s3=='HEAD': print('   STAT.HEAD', b[d3s:d3e][:8].hex(), b[d3s+8:d3e].hex() if any(b[d3s+8:d3e]) else '')
                    elif s3=='FRAM': print('   STAT.FRAM', b[d3s:d3e].hex(), struct.unpack_from('<'+'h'*(l3//2),b,d3s))
                    else: print('   ',s3,l3)
                    q=d3e
            else: print('  ',s2,l2)
            p=d2e
    else:
        print(sig, ln, b[ds:ds+16].hex())
    pos=de
