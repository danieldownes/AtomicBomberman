// Network play over WebRTC (PeerJS). No server of our own is needed:
//  - PeerJS's free public server introduces the browsers to each other (signalling only),
//  - public STUN servers find a direct route through home routers,
//  - a TURN relay, if js/netconfig.js names one (e.g. Metered's free tier), carries the game when no
//    direct route exists. (PeerJS's own default TURN hosts no longer exist, so they aren't used.)
//
// Three fixed rooms. The first computer to enter a room becomes its host by claiming the room's
// well-known peer id; others connect to that id. Two connections per pair of computers:
//  - a reliable one (JSON): room state, pings, round start/ready/go, drops, checksums; the host relays it,
//  - a game channel (binary, unordered, never resent: a late input is worthless, and every packet
//    repeats what the others haven't confirmed yet) carrying the inputs of js/net.js. Members also open
//    game channels to each other (mesh), so their inputs don't take the detour through the host; until
//    one is open, or if it can't be, the host passes the packets on.
//
// ?netsim=oneway,jitter,loss  (ms, ms, 0..1) delays incoming messages, to try bad connections locally.
//
// Overrides for testing or your own servers (see NETWORK.md):
//   ?peerserver=host:port   use a self-hosted PeerServer (http)      ?ice=none   no STUN/TURN (LAN tests)
//   window.AB_NET_CONFIG = { peer: {...}, iceServers: [...], turnCredentialsUrl: '...' }   (js/netconfig.js)
'use strict';
(function (AB) {
  const NP = AB.netplay = {};
  NP.PROTO = 2;
  NP.ROOMS = 3;
  NP.MAX_PLAYERS = 10;
  NP.MAX_COMPUTERS = 5;            // like the original
  const PREFIX = 'atomic-bomberman-dd-v1-room-';
  // this browser's own id (kept in the settings): a computer that drops out of a match can rejoin it
  NP.clientId = function () {
    if (!AB.settings.netCid) { AB.settings.netCid = Math.random().toString(36).slice(2, 12); AB.saveSettings(); }
    return AB.settings.netCid;
  };
  // what a room's info shows of the computers that may rejoin (not the ids themselves)
  NP.cidTag = (cid) => { let h = 7; for (const ch of String(cid)) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0; return h.toString(36); };
  NP.roomPeerId = (n) => PREFIX + n;
  const now = () => performance.now();
  // on entering a room with voice chat: the keys for it (the game's volume leaves the voices alone)
  const voiceTip = (room) => { if (AB.voice.active()) room.say('Voice chat on: V mutes your mic, + / - change the game volume (not the voices).'); };

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
      .then(() => Promise.all([window.Peer ? null : script('js/vendor/peerjs.min.js'), resolveIce()])).then(patchChannels)
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
  // PeerJS's "unreliable" channel is only unordered: lost packets are still resent, which is pointless
  // for the game channel. Make unordered data channels never resend.
  let dcPatched = false;
  function patchChannels() {
    if (dcPatched || !window.RTCPeerConnection) return;
    dcPatched = true;
    const P = RTCPeerConnection.prototype, orig = P.createDataChannel;
    P.createDataChannel = function (label, opts) {
      if (opts && opts.ordered === false && opts.maxRetransmits === undefined && opts.maxPacketLifeTime === undefined) opts = Object.assign({}, opts, { maxRetransmits: 0 });
      return orig.call(this, label, opts);
    };
  }
  // ?netsim: a worse connection, for testing. Applied when messages arrive; reliable ones keep their order.
  const SIM = (() => {
    const v = (AB.params || new URLSearchParams(location.search)).get('netsim');
    if (!v) return null;
    const [oneway, jitter, loss] = v.split(',').map(Number);
    return { oneway: oneway || 0, jitter: jitter || 0, loss: loss || 0 };
  })();
  NP.netsim = SIM;
  function recv(handler, lossy) {
    if (!SIM) return handler;
    let last = 0;
    return (data) => {
      if (lossy && Math.random() < SIM.loss) return;
      let at = now() + SIM.oneway + Math.random() * SIM.jitter;
      if (!lossy) { at = Math.max(at, last); last = at; }
      setTimeout(() => handler(data), Math.max(0, at - now()));
    };
  }
  const GAME_OPTS = (meta) => ({ reliable: false, serialization: 'raw', metadata: Object.assign({ role: 'game' }, meta) });
  const toBytes = (d) => (d instanceof ArrayBuffer ? new Uint8Array(d) : ArrayBuffer.isView(d) ? new Uint8Array(d.buffer, d.byteOffset, d.byteLength) : Array.isArray(d) ? Uint8Array.from(d) : null);
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
    peer.on('connection', (c) => meshAccept(c));
    peer.on('call', (c) => voiceAccept(c));
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
  // otherwise the next free one; computer players take what is left, in the room's random order
  // (aiOrder: black always comes last, so a computer player is only black when nothing else is free).
  // The host decides, in member order.
  const BLACK = 1;
  NP.shuffledAIOrder = function () {
    const a = [0, 2, 3, 4, 5, 6, 7, 8, 9];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a.concat(BLACK);
  };
  NP.assignColours = function (members, ais, order) {
    order = order || (NP.room && NP.room.aiOrder) || [0, 2, 3, 4, 5, 6, 7, 8, 9, BLACK];
    const used = new Set(), out = [];
    const take = (want) => { let c = Number.isInteger(want) ? want : 0; for (let k = 0; k < 10 && used.has(c); k++) c = (c + 1) % 10; used.add(c); return c; };
    for (const m of members) for (const p of m.players) out.push(take(p.color));
    for (let i = 0; i < ais; i++) { const c = order.find(x => !used.has(x)); const col = c !== undefined ? c : take(0); used.add(col); out.push(col); }
    return out;
  };
  // each player's name: their own (AB.settings.netNames, set on the Players here screen), or else
  // the computer's name, numbered when it brings more than one player
  NP.defaultPlayerName = (i, count, base = AB.settings.netName) => (count > 1 ? `${base} ${i + 1}` : base);
  NP.localNames = function (count) {
    const own = Array.isArray(AB.settings.netNames) ? AB.settings.netNames : [];
    return Array.from({ length: count }, (_, i) => (typeof own[i] === 'string' && own[i].trim() ? own[i].trim().slice(0, 16) : NP.defaultPlayerName(i, count)));
  };
  function localPlayers() {
    const list = NP.localControls().slice(0, 4);
    const cols = NP.localColours(), names = NP.localNames(list.length);
    return list.map((control, i) => ({ name: names[i], control, color: cols[i] }));
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
      n, host, me: host ? 'host' : null, members: [], state: 'waiting', ais: AB.settings.netAIs | 0, log: [], connecting: true, aiOrder: NP.shuffledAIOrder(),
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
        AB.voice.start(); voiceTip(room);
        res(room);
      });
      peer.on('error', (err) => {
        if (!opened) { closePeer(peer); rej(err); return; }
        if (err.type === 'network' || err.type === 'server-error') room.say('Matchmaking server connection lost; players already here stay connected.');
      });
      keepConnected(peer);
      peer.on('connection', (c) => hostAccept(room, c));
      peer.on('call', (c) => voiceAccept(c));
    }));
  }

  // the host's match settings as everyone sees them (lobby, room screen)
  NP.matchSettings = function () {
    const S = AB.settings, sc = window.AB_DATA.schemes[S.scheme];
    let arenas = 0, one = null; for (let i = 0; i < AB.LEVELS; i++) if (AB.arenaOn(S, i)) { arenas++; one = i; }
    return { scheme: AB.schemeSummary(S), arenas: arenas === 1 ? AB.levelName(one) : arenas + ' of ' + AB.LEVELS, wins: S.winsNeeded, byKills: !!S.winByKills,
             time: S.playTime, randomStart: !!S.randomStart, conveyor: S.conveyorSpeed | 0, stomped: !!S.stompedDetonate,
             enclosement: S.enclosement | 0, diseases: !!S.diseasesDestroyable, lostToAI: !!S.lostNetToAI, sound: NP.soundProfile() };
  };
  // the sounds a network match uses on every computer: the host's choice in Match settings
  NP.soundProfile = function () {
    const S = AB.settings, A = AB.audio;
    return { preset: A.PRESETS.includes(S.netVoices) ? S.netVoices : A.PRESETS.includes(S.voices) ? S.voices : 'extended',
             variety: A.VARIETY.includes(S.netVariety) ? S.netVariety : A.VARIETY.includes(S.soundVariety) ? S.soundVariety : 'normal' };
  };
  NP.versionClash = (commit) => !!(commit && AB.VERSION.commit && commit !== AB.VERSION.commit);
  function roomInfo(room) {
    const cols = NP.assignColours(room.members, room.ais);
    let k = 0;
    return {
      n: room.n, state: room.state, hostName: room.members[0] && room.members[0].name, ais: room.ais, aiLevel: room.aiLevel,
      rejoin: [...(room.departed || new Map()).keys()].map(NP.cidTag),
      aiColours: cols.slice(cols.length - room.ais),
      ver: AB.VERSION.text, commit: AB.VERSION.commit,
      members: room.members.map(m => ({ id: m.id, name: m.name, peer: m.peer, ping: Math.round(m.ping || 0),
        voice: m.id === 'host' ? AB.voice.active() : !!m.voice, mic: m.id === 'host' ? AB.voice.mic : m.mic || '', muted: m.id === 'host' ? AB.voice.muted : !!m.muted, players: m.players.map(p => ({ name: p.name, color: cols[k++] })) })),
      settings: NP.matchSettings(),
    };
  }
  const humanCount = (room) => room.members.reduce((a, m) => a + m.players.length, 0);
  function hostBroadcast(room, msg, except) {
    for (const m of room.members) if (m.conn && m.conn.open && m !== except) try { m.conn.send(msg); } catch (e) {}
  }
  function sendRoom(room) {
    const me = room.members[0];
    if (me && me.id === 'host') { me.voice = AB.voice.active(); me.mic = AB.voice.mic; me.muted = AB.voice.muted; }
    syncVoice();
    const msg = { t: 'room', info: roomInfo(room) };
    hostBroadcast(room, msg);
    for (const c of room.probes || []) if (c.open) try { c.send(msg); } catch (e) {}
    emit({ t: 'room' });
  }
  NP.refreshRoom = () => { if (NP.room && NP.room.host) sendRoom(NP.room); };

  function hostAccept(room, c) {
    room.probes = room.probes || [];
    if (c.metadata && c.metadata.role === 'game') { hostGameChannel(room, c); return; }
    let member = null;
    c.on('data', recv((m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        if (m.role === 'probe') { room.probes.push(c); c.send({ t: 'room', info: roomInfo(room) }); return; }
        // rollback needs the same game code everywhere: builds from different commits can't play together
        // (a dev copy, with no commit, is only held to the protocol number)
        // a computer that dropped out of this match may come back (from the next round)
        const back = room.state !== 'waiting' && m.cid && room.departed && room.departed.get(String(m.cid));
        const reason = m.v !== NP.PROTO ? 'That room runs a different version of the game.'
          : NP.versionClash(m.commit) ? `The host has ${AB.VERSION.text}, you have ${m.ver || 'another build'}: the older one should reload.`
          : room.state !== 'waiting' && !back ? 'A game is in progress in that room.'
            : room.members.length >= NP.MAX_COMPUTERS ? 'That room is full (5 computers).'
              : humanCount(room) + (m.players || []).length > NP.MAX_PLAYERS ? 'Not enough free player slots in that room.' : null;
        if (reason) { c.send({ t: 'reject', reason }); setTimeout(() => c.close(), 500); return; }
        member = { id: back ? back.id : 'p' + Math.random().toString(36).slice(2, 8), name: String(m.name || 'Bomberman').slice(0, 20), cid: m.cid ? String(m.cid) : null,
                   players: (m.players || []).slice(0, 4).map(p => ({ name: String(p.name).slice(0, 20), control: String(p.control), color: AB.clamp(p.color | 0, 0, 9) })),
                   ping: 0, conn: c, lastSeen: now(), ready: false, peer: typeof m.peer === 'string' ? m.peer : null, game: null, direct: new Set() };
        room.members.push(member);
        if (back) {
          // same id as before, so it gets its old players (and their scores) back at the next round
          room.departed.delete(member.cid);
          c.send({ t: 'welcome', id: member.id, rejoin: true });
          room.say(member.name + ' is back (from the next round).');
          emit({ t: 'rejoined', member });
          sendRoom(room); return;
        }
        room.ais = Math.min(room.ais, NP.MAX_PLAYERS - humanCount(room));
        c.send({ t: 'welcome', id: member.id });
        room.say(member.name + ' joined.');
        sendRoom(room); return;
      }
      if (!member) return;
      member.lastSeen = now();
      if (m.t === 'pong') { const rtt = now() - m.ts; member.ping = member.ping ? member.ping * 0.7 + rtt * 0.3 : rtt; }
      else if (m.t === 'ls') { hostBroadcast(room, m, member); emit({ t: 'ls', r: m.r, m: m.m }); }
      else if (m.t === 'g') { const b = toBytes(m.d); if (b) hostGamePacket(room, member, b); }      // (no game channel yet)
      else if (m.t === 'mesh') { member.direct = new Set(Array.isArray(m.ids) ? m.ids : []); }
      else if (m.t === 'players' && Array.isArray(m.players)) {
        // new names / colours for the same players (how many, and their controls, stay as they joined)
        member.name = String(m.name || member.name).slice(0, 20);
        member.players = member.players.map((p, i) => { const q = m.players[i]; return q ? Object.assign({}, p, { name: String(q.name || p.name).slice(0, 20), color: AB.clamp(q.color | 0, 0, 9) }) : p; });
        room.say(member.name + ' changed names or colours.');
        sendRoom(room);
      }
      else if (m.t === 'vstate') { member.voice = !!m.on; member.mic = String(m.mic || ''); member.muted = !!m.muted; sendRoom(room); }
      else if (m.t === 'talk') { AB.voice.setTalking(member.id, !!m.on); hostBroadcast(room, { t: 'talk', id: member.id, on: !!m.on }, member); }
      else if (m.t === 'ready') { member.ready = m.round; emit({ t: 'ready' }); }
      else if (m.t === 'nudge') { const n = { t: 'nudge', id: member.id, n: m.n | 0, pick: m.pick | 0 }; hostBroadcast(room, n, member); emit(n); }
      else if (m.t === 'leave') { c.close(); }
    }));
    c.on('close', () => {
      room.probes = (room.probes || []).filter(x => x !== c);
      if (member) hostRemove(room, member, 'left');
    });
    c.on('error', () => {});
  }
  // a member's game channel to the host
  function hostGameChannel(room, c) {
    const id = c.metadata.id;
    c.on('open', () => {
      const member = room.members.find(m => m.id === id);
      if (!member || NP.room !== room) { try { c.close(); } catch (e) {} return; }
      if (member.game && member.game !== c) try { member.game.close(); } catch (e) {}
      member.game = c;
    });
    c.on('data', recv((d) => {
      const member = room.members.find(m => m.id === id), b = toBytes(d);
      if (member && b) hostGamePacket(room, member, b);
    }, true));
    c.on('close', () => { const member = room.members.find(m => m.id === id); if (member && member.game === c) member.game = null; });
    c.on('error', () => {});
  }
  // host: a member's input packet. Use it, and pass it on to the members it has no direct link with.
  function hostGamePacket(room, member, b) {
    member.lastInput = now(); member.lastSeen = now();
    if (AB.netmatch) AB.netmatch.onGamePacket(b);
    let fwd = null;
    for (const m of room.members) {
      if (m === member || m.id === 'host' || member.direct.has(m.id) || m.direct.has(member.id)) continue;
      if (!fwd) { fwd = b.slice(); fwd[0] = 2; }
      sendGameTo(m, fwd);
    }
  }
  // host -> member: over the game channel, or the reliable connection while it isn't open
  function sendGameTo(m, b) {
    try {
      if (m.game && m.game.open) m.game.send(b);
      else if (m.conn && m.conn.open) m.conn.send({ t: 'g', d: Array.from(b) });
    } catch (e) {}
  }
  function hostRemove(room, member, why) {
    if (!room.members.includes(member)) return;
    room.members = room.members.filter(m => m !== member);
    room.say(member.name + (why === 'timeout' ? ' lost connection.' : ' left.'));
    if (room.state === 'playing') {
      if (member.cid) { room.departed = room.departed || new Map(); room.departed.set(member.cid, { id: member.id, name: member.name }); }
      emit({ t: 'memberLost', member, why });
    }
    try { member.conn.close(); } catch (e) {}
    if (member.game) try { member.game.close(); } catch (e) {}
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
      c.on('open', () => c.send({ t: 'hello', v: NP.PROTO, role: 'join', name: AB.settings.netName, players: localPlayers(), commit: AB.VERSION.commit, ver: AB.VERSION.text, peer: L.peer.id, cid: NP.clientId() }));
      c.on('data', recv((m) => {
        if (!m || typeof m !== 'object') return;
        room.lastSeen = now();
        if (m.t === 'reject') { clearTimeout(to); room.fail(m.reason); return; }
        if (m.t === 'welcome') { clearTimeout(to); done = true; room.connecting = false; room.me = m.id; room.rejoin = !!m.rejoin; room.say(m.rejoin ? 'Back in room ' + n + ': you play again from the next round.' : 'Joined room ' + n + '.'); startMemberTimer(room); openHostGame(room); AB.voice.start(); voiceTip(room); res(room); return; }
        if (m.t === 'room') { room.info = m.info; room.state = m.info.state; room.members = m.info.members; room.ais = m.info.ais; room.aiLevel = m.info.aiLevel || 'hard'; emit({ t: 'room' }); updateMesh(room); syncVoice(); return; }
        if (m.t === 'ping') { c.send({ t: 'pong', ts: m.ts }); return; }
        if (m.t === 'talk') { AB.voice.setTalking(m.id, !!m.on); return; }
        if (m.t === 'g') { const b = toBytes(m.d); if (b && AB.netmatch) AB.netmatch.onGamePacket(b); return; }
        if (m.t === 'ls') { emit({ t: 'ls', r: m.r, m: m.m }); return; }
        emit(m);     // start / go / drop / next / end / kicked
      }));
      c.on('close', () => { clearTimeout(to); closeGameLinks(room); if (NP.room === room || !done) AB.voice.stop(); if (!done) room.fail('The room closed.'); else if (NP.room === room) { NP.room = null; emit({ t: 'hostLost' }); } });
      c.on('error', () => {});
    }));
  }
  // member: the game channel to the host (reopened if it closes)
  function openHostGame(room) {
    if (NP.room !== room || !L.peer || L.peer.destroyed) return;
    const c = L.peer.connect(NP.roomPeerId(room.n), GAME_OPTS({ id: room.me }));
    room.game = c;
    c.on('data', recv((d) => { const b = toBytes(d); if (b && AB.netmatch) AB.netmatch.onGamePacket(b); }, true));
    const retry = () => { if (room.game === c) room.game = null; if (NP.room === room && !room.closing) setTimeout(() => { if (NP.room === room && !room.game) openHostGame(room); }, 3000); };
    c.on('close', retry); c.on('error', () => {});
    setTimeout(() => { if (room.game === c && !c.open) { try { c.close(); } catch (e) {} retry(); } }, 15000);
  }
  // member: direct game channels to the other members. Of each pair, the one that joined first calls.
  function updateMesh(room) {
    room.links = room.links || new Map();
    const list = room.members || [], i = list.findIndex(m => m.id === room.me);
    if (i < 0) return;
    for (const [id, l] of room.links) if (!list.some(m => m.id === id)) { try { l.c.close(); } catch (e) {} room.links.delete(id); }
    list.forEach((m, j) => {
      if (j <= i || m.id === 'host' || !m.peer || room.links.has(m.id) || !L.peer || L.peer.destroyed) return;
      const last = (room.meshTried = room.meshTried || {})[m.id] || 0;
      if (now() - last < 10000) return;
      room.meshTried[m.id] = now();
      addLink(room, m.id, L.peer.connect(m.peer, GAME_OPTS({ id: room.me, room: room.n })));
    });
  }
  function addLink(room, id, c) {
    room.links = room.links || new Map();
    const old = room.links.get(id);
    if (old && old.c !== c) try { old.c.close(); } catch (e) {}
    const l = { c, id };
    room.links.set(id, l);
    c.on('open', () => reportMesh(room));
    c.on('data', recv((d) => { const b = toBytes(d); if (b && AB.netmatch) AB.netmatch.onGamePacket(b); }, true));
    c.on('close', () => { if (room.links.get(id) === l) { room.links.delete(id); reportMesh(room); } });
    c.on('error', () => {});
    setTimeout(() => { if (room.links.get(id) === l && !c.open) { try { c.close(); } catch (e) {} } }, 15000);
  }
  // incoming direct game channel from another member of my room
  function meshAccept(c) {
    const md = c.metadata || {}, room = NP.room;
    if (md.role !== 'game' || !room || room.host || md.room !== room.n || !(room.members || []).some(m => m.id === md.id)) { setTimeout(() => { try { c.close(); } catch (e) {} }, 100); return; }
    addLink(room, md.id, c);
  }
  function reportMesh(room) {
    if (NP.room !== room || !room.conn || !room.conn.open) return;
    const ids = [...(room.links || new Map()).values()].filter(l => l.c.open).map(l => l.id);
    try { room.conn.send({ t: 'mesh', ids }); } catch (e) {}
  }
  function closeGameLinks(room) {
    room.closing = true;
    if (room.game) try { room.game.close(); } catch (e) {}
    for (const l of (room.links || new Map()).values()) try { l.c.close(); } catch (e) {}
    if (room.links) room.links.clear();
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
    AB.voice.stop();
    clearInterval(roomTimer); roomTimer = null;
    if (!room) return;
    if (room.host) {
      hostBroadcast(room, { t: 'end', reason: 'The host closed the room.' });
      // let the goodbye go out, then free the room's id (closePeer: no ghost reconnects)
      room.peer._abClosing = true;
      setTimeout(() => { for (const m of room.members) if (m.conn) try { m.conn.close(); } catch (e) {} closePeer(room.peer); }, 200);
      const lr = L.rooms[room.n - 1]; lr.state = 'checking'; lr.t = now();      // probe it again once the id is free
    } else if (room.conn) { try { room.conn.send({ t: 'leave' }); } catch (e) {} closeGameLinks(room); setTimeout(() => { try { room.conn.close(); } catch (e) {} }, 100); }
  };
  // closing the tab: say goodbye so the others don't sit waiting for the time-out
  window.addEventListener('pagehide', () => {
    const room = NP.room; if (!room) return;
    try {
      if (room.host) hostBroadcast(room, { t: 'end', reason: 'The host closed the room.' });
      else if (room.conn && room.conn.open) room.conn.send({ t: 'leave' });
    } catch (e) {}
  });

  // ---------------------------------------------------------------- voice chat (js/voice.js)
  // One audio call per pair of computers in the room that have voice chat on: members call the host, and
  // of two members the one that joined first calls the other (like the game's own direct links).
  function syncVoice() {
    const room = NP.room, V = AB.voice;
    if (!room || !room.me || room.connecting) return;
    const me = room.host ? 'host' : room.me, list = room.members || [];
    for (const id of V.remoteIds()) { const m = list.find(x => x.id === id); if (!V.active() || !m || !m.voice) V.dropRemote(id); }
    if (!V.active() || room.host) return;
    const myIdx = list.findIndex(m => m.id === me);
    room.voiceTried = room.voiceTried || {};
    list.forEach((m, j) => {
      if (m.id === me || !m.voice || V.hasRemote(m.id)) return;
      if (m.id !== 'host' && !(myIdx >= 0 && j > myIdx)) return;     // they call me
      if (now() - (room.voiceTried[m.id] || 0) < 8000) return;
      const pid = m.id === 'host' ? NP.roomPeerId(room.n) : m.peer;
      if (!pid || !L.peer || L.peer.destroyed || L.peer.disconnected) return;
      room.voiceTried[m.id] = now();
      const call = L.peer.call(pid, V.outStream(), { metadata: { role: 'voice', room: room.n, id: me } });
      if (call) V.addRemote(m.id, call);
    });
  }
  NP.syncVoice = syncVoice;
  // an incoming voice call from a computer in my room
  function voiceAccept(c) {
    const md = c.metadata || {}, room = NP.room, V = AB.voice;
    const ok = md.role === 'voice' && room && md.room === room.n && V.active() && (room.members || []).some(m => m.id === md.id && m.id !== (room.host ? 'host' : room.me));
    if (!ok) { setTimeout(() => { try { c.close(); } catch (e) {} }, 100); return; }
    c.answer(V.outStream());
    V.addRemote(md.id, c);
  }
  // tell the room: voice on/off and the microphone's state (to show icons), and when this computer speaks
  AB.voice.onState = function () {
    const room = NP.room; if (!room) return;
    if (room.host) sendRoom(room);
    else if (room.conn && room.conn.open) { try { room.conn.send({ t: 'vstate', on: AB.voice.active(), mic: AB.voice.mic, muted: AB.voice.muted }); } catch (e) {} syncVoice(); }
  };
  AB.voice.onTalk = function (on) {
    const room = NP.room; if (!room) return;
    if (room.host) hostBroadcast(room, { t: 'talk', id: 'host', on });
    else if (room.conn && room.conn.open) try { room.conn.send({ t: 'talk', on }); } catch (e) {}
  };
  AB.voice.nameOf = (id) => { const m = NP.room && (NP.room.members || []).find(x => x.id === id); return m ? m.name : id; };

  // ---------------------------------------------------------------- messages during a match
  NP.isHost = () => !!(NP.room && NP.room.host);
  NP.myId = () => (NP.room ? NP.room.me : null);
  // to everyone else in the room (host: all members; member: the host, who relays)
  NP.send = function (msg) {
    const room = NP.room; if (!room) return;
    if (room.host) hostBroadcast(room, msg);
    else if (room.conn && room.conn.open) try { room.conn.send(msg); } catch (e) {}
  };
  // an input packet (js/net.js) to every other computer: direct where there is a link, else via the host
  NP.sendGame = function (b) {
    const room = NP.room; if (!room) return;
    if (room.host) { for (const m of room.members) if (m.id !== 'host') sendGameTo(m, b); return; }
    try {
      if (room.game && room.game.open) room.game.send(b);
      else if (room.conn && room.conn.open) room.conn.send({ t: 'g', d: Array.from(b) });
    } catch (e) {}
    for (const l of (room.links || new Map()).values()) if (l.c.open) try { l.c.send(b); } catch (e) {}
  };
  // for the F9 overlay: how this computer reaches each of the others
  NP.links = function () {
    const room = NP.room; if (!room) return [];
    if (room.host) return room.members.slice(1).map(m => ({ name: m.name, ping: m.ping, conn: m.game && m.game.open ? m.game : null, via: m.game && m.game.open ? 'game channel' : 'reliable' }));
    const out = [{ name: 'host', ping: (room.members.find(m => m.id === room.me) || {}).ping, conn: room.game && room.game.open ? room.game : null, via: room.game && room.game.open ? 'game channel' : 'reliable' }];
    for (const m of room.members) if (m.id !== 'host' && m.id !== room.me) { const l = room.links && room.links.get(m.id); out.push({ name: m.name, conn: l && l.c.open ? l.c : null, via: l && l.c.open ? 'direct' : 'via host' }); }
    return out;
  };
  // whether a connection goes through the TURN relay (asks the browser; cached on the connection)
  NP.routeOf = function (conn) {
    if (!conn || !conn.peerConnection) return null;
    if (!conn._abRouteAt || now() - conn._abRouteAt > 3000) {
      conn._abRouteAt = now();
      conn.peerConnection.getStats().then((st) => {
        let pair = null; const by = {};
        st.forEach((r) => { by[r.id] = r; if (r.type === 'transport' && r.selectedCandidatePairId) pair = r.selectedCandidatePairId; });
        if (!pair) st.forEach((r) => { if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r.id; });
        const p = by[pair], loc = p && by[p.localCandidateId], rem = p && by[p.remoteCandidateId];
        conn._abRoute = loc ? ((loc.candidateType === 'relay' || (rem && rem.candidateType === 'relay')) ? 'relay' : loc.candidateType === 'host' ? 'local' : 'direct') : null;
        conn._abRtt = p && p.currentRoundTripTime ? p.currentRoundTripTime * 1000 : null;
      }).catch(() => {});
    }
    return { route: conn._abRoute || null, rtt: conn._abRtt || null };
  };
  // names or colours changed while in a room (the players themselves stay): tell the host, who shows
  // them to everyone and uses them from the next match on
  NP.updateMyPlayers = function () {
    const room = NP.room; if (!room) return;
    const mine = localPlayers();
    if (room.host) {
      const me = room.members[0]; if (!me) return;
      me.name = AB.settings.netName;
      me.players = me.players.map((p, i) => Object.assign({}, p, mine[i] ? { name: mine[i].name, color: mine[i].color } : {}));
      sendRoom(room);
    } else if (room.conn && room.conn.open) {
      try { room.conn.send({ t: 'players', name: AB.settings.netName, players: mine.map(p => ({ name: p.name, color: p.color })) }); } catch (e) {}
    }
  };
  NP.setState = (st) => { if (NP.room && NP.room.host) { NP.room.state = st; sendRoom(NP.room); } };

  // build a round: who plays in which slot, the arena, the seed and the input delay
  NP.makeRound = function (round, prevPlayers) {
    const room = NP.room, S = AB.settings;
    let players = [];
    if (prevPlayers) {
      // later rounds keep everyone in the same slot (scores are kept per slot). Nobody can join mid-match;
      // players whose computer left carry on as AIs (option #262) or sit the rest of the match out.
      // A computer that comes back (it rejoined from the lobby) gets its players back.
      const here = (id) => room.members.some(m => m.id === id);
      for (const p of prevPlayers.concat(room.benched || [])) {
        if (p.wasOwner && here(p.wasOwner)) players.push(Object.assign({}, p, { ai: false, owner: p.wasOwner, control: p.wasControl, wasOwner: undefined, wasControl: undefined, aiLevel: undefined, benched: undefined }));
        else if (p.ai || here(p.owner)) players.push(Object.assign({}, p));
        else if (S.lostNetToAI) players.push(Object.assign({}, p, { ai: true, aiLevel: room.aiLevel, owner: null, control: 'ai', wasOwner: p.owner, wasControl: p.control }));
        else players.push(Object.assign({}, p, { benched: true, wasOwner: p.wasOwner || p.owner, wasControl: p.wasControl || p.control }));
      }
      room.benched = players.filter(p => p.benched);
      players = players.filter(p => !p.benched).sort((a, b) => a.slot - b.slot);
    } else {
      room.benched = []; room.departed = new Map();       // a new match: nobody to bring back
      const cols = NP.assignColours(room.members, room.ais);
      for (const m of room.members) for (const p of m.players) {
        if (players.length >= NP.MAX_PLAYERS) break;
        players.push({ slot: players.length, color: cols[players.length], team: 0, ai: false, name: p.name, owner: m.id, control: p.control });
      }
      for (let i = 0; i < room.ais && players.length < NP.MAX_PLAYERS; i++) players.push({ slot: players.length, color: cols[players.length], team: 0, ai: true, aiLevel: room.aiLevel, name: 'Computer ' + (i + 1), owner: null, control: 'ai' });
    }
    // input delay from the worst ping: a little delay saves a lot of corrections (js/net.js)
    const pings = room.members.slice(1).map(m => m.ping || 0).sort((a, b) => b - a), maxPing = pings[0] || 0;
    const q = AB.params || new URLSearchParams(location.search);
    const delay = q.get('netdelay') ? AB.clamp(+q.get('netdelay') | 0, 0, 10) : maxPing < 80 ? 1 : maxPing < 200 ? 2 : maxPing < 350 ? 3 : 4;
    // how far the game may run on guesses: the slowest path (member to member through the host, at worst)
    const worstOneWay = (pings.length > 1 ? (pings[0] + pings[1]) / 2 : maxPing / 2);
    const maxRollback = AB.clamp(Math.ceil(worstOneWay / (1000 / AB.TPS)) - delay + 10, 15, 30);
    const computers = room.members.map(m => m.id);
    const sim = {};
    for (const k of ['conveyorSpeed', 'diseasesDestroyable', 'enclosement', 'playTime', 'randomStart', 'stompedDetonate',
                     'winsNeeded', 'winByKills', 'lostNetToAI', 'scheme']) sim[k] = S[k];
    sim.scheme = AB.pickScheme(S);
    sim.countdown = S.countdown !== false;      // one of the host's ticked schemes for this round
    sim.teamPlay = false; sim.goldBomberman = false;
    sim.aiFinale = true;           // only computer players left: fast walls (js/game.js updateAIFinale)
    // the host's sound preset and variety, for everyone (js/audio.js forceProfile)
    sim.sound = NP.soundProfile();
    return { round, seed: (Math.random() * 0xffffffff) >>> 0, level: AB.pickArena(S), sim, players, delay, maxRollback, computers, aiLevel: room.aiLevel };
  };
})(window.AB);
