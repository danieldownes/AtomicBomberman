// Network play scaffolding (round 2 target).
//
// Model: deterministic lockstep, like the original (which sent player inputs over IPX/TCP/IP and
// retransmitted "critical" packets, VALUELST #1100-1104). Every peer runs the same AB.Game with
// the same seed/settings; only per-tick input bitmasks travel over the wire. AI players are
// computed inside the simulation, so they never need to be sent.
//
//   host                        clients
//   ----                        -------
//   lobby: hello/join  <---->   hello
//   start {seed, settings, scheme, level, players, inputDelay}  ---->
//   every tick t: input {t: t+delay, slot, bits}  <---->  (all peers broadcast their local slots)
//   every 60 ticks: sum {t, hash}  <---->  (desync detection via Game.checksum())
//
// Transports implement { send(obj), onmessage = fn(obj, fromId), close(), id }.
// Provided: LoopbackHub (several sessions in one page, used for testing determinism).
// Planned:  WebSocketTransport (tiny relay server, see NETWORK.md) and WebRTC DataChannels.
'use strict';
(function (AB) {
  const Net = AB.net = {};
  Net.PROTOCOL = 1;

  // ---- in-page hub: every transport receives every other transport's messages ----
  class LoopbackHub {
    constructor(latencyTicks = 0) { this.peers = []; this.queue = []; this.latency = latencyTicks; this.now = 0; }
    connect() {
      const hub = this;
      const t = { id: this.peers.length, onmessage: null,
        send(obj) { hub.queue.push({ at: hub.now + hub.latency, from: t.id, data: JSON.stringify(obj) }); },
        close() {} };
      this.peers.push(t);
      return t;
    }
    pump(ticks = 1) {
      this.now += ticks;
      const due = this.queue.filter(m => m.at <= this.now);
      this.queue = this.queue.filter(m => m.at > this.now);
      for (const m of due) for (const p of this.peers) if (p.id !== m.from && p.onmessage) p.onmessage(JSON.parse(m.data), m.from);
    }
  }
  Net.LoopbackHub = LoopbackHub;

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

  // ---- lockstep session ----
  // localSlots: indexes into game.players controlled on this machine; readLocal(i) -> bits
  class LockstepSession {
    constructor(transport, game, opts) {
      this.tr = transport; this.game = game;
      this.delay = opts.inputDelay || 4;
      this.localSlots = opts.localSlots;
      this.remoteSlots = opts.remoteSlots;   // indexes driven by other peers
      this.readLocal = opts.readLocal;
      this.inputs = new Map();               // tick -> Int32Array(players)
      this.have = new Map();                 // tick -> count of received slots
      this.sentUpTo = 0;
      this.sums = new Map();
      this.desync = null;
      this.stalls = 0;
      // pre-fill the first `delay` ticks with neutral input
      for (let t = 1; t <= this.delay; t++) { this.row(t); this.have.set(t, this.remoteSlots.length); }
      transport.onmessage = (m) => this.onMessage(m);
    }
    row(t) { let r = this.inputs.get(t); if (!r) { r = new Int32Array(this.game.players.length); this.inputs.set(t, r); } return r; }
    onMessage(m) {
      if (m.t === 'in') {
        const r = this.row(m.tick);
        for (const [slot, bits] of m.v) r[slot] = bits;
        this.have.set(m.tick, (this.have.get(m.tick) || 0) + m.v.length);
      } else if (m.t === 'sum') {
        const mine = this.sums.get(m.tick);
        if (mine !== undefined && mine !== m.hash) this.desync = { tick: m.tick, mine, theirs: m.hash };
        this.sums.set('r' + m.tick, m.hash);
      }
    }
    // call once per local 60 Hz tick; returns true if the simulation advanced
    update() {
      const g = this.game;
      const next = g.tick + 1;
      // schedule our local input for next + delay
      const target = next + this.delay - 1 + 1;
      if (this.sentUpTo < target) {
        const v = this.localSlots.map(i => [i, this.readLocal(i) | 0]);
        const r = this.row(target);
        for (const [i, b] of v) r[i] = b;
        this.tr.send({ t: 'in', tick: target, v });
        this.sentUpTo = target;
      }
      if ((this.have.get(next) || 0) < this.remoteSlots.length) { this.stalls++; return false; }
      g.step(this.inputs.get(next));
      this.inputs.delete(next); this.have.delete(next);
      if (g.tick % 60 === 0) {
        const h = g.checksum(); this.sums.set(g.tick, h);
        const theirs = this.sums.get('r' + g.tick);
        if (theirs !== undefined && theirs !== h) this.desync = { tick: g.tick, mine: h, theirs };
        this.tr.send({ t: 'sum', tick: g.tick, hash: h });
      }
      return true;
    }
  }
  Net.LockstepSession = LockstepSession;

  // Self-test: two peers in one page with simulated latency must stay in sync.
  // Run from the browser console: AB.net.selfTest()
  Net.selfTest = function (ticks = 1200) {
    const hub = new LoopbackHub(3);
    const settings = AB.defaultSettings();
    const scheme = window.AB_DATA.schemes.basic;
    const players = [0, 1, 2, 3].map(i => ({ slot: i, color: i, ai: i >= 2 }));
    const mk = () => new AB.Game({ settings, scheme, level: 0, seed: 12345, players, match: {} });
    const gA = mk(), gB = mk();
    const rnd = (s) => { let x = s; return () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) >>> 16; };
    const ra = rnd(1), rb = rnd(2);
    const sA = new LockstepSession(hub.connect(), gA, { localSlots: [0], remoteSlots: [1], readLocal: () => ra() & 63, inputDelay: 4 });
    const sB = new LockstepSession(hub.connect(), gB, { localSlots: [1], remoteSlots: [0], readLocal: () => rb() & 63, inputDelay: 4 });
    for (let i = 0; i < ticks * 3 && (gA.tick < ticks || gB.tick < ticks); i++) {
      if (gA.tick < ticks) sA.update();
      if (gB.tick < ticks) sB.update();
      hub.pump(1);
    }
    const ok = gA.checksum() === gB.checksum() && !sA.desync && !sB.desync;
    return { ok, tickA: gA.tick, tickB: gB.tick, sumA: gA.checksum(), sumB: gB.checksum(), stallsA: sA.stalls, stallsB: sB.stalls };
  };
})(window.AB);
