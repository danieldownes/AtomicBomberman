# Atomic Bomberman: HTML5 port

A browser version of Interplay/Hudson's *Atomic Bomberman* (1997). It uses the original game's
graphics, sounds, music, arenas and tuning tables, converted from your CD image.

## How to play

* **Easiest:** double-click `index.html`. It runs straight from disk (`file://`) in Chrome, Edge or
  Firefox.
* **Or serve the folder:** for example `python -m http.server` inside this folder, then open
  http://localhost:8000.

The intro movie from the CD plays first; press any key to skip it. If the browser starts it muted
(browsers need one key press or click before they allow sound), the first key turns the sound on.
You can turn the intro off under Options > Intro Movie on Start.

### Graphics modes

The main menu uses editable gold lettering, with **Local Play**, **Network Game**, then
**Campaign Game**. **HD Mode: Off**, directly below Campaign Game, toggles the graphics pack
with Enter or Left/Right. Retro is the default and downloads no HD assets.

Enabling HD shows a loading bar while the menu art, characters and effects arrive. Escape
cancels; a failed download leaves Retro active and can be retried. The choice is remembered.
HD draws at 1920 x 1440 while preserving the original 640 x 480 game coordinates, animation
timing, player colours and simulation. Arena backgrounds, tiles and destruction frames load
when their arena is needed, separately from the initial switch. Decoded artwork is reused
when switching modes again during the same session. HD works opened from disk too: the
pictures the game recolours (the bombermen, the victory scene) also come as scripts, because
Chrome won't let a page opened from disk read the pixels of its picture files.

The optional pack remasters the still screens and most animation artwork, including Bedrock.
Classic stays 8-bit, drawn with sharp pixels. The apple-eating and knuckle-blowing idles, corner
reactions, conveyors, Aliens enemies, timer and teleport effects use reviewed HD repairs.
The Aliens wall has a smooth reflective face without the invented leaf. Meditation, head polishing
and several deaths still use the original sprites because their generated poses failed review.
HD flames are cut from connected blast artwork to keep their segment joins continuous.
HD draws its
bombs from the biggest bomb frame, scaled and leaned like the original animation. The intro movie and real people in the credits retain their original assets.
Main-menu lettering uses the bundled Amarante outline font. Elsewhere HD writes in Chakra
Petch (bundled, OFL), whose cut corners echo the original bitmap fonts, sized to match them;
Retro keeps the bitmap fonts.

### Default controls (from the original INPUT.BM; change them under Options > Define keyboard layouts)

| Player | Move | Drop bomb | Action (punch / stop kick / trigger) |
|---|---|---|---|
| KEY 0 | Arrow keys | Space | Enter |
| KEY 1 | R D F G | S | A |
| KEY 2 | I J K L | U | O |
| KEY 3 | Numpad 8 4 5 6 | Numpad 0 | Numpad Enter |
| Gamepads (JOY n) | Stick / D-pad | Button A | Button B / X |

**Drop bomb** also works as in the original:

* Press it again while standing on your own bomb to **spooge** (lay all your bombs in a line).
* With the blue glove, hold it while standing on your bomb to **grab** it, then release to throw.

Other keys:

* Esc: back, or quit the match
* P: pause
* F10: force a draw (in a network game, press it twice to forfeit the round)
* F9: network figures (network games only)
* F1: help for the current screen
* M: mute music
* + / - (main keyboard or numpad): game volume, effects and music together (handy over voice
  chat). Not while typing a name, and not in a round if a player's keys use them.
* F11: fullscreen

