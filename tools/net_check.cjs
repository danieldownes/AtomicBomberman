// Headless network check: several computers, each with its own copy of the game's code (as separate
// browsers would have), play rounds through the real rollback session (web/js/net.js) over a simulated
// bad network: latency, jitter, packet loss, lag spikes, blackouts, a tab in the background, computers
// leaving, forfeits, clocks that drift. Every tick a computer settles on (all its inputs final) is
// compared, the whole state of the game, with a clean replay of the final inputs. It also checks that
// every computer gets to see the end of a round, and that no desync is reported where there is none.
//
//   node tools/net_check.cjs                    every scenario, 4 rounds each, over worker threads
//   node tools/net_check.cjs --only drop,far --runs 10
//   node tools/net_check.cjs --list
//
// Node 18 or later, no packages. See tools/README.md.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Worker, isMainThread, parentPort } = require('node:worker_threads');

const WEB = path.resolve(__dirname, '..', 'web');
const FILES = ['data/gamedata.js', 'js/core.js', 'js/game.js', 'js/ai.js', 'js/original.js', 'js/dangerous.js', 'js/net.js'];
// a fresh copy of the game's scripts, with a `window` of its own (as tools/ai_arena.cjs loads them)
function loadGame() {
  const window = {};
  for (const f of FILES) {
    const file = path.join(WEB, f);
    vm.runInThisContext(`(function (window) {${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })(window);
  }
  return window;
}
function prng(seed) {
  let s = seed >>> 0;
  return () => { let t = (s = (s + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// a hash of a whole saved state (typed arrays, arrays, objects, Map, Set; numbers bit for bit)
function deepHash(v) {
  let h = 2166136261 >>> 0;
  const mix = (x) => { h ^= x | 0; h = Math.imul(h, 16777619) >>> 0; };
  const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  const num = (x) => { f64[0] = x; mix(u32[0]); mix(u32[1]); };
  const str = (s) => { mix(s.length); for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i)); };
  const walk = (x) => {
    if (x === null) return mix(1);
    if (x === undefined) return mix(2);
    const t = typeof x;
    if (t === 'number') { mix(3); return num(x); }
    if (t === 'boolean') return mix(x ? 4 : 5);
    if (t === 'string') { mix(6); return str(x); }
    if (ArrayBuffer.isView(x)) { mix(7); mix(x.length); for (let i = 0; i < x.length; i++) num(x[i]); return; }
    if (Array.isArray(x)) { mix(8); mix(x.length); for (const y of x) walk(y); return; }
    if (x instanceof Map) { mix(9); for (const [k, y] of x) { walk(k); walk(y); } return; }
    if (x instanceof Set) { mix(10); for (const y of x) walk(y); return; }
    mix(11);
    for (const k of Object.keys(x).sort()) { str(k); walk(x[k]); }
  };
  walk(v);
  return h >>> 0;
}
// where two states first differ, as a path (state.players[1].acc: 0 vs 230)
function firstDiff(a, b, p = 'state') {
  if (a === b) return null;
  if (typeof a === 'number' && typeof b === 'number') return Object.is(a, b) || (a !== a && b !== b) ? null : `${p}: ${a} vs ${b}`;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
  if (ArrayBuffer.isView(a) || Array.isArray(a)) {
    if (a.length !== b.length) return `${p}.length: ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) { const d = firstDiff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
    return null;
  }
  if (a instanceof Map || a instanceof Set) return deepHash(a) === deepHash(b) ? null : `${p}: differs`;
  for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) { const d = firstDiff(a[k], b[k], `${p}.${k}`); if (d) return d; }
  return null;
}

