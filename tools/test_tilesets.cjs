// Offline integration checks and previews for the Bedrock arena, using the real game renderer and a
// native Canvas. Requires @napi-rs/canvas (npm i @napi-rs/canvas, or NODE_PATH to a copy of it).
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { createCanvas, Image } = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web');
const output = path.join(root, 'output', 'tilesets');
// the renderer before the texture-set code (js/tilesets.js) existed: the original arenas must still
// draw exactly as they did then
const originalRendererCommit = 'c77e4b4e5a515795b067bc3355ad98beb2ed50f3';
const hash = canvas => crypto.createHash('sha256').update(canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data).digest('hex');
const source = file => fs.readFileSync(path.join(web, file), 'utf8');

async function environment(saved = {}) {
  let imageRequests = 0;
  const storage = new Map(Object.entries(saved));
  class LocalImage extends Image {
    constructor() {
      super();
      this.browserComplete = false;
      this.listeners = { load: [], error: [] };
      Object.defineProperty(this, 'complete', { get: () => this.browserComplete });
      for (const event of ['load', 'error']) {
        let handler;
        Object.defineProperty(this, 'on' + event, {
          set: fn => { handler = fn; },
          get: () => (...args) => {
            this.browserComplete = true;
            if (handler) handler(...args);
            for (const fn of this.listeners[event]) fn(...args);
          },
        });
      }
    }
    set src(value) {
      imageRequests++;
      if (value.startsWith('data:image/png;base64,')) super.src = Buffer.from(value.split(',')[1], 'base64');
      else super.src = fs.readFileSync(path.join(web, value.split('?')[0]));
    }
    addEventListener(event, fn) {
      this.listeners[event].push(fn);
    }
  }
  const c = {
    window: {}, console, Image: LocalImage, setTimeout, clearTimeout, structuredClone,
    document: { createElement: name => { assert.equal(name, 'canvas'); return createCanvas(1, 1); } },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v) },
  };
  vm.createContext(c);
  for (const file of ['data/gamedata.js', 'data/fonts.js', 'data/sprites.js', 'data/classic.js',
    'js/core.js', 'js/gfx.js', 'js/victory.js', 'js/tilesets.js', 'js/game.js', 'js/ai.js', 'js/render.js']) vm.runInContext(source(file), c, { filename: file });
  const A = c.window.AB;
  A.audio = { setVolumes() {}, play() {}, PRESET_LABEL: { extended: 'Extended' }, preset: () => 'extended', isCustom: () => false };
  A.input = { layouts: [], takePresses: () => [] };
  for (const file of ['js/screens.js', 'js/screens2.js']) vm.runInContext(source(file), c, { filename: file });
  await A.gfx.load();
  A.gfx.setEnhanced(false);
  return { c, A, storage, requests: () => imageRequests };
}
function game(A, level) {
  const settings = { ...A.defaultSettings(), randomStart: false };
  return new A.Game({ settings, level, scheme: globalThis.testScheme, seed: 1997,
    players: Array.from({ length: 10 }, (_, i) => ({ slot: i, color: i, team: i % 2, ai: false })), match: {} });
}
function picture(draw, g, tick = 0) {
  const canvas = createCanvas(640, 480), ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false; draw(ctx, g, tick);
  return canvas;
}
function save(name, canvas) { fs.writeFileSync(path.join(output, name), canvas.toBuffer('image/png')); }

