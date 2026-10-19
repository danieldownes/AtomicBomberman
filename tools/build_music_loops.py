#!/usr/bin/env python3
"""Seamless music loops: package the looped tracks as scripts, and (re)measure their loop points.

Some tracks end by repeating their opening bars, so looping the whole file plays those bars twice.
js/audio.js loops them through Web Audio up to where the opening comes round again
(AB.audio.MUSIC_LOOPS). Web Audio needs the file's bytes: over http the game fetches the .mp3, but a
page opened from disk (file://) may not fetch, so each looped track also comes as a script,
audio/music/<name>.js, calling AB_MUSIC(name, base64 mp3) - the same trick as the sound clips.

Usage (from the repository root):
  python tools/build_music_loops.py            writes web/audio/music/<name>.js for the looped tracks
  python tools/build_music_loops.py --measure  also prints each track's loop point (needs ffmpeg
                                               and numpy/scipy): where the opening recurs at the end
"""
import base64, os, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MUSIC = os.path.join(ROOT, 'web', 'audio', 'music')
LOOPED = ['menu', 'battle', 'pyramid', 'sewer']        # keep in step with AB.audio.MUSIC_LOOPS


def wrap(name):
    src = os.path.join(MUSIC, name + '.mp3')
    b64 = base64.b64encode(open(src, 'rb').read()).decode('ascii')
    out = os.path.join(MUSIC, name + '.js')
    with open(out, 'w', newline='\n') as f:
        f.write(f"AB_MUSIC('{name}','{b64}');\n")
    return out, os.path.getsize(out)


def measure(name):
    import numpy as np
    from scipy.signal import fftconvolve
    raw = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', os.path.join(MUSIC, name + '.mp3'),
                          '-ac', '1', '-f', 'f32le', '-'], check=True, capture_output=True).stdout
    probe = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate',
                            '-of', 'default=nw=1:nk=1', os.path.join(MUSIC, name + '.mp3')], check=True, capture_output=True, text=True)
    sr = int(probe.stdout.strip())
    m = np.frombuffer(raw, dtype=np.float32)
    seg = m[:3 * sr]
    start = len(m) // 2
    search = m[start:]
    corr = fftconvolve(search, seg[::-1], mode='valid')
    norm = np.sqrt(fftconvolve(search ** 2, np.ones(len(seg)), mode='valid') * (seg ** 2).sum()) + 1e-9
    nc = corr / norm
    i = int(np.argmax(nc))
    return (start + i) / sr, float(nc[i])


if __name__ == '__main__':
    for name in LOOPED:
        out, size = wrap(name)
        line = f'{name:8s} -> {os.path.relpath(out, ROOT)} ({size // 1024} KB)'
        if '--measure' in sys.argv:
            t, c = measure(name)
            line += f'   opening recurs at {t:.6f} s ({c:.3f} alike)'
        print(line)
