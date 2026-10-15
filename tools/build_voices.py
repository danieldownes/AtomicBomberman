"""Assign the CD's unused voice recordings to the game's sound categories.

The shipped SOUNDLST.RES references 974 of the 2027 .RSS files; the rest are alternate takes and
cut lines (the original even had a debug "unrefsnd.lst" listing them for deletion). Each unused
file is mapped to a SOUNDLST category by (1) a referenced sibling take of the same line
(ZAA10A -> ZAA10B), then (2) the dominant category of its file-name prefix. Lines whose
transcript contains crude language go to a separate "uncensored" set. A "child friendly" block list
(shipped and extra clips) removes insults, swearing and rude lines for the Child friendly voice mode.
usage: build_voices.py SOUNDLST.RES transcripts.json extramp3_dir out_voices.js out_pack.js
"""
import sys, re, json, os, base64, collections
soundlst, trans_f, mp3dir, out_js, out_pack = sys.argv[1:6]
CATS = [(400, 499, 'powerup'), (700, 999, 'taunt'), (1200, 1299, 'manybombs'), (1400, 1699, 'awesome'),
        (1700, 1999, 'draw'), (2000, 2299, 'winner'), (2300, 2599, 'disease'), (2600, 2699, 'quit'),
        (2700, 2799, 'hurry'), (2800, 2899, 'intro')] + [(3000 + d * 50, 3049 + d * 50, 'disease%d' % d) for d in range(12)]
def cat_of(i):
    for lo, hi, n in CATS:
        if lo <= i <= hi: return lo
    return None
ref = {}
for line in open(soundlst, 'rb').read().decode('latin1').splitlines():
    line = line.split(';')[0].strip()
    m = re.match(r'^(\d+),\s*(\S+)', line)
    if m: ref.setdefault(m.group(2).upper(), []).append(int(m.group(1)))
trans = json.load(open(trans_f))
extra = sorted(f[:-4].upper() for f in os.listdir(mp3dir) if f.endswith('.mp3'))

def split(n):
    m = re.match(r'^([A-Z_]+?)(\d+)([A-Z_]*)\d*$', n)
    return (m.group(1), m.group(2)) if m else (n, '')
# referenced voice files by line and by prefix
line_cat = collections.defaultdict(collections.Counter)
pref_cat = collections.defaultdict(collections.Counter)
for n, ids in ref.items():
    for i in ids:
        c = cat_of(i)
        if c is None: continue
        p, num = split(n)
        line_cat[(p, num)][c] += 1
        pref_cat[p][c] += 1
# fixed assignments for files whose purpose is clear from their names
FIXED = {'BOING1': None, 'BOING2': None, 'BEEP': None, 'BEEPS': None, 'SQRDRPS2': None, 'SQRDRPS3': None, 'BMDROP1': None}
for d in range(9): FIXED['DISZ%d' % d] = 3000 + d * 50
CRUDE_NAMES = {'ASSKILL', 'BUSTASS', 'MYASS1', 'YOASSGRS', 'JESUS', 'GODHERE', 'PGAD2C', 'ZAHD6D'}
def line_key(n):
    p, num = split(n)
    return (p, int(num)) if num else (p, -1)
# whole lines (every take) that are crude even where the transcription misheard a take
CRUDE_LINES = {(p, k) for k, ps in {20: 'ADD ZAA JDD', 46: 'ADD ZAA JDD', 4: 'EOFM JJFM ZACM', 13: 'JGAD PGAD ZAHD',
               7: 'JGAD PGAD ZAHD', 23: 'PGAD ZAHD', 24: 'JGAD PGAD ZAHD', 1: 'JUPP PUPP ZAFP', 33: 'JUPP PUPP ZAFP',
               19: 'JGAD PGAD ZAHD'}.items() for p in ps.split()}
# ---- child friendly: insults, swearing, rude or grim lines (applies to shipped clips too) ----
CHILD_RE = re.compile(r"\b(stupid\w*|idiot\w*|loser\w*|lame|suck\w*|you blow|daddy|punk|murder\w*|suicide|flamer|"
                      r"death grand|ratchet|screwed|pissed|lick my (crack|pee)|bitch\w*|damn|dam|hell|crap|ass|asses)\b", re.I)
