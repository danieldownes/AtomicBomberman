// Export the generated green Bomberman master to browser and home-screen icon sizes.
// Run from the repository root with sharp and @napi-rs/canvas available to Node.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const root = path.resolve(__dirname, '..');
const icons = path.join(root, 'web', 'img', 'icons');
const output = path.join(root, 'output', 'favicon');
const master = path.join(output, 'green-bomberman-master.png');

(async () => {
  fs.mkdirSync(icons, { recursive: true });
  const metadata = await sharp(master).metadata();
  assert.ok(metadata.hasAlpha, 'The source must retain its transparent background');
  const names = new Map([
    [16, 'green-favicon-16.png'], [32, 'green-favicon-32.png'], [48, 'green-favicon-48.png'],
    [180, 'green-apple-touch-icon.png'], [192, 'green-icon-192.png'], [512, 'green-icon-512.png'],
  ]);
  const pngs = new Map();
  for (const [size, name] of names) {
    const png = await sharp(master).resize(size, size, { fit: 'contain', background: '#00000000', kernel: 'lanczos3' }).png().toBuffer();
    const result = await sharp(png).metadata();
    assert.equal(result.width, size); assert.equal(result.height, size); assert.ok(result.hasAlpha);
    fs.writeFileSync(path.join(icons, name), png);
    pngs.set(size, png);
  }
  // Modern ICO containers can store PNG frames directly, retaining the generated alpha.
  const sizes = [16, 32, 48], header = Buffer.alloc(6 + sizes.length * 16);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, i) => {
    const p = 6 + i * 16, png = pngs.get(size);
    header[p] = size; header[p + 1] = size;
    header.writeUInt16LE(1, p + 4); header.writeUInt16LE(32, p + 6);
    header.writeUInt32LE(png.length, p + 8); header.writeUInt32LE(offset, p + 12);
    offset += png.length;
  });
  const ico = Buffer.concat([header, ...sizes.map(s => pngs.get(s))]);
  fs.writeFileSync(path.join(root, 'web', 'favicon-green.ico'), ico);
  for (let i = 0; i < sizes.length; i++) {
    const p = 6 + i * 16, start = ico.readUInt32LE(p + 12), count = ico.readUInt32LE(p + 8);
    const frame = await sharp(ico.subarray(start, start + count)).metadata();
    assert.equal(frame.width, sizes[i]); assert.equal(frame.height, sizes[i]);
  }

  // Show the exported images at their actual tab sizes against light and dark browser chrome.
  const preview = createCanvas(600, 256), ctx = preview.getContext('2d');
  ctx.fillStyle = '#f0f2f4'; ctx.fillRect(0, 0, 600, 128);
  ctx.fillStyle = '#16203a'; ctx.fillRect(0, 128, 600, 128);
  for (let row = 0; row < 2; row++) {
    const cy = row * 128;
    ctx.fillStyle = row ? '#eef2f8' : '#253043'; ctx.font = '16px sans-serif';
    ctx.fillText(row ? 'Dark tabs' : 'Light tabs', 22, cy + 28);
    for (const [col, size] of sizes.entries()) {
      const x = 210 + col * 130;
      ctx.drawImage(await loadImage(pngs.get(size)), x - size / 2, cy + 64 - size / 2);
      ctx.font = '13px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(size + ' px', x, cy + 108); ctx.textAlign = 'left';
    }
  }
  fs.writeFileSync(path.join(output, 'favicon-preview.png'), preview.toBuffer('image/png'));
  console.log('Exported transparent 16/32/48 px favicons, 180/192/512 px home-screen icons and a three-size ICO.');
})().catch(e => { console.error(e); process.exitCode = 1; });
