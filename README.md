# Atomic Bomberman: HTML5 port

[![Play in your browser](https://img.shields.io/badge/%E2%96%B6%20Play-in%20your%20browser-f8d848?style=for-the-badge)](https://YOUR-USER.github.io/YOUR-REPO/web/)

A browser version of Interplay/Hudson Soft's *Atomic Bomberman* (1997). It is rebuilt from the
original CD: the graphics, sounds, music, arenas, schemes and tuning tables are the game's own,
and the game logic follows the decompiled executable. It runs in any current browser, from GitHub
Pages or straight from disk.

Besides the original game, the port adds:

* **Campaign Mode:** the original's hidden single-player campaign, with ghosts and rovers.
* **Sounds & Voices browser:** every recording on the CD, including about 1,050 the game never
  used, grouped by event and phrase.
* **Child-friendly and uncensored voice presets.**
* **Idle animations** that were cut from the original.
* **An extra 8-bit "Classic" arena.**
* **The CD's intro movie.**

## Play

* **Online:** use the button above.
* **Locally:** open `web/index.html` in Chrome, Edge or Firefox. No server is needed.

The first load downloads about 4 MB, and each round loads its sounds (about 4 MB). Both show a
progress bar.

## What's in the repository

```
web/          the game (see web/README.md for controls, options and how it works)
tools/        the scripts that convert the CD into web/ (see tools/README.md)
decompiled/   pseudo-C of BM95.EXE, used as the reference for the game logic
```

The CD image and the files extracted from it are not included. To rebuild `web/`, put your own
copy of the CD in this folder and follow `tools/README.md`.

## Credits

*Atomic Bomberman* is © 1997 Interplay Productions and Hudson Soft. Bomberman is a trademark of
Hudson Soft (now Konami). This is an unofficial fan project, and all game content belongs to its
owners.
