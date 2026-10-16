# Network play

Main menu > **Network Game**. Browsers meet in one of three fixed rooms and play over WebRTC. The port
needs no server of its own, so it works from GitHub Pages as it is.

## Playing

**Lobby**

* **Your name** is at the top: press Enter on it to type a new one. The first time, it's one of the
  original's random node names (MESSAGES.TXT 500+), and the cursor starts there.
* **Players here** picks the keyboards and joysticks this computer brings, up to four, and each
  player's colour. It works like the local Player Setup: Right changes a player's control, Left
  turns it off. On a colour row, Left and Right step through the ten colours.
  * The host sorts out clashes in joining order. A player who asks for a colour someone earlier
    already has gets the next free one, and computer players take what's left.
* The lobby lists Room 1, 2 and 3. Each shows whether it is empty, waiting for players or playing.
  It also shows the host, who is in the room with their pings, and the host's match settings.
* Enter on an **empty** room makes you its host. Enter on a **waiting** room joins it. A room that
  is **playing** can't be joined until its match ends.

**Room**

* The room lists each computer, its players and its ping to the host. A room holds up to five
  computers and ten players, as in the original.
* The host has a menu:
  * **Computer players**: Left/Right.
  * **Computer skill**: Easy, Medium or Original, for all of them. Players whose computer leaves
    carry on at this skill too.
  * **Match settings**: the local Arena & Match choices, plus the gameplay options a network match
    uses. These are the arenas, scheme, wins or kills needed, play time, random start, conveyor
    speed, stomped bombs, enclosement depth, destroyable diseases and "Lost net players revert to
    AIs".
  * **Start the match**: at least two players are needed.
* Everyone in the room sees the settings change as the host picks them. The settings are the host's
  own Options too, so they carry over to local play.

**Match**

* The match uses the host's match settings. Team play and the Gold Bomberman roulette are off in network games.
* Sounds, voices, music and graphics are cosmetic, so they stay each player's own choice.
* Pause and Force Draw are off, because every computer has to stay in step. Esc then Y leaves.
* **F10 twice** forfeits the round for the players on your computer. It goes out with your next
  input (`AB.IN.FORFEIT`), so every computer drops them at the same tick.
* **Only computer players left:** HURRY sounds, and 3 seconds later the walls close in four times
  as fast and keep going until the arena is full. This applies whether the humans died, forfeited or
  left. If an AI's kill leaves a single player standing, that's an ordinary win.
* Between rounds only the host continues to the next round. The others see "Waiting for the
  host...".
* If a computer falls behind, the others wait for it and show "Waiting for <name>...".
* Keep the game in the front tab. Browsers throttle background tabs, which holds everyone up.
  A computer that sends no input for 20 seconds during a round is dropped. On the results screen
  between rounds only the pings count, so the host can take as long as it likes.

**When someone leaves**

* If a computer leaves (or goes quiet for 8 seconds), its players become computer players from the
  same tick on every screen. If "Lost net players revert to AIs" is off, those players die instead.
* Later rounds keep everyone in the same slot, so scores stay with the right player.
* If the host leaves, the room closes and everyone goes back to the lobby.

## Services used

* **PeerJS 1.5.5** (`js/vendor/peerjs.min.js`, MIT licence) is a WebRTC wrapper. It loads only
  when Network Game opens.
* **Signalling** (free, no account): the public PeerJS server (`0.peerjs.com`) introduces the
  browsers to each other over a WebSocket. After that, game traffic goes browser to browser over
  WebRTC data channels.
* **STUN** (free, no account): Google's and Cloudflare's public STUN servers tell each browser its
  public address, so most home connections can link directly.
* **TURN relay** (optional): some networks can't link directly, so a relay has to carry the game.
  Examples are some mobile, office, school and guest networks, and a PC whose firewall treats its
  network as public. None is set up by default:
  * PeerJS's own free TURN hosts (`eu-0`/`us-0.turn.peerjs.com`) no longer exist. They had no DNS
    records when tested in October 2026, so the port doesn't use them.
  * **Recommended: Cloudflare Realtime TURN.** It's free for the first 1,000 GB a month (shared
    with Cloudflare's SFU), then $0.05/GB. Its API token must stay secret, so a small Cloudflare
    Worker (`cloudflare/turn-worker.js`) hands the game 24-hour logins instead. The game stays on
    GitHub Pages. Setup is in `cloudflare/README.md`.
  * Or Metered's [Open Relay](https://www.metered.ca/tools/openrelay/): 20 GB a month on a free
    account, with its key in the public `js/netconfig.js`.
  * Once a relay is set up, the lobby says "relay ready".
  * A relayed computer uses about 70 MB per hour of play (about 9 KB/s each way). Only computers that
    can't link directly use the relay.