CHILD_LINES = {(p, k) for k, ps in {9: 'ADD ZAA JDD', 10: 'ADD ZAA JDD', 11: 'ADD ZAA JDD', 12: 'ADD ZAA JDD',
               39: 'ADD ZAA JDD', 40: 'ADD ZAA JDD', 41: 'ADD ZAA JDD', 42: 'ADD ZAA JDD', 43: 'ADD ZAA JDD',
               44: 'ADD ZAA JDD', 47: 'ADD ZAA JDD', 58: 'ADD ZAA JDD', 60: 'ADD ZAA JDD', 64: 'ADD ZAA JDD',
               67: 'ADD ZAA JDD', 68: 'ADD ZAA JDD', 76: 'ADD ZAA JDD', 2: 'PGAD',
               14: 'JUPP PUPP ZAFP', 16: 'JUPP PUPP ZAFP', 17: 'JUPP PUPP ZAFP', 31: 'JUPP PUPP ZAFP',
               }.items() for p in ps.split()}
CHILD_LINES |= {('JUPP', 12), ('PUPP', 12), ('ZAFP', 12), ('JUPP', 19), ('PUPP', 19), ('ZAFP', 19), ('JUPP', 41),
                ('PUPP', 41), ('ZAFP', 41), ('DMB', 7), ('JMB', 7), ('ZAE', 7), ('ZAHD', 6), ('PGAD', 6), ('JGAD', 6)}
CHILD_NAMES = {'STUPIDIO', 'SUCKITDN', 'YOUBLOW', 'CALLDAD', 'WHODAD', 'SCHWING', 'BRAKHEAD', 'EATDUST', 'FILLCRAK',
               'ZAFP13AB', 'ZAD08AB', 'ADD69A', 'ADD69B', 'ADD69C', 'ZAA69A', 'ZAA69B', 'ZAA69C', 'ZAFP20AA', 'ZAFP20AB',
               'ZAFP34A1', 'ZAA9E', 'EOFM1AA'}
KEEP_CHILD = {'ZAHD6E', 'PGAD2E', 'PGAD2F', 'PUPP24A', 'PUPP24C'}   # clean takes ("gluteus maximus", coughs, "blow you to bits" misheard)
def child_bad(n, t):
    if n in KEEP_CHILD: return False
    return n in CHILD_NAMES or line_key(n) in CHILD_LINES or line_key(n) in CRUDE_LINES or n in CRUDE_NAMES or bool(CHILD_RE.search(t)) or bool(CRUDE_RE.search(t))
# words the shipped game never uses ("you suck" / "suck it down" did ship, so those stay clean)
CRUDE_RE = re.compile(r"\b(ass|asses|asshole|damn|dammit|hell|god|goddamn|jesus|christ|crap|bitch|bastard|piss|pissed|shit\w*|fuck\w*|effin'?)\b|\bthe a-$", re.I)
# transcript keywords that pin a line to a category regardless of its file name
KEYWORDS = [
    (r'crack\s*(poop|boob)', 3250), (r'short\s*fl', 3200), (r'short\s*fu', 3300), (r'mola[sr]', 3000), (r'constipa|constant pati|cuts to pati', 3100),
    (r'poop|^moves$', 3150), (r'^\W*cra+c?k\W*$', 3050), (r'\bswap', 3350), (r'controls|reversed|confused|^rul', 3400),
    (r'lepros|tag,? you', 2300), (r'invisib|in visible', 2300), (r'\bduds?\b', 2300),
    (r'draw game|tie game|\bthe (draw|rog) game|it.?s a draw|nobody wins', 1700),
    (r'^you win|\bwinner\b|proud of (you|ya)|game over', 2000),
    (r'hurry', 2700), (r'go outside|\bquit', 2600),
]
SKIP_PREFIX = {'BOMB', 'BOMB_', 'ALARM'}   # explosion / alarm effects, not voices
FAMILIES = {}
for fam in ['ADD ZAA JDD', 'PUPP ZAFP JUPP', 'DIS ZAD', 'EOFM ZACM JJFM', 'GEN ZAI', 'DMB ZAE JMB', 'PGAD ZAHD JGAD', 'PGAPU ZAHPU JGAP']:
    ps = fam.split()
    for p in ps: FAMILIES[p] = [q for q in ps if q != p]

