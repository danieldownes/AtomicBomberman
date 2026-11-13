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
  // each pixel and scale only the green chroma by the target colour. head (team play): the pixels
  // head.at(pixel index) picks out take head.rgb instead.
  function remapCanvas(img, rgb, head) {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d');
    x.drawImage(img, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    const body = rgb.map(v => v / 100), top = head && head.rgb.map(v => v / 100);
    for (let i = 0; i < p.length; i += 4) {
      if (!p[i + 3]) continue;
      const r = p[i], g = p[i + 1], b = p[i + 2];
      if (g > r && g > b) {
        const m = r > b ? r : b, k = g - m, t = top && head.at(i >> 2) ? top : body;
        p[i] = Math.min(255, m + k * t[0]); p[i + 1] = Math.min(255, m + k * t[1]); p[i + 2] = Math.min(255, m + k * t[2]);
      }
    }
    x.putImageData(d, 0, 0);
    return c;
  }
  // a few non-player tints used by the port
  const SPECIAL = { gold: [100, 80, 0], ghost: [60, 60, 70] };

  // ---- team play: the head in the player's colour, the rest in the team's ----
  // A colour can be a pair [head, body] of player colours. Which pixels of a bomberman are its head is
  // worked out from the original pixels a frame at a time, as each is first wanted (all of them when f
  // isn't given): per atlas pixel, 1 head, 2 the rest.
  const pairOf = (color) => Array.isArray(color) && AB.PLAYER_RGB[color[0]] && AB.PLAYER_RGB[color[1]] ? color : null;
  const heads = {};
  function headsOf(ani, f) {
    const a = atlases[ani], W = a.img.width, frames = a.meta.frames;
    const h = heads[ani] || (heads[ani] = { m: new Uint8Array(W * a.img.height), done: new Uint8Array(frames.length), c: null });
    for (let k = f === undefined ? 0 : f; k < (f === undefined ? frames.length : f + 1); k++) {
      if (h.done[k]) continue;
      const [fx, fy, w, ht] = frames[k];
      if (!h.c) h.c = document.createElement('canvas');
      h.c.width = w; h.c.height = ht;
      const x = h.c.getContext('2d'); x.drawImage(a.img, fx, fy, w, ht, 0, 0, w, ht);
      const s = headOf(x.getImageData(0, 0, w, ht).data, w, ht);
      for (let y = 0; y < ht; y++) for (let i = 0; i < w; i++) if (s[y * w + i]) h.m[(fy + y) * W + fx + i] = s[y * w + i];
      h.done[k] = 1;
    }
    return h.m;
  }
  // One frame (its pixels d, w by h): 1 head, 2 the rest, 0 neither. The helmet is the topmost big green
  // part, and the head the largest disc the figure holds within the helmet's rows and columns, with
  // everything below the helmet cut off (seen from behind, the head runs into the shoulders). Green in
  // the disc is head, but for a part of its own (a glove) that is mostly outside it; the ball on the
  // antenna is a small part above the disc. Pixels near the green (edges smoothed or redrawn in HD) go
  // with the nearest of it.
  function headOf(d, w, h) {
    const N = w * h, st = [];
    // the background: see-through pixels joined to the frame's edge (not a stray one inside the figure)
    const bg = new Uint8Array(N);
    const fill = (x, y) => { const i = y * w + x; if (!bg[i] && !d[i * 4 + 3]) { bg[i] = 1; st.push(i); } };
    for (let x = 0; x < w; x++) { fill(x, 0); fill(x, h - 1); }
    for (let y = 0; y < h; y++) { fill(0, y); fill(w - 1, y); }
    while (st.length) { const i = st.pop(), x = i % w, y = (i - x) / w; if (x > 0) fill(x - 1, y); if (x < w - 1) fill(x + 1, y); if (y > 0) fill(x, y - 1); if (y < h - 1) fill(x, y + 1); }
    // the clearly green parts, 8-connected
    const green = new Uint8Array(N), part = new Int32Array(N).fill(-1), parts = [];
    for (let i = 0; i < N; i++) { const o = i * 4; green[i] = d[o + 3] && d[o + 1] - Math.max(d[o], d[o + 2]) >= 24 ? 1 : 0; }
    for (let i = 0; i < N; i++) {
      if (!green[i] || part[i] >= 0) continue;
      const p = { px: [], x0: w, x1: -1, y0: h, y1: -1, sx: 0, sy: 0 };
      part[i] = parts.length; st.push(i);
      while (st.length) {
        const j = st.pop(), x = j % w, y = (j - x) / w;
        p.px.push(j); p.sx += x; p.sy += y;
        p.x0 = Math.min(p.x0, x); p.x1 = Math.max(p.x1, x); p.y0 = Math.min(p.y0, y); p.y1 = Math.max(p.y1, y);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, q = ny * w + nx;
          if (nx >= 0 && ny >= 0 && nx < w && ny < h && green[q] && part[q] < 0) { part[q] = parts.length; st.push(q); }
        }
      }
      parts.push(p);
    }
    const most = Math.max(0, ...parts.map(p => p.px.length));
    let helm = null;
    for (const p of parts) if (p.px.length >= Math.max(80, 0.4 * most) && (!helm || p.y0 < helm.y0 || (p.y0 === helm.y0 && p.px.length > helm.px.length))) helm = p;
    let cx = 0, cy = 0, R = 0;
    if (helm) {
      // distances to the background (or the frame's edge), with all below the helmet as background
      const D = new Float32Array(N), at = (x, y) => x < 0 || y < 0 || x >= w || y >= h ? 0 : D[y * w + x];
      for (let i = 0; i < N; i++) D[i] = bg[i] || i >= (helm.y1 + 1) * w ? 0 : 1e6;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (D[i]) D[i] = Math.min(D[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414); }
      for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) { const i = y * w + x; if (D[i]) D[i] = Math.min(D[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414); }
      // the disc's centre: within the helmet's span both across and down (inside the ring a helmet
      // seen from the front makes round the face)
      const rx0 = new Int16Array(h).fill(w), rx1 = new Int16Array(h).fill(-1), cy0 = new Int16Array(w).fill(h), cy1 = new Int16Array(w).fill(-1);
      for (const j of helm.px) { const x = j % w, y = (j - x) / w; rx0[y] = Math.min(rx0[y], x); rx1[y] = Math.max(rx1[y], x); cy0[x] = Math.min(cy0[x], y); cy1[x] = Math.max(cy1[x], y); }
      let best = 0;
      for (let y = helm.y0; y <= helm.y1; y++) for (let x = rx0[y]; x <= rx1[y]; x++) if (y >= cy0[x] && y <= cy1[x] && D[y * w + x] > best) { best = D[y * w + x]; cx = x; cy = y; }
      R = best + 1.5;
    }
    const inDisc = (j) => { const x = j % w, y = (j - x) / w; return (x - cx) * (x - cx) + (y - cy) * (y - cy) <= R * R; };
    // each part: 1 head, 2 the rest, 0 the helmet (pixel by pixel, in the disc or not)
    const side = parts.map(p => {
      if (!helm) return 2;
      if (p === helm) return 0;
      const n = p.px.length, inside = p.px.filter(inDisc).length, x = p.sx / n, y = p.sy / n;
      if (inside >= n / 2) return 1;
      return !inside && n <= 0.18 * Math.PI * R * R && y < cy - 0.4 * R && Math.hypot(x - cx, y - cy) < 1.9 * R ? 1 : 2;
    });
    const s = new Uint8Array(N), out = new Uint8Array(N);
    for (let i = 0; i < N; i++) if (part[i] >= 0) s[i] = side[part[i]] || (inDisc(i) ? 1 : 2);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let v = s[y * w + x];
      for (let r = 1; r <= 2 && !v; r++) for (let dy = -r; dy <= r && !v; dy++) for (let dx = -r; dx <= r && !v; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && part[ny * w + nx] >= 0) v = s[ny * w + nx];
      }
      out[y * w + x] = v;
    }
    return out;
  }
  const hdTints = new Map(); let hdTintBytes = 0;
  gfx.releaseHDTints = function () { hdTints.clear(); hdTintBytes = 0; };
  // HD atlases whose pixels can't be read (opened from disk without js/gfx.js readableSrc's scripts):
  // those animations are drawn from the original, recoloured sprites instead
  const hdUnreadable = new Set();
  // the HD cel recoloured for `color`; null: no recolouring needed; false: can't recolour it here
  const hdFrame = (ani, f, color, hd) => celFrame(ani, f, color, hd, AB.hd.scale(), 'hd');
  // frame f of ani cut from img (its atlas at scale s) and recoloured, cached cel by cel (`tag` tells
  // the atlases apart): the HD ones, and the original sprites in team colours
  function celFrame(ani, f, color, img, s, tag) {
    const a = atlases[ani], pair = pairOf(color), rgb = typeof color === 'string' ? SPECIAL[color] : AB.PLAYER_RGB[pair ? pair[1] : color];
    if (!a.meta.recolor || color === undefined || color === null || !rgb) return null;
    if (hdUnreadable.has(img)) return false;
    const key = ani + ':' + f + ':' + color + ':' + tag;
    if (hdTints.has(key)) { const v = hdTints.get(key); hdTints.delete(key); hdTints.set(key, v); return v.canvas; }
    const fr = a.meta.frames[f], c = document.createElement('canvas');
    c.width = fr[2] * s; c.height = fr[3] * s;
    c.getContext('2d').drawImage(img, fr[0] * s, fr[1] * s, c.width, c.height, 0, 0, c.width, c.height);
    // Cache only the cel being used. Tinting a complete HD death/idle atlas per player is costly.
    let canvas;
    try {
      // a pair: each pixel goes by the original pixel it was drawn from
      const m = pair && headsOf(ani, f), W = a.img.width, cw = c.width;
      const head = pair && { rgb: AB.PLAYER_RGB[pair[0]], at: (j) => { const X = j % cw, Y = (j - X) / cw; return m[(fr[1] + ((Y / s) | 0)) * W + fr[0] + ((X / s) | 0)] === 1; } };
      canvas = remapCanvas(c, rgb, head);
    }
    catch (e) { hdUnreadable.add(img); console.warn('HD ' + ani + ': can\'t recolour (' + e.name + '), using the original sprites'); return false; }
    const bytes = c.width * c.height * 4;
    hdTints.set(key, { canvas, bytes }); hdTintBytes += bytes;
    while (hdTintBytes > 64 * 1024 * 1024 && hdTints.size > 1) {
      const [key, v] = hdTints.entries().next().value;
      hdTints.delete(key); hdTintBytes -= v.bytes;
    }
    return canvas;
  }

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
  gfx.applyDisplay = function (canvas) {
    const settings = AB.settings || {}, scale = AB.hd && AB.hd.scale() || 1;
    gfx.setEnhanced(settings.enhancedGfx !== false);
    if (canvas.width !== AB.W * scale || canvas.height !== AB.H * scale) { canvas.width = AB.W * scale; canvas.height = AB.H * scale; }
    const ctx = canvas.getContext('2d'); ctx.setTransform(scale, 0, 0, scale, 0, 0); ctx.imageSmoothingEnabled = scale > 1;
    canvas.style.imageRendering = scale > 1 || settings.smoothScaling ? 'auto' : 'pixelated';
  };
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
    const pair = pairOf(color);
    if (pair) {
      if (!a.canvases[pair]) { const m = headsOf(ani); a.canvases[pair] = remapCanvas(base, AB.PLAYER_RGB[pair[1]], { rgb: AB.PLAYER_RGB[pair[0]], at: (j) => m[j] === 1 }); }
      return a.canvases[pair];
    }
    if (color < 0 || !AB.PLAYER_RGB[color]) return base;
    if (!a.canvases[color]) a.canvases[color] = remapCanvas(base, AB.PLAYER_RGB[color]);
    return a.canvases[color];
  }
  // the HD atlas to draw frame f of ani from (null: draw the original sprite)
  const hdCel = (ani, f) => { const hd = AB.hd && AB.hd.atlas(ani); return hd && !AB.hd.keepsOriginal(ani, f) ? hd : null; };
  // frame f of ani recoloured on its own: from the HD atlas, or in team colours from the original
  // (null: draw it from source())
  const celOf = (a, ani, f, color, hd) => hd ? hdFrame(ani, f, color, hd) : pairOf(color) ? celFrame(ani, f, color, baseOf(a), 1, enhanced ? 'enhanced' : 'plain') : null;
  // (with team colours, the heads of every frame: worked out now rather than mid-round)
  gfx.prewarm = function (anis, color) {
    for (const n of anis) {
      if (!atlases[n]) continue;
      if (pairOf(color)) { if (atlases[n].meta.recolor) headsOf(n); continue; }
      const hd = hdCel(n, 0); if ((hd ? hdFrame(n, 0, color, hd) : false) === false) source(n, color);
    }
  };

  // draw frame #f of ani with its hotspot at (x,y)
  gfx.frame = function (ctx, ani, f, x, y, color, flip) {
    const a = atlases[ani];
    if (!a) return;
    const fr = a.meta.frames[f];
    if (!fr) return;
    let hd = hdCel(ani, f);
    const tinted = celOf(a, ani, f, color, hd);
    if (tinted) { ctx.drawImage(tinted, Math.round(x - fr[4]), Math.round(y - fr[5]), fr[2], fr[3]); return; }
    if (tinted === false) hd = null;
    const src = hd || source(ani, color), s = hd ? AB.hd.scale() : 1;
    ctx.drawImage(src, fr[0] * s, fr[1] * s, fr[2] * s, fr[3] * s, Math.round(x - fr[4]), Math.round(y - fr[5]), fr[2], fr[3]);
  };
  // frame #f of ani, `scale` times its size, centred on (cx, cy), smoothly scaled (the main menu's bomb)
  gfx.frameScaled = function (ctx, ani, f, cx, cy, scale = 1, color) {
    const a = atlases[ani], fr = a && a.meta.frames[f];
    if (!fr) return;
    let hd = hdCel(ani, f);
    const tinted = hd && hdFrame(ani, f, color, hd), w = fr[2] * scale, h = fr[3] * scale;
    if (tinted === false) hd = null;
    ctx.save();
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    if (tinted) ctx.drawImage(tinted, cx - w / 2, cy - h / 2, w, h);
    else {
      const src = hd || source(ani, color), s = hd ? AB.hd.scale() : 1;
      ctx.drawImage(src, fr[0] * s, fr[1] * s, fr[2] * s, fr[3] * s, cx - w / 2, cy - h / 2, w, h);
    }
    ctx.restore();
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
  gfx.retroImage = function (name, priority) {
    if (!images[name]) images[name] = newImage(name, priority, 0);
    return images[name];
  };
  gfx.image = function (name, priority) {
    if (AB.hd && AB.hd.active()) {
      const im = AB.hd.image(name);
      if (im) return im;
      AB.hd.requestImage(name);
    }
    return gfx.retroImage(name, priority);
  };
  gfx.isLoaded = (name) => { const im = images[name]; return !!(im && im.complete && im.naturalWidth); };

  // ---- pictures whose pixels the game reads (recolouring) ----
  // Opened from disk (file://), Chrome treats every picture file as coming from another site: it can be
  // drawn, but its pixels can't be read back. So those pictures also come as scripts holding the picture
  // as a data: URL (tools/build_pixel_scripts.cjs): <picture without extension>.js calls
  // AB_PIXELS(<picture path>, <data: URL>). readableSrc(path) resolves to a URL whose pixels can be read:
  // over http the path itself, from disk that data: URL (or the path, if the script is missing).
  const fromDisk = typeof location !== 'undefined' && location.protocol === 'file:', readable = new Map();
  window.AB_PIXELS = function (src, url) { const r = readable.get(src); if (r) r(url); };
  gfx.readableSrc = function (path) {
    const [src, query = ''] = path.split('?');
    if (!fromDisk) return Promise.resolve(path);
    return new Promise((resolve) => {
      const done = (url) => { if (readable.get(src) === done) readable.delete(src); script.remove(); resolve(url); };
      readable.set(src, done);
      const script = document.createElement('script');
      script.src = src.replace(/\.[a-z]+$/i, '.js') + (query && '?' + query);
      script.onload = () => { if (readable.get(src) === done) { console.warn('no pixel data in', script.src); done(path); } };
      script.onerror = () => { console.warn('pixel script missing:', script.src); done(path); };
      document.head.appendChild(script);
    });
  };
  // a picture whose pixels can be read, loaded (rejects if it fails)
  gfx.readableImage = (path) => gfx.readableSrc(path).then(url => new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('picture failed to load: ' + path));
    im.src = url;
  }));
  // resolves true once the picture is in, false if it still failed after `retries` more tries
  gfx.loadRetroImage = function (name, opts) {
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
      watch(gfx.retroImage(name, priority));
    });
  };
  gfx.loadImage = function (name, opts) {
    const retro = gfx.loadRetroImage(name, opts);
    return AB.hd && AB.hd.active() ? Promise.all([retro, AB.hd.loadImage(name)]).then(([ok, hd]) => ok || hd) : retro;
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
    if (im.complete && im.naturalWidth) ctx.drawImage(im, x, y, im.width, im.height);
  };

  // Amarante's narrow, angular serifs echo the original gold menu lettering. A real outline font
  // keeps counters, baselines and spacing intact at both resolutions; labels remain ordinary text.
  function fontBytes(encoded) {
    const bin = atob(encoded), buf = new Uint8Array(bin.length);
    for (let i=0;i<bin.length;i++) buf[i]=bin.charCodeAt(i);
    return buf.buffer;
  }
  gfx.loadMenuFont = async function () {
    if (!window.FontFace) return;
    try { const face = new FontFace('ABMenuClean', window.AB_MENUFONT ? fontBytes(window.AB_MENUFONT) : 'url(data/menu-amarante.ttf)'); await face.load(); document.fonts.add(face); }
    catch (e) { console.warn('Menu font:', e.message); }
  };
  // ---- HD's text: Chakra Petch (SIL OFL, data/uifont.js, built by tools/build_ui_fonts.py) ----
  // A real outline font instead of the bitmap fonts' letters scaled up; its cut corners echo theirs.
  // Each bitmap font maps to a weight, size and slight squeeze that keep a line about as tall and as
  // wide as before: font0 (small) with its lowercase as tall as the original's, font1/font6 with
  // their capitals as tall. Text sits on the original baseline (13 px below the top) and, while HD is
  // on, is measured in this font too (gfx.textWidth), so centring and fitting stay exact.
  const HD_FONT = { font0: { w: 600, px: 14, sx: 0.93 }, font1: { w: 700, px: 17, sx: 1 }, font6: { w: 700, px: 17, sx: 1 } };
  let hdFontsReady = false, hdFontsLoading = null;
  gfx.loadHDFonts = function () {
    if (hdFontsReady || !window.FontFace) return Promise.resolve();
    if (hdFontsLoading) return hdFontsLoading;
    hdFontsLoading = (async () => {
      if (!window.AB_UIFONT) await new Promise((resolve, reject) => {
        const v = (window.AB_VERSION || {}).commit || '', s = document.createElement('script');
        s.src = 'data/uifont.js' + (/^[0-9a-f]{7,40}$/.test(v) ? '?v=' + v : '');
        s.onload = resolve; s.onerror = () => reject(new Error('HD font could not be loaded'));
        document.body.appendChild(s);
      });
      const faces = await Promise.all(Object.entries(window.AB_UIFONT).map(async ([w, b64]) => {
        const face = new FontFace('ABUI', fontBytes(b64), { weight: w }); await face.load(); return face;
      }));
      faces.forEach(face => document.fonts.add(face)); hdFontsReady = true;
    })().finally(() => { hdFontsLoading = null; });
    return hdFontsLoading;
  };
  const hdText = () => hdFontsReady && AB.hd && AB.hd.active();
  const hdFont = (font) => HD_FONT[font] || HD_FONT.font1;
  let measure = null; const hdWidths = new Map();
  function hdWidth(text, font) {
    const key = font + '\n' + text; let w = hdWidths.get(key);
    if (w === undefined) {
      if (!measure) measure = document.createElement('canvas').getContext('2d');
      const f = hdFont(font); measure.font = f.w + ' ' + f.px + 'px ABUI';
      w = measure.measureText(text).width * f.sx;
      if (hdWidths.size > 4000) hdWidths.clear();
      hdWidths.set(key, w);
    }
    return w;
  }
  gfx.menuText = function (ctx, text, x, y, maxW = 268, selected = false) {
    ctx.save(); ctx.font = '32px ABMenuClean, serif'; ctx.textBaseline = 'alphabetic';
    const width = ctx.measureText(text).width, scale = Math.min(1, maxW / Math.max(1, width));
    ctx.translate(x, y + 27); ctx.scale(scale, 1);
    ctx.lineJoin = 'round'; ctx.lineWidth = 1.4; ctx.strokeStyle = '#151008'; ctx.strokeText(text, 0, 0);
    const gold = ctx.createLinearGradient(0, -26, 0, 1);
    gold.addColorStop(0, selected ? '#fffcc0' : '#fff779'); gold.addColorStop(0.5, '#ffeb14'); gold.addColorStop(1, '#c38c08');
    ctx.fillStyle = gold; ctx.fillText(text, 0, 0); ctx.restore();
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
    if (hdText()) return hdWidth(String(text), font);
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
    if (hdText()) {
      const f = hdFont(font);
      ctx.save(); ctx.font = f.w + ' ' + f.px + 'px ABUI'; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'; ctx.fillStyle = color;
      ctx.translate(x, y + 13); if (f.sx !== 1) ctx.scale(f.sx, 1);
      ctx.fillText(text, 0, 0); ctx.restore(); return;
    }
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
