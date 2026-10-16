# Cloudflare relay for network play

Some networks block direct links between browsers. Examples are some mobile, office, school and guest
networks, and a PC whose firewall treats its network as public. A TURN relay carries the game for
those players.

This folder has a small Cloudflare Worker, `turn-worker.js`, that hands the game short-lived logins
for Cloudflare Realtime TURN.

* **Where the game runs:** still on GitHub Pages. The Worker is the only thing on Cloudflare.
* **Where the token lives:** the TURN key's API token stays in the Worker as an encrypted secret,
  never in this repository or the browser.
* **What the game gets:** 24-hour logins.
* **Cost:** Cloudflare's TURN is free for the first 1,000 GB a month, then $0.05/GB. A relayed
  player uses about 70 MB per hour.

## Setup

Cloudflare's menu names change from time to time, so yours may differ slightly.

1. **Create a TURN key.** In the [Cloudflare dashboard](https://dash.cloudflare.com), open
   **Realtime**, then **TURN Server**, then **Create**. Name it `atomic-bomberman` and create it.
   Copy the **Turn Token ID** and the **API Token** somewhere safe for the next steps. Treat the API
   Token like a password.
2. **Create the Worker.** Go to **Workers & Pages > Create application** and start from the
   **Hello World** Worker. Name it `atomic-bomberman-turn` and deploy it.
3. **Paste the code.** Open the Worker's code editor (**Edit code**). Replace everything with
   `turn-worker.js` from this folder, then **Deploy**.
4. **Add the two secrets.** In the Worker's **Settings > Variables and Secrets**, choose **Add**.
   Add each of these with the type **Secret**, then **Deploy**:
   * `TURN_KEY_ID`: the Turn Token ID
   * `TURN_KEY_API_TOKEN`: the API Token
5. **Check it.** Open the Worker's address, `https://atomic-bomberman-turn.<your-subdomain>.workers.dev/`,
   in a browser tab. It should say *"OK: the Worker is running and Cloudflare accepted the TURN key."*
   Otherwise it says what's missing.
6. **Point the game at it.** In `web/js/netconfig.js`, set:
   ```js
   window.AB_NET_CONFIG = { turnCredentialsUrl: 'https://atomic-bomberman-turn.<your-subdomain>.workers.dev/' };
   ```
   Then commit and push.
7. **Test the relay.** Open the game in two tabs with `?ice=relay` added to the address. That forces
   all traffic through the relay. The lobby should say "relay ready", and one tab should be able to
   host a room and the other join it.

## Notes

* **Who may ask for logins:** the Worker only answers pages on `danieldownes.github.io`,
  `localhost`/`127.0.0.1` and copies opened from disk. For a fork, edit `ALLOWED_ORIGINS`.
* **Limits of that check:** it stops other websites, but a script can still fake the page address.
  Watch the TURN usage in the dashboard. If it ever grows unexpectedly, create a new TURN key and
  update the two secrets. That cuts off everything issued under the old key.
* **Relay off:** the game works without the Worker. Leave `turnCredentialsUrl` unset and only
  direct links are used.
