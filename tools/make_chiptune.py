"""Synthesise the music for the port's "Classic" arena: an original 8-bit style loop (two pulse
channels, triangle bass, noise drums), written for this port. usage: make_chiptune.py out.wav"""
import sys, numpy as np

SR, BPM = 22050, 144
BEAT = 60 / BPM
NOTE = {n: i for i, n in enumerate(['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'])}
def hz(n):
    name, octv = n[:-1], int(n[-1])
    return 440 * 2 ** ((NOTE[name] + 12 * (octv + 1) - 69) / 12)

# melody: (note, beats) per bar, 4 beats a bar; 'r' = rest
A = [
    [('E5', .5), ('G5', .5), ('C6', 1), ('B5', .5), ('A5', .5), ('G5', 1)],
    [('A5', 1.5), ('G5', .5), ('E5', 1), ('C5', 1)],
    [('F5', .5), ('A5', .5), ('C6', 1), ('A5', .5), ('F5', .5), ('A5', 1)],
    [('G5', 2), ('D5', 1), ('G5', 1)],
    [('E5', .5), ('G5', .5), ('C6', 1), ('D6', .5), ('C6', .5), ('B5', 1)],
    [('C6', 1), ('A5', 1), ('E5', 1), ('A5', 1)],
    [('F5', 1), ('A5', 1), ('G5', 1), ('B5', 1)],
    [('C6', 3), ('r', 1)],
]
B = [
    [('A5', .5), ('C6', .5), ('F6', 1), ('E6', .5), ('D6', .5), ('C6', 1)],
    [('B5', 1.5), ('A5', .5), ('G5', 1), ('D5', 1)],
    [('E5', .5), ('G5', .5), ('B5', 1), ('G5', .5), ('E5', .5), ('B4', 1)],
    [('C5', 1), ('E5', 1), ('A5', 2)],
    [('F5', .5), ('A5', .5), ('C6', 1), ('A5', .5), ('C6', .5), ('F6', 1)],
    [('D6', 1), ('B5', 1), ('G5', 1), ('B5', 1)],
    [('C6', 1), ('G5', 1), ('E5', 1), ('G5', 1)],
    [('C6', 2), ('B5', 1), ('D6', 1)],
]
CH_A = ['C', 'Am', 'F', 'G', 'C', 'Am', 'F|G', 'C']
CH_B = ['F', 'G', 'Em', 'Am', 'F', 'G', 'C', 'C|G']
CHORD = {'C': ['C', 'E', 'G'], 'Am': ['A', 'C', 'E'], 'F': ['F', 'A', 'C'], 'G': ['G', 'B', 'D'], 'Em': ['E', 'G', 'B']}
ROOT = {'C': 'C', 'Am': 'A', 'F': 'F', 'G': 'G', 'Em': 'E'}
bars_mel = A + B + A + B
bars_ch = CH_A + CH_B + CH_A + CH_B
total = len(bars_mel) * 4 * BEAT
N = int(total * SR)
mix = np.zeros(N)
t_all = np.arange(N) / SR

def env(n, a=0.004, d=0.06, s=0.65, r=0.03):
    e = np.ones(n) * s
    ai, di, ri = int(a * SR), int(d * SR), int(r * SR)
    ai = max(1, min(ai, n)); e[:ai] = np.linspace(0, 1, ai)
    if ai < n: e[ai:ai + di] = np.linspace(1, s, len(e[ai:ai + di]))
    if ri < n: e[-ri:] *= np.linspace(1, 0, ri)
    return e

def pulse(f, n, duty, vib=0.0):
    t = np.arange(n) / SR
    ph = (f * t + (vib * np.sin(2 * np.pi * 5.5 * t) * (t > 0.15)) / (2 * np.pi)) % 1
    return np.where(ph < duty, 1.0, -1.0)

def tri(f, n):
    ph = (f * np.arange(n) / SR) % 1
    return (np.abs(ph * 4 - 2) - 1) * -1    # stepped feel is approximated by quantising below

def put(start, sig):
    i = int(start * SR); j = min(N, i + len(sig))
    if i < N: mix[i:j] += sig[:j - i]

rng = np.random.default_rng(7)
for bi, (bar, ch) in enumerate(zip(bars_mel, bars_ch)):
    t0 = bi * 4 * BEAT
    # lead
    pos = 0
    for n, b in bar:
        dur = b * BEAT
        if n != 'r':
            k = int(dur * SR * 0.92)
            put(t0 + pos, 0.20 * pulse(hz(n), k, 0.25, vib=0.6) * env(k))
        pos += dur
    # harmony arpeggio (16ths) and triangle bass (8ths)
    halves = ch.split('|')
    for h, cname in enumerate(halves):
        seg = 4 / len(halves)
        tones = CHORD[cname]
        for s in range(int(seg * 4)):
            note = tones[[0, 1, 2, 1][s % 4]] + '4'
            k = int(BEAT / 4 * SR * 0.8)
            put(t0 + (h * seg + s / 4) * BEAT, 0.07 * pulse(hz(note), k, 0.5) * env(k, d=0.03, s=0.4))
        for s in range(int(seg * 2)):
            note = ROOT[cname] + ('2' if s % 2 == 0 else '3')
            k = int(BEAT / 2 * SR * 0.9)
            w = np.round(tri(hz(note), k) * 7) / 7          # 4-bit-ish triangle steps
            put(t0 + (h * seg + s / 2) * BEAT, 0.22 * w * env(k, d=0.02, s=0.9))
    # drums
    for beat in range(4):
        tb = t0 + beat * BEAT
        if beat in (0, 2):
            k = int(0.12 * SR); tt = np.arange(k) / SR
            put(tb, 0.35 * np.sin(2 * np.pi * (110 * tt - 300 * tt * tt)) * np.exp(-tt * 28))
        else:
            k = int(0.10 * SR)
            put(tb, 0.16 * np.sign(rng.standard_normal(k)) * np.exp(-np.arange(k) / SR * 30))
        for half in (0, 0.5):
            k = int(0.03 * SR)
            put(tb + half * BEAT, 0.05 * np.sign(rng.standard_normal(k)) * np.exp(-np.arange(k) / SR * 120))

mix /= max(1e-6, np.abs(mix).max()) / 0.85
pcm = (np.clip(mix, -1, 1) * 32767).astype('<i2')
st = np.repeat(pcm[:, None], 2, axis=1)
import wave
with wave.open(sys.argv[1], 'wb') as w:
    w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(st.tobytes())
print('seconds', round(total, 1))
