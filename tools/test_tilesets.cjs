// Offline integration checks and previews using the real game renderer and a native Canvas.
// Requires @napi-rs/canvas (available in the Codex workspace dependency bundle).
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
    'js/core.js', 'js/gfx.js', 'js/tilesets.js', 'js/game.js', 'js/ai.js', 'js/render.js']) vm.runInContext(source(file), c, { filename: file });
  const A = c.window.AB;
  A.audio = { setVolumes() {}, play() {}, PRESET_LABEL: { extended: 'Extended' }, preset: () => 'extended', isCustom: () => false };
  A.input = { layouts: [], takePresses: () => [] };
  for (const file of ['js/screens.js', 'js/screens2.js']) vm.runInContext(source(file), c, { filename: file });
  await A.gfx.load();
  A.gfx.setEnhanced(false);
  return { c, A, storage, requests: () => imageRequests };
}
function game(A, level, tileset = 'original') {
  const settings = { ...A.defaultSettings(), tileset, randomStart: false };
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
    const env = await environment(), { A, c, storage } = env, T = A.tilesets;
    globalThis.testScheme = c.window.AB_DATA.schemes.basic;
    assert.equal(T.id(), 'original');
    assert.equal(T.id('missing-pack'), 'original');
    T.override = 'bedrock';
    assert.equal(T.id(), 'bedrock');
    A.saveSettings();
    assert.equal(JSON.parse(storage.get('ab_settings')).tileset, 'original', 'Art review URL overrides must not be saved');
    delete T.override;
    const requests = env.requests();
    await T.load();
    assert.equal(env.requests(), requests, 'Original must not download optional textures');
    const promise = T.load('bedrock');
    assert.strictEqual(promise, T.load('bedrock'), 'Concurrent requests must share one download');
    assert.equal(await promise, true);
    assert.equal(env.requests(), requests + 1);
    assert.equal(T.status('bedrock'), 'ready');
    assert.equal(T.field(0, 'bedrock').width, 640);
    assert.equal(T.field(0, 'bedrock').height, 480);
    assert.equal(T.breakFrames(0, 'bedrock'), 9);
    const grass = T.field(0, 'bedrock').getContext('2d').getImageData(28, 72, 1, 1).data;
    assert.ok(grass[1] > grass[0] && grass[1] > grass[2] && grass[3] === 255, 'Floor must contain the opaque green texture');
    for (const kind of ['solid', 'brick']) {
      const sample = createCanvas(40, 36);
      T.draw(sample.getContext('2d'), 0, kind, 0, 20, 35, 'bedrock');
      assert.equal(sample.getContext('2d').getImageData(20, 18, 1, 1).data[3], 255, 'Block texture must fill the cell');
    }

    // Compare every original arena pixel-for-pixel with the renderer before this change.
    const currentDraw = A.render.draw;
    const baseline = execFileSync('git', ['show', originalRendererCommit + ':web/js/render.js'], { cwd: root, encoding: 'utf8' });
    vm.runInContext(baseline, c, { filename: 'baseline-render.js' });
    const originalDraw = A.render.draw;
    A.render.draw = currentDraw;
    for (let level = 0; level < A.LEVELS; level++) {
      await T.prepare(level, 'original');
      const g = game(A, level);
      A.settings.tileset = 'original';
      for (const remaining of [0, 30, 18, 3]) {
        for (let i = 0; i < g.tiles.length; i++) if (g.tiles[i] === 2) { g.brickT[i] = remaining; break; }
        assert.equal(hash(picture(currentDraw, g)), hash(picture(originalDraw, g)), `Original arena ${level} changed at brick timer ${remaining}`);
      }
      // Draw both cosmetics repeatedly during the same seeded simulation and compare full state.
      const a = game(A, level), b = game(A, level, 'bedrock');
      for (let tick = 0; tick < 360; tick++) {
        const inputs = Int32Array.from({ length: 10 }, (_, i) => (1 << ((Math.floor(tick / 30) + i) % 4)) | (tick % 53 === i ? A.IN.BOMB : 0));
        a.step(inputs); b.step(inputs);
        if (tick % 60 === 0) {
          A.settings.tileset = 'original'; picture(currentDraw, a, tick);
          A.settings.tileset = 'bedrock'; picture(currentDraw, b, tick);
          assert.equal(JSON.stringify(a.saveState()), JSON.stringify(b.saveState()), `Tileset changed simulation state in arena ${level}`);
        }
        assert.equal(a.checksum(), b.checksum());
      }
    }
    console.log('PASS: all 12 Original arenas match the previous renderer; both tilesets produce identical state over 4,320 ticks.');

    // Last destruction frame must reveal the floor, without leaving opaque bits behind.
    const transparent = createCanvas(40, 36);
    T.draw(transparent.getContext('2d'), 0, 'breaking', 8, 20, 35, 'bedrock');
    assert.ok(transparent.getContext('2d').getImageData(0, 0, 40, 36).data.every(v => v === 0));

    // Selecting and previewing are distinct; returning from the picker preserves its caller.
    const S = A.screens;
    A.settings.tileset = 'original';
    S.go('options');
    S.current().items().find(it => it.label === 'Tileset').action();
    S.current().key({ code: 'ArrowDown' });
    assert.equal(T.id(), 'original', 'Browsing a preview must not select it');
    S.current().key({ code: 'Enter' });
    assert.equal(T.id(), 'bedrock');
    assert.equal(JSON.parse(storage.get('ab_settings')).tileset, 'bedrock');
    await A.gfx.preloadImages(['glue6', 'bombdude_a']);
    const menu = createCanvas(640, 480); S.render(menu.getContext('2d')); save('bedrock-selector.png', menu);
    S.current().key({ code: 'Escape' }); assert.equal(S.name(), 'options');
    const options = createCanvas(640, 480); S.render(options.getContext('2d')); save('bedrock-match-options.png', options);
    S.go('settings');
    const settings = createCanvas(640, 480); S.render(settings.getContext('2d')); save('bedrock-settings.png', settings);
    S.go('arenas', { back: 'netsetup' }); S.current().key({ code: 'KeyT' });
    S.current().key({ code: 'Escape' }); assert.equal(S.name(), 'arenas'); assert.equal(S.current().back, 'netsetup');
    const reloaded = await environment({ ab_settings: storage.get('ab_settings') });
    assert.equal(reloaded.A.tilesets.id(), 'bedrock', 'Saved choice must survive reload');

    // A failed optional image must leave all original terrain available, with an explicit status.
    const failed = await environment(), F = failed.A;
    const load = F.gfx.loadImage;
    F.gfx.loadImage = (name, options) => name.startsWith('tilesets/') ? Promise.resolve(false) : load(name, options);
    F.settings.tileset = 'bedrock';
    assert.equal(await F.tilesets.prepare(0), true, 'Original fallback should finish loading');
    assert.equal(F.tilesets.status(), 'failed');
    assert.strictEqual(F.tilesets.field(0), F.gfx.image('field0'));
    F.gfx.loadImage = load;
    assert.equal(await F.tilesets.select('bedrock'), true, 'Selecting again should recover a failed download');
    assert.equal(F.tilesets.status(), 'ready');
    console.log('PASS: lazy loading, shared downloads, selection, persistence, menu return path, failure fallback and retry.');

    // These are actual game-renderer previews, generated entirely offline.
    const g = game(A, 0);
    A.settings.tileset = 'bedrock'; save('bedrock-game.png', picture(currentDraw, g));
    A.settings.tileset = 'original'; save('original-game.png', picture(currentDraw, g));
    A.settings.tileset = 'bedrock';
    const strip = createCanvas(9 * 48, 48), sx = strip.getContext('2d');
    for (let i = 0; i < 9; i++) {
      sx.drawImage(T.field(0), A.OX, A.OY, 40, 36, i * 48 + 4, 6, 40, 36);
      T.draw(sx, 0, 'breaking', i, i * 48 + 24, 41);
    }
    save('bedrock-destruction.png', strip);
    A.gfx.setEnhanced(true); save('bedrock-game-enhanced.png', picture(currentDraw, g));
    console.log('PASS: generated game, selector and destruction previews in output/tilesets/.');
  } finally { clearInterval(keepAlive); }
})().catch(e => { console.error(e); process.exitCode = 1; });