// ------------------------------------------------------------------ one round
// o: seed, level, scheme, humans (players per computer; computer 0 is the host), ais (their levels),
//    frames, oneway / jitter (frames), loss (game packets, 0..1), spikes (chance per frame and link of
//    a lag spike: spikeLen frames of spikeExtra more), mesh (members link directly), delay, maxRollback,
//    pause {c, at, for} (a background tab), drop {c, at, notice} (it leaves; the host notices later),
//    dropLevel, lostNetToAI, forfeit {c, at}, rate [frames per frame], late [frames to start],
//    uplink {c, at, notice} (from `at` none of c's game packets reach the host; dropped `notice` later),
//    blackout {c, len} (c's links carry nothing for len frames, from when the host first sees the round
//    over), endWait (frames on the game screen after the confirmed end)
function run(o) {
  const nc = o.humans.length;
  const ctxs = Array.from({ length: nc + 1 }, loadGame);    // one per computer, and one for the replay
  const D = ctxs[nc].AB_DATA;
  const players = [], slotsOf = [];
  for (let c = 0; c < nc; c++) {
    slotsOf.push([]);
    for (let k = 0; k < o.humans[c]; k++) { slotsOf[c].push(players.length); players.push({ slot: players.length, color: players.length, ai: false, name: `C${c}P${k}` }); }
  }
  for (const lv of o.ais) players.push({ slot: players.length, color: players.length, ai: true, aiLevel: lv, name: 'AI ' + lv });
  // (as js/netplay.js makeRound and js/screens.js build a network round)
  const mkGame = (AB) => {
    const S = Object.assign(AB.defaultSettings(), { playTime: 150, enclosement: 1, lostNetToAI: o.lostNetToAI !== false, aiFinale: true, countdown: true });
    return new AB.Game({ settings: S, scheme: D.schemes[o.scheme || 'basic'], level: o.level || 0, seed: o.seed, players: players.map(p => Object.assign({}, p)), match: {} });
  };
  // (as js/netscreens.js makeSession)
  const applyDrop = (g, slots) => {
    for (const i of slots) {
      const p = g.players[i]; if (!p) continue;
      if (o.lostNetToAI !== false) { p.isAI = true; p.ai = { plan: null, t: 0 }; p.aiLevel = o.dropLevel || 'hard'; }
      else if (p.alive) g.killPlayer(p, -1, true);
    }
  };
  const rnd = prng(o.seed ^ 0xabcdef);
  // a human, more or less: holds a direction a while, now and then a bomb or the action key
  const held = players.map(() => ({ bits: 0, left: 0 }));
  const human = (pi) => {
    const h = held[pi];
    if (--h.left <= 0) { h.bits = rnd() < 0.15 ? 0 : [1, 2, 4, 8][Math.floor(rnd() * 4)]; h.left = 4 + Math.floor(rnd() * 40); }
    return h.bits | (rnd() < 0.03 ? 16 : 0) | (rnd() < 0.01 ? 32 : 0);
  };

  // the network, in frames. Reliable messages (checksums, drops) arrive in order on each link and are
  // never lost; game packets may be lost and overtake each other.
  const q = [], alive = Array(nc).fill(true), spikeUntil = new Map(), lastRel = new Map();
  let now = 0, blackFrom = null;
  const black = (from, to) => o.blackout && blackFrom !== null && now < blackFrom + o.blackout.len && (from === o.blackout.c || to === o.blackout.c);
  const post = (from, to, data, reliable) => {
    if (!alive[to]) return;
    if (!reliable && (rnd() < (o.loss || 0) || black(from, to))) return;
    if (!reliable && o.uplink && from === o.uplink.c && to === 0 && now >= o.uplink.at) return;
    const k = from + '>' + to;
    if (o.spikes && rnd() < o.spikes) spikeUntil.set(k, now + (o.spikeLen || 30));
    let at = now + o.oneway + Math.floor(rnd() * ((o.jitter || 0) + 1)) + ((spikeUntil.get(k) || -1) > now ? (o.spikeExtra || 20) : 0);
    if (reliable) { if (black(from, to)) at = Math.max(at, blackFrom + o.blackout.len); at = Math.max(at, lastRel.get(k) || 0); lastRel.set(k, at); }
    q.push({ at, to, data: data instanceof Uint8Array ? data.slice() : data });
  };
  const S = ctxs.slice(0, nc).map((w, me) => new w.AB.net.RollbackSession(mkGame(w.AB), {
    computers: nc, me, slotsOf, inputDelay: o.delay, maxRollback: o.maxRollback, round: 1, applyDrop,
    readLocal: (pi) => human(pi) | (o.forfeit && o.forfeit.c === me && now === o.forfeit.at ? 64 : 0),
    // members send to the host (who passes it on, without a mesh) and, with a mesh, to each other
    send: (bytes) => {
      if (me === 0) { for (let c = 1; c < nc; c++) post(0, c, bytes); return; }
      post(me, 0, bytes);
      if (o.mesh) for (let c = 1; c < nc; c++) if (c !== me) post(me, c, bytes);
    },
    sendSum: (t, h) => { const d = { sum: [t, h], src: me }; if (me === 0) for (let c = 1; c < nc; c++) post(0, c, d, true); else post(me, 0, d, true); },
  }));
  // what each computer last simulated each tick with: the final version, once the tick is confirmed
  const last = S.map(() => new Map());
  S.forEach((s, c) => { const sim = s.simulate.bind(s); s.simulate = (t, out) => { sim(t, out); last[c].set(t, s.snaps.get(t)); }; });

  const ref = mkGame(ctxs[nc].AB);
  let refTick = 0, dropFrom = null, dropC = -1, bad = null, compared = 0;
  // the replay runs on as far as every computer has confirmed (and made the corrections that came in)
  const advanceRef = () => {
    const live = [...Array(nc).keys()].filter(c => alive[c]);
    const upTo = Math.min(...live.map(c => Math.min(S[c].confirmedTick, S[c].pending - 1)));
    while (refTick < upTo && !bad) {
      const t = ++refTick;
      if (dropFrom === t) applyDrop(ref, slotsOf[dropC]);
      const arr = new Int32Array(players.length);
      for (let c = 0; c < nc; c++) {
        if (c === dropC && t >= dropFrom) continue;
        const a = (alive[c] ? S[c] : S[0]).inp[c][t];
        if (!a) { bad = { tick: t, why: `no final input of computer ${c}` }; return; }
        slotsOf[c].forEach((pi, j) => { arr[pi] = a[j]; });
      }
      ref.step(arr);
      const rs = ref.saveState(), rh = deepHash(rs);
      for (const c of live) {
        const st = last[c].get(t);
        if (!st) continue;
        compared++;
        if (deepHash(st) !== rh) { bad = { tick: t, computer: c, diff: firstDiff(rs, st) }; return; }
        last[c].delete(t);
      }
    }
  };
  const runAt = Array(nc).fill(0), left = Array(nc).fill(false), overT = Array(nc).fill(0);
  let drop = o.drop || null;
  for (now = 0; now < o.frames && !bad; now++) {
    if (o.blackout && blackFrom === null && S[0].game.state === 'over') blackFrom = now;
    for (let c = 0; c < nc; c++) {
      if (!alive[c]) continue;
      // on the results screen (js/netscreens.js): the session's resend(), five times a second
      if (left[c]) { if (now % 12 === c) S[c].resend(); continue; }
      if (o.pause && o.pause.c === c && now >= o.pause.at && now < o.pause.at + o.pause.for) continue;
      if (o.late && now < (o.late[c] || 0)) continue;
      runAt[c] += o.rate ? o.rate[c] : 1;
      while (runAt[c] >= 1) { runAt[c]--; S[c].frame(); S[c].takeEvents(); }
      // the game screen: the end confirmed, a few seconds more, then the results screen
      const g = S[c].game;
      if (g.state === 'over' && S[c].confirmedTick >= g.overAt) { if (++overT[c] > (o.endWait || 150)) left[c] = true; } else overT[c] = 0;
    }
    if (!q.length && S.every((s, c) => !alive[c] || left[c])) break;
    const due = q.filter(m => m.at <= now).sort((a, b) => a.at - b.at);
    for (let i = q.length - 1; i >= 0; i--) if (q[i].at <= now) q.splice(i, 1);
    for (const m of due) {
      if (!alive[m.to]) continue;
      if (m.data.drop) S[m.to].drop(m.data.c, m.data.from, m.data.fill);
      else if (m.data.sum) { S[m.to].onSum(m.data.sum[0], m.data.sum[1]); if (m.to === 0) for (let c = 1; c < nc; c++) if (c !== m.data.src) post(0, c, m.data, true); }
      else {
        S[m.to].onPacket(m.data);
        // the host passes a member's packet on (as js/netplay.js hostGamePacket), to members without a mesh
        if (m.to === 0 && !o.mesh) { const f = m.data.slice(); if (f[0] !== 3) f[0] = 2; for (let c = 1; c < nc; c++) if (c !== m.data[2]) post(0, c, f); }
      }
    }
    if (o.uplink && now === o.uplink.at + o.uplink.notice) drop = { c: o.uplink.c, at: now, notice: 0 };
    if (drop && now === drop.at) alive[drop.c] = false;
    if (drop && now === drop.at + drop.notice) {
      // the host cuts it off after the last of its inputs it has, and sends its copy of them along
      dropC = drop.c; dropFrom = S[0].contig[dropC] + 1;
      const fill = S[0].fillFor(dropC);
      S[0].drop(dropC, dropFrom, fill);
      for (let c = 1; c < nc; c++) if (c !== dropC) post(0, c, { drop: true, c: dropC, from: dropFrom, fill }, true);
    }
    advanceRef();
  }
  advanceRef();
  const desync = S.filter((s, c) => alive[c] && s.desync).map(s => s.desync);
  // a round that ended on one computer has to end on all of them
  const stuck = left.some(Boolean) ? [...Array(nc).keys()].filter(c => alive[c] && !left[c]) : [];
  return { ok: !bad && !desync.length && !stuck.length && compared > 0, bad, desync, stuck, compared, refTick, state: ref.state,
           stats: S.map((s, c) => alive[c] ? { c, tick: s.game.tick, rollbacks: s.stats.rollbacks, maxDepth: s.stats.maxDepth, stalls: s.stats.stalls } : null).filter(Boolean) };
}

