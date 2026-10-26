// Computer players. Runs inside the deterministic simulation (uses game.rng only), so every peer in a
// network game computes identical AI inputs. Tuned with the original's AI values:
//   #915 chance of running the "blast bricks" routine, #920 how close a powerup must be to go for it,
//   #910 how far ahead the closing-in walls count as a threat.
'use strict';
(function (AB) {
  const { COLS, ROWS, DX, DY } = AB;
  const N = COLS * ROWS;
  const idx = (x, y) => y * COLS + x;
  const BAD = new Set([AB.PW.DISEASE, AB.PW.BADDISEASE, AB.PW.CLOG]);
  const AI = AB.AI = {};

  // ---- danger map: earliest tick (relative) each cell burns, Infinity if safe ----
  // self: the AI asking. Its own trigger bombs only go off when it decides (and it only decides
  // when it is clear of them), so for it they are not an immediate threat.
  function dangerMap(g, self) {
    const mine = self && g.bombs.some(b => b && !b.dead && b.kind === 1 && b.owner === self.slot);
    const key = mine ? g.tick * 16 + self.slot + 1 : g.tick * 16;
    if (g._dangerKey === key) return g._danger;
    const T = new Float32Array(N).fill(Infinity);
    const bombs = g.bombs.filter(b => b && !b.dead && b.motion !== 3);
    const tleft = bombs.map(b => {
      if (b.motion === 2) return 9999;
      if (b.kind === 1) return mine && b.owner === self.slot ? 600 : 25;   // someone else's trigger: any moment
      return Math.max(0, b.fuse - b.t);
    });
    // chain reactions: relax a few times
    const reach = bombs.map(b => blastCells(g, b));
    for (let it = 0; it < 4; it++) {
      for (let a = 0; a < bombs.length; a++) {
        for (const c of reach[a]) {
          for (let b = 0; b < bombs.length; b++) {
            if (b !== a && idx(bombs[b].cx, bombs[b].cy) === c && tleft[a] < tleft[b]) tleft[b] = tleft[a];
          }
        }
      }
    }
    for (let a = 0; a < bombs.length; a++) for (const c of reach[a]) if (tleft[a] < T[c]) T[c] = tleft[a];
    for (let i = 0; i < N; i++) if (g.flameT[i] > 0) T[i] = -g.flameT[i];   // burning now (negative = remaining)
    // closing walls
    if (g.enc && !g.enc.done) {
      let e = { x: g.enc.x, y: g.enc.y, dir: g.enc.dir, ring: g.enc.ring };
      const ahead = AB.val(910, 15);
      for (let k = 0; k < ahead; k++) {
        const c = idx(e.x, e.y);
        const t = (k + 1) * g.encEvery() - g.enc.t;
        if (t < T[c]) T[c] = t;
        const nx = e.x + DX[e.dir], ny = e.y + DY[e.dir];
        if (nx >= COLS - e.ring || ny >= ROWS - e.ring || nx < e.ring || ny < e.ring + (e.dir === 0 ? 1 : 0)) {
          e.dir = (e.dir + 1) & 3; if (e.dir === 1) { e.ring++; e.x = e.ring; e.y = e.ring; } continue;
        }
        e.x = nx; e.y = ny;
      }
    }
    g._danger = T; g._dangerKey = key;
    return T;
  }
  function blastCells(g, b, cx = b.cx, cy = b.cy, range = b.range) {
    const out = [idx(cx, cy)];
    for (let d = 0; d < 4; d++) {
      let x = cx, y = cy;
      for (let l = 0; l < range; l++) {
        x += DX[d]; y += DY[d];
        if (!AB.inArena(x, y)) break;
        const t = g.tiles[idx(x, y)];
        if (t === 1) break;
        out.push(idx(x, y));
        // (powerups stop flames too, but someone may pick them up first - stay conservative)
        if (t === 2 || g.bombAt[idx(x, y)] >= 0) break;
      }
    }
    return out;
  }

  // BFS over walkable cells from (sx,sy); returns {dist, prev}
  function bfs(g, sx, sy, ticksPerCell, T, extraBlock) {
    const dist = new Int16Array(N).fill(-1), prev = new Int16Array(N).fill(-1);
    const q = [idx(sx, sy)]; dist[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % COLS, y = (c / COLS) | 0;
      for (let d = 0; d < 4; d++) {
        const nx = x + DX[d], ny = y + DY[d];
        if (!g.free(nx, ny)) continue;
        const n = idx(nx, ny);
        if (dist[n] >= 0 || (extraBlock && extraBlock.has(n))) continue;
        const arrive = (dist[c] + 1) * ticksPerCell;
        // don't path through cells that will be burning while we pass
        const t = T[n];
        if (t < 0) continue;                                     // burning now
        if (t !== Infinity && arrive + 6 >= t && arrive <= t + AB.K.FLAME + 6) continue;
        dist[n] = dist[c] + 1; prev[n] = c; q.push(n);
      }
    }
    return { dist, prev, order: q };
  }
  function firstStep(prev, start, target) {
    let c = target, guard = 0;
    while (prev[c] !== start && prev[c] >= 0 && guard++ < N) c = prev[c];
    return prev[c] === start ? c : (c === start ? -1 : -1);
  }

  function enemyOf(g, p, o) { return o !== p && o.alive && (!g.S.teamPlay || o.team !== p.team); }

  // ---- skill levels ----
  // 'hard' is the AI above, unchanged: the port's own, written for it (it was called Original until the
  // 1997 game's AI was ported, js/original.js). The easier ones think it over less often (and keep doing
  // the same thing meanwhile), notice bombs later, chase people less, drop fewer bombs and care less about
  // power-ups. Everything random comes from the game's own RNG, so network games stay in step.
  //   react: ticks between decisions (+ up to `jitter`)   see: how many ticks before a blast they notice it
  //   chase: how much enemies attract them                bombs: 1-in-N chance to consider a bomb at all
  const LEVELS = {
    easy:   { react: 12, jitter: 8, see: 50, chase: 0, bombs: 3, near: 2, items: 2 },
    medium: { react: 4, jitter: 4, see: 95, chase: 0.6, bombs: 1, near: 3, items: 1 },
  };
  // 'original' (the 1997 game's AI, js/original.js) and 'dangerous' (js/dangerous.js) are computer
  // players of their own
  AI.LEVELS = ['easy', 'medium', 'original', 'hard', 'dangerous'];
  AI.LEVEL_NAMES = { easy: 'Easy', medium: 'Medium', original: 'Original', hard: 'Hard', dangerous: 'Dangerous' };
  const MOVE = AB.IN.UP | AB.IN.DOWN | AB.IN.LEFT | AB.IN.RIGHT;
  AI.think = function (g, p) {
    if (p.aiLevel === 'original' && AI.original) return AI.original(g, p);
    if (p.aiLevel === 'dangerous' && AI.dangerous) return AI.dangerous(g, p);
    const lv = LEVELS[p.aiLevel];
    if (!lv) return think(g, p, null);
    const st = p.ai || (p.ai = {});
    // between decisions keep walking the same way (bomb and action are single presses, not repeated),
    // but never on into flames
    if (st.wait > 0) {
      st.wait--;
      const mv = (st.held | 0) & MOVE;
      const d = mv & AB.IN.UP ? 0 : mv & AB.IN.RIGHT ? 1 : mv & AB.IN.DOWN ? 2 : mv & AB.IN.LEFT ? 3 : -1;
      const nx = AB.cellX(p.x) + (d < 0 ? 0 : DX[d]), ny = AB.cellY(p.y) + (d < 0 ? 0 : DY[d]);
      if (d < 0 || !AB.inArena(nx, ny) || g.flameT[idx(nx, ny)] <= 0) return mv;
      st.wait = 0;
    }
    const bits = think(g, p, lv);
    st.held = bits;
    // in danger they snap out of it quickly; otherwise they take their time
    st.wait = st.danger ? 1 : lv.react + g.rng.int(lv.jitter + 1);
    return bits;
  };
  // what an easier AI notices: other players' blasts further off than `see` ticks look safe to it;
  // its own bombs (it knows where it put them) it always sees
  function perceive(g, p, T, see) {
    const U = Float32Array.from(T);
    const own = new Set();
    for (const b of g.bombs) if (b && !b.dead && b.owner === p.slot) for (const c of blastCells(g, b)) own.add(c);
    for (let i = 0; i < U.length; i++) if (U[i] !== Infinity && U[i] > see && !own.has(i)) U[i] = Infinity;
    return U;
  }

  // Each computer player has its own random stream (seeded from the round's seed and its slot, kept in
  // its state, so network games stay in step), and they keep out of each other's way: without that,
  // two that met made the same choices from then on and walked around on top of each other.
  function arand(st) {
    let t = (st.rs = (st.rs + 0x6D2B79F5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  // how crowded a cell is for p: other players standing on (or next to) it, or other computer
  // players already heading there
  function crowd(g, p, c) {
    const x = c % COLS, y = (c / COLS) | 0;
    let n = 0;
    for (const o of g.players) {
      if (o === p || !o.alive) continue;
      const d = Math.abs(AB.cellX(o.x) - x) + Math.abs(AB.cellY(o.y) - y);
      if (d === 0) n += 2; else if (d === 1) n += 0.5;
      if (o.isAI && o.ai && o.ai.goal === c) n += 1.5;
    }
    return n;
  }

  function think(g, p, lv) {
    const st = p.ai || (p.ai = {});
    if (st.lastBomb === undefined) { st.lastBomb = -999; st.target = -1; st.t = 0; st.moveTo = -1; st.moveT = 0; }
    if (st.rs === undefined) st.rs = ((g.cfg.seed >>> 0) ^ Math.imul(p.slot + 1, 0x9E3779B1)) >>> 0;
    if (!p.alive || p.special === 5 || p.special === 6 || p.special === 7) return 0;
    const T = lv ? perceive(g, p, dangerMap(g, p), lv.see) : dangerMap(g, p);
    const cx = AB.cellX(p.x), cy = AB.cellY(p.y), here = idx(cx, cy);
    const tpc = Math.ceil(AB.CW * AB.SUB / g.speedOf(p));       // ticks per cell
    let bits = 0;
    const ox = AB.offX(p.x), oy = AB.offY(p.y);
    const centred = Math.abs(ox) <= 2 && Math.abs(oy) <= 2;

    // holding a bomb (blue hand): throw it towards an enemy line or just throw
    if (p.held >= 0) { if (g.rng.chance(20)) return 0; return AB.IN.BOMB; }

    const path = bfs(g, cx, cy, tpc, T);
    const safe = (c) => T[c] === Infinity;
    let goal = -1;
    st.danger = !safe(here);

    if (!safe(here)) {
      // flee: nearest reachable safe cell. Of the equally near ones, the one it was already running to,
      // else the least crowded (ties broken the same way every tick, its own way: no dithering)
      let best = -1, bd = 1e9, bc = 1e9;
      for (const c of path.order) {
        if (!safe(c) || path.dist[c] > bd) continue;
        const cr = c === st.goal ? -1 : crowd(g, p, c) + (((Math.imul(c + 1, 2654435761) ^ Math.imul(p.slot + 1, 40503)) >>> 0) % 1000) / 10000;
        if (path.dist[c] < bd || cr < bc) { bd = path.dist[c]; bc = cr; best = c; }
      }
      goal = best;
      if (goal < 0) {
        // nowhere safe: choose the cell that burns latest
        let lt = -1;
        for (const c of path.order) if (T[c] > lt) { lt = T[c]; goal = c; }
      }
    } else {
      // trigger bombs go off oldest first (fcn.00424b41): fire the oldest one once we are clear of
      // it and it would catch an enemy, or it has been sitting there a while
      {
        let oldest = null;
        for (const b of g.bombs) if (b && !b.dead && b.owner === p.slot && b.kind === 1 && b.motion < 2 && (!oldest || b.dropTick < oldest.dropTick)) oldest = b;
        if (oldest) {
          const cells = blastCells(g, oldest);
          const clear = !cells.includes(here);
          const hits = g.players.some(o => enemyOf(g, p, o) && cells.includes(idx(AB.cellX(o.x), AB.cellY(o.y))));
          if (clear && (hits || g.tick - oldest.dropTick > 75) && !(p.prevIn & AB.IN.ACTION)) return AB.IN.ACTION;
        }
      }
      // powerups within reach (#920)
      const near = lv ? lv.near : AB.val(920, 4);
      let bestItem = -1, bdi = 1e9;
      for (const c of path.order) {
        const it = g.items[c];
        if (it >= 0 && !BAD.has(it) && path.dist[c] <= near + 2 && path.dist[c] < bdi && safe(c)) { bdi = path.dist[c]; bestItem = c; }
      }
      if (bestItem >= 0 && (!lv || g.rng.chance(lv.items))) goal = bestItem;
      // closing walls: head for the part of the arena that stays open
      if (g.enc && !g.enc.done) {
        const ringOf = (c) => { const x = c % COLS, y = (c / COLS) | 0; return Math.min(x, y, COLS - 1 - x, ROWS - 1 - y); };
        const keep = Math.min(g.enc.depth, 5);
        if (ringOf(here) < keep) {
          let bi = -1, bd2 = 1e9;
          for (const c of path.order) if (ringOf(c) >= keep && safe(c) && path.dist[c] < bd2) { bd2 = path.dist[c]; bi = c; }
          if (bi >= 0) goal = bi;
        }
      }

      // consider dropping a bomb here
      if (centred && g.bombsOut(p) < g.maxBombs(p) && !g.bombAtCell(cx, cy) && !p.dis[AB.DIS.CONSTIPATION] && g.tick - st.lastBomb > 20 && (!lv || g.rng.chance(lv.bombs))) {
        const fake = { cx, cy, range: g.flameLen(p) };
        const cells = blastCells(g, fake);
        const set = new Set(cells);
        let value = 0;
        for (const c of cells) {
          if (g.tiles[c] === 2 && g.brickT[c] <= 0) value += 1;
        }
        // bricks adjacent along the arms are reported by blastCells including the brick cell
        let hitsEnemy = false;
        for (const o of g.players) if (enemyOf(g, p, o) && set.has(idx(AB.cellX(o.x), AB.cellY(o.y)))) hitsEnemy = true;
        if (hitsEnemy) value += 3;
        if (value > 0 && (hitsEnemy || g.rng.chance(Math.max(1, AB.val(915, 5) - 3)))) {
          // escape check with the new bomb in place
          const T2 = Float32Array.from(T);
          for (const c of cells) if (AB.K.FUSE < T2[c]) T2[c] = AB.K.FUSE;
          const esc = bfs(g, cx, cy, tpc, T2);
          // require a couple of distinct safe spots so a single new bomb can't box us in
          let safeSpots = 0;
          for (const c of esc.order) if (T2[c] === Infinity && esc.dist[c] * tpc < AB.K.FUSE - 30) safeSpots++;
          const crowd = g.players.some(o => o !== p && o.alive && Math.abs(AB.cellX(o.x) - cx) + Math.abs(AB.cellY(o.y) - cy) <= 3);
          const ok = safeSpots >= (crowd ? 2 : 1);
          if (ok) { st.lastBomb = g.tick; st.moveTo = -1; return AB.IN.BOMB; }
        }
      }
      if (goal < 0) {
        // wander towards bricks or enemies
        if (!st.target || st.target < 0 || g.tick - st.t > 90 || path.dist[st.target] < 0) {
          st.t = g.tick;
          const cand = [];
          for (const c of path.order) {
            if (!safe(c) || path.dist[c] < 1) continue;
            // avoid dead-end pockets: need at least two open neighbours
            { let open = 0; const x0 = c % COLS, y0 = (c / COLS) | 0; for (let d = 0; d < 4; d++) if (g.free(x0 + DX[d], y0 + DY[d])) open++; if (open < 2 && g.rng.chance(2)) continue; }
            const x = c % COLS, y = (c / COLS) | 0;
            let score = 0;
            for (let d = 0; d < 4; d++) { const n = idx(x + DX[d], y + DY[d]); if (AB.inArena(x + DX[d], y + DY[d]) && g.tiles[n] === 2) score += 2; }
            const chase = lv ? lv.chase : 1;
            if (chase) for (const o of g.players) if (enemyOf(g, p, o)) { const dd = Math.abs(AB.cellX(o.x) - x) + Math.abs(AB.cellY(o.y) - y); if (dd <= 2) score += (3 - dd) * chase; }
            score -= path.dist[c] * 0.15;
            score -= crowd(g, p, c);           // not where someone else already is or is going
            if (score > 0) cand.push([score + arand(st) * 1.5, c]);
          }
          cand.sort((a, b) => b[0] - a[0]);
          st.target = cand.length ? cand[0][1] : (path.order.length > 1 ? path.order[1 + Math.floor(arand(st) * (path.order.length - 1))] : -1);
        }
        goal = st.target;
        if (goal === here) { if (centred) st.target = -1; goal = -1; }
      }
    }

    st.goal = goal;                          // (the others look at it: crowd)
    // ---- steer towards goal ----
    // commit to the neighbouring cell we started moving into until we are centred in it; this
    // avoids dithering on cell borders when the plan flips between ticks
    const dirTo = (c) => { const sx = c % COLS, sy = (c / COLS) | 0; return sx > cx ? 1 : sx < cx ? 3 : sy > cy ? 2 : sy < cy ? 0 : -1; };
    const KEYS = [AB.IN.UP, AB.IN.RIGHT, AB.IN.DOWN, AB.IN.LEFT];
    const plannedStep = goal >= 0 && goal !== here ? firstStep(path.prev, here, goal) : -1;
    if (st.moveTo >= 0) {
      const mt = st.moveTo, mx = mt % COLS, my = (mt / COLS) | 0;
      const deadly = T[mt] < 0 || (T[mt] !== Infinity && T[mt] < tpc + 4);
      const adjacent = Math.abs(mx - cx) + Math.abs(my - cy) === 1;
      // when fleeing, only keep going if that cell is safe or is where the escape plan goes anyway
      const fleeConflict = !safe(here) && mt !== plannedStep && mt !== here && T[mt] !== Infinity;
      if (deadly || fleeConflict || !g.free(mx, my) || (!adjacent && mt !== here) || (mt === here && centred) || g.tick - st.moveT > 90) st.moveTo = -1;
      else if (mt === here) {
        if (ox > 2) bits |= AB.IN.LEFT; else if (ox < -2) bits |= AB.IN.RIGHT;
        else if (oy > 2) bits |= AB.IN.UP; else if (oy < -2) bits |= AB.IN.DOWN;
        if (bits) return bits;
        st.moveTo = -1;
      } else { bits |= KEYS[dirTo(mt)]; return bits; }
    }
    if (plannedStep >= 0) {
      st.moveTo = plannedStep; st.moveT = g.tick;
      bits |= KEYS[dirTo(plannedStep)];
    } else if (!centred) {
      // re-centre in the current cell
      if (ox > 2) bits |= AB.IN.LEFT; else if (ox < -2) bits |= AB.IN.RIGHT;
      else if (oy > 2) bits |= AB.IN.UP; else if (oy < -2) bits |= AB.IN.DOWN;
    }
    // stop a kicked bomb that is heading back at us
    return bits;
  }
  AI._dangerMap = dangerMap;
})(window.AB);