(async () => {
  fs.mkdirSync(output, { recursive: true });
  // Native image decoding runs off-thread; keep the process alive until every check completes.
  const keepAlive = setInterval(() => {}, 1000);
  try {
    const env = await environment(), { A, c } = env, T = A.tilesets, BR = A.BEDROCK_LEVEL;
    globalThis.testScheme = c.window.AB_DATA.schemes.basic;
    assert.equal(A.levelName(BR), 'Bedrock');
    assert.equal(BR, A.LEVELS - 1, 'Bedrock is the last arena');
    assert.ok(A.arenaOn(A.settings, BR), 'Bedrock is in the random set by default');

    // Textures load only for Bedrock, once.
    const requests = env.requests();
    for (let level = 0; level < BR; level++) assert.equal(await T.load(level), true);
    assert.equal(env.requests(), requests, 'The original arenas must not download the Bedrock textures');
    const promise = T.load(BR);
    assert.strictEqual(promise, T.load(BR), 'Concurrent requests must share one download');
    assert.equal(await promise, true);
    assert.equal(env.requests(), requests + 1);
    assert.equal(T.status(BR), 'ready');
    assert.equal(T.field(BR).width, 640);
    assert.equal(T.field(BR).height, 480);
    assert.equal(T.breakFrames(BR), 9);
    const grass = T.field(BR).getContext('2d').getImageData(28, 72, 1, 1).data;
    assert.ok(grass[1] > grass[0] && grass[1] > grass[2] && grass[3] === 255, 'Floor must contain the opaque green texture');
    for (const kind of ['solid', 'brick']) {
      const sample = createCanvas(40, 36);
      T.draw(sample.getContext('2d'), BR, kind, 0, 20, 35);
      assert.equal(sample.getContext('2d').getImageData(20, 18, 1, 1).data[3], 255, 'Block texture must fill the cell');
    }

    // Every original arena draws pixel-for-pixel as before the texture-set code.
    const currentDraw = A.render.draw;
    const baseline = execFileSync('git', ['show', originalRendererCommit + ':web/js/render.js'], { cwd: root, encoding: 'utf8' });
    vm.runInContext(baseline, c, { filename: 'baseline-render.js' });
    const originalDraw = A.render.draw;
    A.render.draw = currentDraw;
    for (let level = 0; level < BR; level++) {
      await T.prepare(level);
      const g = game(A, level);
      for (const remaining of [0, 30, 18, 3]) {
        for (let i = 0; i < g.tiles.length; i++) if (g.tiles[i] === 2) { g.brickT[i] = remaining; break; }
        assert.equal(hash(picture(currentDraw, g)), hash(picture(originalDraw, g)), `Original arena ${level} changed at brick timer ${remaining}`);
      }
    }
    console.log(`PASS: all ${BR} original arenas match the previous renderer.`);

    // Bedrock plays like an ordinary arena, and drawing it never touches the simulation.
    {
      const a = game(A, BR), b = game(A, BR);
      for (let tick = 0; tick < 1200; tick++) {
        const inputs = Int32Array.from({ length: 10 }, (_, i) => (1 << ((Math.floor(tick / 30) + i) % 4)) | (tick % 53 === i ? A.IN.BOMB : 0));
        a.step(inputs); b.step(inputs);
        if (tick % 30 === 0) picture(currentDraw, b, tick);
        if (tick % 60 === 0) assert.equal(JSON.stringify(a.saveState()), JSON.stringify(b.saveState()), 'Drawing Bedrock changed the simulation');
      }
      assert.equal(a.checksum(), b.checksum());
    }
    console.log('PASS: Bedrock rounds run 1,200 ticks with identical state whether drawn or not.');

    // Last destruction frame must reveal the floor, without leaving opaque bits behind.
    const transparent = createCanvas(40, 36);
    T.draw(transparent.getContext('2d'), BR, 'breaking', 8, 20, 35);
    assert.ok(transparent.getContext('2d').getImageData(0, 0, 40, 36).data.every(v => v === 0));

    // The Arenas list offers Bedrock; ticking only it makes every round Bedrock.
    const S = A.screens;
    S.go('arenas', { back: 'options' });
    const rows = S.current().rows(), row = rows.findIndex(r => r.lvl === BR);
    assert.ok(row >= 0 && rows[row].label === 'Bedrock', 'Bedrock is a row of the Arenas list');
    A.settings.arenas = {}; for (let i = 0; i < A.LEVELS; i++) A.settings.arenas[i] = false;
    S.current().sel = row; S.current().key({ code: 'Enter' });
    assert.ok(A.arenaOn(A.settings, BR));
    for (let i = 0; i < 20; i++) assert.equal(A.pickArena(A.settings), BR);
    await A.gfx.preloadImages(['glue6', 'bombdude_a']);
    const menu = createCanvas(640, 480); S.render(menu.getContext('2d')); save('bedrock-arenas.png', menu);
    S.current().key({ code: 'Escape' }); assert.equal(S.name(), 'options');
    const options = createCanvas(640, 480); S.render(options.getContext('2d')); save('bedrock-match-options.png', options);
    console.log('PASS: Bedrock in the Arenas list, ticked on its own it is picked every round.');

    // A failed download leaves Bedrock playable on Green Acres' terrain, and the next round retries.
    const failed = await environment(), F = failed.A;
    const load = F.gfx.loadImage;
    F.gfx.loadImage = (name, options) => name.startsWith('tilesets/') ? Promise.resolve(false) : load(name, options);
    assert.equal(await F.tilesets.prepare(F.BEDROCK_LEVEL), true, 'The fallback terrain should finish loading');
    assert.equal(F.tilesets.status(F.BEDROCK_LEVEL), 'failed');
    assert.strictEqual(F.tilesets.field(F.BEDROCK_LEVEL), F.gfx.image('field0'));
    F.gfx.loadImage = load;
    assert.equal(await F.tilesets.prepare(F.BEDROCK_LEVEL), true);
    assert.equal(F.tilesets.status(F.BEDROCK_LEVEL), 'ready', 'The next round should retry the download');
    console.log('PASS: lazy loading, shared download, failure fallback and retry.');

    // These are actual game-renderer previews, generated entirely offline.
    save('bedrock-game.png', picture(currentDraw, game(A, BR)));
    save('original-game.png', picture(currentDraw, game(A, 0)));
    const strip = createCanvas(9 * 48, 48), sx = strip.getContext('2d');
    for (let i = 0; i < 9; i++) {
      sx.drawImage(T.field(BR), A.OX, A.OY, 40, 36, i * 48 + 4, 6, 40, 36);
      T.draw(sx, BR, 'breaking', i, i * 48 + 24, 41);
    }
    save('bedrock-destruction.png', strip);
    A.gfx.setEnhanced(true); save('bedrock-game-enhanced.png', picture(currentDraw, game(A, BR)));
    console.log('PASS: generated game, menu and destruction previews in output/tilesets/.');
  } finally { clearInterval(keepAlive); }
})().catch(e => { console.error(e); process.exitCode = 1; });
