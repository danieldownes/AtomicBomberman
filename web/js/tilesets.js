// Cosmetic arena tilesets. Arena IDs, schemes and simulation state keep their original meaning.
'use strict';
(function (AB) {
  const G = AB.gfx, T = AB.tilesets = {};
  const { W, H, CW, CH, OX, OY, COLS, ROWS } = AB;
  const packs = {}, pending = {}, failed = new Set();
  const definitions = [
    { id: 'original', name: 'Original', description: ['Each arena uses its own', 'original terrain graphics.'] },
    { id: 'bedrock', name: 'Bedrock', image: 'tilesets/bedrock/textures', description: ['Bedrock walls, grassy floors', 'and breakable dirt blocks.'], build: buildBedrock },
  ];
  T.list = definitions.map(({ id, name, description }) => ({ id, name, description }));
  T.id = function (id) {
    if (id === undefined) id = T.override === undefined ? (AB.settings || {}).tileset : T.override;
    return definitions.some(d => d.id === id) ? id : 'original';
  };
  T.name = (id) => definitions.find(d => d.id === T.id(id)).name;
  T.status = (id) => { id = T.id(id); return id === 'original' || packs[id] ? 'ready' : failed.has(id) ? 'failed' : pending[id] ? 'loading' : 'idle'; };

  // New textures load only when requested. A failed pack always falls back to the arena's art.
  T.load = function (id) {
    id = T.id(id);
    if (id === 'original' || packs[id]) return Promise.resolve(true);
    if (pending[id]) return pending[id];
    if (failed.has(id)) return Promise.resolve(false);
    const d = definitions.find(d => d.id === id);
    pending[id] = G.loadImage(d.image, { priority: 'high', retries: 1 }).then(ok => {
      if (!ok) throw new Error('Texture image unavailable');
      packs[id] = d.build(G.image(d.image));
      return true;
    }).catch(e => {
      failed.add(id);
      console.warn('Tileset unavailable; using Original:', id, e.message);
      return false;
    }).finally(() => { delete pending[id]; });
    return pending[id];
  };
  T.select = function (id) {
    id = T.id(id);
    delete T.override;
    AB.settings.tileset = id;
    AB.saveSettings();
    failed.delete(id);                    // selecting again also retries a failed download
    return T.load(id);
  };
  T.prepare = function (level, id) {
    id = T.id(id);
    return Promise.all([T.load(id), G.loadImage('field' + level, { priority: 'high', retries: 3 })])
      .then(([loaded, field]) => (id !== 'original' && loaded) || field);
  };

  function pack(id) { return packs[T.id(id)]; }
  T.field = (level, id) => { const p = pack(id); return p ? p.field : G.image('field' + level); };
  T.drawField = function (ctx, level, id) {
    const f = T.field(level, id);
    if (f.width && (f.complete === undefined || f.naturalWidth)) ctx.drawImage(f, 0, 0);
  };
  T.breakFrames = (level, id) => { const p = pack(id); return p ? p.breaking.length : G.seqLen('flame brick ' + level) || 9; };
  // x/y are the same bottom-centre hotspots used by the original .ANI terrain sequences.
  T.draw = function (ctx, level, kind, state, x, y, id) {
    const p = pack(id);
    if (p) {
      const im = kind === 'breaking' ? p.breaking[AB.clamp(state | 0, 0, p.breaking.length - 1)] : p[kind];
      ctx.drawImage(im, Math.round(x - CW / 2), Math.round(y - CH + 1));
    } else {
      const seq = kind === 'breaking' ? 'flame brick ' + level : 'tile ' + level + ' ' + kind;
      G.draw(ctx, seq, state, x, y, -1, false);
    }
  };
  T.preview = function (ctx, level, px, py, nx = 5, ny = 5, id) {
    T.load(id);
    const sc = window.AB_DATA.schemes[AB.settings.scheme] || window.AB_DATA.schemes.basic;
    ctx.save();
    ctx.beginPath(); ctx.rect(px, py, nx * CW, ny * CH); ctx.clip();
    const f = T.field(level, id);
    if (f.width && (f.complete === undefined || f.naturalWidth)) ctx.drawImage(f, OX, OY, nx * CW, ny * CH, px, py, nx * CW, ny * CH);
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const ch = (sc.rows[y] || '')[x];
      if (ch === '#' || ch === ':') T.draw(ctx, level, ch === '#' ? 'solid' : 'brick', 0, px + x * CW + CW / 2, py + y * CH + CH - 1, id);
    }
    ctx.restore();
  };

  function canvas(w, h) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    c.getContext('2d').imageSmoothingEnabled = false;
    return c;
  }
  function buildBedrock(image) {
    if (!image.naturalWidth || Math.abs(image.naturalWidth / image.naturalHeight - 3) > 0.01) throw new Error('Expected three square texture panels');
    // The generated source pixels are kept intact. Sample into the native grid, then enlarge the art
    // pixels 2x. All surfaces and break frames are cached once, with no per-frame image processing.
    const tile = (panel, block) => {
      const small = canvas(CW / 2, CH / 2), s = image.naturalWidth / 3;
      small.getContext('2d').drawImage(image, panel * s, 0, s, image.naturalHeight, 0, 0, small.width, small.height);
      const c = canvas(CW, CH), x = c.getContext('2d'); x.drawImage(small, 0, 0, CW, CH);
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
    const field = canvas(W, H), x = field.getContext('2d');
    x.fillStyle = '#111619'; x.fillRect(0, 0, W, H);
    for (let y = 44; y < H; y += CH) for (let c = 0; c < W; c += CW) x.drawImage(solid, c, y);
    for (let y = 0; y < ROWS; y++) for (let c = 0; c < COLS; c++) {
      x.drawImage(floor, OX + c * CW, OY + y * CH);
      if ((c + y) % 2) { x.fillStyle = 'rgba(0,0,0,0.045)'; x.fillRect(OX + c * CW, OY + y * CH, CW, CH); }
    }
    x.fillStyle = '#090e10'; x.fillRect(4, 4, W - 8, 36);
    x.strokeStyle = '#68716c'; x.strokeRect(4.5, 4.5, W - 9, 35);
    x.strokeStyle = '#080c0b'; x.strokeRect(OX - 0.5, OY - 0.5, COLS * CW + 1, ROWS * CH + 1);

    const breaking = Array.from({ length: 9 }, (_, state) => {
      const c = canvas(CW, CH), q = c.getContext('2d');
      if (state === 8) return c;
      if (state <= 2) {
        q.drawImage(brick, 0, 0);
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
        q.drawImage(brick, sx, sy, 8, 6, sx + dx, sy + dy, 8, 6);
      }
      return c;
    });
    return { field, floor, solid, brick, breaking };
  }
})(window.AB);
