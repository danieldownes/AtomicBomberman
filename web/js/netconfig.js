// Optional network settings, read when Network Game opens. See NETWORK.md.
//
// By default the game uses free public services with no account:
//   - PeerJS's server (0.peerjs.com) introduces the browsers to each other,
//   - Google and Cloudflare STUN servers find a direct route through home routers.
// That is enough for most home connections. Some strict networks (mobile data, offices, schools)
// also need a TURN relay to carry the game; set one up below.
//
// Free relay: Metered's Open Relay (metered.ca/tools/openrelay) gives 20 GB of TURN a month on a free
// account. Sign up, then paste your app name and API key into the URL below. Anyone can read this
// file, so anyone could use that allowance. Only computers that can't link directly use the relay,
// at about 70 MB per hour of play each, so 20 GB is roughly 300 hours of relayed play a month.
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
// These can be combined in one object. A page URL with ?peerserver=host:port (plain http) or
// ?ice=none overrides this.
window.AB_NET_CONFIG = window.AB_NET_CONFIG || null;
