// Audio: every sound from the CD (.RSS, 22 kHz 16-bit stereo) re-encoded to mp3, one small script per
// clip in audio/clips/ so they load on demand, also from file://. Music streams through <audio>.
//
// Sounds are organised by data/sounds.js as the original uses them: a game event is a SOUNDLST.RES id
// range, each event holds phrases (takes that say the same words) and each phrase holds takes. Which
// takes may play comes from a preset (child friendly / original / extended / uncensored / off) plus
// the player's own ticks in the Sounds menu. Like the original, which keeps only part of each series
// in memory, every round picks a fresh handful of phrases per event and loads just those clips.
'use strict';
(function (AB) {
  const A = AB.audio = {};
  const SL = window.AB_DATA.sounds;          // SOUNDLST id -> clip name
  const CAT = window.AB_SOUNDS || { events: [], clips: {} };
  let ctx = null, sfxGain = null, musicGain = null;
  const buffers = {};                        // name -> AudioBuffer | Promise | 'bad'
  const playing = [];
  let music = null, musicName = null, musicVol = 0.7, sfxVol = 0.9, enabled = true;
  const MAX_CONCURRENT = 8;
  const ids = Object.keys(SL).map(Number).sort((a, b) => a - b);

  // ---- catalog indexes ----
  const EV = CAT.events;
  EV.forEach((e, i) => { e.i = i; e.clipList = e.groups.flatMap(g => g.clips); e.groups.forEach((g, j) => { g.i = j; }); });
  A.events = EV;
  A.clipInfo = (n) => CAT.clips[n] || [0, ''];
  const evFor = (id) => EV.find(e => id >= e.lo && id <= e.hi);
  const evOverlap = (lo, hi) => EV.filter(e => e.lo <= hi && e.hi >= lo);
  A.eventFor = evFor;

  // ---- presets / custom selection ----
  const F = { SHIPPED: 1, EXTRA: 2, CRUDE: 4, CHILD: 8, ODD: 16, SFX: 32 };
  A.FLAGS = F;
  A.PRESETS = ['child', 'original', 'extended', 'uncensored', 'off'];
  A.PRESET_LABEL = { child: 'Child friendly', original: 'Original set', extended: 'Extended (unused CD takes)', uncensored: 'Extended + uncensored', off: 'Voices off' };
  let preset = 'extended', overrides = {}, variety = 'normal';
  A.presetOn = function (p, e, n) {
    const f = A.clipInfo(n)[0];
    if (f & F.ODD) return false;
    const base = !!(f & F.SHIPPED) || (p !== 'original' && p !== 'off' && !(f & F.CRUDE));
    if (p === 'original') return !!(f & F.SHIPPED);
    if (p === 'off') return (e.kind === 'sfx' || (f & F.SFX)) ? !!(f & F.SHIPPED) : false;
    if (p === 'uncensored') return base || !!(f & F.CRUDE);
    if (p === 'child') return base && !(f & F.CHILD);
    return base;
  };
  const key = (e, n) => e.lo + ':' + n;
  A.isOn = (e, n) => { const k = key(e, n); return k in overrides ? !!overrides[k] : A.presetOn(preset, e, n); };
  A.setOn = function (e, n, on) {
    const k = key(e, n);
    if (on === A.presetOn(preset, e, n)) delete overrides[k]; else overrides[k] = on ? 1 : 0;
    selDirty = true;
  };
  // a network match plays the host's preset and variety on every computer (no own ticks), so all hear
  // the same sounds; null goes back to this computer's own settings
  let forced = null;
  A.forceProfile = function (p) {
    forced = p && A.PRESETS.includes(p.preset) ? { preset: p.preset, variety: MULT[p.variety] !== undefined ? p.variety : 'normal' } : null;
    if (forced) { preset = forced.preset; overrides = {}; variety = forced.variety; selDirty = true; }
    else A.configure(AB.settings);
  };
  A.forced = () => forced;
  A.configure = function (S) {
    if (forced) return;
    preset = A.PRESETS.includes(S.voices) ? S.voices : 'extended';
    overrides = S.soundOverrides || (S.soundOverrides = {});
    variety = S.soundVariety || 'normal';
    selDirty = true;
  };
  A.preset = () => preset;
  A.isCustom = () => Object.keys(overrides).length > 0;
  A.applyPreset = function (S, p) { S.voices = p; S.soundOverrides = {}; A.configure(S); };
  A.groupState = function (e, g) { let on = 0; for (const n of g.clips) if (A.isOn(e, n)) on++; return on === 0 ? 0 : on === g.clips.length ? 2 : 1; };
  A.eventState = function (e) { let on = 0; for (const n of e.clipList) if (A.isOn(e, n)) on++; return on === 0 ? 0 : on === e.clipList.length ? 2 : 1; };
  A.countOn = function (e, list) { let on = 0; for (const n of list || e.clipList) if (A.isOn(e, n)) on++; return on; };

  // ---- loading clips (one script per clip) ----
  const pack = window.AB_SFX_PACK = window.AB_SFX_PACK || {};
  const waiting = {};                        // name -> [resolve]
  window.AB_CLIP = function (name, b64) { pack[name] = b64; const w = waiting[name]; delete waiting[name]; if (w) w.forEach(r => r(true)); };
  const loadingScripts = {};
  // At most MAX_DOWNLOADS clips download at once, sound effects (lane 0) before voices (lane 1), so the
  // arena picture and the effects a round can't do without aren't stuck behind a hundred voice clips.
  const MAX_DOWNLOADS = 8;
  const lanes = [[], []];
  let inflight = 0;
  function pump() {
    while (inflight < MAX_DOWNLOADS) {
      const q = lanes[0].length ? lanes[0] : lanes[1];
      if (!q.length) return;
      const start = q.shift();
      inflight++;
      start().then(() => { inflight--; pump(); });
    }
  }
  const isSfxClip = (n) => !!(((CAT.clips[n] || [0])[0]) & 32);
  const settle = (name, ok) => { const w = waiting[name]; delete waiting[name]; if (w) w.forEach(r => r(ok)); };
  // lane: 0 = needed now (effects, a sound asked for this moment), 1 = can wait; default by kind
  A.load = function (name, lane) {
    if (!name) return Promise.resolve(false);
    if (A.isLoaded(name)) return Promise.resolve(true);
    if (loadingScripts[name]) return loadingScripts[name];
    const p = new Promise((res) => {
      (waiting[name] = waiting[name] || []).push(res);
      lanes[lane !== undefined ? lane : isSfxClip(name) ? 0 : 1].push(() => new Promise((done) => {
        if (pack[name]) { settle(name, true); done(); return; }
        const s = document.createElement('script');
        s.src = 'audio/clips/' + encodeURIComponent(name) + '.js';
        s.onerror = () => { settle(name, false); done(); };
        s.onload = () => { s.remove(); settle(name, !!pack[name]); done(); };
        document.head.appendChild(s);
      }));
      pump();
    }).then((ok) => { delete loadingScripts[name]; return ok; });
    loadingScripts[name] = p;
    return p;
  };
  A.loadMany = function (names, onProgress) {
    const list = [...new Set(names)].filter(Boolean);
    let done = 0;
    return Promise.all(list.map(n => A.load(n).then(() => { done++; onProgress && onProgress(done / list.length); }))).then(() => list.length);
  };
  A.isLoaded = (n) => !!pack[n] || (buffers[n] && buffers[n] !== 'bad' && !(buffers[n] instanceof Promise));

  // ---- per-round selection ----
  const MULT = { few: 0.5, normal: 1, lots: 2, all: 0 };
  A.VARIETY = ['few', 'normal', 'lots', 'all'];
  A.VARIETY_LABEL = { few: 'Few (half)', normal: 'Normal', lots: 'Lots (double)', all: 'Everything ticked' };
  let roundSel = null, selDirty = true;
  const KEEP = new Set();                    // clips the menus need (never unloaded)
  // R: random 0..n-1 (cosmetic by default; a seeded one makes every computer pick the same)
  function shuffle(a, R = AB.crand) { for (let i = a.length - 1; i > 0; i--) { const j = R(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function pickFor(e, R = AB.crand) {
    const groups = [];
    for (const g of e.groups) { const on = g.clips.filter(n => A.isOn(e, n)); if (on.length) groups.push(on); }
    const m = MULT[variety];
    if (!m) return groups.flat();                     // "everything ticked"
    const lim = !e.limit ? Infinity : Math.max(2, Math.round(e.limit * m));
    shuffle(groups, R);
    const out = [];
    for (const takes of groups.slice(0, lim)) out.push(takes[R(takes.length)]);
    // few phrases on: add more takes of them so repeats still vary
    if (groups.length < lim) for (const takes of groups) for (const n of shuffle(takes.slice(), R)) if (!out.includes(n) && out.length < Math.min(lim, 24)) out.push(n);
    return out;
  }
  // a number from a string (FNV-1a): the same key gives the same pick on every computer
  const hash = (k) => { let h = 0x811c9dc5; for (const ch of String(k)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
  A.hash = hash;
  // choose this round's sounds; returns a promise that resolves once they are loaded. With a seed (a
  // network round's), every computer chooses the same ones.
  A.newRound = function (onProgress, seed) {
    roundSel = {};
    const rng = seed !== undefined && seed !== null ? new AB.Rng(hash('sounds:' + seed)) : null;
    const R = rng ? (n) => rng.int(n) : AB.crand;
    for (const e of EV) roundSel[e.lo] = pickFor(e, R);
    selDirty = false;
    const want = new Set(Object.values(roundSel).flat());
    for (const n of KEEP) want.add(n);
    // free last round's clips that are not needed now
    for (const n of Object.keys(pack)) if (!want.has(n)) delete pack[n];
    for (const n of Object.keys(buffers)) if (!want.has(n) && !(buffers[n] instanceof Promise)) delete buffers[n];
    // effects first: the promise also carries .effects, which resolves when they alone are in
    const list = [...want], total = list.length || 1;
    let done = 0;
    const one = (n, lane) => A.load(n, lane).then(() => { done++; if (onProgress) onProgress(done / total); });
    const effects = Promise.all(list.filter(isSfxClip).map(n => one(n, 0)));
    const voices = Promise.all(list.filter(n => !isSfxClip(n)).map(n => one(n, 1)));
    const all = Promise.all([effects, voices]).then(() => list.length);
    all.effects = effects;
    return all;
  };
  A.roundSelection = () => roundSel;
  // menus: make sure the menu/intro/quit events have something loaded
  A.loadMenuSounds = function () {
    const names = [];
    for (const lo of [10, 20, 40, 2600, 2800]) {
      const e = evFor(lo); if (!e) continue;
      const pick = pickFor(e).slice(0, e.kind === 'voice' ? 4 : 99);
      for (const n of pick) { names.push(n); KEEP.add(n); }
    }
    return A.loadMany(names);
  };

  // ---- Web Audio ----
  A.unlock = function () {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      ctx = new C();
      sfxGain = ctx.createGain(); sfxGain.gain.value = sfxVol; sfxGain.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = musicVol * duck; musicGain.connect(ctx.destination);
      // a seamless-loop track that had to start on an <audio> element: carry on in Web Audio from here
      if (music && musicName && music.loop && A.MUSIC_LOOPS[musicName] && canFetch()) startLoop(musicName, music.currentTime || 0);
    }
    if (ctx.state === 'suspended') ctx.resume();
    if (music && music.paused && musicName) music.play().catch(() => {});
  };
  A.ready = () => !!ctx && ctx.state === 'running';

  function b64ToBuf(b64) {
    const bin = atob(b64); const n = bin.length; const u = new Uint8Array(n);
    for (let i = 0; i < n; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  function decode(name) {
    if (buffers[name]) return buffers[name];
    if (!ctx || !pack[name]) return null;
    const p = ctx.decodeAudioData(b64ToBuf(pack[name])).then(buf => {
      // skip mp3 encoder padding / leading silence (max 60 ms) so effects stay snappy
      const ch = buf.getChannelData(0); const lim = Math.min(ch.length, Math.floor(buf.sampleRate * 0.06));
      let s = 0; while (s < lim && Math.abs(ch[s]) < 0.003) s++;
      buf._start = s / buf.sampleRate;
      buffers[name] = buf; return buf;
    }).catch(e => { console.warn('decode failed', name, e); buffers[name] = 'bad'; });
    buffers[name] = p;
    return p;
  }
  // decode the clips of these events now (timing-critical effects)
  A.predecode = function (lo, hi) {
    if (!ctx) return;
    const names = roundSel ? evOverlap(lo, hi).flatMap(e => roundSel[e.lo] || []) : [];
    for (const n of names) if (pack[n]) decode(n);
  };

  function playBuffer(buf, vol = 1, rate = 1, tag) {
    if (!buf || buf === 'bad' || !ctx) return null;
    while (playing.length >= MAX_CONCURRENT) { const o = playing.shift(); try { o.stop(); } catch (e) {} }
    const src = ctx.createBufferSource(); src.buffer = buf; src.playbackRate.value = rate;
    let node = src;
    if (vol !== 1) { const g = ctx.createGain(); g.gain.value = vol; src.connect(g); node = g; }
    node.connect(sfxGain);
    src.start(0, buf._start || 0);
    src._tag = tag;
    playing.push(src);
    src.onended = () => { const i = playing.indexOf(src); if (i >= 0) playing.splice(i, 1); };
    return src;
  }
  // play a clip by name (loads it first if needed; a clip arriving late is dropped unless `late`)
  A.playName = function (name, vol, opts) {
    if (!enabled || !ctx || !name) return;
    const t0 = performance.now(), late = opts && opts.late, tag = opts && opts.tag;
    const go = () => {
      const b = decode(name);
      if (!b) return;
      if (b instanceof Promise) b.then(buf => { if (late || performance.now() - t0 < 400) playBuffer(buf, vol, 1, tag); });
      else playBuffer(b, vol, 1, tag);
    };
    if (pack[name] || buffers[name]) go();
    else A.load(name, 0).then(ok => { if (ok && (late || performance.now() - t0 < 400)) go(); });
  };
  A.stopTag = function (tag) { for (const s of playing.slice()) if (s._tag === tag) { try { s.stop(); } catch (e) {} } };
  // menu preview: stops the previous preview first
  A.preview = function (name) { A.stopTag('preview'); A.playName(name, 1, { late: true, tag: 'preview' }); };

  // play an exact SOUNDLST id (menus, roulette) if that clip is ticked
  A.play = function (id, vol) {
    const n = SL[id]; if (!n || n === '0' || n === 'xxx') return;
    const e = evFor(id);
    if (e && !A.isOn(e, n.toLowerCase())) return;
    A.playName(n.toLowerCase(), vol);
  };
  // play a random sound for an id range [lo, hi]: this round's picks for the matching events. With a
  // key (network rounds: the event's tick and place), the pick comes from the key, so every computer
  // plays the same take, even one whose clip is still loading (it then plays late or not at all).
  A.playRange = function (lo, hi, vol, key) {
    const evs = evOverlap(lo, hi);
    if (!evs.length) return;
    if (selDirty && roundSel && !forced) for (const e of evs) roundSel[e.lo] = pickFor(e);
    let c = [];
    for (const e of evs) {
      const sel = roundSel ? roundSel[e.lo] : null;
      if (sel) c.push(...sel); else c.push(...e.clipList.filter(n => A.isOn(e, n)));
    }
    if (!c.length) return;
    if (key !== undefined && key !== null) { A.playName(c[hash(key) % c.length], vol); return; }
    const ready = c.filter(A.isLoaded);
    A.playName((ready.length ? ready : c)[AB.crand((ready.length ? ready : c).length)], vol);
  };
  A.rangeCount = function (lo, hi) { let k = 0; for (const id of ids) if (id >= lo && id <= hi) k++; return k; };
  // a random ticked take of a phrase / event (menu preview)
  A.sampleOf = function (e, list) { const on = list.filter(n => A.isOn(e, n)); const l = on.length ? on : list; return l[AB.crand(l.length)]; };

  // ---- echo-safe output (voice chat) ----
  // Browsers cancel the echo of what a page plays from the microphone, but Chrome only does that for
  // audio played through <audio>/<video> elements, not for Web Audio, which plays every game sound.
  // While voice chat has the microphone, the game sounds therefore take a detour: Web Audio -> a
  // WebRTC connection to this same page -> an <audio> element, so they are cancelled like the voices.
  // (Music already plays through an <audio> element.) It adds a few hundredths of a second.
  let loop = null;
  A.echoSafe = () => !!(loop && loop.live);
  A.setEchoSafe = function (on) {
    if (on) {
      if (loop || !window.RTCPeerConnection) return;
      A.unlock(); if (!ctx || !ctx.createMediaStreamDestination) return;
      const L = loop = { live: false };
      L.dest = ctx.createMediaStreamDestination();
      L.pc1 = new RTCPeerConnection(); L.pc2 = new RTCPeerConnection();
      L.pc1.onicecandidate = (e) => { if (e.candidate) L.pc2.addIceCandidate(e.candidate).catch(() => {}); };
      L.pc2.onicecandidate = (e) => { if (e.candidate) L.pc1.addIceCandidate(e.candidate).catch(() => {}); };
      L.el = document.createElement('audio'); L.el.autoplay = true; L.el.style.display = 'none'; document.body.appendChild(L.el);
      // switch the game's output over only once sound comes out the other end
      L.pc2.ontrack = (e) => {
        L.el.srcObject = e.streams[0] || new MediaStream([e.track]);
        L.el.play().catch(() => {});
        const go = () => {
          if (loop !== L || L.live) return; L.live = true;
          for (const n of [sfxGain, musicGain]) { try { n.disconnect(); } catch (x) {} n.connect(L.dest); }
        };
        if (L.pc2.connectionState === 'connected') go();
        L.pc2.onconnectionstatechange = () => { if (L.pc2.connectionState === 'connected') go(); else if (['failed', 'closed'].includes(L.pc2.connectionState)) A.setEchoSafe(false); };
      };
      for (const t of L.dest.stream.getAudioTracks()) L.pc1.addTrack(t, L.dest.stream);
      // full-quality stereo for music-like effects (the default is set for speech)
      const hifi = (sdp) => sdp.replace(/a=fmtp:(\d+) ([^\r\n]*minptime[^\r\n]*)/g, (m, pt, rest) => `a=fmtp:${pt} ${rest};stereo=1;sprop-stereo=1;maxaveragebitrate=256000`);
      (async () => {
        try {
          const offer = await L.pc1.createOffer(); await L.pc1.setLocalDescription(offer); await L.pc2.setRemoteDescription(offer);
          const ans = await L.pc2.createAnswer(); ans.sdp = hifi(ans.sdp);
          await L.pc2.setLocalDescription(ans); await L.pc1.setRemoteDescription(ans);
        } catch (e) { console.warn('echo-safe output:', e.message); A.setEchoSafe(false); }
      })();
      setTimeout(() => { if (loop === L && !L.live) { console.warn('echo-safe output: no connection, game sounds play directly'); A.setEchoSafe(false); } }, 5000);
    } else if (loop) {
      const L = loop; loop = null;
      if (L.live && ctx) for (const n of [sfxGain, musicGain]) { try { n.disconnect(); } catch (x) {} n.connect(ctx.destination); }
      try { L.pc1.close(); L.pc2.close(); } catch (x) {}
      L.el.srcObject = null; L.el.remove();
    }
  };

  // ---- music ----
  // Music streams through an <audio> element, except the tracks below.
  //
  // Seamless loops: these tracks end by repeating their opening bars (the menu: its first two bars,
  // 3.83 s), so with <audio loop> those bars came twice, after a small gap. They play through Web
  // Audio instead: the track up to where its opening comes round again (found by cross-correlating
  // the opening with the end of the track: 0.93-0.99 alike), then straight back to the start. The
  // first 20 ms are blended in from what followed the cut, so the end runs on into the start
  // without a click. (Times in seconds of the decoded track.)
  A.MUSIC_LOOPS = { menu: 26.865488, battle: 129.642177, pyramid: 116.321179, sewer: 107.047528 };
  const loopCache = new Map();               // name -> loop buffer (just the menu's: the rest are long)
  let wl = null;                             // the Web Audio loop playing: { name, src }
  const canFetch = () => !!window.fetch && location.protocol !== 'file:';
  function makeLoop(buf, endSec) {
    const sr = buf.sampleRate, end = Math.min(buf.length, Math.round(endSec * sr));
    const F = Math.max(0, Math.min(Math.round(0.02 * sr), buf.length - end));
    const out = ctx.createBuffer(buf.numberOfChannels, end, sr);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const x = buf.getChannelData(ch), y = out.getChannelData(ch);
      y.set(x.subarray(0, end));
      for (let i = 0; i < F; i++) { const t = i / F; y[i] = x[end + i] * (1 - t) + x[i] * t; }
    }
    return out;
  }
  A.makeLoop = (buf, endSec) => makeLoop(buf, endSec);       // (for tests)
  A.loopPlaying = () => (wl && wl.src ? wl.name : null);
  function startLoop(name, offset = 0) {
    const tok = wl = { name, src: null };
    const go = (lb) => {
      if (wl !== tok || musicName !== name) return;
      const s = ctx.createBufferSource(); s.buffer = lb; s.loop = true; s.connect(musicGain);
      s.start(0, offset % lb.duration);
      tok.src = s;
      if (music) { try { music.pause(); } catch (e) {} music.src = ''; music = null; }   // (it was carrying on until now)
    };
    if (loopCache.has(name)) { go(loopCache.get(name)); return; }
    fetch('audio/music/' + name + '.mp3')
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .then(b => ctx.decodeAudioData(b))
      .then((buf) => { const lb = makeLoop(buf, A.MUSIC_LOOPS[name]); if (name === 'menu') loopCache.set(name, lb); go(lb); })
      .catch((e) => {
        console.warn('music loop:', name, e.message);
        if (wl === tok && musicName === name) { wl = null; if (!music) elementMusic(name, true); }
      });
  }
  function elementMusic(name, loop) {
    music = new Audio('audio/music/' + name + '.mp3');
    music.loop = loop; music.volume = AB.clamp(musicVol * duck, 0, 1);
    music.play().catch(() => { /* needs a user gesture; unlock() retries */ });
  }
  A.music = function (name, loop = true) {
    if (name === musicName && (music || wl)) return;
    A.stopMusic();
    if (!name) return;
    musicName = name;
    if (loop && A.MUSIC_LOOPS[name] && ctx && canFetch()) startLoop(name);
    else elementMusic(name, loop);
  };
  A.stopMusic = function () {
    if (music) { try { music.pause(); } catch (e) {} music.src = ''; }
    if (wl) { try { if (wl.src) wl.src.stop(); } catch (e) {} wl = null; }
    music = null; musicName = null;
  };
  A.musicName = () => musicName;
  // duck: a factor on both (voice chat turns the game down while someone talks); volumes stay as set
  let duck = 1;
  const applyVol = () => {
    if (music) music.volume = AB.clamp(musicVol * duck, 0, 1);
    if (musicGain && ctx) { musicGain.gain.cancelScheduledValues(ctx.currentTime); musicGain.gain.setTargetAtTime(musicVol * duck, ctx.currentTime, 0.06); }
    if (sfxGain && ctx) { sfxGain.gain.cancelScheduledValues(ctx.currentTime); sfxGain.gain.setTargetAtTime(sfxVol * duck, ctx.currentTime, 0.06); }
  };
  A.setVolumes = function (m, s) { musicVol = m; sfxVol = s; applyVol(); };
  A.duckLevel = () => duck;
  A.setDuck = function (f) { f = AB.clamp(f, 0, 1); if (f === duck) return; duck = f; applyVol(); };
  A.setEnabled = (e) => { enabled = e; };
})(window.AB);
