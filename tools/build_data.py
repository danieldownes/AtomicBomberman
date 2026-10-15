"""Parse Atomic Bomberman text resources into a single JS data module.

Outputs web/data/gamedata.js defining window.AB_DATA = {...}
"""
import os, re, json, sys, glob

RAW = sys.argv[1]          # extracted CD root
OUT = sys.argv[2]          # web/data

def lines(path):
    with open(path, 'rb') as f:
        txt = f.read().decode('latin1')
    return txt.replace('\r', '').split('\n')

def strip_comment(l):
    # comments start with ';' but not inside quotes
    out = []; q = False
    for ch in l:
        if ch == '"': q = not q
        if ch == ';' and not q: break
        out.append(ch)
    return ''.join(out).strip()

# ---------------- VALUELST.RES ----------------
values = {}
for l in lines(os.path.join(RAW, 'DATA/RES/VALUELST.RES')):
    l = strip_comment(l)
    if not l: continue
    parts = [p.strip() for p in l.split(',')]
    try:
        k = int(parts[0]); vals = [int(p) for p in parts[1:] if p != '']
    except ValueError:
        continue
    values[k] = vals[0] if len(vals) == 1 else vals

# ---------------- MESSAGES.TXT ----------------
messages = {}
for l in lines(os.path.join(RAW, 'MESSAGES.TXT')):
    l2 = strip_comment(l)
    m = re.match(r'^(\d+),(.*)$', l2)
    if not m: continue
    v = m.group(2).strip()
    if v.startswith('"'):
        v = v[1:]
        if v.endswith('"'): v = v[:-1]
    messages[int(m.group(1))] = v

# ---------------- SOUNDLST.RES ----------------
sounds = {}
for l in lines(os.path.join(RAW, 'DATA/RES/SOUNDLST.RES')):
    l = strip_comment(l)
    m = re.match(r'^(\d+),\s*(\S+)', l)
    if m: sounds[int(m.group(1))] = m.group(2).lower()

# ---------------- Schemes ----------------
schemes = {}
for path in sorted(glob.glob(os.path.join(RAW, 'DATA/SCHEMES/*.SCH'))):
    key = os.path.basename(path)[:-4].lower()
    sc = {'name': key, 'density': 100, 'rows': [None]*11, 'starts': [], 'powers': []}
    for l in lines(path):
        l = l.strip()
        if not l or l.startswith(';'): continue
        if l.startswith('-V,'): sc['version'] = int(l[3:].split(',')[0])
        elif l.startswith('-N,'): sc['name'] = l[3:].strip()
        elif l.startswith('-B,'): sc['density'] = int(l[3:].split(',')[0])
        elif l.startswith('-R,'):
            p = l[3:].split(',', 1)
            sc['rows'][int(p[0])] = p[1][:15].ljust(15, '.')
        elif l.startswith('-S,'):
            p = [int(x) for x in l[3:].split(',')]
            sc['starts'].append({'p': p[0], 'x': p[1], 'y': p[2], 'team': p[3] if len(p) > 3 else 0})
        elif l.startswith('-P,'):
            p = [x.strip() for x in l[3:].split(',')]
            sc['powers'].append({'id': int(p[0]), 'bornwith': int(p[1]), 'hasOverride': int(p[2]),
                                 'override': int(p[3]), 'forbidden': int(p[4])})
    sc['rows'] = [r if r else '.'*15 for r in sc['rows']]
    schemes[key] = sc

# ---------------- Level extras ----------------
extras = {}
for path in glob.glob(os.path.join(RAW, 'DATA/RES/EXTRA*.RES')):
    lvl = int(re.findall(r'EXTRA(\d+)', path.upper())[0])
    items = []
    for l in lines(path):
        l = strip_comment(l)
        if not l.startswith('-'): continue
        p = [x.strip() for x in l[1:].split(',')]
        kind = p[0]
        if kind in ('A', 'C'):      # arrow / conveyor: dir, x, y
            items.append({'t': 'arrow' if kind == 'A' else 'conveyor', 'dir': p[1], 'x': int(p[2]), 'y': int(p[3])})
        elif kind == 'W':           # warp: group, id, x, y, dest
            items.append({'t': 'warp', 'group': int(p[1]), 'id': int(p[2]), 'x': int(p[3]), 'y': int(p[4]), 'dest': int(p[5])})
        elif kind == 'T':           # trampoline: x,y or H,H (hidden/random)
            items.append({'t': 'trampoline', 'x': p[1], 'y': p[2]})
    extras[lvl] = items

# ---------------- Campaign (CAM) ----------------
campaigns = {}
for path in glob.glob(os.path.join(RAW, 'DATA/RES/*.CAM')):
    key = os.path.basename(path)[:-4].lower(); st = []
    for l in lines(path):
        l = strip_comment(l)
        if l.startswith('-C,'):
            p = [x.strip() for x in l[3:].split(',')]
            st.append({'name': p[0], 'level': int(p[1]), 'scheme': p[2], 'rovers': int(p[3]), 'roverSpeed': int(p[4]),
                       'ghosts': int(p[5]), 'ghostSpeed': int(p[6]), 'ais': int(p[7]), 'aiSkill': int(p[8])})
    campaigns[key] = st

# ---------------- Help files (.BM) ----------------
helpfiles = {}
for path in glob.glob(os.path.join(RAW, '*.BM')):
    helpfiles[os.path.basename(path)[:-3].lower()] = open(path, 'rb').read().decode('latin1').replace('\r', '')

data = {'values': values, 'messages': messages, 'sounds': sounds, 'schemes': schemes,
        'extras': extras, 'campaigns': campaigns, 'help': helpfiles}
os.makedirs(OUT, exist_ok=True)
with open(os.path.join(OUT, 'gamedata.js'), 'w') as f:
    f.write('// Generated from the original Atomic Bomberman data files (VALUELST.RES, MESSAGES.TXT,\n')
    f.write('// SOUNDLST.RES, *.SCH, EXTRA*.RES, *.CAM, *.BM). Do not edit by hand.\n')
    f.write('window.AB_DATA = ')
    json.dump(data, f, separators=(',', ':'))
    f.write(';\n')
print('values', len(values), 'messages', len(messages), 'sounds', len(sounds), 'schemes', len(schemes), 'extras', sorted(extras), 'help', sorted(helpfiles))
