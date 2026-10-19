// Pictures whose pixels the game reads (to recolour them), also packaged as scripts for file://.
//
// Opened from disk (file://), Chrome treats every picture file as coming from another site: the game
// can draw it, but can't read its pixels back, and recolouring a bomberman needs them. A data: URL
// picture has no such restriction, and a script tag works from disk, so each of these pictures also
// comes as <picture without extension>.js, calling AB_PIXELS(<picture path>, <data: URL>).
// js/gfx.js (gfx.readableSrc) loads those only when the page is opened from disk; over http the game
// uses the picture files themselves.
//
// Which pictures: every HD atlas that is recoloured per player (AB_SPRITES[name].recolor), the HD
// victory scene and its tint mask, and the original-resolution victory scene and mask. js/hd.js picks
// the same HD pictures (readable()). Run after `node tools/build_hd.cjs manifest` (it runs this itself)
// or `node tools/build_victory.cjs`:
//   node tools/build_pixel_scripts.cjs
'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..'), web = path.join(root, 'web');
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
const HD_IMAGES = ['victory-base', 'victory-tint-mask'];
const RETRO = ['img/victory-base.png', 'img/victory-mask.png'];

function load(file) {
  const c = { window: {} }; vm.createContext(c);
  vm.runInContext(fs.readFileSync(path.join(web, file), 'utf8'), c, { filename: file });
  return c.window;
}
function wrap(src) {
  const file = path.join(web, src), ext = path.extname(src).toLowerCase();
  const url = 'data:' + MIME[ext] + ';base64,' + fs.readFileSync(file).toString('base64');
  const out = file.slice(0, -ext.length) + '.js';
  fs.writeFileSync(out, 'AB_PIXELS(' + JSON.stringify(src) + ',' + JSON.stringify(url) + ');\n');
  return fs.statSync(out).size;
}
function build() {
  const list = RETRO.filter(src => fs.existsSync(path.join(web, src)));
  if (fs.existsSync(path.join(web, 'hd/manifest.js'))) {
    const sprites = load('data/sprites.js').AB_SPRITES, m = load('hd/manifest.js').AB_HD_MANIFEST;
    for (const [name, a] of Object.entries(m.atlases)) if (sprites[name] && sprites[name].recolor) list.push(a.src);
    for (const name of HD_IMAGES) if (m.images[name]) list.push(m.images[name].src);
  }
  let bytes = 0;
  for (const src of list) bytes += wrap(src);
  console.log('pixel scripts: ' + list.length + ' pictures, ' + (bytes / 1048576).toFixed(1) + ' MiB');
}
module.exports = { build };
if (require.main === module) build();
