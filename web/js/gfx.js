// Graphics: sprite atlases (from .ANI), colour remapping (the original .RMP idea), bitmap fonts (.FON),
// and background pictures (.PCX -> png).
'use strict';
(function (AB) {
  const S = window.AB_SPRITES;
  const gfx = AB.gfx = {};
  const atlases = {};        // ani -> {img, meta, canvases: {color: canvas}}
  const seqIndex = {};       // seq name -> {ani, states}
  const images = {};         // background name -> Image

  gfx.load = function (onProgress) {
    const names = Object.keys(S);
    let done = 0;
    const ps = names.map(n => new Promise((res) => {
      const img = new Image();
      img.onload = () => { done++; onProgress && onProgress(done / names.length); res(); };
      img.onerror = () => { console.warn('sprite load failed', n); done++; res(); };
      img.src = S[n].src;
      atlases[n] = { img, meta: S[n], canvases: {} };
      for (const sname in S[n].seqs) {
        if (!seqIndex[sname]) seqIndex[sname] = { ani: n, states: S[n].seqs[sname] };
      }
    }));
    return Promise.all(ps);
  };

  gfx.hasSeq = (name) => !!seqIndex[name];
  gfx.seq = (name) => seqIndex[name];
  gfx.seqLen = (name) => (seqIndex[name] ? seqIndex[name].states.length : 0);
  gfx.seqFrom = function (ani, name) {
    const a = atlases[ani];
    if (!a) return null;
    const st = a.meta.seqs[name];
    return st ? { ani, states: st } : null;
  };

  // Green -> player colour remap. The sprites are authored with a pure green suit; the original
  // remaps it per player (0.RMP..9.RMP, RGB from VALUELST 200-247). We keep the grey/white part of
  // each pixel and scale only the green chroma by the target colour.
  function remapCanvas(img, rgb) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    const R = rgb[0] / 100, G = rgb[1] / 100, B = rgb[2] / 100;
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const r = p[i], g = p[i + 1], b = p[i + 2];
      if (g > r && g > b) {
        const m = r > b ? r : b, k = g - m;
        p[i] = Math.min(255, m + k * R); p[i + 1] = Math.min(255, m + k * G); p[i + 2] = Math.min(255, m + k * B);
      }
    }
    x.putImageData(d, 0, 0);
    return c;
  }
  // a few non-player tints used by the port
  const SPECIAL = { gold: [100, 80, 0], ghost: [60, 60, 70] };

  // ---- "enhanced graphics": the .ANI images only carry an on/off colour key (no alpha channel; the
  // CIMG pixels are 15-bit RGB with the top bit never set). We derive soft edges at load time:
  //  glow   - fire sprites were rendered on black: luminance becomes alpha (smooth, translucent flames)
  //  soft   - silhouette pixels next to the key colour are matted against it and feathered (anti-aliasing)
  //  shadow - drop shadows become translucent
  let enhanced = true;
  gfx.setEnhanced = function (on) {
    if (on === enhanced) return;
    enhanced = on;
    for (const n in atlases) { atlases[n].canvases = {}; atlases[n].base = null; }
  };
  gfx.enhanced = () => enhanced;
  function enhance(img, meta) {
    const fx = meta.fx || 'none';
    if (fx === 'none') return img;
    const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
    const x = c.getContext('2d'); x.drawImage(img, 0, 0);
    const W = c.width, H = c.height;
    const d = x.getImageData(0, 0, W, H), p = d.data;
    if (fx === 'shadow') {
      for (let i = 3; i < p.length; i += 4) p[i] = p[i] ? 110 : 0;
    } else if (fx === 'glow') {
      for (let i = 0; i < p.length; i += 4) {
        if (!p[i + 3]) continue;
        const m = Math.max(p[i], p[i + 1], p[i + 2]);
        const a = Math.min(1, m / 150);
        if (a <= 0.02) { p[i + 3] = 0; continue; }
        p[i] = Math.min(255, p[i] / a); p[i + 1] = Math.min(255, p[i + 1] / a); p[i + 2] = Math.min(255, p[i + 2] / a);
        p[i + 3] = Math.round(255 * Math.pow(a, 0.85));
      }
    } else {
      const K = meta.key || [0, 0, 0];
      const A = new Uint8Array(W * H);
      for (let i = 0; i < W * H; i++) A[i] = p[i * 4 + 3] ? 1 : 0;
      for (let yy = 0; yy < H; yy++) for (let xx = 0; xx < W; xx++) {
        const i = yy * W + xx;
        if (!A[i]) continue;
        let open = 0, open4 = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = xx + dx, ny = yy + dy;
          const t = nx < 0 || ny < 0 || nx >= W || ny >= H || !A[ny * W + nx];
          if (t) { open++; if (!dx || !dy) open4++; }
        }
        if (!open) continue;
        const o = i * 4;
        const dist = Math.max(Math.abs(p[o] - K[0]), Math.abs(p[o + 1] - K[1]), Math.abs(p[o + 2] - K[2]));
        const ak = dist >= 96 ? 1 : Math.max(0.3, dist / 96);
        if (ak < 1) for (let ch = 0; ch < 3; ch++) p[o + ch] = AB.clamp(Math.round(K[ch] + (p[o + ch] - K[ch]) / ak), 0, 255);
        const f = open4 >= 3 ? 0.45 : open >= 5 ? 0.6 : open4 >= 1 ? 0.78 : 0.9;
        p[o + 3] = Math.round(255 * Math.min(ak, f));
      }
    }
    x.putImageData(d, 0, 0);
    return c;
  }
  function baseOf(a) {
    if (!enhanced) return a.img;
    if (!a.base) a.base = enhance(a.img, a.meta);
    return a.base;
  }

  function source(ani, color) {
    const a = atlases[ani];
    if (!a) return null;
    const base = baseOf(a);
    if (color === undefined || color === null || !a.meta.recolor) return base;
    if (typeof color === 'string') {
      if (!SPECIAL[color]) return base;
      if (!a.canvases[color]) a.canvases[color] = remapCanvas(base, SPECIAL[color]);
      return a.canvases[color];
    }
    if (color < 0 || !AB.PLAYER_RGB[color]) return base;
    if (!a.canvases[color]) a.canvases[color] = remapCanvas(base, AB.PLAYER_RGB[color]);
    return a.canvases[color];
  }
  gfx.prewarm = function (anis, color) { for (const n of anis) source(n, color); };

  // draw frame #f of ani with its hotspot at (x,y)
  gfx.frame = function (ctx, ani, f, x, y, color, flip) {
    const a = atlases[ani];
    if (!a) return;
    const fr = a.meta.frames[f];
    if (!fr) return;
    const src = source(ani, color);
    ctx.drawImage(src, fr[0], fr[1], fr[2], fr[3], Math.round(x - fr[4]), Math.round(y - fr[5]), fr[2], fr[3]);
  };
  gfx.frameSize = function (ani, f) {
    const fr = atlases[ani] && atlases[ani].meta.frames[f];
    return fr ? { w: fr[2], h: fr[3], hx: fr[4], hy: fr[5] } : null;
  };

  // draw state `i` of a sequence; offsets from the .ANI STAT/FRAM records are applied when useOff.
  // The frames themselves are already aligned (every frame of a file shares one canvas and hotspot), and
  // the small per-state offsets on top only make the body wobble a pixel or two: with them, the feet of
  // the death and idle animations drift 1-3 px from state to state, without them they stay put. So a
  // sequence is drawn with its usual offset (the most common one) for every state, which keeps it lined
  // up with the other sequences, and parts of a multi-part state keep their offsets relative to the first.
  // Only the bomberman animations are drawn this way: the flames' offsets are positional and stay.
  const baseOff = new WeakMap();
  function seqBase(states) {
    let b = baseOff.get(states);
    if (!b) {
      const n = {};
      let best = '0,0', bn = 0;
      for (const st of states) { if (!st.length) continue; const k = st[1] + ',' + st[2]; n[k] = (n[k] || 0) + 1; if (n[k] > bn) { bn = n[k]; best = k; } }
      b = best.split(',').map(Number);
      baseOff.set(states, b);
    }
    return b;
  }
  gfx.draw = function (ctx, seqName, i, x, y, color, useOff = true) {
    const s = typeof seqName === 'string' ? seqIndex[seqName] : seqName;
    if (!s || !s.states.length) return;
    const st = s.states[((i % s.states.length) + s.states.length) % s.states.length];
    if (!st.length) return;
    // useOff 'steady' (the bomberman animations): one offset for the whole sequence; true: per state
    const b = useOff === 'steady' ? seqBase(s.states) : [st[1], st[2]];
    for (let k = 0; k < st.length; k += 3) {
      const ox = useOff ? b[0] + st[k + 1] - st[1] : 0, oy = useOff ? b[1] + st[k + 2] - st[2] : 0;
      gfx.frame(ctx, s.ani, st[k], x + ox, y + oy, color);
    }
  };

  // ---- background pictures ----
  // A screen that draws a picture that hasn't arrived yet just shows nothing there, so the screens that
  // need one load it first (gfx.loadImage), and the ones likely to come next are fetched quietly in the
  // background, one at a time, at low priority (gfx.prefetch).
  const newImage = (name, priority, attempt) => {
    const im = new Image();
    if (priority && 'fetchPriority' in im) im.fetchPriority = priority;
    im.src = 'img/' + name + '.png' + (attempt ? '?retry=' + attempt : '');
    return im;
  };
  gfx.image = function (name, priority) {
    if (!images[name]) images[name] = newImage(name, priority, 0);
    return images[name];
  };
  gfx.isLoaded = (name) => { const im = images[name]; return !!(im && im.complete && im.naturalWidth); };
  // resolves true once the picture is in, false if it still failed after `retries` more tries
  gfx.loadImage = function (name, opts) {
    const priority = (opts && opts.priority) || 'auto', retries = opts && opts.retries !== undefined ? opts.retries : 2;
    return new Promise((res) => {
      let tries = 0;
      const watch = (im) => {
        if (im.complete) { if (im.naturalWidth) res(true); else failed(); return; }
        im.addEventListener('load', () => res(true), { once: true });
        im.addEventListener('error', failed, { once: true });
      };
      const failed = () => {
        if (tries >= retries) { console.warn('picture failed to load:', name); res(false); return; }
        tries++;
        setTimeout(() => { images[name] = newImage(name, priority, tries); watch(images[name]); }, 700 * tries);
      };
      watch(gfx.image(name, priority));
    });
  };
  gfx.preloadImages = (names, opts) => Promise.all(names.map(n => gfx.loadImage(n, opts)));
  const later = [];
  let prefetching = false;
  gfx.prefetch = function (names) {
    for (const n of names) if (!gfx.isLoaded(n) && !later.includes(n)) later.push(n);
    if (prefetching) return;
    prefetching = true;
    const next = () => {
      const n = later.shift();
      if (n === undefined) { prefetching = false; return; }
      if (gfx.isLoaded(n)) { next(); return; }
      gfx.loadImage(n, { priority: 'low', retries: 1 }).then(next);
    };
    next();
  };
  gfx.blit = function (ctx, name, x = 0, y = 0) {
    const im = gfx.image(name);
    if (im.complete && im.naturalWidth) ctx.drawImage(im, x, y);
  };

  // ---- title text in the style of the original's HURRY!! picture ----
  // The CD has no letters in that style (HURRY.ANI is one picture of the word), so arena names and the
  // round-start countdown are drawn with Anton, a free condensed font embedded in data/titlefont.js:
  // slanted, hollow, a yellow line between two thin black ones, like HURRY!!
  let titleFont = 'bold 40px Impact, "Arial Narrow", sans-serif';
  gfx.loadTitleFont = async function () {
    if (!window.AB_TITLEFONT || !window.FontFace) return;
    try {
      const bin = atob(window.AB_TITLEFONT), buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      const f = new FontFace('ABTitle', buf.buffer);
      await f.load(); document.fonts.add(f);
      titleFont = '40px ABTitle';
    } catch (e) { console.warn('title font:', e.message); }
  };
  // x: centre, y: baseline; size: cap height in px; maxW shrinks long text to fit
  gfx.titleText = function (ctx, text, x, y, size, maxW = 600, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = titleFont.replace('40px', size + 'px');
    let w = ctx.measureText(text).width;
    const sx = w > maxW ? maxW / w : 1;
    ctx.translate(x, y); ctx.transform(sx, 0, -0.22, 1, 0, 0);       // squeeze to fit, slant like HURRY!!
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillText(text, 0, 0);      // a little darkening inside, for legibility
    ctx.strokeStyle = '#000'; ctx.lineWidth = Math.max(4, size / 9); ctx.strokeText(text, 0, 0);
    ctx.strokeStyle = '#f8e030'; ctx.lineWidth = Math.max(2, size / 22); ctx.strokeText(text, 0, 0);
    ctx.restore();
  };

  // title text whose letters are `h` px tall from top to bottom (not the font size), centred on cx, cy:
  // so it grows and shrinks about its middle (the 3-2-1 countdown)
  const inkRatio = {};
  gfx.titleTextMid = function (ctx, text, cx, cy, h, alpha = 1, maxW = 2000) {
    if (!(text in inkRatio)) {
      ctx.save(); ctx.font = titleFont.replace('40px', '100px');
      const m = ctx.measureText(text);
      const ink = (m.actualBoundingBoxAscent || 0) + (m.actualBoundingBoxDescent || 0);
      ctx.restore();
      if (ink > 0) inkRatio[text] = { r: ink / 100, desc: (m.actualBoundingBoxDescent || 0) / 100 };
    }
    const k = inkRatio[text] || { r: 0.72, desc: 0 }, size = h / k.r;
    // baseline below the middle by half the letters' height (less what hangs below it); the slant
    // leans the top to the right, so shift left by half of that lean to keep the middle in place
    gfx.titleText(ctx, text, cx - 0.22 * h / 2, cy + h / 2 - k.desc * size, Math.round(size), maxW, alpha);
  };

  // ---- bitmap fonts (FONT0/1/6.FON) ----
  const F = window.AB_FONTS;
  const fontCache = {};
  function fontSheet(font, color) {
    const key = font + '|' + color;
    if (fontCache[key]) return fontCache[key];
    const fd = F[font];
    const codes = Object.keys(fd.g).map(Number);
    let W = 0; for (const c of codes) W += fd.g[c][0] + 1;
    const cv = document.createElement('canvas'); cv.width = Math.max(1, W); cv.height = fd.h;
    const x = cv.getContext('2d');
    const img = x.createImageData(cv.width, cv.height);
    const col = parseColor(color);
    const pos = {};
    let ox = 0;
    for (const c of codes) {
      const [w, rows] = fd.g[c];
      pos[c] = [ox, w];
      for (let yy = 0; yy < rows.length; yy++) {
        const r = rows[yy];
        for (let xx = 0; xx < w; xx++) {
          if (r & (1 << (w - 1 - xx))) {
            const o = (yy * cv.width + ox + xx) * 4;
            img.data[o] = col[0]; img.data[o + 1] = col[1]; img.data[o + 2] = col[2]; img.data[o + 3] = 255;
          }
        }
      }
      ox += w + 1;
    }
    x.putImageData(img, 0, 0);
    return (fontCache[key] = { cv, pos, h: fd.h });
  }
  function parseColor(c) {
    if (Array.isArray(c)) return c;
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
    if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
    const r = /rgb\((\d+),(\d+),(\d+)\)/.exec(c);
    if (r) return [+r[1], +r[2], +r[3]];
    return [255, 255, 255];
  }
  // FONT0 glyph widths are tight (no built-in spacing); FONT1/FONT6 include a blank column
  const SPACING = { font0: 1, font1: 0, font6: 0 };
  gfx.textWidth = function (text, font = 'font1') {
    const fd = F[font]; let w = 0; const sp = SPACING[font] || 0;
    for (const ch of String(text)) { const g = fd.g[ch.charCodeAt(0)]; w += (g ? g[0] : 6) + sp; }
    return w;
  };
  // align: 0 left, 1 center, 2 right. shadow draws a 1px dark drop shadow like the original menus.
  gfx.text = function (ctx, text, x, y, color = '#ffffff', font = 'font1', align = 0, shadow = true) {
    text = String(text);
    if (align) x -= (align === 1 ? gfx.textWidth(text, font) / 2 : gfx.textWidth(text, font));
    x = Math.round(x); y = Math.round(y);
    if (shadow) drawText(ctx, text, x + 1, y + 1, '#000000', font);
    drawText(ctx, text, x, y, color, font);
  };
  function drawText(ctx, text, x, y, color, font) {
    const sh = fontSheet(font, color); const sp = SPACING[font] || 0;
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      const p = sh.pos[c];
      if (!p) { x += 6 + sp; continue; }
      ctx.drawImage(sh.cv, p[0], 0, p[1], sh.h, x, y, p[1], sh.h);
      x += p[1] + sp;
    }
  }
  gfx.fontHeight = (font = 'font1') => F[font].h;
})(window.AB);
