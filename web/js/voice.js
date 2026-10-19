// Voice chat for network rooms, over the same WebRTC links as the game (no outside service).
//
// While you are in a room with voice chat on, every computer in the room hears every other: one audio
// call per pair of computers (js/netplay.js decides who calls whom, PeerJS carries it, through the
// TURN relay when needed). Rooms hold at most five computers, so everyone simply sends their voice to
// each of the others; no server mixes anything.
//
//   microphone (browser echo cancellation, noise suppression, auto gain)
//     -> level meter -> voice gate / mute (a gain) -> the stream every call sends
//   each call's incoming voice -> its own <audio> element (volume per person)
//
// The voice gate sends only while you speak (the level is over the threshold, plus a short hold), so
// the room doesn't hear your keyboard and leftover game sound between sentences. Game sounds are kept
// out of the microphone by the browser's echo cancellation; js/audio.js setEchoSafe makes it see them.
'use strict';
(function (AB) {
  const V = AB.voice = {};
  const now = () => performance.now();
  const DEF = { on: true, gate: true, gateLevel: 5, volume: 8, vols: {}, deviceId: '', echoSafe: true, duck: true };
  const DUCK = 0.3;      // the game's sound and music while someone else talks (with "duck" on)
  V.cfg = function () {
    const S = AB.settings;
    if (!S.voice || typeof S.voice !== 'object') S.voice = {};
    const v = S.voice;
    for (const k in DEF) if (v[k] === undefined) v[k] = k === 'vols' ? {} : DEF[k];
    if (!v.vols || typeof v.vols !== 'object') v.vols = {};
    return v;
  };
  V.save = () => AB.saveSettings();

  // mic: 'off' (voice chat off or not in a room) | 'asking' | 'live' | 'denied' | 'none' (no microphone) | 'error'
  V.mic = 'off';
  V.muted = false;
  V.level = 0;           // microphone level, 0..1 (for the meter)
  V.open = false;        // sending right now (gate open, not muted)
  V.talking = {};        // computer id -> true while that computer sends (it tells the room)
  V.onTalk = null;       // (open) -> void: set by js/netplay.js to tell the room
  V.onState = null;      // () -> void: voice on/off or mic state changed (js/netplay.js tells the host)
  let actx = null, dest = null, gain = null, analyser = null, buf = null, micStream = null, micSrc = null, timer = null;
  let lastLoud = 0, active = false, lastHeard = -1e9;
  const remotes = new Map();   // computer id -> { call, el, stream, at }

  V.active = () => active;
  // the threshold in dBFS for a gate level of 1 (most sensitive) .. 10
  V.thresholdDb = (lv) => -64 + AB.clamp(lv | 0, 1, 10) * 4;
  V.levelDb = () => (V.level > 0 ? 20 * Math.log10(V.level) : -100);

  function graph() {
    if (actx) return;
    const C = window.AudioContext || window.webkitAudioContext;
    actx = new C();
    dest = actx.createMediaStreamDestination();
    gain = actx.createGain(); gain.gain.value = 0;
    gain.connect(dest);
    analyser = actx.createAnalyser(); analyser.fftSize = 1024;
    buf = new Float32Array(analyser.fftSize);
  }
  // the stream the calls send (silence until there is a microphone and the gate opens)
  V.outStream = function () { graph(); return dest.stream; };

  // voice chat starts when you enter a room (if it's on in your voice settings) and stops when you leave
  V.start = function () {
    if (!V.cfg().on) { V.stop(); return; }
    if (active) return;
    active = true;
    graph();
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    clearInterval(timer); timer = setInterval(tick, 40);
    askMic();
    if (V.onState) V.onState();
  };
  V.stop = function () {
    active = false;
    clearInterval(timer); timer = null;
    for (const id of [...remotes.keys()]) V.dropRemote(id);
    stopMic();
    V.mic = 'off'; V.open = false; V.level = 0; V.talking = {};
    AB.audio.setEchoSafe(false); AB.audio.setDuck(1);
    if (V.onState) V.onState();
  };
  function stopMic() {
    if (micSrc) try { micSrc.disconnect(); } catch (e) {}
    micSrc = null;
    if (micStream) for (const t of micStream.getTracks()) t.stop();
    micStream = null;
  }
  async function askMic() {
    stopMic();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { V.mic = 'none'; if (V.onState) V.onState(); return; }
    V.mic = 'asking';
    const c = V.cfg();
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    if (c.deviceId) audio.deviceId = { exact: c.deviceId };
    try {
      let s;
      try { s = await navigator.mediaDevices.getUserMedia({ audio }); }
      catch (e) { if (c.deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) { delete audio.deviceId; s = await navigator.mediaDevices.getUserMedia({ audio }); } else throw e; }
      if (!active) { for (const t of s.getTracks()) t.stop(); return; }
      micStream = s;
      micSrc = actx.createMediaStreamSource(s);
      micSrc.connect(analyser); micSrc.connect(gain);
      V.mic = 'live';
      if (c.echoSafe) AB.audio.setEchoSafe(true);
    } catch (e) {
      V.mic = e.name === 'NotAllowedError' || e.name === 'SecurityError' ? 'denied' : e.name === 'NotFoundError' ? 'none' : 'error';
      console.warn('microphone:', e.name, e.message);
    }
    if (V.onState) V.onState();
  }
  V.retryMic = () => { if (active) askMic(); };
  V.setDevice = function (id) { V.cfg().deviceId = id || ''; V.save(); if (active) askMic(); };
  V.devices = async function () {
    try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput'); } catch (e) { return []; }
  };
  V.setMuted = function (m) { V.muted = !!m; if (V.onState) V.onState(); };
  V.toggleMute = function () { V.setMuted(!V.muted); return V.muted; };
  V.setEchoSafe = function (on) { V.cfg().echoSafe = !!on; V.save(); AB.audio.setEchoSafe(!!on && active && V.mic === 'live'); };

  // every 40 ms: the microphone's level, and the gate
  function tick() {
    if (!active) return;
    if (actx.state === 'suspended') actx.resume().catch(() => {});
    let rms = 0;
    if (micSrc) { analyser.getFloatTimeDomainData(buf); let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]; rms = Math.sqrt(sum / buf.length); }
    V.level = rms > V.level ? rms : V.level * 0.85 + rms * 0.15;
    const c = V.cfg(), t = now();
    if (20 * Math.log10(rms + 1e-9) > V.thresholdDb(c.gateLevel)) lastLoud = t;
    const open = V.mic === 'live' && !V.muted && (!c.gate || t - lastLoud < 450);
    // someone else talking: the game goes quieter, back up half a second after they stop
    if (Object.keys(V.talking).length) lastHeard = t;
    AB.audio.setDuck(c.duck && t - lastHeard < 500 ? DUCK : 1);
    if (open !== V.open) {
      V.open = open;
      // quick to open, a little softer to close
      gain.gain.cancelScheduledValues(actx.currentTime);
      gain.gain.setTargetAtTime(open ? 1 : 0, actx.currentTime, open ? 0.005 : 0.05);
      if (V.onTalk) V.onTalk(open);
    }
  }

  // ---- the other computers' voices ----
  V.remoteIds = () => [...remotes.keys()];
  V.remoteCall = (id) => { const r = remotes.get(id); return r ? r.call : null; };
  V.hasRemote = (id) => remotes.has(id);
  V.remoteState = function (id) {
    const r = remotes.get(id);
    return !r ? 'none' : r.stream ? 'connected' : 'connecting';
  };
  V.addRemote = function (id, call) {
    V.dropRemote(id);
    const r = { call, el: null, stream: null, at: now() };
    remotes.set(id, r);
    call.on('stream', (st) => {
      if (remotes.get(id) !== r) return;
      r.stream = st;
      if (!r.el) { r.el = document.createElement('audio'); r.el.autoplay = true; r.el.style.display = 'none'; document.body.appendChild(r.el); }
      r.el.srcObject = st;
      applyVolume(id);
      r.el.play().catch(() => {});
    });
    const gone = () => { if (remotes.get(id) === r) V.dropRemote(id); };
    call.on('close', gone); call.on('error', gone);
    // no answer in 15 s: give up for now (js/netplay.js tries again later)
    setTimeout(() => { if (remotes.get(id) === r && !r.stream) V.dropRemote(id); }, 15000);
  };
  V.dropRemote = function (id) {
    const r = remotes.get(id); if (!r) return;
    remotes.delete(id);
    try { r.call.close(); } catch (e) {}
    if (r.el) { r.el.srcObject = null; r.el.remove(); }
    delete V.talking[id];
  };
  // volume of a person (by name, so it is remembered between rooms): 0..10
  V.volumeOf = (name) => { const v = V.cfg().vols[name]; return Number.isInteger(v) ? v : 10; };
  V.setVolumeOf = function (name, v) { V.cfg().vols[name] = AB.clamp(v | 0, 0, 10); V.save(); for (const id of remotes.keys()) applyVolume(id); };
  V.setVolume = function (v) { V.cfg().volume = AB.clamp(v | 0, 0, 10); V.save(); for (const id of remotes.keys()) applyVolume(id); };
  V.nameOf = null;       // (computer id) -> name, set by js/netplay.js
  function applyVolume(id) {
    const r = remotes.get(id); if (!r || !r.el) return;
    const name = V.nameOf ? V.nameOf(id) : id;
    r.el.volume = AB.clamp((V.cfg().volume / 10) * (V.volumeOf(name) / 10), 0, 1);
  }
  V.applyVolumes = () => { for (const id of remotes.keys()) applyVolume(id); };
  V.setTalking = function (id, on) { if (on) V.talking[id] = true; else delete V.talking[id]; };
  // is this computer (id) speaking right now? (mine: my own gate)
  V.isTalking = (id, mine) => (mine ? V.open : !!V.talking[id]);

  // ---- a little speaker / crossed microphone icon ----
  // state: 'talk' (waves, animated), 'muted' (mic crossed out), 'listen' (speaker, no waves)
  V.drawIcon = function (ctx, x, y, state, t = 0) {
    ctx.save();
    ctx.lineWidth = 1.5; ctx.lineCap = 'round';
    if (state === 'muted') {
      ctx.strokeStyle = ctx.fillStyle = '#ff9030';
      ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x - 2.5, y - 6, 5, 8, 2.5) : ctx.rect(x - 2.5, y - 6, 5, 8); ctx.fill();
      ctx.beginPath(); ctx.arc(x, y - 1, 5, 0, Math.PI); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 6); ctx.stroke();
      ctx.strokeStyle = '#ff3020'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 6, y - 7); ctx.lineTo(x + 6, y + 6); ctx.stroke();
    } else {
      const col = state === 'talk' ? '#60f060' : '#7a8a8a';
      ctx.fillStyle = ctx.strokeStyle = col;
      ctx.beginPath(); ctx.moveTo(x - 6, y - 2); ctx.lineTo(x - 3, y - 2); ctx.lineTo(x + 1, y - 6); ctx.lineTo(x + 1, y + 6); ctx.lineTo(x - 3, y + 2); ctx.lineTo(x - 6, y + 2); ctx.closePath(); ctx.fill();
      if (state === 'talk') {
        const k = (t >> 3) % 3;
        for (let i = 0; i <= k; i++) { ctx.beginPath(); ctx.arc(x + 1, y, 3.5 + i * 3, -0.8, 0.8); ctx.stroke(); }
      }
    }
    ctx.restore();
  };
})(window.AB);
