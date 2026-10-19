// Port additions to the menus: the Sounds & Voices browser, the arena picker and Campaign mode.
'use strict';
(function (AB) {
  const SC = AB.screens, G = AB.gfx, A = AB.audio;
  const U = SC.ui;
  const { YELLOW, WHITE, GREY, ORANGE, CYAN } = U;
  const fit = (t, w, font = 'font1') => { t = String(t); if (G.textWidth(t, font) <= w) return t; while (t.length > 1 && G.textWidth(t + '...', font) > w) t = t.slice(0, -1); return t + '...'; };

  // ================================================================= ARENAS
  // tick the arenas a match may use; each round picks one of them at random
  const NOTE = { 2: 'left out of random by the original', 6: 'left out of random by the original' };
  SC.register('arenas', {
    help: 'options',
    // a: { back } - the screen to return to (Arena & Match, or a network room's match settings)
    enter(a) { this.sel = this.sel || 0; this.err = 0; this.back = (a && a.back) || 'options'; },
    rows() {
      const S = AB.settings, rows = [];
      for (let i = 0; i < AB.LEVELS; i++) rows.push({ lvl: i, label: AB.levelName(i) });
      rows.push({ label: 'Tick all', action: () => { S.arenas = {}; for (let i = 0; i < AB.LEVELS; i++) S.arenas[i] = true; } });
      rows.push({ label: 'Original random set', action: () => { S.arenas = {}; } });
      rows.push({ label: 'Done', action: () => this.close() });
      return rows;
    },
    close() {
      const S = AB.settings;
      let n = 0; for (let i = 0; i < AB.LEVELS; i++) if (AB.arenaOn(S, i)) n++;
      if (!n) { this.err = 120; A.play(40); return; }
      AB.saveSettings(); SC.go(this.back);
      if (AB.netplay && AB.netplay.refreshRoom) AB.netplay.refreshRoom();
    },
    key(k) {
      const rows = this.rows(), row = rows[this.sel], S = AB.settings;
      if (k.code === 'ArrowUp') this.sel = (this.sel + rows.length - 1) % rows.length;
      else if (k.code === 'ArrowDown') this.sel = (this.sel + 1) % rows.length;
      else if (U.isBack(k)) this.close();
      else if (U.isOK(k) || k.code === 'ArrowLeft' || k.code === 'ArrowRight') {
        if (row.lvl !== undefined) { S.arenas = Object.assign({}, S.arenas, { [row.lvl]: !AB.arenaOn(S, row.lvl) }); A.play(20); }
        else if (U.isOK(k)) { row.action(); A.play(10); }
      }
    },
    tick() { if (this.err > 0) this.err--; },
    render(ctx) {
      U.glueDim(ctx, 6);
      U.panel(ctx, 24, 24, 592, 412, 0.7);
      U.centerText(ctx, 'ARENAS', 36, YELLOW);
      G.text(ctx, 'Each round is played in one of the ticked arenas.', 320, 58, GREY, 'font0', 1);
      const S = AB.settings, rows = this.rows();
      rows.forEach((row, i) => {
        const y = 78 + i * 20 + (row.lvl === undefined ? 6 : 0), sel = i === this.sel;
        if (sel) { ctx.fillStyle = 'rgba(248,216,72,0.16)'; ctx.fillRect(32, y - 2, 300, 20); U.menuCursor(ctx, 48, y + 15); }
        let x = 66;
        if (row.lvl !== undefined) { U.drawTick(ctx, x, y, AB.arenaOn(S, row.lvl) ? 2 : 0, sel); x += 22; }
        G.text(ctx, row.label, x, y, sel ? YELLOW : row.lvl !== undefined && !AB.arenaOn(S, row.lvl) ? GREY : WHITE, 'font1');
      });
      // preview of the highlighted arena
      const row = rows[this.sel];
      const lvl = row.lvl !== undefined ? row.lvl : (Math.floor(U.frame() / 90) % AB.LEVELS);
      SC.uiLate().arenaPreview(ctx, lvl, 360, 96, 6, 6);
      ctx.strokeStyle = 'rgba(248,216,72,0.6)'; ctx.strokeRect(359.5, 95.5, 241, 217);
      G.text(ctx, AB.levelName(lvl), 480, 322, WHITE, 'font1', 1);
      const note = lvl === AB.CLASSIC_LEVEL ? 'port addition: 8-bit theme' : lvl === AB.BEDROCK_LEVEL ? 'port addition: new terrain' : NOTE[lvl];
      if (note) G.text(ctx, '(' + note + ')', 480, 344, CYAN, 'font0', 1);
      G.text(ctx, 'Up/Down: choose   Enter/Space: tick   Esc: back', 320, 412, GREY, 'font0', 1);
      if (this.err > 0) { U.panel(ctx, 140, 200, 360, 44, 0.92); U.centerText(ctx, 'Tick at least one arena', 214, ORANGE); }
    },
  });

  // ================================================================= SCHEMES
  // tick the .SCH layouts a match may use (each round plays one of them); presets tick a whole set at once.
  // a: { back, players, team } - where to return, and how many play (for "recommended" and the fit marks)
  const PW_LABEL = ['bomb', 'flame', 'disease', 'kick', 'skate', 'punch', 'grab', 'spooge', 'gold flame', 'trigger', 'jelly', 'bad disease', 'random', 'slow'];
  SC.register('schemes', {
    help: 'options',
    enter(a) {
      a = a || {};
      this.back = a.back || 'options';
      this.players = a.players || AB.setup.filter(st => st.control !== 'off').length || 2;
      this.team = a.team !== undefined ? a.team : !!AB.settings.teamPlay;
      if (this.sel === undefined) { this.sel = 2; this.top = 0; this.preset = 0; }
      // start on the scheme that's ticked first
      const on = AB.schemesOn(AB.settings), keys = AB.schemeKeys();
      if (this.sel < 2) this.sel = 2 + Math.max(0, keys.indexOf(on[0]));
      this.err = 0;
    },
    rows() { return [{ k: 'preset' }, { k: 'done' }].concat(AB.schemeKeys().map(key => ({ k: 'sch', key }))); },
    ticked() { const S = AB.settings; if (!S.schemes) { S.schemes = {}; for (const k of AB.schemesOn(S)) S.schemes[k] = true; } return S.schemes; },
    close() {
      const S = AB.settings, on = this.ticked();
      if (!Object.values(on).some(Boolean)) { this.err = 120; A.play(40); return; }
      S.scheme = AB.schemesOn(S)[0];
      AB.saveSettings(); SC.go(this.back);
      if (AB.netplay && AB.netplay.refreshRoom) AB.netplay.refreshRoom();
    },
    key(k) {
      const rows = this.rows(), row = rows[this.sel], P = AB.SCHEME_PRESETS;
      const page = 14;
      if (k.code === 'ArrowUp') this.sel = (this.sel + rows.length - 1) % rows.length;
      else if (k.code === 'ArrowDown') this.sel = (this.sel + 1) % rows.length;
      else if (k.code === 'PageDown') this.sel = Math.min(rows.length - 1, this.sel + page);
      else if (k.code === 'PageUp') this.sel = Math.max(0, this.sel - page);
      else if (U.isBack(k)) this.close();
      else if (row.k === 'preset' && (k.code === 'ArrowLeft' || k.code === 'ArrowRight')) { this.preset = (this.preset + (k.code === 'ArrowLeft' ? P.length - 1 : 1)) % P.length; A.play(20); }
      else if (row.k === 'preset' && U.isOK(k)) {
        const keys = P[this.preset].keys(this.players, this.team);
        if (!keys.length) { A.play(40); return; }
        AB.settings.schemes = {}; for (const key of keys) AB.settings.schemes[key] = true;
        AB.saveSettings(); A.play(10);
        if (AB.netplay && AB.netplay.refreshRoom) AB.netplay.refreshRoom();
      } else if (row.k === 'done' && U.isOK(k)) { A.play(10); this.close(); }
      else if (row.k === 'sch' && (U.isOK(k) || k.code === 'ArrowLeft' || k.code === 'ArrowRight')) {
        const on = this.ticked(); on[row.key] = !on[row.key]; AB.saveSettings(); A.play(20);
        if (AB.netplay && AB.netplay.refreshRoom) AB.netplay.refreshRoom();
      }
    },
    tick() { if (this.err > 0) this.err--; },
    render(ctx) {
      U.glueDim(ctx, 6);
      U.panel(ctx, 24, 24, 592, 412, 0.78);
      U.centerText(ctx, 'SCHEMES', 36, YELLOW);
      const S = AB.settings, rows = this.rows(), on = this.ticked(), P = AB.SCHEME_PRESETS;
      const nOn = AB.schemeKeys().filter(k => on[k]).length;
      G.text(ctx, `Each round is played on one of the ticked schemes (${nOn} ticked).  Green = suits ${this.players} players.`, 320, 58, GREY, 'font0', 1);
      // the preset row and Done, then the scrolling list
      const pr = P[this.preset], prKeys = pr.keys(this.players, this.team);
      const drawRow = (i, y, h) => { const sel = i === this.sel; if (sel) { ctx.fillStyle = 'rgba(248,216,72,0.16)'; ctx.fillRect(32, y - 3, 312, h); U.menuCursor(ctx, 44, y + 15); } return sel; };
      let sel = drawRow(0, 78, 22);
      G.text(ctx, 'Preset:', 62, 78, sel ? YELLOW : WHITE, 'font1');
      G.text(ctx, fit(`${pr.name(this.players)} (${prKeys.length})`, 210), 132, 82, sel ? YELLOW : CYAN, 'font0');
      sel = drawRow(1, 102, 22);
      G.text(ctx, 'Done', 62, 102, sel ? YELLOW : WHITE, 'font1');
      const V = 16, list = rows.length - 2;
      const si = Math.max(0, this.sel - 2);
      if (this.sel >= 2) { if (si < this.top) this.top = si; if (si >= this.top + V) this.top = si - V + 1; }
      this.top = AB.clamp(this.top, 0, Math.max(0, list - V));
      for (let j = 0; j < V && this.top + j < list; j++) {
        const i = this.top + j + 2, row = rows[i], y = 130 + j * 17;
        const s2 = drawRow(i, y, 17);
        const f = AB.schemeFit(row.key), name = window.AB_DATA.schemes[row.key].name.replace(/\s*\((\d+\+?|\d+\s*ONLY)\)(\s*\(\d+\))?\s*$/i, '');
        U.drawTick(ctx, 60, y - 2, on[row.key] ? 2 : 0, s2);
        G.text(ctx, fit(name, 190, 'font0'), 82, y + 1, s2 ? YELLOW : on[row.key] ? WHITE : GREY, 'font0');
        G.text(ctx, f.label, 336, y + 1, f.fits(this.players) ? '#60f060' : '#887', 'font0', 2);
      }
      if (this.top > 0) G.text(ctx, '...', 190, 122, GREY, 'font0', 1);
      if (this.top + V < list) G.text(ctx, '...', 190, 130 + V * 17 - 4, GREY, 'font0', 1);
      // the highlighted scheme: its layout, who it's for, what everyone starts with
      const cur = rows[this.sel].k === 'sch' ? rows[this.sel].key : AB.schemesOn(S)[0];
      const sc = window.AB_DATA.schemes[cur], cw = 15, ch = 13, px = 364, py = 84;
      ctx.fillStyle = '#203018'; ctx.fillRect(px, py, 15 * cw, 11 * ch);
      for (let yy = 0; yy < 11; yy++) for (let xx = 0; xx < 15; xx++) {
        const c = sc.rows[yy][xx];
        if (c === '#') { ctx.fillStyle = '#9a9aa8'; ctx.fillRect(px + xx * cw + 1, py + yy * ch + 1, cw - 2, ch - 2); }
        else if (c === ':') { ctx.fillStyle = sc.density < 100 ? 'rgba(176,112,48,0.75)' : '#b07030'; ctx.fillRect(px + xx * cw + 2, py + yy * ch + 2, cw - 4, ch - 4); }
      }
      // start positions: the head icon (22 x 19, drawn from its top centre) shrunk to fit a cell, centred in it
      for (const st of sc.starts || []) {
        ctx.save(); ctx.translate(px + st.x * cw + cw / 2, py + st.y * ch + ch / 2); ctx.scale(0.62, 0.62);
        U.miniHead(ctx, st.p, 0, -7.5); ctx.restore();
      }
      ctx.strokeStyle = 'rgba(248,216,72,0.6)'; ctx.strokeRect(px - 0.5, py - 0.5, 15 * cw + 1, 11 * ch + 1);
      const f = AB.schemeFit(cur);
      let ty = py + 11 * ch + 10;
      G.text(ctx, fit(sc.name, 230, 'font1'), px, ty, WHITE, 'font1'); ty += 22;
      G.text(ctx, `${cur.toUpperCase()}.SCH   for ${f.label} players` + (f.kind === 'teams' ? ' (teams)' : ''), px, ty, f.fits(this.players) ? '#60f060' : GREY, 'font0'); ty += 16;
      const born = (sc.powers || []).filter(p => p.bornwith > 0).map(p => PW_LABEL[p.id] + (p.bornwith > 1 ? ' x' + p.bornwith : ''));
      const none = (sc.powers || []).filter(p => p.forbidden).map(p => PW_LABEL[p.id]);
      if (born.length) { G.text(ctx, fit('Start with: ' + born.join(', '), 236, 'font0'), px, ty, CYAN, 'font0'); ty += 16; }
      if (none.length) { G.text(ctx, fit('No: ' + none.join(', '), 236, 'font0'), px, ty, ORANGE, 'font0'); ty += 16; }
      G.text(ctx, sc.density < 100 ? `Bricks: ${sc.density}% of the brick spots` : 'Bricks: every brick spot', px, ty, GREY, 'font0');
      G.text(ctx, 'Up/Down, PgUp/PgDn: choose   Enter/Space: tick   Left/Right: browse presets   Esc: back', 320, 414, GREY, 'font0', 1);
      if (this.err > 0) { U.panel(ctx, 140, 200, 360, 44, 0.92); U.centerText(ctx, 'Tick at least one scheme', 214, ORANGE); }
    },
  });

  // ================================================================= CAMPAIGN MODE
  // The original hides this behind 5 x C on the Player Setup screen; the stages come from the CD's
  // *.CAM files. Humans (the keyboard/joystick players from Player Setup) must clear every stage of
  // ghosts, rovers and computer players; a failed stage is replayed ("Oh Well! Campaign unsuccessful!").
  const CAMPS = window.AB_CAMPAIGNS || [];
  const progressOf = (c) => ((AB.settings.campaignProgress || {})[c.file] || 0);
  function humanSetup() {
    const list = [];
    AB.setup.forEach((s, i) => { if (s.control.startsWith('key') || s.control.startsWith('joy')) list.push({ slot: i, control: s.control }); });
    if (!list.length) list.push({ slot: 0, control: 'key0' });
    return list.slice(0, 4);
  }
  function stagePlayers(st) {
    const humans = humanSetup().map(h => ({ slot: h.slot, color: h.slot, team: 0, ai: false, control: h.control, name: 'Player ' + (h.slot + 1) }));
    const used = new Set(humans.map(h => h.slot));
    const ais = [];
    for (let i = 0; i < 10 && ais.length < st.ais; i++) if (!used.has(i)) ais.push({ slot: i, color: i, team: 1, ai: true, control: 'ai', name: 'Player ' + (i + 1) });
    return humans.concat(ais);
  }
  function enemyIcons(ctx, st, x, y, scale = 0.6) {
    const items = [];
    for (let i = 0; i < st.ghosts; i++) items.push('ghost');
    for (let i = 0; i < st.rovers; i++) items.push('rover');
    for (let i = 0; i < st.ais; i++) items.push('ai');
    const step = Math.min(22, 230 / Math.max(1, items.length));
    items.forEach((k, i) => {
      ctx.save(); ctx.translate(x + i * step, y); ctx.scale(scale, scale);
      if (k === 'ai') { ctx.scale(0.62, 0.62); G.draw(ctx, 'stand south', 0, 0, 2, 3 + (i % 6), true); }
      else G.draw(ctx, k + ' south', 0, 0, 18, -1, true);
      ctx.restore();
    });
    return items.length;
  }
  SC.campaignIcons = enemyIcons;

  SC.register('campaign', {
    help: 'manual',
    enter() { this.sel = this.sel || 0; this.start = 0; A.music('menu'); },
    key(k) {
      const c = CAMPS[this.sel], maxStart = Math.min(progressOf(c), c.stages.length - 1);
      if (k.code === 'ArrowUp') { this.sel = (this.sel + CAMPS.length - 1) % CAMPS.length; this.start = 0; A.play(20); }
      else if (k.code === 'ArrowDown') { this.sel = (this.sel + 1) % CAMPS.length; this.start = 0; A.play(21); }
      else if (k.code === 'ArrowLeft') { this.start = Math.max(0, this.start - 1); A.play(20); }
      else if (k.code === 'ArrowRight') { this.start = Math.min(maxStart, this.start + 1); A.play(21); }
      else if (U.isBack(k)) SC.go('mainmenu');
      else if (U.isOK(k)) {
        A.play(10);
        AB.match = { campaign: { ci: this.sel, stage: this.start }, wins: {}, kills: {}, round: 0, players: [], demo: false };
        SC.go('campstage');
      }
    },
    render(ctx) {
      U.glueDim(ctx, 4);
      U.panel(ctx, 20, 18, 600, 424, 0.8);
      U.centerText(ctx, AB.msg(1206, 'Campaign Mode').toUpperCase(), 30, YELLOW);
      G.text(ctx, 'Clear each stage of ghosts, rovers and computer players. Lose, and you try that stage again.', 320, 52, GREY, 'font0', 1);
      G.text(ctx, 'Campaigns', 40, 80, WHITE, 'font1');
      CAMPS.forEach((c, i) => {
        const y = 108 + i * 30, sel = i === this.sel;
        if (sel) { ctx.fillStyle = 'rgba(248,216,72,0.16)'; ctx.fillRect(28, y - 4, 232, 26); U.menuCursor(ctx, 44, y + 16); }
        G.text(ctx, c.title, 62, y, sel ? YELLOW : WHITE, 'font1');
        G.text(ctx, `${Math.min(progressOf(c), c.stages.length)}/${c.stages.length}`, 250, y + 1, progressOf(c) >= c.stages.length ? '#60f060' : GREY, 'font0', 2);
        G.text(ctx, c.file, 62, y + 15, GREY, 'font0');
      });
      // stages of the selected campaign
      const c = CAMPS[this.sel];
      G.text(ctx, 'Stages', 280, 80, WHITE, 'font1');
      c.stages.forEach((st, i) => {
        const y = 104 + i * 33, done = i < progressOf(c), here = i === this.start;
        if (here) { ctx.fillStyle = 'rgba(96,240,96,0.14)'; ctx.fillRect(272, y - 4, 340, 32); }
        G.text(ctx, `${i + 1}.`, 296, y, here ? YELLOW : GREY, 'font0', 2);
        G.text(ctx, st.name, 304, y, here ? YELLOW : done ? '#90e090' : WHITE, 'font0');
        G.text(ctx, AB.levelName(st.level), 604, y, GREY, 'font0', 2);
        enemyIcons(ctx, st, 312, y + 29, 0.36);
      });
      const hum = humanSetup().map(h => (h.control.startsWith('key') ? 'KEY ' : 'JOY ') + h.control.slice(3)).join(', ');
      G.text(ctx, 'Players: ' + hum, 40, 220, CYAN, 'font0');
      G.text(ctx, '(set them up in Local Play)', 40, 236, GREY, 'font0');
      if (progressOf(c) > 0) G.text(ctx, 'Left/Right: starting stage', 40, 262, GREY, 'font0');
      G.text(ctx, 'Up/Down: campaign   Enter: start   Esc: back', 320, 420, GREY, 'font0', 1);
    },
  });

  // "Prepare to begin Campaign! (stage name)" (MESSAGES 1230/1235)
  SC.register('campstage', {
    enter() {
      const M = AB.match, cs = M.campaign;
      this.c = CAMPS[cs.ci]; this.st = this.c.stages[cs.stage]; this.t = 0; this.gone = false;
      M.players = stagePlayers(this.st); M.round++;
      A.music('network', false);
    },
    key(k) { if (this.t > 20 && !(k.pad !== undefined && !k.start && !U.isOK(k))) this.go(); },
    tick() { if (++this.t > AB.TPS * 4) this.go(); },
    go() {
      if (this.gone) return; this.gone = true;
      const st = this.st;
      SC.go('glue', { level: st.level, scheme: st.scheme, then: () => SC.go('game', { level: st.level, scheme: st.scheme, campaign: st }) });
    },
    render(ctx) {
      U.glue(ctx, (AB.match.campaign.stage + 2) % 7);
      U.panel(ctx, 90, 130, 460, 220, 0.85);
      const cs = AB.match.campaign;
      U.centerText(ctx, AB.msg(1230, 'Prepare to begin Campaign!'), 146, YELLOW);
      U.centerText(ctx, AB.msg(1235, '(%s)').replace('%s', this.st.name), 176, WHITE);
      U.centerText(ctx, `${this.c.title}  -  stage ${cs.stage + 1} of ${this.c.stages.length}  -  ${AB.levelName(this.st.level)}`, 204, GREY, 'font0');
      const n = enemyIcons(ctx, this.st, 0, 0, 0) ;
      enemyIcons(ctx, this.st, 320 - Math.min(22, 230 / Math.max(1, n)) * (n - 1) / 2, 286, 0.75);
      const parts = [];
      if (this.st.ghosts) parts.push(`${this.st.ghosts} ghost${this.st.ghosts > 1 ? 's' : ''}`);
      if (this.st.rovers) parts.push(`${this.st.rovers} rover${this.st.rovers > 1 ? 's' : ''}`);
      if (this.st.ais) parts.push(`${this.st.ais} computer player${this.st.ais > 1 ? 's' : ''}`);
      U.centerText(ctx, parts.join(', '), 302, WHITE, 'font0');
      if (this.t > 20 && U.blink()) U.centerText(ctx, 'Press any key', 326, GREY, 'font0');
    },
  });

  SC.register('campfail', {
    enter() { this.t = 0; A.music('lose', false); },
    key(k) {
      if (this.t < 30) return;
      if (U.isBack(k) && k.pad === undefined) { AB.match = null; SC.go('campaign'); }
      else if (U.isOK(k) || k.pad !== undefined) SC.go('campstage');
    },
    tick() { this.t++; },
    render(ctx) {
      G.blit(ctx, 'results', 0, 0);
      U.panel(ctx, 120, 170, 400, 120, 0.85);
      U.centerText(ctx, AB.msg(1240, 'Oh Well!'), 190, YELLOW);
      U.centerText(ctx, AB.msg(1245, 'Campaign unsuccessful!'), 220, WHITE);
      if (this.t > 30 && U.blink()) U.centerText(ctx, 'Press bomb to try this stage again   (Esc: quit)', 258, GREY, 'font0');
    },
  });

  SC.register('campdone', {
    enter() {
      this.t = 0; A.music('win', false); A.playRange(2000, 2299);
      const M = AB.match, human = M && M.players.find(p => !p.ai);
      this.colors = AB.victory.contestants(M, human ? { p: human } : null);
      AB.victory.load(true);
    },
    key(k) { if (this.t > 40) { AB.match = null; SC.go('campaign'); } },
    tick() { this.t++; },
    render(ctx) {
      AB.victory.draw(ctx, this.colors.winnerColor, this.colors.loserColor);
      U.panel(ctx, 100, 380, 440, 70, 0.7);
      U.centerText(ctx, AB.msg(1220, 'Congratulations!'), 392, YELLOW);
      U.centerText(ctx, AB.msg(1225, 'You made it through the whole campaign!'), 420, WHITE);
    },
  });

  // ================================================================= SOUNDS & VOICES
  // Three levels: game events -> phrases (takes saying the same words) -> takes. The take under the
  // cursor plays after a moment; Space ticks or unticks; Enter opens the next level.
  const ROWS = 15, ROW_H = 22, TOP = 78;
  const KIND = { voice: 'voice', sfx: 'effect' };
  function tagsOf(f) {
    const t = [];
    t.push(f & A.FLAGS.SHIPPED ? 'shipped' : 'unused CD take');
    if (f & A.FLAGS.CRUDE) t.push('uncensored');
    if (f & A.FLAGS.CHILD) t.push('not child friendly');
    if (f & A.FLAGS.ODD) t.push('purpose unknown');
    return t.join(', ');
  }
  SC.register('sounds', {
    help: 'options',
    enter() {
      this.lvl = 0; this.ev = null; this.gr = null; this.sel = [0, 0, 0]; this.top = [0, 0, 0];
      this.hold = 0; this.confirm = null; this.lastPreview = null;
      A.setVolumes(AB.settings.musicVolume * 0.35, AB.settings.sfxVolume);     // duck the music while listening
    },
    leave() { A.setVolumes(AB.musicMuted ? 0 : AB.settings.musicVolume, AB.settings.sfxVolume); A.stopTag('preview'); },
    rows() {
      const S = AB.settings;
      if (this.lvl === 0) {
        const head = [
          { kind: 'preset', label: `Preset: ${A.PRESET_LABEL[A.preset()]}${A.isCustom() ? '  (customised)' : ''}` },
          { kind: 'variety', label: `Variety each round: ${A.VARIETY_LABEL[S.soundVariety || 'normal']}` },
        ];
        const evs = (kind) => A.events.filter(e => e.kind === kind).map(e => ({ kind: 'event', e, label: e.name }));
        return head.concat([{ kind: 'section', label: 'VOICES' }], evs('voice'), [{ kind: 'section', label: 'SOUND EFFECTS' }], evs('sfx'), [{ kind: 'done', label: 'Done' }]);
      }
      if (this.lvl === 1) return this.ev.groups.map(g => ({ kind: 'group', g, label: g.label }));
      return this.gr.clips.map(n => ({ kind: 'take', n, label: n.toUpperCase() }));
    },
    back() {
      A.stopTag('preview');
      if (this.lvl > 0) { this.lvl--; this.hold = 0; return; }
      AB.saveSettings(); SC.go('settings');
    },
    open(row) {
      if (row.kind === 'event') { this.ev = row.e; this.lvl = 1; this.sel[1] = 0; this.top[1] = 0; }
      else if (row.kind === 'group') { this.gr = row.g; this.lvl = 2; this.sel[2] = 0; this.top[2] = 0; }
      this.hold = 0; this.lastPreview = null;
    },
    toggle(row) {
      if (row.kind === 'event') { const on = A.eventState(row.e) !== 2; for (const n of row.e.clipList) A.setOn(row.e, n, on); }
      else if (row.kind === 'group') { const on = A.groupState(this.ev, row.g) !== 2; for (const n of row.g.clips) A.setOn(this.ev, n, on); }
      else if (row.kind === 'take') A.setOn(this.ev, row.n, !A.isOn(this.ev, row.n));
      else return false;
      A.play(20); return true;
    },
    cyclePreset(d) {
      const P = A.PRESETS, i = (P.indexOf(A.preset()) + d + P.length) % P.length;
      if (A.isCustom()) { this.confirm = P[i]; return; }
      A.applyPreset(AB.settings, P[i]);
    },
    key(k) {
      const S = AB.settings;
      if (this.confirm) {
        if (k.code === 'KeyY' || U.isOK(k)) A.applyPreset(S, this.confirm);
        this.confirm = null; return;
      }
      const rows = this.rows(), L = this.lvl, row = rows[this.sel[L]];
      const move = (d) => {
        do { this.sel[L] = (this.sel[L] + d + rows.length) % rows.length; } while (rows[this.sel[L]].kind === 'section');
        this.hold = 0;
      };
      if (k.code === 'ArrowUp') move(-1);
      else if (k.code === 'ArrowDown') move(1);
      else if (k.code === 'PageUp') { this.sel[L] = Math.max(0, this.sel[L] - ROWS); if (rows[this.sel[L]].kind === 'section') move(1); this.hold = 0; }
      else if (k.code === 'PageDown') { this.sel[L] = Math.min(rows.length - 1, this.sel[L] + ROWS); if (rows[this.sel[L]].kind === 'section') move(1); this.hold = 0; }
      else if (k.code === 'Space' || k.code === 'KeyT') { if (row.kind === 'preset') this.cyclePreset(1); else this.toggle(row); }
      else if (k.code === 'KeyR' || k.code === 'KeyP') { this.lastPreview = null; this.hold = 11; }
      else if (k.code === 'ArrowLeft' && L === 0 && row.kind === 'preset') this.cyclePreset(-1);
      else if (k.code === 'ArrowRight' && L === 0 && row.kind === 'preset') this.cyclePreset(1);
      else if ((k.code === 'ArrowLeft' || k.code === 'ArrowRight') && row.kind === 'variety') {
        const V = A.VARIETY, d = k.code === 'ArrowLeft' ? -1 : 1;
        S.soundVariety = V[(V.indexOf(S.soundVariety || 'normal') + d + V.length) % V.length]; A.configure(S); A.play(20);
      }
      else if (k.code === 'ArrowLeft') this.back();
      else if (U.isBack(k)) this.back();
      else if (k.code === 'ArrowRight' || U.isOK(k)) {
        if (row.kind === 'done') this.back();
        else if (row.kind === 'preset') this.cyclePreset(1);
        else if (row.kind === 'variety') { const V = A.VARIETY; S.soundVariety = V[(V.indexOf(S.soundVariety || 'normal') + 1) % V.length]; A.configure(S); }
        else if (row.kind === 'take') this.toggle(row);
        else this.open(row);
      }
    },
    tick() {
      // preview whatever sits under the cursor for a moment
      if (++this.hold !== 12 || this.confirm) return;
      const row = this.rows()[this.sel[this.lvl]];
      if (!row) return;
      let n = null;
      if (row.kind === 'event') n = A.sampleOf(row.e, row.e.clipList);
      else if (row.kind === 'group') n = A.sampleOf(this.ev, row.g.clips);
      else if (row.kind === 'take') n = row.n;
      if (n) { A.preview(n); this.lastPreview = n; }
    },
    render(ctx) {
      U.glueDim(ctx, 2);
      U.panel(ctx, 16, 14, 608, 430, 0.86);
      const L = this.lvl, rows = this.rows();
      const crumbs = ['SOUNDS & VOICES'].concat(L >= 1 ? [this.ev.name] : [], L >= 2 ? [this.gr.label] : []);
      G.text(ctx, fit(crumbs.join('  >  '), 580), 30, 24, YELLOW, 'font1');
      // summary line
      let info;
      if (L === 0) {
        let on = 0, all = 0; for (const e of A.events) { on += A.countOn(e); all += e.clipList.length; }
        info = `${on} of ${all} sounds ticked.  Sounds from the CD the game never used are included.`;
      } else if (L === 1) info = `${KIND[this.ev.kind]}  -  ${this.ev.groups.length} phrases, ${A.countOn(this.ev)} of ${this.ev.clipList.length} takes ticked`;
      else info = `${this.gr.clips.length} take${this.gr.clips.length > 1 ? 's' : ''} of this phrase`;
      G.text(ctx, fit(info, 580, 'font0'), 30, 48, GREY, 'font0');
      // list
      const sel = this.sel[L];
      this.top[L] = AB.clamp(this.top[L], Math.max(0, sel - ROWS + 1), Math.min(sel, Math.max(0, rows.length - ROWS)));
      const top = this.top[L];
      for (let r = 0; r < ROWS && top + r < rows.length; r++) {
        const i = top + r, row = rows[i], y = TOP + r * ROW_H, isSel = i === sel;
        if (isSel) { ctx.fillStyle = 'rgba(248,216,72,0.16)'; ctx.fillRect(24, y - 3, 592, ROW_H); U.menuCursor(ctx, 40, y + 16); }
        let x = 58, state = null, right = '', col = WHITE;
        if (row.kind === 'section') { G.text(ctx, row.label, 34, y + 2, ORANGE, 'font0'); ctx.fillStyle = 'rgba(255,144,48,0.5)'; ctx.fillRect(34 + G.textWidth(row.label, 'font0') + 8, y + 10, 560 - G.textWidth(row.label, 'font0'), 1); continue; }
        if (row.kind === 'event') {
          state = A.eventState(row.e);
          const gOn = row.e.groups.filter(g => A.groupState(row.e, g)).length;
          right = `${gOn}/${row.e.groups.length} ${row.e.groups.length === 1 ? 'phrase' : 'phrases'}`;
          if (!state) col = GREY;
        } else if (row.kind === 'group') {
          state = A.groupState(this.ev, row.g);
          const fs = row.g.clips.map(n => A.clipInfo(n)[0]);
          const tags = [];
          if (fs.every(f => !(f & A.FLAGS.SHIPPED))) tags.push('CD');
          if (fs.some(f => f & A.FLAGS.CRUDE)) tags.push('!');
          right = (tags.length ? '[' + tags.join(' ') + ']  ' : '') + `${row.g.clips.length} take${row.g.clips.length > 1 ? 's' : ''}`;
          if (!state) col = GREY;
        } else if (row.kind === 'take') {
          state = A.isOn(this.ev, row.n) ? 2 : 0;
          if (!state) col = GREY;
        } else if (row.kind === 'done') col = WHITE;
        else col = CYAN;
        if (state !== null) { U.drawTick(ctx, x, y, state, isSel); x += 22; }
        if (row.kind === 'take') {
          const info = A.clipInfo(row.n);
          G.text(ctx, row.label, x, y, isSel ? YELLOW : col, 'font1');
          G.text(ctx, fit('"' + (info[1] || '...') + '"', 600 - x - 92, 'font0'), x + 92, y + 1, isSel ? WHITE : GREY, 'font0');
        } else {
          G.text(ctx, fit(row.label, (right ? 470 : 550) - x), x, y, isSel ? YELLOW : col, 'font1');
          if (right) G.text(ctx, right, 606, y + 1, isSel ? WHITE : GREY, 'font0', 2);
        }
        if (row.kind === 'take' && this.lastPreview === row.n) {
          for (let b = 0; b < 3; b++) { const h = 3 + Math.abs(Math.sin(U.frame() / (5 + b * 2) + b)) * 9; ctx.fillStyle = ORANGE; ctx.fillRect(28 + b * 5, y + 14 - h, 3, h); }
        }
      }
      if (top > 0) G.text(ctx, '...', 320, TOP - 14, GREY, 'font0', 1);
      if (top + ROWS < rows.length) G.text(ctx, '...', 320, TOP + ROWS * ROW_H - 6, GREY, 'font0', 1);
      // details of the take under the cursor
      const row = rows[sel];
      if (row && row.kind === 'take') G.text(ctx, fit(tagsOf(A.clipInfo(row.n)[0]), 580, 'font0'), 30, 412, CYAN, 'font0');
      const hint = L === 0 ? 'Enter: open   Space: tick all/none   Left/Right: preset & variety   Esc: back'
        : L === 1 ? 'Enter: takes   Space: tick   R: hear another take   Esc: back'
          : 'Space/Enter: tick   R: play again   Esc: back';
      G.text(ctx, hint, 320, 428, GREY, 'font0', 1);
      if (this.confirm) {
        U.panel(ctx, 120, 190, 400, 80, 0.92);
        U.centerText(ctx, `Switch to "${A.PRESET_LABEL[this.confirm]}"?`, 204, YELLOW);
        U.centerText(ctx, 'Your own ticks will be replaced.   Y = yes, other key = no', 236, WHITE, 'font0');
      }
    },
  });
})(window.AB);
