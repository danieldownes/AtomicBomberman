# Network play plan

Network play is not in round 1, but the engine is already structured for it. This file explains the
design so round 2 is mostly transport and lobby work.

## What the original did

`BM95.EXE` imports `WSOCK32.dll` (`socket`, `sendto`, `recvfrom`, `bind`) and supports IPX, modem,
serial and TCP/IP (`VALUELST.RES` #1100-#1110 hold per-protocol retransmit timeouts for "critical"
packets). The host uploads settings, the scheme and the "extras" to the clients (`MESSAGES.TXT`
300-310: *Receiving Level Data...*, *Receiving Powerup Data...*). Up to five computers can share one
battle of up to ten players, and lost net players can turn into AIs (option #262).

## Model used by the port: deterministic lockstep

* `AB.Game` (js/game.js) is a pure simulation. It never reads the clock, DOM, `Math.random` or
  device input. Everything random goes through the seeded `AB.Rng`.
* One call to `game.step(inputs)` advances 1/60 s. `inputs[i]` is a 6-bit mask per player
  (up, down, left, right, drop bomb, action).
* AI players are computed inside `step()` from the game state and the shared RNG, so every peer
  gets identical AI behaviour without sending anything.
* `game.checksum()` hashes the state, so desyncs are detected immediately.

So only input bits travel over the wire: about 1 byte per local player per tick.

## Session layer (already in js/net.js)

`AB.net.LockstepSession` handles:

* **Input delay** (default 4 ticks, about 67 ms). Local input for tick `t` is scheduled for
  `t + delay` and broadcast as `{t:'in', tick, v:[[slot,bits],...]}`.
* **Stalling.** The sim only advances when every remote slot's input for the next tick has arrived.
* **Desync checks.** Every 60 ticks each peer sends `{t:'sum', tick, hash}`.

`AB.net.selfTest()` runs two sessions in one page over a loopback hub with 3 ticks of latency
and checks that both simulations end with the same checksum. It passes with no stalls.

## Remaining work for round 2

1. **Transport.** Pick one, or both:
   * **WebSocket relay**: a working sketch is already in `server/relay.js` (Node + `ws`:
     `cd server && npm install && npm start`). Rooms are keyed by name, peer ids are assigned,
     up to 5 computers fit per room (like the original), and every `{t:'relay', data}` is
     forwarded to the other members. `AB.net.WebSocketTransport` speaks this protocol. It is the
     simplest option and works through any firewall.
   * **WebRTC DataChannels** (unordered/unreliable plus a small resend window): lower latency, but
     it needs a signalling step (the same tiny relay can do it).
2. **Lobby screens.** "Start Network Game" and "Join Network Game" already exist in the menu.
   Add node names (MESSAGES.TXT 500-548 are the original random defaults), the server list and
   slot assignment ("NET" control type), and team and AI assignment by the host only, as in the
   original.
3. **Start message.** The host sends `{t:'start', seed, settings, scheme, level, players, delay}`.
   Each client builds the identical `AB.Game` from it.
4. **Driver.** In the `game` screen, replace the local `g.step(inputs)` call with
   `session.update()` when a session is active. Rendering and audio stay unchanged because they
   only read game state and `game.events`.
5. **Dropouts.** If a peer stops sending input, the host broadcasts `{t:'drop', slot, atTick}`.
   From that tick every peer flips the slot to AI (setting #262) or kills it.
6. **Between rounds.** The host sends the next round's seed and level. Match scores are derived
   from the identical results on every peer.

## Things to keep deterministic

* Don't use `Math.random()` or `Date.now()` inside js/game.js or js/ai.js.
* Keep floating-point math out of the simulation. Positions, timers and speeds are integers, and
  only cosmetic values (the bomb flight arc height) use `Math.sin`.
* Cosmetic choices (which taunt or explosion sample plays) can stay local and random.