out = collections.defaultdict(list); crude = collections.defaultdict(list); report = []
for n in extra:
    if n in FIXED and FIXED[n] is None: continue
    p, num = split(n)
    if p in SKIP_PREFIX: continue
    c = FIXED.get(n)
    how = 'fixed'
    # DIS## and ZAD## share line numbers: one disease name per line
    DIS_LINE = {1: 2300, 3: 3200, 4: 3100, 6: 3300, 7: 3000, 8: 3400, 9: 3400, 10: 2300, 11: 2300, 13: 3050, 14: 2300, 15: 2300, 16: 3350}
    if c is None and p in ('DIS', 'ZAD') and num and int(num) in DIS_LINE: c = DIS_LINE[int(num)]; how = 'disline'
    if c is None and line_cat.get((p, num)): c = line_cat[(p, num)].most_common(1)[0][0]; how = 'sibling'
    # the same line recorded by another voice actor (JGAP13 = PGAPU13A = ZAHPU13A ...)
    if c is None and num:
        for q in FAMILIES.get(p, ()):
            if line_cat.get((q, num)): c = line_cat[(q, num)].most_common(1)[0][0]; how = 'family'; break
    # announcer lines for the start of a match ("Bombers ready!", "Let's get ready to rumble!") that
    # the original never plays: the port gives them their own event (9000, round start)
    if c is None and p in ('ZABM', 'JOFM', 'SOFM'): c = 9000; how = 'announcer'
    if c is None and pref_cat.get(p): c = pref_cat[p].most_common(1)[0][0]; how = 'prefix'
    if c is None: c = 700; how = 'default-taunt'
    t = trans.get(n.lower(), '')
    for rx, kc in KEYWORDS:
        if how in ('fixed', 'disline'): break
        if re.search(rx, t.strip(), re.I) and not (kc == 2000 and how == 'sibling' and c in (700, 1400)):
            c = kc; how = 'keyword'; break
    is_crude = n in CRUDE_NAMES or line_key(n) in CRUDE_LINES or bool(CRUDE_RE.search(t))
    (crude if is_crude else out)[c].append(n.lower())
    report.append((n, c, how, 'CRUDE' if is_crude else '', t))
# child friendly block list: shipped voice clips + clean extras that are still unsuitable
child = sorted({n.lower() for n, ids in ref.items() if any(cat_of(i) is not None or 320 <= i <= 322 for i in ids)
                and child_bad(n, trans.get(n.lower(), ''))} | {n for lst in out.values() for n in lst if child_bad(n.upper(), trans.get(n, ''))})
with open(out_js, 'w') as f:
    f.write('// Unused voice recordings from the CD, assigned to SOUNDLST categories (key = first id of the range).\n')
    f.write('// Generated by tools/build_voices.py - see that file for how lines were classified.\n')
    f.write('window.AB_VOICES = ' + json.dumps({'extra': out, 'crude': crude, 'child': child}, separators=(',', ':')) + ';\n')
pack = {}
for lst in list(out.values()) + list(crude.values()):
    for n in lst: pack[n] = base64.b64encode(open(os.path.join(mp3dir, n + '.mp3'), 'rb').read()).decode()
with open(out_pack, 'w') as f:
    f.write('// Extra voice clips (unused takes from Atomic Bomberman DATA/SOUND). Generated - do not edit.\n')
    f.write('Object.assign(window.AB_SFX_PACK = window.AB_SFX_PACK || {}, ' + json.dumps(pack, separators=(',', ':')) + ');\n')
json.dump(report, open(os.path.join(os.path.dirname(out_js), 'voices_report.json'), 'w'), indent=0)
cnt = collections.Counter(r[1] for r in report)
print('extra', sum(len(v) for v in out.values()), 'crude', sum(len(v) for v in crude.values()), 'child-blocked', len(child), dict(cnt))
