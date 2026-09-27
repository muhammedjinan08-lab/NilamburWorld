/**
 * mobile.js - touch-screen support for phones and tablets.
 *
 *  - Left thumb: a virtual joystick (analog walking pace; steering + throttle when driving/flying).
 *  - Right thumb: drag anywhere on the world to look around, pinch to zoom.
 *  - Action buttons that follow what you're doing: Jump / Brake / Up, Run / Nitro / Down, Use (E),
 *    Ride (R), Garage (G), and Pass / Shoot / Tackle during a football match. They send the same
 *    key events as a keyboard, so every existing feature works unchanged.
 *  - A menu button gathers the side panels and chat into a drawer; the HUD is compacted (styles.css
 *    `.touch` rules). Tapping an "E" prompt uses it.
 * Turned on for coarse-pointer / touch devices; force with ?touch=1 (or off with ?touch=0).
 * Loaded before main.js, which reads IS_TOUCH (render resolution, shadow map size) and touchAxis.
 */

const IS_TOUCH = (() => {
  const q = new URLSearchParams(location.search).get('touch');
  if (q === '1') return true;
  if (q === '0') return false;
  return window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 0 && window.matchMedia('(hover: none)').matches);
})();
window.touchAxis = { x: 0, y: 0 };   // joystick, -1..1 (y down = backwards)