In the menus, holding Up/Down (or a gamepad's stick) moves once, then after a moment keeps
moving, stopping at the end of a list (a single press goes round from the last item to the
first). The long lists (Options, Schemes, Sounds & Voices, Gameplay Music, the manual) also take
PgUp/PgDn and Home/End, glide as they scroll, and show a scrollbar when they don't fit.

## Campaign Mode

The original has a hidden single-player campaign: pressing C five times on its Player Setup screen
opens it, and that still works here. The port also lists it as **Campaign Game** on the main menu;
network play is under **Network Game** (below).

* There are three campaigns from the CD: *Simple* (4 stages), *Croutons* (9) and *Ghost Towns* (4).
* Each stage sets the arena, the scheme, how many ghosts and rovers there are and how fast they
  move, and how many computer players you face.
* Ghosts drift through bricks, but rovers can't. Both wander the maze, mostly towards you, and kill
  you on contact; flames kill them. They don't harm computer players.
* Clear every enemy to move on to the next stage. If you lose, you get "Oh Well! Campaign
  unsuccessful!" and replay that stage.
* The humans are the keyboard and joystick players from Local Play > Player Setup (KEY 0 if there
  are none).
* Stages you have cleared are remembered. Left/Right on the campaign screen picks a starting stage.

## Network Game

Main menu > **Network Game** plays against people on other computers, straight from the browser.
There is nothing to install or host.

* In the lobby you set your name, and the keyboards, joysticks and colours of the players your
  computer brings (up to four). If two players want the same colour, the one who joined first keeps
  it.
* The lobby has three fixed rooms. Pick an empty one to host it, or a waiting one to join. Each
  room shows who is in it, their pings and the host's settings.
* In the room, the host picks the number of computer players and their skill, and opens Match
  settings. That has
  the arenas, scheme, wins, play time and gameplay options, as in local play's Arena & Match.
  Everyone sees the choices as they change.
* Up to five computers and ten players can play, as in the original. Team play and the Gold
  Bomberman roulette are off online.
* Every computer runs the same simulation, and only key presses are sent. Each computer guesses
  the others' keys until they arrive and corrects itself (rollback), so play stays smooth even at
  a 300-500 ms ping. F9 shows the network figures. If someone leaves, their players carry on as
  computer players.
* On the results screen only the host goes on. Pressing bomb there tells everyone you're waiting;
  after a few presses you can pick one of 15 sounds to send them.
* F10 twice gives up the round for the players on your computer. Once only computer players are
  left, HURRY sounds, and 3 seconds later the walls close in four times as fast and fill the arena.
  An AI that wins by knocking out the last other player just wins.
* Keep the game in the front tab while playing: browsers slow down background tabs.

It runs over WebRTC. PeerJS's free public server does the matchmaking, and most home connections then
link directly. Players on strict networks (some mobile, office or school connections) also need a
relay. Metered's free tier works for that once its key is in `js/netconfig.js`. Details are in
NETWORK.md.

## Computer players

Local Play > Player Setup: Right cycles a player through *AI easy*, *AI medium*, *AI original*,
*AI hard* and *AI dangerous*, then the keyboards and joysticks.

Typing on Player Setup gives the highlighted player its own name in place of "Player 3" (up to 12
characters); Backspace deletes, and an empty name is "Player 3" again. The name shows on the name
tags at the round start, the results and the victory screen. Tab switches a player's team (T now
types).

* **Original** (js/original.js): the 1997 game's own AI, ported from its executable (BM95.EXE). The
  comments name the original function behind each part, so it reads side by side with
  decompiled/BM95_decompiled.c.
  * Each frame it tries eight behaviours in the original's order until one acts:
    1. throw or pick up its own bomb with the blue glove;
    2. punch a bomb next to it;
    3. run from danger to the least dangerous cell in reach;
    4. drop a bomb next to bricks (1 in 5);
    5. drop one when someone is on or next to it (1 in 5, but not near where it started);
    6. now and then go for a power-up;
    7. now and then go after a player, people before computers;
    8. otherwise wander.
  * It drops bombs without checking it can get away from them.
  * Reversed Controls don't affect it, as in the original.
  * Its quirks are kept. For example, after half a second of going for power-ups in a round it stops
    going for them, because the original resets the wrong timer.
* **Hard:** the port's own AI, called Original until the 1997 one was ported. It works out when each
  cell will burn and walks round it, bombs bricks and anyone in its blast, and goes for power-ups
  nearby.
* **Medium:** Hard, but it thinks it over less often, notices other players' bombs later, chases less
  and grabs fewer power-ups.