// ------------------------------------------------------------------ scenarios
const ALL = ['easy', 'medium', 'original', 'hard', 'dangerous'];
const SCHEMES = ['basic', 'airchaos', 'confused', 'pingpong', 'bman93', 'neil', 'obstacle', 'chicane'];
const BASE = { humans: [1, 1, 1], ais: ALL, frames: 4000, oneway: 9, jitter: 4, loss: 0.05, spikes: 0.002, spikeLen: 40, spikeExtra: 25, delay: 2, maxRollback: 20 };
const SCENARIOS = {
  base:     ['3 computers, a player each, and every AI; 300 ms ping, 5% loss, lag spikes', (r) => ({})],
  drop:     ['a computer leaves: its player carries on as an AI', (r) => ({ drop: { c: 2, at: 400 + r * 137, notice: 30 + r * 7 }, dropLevel: ALL[(r + 4) % 5] })],
  dropKill: ['a computer leaves, "Lost net players revert to AIs" off', (r) => ({ drop: { c: 1, at: 300 + r * 151, notice: 40 }, lostNetToAI: false })],
  uplink:   ['a computer\'s input stops reaching the host, which times it out', (r) => ({ uplink: { c: 1 + (r % 2), at: 190 + r * 9, notice: 120 }, mesh: true, frames: 2000 })],
  pause:    ['a tab in the background for a few seconds', (r) => ({ pause: { c: 1 + (r % 2), at: 300 + r * 90, for: 90 + r * 40 } })],
  forfeit:  ['F10 twice', (r) => ({ forfeit: { c: 1 + (r % 2), at: 500 + r * 60 } })],
  big:      ['5 computers, 2 players each', (r) => ({ humans: [2, 2, 2, 2, 2], ais: [] })],
  bigAI:    ['5 computers, a player each, and every AI', (r) => ({ humans: [1, 1, 1, 1, 1] })],
  far:      ['600 ms ping', (r) => ({ oneway: 18, jitter: 8, delay: 4, maxRollback: 30 })],
  schemes:  ['other schemes and arenas (conveyors, warps, trampolines, glove)', (r) => ({ scheme: SCHEMES[r % SCHEMES.length], level: (r * 5 + 2) % 13 })],
  clocks:   ['clocks that run fast or slow, and a late start', (r) => ({ rate: [1, 1.012, 0.988], late: [0, 4 + r, 9 + r] })],
  end:      ['a member hears nothing for 5 s as the round ends', (r) => ({ blackout: { c: 1 + (r % 2), len: 300 }, frames: 6000 })],
};
function job(name, r) {
  return Object.assign({ seed: 1000 + r * 31 + name.length, level: r % 13, mesh: r % 2 === 1 }, BASE, SCENARIOS[name][1](r));
}

