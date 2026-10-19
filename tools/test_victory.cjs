// Integration checks and offline previews for independently coloured victory screens.
// Requires @napi-rs/canvas; no browser or server is needed.
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createCanvas, Image } = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web'), out = path.join(root, 'output', 'victory');

function environment() {
  const requests = [];
  class LocalImage extends Image {
    constructor() {
      super(); this.done = false; this.listeners = { load: [], error: [] };
      Object.defineProperty(this, 'complete', { get: () => this.done });
      for (const event of ['load', 'error']) {
        let callback;
        Object.defineProperty(this, 'on' + event, {
          set: fn => { callback = fn; },
          get: () => (...args) => { this.done = true; if (callback) callback(...args); for (const fn of this.listeners[event]) fn(...args); },
        });
      }
    }
    set src(value) { requests.push(value); super.src = fs.readFileSync(path.join(web, value.split('?')[0])); }
    addEventListener(event, fn) { this.listeners[event].push(fn); }
  }
  const context = {
    window: { AB_SPRITES: {} }, console, Image: LocalImage, setTimeout, clearTimeout,
    document: { createElement: tag => { assert.equal(tag, 'canvas'); return createCanvas(1, 1); } },
    localStorage: { getItem: () => null, setItem() {} },
  };
  vm.createContext(context);
  for (const file of ['data/gamedata.js', 'data/fonts.js', 'js/core.js', 'js/gfx.js', 'js/victory.js']) vm.runInContext(fs.readFileSync(path.join(web, file), 'utf8'), context, { filename: file });
  const A = context.window.AB;
  A.audio = { setVolumes() {}, music() {}, playRange() {} };
  A.input = { layouts: [] };
  vm.runInContext(fs.readFileSync(path.join(web, 'js/screens.js'), 'utf8'), context, { filename: 'screens.js' });
  vm.runInContext(fs.readFileSync(path.join(web, 'js/screens2.js'), 'utf8'), context, { filename: 'screens2.js' });
  return { A, requests };
}
const data = canvas => canvas.getContext('2d').getImageData(0, 0, 640, 480).data;
const scoreMatch = () => ({
  players: [{ slot: 0, color: 4 }, { slot: 1, color: 2 }, { slot: 2, color: 8 }, { slot: 3, color: 6 }],
  wins: { 0: 4, 1: 2, 2: 2, 3: 1 }, kills: { 0: 5, 1: 3, 2: 7, 3: 10 },
});

