// Network play over WebRTC (PeerJS). No server of our own is needed:
//  - PeerJS's free public server introduces the browsers to each other (signalling only),
//  - public STUN servers find a direct route through home routers,
//  - a TURN relay, if js/netconfig.js names one (e.g. Metered's free tier), carries the game when no
//    direct route exists. (PeerJS's own default TURN hosts no longer exist, so they aren't used.)
//
// Three fixed rooms. The first computer to enter a room becomes its host by claiming the room's
// well-known peer id; others connect to that id. The host relays everything (star topology, like the
// original's IPX host): room state, pings, and the lockstep input messages of js/net.js.
//
// Overrides for testing or your own servers (see NETWORK.md):
//   ?peerserver=host:port   use a self-hosted PeerServer (http)      ?ice=none   no STUN/TURN (LAN tests)
//   window.AB_NET_CONFIG = { peer: {...}, iceServers: [...], turnCredentialsUrl: '...' }   (js/netconfig.js)
'use strict';
(function (AB) {
  const NP = AB.netplay = {};
  NP.PROTO = 1;
  NP.ROOMS = 3;
  NP.MAX_PLAYERS = 10;
  NP.MAX_COMPUTERS = 5;            // like the original
  const PREFIX = 'atomic-bomberman-dd-v1-room-';
  NP.roomPeerId = (n) => PREFIX + n;
  const now = () => performance.now();

  // ---------------------------------------------------------------- PeerJS
  let libP = null;
  const script = (src) => new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = src;
    s.onload = () => res(); s.onerror = () => rej(new Error('could not load ' + src));
    document.head.appendChild(s);
  });
  // public STUN servers (free, no account): they only tell a browser its public address
  const STUN = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];
  // what the ICE servers are, for the lobby's status line: 'direct' (STUN only), 'relay', 'relay failed'
  NP.relay = 'direct';
  let ice = STUN, iceAt = 0, iceP = null;
  // a TURN credentials endpoint: your Cloudflare Worker (cloudflare/turn-worker.js), which answers
  // {iceServers: [...]}, or Metered's https://<app>.metered.live/api/v1/turn/credentials?apiKey=...
  async function fetchTurn(url) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 6000);
    try {
      const r = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const j = await r.json();
      const list = Array.isArray(j) ? j : j.iceServers;
      if (!Array.isArray(list) || !list.length) throw new Error('no servers');
      return list;
    } finally { clearTimeout(to); }
  }
  async function resolveIce() {
    const q = AB.params || new URLSearchParams(location.search), C = window.AB_NET_CONFIG || {};
    if (q.get('ice') === 'none') { ice = []; NP.relay = 'none'; return; }
    ice = C.iceServers || STUN;
    NP.relay = ice.some(s => [].concat(s.urls).some(u => /^turns?:/.test(u))) ? 'relay' : 'direct';
    if (C.turnCredentialsUrl) {
      try { ice = ice.concat(await fetchTurn(C.turnCredentialsUrl)); NP.relay = 'relay'; iceAt = now(); }
      catch (e) { console.warn('TURN credentials:', e.message); if (NP.relay !== 'relay') NP.relay = 'relay failed'; }
    }
  }
  // ?ice=relay sends everything through the relay (to check it works: two tabs then connect only through it)
  const rtcConfig = () => {
    const q = AB.params || new URLSearchParams(location.search);
    return q.get('ice') === 'relay' ? { iceServers: ice, iceTransportPolicy: 'relay' } : { iceServers: ice };
  };
  // fetched relay logins last a day: when the lobby opens with ones over an hour old (or none, after a
  // failure), get fresh ones; the lobby's connection uses them from its next connection on
  NP.refreshIce = function () {
    const C = window.AB_NET_CONFIG || {};
    if (!C.turnCredentialsUrl || (NP.relay === 'relay' && now() - iceAt < 3600e3)) return Promise.resolve();
    if (!iceP) iceP = resolveIce().finally(() => { iceP = null; if (L.peer && !L.peer.destroyed) L.peer.options.config = rtcConfig(); });
    return iceP;
  };
  // js/netconfig.js holds optional server settings (empty by default); PeerJS loads only when it's needed
  NP.loadLib = function () {
    if (window.Peer && libP) return libP;
    if (!libP) libP = script('js/netconfig.js').catch(() => {})
      .then(() => Promise.all([window.Peer ? null : script('js/vendor/peerjs.min.js'), resolveIce()]))
      .catch((e) => { libP = null; throw new Error('could not load PeerJS'); });
    return libP;
  };
  function peerOptions() {
    const o = { debug: 0 };
    const q = AB.params || new URLSearchParams(location.search);
    const C = window.AB_NET_CONFIG || {};
    if (C.peer) Object.assign(o, C.peer);
    const ps = q.get('peerserver');
    if (ps) { const [host, port] = ps.split(':'); Object.assign(o, { host, port: +(port || 9000), path: '/', secure: false }); }
    o.config = rtcConfig();
    return o;
  }
  const makePeer = (id) => (id ? new window.Peer(id, peerOptions()) : new window.Peer(peerOptions()));
  // PeerJS emits 'disconnected' from inside destroy(), before the peer counts as destroyed, so a plain
  // "reconnect when disconnected" handler would bring a destroyed room back to life as a ghost that
  // keeps holding the room's id. Peers are therefore closed with closePeer, and reconnect only when
  // the drop wasn't ours, a moment later, and only if still wanted.
  function closePeer(p) { if (!p) return; p._abClosing = true; try { p.destroy(); } catch (e) {} }
  function keepConnected(p, onLost) {
    p.on('disconnected', () => {
      if (p._abClosing || p.destroyed) return;
      if (onLost) onLost();
      setTimeout(() => { if (!p._abClosing && !p.destroyed && p.disconnected) try { p.reconnect(); } catch (e) {} }, 1000);
    });
  }

  // ---------------------------------------------------------------- lobby: watch the three rooms
  // Each room's host answers a "probe" connection with the room's state and keeps sending updates.
  const L = NP.lobby = { peer: null, status: 'off', error: '', rooms: [] };
  for (let n = 1; n <= NP.ROOMS; n++) L.rooms.push({ n, state: 'checking', info: null, conn: null, t: 0 });
  let lobbyTimer = null;
  NP.enterLobby = async function () {
    // reuse the lobby's connection only if it is still really connected to the matchmaking server
    if (L.status === 'online' && L.peer && !L.peer.destroyed && !L.peer.disconnected) { NP.refreshIce(); startProbing(); return; }
    L.status = 'connecting'; L.error = '';
    try { await NP.loadLib(); await NP.refreshIce(); } catch (e) { L.status = 'error'; L.error = e.message; return; }
    closePeer(L.peer);
    const peer = L.peer = makePeer();
    peer.on('open', () => { if (L.peer !== peer) return; L.status = 'online'; for (const r of L.rooms) { r.t = 0; } startProbing(); });
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') {
        const m = /room-(\d+)/.exec(err.message || '');
        const r = m && L.rooms[+m[1] - 1];
        if (r) { r.state = 'empty'; r.info = null; r.conn = null; }
        if (r && NP.room && !NP.room.host && NP.room.connecting && NP.room.n === r.n) NP.room.fail('That room is empty now.');
        return;
      }
      if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') {
        L.status = 'error'; L.error = 'Cannot reach the matchmaking server (' + err.type + ').';
      }
    });
    keepConnected(peer, () => { if (L.peer === peer) L.status = 'connecting'; });
  };
  function startProbing() {
    clearInterval(lobbyTimer);
    const tick = () => {
      // lost the matchmaking server for 10 s and reconnecting hasn't worked: start the lobby afresh
      if (L.peer && (L.peer.disconnected || L.peer.destroyed)) {
        L.lostAt = L.lostAt || now();
        if (now() - L.lostAt > 10000 && !NP.room) { L.lostAt = 0; L.status = 'off'; NP.enterLobby(); }
        return;
      }
      L.lostAt = 0;
      for (const r of L.rooms) if (!r.conn && now() - r.t > 4000) probe(r);
    };
    tick(); lobbyTimer = setInterval(tick, 1000);
  }
  function probe(r) {
    if (!L.peer || L.peer.destroyed || L.peer.disconnected) return;
    if (NP.room && NP.room.n === r.n && NP.room.host) return;
    r.t = now();
    if (r.state === 'error') r.state = 'checking';
    const c = L.peer.connect(NP.roomPeerId(r.n), { reliable: true, serialization: 'json', metadata: { role: 'probe' } });
    r.conn = c;
    const kill = setTimeout(() => { if (r.conn === c && !c.open) { try { c.close(); } catch (e) {} r.conn = null; if (r.state === 'checking') r.state = 'empty'; } }, 7000);
    c.on('open', () => { clearTimeout(kill); c.send({ t: 'hello', v: NP.PROTO, role: 'probe' }); });
    c.on('data', (m) => { if (m && m.t === 'room') { r.info = m.info; r.state = m.info.state; } });
    c.on('close', () => { if (r.conn === c) { r.conn = null; r.state = 'empty'; r.info = null; r.t = now() - 3000; } });
    c.on('error', () => { if (r.conn === c) { r.conn = null; } });
  }
  NP.leaveLobby = function () {
    clearInterval(lobbyTimer); lobbyTimer = null;
    for (const r of L.rooms) { if (r.conn) try { r.conn.close(); } catch (e) {} r.conn = null; }
  };
  NP.shutdown = function () { NP.leaveLobby(); NP.leave(); closePeer(L.peer); L.peer = null; L.status = 'off'; };

  // ---------------------------------------------------------------- rooms
  // member: { id, name, players: [{name, control}], ping, conn (host side), lastSeen, lastTick, ready }
  NP.room = null;
  let roomTimer = null;
  const listeners = new Set();
  NP.on = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
  const emit = (ev) => { for (const fn of [...listeners]) try { fn(ev); } catch (e) { console.error(e); } };

  // the players on this computer: chosen in the lobby (AB.settings.netLocal), or else the keyboard and
  // joystick entries of the local Player Setup
  NP.localControls = function () {
    let list = [];
    if (Array.isArray(AB.settings.netLocal)) list = AB.settings.netLocal.filter(c => c && c !== 'off');
    else AB.setup.forEach((s) => { if (s.control.startsWith('key') || s.control.startsWith('joy')) list.push(s.control); });
    if (!list.length) list.push('key0');
    return [...new Set(list)].slice(0, 4);
  };
  // the colours this computer's players would like (AB.settings.netColours), 0..9 each
  NP.localColours = function () {
    const c = Array.isArray(AB.settings.netColours) ? AB.settings.netColours : [];
    return [0, 1, 2, 3].map(i => (Number.isInteger(c[i]) && c[i] >= 0 && c[i] < 10 ? c[i] : [0, 3, 2, 4][i]));
  };
  // colours for everyone in the room: each player gets the one they asked for if nobody earlier has it,
  // otherwise the next free one; computer players take what is left (host decides, in member order)
  NP.assignColours = function (members, ais) {
    const used = new Set(), out = [];
    const take = (want) => { let c = Number.isInteger(want) ? want : 0; for (let k = 0; k < 10 && used.has(c); k++) c = (c + 1) % 10; used.add(c); return c; };
    for (const m of members) for (const p of m.players) out.push(take(p.color));
    for (let i = 0; i < ais; i++) out.push(take(0));
    return out;
  };
  function localPlayers() {
    const list = NP.localControls();
    const name = AB.settings.netName;
    const cols = NP.localColours();
    return list.slice(0, 4).map((control, i) => ({ name: list.length > 1 ? `${name} ${i + 1}` : name, control, color: cols[i] }));
  }
  NP.localPlayers = localPlayers;

  // join room n: become its host if nobody holds it, otherwise connect to its host
  NP.join = function (n) {
    if (NP.room) NP.leave();
    const r = L.rooms[n - 1];
    return (r.state === 'empty' || r.state === 'checking') ? tryHost(n).catch((e) => (e && e.type === 'unavailable-id' ? joinAsMember(n) : Promise.reject(e))) : joinAsMember(n);
  };

  function baseRoom(n, host) {
    return {
      n, host, me: host ? 'host' : null, members: [], state: 'waiting', ais: AB.settings.netAIs | 0, log: [], connecting: true,
      aiLevel: AB.AI.LEVELS.includes(AB.settings.netAILevel) ? AB.settings.netAILevel : 'hard',
      say(t) { this.log.push(t); if (this.log.length > 5) this.log.shift(); },
      fail: null,
    };
  }

  function tryHost(n) {
    return NP.loadLib().then(() => new Promise((res, rej) => {
      const room = baseRoom(n, true);
      const peer = makePeer(NP.roomPeerId(n));
      room.peer = peer;
      let opened = false;
      peer.on('open', () => {
        opened = true; room.connecting = false;
        room.members = [{ id: 'host', name: AB.settings.netName, players: localPlayers(), ping: 0, lastSeen: now(), ready: true }];
        room.say('You are hosting room ' + n + '.');
        NP.room = room;
        const lr = L.rooms[n - 1]; if (lr.conn) try { lr.conn.close(); } catch (e) {} lr.conn = null; lr.state = 'waiting';
        startHostTimers(room);
        res(room);
      });
      peer.on('error', (err) => {
        if (!opened) { closePeer(peer); rej(err); return; }
        if (err.type === 'network' || err.type === 'server-error') room.say('Matchmaking server connection lost; players already here stay connected.');
      });
      keepConnected(peer);
      peer.on('connection', (c) => hostAccept(room, c));
    }));
  }

  // the host's match settings as everyone sees them (lobby, room screen)
  NP.matchSettings = function () {
    const S = AB.settings, sc = window.AB_DATA.schemes[S.scheme];
    let arenas = 0, one = null; for (let i = 0; i < AB.LEVELS; i++) if (AB.arenaOn(S, i)) { arenas++; one = i; }
    return { scheme: AB.schemeSummary(S), arenas: arenas === 1 ? AB.levelName(one) : arenas + ' of ' + AB.LEVELS, wins: S.winsNeeded, byKills: !!S.winByKills,
             time: S.playTime, randomStart: !!S.randomStart, conveyor: S.conveyorSpeed | 0, stomped: !!S.stompedDetonate,
             enclosement: S.enclosement | 0, diseases: !!S.diseasesDestroyable, lostToAI: !!S.lostNetToAI };
  };
  NP.versionClash = (commit) => !!(commit && AB.VERSION.commit && commit !== AB.VERSION.commit);
  function roomInfo(room) {
    const cols = NP.assignColours(room.members, room.ais);
    let k = 0;
    return {
      n: room.n, state: room.state, hostName: room.members[0] && room.members[0].name, ais: room.ais, aiLevel: room.aiLevel,
      aiColours: cols.slice(cols.length - room.ais),
      ver: AB.VERSION.text, commit: AB.VERSION.commit,
      members: room.members.map(m => ({ id: m.id, name: m.name, ping: Math.round(m.ping || 0), players: m.players.map(p => ({ name: p.name, color: cols[k++] })) })),
      settings: NP.matchSettings(),
    };
  }
  const humanCount = (room) => room.members.reduce((a, m) => a + m.players.length, 0);
  function hostBroadcast(room, msg, except) {
    for (const m of room.members) if (m.conn && m.conn.open && m !== except) try { m.conn.send(msg); } catch (e) {}
  }
  function sendRoom(room) {
    const msg = { t: 'room', info: roomInfo(room) };
    hostBroadcast(room, msg);
    for (const c of room.probes || []) if (c.open) try { c.send(msg); } catch (e) {}
    emit({ t: 'room' });
  }
  NP.refreshRoom = () => { if (NP.room && NP.room.host) sendRoom(NP.room); };

  function hostAccept(room, c) {
    room.probes = room.probes || [];
    let member = null;
    c.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        if (m.role === 'probe') { room.probes.push(c); c.send({ t: 'room', info: roomInfo(room) }); return; }
        // lockstep needs the same game code everywhere: builds from different commits can't play together
        // (a dev copy, with no commit, is only held to the protocol number)
        const reason = m.v !== NP.PROTO ? 'That room runs a different version of the game.'
          : NP.versionClash(m.commit) ? `The host has ${AB.VERSION.text}, you have ${m.ver || 'another build'}: the older one should reload.`
          : room.state !== 'waiting' ? 'A game is in progress in that room.'
            : room.members.length >= NP.MAX_COMPUTERS ? 'That room is full (5 computers).'
              : humanCount(room) + (m.players || []).length > NP.MAX_PLAYERS ? 'Not enough free player slots in that room.' : null;
        if (reason) { c.send({ t: 'reject', reason }); setTimeout(() => c.close(), 500); return; }
        member = { id: 'p' + Math.random().toString(36).slice(2, 8), name: String(m.name || 'Bomberman').slice(0, 20),
                   players: (m.players || []).slice(0, 4).map(p => ({ name: String(p.name).slice(0, 20), control: String(p.control), color: AB.clamp(p.color | 0, 0, 9) })),
                   ping: 0, conn: c, lastSeen: now(), lastTick: 0, ready: false };
        room.members.push(member);
        room.ais = Math.min(room.ais, NP.MAX_PLAYERS - humanCount(room));
        c.send({ t: 'welcome', id: member.id });
        room.say(member.name + ' joined.');
        sendRoom(room); return;
      }
      if (!member) return;
      member.lastSeen = now();
      if (m.t === 'pong') { const rtt = now() - m.ts; member.ping = member.ping ? member.ping * 0.7 + rtt * 0.3 : rtt; }
      else if (m.t === 'ls') {
        const cur = AB.netmatch && AB.netmatch.cfg ? AB.netmatch.cfg.round : 0;
        if (m.m && m.m.t === 'in' && m.r === cur) { member.lastTick = Math.max(member.lastTick, m.m.tick); member.lastInput = now(); }
        hostBroadcast(room, m, member);
        emit({ t: 'ls', r: m.r, m: m.m });
      } else if (m.t === 'ready') { member.ready = m.round; emit({ t: 'ready' }); }
      else if (m.t === 'leave') { c.close(); }
    });
    c.on('close', () => {
      room.probes = (room.probes || []).filter(x => x !== c);
      if (member) hostRemove(room, member, 'left');
    });
    c.on('error', () => {});
  }
  function hostRemove(room, member, why) {
    if (!room.members.includes(member)) return;
    room.members = room.members.filter(m => m !== member);
    room.say(member.name + (why === 'timeout' ? ' lost connection.' : ' left.'));
    if (room.state === 'playing') emit({ t: 'memberLost', member });
    try { member.conn.close(); } catch (e) {}
    sendRoom(room);
  }
  function startHostTimers(room) {
    clearInterval(roomTimer);
    roomTimer = setInterval(() => {
      if (NP.room !== room) return;
      const t = now();
      for (const m of room.members.slice(1)) {
        if (m.conn && m.conn.open) try { m.conn.send({ t: 'ping', ts: t }); } catch (e) {}
        // gone quiet: no answer for 8 s, or no game input for 20 s while a round is running (between
        // rounds, on the results screen, nobody sends input, so only the pings count there)
        const live = room.inGame && AB.netmatch && AB.netmatch.roundLive();
        if (t - m.lastSeen > 8000 || (live && m.lastInput && t - m.lastInput > 20000)) hostRemove(room, m, 'timeout');
      }
      sendRoom(room);
    }, 1000);
  }

  function joinAsMember(n) {
    return NP.loadLib().then(() => new Promise((res, rej) => {
      if (!L.peer || L.peer.destroyed) { rej(new Error('Not connected to the matchmaking server.')); return; }
      const room = baseRoom(n, false);
      NP.room = room;
      let done = false;
      room.fail = (why) => { if (!done) { done = true; NP.room = null; rej(new Error(why)); } };
      const c = L.peer.connect(NP.roomPeerId(n), { reliable: true, serialization: 'json', metadata: { role: 'join' } });
      room.conn = c;
      const to = setTimeout(() => room.fail(NP.relay === 'relay' ? 'Could not reach the room host.' : 'Could not reach the room host (a strict network may need a relay).'), 15000);
      c.on('open', () => c.send({ t: 'hello', v: NP.PROTO, role: 'join', name: AB.settings.netName, players: localPlayers(), commit: AB.VERSION.commit, ver: AB.VERSION.text }));
      c.on('data', (m) => {
        if (!m || typeof m !== 'object') return;
        room.lastSeen = now();
        if (m.t === 'reject') { clearTimeout(to); room.fail(m.reason); return; }
        if (m.t === 'welcome') { clearTimeout(to); done = true; room.connecting = false; room.me = m.id; room.say('Joined room ' + n + '.'); startMemberTimer(room); res(room); return; }
        if (m.t === 'room') { room.info = m.info; room.state = m.info.state; room.members = m.info.members; room.ais = m.info.ais; room.aiLevel = m.info.aiLevel || 'hard'; emit({ t: 'room' }); return; }
        if (m.t === 'ping') { c.send({ t: 'pong', ts: m.ts }); return; }
        if (m.t === 'ls') { emit({ t: 'ls', r: m.r, m: m.m }); return; }
        emit(m);     // start / go / drop / next / end / kicked
      });
      c.on('close', () => { clearTimeout(to); if (!done) room.fail('The room closed.'); else if (NP.room === room) { NP.room = null; emit({ t: 'hostLost' }); } });
      c.on('error', () => {});
    }));
  }
  function startMemberTimer(room) {
    clearInterval(roomTimer);
    room.lastSeen = now();
    roomTimer = setInterval(() => {
      if (NP.room !== room) return;
      if (now() - room.lastSeen > 9000) { try { room.conn.close(); } catch (e) {} NP.room = null; emit({ t: 'hostLost' }); }
    }, 1000);
  }

  NP.leave = function () {
    const room = NP.room; NP.room = null;
    clearInterval(roomTimer); roomTimer = null;
    if (!room) return;
    if (room.host) {
      hostBroadcast(room, { t: 'end', reason: 'The host closed the room.' });
      // let the goodbye go out, then free the room's id (closePeer: no ghost reconnects)
      room.peer._abClosing = true;
      setTimeout(() => { for (const m of room.members) if (m.conn) try { m.conn.close(); } catch (e) {} closePeer(room.peer); }, 200);
      const lr = L.rooms[room.n - 1]; lr.state = 'checking'; lr.t = now();      // probe it again once the id is free
    } else if (room.conn) { try { room.conn.send({ t: 'leave' }); } catch (e) {} setTimeout(() => { try { room.conn.close(); } catch (e) {} }, 100); }
  };
  // closing the tab: say goodbye so the others don't sit waiting for the time-out
  window.addEventListener('pagehide', () => {
    const room = NP.room; if (!room) return;
    try {
      if (room.host) hostBroadcast(room, { t: 'end', reason: 'The host closed the room.' });
      else if (room.conn && room.conn.open) room.conn.send({ t: 'leave' });
    } catch (e) {}
  });

  // ---------------------------------------------------------------- messages during a match
  NP.isHost = () => !!(NP.room && NP.room.host);
  NP.myId = () => (NP.room ? NP.room.me : null);
  // to everyone else in the room (host: all members; member: the host, who relays)
  NP.send = function (msg) {
    const room = NP.room; if (!room) return;
    if (room.host) hostBroadcast(room, msg);
    else if (room.conn && room.conn.open) try { room.conn.send(msg); } catch (e) {}
  };
  NP.setState = (st) => { if (NP.room && NP.room.host) { NP.room.state = st; sendRoom(NP.room); } };

  // build a round: who plays in which slot, the arena, the seed and the input delay
  NP.makeRound = function (round, prevPlayers) {
    const room = NP.room, S = AB.settings;
    let players = [];
    if (prevPlayers) {
      // later rounds keep everyone in the same slot (scores are kept per slot). Nobody can join mid-match;
      // players whose computer left carry on as AIs (option #262) or sit the rest of the match out.
      for (const p of prevPlayers) {
        if (p.ai || room.members.some(m => m.id === p.owner)) players.push(Object.assign({}, p));
        else if (S.lostNetToAI) players.push(Object.assign({}, p, { ai: true, aiLevel: room.aiLevel, owner: null, control: 'ai' }));
      }
    } else {
      const cols = NP.assignColours(room.members, room.ais);
      for (const m of room.members) for (const p of m.players) {
        if (players.length >= NP.MAX_PLAYERS) break;
        players.push({ slot: players.length, color: cols[players.length], team: 0, ai: false, name: p.name, owner: m.id, control: p.control });
      }
      for (let i = 0; i < room.ais && players.length < NP.MAX_PLAYERS; i++) players.push({ slot: players.length, color: cols[players.length], team: 0, ai: true, aiLevel: room.aiLevel, name: 'Computer ' + (i + 1), owner: null, control: 'ai' });
    }
    const maxPing = Math.max(0, ...room.members.map(m => m.ping || 0));
    const delay = AB.clamp(Math.ceil((maxPing / 2 + 30) / (1000 / AB.TPS)), 3, 14);
    const sim = {};
    for (const k of ['conveyorSpeed', 'diseasesDestroyable', 'enclosement', 'playTime', 'randomStart', 'stompedDetonate',
                     'winsNeeded', 'winByKills', 'lostNetToAI', 'scheme']) sim[k] = S[k];
    sim.scheme = AB.pickScheme(S);
    sim.countdown = S.countdown !== false;      // one of the host's ticked schemes for this round
    sim.teamPlay = false; sim.goldBomberman = false;
    sim.aiFinale = true;           // only computer players left: fast walls (js/game.js updateAIFinale)
    return { round, seed: (Math.random() * 0xffffffff) >>> 0, level: AB.pickArena(S), sim, players, delay, aiLevel: room.aiLevel };
  };
})(window.AB);
