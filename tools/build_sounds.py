"""Build the port's sound catalog and per-clip audio files.

The original plays sounds by SOUNDLST.RES id ranges (one range per game event). This script lists
every event the port plays, the clips that belong to it (the shipped SOUNDLST entries plus the unused
takes found on the CD), and groups takes that say the same words into phrases:

    event (e.g. "Taunt after a kill")  ->  phrase ("You suck!")  ->  takes (ADD9A, ADD9B, ZAA9A ...)

Outputs
  data/sounds.js        window.AB_SOUNDS = {events: [...], clips: {...}}
  audio/clips/<n>.js    one small script per clip, loaded on demand (works from file://)

usage: build_sounds.py SOUNDLST.RES transcripts.json voices.js sfx_mp3_dir extra_mp3_dir web_dir
"""
import sys, re, json, os, base64, collections, difflib

soundlst, trans_f, voices_js, sfx_dir, extra_dir, web = sys.argv[1:7]
trans = json.load(open(trans_f))
vj = open(voices_js).read()
V = json.loads(vj[vj.index('{'):vj.rindex('}') + 1])

ids = {}
for line in open(soundlst, 'rb').read().decode('latin1').splitlines():
    line = line.split(';')[0].strip()
    m = re.match(r'^(\d+),\s*(\S+)', line)
    if m: ids.setdefault(int(m.group(1)), m.group(2).lower())

DIS = ['Molasses', 'Crack', 'Constipation', 'Poops', 'Short Flame', 'Crack Poops', 'Short Fuze', 'Swap',
       'Reversed Controls', 'Leprosy', 'Invisible', 'Duds']
# (lo, hi, name, kind, per-round phrase limit)
EVENTS = [
    (10, 10, 'Menu: confirm', 'sfx', 0), (20, 21, 'Menu: move', 'sfx', 0), (40, 41, 'Menu: not allowed', 'sfx', 0),
    (100, 102, 'Drop a bomb', 'sfx', 0), (120, 123, 'Kick a bomb', 'sfx', 0), (130, 132, 'Kicked bomb stops', 'sfx', 0),
    (135, 139, 'Jelly bomb bounces', 'sfx', 0), (140, 146, 'Wall slams down (hurry)', 'sfx', 0),
    (150, 151, 'Punch a bomb', 'sfx', 0), (160, 160, 'Punched bomb bounces', 'sfx', 0),
    (170, 171, 'Grab a bomb', 'sfx', 0), (172, 175, 'Throw a bomb', 'sfx', 0),
    (200, 299, 'Explosion', 'sfx', 10), (300, 301, 'Caught in the flames', 'sfx', 0),
    (341, 349, 'Death animation effects', 'sfx', 0), (350, 353, 'Trampoline', 'sfx', 0),
    (360, 363, 'Bomb lands on your head', 'sfx', 0),
    (400, 499, 'Pick up a power-up', 'voice', 14), (550, 554, 'Poops disease drops a bomb', 'sfx', 0),
    (700, 999, 'Taunt after a kill', 'voice', 16), (1200, 1299, 'Lay a long line of bombs', 'voice', 8),
    (1300, 1300, 'Roulette: tick', 'sfx', 0), (1310, 1310, 'Roulette: prize', 'sfx', 0),
    (1320, 1320, 'Roulette: booby prize', 'sfx', 0), (1330, 1332, 'Warp hole', 'sfx', 0),
    (1400, 1699, '"You are awesome!" (7th power-up)', 'voice', 12), (1700, 1999, 'Draw game', 'voice', 8),
    (2000, 2299, 'Match winner', 'voice', 8), (2300, 2599, 'Catch a disease', 'voice', 12),
    (2600, 2699, 'Quit the game', 'voice', 6), (2700, 2799, 'Hurry up', 'voice', 6),
    (2800, 2899, 'Title: "Atomic Bomberman!"', 'voice', 6),
    (9000, 9000, 'Round start (unused announcer lines)', 'voice', 4),
] + [(3000 + d * 50, 3049 + d * 50, 'Disease: ' + DIS[d], 'voice', 6) for d in range(12)]

