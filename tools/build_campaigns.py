"""Campaign definitions (DATA/RES/*.CAM) -> web/data/campaigns.js.

The original's hidden Campaign mode (5 x C on the Player Setup screen) reads these files: each "-C" line
is a stage: name, arena (level number), scheme, rovers + speed, ghosts + speed, computer players and
an AI difficulty the game never used. usage: build_campaigns.py DATA/RES web_dir"""
import sys, os, json, glob
res, web = sys.argv[1], sys.argv[2]
out = []
for p in sorted(glob.glob(os.path.join(res, '*.CAM'))):
    stages = []
    for line in open(p, 'rb').read().decode('latin1').splitlines():
        line = line.split(';')[0].strip()
        if not line.startswith('-C,'): continue
        f = [x.strip() for x in line[3:].split(',')]
        stages.append({'name': f[0], 'level': int(f[1]), 'scheme': f[2].lower(), 'rovers': int(f[3]), 'roverSpeed': int(f[4]),
                       'ghosts': int(f[5]), 'ghostSpeed': int(f[6]), 'ais': int(f[7]), 'difficulty': int(f[8])})
    name = os.path.basename(p)[:-4]
    out.append({'file': name.upper() + '.CAM', 'title': {'SIMPLE': 'Simple', 'CROUTON': 'Croutons', 'GHOSTS': 'Ghost Towns'}.get(name.upper(), name.title()), 'stages': stages})
order = {'SIMPLE.CAM': 0, 'CROUTON.CAM': 1, 'GHOSTS.CAM': 2}
out.sort(key=lambda c: order.get(c['file'], 9))
with open(os.path.join(web, 'data', 'campaigns.js'), 'w') as f:
    f.write('// Campaign stages from DATA/RES/*.CAM (the original\'s hidden Campaign mode). Generated - do not edit.\n')
    f.write('window.AB_CAMPAIGNS = ' + json.dumps(out, separators=(',', ':')) + ';\n')
print([(c['file'], len(c['stages'])) for c in out])
