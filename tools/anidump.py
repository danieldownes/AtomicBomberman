import struct, sys
def chunks(b, pos, end, depth=0, out=None):
    while pos < end:
        if pos+10 > end: print('  '*depth+'trailing', b[pos:end].hex()); break
        sig=b[pos:pos+4].decode('latin1'); ln,cid=struct.unpack_from('<IH',b,pos+4)
        data=b[pos+10:pos+10+ln]
        info=''
        if sig in ('FNAM','STAT','SEQ ','HEAD','PAL ','TPAL','CBOX'): info=data[:120].hex()
        if sig=='FNAM' or sig=='NAME': info=data.decode('latin1')
        print('  '*depth+f'{sig!r} len={ln} id={cid} {info}')
        if sig in ('FRAM','SEQ ','STAT'): chunks(b,pos+10,pos+10+ln,depth+1)
        pos+=10+ln
b=open(sys.argv[1],'rb').read()
assert b[:10]==b'CHFILEANI '
ln,fid=struct.unpack_from('<IH',b,10)
print('file len',ln,'id',fid,'actual',len(b))
chunks(b,16,16+ln)