// ------------------------------------------------------------------ main
const HELP = `Plays network rounds headless over a simulated bad network and checks every computer stays in step.

  node tools/net_check.cjs [options]

  --only S      scenarios, e.g. drop,far (default: all; --list lists them)
  --runs N      rounds per scenario (default 4)
  --workers N   worker threads (default: one per CPU thread, less one)
  --list        list the scenarios`;

function main() {
  const argv = process.argv.slice(2), arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
  if (argv.includes('--help')) { console.log(HELP); return; }
  if (argv.includes('--list')) { for (const [k, v] of Object.entries(SCENARIOS)) console.log(`  ${k.padEnd(9)} ${v[0]}`); return; }
  const names = arg('only', Object.keys(SCENARIOS).join(',')).split(',');
  for (const n of names) if (!SCENARIOS[n]) { console.error(`there's no scenario "${n}" (--list lists them)`); process.exitCode = 2; return; }
  const runs = +arg('runs', 4);
  const jobs = names.flatMap(n => Array.from({ length: runs }, (_, r) => ({ name: n, r })));
  const workers = Math.max(1, Math.min(jobs.length, +arg('workers', 0) || os.cpus().length - 1));
  let next = 0, done = 0, fails = 0;
  const t0 = Date.now();
  for (let w = 0; w < workers; w++) {
    const wk = new Worker(__filename);
    const give = () => { if (next < jobs.length) wk.postMessage(jobs[next++]); else wk.terminate(); };
    wk.on('message', (m) => {
      const res = m.res, o = job(m.name, m.r);
      if (!res.ok) fails++;
      const what = res.ok ? 'ok' : [res.bad && `state differs at tick ${res.bad.tick} on computer ${res.bad.computer}: ${res.bad.diff || res.bad.why}`,
        res.desync.length && `desync reported: ${JSON.stringify(res.desync[0])}`, res.stuck.length && `never saw the end: computer ${res.stuck.join(', ')}`].filter(Boolean).join('; ');
      const rb = res.stats.map(s => s.rollbacks).reduce((a, b) => a + b, 0);
      console.log(`${m.name.padEnd(9)} ${String(m.r).padStart(2)}  ${(o.scheme || 'basic').padEnd(8)} arena ${String(o.level).padStart(2)}  ${String(res.refTick).padStart(4)} ticks ${res.state.padEnd(6)} ${String(rb).padStart(5)} rollbacks  ${what}`);
      if (++done === jobs.length) { console.log(fails ? `${fails} of ${done} FAILED` : `all ${done} ok (${((Date.now() - t0) / 1000).toFixed(0)} s)`); process.exitCode = fails ? 1 : 0; }
      give();
    });
    wk.on('error', (e) => { console.error(e); process.exitCode = 1; });
    give();
  }
}

if (!isMainThread) parentPort.on('message', (m) => parentPort.postMessage({ name: m.name, r: m.r, res: run(job(m.name, m.r)) }));
else if (require.main === module) main();
module.exports = { run, job, SCENARIOS };
