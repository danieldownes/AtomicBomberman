// Terrain graphics for arenas the port adds on top of the original's: the Bedrock arena draws its
// floor, border, walls, bricks and crumble from one generated texture sheet (img/tilesets/bedrock/).
// The arena's rules are those of an ordinary arena; only the pictures differ.
'use strict';
(function (AB) {
  const G = AB.gfx, T = AB.tilesets = {};
  const { W, H, CW, CH, OX, OY, COLS, ROWS } = AB;
  const packs = {}, pending = {}, failed = new Set();
  const definitions = [
    { id: 'bedrock', level: () => AB.BEDROCK_LEVEL, image: 'tilesets/bedrock/textures', build: buildBedrock },
  ];
  // the texture set an arena uses (null: the arena's own .ANI terrain)
  const defFor = (level) => definitions.find(d => d.level() === level) || null;
  const packKey = d => d.id + (AB.hd && AB.hd.active() ? ':hd' : '');
  // the original arena whose pictures stand in if a set can't be loaded (Bedrock: Green Acres)
  T.baseLevel = (level) => (defFor(level) ? 0 : level);
  T.status = (level) => { const d = defFor(level), k = d && packKey(d); return !d || packs[k] ? 'ready' : failed.has(k) ? 'failed' : pending[k] ? 'loading' : 'idle'; };

  // texture sets load only when an arena needs them; a failed one falls back to the base arena's art
  T.load = function (level, onProgress, retry = false) {
    const d = defFor(level);
    const hd = AB.hd && AB.hd.active(), ready = hd ? AB.hd.prepareArena(level, onProgress, retry) : Promise.resolve(true);
    if (!d) return ready;
    const key = packKey(d);
    if (packs[key]) return ready;
    if (pending[key]) return pending[key];
    if (failed.has(key)) return Promise.resolve(false);
    pending[key] = ready.then(() => G.loadImage(d.image, { priority: 'high', retries: 1 })).then(ok => {
      if (!ok) throw new Error('Texture image unavailable');
      if (hd && !AB.hd.image(d.image)) throw new Error('HD texture image unavailable');
      const image = hd && AB.hd.image(d.image) || G.retroImage && G.retroImage(d.image) || G.image(d.image);
      packs[key] = d.build(image, hd && image.naturalWidth > 120 ? 3 : 1);
      return true;
    }).catch(e => {
      failed.add(key);
      console.warn('Arena textures unavailable, using the ' + AB.levelName(0) + ' terrain:', d.id, e.message);
      return false;
    }).finally(() => { delete pending[key]; });
    return pending[key];
  };
  // before a round: the arena's textures, and its base arena's field picture as the fallback
  // (a download that failed earlier is tried again)
  T.prepare = function (level, onProgress) {
    const d = defFor(level);
    if (d && !packs[packKey(d)]) failed.delete(packKey(d));
    return Promise.all([T.load(level, onProgress, true), (d && G.loadRetroImage || G.loadImage)('field' + T.baseLevel(level), { priority: 'high', retries: 3 })])
      .then(([loaded, field]) => (defFor(level) && loaded) || field);
  };

  function pack(level) { const d = defFor(level); return d ? packs[packKey(d)] : null; }
  T.field = (level) => { const p = pack(level); return p ? p.field : G.image('field' + T.baseLevel(level)); };
  T.drawField = function (ctx, level) {
    const f = T.field(level);
    if (f.width && (f.complete === undefined || f.naturalWidth)) ctx.drawImage(f, 0, 0, W, H);
  };
  T.breakFrames = (level) => { const p = pack(level); return p ? p.breaking.length : G.seqLen('flame brick ' + T.baseLevel(level)) || 9; };
  // x/y are the same bottom-centre hotspots used by the original .ANI terrain sequences.
  T.draw = function (ctx, level, kind, state, x, y) {
    const p = pack(level);
    if (p) {
      const im = kind === 'breaking' ? p.breaking[AB.clamp(state | 0, 0, p.breaking.length - 1)] : p[kind];
      ctx.drawImage(im, Math.round(x - CW / 2), Math.round(y - CH + 1), CW, CH);
    } else {
      const b = T.baseLevel(level);
      const seq = kind === 'breaking' ? 'flame brick ' + b : 'tile ' + b + ' ' + kind;
      G.draw(ctx, seq, state, x, y, -1, false);
    }
  };
  // Menus show an arena's preview only once everything it draws is in, the floor picture and the
  // blocks (in HD the arena's HD pictures; a set that failed falls back to the original's), so it
  // never appears piece by piece. loadPreview starts loading it.
  const hdState = (level) => (AB.hd && AB.hd.arenaState ? AB.hd.arenaState(level) : null);
  const hdField = (level) => !!(AB.hd && AB.hd.active() && AB.hd.imageInfo && AB.hd.imageInfo('field' + level));
  // the original floor picture is needed when there's no HD one (HD off, an arena HD keeps original,
  // a download that failed) or the arena's texture set failed
  const retroField = (level) => (defFor(level) ? T.status(level) === 'failed' : !hdField(level) || hdState(level) === 'failed');
  T.loadPreview = function (level) {
    T.load(level);
    if (retroField(level)) (G.loadRetroImage || G.loadImage)('field' + T.baseLevel(level), { priority: 'low', retries: 1 });
  };
  T.previewReady = function (level) {
    const hs = hdState(level);
    if (hs === 'idle' || hs === 'loading') return false;
    if (defFor(level)) { const st = T.status(level); if (st === 'ready') return true; if (st !== 'failed') return false; }
    else if (!retroField(level)) return !!AB.hd.image('field' + level);
    return G.isLoaded('field' + T.baseLevel(level));
  };
  // a corner of the arena with the current scheme's blocks (menus)
  T.preview = function (ctx, level, px, py, nx = 5, ny = 5) {
    T.load(level);
    const sc = window.AB_DATA.schemes[AB.settings.scheme] || window.AB_DATA.schemes.basic;
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, nx * CW, ny * CH); ctx.clip();
    const f = T.field(level);
    const ratio = (f.naturalWidth || f.width) / W;
    if (f.width && (f.complete === undefined || f.naturalWidth)) ctx.drawImage(f, OX * ratio, OY * ratio, nx * CW * ratio, ny * CH * ratio, px, py, nx * CW, ny * CH);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const ch = (sc.rows[y] || '')[x];
      if (ch === '#' || ch === ':') T.draw(ctx, level, ch === '#' ? 'solid' : 'brick', 0, px + x * CW + CW / 2, py + y * CH + CH - 1);
    }
    ctx.restore();
  };

  function canvas(w, h, scale = 1) {
    const c = document.createElement('canvas'); c.width = w * scale; c.height = h * scale;
    if (scale !== 1) c.getContext('2d').scale(scale, scale);
    c.getContext('2d').imageSmoothingEnabled = false;
    return c;
  }
  function buildBedrock(image, scale = 1) {
    if (!image.naturalWidth || image.naturalWidth % 3) throw new Error('Expected three texture panels side by side');
    // The sheet holds the three panels (grass, bedrock, grass-topped dirt) at the game's own tile
    // size, 40 x 36 like the original arenas' tiles, so they are drawn 1:1 (the high-resolution
    // source is output/tilesets/bedrock-textures-source.png). All surfaces and break frames are
    // cached once, with no per-frame image processing.
    const tile = (panel, block) => {
      const s = image.naturalWidth / 3;
      const c = canvas(CW, CH, scale), x = c.getContext('2d'); x.drawImage(image, panel * s, 0, s, image.naturalHeight, 0, 0, CW, CH);
      if (block) {
        if (panel === 1) {
          // A stepped stone bevel matches the concept: light catches the top and left edges,
          // with a narrow highlight on the right and a recessed, darker lower face.
          x.fillStyle = '#a5adb0'; x.fillRect(2, 0, CW - 4, 2);
          x.fillStyle = 'rgba(204,215,219,0.30)'; x.fillRect(2, 2, CW - 4, 2);
          x.fillStyle = '#788286'; x.fillRect(0, 2, 2, CH - 6);
          x.fillStyle = 'rgba(185,198,202,0.28)'; x.fillRect(2, 4, 2, CH - 10); x.fillRect(CW - 4, 4, 2, CH - 8);
          x.fillStyle = '#bdc5c6'; x.fillRect(0, 0, 2, 2); x.fillRect(CW - 2, 0, 2, 2);
        } else {
          x.fillStyle = 'rgba(255,255,255,0.13)'; x.fillRect(0, 0, CW, 2); x.fillRect(0, 2, 2, CH - 4);
        }
        x.fillStyle = 'rgba(0,0,0,0.38)'; x.fillRect(CW - 2, 2, 2, CH - 2); x.fillRect(0, CH - 4, CW, 4);
      }
      return c;
    };
    const floor = tile(0, false), solid = tile(1, true), brick = tile(2, true);
    const field = canvas(W, H, scale), x = field.getContext('2d');
    x.fillStyle = '#111619'; x.fillRect(0, 0, W, H);
    for (let y = 44; y < H; y += CH) for (let c = 0; c < W; c += CW) x.drawImage(solid, c, y, CW, CH);
    for (let y = 0; y < ROWS; y++) for (let c = 0; c < COLS; c++) {
      x.drawImage(floor, OX + c * CW, OY + y * CH, CW, CH);
      if ((c + y) % 2) { x.fillStyle = 'rgba(0,0,0,0.045)'; x.fillRect(OX + c * CW, OY + y * CH, CW, CH); }
    }
    x.fillStyle = '#090e10'; x.fillRect(4, 4, W - 8, 36);
    x.strokeStyle = '#68716c'; x.strokeRect(4.5, 4.5, W - 9, 35);
    x.strokeStyle = '#080c0b'; x.strokeRect(OX - 0.5, OY - 0.5, COLS * CW + 1, ROWS * CH + 1);

    const breaking = Array.from({ length: 9 }, (_, state) => {
      const c = canvas(CW, CH, scale), q = c.getContext('2d');
      if (state === 8) return c;
      if (state <= 2) {
        q.drawImage(brick, 0, 0, CW, CH);
        if (state) {
          q.fillStyle = '#25261b';
          for (let i = 0; i < 8 + state * 4; i++) {
            const cy = 6 + i * 2, cx = 18 + (i % 4 < 2 ? 0 : 4);
            q.fillRect(cx, cy, 2, 2);
            if (state === 2 && i % 2 === 0) q.fillRect(cx - (i % 3) * 4, cy, 6, 2);
          }
        }
        return c;
      }
      const progress = (state - 2) / 6;
      q.globalAlpha = 1 - progress * 0.65;
      for (let sy = 0; sy < CH; sy += 6) for (let sx = 0; sx < CW; sx += 8) {
        const n = (sx / 8 * 7 + sy / 6 * 11) % 17;
        if (n / 17 < progress * 0.75) continue;
        const dx = Math.round(progress * (sx - CW / 2) * 0.3 / 2) * 2;
        const dy = Math.round((progress * progress * 10 - progress * (n % 4)) / 2) * 2;
        q.drawImage(brick, sx * scale, sy * scale, 8 * scale, 6 * scale, sx + dx, sy + dy, 8, 6);
      }
      return c;
    });
    return { field, floor, solid, brick, breaking };
  }
})(window.AB);
