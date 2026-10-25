// Optional HD art. Loading this manager never requests the manifest or any HD picture.
'use strict';
(function (AB) {
  const H = AB.hd = {}, loaded = new Map(), pending = new Map(), requested = new Set();
  let manifest = null, manifestPromise = null, enabled = false, switching = null, switchToken = null;
  const arenasReady = new Set(), arenasPending = new Map(), arenasFailed = new Set();
  H.active = () => enabled;
  H.scale = () => enabled ? (manifest.scale || 3) : 1;
  H.progress = null;
  const bust = () => { const v = (window.AB_VERSION || {}).commit || ''; return /^[0-9a-f]{7,40}$/.test(v) ? '?v=' + v : ''; };
  function catalog() {
    if (manifest) return Promise.resolve(manifest);
    if (manifestPromise) return manifestPromise;
    manifestPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeout = setTimeout(() => reject(new Error('HD manifest timed out')), 30000);
      script.src = 'hd/manifest.js' + bust();
      script.onload = () => {
        clearTimeout(timeout);
        const m = window.AB_HD_MANIFEST;
        if (!m || m.version !== 1 || !m.images || !m.atlases || m.scale !== 3) { reject(new Error('HD pack is incompatible')); return; }
        manifest = m; resolve(m);
      };
      script.onerror = () => { clearTimeout(timeout); reject(new Error('HD pack could not be downloaded')); };
      document.body.appendChild(script);
    }).catch(e => { manifestPromise = null; throw e; });
    return manifestPromise;
  }
  function asset(kind, name) { return manifest && manifest[kind][name]; }
  function image(kind, name) { return enabled && loaded.get(kind + ':' + name) || null; }
  H.image = name => image('images', name);
  H.atlas = name => image('atlases', name);
  H.imageInfo = name => asset('images', name);
  // what stays original in HD (manifest.original, from ORIGINAL in tools/build_hd.cjs): a name with
  // true isn't in the pack at all; an atlas with a list of frames draws those from the original sprites
  H.keepsOriginal = (name, f) => { const o = manifest && manifest.original && manifest.original[name]; return o === true || (Array.isArray(o) && o.includes(f)); };
  // the pictures whose pixels the game reads: the atlases recoloured per player, and the victory scene.
  // Opened from disk, those load through AB.gfx.readableSrc (tools/build_pixel_scripts.cjs makes them).
  const READ_IMAGES = new Set(['victory-base', 'victory-tint-mask']);
  function readable(kind, name) {
    if (kind === 'images') return READ_IMAGES.has(name);
    const S = window.AB_SPRITES; return !!(S && S[name] && S[name].recolor);
  }
  function fetchImage(kind, name) {
    const key = kind + ':' + name, a = asset(kind, name);
    if (!a) return Promise.resolve(false);
    if (loaded.has(key)) return Promise.resolve(true);
    if (pending.has(key)) return pending.get(key);
    const p = new Promise((resolve, reject) => {
      const im = new Image(), timeout = setTimeout(() => reject(new Error('HD asset timed out: ' + name)), 45000);
      const fail = () => { clearTimeout(timeout); reject(new Error('HD asset unavailable: ' + name)); };
      im.onload = () => {
        clearTimeout(timeout);
        if (!im.naturalWidth || (a.width && (im.naturalWidth !== a.width * a.scale || im.naturalHeight !== a.height * a.scale))) { fail(); return; }
        // The logical size is independent of the source resolution, including callers using G.image.
        if (kind === 'images') { im.width = a.width; im.height = a.height; }
        loaded.set(key, im); resolve(true);
      };
      im.onerror = fail;
      if (readable(kind, name) && AB.gfx && AB.gfx.readableSrc) AB.gfx.readableSrc(a.src + bust()).then(url => { im.src = url; });
      else im.src = a.src + bust();
    }).finally(() => pending.delete(key));
    pending.set(key, p); return p;
  }
  async function batch(items, notify, token) {
    const total = items.reduce((n, [k, name]) => n + (asset(k, name).bytes || 1), 0);
    let done = 0, index = 0;
    const update = label => notify && notify({ fraction: total ? done / total : 1, label, done, total });
    update('Preparing HD graphics');
    await Promise.all(Array.from({ length: Math.min(3, items.length) }, async () => {
      while (!(token && token.cancelled) && index < items.length) {
        const [kind, name] = items[index++]; await fetchImage(kind, name);
        if (token && token.cancelled) throw new Error('HD loading cancelled');
        done += asset(kind, name).bytes || 1; update(name);
      }
    }));
  }
  H.cancel = function () { if (switchToken) { switchToken.cancelled = true; switchToken.reject(new Error('HD loading cancelled')); } };
  // Only core characters/effects and menu screens are part of the initial switch.
  H.set = function (on, onProgress) {
    if (switching) return switching;
    if (!on) { enabled = false; if (AB.gfx) AB.gfx.releaseHDTints(); if (AB.applyDisplay) AB.applyDisplay(); return Promise.resolve(); }
    if (enabled) return Promise.resolve();
    const token = switchToken = { cancelled: false }, cancelled = new Promise((resolve, reject) => { token.reject = reject; });
    const work = (async () => {
      await catalog();
      if (token.cancelled) throw new Error('HD loading cancelled');
      const items = Object.entries(manifest.atlases).filter(([, a]) => a.arena === null).map(([n]) => ['atlases', n]);
      for (const n of Object.keys(manifest.images)) if (!/^field\d+$/.test(n) && !n.startsWith('tilesets/')) items.push(['images', n]);
      await batch(items, onProgress && (p => onProgress({ ...p, fraction: p.fraction * 0.98 })), token);
      if (token.cancelled) throw new Error('HD loading cancelled');
      if (AB.gfx) await AB.gfx.loadHDFonts();
      if (token.cancelled) throw new Error('HD loading cancelled');
      if (onProgress) onProgress({ fraction: 1, label: 'HD graphics ready' });
      enabled = true; if (AB.applyDisplay) AB.applyDisplay();
    })();
    switching = Promise.race([work, cancelled]).finally(() => { token.cancelled = true; if (switchToken === token) switchToken = null; switching = null; });
    return switching;
  };
  H.loadImage = function (name, onProgress) {
    if (!enabled || !asset('images', name)) return Promise.resolve(false);
    return batch([['images', name]], onProgress).then(() => true).catch(e => { console.warn(e.message); return false; });
  };
  H.requestImage = function (name) {
    if (!enabled || requested.has(name) || !asset('images', name)) return;
    requested.add(name); H.loadImage(name);
  };
  // an arena's HD pictures: null (HD off), 'ready', 'failed' (the original pictures stand in), 'loading', 'idle'
  H.arenaState = (level) => !enabled ? null : arenasReady.has(level) ? 'ready' : arenasFailed.has(level) ? 'failed' : arenasPending.has(level) ? 'loading' : 'idle';
  H.prepareArena = function (level, onProgress, retry = false) {
    if (!enabled) return Promise.resolve(true);
    if (retry) arenasFailed.delete(level);
    if (arenasReady.has(level)) return Promise.resolve(true);
    if (arenasPending.has(level)) return arenasPending.get(level);
    if (arenasFailed.has(level)) return Promise.resolve(false);
    const items = Object.entries(manifest.atlases).filter(([, a]) => a.arena === level).map(([n]) => ['atlases', n]);
    const field = level === AB.BEDROCK_LEVEL ? 'tilesets/bedrock/textures' : 'field' + level;
    if (asset('images', field)) items.push(['images', field]);
    const ready = batch(items, onProgress).then(() => { arenasReady.add(level); return true; }).catch(e => { arenasFailed.add(level); console.warn(e.message); return false; }).finally(() => arenasPending.delete(level));
    arenasPending.set(level, ready); return ready;
  };
})(window.AB);
