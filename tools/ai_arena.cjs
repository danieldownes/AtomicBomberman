// Headless AI arena: plays computer-only rounds of the real game (web/js/game.js and web/js/ai.js,
// exactly as the browser runs them) as fast as the CPU allows, over worker threads, and reports how
// each AI did: wins with a 95% confidence interval, how its players died (own bomb, another player's,
// the closing walls), kills, and what it costs per tick. (In a network game every computer runs every
// AI, and rollback runs ticks again, so an AI has to be cheap as well as good.)
//
//   node tools/ai_arena.cjs --lineup hard*2,medium*2 --rounds 400
//   node tools/ai_arena.cjs --lineup mine,hard*3 --ai my_ai.js --by-arena --json out.json
//   node tools/ai_arena.cjs --list
//
// A round is a pure function of the options and its number, so the results don't depend on the number
// of workers, and any round can be played again on its own (--first N --rounds 1). Node 18 or later,
// no packages. See tools/README.md.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

const WEB = path.resolve(__dirname, '..', 'web');
const GAME_FILES = ['data/gamedata.js', 'js/core.js', 'js/game.js', 'js/ai.js', 'js/dangerous.js'];
const ALIASES = { original: 'hard' };      // the menu's name for the game's own AI
const NO_LIMIT = 10 * 60 * 60;             // --time 0 (no time limit): a round stops after 10 minutes
const BUCKETS = 96;                        // thinking-time histogram: bucket b counts calls up to 0.25 * 2^(b/4) us

const HELP = `Plays computer-only rounds of the game headless and reports how each AI did.

  node tools/ai_arena.cjs [options]

  --lineup L    who plays, e.g. hard*2,medium*2 (default hard*4): 2 to 10 players.
                The game's AIs are easy, medium and hard (= original); --ai adds more.
  --rounds N    rounds to play (default 200)
  --teams       play in teams, one per AI named in the lineup
  --arenas A    default (the ones the game picks from), all, or numbers or names: 0,4,forest
  --schemes S   basic (default), a preset (recommended, classic, ffa, teams, small, all) or
                scheme names, e.g. basic,tight
  --time S      round length in seconds (default 150); 0 = no limit (stopped after 10 minutes)
  --walls N     closing walls from 0 (off) to 3 (all the way in); default 1
  --set K=V     any other setting of the game's, e.g. --set conveyorSpeed=2 (repeatable)
  --param K=V   one of the Dangerous AI's weights (P in js/dangerous.js), e.g. --param kill=4000
  --ai FILE     load another AI from FILE (repeatable; see tools/README.md)
  --seed N      base seed (default 1)
  --first N     start at round N (to play round N again: --first N --rounds 1)
  --workers N   worker threads (default: one per CPU thread, less one)
  --check N     play N rounds a second time to check they come out the same (default 2; 0 = off)
  --by-arena    also break the results down by arena
  --json FILE   write the options, summary and every round to FILE
  --list        list the arenas and schemes
  --quiet       no progress line`;

class UsageError extends Error {}
const fail = (msg) => { throw new UsageError(msg); };

// integer hash (MurmurHash3's finaliser), for each round's seed and scheme
function hash32(x) {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return (x ^ (x >>> 16)) >>> 0;
}

