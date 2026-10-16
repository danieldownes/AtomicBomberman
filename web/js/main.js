// Boot + fixed-timestep main loop.
'use strict';
(function (AB) {
  const canvas = document.getElementById('screen');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  AB.canvas = canvas; AB.ctx = ctx;

  function fit() {
    const s = Math.min(window.innerWidth / AB.W, window.innerHeight / AB.H);
    const k = s >= 1 ? (s >= 2 ? Math.floor(s * 4) / 4 : s) : s;
    canvas.style.width = Math.floor(AB.W * k) + 'px';
    canvas.style.height = Math.floor(AB.H * k) + 'px';
  }
  window.addEventListener('resize', fit); fit();
  // display options: enhanced sprite edges and sharp/smooth screen scaling
  AB.applyDisplay = function () {
    const S = AB.settings || {};
    AB.gfx.setEnhanced(S.enhancedGfx !== false);
    canvas.style.imageRendering = S.smoothScaling ? 'auto' : 'pixelated';
  };

  function loadScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.body.appendChild(s); });
  }

  const params = new URLSearchParams(location.search);
  AB.params = params;

  async function boot() {
    const bar = document.querySelector('#bar > div'), msg = document.getElementById('lmsg');
    msg.textContent = 'Preparing graphics...';
    await AB.gfx.load((f) => { bar.style.width = Math.round(70 + f * 22) + '%'; });
    msg.textContent = 'Loading pictures...';
    await AB.gfx.preloadImages(['title', 'mainmenu_port', 'glue0', 'iplogo', 'hslogo']);
    // while the menus are up, fetch the loading pictures and the end-of-round screens in the background
    AB.gfx.prefetch(['glue1', 'glue2', 'glue3', 'glue4', 'glue5', 'glue6', 'results', 'draw', 'winz']);
    bar.style.width = '96%';
    // sounds load on demand (audio/clips); the menus need only a few right away
    AB.audio.configure(AB.settings);
    AB.menuSounds = AB.audio.loadMenuSounds();
    bar.style.width = '100%';
    document.getElementById('loading').style.display = 'none';
    setTimeout(() => { const h = document.getElementById('hint'); if (h) h.classList.add('gone'); }, 12000);
    AB.applyDisplay();
    if (params.get('gfx') === 'orig') AB.gfx.setEnhanced(false);
    const intro = AB.settings.playIntro !== false && !params.has('nointro') && !params.get('test');
    AB.screens.start(params.get('test') ? 'test' : intro ? 'intro' : 'title');
    let last = performance.now(), acc = 0;
    const step = 1000 / AB.TPS;
    function frame(now) {
      acc += Math.min(250, now - last); last = now;
      AB.input.pollPadsForMenu();
      // keep the loop alive even if a screen throws, so one bug can't freeze the game
      try {
        while (acc >= step) { AB.screens.tick(); acc -= step; }
        AB.screens.render(ctx);
      } catch (e) { console.error(e); acc = 0; }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }
  window.addEventListener('keydown', (e) => {
    if (e.code === 'F11') { e.preventDefault(); if (document.fullscreenElement) document.exitFullscreen(); else document.documentElement.requestFullscreen().catch(() => {}); }
  });
  boot().catch(e => { document.getElementById('lmsg').textContent = 'Failed to start: ' + e; console.error(e); });
})(window.AB);
