# Network play

Main menu > **Network Game**. Browsers meet in one of three fixed rooms and play over WebRTC. The port
needs no server of its own, so it works from GitHub Pages as it is.

## Playing

**Lobby**

* **Your name** is at the top: press Enter on it to type a new one. The first time, it's one of the
  original's random node names (MESSAGES.TXT 500+), and the cursor starts there.
* **Players here** picks the keyboards and joysticks this computer brings, up to four, and each
  player's name and colour. It works like the local Player Setup: Right changes a player's control,
  Left turns it off. Enter on a name row types that player's own name (empty: the computer's name,
  numbered, e.g. "Bob 2"). On a colour row, Left and Right step through the ten colours.
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
    uses. These are the arenas, ticked schemes (with presets; the host picks one for each round), wins or kills needed, play time, random start, conveyor
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
* **Voice chat**: everyone in the room hears everyone else (see *Voice chat* below). V mutes you.
* **F9** shows the network figures: input delay, how far behind the confirmed game is, rollbacks
  per second and how deep they go, stalls, and how this computer reaches each of the others
  (direct, through the host, or through the TURN relay).
* Between rounds only the host continues to the next round. The others see "Waiting for the
  host...". If they press bomb anyway, they get the original's "not allowed" sound, and the host
  and the rest hear it too, with a "!" marker (and the count) by that computer's players. From the
  third press on, a list of 15 sounds opens (hurry-ups, poops, disease groans, a couple of
  taunts): Up/Down picks one, bomb sends it to everyone, Esc closes the list.
* Long distances play smoothly: each computer runs on with a guess for the others' keys and
  corrects itself when the real ones arrive (see *Rollback* below). Only if a computer's input
  stops arriving altogether (for about a quarter of a second or more) does the game hold and show
  "Waiting for <name>...".
* Keep the game in the front tab. Browsers throttle background tabs, which holds everyone up.
  A computer that sends no input for 20 seconds during a round is dropped. On the results screen
  between rounds only the pings count, so the host can take as long as it likes.

**When someone leaves**

* If a computer leaves (or goes quiet for 8 seconds), its players become computer players from the
  same tick on every screen. If "Lost net players revert to AIs" is off, those players die instead.
  A message over the top of the screen says who left or lost connection.
* **Rejoining.** That computer can come back while the match is on: its room shows "Enter: rejoin"
  in the lobby (the browser keeps an id of its own, `netCid`, and the host remembers the ids that
  dropped out). It waits in the room and plays again from the next round, with its players back in
  their slots, names, colours and scores. A computer that drops out of a lobby, or a match that
  has ended, simply joins again as usual.
* Later rounds keep everyone in the same slot, so scores stay with the right player.
* If the host leaves, the room closes and everyone goes back to the lobby.

## Voice chat (js/voice.js)

* **In the room and in game.** As soon as you are in a room, you hear everyone else in it and they
  hear you: in the room, between rounds and while playing. The browser asks once for the
  microphone; without one (or if you say no) you still hear the others.
