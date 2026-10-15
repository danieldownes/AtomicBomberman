# Network play

Main menu > **Network Game**. Browsers meet in one of three fixed rooms and play over WebRTC. The port
needs no server of its own, so it works from GitHub Pages as it is.

## Playing

**Lobby**

* The lobby lists Room 1, 2 and 3. Each shows whether it is empty, waiting for players or playing.
  It also shows the host, who is in the room with their pings, and the host's match settings.
* Your name is at the top: press Enter to edit it. The first time, it's one of the original's
  random node names (MESSAGES.TXT 500+).
* Enter on an **empty** room makes you its host. Enter on a **waiting** room joins it. A room that
  is **playing** can't be joined until its match ends.

**Room**

* The room lists each computer, its players and its ping to the host.
* The players on a computer are its keyboard and joystick entries in Start Game > Player Setup, or
  KEY 0 if there are none. A computer can have up to four players.
* A room holds up to five computers and ten players, as in the original.
* The host adds computer players with Left/Right and starts with Enter. At least two players are
  needed.

**Match**

* The match uses the host's settings:
  * the scheme, ticked arenas, wins or kills needed and play time;
  * conveyor speed, stomped bombs, enclosement depth, destroyable diseases and random start;
  * "Lost net players revert to AIs".
* Team play and the Gold Bomberman roulette are off in network games.
* Sounds, voices, music and graphics are cosmetic, so they stay each player's own choice.
* Pause and Force Draw are off, because every computer has to stay in step. Esc then Y leaves.
* Between rounds only the host continues to the next round. The others see "Waiting for the
  host...".
* If a computer falls behind, the others wait for it and show "Waiting for <name>...".
* Keep the game in the front tab. Browsers throttle background tabs, which holds everyone up.
  A computer that sends no input for 20 seconds is dropped.

**When someone leaves**

* If a computer leaves (or goes quiet for 8 seconds), its players become computer players from the
  same tick on every screen. If "Lost net players revert to AIs" is off, those players die instead.
* Later rounds keep everyone in the same slot, so scores stay with the right player.
* If the host leaves, the room closes and everyone goes back to the lobby.

## Services used (all free, no account)

* **PeerJS 1.5.5** (`js/vendor/peerjs.min.js`, MIT licence) is a WebRTC wrapper. It loads only
  when Network Game opens.
* **Signalling:** the public PeerJS server (`0.peerjs.com`) introduces the browsers to each other
  over a WebSocket. After that, game traffic goes browser to browser over WebRTC data channels.
* **STUN** (Google) finds a direct route through home routers.
* **TURN** (PeerJS's public relay) carries the game when no direct route exists, for example on
  some mobile, corporate or symmetric-NAT networks.

These are shared community services with no uptime guarantee. If the PeerJS server can't be reached,
the lobby says "Cannot reach the matchmaking server". To use your own servers, see below.

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
* **Compatibility.** `NP.PROTO` in js/netplay.js is the protocol version. A host turns away other
  versions with "That room runs a different version of the game". To give a fork its own rooms,
  change the id prefix.

| Message | Direction | Purpose |
|---|---|---|
| `hello {v, role, name, players}` | to host | probe the room, or ask to join |
| `room {info}` | host to members and probes | state, host, members, pings, settings (every second and on change) |
| `welcome {id}` / `reject {reason}` | host to joiner | accepted, or why not (version, in a game, full) |
| `ping {ts}` / `pong {ts}` | host and member | round trip every second; the shown ping is smoothed |
| `start {cfg}` | host to members | one round: number, seed, arena, rules, players (slot, name, owner computer, AI), input delay |
| `ready {round}` | member to host | arena loaded |
| `go {round}` | host to members | everyone has loaded (or 12 s passed): start the clock |
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
* **Stalls.** A tick runs only once every remote player's input for it has arrived. A computer
  that is behind runs up to two ticks per frame to catch up.
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

## Using your own servers

Edit `js/netconfig.js`; it ships empty, and the file has examples. Every computer in a room must use
the same signalling server.

```js
window.AB_NET_CONFIG = {
  peer: { host: 'peer.example.com', port: 443, path: '/', secure: true },   // your PeerServer
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' },
               { urls: 'turn:turn.example.com:3478', username: 'u', credential: 'p' }],
};
```

* A PeerServer is `npx peer --port 9000` (the `peer` npm package).
* Metered's Open Relay and Cloudflare Realtime both have free TURN tiers. You can also run coturn.

URL overrides, mainly for testing:

* `?peerserver=127.0.0.1:9000` uses a PeerServer over plain http.
* `?ice=none` uses no STUN/TURN, which is enough on one machine or a LAN.

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
