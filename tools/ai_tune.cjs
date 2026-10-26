// Tunes the Dangerous AI's weights (P in web/js/dangerous.js) by play, with a separable CMA-ES (Ros and
// Hansen's sep-CMA-ES: a cloud of candidate weightings that moves towards the better ones and stretches
// or shrinks along each weight as it learns how much that weight matters). Each candidate plays the same
// rounds of tools/ai_arena.cjs as the others in its generation, so the luck of the draw mostly evens out
// between them; its score is the share of all rounds the Dangerous players win (a draw is no win).
//
//   node tools/ai_tune.cjs --generations 15 --rounds 240 [--lineup dangerous,hard*3] [--size 10] [--seed 1]
//
// After every generation it prints the cloud's centre (its best guess so far) as --param options for
// ai_arena.cjs; check those against the current weights on fresh seeds before taking them. --json FILE
// keeps a log of every candidate.
'use strict';
const fs = require('node:fs');
const { runArena, loadGame } = require('./ai_arena.cjs');

// the weights tuned (the rest stay as they are), each scaled from its current value by 2^x, x starting
// at 0, rounded and kept within [lo, hi]
const TUNE = {
  slack: [2, 14], threatDist: [2, 8], kill: [500, 20000], squeeze: [100, 4000], harass: [0, 2000],
  brick: [20, 1000], burnItem: [0, 2000], layAt: [20, 1000], bombGap: [4, 40], item: [100, 4000],
  spot: [10, 800], hunt: [20, 2000], near: [0, 800], exposed: [0, 2000], deadEnd: [0, 1000],
  conveyor: [0, 800], far: [2, 100], crowd: [0, 800], stick: [0, 800], walls: [50, 3000], fireAfter: [15, 300],
};

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i].replace(/^--/, ''), v = argv[i + 1];
    if (a === 'help' || a === 'h') o.help = true;
    else if (['generations', 'rounds', 'lineup', 'size', 'seed', 'workers', 'json'].includes(a) && v !== undefined) { o[a] = v; i++; }
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

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.help) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(0, 13).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); return; }
  const base = loadGame().AB.AI.dangerousParams, names = Object.keys(TUNE), n = names.length;
  const gens = +(o.generations || 15), rounds = +(o.rounds || 240), lineup = o.lineup || 'dangerous,hard*3';
  const lambda = +(o.size || 10), mu = Math.floor(lambda / 2), seed = +(o.seed || 1);
  const weights = Array.from({ length: mu }, (_, i) => Math.log(mu + 0.5) - Math.log(i + 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < mu; i++) weights[i] /= wsum;
  const mueff = 1 / weights.reduce((a, w) => a + w * w, 0);
  // sep-CMA-ES constants (Ros & Hansen 2008; Hansen's tutorial)
  const cs = (mueff + 2) / (n + mueff + 5), ds = 1 + 2 * Math.max(0, Math.sqrt((mueff - 1) / (n + 1)) - 1) + cs;
  const cc = (4 + mueff / n) / (n + 4 + 2 * mueff / n);
  const c1 = (2 / ((n + 1.3) ** 2 + mueff)) * (n + 2) / 3;
  const cmu = Math.min(1 - c1, (2 * (mueff - 2 + 1 / mueff) / ((n + 2) ** 2 + mueff)) * (n + 2) / 3);
  const chiN = Math.sqrt(n) * (1 - 1 / (4 * n) + 1 / (21 * n * n));
  let m = new Array(n).fill(0), sigma = 0.5, C = new Array(n).fill(1), ps = new Array(n).fill(0), pc = new Array(n).fill(0);
  const randn = normals(seed * 7919 + 17), log = [];
  const toParams = (x) => {
    const p = {};
    names.forEach((k, i) => { const [lo, hi] = TUNE[k]; p[k] = Math.min(hi, Math.max(lo, Math.round(base[k] * 2 ** x[i]))); });
    return p;
  };
  const show = (p) => names.map(k => `--param ${k}=${p[k]}`).join(' ');
  console.log(`Tuning ${n} weights: ${gens} generations of ${lambda}, ${rounds} rounds each (${lineup}).`);
  for (let gen = 0; gen < gens; gen++) {
    const t0 = Date.now(), pop = [];
    for (let k = 0; k < lambda; k++) {
      const z = Array.from({ length: n }, randn), y = z.map((v, i) => Math.sqrt(C[i]) * v), x = y.map((v, i) => m[i] + sigma * v);
      const params = toParams(x);
      // every candidate of this generation plays the same rounds
      const res = await runArena({ lineup, rounds, seed: seed * 1000 + gen, params, check: 0, workers: o.workers });
      const won = res.summary.ai.filter(a => a.name === 'dangerous').reduce((s, a) => s + a.wins, 0);
      pop.push({ x, y, score: won / res.summary.rounds, params });
      log.push({ gen, score: won / res.summary.rounds, params });
    }
    pop.sort((a, b) => b.score - a.score);
    // move the centre to the weighted mean of the better half; adapt the step size and spread
    const yw = new Array(n).fill(0);
    for (let i = 0; i < mu; i++) for (let j = 0; j < n; j++) yw[j] += weights[i] * pop[i].y[j];
    m = m.map((v, j) => v + sigma * yw[j]);
    ps = ps.map((v, j) => (1 - cs) * v + Math.sqrt(cs * (2 - cs) * mueff) * yw[j] / Math.sqrt(C[j]));
    const psn = Math.sqrt(ps.reduce((a, v) => a + v * v, 0));
    const hs = psn / Math.sqrt(1 - (1 - cs) ** (2 * (gen + 1))) < (1.4 + 2 / (n + 1)) * chiN ? 1 : 0;
    pc = pc.map((v, j) => (1 - cc) * v + hs * Math.sqrt(cc * (2 - cc) * mueff) * yw[j]);
    C = C.map((v, j) => {
      let rank = 0;
      for (let i = 0; i < mu; i++) rank += weights[i] * pop[i].y[j] ** 2;
      return (1 - c1 - cmu) * v + c1 * (pc[j] ** 2 + (1 - hs) * cc * (2 - cc) * v) + cmu * rank;
    });
    sigma *= Math.exp((cs / ds) * (psn / chiN - 1));
    const mean = pop.reduce((a, q) => a + q.score, 0) / lambda;
    console.log(`\nGeneration ${gen + 1}: best ${(100 * pop[0].score).toFixed(1)}%, mean ${(100 * mean).toFixed(1)}%, step ${sigma.toFixed(2)} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    console.log(`  centre now: ${show(toParams(m))}`);
    if (o.json) fs.writeFileSync(o.json, JSON.stringify({ names, centre: toParams(m), sigma, C, log }, null, 1));
  }
}
main().catch((e) => { console.error(e.message || e); process.exitCode = 1; });