# unused sound effects found on the CD, placed with the event they belong to
EXTRA_SFX = {'bmdrop1': 100, 'boing1': 135, 'boing2': 135, 'sqrdrps2': 140, 'sqrdrps3': 140}
ODD = set()   # extras of unknown purpose: listed, but off in every preset
for n in os.listdir(extra_dir):
    n = n[:-4].lower()
    if re.match(r'^bomb_?\d', n): EXTRA_SFX[n] = 200
    if re.match(r'^(alarm\d+|beeps?)$', n): EXTRA_SFX[n] = 2700; ODD.add(n)

crude = {n for l in V['crude'].values() for n in l}
child = set(V['child'])
extra_of = collections.defaultdict(list)
for key, lst in list(V['extra'].items()) + list(V['crude'].items()):
    for n in lst: extra_of[int(key)].append(n)
for n, lo in EXTRA_SFX.items(): extra_of[lo].append(n)
shipped = set(ids.values())
have = {f[:-4].lower() for f in os.listdir(sfx_dir)} | {f[:-4].lower() for f in os.listdir(extra_dir)}

SFXISH = re.compile(r'^(get\d|coolpop|\d{4}|pu\d+|bomb_?\d.*|expl.*|alarm\d+|beeps?|boing\d)$')
FILL = {'oh', 'ooh', 'ah', 'ahh', 'uh', 'um', 'hey', 'well', 'yeah', 'whoa', 'woah', 'mm', 'hmm', 'huh', 'mmhmm', 'so', 'and', 'or', 'i', 'a'}
ANNOT = re.compile(r'\[[^\]]*\]?|\([^)]*\)?|\*[^*]*\*?')

def norm(t):
    t = ANNOT.sub(' ', t.lower())
    w = re.sub(r"[^a-z' ]", ' ', t).replace("'", '').split()
    while w and w[0] in FILL: w = w[1:]
    while w and w[-1] in FILL: w = w[:-1]
    return ' '.join(w)

def annot(t):
    m = re.findall(r'(laugh|cry|scream|gasp|music|static|beep|gun|explosion|growl|sigh|cough|burp|giggle|whistle|grunt)', t.lower())
    return m[0] if m else ''

FAMILY = {}
for fam, ps in {'D': 'ADD ZAA JDD', 'P': 'PUPP ZAFP JUPP', 'S': 'DIS ZAD', 'E': 'EOFM ZACM JJFM',
                'G': 'GEN ZAI', 'B': 'DMB ZAE JMB', 'H': 'PGAD ZAHD JGAD', 'U': 'PGAPU ZAHPU JGAP'}.items():
    for p in ps.split(): FAMILY[p] = fam

def line_key(n):
    m = re.match(r'^([a-z]+?)(\d+)', n)
    if not m or m.group(1).upper() not in FAMILY: return None
    return (FAMILY[m.group(1).upper()], int(m.group(2)))

def sfx_stem(n):
    s = re.sub(r'[_\W]', '', n)
    m = re.match(r'^(bomb)(\d+)', s)
    return (m.group(1) + m.group(2)) if m else s

def nice_name(n):
    s = sfx_stem(n)
    m = re.match(r'^bomb(\d+)$', s)
    if m: return 'Explosion %s' % m.group(1)
    return n.upper()

def cap(t):
    t = re.sub(r'\s+', ' ', t).strip()
    return t[:1].upper() + t[1:] if t else t

