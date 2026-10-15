# Transcribe voice clips with Whisper base.en (sherpa-onnx). usage: [WHISPER_DIR=model folder] whisper_stt.py out.json files...
import sys, json, subprocess, os, numpy as np, sherpa_onnx
M = os.environ.get('WHISPER_DIR', '/home/claude/asr/sherpa-onnx-whisper-base.en').rstrip('/') + '/'   # model folder
rec = sherpa_onnx.OfflineRecognizer.from_whisper(encoder=M + 'base.en-encoder.int8.onnx', decoder=M + 'base.en-decoder.int8.onnx',
                                                 tokens=M + 'base.en-tokens.txt', language='en', task='transcribe', num_threads=2)
out = {}
if os.path.exists(sys.argv[1]): out = json.load(open(sys.argv[1]))
files = [f for f in sys.argv[2:] if os.path.basename(f)[:-5] not in out]
B = 16
for i in range(0, len(files), B):
    streams = []
    batch = files[i:i + B]
    for fn in batch:
        pcm = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', fn, '-f', 's16le', '-ac', '1', '-ar', '16000', '-'], capture_output=True).stdout
        a = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
        a = a[:16000 * 29]
        s = rec.create_stream(); s.accept_waveform(16000, a); streams.append(s)
    rec.decode_streams(streams)
    for fn, s in zip(batch, streams): out[os.path.basename(fn)[:-5]] = s.result.text.strip()
    json.dump(out, open(sys.argv[1], 'w'), indent=0)
    print(i + len(batch), '/', len(files), flush=True)
