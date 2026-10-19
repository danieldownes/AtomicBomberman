// Extract independent suit-colour masks from the original pre-rendered victory images.
// Requires sharp. Source art is archived outside web/ so only one scene ships with the game.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web');
const source = path.join(root, 'output', 'victory', 'source');
const names = [...Array.from({ length: 10 }, (_, i) => 'victory' + i), 'team0', 'team1'];

(async () => {
  fs.mkdirSync(source, { recursive: true });
  const images = {};
  for (const name of names) {
    const file = path.join(source, name + '.png');
    if (!fs.existsSync(file)) fs.copyFileSync(path.join(web, 'img', name + '.png'), file);
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 640); assert.equal(info.height, 480); assert.equal(info.channels, 3);
    images[name] = data;
  }
  const context = { window: {} }; vm.createContext(context);
  for (const file of ['data/gamedata.js', 'js/core.js']) vm.runInContext(fs.readFileSync(path.join(web, file), 'utf8'), context);
  const colors = context.window.AB.PLAYER_RGB.map(rgb => rgb.map(v => v / 100));
  const means = [0, 1, 2].map(c => colors.reduce((s, rgb) => s + rgb[c], 0) / colors.length);
  const centered = colors.map(rgb => rgb.map((v, c) => v - means[c]));
  const denominator = centered.reduce((sum, rgb) => sum + rgb.reduce((s, v) => s + v * v, 0), 0);
  const base = images.victory4, mask = Buffer.alloc(640 * 480 * 3);
  // The helmet's antialiased outline has lower cross-palette correlation. Constrain its
  // remaining green material to the original silhouette, excluding the grass behind it.
  const helmet = [[238, 97], [208, 107], [193, 122], [180, 147], [176, 185], [178, 217], [189, 236], [224, 245], [280, 239], [299, 224], [302, 184], [293, 140], [279, 115], [263, 103]];
  const monitor = [[238, 229], [277, 225], [279, 253], [249, 260]];
  function insidePolygon(polygon, x, y) {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[i], b = polygon[j];
      if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
    }
    return inside;
  }
  let winnerPixels = 0, loserPixels = 0;
  for (let y = 0; y < 480; y++) for (let x = 0; x < 640; x++) {
    const p = (y * 640 + x) * 3;
    // The right suit has an exact reference pair: VICTORY2 and TEAM1 differ only in its pixels.
    const loser = [0, 1, 2].some(c => images.victory2[p + c] !== images.team1[p + c]);
    if (loser) {
      assert.ok(x >= 336 && x <= 527 && y >= 236 && y <= 368, 'Loser reference changed outside its original silhouette');
      mask[p + 1] = Math.max(0, base[p + 2] - Math.max(base[p], base[p + 1]));
      if (mask[p + 1]) loserPixels++;
    }
    if (x < 150 || x > 356 || y < 65 || y > 430) continue;
    const chroma = Math.max(0, base[p + 1] - Math.max(base[p], base[p + 2]));
    if (!chroma || insidePolygon(monitor, x, y)) continue;
    // Palette quantisation changes the background between the ten original images. Fit the
    // known player palette to each pixel, selecting only material which follows the suit colour.
    const average = [0, 1, 2].map(c => colors.reduce((s, _, n) => s + images['victory' + n][p + c], 0) / colors.length);
    let numerator = 0, variance = 0;
    for (let n = 0; n < colors.length; n++) for (let c = 0; c < 3; c++) {
      const delta = images['victory' + n][p + c] - average[c];
      numerator += centered[n][c] * delta;
      variance += delta * delta;
    }
    const strength = numerator / denominator;
    let error = 0;
    for (let n = 0; n < colors.length; n++) for (let c = 0; c < 3; c++) {
      const delta = images['victory' + n][p + c] - average[c] - strength * centered[n][c];
      error += delta * delta;
    }
    const confidence = variance ? 1 - error / variance : 0;
    if ((strength >= 4 && confidence >= 0.55) || (chroma >= 8 && insidePolygon(helmet, x, y))) { mask[p] = chroma; winnerPixels++; }
  }
  assert.ok(winnerPixels > 8000 && winnerPixels < 40000, 'Unexpected winner mask coverage');
  assert.ok(loserPixels > 5000 && loserPixels < 15000, 'Unexpected loser mask coverage');
  // Group masked pixels by the master's original palette colours. The ten winner palettes
  // come directly from the shipped variants, preserving white/black brightness and highlights.
  // The right suit has white/red/blue references; derive the other colours from its white shading.
  const winnerClasses = [], loserClasses = [], winnerIndex = new Map(), loserIndex = new Map();
  function material(classes, index, p, winner) {
    const key = base[p] * 65536 + base[p + 1] * 256 + base[p + 2];
    if (!index.has(key)) { index.set(key, classes.length); classes.push({ rgb: [...base.subarray(p, p + 3)], count: 0, sums: Array.from({ length: winner ? 10 : 2 }, () => [0, 0, 0]) }); }
    const n = index.get(key), m = classes[n]; m.count++;
    for (let t = 0; t < m.sums.length; t++) for (let c = 0; c < 3; c++) m.sums[t][c] += images[winner ? 'victory' + t : t ? 'team1' : 'team0'][p + c];
    return n + 1;
  }
  for (let p = 0; p < mask.length; p += 3) {
    assert.ok(!(mask[p] && mask[p + 1]), 'Colour masks overlap');
    if (mask[p]) mask[p] = material(winnerClasses, winnerIndex, p, true);
    if (mask[p + 1]) mask[p + 1] = material(loserClasses, loserIndex, p, false);
  }
  assert.ok(winnerClasses.length < 256 && loserClasses.length < 256, 'Material indices do not fit in the mask');
  // One combined PNG: R/G material indices in the first 480 rows; ten RGB palette rows below.
  // Each palette row has winner entries at x=0..255 and loser entries at x=256..511.
  const packed = Buffer.alloc(640 * (480 + colors.length) * 3); mask.copy(packed);
  for (let color = 0; color < colors.length; color++) {
    winnerClasses.forEach((m, n) => {
      for (let c = 0; c < 3; c++) packed[((480 + color) * 640 + n) * 3 + c] = Math.round(m.sums[color][c] / m.count);
    });
    loserClasses.forEach((m, n) => {
      const red = m.sums[0].map(v => v / m.count), white = m.sums[1].map(v => v / m.count);
      for (let c = 0; c < 3; c++) {
        const neutral = Math.min(m.rgb[c], red[c], white[c]);
        const v = color === 3 ? m.rgb[c] : color === 2 ? red[c] : color === 0 ? white[c] : color === 1 ? white[c] * colors[color][c] : neutral + (white[c] - neutral) * colors[color][c];
        packed[((480 + color) * 640 + 256 + n) * 3 + c] = Math.round(v);
      }
    });
  }
  fs.copyFileSync(path.join(source, 'victory4.png'), path.join(web, 'img', 'victory-base.png'));
  await sharp(packed, { raw: { width: 640, height: 480 + colors.length, channels: 3 } }).png().toFile(path.join(web, 'img', 'victory-mask.png'));
  const preview = Buffer.alloc(mask.length);
  for (let p = 0; p < mask.length; p += 3) {
    preview[p] = mask[p] ? 32 : mask[p + 1] ? 255 : base[p] / 5;
    preview[p + 1] = mask[p] ? 255 : mask[p + 1] ? 64 : base[p + 1] / 5;
    preview[p + 2] = mask[p] ? 96 : mask[p + 1] ? 64 : base[p + 2] / 5;
  }
  await sharp(preview, { raw: { width: 640, height: 480, channels: 3 } }).png().toFile(path.join(root, 'output', 'victory', 'mask-preview.png'));
  console.log(JSON.stringify({ winnerPixels, loserPixels, winnerMaterials: winnerClasses.length, loserMaterials: loserClasses.length, baseBytes: fs.statSync(path.join(web, 'img', 'victory-base.png')).size, maskBytes: fs.statSync(path.join(web, 'img', 'victory-mask.png')).size }));
  require('./build_pixel_scripts.cjs').build();      // the same pictures as scripts, for file://
})().catch(e => { console.error(e); process.exitCode = 1; });
