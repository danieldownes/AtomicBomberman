"""Extract Atomic Bomberman from the raw CD dump (Mode 2 / 2352-byte sectors) into a folder.
usage: python extract_iso.py AtomicBomberman.iso outdir      (needs: pip install pycdlib)
"""
import sys, os, pycdlib, tempfile
src, out = sys.argv[1], sys.argv[2]
size = os.path.getsize(src)
cooked = tempfile.NamedTemporaryFile(delete=False, suffix='.iso').name
with open(src, 'rb') as f, open(cooked, 'wb') as o:
    if size % 2352 == 0:
        for _ in range(size // 2352):
            s = f.read(2352); o.write(s[24:24 + 2048])     # Mode 2 Form 1: 12 sync + 4 header + 8 subheader
    else:
        o.write(f.read())
iso = pycdlib.PyCdlib(); iso.open(cooked)
for root, dirs, files in iso.walk(iso_path='/'):
    for fn in files:
        name = fn.split(';')[0].rstrip('.')
        d = os.path.join(out, root.strip('/')); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, name), 'wb') as o:
            iso.get_file_from_iso_fp(o, iso_path=root.rstrip('/') + '/' + fn)
iso.close(); os.unlink(cooked)
print('extracted to', out)
