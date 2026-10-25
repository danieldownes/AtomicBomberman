// Input: keyboards (KEY 0..3) and gamepads (JOY 0..3), mapped to the original two-button scheme.
// Defaults from INPUT.BM: KEY0 = cursor keys / Space (drop bomb) / Enter (action)
//                         KEY1 = R,D,F,G / S (drop bomb) / A (action)
'use strict';
(function (AB) {
  const I = AB.input = {};
  const down = new Set();
  const pressedQueue = [];
  I.layouts = [
    { name: 'Cursor keys / Space / Enter', up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', bomb: 'Space', action: 'Enter' },
    { name: 'R D F G / S / A', up: 'KeyR', down: 'KeyF', left: 'KeyD', right: 'KeyG', bomb: 'KeyS', action: 'KeyA' },
    { name: 'I J K L / U / O', up: 'KeyI', down: 'KeyK', left: 'KeyJ', right: 'KeyL', bomb: 'KeyU', action: 'KeyO' },
    { name: 'Numpad 8456 / 0 / Enter', up: 'Numpad8', down: 'Numpad5', left: 'Numpad4', right: 'Numpad6', bomb: 'Numpad0', action: 'NumpadEnter' },
  ];
  try {
    const saved = JSON.parse(localStorage.getItem('ab_keys') || 'null');
    if (Array.isArray(saved) && saved.length === 4) I.layouts = saved;
  } catch (e) {}
  I.saveLayouts = () => { try { localStorage.setItem('ab_keys', JSON.stringify(I.layouts)); } catch (e) {} };

  const GAME_KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Enter', 'Tab', 'Backspace']);
  window.addEventListener('keydown', (e) => {
    AB.audio && AB.audio.unlock();
    if (GAME_KEYS.has(e.code) || e.code.startsWith('Key') || e.code.startsWith('Numpad') || e.code.startsWith('F')) {
      if (!(e.code === 'F5' || e.code === 'F11' || e.code === 'F12' || (e.ctrlKey && e.code === 'KeyR'))) e.preventDefault();
    }
    if (!e.repeat) pressedQueue.push({ code: e.code, key: e.key, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey });
    down.add(e.code);
  });
  window.addEventListener('keyup', (e) => { down.delete(e.code); });
  window.addEventListener('blur', () => down.clear());
  window.addEventListener('mousedown', () => AB.audio && AB.audio.unlock());
  window.addEventListener('touchstart', () => AB.audio && AB.audio.unlock(), { passive: true });

  I.isDown = (code) => down.has(code);
  // a key held down: on the keyboard, or a gamepad's stick / d-pad direction (for menu key repeat)
  const padHeld = new Set();
  I.held = (code) => down.has(code) || padHeld.has(code);
  // drain key presses for menu handling
  I.takePresses = () => pressedQueue.splice(0, pressedQueue.length);

  // ---- gamepads ----
  I.pads = function () {
    const out = [];
    const gp = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of gp) if (p && p.connected) out.push(p);
    return out;
  };
  let padPrev = [];
  // The stick, read with thresholds so it doesn't flicker or turn by accident: it counts once pushed
  // half way out and stops under a third; then its angle picks straight up, down, left or right
  // (within 30 degrees of them) or, between those, the diagonal's two directions, which turn a corner
  // as soon as it opens (js/game.js chooseDir, where the direction pressed last leads). Crossing from
  // one of those to the next takes 6 degrees past the edge, so a stick held on an edge stays put.
  const IN_AT = 0.5, OUT_AT = 0.33, STRAIGHT = 30, STICKY = 6;
  const SECTORS = [AB.IN.RIGHT, AB.IN.RIGHT | AB.IN.DOWN, AB.IN.DOWN, AB.IN.DOWN | AB.IN.LEFT,
    AB.IN.LEFT, AB.IN.LEFT | AB.IN.UP, AB.IN.UP, AB.IN.UP | AB.IN.RIGHT];
  const padStick = [];   // pad -> the stick's sector last read (0..7 from right, clockwise; -1 centred)
  const half = (s) => (s % 2 ? 45 - STRAIGHT : STRAIGHT);
  const off = (a, s) => Math.abs(((a - s * 45 + 540) % 360) - 180);   // degrees from a sector's middle
  I.stickBits = function (i, x, y) {
    const prev = padStick[i] === undefined ? -1 : padStick[i], m = Math.hypot(x, y);
    if (m < (prev < 0 ? IN_AT : OUT_AT)) { padStick[i] = -1; return 0; }
    const a = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;   // 0 = right, clockwise (y is down)
    let s = prev;
    if (s < 0 || off(a, s) > half(s) + STICKY) for (s = 0; s < 8 && off(a, s) > half(s); s++);
    padStick[i] = s;
    return SECTORS[s];
  };
  function padBits(p, i) {
    const ax = p.axes || [];
    let b = I.stickBits(i, ax[0] || 0, ax[1] || 0);
    const bt = p.buttons || [];
    const pr = (k) => bt[k] && (bt[k].pressed || bt[k].value > 0.5);
    // the d-pad: buttons, like keys
    if (pr(12)) b |= AB.IN.UP;
    if (pr(13)) b |= AB.IN.DOWN;
    if (pr(14)) b |= AB.IN.LEFT;
    if (pr(15)) b |= AB.IN.RIGHT;
    if (pr(0)) b |= AB.IN.BOMB;
    if (pr(1) || pr(2)) b |= AB.IN.ACTION;
    return b;
  }
  // synthesize menu presses from gamepads (edge detection)
  I.pollPadsForMenu = function () {
    const pads = I.pads();
    padHeld.clear();
    pads.forEach((p, i) => {
      const b = padBits(p, i), o = padPrev[i] || 0, e = b & ~o;
      if (b & AB.IN.UP) padHeld.add('ArrowUp');
      if (b & AB.IN.DOWN) padHeld.add('ArrowDown');
      if (e & AB.IN.UP) pressedQueue.push({ code: 'ArrowUp', pad: i });
      if (e & AB.IN.DOWN) pressedQueue.push({ code: 'ArrowDown', pad: i });
      if (e & AB.IN.LEFT) pressedQueue.push({ code: 'ArrowLeft', pad: i });
      if (e & AB.IN.RIGHT) pressedQueue.push({ code: 'ArrowRight', pad: i });
      if (e & AB.IN.BOMB) pressedQueue.push({ code: 'Enter', pad: i });
      if (e & AB.IN.ACTION) pressedQueue.push({ code: 'Escape', pad: i });
      if (p.buttons[9] && p.buttons[9].pressed && !(o & 64)) pressedQueue.push({ code: 'Escape', pad: i, start: true });
      padPrev[i] = b | ((p.buttons[9] && p.buttons[9].pressed) ? 64 : 0);
    });
  };

  // device: {type:'key', n} | {type:'joy', n}
  I.read = function (dev) {
    if (!dev) return 0;
    if (dev.type === 'key') {
      const L = I.layouts[dev.n]; if (!L) return 0;
      let b = 0;
      if (down.has(L.up)) b |= AB.IN.UP;
      if (down.has(L.down)) b |= AB.IN.DOWN;
      if (down.has(L.left)) b |= AB.IN.LEFT;
      if (down.has(L.right)) b |= AB.IN.RIGHT;
      if (down.has(L.bomb)) b |= AB.IN.BOMB;
      if (down.has(L.action)) b |= AB.IN.ACTION;
      return b;
    }
    if (dev.type === 'joy') {
      const p = I.pads()[dev.n];
      return p ? padBits(p, dev.n) : 0;
    }
    return 0;
  };
  I.keyLabel = function (code) {
    if (!code) return '?';
    return code.replace(/^Key/, '').replace(/^Digit/, '').replace(/^Arrow/, '').replace(/^Numpad/, 'Num ');
  };
})(window.AB);
