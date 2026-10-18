// Rollback netcode for network play (the lobby and rooms are in js/netplay.js and js/netscreens.js).
//
// Every computer runs the same deterministic AB.Game from the same seed; only key presses travel.
// Lockstep (wait until every computer's input for a tick has arrived) feels sluggish at long
// distances, so this is rollback, the way fighting games do it:
//   - this computer's own input is used after a short delay (2-4 ticks, from the ping),
//   - the other players' input for ticks that hasn't arrived yet is predicted (same keys as last time),
//   - when the real input arrives and differs, the game goes back to that tick (Game.saveState /
//     loadState), applies it, and runs forward again to now, all before the next frame is drawn.
// The outcome is exactly what lockstep would give (same inputs, same ticks), so deaths and bomb
// timings are never "compensated": only what is on screen arrives a little late and gets corrected.
//
// Packets (binary, unordered channel; every packet repeats all inputs the others haven't confirmed,
// so a lost packet costs nothing):
//   u8 type=1, u8 round, u8 source computer, u8 computers, u32 sender's tick,
//   per computer: u32 newest tick I have all of its inputs up to (ack), i16 lead x8 (time sync),
//   u32 first tick, u16 count, u8 players on the source computer, then count x players input bytes.
// Checksums of confirmed ticks go over the reliable channel (desync detection).
'use strict';
(function (AB) {
  const Net = AB.net = {};
  Net.PROTOCOL = 2;

  // ---- WebSocket relay transport (server not bundled in round 1; see NETWORK.md) ----
  class WebSocketTransport {
    constructor(url, room) {
      this.id = null; this.peers = []; this.onmessage = null; this.onopen = null; this.onerror = null; this.ws = new WebSocket(url);
      this.ws.onopen = () => this.ws.send(JSON.stringify({ t: 'join', room, v: Net.PROTOCOL }));
      this.ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.t === 'welcome') { this.id = m.id; this.peers = m.peers; this.onopen && this.onopen(); return; }
        if (m.t === 'full') { this.onerror && this.onerror('room full'); return; }
        if (m.data !== undefined) this.onmessage && this.onmessage(m.data, m.from);
      };
    }
    send(obj) { if (this.ws.readyState === 1) this.ws.send(JSON.stringify({ t: 'relay', data: obj })); }
    close() { this.ws.close(); }
  }
  Net.WebSocketTransport = WebSocketTransport;

  // ---- rollback session ----
  // o: { computers, me, slotsOf: [[player index, ...] per computer], inputDelay, maxRollback, round,
  //      readLocal(playerIndex) -> bits, send(Uint8Array), sendSum(tick, hash), applyDrop(game, slots) }
  // Computer 0 is the host. The host decides when a computer has left (drop), so a member's input only
  // counts as final once the host has it too (otherwise a drop could still cut it off).
  const KEEP = 240;                   // ticks of snapshots kept behind the final tick
  class RollbackSession {
    constructor(game, o) {
      this.game = game; this.o = o;
      this.n = o.computers; this.me = o.me; this.slotsOf = o.slotsOf;
      this.delay = o.inputDelay; this.maxRoll = o.maxRollback || 15; this.round = o.round & 255;
      this.np = game.players.length;
      const per = (v) => Array.from({ length: this.n }, () => v);
      this.inp = per(null).map(() => []);
      this.contig = per(this.delay);    // newest tick up to which I have all of computer c's inputs
      this.ackOfMe = per(this.delay);   // ...and up to which computer c has all of mine
      this.hostHas = per(this.delay);   // ...and the host has all of computer c's
      this.lead = per(0); this.leadOfMe = per(0); this.leadN = per(0); this.dropped = per(null); this.directAt = per(-1e9);
      // nobody can have pressed anything for the first `delay` ticks
      for (let c = 0; c < this.n; c++) for (let t = 1; t <= this.delay; t++) this.inp[c][t] = new Uint8Array(this.slotsOf[c].length);
      this.used = [];                   // tick -> the inputs that tick was simulated with
      this.snaps = new Map([[game.tick, game.saveState()]]);
      this.evLog = new Map();           // tick -> events already handed out for that tick
      this.sums = new Map(); this.remoteSums = new Map(); this.lastSum = 0;
      this.pending = Infinity;          // earliest tick simulated with a wrong prediction
      this.events = []; this.desync = null; this.stalled = false; this.sinceWait = 0; this.sinceCatch = 0; this.pruned = 0; this.frames = 0;
      this.smooth = game.players.map(() => [0, 0]);    // drawing offsets that hide corrections
      this.stats = { rollbacks: 0, rolledTicks: 0, maxDepth: 0, lastDepth: 0, stalls: 0, waits: 0, catchups: 0, packets: 0 };
    }
    get localSlots() { return this.slotsOf[this.me]; }
    gone(c) { const d = this.dropped[c]; return d !== null && this.contig[c] >= d - 1; }
    // newest tick for which every other computer's input is in: how far the game may run ahead
    confirmedInputs() {
      let m = Infinity;
      for (let c = 0; c < this.n; c++) if (c !== this.me && !this.gone(c)) m = Math.min(m, this.contig[c]);
      return m;
    }
    // newest tick whose inputs are final (as above, and the host has them all): it can't change any more
    finalInputs() {
      if (this.me === 0) return this.confirmedInputs();
      let m = Infinity;
      for (let c = 0; c < this.n; c++) {
        if (this.gone(c) || c === this.me) continue;      // (mine: while I'm here, the host won't cut me off)
        m = Math.min(m, c === 0 ? this.contig[c] : Math.min(this.contig[c], this.hostHas[c]));
      }
      return m;
    }
    get confirmedTick() { return Math.min(this.finalInputs(), this.game.tick); }
    // the computers the game is waiting for (their players' indexes), for "Waiting for ..."
    missing() {
      const m = this.confirmedInputs(), out = [];
      for (let c = 0; c < this.n; c++) if (c !== this.me && !this.gone(c) && this.contig[c] === m) out.push(...this.slotsOf[c]);
      return out;
    }
    // the input of computer c for tick t: the real one, or a guess (its newest earlier input, without forfeit)
    inputFor(c, t) {
      const d = this.dropped[c];
      if (d !== null && t >= d) return null;                     // its players are computer players now
      const a = this.inp[c][t];
      if (a) return a;
      for (let k = t - 1; k >= 1 && k >= t - 60; k--) {
        const b = this.inp[c][k];
        if (b) return b.map(x => x & ~AB.IN.FORFEIT);
      }
      return new Uint8Array(this.slotsOf[c].length);
    }
    simulate(t, out) {
      const g = this.game;
      for (let c = 0; c < this.n; c++) if (this.dropped[c] === t && this.o.applyDrop) this.o.applyDrop(g, this.slotsOf[c]);
      const arr = new Int32Array(this.np);
      for (let c = 0; c < this.n; c++) {
        const bits = this.inputFor(c, t);
        if (bits) this.slotsOf[c].forEach((pi, j) => { arr[pi] = bits[j]; });
      }
      this.used[t] = arr;
      g.step(arr);
      const evs = g.events.map(e => Object.assign({ tick: t }, e));
      if (out) out.push(...evs); else { this.evLog.set(t, evs); this.events.push(...evs); }
      this.snaps.set(t, g.saveState());
      if (t % 60 === 0) this.sums.set(t, g.checksum());
    }
    rollback() {
      const g = this.game, from = this.pending, to = g.tick;
      this.pending = Infinity;
      const snap = this.snaps.get(from - 1);
      if (!snap) { console.warn('rollback: no snapshot for tick', from - 1); return; }
      const before = g.players.map(p => [p.x, p.y, p.alive]);
      g.loadState(snap);
      const evs = [];
      for (let t = from; t <= to; t++) this.simulate(t, evs);
      this.matchEvents(from, to, evs);
      // a corrected player would jump: draw them where they were and let them slide over
      g.players.forEach((p, i) => {
        const dx = before[i][0] - p.x, dy = before[i][1] - p.y;
        if (before[i][2] && p.alive && Math.abs(dx) + Math.abs(dy) < AB.CW * 1.5) { this.smooth[i][0] += dx; this.smooth[i][1] += dy; }
        else this.smooth[i] = [0, 0];
      });
      const depth = to - from + 1;
      this.stats.rollbacks++; this.stats.rolledTicks += depth; this.stats.lastDepth = depth;
      if (depth > this.stats.maxDepth) this.stats.maxDepth = depth;
    }
    // the events of re-simulated ticks: hand out only the ones that didn't happen the first time round
    // (the same event a tick or three earlier or later counts as the same one: no doubled sounds)
    matchEvents(from, to, evs) {
      const pool = new Map();
      for (let t = from; t <= to; t++) for (const e of this.evLog.get(t) || []) {
        const k = evKey(e);
        if (!pool.has(k)) pool.set(k, []);
        pool.get(k).push(t);
      }
      for (let t = from; t <= to; t++) this.evLog.set(t, []);
      for (const e of evs) {
        this.evLog.get(e.tick).push(e);
        const ticks = pool.get(evKey(e));
        let best = -1;
        if (ticks) for (let i = 0; i < ticks.length; i++) if (Math.abs(ticks[i] - e.tick) <= 3 && (best < 0 || Math.abs(ticks[i] - e.tick) < Math.abs(ticks[best] - e.tick))) best = i;
        if (best >= 0) ticks.splice(best, 1); else this.events.push(e);
      }
    }
    // how far ahead (+) or behind (-) computer c is, in ticks; latency cancels out (GGPO-style):
    // each side measures "their tick when sent - my tick when received" and they swap the numbers
    offsetOf(c) { return this.leadN[c] ? (this.lead[c] - this.leadOfMe[c]) / 2 : 0; }
    // call once per 60 Hz frame
    frame() {
      const g = this.game;
      this.frames++; this.stalled = false;
      for (const s of this.smooth) { s[0] *= 0.8; s[1] *= 0.8; if (Math.abs(s[0]) + Math.abs(s[1]) < 0.3) s[0] = s[1] = 0; }
      // time sync: more than 2 ticks ahead of someone? hold back a frame now and then. Behind? run extra.
      let minOff = 0, maxOff = 0;
      for (let c = 0; c < this.n; c++) if (c !== this.me && this.dropped[c] === null) { const v = this.offsetOf(c); minOff = Math.min(minOff, v); maxOff = Math.max(maxOff, v); }
      // (gently: the figures are a few frames old, so pushing hard would overshoot and swing back)
      let steps = 1;
      this.sinceWait++; this.sinceCatch++;
      if (minOff < -2 && this.sinceWait >= (minOff < -6 ? 2 : 4)) { steps = 0; this.sinceWait = 0; this.stats.waits++; }
      else if (maxOff > 60 || (maxOff > 10 && this.sinceCatch >= 2)) { steps = maxOff > 60 ? 3 : 2; this.sinceCatch = 0; this.stats.catchups++; }
      // a real input that differs from what we guessed: go back and redo those ticks
      if (this.pending <= g.tick) this.rollback();
      for (let k = 0; k < steps; k++) {
        this.readInput();
        const next = g.tick + 1;
        if (next - this.confirmedInputs() > this.maxRoll) { this.stalled = true; this.stats.stalls++; break; }
        this.simulate(next);
      }
      this.readInput();
      this.sendPacket();
      this.checkSums();
      this.prune();
    }
    // this computer's input, for `delay` ticks from now
    readInput() {
      const target = this.game.tick + 1 + this.delay;
      while (this.contig[this.me] < target) {
        const t = ++this.contig[this.me];
        const a = new Uint8Array(this.slotsOf[this.me].length);
        this.slotsOf[this.me].forEach((pi, j) => { a[j] = this.o.readLocal(pi) & 255; });
        this.inp[this.me][t] = a;
      }
    }
    takeEvents() { const e = this.events; this.events = []; return e; }

    // ---- packets ----
    sendPacket() {
      const me = this.me, ns = this.slotsOf[me].length;
      let first = this.contig[me] + 1;
      for (let c = 0; c < this.n; c++) if (c !== me && this.dropped[c] === null) first = Math.min(first, this.ackOfMe[c] + 1);
      first = Math.max(first, 1);
      const cnt = AB.clamp(this.contig[me] - first + 1, 0, 600);
      const buf = new Uint8Array(8 + 6 * this.n + 7 + cnt * ns), dv = new DataView(buf.buffer);
      dv.setUint8(0, 1); dv.setUint8(1, this.round); dv.setUint8(2, me); dv.setUint8(3, this.n); dv.setUint32(4, this.game.tick);
      let off = 8;
      for (let c = 0; c < this.n; c++) {
        dv.setUint32(off, this.contig[c]);
        dv.setInt16(off + 4, AB.clamp(Math.round(this.lead[c] * 8), -32000, 32000));
        off += 6;
      }
      dv.setUint32(off, first); dv.setUint16(off + 4, cnt); dv.setUint8(off + 6, ns); off += 7;
      for (let k = 0; k < cnt; k++) { const a = this.inp[me][first + k]; for (let j = 0; j < ns; j++) buf[off++] = a ? a[j] : 0; }
      this.o.send(buf);
    }
    // type 1 came straight from its computer, type 2 was passed on by the host
    onPacket(bytes) {
      const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      if (b.length < 8) return;
      const dv = new DataView(b.buffer, b.byteOffset, b.byteLength), type = dv.getUint8(0);
      if ((type !== 1 && type !== 2) || dv.getUint8(1) !== this.round) return;
      const src = dv.getUint8(2), n = dv.getUint8(3);
      if (src === this.me || src >= this.n || n !== this.n || b.length < 8 + 6 * n + 7) return;
      this.stats.packets++;
      if (type === 1) this.directAt[src] = this.frames;
      // a passed-on copy arrives later than a direct one would: no use for time sync if there is one
      const useLead = type === 1 || this.frames - this.directAt[src] > 60;
      const cur = dv.getUint32(4);
      let off = 8;
      for (let c = 0; c < n; c++) {
        const ack = dv.getUint32(off);
        if (c === this.me) { this.ackOfMe[src] = Math.max(this.ackOfMe[src], ack); if (useLead) this.leadOfMe[src] = dv.getInt16(off + 4) / 8; }
        if (src === 0) this.hostHas[c] = Math.max(this.hostHas[c], ack);
        off += 6;
      }
      if (useLead) {
        // their tick when they sent this, minus ours now
        const sample = cur - this.game.tick;
        this.lead[src] = this.leadN[src] ? this.lead[src] * 0.9 + sample * 0.1 : sample;
        this.leadN[src]++;
      }
      const first = dv.getUint32(off), cnt = dv.getUint16(off + 4), ns = dv.getUint8(off + 6); off += 7;
      if (ns !== this.slotsOf[src].length || b.length < off + cnt * ns) return;
      for (let k = 0; k < cnt; k++, off += ns) this.store(src, first + k, b.subarray(off, off + ns));
    }
    // a real input for computer c, tick t
    store(c, t, bits) {
      if (this.inp[c][t] || t <= 0) return;
      if (this.dropped[c] !== null && t >= this.dropped[c]) return;
      const a = Uint8Array.from(bits);
      this.inp[c][t] = a;
      const u = this.used[t];
      if (u && t <= this.game.tick) {
        let differs = false;
        this.slotsOf[c].forEach((pi, j) => { if (u[pi] !== a[j]) differs = true; });
        if (differs && t < this.pending) this.pending = t;
      }
      while (this.inp[c][this.contig[c] + 1]) this.contig[c]++;
    }
    // computer c has left: from tick `from` its players are computer players. The host sends its own
    // copy of c's last inputs along (fill), so everyone has all of them up to `from` - 1.
    drop(c, from, fill) {
      if (this.dropped[c] !== null || c === this.me) return;
      if (fill) fill.data.forEach((bits, k) => this.store(c, fill.start + k, bits));
      this.dropped[c] = from;
      for (let t = from; t <= this.contig[c]; t++) this.inp[c][t] = undefined;     // cut off (it had sent more to us than to the host)
      if (this.contig[c] >= from) this.contig[c] = from - 1;
      if (from <= this.game.tick && from < this.pending) this.pending = from;
      this.hostHas[c] = Math.max(this.hostHas[c], from - 1);
    }
    // the host's copy of computer c's inputs, for a drop message
    fillFor(c, back = 600) {
      const end = this.contig[c], start = Math.max(1, end - back + 1), data = [];
      for (let t = start; t <= end; t++) data.push(Array.from(this.inp[c][t] || []));
      return { start, data };
    }

    // ---- checksums of final ticks ----
    checkSums() {
      const conf = this.confirmedTick;
      for (let t = (Math.floor(this.lastSum / 60) + 1) * 60; t <= conf; t += 60) {
        const h = this.sums.get(t);
        this.lastSum = t;
        if (h === undefined) continue;
        if (this.o.sendSum) this.o.sendSum(t, h);
        for (const r of this.remoteSums.get(t) || []) if (r !== h && !this.desync) this.desync = { tick: t, mine: h, theirs: r };
      }
    }
    onSum(t, h) {
      if (!this.remoteSums.has(t)) this.remoteSums.set(t, []);
      this.remoteSums.get(t).push(h);
      const mine = this.sums.get(t);
      if (t <= this.lastSum && mine !== undefined && mine !== h && !this.desync) this.desync = { tick: t, mine, theirs: h };
    }
    prune() {
      const keep = this.confirmedTick - KEEP;
      for (let t = this.pruned; t < keep; t++) {
        this.snaps.delete(t); this.used[t] = undefined; this.evLog.delete(t);
        if (t % 60 === 0 && t < keep - 600) { this.sums.delete(t); this.remoteSums.delete(t); }
      }
      this.pruned = Math.max(this.pruned, keep);
    }
    // for the F9 overlay
    info() {
      let off = 0;
      for (let c = 0; c < this.n; c++) if (c !== this.me && this.dropped[c] === null) off = Math.min(off, this.offsetOf(c));
      return { tick: this.game.tick, confirmed: this.confirmedTick, behind: this.game.tick - this.confirmedTick, delay: this.delay, maxRoll: this.maxRoll, offset: off, ...this.stats };
    }
  }
  const evKey = (e) => { const o = Object.assign({}, e); delete o.tick; return JSON.stringify(o); };
  Net.RollbackSession = RollbackSession;

  // ---- self-test: three computers through a host, with latency, jitter and packet loss ----
  // Every computer must end up with exactly the game a direct run with the real inputs gives.
  // Run from the browser console: AB.net.selfTest()  (or headless from test/rollback.js)
  Net.selfTest = function (opt = {}) {
    const frames = opt.frames || 1500, oneway = opt.oneway !== undefined ? opt.oneway : 9, jitter = opt.jitter !== undefined ? opt.jitter : 3;
    const loss = opt.loss !== undefined ? opt.loss : 0.05, delay = opt.delay || 3, dropAt = opt.dropAt || 0;
    const settings = AB.defaultSettings(); settings.playTime = 600; settings.lostNetToAI = true;
    const scheme = window.AB_DATA.schemes.basic;
    const players = [0, 1, 2, 3].map(i => ({ slot: i, color: i, ai: i === 3 }));
    const slotsOf = [[0], [1], [2]];
    const mk = () => new AB.Game({ settings, scheme, level: 0, seed: 4242, players, match: {} });
    let rs = 99;
    const rnd = () => (rs = (Math.imul(rs, 1103515245) + 12345) >>> 0) / 4294967296;
    const applyDrop = (g, slots) => { for (const i of slots) { const p = g.players[i]; p.isAI = true; p.ai = { plan: null, t: 0 }; p.aiLevel = 'hard'; } };
    // the network: 0 is the host; members send to the host, the host forwards to the other members
    const q = [];
    let now = 0;
    const post = (to, data, lossy = true) => { if (lossy && rnd() < loss) return; q.push({ at: now + oneway + Math.floor(rnd() * (jitter + 1)), to, data: data.slice ? data.slice() : data }); };
    const games = [mk(), mk(), mk()], alive = [true, true, true];
    const S = games.map((g, me) => new RollbackSession(g, {
      computers: 3, me, slotsOf, inputDelay: delay, maxRollback: 20, round: 1, applyDrop,
      readLocal: () => { const r = rnd(); return r < 0.7 ? [1, 2, 4, 8][Math.floor(r * 5.7)] || 0 : r < 0.75 ? AB.IN.BOMB : 0; },
      send: (bytes) => { if (me === 0) { post(1, bytes); post(2, bytes); } else post(0, bytes); },
      sendSum: (t, h) => { const d = { sum: [t, h], src: me }; if (me === 0) { post(1, d, false); post(2, d, false); } else post(0, d, false); },
    }));
    let dropFrom = null;
    for (now = 0; now < frames; now++) {
      for (let c = 0; c < 3; c++) if (alive[c] && !(c === 2 && opt.pauseAt && now >= opt.pauseAt && now < opt.pauseAt + (opt.pauseFor || 120))) S[c].frame();   // (pause: a background tab)
      const due = q.filter(m => m.at <= now);
      for (let i = q.length - 1; i >= 0; i--) if (q[i].at <= now) q.splice(i, 1);
      for (const m of due) {
        if (!alive[m.to]) continue;
        if (m.data.drop) S[m.to].drop(2, m.data.from, m.data.fill);
        else if (m.data.sum) { S[m.to].onSum(m.data.sum[0], m.data.sum[1]); if (m.to === 0) for (const c of [1, 2]) if (c !== m.data.src) post(c, m.data, false); }
        else {
          S[m.to].onPacket(m.data);
          if (m.to === 0) { const src = m.data[2], f = m.data.slice(); f[0] = 2; for (const c of [1, 2]) if (c !== src) post(c, f); }   // host passes it on
        }
      }
      if (dropAt && now === dropAt) alive[2] = false;
      if (dropAt && now === dropAt + 30) {
        // the host notices: from the tick after the last input it has, with its copy of the rest
        dropFrom = S[0].contig[2] + 1;
        const fill = S[0].fillFor(2);
        S[0].drop(2, dropFrom, fill);
        q.push({ at: now + oneway, to: 1, data: { drop: true, from: dropFrom, fill } });
      }
    }
    // reference: one plain game with every computer's real inputs
    const ref = mk(), live = [0, 1, 2].filter(c => alive[c]);
    const end = Math.min(...live.map(c => S[c].confirmedTick));
    const events = live.map(c => S[c].takeEvents().length);
    const sums = {};
    for (let t = 1; t <= end; t++) {
      if (dropFrom === t) applyDrop(ref, slotsOf[2]);
      const arr = new Int32Array(4);
      for (let c = 0; c < 3; c++) { if (dropFrom !== null && c === 2 && t >= dropFrom) continue; const a = S[live[0]].inp[c][t] || S[0].inp[c][t]; if (a) arr[slotsOf[c][0]] = a[0]; }
      ref.step(arr);
      if (t % 60 === 0) sums[t] = ref.checksum();
    }
    let compared = 0, bad = 0;
    for (const t in sums) for (const c of live) { const h = S[c].sums.get(+t); if (h === undefined) continue; compared++; if (h !== sums[t]) bad++; }
    return { ok: bad === 0 && compared > 0 && live.every(c => !S[c].desync), compared, bad, confirmedTo: end, dropFrom, events,
             stats: live.map(c => ({ computer: c, tick: S[c].game.tick, ...S[c].stats })) };
  };
})(window.AB);
