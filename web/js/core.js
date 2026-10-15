// Atomic Bomberman HTML5 port - core constants & utilities
// All gameplay numbers come from the original VALUELST.RES (window.AB_DATA.values) wherever possible.
'use strict';
window.AB = window.AB || {};
(function (AB) {
  const D = window.AB_DATA;

  // ---- screen / arena geometry (from the original executable: arena origin, cell size) ----
  AB.W = 640; AB.H = 480;
  AB.COLS = 15; AB.ROWS = 11;
  AB.CW = 40; AB.CH = 36;           // cell size in pixels
  AB.OX = 20; AB.OY = 64;           // arena origin on the 640x480 screen
  AB.MAXP = 10;                     // max players

  // ---- timing ----
  // The original measures everything in "reference frames" at 20 fps (VALUELST #25/#30) and
  // speeds in 1/100 pixel per reference frame. The port simulates at a fixed 60 Hz, i.e. 3 ticks
  // per reference frame, which keeps the simulation deterministic for lockstep network play.
  AB.TPS = 60;
  AB.TPR = 3;                       // ticks per reference frame
  AB.SUB = 300;                     // movement accumulator units per pixel (1/100 px * 3 ticks)

  // direction tables, same order as the original (0=N,1=E,2=S,3=W)
  AB.DX = [0, 1, 0, -1];
  AB.DY = [-1, 0, 1, 0];
  AB.DIRNAME = ['north', 'east', 'south', 'west'];
  AB.NONE = -1;

  // input bits
  AB.IN = { UP: 1, DOWN: 2, LEFT: 4, RIGHT: 8, BOMB: 16, ACTION: 32 };

  // ---- original tuning values ----
  AB.val = function (id, def) {
    const v = D.values[id];
    return v === undefined ? def : v;
  };
  AB.msg = function (id, def) {
    const v = D.messages[id];
    return v === undefined ? (def || '') : v;
  };

  // ---- deterministic PRNG (mulberry32); used by the simulation only ----
  AB.Rng = class {
    constructor(seed) { this.s = seed >>> 0; }
    next() {
      let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0);
    }
    int(n) { return n <= 0 ? 0 : this.next() % n; }        // 0..n-1
    chance(n) { return n <= 1 ? true : this.int(n) === 0; } // 1-in-N, like the original
    pick(a) { return a[this.int(a.length)]; }
    shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = this.int(i + 1); const t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  };
  // cosmetic randomness (sound variations etc.) - never used by the simulation
  AB.crand = (n) => Math.floor(Math.random() * n);

  AB.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  AB.cellCenterX = (cx) => AB.OX + cx * AB.CW + (AB.CW >> 1);
  AB.cellCenterY = (cy) => AB.OY + cy * AB.CH + (AB.CH >> 1);
  // cell & offset-from-center for a pixel position (mirrors fcn.0042665c / fcn.00426599)
  AB.cellX = (x) => Math.floor((x - AB.OX) / AB.CW);
  AB.cellY = (y) => Math.floor((y - AB.OY) / AB.CH);
  AB.offX = (x) => ((((x - AB.OX) % AB.CW) + AB.CW) % AB.CW) - (AB.CW >> 1);
  AB.offY = (y) => ((((y - AB.OY) % AB.CH) + AB.CH) % AB.CH) - (AB.CH >> 1);
  AB.inArena = (cx, cy) => cx >= 0 && cy >= 0 && cx < AB.COLS && cy < AB.ROWS;
  AB.wrapX = (cx) => ((cx % AB.COLS) + AB.COLS) % AB.COLS;
  AB.wrapY = (cy) => ((cy % AB.ROWS) + AB.ROWS) % AB.ROWS;

  // ---- player colours: VALUELST 200..247 (RGB percentages for 0.RMP .. 9.RMP) ----
  AB.PLAYER_RGB = [];
  for (let i = 0; i < 10; i++) {
    AB.PLAYER_RGB.push([AB.val(200 + i * 5, 100), AB.val(201 + i * 5, 100), AB.val(202 + i * 5, 100)]);
  }
  AB.PLAYER_CSS = AB.PLAYER_RGB.map(c => `rgb(${Math.round(c[0] * 2.55)},${Math.round(c[1] * 2.55)},${Math.round(c[2] * 2.55)})`);
  AB.COLOR_NAMES = ['White', 'Black', 'Red', 'Blue', 'Green', 'Yellow', 'Cyan', 'Magenta', 'Orange', 'Purple'];

  // ---- powerups (order = .SCH "-P" table and VALUELST 400-412 / 550-564) ----
  AB.PW = { BOMB: 0, FLAME: 1, DISEASE: 2, KICK: 3, SKATE: 4, PUNCH: 5, GRAB: 6, SPOOGE: 7, GOLDFLAME: 8,
            TRIGGER: 9, JELLY: 10, BADDISEASE: 11, RANDOM: 12, CLOG: 13 };
  AB.PW_SEQ = ['power bomb', 'power flame', 'power disease', 'power kicker', 'power skate', 'power punch',
               'power grab', 'power spooge', 'power goldflame', 'power trigger', 'power jelly', 'power disease3',
               'power random', 'power clog'];
  AB.PW_COUNT = 13;

  // ---- diseases (DISEASE.H order, matches SOUNDLST 3000..3550 and the player struct bytes 132..143) ----
  AB.DIS = { MOLASSES: 0, CRACK: 1, CONSTIPATION: 2, POOPS: 3, SHORTFLAME: 4, CRACKPOOPS: 5, SHORTFUZE: 6,
             SWAP: 7, REVERSED: 8, LEPROSY: 9, INVISIBLE: 10, DUDS: 11 };
  AB.DIS_COUNT = 12;
  AB.DIS_NAMES = ['Molasses', 'Crack', 'Constipation', 'Poops', 'Short Flame', 'Crack Poops', 'Short Fuze',
                  'Swap', 'Reversed Controls', 'Leprosy', 'Invisible', 'Duds'];

  // ---- levels (MESSAGES.TXT 150..160) ----
  // the port adds a 12th arena, "Classic", after the original eleven (8-bit theme, js/render.js)
  AB.CLASSIC_LEVEL = AB.val(35, 11);
  AB.LEVELS = AB.CLASSIC_LEVEL + 1;
  AB.levelName = (n) => (n === AB.CLASSIC_LEVEL ? 'Classic (8-bit)' : AB.msg(150 + n, 'Level ' + n));
  AB.LEVEL_MUSIC = ['grnacres', 'generic', 'hockey', 'pyramid', 'mineshft', 'battle', 'gieger', 'haunted', 'ocean', 'swamp', 'sewer', 'classic'];
  // tracks that can be ticked for gameplay (Options > Gameplay Music); the menu/title themes are
  // off by default, the short jingles (win/lose/draw/network) are not offered
  AB.MUSIC_TRACKS = AB.LEVEL_MUSIC.map((t, i) => ({ id: t, name: AB.levelName(i), on: true }))
    .concat([{ id: 'title', name: 'Title Theme', on: false }, { id: 'menu', name: 'Menu Theme', on: false }]);
  AB.trackOn = (S, id) => {
    const m = S.gameMusic || {};
    if (id in m) return !!m[id];
    const t = AB.MUSIC_TRACKS.find(t => t.id === id); return !!(t && t.on);
  };
  // music for a round: the level's own track if it is ticked (or shuffle among the ticked ones)
  let lastTrack = null;
  AB.gameTrack = function (S, level) {
    const on = AB.MUSIC_TRACKS.filter(t => AB.trackOn(S, t.id)).map(t => t.id);
    if (!on.length) return null;
    const own = AB.LEVEL_MUSIC[level] || 'generic';
    if (S.musicOrder !== 'shuffle' && on.includes(own)) return (lastTrack = own);
    const pool = on.length > 1 ? on.filter(t => t !== lastTrack) : on;
    return (lastTrack = pool[Math.floor(Math.random() * pool.length)]);
  };

  // ---- settings (defaults from VALUELST, like fcn.0041095a) ----
  AB.defaultSettings = function () {
    return {
      teamPlay: false,
      randomStart: !!AB.val(40, 1),
      conveyorSpeed: 1,                     // 0 low, 1 medium, 2 high
      stompedDetonate: !!AB.val(46, 1),
      winByKills: false,
      goldBomberman: false,
      enclosement: AB.val(27, 1),           // 0 none .. 3 all the way
      scheme: 'basic',
      arenas: {},                           // arena index -> ticked; each round picks one of the ticked arenas
      campaignProgress: {},                 // campaign file -> stages cleared
      playTime: AB.val(100, 150),           // seconds, 0 = infinite
      assignKeyboard: !!AB.val(14, 1),
      diseasesDestroyable: !!AB.val(120, 1),
      lostNetToAI: true,
      gameMusic: {},                        // track id -> ticked (missing = default from AB.MUSIC_TRACKS)
      musicOrder: 'level',                  // level = each level's own track, shuffle = any ticked track
      winsNeeded: AB.val(310, 2),
      enhancedGfx: true,                    // soft sprite edges / glowing flames (port addition)
      idleAnims: true,                      // play the unused idle animations when a player stands still
      playIntro: true,                      // the intro movie from the CD (INTRO/BMINTRO.EXE) on start
      smoothScaling: false,                 // bilinear screen scaling instead of sharp pixels
      voices: 'extended',                   // sound preset: child | original | extended | uncensored | off
      soundOverrides: {},                   // "eventLo:clip" -> 1/0, the player's own ticks on top of the preset
      soundVariety: 'normal',               // how many phrases per event each round: few | normal | lots | all
      musicVolume: 0.7,
      sfxVolume: 0.9,
    };
  };
  AB.PLAY_TIMES = [60, 90, 120, 150, 180, 240, 300, 600, 0];
  // arenas a round may use: the original picks randomly among those with VALUELST #1150+n = 1 (it leaves
  // out the Hockey Rink and Aliens); the Arenas menu lets the player tick any set, including those two
  AB.arenaDefault = (i) => (i === AB.CLASSIC_LEVEL ? true : !!AB.val(1150 + i, 1));
  AB.arenaOn = (S, i) => { const a = S.arenas || {}; return i in a ? !!a[i] : AB.arenaDefault(i); };
  AB.pickArena = function (S) {
    const ok = []; for (let i = 0; i < AB.LEVELS; i++) if (AB.arenaOn(S, i)) ok.push(i);
    if (!ok.length) for (let i = 0; i < AB.LEVELS; i++) ok.push(i);
    return ok[Math.floor(Math.random() * ok.length)];
  };
  // idle animations found on the CD but never loaded by the original (ZEN/HEADWIPE/APPLBITE/NUCKBLOW.ANI):
  // the port plays one after a player has stood still for IDLE_AFTER seconds. len = states at 20 fps.
  AB.IDLE_ANIMS = [{ ani: 'zen', seq: 'Unnamed', len: 121 }, { ani: 'headwipe', seq: 'Unnamed', len: 211 },
                   { ani: 'applbite', seq: 'Unnamed', len: 121 }, { ani: 'nuckblow', seq: 'unnamed', len: 121 }];
  AB.IDLE_AFTER = 5;
})(window.AB);