// ------------------------------------------------------------------ the game
// The game's scripts, each run as a function of a `window` of this game's own (a vm context would
// do, but every Math, Infinity or Int16Array the AI looks up in one goes through a slow interceptor:
// it ran almost 5 times slower). Then the extra AIs (--ai): an extra AI's file runs the same way, so
// window.AB is the game, and registers itself by name:
//   window.AB.arena.register('mine', (g, p) => inputBits)
// window.AB.arena.builtin(g, p) is the game's AI; for a player whose level it doesn't know, it plays
// Original. Every computer player's move then goes through one function, which times it.
function loadGame(aiFiles = [], params = null) {
  const window = {};
  const run = (file) => vm.runInThisContext(`(function (window) {${fs.readFileSync(file, 'utf8')}\n})`, { filename: file })(window);
  for (const f of GAME_FILES) run(path.join(WEB, f));
  const AB = window.AB, builtin = AB.AI.think, custom = {}, timing = {};
  if (params) Object.assign(AB.AI.dangerousParams, params);
  AB.arena = { builtin, register(name, think) { custom[String(name).toLowerCase()] = think; } };
  for (const f of aiFiles) run(f);
  AB.AI.think = (g, p) => {
    const t0 = performance.now();
    const bits = (custom[p.aiLevel] || builtin)(g, p);
    addTime(timing, p.aiLevel, (performance.now() - t0) * 1000);
    return bits;
  };
  return { AB, D: window.AB_DATA, custom, timing };
}
function addTime(timing, level, us) {
  const t = timing[level] || (timing[level] = { n: 0, us: 0, max: 0, hist: new Array(BUCKETS).fill(0) });
  t.n++; t.us += us; if (us > t.max) t.max = us;
  t.hist[Math.min(BUCKETS - 1, Math.max(0, Math.ceil(4 * Math.log2(us / 0.25))))]++;
}
function mergeTiming(into, from) {
  for (const [level, f] of Object.entries(from)) {
    const t = into[level] || (into[level] = { n: 0, us: 0, max: 0, hist: new Array(BUCKETS).fill(0) });
    t.n += f.n; t.us += f.us; t.max = Math.max(t.max, f.max);
    for (let b = 0; b < BUCKETS; b++) t.hist[b] += f.hist[b];
  }
}
function quantile(t, q) {
  let acc = 0;
  for (let b = 0; b < BUCKETS; b++) if ((acc += t.hist[b]) >= q * t.n) return Math.min(t.max, 0.25 * 2 ** (b / 4));
  return t.max;
}

// ------------------------------------------------------------------ options
function int(v, what, lo, hi) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) fail(`${what} wants a whole number from ${lo} to ${hi}, not "${v}"`);
  return n;
}
function options(env, o) {
  const { AB, D, custom } = env;
  const known = [...AB.AI.LEVELS, ...Object.keys(custom)];
  const lineup = [];
  for (const part of String(o.lineup || 'hard*4').toLowerCase().split(',')) {
    const m = /^\s*([\w-]+)\s*(?:\*\s*(\d+))?\s*$/.exec(part);
    if (!m) fail(`can't read "${part}" in --lineup (it looks like hard*2,medium*2)`);
    const name = ALIASES[m[1]] || m[1];
    if (!known.includes(name)) fail(`there's no AI called "${m[1]}" (there are ${known.join(', ')}; original is hard)`);
    for (let k = m[2] === undefined ? 1 : +m[2]; k > 0; k--) lineup.push(name);
  }
  if (lineup.length < 2 || lineup.length > AB.MAXP) fail(`a round needs 2 to ${AB.MAXP} players, not ${lineup.length}`);
  const names = [...new Set(lineup)], teams = !!o.teams;
  if (teams && names.length < 2) fail('--teams needs two different AIs in the lineup (one team each)');
  const defaults = AB.defaultSettings(), settings = { teamPlay: teams };
  if (o.time !== undefined) settings.playTime = int(o.time, '--time', 0, 3600);
  if (o.walls !== undefined) settings.enclosement = int(o.walls, '--walls', 0, 3);
  for (const kv of o.set || []) {
    const eq = kv.indexOf('='), k = kv.slice(0, eq), v = kv.slice(eq + 1);
    if (eq < 1 || !(k in defaults)) fail(`--set ${kv}: the settings are ${Object.keys(defaults).join(', ')}`);
    try { settings[k] = JSON.parse(v); } catch (e) { settings[k] = v; }
  }
  const S = Object.assign(defaults, settings);
  // the Dangerous AI's weights to change: --param K=V, or params: {K: V}
  const P = AB.AI.dangerousParams || {}, params = Object.assign({}, o.params);
  for (const kv of o.param || []) {
    const eq = kv.indexOf('='), k = kv.slice(0, eq), v = Number(kv.slice(eq + 1));
    if (eq < 1 || !(k in P) || !Number.isFinite(v)) fail(`--param ${kv}: the weights are ${Object.keys(P).join(', ')}`);
    params[k] = v;
  }
  for (const k of Object.keys(params)) if (!(k in P)) fail(`the Dangerous AI has no weight "${k}"`);
  const threads = os.availableParallelism ? os.availableParallelism() : os.cpus().length;
  return {
    lineup, names, teams, teamOf: Object.fromEntries(names.map((nm, t) => [nm, t])),
    rounds: int(o.rounds ?? 200, '--rounds', 1, 1e8), first: int(o.first ?? 0, '--first', 0, 1e9),
    seed: int(o.seed ?? 1, '--seed', 0, 0xffffffff),
    arenas: pickArenas(AB, o.arenas), schemes: pickSchemes(AB, D, o.schemes, lineup.length, teams),
    settings, playTime: S.playTime, enclosement: S.enclosement,
    workers: int(o.workers ?? Math.max(1, threads - 1), '--workers', 1, 1024),
    check: int(o.check ?? 2, '--check', 0, 1e6),
    aiFiles: o.ai || [], params,
  };
}
function pickArenas(AB, spec) {
  const all = Array.from({ length: AB.LEVELS }, (_, i) => i);
  if (!spec || spec === 'default') return all.filter(i => AB.arenaDefault(i));
  if (spec === 'all') return all;
  return String(spec).split(',').map(s => {
    s = s.trim().toLowerCase();
    if (/^\d+$/.test(s)) return +s < AB.LEVELS ? +s : fail(`there's no arena ${s} (0 to ${AB.LEVELS - 1}; --list shows them)`);
    const m = all.filter(i => AB.levelName(i).toLowerCase().includes(s));
    return m.length === 1 ? m[0] : fail(`"${s}" ${m.length ? 'matches ' + m.map(AB.levelName).join(', ') : 'matches no arena'} (--list shows them)`);
  });
}
function pickSchemes(AB, D, spec, n, teams) {
  const preset = AB.SCHEME_PRESETS.find(p => p.id === (spec || 'basic'));
  const keys = preset ? preset.keys(n, teams) : String(spec).toLowerCase().split(',').map(s => s.trim());
  for (const k of keys) if (!D.schemes[k]) fail(`there's no scheme "${k}" (--list shows them)`);
  return keys.length ? keys : fail(`no scheme in "${spec}" suits ${n} players`);
}

