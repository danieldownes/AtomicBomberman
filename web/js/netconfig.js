// Optional network settings, read when Network Game opens. Leave this as it is to use the free public
// services: PeerJS's server (0.peerjs.com) introduces the browsers, Google STUN finds a direct route,
// and PeerJS's TURN servers relay the game when no direct route exists. See NETWORK.md.
//
// Every computer in a room must use the same matchmaking server, so change this for everyone or no one.
//
// Your own PeerServer (npx peer --port 9000), for example:
//   window.AB_NET_CONFIG = { peer: { host: 'peer.example.com', port: 443, path: '/', secure: true } };
//
// Your own TURN relay (Metered Open Relay, Cloudflare Realtime, coturn...), for example:
//   window.AB_NET_CONFIG = { iceServers: [
//     { urls: 'stun:stun.l.google.com:19302' },
//     { urls: 'turn:turn.example.com:3478', username: 'user', credential: 'pass' },
//   ] };
//
// Both can be set together. A page URL with ?peerserver=host:port (plain http) or ?ice=none overrides this.
window.AB_NET_CONFIG = window.AB_NET_CONFIG || null;
