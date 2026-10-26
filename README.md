# Atomic Bomberman: HTML5 port

[![Play in your browser](https://img.shields.io/badge/%E2%96%B6%20Play-in%20your%20browser-f8d848?style=for-the-badge)](https://danieldownes.github.io/AtomicBomberman/)

A browser version of Interplay/Hudson Soft's *Atomic Bomberman* (1997). It is rebuilt from the
original CD: the graphics, sounds, music, arenas, schemes and tuning tables are the game's own,
and the game logic follows the decompiled executable. It runs in any current browser, from GitHub
Pages or straight from disk.

Other sites host emulated versions of the game. This hobby project is a full reimplementation and
iteration of the beloved classic: new code, written from the decompiled original, that plays like
it and builds on it.

Besides the original game, the port adds:

* **Network play in the browser:** a lobby with three rooms showing who is in each and their
  pings. Up to five computers and ten players, peer to peer over WebRTC, with no server to run.
* **Campaign Mode:** the original's hidden single-player campaign, with ghosts and rovers.
* **Sounds & Voices browser:** every recording on the CD, including about 1,050 the game never
  used, grouped by event and phrase.
* **Child-friendly and uncensored voice presets.**
* **Idle animations** that were cut from the original.
* **An extra 8-bit "Classic" arena.**
* **An extra "Bedrock" arena** with new terrain graphics: bedrock walls, grass and breakable dirt.
* **A Dangerous computer player** that sees the board as it will burn, never lays a bomb it can't get
  away from, corners people (with a second bomb on the run), and kicks bombs at them, timed so they
  get no warning.
* **The CD's intro movie.**

## Play

* **Online:** use the button above.
* **Locally:** open `web/index.html` in Chrome, Edge or Firefox. No server is needed.

The first load downloads about 4 MB, and each round loads its sounds (about 4 MB). Both show a
progress bar.

## Versions

The main menu shows the version in its top left corner, for example **V1.1.24**, with the commit
hash and date beside it.
The network lobby shows it too.

* `1.1` is set by hand in `web/index.html` (`window.AB_VERSION.base`; it was 1.0 until October 2026).
* The last number is the build: the number of commits on main, so it goes up with every commit.
* The build number, commit hash and date are filled in by `.github/workflows/pages.yml` when it
  deploys the site. A copy run from disk shows "dev build".
* Network play needs the same game code on every computer, so only computers on the same commit can
  share a room. A dev copy is exempt.

To turn on the workflow: on GitHub go to Settings > Pages > Build and deployment, and set
**Source** to **GitHub Actions**. Every push to main then deploys automatically.

## What's in the repository

```
web/          the game (see web/README.md for controls, options and how it works)
.github/      pages.yml: deploys web/ to GitHub Pages with the version stamped in
cloudflare/   an optional Cloudflare Worker that gives network players a relay (see cloudflare/README.md)
tools/        the scripts that convert the CD into web/ (see tools/README.md)
decompiled/   pseudo-C of BM95.EXE, used as the reference for the game logic
```

The CD image and the files extracted from it are not included. To rebuild `web/`, put your own
copy of the CD in this folder and follow `tools/README.md`.

## Credits

*Atomic Bomberman* is © 1997 Interplay Productions and Hudson Soft. Bomberman is a trademark of
Hudson Soft (now Konami). This is an unofficial fan project, and all game content belongs to its
owners.