Checked from a home connection in October 2026: the PeerJS server answered in about 3 seconds, and two
browsers on one machine connected in under a second. These are shared community services with no
uptime guarantee. If the PeerJS server can't be reached, the lobby says "Cannot reach the
matchmaking server". If two computers can't link directly and no relay is set up, joining fails
with "Could not reach the room host (a strict network may need a relay)."

## How the rooms work

* **Room ids.** Each room is a well-known PeerJS id: `atomic-bomberman-dd-v1-room-1` to `-3`. An id
  can only be held by one browser at a time, so whoever claims it first becomes the host.
  * If two people pick an empty room at the same moment, one gets the id. The other gets
    `unavailable-id` and joins that room instead.
* **Lobby.** The lobby has its own random id. Every few seconds it opens a *probe* connection to
  each room id.
  * A host answers with the room's info and then pushes updates every second.
  * If nobody holds the id, the server reports `peer-unavailable` and the room shows as empty.
    That takes about 5 seconds, so a room reads "checking..." at first. Enter works on it anyway.
* **Star topology.** As with the original's IPX host, every member connects only to the host, and
  the host relays everything to the others. Messages are JSON on a reliable, ordered data channel.
* **Leaving.** A host that leaves frees the room's id at once.
  * PeerJS fires its "disconnected" event from inside `destroy()`, so the port never reconnects a
    peer it is closing (`closePeer`). Earlier, that left a ghost holding the room, and re-hosting or
    rejoining failed.
  * A lobby whose link to the matchmaking server has dropped reconnects. After 10 seconds it starts
    over with a new connection.
