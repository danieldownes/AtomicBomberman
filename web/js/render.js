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
  const bottomX = (x) => cellL(x) + 20, bottomY = (y) => cellT(y) + 35;

  // "Classic" arena (port addition): CLASSICS.ANI players/icons + 8-bit tiles, bombs and flames
  const CLASSIC_PW = { [AB.PW.BOMB]: 'classic power bomb', [AB.PW.FLAME]: 'classic power flame', [AB.PW.KICK]: 'Classic power kick',
                       [AB.PW.SPOOGE]: 'classic power spooge', [AB.PW.DISEASE]: 'classic power death', [AB.PW.BADDISEASE]: 'classic power death' };
  let classic = false;
  const bombSeq = (b) => classic ? (b.kind === 1 ? 'nes bomb trigger' : b.kind === 2 ? 'nes bomb jelly' : 'nes bomb')
    : b.kind === 1 ? 'bomb trigger green' : b.kind === 2 ? 'bomb jelly green' : 'bomb regular green';

  Rn.draw = function (ctx, g, t) {
    const lvl = g.level;
    classic = lvl === AB.CLASSIC_LEVEL;
    AB.tilesets.drawField(ctx, lvl);
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
      const st = Math.floor(b.anim / 3);
      const h = b.motion === 2 && b.fly ? b.fly.h : 0;
      sprites.push({ y: b.y + (h ? 40 : -1), fn: () => {
        if (h) G.draw(ctx, 'shadow', 0, b.x, b.y + 16, -1, false);
        G.draw(ctx, seq, st, b.x, b.y + 17 - h, b.color, false);
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
    G.draw(ctx, bombSeq(b), Math.floor(b.anim / 3), x, yBottom, b.color, false);
  }

  // ---- top status bar: per-player score/kills (VALUELST 113-119), timer at #110/#111 ----
  function drawHud(ctx, g, t) {
    const xs = [AB.val(115, 10), AB.val(116, 110), AB.val(117, 210), AB.val(118, 310), AB.val(119, 410)];
    const ys = [AB.val(113, 6), AB.val(114, 26)];
    const match = g.cfg.match || { wins: {} };
    g.players.forEach((p, i) => {
      const x = xs[i % 5], y = ys[(i / 5) | 0];
      const css = AB.PLAYER_CSS[p.color];
      ctx.globalAlpha = p.alive ? 1 : 0.45;
      // tiny bomberman head in the player's colour
      ctx.save(); ctx.beginPath(); ctx.rect(x - 4, y - 2, 22, 19); ctx.clip();
      ctx.translate(x + 7, y + 25); ctx.scale(0.5, 0.5);
      G.draw(ctx, 'stand south', 0, 0, 0, p.color, true);
      ctx.restore();
      const wins = (match.wins && match.wins[p.slot]) || 0;
      const kills = (match.kills && match.kills[p.slot] !== undefined ? match.kills[p.slot] : 0) + p.kills;
      G.text(ctx, `S:${wins} K:${kills}`, x + 16, y, p.color === 1 ? '#a0a0a0' : css, 'font0');
      ctx.globalAlpha = 1;
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
