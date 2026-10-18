// Network play screens: the lobby (three fixed rooms), the room waiting area, and the match controller
// that keeps every computer's rounds in step (start -> load -> ready -> go -> rollback play -> results).
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
    '   computer brings, up to four, and the colour of each player. If two',
    '   players want the same colour, the one who joined first keeps it.',
    '',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    'The room',
    '~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~',
    ' - Ping is the round trip from the host to each computer.',
    ' - The host sets the number of computer players and their skill',
    '   (Easy, Medium or Original, the AI of the original game), opens Match',
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
    '   over the network. Each one guesses what the others press until',
    '   it arrives, then quietly corrects itself, so long distances',
    '   still play smoothly. Only if a computer stops sending do the',
    '   others wait for it ("Waiting for ...").',
    ' - F9 shows the network figures (delay, corrections, connections).',
    ' - Keep the game in the front tab. Browsers slow down background',
    '   tabs, and that holds everyone up.',
    ' - Pause and Force Draw are off. F10 twice gives up the round for',
    '   the players on your computer.',
    ' - On the results screen only the host goes on. Pressing bomb there',
    '   tells everyone you are waiting; after a few presses you can pick',
    '   a sound to send them (Up/Down, bomb; Esc closes the list).',
    ' - When only computer players are left, HURRY sounds, and 3 s later',
    '   the walls close in four times as fast, all the way.',
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
      case 'nudge': NM.gotNudge(ev); break;
      case 'hostLost': NM.notice = 'The host left, so the room has closed.'; NM.reset(); SC.go('network'); break;
    }
  });
  NM.pending = [];
  // checksums of the round being played (other rounds' are dropped: they can't be compared any more)
  NM.deliver = function (ev) {
    const s = NM.session;
    if (s && NM.cfg && ev.r === NM.cfg.round && ev.m && ev.m.t === 'sum') s.onSum(ev.m.tick, ev.m.h);
  };
  // input packets (js/net.js) carry their round's low byte. Ones for another round are dropped: whatever
  // the session hasn't confirmed is sent again in every packet anyway.
  NM.onGamePacket = function (b) {
    const s = NM.session;
    if (s && b.length > 1 && b[1] === s.round) s.onPacket(b);
  };
  NM.reset = function () { NM.nudges = {}; NM.session = null; NM.cfg = null; NM.pending = []; NM.goRound = 0; NM.myReady = 0; NM.forfeitSlots = null; if (AB.match && AB.match.net) AB.match = null; };
  // a drop may arrive before this computer has started the round it belongs to: keep it until then
  NM.applyDrop = function (d) {
    if (NM.session && NM.cfg && NM.cfg.round === d.round) NM.session.drop(d.c, d.from, d.fill);
    else NM.pending.push(d);
  };
  // host: begin a round on every computer
  NM.hostStart = function (round) {
    const prev = NM.cfg && NM.cfg.players;
    const cfg = NP.makeRound(round, prev);
    NP.setState('playing');
    NP.send({ t: 'start', cfg });
    NM.start(cfg);
  };
  NM.start = function (cfg) {
    const me = NP.myId();
    const first = cfg.round === 1 || !AB.match || !AB.match.net;
    if (cfg.round === 1) { NM.goRound = 0; NM.myReady = 0; }     // a new match: nothing carried over
    const S = Object.assign({}, AB.settings, cfg.sim);
    const M = AB.match = first ? { net: true, wins: {}, kills: {}, round: 0, players: [], demo: false } : AB.match;
    M.round = cfg.round; M.S = S; M.over = false;
    M.players = cfg.players.map(p => Object.assign({}, p, { control: p.ai ? 'ai' : p.owner === me ? p.control : 'net' }));
    NM.cfg = cfg; NM.session = null; NM.nudges = {};
    for (const m of (NP.room ? NP.room.members : [])) m.ready = false;
    SC.go('glue', { level: cfg.level, net: cfg.round, then: () => SC.go('game', { net: cfg }) });
  };
  // after loading: tell the host; the host starts everyone together once all are loaded (or after 12 s)
  NM.ready = function (round) {
    NM.readyAt = performance.now();
    if (NP.isHost()) { NM.myReady = round; NM.checkGo(); } else NP.send({ t: 'ready', round });
  };
  // (a slow connection may need a while for the arena picture and the sounds: wait up to 45 s for it)
  NM.checkGo = function () {
    const room = NP.room; if (!room || !room.host || !NM.cfg) return;
    const r = NM.cfg.round;
    if (NM.myReady !== r || Math.abs(NM.goRound) === r) return;
    const all = room.members.slice(1).every(m => m.ready === r);
    if (all || performance.now() - NM.readyAt > 45000) {
      NP.send({ t: 'go', round: r });
      // the 'go' reaches the others about half a ping later: start that much later too
      const late = Math.min(400, Math.max(0, ...room.members.slice(1).map(m => m.ping || 0)) / 2);
      NM.goRound = -r;
      setTimeout(() => { if (NM.goRound === -r) NM.goRound = r; }, late);
    }
  };
  // host, while loading: the computers that haven't finished yet
  NM.waitingFor = function () {
    const room = NP.room; if (!room || !room.host || !NM.cfg) return [];
    return room.members.slice(1).filter(m => m.ready !== NM.cfg.round).map(m => m.name);
  };
  setInterval(() => { if (NP.isHost() && NM.cfg && Math.abs(NM.goRound) !== NM.cfg.round) NM.checkGo(); }, 500);
  // host: a computer left mid-round -> from the tick after the last input of it the host has, its players
  // are computer players (or out), on every computer. The host's copy of its last inputs goes along, so
  // everyone plays the same ticks with the same inputs up to there.
  NM.memberLost = function (member) {
    const cfg = NM.cfg;
    if (!cfg) return;
    const c = cfg.computers.indexOf(member.id);
    if (c <= 0) return;
    const s = NM.session && NM.session.round === (cfg.round & 255) ? NM.session : null;
    const from = s ? s.contig[c] + 1 : 1;
    const d = { t: 'drop', round: cfg.round, c, from, fill: s ? s.fillFor(c) : null };
    NP.send(d);
    NM.applyDrop(d);
  };
  // a game screen asks for its rollback session
  NM.makeSession = function (g, devices, cfg) {
    const me = NP.myId(), comps = cfg.computers, n = comps.length;
    const slotsOf = comps.map(id => cfg.players.map((p, i) => (!p.ai && p.owner === id ? i : -1)).filter(i => i >= 0));
    const s = new AB.net.RollbackSession(g, {
      computers: n, me: Math.max(0, comps.indexOf(me)), slotsOf, inputDelay: cfg.delay, maxRollback: cfg.maxRollback, round: cfg.round,
      readLocal: (i) => { const b = I.read(devices[i]); if (NM.forfeitSlots && NM.forfeitSlots.delete(i)) return b | AB.IN.FORFEIT; return b; },
      send: (b) => NP.sendGame(b),
      sendSum: (tick, h) => NP.send({ t: 'ls', r: cfg.round, m: { t: 'sum', tick, h } }),
      // inside the game, at the drop's tick (so a rollback replays it too)
      applyDrop: (game, slots) => {
        for (const i of slots) {
          const p = game.players[i]; if (!p) continue;
          if (cfg.sim.lostNetToAI) { p.isAI = true; p.ai = { plan: null, t: 0 }; p.aiLevel = cfg.aiLevel || 'hard'; }
          else if (p.alive) game.killPlayer(p, -1, true);
          const mp = AB.match && AB.match.players[i]; if (mp) { mp.ai = true; mp.control = 'ai'; }
        }
      },
    });
    NM.session = s;
    for (const d of NM.pending.filter(d => d.round === cfg.round)) s.drop(d.c, d.from, d.fill);
    NM.pending = NM.pending.filter(d => d.round !== cfg.round);
    if (NP.room && NP.room.host) {
      NP.room.inGame = true;
      for (const m of NP.room.members) m.lastInput = performance.now();
      // players whose computer left before this round started
      const gone = new Set(cfg.players.filter(p => !p.ai && p.owner && !NP.room.members.some(m => m.id === p.owner)).map(p => p.owner));
      for (const id of gone) NM.memberLost({ id });
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
  // F10 (pressed twice) in a network round: this computer's players give up the round. It goes out as
  // part of their next input, so every computer drops them at the same tick
  NM.forfeitAll = function () { if (NM.session) NM.forfeitSlots = new Set(NM.session.localSlots); };
  // results screen: a member pressing bomb can't start the next round (only the host can). Like the
  // original, that gets the "not allowed" sound, and the host and the others hear it too and see who
  // is waiting. From the third press on, the member gets a list of sounds to send instead.
  NM.nudges = {};
  // [event id, phrase] from the sound library (data/sounds.js), with the name the list shows
  NM.NUDGE_SOUNDS = [
    ['Hurry up, tough guy', 2700, 'Yeah, hurry up there, tough guy'],
    ['Cut the macho crap', 2700, 'Would you guys cut out this macho crap and hurry'],
    ['Do not make me come out', 2700, "DON'T MAKE ME COME OUT THERE"],
    ['Time is running out', 2700, "Time's running out"],
    ['Alarm', 2700, 'ALARM1'],
    ['Beeps', 2700, 'BEEPS'],
    ['Poops (1)', 550, 'POOPS1'],
    ['Poops (2)', 550, 'POOPS3'],
    ['Here comes the poop man', 3150, 'Here comes the poop man'],
    ['Constipation', 3100, 'Constipation'],
    ['Ewwwwww', 2300, 'Ewwwwww'],
    ['Make it stop', 2300, 'Make it stop'],
    ['Mommy', 2300, 'Mommy'],
    ['Wanna buy a monkey', 700, 'Wanna buy a monkey'],
    ['Ready to rumble', 9000, "Let's get ready to rumble"],
  ];
  function playNudgeSound(i) {
    const s = NM.NUDGE_SOUNDS[i], ev = s && (window.AB_SOUNDS || { events: [] }).events.find(e => e.lo === s[1]);
    const g = ev && ev.groups.find(x => x.label === s[2]);
    const on = g ? g.clips.filter(n => A.isOn(ev, n)) : [];         // (respects the sound settings' ticks)
    if (on.length) A.playName(on[Math.floor(Math.random() * on.length)], 1, { late: true }); else A.playRange(40, 41);
  }
  // pick: one of NUDGE_SOUNDS, or none for the "not allowed" sound
  NM.nudge = function (pick) {
    const me = NP.myId(), t = performance.now(), my = NM.nudges[me];
    if (my && t - my.at < 400) return my.n;                        // (no machine-gunning)
    const n = (my ? my.n : 0) + 1;
    const ev = { id: me, n, pick: Number.isInteger(pick) ? pick : -1 };
    NM.gotNudge(ev);
    NP.send({ t: 'nudge', n, pick: ev.pick });
    return n;
  };
  NM.gotNudge = function (ev) {
    if (!ev.id) return;
    NM.nudges[ev.id] = { n: ev.n | 0, at: performance.now() };
    if (ev.pick >= 0 && ev.pick < NM.NUDGE_SOUNDS.length) playNudgeSound(ev.pick); else A.playRange(40, 41);
  };
  // the computer a match player belongs to, for the results screen's markers
  NM.nudgeOf = function (p) { const v = p && p.owner && NM.nudges[p.owner]; return v || null; };
  // F9: the network figures, for the overlay on the game screen
  NM.statsLines = function (prev) {
    const s = NM.session; if (!s) return [];
    const i = s.info(), t = performance.now();
    // per-second figures, worked out once a second
    const dt = prev && prev.t ? (t - prev.t) / 1000 : 0, fresh = !prev || dt >= 1;
    const rates = fresh ? (dt ? { rollbacks: ((i.rollbacks - prev.i.rollbacks) / dt).toFixed(1), packets: ((i.packets - prev.i.packets) / dt).toFixed(0) } : {}) : prev.rates;
    const rate = (k) => (rates[k] !== undefined ? rates[k] : '-');
    const lines = [
      `input delay ${i.delay} ticks (${Math.round(i.delay * 1000 / AB.TPS)} ms)   rollback limit ${i.maxRoll}`,
      `confirmed ${i.behind} ticks behind   time offset ${i.offset.toFixed(1)}`,
      `rollbacks ${rate('rollbacks')}/s  depth ${i.lastDepth} (max ${i.maxDepth})`,
      `stalls ${i.stalls}  waits ${i.waits}  catch-ups ${i.catchups}  packets ${rate('packets')}/s`,
    ];
    for (const l of NP.links()) {
      const r = NP.routeOf(l.conn);
      const ping = l.ping ? Math.round(l.ping) + ' ms' : r && r.rtt ? Math.round(r.rtt) + ' ms' : '';
      lines.push(`${l.name}: ${ping}  ${l.via}${r && r.route ? ' (' + r.route + ')' : ''}`);
    }
    if (NP.netsim) lines.push(`netsim: ${NP.netsim.oneway}+${NP.netsim.jitter} ms, ${Math.round(NP.netsim.loss * 100)}% loss`);
    return { lines, keep: fresh ? { t, i, rates } : prev };
  };
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
      G.text(ctx, AB.VERSION.text, 600, 28, '#778', 'font0', 2);
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
          const lc = NP.localColours();
          lp.forEach((c, j) => U.miniHead(ctx, lc[j], 210 + j * 20, y + 2));
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
          const clash = info && NP.versionClash(info.commit);
          G.text(ctx, line1, 170, y + 1, col, 'font0');
          if (clash) G.text(ctx, fit(`Host has ${info.ver}, you have ${AB.VERSION.text}: the older one should reload`, 410, 'font0'), 170, y + 20, ORANGE, 'font0');
          else if (line2) G.text(ctx, fit(line2, 410, 'font0'), 170, y + 20, GREY, 'font0');
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
      this.cols = NP.localColours().slice();
      this.sel = 0; this.err = null; this.errT = 0;
    },
    opts() { return SC.uiLate().controlOptions().filter(c => c !== 'ai'); },
    // each player has a control row, and a colour row while it's on
    rows() { const r = []; this.list.forEach((c, i) => { r.push({ k: 'ctl', i }); if (c !== 'off') r.push({ k: 'col', i }); }); return r; },
    key(k) {
      const o = this.opts(), rows = this.rows();
      this.sel = Math.min(this.sel, rows.length - 1);
      const row = rows[this.sel];
      if (k.code === 'ArrowUp') { this.sel = (this.sel + rows.length - 1) % rows.length; A.play(20); }
      else if (k.code === 'ArrowDown') { this.sel = (this.sel + 1) % rows.length; A.play(21); }
      else if (row.k === 'col' && (k.code === 'ArrowRight' || k.code === 'ArrowLeft')) { this.cols[row.i] = (this.cols[row.i] + (k.code === 'ArrowRight' ? 1 : 9)) % 10; A.play(20); }
      else if (k.code === 'ArrowRight') { this.list[row.i] = o[(o.indexOf(this.list[row.i]) + 1) % o.length]; A.play(20); }
      else if (k.code === 'ArrowLeft') { this.list[row.i] = 'off'; A.play(21); }
      else if (U.isOK(k) || U.isBack(k)) {
        const on = this.list.filter(c => c !== 'off');
        if (!on.length) { this.err = 'Pick at least one keyboard or joystick'; this.errT = 150; A.play(40); return; }
        if (new Set(on).size !== on.length) { this.err = AB.msg(45, 'More than one player selected to an input device!'); this.errT = 150; A.play(40); return; }
        // colours follow the players that are on, in order
        AB.settings.netLocal = on;
        AB.settings.netColours = this.list.map((c, i) => (c !== 'off' ? this.cols[i] : -1)).filter(c => c >= 0);
        AB.saveSettings(); A.play(10); SC.go('network');
      }
    },
    tick() { if (this.errT > 0) this.errT--; },
    render(ctx) {
      U.glueDim(ctx, 1);
      U.panel(ctx, 30, 22, 580, 420, 0.82);
      U.centerText(ctx, 'PLAYERS ON THIS COMPUTER', 34, YELLOW);
      G.text(ctx, 'Each computer brings up to four players. Computer players are added by the host in the room.', 320, 58, GREY, 'font0', 1);
      const label = SC.uiLate().controlLabel, name = AB.settings.netName;
      const on = this.list.filter(c => c !== 'off').length, rows = this.rows();
      let n = 0, y = 84;
      rows.forEach((row, ri) => {
        const sel = ri === this.sel, c = this.list[row.i];
        if (sel) U.menuCursor(ctx, 60, y + 17);
        if (row.k === 'ctl') {
          G.text(ctx, `Player ${row.i + 1}: ${label(c)}`, 104, y, c === 'off' ? GREY : sel ? YELLOW : WHITE, 'font1');
          if (c !== 'off') { n++; G.text(ctx, on > 1 ? `${name} ${n}` : name, 340, y + 2, CYAN, 'font0'); }
          y += 22;
        } else {
          U.miniHead(ctx, this.cols[row.i], 124, y);
          G.text(ctx, 'Colour: ' + AB.COLOUR_NAMES[this.cols[row.i]], 144, y, sel ? YELLOW : WHITE, 'font1');
          y += 26;
        }
      });
      // what the keys are, as on the Player Setup screen
      const ky = 290;
      G.text(ctx, 'Keyboard layouts (Options > Define keyboard layouts):', 84, ky, YELLOW, 'font0');
      const kl = (c) => I.keyLabel(c).replace('Num ', 'N').replace('Enter', 'Ent').replace('Space', 'Spc');
      I.layouts.forEach((Ly, i) => {
        const dirs = Ly.up === 'ArrowUp' && Ly.down === 'ArrowDown' && Ly.left === 'ArrowLeft' ? 'Arrows' : `${kl(Ly.up)}${kl(Ly.left)}${kl(Ly.down)}${kl(Ly.right)}`;
        G.text(ctx, `KEY ${i}:  ${dirs}   bomb ${kl(Ly.bomb)}   action ${kl(Ly.action)}`, 100, ky + 18 + i * 16, WHITE, 'font0');
      });
      const pads = I.pads();
      G.text(ctx, pads.length ? pads.map((p, i) => `JOY ${i}: ${p.id.slice(0, 28)}`).join('   ') : 'No joysticks detected (press a button on one to wake it up)', 100, ky + 18 + I.layouts.length * 16 + 6, GREY, 'font0');
      G.text(ctx, 'Right: change   Left: off (or the other way on a colour)   Enter or Esc: done', 320, 418, GREY, 'font0', 1);
      G.text(ctx, 'If two players want the same colour, the one who joined first keeps it.', 320, 400, GREY, 'font0', 1);
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
      this.err = null; this.errT = 0; if (this.sel === undefined) this.sel = 3;
      NP.leaveLobby(); A.music('menu');
      if (NP.room && NP.room.host) { NP.room.inGame = false; NP.setState('waiting'); }
    },
    rows() { return [{ k: 'ais' }, { k: 'skill' }, { k: 'setup' }, { k: 'start' }]; },
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
      } else if ((k.code === 'ArrowLeft' || k.code === 'ArrowRight' || U.isOK(k)) && row.k === 'skill') {
        const L = AB.AI.LEVELS, d = k.code === 'ArrowLeft' ? -1 : 1;
        room.aiLevel = L[(L.indexOf(room.aiLevel) + d + L.length) % L.length];
        AB.settings.netAILevel = room.aiLevel; AB.saveSettings(); A.play(20); NP.refreshRoom();
      } else if (U.isOK(k)) {
        if (row.k === 'setup') { A.play(10); SC.go('netsetup'); return; }
        if (row.k === 'ais') { this.sel = 3; return; }
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
      // everyone's colour as the host has sorted them out (first come, first served)
      const cols = room.host ? NP.assignColours(room.members, room.ais) : null;
      const aiCols = room.host ? cols.slice(cols.length - room.ais) : (room.info && room.info.aiColours) || [];
      let slot = 0;
      room.members.forEach((m, i) => {
        const y = 94 + i * 28, mine = m.id === room.me;
        if (mine) { ctx.fillStyle = 'rgba(96,240,96,0.10)'; ctx.fillRect(44, y - 4, 552, 26); }
        G.text(ctx, fit(m.name, 150) + (i === 0 ? '  (host)' : ''), 56, y, mine ? YELLOW : WHITE, 'font1');
        m.players.forEach((p, j) => { U.miniHead(ctx, cols ? cols[slot] : (p.color | 0), 268 + j * 22, y + 2); slot++; });
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
          for (let k = 0; k < room.ais; k++) U.miniHead(ctx, aiCols[k] !== undefined ? aiCols[k] : slot + k, 290 + k * 20, y + 2);
          if (sel) G.text(ctx, 'Left/Right', 590, y + 2, GREY, 'font0', 2);
        } else if (row.k === 'skill') {
          G.text(ctx, `Computer skill: ${AB.AI.LEVEL_NAMES[room.aiLevel || 'hard']}`, 70, y, col, 'font1');
          if (sel) G.text(ctx, 'Left/Right', 590, y + 2, GREY, 'font0', 2);
        } else if (row.k === 'setup') {
          G.text(ctx, room.host ? 'Match settings  >' : 'Match settings:', 70, y, col, 'font1');
          if (sel) G.text(ctx, 'Enter: change', 590, y + 2, GREY, 'font0', 2);
        } else if (room.host) G.text(ctx, 'START THE MATCH!', 70, y, col, 'font1');
      });
      const lines = settingsLines(set);
      const ly = ys + (room.host ? 4 : 3) * 24 + 2;
      lines.forEach((t, i) => G.text(ctx, fit(t, 540, 'font0'), 70, ly + i * 15, GREY, 'font0'));
      // recent events
      const logY = ly + lines.length * 15 + 8;
      room.log.slice(-AB.clamp(Math.floor((412 - logY) / 14), 0, 4) || room.log.length).forEach((t, i) => G.text(ctx, t, 56, logY + i * 14, '#9aa', 'font0'));
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
        { label: 'Schemes', value: AB.schemeSummary(S) + '  >', action: () => { const r = NP.room; SC.go('schemes', { back: 'netsetup', players: r ? r.members.reduce((a, m) => a + m.players.length, 0) + r.ais : 2, team: false }); } },
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