* **Compatibility.** Lockstep needs the same game code on every computer.
  * A deployed build carries its commit hash (see the root README's *Versions*). A host turns away
    a computer on another commit: "The host has v1.0.9, you have v1.0.8: the older one should
    reload". The lobby shows the same warning on the room.
  * Every file is loaded with `?v=<commit>`, so a cached file from an older build can't mix in.
  * A dev copy (run from disk or a local server, with no commit) is only checked against
    `NP.PROTO`, the protocol number in js/netplay.js.
  * To give a fork its own rooms, change the id prefix.

| Message | Direction | Purpose |
|---|---|---|
| `hello {v, role, name, players}` | to host | probe the room, or ask to join |
| `room {info}` | host to members and probes | state, host, members, pings, settings (every second and on change) |
| `welcome {id}` / `reject {reason}` | host to joiner | accepted, or why not (version, in a game, full) |
| `ping {ts}` / `pong {ts}` | host and member | round trip every second; the shown ping is smoothed |
| `start {cfg}` | host to members | one round: number, seed, arena, rules, players (slot, name, owner computer, AI), input delay |
| `ready {round}` | member to host | arena loaded |
| `go {round}` | host to members | everyone has loaded the arena picture and sound effects (or 45 s passed): start the clock |
| `ls {r, m}` | member to host to others | a lockstep message (`in` inputs or `sum` checksum) for round `r` |
| `drop {round, slots, from}` | host to members | those players need no more input from tick `from` |
| `victory` | host to members | the match is won: show the victory screen |
| `end {reason?}` | host to members | match over, back to the room; with a reason, the room has closed |
| `leave` | member to host | leaving (also sent when the tab closes) |

## Lockstep (js/net.js)

* **Pure simulation.** `AB.Game` never reads the clock, the DOM, `Math.random` or devices.
  * One `game.step(inputs)` is 1/60 s. `inputs[i]` is a 6-bit mask for player `i`.
  * AI players are computed inside `step()` from the shared state and seeded RNG, so nothing is
    sent for them.
  * Only input bits travel: about one byte per human player per tick.
* **Input delay.** Local input for tick `t` is scheduled for `t + delay`.
  * The host sets the delay each round from the worst ping: `ceil((ping/2 + 30 ms) / 16.7 ms)`,
    kept between 3 and 14 ticks (50–233 ms).
* **Stalls.** A tick runs only once every remote player's input for it has arrived.
* **Catch-up.** Inputs are always queued `delay` ticks ahead. So only a queue at least two ticks
  longer than that means a computer has fallen behind, for example after a hiccup. That computer
  then runs two ticks per frame until it has caught up. Otherwise the game runs at the normal
  60 ticks a second, the same speed as local play.
* **Desync checks.** Every 60 ticks each computer sends `game.checksum()`, and any mismatch
  stops the round with a message. (It never happened in testing.)
* **Rounds.** Lockstep messages carry their round number. Early ones are kept until that round
  starts, and late ones from the last round are dropped.
* **Drops.** The host relays a member's inputs before anything else it sends about that member,
  and the channels are ordered. So when a member is lost, every computer has received the same
  inputs from it.
  * The host cuts at the tick after the last input it relayed, or the current tick if that is
    later.
  * From that tick every computer turns those players into AIs, or kills them.

`AB.net.selfTest()` (browser console) runs two sessions in one page with three ticks of latency and
checks that both end with the same checksum.

## Relay and server settings

Edit `js/netconfig.js`. It ships empty, and the file has examples.

**Cloudflare relay.** After following `cloudflare/README.md`, set:

```js
window.AB_NET_CONFIG = { turnCredentialsUrl: 'https://atomic-bomberman-turn.YOUR-SUBDOMAIN.workers.dev/' };
```

* The Worker only answers pages on `danieldownes.github.io`, `localhost`/`127.0.0.1` and copies
  opened from disk. Edit `ALLOWED_ORIGINS` in the Worker for a fork.
* That check only stops other websites. A script could still ask the Worker for logins, so keep an
  eye on the usage in Cloudflare's dashboard.
* Logins last 24 hours. The lobby fetches fresh ones whenever it opens with ones over an hour old.

**Metered relay.** Sign up at metered.ca and create an app. Then set:

```js
window.AB_NET_CONFIG = {
  turnCredentialsUrl: 'https://YOUR-APP.metered.live/api/v1/turn/credentials?apiKey=YOUR-KEY',
};
```

* The game fetches that URL once when Network Game opens and adds the servers it returns to the
  free STUN servers.
* If the fetch fails, the lobby says "relay unavailable" and direct links still work.
* The key sits in a public file, so anyone could use your monthly allowance.

**Other servers.**

```js
window.AB_NET_CONFIG = {
  peer: { host: 'peer.example.com', port: 443, path: '/', secure: true },   // your PeerServer
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' },                    // replaces the default STUN list
               { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }],
};
```

* A PeerServer is `npx peer --port 9000` (the `peer` npm package). Every computer in a room must use
  the same one.
* You can also run your own TURN server with coturn.

URL overrides, mainly for testing:

* `?peerserver=127.0.0.1:9000` uses a PeerServer over plain http.
* `?ice=none` uses no STUN/TURN, which is enough on one machine or a LAN.
* `?ice=relay` sends everything through the relay. Two tabs with it can only connect through the
  relay, so this checks that the relay works.

**Local test.** Run `npx peer --port 9000 --host 127.0.0.1`, serve this folder, and open two browser
profiles (or one normal and one private window) at
`http://localhost:8000/?peerserver=127.0.0.1:9000&ice=none`.

`server/relay.js` is an earlier WebSocket relay sketch. The game doesn't use it.

## What the original did

* `BM95.EXE` imports `WSOCK32.dll` and supports IPX, modem, serial and TCP/IP. `VALUELST.RES`
  #1100–#1110 hold per-protocol retransmit timeouts for "critical" packets.
* The host uploads the settings, the scheme and the extras to the clients (MESSAGES.TXT 300–310:
  *Receiving Level Data...*).
* Up to five computers share one battle of up to ten players, and lost net players can turn into
  AIs (option #262).
* Its NETWORK.BM lists features it turned off online: some animations, the trampolines, and the
  "Diseases Can Be Destroyed" option. Lockstep keeps every computer identical, so the port keeps
  them all. F1 on the network screens shows the port's own help page instead.

## Keeping the simulation deterministic

* Don't use `Math.random()` or `Date.now()` in js/game.js or js/ai.js.
* Keep floating point out of the simulation. Positions, timers and speeds are integers. Only
  cosmetic values, such as the height of a thrown bomb's arc, use `Math.sin`.
* Cosmetic choices, such as which taunt or explosion sample plays, can stay local and random.
