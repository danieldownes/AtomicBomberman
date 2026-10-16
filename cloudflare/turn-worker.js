// Cloudflare Worker for Atomic Bomberman's network play: hands the game short-lived TURN relay logins
// from Cloudflare Realtime, so players whose networks block direct links can still connect.
//
// The game stays on GitHub Pages. This Worker only keeps the TURN key's API token secret: Cloudflare's
// docs say the key must never reach the browser, so the browser gets a 24-hour login instead.
//
// Setup (see cloudflare/README.md): paste this file into a new Worker, then add two secrets under
// Settings > Variables and Secrets:
//   TURN_KEY_ID          the TURN key's "Turn Token ID"
//   TURN_KEY_API_TOKEN   the TURN key's "API Token"
// and put the Worker's URL in web/js/netconfig.js as turnCredentialsUrl.

// pages allowed to ask for logins (a browser sends its page's origin; other sites get turned away)
const ALLOWED_ORIGINS = [
  /^https:\/\/danieldownes\.github\.io$/,          // the game on GitHub Pages
  /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,      // a copy served on your own computer
  /^null$/,                                          // a copy opened straight from disk (file://)
];
const TTL_SECONDS = 24 * 3600;    // longer than a play session: a relayed link stops when its login expires

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED_ORIGINS.some((re) => re.test(origin));
    const cors = {
      'Access-Control-Allow-Origin': allowed ? origin : 'https://danieldownes.github.io',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
      'Cache-Control': 'no-store',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });
    // opened straight in a browser tab (no Origin): a setup check that reports, but hands out nothing
    const check = !origin;
    if (!allowed && !check) return new Response('Forbidden', { status: 403, headers: cors });
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) {
      return new Response('Not ready: the Worker is missing its TURN_KEY_ID or TURN_KEY_API_TOKEN secret.', { status: 500, headers: cors });
    }

    const r = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: TTL_SECONDS }),
    });
    if (!r.ok) {
      const why = r.status === 401 || r.status === 403 ? ' (check the two secrets: the Turn Token ID and its API Token)' : '';
      return new Response(`Not ready: Cloudflare TURN answered ${r.status}${why}.`, { status: 502, headers: cors });
    }
    const data = await r.json();
    if (check) return new Response('OK: the Worker is running and Cloudflare accepted the TURN key.', { headers: Object.assign({ 'Content-Type': 'text/plain; charset=utf-8' }, cors) });

    // browsers block port 53, so those relay addresses would only time out (Cloudflare's docs suggest
    // dropping them when not every client trickles candidates)
    const iceServers = [].concat(data.iceServers || []).map((s) => {
      const urls = [].concat(s.urls || []).filter((u) => !/:53(\?|$)/.test(u));
      return Object.assign({}, s, { urls });
    }).filter((s) => s.urls.length);

    return new Response(JSON.stringify({ iceServers }), { headers: Object.assign({ 'Content-Type': 'application/json' }, cors) });
  },
};
