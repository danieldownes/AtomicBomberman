// Atomic Bomberman HTML5 port - deterministic game simulation.
//
// The simulation is a pure function of (settings, seed, per-tick inputs): it never reads the clock,
// the DOM or Math.random. That makes it suitable for rollback network play (see js/net.js).
// Mechanics follow the original BM95.EXE (decompiled with angr/radare2) and its VALUELST.RES values:
//   - movement in 1-pixel steps with perpendicular auto-centering and corner sliding (fcn.0041ec84)
//   - multi-direction input prefers open directions (fcn.0041e61e)
//   - kick (#300 speed), punch/throw (#301 speed, #660/#661 arcs), stop-kicked-bomb on ACTION
//   - trigger bombs detonate oldest first (fcn.00424b41)
//   - enclosement spiral, one block every 250 ms after HURRY (fcn.00426818)
//   - diseases spread on contact, last #130 frames, may be cured by new powerups (#124/#125)
'use strict';
(function (AB) {
  const { COLS, ROWS, CW, CH, DX, DY, TPR, SUB } = AB;
  const N = COLS * ROWS;
  const T_BLANK = 0, T_SOLID = 1, T_BRICK = 2;
  const PW = AB.PW, DIS = AB.DIS;
  const V = AB.val;
  const R = (frames) => Math.round(frames * TPR);        // reference frames -> ticks

  const K = {
    FUSE: R(V(41, 40)),
    FLAME: R(V(10, 10)),
    BRICK: R(V(20, 10)),
    START_SPEED: V(42, 923),
    SKATE: V(90, 150),
    CLOG: V(91, 150),
    KICK_SPEED: V(300, 1000),
    PUNCH_SPEED: V(301, 1300),
    ARC1: V(660, 65), ARC2: V(661, 20),
    DIS_TIME: R(V(130, 300)),
    DIS_FRESH: R(V(129, 10)),
    OUTSURVIVE: R(V(25, 20)),
    HURRY: V(101, 60),
    NOPOWER_EARLY: V(102, 40),
    TRAMP: R(V(680, 30)), TRAMP_DY: V(681, 35),
    PICKUP_PAUSE: R(V(665, 2)),
    LOSE_MIN: V(670, 1), LOSE_RND: V(671, 3),
    JELLY_TURN: V(667, 3),
    STUN: R(16),                                  // fcn.00421f7e sets 16 frames
    ENCLOSE_EVERY: Math.round(250 * AB.TPS / 1000),
    WARP: R(8),
    TAUNT: V(95, 5),
    CURE_CHANCE: V(125, 10),
    MANY_BOMBS: V(651, 4), MANY_BOMBS_CHANCE: V(650, 4),
    DUD_MIN: V(320, 180) * AB.TPS, DUD_RND: V(321, 180) * AB.TPS, DUD_CHANCE: V(322, 3),
    DUD_WAIT: R(V(323, 120)), DUD_WAIT_RND: R(V(324, 200)),
    ANGEL_DY: V(106, 4),
  };
  AB.K = K;
  const LIMITS = []; for (let i = 0; i < 15; i++) LIMITS.push(V(550 + i, 0));
  const START = []; for (let i = 0; i < 15; i++) START.push(V(50 + i, 0));
  const PW_AMOUNT = []; for (let i = 0; i < 13; i++) PW_AMOUNT.push(V(400 + i, 0));

  const idx = (x, y) => y * COLS + x;

  const STATE_SKIP = new Set(['cfg', 'S', 'scheme', 'rng', 'events', 'camp']);
  class Game {
    // cfg: {settings, scheme(obj), level, seed, players:[{slot,color,team,ai:boolean,name}], match:{wins:[],kills:[]}}
    constructor(cfg) {
      this.cfg = cfg;
      this.S = cfg.settings;
      this.rng = new AB.Rng(cfg.seed);
      this.tick = 0;
      this.level = cfg.level;
      this.scheme = cfg.scheme;
      this.tiles = new Uint8Array(N);
      this.brickT = new Int16Array(N);          // >0 while a brick disintegrates
      this.hidden = new Int8Array(N).fill(-1);  // powerup hidden under a brick
      this.items = new Int8Array(N).fill(-1);   // powerup lying on the floor
      this.itemSafe = new Int16Array(N);        // ticks a revealed item is immune to the flame that revealed it
      this.flameT = new Int16Array(N);          // remaining flame ticks per cell
      this.flameKind = new Array(N).fill(null); // 'center' | 'midnorth' | 'tipwest' ...
      this.flameOwner = new Int8Array(N).fill(-1);
      this.flameColor = new Int8Array(N);
      this.flameGold = new Uint8Array(N);
      this.bombs = [];
      this.bombAt = new Int16Array(N).fill(-1); // cell -> bomb index (ground bombs only)
      this.extras = new Array(N).fill(null);
      this.events = [];
      this.nextBombId = 1;
      this.players = [];
      this.timeLeft = this.S.playTime > 0 ? this.S.playTime * AB.TPS : -1;
      this.hurry = false; this.hurryShown = 0;
      this.enc = null;               // enclosement spiral state
      // round-start countdown (3, 2, 1) with the arena's name: nothing moves until it's over
      // (S.countdown is set by the match screens from the Options setting; a bare Game doesn't count down)
      this.startDelay = this.S.countdown === true && !(cfg.match && cfg.match.demo) ? 3 * AB.TPS : 0;
      this.state = 'play';            // play | ending | over
      this.endTimer = 0;
      this.result = null;
      this.dudTimer = K.DUD_MIN + this.rng.int(K.DUD_RND);
      this.dudPending = false;
      this.regen = V(340 + this.level, 0) * AB.TPS;
      this.regenTimer = this.regen;
      // the original delays the controls on the Hockey Rink by VALUELST #452 ms ("ice"); the port leaves that out
      this.conveyorSpeed = V(190 + (this.S.conveyorSpeed | 0), 350);
      this.camp = cfg.campaign || null;     // campaign stage: {rovers, roverSpeed, ghosts, ghostSpeed}
      this.aliens = [];
      this.build(cfg.players);
      if (this.camp) this.spawnAliens();
    }

    ev(e) { this.events.push(e); }
    snd(lo, hi) { this.events.push({ t: 'snd', lo, hi: hi === undefined ? lo : hi }); }

    // ------------------------------------------------------------------ setup
    build(plist) {
      const sc = this.scheme, rng = this.rng;
      // tiles from the scheme
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        const ch = (sc.rows[y] || '')[x] || '.';
        this.tiles[idx(x, y)] = ch === '#' ? T_SOLID : ch === ':' ? (rng.int(100) < sc.density ? T_BRICK : T_BLANK) : T_BLANK;
      }
      // starting positions
      let starts = sc.starts.slice().sort((a, b) => a.p - b.p);
      if (this.S.randomStart) {
        const s = starts.slice(0, Math.max(plist.length, 1));
        rng.shuffle(s);
        starts = s.concat(starts.slice(s.length));
      }
      plist.forEach((pc, i) => {
        const st = starts[i] || starts[i % starts.length];
        const p = this.newPlayer(pc, st.x, st.y);
        if (this.S.teamPlay && pc.team === undefined) p.team = st.team;
        this.players.push(p);
        // clear the start cell and its neighbours of bricks
        this.clearBricksAround(st.x, st.y);
      });
      // level extras (EXTRA%d.RES)
      const ex = (window.AB_DATA.extras[this.level] || []);
      const wrap = (v, n) => (v < 0 ? n + v : v);
      const tramps = [];
      for (const e of ex) {
        if (e.t === 'trampoline') { tramps.push(e); continue; }
        const x = wrap(e.x, COLS), y = wrap(e.y, ROWS);
        if (!AB.inArena(x, y)) continue;
        const d = { N: 0, E: 1, S: 2, W: 3 }[e.dir];
        this.extras[idx(x, y)] = e.t === 'warp' ? { t: 'warp', id: e.id, dest: e.dest } : { t: e.t, dir: d };
        if (e.t === 'warp') this.tiles[idx(x, y)] = T_BLANK;
      }
      for (const e of tramps) {
        let x, y;
        if (e.x === 'H') {
          for (let k = 0; k < 200; k++) { x = rng.int(COLS); y = rng.int(ROWS); if (this.tiles[idx(x, y)] !== T_SOLID && !this.extras[idx(x, y)]) break; }
        } else { x = wrap(+e.x, COLS); y = wrap(+e.y, ROWS); }
        if (AB.inArena(x, y)) this.extras[idx(x, y)] = { t: 'trampoline' };
      }
      // arrows / conveyors / warps sit on open floor
      for (let i = 0; i < N; i++) if (this.extras[i] && this.extras[i].t !== 'trampoline' && this.tiles[i] === T_BRICK) this.tiles[i] = T_BLANK;
      this.placePowerups();
      // Gold Bomberman roulette prize for the previous match winner
      for (const p of this.players) {
        if (p.bonus === undefined || p.bonus < 0) continue;
        if (p.bonus === PW.DISEASE) this.infect(p, 1);
        else if (p.bonus === PW.BADDISEASE) this.infect(p, 3);
        else if (p.bonus === PW.RANDOM) this.collect(p, PW.RANDOM);
        else this.givePower(p, p.bonus, 1, true);
      }
    }
    clearBricksAround(x, y) {
      for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cx = x + dx, cy = y + dy;
        if (AB.inArena(cx, cy) && this.tiles[idx(cx, cy)] === T_BRICK) this.tiles[idx(cx, cy)] = T_BLANK;
      }
    }
    newPlayer(pc, cx, cy) {
      const p = {
        slot: pc.slot, color: pc.color, team: pc.team | 0, ai: !!pc.ai, name: pc.name || ('Player ' + (pc.slot + 1)),
        alive: true, dead: false, dieAnim: 0, dieT: 0, dieY: 0,
        x: AB.cellCenterX(cx), y: AB.cellCenterY(cy), acc: 0,
        dir: 2, moving: false, walkPix: 0,
        pw: new Array(15).fill(0), collected: [],
        dis: new Array(AB.DIS_COUNT).fill(false), disT: 0, disFresh: 0,
        special: 0, specialT: 0,            // 1 kick, 2 punch, 3 stunned, 4 pickup, 5 trampoline, 6 warp-out, 7 warp-in, 20+ cornerhead
        cornerN: 0, held: -1, stunT: 0,
        prevIn: 0, inBits: 0,
        idleT: 0, idleN: pc.slot | 0,       // standing-still timer for the idle animations (cosmetic)
        kills: 0, awesomeCount: 0, tramp: null, warp: null,
        warpLock: -1,                       // the warp just arrived at: it can't send you on until you've left its tile
        ai: pc.ai ? { plan: null, t: 0 } : null,
        isAI: !!pc.ai,
        aiLevel: pc.aiLevel || 'hard',      // computer skill: 'easy', 'medium' or 'hard' (the original AI)
      };
      for (let i = 0; i < 15; i++) p.pw[i] = START[i];
      // scheme born-with powerups
      for (const sp of this.scheme.powers) if (sp.bornwith > 0 && sp.id < 13) this.givePower(p, sp.id, sp.bornwith, true);
      p.bonus = pc.bonus !== undefined ? pc.bonus : -1;   // gold bomberman reward, applied in build()
      return p;
    }
    placePowerups() {
      const rng = this.rng;
      const bricks = [];
      for (let i = 0; i < N; i++) if (this.tiles[i] === T_BRICK) bricks.push(i);
      rng.shuffle(bricks);
      let bi = 0;
      for (let t = 0; t < 13; t++) {
        const sp = this.scheme.powers.find(p => p.id === t);
        if (sp && sp.forbidden) continue;
        let n = sp && sp.hasOverride ? sp.override : PW_AMOUNT[t];
        if (n < 0) { let k = 0; for (let j = 0; j < -n; j++) if (rng.chance(10)) k++; n = k; }
        for (let j = 0; j < n && bi < bricks.length; j++) this.hidden[bricks[bi++]] = t;
      }
    }

    // ------------------------------------------------------------------ queries
    tile(x, y) { return AB.inArena(x, y) ? this.tiles[idx(x, y)] : T_SOLID; }
    bombAtCell(x, y) {
      if (!AB.inArena(x, y)) return null;
      const b = this.bombAt[idx(x, y)];
      return b >= 0 ? this.bombs[b] : null;
    }
    playerAtCell(x, y, except) {
      for (const p of this.players) if (p.alive && p !== except && !p.tramp && AB.cellX(p.x) === x && AB.cellY(p.y) === y) return p;
      return null;
    }
    // walkable for players (fcn.0041e5c3): blank tile, no ground bomb
    free(x, y) {
      if (!AB.inArena(x, y)) return false;
      const i = idx(x, y);
      if (this.tiles[i] !== T_BLANK || this.brickT[i] > 0) return false;
      if (this.bombAt[i] >= 0) return false;
      return true;
    }
    alivePlayers() { return this.players.filter(p => p.alive); }
    bombsOut(p) { let n = 0; for (const b of this.bombs) if (b && b.owner === p.slot && !b.dead) n++; return n; }
    maxBombs(p) { return p.pw[PW.BOMB]; }
    flameLen(p) {
      if (p.dis[DIS.SHORTFLAME]) return 1;
      if (p.pw[PW.GOLDFLAME]) return Math.max(COLS, ROWS);
      return p.pw[PW.FLAME];
    }
    speedOf(p) {
      let s = K.START_SPEED + p.pw[PW.SKATE] * K.SKATE - p.pw[PW.CLOG] * K.CLOG;
      if (p.dis[DIS.MOLASSES]) s = Math.floor(s / 3);
      if (p.dis[DIS.CRACK] || p.dis[DIS.CRACKPOOPS]) s = Math.floor(s * 3 / 2);
      return Math.max(100, s);
    }
    pById(slot) { return this.players.find(p => p.slot === slot); }

    // ------------------------------------------------------------------ main step
    // inputs: array indexed by player order (this.players[i]) of input bit masks
    step(inputs) {
      this.events.length = 0;
      if (this.state === 'over' && this.result && this.result.forced) return;
      this.tick++;
      if (this.startDelay > 0) {
        // counting down: inputs are ignored and nothing moves (the same on every computer)
        if (--this.startDelay === 0) this.ev({ t: 'go' });
        this.players.forEach((p, i) => {
          // a forfeit (network F10) still counts
          if (inputs && (inputs[i] & AB.IN.FORFEIT) && !p.isAI && p.alive) { this.killPlayer(p, -1, true); this.ev({ t: 'forfeit', slot: p.slot }); }
          p.inBits = 0; p.prevIn = 0;
        });
        return;
      }
      // AI players compute their own input deterministically inside the simulation
      for (let i = 0; i < this.players.length; i++) {
        const p = this.players[i];
        let bits = inputs ? (inputs[i] | 0) : 0;
        // a player who forfeits (network F10) drops out of the round on every computer at this tick
        if ((bits & AB.IN.FORFEIT) && !p.isAI) { if (p.alive && this.state === 'play') { this.killPlayer(p, -1, true); this.ev({ t: 'forfeit', slot: p.slot }); } bits = 0; }
        if (p.isAI && AB.AI) bits = AB.AI.think(this, p);
        p.inBits = bits;
      }
      const live = this.state !== 'over';
      if (live) this.updateTimer();
      for (const p of this.players) this.updatePlayer(p);
      if (this.aliens.length && live) this.updateAliens();
      this.updateDiseaseContact();
      this.updateBombs();
      this.updateFlames();
      this.checkDeaths();
      if (live) { if (this.state === 'play') this.updateAIFinale(); this.updateEnclosement(); this.updateRegen(); this.checkRoundEnd(); }
      for (const p of this.players) p.prevIn = p.inBits;
    }

    updateTimer() {
      if (this.state !== 'play') return;
      // random dud bombs (#320-#324): every few minutes the next bomb may fizzle and go off late
      if (--this.dudTimer <= 0) {
        this.dudTimer = K.DUD_MIN + this.rng.int(K.DUD_RND);
        if (this.rng.chance(K.DUD_CHANCE)) this.dudPending = true;
      }
      if (this.timeLeft < 0) return;
      this.timeLeft--;
      const sec = Math.ceil(this.timeLeft / AB.TPS);
      if (!this.hurry && this.timeLeft <= K.HURRY * AB.TPS && this.S.playTime >= K.HURRY) {
        this.hurry = true; this.hurryShown = 3 * AB.TPS;
        this.snd(2700, 2799);
        this.ev({ t: 'hurry' });
      }
      if (this.hurryShown > 0) this.hurryShown--;
      if (this.hurry && !this.enc && this.S.enclosement > 0 && this.timeLeft <= (K.HURRY - 5) * AB.TPS) {
        this.enc = { x: 0, y: 0, dir: 1, ring: 0, t: 0, done: false, depth: this.S.enclosement === 3 ? 99 : this.S.enclosement * 2 };
      }
      if (this.timeLeft <= 0) { this.timeLeft = 0; this.endRound(null, true); }
      this._sec = sec;
    }

    // ------------------------------------------------------------------ players
    updatePlayer(p) {
      if (!p.alive) {
        if (p.dieAnim) {
          p.dieT++;
          if (p.dieAnim === 9) p.dieY -= K.ANGEL_DY / TPR;   // the angel death floats upward (#106)
        }
        return;
      }
      if (p.disT > 0) {
        p.disT--;
        if (p.disT === 0) p.dis.fill(false);
      }
      if (p.disFresh > 0) p.disFresh--;
      // idle animations: count while the player stands still; one plays after AB.IDLE_AFTER seconds
      if (p.inBits || p.moving || p.special || p.held >= 0 || p.disT > 0) p.idleT = 0;
      else if (++p.idleT >= AB.IDLE_AFTER * AB.TPS + AB.IDLE_ANIMS[p.idleN % AB.IDLE_ANIMS.length].len * TPR) { p.idleT = 0; p.idleN++; }

      // special animations that freeze the player
      if (p.special) {
        p.specialT++;
        if (p.special === 5) { this.updateTrampoline(p); return; }
        if (p.special === 6 || p.special === 7) { this.updateWarp(p); return; }
        if (p.special === 3) { if (--p.stunT <= 0) p.special = 0; return; }
        if (p.special === 4) { if (p.specialT >= K.PICKUP_PAUSE + R(10)) p.special = 0; }
        if (p.special === 1 || p.special === 2) { if (p.specialT >= R(8)) p.special = 0; }
        if (p.special >= 20) {
          const len = 50;   // every cornerhead sequence in CORNER*.ANI has 50 states
          if (p.specialT >= R(len || 50)) { p.special = 0; p.specialT = 0; }
        }
      }

      let bits = p.inBits;
      if (p.dis[DIS.POOPS] || p.dis[DIS.CRACKPOOPS]) bits |= AB.IN.BOMB;
      const bombDown = !!(bits & AB.IN.BOMB), bombWas = !!(p.prevIn & AB.IN.BOMB);
      const actDown = !!(bits & AB.IN.ACTION), actWas = !!(p.prevIn & AB.IN.ACTION);
      const poops = p.dis[DIS.POOPS] || p.dis[DIS.CRACKPOOPS];

      // ---- movement ----
      let godir = this.chooseDir(p, bits);
      if (godir >= 0 && p.dis[DIS.REVERSED]) godir = (godir + 2) & 3;
      if (p.special >= 20 && godir >= 0) { p.special = 0; p.specialT = 0; }
      const cx = AB.cellX(p.x), cy = AB.cellY(p.y);
      const ex = this.extras[idx(cx, cy)];
      if (godir >= 0 && !(p.special === 4)) {
        let spd = this.speedOf(p);
        if (ex && ex.t === 'conveyor') {
          if (ex.dir === godir) spd += this.conveyorSpeed;
          if (ex.dir === ((godir + 2) & 3)) spd -= this.conveyorSpeed;
        }
        p.dir = godir;
        p.moving = true;
        p.acc += Math.max(0, spd);
        while (p.acc >= SUB) {
          p.acc -= SUB;
          if (this.stepPlayer(p, godir)) return;   // died / teleported
        }
      } else {
        p.moving = false;
        if (ex && ex.t === 'conveyor' && !p.special) {
          p.acc += this.conveyorSpeed;
          while (p.acc >= SUB) { p.acc -= SUB; if (this.stepPlayer(p, ex.dir, true)) return; }
        } else p.acc = 0;
      }
      // trapped -> cornerhead panic animation (all four neighbours blocked)
      if (!p.special && !p.moving) {
        let blocked = 0;
        for (let d = 0; d < 4; d++) if (!this.free(AB.cellX(p.x) + DX[d], AB.cellY(p.y) + DY[d])) blocked++;
        if (blocked >= 4 && this.dangerAt(AB.cellX(p.x), AB.cellY(p.y))) {
          p.special = 20 + this.rng.int(Math.max(1, V(330, 13))); p.specialT = 0;
        }
      }
      this.pickupAt(p);

      // ---- held bomb (blue hand): released button or poops -> throw ----
      if (p.held >= 0) {
        const b = this.bombs[p.held];
        if (!b || b.dead) p.held = -1;
        else {
          b.x = p.x; b.y = p.y;
          if (poops || !bombDown) { this.throwBomb(p, b); p.held = -1; }
        }
      }
      // ---- action button ----
      if (actDown && !actWas) {
        if (p.pw[PW.KICK]) this.stopKicked(p);
        if (p.pw[PW.PUNCH] && !bombDown && p.held < 0) {
          const tx = AB.cellX(p.x) + DX[p.dir], ty = AB.cellY(p.y) + DY[p.dir];
          const b = this.bombAtCell(tx, ty);
          if (b && (b.motion === 0 || b.motion === 1)) { this.punchBomb(b, p.dir); p.special = 2; p.specialT = 0; }
        }
        if (p.pw[PW.TRIGGER]) this.detonateOldestTrigger(p);
      }
      // ---- drop bomb / grab / spooge ----
      if (bombDown && (!bombWas || poops) && !p.dis[DIS.CONSTIPATION] && p.held < 0) {
        const pcx = AB.cellX(p.x), pcy = AB.cellY(p.y);
        const here = this.bombAtCell(pcx, pcy);
        if (here && here.owner === p.slot && p.pw[PW.GRAB] && !bombWas) {
          // pick up our bomb
          here.motion = 3; here.holder = p.slot; this.bombAt[idx(here.cx, here.cy)] = -1;
          p.held = here.i; p.special = 4; p.specialT = 0;
          this.snd(170, 175);
        } else if (here && here.owner === p.slot && p.pw[PW.SPOOGE] && !poops && !bombWas) {
          // spooge: lay the remaining bombs in a line
          let x = pcx, y = pcy, n = 0;
          while (this.bombsOut(p) < this.maxBombs(p)) {
            x += DX[p.dir]; y += DY[p.dir];
            if (!this.free(x, y) || this.playerAtCell(x, y) || this.items[idx(x, y)] >= 0) break;
            this.dropBomb(p, x, y, n === 0); n++;
          }
        } else if (!here && this.bombsOut(p) < this.maxBombs(p) && this.free(pcx, pcy)) {
          const e = this.extras[idx(pcx, pcy)];
          if (!(e && e.t === 'warp')) {
            this.dropBomb(p, pcx, pcy, true);
            const out = this.bombsOut(p);
            if (out >= K.MANY_BOMBS && out === this.maxBombs(p) && this.rng.chance(K.MANY_BOMBS_CHANCE)) this.snd(1200, 1299);
          }
        }
      }
    }

    // fcn.0041e61e: with several directions held, keep only those leading to open cells, take the last
    chooseDir(p, bits) {
      const want = [!!(bits & AB.IN.UP), !!(bits & AB.IN.RIGHT), !!(bits & AB.IN.DOWN), !!(bits & AB.IN.LEFT)];
      const cnt = want.filter(Boolean).length;
      if (!cnt) return -1;
      const cx = AB.cellX(p.x), cy = AB.cellY(p.y);
      if (cnt > 1) {
        let open = 0;
        for (let d = 0; d < 4; d++) if (want[d] && this.free(cx + DX[d], cy + DY[d])) open++;
        if (open) for (let d = 0; d < 4; d++) if (want[d] && !this.free(cx + DX[d], cy + DY[d])) want[d] = false;
        // prefer continuing the current direction when it is still wanted (smoother cornering)
        if (want[p.dir] && p.moving && cnt === 2 && open === 2) {
          const other = [0, 1, 2, 3].find(d => d !== p.dir && want[d]);
          const ox = AB.offX(p.x), oy = AB.offY(p.y);
          if (other !== undefined && ((DX[other] && ox === 0) || (DY[other] && oy === 0))) return other;
          return p.dir;
        }
      }
      let r = -1;
      for (let d = 0; d < 4; d++) if (want[d]) r = d;
      return r;
    }

    // one pixel of movement (fcn.0041ec84). returns true if the player died or left normal movement
    stepPlayer(p, dir, conveyor) {
      p.walkPix++;
      const ox = AB.offX(p.x), oy = AB.offY(p.y);
      const along = DX[dir] * ox + DY[dir] * oy;
      const perp = DX[dir] * oy - DY[dir] * ox;
      const cx = AB.cellX(p.x), cy = AB.cellY(p.y);
      const ax = cx + DX[dir], ay = cy + DY[dir];
      if (p.warpLock >= 0 && p.warpLock !== idx(cx, cy)) p.warpLock = -1;
      if (along === -1 && !conveyor) {
        const e = this.extras[idx(cx, cy)];
        if (e && e.t === 'warp' && p.warpLock !== idx(cx, cy)) { this.startWarp(p, e); return true; }
        if (e && e.t === 'trampoline') { this.startTrampoline(p); return true; }
      }
      if (along === 0 && p.pw[PW.KICK] && !conveyor) {
        const b = this.bombAtCell(ax, ay);
        if (b && (b.motion === 0 || b.motion === 1) && this.free(ax + DX[dir], ay + DY[dir]) && !this.playerAtCell(ax + DX[dir], ay + DY[dir])) {
          this.kickBomb(b, dir, p);
          p.special = 1; p.specialT = 0;
        }
      }
      let mx = 0, my = 0;
      if (along < 0 || this.free(ax, ay)) {
        mx = DX[dir]; my = DY[dir];
        if (perp !== 0) {
          const d2 = perp < 0 ? (dir + 1) & 3 : (dir + 3) & 3;
          mx += DX[d2]; my += DY[d2];
        }
      } else if (perp !== 0) {
        // corner sliding: we are off-centre towards an open side -> slide around the corner
        const side = perp < 0 ? (dir + 3) & 3 : (dir + 1) & 3;
        const sx = cx + DX[side], sy = cy + DY[side];
        if (this.free(sx, sy) && this.free(sx + DX[dir], sy + DY[dir])) { mx = DX[side]; my = DY[side]; }
      } else if (along > 0) {
        mx = -DX[dir]; my = -DY[dir];
      }
      if (!mx && !my) return false;
      p.x += mx; p.y += my;
      if (this.flameAtPlayer(p)) { this.killPlayer(p, this.flameOwner[idx(AB.cellX(p.x), AB.cellY(p.y))]); return true; }
      this.pickupAt(p);
      return false;
    }

    startWarp(p, e) {
      // find destination warp
      let dest = -1;
      for (let i = 0; i < N; i++) if (this.extras[i] && this.extras[i].t === 'warp' && this.extras[i].id === e.dest) dest = i;
      if (dest < 0) return;
      p.special = 6; p.specialT = 0; p.warp = { dest };
      p.x = AB.cellCenterX(AB.cellX(p.x)); p.y = AB.cellCenterY(AB.cellY(p.y));
      this.snd(1330);
    }
    updateWarp(p) {
      if (p.special === 6 && p.specialT > K.WARP) {
        const d = p.warp.dest;
        p.x = AB.cellCenterX(d % COLS); p.y = AB.cellCenterY((d / COLS) | 0);
        p.special = 7; p.specialT = 0; p.warpLock = d;
        // step off the destination warp so we don't bounce back immediately
        for (let k = 0; k < 4; k++) {
          const dd = (p.dir + k) & 3;
          if (this.free((d % COLS) + DX[dd], ((d / COLS) | 0) + DY[dd])) { p.dir = dd; break; }
        }
      } else if (p.special === 7 && p.specialT > K.WARP) {
        p.special = 0; p.specialT = 0;
        // nudge one pixel out of the warp centre in our facing direction
        if (this.free(AB.cellX(p.x) + DX[p.dir], AB.cellY(p.y) + DY[p.dir])) { p.x += DX[p.dir]; p.y += DY[p.dir]; }
      }
    }
    startTrampoline(p) {
      p.special = 5; p.specialT = 0; p.tramp = { h: 0 };
      p.x = AB.cellCenterX(AB.cellX(p.x)); p.y = AB.cellCenterY(AB.cellY(p.y));
      this.snd(350, 353);
    }
    updateTrampoline(p) {
      const t = p.specialT, half = K.TRAMP / 2;
      // height in pixels: up at #681 px per reference frame, then down
      p.tramp.h = (t < half ? t : K.TRAMP - t) * K.TRAMP_DY / TPR;
      if (t === Math.floor(half)) {
        // land somewhere within 2 cells, in a different row and column (fcn.0041f29b state 5)
        const cx = AB.cellX(p.x), cy = AB.cellY(p.y);
        for (let k = 0; k < 100; k++) {
          const nx = cx + this.rng.int(5) - 2, ny = cy + this.rng.int(5) - 2;
          if (nx !== cx && ny !== cy && this.free(nx, ny) && this.flameT[idx(nx, ny)] <= 0) { p.x = AB.cellCenterX(nx); p.y = AB.cellCenterY(ny); break; }
        }
      }
      if (t >= K.TRAMP) {
        p.special = 0; p.specialT = 0; p.tramp = null;
        // landed inside a wall that closed in while we were airborne
        if (this.tile(AB.cellX(p.x), AB.cellY(p.y)) === T_SOLID) this.killPlayer(p, -1, true);
      }
    }

    flameAtPlayer(p) {
      if (p.tramp || p.special === 6 || p.special === 7) return false;
      const i = idx(AB.cellX(p.x), AB.cellY(p.y));
      return this.flameT[i] > 0;
    }
    dangerAt(x, y) {
      for (const b of this.bombs) {
        if (!b || b.dead || b.motion > 1) continue;
        if (b.cx === x && b.cy === y) return true;
        if (b.cx === x && Math.abs(b.cy - y) <= b.range) return true;
        if (b.cy === y && Math.abs(b.cx - x) <= b.range) return true;
      }
      return false;
    }

    // ------------------------------------------------------------------ powerups
    pickupAt(p) {
      const i = idx(AB.cellX(p.x), AB.cellY(p.y));
      const t = this.items[i];
      if (t < 0) return;
      this.items[i] = -1;
      this.collect(p, t);
    }
    // fcn.0041e21e: apply a picked-up powerup
    collect(p, t) {
      // any pickup may cure the current disease (#124, 1 in #125)
      if (p.disT > 0 && V(124, 1) && this.rng.chance(K.CURE_CHANCE)) { p.dis.fill(false); p.disT = 0; }
      if (t === PW.RANDOM) {
        for (let k = 0; k < 200; k++) {
          t = this.rng.int(12);
          const sp = this.scheme.powers.find(q => q.id === t);
          if (!(sp && sp.forbidden)) break;
        }
      }
      if (t === PW.DISEASE) { this.infect(p, 1); p.collected.push(t); return; }
      if (t === PW.BADDISEASE) { this.infect(p, 3); p.collected.push(t); return; }
      if (t === PW.TRIGGER) p.trigUsed = 0;
      this.givePower(p, t, 1, false);
      p.collected.push(t);
      // "you are now AWESOME": 7th powerup and every 5th after that
      p.awesomeCount++;
      let awesome = p.awesomeCount >= 7 && (p.awesomeCount - 7) % 5 === 0;
      if (p.awesomeCount > 50) p.awesomeCount = 7;
      if (awesome) this.snd(1400, 1699);
      else if (t === PW.JELLY) this.snd(135, 139);
      else this.snd(400, 499);
      this.ev({ t: 'pickup', slot: p.slot, pw: t });
    }
    givePower(p, t, n, silent) {
      const lim = LIMITS[t] || 0;
      // mutually exclusive powerups (manual): spit out the conflicting one
      const spit = (k) => {
        if (p.pw[k] <= 0) return;
        p.pw[k] = 0;
        for (let ci = p.collected.indexOf(k); ci >= 0; ci = p.collected.indexOf(k)) p.collected.splice(ci, 1);
        if (!silent) this.scatter([k], AB.cellX(p.x), AB.cellY(p.y));
      };
      if (t === PW.TRIGGER) { spit(PW.JELLY); spit(PW.PUNCH); }
      if (t === PW.JELLY) spit(PW.TRIGGER);
      if (t === PW.PUNCH) spit(PW.TRIGGER);
      if (t === PW.GRAB) spit(PW.SPOOGE);
      if (t === PW.SPOOGE) spit(PW.GRAB);
      p.pw[t] += n;
      if (lim > 0 && p.pw[t] > lim) p.pw[t] = lim;
    }
    // fcn.0041dfb6: one of the 9 diseases (DISEASE.H 0..8); "swap" trades places instead.
    // The original only implements 9 (VALUELST has durations #130-#138); leprosy/invisible/duds
    // have sounds but are never handed out.
    infect(p, count) {
      for (let k = 0; k < count; k++) {
        const d = this.rng.int(9);
        if (k === 0) { if (this.rng.chance(3)) this.snd(3000 + d * 50, 3049 + d * 50); else this.snd(2300, 2599); }
        if (d === DIS.SWAP) { this.swapPlayers(p); continue; }
        p.dis[d] = true;
        p.disT = R(V(130 + d, 300)); p.disFresh = K.DIS_FRESH;
      }
      this.ev({ t: 'disease', slot: p.slot });
    }
    swapPlayers(p) {
      const others = this.players.filter(o => o !== p && o.alive && !o.special);
      if (!others.length) return;
      const o = this.rng.pick(others);
      const tx = p.x, ty = p.y; p.x = o.x; p.y = o.y; o.x = tx; o.y = ty;
      this.snd(1330);
    }
    updateDiseaseContact() {
      const ps = this.players;
      for (const p of ps) {
        if (!p.alive || p.disT <= 0 || p.disFresh > 0) continue;
        for (const o of ps) {
          if (o === p || !o.alive || o.disT > 0 || o.tramp) continue;
          if (Math.abs(o.x - p.x) <= CW - 10 && Math.abs(o.y - p.y) <= CH - 10) {
            for (let d = 0; d < AB.DIS_COUNT; d++) o.dis[d] = p.dis[d];
            o.disT = p.disT; o.disFresh = K.DIS_FRESH;
            if (!V(123, 1)) { p.dis.fill(false); p.disT = 0; }
            p.disFresh = K.DIS_FRESH;
            this.snd(2300, 2599);
            break;
          }
        }
      }
    }
    // drop powerups randomly across the map (on death, on bomb-on-head, when spat out)
    scatter(list, nearX, nearY) {
      for (const t of list) {
        if (t === PW.DISEASE || t === PW.BADDISEASE) { if (!this.rng.chance(2)) continue; }
        for (let k = 0; k < 60; k++) {
          const x = this.rng.int(COLS), y = this.rng.int(ROWS), i = idx(x, y);
          if (this.tiles[i] === T_BLANK && this.items[i] < 0 && this.bombAt[i] < 0 && this.flameT[i] <= 0 && !this.extras[i] && !this.playerAtCell(x, y)) {
            this.items[i] = t; this.itemSafe[i] = R(4);
            this.ev({ t: 'itemfly', x, y, fromX: nearX, fromY: nearY, pw: t });
            break;
          }
        }
      }
    }

    // ------------------------------------------------------------------ bombs
    dropBomb(p, x, y, sound) {
      const b = {
        i: this.bombs.length, id: this.nextBombId++, owner: p.slot, color: p.color, cx: x, cy: y,
        x: AB.cellCenterX(x), y: AB.cellCenterY(y), t: 0, fuse: K.FUSE, range: this.flameLen(p), gold: !!p.pw[PW.GOLDFLAME],
        kind: p.pw[PW.JELLY] ? 2 : 0, motion: 0, dir: 0, acc: 0, stop: false,
        fly: null, holder: -1, dud: false, dead: false, dropTick: this.tick, anim: 0,
      };
      // trigger: as many remote bombs as your bomb count, then back to normal (fcn.0041eb13)
      if (p.pw[PW.TRIGGER] && (p.trigUsed | 0) < this.maxBombs(p)) { b.kind = 1; p.trigUsed = (p.trigUsed | 0) + 1; }
      if (p.dis[DIS.SHORTFUZE]) b.fuse = Math.floor(b.fuse / 3);
      if (p.dis[DIS.DUDS] || this.dudPending) {
        b.dud = true; b.fuse += K.DUD_WAIT + this.rng.int(K.DUD_WAIT_RND); this.dudPending = false;
        if (b.kind === 1) b.kind = 0;
      }
      // reuse dead slots to keep indices small
      let slot = this.bombs.findIndex(o => !o || o.dead);
      if (slot < 0) slot = this.bombs.length;
      b.i = slot; this.bombs[slot] = b;
      this.bombAt[idx(x, y)] = slot;
      if (sound) this.snd(100, 101);
      if (p.dis[DIS.POOPS] || p.dis[DIS.CRACKPOOPS]) this.snd(550, 554);
      return b;
    }
    kickBomb(b, dir, p) {
      if (b.motion === 1 && b.dir === dir) return;
      b.motion = 1; b.dir = dir; b.acc = 0; b.stop = false; b.kicker = p.slot; b.conveyed = false;
      // snap the perpendicular axis to the cell centre
      if (DX[dir]) b.y = AB.cellCenterY(b.cy); else b.x = AB.cellCenterX(b.cx);
      this.snd(120, 123);
    }
    stopKicked(p) {
      // fcn.004247c5: flags the player's own sliding (non-jelly) bombs to stop at the next cell
      for (const b of this.bombs) if (b && !b.dead && b.motion === 1 && b.owner === p.slot && b.kind !== 2 && !b.conveyed) b.stop = true;
    }
    punchBomb(b, dir) {
      if (b.motion === 0 || b.motion === 1) this.bombAt[idx(b.cx, b.cy)] = -1;
      b.motion = 2; b.dir = dir; b.acc = 0; b.stop = false;
      b.x = AB.cellCenterX(b.cx); b.y = AB.cellCenterY(b.cy);
      b.fly = { cells: 0, lastCx: b.cx, lastCy: b.cy, travelled: 0, total: 3 * (DX[dir] ? CW : CH), arc: K.ARC1, h: 0 };
      this.snd(150, 151);
    }
    throwBomb(p, b) {
      b.cx = AB.cellX(p.x); b.cy = AB.cellY(p.y);
      b.holder = -1;
      this.punchBomb(b, p.dir);
      this.snd(172, 175);
    }
    detonateOldestTrigger(p) {
      let best = null;
      for (const b of this.bombs) if (b && !b.dead && b.owner === p.slot && b.kind === 1 && b.motion < 2 && (!best || b.dropTick < best.dropTick)) best = b;
      if (best) this.explode(best);
    }

    updateBombs() {
      // once the round is decided (winner's grace period) bombs stay put and never go off
      const frozen = this.state === 'over';
      for (const b of this.bombs) {
        if (!b || b.dead) continue;
        b.anim++;
        // fuse runs unless the bomb is flying or carried; trigger bombs wait for the trigger
        if (frozen) { /* fuse paused */ }
        else if (b.motion < 2 && b.kind !== 1) {
          b.t++;
          if (b.t >= b.fuse) { this.explode(b); continue; }
        } else if (b.kind === 1 && b.motion < 2) {
          b.t++;
          // safety: trigger bombs left alone forever eventually go off (owner died)
          const o = this.pById(b.owner);
          if ((!o || !o.alive) && b.t >= b.fuse) { this.explode(b); continue; }
        }
        if (b.motion === 1) this.slideBomb(b);
        else if (b.motion === 2) this.flyBomb(b);
        else if (b.motion === 0) {
          // conveyors carry idle bombs
          const e = this.extras[idx(b.cx, b.cy)];
          if (e && e.t === 'conveyor') {
            const nx = b.cx + AB.DX[e.dir], ny = b.cy + AB.DY[e.dir];
            if (this.free(nx, ny) && !this.playerAtCell(nx, ny)) { b.motion = 1; b.dir = e.dir; b.acc = 0; b.conveyed = true; }
          }
        }
      }
    }
    slideBomb(b) {
      const speed = b.conveyed ? this.conveyorSpeed : K.KICK_SPEED;
      b.acc += speed;
      while (b.acc >= SUB) {
        b.acc -= SUB;
        const ox = AB.offX(b.x), oy = AB.offY(b.y);
        const along = DX[b.dir] * ox + DY[b.dir] * oy;
        if (along === 0) {
          const e = this.extras[idx(b.cx, b.cy)];
          if (e && e.t === 'arrow') b.dir = e.dir;
          if (e && e.t === 'conveyor' && b.conveyed) b.dir = e.dir;
          if (b.conveyed && !(e && e.t === 'conveyor')) { b.motion = 0; b.conveyed = false; return; }
          if (b.stop) { b.motion = 0; b.stop = false; this.snd(130, 132); return; }
          const nx = b.cx + DX[b.dir], ny = b.cy + DY[b.dir];
          const ne = AB.inArena(nx, ny) ? this.extras[idx(nx, ny)] : null;
          if (!this.free(nx, ny) || this.playerAtCell(nx, ny) || (ne && ne.t === 'warp')) {
            if (b.kind === 2 && !b.conveyed) {
              // jelly bombs bounce back
              b.dir = (b.dir + 2) & 3; this.snd(135, 139);
              const bx = b.cx + DX[b.dir], by = b.cy + DY[b.dir];
              if (!this.free(bx, by) || this.playerAtCell(bx, by)) { b.motion = 0; return; }
            } else { if (!b.conveyed) this.snd(130, 132); b.motion = 0; b.conveyed = false; return; }
          }
        }
        const nx2 = b.x + DX[b.dir], ny2 = b.y + DY[b.dir];
        const ncx = AB.cellX(nx2), ncy = AB.cellY(ny2);
        if ((ncx !== b.cx || ncy !== b.cy) && (!this.free(ncx, ncy) || this.playerAtCell(ncx, ncy))) {
          // something moved into the next cell since we last checked: stop (or bounce) in this cell
          b.x = AB.cellCenterX(b.cx); b.y = AB.cellCenterY(b.cy); b.acc = 0;
          if (b.kind === 2 && !b.conveyed) { b.dir = (b.dir + 2) & 3; this.snd(135, 139); continue; }
          if (!b.conveyed) this.snd(130, 132);
          b.motion = 0; b.conveyed = false; return;
        }
        b.x = nx2; b.y = ny2;
        if (ncx !== b.cx || ncy !== b.cy) {
          if (this.bombAt[idx(b.cx, b.cy)] === b.i) this.bombAt[idx(b.cx, b.cy)] = -1;
          b.cx = ncx; b.cy = ncy; this.bombAt[idx(ncx, ncy)] = b.i;
          // rolling over a powerup destroys it
          if (this.items[idx(ncx, ncy)] >= 0 && !b.conveyed) this.items[idx(ncx, ncy)] = -1;
        }
        if (this.flameT[idx(b.cx, b.cy)] > 0) { this.explode(b); return; }
      }
    }
    // punched / thrown bombs (motion 2), fcn.0042331c case 2: fly 3 cells, then check every cell
    // centre for a landing spot; bounce off tiles, bombs, powerups, warps and heads; wrap around the
    // arena through a virtual border (the bomb leaves the screen and comes back on the other side).
    flyBomb(b) {
      const f = b.fly;
      b.acc += K.PUNCH_SPEED;
      while (b.acc >= SUB) {
        b.acc -= SUB;
        b.x += DX[b.dir]; b.y += DY[b.dir];
        f.travelled++;
        if (AB.offX(b.x) !== 0 || AB.offY(b.y) !== 0) continue;
        let cx = AB.cellX(b.x), cy = AB.cellY(b.y);
        if (cx >= COLS + 2) { b.x -= (COLS + 3) * CW; cx -= COLS + 3; }
        if (cx <= -2) { b.x += (COLS + 3) * CW; cx += COLS + 3; }
        if (cy >= ROWS + 2) { b.y -= (ROWS + 3) * CH; cy -= ROWS + 3; }
        if (cy <= -2) { b.y += (ROWS + 3) * CH; cy += ROWS + 3; }
        if (cx !== f.lastCx || cy !== f.lastCy) { f.cells++; f.lastCx = cx; f.lastCy = cy; }
        if (f.cells < 3) continue;
        // landing check at this cell
        const inside = AB.inArena(cx, cy);
        if (b.kind === 2 && inside && this.rng.chance(K.JELLY_TURN)) b.dir = (b.dir + this.rng.int(2) * 2 + 1) & 3;
        this.snd(160);
        f.travelled = 0; f.total = DX[b.dir] ? CW : CH; f.arc = K.ARC2;
        if (!inside) continue;
        const i = idx(cx, cy);
        if (this.tiles[i] !== T_BLANK || this.brickT[i] > 0) continue;
        if (this.bombAt[i] >= 0) continue;
        if (this.items[i] >= 0) continue;
        const pl = this.playerAtCell(cx, cy);
        if (pl) { this.bonk(pl, b); continue; }
        const e = this.extras[i];
        if (e && e.t === 'warp') continue;
        // land
        b.cx = cx; b.cy = cy; b.motion = 0; b.fly = null; b.acc = 0;
        this.bombAt[i] = b.i;
        if (this.flameT[i] > 0) this.explode(b);
        return;
      }
      f.h = Math.round(Math.sin(Math.PI * Math.min(1, f.travelled / f.total)) * f.arc);
    }
    // a punched/thrown bomb lands on someone's head: stun + lose powerups (fcn.00421f7e)
    bonk(p, b) {
      if (p.special === 3) return;
      p.special = 3; p.specialT = 0; p.stunT = K.STUN;
      this.snd(360, 363);
      const n = K.LOSE_MIN + this.rng.int(K.LOSE_RND + 1);
      const lost = [];
      for (let k = 0; k < n && p.collected.length; k++) {
        const j = this.rng.int(p.collected.length);
        const t = p.collected.splice(j, 1)[0];
        if (t !== PW.DISEASE && t !== PW.BADDISEASE && p.pw[t] > START[t]) p.pw[t]--;
        lost.push(t);
      }
      this.scatter(lost, AB.cellX(p.x), AB.cellY(p.y));
    }

    explode(b) {
      if (b.dead || this.state === 'over') return;
      b.dead = true;
      if (b.motion === 0 || b.motion === 1) { if (this.bombAt[idx(b.cx, b.cy)] === b.i) this.bombAt[idx(b.cx, b.cy)] = -1; }
      if (b.motion === 3) { const h = this.pById(b.holder); if (h && h.held === b.i) h.held = -1; }
      if (b.motion === 2) {
        // detonated in the air (only by enclosement) - explode at the nearest cell
        b.cx = AB.cellX(b.x); b.cy = AB.cellY(b.y);
      }
      if (b.motion === 3) { const h = this.pById(b.holder); if (h) { b.cx = AB.cellX(h.x); b.cy = AB.cellY(h.y); } }
      this.snd(200, 299);
      this.ev({ t: 'explode', x: b.cx, y: b.cy });
      const owner = b.owner;
      this.setFlame(b.cx, b.cy, 'center', owner, b.color, b.gold);
      this.burnItem(b.cx, b.cy);
      for (let d = 0; d < 4; d++) {
        let x = b.cx, y = b.cy;
        for (let l = 0; l < b.range; l++) {
          x += DX[d]; y += DY[d];
          if (!AB.inArena(x, y)) break;
          const i = idx(x, y);
          const ob = this.bombAt[i] >= 0 ? this.bombs[this.bombAt[i]] : null;
          if (ob && !ob.dead) { this.explode(ob); break; }
          if (this.items[i] >= 0 && this.itemSafe[i] <= 0) { this.burnItem(x, y); break; }
          const t = this.tiles[i];
          if (t === T_SOLID) break;
          if (t === T_BRICK) {
            if (this.brickT[i] <= 0) { this.brickT[i] = K.BRICK; this.ev({ t: 'brick', x, y }); }
            break;
          }
          if (this.brickT[i] > 0) break;
          const last = l === b.range - 1;
          this.setFlame(x, y, (last ? 'tip' : 'mid') + AB.DIRNAME[d], owner, b.color, b.gold);
        }
      }
    }
    burnItem(x, y) {
      const i = idx(x, y);
      const t = this.items[i];
      if (t < 0 || this.itemSafe[i] > 0) return;
      this.items[i] = -1;
      this.ev({ t: 'burnitem', x, y, pw: t });
      if ((t === PW.DISEASE || t === PW.BADDISEASE) && !this.S.diseasesDestroyable) this.scatter([t], x, y);
    }
    setFlame(x, y, kind, owner, color, gold) {
      const i = idx(x, y);
      // centres win over arms, arms over tips (prettier overlaps)
      const rank = (k) => (k === 'center' ? 3 : k && k.startsWith('mid') ? 2 : 1);
      if (this.flameT[i] <= 0 || rank(kind) >= rank(this.flameKind[i]) || this.flameT[i] < K.FLAME / 2) this.flameKind[i] = kind;
      this.flameT[i] = K.FLAME;
      this.flameOwner[i] = owner; this.flameColor[i] = color; this.flameGold[i] = gold ? 1 : 0;
      // flames set off bombs passing through (sliding) - ground bombs handled in explode()
    }
    updateFlames() {
      for (let i = 0; i < N; i++) {
        if (this.flameT[i] > 0) { this.flameT[i]--; if (!this.flameT[i]) this.flameKind[i] = null; }
        if (this.itemSafe[i] > 0) this.itemSafe[i]--;
        if (this.brickT[i] > 0) {
          this.brickT[i]--;
          if (this.brickT[i] === 0) {
            this.tiles[i] = T_BLANK;
            if (this.hidden[i] >= 0) {
              // over-powerful powers don't appear in the first #102 seconds; they go elsewhere
              this.items[i] = this.hidden[i]; this.hidden[i] = -1; this.itemSafe[i] = R(2);
            }
          }
        }
      }
      // flames reaching a bomb that slid/landed into them
      for (const b of this.bombs) if (b && !b.dead && b.motion < 2 && this.flameT[idx(b.cx, b.cy)] > 0) this.explode(b);
    }

    // ------------------------------------------------------------------ death
    checkDeaths() {
      for (const p of this.players) {
        if (!p.alive) continue;
        if (this.flameAtPlayer(p)) this.killPlayer(p, this.flameOwner[idx(AB.cellX(p.x), AB.cellY(p.y))]);
      }
    }
    killPlayer(p, killerSlot, crushed) {
      if (!p.alive) return;
      p.alive = false; p.dead = true; p.dieT = 0; p.dieY = 0;
      p.special = 0; p.specialT = 0; p.tramp = null; p.warp = null;
      p.dieAnim = 1 + this.rng.int(Math.max(1, V(105, 24)));
      if (p.held >= 0) { const b = this.bombs[p.held]; if (b && !b.dead) { b.motion = 0; b.cx = AB.cellX(p.x); b.cy = AB.cellY(p.y); b.x = AB.cellCenterX(b.cx); b.y = AB.cellCenterY(b.cy); b.holder = -1; if (this.bombAt[idx(b.cx, b.cy)] < 0) this.bombAt[idx(b.cx, b.cy)] = b.i; } p.held = -1; }
      p.deathTick = this.tick;
      this.events.push({ t: 'snd', lo: 300, hi: 301, death: true, slot: p.slot });     // (network play holds death sounds until certain)
      this.ev({ t: 'death', slot: p.slot, anim: p.dieAnim });
      if (killerSlot !== undefined && killerSlot >= 0 && !crushed && this.state !== 'over') {
        const k = this.pById(killerSlot);
        if (k) {
          if (k === p) k.kills--; else k.kills++;
          if (k !== p && this.rng.chance(K.TAUNT)) this.ev({ t: 'taunt', slot: k.slot, of: p.slot });
        }
      }
      // all collected powerups fly out across the map
      const list = p.collected.slice(); p.collected.length = 0;
      this.scatter(list, AB.cellX(p.x), AB.cellY(p.y));
    }

    // ------------------------------------------------------------------ campaign enemies (aliens.c)
    // Rovers (type 1) roll along open floor; ghosts (type 2) also drift through bricks. Both wander the
    // maze and turn at intersections (1 in #1200), usually towards the nearest human (all but 1 in #1205).
    // They kill the humans they touch (fcn.00401b5c spares computer players) and die in flames.
    spawnAliens() {
      const c = this.camp, rng = this.rng;
      const add = (type, n, speed) => {
        for (let k = 0; k < n; k++) {
          for (let tries = 0; tries < 400; tries++) {
            const x = rng.int(COLS), y = rng.int(ROWS), i = idx(x, y);
            if (this.tiles[i] === T_SOLID || this.extras[i]) continue;
            // rovers need open floor: on a crowded map they may take a brick's place (late tries only)
            if (type === 1 && this.tiles[i] !== T_BLANK && tries < 150) continue;
            if (tries < 350 && this.players.some(p => Math.abs(AB.cellX(p.x) - x) + Math.abs(AB.cellY(p.y) - y) < 5)) continue;
            if (this.aliens.some(a => a.cx0 === x && a.cy0 === y)) continue;
            if (type === 1 && this.tiles[i] === T_BRICK) { this.tiles[i] = T_BLANK; this.hidden[i] = -1; }
            this.aliens.push({ type, x: AB.cellCenterX(x), y: AB.cellCenterY(y), cx0: x, cy0: y, dir: rng.int(4), acc: 0,
                               speed: Math.max(60, speed), alive: true, dieT: 0, anim: rng.int(60) });
            break;
          }
        }
      };
      add(1, c.rovers | 0, c.roverSpeed | 0);
      add(2, c.ghosts | 0, c.ghostSpeed | 0);
    }
    alienCan(a, x, y) {
      if (!AB.inArena(x, y)) return false;
      const i = idx(x, y);
      if (this.tiles[i] === T_SOLID) return false;
      if (a.type === 1 && (this.tiles[i] === T_BRICK || this.brickT[i] > 0)) return false;
      return this.bombAt[i] < 0;
    }
    alienTurn(a, opts, cx, cy, humans) {
      const back = (a.dir + 2) & 3;
      const pool = opts.length > 1 ? opts.filter(d => d !== back) : opts;
      if (!humans.length || this.rng.chance(V(1205, 3))) return pool[this.rng.int(pool.length)];
      let best = humans[0], bd = 1e9;
      for (const p of humans) { const d = Math.abs(AB.cellX(p.x) - cx) + Math.abs(AB.cellY(p.y) - cy); if (d < bd) { bd = d; best = p; } }
      const tx = AB.cellX(best.x), ty = AB.cellY(best.y);
      let pick = pool[0], pd = 1e9;
      for (const d of pool) { const dd = Math.abs(cx + DX[d] - tx) + Math.abs(cy + DY[d] - ty); if (dd < pd) { pd = dd; pick = d; } }
      return pick;
    }
    updateAliens() {
      const humans = this.players.filter(p => p.alive && !p.isAI);
      const unit = 100 * TPR;     // speeds are 1/100 pixel per reference frame
      for (const a of this.aliens) {
        if (!a.alive) { a.dieT++; continue; }
        a.anim++;
        a.acc += a.speed;
        while (a.acc >= unit) {
          a.acc -= unit;
          const cx = AB.cellX(a.x), cy = AB.cellY(a.y), ox = AB.offX(a.x), oy = AB.offY(a.y);
          if (ox === 0 && oy === 0) {
            const opts = [0, 1, 2, 3].filter(d => this.alienCan(a, cx + DX[d], cy + DY[d]));
            if (!opts.length) { a.acc = 0; break; }
            if (!opts.includes(a.dir) || (opts.length > 2 && this.rng.chance(V(1200, 3)))) a.dir = this.alienTurn(a, opts, cx, cy, humans);
          } else if (DX[a.dir] * ox + DY[a.dir] * oy > 0 && !this.alienCan(a, cx + DX[a.dir], cy + DY[a.dir])) a.dir = (a.dir + 2) & 3;
          a.x += DX[a.dir]; a.y += DY[a.dir];
        }
        for (const p of humans) {
          if (!p.alive || p.tramp || p.special === 6 || p.special === 7) continue;
          if (Math.abs(p.x - a.x) < 26 && Math.abs(p.y - a.y) < 24) { this.killPlayer(p, -1, true); this.ev({ t: 'alienkill', slot: p.slot }); }
        }
        const fi = idx(AB.cellX(a.x), AB.cellY(a.y));
        if (this.flameT[fi] > 0) {
          a.alive = false; a.dieT = 0;
          const k = this.pById(this.flameOwner[fi]);
          if (k) k.kills++;
          this.snd(341); this.ev({ t: 'aliendie', type: a.type, x: a.x, y: a.y });
        }
      }
    }

    // ------------------------------------------------------------------ hurry / enclosement
    // network games (S.aiFinale): once only computer players are left, nobody is watching a fair fight,
    // so HURRY sounds, and 3 s later the walls close in 4 times as fast and fill the whole arena
    updateAIFinale() {
      if (!this.S.aiFinale) return;
      if (this.finaleT === undefined) {
        if (!this.players.some(p => !p.isAI) || this.players.some(p => p.alive && !p.isAI)) return;
        if (this.players.filter(p => p.alive).length < 2) return;
        this.finaleT = 3 * AB.TPS;
        if (!this.hurry) { this.hurry = true; this.snd(2700, 2799); this.ev({ t: 'hurry' }); }
        this.hurryShown = 3 * AB.TPS;
        return;
      }
      if (this.finaleT > 0 && --this.finaleT === 0) {
        const e = this.enc;
        if (!e) this.enc = { x: 0, y: 0, dir: 1, ring: 0, t: 0, done: false, depth: 99 };
        else if (e.done) Object.assign(e, { done: false, depth: 99, x: e.ring, y: e.ring, dir: 1, t: 0 });   // carry on inwards
        else e.depth = 99;
        this.enc.fast = true;
      }
    }
    encEvery() { return this.enc && this.enc.fast ? Math.max(1, Math.round(K.ENCLOSE_EVERY / 4)) : K.ENCLOSE_EVERY; }
    updateEnclosement() {
      const e = this.enc;
      if (!e || e.done || this.state !== 'play') return;
      if (++e.t < this.encEvery()) return;
      e.t = 0;
      this.slam(e.x, e.y);
      // advance along the clockwise spiral
      for (let guard = 0; guard < 8; guard++) {
        const nx = e.x + DX[e.dir], ny = e.y + DY[e.dir];
        if (nx >= COLS - e.ring || ny >= ROWS - e.ring || nx < e.ring || ny < e.ring + (e.dir === 0 ? 1 : 0)) {
          e.dir = (e.dir + 1) & 3;
          if (e.dir === 1) {
            e.ring++;
            if (e.ring >= e.depth || e.ring * 2 >= ROWS) { e.done = true; return; }
            e.x = e.ring; e.y = e.ring; return;
          }
          continue;
        }
        e.x = nx; e.y = ny; return;
      }
    }
    slam(x, y) {
      const i = idx(x, y);
      if (this.tiles[i] === T_SOLID && this.brickT[i] <= 0) return;
      this.tiles[i] = T_SOLID; this.brickT[i] = 0; this.hidden[i] = -1; this.items[i] = -1; this.extras[i] = null;
      this.snd(141, 146);
      this.ev({ t: 'slam', x, y });
      for (const p of this.players) if (p.alive && AB.cellX(p.x) === x && AB.cellY(p.y) === y) this.killPlayer(p, -1, true);
      const bi = this.bombAt[i];
      if (bi >= 0) {
        const b = this.bombs[bi];
        if (this.S.stompedDetonate) this.explode(b); else { b.dead = true; this.bombAt[i] = -1; }
      }
      this.flameT[i] = 0;
    }
    // haunted house: bricks regenerate (#340+level seconds), never near players (#695)
    updateRegen() {
      if (!this.regen || this.state !== 'play') return;
      if (--this.regenTimer > 0) return;
      this.regenTimer = this.regen;
      const rad = V(695, 4);
      for (let k = 0; k < 30; k++) {
        const x = this.rng.int(COLS), y = this.rng.int(ROWS), i = idx(x, y);
        if (this.tiles[i] !== T_BLANK || this.items[i] >= 0 || this.bombAt[i] >= 0 || this.flameT[i] > 0 || this.extras[i]) continue;
        if (this.players.some(p => p.alive && Math.abs(AB.cellX(p.x) - x) < rad && Math.abs(AB.cellY(p.y) - y) < rad)) continue;
        this.tiles[i] = T_BRICK; this.ev({ t: 'regen', x, y });
        break;
      }
    }

    // ------------------------------------------------------------------ round end
    checkRoundEnd() {
      if (this.state === 'over') return;
      if (this.camp) { this.checkStageEnd(); return; }
      const alive = this.alivePlayers();
      const teams = new Set(alive.map(p => p.team));
      const decided = this.S.teamPlay ? teams.size <= 1 : alive.length <= 1;
      if (this.state === 'play' && decided) { this.state = 'ending'; this.endTimer = K.OUTSURVIVE; }
      if (this.state === 'ending') {
        if (--this.endTimer <= 0) {
          const alive2 = this.alivePlayers();
          if (!alive2.length) this.endRound(null, true);
          else if (this.S.teamPlay) this.endRound({ team: alive2[0].team, players: alive2.map(p => p.slot) }, false);
          else this.endRound({ slot: alive2[0].slot, players: [alive2[0].slot] }, false);
        }
      }
      // still wait for death animations to play out a little
    }
    // campaign (fcn.004016df): the stage is cleared once every computer player, ghost and rover is gone
    // and a human still stands; it fails when no human is left (or time runs out)
    checkStageEnd() {
      const humans = this.players.filter(p => !p.isAI), alive = humans.filter(p => p.alive);
      const foes = this.players.filter(p => p.isAI && p.alive).length + this.aliens.filter(a => a.alive).length;
      if (this.state === 'play' && (!alive.length || !foes)) { this.state = 'ending'; this.endTimer = alive.length ? K.OUTSURVIVE * 2 : K.OUTSURVIVE; }
      if (this.state === 'ending' && --this.endTimer <= 0) {
        if (!alive.length) this.endRound(null, true);
        else if (!foes) this.endRound({ slot: alive[0].slot, players: alive.map(p => p.slot) }, false);
        else this.state = 'play';
      }
    }
    endRound(winner, draw) {
      if (this.state === 'over') return;
      this.state = 'over'; this.overAt = this.tick;
      this.result = { winner, draw: !!draw || !winner, kills: this.players.map(p => ({ slot: p.slot, kills: p.kills })) };
      if (this.camp) { this.result.cleared = !!winner && !draw; this.result.fail = !this.result.cleared; }
      this.ev({ t: 'roundover', result: this.result });
    }
    // ---- save / restore (rollback netcode) ----
    // Everything that changes during play, as a structured-clone-able object. Config (cfg, settings,
    // scheme) is shared, the RNG keeps just its state, and caches (fields starting with _) are dropped:
    // a restored game recomputes them, so it behaves exactly like one that never rolled back.
    saveState() {
      const o = {};
      for (const k in this) if (!STATE_SKIP.has(k) && k[0] !== '_') o[k] = this[k];
      o.rng = this.rng.s;
      return structuredClone(o);
    }
    loadState(st) {
      const c = structuredClone(st), r = c.rng;
      delete c.rng;
      for (const k in this) if (k[0] === '_') delete this[k];
      Object.assign(this, c);
      this.rng.s = r;
      this.events = [];
    }
    // force a draw (F10 in the original)
    forceDraw() { this.events.length = 0; this.endRound(null, true); if (this.result) this.result.forced = true; }

    // a compact hash of the simulation state, used to detect network desyncs
    checksum() {
      let h = 2166136261 >>> 0;
      const mix = (v) => { h ^= (v | 0); h = Math.imul(h, 16777619) >>> 0; };
      mix(this.tick); mix(this.rng.s); if (this.enc) { mix(this.enc.x); mix(this.enc.y); mix(this.enc.ring); mix(this.enc.fast ? 1 : 0); }
      for (const p of this.players) {
        mix(p.x); mix(p.y); mix(p.alive ? 1 : 0); mix(p.special); mix(p.disT); mix(p.held); mix(p.warpLock);
        for (const v of p.pw) mix(v);
        for (let d = 0; d < AB.DIS_COUNT; d++) mix(p.dis[d] ? d + 1 : 0);
      }
      for (const b of this.bombs) if (b && !b.dead) { mix(b.x); mix(b.y); mix(b.t); mix(b.motion); mix(b.dir); }
      for (const a of this.aliens) { mix(a.x); mix(a.y); mix(a.alive ? a.dir + 1 : 0); }
      for (let i = 0; i < N; i++) { mix(this.tiles[i]); mix(this.items[i]); mix(this.flameT[i]); mix(this.brickT[i]); mix(this.bombAt[i]); }
      return h >>> 0;
    }
  }
  Game.T_BLANK = T_BLANK; Game.T_SOLID = T_SOLID; Game.T_BRICK = T_BRICK;
  AB.Game = Game;
})(window.AB);