// ------------------------------------------------------------------ one round
// Arenas take turns; each arena plays the lineup in every rotation (who sits in which slot) in turn,
// and the scheme comes from the round's seed.
function roundSpec(opts, i) {
  const A = opts.arenas.length, seed = hash32(hash32(opts.seed) + i);
  return { i, seed, arena: opts.arenas[i % A], scheme: opts.schemes[hash32(seed ^ 0x5bd1e995) % opts.schemes.length], rotation: Math.floor(i / A) % opts.lineup.length };
}
// deaths: [slot, killer's slot (-1: none), crushed by the walls (1/0), tick, diseases (bit d = AB.DIS d)]
function playRound(env, opts, spec) {
  const { AB, D } = env, n = opts.lineup.length;
  const names = opts.lineup.map((_, k) => opts.lineup[(k + spec.rotation) % n]);
  const S = Object.assign(AB.defaultSettings(), opts.settings);
  const players = names.map((name, k) => ({ slot: k, color: k, team: opts.teams ? opts.teamOf[name] : 0, ai: true, aiLevel: name, name: 'AI ' + (k + 1) }));
  const g = new AB.Game({ settings: S, scheme: D.schemes[spec.scheme], level: spec.arena, seed: spec.seed, players, match: {} });
  const deaths = [], kill = g.killPlayer;
  g.killPlayer = function (p, by, crushed) {
    if (p.alive) deaths.push([p.slot, crushed ? -1 : by, crushed ? 1 : 0, this.tick, p.disT > 0 ? p.dis.reduce((m, on, d) => (on ? m | (1 << d) : m), 0) : 0]);
    return kill.call(this, p, by, crushed);
  };
  const limit = S.playTime > 0 ? (S.playTime + 60) * AB.TPS : NO_LIMIT;
  while (g.state !== 'over' && g.tick < limit) g.step(null);
  const w = g.result && g.result.winner;
  return { i: spec.i, seed: spec.seed, arena: spec.arena, scheme: spec.scheme, names, ticks: g.tick, timeout: !w && (g.state !== 'over' || g.timeLeft === 0), winner: w ? w.players : null, deaths, sum: g.checksum() };
}

