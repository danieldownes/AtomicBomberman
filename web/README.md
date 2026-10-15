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
* F10: force a draw
* F1: help for the current screen
* M: mute music
* F11: fullscreen

## Campaign Mode

The original has a hidden single-player campaign: pressing C five times on its Player Setup screen
opens it, and that still works here. The port also lists it on the main menu, in place of
"Start Network Game"; network play is under "Network Game" (below).

* There are three campaigns from the CD: *Simple* (4 stages), *Croutons* (9) and *Ghost Towns* (4).
* Each stage sets the arena, the scheme, how many ghosts and rovers there are and how fast they
  move, and how many computer players you face.
* Ghosts drift through bricks, but rovers can't. Both wander the maze, mostly towards you, and kill
  you on contact; flames kill them. They don't harm computer players.
* Clear every enemy to move on to the next stage. If you lose, you get "Oh Well! Campaign
  unsuccessful!" and replay that stage.
* The humans are the keyboard and joystick players from Start Game > Player Setup (KEY 0 if there
  are none).
* Stages you have cleared are remembered. Left/Right on the campaign screen picks a starting stage.

## Network Game

Main menu > **Network Game** plays against people on other computers, straight from the browser.
There is nothing to install or host.

* The lobby has three fixed rooms. Pick an empty one to host it, or a waiting one to join. Each
  room shows who is in it, their pings and the host's settings.
* In the room, the host adds computer players with Left/Right and starts with Enter. Up to five
  computers and ten players can play, as in the original. Each computer brings the keyboard and
  joystick players from Start Game > Player Setup.
* The match uses the host's Options and Arena & Match settings. Team play and the Gold Bomberman
  roulette are off online.
* Every computer runs the same simulation in lockstep, and only key presses are sent. If someone
  leaves, their players carry on as computer players.
* Keep the game in the front tab while playing: browsers slow down background tabs.

It runs over WebRTC using PeerJS's free public matchmaking and relay servers. Details, and how to use
your own servers, are in NETWORK.md.

## Arenas

Start Game > Arena & Match > **Arenas** has a tick box for every arena; each round is played in one
of the ticked ones.

* *The Hockey Rink* and *Aliens* start unticked, because the original leaves them out of its
  random choice. Tick them to play them.
* *Classic (8-bit)* is an extra arena added by the port. It uses the NES-style bombermen and
  power-up icons found unused on the CD (CLASSICS.ANI). Its tiles, bricks, bombs, flames, floor
  and chiptune music are new, made for this port.

## Options added by the port

These are under main menu > Options, next to the original settings.

* **Gameplay Music** opens a track list with a tick box for each track. Move the cursor onto a
  track to hear it, and press Enter or Space to tick or untick it. **Track Order** chooses between
  *Each level's own track* (the original behaviour; a level whose track is unticked plays a
  random ticked one instead) and *Shuffle ticked tracks*. Untick everything for silent rounds.
  Leaving the list brings the menu music back. This replaces the original "Disable music during
  gameplay" switch.
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
* **Idle Animations**: four animations found unused on the CD (meditating, wiping his head,
  eating an apple, blowing on his knuckles). One plays when a player stands still for five
  seconds.
* **Intro Movie on Start**: plays the CD's intro movie before the title screen.
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
js/ai.js            computer players
js/render.js        drawing with the original sprites
js/screens.js       menus, results, victory, roulette, online manual, credits, intro movie
js/screens2.js      Sounds & Voices browser, Arenas, Campaign Mode
js/gfx.js, audio.js, input.js
js/net.js           lockstep session: input delay, stalls, checksums, drop-outs (see NETWORK.md)
js/netplay.js       network rooms over PeerJS/WebRTC: hosting, joining, pings, relaying
js/netscreens.js    the network lobby and room screens, and the match controller
js/netconfig.js     optional matchmaking/relay server settings (empty by default)
js/vendor/          PeerJS 1.5.5 (MIT), loaded only for network games
data/gamedata.js    VALUELST.RES, MESSAGES.TXT, SOUNDLST.RES, all 67 .SCH schemes, EXTRA*.RES, *.BM help
data/sprites.js     the .ANI sprite files (frames + sequences) as atlases, plus the unused idle and classic sets
data/classic.js     the Classic arena's tiles, bombs and flames (new art)
data/campaigns.js   the campaign stages from DATA/RES/*.CAM
data/sounds.js      sound catalog: game events -> phrases -> takes, with flags for each take
data/fonts.js       FONT0/1/6.FON
img/                every .PCX picture as PNG, mainmenu_port.png (relabelled menu), field11.png (Classic)
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
