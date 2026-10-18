// Screens: logos, title, main menu, player setup, level/options, settings, keys, game, results,
// draw, victory, gold-bomberman roulette, online help, credits, intro movie.
// (Network lobby and rooms: js/netscreens.js.)
// Layout coordinates come from VALUELST.RES (#700-#815) and texts from MESSAGES.TXT where possible.
'use strict';
(function (AB) {
  const G = AB.gfx, A = AB.audio, I = AB.input;
  const SC = AB.screens = {};
  const screens = {};
  let cur = null, curName = '', frame = 0;
  const YELLOW = '#f8d848', WHITE = '#ffffff', GREY = '#a8a8a8', ORANGE = '#ff9030', CYAN = '#80e8ff';

  // ---------------------------------------------------------------- persistent state
  function load(key, def) { try { const v = JSON.parse(localStorage.getItem(key)); return v === null || v === undefined ? def : v; } catch (e) { return def; } }
  function save(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  AB.settings = Object.assign(AB.defaultSettings(), load('ab_settings', {}));
  // older saves had a single "Disable music during gameplay" switch
  if (AB.settings.noGameMusic) { AB.settings.gameMusic = {}; for (const t of AB.MUSIC_TRACKS) AB.settings.gameMusic[t.id] = false; }
  delete AB.settings.noGameMusic;
  AB.saveSettings = () => save('ab_settings', AB.settings);
  const defaultSetup = () => Array.from({ length: 10 }, (_, i) => ({ control: i === 0 ? 'key0' : i < 4 ? 'ai' : 'off', team: i < 5 ? 0 : 1 }));
  AB.setup = load('ab_setup', null) || defaultSetup();
  if (!Array.isArray(AB.setup) || AB.setup.length !== 10) AB.setup = defaultSetup();
  AB.saveSetup = () => save('ab_setup', AB.setup);
  A.setVolumes(AB.settings.musicVolume, AB.settings.sfxVolume);

  // ---------------------------------------------------------------- manager
  SC.register = (name, s) => { screens[name] = s; };
  SC.go = function (name, arg) {
    if (cur && cur.leave) cur.leave();
    cur = screens[name]; curName = name; frame = 0;
    if (cur.enter) cur.enter(arg);
  };
  SC.start = SC.go;
  SC.name = () => curName;
  SC.current = () => cur;
  SC.tick = function () {
    frame++;
    const presses = I.takePresses();
    for (const k of presses) {
      if (k.code === 'F1' && cur.help && !saved) { SC.pushHelp(cur.help); continue; }
      // in a match, keys used by a player's layout are game input, not shortcuts
      const playerKey = curName === 'game' && I.layouts.some(L => Object.values(L).includes(k.code));
      if (k.code === 'KeyM' && !cur.textEntry && !playerKey) {
        AB.musicMuted = !AB.musicMuted; A.setVolumes(AB.musicMuted ? 0 : AB.settings.musicVolume, AB.settings.sfxVolume); continue;
      }
      cur.key && cur.key(k);
    }
    cur.tick && cur.tick();
  };
  SC.render = function (ctx) { cur.render && cur.render(ctx); };
  // help as an overlay: remember the current screen object and come back to it untouched
  let saved = null;
  SC.pushHelp = function (file) {
    saved = { scr: cur, name: curName };
    if (cur && cur.pause) cur.pause();
    cur = screens.help; curName = 'help';
    cur.enter({ file, back: '__pop' });
  };
  SC.pop = function () {
    if (!saved) { SC.go('mainmenu'); return; }
    cur = saved.scr; curName = saved.name; saved = null;
    I.takePresses();
  };

  // ---------------------------------------------------------------- helpers
  const isOK = (k) => k.code === 'Enter' || k.code === 'Space' || k.code === 'NumpadEnter';
  const isBack = (k) => k.code === 'Escape' || k.code === 'Backspace';
  function panel(ctx, x, y, w, h, a = 0.62) {
    ctx.fillStyle = `rgba(0,0,16,${a})`; ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = 'rgba(248,216,72,0.55)'; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  }
  function glue(ctx, n) { G.blit(ctx, 'glue' + (n % AB.val(16, 7)), 0, 0); }
  function cursorDude(ctx, x, y, scale = 0.5) {
    const im = G.image('bombdude_a');
    if (im.complete && im.naturalWidth) {
      const bob = Math.sin(frame / 8) * 2;
      const w = Math.round(im.width * scale), h = Math.round(im.height * scale);
      ctx.drawImage(im, Math.round(x - w / 2), Math.round(y - h / 2 + bob), w, h);
    }
  }
  // the original list cursor: MISC.ANI "cursor1", a little bomber head that blinks every
  // #690 + rand(#691) seconds (fcn.00413bd6)
  const blinkState = { next: 0, t: -1 };
  function menuCursor(ctx, x, y) {
    const now = frame / AB.TPS, bv = AB.val(690, [2, 2]);
    if (blinkState.t < 0 && now >= blinkState.next) blinkState.t = 0;
    let st = 0;
    if (blinkState.t >= 0) {
      st = Math.floor(blinkState.t / AB.TPR); blinkState.t++;
      if (st >= (G.seqLen('cursor1') || 5)) { blinkState.t = -1; blinkState.next = now + bv[0] + Math.random() * bv[1]; st = 0; }
    }
    G.draw(ctx, 'cursor1', st, x, y, -1, true);
  }
  // "Press F1 for help" (#790, MESSAGES 330), drawn on every glue screen by fcn.00413fb9
  function f1Hint(ctx) { const c = AB.val(790, [320, 440]); G.text(ctx, AB.msg(330, 'Press F1 for help'), c[0], c[1], WHITE, 'font1', 1); }
  // glue backgrounds are busy; a light dim keeps the original look but helps the text
  function glueDim(ctx, n) { glue(ctx, n); ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(0, 0, 640, 480); }
  function miniHead(ctx, color, x, y) {
    ctx.save(); ctx.beginPath(); ctx.rect(x - 11, y - 2, 22, 19); ctx.clip();
    ctx.translate(x, y + 25); ctx.scale(0.5, 0.5);
    G.draw(ctx, 'stand south', 0, 0, 0, color, true);
    ctx.restore();
  }
  function miniBomber(ctx, color, x, y, scale = 0.6, dir = 'south') {
    // draw a scaled standing bomberman (hotspot at feet)
    const s = G.seq('stand ' + dir);
    if (!s) return;
    ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
    G.draw(ctx, s, 0, 0, 0, color, true);
    ctx.restore();
  }
  function centerText(ctx, t, y, color = WHITE, font = 'font1') { G.text(ctx, t, 320, y, color, font, 1); }
  // tick box: state 0 empty, 1 partly ticked (dash), 2/true ticked
  function drawTick(ctx, x, y, state, sel) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x, y + 1, 14, 14);
    ctx.strokeStyle = sel ? YELLOW : WHITE; ctx.lineWidth = 1; ctx.strokeRect(x + 0.5, y + 1.5, 13, 13);
    if (state === 1) { ctx.fillStyle = '#60f060'; ctx.fillRect(x + 3, y + 7, 8, 3); }
    else if (state) {
      ctx.strokeStyle = '#60f060'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.beginPath();
      ctx.moveTo(x + 3, y + 8); ctx.lineTo(x + 6, y + 12); ctx.lineTo(x + 12, y + 3); ctx.stroke(); ctx.lineCap = 'butt';
    }
  }
  function fmtTime(s) { return s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : AB.msg(280, 'Infinite'); }
  const yesno = (b) => (b ? 'Yes' : 'No');
  function blink() { return (frame >> 4) % 2 === 0; }
  // shared with the screens in js/screens2.js
  SC.uiLate = () => ({ arenaPreview, arenaSummary, startMatch, nextRound, activeSetup, controlOptions, controlLabel });
  SC.ui = { YELLOW, WHITE, GREY, ORANGE, CYAN, isOK: (k) => isOK(k), isBack: (k) => isBack(k), panel, glue, glueDim, menuCursor, f1Hint,
            centerText, drawTick, blink, miniHead, miniBomber, fmtTime, frame: () => frame };

  // ================================================================= INTRO MOVIE
  // The CD's intro (an Interplay MVE movie inside INTRO/BMINTRO.EXE, re-encoded to intro/intro.mp4)
  // plays on every start, before the logos. Browsers may refuse sound until a key is pressed: then it
  // starts muted and the first key turns the sound on; any key after that skips it.
  SC.register('intro', {
    enter() {
      const v = this.v = document.getElementById('intro'), hint = this.hint = document.getElementById('introhint');
      this.t = 0; this.done = false;
      v.style.display = 'block'; v.muted = false; v.volume = Math.max(0.2, AB.settings.musicVolume);
      // VP9/Opus first (every current browser), H.264/AAC as the fallback
      v.src = v.canPlayType('video/webm; codecs="vp9, opus"') ? 'intro/intro.webm' : 'intro/intro.mp4';
      v.onended = () => this.finish();
      v.onerror = () => this.finish();
      this.onClick = () => this.key({ code: 'Click' });
      v.addEventListener('click', this.onClick);
      const show = (t) => { hint.textContent = t; hint.style.display = t ? 'block' : 'none'; };
      this.show = show;
      show('Loading the intro...  (any key skips)');
      v.play().then(() => show('Press any key to skip')).catch(() => {
        v.muted = true;
        v.play().then(() => show('Press any key for sound  -  press again to skip')).catch(() => show('Press any key to play the intro'));
      });
    },
    key(k) {
      const v = this.v;
      A.unlock();
      if (v.paused && !v.ended) { v.muted = false; v.play().catch(() => this.finish()); this.show('Press any key to skip'); return; }
      if (v.muted) { v.muted = false; this.show('Press any key to skip'); return; }
      if (this.t > 15) this.finish();
    },
    tick() { this.t++; },
    finish() { if (this.done) return; this.done = true; SC.go('title'); },
    leave() {
      const v = this.v; if (!v) return;
      v.onended = v.onerror = null; v.removeEventListener('click', this.onClick);
      try { v.pause(); } catch (e) {}
      v.removeAttribute('src'); v.load(); v.style.display = 'none'; this.hint.style.display = 'none';
    },
    render(ctx) { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 640, 480); },
  });

  // ================================================================= LOGOS
  SC.register('title', {
    enter() { this.t = 0; this.stage = 0; this.waiting = true; },
    key(k) {
      A.unlock();
      const intro = () => { A.music('title'); (AB.menuSounds || Promise.resolve()).then(() => A.playRange(2800, 2899)); };
      if (this.waiting) { this.waiting = false; this.stage = 2; this.t = 0; intro(); return; }
      if (this.stage < 2) { this.stage = 2; this.t = 0; intro(); return; }
      A.play(10); SC.go('mainmenu');
    },
    tick() {
      this.t++;
      if (this.waiting) return;
      if (this.stage === 2 && this.t > AB.val(12, 7) * AB.TPS * 3) SC.go('mainmenu');
    },
    render(ctx) {
      if (this.waiting || this.stage < 2) {
        // Interplay + Hudson logos, then the title
        const logo = (Math.floor(frame / 150) % 2) ? 'hslogo' : 'iplogo';
        G.blit(ctx, logo, 0, 0);
        if (blink()) { panel(ctx, 170, 430, 300, 30, 0.7); centerText(ctx, 'Press any key to start', 437, YELLOW); }
        return;
      }
      G.blit(ctx, 'title', 0, 0);
      if (blink() && this.t > 40) centerText(ctx, 'Press any key', 452, WHITE);
    },
  });

  // ================================================================= MAIN MENU
  // the port's menu picture (img/mainmenu_port.png) replaces "Start/Join Network Game" with these two
  const MAIN_ITEMS = ['Start Game', 'Campaign Mode', 'Network Game', 'Options', 'About Bomberman', 'Online Manual', 'Exit Bomberman'];
  SC.register('mainmenu', {
    help: 'manual',
    enter() { this.sel = this.sel || 0; this.idle = 0; this.confirm = false; A.music('menu'); },
    key(k) {
      this.idle = 0;
      if (this.confirm) {
        if (k.code === 'KeyY' || isOK(k)) { A.playRange(2600, 2699); SC.go('bye'); }
        else this.confirm = false;
        return;
      }
      if (k.code === 'ArrowUp') { this.sel = (this.sel + MAIN_ITEMS.length - 1) % MAIN_ITEMS.length; A.play(20); }
      else if (k.code === 'ArrowDown') { this.sel = (this.sel + 1) % MAIN_ITEMS.length; A.play(21); }
      else if (isBack(k)) { this.confirm = true; }
      else if (isOK(k)) {
        A.play(10);
        switch (this.sel) {
          case 0: SC.go('players'); break;
          case 1: SC.go('campaign'); break;
          case 2: SC.go('network', {}); break;
          case 3: SC.go('settings'); break;
          case 4: SC.go('credits'); break;
          case 5: SC.go('help', { back: 'mainmenu' }); break;
          case 6: this.confirm = true; break;
        }
      }
    },
    tick() {
      // attract mode after #92 seconds of idling
      if (++this.idle > AB.val(92, 30) * AB.TPS && AB.val(92, 30) >= 5) SC.go('game', { demo: true });
    },
    render(ctx) {
      G.blit(ctx, 'mainmenu_port', 0, 0);
      // fcn.0042b9ce: "bomb trigger green" animates next to the selected item (#700: x, y, spacing)
      const m = AB.val(700, [332, 140, 38, 0]);
      G.draw(ctx, 'bomb trigger green', Math.floor(frame / AB.TPR), m[0], m[1] + this.sel * m[2], -1, false);
      G.text(ctx, AB.VERSION.text.toUpperCase().replace(' DEV', ''), 50, 0, WHITE, 'font1');
      G.text(ctx, AB.VERSION.commit ? AB.VERSION.commit + '  ' + AB.VERSION.date : 'dev build', 52, 22, GREY, 'font0');
      if (this.confirm) {
        panel(ctx, 170, 200, 300, 80, 0.85);
        centerText(ctx, AB.msg(10, 'Are you sure you want to exit?'), 220, YELLOW);
        centerText(ctx, 'Y = Yes     any other key = No', 248, WHITE, 'font0');
      }
    },
  });

  SC.register('bye', {
    enter() { A.stopMusic(); this.t = 0; },
    key() { if (this.t > 30) SC.go(AB.settings.playIntro !== false ? 'intro' : 'title'); },
    tick() { this.t++; },
    render(ctx) {
      G.blit(ctx, 'iplogo', 0, 0);
      panel(ctx, 120, 200, 400, 70, 0.8);
      centerText(ctx, 'Thanks for playing Atomic Bomberman!', 215, YELLOW);
      centerText(ctx, 'You can close this tab now (any key to restart).', 240, WHITE, 'font0');
    },
  });

  // ================================================================= PLAYER / CONTROL SETUP
  function controlOptions() {
    const o = ['off', 'ai', 'key0', 'key1', 'key2', 'key3'];
    const pads = I.pads();
    for (let i = 0; i < Math.max(pads.length, 0); i++) o.push('joy' + i);
    return o;
  }
  // Player Setup's Right key cycle: the three AI skills are separate steps
  function setupTokens() {
    const o = [];
    for (const c of controlOptions()) { if (c === 'ai') for (const l of AB.AI.LEVELS) o.push('ai:' + l); else o.push(c); }
    return o;
  }
  function controlLabel(c, aiLevel) {
    if (c === 'off') return AB.msg(220, 'OFF');
    if (c === 'ai') return AB.msg(221, 'AI') + (aiLevel ? ' - ' + AB.AI.LEVEL_NAMES[aiLevel].toUpperCase() : '');
    if (c.startsWith('key')) return 'KEY ' + c.slice(3);
    if (c.startsWith('joy')) return 'JOY ' + c.slice(3);
    if (c === 'net') return AB.msg(224, 'NET');
    return c;
  }
  SC.register('players', {
    help: 'input',
    enter() {
      this.sel = 0; this.err = null; this.errT = 0; this.cPresses = 0;
      A.music('menu');
      if (AB.settings.assignKeyboard && !AB.setup.some(s => s.control.startsWith('key'))) AB.setup[0].control = 'key0';
    },
    key(k) {
      const s = AB.setup[this.sel];
      if (k.code === 'ArrowUp') this.sel = (this.sel + 9) % 10;
      else if (k.code === 'ArrowDown') this.sel = (this.sel + 1) % 10;
      else if (k.code === 'ArrowRight') {
        // off -> AI easy -> AI medium -> AI original -> KEY 0 ... (the AI's skill rides along in aiLevel)
        const o = setupTokens(), cur = s.control === 'ai' ? 'ai:' + (s.aiLevel || 'hard') : s.control;
        const nx = o[(o.indexOf(cur) + 1) % o.length];
        if (nx.startsWith('ai:')) { s.control = 'ai'; s.aiLevel = nx.slice(3); } else s.control = nx;
        A.play(20);
      } else if (k.code === 'ArrowLeft') { s.control = 'off'; A.play(21); }
      else if (k.code === 'KeyT') {
        if (AB.settings.teamPlay) { s.team = s.team ? 0 : 1; A.play(20); }
        else { this.err = 'Enable Team Play in Options first'; this.errT = 120; }
      } else if (k.code === 'KeyC' && !k.ctrl) {
        // the original's hidden way in: press C five times on this screen (fcn.00410f81)
        if (++this.cPresses >= 5) { this.cPresses = 0; AB.saveSetup(); SC.go('campaign'); }
      } else if (k.code === 'KeyA' && k.ctrl) { AB.setup.forEach(x => { if (x.control === 'off' || !x.control.startsWith('key')) x.control = 'ai'; }); }
      else if (isBack(k)) { AB.saveSetup(); SC.go('mainmenu'); }
      else if (isOK(k) || k.pad !== undefined && k.code === 'Enter') {
        const active = AB.setup.filter(x => x.control !== 'off');
        const devs = active.map(x => x.control).filter(c => c !== 'ai');
        if (active.length < 2) { this.err = AB.msg(46, 'Must have at least two players selected!'); this.errT = 150; A.play(40); return; }
        if (new Set(devs).size !== devs.length) { this.err = AB.msg(45, 'More than one player selected to an input device!'); this.errT = 150; A.play(40); return; }
        if (AB.settings.teamPlay && new Set(active.map(x => x.team)).size < 2) { this.err = AB.msg(48, 'Must have at least one player on each team!'); this.errT = 150; A.play(40); return; }
        AB.saveSetup(); A.play(10); SC.go('options');
      }
    },
    tick() { if (this.errT > 0) this.errT--; },
    render(ctx) {
      glueDim(ctx, 1);
      const h = AB.val(705, [40, 140, 0, 200]), l = AB.val(710, [70, 170, 24, 150]);
      const jh = AB.val(715, [300, 140, 0, 170]), jl = AB.val(720, [320, 170, 24, 320]);
      centerText(ctx, 'Player Setup', 96, YELLOW);
      G.text(ctx, AB.msg(50, 'Available players:'), h[0], h[1], YELLOW, 'font1');
      for (let i = 0; i < 10; i++) {
        const st = AB.setup[i], y = l[1] + i * l[2];
        if (i === this.sel) menuCursor(ctx, l[0] - 16, y + 17);
        miniHead(ctx, i, l[0] + 10, y);
        const label = AB.msg(51, 'Player %u: %s').replace('%u', i + 1).replace('%s', controlLabel(st.control));
        G.text(ctx, label, l[0] + 26, y, st.control === 'off' ? GREY : i === this.sel ? YELLOW : WHITE, 'font1');
        // the AI's skill, small, after "AI"
        if (st.control === 'ai') G.text(ctx, AB.AI.LEVEL_NAMES[st.aiLevel || 'hard'].toLowerCase(), l[0] + 32 + G.textWidth(label, 'font1'), y + 3, CYAN, 'font0');
        if (AB.settings.teamPlay && st.control !== 'off') G.text(ctx, AB.msg(230, 'TEAM') + (st.team ? ' 2' : ' 1'), Math.max(l[0] + 170, l[0] + 40 + G.textWidth(label, 'font1') + (st.control === 'ai' ? 60 : 0)), y, st.team ? '#ff6060' : WHITE, 'font1');
      }
      G.text(ctx, AB.msg(40, 'Available Joysticks:'), jh[0], jh[1], YELLOW, 'font1');
      const pads = I.pads();
      if (!pads.length) G.text(ctx, AB.msg(42, 'None Detected'), jl[0], jl[1], GREY, 'font1');
      pads.forEach((p, i) => G.text(ctx, AB.msg(41, 'Joy %u - %s').replace('%u', i).replace('%s', p.id.slice(0, 24)), jl[0], jl[1] + i * jl[2], WHITE, 'font0'));
      const ky = jl[1] + Math.max(1, pads.length) * jl[2] + 24;
      G.text(ctx, 'Keyboard layouts:', jh[0], ky, YELLOW, 'font1');
      const kl = (c) => I.keyLabel(c).replace('Num ', 'N').replace('Enter', 'Ent').replace('Space', 'Spc');
      I.layouts.forEach((L, i) => {
        const dirs = L.up === 'ArrowUp' && L.down === 'ArrowDown' && L.left === 'ArrowLeft' ? 'Arrows' : `${kl(L.up)}${kl(L.left)}${kl(L.down)}${kl(L.right)}`;
        G.text(ctx, `KEY ${i}:  ${dirs}   bomb ${kl(L.bomb)}   action ${kl(L.action)}`, jl[0], ky + 24 + i * 20, WHITE, 'font0');
      });
      G.text(ctx, 'Right: change (AI: easy, medium, original)   Left: off   T: team   Enter: continue', 320, 418, GREY, 'font0', 1);
      f1Hint(ctx);
      if (this.errT > 0) { panel(ctx, 100, 200, 440, 50, 0.9); centerText(ctx, this.err, 216, ORANGE); }
    },
  });

  // ================================================================= LEVEL / MATCH OPTIONS
  const schemeKeys = () => Object.keys(window.AB_DATA.schemes).sort();
  function arenaSummary(S) {
    const on = []; for (let i = 0; i < AB.LEVELS; i++) if (AB.arenaOn(S, i)) on.push(i);
    if (on.length === AB.LEVELS) return 'All ' + AB.LEVELS + ' (random)';
    if (on.length === 1) return AB.levelName(on[0]);
    if (!on.length) return 'All (none ticked)';
    return on.length + ' of ' + AB.LEVELS + ' (random)';
  }
  // sample blocks preview (#730: x, y, 5 x 5 blocks) drawn with the arena's own tiles
  function arenaPreview(ctx, lvl, px, py, nx = 5, ny = 5) {
    AB.tilesets.preview(ctx, lvl, px, py, nx, ny);
  }
  SC.register('options', {
    help: 'options',
    enter() { this.sel = 5; },
    items() {
      const S = AB.settings;
      return [
        { label: 'Arenas', value: arenaSummary(S) + '  >', action: () => SC.go('arenas') },
        { label: 'Schemes', value: AB.schemeSummary(S) + '  >', action: () => SC.go('schemes', { back: 'options' }) },
        { label: 'Tileset', value: AB.tilesets.name() + '  >', action: () => SC.go('tilesets', { back: 'options' }) },
        { label: 'Match', value: AB.msg(211, '%u %s to win match').replace('%u', S.winsNeeded).replace('%s', S.winByKills ? AB.msg(209, 'Kills') : AB.msg(208, 'Wins')),
          change: (d) => { S.winsNeeded = AB.clamp(S.winsNeeded + d, 1, S.winByKills ? 50 : 9); } },
        { label: 'Play Time', value: fmtTime(S.playTime),
          change: (d) => { const t = AB.PLAY_TIMES; S.playTime = t[(t.indexOf(S.playTime) + d + t.length) % t.length]; } },
        { label: 'START THE MATCH!', value: '', action: () => startMatch() },
      ];
    },
    key(k) {
      const items = this.items();
      if (k.code === 'ArrowUp') this.sel = (this.sel + items.length - 1) % items.length;
      else if (k.code === 'ArrowDown') this.sel = (this.sel + 1) % items.length;
      else if (k.code === 'ArrowLeft' && items[this.sel].change) { items[this.sel].change(-1); A.play(20); AB.saveSettings(); }
      else if (k.code === 'ArrowRight' && items[this.sel].change) { items[this.sel].change(1); A.play(21); AB.saveSettings(); }
      else if (isBack(k)) SC.go('players');
      else if (isOK(k)) { AB.saveSettings(); A.play(10); if (items[this.sel].action) items[this.sel].action(); else startMatch(); }
    },
    render(ctx) {
      glueDim(ctx, 6);
      centerText(ctx, 'Arena & Match', 60, YELLOW);
      const l = AB.val(735, [55, 170, 24, 300]);
      this.items().forEach((it, i) => {
        const y = l[1] + i * l[2] * 1.5;
        if (i === this.sel) menuCursor(ctx, l[0] - 16, y + 17);
        G.text(ctx, it.label + (it.value ? ':' : ''), l[0], y, i === this.sel ? YELLOW : WHITE, 'font1');
        if (it.value) G.text(ctx, it.value, l[0] + 100, y, WHITE, 'font1');
      });
      // preview: cycles through the ticked arenas
      const S = AB.settings, pv = AB.val(730, [400, 100, 5, 5]);
      const on = []; for (let i = 0; i < AB.LEVELS; i++) if (AB.arenaOn(S, i)) on.push(i);
      const list = on.length ? on : [...Array(AB.LEVELS).keys()];
      const lvl = list[Math.floor(frame / 90) % list.length];
      arenaPreview(ctx, lvl, pv[0], pv[1], pv[2], pv[3]);
      G.text(ctx, AB.levelName(lvl), pv[0] + pv[2] * AB.CW / 2, pv[1] + pv[3] * AB.CH + 8, WHITE, 'font1', 1);
      const n = AB.setup.filter(st => st.control !== 'off').length;
      G.text(ctx, `${n} players     Left/Right: change     Enter: start     Esc: back`, 320, 418, GREY, 'font0', 1);
      f1Hint(ctx);
    },
  });

  // ---------------------------------------------------------------- match control
  function activeSetup() {
    const list = [];
    AB.setup.forEach((s, i) => { if (s.control !== 'off') list.push({ slot: i, color: i, team: s.team, ai: s.control === 'ai', aiLevel: s.aiLevel || 'hard', control: s.control, name: 'Player ' + (i + 1) }); });
    return list;
  }
  function startMatch(demo) {
    AB.match = { wins: {}, kills: {}, round: 0, players: demo ? demoPlayers() : activeSetup(), over: false, demo: !!demo, bonus: AB.nextBonus || null };
    AB.nextBonus = null;
    nextRound();
  }
  function demoPlayers() {
    const n = 4 + Math.floor(Math.random() * 4);
    return Array.from({ length: n }, (_, i) => ({ slot: i, color: i, team: i % 2, ai: true, control: 'ai', name: 'Player ' + (i + 1) }));
  }
  function nextRound() {
    const M = AB.match; M.round++;
    // pick the arena now so the glue screen can load its picture along with this round's sounds
    const level = AB.pickArena(AB.settings), scheme = AB.pickScheme(AB.settings);
    SC.go('glue', { level, then: () => SC.go('game', { level, scheme }) });
  }
  AB.startMatch = startMatch;

  // between rounds: pick and load this round's sounds (each round gets a different handful)
  SC.register('glue', {
    enter(a) {
      this.a = a; this.t = 0; this.prog = 0; this.readySent = false; this.extraT = 0;
      // one of the loading pictures that's already here (glue0 comes with the start-up)
      const nG = AB.val(16, 7), have = [];
      for (let i = 0; i < nG; i++) if (G.isLoaded('glue' + i)) have.push(i);
      this.n = have.length ? have[Math.floor(Math.random() * have.length)] : 0;
      // needed before the round can start: the arena picture (high priority) and the sound effects;
      // the voices get a few more seconds, then go on loading during the round
      this.img = a.level === undefined; this.fx = false; this.all = false;
      const field = a.level !== undefined ? AB.tilesets.prepare(a.level) : AB.tilesets.load();
      field.then(() => { this.img = true; });
      const snd = A.newRound((f) => { this.prog = f; });
      snd.effects.then(() => { this.fx = true; });
      snd.then(() => { this.all = true; });
      // then, quietly: the pictures the next screens show
      Promise.all([field, snd.effects]).then(() => {
        const M = AB.match, S = (M && M.S) || AB.settings, list = ['results', 'draw', 'winz'];
        if (M && M.players) for (const p of M.players) list.push('victory' + p.color);
        if (S.teamPlay) list.push('team0', 'team1');
        if (S.goldBomberman) list.push('roulette');
        for (let i = 0; i < nG; i++) list.push('glue' + i);
        G.prefetch(list);
      });
    },
    // go on once the picture and the effects are in, plus up to 6 s for the voices (90 s at most, so a
    // dead connection can't hang the game); a network round then waits until the host says go
    tick() {
      this.t++;
      const must = this.img && this.fx;
      if (must && !this.all) this.extraT++;
      const loaded = this.t > 40 && ((must && (this.all || this.extraT > AB.TPS * 6)) || this.t > AB.TPS * 90);
      if (!this.a.net) { if (loaded) this.a.then(); return; }
      if (loaded && !this.readySent) { this.readySent = true; AB.netmatch.ready(this.a.net); }
      if (this.readySent && AB.netmatch.goRound === this.a.net) this.a.then();
    },
    render(ctx) {
      glue(ctx, this.n);
      if (this.a.level !== undefined) G.titleText(ctx, AB.levelName(this.a.level), 320, 180, 56, 560);
      let txt = AB.msg(201, 'Loading data...');
      if (this.readySent) { const w = AB.netmatch.waitingFor ? AB.netmatch.waitingFor() : []; txt = w.length ? 'Waiting for ' + w.join(', ') + '...' : 'Waiting for the other computers...'; }
      else if (this.t > AB.TPS * 3 && !this.img) txt = 'Loading the arena...';
      centerText(ctx, txt, 232, WHITE);
      const prog = ((this.img ? 1 : 0) + this.prog * 3) / 4;
      if (!this.readySent && prog < 1 && this.t > 20) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(220, 256, 200, 6); ctx.fillStyle = YELLOW; ctx.fillRect(220, 256, 200 * prog, 6); }
    },
  });

  SC.register('game', {
    help: 'manual',
    enter(arg) {
      arg = arg || {};
      if (arg.demo) { AB.match = { wins: {}, kills: {}, round: 1, players: demoPlayers(), demo: true }; }
      if (!AB.match) startMatch();
      const M = AB.match;
      const S = Object.assign({}, AB.settings);
      if (M.demo) { S.playTime = 90; S.arenas = {}; }
      // network round: the host decided arena, seed and settings (js/netscreens.js)
      const net = this.net = arg.net || null;
      S.countdown = AB.settings.countdown !== false;          // Options > Round Start Countdown
      if (net) Object.assign(S, net.sim);
      // pick an arena: a campaign stage names one, otherwise one of the ticked arenas
      let level = net ? net.level : arg.level !== undefined ? arg.level : AB.testLevel !== undefined ? AB.testLevel : AB.pickArena(S);
      if (arg.scheme) S.scheme = arg.scheme;
      const scheme = window.AB_DATA.schemes[S.scheme] || window.AB_DATA.schemes.basic;
      const seed = net ? net.seed : (Math.random() * 0xffffffff) >>> 0;
      const players = M.players.map(p => Object.assign({}, p, { bonus: M.bonus && M.bonus.slot === p.slot && M.round === 1 ? M.bonus.pw : -1 }));
      if (arg.campaign) S.teamPlay = false;
      this.g = new AB.Game({ settings: S, scheme, level, seed, players, match: M, campaign: arg.campaign || null });
      AB.curGame = this.g;
      this.devices = M.players.map(p => p.control.startsWith('key') ? { type: 'key', n: +p.control.slice(3) } : p.control.startsWith('joy') ? { type: 'joy', n: +p.control.slice(3) } : null);
      this.t = 0; this.overT = 0; this.paused = false; this.quitAsk = false; this.stallT = 0; this.desync = false; this.forfeitAsk = 0;
      this.held = []; this.deathShown = {}; this.netStats = null;
      this.session = net ? AB.netmatch.makeSession(this.g, this.devices, net) : null;
      const track = AB.gameTrack(S, level);
      if (track) A.music(track); else A.stopMusic();
      // warm up recoloured sprites for the players in this round
      for (const p of M.players) G.prewarm(['walk', 'stand', 'bombs', 'mflame', 'kick'], p.color);
      // decode the timing-critical effects up front; voice clips decode on first use
      A.predecode(100, 219); A.predecode(300, 363); A.predecode(1300, 1330); A.predecode(2700, 2799);
    },
    key(k) {
      const M = AB.match;
      if (M.demo) { SC.go('mainmenu'); return; }
      if (k.pad !== undefined && !this.quitAsk && !k.start) return;    // pads drive players, not menus
      const playerKey = I.layouts.some(L => Object.values(L).includes(k.code));
      if (this.quitAsk) {
        if (k.code === 'KeyY' || isOK(k)) {
          A.playRange(2600, 2699);
          if (this.net) { AB.netmatch.quit(); return; }
          AB.match = null; SC.go('mainmenu');
        } else this.quitAsk = false;
        return;
      }
      if (k.code === 'Escape' || (k.code === 'KeyQ' && k.ctrl)) { this.quitAsk = true; return; }
      // no pause or forced draw in a network game (every computer must stay in step); F10 twice forfeits
      if (this.net) {
        if (k.code === 'F9') this.showNet = !this.showNet;
        if (k.code === 'F10') {
          if (this.forfeitAsk > 0) { this.forfeitAsk = 0; AB.netmatch.forfeitAll(); }
          else if (this.g.players.some((p, i) => p.alive && this.session && this.session.localSlots.includes(i))) this.forfeitAsk = 2 * AB.TPS;
        }
        return;
      }
      if ((k.code === 'KeyP' && !playerKey) || k.code === 'Pause') this.paused = !this.paused;
      if (k.code === 'F10') this.g.forceDraw();
    },
    tick() {
      const g = this.g;
      this.t++;
      if (this.t === 30 && !AB.match.demo) A.playRange(9000, 9000);    // round-start announcer (unused CD lines)
      if (this.forfeitAsk > 0) this.forfeitAsk--;
      { const n = g.startDelay > 0 ? Math.ceil(g.startDelay / AB.TPS) : 0; if (n !== this.lastCount) { if (n > 0) A.play(1300); this.lastCount = n; } }
      if (this.session) {
        // rollback (js/net.js): the session runs the game on, correcting it when the others' real
        // inputs arrive. Its events are new ones only; deaths wait until they can't be undone.
        const s = this.session;
        if (!this.desync) s.frame();
        if (s.desync && !this.desync) { this.desync = true; console.warn('desync', s.desync); }
        for (const e of s.takeEvents()) {
          if (e.t === 'death' || e.t === 'taunt' || e.t === 'forfeit' || e.t === 'alienkill' || e.death) this.held.push(e);
          else this.onEvent(e);
        }
        const conf = s.confirmedTick;
        this.held = this.held.filter((e) => {
          if (e.tick > conf) return true;
          // still true after any corrections? (the victim is dead, and died about then)
          const v = e.of !== undefined ? e.of : e.slot, p = g.players.find(q => q.slot === v);
          if (p && !p.alive && Math.abs(p.deathTick - e.tick) <= 3) this.onEvent(e);
          return false;
        });
        this.stallT = s.stalled ? this.stallT + 1 : 0;
      } else {
        if (this.paused || this.quitAsk || AB.debugFreeze) return;
        const inputs = this.devices.map(d => I.read(d));
        g.step(inputs);
        for (const e of g.events) this.onEvent(e);
      }
      // (network: only once the end can't be undone any more)
      if (g.state === 'over' && (!this.session || this.session.confirmedTick >= g.overAt)) {
        // the winner gets to run around for a few seconds; a forced draw (F10) ends right away
        const r = g.result, wait = r.forced ? 0.25 : AB.match.campaign ? 2.5 : r.draw ? 2.5 : 5;
        if (++this.overT > AB.TPS * wait) this.finish();
      } else if (this.session) this.overT = 0;
    },
    onEvent(e) {
      if (e.t === 'snd') { if (e.lo === e.hi) A.play(e.lo); else A.playRange(e.lo, e.hi); }
      else if (e.t === 'taunt') setTimeout(() => A.playRange(700, 999), 500);
      else if (e.t === 'death') { if (340 + e.anim <= 349) A.play(340 + e.anim); }
    },
    // network round: draw the game as this computer knows it for sure. A death the others' inputs could
    // still undo shows the player standing until it's certain; then the death animation starts. Players
    // moved by a correction slide to where they belong instead of jumping (js/net.js smooth).
    drawNet(ctx) {
      const g = this.g, s = this.session, conf = s.confirmedTick, undo = [];
      g.players.forEach((p, i) => {
        if (!p.alive && p.deathTick > conf) { undo.push([p, 'alive', p.alive]); p.alive = true; return; }
        if (!p.alive) {
          const k = p.slot, d = this.deathShown[k];
          if (!d || d.tick !== p.deathTick) this.deathShown[k] = { tick: p.deathTick, at: g.tick };
          const late = this.deathShown[k].at - p.deathTick;
          if (late > 0) {
            const dieT = Math.max(0, p.dieT - late);
            undo.push([p, 'dieT', p.dieT], [p, 'dieY', p.dieY]);
            if (p.dieT > 0) p.dieY = p.dieY * dieT / p.dieT;
            p.dieT = dieT;
          }
          return;
        }
        const o = s.smooth[i];
        if (o && (o[0] || o[1])) { undo.push([p, 'x', p.x], [p, 'y', p.y]); p.x += Math.round(o[0]); p.y += Math.round(o[1]); }
      });
      try { AB.render.draw(ctx, g, this.t); }
      finally { for (let k = undo.length - 1; k >= 0; k--) undo[k][0][undo[k][1]] = undo[k][2]; }
    },
    finish() {
      const g = this.g, M = AB.match, res = g.result;
      for (const p of g.players) M.kills[p.slot] = (M.kills[p.slot] || 0) + p.kills;
      if (!res.draw && res.winner) {
        // team play: the whole team scores the round, including teammates who didn't survive
        const scorers = res.winner.team !== undefined ? M.players.filter(p => p.team === res.winner.team).map(p => p.slot) : res.winner.players;
        for (const s of scorers) M.wins[s] = (M.wins[s] || 0) + 1;
      }
      M.lastResult = res; M.lastLevel = g.level;
      if (M.demo) { SC.go('mainmenu'); return; }
      if (M.campaign) {
        const cs = M.campaign, c = window.AB_CAMPAIGNS[cs.ci];
        if (!res.cleared) { SC.go('campfail'); return; }
        const P = AB.settings.campaignProgress = AB.settings.campaignProgress || {};
        P[c.file] = Math.max(P[c.file] || 0, cs.stage + 1); AB.saveSettings();
        cs.stage++;
        SC.go(cs.stage >= c.stages.length ? 'campdone' : 'campstage');
        return;
      }
      if (res.draw) SC.go('draw'); else SC.go('results');
    },
    render(ctx) {
      if (this.session) this.drawNet(ctx); else AB.render.draw(ctx, this.g, this.t);
      const M = AB.match;
      if (M && M.campaign) {
        // enemies left in this campaign stage
        const g = this.g, gh = g.aliens.filter(a => a.alive && a.type === 2).length, ro = g.aliens.filter(a => a.alive && a.type === 1).length;
        const ai = g.players.filter(p => p.isAI && p.alive).length;
        const txt = [gh ? `ghosts ${gh}` : '', ro ? `rovers ${ro}` : '', ai ? `dudes ${ai}` : ''].filter(Boolean).join('  ') || 'stage clear!';
        G.text(ctx, txt, 515, 28, ai + gh + ro ? WHITE : '#60f060', 'font0', 2);
      }
      if (M && M.demo && blink()) { panel(ctx, 230, 450, 180, 24, 0.7); centerText(ctx, 'DEMO - press any key', 454, YELLOW, 'font0'); }
      // round start: the arena's name and a 3, 2, 1 countdown
      if (this.g.startDelay > 0) {
        const g = this.g, n = Math.ceil(g.startDelay / AB.TPS), frac = (g.startDelay % AB.TPS) / AB.TPS;
        G.titleText(ctx, AB.levelName(g.level), 320, 200, 52, 560);
        G.titleText(ctx, String(n), 320, 322, 76 + Math.round(30 * frac), 200, 0.8 + 0.2 * frac);
      }
      if (this.session && this.showNet) {
        const st = AB.netmatch.statsLines(this.netStats);
        this.netStats = st.keep;
        panel(ctx, 4, 40, 400, 12 + st.lines.length * 13, 0.75);
        st.lines.forEach((l, i) => G.text(ctx, l, 10, 46 + i * 13, i < 4 ? WHITE : CYAN, 'font0'));
      }
      if (this.session && this.stallT > 20) {
        const who = this.session.missing().map(i => this.g.players[i] && this.g.players[i].name).filter(Boolean);
        panel(ctx, 140, 220, 360, 44, 0.85);
        centerText(ctx, 'Waiting for ' + (who.length ? [...new Set(who)].join(', ') : 'the other computers') + '...', 228, YELLOW, 'font0');
        centerText(ctx, Math.floor(this.stallT / AB.TPS) + ' s', 246, GREY, 'font0');
      }
      if (this.desync) { panel(ctx, 120, 200, 400, 60, 0.92); centerText(ctx, 'The computers are out of sync.', 214, ORANGE); centerText(ctx, 'Press Esc to leave the match.', 238, WHITE, 'font0'); }
      if (this.paused) { panel(ctx, 220, 210, 200, 50, 0.85); centerText(ctx, 'PAUSED', 226, YELLOW); }
      if (this.forfeitAsk > 0) { panel(ctx, 150, 206, 340, 40, 0.88); centerText(ctx, 'Press F10 again to forfeit this round', 220, YELLOW, 'font0'); }
      if (this.quitAsk) {
        panel(ctx, 160, 200, 320, 80, 0.88);
        centerText(ctx, 'Quit this match?', 218, YELLOW);
        centerText(ctx, this.net ? 'Y = leave the network game    other = resume' : 'Y = quit to main menu    other = resume', 246, WHITE, 'font0');
      }
    },
  });

  // ================================================================= DRAW / RESULTS / VICTORY
  SC.register('draw', {
    enter() { this.t = 0; A.music('draw', false); A.playRange(1700, 1999); },
    key(k) { if (this.t > 30 && (isOK(k) || isBack(k))) SC.go('results'); },
    tick() { if (++this.t > AB.TPS * 6) SC.go('results'); },
    render(ctx) { G.blit(ctx, 'draw', 0, 0); },
  });

  // match rules: a network match uses the host's settings
  const MS = () => (AB.match && AB.match.S) || AB.settings;
  // network matches name their players ("Alice", "Computer 1"); local ones say "Player 3" like the original
  const netName = (slot) => { const M = AB.match, p = M && M.net && M.players.find(q => q.slot === slot); return p ? p.name : null; };
  const pLabel = (slot) => netName(slot) || AB.msg(33, 'Player %u').replace('%u', slot + 1);
  function matchWinner() {
    const M = AB.match, S = MS();
    const need = S.winsNeeded;
    const score = (p) => (S.winByKills ? (M.kills[p.slot] || 0) : (M.wins[p.slot] || 0));
    if (S.teamPlay) {
      // team score: shared wins, or the team's combined kills
      let best = null;
      for (const team of [0, 1]) {
        const members = M.players.filter(p => p.team === team);
        if (!members.length) continue;
        const v = S.winByKills ? members.reduce((a, p) => a + score(p), 0) : Math.max(...members.map(score));
        if (v >= need && (!best || v > best.v)) best = { team, p: members[0], v };
      }
      return best;
    }
    let best = null;
    for (const p of M.players) {
      const v = score(p);
      if (v >= need && (!best || v > best.v)) best = { p, v };
    }
    return best;
  }

  AB.matchWinner = () => matchWinner();
  SC.register('results', {
    enter() { this.t = 0; A.music('lose', false); this.winner = matchWinner(); this.pick = null; },
    key(k) {
      if (this.t < 30) return;
      if (AB.match && AB.match.net) {
        const NM = AB.netmatch, host = AB.netplay.isHost();
        // a member's sound list (after a few presses): up/down choose, bomb sends, Esc closes it
        if (!host && this.pick !== null) {
          const n = NM.NUDGE_SOUNDS.length;
          if (k.code === 'ArrowUp') { this.pick = (this.pick + n - 1) % n; A.play(20); }
          else if (k.code === 'ArrowDown') { this.pick = (this.pick + 1) % n; A.play(21); }
          else if (isOK(k)) NM.nudge(this.pick);
          else if (isBack(k)) this.pick = null;
          return;
        }
        if (isBack(k) && k.pad === undefined && !host) { NM.quit(); return; }
        if ((isOK(k) || isBack(k)) && host) NM.hostContinue(this.winner);
        else if (isOK(k) && NM.nudge() >= 3) this.pick = 0;      // only the host moves on: say so
        return;
      }
      if (isOK(k) || isBack(k)) {
        if (isBack(k) && !this.winner && k.pad === undefined) { AB.match = null; SC.go('mainmenu'); return; }
        if (this.winner) SC.go('victory', this.winner); else nextRound();
      }
    },
    tick() { this.t++; },
    render(ctx) {
      G.blit(ctx, 'results', 0, 0);
      const M = AB.match, S = MS(), res = M.lastResult;
      const top = AB.val(800, [150, 94]), hd = AB.val(780, [150, 140]), row = AB.val(785, [150, 210, 20]);
      if (this.winner) {
        const t = S.teamPlay && this.winner.team !== undefined ? AB.msg(34, 'Team %u').replace('%u', this.winner.team + 1).toUpperCase() + ' WINS THE MATCH!'
          : netName(this.winner.p.slot) ? netName(this.winner.p.slot).toUpperCase() + ' WINS THE MATCH!' : AB.msg(36, 'PLAYER %u WINS THE MATCH!').replace('%u', this.winner.p.slot + 1);
        G.text(ctx, t, top[0], top[1], YELLOW, 'font1');
      } else {
        G.text(ctx, S.winByKills ? AB.msg(121, '(Match winner must score %u kills)').replace('%u', S.winsNeeded) : AB.msg(120, '(Match winner must score %u victories)').replace('%u', S.winsNeeded), top[0], top[1], GREY, 'font1');
      }
      let head;
      if (!res || res.draw || !res.winner) head = AB.msg(30, 'Game Winner was %s !').replace('%s', AB.msg(32, 'undetermined'));
      else if (res.winner.team !== undefined) head = AB.msg(30, 'Game Winner was %s !').replace('%s', AB.msg(34, 'Team %u').replace('%u', res.winner.team + 1));
      else head = AB.msg(30, 'Game Winner was %s !').replace('%s', pLabel(res.winner.slot));
      G.text(ctx, head, hd[0], hd[1], WHITE, 'font1');
      const wz = G.image('winz');
      M.players.forEach((p, i) => {
        const y = row[1] + i * row[2];
        const won = res && res.winner && res.winner.players.includes(p.slot);
        miniHead(ctx, p.color, row[0] - 16, y);
        const nd = M.net && AB.netmatch.nudgeOf(p);
        if (nd) drawNudge(ctx, row[0] - 44, y + 7, nd);
        let line = AB.msg(31, 'Player %u score: %u (kills: %d)').replace('%u', p.slot + 1).replace('%u', M.wins[p.slot] || 0).replace('%d', M.kills[p.slot] || 0);
        if (netName(p.slot)) line = line.replace(AB.msg(33, 'Player %u').replace('%u', p.slot + 1), netName(p.slot));
        G.text(ctx, line, row[0], y, won ? YELLOW : WHITE, 'font1');
        const w = M.wins[p.slot] || 0;
        for (let k = 0; k < w; k++) {
          if (wz.complete) ctx.drawImage(wz, 420 + k * 20, y - 1, 18, 18);
          miniHead(ctx, p.color, 429 + k * 20, y + 1);
        }
      });
      if (M.net && !AB.netplay.isHost() && this.pick !== null) {
        const list = AB.netmatch.NUDGE_SOUNDS, x = 424, y = 162, h = 15;
        panel(ctx, x, y, 210, 30 + list.length * h, 0.88);
        G.text(ctx, 'Send the others a sound:', x + 10, y + 7, YELLOW, 'font0');
        list.forEach((s, i) => G.text(ctx, (i === this.pick ? '> ' : '  ') + s[0], x + 10, y + 24 + i * h, i === this.pick ? WHITE : GREY, 'font0'));
        if (this.t > 30) centerText(ctx, 'Waiting for the host...   Up/Down: pick a sound   Bomb: send   Esc: close', 440, GREY, 'font0');
      } else if (M.net && !AB.netplay.isHost()) { if (this.t > 30) centerText(ctx, 'Waiting for the host...   (Esc: leave the network game)', 440, GREY, 'font0'); }
      else if (this.t > 30 && blink()) centerText(ctx, this.winner ? 'Press bomb to continue' : M.net ? 'Press bomb for the next round' : 'Press bomb for the next round   (Esc: quit match)', 440, WHITE, 'font0');
    },
  });

  // a "come on!" marker by a player whose computer keeps pressing to go on: pops on each press, then fades
  function drawNudge(ctx, x, y, nd) {
    const age = (performance.now() - nd.at) / 1000, pop = Math.max(0, 1 - age / 0.4);
    const r = 7 + 3 * pop, a = Math.max(0.55, 1 - age / 2);
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = nd.n > 2 ? '#ff6030' : '#f8d848';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x + r * 0.5, y + r * 0.7); ctx.lineTo(x + r + 3, y + r + 3); ctx.lineTo(x + r * 0.9, y + r * 0.2); ctx.fill();
    ctx.fillStyle = '#000'; ctx.font = `bold ${Math.round(r * 1.5)}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('!', x, y + 1);
    ctx.restore();
    if (nd.n > 1) G.text(ctx, 'x' + nd.n, x - 30, y - 5, nd.n > 2 ? ORANGE : YELLOW, 'font0');
  }
  SC.register('victory', {
    enter(w) {
      this.w = w; this.t = 0;
      A.music('win', false); A.playRange(2000, 2299);
      AB.match.over = true;
    },
    key(k) {
      if (this.t < 40) return;
      if (AB.match && AB.match.net) {
        if (AB.netplay.isHost() && (isOK(k) || isBack(k))) AB.netmatch.hostEnd();
        else if (isBack(k) && k.pad === undefined) AB.netmatch.quit();
        return;
      }
      if (isOK(k) || isBack(k)) {
        if (MS().goldBomberman && !AB.match.demo) SC.go('roulette', this.w);
        else { AB.match = null; SC.go('players'); }
      }
    },
    tick() { this.t++; },
    render(ctx) {
      const w = this.w;
      if (MS().teamPlay && w.team !== undefined) G.blit(ctx, 'team' + (w.team ? 1 : 0), 0, 0);
      else G.blit(ctx, 'victory' + w.p.color, 0, 0);
      const txt = MS().teamPlay && w.team !== undefined ? `TEAM ${w.team ? 'RED' : 'WHITE'} WINS THE MATCH!`
        : netName(w.p.slot) ? netName(w.p.slot).toUpperCase() + ' WINS THE MATCH!' : AB.msg(36, 'PLAYER %u WINS THE MATCH!').replace('%u', w.p.slot + 1);
      panel(ctx, 120, 412, 400, 34, 0.55);
      centerText(ctx, txt, 420, YELLOW);
    },
  });

  // ================================================================= GOLD BOMBERMAN ROULETTE
  const ROUL = [
    ['powbomb', AB.PW.BOMB], ['powflame', AB.PW.FLAME], ['powdisea', AB.PW.DISEASE], ['powkick', AB.PW.KICK], ['powskate', AB.PW.SKATE],
    ['powpunch', AB.PW.PUNCH], ['powgrab', AB.PW.GRAB], ['powspoog', AB.PW.SPOOGE], ['powgold', AB.PW.GOLDFLAME], ['powtrig', AB.PW.TRIGGER],
    ['powjelly', AB.PW.JELLY], ['powbad', AB.PW.BADDISEASE], ['powrand', AB.PW.RANDOM], ['powslow', AB.PW.CLOG],
  ];
  SC.register('roulette', {
    help: 'roulette',
    enter(w) {
      this.w = w; this.pos = Math.random() * ROUL.length; this.speed = 0.55 + Math.random() * 0.2; this.done = false; this.t = 0; this.lastI = -1;
      A.music('menu');
    },
    key(k) {
      if (this.done && (isOK(k) || isBack(k))) { AB.nextBonus = { slot: this.w.p.slot, pw: ROUL[this.result][1] }; AB.match = null; SC.go('players'); }
    },
    tick() {
      this.t++;
      if (!this.done) {
        this.pos += this.speed; this.speed *= 0.985;
        const i = Math.floor(this.pos) % ROUL.length;
        if (i !== this.lastI) { A.play(1300); this.lastI = i; }
        if (this.speed < 0.01) {
          this.done = true; this.result = i;
          if (ROUL[i][1] === AB.PW.CLOG || ROUL[i][1] === AB.PW.DISEASE || ROUL[i][1] === AB.PW.BADDISEASE) A.play(1320); else A.play(1310);
        }
      }
    },
    render(ctx) {
      G.blit(ctx, 'roulette', 0, 0);
      const c = AB.val(1000, [320, 240]), r = AB.val(1002, [200, 150]);
      const n = ROUL.length, sel = Math.floor(this.pos) % n;
      centerText(ctx, AB.msg(650, 'Goldman Roulette Wheel'), AB.val(805, [320, 30])[1], YELLOW);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const x = c[0] + Math.cos(a) * r[0] * 0.95, y = c[1] + 40 + Math.sin(a) * r[1] * 0.9;
        const im = G.image(ROUL[i][0]);
        if (i === sel) { ctx.fillStyle = (this.t >> 2) % 2 ? '#ffe040' : '#ff8000'; ctx.fillRect(x - 24, y - 22, 48, 44); }
        if (im.complete) ctx.drawImage(im, x - 20, y - 18);
      }
      if (this.done) {
        panel(ctx, 120, 400, 400, 60, 0.85);
        centerText(ctx, AB.msg(790, 'The Gold Player has'), 408, WHITE, 'font0');
        centerText(ctx, AB.msg(800 + ROUL[this.result][1], '') + ' ' + AB.msg(791, 'for the next match!!'), 430, YELLOW, 'font1');
      }
    },
  });

  // ================================================================= SETTINGS (main menu "Options")
  function musicSummary(S) {
    const on = AB.MUSIC_TRACKS.filter(t => AB.trackOn(S, t.id)), n = on.length;
    const levelsOnly = n === AB.LEVEL_MUSIC.length && on.every(t => AB.LEVEL_MUSIC.includes(t.id));
    const what = n === 0 ? 'Off' : n === AB.MUSIC_TRACKS.length ? 'All tracks' : levelsOnly ? 'All level tracks' : `${n} of ${AB.MUSIC_TRACKS.length} tracks`;
    return what + (n > 1 && S.musicOrder === 'shuffle' ? ', shuffled' : '') + '  >';
  }
  SC.register('settings', {
    help: 'options',
    enter() { this.sel = this.sel || 0; },

    items() {
      const S = AB.settings, cyc = (arr, v, d) => arr[(arr.indexOf(v) + d + arr.length) % arr.length];
      return [
        { label: AB.msg(250, 'Team Play: %s').replace('%s', yesno(S.teamPlay)), change: () => { S.teamPlay = !S.teamPlay; } },
        { label: AB.msg(251, 'Random Start: %s').replace('%s', yesno(S.randomStart)), change: () => { S.randomStart = !S.randomStart; } },
        { label: AB.msg(253, 'Conveyor Speed: %s').replace('%s', [AB.msg(295), AB.msg(296), AB.msg(297)][S.conveyorSpeed]), change: (d) => { S.conveyorSpeed = (S.conveyorSpeed + d + 3) % 3; } },
        { label: AB.msg(254, 'Stomped Bombs Detonate: %s').replace('%s', yesno(S.stompedDetonate)), change: () => { S.stompedDetonate = !S.stompedDetonate; } },
        { label: AB.msg(255, 'Win Matches By Kill Total: %s').replace('%s', yesno(S.winByKills)), change: () => { S.winByKills = !S.winByKills; } },
        { label: AB.msg(256, 'Gold Bomberman: %s').replace('%s', yesno(S.goldBomberman)), change: () => { S.goldBomberman = !S.goldBomberman; } },
        { label: AB.msg(257, 'Enclosement Depth: %s').replace('%s', AB.msg(315 + S.enclosement)), change: (d) => { S.enclosement = (S.enclosement + d + 4) % 4; } },
        { label: AB.msg(258, 'Scheme File: %s').replace('%s', (() => { const on = AB.schemesOn(S); return on.length === 1 ? on[0].toUpperCase() + '.SCH' : on.length + ' ticked'; })()) + '  >', action: () => SC.go('schemes', { back: 'settings' }) },
        { label: AB.msg(259, 'Play Time: %s').replace('%s', fmtTime(S.playTime)), change: (d) => { S.playTime = cyc(AB.PLAY_TIMES, S.playTime, d); } },
        { label: AB.msg(260, 'Assign Keyboard Player: %s').replace('%s', yesno(S.assignKeyboard)), change: () => { S.assignKeyboard = !S.assignKeyboard; } },
        { label: AB.msg(261, 'Diseases Can Be Destroyed: %s').replace('%s', yesno(S.diseasesDestroyable)), change: () => { S.diseasesDestroyable = !S.diseasesDestroyable; } },
        { label: AB.msg(262, 'Lost net players revert to AIs: %s').replace('%s', yesno(S.lostNetToAI)), change: () => { S.lostNetToAI = !S.lostNetToAI; } },
        { label: `Gameplay Music: ${musicSummary(S)}`, action: () => SC.go('music') },
        { label: `Sounds & Voices: ${(A.PRESET_LABEL[A.preset()] || A.preset()) + (A.isCustom() ? ', customised' : '')}  >`, action: () => SC.go('sounds') },
        { label: `Arena Tileset: ${AB.tilesets.name()}  >`, action: () => SC.go('tilesets', { back: 'settings' }) },
        { label: `Graphics: ${S.enhancedGfx !== false ? 'Enhanced (soft edges, glowing flames)' : 'Original (hard colour key)'}`, change: () => { S.enhancedGfx = S.enhancedGfx === false; AB.applyDisplay(); } },
        { label: `Screen Scaling: ${S.smoothScaling ? 'Smooth' : 'Sharp pixels'}`, change: () => { S.smoothScaling = !S.smoothScaling; AB.applyDisplay(); } },
        { label: `Idle Animations: ${S.idleAnims !== false ? 'On (unused CD animations)' : 'Off'}`, change: () => { S.idleAnims = S.idleAnims === false; } },
        { label: `Intro Movie on Start: ${yesno(S.playIntro !== false)}`, change: () => { S.playIntro = S.playIntro === false; } },
        { label: `Round Start Countdown: ${yesno(S.countdown !== false)}`, change: () => { S.countdown = S.countdown === false; } },
        { label: `Music Volume: ${Math.round(S.musicVolume * 10)}`, change: (d) => { S.musicVolume = AB.clamp(Math.round(S.musicVolume * 10 + d) / 10, 0, 1); A.setVolumes(S.musicVolume, S.sfxVolume); } },
        { label: `Sound Effects Volume: ${Math.round(S.sfxVolume * 10)}`, change: (d) => { S.sfxVolume = AB.clamp(Math.round(S.sfxVolume * 10 + d) / 10, 0, 1); A.setVolumes(S.musicVolume, S.sfxVolume); A.playRange(400, 499); } },
        { label: AB.msg(265, 'Define keyboard layouts'), action: () => SC.go('keys') },
        { label: 'Done', action: () => { AB.saveSettings(); SC.go('mainmenu'); } },
      ];
    },
    key(k) {
      const items = this.items();
      const it = items[this.sel];
      if (k.code === 'ArrowUp') this.sel = (this.sel + items.length - 1) % items.length;
      else if (k.code === 'ArrowDown') this.sel = (this.sel + 1) % items.length;
      else if ((k.code === 'ArrowLeft' || k.code === 'ArrowRight') && it.change) { it.change(k.code === 'ArrowLeft' ? -1 : 1); A.play(20); }
      else if (isOK(k)) { if (it.action) it.action(); else if (it.change) { it.change(1); A.play(20); } }
      else if (isBack(k)) { AB.saveSettings(); SC.go('mainmenu'); }
    },
    render(ctx) {
      glueDim(ctx, 3);
      const l = AB.val(745, [55, 40, 22, 500]);
      const items = this.items(), rows = 17;
      this.top = AB.clamp(this.top || 0, Math.max(0, this.sel - rows + 1), Math.min(this.sel, Math.max(0, items.length - rows)));
      for (let r = 0; r < rows && this.top + r < items.length; r++) {
        const i = this.top + r, it = items[i], y = l[1] + r * l[2];
        if (i === this.sel) menuCursor(ctx, l[0] - 16, y + 17);
        G.text(ctx, it.label, l[0], y, i === this.sel ? YELLOW : WHITE, 'font1');
      }
      if (this.top > 0) G.text(ctx, '...', l[0], l[1] - 18, GREY, 'font1');
      if (this.top + rows < items.length) G.text(ctx, '...', l[0], l[1] + rows * l[2] - 6, GREY, 'font1');
      G.text(ctx, 'Left/Right/Enter: change     Esc: back', 320, 418, GREY, 'font0', 1);
      f1Hint(ctx);
    },
  });

  // ================================================================= GAMEPLAY MUSIC (port addition)
  // tick the tracks that may play during a round; the track under the cursor plays as a preview and the
  // menu music comes back on leaving. Rows: order, one per track, tick all, untick all, done.
  SC.register('music', {
    help: 'options',
    enter() { this.sel = this.sel || 0; this.hold = 0; this.preview = A.musicName(); },
    rows() {
      const S = AB.settings, T = AB.MUSIC_TRACKS;
      const setAll = (v) => { S.gameMusic = {}; for (const t of T) S.gameMusic[t.id] = v; };
      return [{ label: `Track Order: ${S.musicOrder === 'shuffle' ? 'Shuffle ticked tracks' : "Each level's own track"}`, change: () => { S.musicOrder = S.musicOrder === 'shuffle' ? 'level' : 'shuffle'; } }]
        .concat(T.map(t => ({ track: t, label: t.name, change: () => { S.gameMusic = Object.assign({}, S.gameMusic, { [t.id]: !AB.trackOn(S, t.id) }); } })))
        .concat([{ label: 'Tick all', action: () => setAll(true) }, { label: 'Untick all', action: () => setAll(false) },
                 { label: 'Done', action: () => this.close() }]);
    },
    close() { AB.saveSettings(); A.music('menu'); SC.go('settings'); },
    key(k) {
      const rows = this.rows(), it = rows[this.sel];
      if (k.code === 'ArrowUp') this.sel = (this.sel + rows.length - 1) % rows.length;
      else if (k.code === 'ArrowDown') this.sel = (this.sel + 1) % rows.length;
      else if ((k.code === 'ArrowLeft' || k.code === 'ArrowRight') && it.change) { it.change(); A.play(20); }
      else if (isOK(k)) { if (it.action) it.action(); else if (it.change) it.change(); A.play(20); }
      else if (isBack(k)) this.close();
      this.hold = 0;
    },
    tick() {
      // start the highlighted track after a short pause so scrolling through the list stays quiet
      const it = this.rows()[this.sel];
      if (it && it.track && ++this.hold === 12 && this.preview !== it.track.id) { this.preview = it.track.id; A.music(it.track.id); }
    },
    render(ctx) {
      glueDim(ctx, 3);
      panel(ctx, 40, 22, 560, 406, 0.55);
      centerText(ctx, 'GAMEPLAY MUSIC', 34, YELLOW);
      const S = AB.settings, rows = this.rows();
      rows.forEach((it, i) => {
        const y = 72 + i * 20, sel = i === this.sel;
        if (sel) { ctx.fillStyle = 'rgba(248,216,72,0.16)'; ctx.fillRect(48, y - 2, 544, 20); menuCursor(ctx, 66, y + 16); }
        let x = 84;
        if (it.track) {
          drawTick(ctx, x, y, AB.trackOn(S, it.track.id) ? 2 : 0, sel);
          x += 24;
        }
        G.text(ctx, it.label, x, y, sel ? YELLOW : (it.track && !AB.trackOn(S, it.track.id) ? GREY : WHITE), 'font1');
        if (it.track && A.musicName() === it.track.id) {           // now-playing bars
          for (let b = 0; b < 3; b++) {
            const h = 3 + Math.abs(Math.sin(frame / (5 + b * 2) + b * 1.7)) * 10;
            ctx.fillStyle = ORANGE; ctx.fillRect(560 + b * 6, y + 15 - h, 4, h);
          }
        }
      });
      G.text(ctx, 'Up/Down: listen   Enter/Space: tick   Esc: back', 320, 412, GREY, 'font0', 1);
      f1Hint(ctx);
    },
  });

  // ================================================================= KEY BINDINGS
  const ACTIONS = ['up', 'down', 'left', 'right', 'bomb', 'action'];
  SC.register('keys', {
    enter() { this.p = 0; this.a = 0; this.wait = false; },
    get textEntry() { return this.wait; },
    key(k) {
      if (this.wait) {
        if (k.code !== 'Escape') { I.layouts[this.p][ACTIONS[this.a]] = k.code; I.saveLayouts(); }
        this.wait = false; return;
      }
      if (k.code === 'ArrowUp') this.a = (this.a + ACTIONS.length) % (ACTIONS.length + 1);
      if (k.code === 'ArrowDown') this.a = (this.a + 1) % (ACTIONS.length + 1);
      if (k.code === 'ArrowLeft') this.p = (this.p + 3) % 4;
      if (k.code === 'ArrowRight') this.p = (this.p + 1) % 4;
      if (isOK(k)) {
        if (this.a === ACTIONS.length) { localStorage.removeItem('ab_keys'); location.reload(); return; }
        this.wait = true;
      }
      if (isBack(k)) SC.go('settings');
    },
    render(ctx) {
      glue(ctx, 4);
      panel(ctx, 30, 30, 580, 420);
      centerText(ctx, 'DEFINE KEYBOARD LAYOUTS', 44, YELLOW);
      for (let p = 0; p < 4; p++) {
        const x = 60 + p * 140;
        G.text(ctx, 'KEY ' + p, x, 90, p === this.p ? YELLOW : WHITE, 'font1');
        ACTIONS.forEach((a, i) => {
          const y = 130 + i * 34;
          const on = p === this.p && i === this.a;
          if (on) { ctx.fillStyle = this.wait ? 'rgba(255,120,40,0.5)' : 'rgba(248,216,72,0.25)'; ctx.fillRect(x - 6, y - 4, 130, 26); }
          G.text(ctx, a, x, y, GREY, 'font0');
          G.text(ctx, on && this.wait ? '...' : I.keyLabel(I.layouts[p][a]), x + 56, y, WHITE, 'font1');
        });
      }
      const ry = 130 + ACTIONS.length * 34 + 10;
      if (this.a === ACTIONS.length) { ctx.fillStyle = 'rgba(248,216,72,0.25)'; ctx.fillRect(200, ry - 4, 240, 26); }
      centerText(ctx, 'Return to default keys', ry, WHITE);
      G.text(ctx, 'Arrows select   Enter: press a new key   Esc: back', 320, 420, GREY, 'font0', 1);
    },
  });

  // ================================================================= ONLINE MANUAL
  SC.register('help', {
    enter(a) {
      this.back = (a && a.back) || 'mainmenu';
      const H = window.AB_DATA.help;
      this.files = Object.keys(H).filter(k => k !== 'highmem' && k !== 'lowmem' && !k.startsWith('port')).sort();   // port* = the port's own pages, opened with F1
      this.file = a && a.file && H[a.file] ? a.file : null;
      this.sel = 0; this.scroll = 0;
    },
    key(k) {
      const H = window.AB_DATA.help;
      if (!this.file) {
        if (k.code === 'ArrowUp') this.sel = (this.sel + this.files.length - 1) % this.files.length;
        else if (k.code === 'ArrowDown') this.sel = (this.sel + 1) % this.files.length;
        else if (isOK(k)) { this.file = this.files[this.sel]; this.scroll = 0; }
        else if (isBack(k)) { if (this.back === '__pop') SC.pop(); else SC.go(this.back); }
        return;
      }
      const lines = H[this.file].split('\n').length;
      if (k.code === 'ArrowDown') this.scroll = Math.max(0, Math.min(lines - 20, this.scroll + 1));
      else if (k.code === 'ArrowUp') this.scroll = Math.max(0, this.scroll - 1);
      else if (k.code === 'PageDown' || k.code === 'Space') this.scroll = Math.min(Math.max(0, lines - 20), this.scroll + 20);
      else if (k.code === 'PageUp') this.scroll = Math.max(0, this.scroll - 20);
      else if (isBack(k) || k.code === 'Enter') { if (this.back === '__pop') SC.pop(); else this.file = null; }
    },
    render(ctx) {
      glue(ctx, 5);
      panel(ctx, 16, 16, 608, 448, 0.82);
      if (!this.file) {
        centerText(ctx, AB.msg(600, 'Available help files:'), 40, YELLOW);
        this.files.forEach((f, i) => {
          const y = 80 + i * 26;
          if (i === this.sel) menuCursor(ctx, 212, y + 17);
          G.text(ctx, f.toUpperCase() + '.BM', 230, y, i === this.sel ? YELLOW : WHITE, 'font1');
        });
        return;
      }
      const lines = window.AB_DATA.help[this.file].replace(/\t/g, '    ').split('\n');
      for (let i = 0; i < 25; i++) {
        const s = lines[this.scroll + i];
        if (s === undefined) break;
        const isHead = /^[*~=]/.test(s);
        G.text(ctx, s.replace(/<IMG\w+>/g, '  '), 30, 26 + i * 17, isHead ? YELLOW : WHITE, 'font0', 0, false);
        const m = /<IMG(\w+)>/.exec(s);
        if (m) { const im = G.image(m[1].toLowerCase()); if (im.complete && im.naturalWidth) ctx.drawImage(im, 30, 26 + i * 17 - 2, 20, 18); }
      }
      G.text(ctx, 'Up/Down/PgUp/PgDn scroll   Esc: back', 320, 446, GREY, 'font0', 1);
    },
  });

  // ================================================================= CREDITS
  SC.register('credits', {
    help: 'credits',
    enter() { this.y = 0; A.music('menu'); },
    key(k) { if (isBack(k) || isOK(k)) SC.go('mainmenu'); },
    tick() { this.y += 0.5; },
    render(ctx) {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 640, 480);
      G.blit(ctx, 'credbar', 220, 4);
      const lines = window.AB_DATA.help.credits.replace(/\t/g, '    ').split('\n');
      ctx.save(); ctx.beginPath(); ctx.rect(0, 110, 640, 370); ctx.clip();
      const total = lines.length * 18 + 400;
      const off = this.y % total;
      lines.forEach((s, i) => {
        const y = 480 + i * 18 - off;
        if (y > 90 && y < 480) G.text(ctx, s.trim(), 320, y, /^[*~=]/.test(s) ? YELLOW : WHITE, 'font0', 1, false);
      });
      ctx.restore();
      ctx.drawImage(G.image('kurt'), 520, 380);
      ctx.drawImage(G.image('jerm'), 20, 360);
    },
  });

  function hashStr(s) { let h = 0; for (const c of s) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0; return h; }

  // ================================================================= TEST (developer)
  SC.register('test', {
    enter() {
      const n = +(AB.params.get('n') || 4);
      const lvl = AB.params.get('level');
      if (lvl !== null) AB.testLevel = +lvl;
      if (AB.params.get('scheme')) AB.settings.scheme = AB.params.get('scheme');
      AB.match = { wins: {}, kills: {}, round: 1, players: Array.from({ length: n }, (_, i) => ({ slot: i, color: i, team: i % 2, ai: AB.params.get('human') ? i > 0 : true, control: AB.params.get('human') && i === 0 ? 'key0' : 'ai', name: 'Player ' + (i + 1) })), demo: false };
      SC.go('game', {});
    },
  });
})(window.AB);