// ------------------------------------------------------------------ results
// 95% Wilson score interval for k successes out of n
function wilson(k, n, z = 1.96) {
  const p = k / n, d = 1 + z * z / n, c = p + z * z / (2 * n), h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}
function summarise(env, opts, records) {
  const { AB } = env, ai = {}, arenas = {};
  for (const nm of opts.names) {
    const count = opts.lineup.filter(x => x === nm).length;
    ai[nm] = { name: nm, label: (AB.AI.LEVEL_NAMES[nm] || nm) + (count > 1 ? ' x' + count : ''), count, seats: 0, wins: 0, own: 0, killed: 0, walls: 0, kills: 0, teamKills: 0, survived: 0, ownSick: 0, sick: {} };
  }
  let draws = 0, timeouts = 0, ticks = 0;
  for (const r of records) {
    ticks += r.ticks;
    const ar = arenas[r.arena] || (arenas[r.arena] = { arena: r.arena, name: AB.levelName(r.arena), rounds: 0, draws: 0, ai: {} });
    const arAI = (nm) => ar.ai[nm] || (ar.ai[nm] = { seats: 0, wins: 0, own: 0 });
    ar.rounds++;
    for (const nm of r.names) { ai[nm].seats++; arAI(nm).seats++; }
    if (r.winner) { const nm = r.names[r.winner[0]]; ai[nm].wins++; arAI(nm).wins++; } else { draws++; ar.draws++; if (r.timeout) timeouts++; }
    const dead = new Set();
    for (const [slot, by, crushed, , sick] of r.deaths) {
      const nm = r.names[slot], a = ai[nm];
      dead.add(slot);
      if (crushed) a.walls++;
      else if (by === slot) {
        a.own++; arAI(nm).own++;
        if (sick) { a.ownSick++; for (let d = 0; d < AB.DIS_COUNT; d++) if (sick & (1 << d)) a.sick[AB.DIS_NAMES[d]] = (a.sick[AB.DIS_NAMES[d]] || 0) + 1; }
      } else if (by >= 0) {
        a.killed++;
        // (in teams each AI is a team: a player of the same AI is a teammate)
        if (opts.teams && r.names[by] === nm) a.teamKills++; else ai[r.names[by]].kills++;
      }
    }
    for (let s = 0; s < r.names.length; s++) if (!dead.has(s)) ai[r.names[s]].survived++;
  }
  const decided = records.length - draws;
  for (const a of Object.values(ai)) {
    a.share = a.wins / records.length;
    a.decidedShare = decided ? a.wins / decided : null;
    a.ci = decided ? wilson(a.wins, decided) : null;
    a.equal = opts.teams ? null : a.count / opts.lineup.length;      // (team sizes make "equal" unclear)
  }
  return { rounds: records.length, decided, draws, timeouts, seconds: ticks / AB.TPS, ai: Object.values(ai), arenas: Object.values(arenas).sort((x, y) => x.arena - y.arena) };
}

function table(rows) {
  const w = rows[0].map((_, c) => Math.max(...rows.map(r => String(r[c]).length)));
  return rows.map(r => r.map((v, c) => (c === 0 ? String(v).padEnd(w[c]) : String(v).padStart(w[c]))).join('  ').trimEnd()).join('\n');
}
const pc = (x, dp = 0) => (x === null || x === undefined ? '-' : (100 * x).toFixed(dp) + '%');
const big = (x) => (x >= 1e6 ? (x / 1e6).toFixed(2) + 'M' : x >= 1e4 ? Math.round(x / 1e3) + 'k' : String(Math.round(x)));
const micro = (x) => (x >= 100 ? x.toFixed(0) : x >= 10 ? x.toFixed(1) : x.toFixed(2));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const roundList = (list) => (list.length > 3 ? `${list.length} rounds` : `round${list.length > 1 ? 's' : ''} ${list.join(list.length > 2 ? ', ' : ' and ')}`);