events, clips = [], {}
for lo, hi, name, kind, limit in EVENTS:
    members = [ids[i] for i in sorted(ids) if lo <= i <= hi and ids[i] not in ('0', 'xxx')]
    members += extra_of.get(lo, [])
    seen, mem = set(), []
    for n in members:
        if n in seen or n not in have: continue
        seen.add(n); mem.append(n)
    if not mem: continue
    # ---- phrase groups ----
    parent = {n: n for n in mem}
    def find(x):
        while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    def union(a, b): parent[find(a)] = find(b)
    speech = {}
    for n in mem:
        t = trans.get(n, '')
        sp = kind == 'voice' and not SFXISH.match(n)
        speech[n] = norm(t) if sp else ''
    bykey = collections.defaultdict(list)
    for n in mem:
        if kind == 'sfx' or SFXISH.match(n): bykey[('sfx', sfx_stem(n))].append(n)
        else:
            k = line_key(n)
            if k: bykey[k].append(n)
            elif not speech[n] and annot(trans.get(n, '')): bykey[('annot', annot(trans.get(n, '')))].append(n)
    for lst in bykey.values():
        for n in lst[1:]: union(n, lst[0])
    sp_list = [n for n in mem if len(speech[n].replace(' ', '')) >= 4]
    for i, a in enumerate(sp_list):
        for b in sp_list[i + 1:]:
            if find(a) == find(b): continue
            sa, sb = speech[a], speech[b]
            if sa == sb or difflib.SequenceMatcher(None, sa, sb).ratio() >= 0.82: union(a, b)
    groups = collections.defaultdict(list)
    for n in mem: groups[find(n)].append(n)
    glist = []
    for g in groups.values():
        g.sort(key=lambda n: (n not in shipped, n))
        if kind == 'sfx' or all(SFXISH.match(n) for n in g):
            label = nice_name(g[0])
        else:
            clean = lambda t: re.sub(r'\s+', ' ', ANNOT.sub(' ', t)).strip(' .!?,-')
            key = lambda t: re.sub(r'[^a-z ]', '', clean(t).lower()).strip()
            cands = [key(trans.get(n, '')) for n in g if len(key(trans.get(n, '')).replace(' ', '')) >= 2]
            if cands:
                cnt = collections.Counter(cands)
                best = max(cnt, key=lambda k: (cnt[k], -abs(len(k) - 18)))
                rep = next(n for n in g if key(trans.get(n, '')) == best)
                label = cap(clean(trans.get(rep, ''))) or rep.upper()
            else:
                a = annot(' '.join(trans.get(n, '') for n in g))
                label = '[' + (a or 'sound') + ']' if a else g[0].upper()
        glist.append({'label': label[:48], 'clips': g})
    glist.sort(key=lambda G: (not any(n in shipped for n in G['clips']), G['label'].lower()))
    events.append({'lo': lo, 'hi': hi, 'name': name, 'kind': kind, 'limit': limit, 'groups': glist})
    for n in mem:
        f = 0
        if n in shipped: f |= 1
        else: f |= 2
        if n in crude: f |= 4
        if n in child: f |= 8
        if n in ODD: f |= 16
        if kind == 'sfx' or SFXISH.match(n): f |= 32
        t = trans.get(n, '').strip()
        clips[n] = [f, t[:90]]

os.makedirs(os.path.join(web, 'data'), exist_ok=True)
with open(os.path.join(web, 'data', 'sounds.js'), 'w') as f:
    f.write('// Sound catalog: game events -> phrases -> takes. Generated by tools/build_sounds.py - do not edit.\n')
    f.write('// clip flags: 1 shipped (SOUNDLST.RES), 2 unused CD take, 4 uncensored, 8 not child friendly, 16 unknown purpose, 32 sound effect\n')
    f.write('window.AB_SOUNDS = ' + json.dumps({'events': events, 'clips': clips}, separators=(',', ':')) + ';\n')

cdir = os.path.join(web, 'audio', 'clips'); os.makedirs(cdir, exist_ok=True)
written = 0
for n in sorted(have):
    src = os.path.join(sfx_dir, n + '.mp3')
    if not os.path.exists(src): src = os.path.join(extra_dir, n + '.mp3')
    b = base64.b64encode(open(src, 'rb').read()).decode()
    with open(os.path.join(cdir, n + '.js'), 'w') as f:
        f.write('AB_CLIP("%s","%s");\n' % (n, b))
    written += 1
ng = sum(len(e['groups']) for e in events)
print('events', len(events), 'phrases', ng, 'clips in catalog', len(clips), 'clip files', written)
# the port's own additions (the Wilhelm scream...): tools/add_port_sounds.py
import importlib.util
spec = importlib.util.spec_from_file_location('add_port_sounds', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'add_port_sounds.py'))
aps = importlib.util.module_from_spec(spec); spec.loader.exec_module(aps)
aps.WEB = web; aps.add()
