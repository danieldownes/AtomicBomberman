// Tunes the Dangerous AI's weights (P in web/js/dangerous.js) by play, with a separable CMA-ES (Ros and
// Hansen's sep-CMA-ES: a cloud of candidate weightings that moves towards the better ones and stretches
// or shrinks along each weight as it learns how much that weight matters). Each generation every
// candidate plays the same rounds of tools/ai_arena.cjs, and so does P as it stands, the yardstick: a
// candidate's score is how many more of those rounds its Dangerous players win than P's do (a draw is no
// win), so the luck of the draw mostly cancels out. Every few generations the cloud's centre plays P on
// fresh rounds of its own (validation), and the best centre that beat P by more than chance (95%) is kept
// as the champion.
//
// A training run is a few sessions in a row, the first starting from P, each later one from a random
// spread about it, so that they look in different places. The whole state goes to the --json file after
// every generation, and --resume carries on from it: a run can be stopped (Ctrl+C) and started again.
//
//   node tools/ai_tune.cjs --sessions 3 --generations 30 --rounds 300 --json tune.json
//   node tools/ai_tune.cjs --resume tune.json
//
//   --lineup L      the rounds to play (default dangerous,hard*3; several, joined by +, share them)
//   --only a,b      tune just these weights (default: every weight in TUNE below)
//   --size N        candidates a generation (default 4 + 3 ln of the number of weights)
//   --sigma S       the cloud's spread to start with, in powers of 2 (default 0.5)
//   --spread S      how far from P the later sessions start, in powers of 2 (default 0.5)
//   --validate K    every K generations, the centre against P on --vrounds rounds (default 5, 1000)
//   --seed, --workers  as for ai_arena.cjs
//
// It prints the champion as --param options for ai_arena.cjs: check those against P on fresh seeds before
// writing them into P.
'use strict';
const fs = require('node:fs');
const { runArena, loadGame } = require('./ai_arena.cjs');

// the weights tuned, each scaled from P's value by 2^x (x starts at 0), rounded and kept within [lo, hi]
// (the switches, 0 or 1, stay as they are)
const TUNE = {
  slack: [2, 14], threatDist: [2, 8], kill: [500, 20000], squeeze: [100, 4000], harass: [0, 2000], cut: [0, 400],
  brick: [20, 1000], burnItem: [0, 2000], layAt: [20, 1000], bombGap: [4, 40],
  item: [100, 4000], spot: [10, 800], hunt: [20, 2000], near: [0, 800], endgame: [1, 6], exposed: [0, 2000],
  deadEnd: [0, 1000], conveyor: [0, 800], far: [2, 100], crowd: [0, 800], stick: [0, 800], walls: [50, 3000],
  fireAfter: [15, 300], shot: [0, 3000], runLay: [100, 3000], kickWait: [0, 200], kickLate: [0, 400],
  early: [0, 150], greedy: [100, 400], sick: [0, 2000], pen: [3, 12], penned: [10, 600], penSick: [1, 20],
  lateAt: [0, 120], inner: [0, 2000],
};
const OPTIONS = ['sessions', 'generations', 'rounds', 'lineup', 'size', 'seed', 'workers', 'json', 'resume', 'only', 'sigma', 'spread', 'validate', 'vrounds'];

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i].replace(/^--/, ''), v = argv[i + 1];
    if (a === 'help' || a === 'h') o.help = true;
    else if (OPTIONS.includes(a) && v !== undefined) { o[a] = v; i++; }
    else throw new Error(`what is "${argv[i]}"? (--help)`);
  }
  return o;
}

// a seeded stream of normal deviates (mulberry32 and Box-Muller): the tuning itself is reproducible
function normals(seed) {
  let s = seed >>> 0, spare = null;
  const u = () => { let t = (s = (s + 0x6D2B79F5) >>> 0); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return (((t ^ (t >>> 14)) >>> 0) + 0.5) / 4294967296; };
  return () => {
    if (spare !== null) { const z = spare; spare = null; return z; }
    const r = Math.sqrt(-2 * Math.log(u())), a = 2 * Math.PI * u();
    spare = r * Math.sin(a); return r * Math.cos(a);
  };
}
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, a.length - 1)); };
const pct = (v) => `${v >= 0 ? '+' : ''}${(100 * v).toFixed(1)}`;

