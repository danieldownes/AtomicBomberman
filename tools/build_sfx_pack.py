"""Pack the converted sound effects (mp3) into a single JS file so the game runs from file://.
usage: build_sfx_pack.py <dir with *.mp3> <output sfx.js>
"""
import sys, os, base64, json
src, out = sys.argv[1], sys.argv[2]
pack = {}
for fn in sorted(os.listdir(src)):
    if fn.endswith('.mp3'):
        pack[fn[:-4].lower()] = base64.b64encode(open(os.path.join(src, fn), 'rb').read()).decode()
with open(out, 'w') as f:
    f.write('// Sound effects from Atomic Bomberman DATA/SOUND/*.RSS (re-encoded to mp3). Generated - do not edit.\n')
    f.write('window.AB_SFX_PACK = ' + json.dumps(pack, separators=(',', ':')) + ';\n')
print(len(pack), os.path.getsize(out))