function report(env, res, o) {
  const { AB, D } = env, { opts, summary: s, timing, speed, check } = res;
  const out = [];
  const arenas = opts.arenas.length === AB.LEVELS ? 'all' : opts.arenas.join(',') === pickArenas(AB).join(',') ? `the ${opts.arenas.length} default ones` : opts.arenas.map(i => AB.levelName(i)).join(', ');
  const schemes = opts.schemes.length === 1 ? D.schemes[opts.schemes[0]].name : `${opts.schemes.length}, at random`;
  out.push(`${plural(s.rounds, 'round')}, ${opts.lineup.length} computer players${opts.teams ? ' in teams' : ''}: ${s.ai.map(a => a.label).join(', ')}`);
  out.push(`Arenas: ${arenas}. Schemes: ${schemes}. ${opts.playTime ? opts.playTime + ' s rounds' : 'No time limit'}, closing walls ${opts.enclosement}. Seed ${opts.seed}${opts.first ? `, rounds ${opts.first} on` : ''}.`);
  const changed = Object.entries(opts.params);
  if (changed.length) out.push(`Dangerous's weights changed: ${changed.map(([k, v]) => `${k}=${v}`).join(' ')}.`);
  out.push('');
  const rows = [['', 'wins', 'of all', 'of won', '95% CI', 'if equal', 'own bomb', 'killed', 'walls', 'kills', 'us/tick', 'p99']];
  for (const a of s.ai) {
    const t = timing[a.name];
    rows.push([a.label, a.wins, pc(a.share, 1), pc(a.decidedShare, 1), a.ci ? `${pc(a.ci[0])}-${pc(a.ci[1])}` : '-', pc(a.equal),
      pc(a.own / a.seats), pc(a.killed / a.seats), pc(a.walls / a.seats), (a.kills / a.seats).toFixed(2), t ? micro(t.mean) : '-', t ? micro(t.p99) : '-']);
  }
  out.push(table(rows), '');
  out.push('wins: rounds won, as a share of all rounds and of the rounds someone won (with its 95% confidence');
  out.push('interval); if equal: that share if all the AIs were equally strong. own bomb, killed (by another');
  out.push('player), walls: how often one of its players died that way, per round. kills: other players one of');
  out.push('its players killed per round. us/tick: microseconds of thinking per player per tick, mean and 99th percentile.');
  if (speed.workers > 1) out.push(`(With ${speed.workers} workers sharing the machine the times come out high: --workers 1 measures them.)`);
  out.push('');
  out.push(`Draws: ${s.draws} (${pc(s.draws / s.rounds, 1)}), ${s.timeouts} of them at the time limit. Average round ${(s.seconds / s.rounds).toFixed(1)} s.`);
  for (const a of s.ai) {
    if (!a.ownSick) continue;
    const top = Object.entries(a.sick).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([k, v]) => `${k} ${v}`).join(', ');
    out.push(`${a.label}: ${pc(a.ownSick / a.own)} of its own-bomb deaths came while diseased (${top}).`);
  }
  for (const a of s.ai) if (a.teamKills) out.push(`${a.label} killed a teammate ${plural(a.teamKills, 'time')} (not counted in kills).`);
  if (o.byArena) {
    const head = ['Arena', 'rounds', 'draws'];
    for (const a of s.ai) head.push(a.label + ' wins', 'own bomb');
    const ar = [head];
    for (const r of s.arenas) {
      const row = [r.name, r.rounds, pc(r.draws / r.rounds)];
      for (const a of s.ai) { const x = r.ai[a.name]; row.push(pc(x.wins / r.rounds), pc(x.own / x.seats)); }
      ar.push(row);
    }
    out.push('', table(ar));
  }
  out.push('', `Played ${big(speed.ticks)} ticks (${(speed.ticks / AB.TPS / 3600).toFixed(1)} h of play) in ${speed.seconds.toFixed(1)} s on ${plural(speed.workers, 'worker')}: ` +
    `${big(speed.ticks / speed.seconds)} ticks/s, ${big(speed.perWorker)} per worker (${Math.round(speed.perWorker / AB.TPS)}x real time).`);
  if (check) {
    out.push(check.differs.length
      ? `Played ${roundList(check.rounds)} again: ${roundList(check.differs)} came out differently. An AI that isn't deterministic (Math.random, the clock, state kept between games) would put network games out of step.`
      : `Played ${roundList(check.rounds)} again: the same.`);
  }
  return out.join('\n');
}