// plays `rounds` rounds, shared between the lineups, with these weights: 1 for each Dangerous won, 0 if
// not, in the same order every time for the same seed (so two weightings compare round by round)
async function play(lineups, rounds, seed, params, workers) {
  const won = [];
  for (let k = 0; k < lineups.length; k++) {
    const n = Math.round(rounds * (k + 1) / lineups.length) - Math.round(rounds * k / lineups.length);
    const res = await runArena({ lineup: lineups[k], rounds: n, seed: (seed + k * 7919) >>> 0, params, check: 0, workers });
    for (const r of res.records) won.push(r.winner && r.winner.some(s => r.names[s] === 'dangerous') ? 1 : 0);
  }
  return won;
}

function toParams(S, x) {
  const p = {};
  S.names.forEach((k, i) => { const [lo, hi] = TUNE[k]; p[k] = Math.min(hi, Math.max(lo, Math.round(S.base[k] * 2 ** x[i]))); });
  return p;
}
const show = (S, p) => S.names.filter(k => p[k] !== S.base[k]).map(k => `--param ${k}=${p[k]}`).join(' ') || '(P as it stands)';
const save = (S) => { if (S.args.json) fs.writeFileSync(S.args.json, JSON.stringify(S, null, 1)); };

// a session starts its cloud at P (the first) or at a random spread about it
function startSession(S) {
  const n = S.names.length, randn = normals(S.args.seed * 92821 + S.session * 6007 + 3);
  const m = S.session ? S.names.map(() => S.args.spread * randn()) : new Array(n).fill(0);
  return { m, sigma: S.args.sigma, C: new Array(n).fill(1), ps: new Array(n).fill(0), pc: new Array(n).fill(0) };
}

