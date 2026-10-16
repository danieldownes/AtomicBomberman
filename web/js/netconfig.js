// Optional network settings, read when Network Game opens. See NETWORK.md.
//
// By default the game uses free public services with no account:
//   - PeerJS's server (0.peerjs.com) introduces the browsers to each other,
//   - Google and Cloudflare STUN servers find a direct route through home routers.
// That is enough for many connections. Some networks block direct links (some mobile, office, school
// and guest networks, and some PCs' firewalls), so a TURN relay has to carry the game; set one up here.
//
// Recommended relay: Cloudflare Realtime TURN (1,000 GB a month free) through your own small Worker,
// which keeps the API token secret. Setup: cloudflare/README.md. Then put the Worker's address here:
//   window.AB_NET_CONFIG = { turnCredentialsUrl: 'https://atomic-bomberman-turn.YOUR-SUBDOMAIN.workers.dev/' };
//
// Or Metered's Open Relay (20 GB a month free, metered.ca/tools/openrelay). Its key sits in this public
// file, so anyone could use that allowance:
//   window.AB_NET_CONFIG = { turnCredentialsUrl: 'https://YOUR-APP.metered.live/api/v1/turn/credentials?apiKey=YOUR-KEY' };
//
// Or list relay servers yourself (static credentials, coturn...):
//   window.AB_NET_CONFIG = { iceServers: [
//     { urls: 'stun:stun.l.google.com:19302' },
//     { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
//   ] };
//
// Your own PeerServer (npx peer --port 9000). Every computer in a room must use the same one:
//   window.AB_NET_CONFIG = { peer: { host: 'peer.example.com', port: 443, path: '/', secure: true } };
//
// These can be combined in one object. Page address overrides: ?peerserver=host:port (plain http),
// ?ice=none (no STUN/TURN), ?ice=relay (relay only, to check the relay works).
window.AB_NET_CONFIG = window.AB_NET_CONFIG || null;
