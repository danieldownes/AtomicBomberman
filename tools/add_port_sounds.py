#!/usr/bin/env python3
"""Sounds the port adds to the CD's: added to the sound catalog (web/data/sounds.js) and written as
clips (web/audio/clips/<name>.js), the same as the CD's sounds. tools/build_sounds.py runs this at its
end; run it on its own after changing PORT_SOUNDS (from the repository root; needs ffmpeg):

  python tools/add_port_sounds.py
  python tools/add_port_sounds.py --wilhelm SESSION.flac    first cut the Wilhelm scream (below)

The Wilhelm scream: the original 1951 Sunset Editorial session, "Man eaten by alligator; screams",
released CC0 by USC (archive.org/details/SSE_Library_VOICES, freesound.org sound 675810). The session
has several screams; the fourth is the one known as the Wilhelm scream. --wilhelm finds the screams
in the session by their loudness and keeps the fourth, with a little air either side, as
tools/port_sounds/wilhelm.flac.
"""
import json, os, re, subprocess, sys, base64
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, 'web')
SRC = os.path.join(ROOT, 'tools', 'port_sounds')
SHIPPED, EXTRA, CRUDE, CHILD, ODD, SFX = 1, 2, 4, 8, 16, 32
# name: clip name; event: the catalog event's first id; flags as in sounds.js (EXTRA | SFX: on in the
# Child friendly, Extended and Uncensored presets, off in "Original set", like the CD's unused takes)
PORT_SOUNDS = [
    {'name': 'wilhelm', 'event': 300, 'label': 'Wilhelm scream', 'flags': EXTRA | SFX, 'src': 'wilhelm.flac',
     'text': '[Wilhelm scream] 1951 Sunset Editorial session (USC, CC0)'},
]


def decode(path, sr=22050, ch=2):
    raw = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', path, '-ac', str(ch), '-ar', str(sr), '-f', 'f32le', '-'],
                         check=True, capture_output=True).stdout
    return np.frombuffer(raw, np.float32).reshape(-1, ch)


def cut_wilhelm(session):
    """the fourth scream of the session, as tools/port_sounds/wilhelm.flac"""
    sr = 48000
    x = decode(session, sr, 1)[:, 0].astype(np.float64)
    hop = int(0.01 * sr)
    env = np.array([np.sqrt(np.mean(x[i:i + hop] ** 2)) for i in range(0, len(x) - hop, hop)])
    env = np.convolve(env, np.ones(5) / 5, mode='same')
    floor = np.percentile(env, 20)
    thr = floor + 0.12 * (env.max() - floor)
    loud = env > thr
    # runs of loudness, joined across gaps under 0.25 s, at least 0.3 s long
    runs, i = [], 0
    while i < len(loud):
        if loud[i]:
            j = i
            while j < len(loud) and loud[j]: j += 1
            runs.append([i, j]); i = j
        else: i += 1
    merged = []
    for r in runs:
        if merged and r[0] - merged[-1][1] < 25: merged[-1][1] = r[1]
        else: merged.append(r)
    # a scream is loud most of the way through: the reference tone at the start and the spoken slate
    # (a spike, then talking) stay at 0.27 and 0.19 of the loudest level, the six screams at 0.37-0.84
    screams = [r for r in merged if r[1] - r[0] >= 30 and np.median(env[r[0]:r[1]]) >= 0.33 * env.max()]
    print('screams found (s):', ', '.join('%.2f-%.2f' % (a * hop / sr, b * hop / sr) for a, b in screams))
    if len(screams) < 4: sys.exit('fewer than four screams found: check the file')
    a, b = screams[3]
    t0, t1 = max(0, a * hop / sr - 0.05), min(len(x) / sr, b * hop / sr + 0.3)
    os.makedirs(SRC, exist_ok=True)
    out = os.path.join(SRC, 'wilhelm.flac')
    subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-y', '-i', session, '-ss', '%.3f' % t0, '-to', '%.3f' % t1,
                    '-af', 'afade=t=in:d=0.02,areverse,afade=t=in:d=0.08,areverse', out], check=True)
    print('the fourth: %.2f s to %.2f s ->' % (t0, t1), os.path.relpath(out, ROOT))


def add():
    path = os.path.join(WEB, 'data', 'sounds.js')
    text = open(path, encoding='utf-8').read()
    i = text.index('window.AB_SOUNDS = ')
    head, body = text[:i], text[i + len('window.AB_SOUNDS = '):].rstrip().rstrip(';')
    cat = json.loads(body)
    names = {s['name'] for s in PORT_SOUNDS}
    for e in cat['events']:                    # (again: replace what an earlier run added)
        e['groups'] = [g for g in e['groups'] if not any(n in names for n in g['clips'])]
    for s in PORT_SOUNDS:
        ev = next(e for e in cat['events'] if e['lo'] == s['event'])
        ev['groups'].append({'label': s['label'], 'clips': [s['name']]})
        cat['clips'][s['name']] = [s['flags'], s['text']]
        # the clip: like the CD's sound effects (tools/convert_audio.sh), 22050 Hz stereo MP3 at 64 kbit/s,
        # brought up to a -0.5 dB peak (the CD's screams peak at full scale)
        src = os.path.join(SRC, s['src'])
        peak = float(np.abs(decode(src)).max())
        gain = -0.5 - 20 * np.log10(max(peak, 1e-6))
        mp3 = subprocess.run(['ffmpeg', '-nostdin', '-loglevel', 'error', '-i', src, '-af', 'volume=%.2fdB' % gain, '-ar', '22050', '-ac', '2',
                              '-c:a', 'libmp3lame', '-b:a', '64k', '-f', 'mp3', '-'], check=True, capture_output=True).stdout
        with open(os.path.join(WEB, 'audio', 'clips', s['name'] + '.js'), 'w', newline='\n') as f:
            f.write('AB_CLIP("%s","%s");\n' % (s['name'], base64.b64encode(mp3).decode()))
        print('%-8s -> event %d "%s" (%d KB, %+.1f dB)' % (s['name'], ev['lo'], ev['name'], len(mp3) // 1024, gain))
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + 'window.AB_SOUNDS = ' + json.dumps(cat, separators=(',', ':')) + ';\n')


if __name__ == '__main__':
    if '--wilhelm' in sys.argv: cut_wilhelm(sys.argv[sys.argv.index('--wilhelm') + 1])
    add()
