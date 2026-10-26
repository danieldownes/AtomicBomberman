// The Original computer player: the 1997 game's own AI, ported from BM95.EXE. It follows the decompiled
// code (decompiled/BM95_decompiled.c), checked against the executable's machine code where the decompile
// loses what was passed in registers; each function below names the one it ports (fcn.0040xxxx), so the
// two read side by side.
//
// Once a frame, for each computer player (fcn.0041f29b, the player update), the game sets the player's
// direction to "none" and lets go of its buttons (remembering last frame's, so a press is only new if they
// were up), and fcn.0040a1c6 notes the cell it is in, then tries its behaviours in a fixed order until one
// acts. The order is a table in the executable's data, at 0x45ba78 (the decompiled C hasn't got it):
//   1 fcn.0040bd44  the blue glove: throw the bomb it carries; pick up its own bomb (1 in 2)
//   2 fcn.0040be02  the boxing glove: punch a bomb next to it (1 in 4)
//   3 fcn.0040b20f  in danger, run for the least dangerous cell in reach; out of it, now and then fire its
//                   remote bombs (1 in 10), and stay put if no cell next to it is safe to step into
//   4 fcn.0040ad8d  next to a brick: drop a bomb (1 in VALUELST #915)
//   5 fcn.0040abed  someone on or next to it: drop a bomb (1 in 5), unless it's near where it started
//   6 fcn.0040baf5  now and then (1 in 50) go for a power-up within #920 steps
//   7 fcn.0040b8c2  now and then (1 in 50) go after a player, people before computers
//   8 fcn.0040a81f  wander, turning now and then (1 in 25)
// It drops a bomb without looking for a way out (fcn.00423188 only asks if the cell can take one) and
// counts on running afterwards. The executable has three more behaviours that the table leaves out
// (fcn.0040a628, fcn.0040a994, fcn.0040b594); they aren't ported.
//
// The port: the original thinks once a frame, as fast as the PC draws, and its timing is in 20 fps
// "reference frames" (VALUELST #30); this thinks once a reference frame (every AB.TPR ticks), and its keys
// stay down in between. Its random numbers come from the game's own generator (the original's come from
// the C library's rand()), so every computer in a network game makes the same moves for it.
'use strict';
(function (AB) {
  const { COLS, ROWS, DX, DY, IN, PW, DIS } = AB;
  const N = COLS * ROWS;
  const idx = (x, y) => y * COLS + x;
  const KEYS = [IN.UP, IN.RIGHT, IN.DOWN, IN.LEFT];
  const FRAME_MS = Math.round(1000 * AB.TPR / AB.TPS);    // a reference frame: 1000 / VALUELST #30 = 50 ms
  // the cells fcn.0040abed looks at for someone to bomb: left, up, its own, down, right (0x45bab0, 0x45ba9c)
  const NEAR_X = [-1, 0, 0, 0, 1], NEAR_Y = [0, -1, 0, 1, 0];

  // ---------------------------------------------------------------- the board, as the AI asks about it
  const tile = (g, x, y) => g.tile(x, y);                          // fcn.00425fb9: 0 floor, 1 solid, 2 brick
  const bombAt = (g, x, y) => g.bombAtCell(x, y);                  // fcn.00422e48
  const burning = (g, x, y) => AB.inArena(x, y) && g.flameT[idx(x, y)] > 0;     // fcn.0042708d: a flame there
  const itemAt = (g, x, y) => AB.inArena(x, y) && g.items[idx(x, y)] >= 0;      // fcn.0042542d
  // fcn.00423188: can a bomb go here? (no bomb, no warp hole, floor)
  function canDrop(g, x, y) {
    if (bombAt(g, x, y)) return false;
    const ex = AB.inArena(x, y) && g.extras[idx(x, y)];
    if (ex && ex.t === 'warp') return false;
    return tile(g, x, y) === 0;
  }
  // fcn.0040a59d: safe to step into: no bomb, floor, not burning, and no danger
  const safeStep = (g, x, y) => !bombAt(g, x, y) && tile(g, x, y) === 0 && !burning(g, x, y) && danger(x, y) === 0;

  // The danger grid (fcn.00424d37 reads it, fcn.00424dfe raises a cell to a value, never lowers it). Each
  // frame the game clears it (fcn.0042331c) and marks it again:
  //   - every bomb, its cell and its arms out to its range, stopping before a wall, a brick or another bomb
  //     and after a power-up: 100 + the milliseconds since it was laid (a dud starts below 0; a remote bomb
  //     stays at 0), so the sooner a bomb goes off, the higher (fcn.0042331c);
  //   - every flame: 1000 (fcn.00426fcc, fcn.00426d06);
  //   - the next #910 blocks of the closing walls: 250, 240, 230... (fcn.00426818).
  const grid = new Int32Array(N);
  let gridGame = null;
  function danger(x, y) { return AB.inArena(x, y) ? grid[idx(x, y)] : 0; }
  function raise(x, y, v) { if (AB.inArena(x, y) && v > grid[idx(x, y)]) grid[idx(x, y)] = v; }
  function markDanger(g) {
    if (gridGame === g && g._originalKey === g.tick) return;
    gridGame = g; g._originalKey = g.tick;
    grid.fill(0);
    const ms = (ticks) => Math.floor(ticks * 1000 / AB.TPS);
    for (const b of g.bombs) {
      if (!b || b.dead) continue;
      const v = 100 + (b.kind === 1 ? 0 : ms(b.t - Math.max(0, b.fuse - AB.K.FUSE)));   // (a dud's extra wait first)
      const cx = AB.cellX(b.x), cy = AB.cellY(b.y);
      raise(cx, cy, v);
      for (let d = 0; d < 4; d++) {
        let x = cx, y = cy;
        for (let m = 1; m <= b.range; m++) {
          x += DX[d]; y += DY[d];
          if (tile(g, x, y) !== 0 || bombAt(g, x, y)) break;
          raise(x, y, v);
          if (itemAt(g, x, y)) break;
        }
      }
    }
    for (let c = 0; c < N; c++) if (g.flameT[c] > 0 && grid[c] < 1000) grid[c] = 1000;
    const e = g.enc;
    if (e && !e.done) {
      const ahead = AB.val(910, 15);
      let x = e.x, y = e.y, dir = e.dir, ring = e.ring;
      for (let k = 0; k < ahead; k++) {
        raise(x, y, 100 + 10 * (ahead - k));
        // on along the spiral (as js/game.js encAdvance)
        for (let guard = 0; guard < 8; guard++) {
          const nx = x + DX[dir], ny = y + DY[dir];
          if (nx >= COLS - ring || ny >= ROWS - ring || nx < ring || ny < ring + (dir === 0 ? 1 : 0)) {
            dir = (dir + 1) & 3;
            if (dir === 1) { ring++; x = ring; y = ring; break; }
            continue;
          }
          x = nx; y = ny; break;
        }
        if (ring >= e.depth || ring * 2 >= ROWS) break;
      }
    }
  }

  // ---------------------------------------------------------------- the searches
  // fcn.004092a1 (to a cell), fcn.0040970b (to the least dangerous cell), fcn.00409c1f (to a power-up).
  // A pool of 100 walkers (0x45ed68, 24 bytes each). One starts on each open cell next to the start,
  // heading away from it and remembering which of the four it was (its first step, 1-4). Each pass, every
  // walker marks its cell visited, sends a new walker each way to its sides that's open (the side tried
  // first is picked at random for the whole search) and steps on ahead; one that steps into a wall, a
  // brick, a bomb or a visited cell stops. A walker sent to a later place in the pool waits a pass, so all
  // move a cell a pass, and the first to find what's wanted came the shortest way: its first step is the
  // way to go. The walls, bricks and bombs come from fcn.004090e7 (once a frame), copied afresh for each
  // search (fcn.004091a0); outside the arena counts as blocked (fcn.00409083).
  const POOL = 100;
  const on = new Uint8Array(POOL), wx = new Int16Array(POOL), wy = new Int16Array(POOL);
  const first = new Int8Array(POOL), head = new Int8Array(POOL), wait = new Int8Array(POOL);
  const base = new Uint8Array(N), seen = new Uint8Array(N);
  let baseGame = null;
  function markBlocked(g) {
    if (baseGame === g && g._originalBase === g.tick) return;
    baseGame = g; g._originalBase = g.tick;
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) base[idx(x, y)] = tile(g, x, y) !== 0 || bombAt(g, x, y) ? 1 : 0;
  }
  const blocked = (x, y) => !AB.inArena(x, y) || seen[idx(x, y)] === 1;
  const visit = (x, y) => { if (AB.inArena(x, y)) seen[idx(x, y)] = 1; };
  function walker() { for (let k = 0; k < POOL; k++) if (!on[k]) return k; return -1; }   // fcn.004091c9

  // what a search found: the first step (1-4, 0: none), passes taken, and the cell or power-up
  let foundFirst = 0, passes = 0, bestX = 0, bestY = 0;
  const TO_CELL = 0, LEAST_DANGER = 1, TO_ITEM = 2;
  function search(g, sx, sy, what, tx, ty, most) {
    const turn = g.rng.int(2) * 2 - 1;
    seen.set(base);
    on.fill(0);
    foundFirst = 0; passes = 0; bestX = sx; bestY = sy;
    if (what === TO_CELL && sx === tx && sy === ty) return 0;
    let best = 10000, bestFirst = 0;
    // has the walker with first step f found it at (x, y)? (fcn.0040970b keeps the least dangerous cell
    // so far and is done at a safe one)
    const found = (x, y, f) => {
      if (what === TO_CELL) return x === tx && y === ty;
      if (what === TO_ITEM) return itemAt(g, x, y) && ((bestX = x), (bestY = y), true);
      const v = danger(x, y);
      if (v < best) { best = v; bestX = x; bestY = y; bestFirst = f; return v === 0; }
      return false;
    };
    for (let d = 0; d < 4; d++) {
      const x = sx + DX[d], y = sy + DY[d];
      if (blocked(x, y)) continue;
      const k = walker();
      if (k < 0) break;
      on[k] = 1; wx[k] = x; wy[k] = y; first[k] = d + 1; head[k] = d; wait[k] = 1;
    }
    for (;;) {
      let live = 0;
      for (let k = 0; k < POOL; k++) {
        if (!on[k]) continue;
        live++;
        if (wait[k] === 2) { wait[k] = 1; continue; }
        const dead = wait[k] === 0 && blocked(wx[k], wy[k]);
        wait[k] = 0;
        if (!blocked(wx[k], wy[k]) && found(wx[k], wy[k], first[k])) return (foundFirst = first[k]);
        if (!dead) visit(wx[k], wy[k]);
        for (let l = -1; l <= 1; l += 2) {
          const h = (turn * l + head[k]) & 3, x = wx[k] + DX[h], y = wy[k] + DY[h];
          if (blocked(x, y)) continue;
          if (found(x, y, first[k])) return (foundFirst = first[k]);
          const j = walker();
          if (j < 0) continue;
          live++;
          on[j] = 1; wx[j] = x; wy[j] = y; first[j] = first[k]; head[j] = h; wait[j] = j > k ? 2 : 1;
          visit(x, y);
        }
        const x = wx[k] + DX[head[k]], y = wy[k] + DY[head[k]];
        if (!blocked(x, y) && found(x, y, first[k])) return (foundFirst = first[k]);
        if (dead || blocked(x, y)) on[k] = 0;
        wx[k] = x; wy[k] = y;
      }
      passes++;
      if (passes > most) live = 0;
      if (!live) return (foundFirst = what === LEAST_DANGER ? bestFirst : 0);
    }
  }

  // ---------------------------------------------------------------- the behaviours
  // Each sets what it wants this frame in st (dir: 0-3 or -1, bomb / action: pressed; fresh: a press that
  // counts even if the button was down last frame, as the original's clearing last frame's button does)
  // and returns true if it acted.

  // 1 fcn.0040bd44: with the blue glove, throw the bomb it carries (let go of the button); standing on a
  // bomb of its own, pick it up (1 in 2)
  function glove(g, p, st, cx, cy) {
    if (!p.pw[PW.GRAB]) return false;
    if (p.held >= 0) { st.bomb = false; return true; }
    const b = bombAt(g, cx, cy);
    if (b && b.owner === p.slot && g.rng.int(2) !== 0) { st.bomb = true; st.fresh |= IN.BOMB; return true; }
    return false;
  }
  // 2 fcn.0040be02: with the boxing glove, punch the first bomb next to it (up, right, down, left), 1 in 4
  function punch(g, p, st, cx, cy) {
    if (!p.pw[PW.PUNCH] || g.rng.int(4) !== 0) return false;
    for (let d = 0; d < 4; d++) {
      if (!bombAt(g, cx + DX[d], cy + DY[d])) continue;
      st.dir = d; st.action = true; st.fresh |= IN.ACTION;
      return true;
    }
    return false;
  }
  // fcn.0040a76e: don't step into a flame
  function stepCheck(g, st, cx, cy) {
    if (st.dir >= 0 && st.dir <= 3 && burning(g, cx + DX[st.dir], cy + DY[st.dir])) st.dir = -1;
  }
  // 3 fcn.0040b20f: in danger, keep making for the place it chose (if that was safe and still is), or
  // choose the least dangerous cell within 20 steps; if that's no less dangerous than here, stay. Out of
  // danger: with remote bombs (and no boxing glove, whose button it would press), fire them now and then;
  // and if there's no safe cell next to it to step into, stay put.
  function flee(g, p, st, cx, cy) {
    if (danger(cx, cy)) {
      if (st.fleeing && !st.fleeDanger && danger(st.fleeX, st.fleeY)) st.fleeing = 0;
      if (st.fleeing) {
        if (!search(g, cx, cy, TO_CELL, st.fleeX, st.fleeY, 20)) { st.fleeing = 0; return false; }
        st.dir = foundFirst - 1;
        stepCheck(g, st, cx, cy);
        return st.dir !== -1;
      }
      if (!search(g, cx, cy, LEAST_DANGER, 0, 0, 20)) { st.fleeing = 0; return false; }
      st.fleeing = 1;
      if (danger(cx, cy) <= danger(bestX, bestY)) { st.fleeX = cx; st.fleeY = cy; st.dir = -1; return true; }
      st.fleeX = bestX; st.fleeY = bestY; st.fleeDanger = danger(bestX, bestY);
      st.dir = foundFirst - 1;
      stepCheck(g, st, cx, cy);
      return st.dir !== -1;
    }
    if (p.pw[PW.TRIGGER] && !p.pw[PW.PUNCH] && g.rng.int(10) === 0) st.action = true;
    for (let d = 0; d < 4; d++) if (safeStep(g, cx + DX[d], cy + DY[d])) { st.fleeing = 0; return false; }
    st.fleeing = 0;
    return true;
  }
  // 4 fcn.0040ad8d: a bomb to spare, not constipated, a brick next to it, the cell can take a bomb: drop
  // one, 1 in #915
  function bricks(g, p, st, cx, cy) {
    if (g.bombsOut(p) >= g.maxBombs(p) || p.dis[DIS.CONSTIPATION]) return false;
    let n = 0;
    for (let d = 0; d < 4; d++) if (tile(g, cx + DX[d], cy + DY[d]) === 2) n++;
    if (!n || !canDrop(g, cx, cy) || g.rng.int(Math.max(1, AB.val(915, 5))) !== 0) return false;
    st.bomb = true; st.fresh |= IN.BOMB;
    return true;
  }
  // 5 fcn.0040abed: a bomb to spare, three cells or more from where it started (or last warped to: player
  // +0x14), and someone on its cell or next to it: unless they're on its team or the cell can't take a
  // bomb, drop one, 1 in 5. (It looks at the first such player only.)
  function attack(g, p, st, cx, cy) {
    if (g.bombsOut(p) >= g.maxBombs(p)) return false;
    const hx = st.home % COLS, hy = (st.home - hx) / COLS;
    if (Math.abs(cx - hx) + Math.abs(cy - hy) < 3) return false;
    for (let k = 0; k < 5; k++) {
      const o = g.playerAtCell(cx + NEAR_X[k], cy + NEAR_Y[k], p);
      if (!o) continue;
      if (g.S.teamPlay && o.team === p.team) return false;
      if (!canDrop(g, cx, cy) || g.rng.int(5) !== 0) return false;
      st.bomb = true; st.fresh |= IN.BOMB;
      return true;
    }
    return false;
  }
  // 6 fcn.0040baf5: now and then (1 in 50), look for a power-up (any kind, diseases too) within #920
  // steps and go for it, a step at a time while the next cell is safe. It gives up when the power-up has
  // gone, when there's no way to it, or after 10 reference frames of trying. (In the original, starting
  // afresh clears the chase's timer, 0x45ed70+0xc, where it means its own, +0x1c; so its time runs out for
  // good after half a second of going for power-ups in a round. Kept: that's how it played.)
  function powerUp(g, p, st, cx, cy) {
    const near = AB.val(920, 4);
    if (!st.seeking && g.rng.int(50) === 0) {
      search(g, cx, cy, TO_ITEM, 0, 0, near);
      if (foundFirst && near + 1 >= passes) { st.seeking = 1; st.chaseT = 0; st.item = idx(bestX, bestY); }
    }
    if (!st.seeking) return false;
    st.seekT += FRAME_MS;
    if (st.seekT >= 10 * FRAME_MS || g.items[st.item] < 0) { st.seeking = 0; return false; }
    const ix = st.item % COLS, iy = (st.item - ix) / COLS;
    search(g, cx, cy, TO_CELL, ix, iy, near + 1);
    if (!passes && g.rng.int(2) !== 0) st.seeking = 0;
    if (!foundFirst) { st.seeking = 0; return false; }
    st.seekDir = foundFirst - 1;
    st.dir = safeStep(g, cx + DX[st.seekDir], cy + DY[st.seekDir]) ? st.seekDir : -1;
    return true;
  }
  // 7 fcn.0040b8c2: now and then (1 in 50), pick a player to go after (fcn.00422718) and head for their
  // cell, a step at a time while the next cell is safe. After 10 reference frames it may give up (1 in 50
  // a frame); it does when they're out of the round or out of reach (20 steps).
  function chase(g, p, st, cx, cy) {
    if (!st.chasing && g.rng.int(50) === 0) {
      const o = target(g, p);
      if (o) { st.chasing = 1; st.chaseT = 0; st.chaseWho = o.slot; }
    }
    if (!st.chasing) return false;
    st.chaseT += FRAME_MS;
    if (st.chaseT >= 10 * FRAME_MS && g.rng.int(50) === 0) { st.chasing = 0; return false; }
    const o = g.pById(st.chaseWho);
    if (!o || !o.alive) { st.chasing = 0; return false; }
    search(g, cx, cy, TO_CELL, AB.cellX(o.x), AB.cellY(o.y), 20);
    if (!passes && g.rng.int(2) !== 0) st.chasing = 0;
    if (!foundFirst) { st.chasing = 0; return false; }
    st.chaseDir = foundFirst - 1;
    st.dir = safeStep(g, cx + DX[st.chaseDir], cy + DY[st.chaseDir]) ? st.chaseDir : -1;
    return true;
  }
  // fcn.00422718: someone to go after: from a slot picked at random, the first other player still in,
  // not on its team, that a person controls; failing that, a computer player
  function target(g, p) {
    for (let pass = 0; pass < 2; pass++) {
      for (let n = 0, s = g.rng.int(10); n < 10; n++, s = (s + 1) % 10) {
        const o = g.players[s];
        if (!o || o === p || !o.alive || (pass === 0 && o.isAI)) continue;
        if (!g.S.teamPlay || o.team !== p.team) return o;
      }
    }
    return null;
  }
  // 8 fcn.0040a81f: walk on the way it's going; now and then (1 in 25) turn left or right (only when the
  // way ahead is clear: so it is in the original); if the next cell isn't safe, pick a way at random for
  // next time and stand
  function wander(g, p, st, cx, cy) {
    if (g.rng.int(25) === 0) {
      const turn = (g.rng.int(2) * 2 + st.wanderDir - 1) & 3;
      if (safeStep(g, cx + DX[st.wanderDir], cy + DY[st.wanderDir])) st.wanderDir = turn;
    }
    if (safeStep(g, cx + DX[st.wanderDir], cy + DY[st.wanderDir])) { st.dir = st.wanderDir; return true; }
    st.wanderDir = g.rng.int(4);
    return false;
  }
  const TABLE = [glove, punch, flee, bricks, attack, powerUp, chase, wander];       // 0x45ba78

  // ---------------------------------------------------------------- a frame
  function think(g, p) {
    const st = p.ai || (p.ai = {});
    if (st.wanderDir === undefined) {
      Object.assign(st, { wanderDir: 0, home: idx(AB.cellX(p.x), AB.cellY(p.y)), keys: 0, fleeing: 0, fleeX: 0, fleeY: 0, fleeDanger: 0,
        chasing: 0, chaseT: 0, chaseWho: -1, chaseDir: 0, seeking: 0, seekT: 0, item: -1, seekDir: 0 });
    }
    if (!p.alive) return 0;
    // warping: where it comes out counts as where it started (player +0x14, fcn.0041f29b)
    if (p.special === 6 && p.warp) st.home = p.warp.dest;
    // no thinking on a trampoline or in a warp; picking up a bomb, the button stays down for #665 frames
    if (p.special === 5 || p.special === 6 || p.special === 7) return (st.keys = 0);
    if (p.special === 4 && p.specialT <= AB.K.PICKUP_PAUSE) return (st.keys = IN.BOMB);
    if (g.tick % AB.TPR !== 0) return turnRound(p, st.keys);
    // a new frame: no direction, buttons up (fcn.0041f29b), then the behaviours in turn (fcn.0040a1c6)
    markBlocked(g);
    markDanger(g);
    const cx = AB.cellX(p.x), cy = AB.cellY(p.y);
    st.dir = -1; st.bomb = false; st.action = false; st.fresh = 0;
    for (const behaviour of TABLE) if (behaviour(g, p, st, cx, cy)) break;
    // a fresh press counts even if the button was down last frame: the original clears last frame's
    // button; here the simulation's record of it (p.prevIn)
    p.prevIn &= ~st.fresh;
    st.keys = (st.dir >= 0 ? KEYS[st.dir] : 0) | (st.bomb ? IN.BOMB : 0) | (st.action ? IN.ACTION : 0);
    return turnRound(p, st.keys);
  }
  // Reversed Controls don't touch the original's computer players (fcn.0041f29b turns only the others'
  // directions round); the port's simulation turns everyone's, so it presses the opposite way
  function turnRound(p, bits) {
    if (!(p.disT > 0 && p.dis[DIS.REVERSED])) return bits;
    return (bits & ~(IN.UP | IN.DOWN | IN.LEFT | IN.RIGHT)) | (bits & IN.UP ? IN.DOWN : 0) | (bits & IN.DOWN ? IN.UP : 0) | (bits & IN.LEFT ? IN.RIGHT : 0) | (bits & IN.RIGHT ? IN.LEFT : 0);
  }

  AB.AI.original = think;
})(window.AB);