(async () => {
  const keepAlive = setInterval(() => {}, 1000);
  try {
    fs.mkdirSync(out, { recursive: true });
    const { A, requests } = environment(), V = A.victory;
    assert.equal(requests.length, 0, 'Victory art must stay lazy at boot');
    const promise = V.load(); assert.strictEqual(V.load(), promise); assert.equal(await promise, true);
    assert.equal(requests.length, 2, 'One base and one mask must replace all variant downloads');
    const m = scoreMatch(), winner = { p: m.players[0] }, settings = { teamPlay: false, winByKills: false };
    let selected = V.contestants(m, winner, settings);
    assert.equal(selected.runnerUp.slot, 2, 'Wins tie must use kills'); assert.equal(selected.loserColor, 8);
    selected = V.contestants(m, winner, { ...settings, winByKills: true });
    assert.equal(selected.runnerUp.slot, 3, 'Kill mode must rank by kills');
    m.S = { winByKills: true };
    assert.equal(V.contestants(m, winner).runnerUp.slot, 3, 'Host match settings must override local scoring preferences');
    delete m.S;
    m.kills[1] = m.kills[2];
    assert.equal(V.contestants(m, winner, settings).runnerUp.slot, 1, 'Exact ties must use slot order');
    const reversed = { ...m, players: m.players.slice().reverse() };
    assert.equal(V.contestants(reversed, winner, settings).runnerUp.slot, 1, 'Client list order must not affect ties');
    m.kills[1] = 12; m.kills[2] = 12; m.wins[1] = 1; m.wins[2] = 2;
    assert.equal(V.contestants(m, winner, { ...settings, winByKills: true }).runnerUp.slot, 2, 'Kill ties must use wins');
    const solo = { ...m, players: [m.players[0]] };
    assert.equal(V.contestants(solo, winner, settings).runnerUp, null);
    assert.equal(V.contestants(solo, winner, settings).loserColor, 3);
    const teams = { ...m, players: m.players.map((p, i) => ({ ...p, team: i % 2 })) };
    for (const team of [0, 1]) {
      const result = V.contestants(teams, { team, p: teams.players[team] }, { ...settings, teamPlay: true });
      assert.equal(result.winnerColor, team ? 2 : 0); assert.equal(result.loserColor, team ? 0 : 2);
      assert.notEqual(result.runnerUp.team, team);
    }
    console.log('PASS: runner-up ranking, both scoring modes, deterministic ties, teams and single-player fallback.');

    const masterCanvas = createCanvas(640, 480), maskCanvas = createCanvas(640, 480);
    masterCanvas.getContext('2d').drawImage(A.gfx.image('victory-base'), 0, 0);
    maskCanvas.getContext('2d').drawImage(A.gfx.image('victory-mask'), 0, 0);
    const master = data(masterCanvas), mask = data(maskCanvas);
    for (const [x, y] of [[251, 236], [260, 247], [225, 170], [446, 303]]) {
      const p = (y * 640 + x) * 4;
      assert.equal(mask[p], 0, 'Monitor/visor must not receive the winner tint');
      assert.equal(mask[p + 1], 0, 'Monitor/visor must not receive the loser tint');
    }
    assert.deepEqual(data(V.image(4, 3)), master, 'Original green/blue pair must reproduce the master exactly');
    const cached = V.image(4, 2); assert.strictEqual(V.image(4, 2), cached);
    const colorA = data(V.image(4, 2)), colorB = data(V.image(4, 3)), colorC = data(V.image(9, 3));
    let winnerChanged = 0, loserChanged = 0;
    for (let i = 0; i < mask.length; i += 4) {
      assert.ok(!(mask[i] && mask[i + 1]), 'Winner and loser masks must not overlap');
      for (let c = 0; c < 3; c++) {
        if (!mask[i + 1]) assert.equal(colorA[i + c], colorB[i + c], 'Loser tint changed another part of the scene');
        if (!mask[i]) assert.equal(colorC[i + c], colorB[i + c], 'Winner tint changed another part of the scene');
      }
      if (colorA[i] !== colorB[i] || colorA[i + 2] !== colorB[i + 2]) loserChanged++;
      if (colorC[i] !== colorB[i] || colorC[i + 1] !== colorB[i + 1]) winnerChanged++;
    }
    assert.ok(winnerChanged > 8000 && loserChanged > 5000);
    for (let winner = 0; winner < 10; winner++) for (let loser = 0; loser < 10; loser++) {
      const image = data(V.image(winner, loser));
      for (let i = 0; i < image.length; i += 4) {
        assert.equal(image[i + 3], 255);
        if (!mask[i] && !mask[i + 1]) for (let c = 0; c < 3; c++) assert.equal(image[i + c], master[i + c], 'Unmasked artwork changed');
      }
    }
    assert.notStrictEqual(V.image(4, 2), cached, 'The bounded cache must evict old pairs');
    assert.equal(requests.length, 2, 'Rendering colour combinations must not load extra artwork');
    console.log('PASS: all 100 colour pairs preserve unmasked art; character tints are independent and cached.');

    const combinations = [[4, 2], [3, 8], [9, 6], [0, 1], [5, 7], [1, 0]];
    const gallery = createCanvas(1280, 1032), gx = gallery.getContext('2d');
    for (const [n, [winnerColor, loserColor]] of combinations.entries()) {
      const win = { slot: 0, color: winnerColor }, runner = { slot: 1, color: loserColor };
      A.match = { players: [win, runner, { slot: 2, color: 5 }], wins: { 0: 3, 1: 2, 2: 1 }, kills: { 0: 4, 1: 3, 2: 7 }, S: { ...A.defaultSettings(), teamPlay: false }, net: false };
      A.screens.go('victory', { p: win, v: 3 });
      assert.equal(A.screens.current().colors.loserColor, loserColor, 'Victory screen did not select the runner-up');
      const frame = createCanvas(640, 480); A.screens.render(frame.getContext('2d'));
      const label = A.COLOR_NAMES[winnerColor].toLowerCase() + '-vs-' + A.COLOR_NAMES[loserColor].toLowerCase();
      fs.writeFileSync(path.join(out, label + '.png'), frame.toBuffer('image/png'));
      if (n < 4) {
        const x = (n % 2) * 640, y = Math.floor(n / 2) * 516;
        gx.fillStyle = '#111827'; gx.fillRect(x, y, 640, 36);
        gx.fillStyle = '#eef2f8'; gx.font = '18px sans-serif';
        gx.fillText('Winner: ' + A.COLOR_NAMES[winnerColor] + '  /  Runner-up: ' + A.COLOR_NAMES[loserColor], x + 16, y + 25);
        gx.drawImage(frame, x, y + 36);
      }
    }
    fs.writeFileSync(path.join(out, 'colour-combinations.png'), gallery.toBuffer('image/png'));
    A.match = { players: [{ slot: 0, color: 6, ai: false }, { slot: 1, color: 8, ai: true }], wins: { 0: 1 }, kills: { 1: 2 } };
    A.screens.go('campdone');
    assert.equal(A.screens.current().colors.winnerColor, 6);
    assert.equal(A.screens.current().colors.loserColor, 8);
    A.screens.render(createCanvas(640, 480).getContext('2d'));
    // A failed mask still shows the scene, and an explicit new screen entry can retry.
    const failed = environment(), load = failed.A.gfx.loadRetroImage;
    failed.A.gfx.loadRetroImage = async name => name !== 'victory-mask';
    assert.equal(await failed.A.victory.load(), false);
    failed.A.gfx.loadRetroImage = load;
    assert.equal(await failed.A.victory.load(true), true);
    console.log('PASS: actual victory-screen integration, failure recovery and six preview combinations.');
  } finally { clearInterval(keepAlive); }
})().catch(e => { console.error(e); process.exitCode = 1; });