* **V** mutes or unmutes your microphone, in the room and in game (unless V is one of your
  keyboard layout's keys). A speaker by a name in the room, or over a bomberman, shows who is
  talking; a crossed-out microphone, who is muted or has none.
* **Voice chat settings** (Room > Voice chat, or Voice chat in the lobby to choose and test the
  microphone before joining; each player's own): voice chat on or off, the
  microphone (and Enter to ask the browser again after a refusal), which microphone, the
  **voice gate** (sends only while you speak: the level meter shows your voice, the yellow mark
  where the gate opens; levels 1-10 are -60 to -24 dBFS, it stays open 0.45 s after you stop),
  the volume of all voices and of each person (remembered by name), and *Keep game sounds out*.
* **No outside service.** Each pair of computers in the room has its own audio call over WebRTC,
  through the same STUN/TURN as the game: members call the host, and of two members the one that
  joined first calls the other. A room holds at most five computers, so each sends its voice to
  at most four others (about 30-40 kbps each with Opus); nothing mixes them on a server.
  Echo cancellation, noise suppression and automatic gain come from the browser.
* **Game sounds and the microphone.** Browsers cancel the echo of what a page plays, but Chrome
  only does that for `<audio>`/`<video>` elements, not for Web Audio, which plays every game sound
  (music already plays through an `<audio>` element). With *Keep game sounds out* on (the default),
  while your microphone is on the game sounds go Web Audio -> a WebRTC connection inside the page
  -> an `<audio>` element, so the browser cancels them like the voices. That adds a few hundredths
  of a second to them; if it can't connect, the game sounds play directly as before. Echo
  cancellation needs a real microphone and speakers, so it can only be tried out by playing:
  headphones avoid the question altogether.
* Messages: `vstate {on, mic, muted}` member -> host (the host puts it in the room info, so
  everyone sees who has voice), `talk {id, on}` when someone's gate opens or closes.

## The same sounds on every computer

* The host picks **Sounds (everyone)** (child friendly, original, extended, uncensored, voices off)
  and **Sound variety (everyone)** in Match settings. During the match every computer plays that
  set, without anyone's own ticks; your own Sounds & Voices settings come back after it
  (`AB.audio.forceProfile`).
* **Seeded choices.** Each round picks a handful of takes per sound event (`A.newRound`); a
  network round seeds that from the round's seed, so every computer loads the same takes. Each
  sound the game asks for then picks its take from a key made of the round seed, the event's tick
  and its place among that tick's events (`seq`, from js/net.js), not from `Math.random`, and
  doesn't prefer whatever happens to be loaded already. The countdown, announcer, draw and victory
  voices are keyed on the round seed.
* **With rollback.** A sound plays when its tick is first simulated, guesses included. A re-run of
  the same ticks plays nothing again (see *What you see* above), and the same event a tick or
  three later is still the same event. So a sound only differs between computers when one of
  them guessed an event that then didn't happen (it can't be unplayed) or heard of a real one
  late. In testing (three computers, 240 ms ping, 2% loss) all three played the same set of
  takes.

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
  * A relayed computer uses about 55 MB per hour of play (7-8 KB/s each way). Only computers that
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
* **Connections.** Between each member and the host there are two data channels:
  * a reliable, ordered one for JSON messages (room state, pings, round start, drops, checksums,
    nudges). The host relays these to the others, as with the original's IPX host;
  * a **game channel** for the input packets: binary (`serialization: 'raw'`), unordered and never
    resent (`maxRetransmits: 0`; PeerJS's own "unreliable" only drops the ordering, so the port
    sets this on unordered channels). A resent input would come too late to matter, and every packet
    repeats all inputs the others haven't confirmed, so a lost one costs nothing.
  * Members also open game channels to each other (a mesh: of each pair, the one that joined first
    calls), so their inputs don't make the detour through the host. They tell the host which links
    are up (`mesh`), and the host passes packets on only between members without one. Until a game
    channel is open, packets go over the reliable channel as `g {d}`.
* **Leaving.** A host that leaves frees the room's id at once.
  * PeerJS fires its "disconnected" event from inside `destroy()`, so the port never reconnects a
    peer it is closing (`closePeer`). Earlier, that left a ghost holding the room, and re-hosting or
    rejoining failed.
  * A lobby whose link to the matchmaking server has dropped reconnects. After 10 seconds it starts
    over with a new connection.
* **Compatibility.** Rollback needs the same game code on every computer.
  * A deployed build carries its commit hash (see the root README's *Versions*). A host turns away
    a computer on another commit: "The host has v1.0.9, you have v1.0.8: the older one should
    reload". The lobby shows the same warning on the room.
  * Every file is loaded with `?v=<commit>`, so a cached file from an older build can't mix in.
  * A dev copy (run from disk or a local server, with no commit) is only checked against
    `NP.PROTO`, the protocol number in js/netplay.js.
  * To give a fork its own rooms, change the id prefix.

| Message | Direction | Purpose |
|---|---|---|
| `hello {v, role, name, players, peer, cid}` | to host | probe the room, or ask to join (`cid`: this browser's id, to rejoin a match it dropped out of) |
| `room {info}` | host to members and probes | state, host, members, pings, settings (every second and on change) |
| `welcome {id}` / `reject {reason}` | host to joiner | accepted, or why not (version, in a game, full) |
| `ping {ts}` / `pong {ts}` | host and member | round trip every second; the shown ping is smoothed |
| `start {cfg}` | host to members | one round: number, seed, arena, rules, players (slot, name, owner computer, AI), computers, input delay, rollback limit |
| `ready {round}` | member to host | arena loaded |
| `go {round}` | host to members | everyone has loaded the arena picture and sound effects (or 45 s passed): start the clock. The host starts half its worst ping later, so all start together |
| `ls {r, m:{t:'sum', tick, h}}` | each to all (via host) | checksum of a confirmed tick of round `r` |
| `drop {round, c, from, fill, name, why}` | host to members | computer `c` has left (`why`: left or timeout): its players are AIs (or out) from tick `from`; `fill` is the host's copy of its last inputs |
| `mesh {ids}` | member to host | the members it has a direct game channel with |
| `g {d}` | any (via host) | an input packet, while no game channel is open |
| `nudge {n, pick}` | member to host to others | pressed bomb on the results screen (`pick`: a sound from the list, or -1) |
| `notice {text}` | host to members | a message for the top of the screen (someone rejoined) |
| `victory` | host to members | the match is won: show the victory screen |
| `end {reason?}` | host to members | match over, back to the room; with a reason, the room has closed |
| `leave` | member to host | leaving (also sent when the tab closes) |

## Rollback (js/net.js)

Until October 2026 the port used plain lockstep: a tick ran only once every computer's input for it
had arrived, with an input delay of half the ping plus 30 ms. Between Europe and Asia (300 ms ping)
that meant about 200 ms between pressing a key and seeing it, and a freeze every time a packet came
late. Now it uses **rollback**, the way fighting games do it:

* **Pure simulation.** `AB.Game` never reads the clock, the DOM, `Math.random` or devices.
  * One `game.step(inputs)` is 1/60 s. `inputs[i]` is a bit mask for player `i`.
  * AI players are computed inside `step()` from the shared state and seeded RNG, so nothing is
    sent for them. Only input bits travel: one byte per human player per tick.
  * `game.saveState()` / `loadState()` copy the whole simulation (7-14 KB, about 0.1 ms).
* **Short input delay.** Local input for tick `t` is used at `t + delay`. The host picks the delay
  each round from the worst ping: 1 tick under 80 ms, 2 under 200 ms, 3 under 350 ms, else 4
  (17-67 ms). `?netdelay=N` overrides it for testing.
* **Guess, then correct.** When another computer's input for a tick hasn't arrived, the game uses
  its last one (players mostly keep holding the same keys; forfeit is never guessed). The state is
  saved every tick. When the real input arrives and differs from the guess, the game goes back to
  that tick, applies it, and runs forward to now again, all before the next frame is drawn. The
  outcome is exactly what lockstep gives (same inputs at the same ticks), so death checks and bomb
  timings are never "compensated" or approximated: they are simply decided by the real inputs.
* **Rollback limit.** The game runs at most `maxRollback` ticks beyond the last tick it has
  everyone's input for (15-30, from the slowest path). Past that it holds ("Waiting for ...").
  Going back 15 ticks costs about 5 ms with ten players.
* **What you see.**
  * Sounds and effects of re-run ticks are matched against what was already played, so nothing
    plays twice. A real event the guess missed plays late.
  * A death waits until it is *confirmed* (the inputs up to that tick are final), so nobody is seen
    dying and then coming back. The player stands still meanwhile, a few frames at most.
  * A player moved by a correction slides to the right place over a few frames instead of jumping.
  * The round ends (and scores count) only once the end itself is confirmed.
* **Time sync.** Every packet carries the sender's tick. Each computer measures "their tick when
  sent minus my tick on arrival" for each other one, and they swap the figures; half the difference
  is how far ahead one is, with the latency cancelled out. A computer more than 2 ticks ahead
  skips an occasional frame, one that has fallen behind (a background tab, a hiccup) runs extra
  ticks, so all run at 60 ticks a second together.
* **Packets** (type 1 direct, 2 passed on by the host), binary:
  `u8 type, u8 round, u8 source, u8 computers, u32 sender's tick`, then per computer
  `u32 newest tick I have all of its inputs up to, i16 lead x8`, then
  `u32 first tick, u16 count, u8 players`, and `count x players` input bytes: everything since the
  oldest tick some other computer hasn't confirmed. Sent every frame: about 7-8 KB/s each way.
* **Final ticks.** The host decides when a computer has left, so a member's input only counts as
  final once the host has it too. A tick whose inputs are all final can't change any more.
* **Desync checks.** Every 60 ticks the checksum of the final state goes to everyone, and any
  mismatch stops the round with a message. (It never happened in testing.)
* **Drops.** When a computer leaves, the host cuts it off at the tick after the last input of it the
  host has, and sends its copy of the last inputs along. Every computer then turns those players
  into AIs (or kills them) inside the game at that tick, rolling back to it if needed.
* **Testing.** `?netsim=oneway,jitter,loss` (ms, ms, 0..1) on each computer delays incoming
  messages and drops game packets, e.g. `?netsim=150,20,0.02` on both for a 300 ms ping.
  `AB.net.selfTest()` (browser console, or `test/` in Node) runs three computers through a host with
  latency, jitter, loss and a drop, and compares every confirmed checksum with a plain run of the
  same inputs.

Measured with two browsers on `?netsim=<oneway>,20,0.02` (both moving the whole time, 25 s):

| Ping | Old lockstep input delay | Input delay now | Rollbacks | Average depth | Frames held in 25 s | Speed |
|---|---|---|---|---|---|---|
| 120 ms | 100 ms, freezes on late packets | 33 ms | 1.5-3 a second | 1-2 ticks | 0 | 60 ticks/s |
| 320 ms | 200 ms, freezes on late packets | 50 ms | about 3 a second | 5-7 ticks | 3-4 | 60 ticks/s |
| 520 ms | 233 ms, freezes on late packets | 67 ms | about 3 a second | 11 ticks | 4-8 | 60 ticks/s |

Most of the held frames come at the start of a round, during the 3-2-1, while the clocks line up.

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