async function generation(S) {
  const a = S.args, c = S.cma, n = S.names.length, lambda = a.size, mu = Math.floor(lambda / 2), t0 = Date.now();
  const weights = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wsum = weights.reduce((x, y) => x + y, 0);
  for (let i = 0; i < mu; i++) weights[i] /= wsum;
  const mueff = 1 / weights.reduce((x, w) => x + w * w, 0);
  // sep-CMA-ES constants (Ros & Hansen 2008; Hansen's tutorial)
  const cs = (mueff + 2) / (n + mueff + 5), ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const cc = (4 + mueff / n) / (n + 4 + 2 * mueff / n);
  const c1 = (2 / ((n + 1.3) ** 2 + mueff)) * (n + 2) / 3;
  const cmu = Math.min(1 - c1, (2 * (mueff - 2 + 1 / mueff) / ((n + 2) ** 2 + mueff)) * (n + 2) / 3);
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  // every candidate and the yardstick play the same rounds
  const seed = (a.seed * 1000003 + S.session * 10007 + S.gen * 101) >>> 0;
  const yard = await play(a.lineups, a.rounds, seed, S.base, a.workers), base = mean(yard);
  const randn = normals(seed ^ 0x5bd1e995), pop = [];
  for (let k = 0; k < lambda; k++) {
    const y = S.names.map((_, i) => Math.sqrt(c.C[i]) * randn()), x = y.map((v, i) => c.m[i] + c.sigma * v);
    const params = toParams(S, x), won = await play(a.lineups, a.rounds, seed, params, a.workers);
    pop.push({ y, delta: mean(won) - base, params });
  }
  pop.sort((p, q) => q.delta - p.delta);
  // move the centre to the weighted mean of the better half; adapt the step size and spread
  const yw = new Array(n).fill(0);
  for (let i = 0; i < mu; i++) for (let j = 0; j < n; j++) yw[j] += weights[i] * pop[i].y[j];
  c.m = c.m.map((v, j) => v + c.sigma * yw[j]);
  c.ps = c.ps.map((v, j) => (1 - cs) * v + Math.sqrt(cs * (2 - cs) * mueff) * yw[j] / Math.sqrt(c.C[j]));
  const psn = Math.sqrt(c.ps.reduce((x, v) => x + v * v, 0));
  const hs = psn / Math.sqrt(1 - (1 - cs) ** (2 * (S.gen + 1))) < (1.4 + 2 / (n + 1)) * chiN ? 1 : 0;
  c.pc = c.pc.map((v, j) => (1 - cc) * v + hs * Math.sqrt(cc * (2 - cc) * mueff) * yw[j]);
  c.C = c.C.map((v, j) => {
    let rank = 0;
    for (let i = 0; i < mu; i++) rank += weights[i] * pop[i].y[j] ** 2;
    return (1 - c1 - cmu) * v + c1 * (c.pc[j] ** 2 + (1 - hs) * cc * (2 - cc) * v) + cmu * rank;
  });
  c.sigma *= Math.exp((cs / ds) * (psn / chiN - 1));
  const avg = mean(pop.map(q => q.delta));
  S.log.push({ session: S.session, gen: S.gen, yardstick: base, best: pop[0].delta, mean: avg, sigma: c.sigma });
  console.log(`\nSession ${S.session + 1}, generation ${S.gen + 1}: P won ${(100 * base).toFixed(1)}%; candidates ${pct(pop[0].delta)} at best, ${pct(avg)} on average (points); step ${c.sigma.toFixed(2)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  console.log(`  centre now: ${show(S, toParams(S, c.m))}`);
}

// the centre against P on fresh rounds, round by round; the best that beats it by more than chance stays
async function validate(S) {
  const a = S.args, params = toParams(S, S.cma.m), seed = (0x7fffffff - a.seed * 7919 - S.session * 1009 - S.gen) >>> 0;
  const yard = await play(a.lineups, a.vrounds, seed, S.base, a.workers), won = await play(a.lineups, a.vrounds, seed, params, a.workers);
  const d = won.map((w, i) => w - yard[i]), md = mean(d), se = sd(d) / Math.sqrt(d.length);
  const beat = md - 1.96 * se > 0;
  console.log(`  validation, ${d.length} fresh rounds: the centre won ${(100 * mean(won)).toFixed(1)}%, P ${(100 * mean(yard)).toFixed(1)}%: ${pct(md)} points, give or take ${(196 * se).toFixed(1)}${beat ? ': better' : ''}`);
  if (beat && (!S.champion || md > S.champion.delta)) {
    S.champion = { params, delta: md, se, session: S.session, gen: S.gen, rounds: d.length };
    console.log(`  new champion: ${show(S, params)}`);
  }
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 26).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  let S;
  if (o.resume) {
    S = JSON.parse(fs.readFileSync(o.resume, 'utf8'));
    S.args.json = o.json || o.resume;
    if (o.workers) S.args.workers = +o.workers;
    for (const k of ['sessions', 'generations']) if (o[k]) S.args[k] = +o[k];    // (to make a run longer)
    console.log(`Carrying on: session ${S.session + 1} of ${S.args.sessions}, generation ${S.gen + 1} of ${S.args.generations}.`);
  } else {
    const P = loadGame().AB.AI.dangerousParams, names = o.only ? o.only.split(',') : Object.keys(TUNE);
    for (const k of names) if (!TUNE[k] || !(k in P)) throw new Error(`there's no weight "${k}" to tune (${Object.keys(TUNE).join(', ')})`);
    const args = {
      sessions: +(o.sessions || 1), generations: +(o.generations || 15), rounds: +(o.rounds || 240),
      lineups: (o.lineup || 'dangerous,hard*3').split('+'), size: +(o.size || 4 + Math.floor(3 * Math.log(names.length))),
      sigma: +(o.sigma || 0.5), spread: +(o.spread || 0.5), validate: +(o.validate || 5), vrounds: +(o.vrounds || 1000),
      seed: +(o.seed || 1), workers: o.workers ? +o.workers : undefined, json: o.json,
    };
    S = { args, names, base: Object.fromEntries(names.map(k => [k, P[k]])), session: 0, gen: 0, cma: null, champion: null, log: [] };
    console.log(`Tuning ${names.length} weights: ${args.sessions} session(s) of ${args.generations} generations of ${args.size}, ${args.rounds} rounds each (${args.lineups.join(' + ')}).`);
  }
  while (S.session < S.args.sessions) {
    if (!S.cma) { S.cma = startSession(S); save(S); }
    while (S.gen < S.args.generations) {
      await generation(S);
      if ((S.gen + 1) % S.args.validate === 0 || S.gen + 1 === S.args.generations) await validate(S);
      S.gen++;
      save(S);
    }
    S.session++; S.gen = 0; S.cma = null;
    save(S);
  }
  console.log(S.champion
    ? `\nChampion (session ${S.champion.session + 1}, generation ${S.champion.gen + 1}): ${pct(S.champion.delta)} points against P over ${S.champion.rounds} rounds\n  ${show(S, S.champion.params)}`
    : '\nNo weighting beat P by more than chance.');
}
main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
