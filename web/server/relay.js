// Minimal WebSocket relay for lockstep inputs: an early sketch, NOT used by the game, which plays over
// PeerJS / WebRTC instead (see NETWORK.md). Kept as a starting point for a self-hosted alternative.
// Usage:  cd server && npm install ws && node relay.js [port]
// Clients (js/net.js WebSocketTransport) send {t:'join', room} then {t:'relay', data}.
// The relay assigns peer ids and forwards every message to the other members of the room.
'use strict';
const { WebSocketServer } = require('ws');
const port = +(process.argv[2] || 8787);
const wss = new WebSocketServer({ port });
const rooms = new Map();          // room -> Set(ws)
let nextId = 1;
wss.on('connection', (ws) => {
  ws.id = nextId++;
  ws.on('message', (raw) => {
    let m; try { m = JSON.parse(raw); } catch (e) { return; }
    if (m.t === 'join' && typeof m.room === 'string') {
      ws.room = m.room.slice(0, 32);
      if (!rooms.has(ws.room)) rooms.set(ws.room, new Set());
      const peers = rooms.get(ws.room);
      if (peers.size >= 5) { ws.send(JSON.stringify({ t: 'full' })); return ws.close(); }  // up to five computers, like the original
      peers.add(ws);
      ws.send(JSON.stringify({ t: 'welcome', id: ws.id, peers: [...peers].map(p => p.id) }));
      for (const p of peers) if (p !== ws) p.send(JSON.stringify({ from: 0, data: { t: 'peer-joined', id: ws.id } }));
    } else if (m.t === 'relay' && ws.room) {
      const out = JSON.stringify({ from: ws.id, data: m.data });
      for (const p of rooms.get(ws.room) || []) if (p !== ws && p.readyState === 1) p.send(out);
    }
  });
  ws.on('close', () => {
    const peers = ws.room && rooms.get(ws.room);
    if (!peers) return;
    peers.delete(ws);
    for (const p of peers) p.send(JSON.stringify({ from: 0, data: { t: 'peer-left', id: ws.id } }));
    if (!peers.size) rooms.delete(ws.room);
  });
});
console.log(`Atomic Bomberman relay listening on ws://localhost:${port}`);
