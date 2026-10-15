# BM95.EXE reverse-engineering notes

* **Compiler:** Watcom C/C++ 32-bit (`BEGTEXT`/`DGROUP` sections).
* **Image base:** 0x400000.
* **Entry point:** 0x44bdcc.
* **Imports:** DDRAW, DSOUND, DINPUT, WSOCK32 (UDP), WINMM (joystick), plus KERNEL32 and USER32 for
  serial/modem play.

`BM95_decompiled.c` is the raw angr output for all 2443 functions. Watcom passes the first four
arguments in EAX, EDX, EBX and ECX, so many "locals" in the pseudo-C are really parameters.
`valuelst_usage.txt` maps every `VALUELST.RES` id to the functions that read it. It was found by
scanning `mov eax, <id>; call 0x412135`. It's the fastest way to locate a mechanic.

## Identified functions

| Address | Purpose |
|---|---|
| 0x412135 | `get_value(id)`: VALUELST.RES lookup |
| 0x41095a | game settings defaults (#14, 27, 30, 40, 46, 100, 120-125, 310) |
| 0x4214bc | player init: fuse #41, start speed #42, true colours #32 |
| 0x41f29b | **player per-frame update**: input, specials (kick/punch/pickup/trampoline/warp/cornerhead), diseases, bomb drop / grab / spooge, action button, death animation, drawing |
| 0x41ec84 | **movement**: steps one pixel at a time. Auto-centres perpendicular to travel when the way is open, slides round corners when off-centre and blocked. It also kicks bombs at the cell centre and triggers warps/trampolines one pixel before the centre |
| 0x41e61e | input read: with several directions held, keeps only those into open cells and takes the last |
| 0x41e5c3 | cell walkable? |
| 0x42665c / 0x4266a3 | pixel to cell x / y (`(x - originX) / cellW`) |
| 0x426599 / 0x4265eb | pixel offset from the cell centre |
| 0x42331c | **bomb update**: fuse (paused while flying or held, never for triggers), explosion rays (chain bombs, burn powerups, break bricks, stop at solids), punch arc via `sin` (#660 first hop, #661 bounces) |
| 0x42464b | kick: bomb motion 1, speed #300 |
| 0x4248c6 | punch/throw: bomb motion 2, speed #301 |
| 0x424af4 | pick up a bomb (motion 3, linked to the player) |
| 0x4247c5 | ACTION with kick: flag your sliding non-jelly bombs to stop |
| 0x424b41 | ACTION with trigger: detonate your **oldest** trigger bomb |
| 0x424a50 | ACTION with punch: punch the bomb in the facing cell |
| 0x421f7e | bomb landed on a head: lose #670 + rand(#671) powerups |
| 0x426d06 | flame/brick-burn animation update (#10, #20) |
| 0x426818 | **HURRY enclosement**: clockwise spiral from (0,0), one block per 250 ms, depth = 2 rings per setting step; kills players, removes powerups, detonates or destroys bombs (#46) |
| 0x426704 | regenerating bricks (haunted house #347, clear radius #695) |
| 0x425107 | powerup placement / hidden powerups (#102) |
| 0x422c13 / 0x422ede | random dud bombs (#320-#324) |
| 0x41d957 | find sequence by name (binary search) |
| 0x41daa7 / 0x41db41 | sequence state to frame number / per-state x,y offset |
| 0x41cd03 | .ANI SEQ/STAT/FRAM loader (5 shorts per sub-frame) |
| 0x40a1c6, 0x40ae8f, 0x40bb3f | AI (#915 blast-bricks chance, #920 powerup distance) |
| 0x401b5c | campaign ghosts/rovers (#1200, #1310, #1320) |
| 0x403382 / 0x40341f / 0x4034bc | Gold Bomberman roulette wheel (#1000-#1007) |

## Player struct (152 bytes, 10 of them at 0x461bc4)

| Offset | Field |
|---|---|
| +0 | alive |
| +4 | death animation number |
| +16 | input type (keyboard / joystick / AI / net) |
| +28 / +32 | x / y in pixels |
| +44 / +46 | facing / requested direction |
| +54 / +55 | previous bomb / action buttons |
| +56 / +57 | current bomb / action buttons |
| +78 / +80 | special animation and frame |
| +86 .. +96 | powerup counts, in .SCH `-P` order: bombs, flame, disease, kick, skate, punch, grab, spooge, goldflame, trigger, jelly |
| +112 | base speed |
| +116 | movement accumulator (1/100 px) |
| +120 / +124 / +128 | disease timer / duration / freshness |
| +132 .. +143 | disease flags, in SOUNDLST 3000-3550 order: molasses, crack, constipation, poops, short flame, crack poops, short fuze, swap, reversed, leprosy, invisible, duds |
| +148 | held bomb pointer |

Special animation values (+78):

* 1 kick
* 2 punch
* 3 stunned
* 4 pickup
* 5 trampoline
* 6 warp out
* 7 warp in
* 20-39 cornerhead