function list(env) {
  const { AB, D } = env, out = ['Arenas (--arenas takes numbers or part of a name; * = picked by default):'];
  for (let i = 0; i < AB.LEVELS; i++) {
    const n = {};
    for (const e of D.extras[i] || []) n[e.t] = (n[e.t] || 0) + 1;
    const things = Object.entries(n).map(([t, k]) => `${k} ${t}s`);
    if (AB.val(340 + i, 0)) things.push('bricks grow back');
    out.push(`  ${String(i).padStart(2)} ${AB.arenaDefault(i) ? '*' : ' '} ${AB.levelName(i).padEnd(22)} ${things.join(', ')}`.trimEnd());
  }
  out.push('', `Schemes (--schemes takes names, or a preset: ${AB.SCHEME_PRESETS.map(p => p.id).join(', ')}):`);
  const keys = AB.schemeKeys(), w = Math.max(...keys.map(k => k.length));
  for (const k of keys) out.push(`  ${k.padEnd(w)}  ${D.schemes[k].name.padEnd(40)} ${AB.schemeFit(k).label}`);
  out.push('', `AIs: ${[...AB.AI.LEVELS, ...Object.keys(env.custom)].join(', ')} (original = hard)`);
  return out.join('\n');
}

// ------------------------------------------------------------------ running it
// Workers ask for rounds a few at a time, so long and short rounds even out between them.
async function runArena(o = {}) {
  o = Object.assign({}, o, { ai: (o.ai || []).map(f => path.resolve(f)) });
  const env = loadGame(o.ai), opts = options(env, o);
  if (env.AB.AI.dangerousParams) Object.assign(env.AB.AI.dangerousParams, opts.params);   // (for the check, which plays here)
  const end = opts.first + opts.rounds, workers = Math.min(opts.workers, opts.rounds);
  const chunk = Math.max(1, Math.min(16, Math.floor(opts.rounds / (workers * 8))));
  const records = [], timing = {}, pool = [];
  let next = opts.first, ticks = 0, busy = 0;
  const t0 = performance.now();
  await new Promise((resolve, reject) => {
    let live = workers, failed = false;
    const stop = (e) => { if (failed) return; failed = true; for (const w of pool) w.terminate(); reject(e); };
    for (let k = 0; k < workers; k++) {
      const w = new Worker(__filename, { workerData: opts });
      pool.push(w);
      const feed = () => { if (next >= end) { w.postMessage({ t: 'stop' }); return; } const from = next; next = Math.min(end, next + chunk); w.postMessage({ t: 'run', from, to: next }); };
      w.on('message', (m) => {
        if (m.t === 'ready') feed();
        else if (m.t === 'done') {
          records.push(...m.records); ticks += m.ticks; busy += m.ms; mergeTiming(timing, m.timing);
          if (o.onProgress) o.onProgress(records.length, opts.rounds);
          feed();
        } else if (m.t === 'error') stop(new UsageError(m.error));
      });
      w.on('error', stop);
      w.on('exit', () => { if (--live === 0 && !failed) resolve(); });
    }
  });
  const seconds = (performance.now() - t0) / 1000;
  records.sort((a, b) => a.i - b.i);
  // the check plays the last rounds again here, in a context of its own: rounds a worker played after
  // many others, so an AI that carries anything over from one game to the next shows up too
  let check = null;
  if (opts.check) {
    const again = records.slice(-opts.check);
    const differs = again.filter(r => {
      const x = playRound(env, opts, roundSpec(opts, r.i));
      return x.sum !== r.sum || x.ticks !== r.ticks || JSON.stringify(x.winner) !== JSON.stringify(r.winner) || JSON.stringify(x.deaths) !== JSON.stringify(r.deaths);
    }).map(r => r.i);
    check = { rounds: again.map(r => r.i), differs };
  }
  const timingOut = {};
  for (const [level, t] of Object.entries(timing)) timingOut[level] = { calls: t.n, us: t.us, mean: t.us / t.n, p99: quantile(t, 0.99), max: t.max, hist: t.hist };
  const res = { opts, summary: summarise(env, opts, records), timing: timingOut, speed: { ticks, seconds, workers, perWorker: ticks / (busy / 1000) }, check, records };
  res.text = (more = {}) => report(env, res, Object.assign({}, o, more));
  return res;
}

