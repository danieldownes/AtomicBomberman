// One original victory scene, with independently tinted winner and runner-up suits.
'use strict';
(function (AB) {
  const G = AB.gfx, V = AB.victory = {};
  const ASSETS = ['victory-base', 'victory-mask'], CACHE_LIMIT = 4;
  const cache = new Map();
  const hdCache = new Map();
  let hdBase = null, hdPixels = null, hdOriginal = null;
  let hdUnreadable = null;      // the HD scene whose pixels couldn't be read (the original one is drawn)
  function hdImage(winnerColor, loserColor) {
    if (!AB.hd || !AB.hd.active()) return null;
    const base = AB.hd.image('victory-base'), mask = AB.hd.image('victory-tint-mask');
    if (!base || !mask || base === hdUnreadable) return null;
    try { return hdTinted(base, mask, winnerColor, loserColor); }
    catch (e) { hdUnreadable = base; hdBase = null; console.warn('HD victory scene: can\'t recolour (' + e.name + '), using the original'); return null; }
  }
  function hdTinted(base, mask, winnerColor, loserColor) {
    const width = base.naturalWidth, height = base.naturalHeight;
    const create = () => { const c = document.createElement('canvas'); c.width = width; c.height = height; return c; };
    if (hdBase !== base) {
      const c = create(), ctx = c.getContext('2d'); ctx.drawImage(base,0,0,width,height);
      hdOriginal = ctx.getImageData(0,0,width,height).data;
      ctx.clearRect(0,0,width,height);ctx.drawImage(mask,0,0,width,height);
      const m = ctx.getImageData(0,0,width,height).data; hdPixels = [];
      for(let i=0;i<m.length;i+=4)if(m[i]||m[i+1])hdPixels.push(i,m[i]?1:2);
      hdBase=base;hdCache.clear();
    }
    winnerColor=valid(winnerColor,4);loserColor=valid(loserColor,3);
    const key=winnerColor+':'+loserColor;
    if(hdCache.has(key)){const c=hdCache.get(key);hdCache.delete(key);hdCache.set(key,c);return c;}
    const c=create(),ctx=c.getContext('2d'),d=ctx.createImageData(width,height);d.data.set(hdOriginal);
    for(let p=0;p<hdPixels.length;p+=2){
      const i=hdPixels[p],winner=hdPixels[p+1]===1,sourceChannel=winner?1:2,rgb=AB.PLAYER_RGB[winner?winnerColor:loserColor];
      const neutral=winner?Math.max(hdOriginal[i],hdOriginal[i+2]):Math.max(hdOriginal[i],hdOriginal[i+1]);
      const chroma=hdOriginal[i+sourceChannel]-neutral;
      for(let ch=0;ch<3;ch++)d.data[i+ch]=AB.clamp(Math.round(hdOriginal[i+ch]+chroma*(rgb[ch]/100-(ch===sourceChannel?1:0))),0,255);
    }
    ctx.putImageData(d,0,0);hdCache.set(key,c);if(hdCache.size>CACHE_LIMIT)hdCache.delete(hdCache.keys().next().value);return c;
  }
  let state = 'idle', loading = null, original = null, pixels = null, palettes = null;
  const canvas = () => { const c = document.createElement('canvas'); c.width = AB.W; c.height = AB.H; return c; };
  const valid = (color, fallback) => Number.isInteger(color) && color >= 0 && color < AB.PLAYER_RGB.length ? color : fallback;

  // Pure presentation logic: same match scores and slot tie-break on every network client.
  V.contestants = function (match, winner, settings) {
    const S = settings || (match && match.S) || AB.settings || {};
    if (!match || !winner || !winner.p) return { winnerColor: 4, loserColor: 3, runnerUp: null };
    const team = S.teamPlay && winner.team !== undefined;
    const candidates = match.players.filter(p => team ? p.team !== winner.team : p.slot !== winner.p.slot);
    const score = (table, p) => (match[table] && match[table][p.slot]) || 0;
    const primary = S.winByKills ? 'kills' : 'wins', secondary = S.winByKills ? 'wins' : 'kills';
    candidates.sort((a, b) => score(primary, b) - score(primary, a) || score(secondary, b) - score(secondary, a) || a.slot - b.slot);
    const runnerUp = candidates[0] || null;
    return {
      winnerColor: team ? (winner.team ? 2 : 0) : valid(winner.p.color, 4),
      loserColor: team ? (winner.team ? 0 : 2) : runnerUp ? valid(runnerUp.color, 3) : 3,
      runnerUp,
    };
  };
  V.prefetch = () => G.prefetch(ASSETS);
  V.load = function (retry = false) {
    if (state === 'ready') return Promise.resolve(true);
    if (state === 'loading') return loading;
    if (state === 'failed' && !retry) return Promise.resolve(false);
    state = 'loading';
    // opened from disk the pictures come through G.readableImage, so their pixels can be read
    const get = n => typeof location !== 'undefined' && location.protocol === 'file:' && G.readableImage
      ? G.readableImage('img/' + n + '.png').catch(() => null)
      : (G.loadRetroImage || G.loadImage)(n, { priority: 'high', retries: 2 }).then(ok => ok && (G.retroImage || G.image)(n));
    loading = Promise.all(ASSETS.map(get)).then(([base, mask]) => {
      if (!base || !mask) throw new Error('Victory art unavailable');
      const c = canvas(), ctx = c.getContext('2d');
      if (base.naturalWidth !== AB.W || base.naturalHeight !== AB.H || mask.naturalWidth !== AB.W || mask.naturalHeight !== AB.H + AB.PLAYER_RGB.length) throw new Error('Unexpected victory image size');
      ctx.drawImage(base, 0, 0); original = ctx.getImageData(0, 0, AB.W, AB.H).data;
      c.height = mask.naturalHeight; ctx.drawImage(mask, 0, 0);
      const data = ctx.getImageData(0, 0, AB.W, AB.H).data;
      palettes = ctx.getImageData(0, AB.H, AB.W, AB.PLAYER_RGB.length).data;
      pixels = [];
      for (let i = 0; i < data.length; i += 4) if (data[i] || data[i + 1]) pixels.push(i, data[i], data[i + 1]);
      state = 'ready'; return true;
    }).catch(e => {
      state = 'failed'; original = pixels = palettes = null;
      console.warn('Victory recolouring unavailable:', e.message);
      return false;
    });
    return loading;
  };
  V.image = function (winnerColor, loserColor) {
    if (state !== 'ready') return null;
    winnerColor = valid(winnerColor, 4); loserColor = valid(loserColor, 3);
    const key = winnerColor + ':' + loserColor;
    if (cache.has(key)) { const c = cache.get(key); cache.delete(key); cache.set(key, c); return c; }
    const c = canvas(), ctx = c.getContext('2d'), image = ctx.createImageData(AB.W, AB.H), data = image.data;
    data.set(original);
    const winnerOffset = winnerColor * AB.W * 4, loserOffset = (loserColor * AB.W + 256) * 4;
    // Recolour only the classified suit materials, using the original artwork's palettes.
    // Every other pixel, including eyes, monitor, metal parts and background, stays untouched.
    for (let p = 0; p < pixels.length; p += 3) {
      const i = pixels[p], w = pixels[p + 1], l = pixels[p + 2];
      const offset = w ? winnerOffset + (w - 1) * 4 : loserOffset + (l - 1) * 4;
      data[i] = palettes[offset]; data[i + 1] = palettes[offset + 1]; data[i + 2] = palettes[offset + 2];
    }
    ctx.putImageData(image, 0, 0); cache.set(key, c);
    if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
    return c;
  };
  V.draw = function (ctx, winnerColor, loserColor) {
    const image = hdImage(winnerColor, loserColor) || V.image(winnerColor, loserColor);
    if (image) ctx.drawImage(image, 0, 0, AB.W, AB.H);
    else { V.load(); G.blit(ctx, ASSETS[0], 0, 0); }
  };
})(window.AB);
