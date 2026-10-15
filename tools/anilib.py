import struct
def rd(b,pos):
    sig=b[pos:pos+4].decode('latin1'); ln,cid=struct.unpack_from('<IH',b,pos+4)
    return sig,ln,cid,pos+10,pos+10+ln

def decode_cimg(b, s, e):
    typ,unk1,addl=struct.unpack_from('<HHI',b,s)
    p=s+8
    unk2,w,h,hx,hy,keyb,unk3=struct.unpack_from('<IHHHHHH',b,p); p+=16
    pal=None
    if addl>=32:
        palsize=addl-32
        p+=8
        pal=b[p:p+palsize]; p+=palsize
    u1,u2,csize,usize=struct.unpack_from('<HHII',b,p); p+=12
    data=b[p:p+csize-12]
    return dict(type=typ,unk1=unk1,addl=addl,unk2=unk2,w=w,h=h,hx=hx,hy=hy,keyb=keyb,unk3=unk3,pal=pal,u1=u1,u2=u2,csize=csize,usize=usize,data=data,end=p+csize-12,chunkend=e)

def rle16(data, n):
    out=[]; i=0
    while len(out)<n and i<len(data):
        c=data[i]; i+=1
        k=(c&0x7f)+1
        if c&0x80:
            v=data[i]|(data[i+1]<<8); i+=2; out.extend([v]*k)
        else:
            for _ in range(k):
                out.append(data[i]|(data[i+1]<<8)); i+=2
    return out, i

def parse(b):
    assert b[:10]==b'CHFILEANI '
    ln,_=struct.unpack_from('<IH',b,10); pos=16; end=16+ln
    frames=[]; seqs=[]; misc={}
    while pos<end:
        sig,ln,cid,ds,de=rd(b,pos)
        if sig=='FRAM':
            p=ds; fr={'name':None}
            while p<de:
                s2,l2,c2,d2s,d2e=rd(b,p)
                if s2=='FNAM': fr['name']=b[d2s:d2e].split(b'\0')[0].decode('latin1')
                elif s2=='HEAD': fr['head']=b[d2s:d2e]
                elif s2=='CIMG': fr['cimg']=decode_cimg(b,d2s,d2e)
                else: fr.setdefault('other',[]).append((s2,b[d2s:d2e]))
                p=d2e
            frames.append(fr)
        elif sig=='SEQ ':
            p=ds; sq={'states':[]}
            while p<de:
                s2,l2,c2,d2s,d2e=rd(b,p)
                if s2=='HEAD':
                    sq['name']=b[d2s:d2e].split(b'\0')[0].decode('latin1'); sq['head']=b[d2s:d2e]
                elif s2=='STAT':
                    st={}; q=d2s
                    while q<d2e:
                        s3,l3,c3,d3s,d3e=rd(b,q)
                        if s3=='HEAD': st['head']=b[d3s:d3e]
                        elif s3=='FRAM': st['fram']=b[d3s:d3e]
                        else: st.setdefault('other',[]).append((s3,b[d3s:d3e]))
                        q=d3e
                    sq['states'].append(st)
                else: sq.setdefault('other',[]).append((s2,b[d2s:d2e]))
                p=d2e
            seqs.append(sq)
        else:
            misc.setdefault(sig,[]).append(b[ds:de])
        pos=de
    return frames, seqs, misc