function workerMain() {
  const opts = workerData, env = loadGame(opts.aiFiles, opts.params);
  parentPort.on('message', (m) => {
    if (m.t === 'stop') { parentPort.close(); return; }
    const records = [], t0 = performance.now();
    let ticks = 0;
    for (let i = m.from; i < m.to; i++) {
      const spec = roundSpec(opts, i);
      try { const r = playRound(env, opts, spec); records.push(r); ticks += r.ticks; } catch (e) {
        parentPort.postMessage({ t: 'error', error: `Round ${i} (seed ${spec.seed}, ${env.AB.levelName(spec.arena)}, scheme ${spec.scheme}, ${opts.lineup.join(',')}) failed:\n${e.stack || e}` });
        return;
      }
    }
    const timing = Object.assign({}, env.timing);       // (sent as it is so far, then counted afresh)
    for (const k of Object.keys(env.timing)) delete env.timing[k];
    parentPort.postMessage({ t: 'done', records, ticks, ms: performance.now() - t0, timing });
  });
  parentPort.postMessage({ t: 'ready' });
}

function parseArgs(argv) {
  const o = { ai: [], set: [] };
  const flags = { help: 'help', h: 'help', list: 'list', teams: 'teams', 'by-arena': 'byArena', quiet: 'quiet' };
  const values = ['lineup', 'rounds', 'first', 'seed', 'arenas', 'schemes', 'time', 'walls', 'workers', 'check', 'json'];
  o.param = [];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i], v;
    if (!a.startsWith('-')) fail(`what is "${a}"? (--help lists the options)`);
    a = a.replace(/^--?/, '');
    const eq = a.indexOf('=');
    if (eq >= 0) { v = a.slice(eq + 1); a = a.slice(0, eq); }
    if (flags[a]) { o[flags[a]] = true; continue; }
    if (!values.includes(a) && a !== 'ai' && a !== 'set' && a !== 'param') fail(`there's no option --${a} (--help lists them)`);
    if (v === undefined) { v = argv[++i]; if (v === undefined) fail(`--${a} needs a value`); }
    if (a === 'ai') { if (!fs.existsSync(v)) fail(`there's no file ${v} (--ai)`); o.ai.push(path.resolve(v)); }
    else if (a === 'set' || a === 'param') o[a].push(v); else o[a] = v;
  }
  return o;
}

async function cli() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(HELP); return; }
  if (o.list) { console.log(list(loadGame(o.ai))); return; }
  const tty = process.stderr.isTTY && !o.quiet;
  if (tty) o.onProgress = (done, total) => process.stderr.write(`\r${done} of ${total} rounds`);
  const res = await runArena(o);
  if (tty) process.stderr.write('\r\x1b[K');
  console.log(res.text());
  if (o.json) {
    const { text, ...data } = res;
    fs.writeFileSync(o.json, JSON.stringify(data));
    console.log(`Wrote ${o.json}.`);
  }
  if (res.check && res.check.differs.length) process.exitCode = 1;
}

if (!isMainThread) workerMain();
else if (require.main === module) cli().catch((e) => { console.error(e instanceof UsageError ? e.message : e.stack || String(e)); process.exitCode = 1; });
module.exports = { runArena, loadGame, playRound, roundSpec };