* **Easy:** all of that, more so.
* **Dangerous** (js/dangerous.js): the strongest.
  * It works out when every cell will burn. That includes chain reactions (a bomb a blast reaches goes
    off with it), a brick that burns away and lets a later blast through, a kicked bomb going off
    wherever it has slid to when its fuse runs out, and a punched one where it comes down (off one edge
    and back in at the other).
  * It times its own steps as the game moves it, so it slips through the gaps between blasts.
  * It never lays a bomb it can't get away from, nor one a nearby player could trap it with by laying
    another, and it keeps out of corridors where that could happen.
  * It minds Reversed Controls and Short Fuze, and keeps off trampolines, warps and diseases.
  * It heads for where a bomb would do most, and lays bombs to leave someone no way out, or only one
    or two (then it knows where they'll hide).
  * It fires its remote bombs when someone stands in the blast, and kicks and punches bombs at people.
    A punched bomb that lands on a head stuns them, usually for long enough.
`node tools/ai_arena.cjs` plays computer-only rounds headless to compare them (see ../tools/README.md).
Measured with it on the 11 default arenas, counting the rounds someone won:

* **Two against two:**
  * Hard beat Medium 69% to 31%.
  * Original beat Medium 66% to 34% and Easy 76% to 24%.
  * Hard beat Original 58% to 42%.
* **One on one:** Hard beat Original 60% to 40%.
* **One Dangerous against three Hards:** Dangerous won 42% of 1,000 rounds, which is 62% of the rounds
  someone won (an even share is 25%).
* **Dangerous one on one against Hard:** 59% of 400 rounds (79%).
* **One Dangerous against three Originals:** 58% (74%).

Per player per tick, Original thinks for about 1 µs, Hard for 7 and Dangerous for 22.

In network games the host sets one skill for all the computer players.

Hard, Medium and Easy each have their own random choices (seeded from the round and its slot, so
network games stay in step), and they keep out of each other's way: of equally near safe cells they take
the least crowded one, and they don't pick a cell another player stands on or another computer
player is heading for. Before, two that met made the same choices from then on and walked around
on top of each other: 8 computer players overlapped 3.6 % of the time (once for 25 s on end); now
0.5 % (at most 10 s, when cornered together).

## Arenas

Local Play > Arena & Match > **Arenas** has a tick box for every arena; each round is played in one
of the ticked ones.

* *The Hockey Rink* and *Aliens* start unticked, because the original leaves them out of its
  random choice. Tick them to play them.
* *Classic (8-bit)* is an extra arena added by the port. It uses the NES-style bombermen and
  power-up icons found unused on the CD (CLASSICS.ANI). Its tiles, bricks, bombs, flames, floor
  and chiptune music are new, made for this port.
* *Bedrock* is a second extra arena: bedrock walls, grass floors and breakable grass-topped dirt
  that crumbles in nine frames, new generated pixel art. It plays like Green Acres, uses the Mine
  Shaft music, and its textures load the first time it comes up. If they can't be downloaded, that
  round uses Green Acres' terrain and the next one tries again.

## Schemes

Local Play > Arena & Match > **Schemes** (the network host's Match settings and the Options
screen's *Scheme File* open the same list). Every .SCH layout has a tick box, and each round is
played on one of the ticked ones.

* The number after each name is who the layout was made for, read from the original's own tags.
  "(10)" means up to 10 players, "(8 ONLY)" exactly 8, "(5)(5)" two teams, and "(1+)" any number.
  Layouts that suit the current number of players are shown in green.
* The highlighted scheme gets a map with its start positions, what everyone starts with, which
  power-ups it rules out, and how full of bricks it is.
* **Preset** (Left/Right to browse, Enter to apply) ticks a whole set:
  * *Recommended for N players*: every layout made for that many.
  * *Original default*: just the BASIC SET.
  * *Classic grids*.
  * *Free-for-all layouts*.
  * *Team layouts*.
  * *Small games (made for 4 or fewer)*.
  * *Everything*.

## Match victory screens

The celebrating Bomberman uses the winner's colour; the defeated one uses the runner-up's colour.
Runner-up is decided by total wins (or total kills in a kill-based match), then the other score,
then the lower player slot if both scores are tied. Team games use the winning and opposing
teams' white/red colours. The original scene and lighting are preserved while each suit is
recoloured independently.

## Options added by the port

These are under main menu > Options, next to the original settings.

* **Gameplay Music** opens a track list with a tick box for each track. Move the cursor onto a
  track to hear it, and press Enter or Space to tick or untick it. **Track Order** chooses between
  *Each level's own track* (the original behaviour; a level whose track is unticked plays a
  random ticked one instead) and *Shuffle ticked tracks*. Untick everything for silent rounds.
  Leaving the list brings the menu music back. This replaces the original "Disable music during
  gameplay" switch.
* **Seamless loops.** The menu music and three level tracks (Battle, Pyramid, Sewer) end by
  repeating their opening bars (the menu: its first two bars, 3.8 s), so looping the whole file
  played those bars twice, after a small gap. The port finds where each track's opening comes
  round again (cross-correlating the opening with the end: 0.93-0.99 alike) and loops just the
  part before it, through Web Audio, with the first 20 ms blended in from what followed the cut so
  there is no click (`AB.audio.MUSIC_LOOPS` in js/audio.js). Opened from disk (file://), where the
  browser won't fetch files, the same tracks load from `audio/music/<name>.js` instead. The
  end-of-round tracks (results, draw, match won) run from their last note straight into their
  first, so they loop whole, the same way, for as long as the screen stays up.
* **Sounds & Voices** is a browser for every sound, including the roughly 1,050 recordings on
  the CD that the game never used. It has three levels:
  * game events, such as "Taunt after a kill" or "Explosion";
  * the phrases in an event, where takes that say the same words are grouped together;
  * the individual takes.

  The sound under the cursor plays after a moment; R plays another take. Space ticks or unticks
  an event, phrase or take, and Enter opens the next level.

  **Preset** sets every tick at once:
  * *Child friendly*: the extended set minus insults, swearing and rude lines. This also drops
    some lines the original shipped with, such as "You are a stupid man's idiot".
  * *Original set*: exactly the clips listed in SOUNDLST.RES.
  * *Extended* (the default): the original set plus the unused takes.
  * *Extended + uncensored*: adds the cut lines with real swearing.
  * *Voices off*: sound effects only.

  Your own ticks are kept on top of the preset. **Variety each round** sets how many different
  phrases each event gets per round. Every round picks a new handful of the ticked sounds and
  loads only those.

  One sound is the port's own: the **Wilhelm scream**, a third take of "Caught in the flames"
  (about one death in three). It is the fourth scream of the original 1951 recording session,
  which USC released into the public domain (CC0); see `tools/port_sounds/README.md`. It plays in
  the Child friendly, Extended and Uncensored presets, not in Original set.
* **Idle Animations**: four animations found unused on the CD (meditating, wiping his head,
  eating an apple, blowing on his knuckles). One plays when a player stands still for five
  seconds.
* **Intro Movie on Start**: plays the CD's intro movie before the title screen.
* **Round Start Countdown** (on by default): each round opens with the name of its scheme (the
  layout, e.g. "Just the BASIC SET! (10)") and a 3, 2, 1 countdown before anyone can move: each
  number starts screen-high and shrinks away, with a wall slam, and an explosion on "go". The
  round's music starts after it. The numbers fade out in an oval around each human player's
  bomberman, so nobody loses sight of themselves. During the countdown and for a second after,
  every bomberman has a name tag at its feet ("Player 1", "AI 3", or the player's own name). The
  loading screen shows the scheme's name too.
* **Status bar**: each player's head, name and score (S: rounds won, K: kills), laid out in one or
  two rows and sized to fill the bar, whether there are 2 players or 10. A player who is out is
  crossed out.
* **Only computer players left** (local and network games, not campaigns): once every human player
  is out and at least two computer players remain, HURRY sounds, and 3 seconds later the walls
  close in four times as fast and fill the arena (at once, if they are already closing in). An AI that wins by knocking out the last human
  just wins.
  * The lettering copies the style of the original's HURRY!! picture. The CD has no letters in that
    style, so it uses Anton, a free font (SIL Open Font License) embedded in `data/titlefont.js`.
  * In network games the host's setting applies.
* **Closing walls you can see coming** (Enclosement Depth): each block drops straight down from
  above, larger and fading in, its shadow growing on the floor beneath, and lands with a thud, a
  flash and a puff of dust. A block landing on a block already there (an arena walled all round)
  thuds too and sends rock chips flying, so the walls are seen and heard closing in all the way
  round.
* **Demo (attract mode)**: left alone on the main menu, the game plays a round of computer
  players. It follows Options (arenas, schemes, play time, closing walls, sounds) instead of a fixed
  90-second round on the default arenas, and loads like any round, so it gets its own sounds and,
  in HD, its arena's art. Any key goes back to the menu.
* **Graphics**
  * *Enhanced*: soft sprite edges, translucent shadows and glowing flames. These are derived
    when the game loads.
  * *Original*: the hard colour key, as shipped. The data has no alpha channel.
* **Screen Scaling**: sharp pixels or smooth (bilinear) scaling.

## What's in here

```
index.html          the game
js/core.js          constants, VALUELST.RES access, deterministic RNG
js/game.js          the simulation (movement, bombs, flames, powerups, diseases, hurry walls...)
js/ai.js            computer players: Hard, and Easy and Medium built on it
js/original.js      the Original computer player: the 1997 game's AI, ported from BM95.EXE
js/dangerous.js     the Dangerous computer player
js/render.js        drawing with the original sprites
js/screens.js       menus, results, victory, roulette, online manual, credits, intro movie
js/screens2.js      Sounds & Voices browser, Arenas, Campaign Mode
js/gfx.js, audio.js, input.js
js/victory.js       one victory scene with independent winner/runner-up colours and cached palettes
js/tilesets.js      the Bedrock arena's terrain: loading, previews and cached rendering
js/net.js           rollback session: prediction, re-simulation, time sync, checksums, drop-outs (see NETWORK.md)
js/netplay.js       network rooms over PeerJS/WebRTC: hosting, joining, pings, relaying
js/netscreens.js    the network lobby and room screens, and the match controller
js/voice.js         voice chat in network rooms: microphone, voice gate, one WebRTC call per pair
js/netconfig.js     optional relay (TURN) and matchmaking server settings (empty by default)
js/vendor/          PeerJS 1.5.5 (MIT), loaded only for network games
data/gamedata.js    VALUELST.RES, MESSAGES.TXT, SOUNDLST.RES, all 67 .SCH schemes, EXTRA*.RES, *.BM help
data/sprites.js     the .ANI sprite files (frames + sequences) as atlases, plus the unused idle and classic sets
data/classic.js     the Classic arena's tiles, bombs and flames (new art)
data/campaigns.js   the campaign stages from DATA/RES/*.CAM
data/sounds.js      sound catalog: game events -> phrases -> takes, with flags for each take
data/fonts.js       FONT0/1/6.FON
data/titlefont.js   the Anton font (OFL, licence in data/titlefont.LICENSE.txt) for arena names and the countdown
data/uifont.js      the Chakra Petch font (OFL, data/ui-chakra-petch.*) for HD mode's text
img/                every .PCX picture as PNG, mainmenu_port.png (relabelled menu), field11.png (Classic)
img/tilesets/       terrain textures for the Bedrock arena (new generated pixel art)
img/victory-base.png, victory-mask.png   the shared original win scene and its material/palette map
img/icons/green-*, favicon-green.ico, manifest.webmanifest   the site icon: a generated green
                    bomberman's head based on the original title and victory artwork (16-48 px
                    for tabs, 180 px for iPhones/iPads, 192/512 px for "add to home screen")
audio/music/        the 17 music tracks, plus classic.mp3 (new)
audio/clips/        all 2,010 sound clips from the CD, one small script each, loaded when needed
intro/              the CD's intro movie, re-encoded (WebM, with MP4 as a fallback)
```

## How it was made

* The CD dump was a raw Mode-2 (2352-byte sector) image. It was converted to a plain ISO and
  extracted (see `../extracted`).
* **Sprites:** the `CHFILEANI` format was decoded. FRAM/CIMG chunks hold 16-bit RLE images with a key
  colour; SEQ/STAT chunks hold sequences with per-state frame offsets. The green player suit is
  recoloured at runtime for the ten player colours (VALUELST 200-247, the `.RMP` remap idea).
* **Audio:** `.RSS` files are raw 22 kHz 16-bit stereo PCM, re-encoded to MP3.
* **Logic:** `BM95.EXE` (Watcom C) was decompiled with angr and radare2. The port follows it for
  per-pixel movement with corner sliding, multi-key direction preference, kick/punch/throw,
  oldest-first trigger detonation, trampoline relocation, disease spreading, the spiral HURRY
  enclosement (one block every 250 ms) and more. All numbers come from the game's own
  `VALUELST.RES`.

* **Voices:** the CD holds 2,027 `.RSS` clips, but the game only uses the 974 named in
  SOUNDLST.RES; it never had voice modes. The unused clips were transcribed with Whisper. Each
  one was then filed under an event by its sibling takes, its file-name prefix and keywords, and
  grouped into phrases by line number and transcript. The transcripts, and so the phrase names
  and groups, are machine-made and approximate. The full list is in `../tools/VOICE_LINES.csv`.
  The rules that pick the uncensored and child-friendly sets are in `../tools/build_voices.py`.
* **Intro:** `INTRO/BMINTRO.EXE` is a player with an Interplay MVE movie inside, which was
  re-encoded. The game itself never plays it.

The conversion scripts are in `../tools` if you want to regenerate the assets.
