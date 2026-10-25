// Draws a Game state onto the 640x480 canvas using the original sprites.
'use strict';
(function (AB) {
  const G = AB.gfx;
  const { COLS, ROWS, CW, CH, OX, OY } = AB;
  const idx = (x, y) => y * COLS + x;
  const Rn = AB.render = {};

  // anchors: tiles/items/bombs use the cell's bottom-centre with the frame hotspot (no sequence
  // offsets), flames and bombermen use the cell centre + the per-state offsets stored in the .ANI.
  const cellL = (x) => OX + x * CW, cellT = (y) => OY + y * CH;
  const FALL = 20, LAND = 12, CHIPS = 32;   // ticks: a closing-in block's fall, its landing flash and dust, flying chips
  const CHIP_COL = ['#2c2824', '#5e574d', '#8e8475', '#c9bfae', '#e6dccb'];
  function drawChips(ctx, L) {
    const { x, y, cx, cy, age } = L, a = Math.min(1, 2 * (1 - age / CHIPS));
    let s = (x * 73856093) ^ (y * 19349663) ^ 0x5bd1e995;          // the same chips every frame
    const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) | 0; return ((s >>> 8) & 0xffff) / 0x10000; };
    ctx.save(); ctx.globalAlpha = a; ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    for (let k = 0; k < 28; k++) {
      const ang = rnd() * Math.PI * 2, sp = 1.4 + rnd() * 2.8, up = 2.2 + rnd() * 3.4, sz = 2.5 + rnd() * 4.5, spin = (rnd() - 0.5) * 0.7;
      const px = cx + Math.cos(ang) * (8 + sp * age), py = cy + 4 + Math.sin(ang) * 8 - up * age + 0.2 * age * age;
      ctx.save(); ctx.translate(px, py); ctx.rotate(spin * age + ang);
      // an irregular chip: a lopsided four-sided shard
      ctx.beginPath(); ctx.moveTo(-sz / 2, -sz * 0.3); ctx.lineTo(sz * 0.2, -sz / 2); ctx.lineTo(sz / 2, sz * 0.15); ctx.lineTo(-sz * 0.1, sz * 0.4); ctx.closePath();
      ctx.fillStyle = CHIP_COL[k % CHIP_COL.length]; ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // and a cloud of dust that rises and spreads
    ctx.fillStyle = 'rgb(205,195,178)';
    for (let k = 0; k < 5; k++) {
      const ang = rnd() * Math.PI * 2, d = 6 + age * 0.9;
      ctx.globalAlpha = 0.35 * a; ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * d, cy - age * 0.5 + Math.sin(ang) * d * 0.5, 5 + age * 0.45, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  const bottomX = (x) => cellL(x) + 20, bottomY = (y) => cellT(y) + 35;

  // "Classic" arena (port addition): CLASSICS.ANI players/icons + 8-bit tiles, bombs and flames
  const CLASSIC_PW = { [AB.PW.BOMB]: 'classic power bomb', [AB.PW.FLAME]: 'classic power flame', [AB.PW.KICK]: 'Classic power kick',
                       [AB.PW.SPOOGE]: 'classic power spooge', [AB.PW.DISEASE]: 'classic power death', [AB.PW.BADDISEASE]: 'classic power death' };
  let classic = false;
  const bombSeq = (b) => classic ? (b.kind === 1 ? 'nes bomb trigger' : b.kind === 2 ? 'nes bomb jelly' : 'nes bomb')
    : b.kind === 1 ? 'bomb trigger green' : b.kind === 2 ? 'bomb jelly green' : 'bomb regular green';

  // HD bombs. The CD's bomb animations are one bomb drawn again and again: smaller and back (the
  // regular and remote bombs pulse), leaning from side to side (jelly), with "DUD!" blinking on it
  // (a dud). The HD remaster redrew every frame on its own and the small ones came out wrong (two
  // fuse caps, clipped edges), so in HD only the biggest frame is drawn, moved into the place of each
  // original frame: BOMB_XF[atlas][frame] = [sx, sy, lean, tx, ty] maps the biggest frame's pixels
  // (x, y from its hotspot) to (sx*x + lean*y + tx, sy*y + ty), fitted to the CD's frames by
  // tools/build_bomb_transforms.py. Between two states it blends, so the bomb moves smoothly.
  const BOMB_XF = {"bombs":[[1.0,1.0,0.0,-0.0,0.0],[0.9563,0.9563,0.0,-0.0029,0.0598],[0.9142,0.9142,0.0,-0.0057,0.1174],[0.8675,0.8675,0.0,-0.0088,0.1812],[0.8262,0.8262,0.0,-0.0115,0.2376],[0.773,0.773,0.0,-0.0151,0.3104],[0.7256,0.7256,0.0,-0.0182,0.3753],[0.6794,0.6794,0.0,-0.0213,0.4384],[0.6352,0.6352,0.0,-0.0242,0.4987],[0.5918,0.5918,0.0,-0.0271,0.5581],[0.893,0.8523,0.1504,-0.317,-0.5731],[0.8858,0.8608,0.104,-0.2979,-0.399],[0.8759,0.8664,0.0495,-0.2969,-0.1857],[0.8666,0.8685,-0.0015,0.0547,-0.1572],[0.8736,0.8666,-0.0538,0.3857,-0.1889],[0.8727,0.8671,-0.104,0.505,-0.1384],[0.8745,0.8644,-0.1565,0.626,-0.3026]],"triganim":[[1.0,1.0,0.0,-0.0,-0.0],[0.9579,0.9579,0.0,-0.0025,-0.7895],[0.9127,0.9127,0.0,-0.0052,-1.6371],[0.8709,0.8709,0.0,-0.0077,-2.4219],[0.8276,0.8276,0.0,-0.0103,-3.2339],[0.777,0.777,0.0,-0.0133,-4.1818],[0.7257,0.7257,0.0,-0.0163,-5.1439],[0.6819,0.6819,0.0,-0.0189,-5.9662],[0.6345,0.6345,0.0,-0.0217,-6.8532],[0.5983,0.5983,0.0,-0.0239,-7.533]],"duds":[[1.0,1.0,0.0,0.0,0.0],[1.0,1.0,0.0,0.0,0.0]]};
  const BOMB_BASE = { bombs: ['bombs', 0], triganim: ['triganim', 0], duds: ['bombs', 0] };
  function drawBomb(ctx, seq, anim, x, y, color) {
    const s = G.seq(seq), xf = s && BOMB_XF[s.ani], base = s && BOMB_BASE[s.ani];
    if (!xf || !AB.hd || !AB.hd.atlas(base[0])) { G.draw(ctx, seq, Math.floor(anim / 3), x, y, color, false); return; }
    const n = s.states.length, pos = anim / 3, i = Math.floor(pos) % n, f = pos - Math.floor(pos);
    const a = xf[s.states[i][0]], b = xf[s.states[(i + 1) % n][0]], m = a.map((v, k) => v + (b[k] - v) * f);
    ctx.save();
    ctx.translate(x, y); ctx.transform(m[0], 0, m[2], m[1], m[3], m[4]);
    ctx.imageSmoothingEnabled = true;
    G.frame(ctx, base[0], base[1], 0, 0, color);
    // the dud's "DUD!" frame: the lettering of the CD's frame (font1's letters, 7 px tall, outlined)
    if (s.ani === 'duds' && s.states[i][0] === 0) {
      ctx.translate(0, -20); ctx.scale(0.75, 7 / 12); ctx.translate(0, -1);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) G.text(ctx, 'DUD!', dx, dy, '#000000', 'font1', 1, false);
      G.text(ctx, 'DUD!', 0, 0, '#ffffff', 'font1', 1, false);
    }
    ctx.restore();
  }

  Rn.draw = function (ctx, g, t) {
    const lvl = g.level;
    classic = lvl === AB.CLASSIC_LEVEL;
    // Classic is 8-bit art, HD or not (it has no HD pictures): its pixels stay sharp
    const smooth = ctx.imageSmoothingEnabled;
    if (classic) ctx.imageSmoothingEnabled = false;
    AB.tilesets.drawField(ctx, lvl);
    // the status bar's own panel, under the sprites: flush with the top and sides, half see-through
    // (the arenas' pictures each have a black panel of a different size there)
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, AB.W, BAR_H);
    // floor extras
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const e = g.extras[idx(x, y)];
      if (!e) continue;
      if (e.t === 'arrow') G.draw(ctx, 'extra arrow ' + AB.DIRNAME[e.dir], 0, bottomX(x), bottomY(y), -1, false);
      else if (e.t === 'conveyor') G.draw(ctx, 'extra conveyor ' + AB.DIRNAME[e.dir], Math.floor(t / 4), bottomX(x), bottomY(y), -1, false);
      else if (e.t === 'warp') G.draw(ctx, 'extra warp 1', 0, bottomX(x), bottomY(y), -1, false);
      else if (e.t === 'trampoline') {
        const bouncing = g.players.some(p => p.tramp && AB.cellX(p.x) === x && AB.cellY(p.y) === y && p.specialT < 12);
        G.draw(ctx, 'extra trampoline', bouncing ? Math.floor(t / 2) : 0, bottomX(x), bottomY(y), -1, false);
      }
    }
    // tiles
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = idx(x, y), tt = g.tiles[i];
      if (g.brickT[i] > 0) {
        const n = AB.tilesets.breakFrames(lvl);
        const st = Math.min(n - 1, Math.floor((AB.K.BRICK - g.brickT[i]) * n / AB.K.BRICK));
        AB.tilesets.draw(ctx, lvl, 'breaking', st, bottomX(x), bottomY(y));
      } else if (tt === 1) AB.tilesets.draw(ctx, lvl, 'solid', 0, bottomX(x), bottomY(y));
      else if (tt === 2) AB.tilesets.draw(ctx, lvl, 'brick', 0, bottomX(x), bottomY(y));
    }
    // the closing walls: a shadow growing under each block about to land, and a flash and a puff of
    // dust where one just has
    const falling = g.encUpcoming ? g.encUpcoming(8).filter(u => u.in <= FALL) : [];
    for (const u of falling) {
      const p = 1 - u.in / FALL, q = p * p, w = 40 * (0.45 + 0.55 * q), h = 30 * (0.45 + 0.55 * q);
      ctx.save(); ctx.globalAlpha = 0.7 * p; ctx.fillStyle = '#000';
      ctx.beginPath(); ctx.ellipse(cellL(u.x) + 20, cellT(u.y) + 20, w / 2, h / 2, 0, 0, Math.PI * 2); ctx.fill(); ctx.restore();
    }
    const landed = [];
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = idx(x, y), age = g.tick - g.slamAt[i], onBlock = g.slamOnBlock && g.slamOnBlock[i];
      if (age < 0 || age >= (onBlock ? CHIPS : LAND)) continue;
      const cx = cellL(x) + 20, cy = cellT(y) + 18;
      ctx.save();
      if (age < LAND) {
        const a = 1 - age / LAND;
        ctx.globalAlpha = 0.45 * a; ctx.fillStyle = '#fff'; ctx.fillRect(cellL(x), cellT(y), 40, 36);
        ctx.fillStyle = 'rgba(200,190,170,1)';
        for (let k = 0; k < 6; k++) {
          const ang = (k / 6) * Math.PI * 2 + (x * 7 + y * 3) % 6, d = 18 + age * 1.6;
          ctx.globalAlpha = 0.55 * a; ctx.beginPath(); ctx.arc(cx + Math.cos(ang) * d, cy + 14 + Math.sin(ang) * d * 0.45, 2.5 + age * 0.35, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      if (onBlock) landed.push({ x, y, cx, cy, age });
    }
    // powerups on the floor
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const it = g.items[idx(x, y)];
      if (it < 0) continue;
      const name = (classic && CLASSIC_PW[it]) || AB.PW_SEQ[it];
      G.draw(ctx, name, it === AB.PW.RANDOM ? Math.floor(t / 3) : 0, bottomX(x), bottomY(y) - (classic && CLASSIC_PW[it] ? 2 : 0), -1, classic && !!CLASSIC_PW[it]);
    }
    // flames
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
      const i = idx(x, y);
      if (g.flameT[i] <= 0 || !g.flameKind[i]) continue;
      const name = classic ? 'nes flame ' + g.flameKind[i] : 'flame ' + g.flameKind[i] + ' green';
      // fcn.00426d06: one state per reference frame (20 fps), looping over the flame's lifetime
      const el = AB.K.FLAME - g.flameT[i];
      const st = Math.floor(el / AB.TPR);
      G.draw(ctx, name, st, cellL(x) + 20, cellT(y) + 18, g.flameGold[i] ? 'gold' : g.flameColor[i], true);
    }
    // ground bombs and their shadows for flying ones
    const sprites = [];
    for (const b of g.bombs) {
      if (!b || b.dead) continue;
      if (b.motion === 3) continue;       // drawn with the holder
      let seq = bombSeq(b);
      if (b.dud && b.t > AB.K.FUSE && !classic) seq = 'bomb regular green dud';
      const h = b.motion === 2 && b.fly ? b.fly.h : 0;
      sprites.push({ y: b.y + (h ? 40 : -1), fn: () => {
        if (h) G.draw(ctx, 'shadow', 0, b.x, b.y + 16, -1, false);
        drawBomb(ctx, seq, b.anim, b.x, b.y + 17 - h, b.color);
      } });
    }
    // campaign ghosts and rovers (ALIENS1.ANI)
    for (const a of g.aliens) {
      if (!a.alive && a.dieT > 45) continue;
      sprites.push({ y: a.y, fn: () => {
        const name = (a.type === 2 ? 'ghost ' : 'rover ') + AB.DIRNAME[a.dir];
        const bob = a.type === 2 ? Math.round(Math.sin(a.anim / 9) * 2) - 2 : ((a.anim >> 2) & 1);
        ctx.save();
        if (!a.alive) { ctx.globalAlpha = Math.max(0, 1 - a.dieT / 45); if ((a.dieT >> 2) & 1) ctx.filter = 'brightness(2.2)'; }
        else if (a.type === 2) ctx.globalAlpha = 0.86;
        G.draw(ctx, name, 0, a.x, a.y + 18 + bob, -1, true);
        ctx.restore();
      } });
    }
    // players
    for (const p of g.players) {
      if (!p.alive && (!p.dieAnim || deathDone(p))) continue;
      sprites.push({ y: p.y + (p.tramp ? 30 : 0), fn: () => drawPlayer(ctx, g, p, t) });
    }
    sprites.sort((a, b) => a.y - b.y);
    for (const s of sprites) s.fn();
    // the closing walls' blocks dropping in: bigger and fainter the higher they are, landing on the tick
    // the game sets the block (on an empty cell, a brick, or a block already there)
    for (const u of falling) {
      const p = 1 - u.in / FALL, q = p * p, sc = 1 + 0.6 * (1 - q), lift = 72 * (1 - q);
      const cx = cellL(u.x) + 20, cy = cellT(u.y) + 18;
      ctx.save(); ctx.globalAlpha = Math.min(1, p * 1.8);
      ctx.translate(cx, cy - lift); ctx.scale(sc, sc);
      AB.tilesets.draw(ctx, lvl, 'solid', 0, 0, 17);
      ctx.restore();
    }
    // a block that landed on a block: chips of rock fly up and out, tumbling, and fall back
    for (const L of landed) drawChips(ctx, L);
    ctx.imageSmoothingEnabled = smooth;
    drawHud(ctx, g, t);
    if (g.hurryShown > 0 && Math.floor(g.hurryShown / 8) % 2 === 0) G.draw(ctx, 'hurry', 0, 320, 260, -1, false);
  };

  function deathDone(p) {
    if (classic) return p.dieT > 11 * AB.TPR * 3 + 30;
    const n = G.seqLen('die green ' + p.dieAnim) || 40;
    return p.dieT > n * AB.TPR + 30;
  }
  // classic players: only walk, stand and death exist, so the special moves show the standing pose
  function drawClassicPlayer(ctx, g, p, t, color, dn) {
    if (!p.alive) { G.draw(ctx, 'classic death', Math.min(10, Math.floor(p.dieT / (AB.TPR * 3))), p.x, p.y + 17 + p.dieY, color, 'steady'); return; }
    let y = p.y + 17;
    if (p.tramp) { G.draw(ctx, 'shadow', 0, p.x, p.y + 14, -1, false); y -= p.tramp.h; }
    const sp = p.special;
    let d = dn, jx = 0;
    if (sp === 6 || sp === 7) d = AB.DIRNAME[(Math.floor(p.specialT / 3)) & 3];
    if (sp === 3 || sp >= 20) jx = (t >> 1) % 2 ? 1 : -1;
    if (p.moving && !sp) G.draw(ctx, 'classic walk ' + d, [0, 1, 0, 2][Math.floor(p.walkPix / 6) % 4], p.x, y, color, 'steady');
    else G.draw(ctx, 'classic stand ' + d, 0, p.x + jx, y, color, 'steady');
    if (p.held >= 0) { const b = g.bombs[p.held]; if (b && !b.dead) drawHeldBomb(ctx, b, p.x, y - 52); }
  }

  function drawPlayer(ctx, g, p, t) {
    const dn = AB.DIRNAME[p.dir];
    let color = p.color;
    if (p.alive && p.disT > 0 && (t >> 2) % 2) color = (t * 7 + p.slot * 3) % 10;      // diseased players flash
    if (g.S.teamPlay && g.tick > AB.val(32, 40) * AB.TPR) color = p.team ? 2 : 0;   // team colours after a while (TEAM0.PCX white, TEAM1.PCX red)
    if (classic) { if (p.alive && p.dis[AB.DIS.INVISIBLE] && (t % 90) > 6) return; drawClassicPlayer(ctx, g, p, t, color, dn); return; }
    if (!p.alive) {
      const name = 'die green ' + p.dieAnim;
      const n = G.seqLen(name) || 40;
      const st = Math.min(n - 1, Math.floor(p.dieT / AB.TPR));
      G.draw(ctx, name, st, p.x, p.y + p.dieY, color, 'steady');
      return;
    }
    if (p.dis[AB.DIS.INVISIBLE] && (t % 90) > 6) return;
    let y = p.y;
    if (p.tramp) {
      G.draw(ctx, 'shadow', 0, p.x, p.y + 14, -1, false);
      y -= p.tramp.h;
    }
    const sp = p.special;
    if (sp === 6 || sp === 7) { G.draw(ctx, 'spin', Math.floor(p.specialT / 2), p.x, y, color, 'steady'); return; }
    if (sp >= 20) { G.draw(ctx, 'cornerhead ' + (sp - 20), Math.floor(p.specialT / AB.TPR), p.x, y, color, 'steady'); return; }
    if (sp === 1) { G.draw(ctx, 'kick ' + dn, Math.floor(p.specialT / AB.TPR), p.x, y, color, 'steady'); return; }
    if (sp === 2) { G.draw(ctx, 'punch ' + dn, Math.floor(p.specialT / AB.TPR) + 1, p.x, y, color, 'steady'); return; }
    if (sp === 4) {
      G.draw(ctx, 'pickup ' + dn, Math.floor(p.specialT / AB.TPR), p.x, y, color, 'steady');
      // the bomb follows the pickup curve (VALUELST #500-#506: forward, height pairs)
      const b = g.bombs[p.held];
      if (b && !b.dead) {
        const curve = [AB.val(500, [12, 10]), AB.val(502, [25, 20]), AB.val(504, [25, 30]), AB.val(506, [12, 40])];
        const k = Math.min(3, Math.floor(p.specialT / (AB.TPR * 2)));
        const fwd = curve[k][0] * 0.5, h = curve[k][1];
        drawHeldBomb(ctx, b, p.x + AB.DX[p.dir] * fwd, y + 17 + AB.DY[p.dir] * fwd * 0.6 - (h / 40) * 57);
      }
      return;
    }
    if (sp === 3) { G.draw(ctx, 'stand ' + dn, 0, p.x + ((t >> 1) % 2 ? 1 : -1), y, color, 'steady'); return; }
    if (p.held >= 0) {
      if (p.moving) G.draw(ctx, 'walkbomb ' + dn, Math.floor(p.walkPix / 3), p.x, y, color, 'steady');
      else G.draw(ctx, 'standbomb ' + dn, 0, p.x, y, color, 'steady');
      const b = g.bombs[p.held];
      if (b && !b.dead) drawHeldBomb(ctx, b, p.x, y - 40 + (p.moving ? ((p.walkPix >> 2) % 2) : 0));
      return;
    }
    if (p.moving) { G.draw(ctx, 'walk ' + dn, Math.floor(p.walkPix / 3), p.x, y, color, 'steady'); return; }
    const idle = p.idleT - AB.IDLE_AFTER * AB.TPS;
    if (idle >= 0 && g.S.idleAnims !== false) {
      const a = AB.IDLE_ANIMS[p.idleN % AB.IDLE_ANIMS.length], seq = G.seqFrom(a.ani, a.seq);
      const st = Math.floor(idle / AB.TPR);
      // the idle .ANI files put the feet on the hotspot; the stand sequence draws them 19 px lower
      if (seq && st < seq.states.length) { G.draw(ctx, seq, st, p.x + 2, y + 19, color, 'steady'); return; }
    }
    G.draw(ctx, 'stand ' + dn, 0, p.x, y, color, 'steady');
  }

  function drawHeldBomb(ctx, b, x, yBottom) {
    drawBomb(ctx, bombSeq(b), b.anim, x, yBottom, b.color);
  }

  // ---- top status bar: per-player score/kills (VALUELST 113-119), timer at #110/#111 ----
  // a player's name (network and typed names; otherwise "Player 3" / "AI 3"), for the status bar and
  // the name tags (js/screens.js)
  Rn.playerName = function (g, p) {
    const M = g.cfg && g.cfg.match, mp = M && M.players && M.players.find(q => q.slot === p.slot);
    if (mp && mp.name && (M.net || mp.custom)) return mp.name;
    return p.isAI ? 'AI ' + (p.slot + 1) : AB.msg(33, 'Player %u').replace('%u', p.slot + 1);
  };
  // a player's head (from the standing sprite: antenna to visor, 52..10 px above where it's drawn
  // from), in a square `size` px across with its middle at (cx, cy)
  function drawHead(ctx, p, cx, cy, size) {
    const k = size / 42;
    ctx.save(); ctx.beginPath(); ctx.rect(cx - 21 * k, cy - 21 * k, 42 * k, 42 * k); ctx.clip();
    ctx.translate(cx - 2 * k, cy + 31 * k); ctx.scale(k, k);
    G.draw(ctx, 'stand south', 0, 0, 0, p.color, true);
    ctx.restore();
  }
  const fitName = (t, w) => { if (G.textWidth(t, 'font0') <= w) return t; while (t.length > 1 && G.textWidth(t + '..', 'font0') > w) t = t.slice(0, -1); return t + '..'; };
  // the status bar (the dark panel left of the timer): each player's head, name and score (S: rounds
  // won, K: kills), as big as fits. The players are laid out in one or two rows, the name beside the
  // score or above it, whichever lets them be drawn largest (up to twice size). A dead player's head
  // and name are crossed out.
  const BAR_H = 48, BAR = { x: 6, y: 3, w: 516, h: 42 }, LINE = 14;      // LINE: font0's line at full size
  const OUTLINED = new Set([1, 3, 9]);      // black, blue and purple names get a light outline, to read on black
  function drawHud(ctx, g, t) {
    const match = g.cfg.match || { wins: {} }, hd = !!(AB.hd && AB.hd.active()), n = g.players.length;
    const tw = (str) => G.textWidth(str, 'font0');
    const rows0 = g.players.map(p => {
      const wins = (match.wins && match.wins[p.slot]) || 0;
      const kills = (match.kills && match.kills[p.slot] !== undefined ? match.kills[p.slot] : 0) + p.kills;
      return { p, name: Rn.playerName(g, p), stats: `S:${wins} K:${kills}` };
    });
    const nameW = Math.min(96, Math.max(0, ...rows0.map(e => tw(e.name)))), statW = Math.max(tw('S:9 K:99'), ...rows0.map(e => tw(e.stats)));
    let L = null;
    for (const rows of n > 1 ? [1, 2] : [1]) {
      const cols = Math.ceil(n / rows), cw = BAR.w / cols, ch = BAR.h / rows;
      for (const stacked of [false, true]) {
        const icon = (stacked ? 2 : 1) * LINE * 1.15;
        const needW = icon + 4 + (stacked ? Math.max(nameW, statW) : nameW + 6 + statW) + 4, needH = (stacked ? 2 : 1) * LINE + 2;
        const sc = Math.min(cw / needW, ch / needH, 2);
        if (!L || sc > L.s + 0.01) L = { cols, cw, ch, stacked, s: sc };
      }
    }
    if (!L) return;
    // text in the original bitmap font stays sharp at full or double size; HD's outline font scales freely
    const ts = hd ? L.s : L.s >= 2 ? 2 : 1;
    rows0.forEach((e, i) => {
      const p = e.p, x0 = BAR.x + (i % L.cols) * L.cw, cy = BAR.y + Math.floor(i / L.cols) * L.ch + L.ch / 2;
      const iconH = (L.stacked ? 2 : 1) * LINE * L.s * 1.15, iconW = iconH, tx = x0 + iconW + 4 * L.s;
      const col = AB.PLAYER_CSS[p.color], outlined = OUTLINED.has(p.color);
      const room = (L.cw - (tx - x0) - 4) / ts - (L.stacked ? 0 : 6 + tw(e.stats));
      const name = fitName(e.name, Math.max(12, room));
      const ny = L.stacked ? cy - LINE * ts / 2 : cy, sy = L.stacked ? cy + LINE * ts / 2 : cy;
      const sx = L.stacked ? tx : tx + (tw(name) + 6) * ts;
      ctx.globalAlpha = p.alive ? 1 : 0.5;
      drawHead(ctx, p, x0 + iconW / 2, cy, iconH);
      const say = (str, x, y, c, outline) => {
        ctx.save(); ctx.translate(x, y - 7 * ts); ctx.scale(ts, ts);
        if (outline) {
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]) G.text(ctx, str, dx, dy, '#c8c8c8', 'font0', 0, false);
          G.text(ctx, str, 0, 0, c, 'font0', 0, false);
        } else G.text(ctx, str, 0, 0, c, 'font0');
        ctx.restore();
      };
      say(name, tx, ny, col, outlined);
      say(e.stats, sx, sy, '#d0d0d0');
      ctx.globalAlpha = 1;
      if (!p.alive) {
        // crossed out: an X over the head, a line through the name
        ctx.save(); ctx.lineCap = 'round';
        const ix = x0 + iconW / 2, d = iconH * 0.42, line = (x1, y1, x2, y2, w) => {
          ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = w + 2; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.strokeStyle = '#f03028'; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        };
        const w = Math.max(1.5, 2 * L.s);
        line(ix - d, cy - d, ix + d, cy + d, w); line(ix + d, cy - d, ix - d, cy + d, w);
        line(tx - 1, ny, tx + tw(name) * ts + 1, ny, Math.max(1.2, 1.4 * ts));
        ctx.restore();
      }
    });
    // timer
    const tx = AB.val(110, 525), ty = AB.val(111, 36), sp = AB.val(112, 4);
    if (g.timeLeft < 0) { G.draw(ctx, 'infinity', 0, tx + 40, ty, -1, false); return; }
    const s = Math.ceil(g.timeLeft / AB.TPS);
    const str = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    let x = tx;
    const seq = G.seqFrom('kfont', 'numeric font');
    for (const ch of str) {
      const st = ch === ':' ? 10 : +ch;
      if (seq) {
        const fr = seq.states[st] ? seq.states[st][0] : 0;
        const sz = G.frameSize('kfont', fr);
        if (g.hurry && (t >> 3) % 2) ctx.globalAlpha = 0.6;
        G.frame(ctx, 'kfont', fr, x + (sz ? sz.hx : 0), ty);
        ctx.globalAlpha = 1;
        x += (sz ? sz.w : 18) + sp;
      }
    }
  }
})(window.AB);
