// The Dangerous computer player. Like the others it runs inside the deterministic simulation: it reads
// only the game, keeps what it remembers in p.ai, scores in whole numbers and draws no random numbers, so
// every computer in a network game makes the same moves for it. Thinking allocates nothing: the scratch
// arrays below are filled afresh on each use.
//
// It builds on the Hard AI's idea (js/ai.js: work out when each cell will burn, walk round it), and
//   - sees the board as it will be: its bombs' real fuse (Short Fuze), chain reactions, bricks that burn
//     away and let a later blast through, where kicked and thrown bombs will go off, the closing walls;
//     and times its steps as the game moves it, from where it is in its cell (rows and columns differ,
//     conveyors speed and slow it);
//   - never lays a bomb it can't get away from, nor one a nearby enemy could trap it with by laying one
//     of their own next (where they stand, or a step nearer), and keeps out of places where that could
//     happen;
//   - minds Reversed Controls, keeps off trampolines and diseases unless fleeing, and keeps clear of
//     players who have a disease;
//   - goes through warp holes (the flames can't touch it meanwhile), to get away from its bombs and as
//     short cuts, but not out of a hole an enemy waits by;
//   - heads for where a bomb would do most (bricks, enemies) and it could still get away; early in the
//     round, for power-ups and the bricks that hide them above all;
//   - lays bombs to kill: where every way out an enemy has would burn, or only one or two are left, or
//     just to take away some of their room; running from one bomb, it lays another if that corners them;
//   - late in the round keeps out of the closing walls' way, and gets between the enemies still out
//     there and the middle;
//   - fires its remote bombs when someone stands in the blast.
'use strict';
(function (AB) {
  const { COLS, ROWS, DX, DY, IN, PW, DIS, K } = AB;
  const N = COLS * ROWS, NEVER = 0x3fffffff;
  const idx = (x, y) => y * COLS + x;
  const KEYS = [IN.UP, IN.RIGHT, IN.DOWN, IN.LEFT];
  const SLIDE = Math.ceil(AB.CW * AB.SUB / K.KICK_SPEED);          // ticks a kicked bomb takes per cell
  const FLY = AB.SUB / K.PUNCH_SPEED;                               // ticks a thrown bomb takes per pixel

  // What it weighs up, in points (AB.AI.dangerousParams, so tools/ai_arena.cjs can try others).
  const P = {
    slack: 6,          // ticks to keep clear of a flame either side, walking through its cell
    threatDist: 4,     // an enemy this many steps away might lay a bomb next: don't be trappable by it
    approach: 1,       // ... and one might take a step nearer first (0: only where they stand)
    kill: 3000,        // a bomb that leaves an enemy no way out
    squeeze: 600,      // ... or one way out (half that for two)
    harass: 200,       // ... or just makes an enemy run (they make mistakes on the run)
    cut: 40,           // ... and per safe cell an enemy loses (of the first 12), short of cornering them
    brick: 150,        // each brick a bomb breaks
    burnItem: 300,     // each good power-up it would burn
    layAt: 150,        // lays a bomb worth at least this
    bombGap: 12,       // ticks between bombs
    item: 600,         // a power-up worth having (ITEM scales it)
    spot: 100,         // a cell to bomb from: per brick its blast would break (if it could get away)
    hunt: 250,         // ... and per enemy it would catch in the blast
    near: 100,         // per step closer than four to an enemy
    endgame: 2,        // hunting counts this many times over with one enemy left, or under 45 s to go
    exposed: 200,      // a cell in a corridor a nearby enemy could catch it in with a bomb laid now
    deadEnd: 150,      // a cell with one way out, with an enemy about
    conveyor: 80,      // a conveyor (it can't stand still on one)
    far: 15,           // per step away
    crowd: 100,        // other players there or heading there
    stick: 80,         // the cell it was already heading for
    jitter: 60,        // a tie-break of its own (changes every two seconds)
    walls: 400,        // a cell the closing walls will fill
    fireAfter: 60,     // fires a remote bomb that has caught nobody after this many ticks
    runLay: 300,       // running from a bomb, lays another on the way if it does this much to the enemies (0: never)
    early: 50,         // for the first this many seconds of a round...
    greedy: 200,       // ... power-ups, and bricks (which hide them), count this much (percent): they win the late game
    sick: 300,         // a cell next to a player with a disease, which it would catch (0: doesn't mind)
    lateAt: 65,        // from this many seconds left, with walls to come, a cell they will fill isn't one to
                       // stay in, for it or for an enemy (0: it keeps clear of them only while they fall)
    inner: 300,        // ... and a cell inside, by an enemy outside, cuts them off from the middle
    warps: 1,          // goes through warp holes, out at the other end (0: keeps off them)
  };
  // what each power-up is worth to it, in hundredths of P.item; below zero: keep off
  const ITEM = [];
  ITEM[PW.BOMB] = 100; ITEM[PW.FLAME] = 90; ITEM[PW.DISEASE] = -100; ITEM[PW.KICK] = 70; ITEM[PW.SKATE] = 80;
  ITEM[PW.PUNCH] = 20; ITEM[PW.GRAB] = 5; ITEM[PW.SPOOGE] = 20; ITEM[PW.GOLDFLAME] = 90; ITEM[PW.TRIGGER] = 60;
  ITEM[PW.JELLY] = 15; ITEM[PW.BADDISEASE] = -100; ITEM[PW.RANDOM] = 10; ITEM[PW.CLOG] = -100;

  // ---------------------------------------------------------------- scratch
  const S0 = new Int32Array(N), E0 = new Int32Array(N);   // when each cell burns, as things are
  const risk = new Uint8Array(N);                         // ... and where someone's remote bomb could go off
  const S1 = new Int32Array(N), E1 = new Int32Array(N);   // ... if the enemies near it each laid a bomb now
  const S2 = new Int32Array(N), E2 = new Int32Array(N);   // ... with a bomb of its own laid here (or one fired)
  const S3 = new Int32Array(N), E3 = new Int32Array(N);   // ... with its bomb and the enemies' both
  const distA = new Int16Array(N), prevA = new Int16Array(N), queA = new Int16Array(N), timeA = new Int32Array(N);
  const distB = new Int16Array(N), prevB = new Int16Array(N), queB = new Int16Array(N), timeB = new Int32Array(N);
  const distC = new Int16Array(N), queC = new Int16Array(N), seenC = new Int32Array(N);
  let stampC = 0;
  // cells to keep off: a disease lying there, a trampoline (where it lands is anyone's guess), a warp
  // hole (unless it means to go through), a cell by a player with a disease (catching), a warp hole with
  // an enemy near enough to shut it in when it comes out there (a hole's way out is narrow)
  const keepOff = new Uint8Array(N), DISEASED = 1, TRAMP = 2, WARP = 4, SICK = 8, AMBUSH = 16, arm = new Int8Array(4);
  let walk = DISEASED | TRAMP | SICK | AMBUSH;  // what its own paths keep off (warp holes too, unless P.warps)
  // a warp hole (with P.warps): the cell of the hole it comes out of; -1 not one
  const warpTo = new Int16Array(N).fill(-1), holes = new Int16Array(16);
  const WARPT = 2 * (K.WARP + 1);               // ticks warping (js/game.js updateWarp), out of the flames' reach
  // which ring round the edge each cell is in (0: the outermost), as the closing walls fill them
  const ringOf = new Uint8Array(N);
  for (let c = 0; c < N; c++) { const x = c % COLS, y = (c - x) / COLS; ringOf[c] = Math.min(x, y, COLS - 1 - x, ROWS - 1 - y); }
  const MAXB = 160, MAXPOS = 4096;
  const bFrom = new Int16Array(MAXB), bTo = new Int16Array(MAXB), bRange = new Int16Array(MAXB);
  const bTime = new Int32Array(MAXB), bDone = new Uint8Array(MAXB), pos = new Int16Array(MAXPOS);
  const bombHere = new Int16Array(N), gone = new Int32Array(N), mark = new Int32Array(N);
  let stamp = 0;
  // bombs that might be laid, for danger(): where, how far they reach, their fuse
  const xCell = new Int16Array(8), xRange = new Int16Array(8), xFuse = new Int32Array(8);
  let nExtra = 0, fireNow = null, riskOut = null, moved = null;     // moved: a bomb to leave out (one it would kick)

  // ---------------------------------------------------------------- when each cell burns
  // s[c]: ticks till the first flame there (0: burning now; NEVER: none coming), e[c]: when the last one
  // goes out (NEVER: the walls close it for good). Bombs go off in order of time (as Dijkstra settles
  // distances), each setting off those its blast reaches; a brick a blast breaks lets later blasts through.
  // A kicked bomb may go off anywhere it slides, a thrown one where it comes down. Someone else's remote
  // bomb could go off any moment: its blast goes in riskOut (if given) rather than in s, so it's somewhere
  // not to stay but not a wall: getting out beats standing there. Its own go off only when it says so, or
  // when a blast sets them off. Bombs that might be laid (xCell..., nExtra of them) and one fired now
  // (fireNow) are counted in too.
  function danger(g, self, s, e) {
    s.fill(NEVER); e.fill(0); bombHere.fill(-1);
    if (riskOut) riskOut.fill(0);
    for (let c = 0; c < N; c++) gone[c] = g.tiles[c] !== 2 ? 0 : g.brickT[c] > 0 ? g.brickT[c] : NEVER;
    let nb = 0, np = 0;
    for (const b of g.bombs) {
      if (!b || b.dead || b === moved || b.motion === 3 || nb >= MAXB - 8 || np >= MAXPOS - 2 * (COLS + ROWS)) continue;
      let t = Math.max(0, b.fuse - b.t), remote = false;
      if (b === fireNow) t = 0;
      else if (b.kind === 1) {
        const o = g.pById(b.owner);
        if (o && o.alive) { t = NEVER; remote = b.owner !== self.slot; }
      }
      bFrom[nb] = np; bRange[nb] = b.range;
      const here = idx(b.cx, b.cy), belt = g.extras[here];
      const carried = b.motion === 0 && belt && belt.t === 'conveyor' && g.free(b.cx + DX[belt.dir], b.cy + DY[belt.dir]) && !g.playerAtCell(b.cx + DX[belt.dir], b.cy + DY[belt.dir]);
      if (b.motion === 0 && !carried) {
        pos[np++] = here; bombHere[here] = nb;
        if (g.flameT[here] > 0) t = 0;
      } else if (b.motion === 1 || carried) {
        // on the move, kicked or carried by a conveyor (js/game.js slideBomb, updateBombs): it goes off
        // wherever it has got to when the fuse runs out, at a cell every SLIDE ticks kicked, slower on a
        // conveyor; it stops short of anything in the way, arrows turn it, a conveyor carries it only as
        // far as the conveyor goes, and a flame on the way sets it off there. Counted: the cell it should
        // be in then and the cells either side (or where it comes to rest, for a remote bomb).
        const conveyed = carried || b.conveyed, per = conveyed ? Math.ceil(AB.CW * AB.SUB / g.conveyorSpeed) : SLIDE;
        let x = b.cx, y = b.cy, d = conveyed ? belt ? belt.dir : b.dir : b.dir, len = 1;
        const p0 = np;
        pos[np++] = here; bombHere[here] = nb;
        if (g.flameT[here] > 0) t = 0;
        for (let k = 1; k <= COLS + ROWS && t > 0; k++) {
          const ex = g.extras[idx(x, y)];
          if (ex && ex.t === 'arrow') d = ex.dir;
          else if (conveyed) { if (ex && ex.t === 'conveyor') d = ex.dir; else break; }
          const x2 = x + DX[d], y2 = y + DY[d];
          if (!g.free(x2, y2)) break;
          const ex2 = g.extras[idx(x2, y2)];
          if (ex2 && ex2.t === 'warp') break;
          x = x2; y = y2;
          pos[np++] = idx(x, y); len++;
          if (g.flameT[idx(x, y)] > 0) { t = Math.min(t, k * per); break; }
          if (k * per > t + per) break;
        }
        const j = t >= NEVER ? len - 1 : Math.min(len - 1, Math.floor(t / per));
        const a = Math.max(0, j - 1), z = Math.min(len - 1, j + 1);
        for (let q = a; q <= z; q++) pos[p0 + q - a] = pos[p0 + q];
        np = p0 + z - a + 1;
      } else {
        // in the air: where it comes down, its fuse running again from there
        const c = landing(g, b);
        if (c < 0) continue;
        pos[np++] = c;
        t = g.flameT[c] > 0 ? landT : t < NEVER ? t + landT : NEVER;
      }
      if (remote && riskOut && t >= NEVER) for (let q = bFrom[nb]; q < np; q++) reach(g, pos[q], b.range, riskOut);
      bTo[nb] = np; bTime[nb] = t; nb++;
    }
    for (let k = 0; k < nExtra; k++) {
      const c = xCell[k];
      bFrom[nb] = np; bRange[nb] = xRange[k]; bTime[nb] = g.flameT[c] > 0 ? 0 : xFuse[k];
      pos[np++] = c; if (bombHere[c] < 0) bombHere[c] = nb;
      bTo[nb] = np; nb++;
    }
    bDone.fill(0, 0, nb);
    for (let k = 0; k < nb; k++) {
      let i = -1;
      for (let j = 0; j < nb; j++) if (!bDone[j] && (i < 0 || bTime[j] < bTime[i])) i = j;
      const t = bTime[i];
      if (t >= NEVER) break;
      bDone[i] = 1;
      if (++stamp >= 0x7fffffff) { stamp = 1; mark.fill(0); }
      for (let q = bFrom[i]; q < bTo[i]; q++) burst(g, pos[q], bRange[i], t, i, s, e);
      for (let j = 0; j < nb; j++) {
        if (bDone[j] || bTime[j] <= t) continue;
        for (let q = bFrom[j]; q < bTo[j]; q++) if (mark[pos[q]] === stamp) { bTime[j] = t; break; }
      }
    }
    for (let c = 0; c < N; c++) if (g.flameT[c] > 0) { s[c] = 0; if (g.flameT[c] > e[c]) e[c] = g.flameT[c]; }
    // the closing walls (js/game.js encAdvance), some 4 seconds ahead
    const en = g.enc;
    if (en && !en.done) {
      const every = g.encEvery();
      let x = en.x, y = en.y, d = en.dir, ring = en.ring;
      for (let k = 0; k * every < 240; k++) {
        const c = idx(x, y), t = (k + 1) * every - en.t;
        if (t < s[c]) s[c] = t;
        e[c] = NEVER;
        let moved = false;
        for (let guard = 0; guard < 8 && !moved; guard++) {
          const x2 = x + DX[d], y2 = y + DY[d];
          if (x2 >= COLS - ring || y2 >= ROWS - ring || x2 < ring || y2 < ring + (d === 0 ? 1 : 0)) {
            d = (d + 1) & 3;
            if (d === 1) { ring++; x = ring; y = ring; moved = true; }
          } else { x = x2; y = y2; moved = true; }
        }
        if (ring >= en.depth || ring * 2 >= ROWS) break;
      }
    }
  }
  // one bomb's blast from cell c0 at time t (js/game.js explode): arms stop at solid blocks, at a brick
  // still standing then (which it breaks) and at a bomb that hasn't gone off (which it sets off)
  function burst(g, c0, range, t, self, s, e) {
    burn(c0, t, s, e);
    const x0 = c0 % COLS, y0 = (c0 - x0) / COLS;
    for (let d = 0; d < 4; d++) {
      let x = x0, y = y0;
      for (let l = 0; l < range; l++) {
        x += DX[d]; y += DY[d];
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) break;
        const c = idx(x, y), tile = g.tiles[c];
        if (tile === 1) break;
        burn(c, t, s, e);
        if (tile === 2 && gone[c] > t) { if (gone[c] === NEVER) gone[c] = t + K.BRICK; break; }
        const j = bombHere[c];
        if (j >= 0 && j !== self && !bDone[j]) break;
      }
    }
  }
  function burn(c, t, s, e) {
    mark[c] = stamp;
    if (t < s[c]) s[c] = t;
    if (t + K.FLAME > e[c] && e[c] < NEVER) e[c] = t + K.FLAME;
  }
  // the cells a blast from c0 would reach as the board is now (for remote bombs: risk)
  function reach(g, c0, range, out) {
    out[c0] = 1;
    const x0 = c0 % COLS, y0 = (c0 - x0) / COLS;
    for (let d = 0; d < 4; d++) {
      let x = x0, y = y0;
      for (let l = 0; l < range; l++) {
        x += DX[d]; y += DY[d];
        if (x < 0 || y < 0 || x >= COLS || y >= ROWS) break;
        const c = idx(x, y);
        if (g.tiles[c] === 1) break;
        out[c] = 1;
        if (g.tiles[c] === 2 || g.bombAt[c] >= 0) break;
      }
    }
  }
  // where a punched or thrown bomb comes down (js/game.js flyBomb): after three cells, the first cell it
  // can land in, off one edge and on at the other. (A jelly bomb may turn as it bounces: not foreseen.)
  let landT = 0;
  function landing(g, b) {
    const f = b.fly;
    if (!f) return -1;
    let x = AB.cellX(b.x), y = AB.cellY(b.y), cells = f.cells;
    const d = b.dir, per = (DX[d] ? AB.CW : AB.CH) * FLY;
    for (let k = 1; k <= 40; k++) {
      x += DX[d]; y += DY[d];
      if (x >= COLS + 2) x -= COLS + 3; else if (x <= -2) x += COLS + 3;
      if (y >= ROWS + 2) y -= ROWS + 3; else if (y <= -2) y += ROWS + 3;
      if (++cells < 3 || !AB.inArena(x, y)) continue;
      const c = idx(x, y), ex = g.extras[c];
      if (g.tiles[c] !== 0 || g.brickT[c] > 0 || g.bombAt[c] >= 0 || g.items[c] >= 0 || (ex && ex.t === 'warp') || g.playerAtCell(x, y)) continue;
      landT = Math.ceil(k * per);
      return c;
    }
    return -1;
  }

  // ---------------------------------------------------------------- where it can go
  // Breadth-first over the cells someone at (sx, sy) can walk to at `speed`, starting `lead` ticks from
  // now. Steps are timed as the game moves them (a cell is 40 pixels across and 36 down; a conveyor adds
  // its speed going with it and takes it off going against it); a cell that burns while they'd be in it is
  // no way through. The cells end up in que (it returns how many), the steps in dist, the ticks to each in
  // time and the way back in prev. `wall`: a cell to count as blocked (a bomb about to be laid there);
  // `off`: what to keep off (keepOff flags), or 0. A warp hole leads only to the hole it comes out of
  // (that hole goes in que, the warp hole itself doesn't): in the flames can't touch them, but the
  // walls still can. (ox, oy): how far from the middle of its cell it is now, in pixels: the first step
  // is that much nearer or further, and it has to be out of its cell before that burns.
  function search(g, sx, sy, speed, lead, s, e, dist, prev, que, time, wall, off, ox = 0, oy = 0) {
    dist.fill(-1);
    const c0 = idx(sx, sy), slack = P.slack, conv = g.conveyorSpeed;
    dist[c0] = 0; prev[c0] = -1; que[0] = c0; time[c0] = lead;
    let n = 1;
    for (let h = 0; h < n; h++) {
      const c = que[h], x = c % COLS, y = (c - x) / COLS, d = dist[c], t = time[c];
      for (let k = 0; k < 4; k++) {
        const x2 = x + DX[k], y2 = y + DY[k];
        if (!g.free(x2, y2)) continue;
        const c2 = idx(x2, y2), w = warpTo[c2];
        // (the hole it stands in, it can step out of and back into: that warps it)
        if ((dist[c2] >= 0 && !(c2 === c0 && w >= 0)) || c2 === wall || (keepOff[c2] & off & ~AMBUSH)) continue;
        let v = speed;
        const ex = g.extras[c2];
        if (ex && ex.t === 'conveyor') v += ex.dir === k ? conv : ex.dir === ((k + 2) & 3) ? -conv : 0;
        v = Math.max(100, v);
        const step = Math.ceil((k & 1 ? AB.CW : AB.CH) * AB.SUB / v);
        let enter = t + (step >> 1);
        if (h === 0) {
          enter = t + Math.max(0, Math.ceil((((k & 1 ? AB.CW : AB.CH) >> 1) - DX[k] * ox - DY[k] * oy) * AB.SUB / v));
          if (s[c0] < enter) continue;
        }
        const leave = enter + step, mid = enter + step - (step >> 1);
        if (w >= 0) {
          // in to the middle of the hole, then out at the other, and off that one
          const out = mid + WARPT, until = e[c2] >= NEVER ? mid + (WARPT >> 1) : mid;
          if (dist[w] >= 0 || (keepOff[w] & off) || (s[c2] < NEVER && until + slack > s[c2] && enter - slack < e[c2])) continue;
          if (s[w] < NEVER && out + (step >> 1) + slack > s[w] && out - slack < e[w]) continue;
          if (c2 !== c0) { dist[c2] = d + 1; prev[c2] = c; time[c2] = mid; }
          dist[w] = d + 2; prev[w] = c2 !== c0 ? c2 : c; que[n++] = w; time[w] = out;
          continue;
        }
        if (s[c2] < NEVER && leave + slack > s[c2] && enter - slack < e[c2]) continue;
        dist[c2] = d + 1; prev[c2] = c; que[n++] = c2; time[c2] = mid;
      }
    }
    return n;
  }
  // how many of the first n cells in que never burn and (if r is given) no remote bomb reaches; stops
  // counting at upTo
  function safeCells(s, r, que, n, upTo) {
    let k = 0;
    for (let q = 0; q < n && k < upTo; q++) if (s[que[q]] >= NEVER && !(r && r[que[q]])) k++;
    return k;
  }
  // an enemy's room: how many of the first n cells in que never burn (up to ROOM), and how many of those
  // (inside, also up to ROOM) are in ring `keep` or further in, where the closing walls won't come
  const ROOM = 12;
  let inside = 0;
  function roomOf(s, que, n, keep) {
    let k = 0;
    inside = 0;
    for (let q = 0; q < n && inside < ROOM; q++) {
      const c = que[q];
      if (s[c] < NEVER) continue;
      if (k < ROOM) k++;
      if (ringOf[c] >= keep) inside++;
    }
    return k;
  }
  // how many rings round the edge the closing walls will fill: while they fall, or (P.lateAt) from that
  // many seconds before they start; 0 for none
  function wallRings(g) {
    const en = g.enc, S = g.S;
    if (en) return en.done ? 0 : Math.min(en.depth, 5);
    if (!P.lateAt || g.timeLeft < 0 || g.timeLeft > P.lateAt * AB.TPS || !S.enclosement || S.playTime < K.HURRY) return 0;
    return Math.min(S.enclosement === 3 ? 99 : S.enclosement * 2, 5);
  }
  function firstStep(prev, start, target) {
    let c = target;
    for (let guard = 0; prev[c] !== start && prev[c] >= 0 && guard < N; guard++) c = prev[c];
    return prev[c] === start ? c : -1;
  }

  // ---------------------------------------------------------------- players
  function enemy(g, p, o) { return o !== p && o.alive && (!g.S.teamPlay || o.team !== p.team); }
  // ticks before someone can start walking: stunned, or picking up a bomb
  const waitOf = (o) => (o.special === 3 ? o.stunT : o.special === 4 ? Math.max(0, K.PICKUP_PAUSE + 30 - o.specialT) : 0);
  const fuseOf = (o) => (o.dis[DIS.SHORTFUZE] ? Math.floor(K.FUSE / 3) : K.FUSE);
  const canBomb = (g, o, x, y) => g.bombsOut(o) < g.maxBombs(o) && !o.dis[DIS.CONSTIPATION] && !g.bombAtCell(x, y);
  // other players on (or next to) a cell, or other computer players heading there (as js/ai.js)
  function crowd(g, p, c) {
    const x = c % COLS, y = (c - x) / COLS;
    let n = 0;
    for (const o of g.players) {
      if (o === p || !o.alive) continue;
      const d = Math.abs(AB.cellX(o.x) - x) + Math.abs(AB.cellY(o.y) - y);
      if (d === 0) n += 2; else if (d === 1) n += 0.5;
      if (o.isAI && o.ai && o.ai.goal === c) n += 1.5;
    }
    return n;
  }
  // the enemies close enough to trap it, as bombs they might lay where they stand (danger()'s extras), and
  // with P.approach, a step nearer it, where they'll be next (it's the way into where it is that they cut)
  function threats(g, p, cx, cy) {
    nExtra = 0;
    for (const o of g.players) {
      if (nExtra >= (P.approach ? 6 : 4) || !enemy(g, p, o) || o.tramp || o.special === 6 || o.special === 7) continue;
      const ox = AB.cellX(o.x), oy = AB.cellY(o.y), d = Math.abs(ox - cx) + Math.abs(oy - cy);
      if (d > P.threatDist || !canBomb(g, o, ox, oy)) continue;
      const range = g.flameLen(o), fuse = fuseOf(o);
      xCell[nExtra] = idx(ox, oy); xRange[nExtra] = range; xFuse[nExtra] = fuse; nExtra++;
      if (!P.approach || d < 2) continue;
      let next = -1, nd = d;
      for (let k = 0; k < 4; k++) {
        const x = ox + DX[k], y = oy + DY[k], dd = Math.abs(x - cx) + Math.abs(y - cy);
        if (dd < nd && g.free(x, y)) { nd = dd; next = idx(x, y); }
      }
      if (next >= 0) { xCell[nExtra] = next; xRange[nExtra] = range; xFuse[nExtra] = fuse + Math.ceil(AB.CW * AB.SUB / Math.max(100, g.speedOf(o))); nExtra++; }
    }
    return nExtra;
  }
  function itemWorth(g, p, t) {
    if (t === PW.FLAME && g.flameLen(p) >= 7) return 20;
    if (t === PW.BOMB && g.maxBombs(p) >= 8) return 30;
    if (t === PW.SKATE && p.pw[PW.SKATE] >= 4) return 10;
    if (t === PW.PUNCH && p.pw[PW.TRIGGER]) return -20;     // would cost it the remote bombs
    return ITEM[t] | 0;
  }

  // ---------------------------------------------------------------- deciding
  let cacheGame = null;
  function think(g, p) {
    const st = p.ai || (p.ai = {});
    if (st.moveTo === undefined) { st.moveTo = -1; st.moveT = 0; st.target = -1; st.lastBomb = -999; st.goal = -1; }
    if (!p.alive || p.special === 5 || p.special === 6 || p.special === 7) return 0;
    if (p.held >= 0) return 0;                  // carrying a bomb (Poops with the blue glove): let it go
    const cx = AB.cellX(p.x), cy = AB.cellY(p.y), here = idx(cx, cy);
    const ox = AB.offX(p.x), oy = AB.offY(p.y), centred = Math.abs(ox) <= 2 && Math.abs(oy) <= 2;
    const speed = g.speedOf(p), lead = waitOf(p);

    // the board as it will burn: the same for every Dangerous player this tick, unless it has remote
    // bombs of its own out (it fires those when it likes)
    let mine = false;
    for (const b of g.bombs) if (b && !b.dead && b.kind === 1 && b.owner === p.slot) { mine = true; break; }
    const key = g.tick * 16 + (mine ? p.slot + 1 : 0);
    if (cacheGame !== g || g._dangerousKey !== key) {
      nExtra = 0; fireNow = null; riskOut = risk;
      danger(g, p, S0, E0);
      riskOut = null; cacheGame = g; g._dangerousKey = key;
    }
    // ... and as it would if the enemies near it each laid a bomb now
    if (threats(g, p, cx, cy)) danger(g, p, S1, E1); else { S1.set(S0); E1.set(E0); }
    markCells(g, p);
    // in a warp hole on its way through (not one it has just come out of): on to the very middle, where
    // the warp takes it (stopping short, it would stand there)
    if (warpTo[here] >= 0 && p.warpLock !== here && (ox || oy)) return reversed(p, ox > 0 ? IN.LEFT : ox < 0 ? IN.RIGHT : oy > 0 ? IN.UP : IN.DOWN);
    let n = search(g, cx, cy, speed, lead, S0, E0, distA, prevA, queA, timeA, -1, walk, ox, oy);
    let goal = -1;
    if (S0[here] < NEVER || risk[here]) {
      // in danger: the best way out, off diseases (lying or catching) and trampolines; if there's none,
      // past a disease; and only if there's still none, on a trampoline (or a warp, without P.warps)
      goal = refuge(g, p, n, st);
      if (goal < 0) { n = search(g, cx, cy, speed, lead, S0, E0, distA, prevA, queA, timeA, -1, walk & (TRAMP | WARP), ox, oy); goal = refuge(g, p, n, st); }
      if (goal < 0) { n = search(g, cx, cy, speed, lead, S0, E0, distA, prevA, queA, timeA, -1, 0, ox, oy); goal = refuge(g, p, n, st); }
      // or kick or punch the bomb away: at someone, or because there's nowhere to run
      const send = sendBomb(g, p, cx, cy, here, speed, lead, centred, goal < 0);
      if (send) { st.moveTo = -1; return send; }
      // or, on the way, lay another that corners someone (where they're running to is known), if it
      // could still get away from both
      if (P.runLay && goal >= 0 && centred && g.tick - st.lastBomb > P.bombGap && canBomb(g, p, cx, cy) && !(g.extras[here] && g.extras[here].t === 'warp') &&
          bombWorth(g, p, cx, cy, here, speed, lead) >= P.layAt && pressed >= P.runLay) { st.lastBomb = g.tick; st.moveTo = -1; return IN.BOMB; }
      if (goal < 0) { let late = -1; for (let q = 0; q < n; q++) if (S0[queA[q]] > late) { late = S0[queA[q]]; goal = queA[q]; } }
    } else {
      // its oldest remote bomb (the one ACTION fires): fire it if it catches someone and not itself
      if (mine && !(p.prevIn & IN.ACTION)) {
        let ob = null;
        for (const b of g.bombs) if (b && !b.dead && b.owner === p.slot && b.kind === 1 && b.motion < 2 && (!ob || b.dropTick < ob.dropTick)) ob = b;
        if (ob) {
          nExtra = 0; fireNow = ob;
          danger(g, p, S2, E2);
          fireNow = null;
          let hits = 0;
          for (const o of g.players) if (enemy(g, p, o) && S2[idx(AB.cellX(o.x), AB.cellY(o.y))] <= 2) hits++;
          if (S2[here] >= NEVER && (hits || g.tick - ob.dropTick > P.fireAfter)) return IN.ACTION;
        }
      }
      // a bomb next to it to kick or punch at someone?
      const send = sendBomb(g, p, cx, cy, here, speed, lead, centred, false);
      if (send) { st.moveTo = -1; return send; }
      // a bomb here?
      let tried = false;
      if (centred && g.tick - st.lastBomb > P.bombGap && canBomb(g, p, cx, cy) && !(g.extras[here] && g.extras[here].t === 'warp')) {
        if (bombWorth(g, p, cx, cy, here, speed, lead) >= P.layAt) { st.lastBomb = g.tick; st.moveTo = -1; return IN.BOMB; }
        tried = true;
      }
      if (st.trapT === undefined || g.tick - st.trapT >= 8) { findTrap(g, p, n, st, speed); st.trapT = g.tick; }
      goal = pickGoal(g, p, n, st, here, tried);
      st.target = goal;
      if (goal === here) goal = -1;
    }
    st.goal = goal;
    const bits = reversed(p, steer(g, p, st, goal, here, cx, cy, ox, oy, centred));
    seen.tick = g.tick; seen.slot = p.slot; seen.here = here; seen.goal = goal; seen.danger = risk[here] ? -1 : S0[here]; seen.bits = bits;
    return bits;
  }
  // what the last call saw and chose (for looking into its decisions: nothing reads this back)
  const seen = { tick: 0, slot: -1, here: -1, goal: -1, danger: NEVER, bits: 0, S0, E0, S1, risk };

  // keepOff (and walk, warpTo) for player p: diseases lying about, trampolines, warp holes (and where
  // each leads, with P.warps, and which have enemies by them), and with P.sick, while p is well, the
  // cells by anyone who has a disease
  function markCells(g, p) {
    let nh = 0;
    for (let c = 0; c < N; c++) {
      const it = g.items[c], ex = g.extras[c];
      keepOff[c] = (it >= 0 && ITEM[it] < 0 ? DISEASED : 0) | (ex && ex.t === 'trampoline' ? TRAMP : 0);
      warpTo[c] = -1;
      if (ex && ex.t === 'warp') { keepOff[c] |= WARP; if (nh < holes.length) holes[nh++] = c; }
    }
    // (as js/game.js startWarp: out of the last hole with the id this one names)
    if (P.warps) {
      for (let i = 0; i < nh; i++) for (let j = 0; j < nh; j++) if (g.extras[holes[j]].id === g.extras[holes[i]].dest) warpTo[holes[i]] = holes[j];
      for (let i = 0; i < nh; i++) {
        const hx = holes[i] % COLS, hy = (holes[i] - hx) / COLS;
        for (const o of g.players) if (enemy(g, p, o) && Math.abs(AB.cellX(o.x) - hx) + Math.abs(AB.cellY(o.y) - hy) <= P.threatDist) keepOff[holes[i]] |= AMBUSH;
      }
    }
    walk = DISEASED | TRAMP | SICK | AMBUSH | (P.warps ? 0 : WARP);
    if (!P.sick || p.disT > 0) return;
    for (const o of g.players) {
      if (o === p || !o.alive || !(o.disT > 0)) continue;
      const x = AB.cellX(o.x), y = AB.cellY(o.y);
      keepOff[idx(x, y)] |= SICK;
      for (let d = 0; d < 4; d++) if (AB.inArena(x + DX[d], y + DY[d])) keepOff[idx(x + DX[d], y + DY[d])] |= SICK;
    }
  }

  // where to run to: the nearest cell that never burns, better one an enemy couldn't catch it in either,
  // with room around it, off conveyors and with nobody else heading there
  function refuge(g, p, n, st) {
    let best = -1, bs = -NEVER;
    for (let q = 0; q < n; q++) {
      const c = queA[q];
      if (S0[c] < NEVER || risk[c]) continue;
      let sc = -distA[c] * 100 - Math.floor(crowd(g, p, c) * 60);
      if (S1[c] < NEVER) sc -= 250;
      if (c === st.goal) sc += 50;
      const ex = g.extras[c];
      if (ex && ex.t === 'conveyor') sc -= P.conveyor;
      const x = c % COLS, y = (c - x) / COLS;
      for (let d = 0; d < 4; d++) if (g.free(x + DX[d], y + DY[d])) sc += 20;
      if (sc > bs) { bs = sc; best = c; }
    }
    return best;
  }

  // what a bomb laid here now would be worth, or -1 if it couldn't get away from it, or a nearby enemy
  // could trap it by laying another
  let pressed = 0;                              // what the last bombWorth() made of it against the enemies
  function bombWorth(g, p, cx, cy, here, speed, lead) {
    const range = g.flameLen(p), fuse = fuseOf(p);
    pressed = 0;
    // its way out with the bomb down, and with the bombs the enemies near it might lay as well
    const nThreats = threats(g, p, cx, cy);
    xCell[nThreats] = here; xRange[nThreats] = range; xFuse[nThreats] = fuse;
    nExtra = nThreats + 1; fireNow = null;
    // (the way out mustn't need a trampoline, nor go past a disease)
    if (nThreats) {
      danger(g, p, S3, E3);
      const m = search(g, cx, cy, speed, lead, S3, E3, distB, prevB, queB, timeB, -1, walk, AB.offX(p.x), AB.offY(p.y));
      if (!safeCells(S3, risk, queB, m, 1)) { nExtra = 0; return -1; }
    }
    xCell[0] = here; xRange[0] = range; xFuse[0] = fuse; nExtra = 1;
    danger(g, p, S2, E2);
    nExtra = 0;
    const m = search(g, cx, cy, speed, lead, S2, E2, distB, prevB, queB, timeB, -1, walk, AB.offX(p.x), AB.offY(p.y));
    if (!safeCells(S2, risk, queB, m, 1)) return -1;
    let worth = pressed = pressure(g, p, here, null, 0);
    // bricks it would break (that nothing else is breaking already) and good power-ups it would burn
    const greed = greedOf(g);
    for (let d = 0; d < 4; d++) {
      let x = cx, y = cy;
      for (let l = 0; l < range; l++) {
        x += DX[d]; y += DY[d];
        if (!AB.inArena(x, y)) break;
        const c = idx(x, y), t = g.tiles[c];
        if (t === 1) break;
        if (t === 2) { if (g.brickT[c] <= 0 && S0[c] >= NEVER) worth += Math.floor(P.brick * greed / 100); break; }
        if (g.items[c] >= 0) { if (ITEM[g.items[c]] > 0) worth -= Math.floor(P.burnItem * greed / 100); break; }
        if (g.bombAt[c] >= 0) break;
      }
    }
    return worth;
  }
  // how much power-ups (and bricks) count now, in percent: more early in the round (P.early, P.greedy)
  const greedOf = (g) => (g.tick < P.early * AB.TPS ? P.greedy : 100);

  // What the board in S2 (a bomb laid, kicked or thrown) does to the enemies, against S0 before it: an
  // enemy left no way out is a kill; one or two ways out, a squeeze (where it will hide is known: the next
  // bomb goes there); having to run at all, harassed; and every safe cell they lose (of the first ROOM)
  // is a cut. Late (wallRings), cells the closing walls will fill don't count as ways out, short of a kill:
  // left only those, they're squeezed. `wall`: the bomb's cell if it blocks the way; `stunned` (stunT
  // ticks): an enemy the bomb bounces off, who can't move for that long.
  function pressure(g, p, wall, stunned, stunT) {
    const keep = P.lateAt ? wallRings(g) : 0;
    let worth = 0;
    for (const o of g.players) {
      if (!enemy(g, p, o) || o.tramp) continue;
      const ex = AB.cellX(o.x), ey = AB.cellY(o.y), oc = idx(ex, ey);
      if (S2[oc] >= NEVER) continue;
      const ov = g.speedOf(o), ow = waitOf(o);
      const all = roomOf(S2, queB, search(g, ex, ey, ov, o === stunned ? Math.max(stunT, ow) : ow, S2, E2, distB, prevB, queB, timeB, wall, 0, AB.offX(o.x), AB.offY(o.y)), keep);
      const k = inside;
      let allBefore = ROOM, before = ROOM;
      if (S0[oc] < NEVER || keep) { allBefore = roomOf(S0, queB, search(g, ex, ey, ov, ow, S0, E0, distB, prevB, queB, timeB, -1, 0, AB.offX(o.x), AB.offY(o.y)), keep); before = inside; }
      if (all === 0 && allBefore > 0) { worth += P.kill; continue; }
      if (k < before) worth += P.cut * (before - k);
      if (k <= 2 && k < before) worth += Math.floor(P.squeeze / Math.max(1, k));
      else if (S0[oc] >= NEVER) worth += P.harass;
    }
    return worth;
  }

  // the keys for kicking or punching a bomb next to it (0: neither), at an enemy, or if it `need`s to just
  // to be safe
  function sendBomb(g, p, cx, cy, here, speed, lead, centred, need) {
    let d = -1;
    if (p.pw[PW.KICK] && centred && (d = kickWorth(g, p, cx, cy, here, speed, lead, need)) >= 0) return reversed(p, KEYS[d]);
    // (facing the bomb, then the punch: the same tick)
    if (p.pw[PW.PUNCH] && !(p.prevIn & IN.ACTION) && (d = punchWorth(g, p, cx, cy, here, speed, lead, need)) >= 0) return reversed(p, KEYS[d]) | IN.ACTION;
    return 0;
  }

  // Kicking a bomb next to it (js/game.js kickBomb, slideBomb): it slides a cell every SLIDE ticks with its
  // fuse running, turned by arrows, and stops short of anything in the way, a player included, so a bomb
  // sent down a corridor at someone goes off by them, or out in the open on the way if the fuse runs out
  // first. Kicks one if that catches or corners an enemy and leaves it safe (or if it `need`s to, any kick
  // that leaves it safe). Returns the direction, or -1.
  function kickWorth(g, p, cx, cy, here, speed, lead, need) {
    let best = -1, bv = need ? -1 : P.layAt;
    for (let d = 0; d < 4; d++) {
      const bx = cx + DX[d], by = cy + DY[d], b = g.bombAtCell(bx, by);
      if (!b || b.motion !== 0 || b.kind !== 0) continue;           // (remote and jelly bombs: not foreseen)
      if (!g.free(bx + DX[d], by + DY[d]) || g.playerAtCell(bx + DX[d], by + DY[d])) continue;
      const c = slideEnd(g, bx, by, d, Math.max(0, b.fuse - b.t));
      if (c === idx(bx, by)) continue;
      moved = b; xCell[0] = c; xRange[0] = b.range; xFuse[0] = slideT; nExtra = 1;
      danger(g, p, S2, E2);
      moved = null; nExtra = 0;
      const m = search(g, cx, cy, speed, lead, S2, E2, distB, prevB, queB, timeB, -1, walk, AB.offX(p.x), AB.offY(p.y));
      if ((S2[here] < NEVER || risk[here]) && !safeCells(S2, risk, queB, m, 1)) continue;
      const v = pressure(g, p, c, null, 0);
      if (v > bv) { bv = v; best = d; }
    }
    return best;
  }
  // where a bomb kicked from (x, y) towards d goes off with t ticks of fuse left, and when (slideT)
  let slideT = 0;
  function slideEnd(g, x, y, d, t) {
    for (let k = 0; k < COLS + ROWS; k++) {
      const ex = g.extras[idx(x, y)];
      if (ex && ex.t === 'arrow') d = ex.dir;
      if ((k + 1) * SLIDE > t) break;
      const x2 = x + DX[d], y2 = y + DY[d];
      if (!g.free(x2, y2) || g.playerAtCell(x2, y2)) break;
      const ex2 = g.extras[idx(x2, y2)];
      if (ex2 && ex2.t === 'warp') break;
      x = x2; y = y2;
      if (g.flameT[idx(x, y)] > 0) { t = (k + 1) * SLIDE; break; }
    }
    slideT = t;
    return idx(x, y);
  }

  // Punching a bomb next to it (js/game.js punchBomb, flyBomb): it flies three cells, then on until it
  // can land, off one edge of the arena and back in at the other, its fuse waiting; landing on a head it
  // stuns them (STUN ticks they can't move, js/game.js bonk) and bounces on. Punches one if that catches or
  // corners an enemy (a stunned one next to the bomb rarely gets away), or if it `need`s to, any punch that
  // leaves it safe. Returns the direction, or -1.
  function punchWorth(g, p, cx, cy, here, speed, lead, need) {
    let best = -1, bv = need ? -1 : P.layAt;
    for (let d = 0; d < 4; d++) {
      const bx = cx + DX[d], by = cy + DY[d], b = g.bombAtCell(bx, by);
      if (!b || (b.motion !== 0 && b.motion !== 1) || b.kind === 1) continue;
      const c = throwEnd(g, bx, by, d);
      if (c < 0) continue;
      moved = b; xCell[0] = c; xRange[0] = b.range; xFuse[0] = throwT + Math.max(0, b.fuse - b.t); nExtra = 1;
      danger(g, p, S2, E2);
      moved = null; nExtra = 0;
      const m = search(g, cx, cy, speed, lead, S2, E2, distB, prevB, queB, timeB, -1, walk, AB.offX(p.x), AB.offY(p.y));
      if ((S2[here] < NEVER || risk[here]) && !safeCells(S2, risk, queB, m, 1)) continue;
      const v = pressure(g, p, c, bonked, bonkT + K.STUN);
      if (v > bv) { bv = v; best = d; }
    }
    return best;
  }
  // where a bomb punched from (x, y) towards d comes down, after how long (throwT), and whose head it
  // bounces off on the way (bonked, bonkT ticks from now)
  let throwT = 0, bonked = null, bonkT = 0;
  function throwEnd(g, x, y, d) {
    const per = (DX[d] ? AB.CW : AB.CH) * FLY;
    bonked = null;
    for (let k = 1; k <= 40; k++) {
      x += DX[d]; y += DY[d];
      if (x >= COLS + 2) x -= COLS + 3; else if (x <= -2) x += COLS + 3;
      if (y >= ROWS + 2) y -= ROWS + 3; else if (y <= -2) y += ROWS + 3;
      if (k < 3 || !AB.inArena(x, y)) continue;
      const c = idx(x, y), ex = g.extras[c];
      if (g.tiles[c] !== 0 || g.brickT[c] > 0 || g.bombAt[c] >= 0 || g.items[c] >= 0 || (ex && ex.t === 'warp')) continue;
      const o = g.playerAtCell(x, y);
      if (o) { if (!bonked && o.special !== 3) { bonked = o; bonkT = Math.ceil(k * per); } continue; }
      throwT = Math.ceil(k * per);
      return c;
    }
    return -1;
  }

  // Where it could corner someone: of the cells a few steps away in line with an enemy, in reach of its
  // blast, the one where a bomb (laid when it gets there) would leave that enemy fewest ways out, while it
  // could still get away itself. Looked at every few ticks (it costs a search or three); the enemy may have
  // moved by the time it's there, so it counts half.
  function findTrap(g, p, n, st, speed) {
    st.trap = -1; st.trapV = 0;
    if (!canBomb(g, p, -1, -1)) return;
    const range = g.flameLen(p), fuse = fuseOf(p);
    let tried = 0;
    for (let q = 1; q < n && tried < 3; q++) {
      const c = queA[q];
      if (distA[c] > 6) continue;               // (que is in order of steps, but for warps)
      if (S0[c] < NEVER || risk[c] || keepOff[c]) continue;
      const x = c % COLS, y = (c - x) / COLS;
      let foe = null;
      for (const o of g.players) {
        if (!enemy(g, p, o)) continue;
        const ex = AB.cellX(o.x), ey = AB.cellY(o.y);
        if ((ex === x || ey === y) && Math.abs(ex - x) + Math.abs(ey - y) <= range && clearLine(g, x, y, ex, ey)) { foe = o; break; }
      }
      if (!foe) continue;
      tried++;
      xCell[0] = c; xRange[0] = range; xFuse[0] = timeA[c] + fuse; nExtra = 1;
      danger(g, p, S2, E2);
      nExtra = 0;
      const m = search(g, x, y, speed, timeA[c], S2, E2, distB, prevB, queB, timeB, -1, walk);
      if (!safeCells(S2, risk, queB, m, 1)) continue;
      const ex = AB.cellX(foe.x), ey = AB.cellY(foe.y);
      const k = safeCells(S2, null, queB, search(g, ex, ey, g.speedOf(foe), waitOf(foe), S2, E2, distB, prevB, queB, timeB, c, 0, AB.offX(foe.x), AB.offY(foe.y)), 3);
      const v = Math.floor((k === 0 ? P.kill : k <= 2 ? Math.floor(P.squeeze / k) : 0) / 2);
      if (v > st.trapV) { st.trapV = v; st.trap = c; }
    }
  }
  // nothing solid or brick between two cells in a row or column
  function clearLine(g, x0, y0, x1, y1) {
    const dx = Math.sign(x1 - x0), dy = Math.sign(y1 - y0);
    for (let x = x0 + dx, y = y0 + dy; x !== x1 || y !== y1; x += dx, y += dy) if (g.tiles[idx(x, y)] !== 0) return false;
    return true;
  }

  // what bombing from cell c would do, roughly (bricks it breaks, enemies in its blast), if it could get
  // out of the blast's way to a safe cell (or a warp hole) within `depth` steps; 0 if not. Fills arm[]
  // with the blast.
  function spotWorth(g, p, c, range, depth, keen, greed) {
    const x = c % COLS, y = (c - x) / COLS;
    let bricks = 0;
    for (let d = 0; d < 4; d++) {
      let l = 0, x2 = x, y2 = y;
      for (; l < range; l++) {
        x2 += DX[d]; y2 += DY[d];
        if (!AB.inArena(x2, y2)) break;
        const c2 = idx(x2, y2), t = g.tiles[c2];
        if (t === 1) break;
        if (t === 2) { if (g.brickT[c2] <= 0 && S0[c2] >= NEVER) bricks++; l++; break; }
        if (g.bombAt[c2] >= 0 || g.items[c2] >= 0) { l++; break; }
      }
      arm[d] = l;
    }
    let caught = 0;
    for (const o of g.players) if (enemy(g, p, o) && inBlast(c, AB.cellX(o.x), AB.cellY(o.y))) caught++;
    if (!bricks && !caught) return 0;
    // a way out of the blast: breadth-first from c (where the bomb would be) to a cell outside it
    if (++stampC >= 0x7fffffff) { stampC = 1; seenC.fill(0); }
    seenC[c] = stampC; distC[c] = 0; queC[0] = c;
    let n = 1, out = false;
    for (let h = 0; h < n && !out; h++) {
      const c1 = queC[h], x1 = c1 % COLS, y1 = (c1 - x1) / COLS;
      if (distC[c1] >= depth) continue;
      for (let k = 0; k < 4; k++) {
        const x2 = x1 + DX[k], y2 = y1 + DY[k];
        if (!g.free(x2, y2)) continue;
        const c2 = idx(x2, y2);
        if (seenC[c2] === stampC || S0[c2] < NEVER || (keepOff[c2] & walk & ~AMBUSH)) continue;
        if (warpTo[c2] >= 0) { if (!(keepOff[warpTo[c2]] & AMBUSH)) { out = true; break; } continue; }
        seenC[c2] = stampC; distC[c2] = distC[c1] + 1; queC[n++] = c2;
        if (!risk[c2] && !inBlast(c, x2, y2)) { out = true; break; }
      }
    }
    return out ? Math.floor(bricks * P.spot * greed / 100) + caught * P.hunt * keen : 0;
  }
  // is (x2, y2) in the blast spotWorth() last measured from cell c?
  function inBlast(c, x2, y2) {
    const x = c % COLS, y = (c - x) / COLS;
    if (x2 === x) return y2 === y || (y2 < y ? y - y2 <= arm[0] : y2 - y <= arm[2]);
    if (y2 === y) return x2 > x ? x2 - x <= arm[1] : x - x2 <= arm[3];
    return false;
  }

  // where to go when nothing threatens it: power-ups, places to bomb from, enemies to corner, room to move;
  // keeping clear of anyone with a disease, and late in the round, of the cells the closing walls will
  // fill, getting between the enemies out there and the middle
  function pickGoal(g, p, n, st, here, tried) {
    const range = g.flameLen(p);
    const depth = Math.max(1, Math.floor((fuseOf(p) - 30) * Math.max(100, g.speedOf(p)) / (AB.CW * AB.SUB)));
    const walls = wallRings(g), late = P.lateAt ? walls : 0, greed = greedOf(g), well = P.sick && !(p.disT > 0);
    const era = (g.tick / 120) | 0, bombs = canBomb(g, p, -1, -1);
    let foes = 0;
    for (const o of g.players) if (enemy(g, p, o)) foes++;
    const keen = foes === 1 || (g.timeLeft >= 0 && g.timeLeft < 45 * AB.TPS) ? P.endgame : 1;
    let best = -1, bs = -NEVER;
    for (let q = 0; q < n && q < 90; q++) {
      const c = queA[q];
      if (S0[c] < NEVER || risk[c]) continue;
      const x = c % COLS, y = (c - x) / COLS;
      let sc = -distA[c] * P.far;
      const it = g.items[c];
      if (it >= 0) sc += Math.floor(P.item * itemWorth(g, p, it) * greed / 10000);
      if (bombs && !(c === here && tried) && !(keepOff[c] & WARP)) sc += spotWorth(g, p, c, range, depth, keen, greed);
      let open = 0, foe = false, cut = false;
      for (let d = 0; d < 4; d++) if (g.free(x + DX[d], y + DY[d])) open++;
      for (const o of g.players) {
        if (o === p || !o.alive) continue;
        const ox = AB.cellX(o.x), oy = AB.cellY(o.y), dd = Math.abs(ox - x) + Math.abs(oy - y);
        const sick = well && o.disT > 0;
        if (sick && dd <= 2) sc -= P.sick;
        if (!enemy(g, p, o)) continue;
        if (dd < 4 && !sick) sc += (4 - dd) * P.near * keen;
        if (dd <= 5) foe = true;
        if (late && dd <= 3 && ringOf[idx(ox, oy)] < late && ringOf[c] >= late) cut = true;
      }
      if (cut) sc += P.inner;
      if (open < 2 && foe) sc -= P.deadEnd;
      if (S1[c] < NEVER && open <= 2) sc -= P.exposed;
      const ex = g.extras[c];
      if (ex && ex.t === 'conveyor') sc -= P.conveyor;
      sc -= Math.floor(crowd(g, p, c) * P.crowd);
      if (c === st.target) sc += P.stick;
      if (c === st.trap) sc += st.trapV;
      if (walls && ringOf[c] < walls) sc -= P.walls;
      sc += ((Math.imul(c + 1, 2654435761) ^ Math.imul(p.slot + 7, 40503) ^ Math.imul(era + 1, 69069)) >>> 0) % (P.jitter + 1);
      if (sc > bs) { bs = sc; best = c; }
    }
    return best;
  }

  // the keys for heading to `goal` (as js/ai.js: it keeps on into the neighbouring cell it set off for
  // until it's centred there, so it doesn't dither on cell borders when the plan flips between ticks)
  function steer(g, p, st, goal, here, cx, cy, ox, oy, centred) {
    const fleeing = S0[here] < NEVER || risk[here];
    const planned = goal >= 0 && goal !== here ? firstStep(prevA, here, goal) : -1;
    if (st.moveTo >= 0) {
      const mt = st.moveTo, mx = mt % COLS, my = (mt - mx) / COLS;
      const deadly = S0[mt] <= 20 && E0[mt] > 0;
      const adjacent = Math.abs(mx - cx) + Math.abs(my - cy) === 1;
      const conflict = fleeing && mt !== planned && mt !== here && (S0[mt] < NEVER || risk[mt]);
      if (deadly || conflict || !g.free(mx, my) || (!adjacent && mt !== here) || (mt === here && centred) || g.tick - st.moveT > 90) st.moveTo = -1;
      else if (mt === here) {
        const k = recentre(ox, oy);
        if (k) return k;
        st.moveTo = -1;
      } else return KEYS[dirTo(cx, cy, mt)];
    }
    if (planned >= 0) { st.moveTo = planned; st.moveT = g.tick; return KEYS[dirTo(cx, cy, planned)]; }
    return centred ? 0 : recentre(ox, oy);
  }
  function dirTo(cx, cy, c) { const x = c % COLS, y = (c - x) / COLS; return x > cx ? 1 : x < cx ? 3 : y > cy ? 2 : 0; }
  function recentre(ox, oy) { return ox > 2 ? IN.LEFT : ox < -2 ? IN.RIGHT : oy > 2 ? IN.UP : oy < -2 ? IN.DOWN : 0; }
  // Reversed Controls turn every direction round: press the opposite way, to go the way it means
  function reversed(p, bits) {
    if (!(p.disT > 0 && p.dis[DIS.REVERSED])) return bits;
    return (bits & ~(IN.UP | IN.DOWN | IN.LEFT | IN.RIGHT)) | (bits & IN.UP ? IN.DOWN : 0) | (bits & IN.DOWN ? IN.UP : 0) | (bits & IN.LEFT ? IN.RIGHT : 0) | (bits & IN.RIGHT ? IN.LEFT : 0);
  }

  AB.AI.dangerous = think;
  AB.AI.dangerousParams = P;
  AB.AI.dangerousSeen = seen;
})(window.AB);
