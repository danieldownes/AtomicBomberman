// Network play screens: the lobby (three fixed rooms), the room waiting area, and the match controller
// that keeps every computer's rounds in step (start -> load -> ready -> go -> lockstep -> results).
'use strict';
(function (AB) {
  const SC = AB.screens, G = AB.gfx, A = AB.audio, I = AB.input, NP = AB.netplay;
  const U = SC.ui;
  const { YELLOW, WHITE, GREY, ORANGE, CYAN } = U;
  const GREEN = '#60f060';
  if (!AB.settings.netName) { AB.settings.netName = AB.msg(500 + Math.floor(Math.random() * AB.val(47, 49)), 'Bomberman'); AB.saveSettings(); }
  // F1 on the network screens: the original NETWORK.BM covers IPX, modem and serial, so the port has its own
  window.AB_DATA.help.portnet = [
    '**************************************************************',
    'Network Game (HTML5 port)',
    '**************************************************************',
    'Up to five computers and ten players can share a match, like',
    'the original. Everyone meets in one of three fixed rooms, so',
    'there is nothing to set up.',
    '',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'The lobby',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    ' - Your name: press Enter to type it, and Enter again when done.',
    ' - Each room shows whether it is empty, waiting for players or',
    '   playing, who hosts it, and the match settings it uses.',
    ' - Enter on an empty room makes you its host. Enter on a waiting',
    '   room joins it. A room that is playing opens again when its',
    '   match is over.',
    ' - Players here: Enter picks the keyboards and joysticks your',
    '   computer brings, up to four.',
    '',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'The room',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    ' - Ping is the round trip from the host to each computer.',
    ' - The host sets the number of computer players, opens Match',
    '   settings (arenas, scheme, wins, play time and the gameplay',
    '   options) and starts the match (at least two players).',
    ' - Everyone in the room sees the settings change as the host picks',
    '   them. Team play and the Gold Bomberman roulette are off in',
    '   network games.',
    '',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'During a match',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    ' - Every computer runs the same game and only key presses travel',
    '   over the network. If one computer falls behind, the others',
    '   wait for it ("Waiting for ...").',
    ' - Keep the game in the front tab. Browsers slow down background',
    '   tabs, and that holds everyone up.',
    ' - Pause and Force Draw are off.',
    ' - If a computer leaves, its players carry on as computer',
    '   players ("Lost net players revert to AIs" in Options) or drop',
    '   out. If the host leaves, the room closes.',
    '',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'Connections',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'Computers connect to each other directly (WebRTC), and the free',
    'PeerJS server introduces them. That is a shared public service,',
    'so now and then it may be slow or busy.',
    'Most home connections can link directly. Some strict networks',
    '(mobile data, offices, schools) need a relay server in between.',
    'When one is set up, the lobby says "relay ready".',
  ].join('\n');
  const pingCol = (ms) => (ms < 80 ? GREEN : ms < 160 ? YELLOW : ORANGE);
  const fit = (t, w, font = 'font1') => { t = String(t); if (G.textWidth(t, font) <= w) return t; while (t.length > 1 && G.textWidth(t + '...', font) > w) t = t.slice(0, -1); return t + '...'; };

  // ================================================================= MATCH CONTROLLER
  const NM = AB.netmatch = { goRound: 0, cfg: null, session: null, notice: null };
  NP.on((ev) => {
    const room = NP.room;
    switch (ev.t) {
      case 'ls': NM.deliver(ev); break;
      case 'start': NM.start(ev.cfg); break;
      case 'go': NM.goRound = ev.round; break;
      case 'drop': NM.applyDrop(ev); break;
      case 'victory': if (AB.match && AB.match.net) SC.go('victory', AB.matchWinner()); break;
      case 'end':
        if (ev.reason) { NM.notice = ev.reason; NP.leave(); NM.reset(); SC.go('network'); }
        else { NM.reset(); SC.go('room'); }
        break;
      case 'ready': NM.checkGo(); break;
      case 'memberLost': NM.memberLost(ev.member); break;
      case 'hostLost': NM.notice = 'The host left, so the room has closed.'; NM.reset(); SC.go('network'); break;
    }
  });
  NM.pending = [];
  // lockstep messages carry their round: late ones from the last round are dropped, early ones for a
  // round this computer hasn't started yet are kept until it has
  NM.early = [];
  NM.deliver = function (ev) {
    const s = NM.session;
    if (s && s.round === ev.r) { if (NM.transport.onmessage) NM.transport.onmessage(ev.m); }
    else if (!s || ev.r > s.round) NM.early.push(ev);
  };
  NM.reset = function () { NM.session = null; NM.transport = null; NM.cfg = null; NM.pending = []; NM.early = []; if (AB.match && AB.match.net) AB.match = null; };
  // a drop may arrive before this computer has started the round it belongs to: keep it until then
  NM.applyDrop = function (d) {
    if (NM.session && NM.session.round === d.round) NM.session.drop(d.slots, d.from);
    else NM.pending.push(d);
  };
  // host: begin a round on every computer
  NM.hostStart = function (round) {
    const prev = NM.cfg && NM.cfg.players;
    const cfg = NP.makeRound(round, prev);
    NP.setState('playing');
    for (const m of NP.room.members) m.lastTick = 0;
    NP.send({ t: 'start', cfg });
    NM.start(cfg);
  };
  NM.start = function (cfg) {
    const me = NP.myId();
    const first = cfg.round === 1 || !AB.match || !AB.match.net;
    const S = Object.assign({}, AB.settings, cfg.sim);
    const M = AB.match = first ? { net: true, wins: {}, kills: {}, round: 0, players: [], demo: false } : AB.match;
    M.round = cfg.round; M.S = S; M.over = false;
    M.players = cfg.players.map(p => Object.assign({}, p, { control: p.ai ? 'ai' : p.owner === me ? p.control : 'net' }));
    NM.cfg = cfg; NM.session = null;
    for (const m of (NP.room ? NP.room.members : [])) m.ready = false;
    SC.go('glue', { level: cfg.level, net: cfg.round, then: () => SC.go('game', { net: cfg }) });
  };
  // after loading: tell the host; the host starts everyone together once all are loaded (or after 12 s)
  NM.ready = function (round) {
    NM.readyAt = performance.now();
    if (NP.isHost()) { NM.myReady = round; NM.checkGo(); } else NP.send({ t: 'ready', round });
  };
  NM.checkGo = function () {
    const room = NP.room; if (!room || !room.host || !NM.cfg) return;
    const r = NM.cfg.round;
    if (NM.myReady !== r || NM.goRound === r) return;
    const all = room.members.slice(1).every(m => m.ready === r);
    if (all || performance.now() - NM.readyAt > 12000) { NP.send({ t: 'go', round: r }); NM.goRound = r; }
  };
  setInterval(() => { if (NP.isHost() && NM.cfg && NM.goRound !== NM.cfg.round) NM.checkGo(); }, 500);
  // host: a computer left mid-round -> its players stop needing input from the next tick it never sent
  NM.memberLost = function (member) {
    const cfg = NM.cfg;
    if (!cfg) return;
    // (player indexes, which are the lockstep slots; colour slots can have gaps in later rounds)
    const slots = cfg.players.map((p, i) => (p.owner === member.id && !p.ai ? i : -1)).filter(i => i >= 0);
    if (!slots.length) return;
    const s = NM.session && NM.session.round === cfg.round ? NM.session : null;
    // every tick up to member.lastTick was relayed to everyone, so all computers agree on where to cut
    const from = s ? Math.max(member.lastTick + 1, s.game.tick + 1) : 1;
    const d = { t: 'drop', round: cfg.round, slots, from };
    NP.send(d);
    NM.applyDrop(d);
  };
  // a game screen asks for its lockstep session
  NM.makeSession = function (g, devices, cfg) {
    const me = NP.myId();
    const local = [], remote = [];
    cfg.players.forEach((p, i) => { if (p.ai) return; if (p.owner === me) local.push(i); else remote.push(i); });
    const tr = NM.transport = { onmessage: null, send: (m) => NP.send({ t: 'ls', r: cfg.round, m }) };
    const s = new AB.net.LockstepSession(tr, g, {
      localSlots: local, remoteSlots: remote, inputDelay: cfg.delay, readLocal: (i) => I.read(devices[i]),
      onDrop: (slots) => {
        for (const i of slots) {
          const p = g.players[i]; if (!p) continue;
          if (cfg.sim.lostNetToAI) { p.isAI = true; p.ai = { plan: null, t: 0 }; }
          else if (p.alive) g.killPlayer(p, -1, true);
          const mp = AB.match.players[i]; if (mp) { mp.ai = true; mp.control = 'ai'; }
        }
      },
    });
    s.round = cfg.round;
    NM.session = s;
    const early = NM.early.filter(e => e.r === cfg.round);
    NM.early = NM.early.filter(e => e.r > cfg.round);
    for (const e of early) tr.onmessage(e.m);
    for (const d of NM.pending.filter(d => d.round === cfg.round)) s.drop(d.slots, d.from);
    NM.pending = NM.pending.filter(d => d.round !== cfg.round);
    if (NP.room && NP.room.host) {
      NP.room.inGame = true;
      for (const m of NP.room.members) m.lastInput = performance.now();
      // players whose computer left before this round started
      const gone = new Set(cfg.players.filter(p => !p.ai && p.owner && !NP.room.members.some(m => m.id === p.owner)).map(p => p.owner));
      for (const id of gone) NM.memberLost({ id, lastTick: 0 });
    }
    return s;
  };
  // results / victory: only the host moves the match on
  NM.hostContinue = function (winner) {
    if (!NP.isHost()) return;
    if (winner) { NP.send({ t: 'victory' }); SC.go('victory', winner); }
    else NM.hostStart(AB.match.round + 1);
  };
  NM.hostEnd = function () {
    if (!NP.isHost()) return;
    NP.send({ t: 'end' }); NM.reset(); if (NP.room) NP.room.inGame = false; NP.setState('waiting'); SC.go('room');
  };
  NM.quit = function () { NP.leave(); NM.reset(); SC.go('network'); };
  // a round is being played right now (inputs flow): only then does silence from a computer mean it's gone
  NM.roundLive = () => !!NM.session && SC.name() === 'game';

  // ================================================================= LOBBY
  SC.register('network', {
    help: 'portnet',
    get textEntry() { return this.editing; },
    enter() {
      // first visit: start on the name, so it's obvious it can be changed
      if (this.sel === undefined) this.sel = AB.settings.netNameSet ? 2 : 0;
      this.editing = false; this.busy = null; this.err = NM.notice || null; this.errT = NM.notice ? 400 : 0; NM.notice = null;
      if (NP.room) NP.leave();
      NP.enterLobby();
      A.music('menu');
    },
    leave() { if (!NP.room) NP.leaveLobby(); },
    rows() { return [{ k: 'name' }, { k: 'local' }, { k: 'room', n: 1 }, { k: 'room', n: 2 }, { k: 'room', n: 3 }, { k: 'back' }]; },
    key(k) {
      const S = AB.settings;
      if (this.editing) {
        if (k.code === 'Enter' || k.code === 'Escape' || k.code === 'NumpadEnter') {
          this.editing = false; S.netName = (S.netName || '').trim() || 'Bomberman'; S.netNameSet = true; AB.saveSettings(); A.play(10);
        } else if (k.code === 'Backspace') S.netName = (S.netName || '').slice(0, -1);
        else if (k.key && k.key.length === 1 && (S.netName || '').length < 16 && /[\w .!'-]/.test(k.key)) S.netName = (S.netName || '') + k.key;
        return;
      }
      if (this.busy) return;
      const rows = this.rows(), row = rows[this.sel];
      if (k.code === 'ArrowUp') { this.sel = (this.sel + rows.length - 1) % rows.length; A.play(20); }
      else if (k.code === 'ArrowDown') { this.sel = (this.sel + 1) % rows.length; A.play(21); }
      else if (U.isBack(k)) { NP.shutdown(); SC.go('mainmenu'); }
      else if (U.isOK(k)) {
        if (row.k === 'back') { NP.shutdown(); SC.go('mainmenu'); return; }
        if (row.k === 'name') { this.editing = true; A.play(10); return; }
        if (row.k === 'local') { A.play(10); SC.go('netlocal'); return; }
        if (NP.lobby.status !== 'online') { this.err = 'Not connected to the matchmaking server yet.'; this.errT = 180; return; }
        A.play(10);
        const r = NP.lobby.rooms[row.n - 1];
        this.busy = r.state === 'empty' ? 'Opening room ' + row.n + '...' : 'Joining room ' + row.n + '...';
        NP.join(row.n).then(() => { this.busy = null; SC.go('room'); })
          .catch((e) => { this.busy = null; this.err = (e && e.message) || String(e); this.errT = 300; A.play(40); });
      }
    },
    tick() { if (this.errT > 0) this.errT--; },
    render(ctx) {
      U.glueDim(ctx, 6);
      U.panel(ctx, 30, 22, 580, 420, 0.82);
      U.centerText(ctx, 'NETWORK GAME', 34, YELLOW);
      const L = NP.lobby, S = AB.settings;
      const relayNote = NP.relay === 'relay' ? '  -  relay ready' : NP.relay === 'relay failed' ? '  -  relay unavailable' : '';
      const st = L.status === 'online' ? ['Connected to the matchmaking server' + relayNote, NP.relay === 'relay failed' ? YELLOW : GREEN] : L.status === 'connecting' ? ['Connecting to the matchmaking server...', YELLOW]
        : L.status === 'error' ? [L.error || 'Offline', ORANGE] : ['Offline', GREY];
      G.text(ctx, st[0], 320, 58, st[1], 'font0', 1);
      const rows = this.rows();
      rows.forEach((row, i) => {
        const sel = i === this.sel;
        const y = row.k === 'name' ? 82 : row.k === 'local' ? 106 : row.k === 'back' ? 372 : 146 + (row.n - 1) * 72;
        const h = row.k === 'room' ? 62 : 22;
        if (sel) { ctx.fillStyle = 'rgba(248,216,72,0.14)'; ctx.fillRect(42, y - 4, 556, h); U.menuCursor(ctx, 56, y + 16); }
        if (row.k === 'name') {
          G.text(ctx, 'Your name:', 74, y, sel ? YELLOW : WHITE, 'font1');
          G.text(ctx, (S.netName || '') + (this.editing && U.blink() ? '_' : ''), 210, y, this.editing ? YELLOW : CYAN, 'font1');
          if (sel && !this.editing) G.text(ctx, 'Enter: change', 590, y + 2, GREY, 'font0', 2);
        } else if (row.k === 'local') {
          G.text(ctx, 'Players here:', 74, y, sel ? YELLOW : WHITE, 'font1');
          const lp = NP.localControls();
          lp.forEach((c, j) => U.miniHead(ctx, j, 210 + j * 20, y + 2));
          G.text(ctx, lp.map(c => c.toUpperCase().replace(/(\D+)(\d)/, '$1 $2')).join(', '), 214 + lp.length * 20, y + 2, CYAN, 'font0');
          if (sel) G.text(ctx, 'Enter: change', 590, y + 2, GREY, 'font0', 2);
        } else if (row.k === 'back') {
          G.text(ctx, 'Back', 74, y, sel ? YELLOW : WHITE, 'font1');
        } else {
          const r = L.rooms[row.n - 1], info = r.info;
          G.text(ctx, 'Room ' + row.n, 74, y, sel ? YELLOW : WHITE, 'font1');
          let line1, line2 = '', col = GREY;
          if (L.status !== 'online') line1 = '';
          else if (r.state === 'checking') line1 = 'checking...';
          else if (r.state === 'empty' || !info) { line1 = 'Empty - press Enter to host it'; col = CYAN; }
          else {
            const n = info.members.reduce((a, m) => a + m.players.length, 0) + (info.ais || 0);
            line1 = (info.state === 'playing' ? 'Playing' : 'Waiting for players') + `  -  ${n} player${n === 1 ? '' : 's'} on ${info.members.length} computer${info.members.length === 1 ? '' : 's'}`;
            line2 = 'Host: ' + info.hostName + '     ' + info.members.slice(1).map(m => m.name + ' ' + m.ping + ' ms').join(', ');
            col = info.state === 'playing' ? ORANGE : GREEN;
          }
          G.text(ctx, line1, 170, y + 1, col, 'font0');
          if (line2) G.text(ctx, fit(line2, 410, 'font0'), 170, y + 20, GREY, 'font0');
          if (info && info.settings) G.text(ctx, fit(`${info.settings.scheme}  -  ${info.settings.byKills ? info.settings.wins + ' kills' : info.settings.wins + ' wins'}  -  arenas ${info.settings.arenas}`, 410, 'font0'), 170, y + 36, GREY, 'font0');
        }
      });
      G.text(ctx, this.editing ? 'Type a name, Enter when done' : 'Up/Down: choose   Enter: change, join or host   Esc: back', 320, 418, GREY, 'font0', 1);
      if (this.busy) { U.panel(ctx, 160, 200, 320, 44, 0.92); U.centerText(ctx, this.busy, 214, YELLOW); }
      else if (this.errT > 0 && this.err) { U.panel(ctx, 70, 196, 500, 50, 0.92); U.centerText(ctx, fit(this.err, 480, 'font0'), 214, ORANGE, 'font0'); }
    },
  });

  // ================================================================= PLAYERS ON THIS COMPUTER
  // like the local Player Setup, for the (up to four) players this computer brings to a network game
  SC.register('netlocal', {
    help: 'portnet',
    enter() {
      const cur = NP.localControls();
      this.list = [0, 1, 2, 3].map(i => cur[i] || 'off');
      this.sel = 0; this.err = null; this.errT = 0;
    },
    opts() { return SC.uiLate().controlOptions().filter(c => c !== 'ai'); },
    key(k) {
      const o = this.opts();
      if (k.code === 'ArrowUp') { this.sel = (this.sel + 3) % 4; A.play(20); }
      else if (k.code === 'ArrowDown') { this.sel = (this.sel + 1) % 4; A.play(21); }
      else if (k.code === 'ArrowRight') { this.list[this.sel] = o[(o.indexOf(this.list[this.sel]) + 1) % o.length]; A.play(20); }
      else if (k.code === 'ArrowLeft') { this.list[this.sel] = 'off'; A.play(21); }
      else if (U.isOK(k) || U.isBack(k)) {
        const on = this.list.filter(c => c !== 'off');
        if (!on.length) { this.err = 'Pick at least one keyboard or joystick'; this.errT = 150; A.play(40); return; }
        if (new Set(on).size !== on.length) { this.err = AB.msg(45, 'More than one player selected to an input device!'); this.errT = 150; A.play(40); return; }
        AB.settings.netLocal = on; AB.saveSettings(); A.play(10); SC.go('network');
      }
    },
    tick() { if (this.errT > 0) this.errT--; },
    render(ctx) {
      U.glueDim(ctx, 1);
      U.panel(ctx, 30, 22, 580, 420, 0.82);
      U.centerText(ctx, 'PLAYERS ON THIS COMPUTER', 34, YELLOW);
      G.text(ctx, 'Each computer brings up to four players. Computer players are added by the host in the room.', 320, 58, GREY, 'font0', 1);
      const label = SC.uiLate().controlLabel, name = AB.settings.netName;
      const on = this.list.filter(c => c !== 'off').length;
      let n = 0;
      this.list.forEach((c, i) => {
        const y = 96 + i * 30, sel = i === this.sel;
        if (sel) U.menuCursor(ctx, 60, y + 17);
        if (c !== 'off') U.miniHead(ctx, n, 84, y);
        G.text(ctx, `Player ${i + 1}: ${label(c)}`, 104, y, c === 'off' ? GREY : sel ? YELLOW : WHITE, 'font1');
        if (c !== 'off') { n++; G.text(ctx, on > 1 ? `${name} ${n}` : name, 330, y + 2, CYAN, 'font0'); }
      });
      // what the keys are, as on the Player Setup screen
      G.text(ctx, 'Keyboard layouts (Options > Define keyboard layouts):', 84, 232, YELLOW, 'font0');
      const kl = (c) => I.keyLabel(c).replace('Num ', 'N').replace('Enter', 'Ent').replace('Space', 'Spc');
      I.layouts.forEach((Ly, i) => {
        const dirs = Ly.up === 'ArrowUp' && Ly.down === 'ArrowDown' && Ly.left === 'ArrowLeft' ? 'Arrows' : `${kl(Ly.up)}${kl(Ly.left)}${kl(Ly.down)}${kl(Ly.right)}`;
        G.text(ctx, `KEY ${i}:  ${dirs}   bomb ${kl(Ly.bomb)}   action ${kl(Ly.action)}`, 100, 252 + i * 18, WHITE, 'font0');
      });
      const pads = I.pads();
      G.text(ctx, pads.length ? pads.map((p, i) => `JOY ${i}: ${p.id.slice(0, 28)}`).join('   ') : 'No joysticks detected (press a button on one to wake it up)', 100, 252 + I.layouts.length * 18 + 8, GREY, 'font0');
      G.text(ctx, 'Right: change   Left: off   Enter or Esc: done', 320, 418, GREY, 'font0', 1);
      if (this.errT > 0) { U.panel(ctx, 100, 200, 440, 50, 0.92); U.centerText(ctx, this.err, 216, ORANGE, 'font0'); }
    },
  });

  // ================================================================= ROOM
  // the match settings as text lines (the host's own, or the ones a member received)
  const yn = (b) => (b ? 'Yes' : 'No');
  const convName = (v) => [AB.msg(295, 'Slow'), AB.msg(296, 'Medium'), AB.msg(297, 'Fast')][v] || '';
  function settingsLines(set) {
    if (!set) return [];
    const L = [`Scheme: ${set.scheme}     Arenas: ${set.arenas}`,
               `Match: ${set.wins} ${set.byKills ? 'kills' : 'wins'} to win     Play time: ${U.fmtTime(set.time)}`];
    if (set.conveyor !== undefined) {
      L.push(`Random start: ${yn(set.randomStart)}   Conveyors: ${convName(set.conveyor)}   Stomped bombs detonate: ${yn(set.stomped)}`);
      L.push(`Hurry walls: ${AB.msg(315 + set.enclosement, String(set.enclosement))}   Diseases destroyable: ${yn(set.diseases)}   Leavers become AIs: ${yn(set.lostToAI)}`);
    }
    return L;
  }
  SC.register('room', {
    help: 'portnet',
    enter() {
      this.err = null; this.errT = 0; if (this.sel === undefined) this.sel = 2;
      NP.leaveLobby(); A.music('menu');
      if (NP.room && NP.room.host) { NP.room.inGame = false; NP.setState('waiting'); }
    },
    rows() { return [{ k: 'ais' }, { k: 'setup' }, { k: 'start' }]; },
    key(k) {
      const room = NP.room; if (!room) { SC.go('network'); return; }
      if (U.isBack(k) && k.pad === undefined) { NP.leave(); SC.go('network'); return; }
      if (!room.host) return;
      const rows = this.rows(), row = rows[this.sel];
      const humans = room.members.reduce((a, m) => a + m.players.length, 0);
      if (k.code === 'ArrowUp') { this.sel = (this.sel + rows.length - 1) % rows.length; A.play(20); }
      else if (k.code === 'ArrowDown') { this.sel = (this.sel + 1) % rows.length; A.play(21); }
      else if ((k.code === 'ArrowLeft' || k.code === 'ArrowRight') && row.k === 'ais') {
        room.ais = AB.clamp(room.ais + (k.code === 'ArrowLeft' ? -1 : 1), 0, NP.MAX_PLAYERS - humans);
        AB.settings.netAIs = room.ais; AB.saveSettings(); A.play(20); NP.refreshRoom();
      } else if (U.isOK(k)) {
        if (row.k === 'setup') { A.play(10); SC.go('netsetup'); return; }
        if (row.k === 'ais') { this.sel = 2; return; }
        if (humans + room.ais < 2) { this.err = 'Need at least two players: wait for someone to join, or add computer players.'; this.errT = 240; A.play(40); return; }
        A.play(10); NM.hostStart(1);
      }
    },
    tick() { if (this.errT > 0) this.errT--; if (!NP.room) SC.go('network'); },
    render(ctx) {
      const room = NP.room;
      U.glueDim(ctx, 5);
      U.panel(ctx, 30, 22, 580, 420, 0.82);
      if (!room) return;
      U.centerText(ctx, 'ROOM ' + room.n, 34, YELLOW);
      G.text(ctx, room.host ? 'You are the host: set up the match, then start it.' : 'Waiting for the host to start the match...', 320, 56, room.host ? CYAN : GREY, 'font0', 1);
      // computers and their players
      G.text(ctx, 'Computer', 56, 78, GREY, 'font0'); G.text(ctx, 'Players', 260, 78, GREY, 'font0'); G.text(ctx, 'Ping', 584, 78, GREY, 'font0', 2);
      let slot = 0;
      room.members.forEach((m, i) => {
        const y = 94 + i * 28, mine = m.id === room.me;
        if (mine) { ctx.fillStyle = 'rgba(96,240,96,0.10)'; ctx.fillRect(44, y - 4, 552, 26); }
        G.text(ctx, fit(m.name, 150) + (i === 0 ? '  (host)' : ''), 56, y, mine ? YELLOW : WHITE, 'font1');
        m.players.forEach((p, j) => { U.miniHead(ctx, slot, 268 + j * 22, y + 2); slot++; });
        G.text(ctx, fit(m.players.map(p => (typeof p === 'string' ? p : p.name)).join(', '), 250 - m.players.length * 22, 'font0'), 268 + m.players.length * 22 + 6, y + 2, GREY, 'font0');
        if (i === 0) G.text(ctx, 'host', 584, y + 2, GREY, 'font0', 2);
        else G.text(ctx, Math.round(m.ping || 0) + ' ms', 584, y + 2, pingCol(m.ping || 0), 'font0', 2);
      });
      // the host's menu (members see the same lines, greyed)
      const ys = 98 + Math.max(room.members.length, 2) * 28 + 6;
      const set = room.host ? NP.matchSettings() : room.info && room.info.settings;
      const rows = this.rows();
      rows.forEach((row, i) => {
        const y = ys + i * 24, sel = room.host && i === this.sel;
        if (sel) { ctx.fillStyle = 'rgba(248,216,72,0.14)'; ctx.fillRect(44, y - 3, 552, 22); U.menuCursor(ctx, 50, y + 16); }
        const col = !room.host ? GREY : sel ? YELLOW : WHITE;
        if (row.k === 'ais') {
          G.text(ctx, `Computer players: ${room.ais}`, 70, y, col, 'font1');
          for (let k = 0; k < room.ais; k++) U.miniHead(ctx, slot + k, 290 + k * 20, y + 2);
          if (sel) G.text(ctx, 'Left/Right', 590, y + 2, GREY, 'font0', 2);
        } else if (row.k === 'setup') {
          G.text(ctx, room.host ? 'Match settings  >' : 'Match settings:', 70, y, col, 'font1');
          if (sel) G.text(ctx, 'Enter: change', 590, y + 2, GREY, 'font0', 2);
        } else if (room.host) G.text(ctx, 'START THE MATCH!', 70, y, col, 'font1');
      });
      const lines = settingsLines(set);
      const ly = ys + (room.host ? 3 : 2) * 24 + 2;
      lines.forEach((t, i) => G.text(ctx, fit(t, 540, 'font0'), 70, ly + i * 15, GREY, 'font0'));
      // recent events
      const logY = ly + lines.length * 15 + 8;
      room.log.slice(-AB.clamp(Math.floor((410 - logY) / 14), 1, 4)).forEach((t, i) => G.text(ctx, t, 56, logY + i * 14, '#9aa', 'font0'));
      const hint = room.host ? 'Up/Down: choose   Enter: select   Esc: close the room' : 'Esc: leave the room';
      G.text(ctx, hint, 320, 420, GREY, 'font0', 1);
      if (this.errT > 0) { U.panel(ctx, 60, 196, 520, 50, 0.92); U.centerText(ctx, fit(this.err, 500, 'font0'), 214, ORANGE, 'font0'); }
    },
  });

  // ================================================================= MATCH SETTINGS (host)
  // the local Arena & Match screen and the gameplay options that a network match uses, in one list;
  // every change is sent to the room straight away
  const lbl = (id, d) => AB.msg(id, d).replace(/:?\s*%s\s*$/, '');
  SC.register('netsetup', {
    help: 'options',
    enter() { if (this.sel === undefined) this.sel = 0; if (!NP.isHost()) SC.go('room'); },
    items() {
      const S = AB.settings, keys = Object.keys(window.AB_DATA.schemes).sort();
      const tog = (k) => () => { S[k] = !S[k]; };
      return [
        { label: 'Arenas', value: SC.uiLate().arenaSummary(S) + '  >', action: () => SC.go('arenas', { back: 'netsetup' }) },
        { label: 'Scheme', value: window.AB_DATA.schemes[S.scheme] ? window.AB_DATA.schemes[S.scheme].name : S.scheme,
          change: (d) => { S.scheme = keys[(keys.indexOf(S.scheme) + d + keys.length) % keys.length]; } },
        { label: 'Match', value: AB.msg(211, '%u %s to win match').replace('%u', S.winsNeeded).replace('%s', S.winByKills ? AB.msg(209, 'Kills') : AB.msg(208, 'Wins')),
          change: (d) => { S.winsNeeded = AB.clamp(S.winsNeeded + d, 1, S.winByKills ? 50 : 9); } },
        { label: lbl(255, 'Win Matches By Kill Total'), value: yn(S.winByKills), change: () => { S.winByKills = !S.winByKills; S.winsNeeded = AB.clamp(S.winsNeeded, 1, S.winByKills ? 50 : 9); } },
        { label: 'Play Time', value: U.fmtTime(S.playTime), change: (d) => { const t = AB.PLAY_TIMES; S.playTime = t[(t.indexOf(S.playTime) + d + t.length) % t.length]; } },
        { label: lbl(251, 'Random Start'), value: yn(S.randomStart), change: tog('randomStart') },
        { label: lbl(253, 'Conveyor Speed'), value: convName(S.conveyorSpeed), change: (d) => { S.conveyorSpeed = (S.conveyorSpeed + d + 3) % 3; } },
        { label: lbl(254, 'Stomped Bombs Detonate'), value: yn(S.stompedDetonate), change: tog('stompedDetonate') },
        { label: lbl(257, 'Enclosement Depth'), value: AB.msg(315 + S.enclosement), change: (d) => { S.enclosement = (S.enclosement + d + 4) % 4; } },
        { label: lbl(261, 'Diseases Can Be Destroyed'), value: yn(S.diseasesDestroyable), change: tog('diseasesDestroyable') },
        { label: lbl(262, 'Lost net players revert to AIs'), value: yn(S.lostNetToAI), change: tog('lostNetToAI') },
        { label: 'Back to the room', value: '', action: () => SC.go('room') },
      ];
    },
    key(k) {
      if (!NP.isHost()) { SC.go('network'); return; }
      const items = this.items(), it = items[this.sel];
      if (k.code === 'ArrowUp') { this.sel = (this.sel + items.length - 1) % items.length; A.play(20); }
      else if (k.code === 'ArrowDown') { this.sel = (this.sel + 1) % items.length; A.play(21); }
      else if ((k.code === 'ArrowLeft' || k.code === 'ArrowRight') && it.change) { it.change(k.code === 'ArrowLeft' ? -1 : 1); A.play(20); AB.saveSettings(); NP.refreshRoom(); }
      else if (U.isBack(k)) { AB.saveSettings(); SC.go('room'); }
      else if (U.isOK(k)) {
        if (it.action) { A.play(10); it.action(); }
        else if (it.change) { it.change(1); A.play(20); AB.saveSettings(); NP.refreshRoom(); }
      }
    },
    tick() { if (!NP.room) SC.go('network'); },
    render(ctx) {
      U.glueDim(ctx, 6);
      U.panel(ctx, 30, 22, 580, 420, 0.82);
      U.centerText(ctx, 'MATCH SETTINGS  -  ROOM ' + (NP.room ? NP.room.n : ''), 34, YELLOW);
      G.text(ctx, 'Changes show up for everyone in the room straight away.', 320, 56, GREY, 'font0', 1);
      this.items().forEach((it, i) => {
        const y = 80 + i * 24, sel = i === this.sel;
        if (sel) U.menuCursor(ctx, 48, y + 16);
        G.text(ctx, it.label, 66, y, sel ? YELLOW : WHITE, 'font1');
        if (it.value) G.text(ctx, fit(it.value, 244), 352, y, sel ? YELLOW : CYAN, 'font1');
      });
      G.text(ctx, 'Team play and the Gold Bomberman roulette are off in network games.', 320, 400, GREY, 'font0', 1);
      G.text(ctx, 'Up/Down: choose   Left/Right: change   Enter: open   Esc: back to the room', 320, 420, GREY, 'font0', 1);
    },
  });
})(window.AB);