(function () {
  if (!IS_TOUCH) return;
  document.body.classList.add('touch');
  document.addEventListener('gesturestart', (e) => (e.cancelable && e.preventDefault()));          // iOS page pinch-zoom
  document.addEventListener('dblclick', (e) => (e.cancelable && e.preventDefault()), { passive: false });

  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code: code, key: code, bubbles: true }));
  const el = (tag, id, cls, html) => { const e = document.createElement(tag); if (id) e.id = id; if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };

  // ---------- Layout: menu drawer toggle ----------
  const menu = el('button', 'm-menu', 'm-btn', '☰');
  menu.type = 'button'; menu.title = 'Panels, quests, fast travel, chat';
  menu.addEventListener('click', () => document.body.classList.toggle('menu-open'));
  document.body.appendChild(menu);
  // Tapping the world closes the drawer
  document.getElementById('canvas-container').addEventListener('touchstart', () => document.body.classList.remove('menu-open'), { passive: true });
  // Fast travel from the drawer should close it too
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.btn-teleport[data-location]')) document.body.classList.remove('menu-open'); });

  // ---------- Joystick ----------
  const pad = el('div', 'm-stick', ''), knob = el('div', null, 'm-knob');
  pad.appendChild(knob);
  document.body.appendChild(pad);
  let stickId = null, cx = 0, cy = 0;
  const R = 52;
  const driveKeys = { KeyW: false, KeyS: false, KeyA: false, KeyD: false };
  function setDriveKeys(x, y) {
    const driving = typeof state !== 'undefined' && (state.driving);
    const want = { KeyW: driving && y < -0.3, KeyS: driving && y > 0.3, KeyA: driving && x < -0.3, KeyD: driving && x > 0.3 };
    for (const k in want) if (want[k] !== driveKeys[k]) { driveKeys[k] = want[k]; if (typeof keyState !== 'undefined') keyState[k] = want[k]; }
  }
  function stickMove(t) {
    let dx = t.clientX - cx, dy = t.clientY - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) { dx *= R / d; dy *= R / d; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    const x = dx / R, y = dy / R;
    const driving = typeof state !== 'undefined' && state.driving;
    window.touchAxis.x = driving ? 0 : x; window.touchAxis.y = driving ? 0 : y;   // walking is analog
    setDriveKeys(x, y);
  }
  function stickEnd() {
    stickId = null; knob.style.transform = '';
    window.touchAxis.x = 0; window.touchAxis.y = 0;
    setDriveKeys(0, 0);
  }
  pad.addEventListener('touchstart', (e) => {
    (e.cancelable && e.preventDefault());
    const t = e.changedTouches[0]; stickId = t.identifier;
    const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
    stickMove(t);
  }, { passive: false });
  pad.addEventListener('touchmove', (e) => {
    (e.cancelable && e.preventDefault());
    for (const t of e.changedTouches) if (t.identifier === stickId) stickMove(t);
  }, { passive: false });
  pad.addEventListener('touchend', (e) => { for (const t of e.changedTouches) if (t.identifier === stickId) stickEnd(); });
  pad.addEventListener('touchcancel', stickEnd);

  // ---------- Look (drag) + pinch zoom on the world ----------
  const cont = document.getElementById('canvas-container');
  const looks = new Map();   // touch id -> {x, y}
  let pinch0 = 0, dist0 = 16;
  cont.addEventListener('touchstart', (e) => {
    for (const t of e.changedTouches) looks.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (looks.size === 2) { const [a, b] = [...looks.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = camRig.distTarget; }
    (e.cancelable && e.preventDefault());
  }, { passive: false });
  cont.addEventListener('touchmove', (e) => {
    (e.cancelable && e.preventDefault());
    if (typeof camRig === 'undefined') return;
    if (looks.size >= 2) {
      for (const t of e.changedTouches) if (looks.has(t.identifier)) looks.set(t.identifier, { x: t.clientX, y: t.clientY });
      const [a, b] = [...looks.values()], d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch0 > 0) camRig.distTarget = clamp(dist0 * pinch0 / d, 6, 60);
      return;
    }
    for (const t of e.changedTouches) {
      const p = looks.get(t.identifier); if (!p) continue;
      if (!state.driving) {   // while driving the camera is locked behind the vehicle
        camRig.yaw -= (t.clientX - p.x) * 0.008;
        camRig.pitch = clamp(camRig.pitch + (t.clientY - p.y) * 0.006, 0.04, 1.35);
        camRig.idleTime = 0;
      }
      looks.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
  }, { passive: false });
  const endLook = (e) => { for (const t of e.changedTouches) looks.delete(t.identifier); if (looks.size < 2) pinch0 = 0; };
  cont.addEventListener('touchend', endLook);
  cont.addEventListener('touchcancel', endLook);

  // ---------- Action buttons ----------
  const pad2 = el('div', 'm-actions', '');
  document.body.appendChild(pad2);
  const buttons = {};
  function btn(id, code, big) {
    const b = el('button', null, 'm-act' + (big ? ' big' : ''), '');
    b.type = 'button';
    b.dataset.code = code;
    let lastTouch = 0;
    const down = (e) => {
      if (e.type === 'touchstart') lastTouch = performance.now();
      else if (performance.now() - lastTouch < 1000) return;   // the browser's emulated mouse event after a tap
      (e.cancelable && e.preventDefault());
      if (b.classList.contains('on')) return;
      b.classList.add('on'); key(code, true);
    };
    const up = (e) => {
      if (e.type !== 'touchend' && e.type !== 'touchcancel' && performance.now() - lastTouch < 1000) return;
      (e.cancelable && e.preventDefault()); if (!b.classList.contains('on')) return; b.classList.remove('on'); key(code, false);
    };
    b.addEventListener('touchstart', down, { passive: false });
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
    b.addEventListener('mousedown', down); b.addEventListener('mouseup', up); b.addEventListener('mouseleave', up);   // stylus / desktop testing
    pad2.appendChild(b);
    buttons[id] = b;
    return b;
  }
  btn('use', 'KeyE', true);
  btn('jump', 'Space');
  btn('run', 'ShiftLeft');
  btn('ride', 'KeyR');
  btn('garage', 'KeyG');
  btn('pass', 'KeyF');
  btn('shoot', 'KeyQ', true);
  btn('tackle', 'KeyC');
  const setBtn = (id, icon, label, show) => {
    const b = buttons[id], html = '<span>' + icon + '</span><small>' + label + '</small>';
    if (b._html !== html) { b.innerHTML = html; b._html = html; }
    b.style.display = show === false ? 'none' : '';
  };

  // Tap the on-screen "E" prompt to use it
  ['spot-prompt', 'garage-prompt'].forEach(id => {
    const p = document.getElementById(id); if (!p) return;
    p.addEventListener('click', () => { const c = id === 'garage-prompt' ? 'KeyG' : 'KeyE'; key(c, true); setTimeout(() => key(c, false), 60); });
  });

  // Portrait phones: a small hint, once
  const hint = el('div', 'm-rotate', 'glass-panel', '📱↻ Turn your phone sideways for the best view');
  document.body.appendChild(hint);
  hint.addEventListener('click', () => hint.remove());
  setTimeout(() => hint.remove(), 7000);

  // Full screen (and landscape where allowed) when the player starts
  document.addEventListener('click', function go(e) {
    if (!e.target.closest || !e.target.closest('#name-form button, #name-offline')) return;
    document.removeEventListener('click', go, true);
    try {
      const d = document.documentElement, rq = d.requestFullscreen || d.webkitRequestFullscreen;
      if (rq) Promise.resolve(rq.call(d)).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {});
    } catch (err) { /* not supported (iOS Safari) */ }
  }, true);

  // Per-frame: relabel buttons for the current situation
  let _t = 0;
  function tick() {
    requestAnimationFrame(tick);
    const now = performance.now(); if (now - _t < 150) return; _t = now;
    if (typeof state === 'undefined') return;
    const v = state.driving, heli = v && v.type === 'heli';
    const football = typeof fbPlaying === 'function' && fbPlaying();
    const spot = document.getElementById('spot-prompt');
    const near = (spot && spot.classList.contains('show')) || (typeof nearestFreeVehicle === 'function' && !v && nearestFreeVehicle());
    setBtn('use', '✋', v ? (heli ? 'Exit' : 'Get out') : near ? 'Use' : 'Use');
    buttons.use.classList.toggle('ready', !!near);
    setBtn('jump', heli ? '▲' : v ? '🛑' : '⤒', heli ? 'Up' : v ? 'Brake' : 'Jump');
    setBtn('run', heli ? '▼' : v ? '🔥' : '🏃', heli ? 'Down' : v ? 'Nitro' : 'Run', !v || heli || !!(v.mods && v.mods.nitro));
    setBtn('ride', '🪟', state.ridingVehicle ? 'Hop off' : 'Ride', !v);
    const gp = document.getElementById('garage-prompt');
    setBtn('garage', '🔧', 'Garage', !!(gp && gp.classList.contains('show')));
    setBtn('pass', '👟', 'Pass', football);
    setBtn('shoot', '⚽', 'Shoot', football);
    setBtn('tackle', '🦵', 'Tackle', football);
    document.body.classList.toggle('m-driving', !!v);
    document.body.classList.toggle('m-football', football);
    // joystick no longer drives analog walking once in a vehicle (and vice versa)
    if (v && (window.touchAxis.x || window.touchAxis.y)) { window.touchAxis.x = 0; window.touchAxis.y = 0; }
  }
  requestAnimationFrame(tick);

  // Start with the side panels minimised on small screens (their state is remembered after that)
  window.addEventListener('load', () => {
    if (window.innerWidth > 1100) return;
    try { if (localStorage.getItem('nw_touch_init')) return; localStorage.setItem('nw_touch_init', '1'); } catch (e) { return; }
    setTimeout(() => document.querySelectorAll('.collapsible:not([data-key=minimap]) .btn-min').forEach(b => { if (!b.closest('.collapsed')) b.click(); }), 800);
  });
})();
