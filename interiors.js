/**
 * interiors.js - walk-in interiors for every building in the world: the room registry (walkable floors
 * + keeping the camera inside), real-size staff and customers, furniture and goods per kind of shop or
 * office, and the "E" interaction spots that give each building its own feature (haircut at the salon,
 * try-on room at the textile shop, ATM at the bank, a film at the theatre ...).
 *
 * Everything is authored in real metres: avatars and NPCs are ~1.72 m, counters 0.9 m, chairs 0.46 m,
 * doors 2.1-2.4 m. Static geometry goes through town.js's merged batches (frame()/tbPush) so hundreds of
 * props cost a handful of draw calls; furnishings use the 'int' batch, which doesn't cast sun shadows.
 * Depends on world.js (GROUND_EXTRAS, COLL helpers) and town.js (frame, TM, TB, SHOP_FLOOR ...).
 */

const ROOMS = [];   // { name, kind, room:[x0,x1,z0,z1], floor:[..], step:[..], floorY, stepY, ceilY }
const SPOTS = [];   // { x, z, y, r, icon, label, act }

// ---------- Rooms: walkable floors + camera containment ----------
// hw/hd are the room's inner half-extents in the frame's local space; the floor rectangle can be larger
// (the whole footprint, so the doorway threshold is walkable) and a front step can be added in +z.
function registerRoom(F, lx, lz, hw, hd, floorY, ceilY, name, kind, opt) {
  opt = opt || {};
  const rect = (cx, cz, a, b) => {
    const p1 = F.w(cx - a, cz - b), p2 = F.w(cx + a, cz + b);
    return [Math.min(p1[0], p2[0]), Math.max(p1[0], p2[0]), Math.min(p1[1], p2[1]), Math.max(p1[1], p2[1])];
  };
  const r = { name: name, kind: kind, open: !!opt.open, room: rect(lx, lz, hw, hd), floorY: F.by + floorY * F.sc, ceilY: F.by + ceilY * F.sc };
  if (!opt.noFloor) r.floor = rect(lx, lz, opt.floorHW || hw, opt.floorHD || hd);
  r.center = F.w(lx, lz); r.front = F.w(lx, lz + hd);   // for tests / fast travel into a building
  if (opt.stepD) {
    const fhd = opt.floorHD || hd;
    r.step = rect(lx, lz + fhd + opt.stepD / 2, (opt.floorHW || hw) - 0.45, opt.stepD / 2);
    r.stepY = F.by + (opt.stepY !== undefined ? opt.stepY : floorY / 2) * F.sc;
  }
  ROOMS.push(r);
  return r;
}
const inRect = (q, x, z) => q && x >= q[0] && x <= q[1] && z >= q[2] && z <= q[3];
// One GROUND_EXTRAS entry for every room floor (rather than one closure per building)
GROUND_EXTRAS.push(function (x, z) {
  let best = null;
  for (let i = 0; i < ROOMS.length; i++) {
    const r = ROOMS[i];
    if (inRect(r.floor, x, z)) best = best === null ? r.floorY : Math.max(best, r.floorY);
    else if (inRect(r.step, x, z)) best = best === null ? r.stepY : Math.max(best, r.stepY);
  }
  return best;
});
// The room the player is standing in (used by the camera to stay under the ceiling / inside the walls)
function roomAt(x, y, z) {
  for (let i = 0; i < ROOMS.length; i++) {
    const r = ROOMS[i];
    if (!r.open && inRect(r.room, x, z) && y > r.floorY - 0.8 && y < r.ceilY) return r;
  }
  return null;
}

// ---------- Sub-frames: place a piece of furniture in its own local space ----------
// Local +z is the piece's front. yaw 0 = against the back wall facing the door; +PI/2 = against the
// left wall facing +x; -PI/2 = against the right wall; PI = facing the back wall. `dy` lifts the whole
// sub-frame (e.g. to a shop's floor level, so furniture is authored with y = 0 on the floor).
function sub(F, ox, oz, yaw, dy) {
  yaw = yaw || 0; dy = dy || 0;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const T = (lx, lz) => [ox + lx * c + lz * s, oz - lx * s + lz * c];
  const S = { by: F.by + dy * F.sc, sc: F.sc };
  S.w = (lx, lz) => { const q = T(lx, lz); return F.w(q[0], q[1]); };
  S.put = (key, geo, lx, ly, lz, hex, rx, lry, rz) => { const q = T(lx, lz); F.put(key, geo, q[0], ly + dy, q[1], hex, rx, yaw + (lry || 0), rz); };
  S.box = (key, w, h, d, lx, ly, lz, hex, rx, lry, rz) => { const q = T(lx, lz); F.box(key, w, h, d, q[0], ly + dy, q[1], hex, rx, yaw + (lry || 0), rz); };
  S.cyl = (key, rt, rb, h, lx, ly, lz, hex, seg, rx, lry, rz) => { const q = T(lx, lz); F.cyl(key, rt, rb, h, q[0], ly + dy, q[1], hex, seg, rx, yaw + (lry || 0), rz); };
  S.sph = (key, r, lx, ly, lz, hex, sy) => { const q = T(lx, lz); F.sph(key, r, q[0], ly + dy, q[1], hex, sy); };
  S.col = (lx, lz, hw, hd) => { const q = T(lx, lz), sw = Math.abs(s) > 0.7; F.col(q[0], q[1], sw ? hd : hw, sw ? hw : hd); };
  return S;
}

// Low-poly shared shapes (merged later, so per-vertex cost matters more than object count)
const _orbGeo = new Map();
function orbGeo(r, sy) {
  const k = r.toFixed(3) + ':' + (sy || 1);
  let g = _orbGeo.get(k);
  if (!g) { g = new THREE.SphereGeometry(r, 7, 5); if (sy) g.scale(1, sy, 1); _orbGeo.set(k, g); }
  return g;
}
const orb = (T, key, r, x, y, z, hex, sy) => T.put(key, orbGeo(r, sy), x, y, z, hex);
const torus = (T, key, r, tube, x, y, z, hex, rx, ry) => T.put(key, new THREE.TorusGeometry(r, tube, 5, 12), x, y, z, hex, rx || 0, ry || 0);

// Deterministic "random" so the world looks the same for every player (multiplayer relies on this)
let _irs = 1234567;
const irng = () => { _irs = (_irs * 16807) % 2147483647; return (_irs - 1) / 2147483646; };
const pick = (a) => a[(irng() * a.length) | 0];

// ---------- People (static, merged) ----------
const NPC_SKINS = [0x7a4a2e, 0x8a5a38, 0x9a6a44, 0xa8744a, 0xb07a50, 0xc08a5c];
const NPC_SHIRTS = [0xd33a3a, 0x2a58d8, 0xf0f0e8, 0xe0a020, 0x2ea043, 0x8a3ab0, 0xe8e0c0, 0x1c8a8a, 0xf08a8a, 0x5a6a7a, 0x9ab8d8];
const NPC_LOWERS = [0x2a2f45, 0x3a3a3a, 0x4a5a6a, 0x5a4a3a, 0x22304a];
const NPC_HAIR = [0x120d0a, 0x17110d, 0x2a1d14, 0x3a3a3a, 0xbdbdbd];
// A real-size (1.72 m) figure. o: { sit, seat, pose: 'side'|'front'|'lap'|'pray'|'up', k (scale, e.g. 0.8
// for children), skin, shirt, lower, hair, hairStyle: 'short'|'long'|'bun'|'bald'|'none', mundu, saree,
// coat (colour of an over-coat), cap (colour), shoe, hold: fn(P, up) to add something in the hands }
function npc(T, x, y, z, yaw, o) {
  o = o || {};
  const k = o.k || 1;
  const skin = o.skin !== undefined ? o.skin : pick(NPC_SKINS);
  const shirt = o.shirt !== undefined ? o.shirt : pick(NPC_SHIRTS);
  const lower = o.lower !== undefined ? o.lower : (o.mundu ? 0xf3efe2 : pick(NPC_LOWERS));
  const hair = o.hair !== undefined ? o.hair : pick(NPC_HAIR);
  const shoe = o.shoe !== undefined ? o.shoe : 0x2a1c14;
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const P = (key, geo, px, py, pz, hex, rx, rz) => T.put(key, geo, x + (px * c + pz * s) * k, y + py * k, z + (-px * s + pz * c) * k, hex, rx || 0, yaw, rz || 0);
  const B = (w, h, d) => new THREE.BoxGeometry(w * k, h * k, d * k);
  const C = (rt, rb, h, seg) => new THREE.CylinderGeometry(rt * k, rb * k, h * k, seg || 6);
  const O = (r, sy) => orbGeo(r * k, sy);
  const seat = (o.seat || 0.46) / k;
  const up = o.sit ? (seat + 0.06 - 0.89) : 0;   // everything from the hips up moves down when seated
  if (!o.sit) {
    if (o.mundu || o.saree) {
      P('cloth', C(0.2, o.saree ? 0.26 : 0.23, 0.84, 10), 0, 0.47, 0, lower);
      for (const sx of [-1, 1]) P('rubber', B(0.09, 0.06, 0.22), sx * 0.09, 0.03, 0.05, shoe);
    } else {
      for (const sx of [-1, 1]) {
        P('cloth', C(0.07, 0.06, 0.82), sx * 0.1, 0.48, 0, lower);
        P('rubber', B(0.1, 0.07, 0.25), sx * 0.1, 0.035, 0.04, shoe);
      }
    }
  } else {
    for (const sx of [-1, 1]) {
      P('cloth', C(0.075, 0.068, 0.44), sx * 0.1, seat + 0.03, 0.2, lower, Math.PI / 2);
      P('cloth', C(0.062, 0.056, seat), sx * 0.1, seat / 2, 0.42, (o.mundu || o.saree) ? lower : lower);
      P('rubber', B(0.1, 0.07, 0.25), sx * 0.1, 0.035, 0.47, shoe);
    }
    if (o.mundu || o.saree) P('cloth', B(0.44, 0.18, 0.52), 0, seat + 0.05, 0.2, lower);
  }
  // hips, chest, optional coat / saree drape
  P('cloth', B(0.36, 0.16, 0.21), 0, 0.93 + up, 0, (o.mundu || o.saree) ? lower : lower);
  P('cloth', B(0.38, 0.56, 0.22), 0, 1.21 + up, 0, shirt);
  if (o.coat !== undefined) P('cloth', B(0.42, o.sit ? 0.62 : 0.98, 0.25), 0, (o.sit ? 1.2 : 1.04) + up, 0, o.coat);
  if (o.saree) P('cloth', B(0.12, 0.5, 0.235), 0.12, 1.15 + up, 0.005, lower, 0, 0.3);   // pallu over the shoulder
  // arms
  const pose = o.pose || (o.sit ? 'lap' : 'side');
  for (const sx of [-1, 1]) {
    P('cloth', C(0.052, 0.046, 0.3), sx * 0.235, 1.3 + up, 0, o.coat !== undefined ? o.coat : shirt);
    if (pose === 'side') {
      P('cloth', C(0.042, 0.036, 0.28), sx * 0.245, 1.0 + up, 0.02, skin);
      P('cloth', B(0.07, 0.09, 0.05), sx * 0.245, 0.83 + up, 0.03, skin);
    } else if (pose === 'front' || (pose === 'up' && sx < 0)) {
      P('cloth', C(0.042, 0.036, 0.28), sx * 0.215, 1.14 + up, 0.15, skin, Math.PI / 2);
      P('cloth', B(0.07, 0.05, 0.09), sx * 0.205, 1.14 + up, 0.31, skin);
    } else if (pose === 'lap') {
      P('cloth', C(0.042, 0.036, 0.28), sx * 0.2, 1.04 + up, 0.12, skin, 1.15);
      P('cloth', B(0.07, 0.05, 0.09), sx * 0.19, 0.98 + up, 0.27, skin);
    } else if (pose === 'pray') {
      P('cloth', C(0.042, 0.036, 0.26), sx * 0.12, 1.2 + up, 0.13, skin, 1.0, -sx * 0.6);
      if (sx > 0) P('cloth', B(0.06, 0.14, 0.05), 0, 1.3 + up, 0.22, skin);
    } else if (pose === 'up') {   // right arm raised (pouring / pulling tea, writing on a board)
      P('cloth', C(0.042, 0.036, 0.3), sx * 0.26, 1.58 + up, 0.05, skin, -0.25);
      P('cloth', B(0.07, 0.09, 0.05), sx * 0.27, 1.75 + up, 0.09, skin);
    }
  }
  // head
  P('cloth', C(0.045, 0.05, 0.1), 0, 1.53 + up, 0, skin);
  P('cloth', O(0.105, 1.12), 0, 1.63 + up, 0, skin);
  P('cloth', B(0.03, 0.045, 0.03), 0, 1.615 + up, 0.103, skin);   // nose - reads which way they face
  const hs = o.hairStyle || 'short';
  if (hs !== 'bald' && hs !== 'none') {
    P('cloth', O(0.112, 0.72), 0, 1.68 + up, -0.012, hair);
    if (hs === 'long') P('cloth', B(0.22, 0.44, 0.06), 0, 1.47 + up, -0.095, hair);
    if (hs === 'bun') P('cloth', O(0.06), 0, 1.66 + up, -0.13, hair);
  }
  if (o.cap !== undefined) {
    P('cloth', C(0.118, 0.118, 0.07, 10), 0, 1.74 + up, 0, o.cap);
    P('cloth', B(0.16, 0.015, 0.1), 0, 1.71 + up, 0.12, o.cap);
  }
  if (o.hold) o.hold(P, up, B, C);
}
// Handy things for NPC hands (P is npc's part placer, in the figure's own space)
const HOLD = {
  scissors: (P, up, B) => { P('metal', B(0.02, 0.01, 0.16), 0.19, 1.15 + up, 0.37, 0xc8d0d8, 0, 0.3); P('metal', B(0.02, 0.01, 0.16), 0.19, 1.15 + up, 0.37, 0xc8d0d8, 0, -0.3); },
  comb: (P, up, B) => P('paint', B(0.02, 0.03, 0.14), -0.2, 1.15 + up, 0.37, 0x1a1a1a),
  paper: (P, up, B) => P('cloth', B(0.36, 0.26, 0.01), 0, 1.12 + up, 0.33, 0xf4f2ea, -0.5),
  book: (P, up, B) => P('cloth', B(0.2, 0.26, 0.03), 0, 1.13 + up, 0.33, 0x2a58d8, -0.6),
  glass: (P, up, B, C) => P('cglass', C(0.03, 0.025, 0.09, 8), 0.2, 1.18 + up, 0.33),
  tray: (P, up, B) => P('metal', B(0.4, 0.02, 0.3), 0, 1.17 + up, 0.34, 0xc0c4c8),
  phone: (P, up, B) => P('paint', B(0.07, 0.14, 0.01), 0.2, 1.18 + up, 0.33, 0x101010, -0.5)
};

// ---------- Common fittings ----------
function tubeLight(T, x, y, z, rot) { T.box('lamp', 1.2, 0.05, 0.07, x, y, z, undefined, 0, rot || 0); T.box('metal', 1.25, 0.03, 0.1, x, y + 0.04, z, 0xe8e8e8, 0, rot || 0); }
function ceilingFan(T, x, ceil, z) {
  T.cyl('metal', 0.02, 0.02, 0.35, x, ceil - 0.17, z, 0xe8e8e0, 6);
  T.cyl('paint', 0.1, 0.1, 0.08, x, ceil - 0.38, z, 0xe8e8e0, 10);
  for (let i = 0; i < 3; i++) T.box('paint', 0.62, 0.012, 0.11, x, ceil - 0.4, z, 0xd8d8d0, 0, i * 2.094, 0);
}
function wallFrame(T, x, y, z, w, h, hex, yaw) { T.box('wood', w + 0.08, h + 0.08, 0.03, x, y, z, 0x5a3a20, 0, yaw || 0); T.box('cloth', w, h, 0.02, x, y, z + (Math.abs(yaw || 0) > 0.1 ? 0 : 0.015), hex, 0, yaw || 0); }
function counter(S, x, z, w, d, h, hex, glassTop) {
  S.box('wood', w, h, d, x, h / 2, z, hex || 0x6a4a2a);
  S.box('wood', w + 0.06, 0.04, d + 0.06, x, h + 0.02, z, 0x4a2c14);
  if (glassTop) { S.box('cglass', w - 0.1, 0.35, d - 0.1, x, h + 0.2, z); S.box('metal', w, 0.03, d, x, h + 0.39, z, 0xb8bec4); }
  S.col(x, z, w / 2, d / 2);
}
function chair(S, x, z, yaw, hex, noCol) {
  const C = sub(S, x, z, yaw || 0);
  C.box('wood', 0.44, 0.05, 0.42, 0, 0.45, 0, hex || 0x7a4a24);
  C.box('wood', 0.44, 0.48, 0.04, 0, 0.72, -0.2, hex || 0x7a4a24);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) C.box('wood', 0.04, 0.45, 0.04, sx * 0.19, 0.225, sz * 0.18, 0x4a2c14);
  if (!noCol) C.col(0, 0, 0.22, 0.22);
}
function plasticChair(S, x, z, yaw, hex) {
  const C = sub(S, x, z, yaw || 0);
  C.box('paint', 0.46, 0.04, 0.44, 0, 0.44, 0, hex || 0xe8e8e8);
  C.box('paint', 0.46, 0.44, 0.04, 0, 0.68, -0.21, hex || 0xe8e8e8, -0.12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) C.box('paint', 0.04, 0.44, 0.04, sx * 0.2, 0.22, sz * 0.19, hex || 0xe8e8e8);
}
function table(S, x, z, w, d, h, hex, noCol) {
  S.box('wood', w, 0.05, d, x, h || 0.75, z, hex || 0x8a5a2a);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) S.box('wood', 0.05, (h || 0.75), 0.05, x + sx * (w / 2 - 0.06), (h || 0.75) / 2, z + sz * (d / 2 - 0.06), 0x4a2c14);
  if (!noCol) S.col(x, z, w / 2, d / 2);
}
function bench(S, x, z, len, yaw, hex) {
  const C = sub(S, x, z, yaw || 0);
  C.box('wood', len, 0.05, 0.36, 0, 0.44, 0, hex || 0x7a5a30);
  for (const sx of [-1, 1]) C.box('wood', 0.05, 0.44, 0.32, sx * (len / 2 - 0.1), 0.22, 0, 0x4a2c14);
}
// Wall shelving unit (front = +z), `fill(S, shelfY, i, w)` puts goods on each shelf
function shelving(S, x, z, w, h, d, n, hex, fill, noCol) {
  const U = sub(S, x, z, 0);
  U.box('wood', w, h, 0.03, 0, h / 2, -d / 2 + 0.015, hex || 0x8a6a42);
  for (const sx of [-1, 1]) U.box('wood', 0.04, h, d, sx * (w / 2 - 0.02), h / 2, 0, hex || 0x8a6a42);
  for (let i = 0; i < n; i++) {
    const y = 0.08 + i * (h - 0.1) / n;
    U.box('wood', w - 0.04, 0.03, d, 0, y, 0, hex || 0x8a6a42);
    if (fill) fill(U, y + 0.015, i, w - 0.1, d);
  }
  U.box('wood', w, 0.03, d, 0, h, 0, hex || 0x8a6a42);
  if (!noCol) U.col(0, 0, w / 2, d / 2);
}
// Rows of packets / boxes / tins on a shelf
function packets(U, y, w, d, colors, bw, bh, bd, gap) {
  const n = Math.floor(w / (bw + gap));
  for (let i = 0; i < n; i++) U.box('cloth', bw, bh, bd, -w / 2 + (bw + gap) * (i + 0.5), y + bh / 2, 0.02, colors[i % colors.length]);
}
function tins(U, y, w, colors, r, h) {
  const n = Math.floor(w / (r * 2.3));
  for (let i = 0; i < n; i++) U.cyl('paint', r, r, h, -w / 2 + r * 2.3 * (i + 0.5), y + h / 2, 0.02, colors[i % colors.length], 8);
}
function books(U, y, w, colors) {
  let x = -w / 2 + 0.03;
  while (x < w / 2 - 0.05) {
    const bw = 0.03 + irng() * 0.035, bh = 0.2 + irng() * 0.1;
    U.box('cloth', bw, bh, 0.2, x + bw / 2, y + bh / 2, 0.02, pick(colors));
    x += bw + 0.004;
  }
}

// ---------- Interaction spots ----------
function addSpot(T, lx, ly, lz, icon, label, act, r) {
  const p = T.w(lx, lz);
  SPOTS.push({ x: p[0], z: p[1], y: T.by + ly * T.sc, r: r || 1.9, icon: icon, label: label, act: act });
}
function nearestSpot() {
  if (!state || state.driving || state.ridingTrain || state.ridingVehicle) return null;
  const p = state.playerPos;
  let best = null, bd = 1e9;
  for (let i = 0; i < SPOTS.length; i++) {
    const s = SPOTS[i];
    if (Math.abs(p.y - s.y) > 2.2) continue;
    const d = Math.hypot(p.x - s.x, p.z - s.z);
    if (d < s.r && d < bd) { bd = d; best = s; }
  }
  return best;
}
function trySpot() {
  const s = nearestSpot();
  if (!s) return false;
  const res = s.act();
  if (res) triggerLandmarkPopup(s.icon + ' ' + res[0], res[1]);
  return true;
}
let _lastSpot = null;
function updateSpotPrompt() {
  const el = document.getElementById('spot-prompt');
  if (!el) return;
  const s = nearestSpot();
  if (s !== _lastSpot) {
    _lastSpot = s;
    if (s) { el.textContent = ''; const k = document.createElement('span'); k.className = 'key-badge'; k.textContent = 'E'; el.appendChild(k); el.appendChild(document.createTextNode(' ' + s.icon + ' ' + s.label)); }
    el.classList.toggle('show', !!s);
  }
}
// Small audio cues for a few features (only when the soundscape is switched on)
function chime(freqs, dur) {
  if (typeof audioCtx === 'undefined' || !audioCtx || !audioNodes || state.audioMuted) return;
  const t = audioCtx.currentTime;
  freqs.forEach((f, i) => {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.type = 'sine'; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.14 / (i + 1), t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + (dur || 2.2));
    o.connect(g); g.connect(audioNodes.master); o.start(t); o.stop(t + (dur || 2.2) + 0.1);
  });
}
const rupees = (n) => '₹' + n;

// ======================================================================================================
// Shops
// ======================================================================================================
const heapGeo = (sx, sy, sz) => { const g = new THREE.SphereGeometry(1, 7, 4, 0, Math.PI * 2, 0, Math.PI / 2); g.scale(sx, sy, sz); return g; };
function heap(T, x, y, z, sx, sy, sz, hex, lry) { T.put('cloth', heapGeo(sx, sy, sz), x, y, z, hex, 0, lry || 0); }

// Produce: a heap per crate with a few individual pieces on top (reads as a full crate, costs little)
const PRODUCE = [
  { n: 'tomato', hex: 0xd8402a, r: 0.045 }, { n: 'onion', hex: 0x8a2a5a, r: 0.05 }, { n: 'potato', hex: 0x9a7040, r: 0.05 },
  { n: 'cabbage', hex: 0x6aa84a, r: 0.1 }, { n: 'brinjal', hex: 0x4a1a4a, r: 0.045, sy: 1.8 }, { n: 'lemon', hex: 0xf3c21c, r: 0.035 },
  { n: 'chilli', hex: 0x2a8a2a, r: 0.02, sy: 3 }, { n: 'carrot', hex: 0xe07a1a, r: 0.035, sy: 2.4 }, { n: 'cucumber', hex: 0x4a8a2a, r: 0.04, sy: 2.6 },
  { n: 'ginger', hex: 0xc8a060, r: 0.04 }, { n: 'beans', hex: 0x3a9a3a, r: 0.018, sy: 4 }, { n: 'yam', hex: 0x7a5a3a, r: 0.08 }
];
const SPICES = [0xb8281a, 0xe0b020, 0x2a2018, 0x6a8a3a, 0xe8d8b0, 0x8a4a1a, 0xc87a2a, 0x5a3a2a];
function vegRack(S, len, list, seed) {
  S.box('wood', len, 0.4, 1.1, 0, 0.2, 0, 0x6a4a2a);
  const sections = Math.max(1, Math.floor(len / 0.85)), sw = len / sections;
  for (let tier = 0; tier < 3; tier++) {
    const y = 0.46 + (2 - tier) * 0.27, z = -0.36 + tier * 0.34;
    S.box('wood', len, 0.05, 0.36, 0, y, z, 0x8a5a2a, -0.2);
    for (let k = 0; k < sections; k++) {
      const pr = list[(k * 3 + tier * 5 + seed) % list.length], x = -len / 2 + sw * (k + 0.5);
      S.box('wood', 0.03, 0.12, 0.34, x - sw / 2 + 0.015, y + 0.06, z, 0x5a3a1a, -0.2);
      heap(S, x, y + 0.02, z, sw / 2 - 0.05, 0.1 + pr.r * 0.9, 0.16, pr.hex);
      for (let i = 0; i < 4; i++) {
        const px = x - sw * 0.3 + i * sw * 0.2, pz = z + (i % 2 ? -0.05 : 0.05), long = (pr.sy || 1) > 1.4;
        // long produce (beans, chillies, carrots, brinjal) lies on the heap instead of standing on end
        S.put('cloth', orbGeo(pr.r, pr.sy), px, y + 0.1 + pr.r * (long ? 1 : 1.4), pz, pr.hex, long ? Math.PI / 2 : 0, long ? i * 0.7 : 0);
      }
    }
  }
  S.col(0, 0, len / 2, 0.55);
}
function weighingScale(T, x, y, z) {
  T.box('paint', 0.3, 0.08, 0.25, x, y + 0.04, z, 0xe8e8e8);
  T.box('screen', 0.12, 0.05, 0.02, x, y + 0.06, z + 0.13, 0x60ff90);
  T.cyl('metal', 0.14, 0.14, 0.015, x, y + 0.09, z, 0xc8ccd0, 12);
}
function cashCounter(R, x, z, yaw, len, staffOpt) {
  const S = sub(R, x, z, yaw);
  counter(S, 0, 0, len || 1.6, 0.6, 0.9, 0x6a4a2a);
  S.box('paint', 0.35, 0.12, 0.3, (len || 1.6) / 2 - 0.35, 0.96, 0, 0x2a2a2a);                      // billing machine
  S.box('screen', 0.28, 0.2, 0.02, (len || 1.6) / 2 - 0.35, 1.13, -0.08, 0x3a6aa0);
  npc(S, 0, 0, -0.65, 0, Object.assign({ pose: 'front' }, staffOpt || {}));
  return S;
}

const SHOP_FIT = {};
SHOP_FIT.fruit = function (c) {
  const { R, o, hw, hd } = c;
  const spice = /spice/i.test(o.name + ' ' + o.sub);
  if (spice) {
    // Spice & nuts: open jute sacks with coned heaps, glass jars on shelves
    for (let i = 0; i < 10; i++) {
      const x = -hw + 0.7 + (i % 5) * 0.9, z = -hd + 0.8 + Math.floor(i / 5) * 1.0;
      R.cyl('cloth', 0.32, 0.34, 0.55, x, 0.275, z, 0xc8a870, 10);
      R.cyl('cloth', 0.02, 0.3, 0.2, x, 0.62, z, SPICES[i % SPICES.length], 10);
    }
    R.col(-hw + 2.5, -hd + 1.3, 2.2, 0.9);
    shelving(sub(R, hw - 0.25, -0.5, -Math.PI / 2), 0, 0, 3.6, 2.2, 0.4, 5, 0x7a5030, (U, y, i, w) => {
      const n = Math.floor(w / 0.2);
      for (let k = 0; k < n; k++) { U.cyl('cglass', 0.07, 0.07, 0.2, -w / 2 + 0.2 * (k + 0.5), y + 0.1, 0.02); U.cyl('cloth', 0.06, 0.06, 0.13, -w / 2 + 0.2 * (k + 0.5), y + 0.07, 0.02, SPICES[(k + i) % SPICES.length], 8); }
    });
  } else {
    const len = 2 * hd - 2.4;
    vegRack(sub(R, -hw + 0.55, -0.6, Math.PI / 2), len, PRODUCE, 0);
    vegRack(sub(R, hw - 0.55, -0.6, -Math.PI / 2), len, PRODUCE, 5);
    vegRack(sub(R, 0, -hd + 0.55, 0), 2 * hw - 2.6, PRODUCE, 2);
    // hanging banana bunches and a coconut pile
    for (let i = 0; i < 4; i++) {
      const x = -1.5 + i;
      R.cyl('metal', 0.006, 0.006, 0.5, x, c.ch - 0.25, hd - 1.3, 0x555555, 4);
      heap(R, x, c.ch - 0.95, hd - 1.3, 0.16, 0.45, 0.16, i % 2 ? 0xe8c020 : 0x8ab030);
    }
    for (let i = 0; i < 9; i++) orb(R, 'cloth', 0.12, -hw + 1.6 + (i % 3) * 0.22, 0.12 + Math.floor(i / 3) * 0.16, hd - 2.4 + (i % 2) * 0.1, 0x7a4a24);
    for (let i = 0; i < 3; i++) { R.cyl('cloth', 0.26, 0.3, 0.55, hw - 1.6, 0.28, -hd + 2 + i * 0.7, 0xd8c098, 8); heap(R, hw - 1.6, 0.55, -hd + 2 + i * 0.7, 0.24, 0.12, 0.24, [0x8a2a5a, 0x9a7040, 0x7a5a3a][i]); }
  }
  const S = cashCounter(R, 1.2, hd - 2.3, Math.PI, 1.6, { mundu: true, shirt: 0xe8e0c0 });
  weighingScale(S, -0.3, 0.92, 0);
  npc(R, 2.2, 0, hd - 1.7, Math.PI + 0.6, { hold: HOLD.paper });
  shopSpot(R, 1.2, hd - 1.6, spice ? '🌶️' : '🥬', spice ? 'Buy spices' : 'Buy vegetables & fruits', spice ? 'spice' : 'veg', 1.8, c.o && c.o.name);
};

SHOP_FIT.salon = function (c) {
  const { R, o, hw, hd, ch } = c;
  const ladies = /ladies|parlour|beauty/i.test(o.name + ' ' + o.sub);
  const seatHex = ladies ? 0xb04a8a : 0x1a1a1a;
  shopSpot(R, -c.hw + 1.2, c.hd - 1.0, '💆', 'Other services & products', 'salon', 1.2, o.name);
  // Mirror wall + counter along the right wall; hydraulic chairs facing it
  const mz0 = -hd + 0.8, mz1 = hd - 1.4, mlen = mz1 - mz0;
  const M = sub(R, hw - 0.02, (mz0 + mz1) / 2, -Math.PI / 2);
  M.box('mirror', mlen, 1.2, 0.03, 0, 1.75, 0);
  M.box('wood', mlen, 0.05, 0.42, 0, 0.92, 0.21, 0xe8e0d8);
  M.box('wood', mlen, 0.85, 0.4, 0, 0.45, 0.2, ladies ? 0xf0d8e8 : 0x3a3a40);
  M.col(0, 0.2, mlen / 2, 0.2);
  const items = [0x2a58d8, 0xe8e0c0, 0x2ea043, 0xd33a3a, 0xf0b820, 0x1a1a1a, 0xffffff];
  for (let i = 0; i < Math.floor(mlen / 0.22); i++) {
    const x = -mlen / 2 + 0.2 + i * 0.22;
    if (i % 4 === 0) M.box('paint', 0.05, 0.02, 0.18, x, 0.96, 0.25, 0x1a1a1a);                     // comb
    else if (i % 4 === 1) M.cyl('paint', 0.03, 0.03, 0.16 + (i % 3) * 0.04, x, 1.03, 0.3, items[i % items.length], 8);   // bottles
    else if (i % 4 === 2) { M.box('metal', 0.02, 0.01, 0.15, x, 0.955, 0.22, 0xc8d0d8, 0, 0.3); M.box('metal', 0.02, 0.01, 0.15, x, 0.955, 0.22, 0xc8d0d8, 0, -0.3); }   // scissors
    else M.box('paint', 0.06, 0.05, 0.16, x, 0.97, 0.28, 0x151515);                               // trimmer
  }
  M.box('cglass', 0.4, 0.3, 0.3, mlen / 2 - 0.4, 1.1, 0.24);                                        // UV steriliser
  M.box('screen', 0.36, 0.26, 0.26, mlen / 2 - 0.4, 1.1, 0.24, 0x6060ff);
  for (let i = 0; i < 4; i++) M.box('cloth', 0.35, 0.06, 0.3, -mlen / 2 + 0.35, 0.95 + i * 0.065, 0.22, 0xffffff);   // towel stack
  const chairs = [-hd + 1.6, -0.2, hd - 2.4].filter(z => z < hd - 2);
  chairs.forEach((z, i) => {
    const C = sub(R, hw - 1.25, z, -Math.PI / 2);
    C.cyl('metal', 0.28, 0.3, 0.05, 0, 0.025, 0, 0xc8ccd0, 12);
    C.cyl('metal', 0.07, 0.07, 0.36, 0, 0.22, 0, 0x9aa0a6, 8);
    C.box('rubber', 0.56, 0.12, 0.54, 0, 0.47, 0, seatHex);
    C.box('rubber', 0.56, 0.72, 0.12, 0, 0.88, -0.26, seatHex, -0.12);
    C.box('rubber', 0.26, 0.14, 0.1, 0, 1.33, -0.31, seatHex);
    for (const sx of [-1, 1]) { C.box('metal', 0.08, 0.06, 0.46, sx * 0.31, 0.68, -0.02, 0xc8ccd0); C.box('metal', 0.04, 0.2, 0.04, sx * 0.31, 0.57, 0.18, 0xc8ccd0); }
    C.box('metal', 0.46, 0.03, 0.22, 0, 0.16, 0.42, 0xc8ccd0);
    C.col(0, 0, 0.3, 0.3);
    if (i === 0) {
      // customer under a cape, barber working with scissors and comb
      npc(C, 0, 0, 0, 0, { sit: true, seat: 0.53, hairStyle: ladies ? 'long' : 'short', shirt: 0x6a8ab0, lower: 0x2a2f45 });
      C.put('cloth', new THREE.CylinderGeometry(0.14, 0.46, 0.7, 12, 1, true), 0, 0.92, 0.08, ladies ? 0xf0a0c8 : 0x2a6ab0);
      npc(C, -0.15, 0, -0.62, 0.15, { pose: 'front', shirt: ladies ? 0xf0a0c8 : 0x151515, lower: 0x2a2a2a, hairStyle: ladies ? 'bun' : 'short', hold: (P, up, B) => { HOLD.scissors(P, up, B); HOLD.comb(P, up, B); } });
      for (let k = 0; k < 14; k++) C.box('cloth', 0.05 + irng() * 0.05, 0.004, 0.03, (irng() - 0.5) * 0.9, 0.004, (irng() - 0.5) * 0.9, 0x1a1410, 0, irng() * 3);   // clippings
    }
    if (i === 1) addSpot(C, 0, 0, 0.9, '💈', ladies ? 'Sit down for a hair styling' : 'Sit down for a haircut', () => {
      const price = ladies ? 250 : 120;
      if (!spendCash(price)) return ['Not enough cash', 'A ' + (ladies ? 'hair styling' : 'haircut') + ' is ' + rupees(price) + ' and you have ' + fmtRs(econ.cash) + '. Take a job from the 💼 Jobs board to earn some.'];
      const cur = (window.playerAppearance && window.playerAppearance.hairStyle) || 'short';
      const order = ladies ? ['bun', 'braid', 'ponytail', 'long', 'medium'] : ['short', 'medium', 'bald', 'ponytail', 'long'];
      const next = order[(order.indexOf(cur) + 1) % order.length];
      const partial = { hairStyle: next };
      if (ladies && next === 'bun') partial.flower = true;
      if (window.NW && NW.setAppearance) NW.setAppearance(partial); else applyPlayerAppearance(Object.assign({}, window.playerAppearance, partial));
      chime([880, 1320], 0.4);
      const label = (HAIR_STYLE_LIST.find(h => h[0] === next) || [next, next])[1];
      return [ladies ? 'Styled!' : 'Fresh haircut!', 'You now have a ' + label.toLowerCase() + ' style - paid ' + rupees(price) + ' cash. Come again next month!'];
    }, 1.2);
    if (i === 2) npc(C, 0.35, 0, -0.7, 0.8, { pose: 'side', shirt: ladies ? 0xf0a0c8 : 0x151515, lower: 0x2a2a2a, hairStyle: ladies ? 'long' : 'short' });
  });
  // Waiting area on the left wall: bench, a customer with the newspaper, TV, price list
  bench(R, -hw + 0.35, -0.3, 2.4, Math.PI / 2, 0x4a3a2a);
  R.col(-hw + 0.35, -0.3, 0.2, 1.2);
  npc(R, -hw + 0.35, 0, -0.9, Math.PI / 2, { sit: true, seat: 0.46, hold: HOLD.paper });
  R.box('paint', 0.04, 0.55, 0.95, -hw + 0.03, 2.05, 1.2, 0x101010);
  R.box('screen', 0.02, 0.48, 0.86, -hw + 0.06, 2.05, 1.2, 0x5a7aa0);
  wallFrame(sub(R, -hw + 0.02, -hd + 1.4, Math.PI / 2), 0, 1.7, 0, 0.7, 0.9, 0xf4f0e0);
  // Wash basin at the back
  R.box('paint', 0.6, 0.18, 0.45, -1, 0.85, -hd + 0.25, 0xf4f4f4);
  R.box('paint', 0.1, 0.85, 0.1, -1, 0.42, -hd + 0.2, 0xf4f4f4);
  R.cyl('metal', 0.015, 0.015, 0.2, -1, 1.0, -hd + 0.12, 0xc8ccd0, 6, 1.3);
  ceilingFan(R, 0, ch, 0);
};

SHOP_FIT.textile = function (c) {
  const { R, o, hw, hd, ch } = c;
  const tailor = /tailor/i.test(o.name + ' ' + o.sub);
  const cloth = [0xc0392b, 0x2a58d8, 0xf0b820, 0x2ea043, 0x8a3ab0, 0xf3efe2, 0xe07a8a, 0x1c8a8a, 0x7a1f46, 0xd8c8a0];
  const clothFill = (U, y, i, w) => {
    const n = Math.floor(w / 0.32);
    for (let k = 0; k < n; k++) for (let s = 0; s < 4; s++) U.box('cloth', 0.28, 0.05, 0.3, -w / 2 + 0.32 * (k + 0.5), y + 0.03 + s * 0.055, 0.02, cloth[(k * 3 + s + i) % cloth.length]);
  };
  shelving(sub(R, 0, -hd + 0.2, 0), 0, 0, 2 * hw - 0.2, 2.6, 0.38, 6, 0x7a5030, clothFill);
  shelving(sub(R, -hw + 0.2, -0.4, Math.PI / 2), 0, 0, 2 * hd - 3.2, 2.6, 0.38, 6, 0x7a5030, clothFill);
  if (tailor) {
    // Sewing machines with tailors at work, a rail of stitched clothes, measuring at the counter
    for (let i = 0; i < 3; i++) {
      const T = sub(R, 1.0 + (i % 2) * 1.9, -hd + 1.6 + Math.floor(i / 2) * 1.9, 0);
      table(T, 0, 0, 1.0, 0.55, 0.76, 0x6a4a2a);
      T.box('paint', 0.36, 0.2, 0.16, 0, 0.9, -0.05, 0x1a1a1a);
      T.box('paint', 0.1, 0.12, 0.16, -0.15, 1.04, -0.05, 0x1a1a1a);
      T.cyl('metal', 0.06, 0.06, 0.02, 0.2, 0.93, -0.05, 0xc8ccd0, 10, 0, 0, Math.PI / 2);
      T.box('cloth', 0.5, 0.01, 0.4, -0.1, 0.785, 0.05, pick(cloth));
      chair(T, 0, -0.55, 0, 0x5a3a20, true);
      npc(T, 0, 0, -0.55, 0, { sit: true, pose: 'front', mundu: i !== 1, shirt: 0xe8e0c0, hairStyle: i === 1 ? 'bun' : 'short', saree: i === 1, lower: i === 1 ? 0x2ea043 : undefined });
    }
    R.box('metal', 0.03, 0.03, 3.0, hw - 0.4, 1.95, -0.8, 0xc0c4c8);
    for (let i = 0; i < 9; i++) { R.box('metal', 0.02, 0.1, 0.02, hw - 0.4, 1.88, -2.1 + i * 0.32, 0xc0c4c8); R.box('cloth', 0.08, 0.75, 0.42, hw - 0.4, 1.42, -2.1 + i * 0.32, pick(cloth)); }
    counter(R, -1.2, hd - 2.6, 2.2, 0.8, 0.9, 0x7a5030);
    R.box('paint', 0.9, 0.005, 0.02, -1.2, 0.905, hd - 2.6, 0xe8d020);
    npc(R, -1.2, 0, hd - 3.3, 0, { pose: 'front', mundu: true, shirt: 0xf0f0e8, hold: (P, up, B) => P('paint', B(0.9, 0.005, 0.02), 0, 1.16 + up, 0.34, 0xe8d020) });
    shopSpot(R, -1.2, hd - 1.8, '📏', 'Tailoring counter', 'tailor', 1.6, c.o && c.o.name);
  } else {
    // Long sales counter with an unfurled saree, staff behind it, customers seated in front
    counter(R, 0.4, -0.6, 1.0, 2 * hd - 4.2, 0.9, 0x7a5030);
    R.box('cloth', 0.9, 0.01, 1.4, 0.4, 0.915, -1.4, 0xf3efe2);
    R.box('gold', 0.9, 0.012, 0.08, 0.4, 0.918, -0.72);
    R.box('cloth', 0.9, 0.01, 1.2, 0.4, 0.915, 0.4, 0x7a1f46);
    for (let i = 0; i < 2; i++) npc(R, -0.4, 0, -2 + i * 2.2, Math.PI / 2, { pose: 'front', mundu: i === 0, shirt: 0xe8e0c0, hairStyle: i ? 'long' : 'short', saree: i === 1, lower: i === 1 ? 0xc0392b : undefined });
    for (let i = 0; i < 3; i++) { const z = -2.2 + i * 1.3; R.cyl('paint', 0.18, 0.18, 0.46, 1.35, 0.23, z, 0x8a1c1c, 10); if (i < 2) npc(R, 1.35, 0, z, -Math.PI / 2, { sit: true, seat: 0.47, saree: i === 0, hairStyle: i === 0 ? 'long' : 'short', lower: i === 0 ? 0x2a58d8 : undefined }); }
    // Mannequins by the entrance
    [[-hw + 1.2, hd - 1.8, 0xc0392b], [hw - 1.0, hd - 1.8, 0xf3efe2]].forEach(m => npc(R, m[0], 0, m[1], 0, { skin: 0xf2e8dc, hairStyle: 'none', saree: true, shirt: m[2], lower: m[2] === 0xf3efe2 ? 0xf7f3e6 : m[2] }));
    // Trial room in the back-right corner
    shopSpot(R, 1.3, 1.4, '👗', 'Buy clothes at the counter', 'textile', 1.6, c.o && c.o.name);
    const tx = hw - 0.8, tz = -hd + 0.9;
    R.box('wood', 0.05, 2.2, 1.6, tx - 0.8, 1.1, tz, 0xd8c8a8);
    R.box('metal', 1.6, 0.03, 0.03, tx, 2.1, tz + 0.8, 0xc0c4c8);
    R.box('cloth', 1.1, 1.9, 0.03, tx + 0.22, 1.1, tz + 0.8, 0x7a1f46);
    R.box('mirror', 0.6, 1.4, 0.02, tx, 1.3, -hd + 0.03);
    addSpot(R, tx - 0.3, 0, tz + 1.3, '👗', 'Use the trial room (change outfit)', () => {
      const b = document.getElementById('btn-my-character'); if (b) b.click();
      return ['Trial room', 'Pick any outfit - kasavu saree, mundu, jubba, churidar or casual wear. Close the window when you like the fit.'];
    }, 1.3);
  }
  ceilingFan(R, 0, ch, -1);
};

SHOP_FIT.gold = function (c) {
  const { R, hw, hd, ch } = c;
  const gc = (S, len) => {
    counter(S, 0, 0, len, 0.7, 0.8, 0x5a0d14, true);
    for (let i = 0; i < Math.floor(len / 0.45); i++) {
      const x = -len / 2 + 0.3 + i * 0.45, y = 0.85;
      S.box('cloth', 0.34, 0.02, 0.3, x, y, 0, 0x6a1020);
      if (i % 3 === 0) { torus(S, 'gold', 0.1, 0.012, x, y + 0.03, 0, undefined, Math.PI / 2); torus(S, 'gold', 0.07, 0.01, x, y + 0.03, 0.02, undefined, Math.PI / 2); }
      else if (i % 3 === 1) for (let k = 0; k < 3; k++) torus(S, 'gold', 0.04, 0.008, x - 0.08 + k * 0.08, y + 0.02, 0, undefined, Math.PI / 2);
      else { S.box('cloth', 0.16, 0.22, 0.1, x, y + 0.12, -0.05, 0x6a1020, -0.2); torus(S, 'gold', 0.07, 0.01, x, y + 0.14, 0.01, undefined, 0.2); }
    }
  };
  const L = 2 * hd - 3.6;
  const left = sub(R, -hw + 1.3, -0.6, Math.PI / 2), right = sub(R, hw - 1.3, -0.6, -Math.PI / 2), back = sub(R, 0, -hd + 1.3, 0);
  gc(left, L); gc(right, L); gc(back, 2 * hw - 3.6);
  [[left, -0.9], [left, 1.1], [right, 0.2], [back, 0]].forEach(([S, x], i) => {
    npc(S, x, 0, -0.7, 0, { pose: 'front', shirt: 0xf0f0e8, lower: 0x2a2f45, saree: i === 1, hairStyle: i === 1 ? 'long' : 'short' });
    if (i !== 3) { chair(S, x, 0.75, Math.PI, 0x8a1c1c); if (i !== 2) npc(S, x, 0, 0.75, Math.PI, { sit: true, seat: 0.47, saree: i === 0, hairStyle: i === 0 ? 'bun' : 'short' }); }
  });
  R.box('metal', 0.9, 1.3, 0.7, -hw + 0.55, 0.65, -hd + 0.45, 0x3a4248);                              // safe
  R.cyl('metal', 0.1, 0.1, 0.04, -hw + 0.55, 0.85, -hd + 0.82, 0xc0c4c8, 12, Math.PI / 2);
  R.box('mirror', 0.5, 0.8, 0.02, hw - 0.03, 1.6, hd - 1.8, undefined, 0, -Math.PI / 2);
  for (let i = 0; i < 6; i++) R.cyl('gold', 0.015, 0.015, 0.25 + (i % 2) * 0.1, Math.cos(i) * 0.25, ch - 0.35, -0.5 + Math.sin(i) * 0.25, undefined, 6);
  R.put('lamp', orbGeo(0.12), 0, ch - 0.55, -0.5);
  shopSpot(back, 0, 1.3, '💍', 'Buy jewellery', 'gold', 1.8, c.o && c.o.name);
};

SHOP_FIT.bakery = function (c) {
  const { R, hw, hd } = c;
  // L-shaped glass display: along the left wall and across the back
  const disp = (S, len) => {
    S.box('wood', len, 0.8, 0.7, 0, 0.4, 0, 0xb5541c);
    S.box('cglass', len, 0.6, 0.7, 0, 1.1, 0);
    S.box('metal', len, 0.03, 0.7, 0, 1.41, 0, 0xc8ccd0);
    for (let row = 0; row < 2; row++) {
      S.box('cglass', len - 0.1, 0.01, 0.6, 0, 0.82 + row * 0.28, 0);
      for (let i = 0; i < Math.floor(len / 0.3); i++) {
        const x = -len / 2 + 0.15 + i * 0.3, y = 0.83 + row * 0.28, t = (i + row) % 5;
        if (t === 0) { S.cyl('cloth', 0.12, 0.12, 0.09, x, y + 0.045, 0, 0xf4b5c8, 12); S.cyl('cloth', 0.12, 0.12, 0.02, x, y + 0.1, 0, 0xffffff, 12); }
        else if (t === 1) S.cyl('cloth', 0.12, 0.12, 0.1, x, y + 0.05, 0, 0x5a2a14, 12);
        else if (t === 2) for (let k = 0; k < 3; k++) S.put('cloth', new THREE.CylinderGeometry(0.06, 0.06, 0.09, 3), x - 0.08 + k * 0.08, y + 0.03, 0.05, 0xe0a050, Math.PI / 2);   // puffs
        else if (t === 3) for (let k = 0; k < 4; k++) orb(S, 'cloth', 0.035, x - 0.09 + k * 0.06, y + 0.035, 0.05, 0xf3b81c);   // laddu
        else for (let k = 0; k < 3; k++) S.box('cloth', 0.08, 0.04, 0.12, x - 0.09 + k * 0.09, y + 0.02, 0.03, [0xd8402a, 0x2a8a2a, 0xf0e0a0][k]);   // halwa
      }
    }
    S.col(0, 0, len / 2, 0.35);
  };
  disp(sub(R, -hw + 0.4, -0.3, Math.PI / 2), 2 * hd - 3.4);
  disp(sub(R, 0.5, -hd + 1.5, 0), 2 * hw - 2.4);
  // Bread and biscuits on the back wall, jars on top of the display, a drinks fridge
  shelving(sub(R, 0.5, -hd + 0.2, 0), 0, 0, 2 * hw - 2.4, 2.0, 0.35, 4, 0x8a5a2a, (U, y, i, w) => {
    const n = Math.floor(w / 0.3);
    for (let k = 0; k < n; k++) U.box('cloth', 0.24, 0.13, 0.2, -w / 2 + 0.3 * (k + 0.5), y + 0.065, 0.02, i % 2 ? 0xd8a060 : [0xc0392b, 0x2a58d8, 0xf0b820][k % 3]);
  });
  for (let i = 0; i < 5; i++) { R.cyl('cglass', 0.1, 0.1, 0.3, -1.6 + i * 0.5, 1.58, -hd + 1.5); R.cyl('cloth', 0.08, 0.08, 0.16, -1.6 + i * 0.5, 1.51, -hd + 1.5, [0xf3b81c, 0xd8402a, 0x8a4a2a, 0xffffff, 0x2ea043][i], 8); }
  R.box('paint', 0.7, 1.9, 0.6, hw - 0.4, 0.95, -hd + 0.35, 0xe8ecef);
  R.box('cglass', 0.6, 1.5, 0.02, hw - 0.4, 1.05, -hd + 0.66);
  for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) R.cyl('paint', 0.03, 0.03, 0.22, hw - 0.62 + k * 0.14, 0.5 + r * 0.38, -hd + 0.45, [0xd33a3a, 0x2a8a3a, 0xe8a020, 0x1a1a1a][k], 6);
  R.col(hw - 0.4, -hd + 0.35, 0.35, 0.3);
  npc(R, -hw + 1.3, 0, -1.4, -Math.PI / 2, { pose: 'front', shirt: 0xffffff, lower: 0x2a2f45, cap: 0xffffff });
  cashCounter(R, hw - 1.3, 0.8, -Math.PI / 2, 1.4, { shirt: 0xb5541c });
  npc(R, 0.3, 0, -0.5, -2.6, { hold: HOLD.paper });
  table(R, 1.6, hd - 2.3, 0.6, 0.6, 1.05);
  shopSpot(R, -hw + 1.8, -0.4, '🥐', 'Buy from the bakery', 'bakery', 1.8, c.o && c.o.name);
};

SHOP_FIT.tea = function (c) {
  const { R, o, hw, hd, ch } = c;
  if (/depot/i.test(o.name + ' ' + o.sub)) {
    // Tea depot: shelves of tea packets and tins, a tasting counter
    [[0, -hd + 0.2, 0, 2 * hw - 0.4], [-hw + 0.2, -0.3, Math.PI / 2, 2 * hd - 3], [hw - 0.2, -0.3, -Math.PI / 2, 2 * hd - 3]].forEach(([x, z, yw, len]) =>
      shelving(sub(R, x, z, yw), 0, 0, len, 2.2, 0.35, 5, 0x6a4a2a, (U, y, i, w) => i % 2 ? tins(U, y, w, [0x1f5a3a, 0xc0392b, 0xd4a017, 0x2a2a2a], 0.07, 0.2) : packets(U, y, w, 0.3, [0x2e7d4f, 0xe8a020, 0x7a1f1f, 0xf0e6c0], 0.14, 0.22, 0.08, 0.04)));
    const S = cashCounter(R, 0, 0.3, 0, 2.2, { mundu: true, shirt: 0x2e7d4f });
    for (let i = 0; i < 4; i++) S.cyl('paint', 0.05, 0.04, 0.06, -0.8 + i * 0.25, 0.94, 0.15, 0xffffff, 10);
    shopSpot(R, 0, 1.4, '🍵', 'Buy tea & coffee', 'teadepot', 1.6, c.o && c.o.name);
  } else {
    // Chayakkada: tea counter by the entrance with the boiler, glasses and a snack cabinet
    const S = sub(R, -hw + 1.0, hd - 1.9, Math.PI / 2);
    counter(S, 0, 0, 2.0, 0.7, 0.95, 0x6a4a2a);
    S.cyl('metal', 0.24, 0.26, 0.6, -0.5, 1.28, -0.05, 0xd0d4d8, 14);
    S.cyl('metal', 0.02, 0.02, 0.14, -0.5, 1.05, 0.2, 0xb0b4b8, 6, Math.PI / 2);
    S.cyl('metal', 0.14, 0.12, 0.16, 0.05, 1.03, 0, 0xc8ccd0, 12);
    for (let i = 0; i < 8; i++) S.cyl('cglass', 0.035, 0.03, 0.1, 0.35 + (i % 4) * 0.09, 1.0, -0.12 + Math.floor(i / 4) * 0.1);
    S.box('cglass', 0.6, 0.4, 0.4, 0.6, 1.2, 0.05);
    for (let i = 0; i < 6; i++) orb(S, 'cloth', 0.045, 0.42 + (i % 3) * 0.16, 1.05, -0.05 + Math.floor(i / 3) * 0.13, i % 2 ? 0xc07a2a : 0xe0a040, 0.45);
    npc(S, -0.2, 0, -0.65, 0, { pose: 'up', mundu: true, shirt: 0xf0f0e8, hold: HOLD.glass });
    // Tables with benches and customers
    for (let i = 0; i < 3; i++) {
      const z = -hd + 1.3 + i * 1.8;
      if (z > hd - 2.5) continue;
      const T = sub(R, 0.8, z, 0);
      table(T, 0, 0, 2.0, 0.65, 0.75, 0x8a6a42);
      bench(T, 0, -0.62, 2.0, 0); bench(T, 0, 0.62, 2.0, Math.PI);
      for (let k = 0; k < 3; k++) T.cyl('cglass', 0.035, 0.03, 0.1, -0.6 + k * 0.6, 0.83, (k % 2 ? 0.15 : -0.15));
      npc(T, -0.5, 0, -0.62, 0, { sit: true, seat: 0.46, pose: 'front', mundu: i !== 1 });
      if (i !== 2) npc(T, 0.6, 0, 0.62, Math.PI, { sit: true, seat: 0.46, pose: i ? 'lap' : 'front', hold: i ? HOLD.paper : undefined });
    }
    wallFrame(sub(R, hw - 0.02, -1, -Math.PI / 2), 0, 1.8, 0, 0.5, 0.7, 0xf4e8c8);   // calendar
    R.box('paint', 0.3, 0.18, 0.12, hw - 0.12, 1.9, 1.2, 0x5a3a20);                   // radio on a bracket
    shopSpot(S, -0.2, 1.2, '☕', 'Order chaya & snacks', 'chaya', 1.8, c.o && c.o.name);
  }
  ceilingFan(R, 0.5, ch, -0.5);
};

SHOP_FIT.grocery = function (c) {
  const { R, o, hw, hd, ch } = c;
  const pk = [0xe8dcc0, 0xd33a3a, 0x2a58d8, 0xf0b820, 0x2ea043, 0xe07a1a, 0x8a3ab0, 0xffffff];
  if (/provision/i.test(o.name + ' ' + o.sub)) {
    // Traditional provision store: grain bins and sacks, shopkeeper at a wooden counter, shelves behind
    shelving(sub(R, 0, -hd + 0.2, 0), 0, 0, 2 * hw - 0.4, 2.4, 0.35, 5, 0x6a4a2a, (U, y, i, w) => i % 2 ? tins(U, y, w, [0xd4a017, 0xc0c4c8, 0x2a58d8], 0.09, 0.26) : packets(U, y, w, 0.3, pk, 0.16, 0.24, 0.1, 0.04));
    for (let i = 0; i < 6; i++) {
      const x = -hw + 0.7 + i * 0.95;
      R.box('wood', 0.8, 0.6, 0.7, x, 0.3, -1.4, 0x7a5030);
      heap(R, x, 0.6, -1.4, 0.36, 0.12, 0.3, [0xf4f0e0, 0xe0c890, 0xc8a060, 0xf0e8d0, 0x9a6a3a, 0xe8d020][i]);
    }
    R.col(0, -1.4, hw - 0.3, 0.35);
    for (let i = 0; i < 4; i++) R.cyl('cloth', 0.28, 0.32, 0.65, hw - 0.5, 0.33, 0.6 + i * 0.7, 0xd8c098, 8);
    const S = cashCounter(R, -1.6, 1.2, Math.PI, 2.0, { mundu: true, shirt: 0xe8e0c0 });
    weighingScale(S, 0.4, 0.92, 0);
    shopSpot(R, -1.6, 2.2, '🌾', 'Buy provisions', 'provisions', 1.8, c.o && c.o.name);
  } else {
    // Supermarket: gondola aisles, wall shelving, freezer, billing counter with a scanner
    const aisleLen = 2 * hd - 4.2;
    for (let i = 0; i < 3; i++) {
      const x = -hw + 1.6 + i * ((2 * hw - 3.2) / 2);
      for (const sd of [-1, 1]) shelving(sub(R, x + sd * 0.22, -1.1, sd < 0 ? -Math.PI / 2 : Math.PI / 2), 0, 0, aisleLen, 1.7, 0.4, 4, 0xd8dde2, (U, y, k, w) => packets(U, y, w, 0.3, pk.slice(k, k + 4), 0.14, 0.22, 0.12, 0.03), true);
      R.col(x, -1.1, 0.42, aisleLen / 2);
    }
    shelving(sub(R, 0, -hd + 0.2, 0), 0, 0, 2 * hw - 0.4, 2.2, 0.38, 5, 0xd8dde2, (U, y, i, w) => tins(U, y, w, pk, 0.06, 0.2));
    R.box('paint', 1.6, 0.85, 0.7, hw - 0.9, 0.43, hd - 2.9, 0xe8ecef);
    R.box('cglass', 1.5, 0.02, 0.6, hw - 0.9, 0.87, hd - 2.9);
    R.col(hw - 0.9, hd - 2.9, 0.8, 0.35);
    for (let i = 0; i < 6; i++) R.cyl('cloth', 0.26, 0.3, 0.6, -hw + 0.45, 0.3, hd - 2.9 - i * 0.6, 0xf4f0e0, 8);
    const S = cashCounter(R, -1.6, hd - 2.2, Math.PI, 1.8, { shirt: 0xd33a3a, lower: 0x2a2f45 });
    S.box('paint', 0.12, 0.14, 0.08, 0.3, 0.97, 0.1, 0x151515);
    for (let i = 0; i < 4; i++) R.box('paint', 0.42, 0.22, 0.3, -hw + 1.6, 0.11 + i * 0.09, hd - 1.2, 0xd33a3a);
    npc(R, 0.5, 0, 1.2, 0.4, { pose: 'front', hold: (P, up, B) => P('paint', B(0.4, 0.22, 0.28), 0, 0.95 + up, 0.3, 0xd33a3a) });
    shopSpot(R, -1.6, hd - 1.3, '🛒', 'Shop at the billing counter', 'supermarket', 1.8, c.o && c.o.name);
  }
  tubeLight(R, 0, ch - 0.06, 0, Math.PI / 2);
};

SHOP_FIT.pharmacy = function (c) {
  const { R, o, hw, hd, ch } = c;
  const meds = [0xffffff, 0xf4f4f0, 0x2a8a8a, 0xd33a3a, 0x2a58d8, 0xf0b820, 0x159a7e];
  const medFill = (U, y, i, w) => { const n = Math.floor(w / 0.1); for (let k = 0; k < n; k++) U.box('cloth', 0.08, 0.1 + (k % 3) * 0.03, 0.12, -w / 2 + 0.1 * (k + 0.5), y + 0.06, 0.02, meds[(k * 5 + i) % meds.length]); };
  shelving(sub(R, 0, -hd + 0.2, 0), 0, 0, 2 * hw - 0.4, 2.6, 0.32, 8, 0xf4f4f4, medFill);
  shelving(sub(R, -hw + 0.2, -2.4, Math.PI / 2), 0, 0, 2 * hd - 5.6, 2.6, 0.32, 8, 0xf4f4f4, medFill);
  shelving(sub(R, hw - 0.2, -2.4, -Math.PI / 2), 0, 0, 2 * hd - 5.6, 2.6, 0.32, 8, 0xf4f4f4, medFill);
  // Glass counter across the shop - staff behind, customers in front
  const S = sub(R, 0, 0.2, 0);
  counter(S, 0, 0, 2 * hw - 1.2, 0.6, 0.9, 0xf0f0f0, true);
  for (let i = 0; i < 12; i++) S.box('cloth', 0.12, 0.08, 0.1, -2 + i * 0.36, 0.95, 0, meds[i % meds.length]);
  S.box('paint', 0.28, 0.12, 0.2, 1.8, 0.97, -0.1, 0x2a58d8);   // BP monitor
  const generic = /jan aushadhi|generic/i.test(o.name + ' ' + o.sub);
  npc(S, -1.2, 0, -0.7, 0, { pose: 'front', coat: 0xffffff, hairStyle: 'short' });
  npc(S, 1.0, 0, -0.7, 0, { pose: 'side', coat: 0xffffff, hairStyle: 'bun', saree: true, lower: 0x2a58d8 });
  npc(S, -0.8, 0, 0.8, Math.PI, { hold: HOLD.paper });
  R.box('paint', 0.6, 1.7, 0.55, hw - 0.4, 0.85, hd - 2.2, 0xe8ecef);                  // medicine fridge
  R.box('cglass', 0.52, 1.3, 0.02, hw - 0.4 - 0.29, 1.0, hd - 2.2, undefined, 0, Math.PI / 2);
  R.col(hw - 0.4, hd - 2.2, 0.3, 0.28);
  shopSpot(S, 0, 0.9, '💊', 'Buy medicines', 'pharmacy', 1.8, c.o && c.o.name);
  tubeLight(R, 0, ch - 0.06, -1.5, 0);
};

SHOP_FIT.hardware = function (c) {
  const { R, hw, hd } = c;
  const paint = [0xd33a3a, 0x2a58d8, 0xf0b820, 0x2ea043, 0xffffff, 0xe07a1a, 0x8a3ab0];
  // Pegboard of tools on the back wall
  const P = sub(R, 0, -hd + 0.03, 0);
  P.box('paint', 2 * hw - 1, 1.6, 0.02, 0, 1.6, 0, 0xc8a878);
  for (let i = 0; i < 16; i++) {
    const x = -hw + 1.0 + (i % 8) * ((2 * hw - 2) / 8), y = 2.1 - Math.floor(i / 8) * 0.8, t = i % 4;
    if (t === 0) { P.box('wood', 0.03, 0.34, 0.03, x, y, 0.04, 0x8a5a2a); P.box('metal', 0.12, 0.05, 0.04, x, y + 0.17, 0.04, 0x3a4248); }    // hammer
    else if (t === 1) P.box('metal', 0.04, 0.3, 0.01, x, y, 0.03, 0xb0b4b8, 0, 0, 0.2);                                                        // spanner
    else if (t === 2) { P.box('metal', 0.34, 0.12, 0.004, x, y, 0.03, 0xc8ccd0); P.box('wood', 0.1, 0.1, 0.03, x + 0.2, y, 0.03, 0xd33a3a); } // saw
    else { P.box('rubber', 0.05, 0.2, 0.02, x - 0.03, y, 0.03, 0xd33a3a, 0, 0, 0.15); P.box('rubber', 0.05, 0.2, 0.02, x + 0.03, y, 0.03, 0xd33a3a, 0, 0, -0.15); }   // pliers
  }
  // Paint tins on a rack (left), PVC pipes (right), cement bags and buckets
  shelving(sub(R, -hw + 0.2, -0.8, Math.PI / 2), 0, 0, 2 * hd - 4.4, 2.0, 0.4, 5, 0x5a6a7a, (U, y, i, w) => tins(U, y, w, paint, 0.1, 0.24));
  for (let r = 0; r < 4; r++) for (let k = 0; k < 5 - r; k++) R.cyl('paint', 0.055, 0.055, 3.0, hw - 0.35 - k * 0.12 - r * 0.06, 0.06 + r * 0.1, -1.0, r % 2 ? 0xd8d8d8 : 0x6a7a8a, 8, Math.PI / 2);
  R.col(hw - 0.5, -1.0, 0.35, 1.5);
  for (let i = 0; i < 8; i++) R.box('cloth', 0.6, 0.14, 0.4, -1 + (i % 2) * 0.62, 0.07 + Math.floor(i / 2) * 0.14, hd - 2.8, 0x9a9a92);
  R.col(-0.7, hd - 2.8, 0.62, 0.2);
  for (let i = 0; i < 3; i++) R.cyl('paint', 0.16, 0.13, 0.3, 1.2 + i * 0.4, 0.15, hd - 2.6, paint[i], 10);
  torus(R, 'rubber', 0.3, 0.025, hw - 0.6, 0.06, hd - 3.2, 0x2ea043, Math.PI / 2);
  const S = cashCounter(R, 0.8, 1.0, Math.PI, 1.8, { shirt: 0x204a8a, lower: 0x3a3a3a });
  S.box('metal', 0.4, 0.05, 0.1, -0.4, 0.93, 0.1, 0x9aa0a6);
  shopSpot(R, 0.8, 2.0, '🔨', 'Buy hardware', 'hardware', 1.8, c.o && c.o.name);
};

SHOP_FIT.mobile = function (c) {
  const { R, o, hw, hd } = c;
  const tech = /laptop|digital/i.test(o.name + ' ' + o.sub);
  const phoneCase = (S, len) => {
    counter(S, 0, 0, len, 0.6, 0.95, 0x151c2b, true);
    for (let i = 0; i < Math.floor(len / 0.3); i++) {
      const x = -len / 2 + 0.2 + i * 0.3;
      if (tech && i % 3 === 0) { S.box('paint', 0.3, 0.02, 0.2, x, 0.98, 0, 0x2a2a30); S.box('screen', 0.3, 0.2, 0.01, x, 1.08, -0.1, 0x3a5a8a, -0.3); }
      else { S.box('paint', 0.06, 0.02, 0.06, x, 0.965, 0, 0xc0c4c8); S.box('screen', 0.07, 0.14, 0.008, x, 1.05, 0, 0x2a3a5a, -0.25); }
    }
  };
  const L = sub(R, -hw + 1.2, -0.5, Math.PI / 2), B = sub(R, 0.6, -hd + 1.1, 0);
  phoneCase(L, 2 * hd - 3.6); phoneCase(B, 2 * hw - 2.8);
  for (let i = 0; i < 24; i++) R.box('cloth', 0.12, 0.2, 0.02, -hw + 1.8 + (i % 12) * 0.5, 1.4 + Math.floor(i / 12) * 0.45, -hd + 0.03, [0x1b6dc2, 0xd33a3a, 0x151515, 0xe8a020, 0x2ea043, 0xf08a8a][i % 6]);
  npc(L, -0.6, 0, -0.65, 0, { pose: 'front', shirt: 0x1b6dc2, lower: 0x151515 });
  npc(B, 0.8, 0, -0.65, 0, { pose: 'front', shirt: 0x1b6dc2, lower: 0x151515, hold: HOLD.phone });
  npc(B, 0.4, 0, 0.7, Math.PI, { hold: HOLD.phone });
  // Repair desk on the right: technician with a magnifier lamp
  const T = sub(R, hw - 0.5, 0.2, -Math.PI / 2);
  table(T, 0, 0, 1.4, 0.6, 0.78, 0x3a4248);
  T.box('paint', 0.1, 0.02, 0.18, -0.2, 0.81, 0, 0x101010); T.box('metal', 0.05, 0.02, 0.07, 0.1, 0.81, 0.05, 0x3aa03a);
  T.cyl('metal', 0.015, 0.015, 0.45, 0.4, 1.0, -0.2, 0x9aa0a6, 6, 0.4); T.cyl('cglass', 0.08, 0.08, 0.02, 0.4, 1.2, -0.05);
  plasticChair(T, 0, -0.55, 0, 0x2a58d8);
  npc(T, 0, 0, -0.55, 0, { sit: true, pose: 'front', shirt: 0x2a2f45 });
  R.box('paint', 0.04, 0.6, 1.0, -hw + 0.03, 2.1, 1.4, 0x101010);
  R.box('screen', 0.02, 0.52, 0.9, -hw + 0.06, 2.1, 1.4, 0x3ee0ff);
  shopSpot(B, 0.4, 1.4, tech ? '💻' : '📱', tech ? 'Buy laptops & accessories' : 'Buy phones, accessories & recharge', tech ? 'laptops' : 'mobile', 1.8, c.o && c.o.name);
};

SHOP_FIT.electronics = function (c) {
  const { R, o, hw, hd, ch } = c;
  const comp = /computer|camera|tech/i.test(o.name + ' ' + o.sub);
  if (comp) {
    // Tech Bazaar: computer tables, a camera case, printers
    for (let i = 0; i < 4; i++) {
      const T = sub(R, -hw + 1.3 + (i % 2) * 3.0, -hd + 1.2 + Math.floor(i / 2) * 2.4, 0);
      table(T, 0, 0, 1.6, 0.7, 0.76, 0xe8e8e8);
      T.box('paint', 0.56, 0.36, 0.03, -0.2, 1.05, -0.2, 0x151515); T.box('screen', 0.52, 0.32, 0.01, -0.2, 1.05, -0.18, 0x3a6ab0);
      T.box('paint', 0.05, 0.12, 0.05, -0.2, 0.84, -0.2, 0x151515);
      T.box('paint', 0.44, 0.02, 0.14, -0.2, 0.79, 0.08, 0x2a2a2a);
      T.box('paint', 0.18, 0.4, 0.42, 0.55, 0.98, -0.1, 0x1a1a1a);
    }
    counter(R, hw - 1.0, -0.3, 0.7, 2.6, 0.95, 0x0f3d6e, true);
    for (let i = 0; i < 6; i++) { R.box('paint', 0.14, 0.1, 0.1, hw - 1.0, 1.02, -1.4 + i * 0.44, 0x151515); R.cyl('paint', 0.035, 0.035, 0.07, hw - 1.0, 1.02, -1.4 + i * 0.44 + 0.07, 0x2a2a2a, 8, Math.PI / 2); }
    for (let i = 0; i < 2; i++) R.box('paint', 0.5, 0.3, 0.45, -hw + 0.5, 0.95 + i * 0.35, hd - 2.4, 0xe8e8e8);
    R.col(-hw + 0.5, hd - 2.4, 0.3, 0.25);
    npc(R, hw - 1.7, 0, -0.3, Math.PI / 2, { pose: 'front', shirt: 0x0f3d6e });
    plasticChair(R, -hw + 1.1, -hd + 1.95, Math.PI, 0x151515);
    npc(R, -hw + 1.1, 0, -hd + 1.95, Math.PI, { sit: true, seat: 0.46, pose: 'front' });
    shopSpot(R, hw - 1.9, 0.8, '📷', 'Buy cameras & computers', 'laptops', 1.8, c.o && c.o.name);
  } else {
    // Appliances: TVs on the back wall, fridges on the left, washing machines on the right, split ACs
    const B = sub(R, 0, -hd + 0.05, 0);
    [[-2.6, 1.1, 0.65, 0x3a8ad0], [0, 1.4, 0.8, 0xd08a3a], [2.6, 1.0, 0.6, 0x3ad08a]].forEach(([x, wd, ht, col]) => { B.box('paint', wd + 0.06, ht + 0.06, 0.05, x, 1.8, 0.02, 0x0a0a0a); B.box('screen', wd, ht, 0.01, x, 1.8, 0.05, col); });
    table(B, 0, 0.6, 2.4, 0.5, 0.5, 0x2a2a2a);
    B.box('paint', 1.0, 0.6, 0.05, 0, 0.85, 0.6, 0x0a0a0a); B.box('screen', 0.94, 0.54, 0.01, 0, 0.85, 0.63, 0x5a9ae0);
    for (let i = 0; i < 4; i++) {
      const z = -hd + 2.0 + i * 0.95, dbl = i % 2;
      R.box('paint', 0.75, dbl ? 1.8 : 1.5, 0.7, -hw + 0.45, dbl ? 0.9 : 0.75, z, [0xe8ecef, 0xb0b8c0, 0x8a1c1c, 0xe8ecef][i]);
      R.box('metal', 0.02, 0.4, 0.03, -hw + 0.82, 1.0, z + 0.25, 0xc0c4c8);
    }
    R.col(-hw + 0.45, -hd + 3.4, 0.38, 1.9);
    for (let i = 0; i < 3; i++) {
      const z = -hd + 2.2 + i * 1.0;
      R.box('paint', 0.62, 0.85, 0.6, hw - 0.4, 0.43, z, 0xf2f2f2);
      R.cyl('cglass', 0.2, 0.2, 0.02, hw - 0.72, 0.5, z, undefined, 16, 0, 0, Math.PI / 2);
    }
    R.col(hw - 0.4, -hd + 3.2, 0.32, 1.6);
    for (let i = 0; i < 2; i++) R.box('paint', 0.9, 0.3, 0.22, -1 + i * 2, ch - 0.35, -hd + 0.15, 0xf8f8f8);
    npc(R, 0.5, 0, 0.2, Math.PI, { pose: 'front', shirt: 0x0f3d6e, hold: HOLD.paper });
    npc(R, 0.4, 0, 1.2, 0.2, {});
    shopSpot(R, 0.5, 1.0, '📺', 'Buy electronics & appliances', 'electronics', 1.8, c.o && c.o.name);
  }
  ceilingFan(R, 0, ch, 0);
};

SHOP_FIT.stationery = function (c) {
  const { R, o, hw, hd, ch } = c;
  const txt = o.name + ' ' + o.sub;
  const bookCols = [0xc0392b, 0x2a58d8, 0x2ea043, 0xf0b820, 0x1c1c1c, 0x8a3ab0, 0xe8dcc0, 0x7a1f46];
  if (/xerox|dtp|photocopy/i.test(txt)) {
    // Photocopy & DTP: copiers, a DTP desk, paper reams
    for (let i = 0; i < 2; i++) {
      const x = -hw + 1.0 + i * 1.6;
      R.box('paint', 1.0, 1.0, 0.7, x, 0.5, -hd + 0.6, 0xd8dcd8);
      R.box('paint', 1.0, 0.1, 0.7, x, 1.05, -hd + 0.6, 0x9aa0a6);
      R.box('screen', 0.2, 0.08, 0.1, x + 0.3, 1.12, -hd + 0.85, 0x60a0ff, -0.5);
      R.box('cloth', 0.3, 0.02, 0.21, x - 0.2, 1.12, -hd + 0.6, 0xffffff);
      R.col(x, -hd + 0.6, 0.5, 0.35);
    }
    const T = sub(R, hw - 1.2, -hd + 1.2, 0);
    table(T, 0, 0, 1.6, 0.7, 0.76, 0x6a4a2a);
    T.box('paint', 0.5, 0.34, 0.03, 0, 1.03, -0.2, 0x151515); T.box('screen', 0.46, 0.3, 0.01, 0, 1.03, -0.18, 0x3a6ab0);
    T.box('paint', 0.44, 0.24, 0.35, 0.6, 0.9, -0.05, 0x2a2a2a);
    plasticChair(T, 0, 0.6, Math.PI, 0x2a58d8);
    npc(T, 0, 0, 0.6, Math.PI, { sit: true, seat: 0.46, pose: 'front' });
    for (let i = 0; i < 6; i++) R.box('cloth', 0.3, 0.06, 0.21, -1 + (i % 3) * 0.32, 0.03 + Math.floor(i / 3) * 0.06, -0.6, 0xffffff);
    cashCounter(R, -0.8, 1.2, Math.PI, 1.8, { shirt: 0x8a2a2a });
    shopSpot(R, -0.8, 2.2, '🖨️', 'Photocopy, print & bind', 'xerox', 1.8, c.o && c.o.name);
  } else if (/uniform|student/i.test(txt)) {
    for (const sd of [-1, 1]) {
      R.box('metal', 0.03, 0.03, 2 * hd - 3, sd * (hw - 0.4), 1.9, -0.8, 0xc0c4c8);
      for (let i = 0; i < 12; i++) R.box('cloth', 0.08, 0.7, 0.42, sd * (hw - 0.4), 1.5, -hd + 1 + i * 0.5, i % 3 ? 0xf4f4f0 : 0x22304a);
    }
    shelving(sub(R, 0, -hd + 0.2, 0), 0, 0, 2 * hw - 2, 2.2, 0.4, 4, 0x6a4a2a, (U, y, i, w) => packets(U, y, w, 0.35, [0xd33a3a, 0x2a58d8, 0x2ea043, 0xe07a1a], 0.3, 0.36, 0.2, 0.06));
    cashCounter(R, 0, 0.6, Math.PI, 2.0, { shirt: 0xf0f0e8 });
    npc(R, 1.2, 0, 1.8, 0.4, { k: 0.8, shirt: 0xf4f4f0, lower: 0x22304a });
    shopSpot(R, 0, 1.6, '🎒', 'Buy school supplies', 'uniform', 1.8, c.o && c.o.name);
  } else {
    // Bookshop: bookshelves around the walls, a table of notebooks, a globe
    [[0, -hd + 0.2, 0, 2 * hw - 0.4], [-hw + 0.2, -0.4, Math.PI / 2, 2 * hd - 3.4], [hw - 0.2, -0.4, -Math.PI / 2, 2 * hd - 3.4]].forEach(([x, z, yw, len]) =>
      shelving(sub(R, x, z, yw), 0, 0, len, 2.4, 0.32, 6, 0x6a4a2a, (U, y) => books(U, y, len - 0.1, bookCols)));
    table(R, 0, -0.8, 1.8, 1.0, 0.8, 0x8a5a2a);
    for (let i = 0; i < 8; i++) R.box('cloth', 0.21, 0.02 * (2 + i % 3), 0.3, -0.7 + (i % 4) * 0.46, 0.84, -1.05 + Math.floor(i / 4) * 0.5, bookCols[i]);
    R.cyl('wood', 0.02, 0.06, 0.2, 0.7, 0.92, -0.6, 0x5a3a20, 6); orb(R, 'paint', 0.14, 0.7, 1.15, -0.6, 0x2a78c8);
    cashCounter(R, 1.2, 1.4, Math.PI, 1.6, { shirt: 0x8a2a2a });
    npc(R, -0.8, 0, 0.4, Math.PI, { hold: HOLD.book });
    shopSpot(R, 0, 0.4, '📚', 'Buy books & stationery', 'books', 1.8, c.o && c.o.name);
  }
  tubeLight(R, 0, ch - 0.06, 0, 0);
};

SHOP_FIT.hotel = function (c) {
  const { R, o, hw, hd, ch } = c;
  if (/lodge|rooms available/i.test(o.name + ' ' + o.sub) && !/biriyani|meals|restaurant/i.test(o.sub)) {
    // Lodge reception: desk, key board, sofas, a potted plant
    const S = cashCounter(R, 0, -hd + 1.4, 0, 2.6, { shirt: 0xffffff, lower: 0x151515 });
    S.box('wood', 1.2, 0.8, 0.04, 0, 1.9, -0.9, 0x5a2a12);
    for (let i = 0; i < 12; i++) S.box('metal', 0.04, 0.08, 0.02, -0.5 + (i % 6) * 0.2, 2.1 - Math.floor(i / 6) * 0.3, -0.87, 0xd4a017);
    S.box('paint', 0.25, 0.05, 0.18, -0.9, 0.96, 0, 0x151515);
    for (const sd of [-1, 1]) {
      const T = sub(R, sd * (hw - 0.6), 0.6, sd < 0 ? Math.PI / 2 : -Math.PI / 2);
      T.box('cloth', 1.8, 0.42, 0.75, 0, 0.21, 0, 0x5a2a12); T.box('cloth', 1.8, 0.5, 0.2, 0, 0.65, -0.28, 0x5a2a12);
      T.col(0, 0, 0.9, 0.38);
    }
    table(R, 0, 0.6, 1.0, 0.6, 0.45, 0x3a2412);
    npc(R, -hw + 0.6, 0, 0.1, Math.PI / 2, { sit: true, seat: 0.42, hold: HOLD.paper });
    R.cyl('paint', 0.22, 0.18, 0.4, hw - 0.5, 0.2, hd - 1.8, 0x7a4a24, 10); heap(R, hw - 0.5, 0.4, hd - 1.8, 0.35, 0.7, 0.35, 0x2e7d4f);
    R.box('paint', 0.5, 0.65, 0.3, 1.0, 0.33, 1.4, 0x1c3a6a); R.col(1.0, 1.4, 0.25, 0.15);   // suitcase
    shopSpot(R, 0, -hd + 2.4, '🛎️', 'Reception - book a room', 'lodge', 1.8, c.o && c.o.name);
  } else {
    // Restaurant: tables of diners on banana leaves, waiter, cash counter, wash basin, kitchen hatch
    const tables = [];
    for (let i = 0; i < 2; i++) for (let j = 0; j < 3; j++) tables.push([-hw + 1.6 + i * (hw * 2 - 3.2), -hd + 1.4 + j * 2.1]);
    tables.forEach(([x, z], ti) => {
      if (z > hd - 2.6) return;
      const T = sub(R, x, z, 0);
      table(T, 0, 0, 1.2, 0.8, 0.75, 0x8a6a42);
      for (const [cx, cz, cy] of [[-0.35, -0.6, 0], [0.35, -0.6, 0], [-0.35, 0.6, Math.PI], [0.35, 0.6, Math.PI]]) chair(T, cx, cz, cy, 0x6a4a24, true);
      for (let s = 0; s < 4; s++) {
        const cx = s % 2 ? 0.35 : -0.35, cz = s < 2 ? -0.2 : 0.2;
        T.box('cloth', 0.36, 0.005, 0.28, cx, 0.78, cz, 0x3a8a2a);   // banana leaf
        if ((ti + s) % 3 !== 0) { heap(T, cx, 0.783, cz, 0.08, 0.05, 0.06, 0xf4f0e8); T.cyl('paint', 0.035, 0.035, 0.03, cx + 0.1, 0.8, cz, [0xe8a020, 0x8a3a1a, 0xf0d060][s % 3], 8); }
      }
      if (ti % 2 === 0) npc(T, -0.35, 0, -0.6, 0, { sit: true, seat: 0.46, pose: 'front', mundu: ti === 0 });
      if (ti % 3 !== 2) npc(T, 0.35, 0, 0.6, Math.PI, { sit: true, seat: 0.46, pose: 'front', saree: ti === 1, hairStyle: ti === 1 ? 'long' : 'short' });
    });
    npc(R, 0, 0, -0.2, Math.PI / 2, { pose: 'front', shirt: 0xffffff, lower: 0x151515, hold: HOLD.tray });
    // Kitchen hatch in the back wall with big vessels
    R.box('wood', 1.8, 0.1, 0.5, 0, 1.05, -hd + 0.25, 0x5a3a20);
    R.box('paint', 1.6, 0.9, 0.02, 0, 1.6, -hd + 0.02, 0x1a1410);
    R.cyl('metal', 0.26, 0.22, 0.34, -0.4, 1.27, -hd + 0.25, 0xb0b4b8, 12); R.cyl('metal', 0.22, 0.2, 0.28, 0.4, 1.24, -hd + 0.25, 0x8a8e92, 12);
    const S = cashCounter(R, hw - 1.1, hd - 2.4, Math.PI, 1.4, { mundu: true, shirt: 0xe8e0c0 });
    S.cyl('cglass', 0.07, 0.07, 0.14, -0.4, 0.99, 0.1); S.cyl('cloth', 0.06, 0.06, 0.08, -0.4, 0.96, 0.1, 0x6aa84a, 8);   // fennel jar
    R.box('paint', 0.55, 0.2, 0.4, -hw + 0.25, 0.85, hd - 2.2, 0xf4f4f4); R.box('mirror', 0.02, 0.6, 0.5, -hw + 0.03, 1.5, hd - 2.2);
    wallFrame(sub(R, -hw + 0.02, 0, Math.PI / 2), 0, 2.1, 0, 1.0, 0.7, 0xf4e8c8);   // menu
    shopSpot(R, 0, 0.9, '🍛', 'Order food (or get your fish cooked)', 'restaurant', 1.8, c.o && c.o.name);
    for (const z of [-1.8, 1.0]) ceilingFan(R, 0, ch, z);
  }
};

SHOP_FIT.furniture = function (c) {
  const { R, hw, hd, ch } = c;
  const teak = 0x7a4a24;
  // Sofa set
  const Sf = sub(R, -hw + 0.55, -1.5, Math.PI / 2);
  Sf.box('cloth', 2.0, 0.45, 0.8, 0, 0.3, 0, 0x7a2a1a); Sf.box('cloth', 2.0, 0.5, 0.2, 0, 0.72, -0.3, 0x7a2a1a);
  for (const sx of [-1, 1]) Sf.box('wood', 0.12, 0.62, 0.8, sx * 1.02, 0.31, 0, teak);
  Sf.col(0, 0, 1.08, 0.4);
  table(R, -hw + 1.7, -1.5, 0.6, 1.1, 0.42, teak);
  // Double bed at the back
  const Bd = sub(R, 1.0, -hd + 1.2, 0);
  Bd.box('wood', 1.9, 0.35, 2.1, 0, 0.18, 0.4, teak); Bd.box('cloth', 1.8, 0.2, 2.0, 0, 0.45, 0.4, 0xf4f0e8);
  Bd.box('wood', 1.9, 1.1, 0.08, 0, 0.55, -0.64, teak);
  for (const sx of [-1, 1]) Bd.box('cloth', 0.6, 0.12, 0.35, sx * 0.45, 0.6, -0.35, 0xe8dcc0);
  Bd.col(0, 0.4, 0.95, 1.05);
  // Wardrobe, dining set, easy chair and a hanging swing (oonjal)
  R.box('wood', 1.2, 2.1, 0.6, hw - 0.35, 1.05, -hd + 0.5, teak); R.box('wood', 0.02, 1.9, 0.02, hw - 0.35, 1.05, -hd + 0.2, 0x3a2412, 0, Math.PI / 2);
  R.col(hw - 0.35, -hd + 0.5, 0.3, 0.6);
  table(R, 1.2, 1.2, 1.5, 0.9, 0.76, teak);
  for (const [cx, cz, cy] of [[0.8, 0.55, 0], [1.6, 0.55, 0], [0.8, 1.85, Math.PI], [1.6, 1.85, Math.PI]]) chair(R, cx, cz, cy, teak, true);
  const E = sub(R, -hw + 1.0, 1.2, 1.2);
  E.box('wood', 0.6, 0.04, 0.9, 0, 0.35, 0.1, teak, 0.35); E.box('cloth', 0.5, 0.02, 0.85, 0, 0.37, 0.1, 0x8a6a42, 0.35);
  for (const sx of [-1, 1]) E.box('wood', 0.05, 0.05, 1.1, sx * 0.3, 0.55, 0, teak, -0.15);
  R.box('wood', 1.8, 0.08, 0.6, -1.0, 0.6, hd - 2.6, teak);
  for (const sx of [-1, 1]) R.cyl('metal', 0.008, 0.008, ch - 0.65, -1.0 + sx * 0.8, 0.65 + (ch - 0.65) / 2, hd - 2.6, 0x8a8e92, 4);
  npc(R, 0.2, 0, 0.2, Math.PI * 0.8, { mundu: true, shirt: 0xe8dcc0 });
  shopSpot(R, -1.0, hd - 1.6, '🪑', 'Buy teak furniture', 'furniture', 1.8, c.o && c.o.name);
};

SHOP_FIT.optical = function (c) {
  const { R, hw, hd } = c;
  // Frames display wall, sunglass counter, eye-test corner with chart and phoropter
  const W = sub(R, 0, -hd + 0.03, 0);
  W.box('paint', 2 * hw - 1.2, 1.6, 0.02, 0, 1.6, 0, 0xf4f8fa);
  for (let r = 0; r < 6; r++) for (let k = 0; k < 10; k++) {
    const x = -hw + 1.1 + k * ((2 * hw - 2.2) / 9), y = 1.0 + r * 0.24;
    for (const sx of [-1, 1]) torus(W, 'paint', 0.035, 0.005, x + sx * 0.045, y, 0.04, [0x151515, 0x7a4a24, 0x1a3a5a, 0xc0392b][(r + k) % 4], 0, 0);
  }
  counter(R, 0, -0.6, 3.0, 0.6, 0.95, 0x1a3a5a, true);
  for (let i = 0; i < 8; i++) for (const sx of [-1, 1]) torus(R, 'paint', 0.035, 0.006, -1.2 + i * 0.34 + sx * 0.045, 1.0, -0.6, 0x151515, Math.PI / 2);
  R.box('mirror', 0.3, 0.4, 0.02, 1.2, 1.18, -0.62, undefined, -0.2);
  npc(R, -0.4, 0, -1.3, 0, { pose: 'front', coat: 0xffffff });
  const T = sub(R, hw - 1.0, hd - 2.8, -Math.PI / 2);
  T.box('rubber', 0.55, 0.12, 0.55, 0, 0.47, 0, 0x2a2a30); T.box('rubber', 0.55, 0.7, 0.1, 0, 0.88, -0.24, 0x2a2a30); T.cyl('metal', 0.07, 0.07, 0.4, 0, 0.2, 0, 0x9aa0a6, 8); T.col(0, 0, 0.3, 0.3);
  T.cyl('metal', 0.02, 0.02, 0.9, 0.45, 1.3, 0, 0x9aa0a6, 6); T.box('paint', 0.4, 0.2, 0.08, 0.2, 1.62, 0.28, 0x151515);
  npc(T, 0, 0, 0, 0, { sit: true, seat: 0.53 });
  const chartS = sub(R, -hw + 0.03, hd - 2.8, Math.PI / 2);
  chartS.box('paint', 0.8, 1.1, 0.02, 0, 1.6, 0, 0xffffff);
  for (let r = 0; r < 7; r++) chartS.box('paint', 0.5 - r * 0.06, 0.08 - r * 0.008, 0.005, 0, 2.0 - r * 0.13, 0.012, 0x101010);
  shopSpot(T, 0, 0.9, '👓', 'Eye test & glasses', 'optical', 1.4, c.o && c.o.name);
};

SHOP_FIT.generic = function (c) {
  const { R, hw, hd } = c;
  shelving(sub(R, 0, -hd + 0.2, 0), 0, 0, 2 * hw - 0.4, 2.2, 0.35, 5, 0x6a4a2a, (U, y, i, w) => packets(U, y, w, 0.3, NPC_SHIRTS, 0.16, 0.22, 0.1, 0.04));
  cashCounter(R, 0, 0, 0, 2.0, {});
  shopSpot(R, 0, 0.9, '🛍️', 'Buy at the counter', 'general', 1.8, c.o && c.o.name);
};

function furnishShop(F, o, w, d, h1) {
  const I = frame(F.bx, F.by, F.bz, F.ry, F.sc, 'int');
  const R = sub(I, 0, 0, 0, SHOP_FLOOR);
  const c = { R: R, I: I, F: F, o: o, w: w, d: d, hw: w / 2 - WALL_T, hd: d / 2 - WALL_T, ch: h1 - SHOP_FLOOR };
  if (o.kind === 'civic') return furnishCivic(c);
  tubeLight(R, -c.hw / 2, c.ch - 0.06, -c.hd / 3, Math.PI / 2);
  tubeLight(R, c.hw / 2, c.ch - 0.06, -c.hd / 3, Math.PI / 2);
  (SHOP_FIT[o.kind] || SHOP_FIT.generic)(c);
}

// ======================================================================================================
// Civic buildings
// ======================================================================================================
const KHAKI = 0xb8995c, NAVY = 0x22304a;
function officeDesk(S, x, z, yaw, staff, opt) {
  const D = sub(S, x, z, yaw || 0);
  table(D, 0, 0, 1.3, 0.7, 0.76, (opt && opt.hex) || 0x6a4a2a);
  D.box('paint', 0.46, 0.3, 0.03, 0, 1.0, -0.2, 0x151515); D.box('screen', 0.42, 0.26, 0.01, 0, 1.0, -0.18, 0x3a6ab0);
  D.box('paint', 0.4, 0.02, 0.13, 0, 0.79, 0.05, 0x2a2a2a);
  for (let i = 0; i < 3; i++) D.box('cloth', 0.24, 0.04, 0.32, 0.45, 0.8 + i * 0.045, -0.05, [0xe8d8a8, 0xd8c890, 0xf0e8c8][i]);   // files
  chair(D, 0, -0.62, 0, 0x3a3a40, true);
  if (staff) npc(D, 0, 0, -0.62, 0, Object.assign({ sit: true, seat: 0.47, pose: 'front' }, staff));
  if (!opt || !opt.noVisitor) chair(D, 0.2, 0.7, Math.PI, 0x6a4a2a, true);
  return D;
}
function glassCounterRow(S, len, windows, clerk) {
  // A counter with glass partitions and speaking windows; clerks seated behind (local -z)
  S.box('wood', len, 1.0, 0.6, 0, 0.5, 0, 0x6a4a2a);
  S.box('wood', len + 0.04, 0.04, 0.66, 0, 1.02, 0, 0x4a2c14);
  S.box('cglass', len, 1.0, 0.03, 0, 1.55, 0);
  S.box('metal', len, 0.06, 0.08, 0, 2.08, 0, 0xb8bec4);
  S.col(0, 0, len / 2, 0.3);
  for (let i = 0; i < windows; i++) {
    const x = -len / 2 + len * (i + 0.5) / windows;
    S.box('metal', 0.05, 1.0, 0.06, x - len / windows / 2, 1.55, 0, 0xb8bec4);
    S.box('paint', 0.4, 0.12, 0.02, x, 1.12, 0.03, 0x1a1a1a);   // speaking slot
    if (clerk) { chair(S, x, -0.75, 0, 0x3a3a40, true); npc(S, x, 0, -0.75, 0, Object.assign({ sit: true, seat: 0.47, pose: 'front' }, clerk(i))); }
  }
}
const CIVIC = {};
CIVIC.police = function (c) {
  const { R, hw, hd, ch } = c;
  const cop = (o) => Object.assign({ shirt: KHAKI, lower: KHAKI, cap: KHAKI, shoe: 0x101010 }, o || {});
  // Front desk with the duty officer, visitors' chairs
  const S = sub(R, -1.5, hd - 3.0, 0);
  counter(S, 0, 0, 2.4, 0.7, 1.0, 0x5a3a20);
  S.box('cloth', 0.3, 0.04, 0.4, -0.6, 1.03, 0, 0x2a58d8);   // register
  S.box('paint', 0.22, 0.15, 0.18, 0.7, 1.08, -0.1, 0x3a4a3a);   // wireless set
  npc(S, 0, 0, -0.7, 0, cop({ pose: 'front' }));
  for (let i = 0; i < 3; i++) plasticChair(R, 1.8 + i * 0.6, hd - 1.9, Math.PI, 0x2a58d8);
  npc(R, 2.4, 0, hd - 1.9, Math.PI, { sit: true, seat: 0.44, mundu: true });
  // SHO's desk, steel almirahs full of files, notice board, flag
  officeDesk(R, 2.2, -hd + 1.6, 0, cop({}), { hex: 0x3a2412 });
  for (let i = 0; i < 3; i++) R.box('metal', 0.9, 1.9, 0.45, hw - 0.3, 0.95, -hd + 3.2 + i * 1.0, 0x7a8288, 0, -Math.PI / 2);
  R.col(hw - 0.3, -hd + 4.2, 0.25, 1.5);
  wallFrame(sub(R, 0, -hd + 0.02, 0), 0, 1.8, 0, 1.4, 0.9, 0xe8e0c8);
  R.cyl('metal', 0.02, 0.02, 1.8, hw - 0.5, 0.9, -hd + 0.5, 0xc0c4c8, 6); R.box('cloth', 0.6, 0.4, 0.01, hw - 0.2, 1.6, -hd + 0.5, 0x1c4fa8);
  // Lock-up with bars in the back-left corner
  const lx0 = -hw, lx1 = -hw + 2.4, lz0 = -hd, lz1 = -hd + 2.6;
  R.box('wall', 0.2, c.ch, lz1 - lz0, lx1, c.ch / 2, (lz0 + lz1) / 2, 0xdfe8f2);
  for (let i = 0; i < 12; i++) R.cyl('metal', 0.02, 0.02, c.ch - 0.1, lx0 + 0.1 + i * 0.19, (c.ch - 0.1) / 2, lz1, 0x5a6268, 6);
  R.box('metal', lx1 - lx0, 0.06, 0.06, (lx0 + lx1) / 2, 2.0, lz1, 0x5a6268);
  R.col((lx0 + lx1) / 2, lz1, (lx1 - lx0) / 2, 0.08); R.col(lx1, (lz0 + lz1) / 2, 0.1, (lz1 - lz0) / 2);
  bench(R, -hw + 1.2, -hd + 0.4, 1.8, 0, 0x5a5a5a);
  addSpot(S, 0, 0, 1.2, '👮', 'File a complaint', () => ['Complaint registered', 'The duty officer writes it down: "Lost mobile phone near the bus stand." FIR no. ' + (1200 + ((irng() * 700) | 0)) + '/2026. "We will call you."'], 1.8);
  for (const z of [-1.5, 1.5]) ceilingFan(R, 0, ch, z);
};
CIVIC.fire = function (c) {
  const { R, I, hw, hd, ch } = c;
  // Fire engine parked in the bay, equipment racks, extinguishers, duty desk
  const p = I.w(-1.5, 0.3);
  const yaw = c.F.ry;
  const M4 = new THREE.Matrix4().compose(new THREE.Vector3(p[0], I.by + SHOP_FLOOR, p[1]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
  vehicleParts('van', 0xc8201e).forEach(pt => tbPush('int|' + pt.key, pt.geo, new THREE.Matrix4().multiplyMatrices(M4, pt.matrix), pt.color ? pt.color.getHex() : undefined));
  R.col(-1.5, 0.3, 1.1, 3.3);
  const rack = sub(R, hw - 0.3, -1.2, -Math.PI / 2);
  rack.box('metal', 3.4, 0.05, 0.4, 0, 1.8, 0, 0x7a8288);
  for (let i = 0; i < 6; i++) {
    const x = -1.5 + i * 0.6;
    rack.box('metal', 0.02, 0.12, 0.02, x, 1.72, 0.1, 0xc0c4c8);
    rack.box('cloth', 0.42, 0.9, 0.14, x, 1.2, 0.12, 0x4a3a1a);                 // turnout coat
    rack.sph('paint', 0.14, x, 1.95, 0, 0xe8c020, 0.8);                          // helmet
    rack.box('rubber', 0.24, 0.35, 0.18, x, 0.18, 0.12, 0x151515);              // boots
  }
  rack.col(0, 0.1, 1.8, 0.25);
  for (let i = 0; i < 4; i++) { R.cyl('paint', 0.09, 0.09, 0.55, -hw + 0.3, 0.28, -hd + 1.2 + i * 0.35, 0xc8201e, 10); R.cyl('paint', 0.04, 0.04, 0.08, -hw + 0.3, 0.6, -hd + 1.2 + i * 0.35, 0x151515, 6); }
  for (let i = 0; i < 3; i++) torus(R, 'rubber', 0.3, 0.05, -hw + 0.6 + i * 0.1, 0.35 + i * 0.1, -hd + 3.2, 0xb82010, 0, Math.PI / 2);
  officeDesk(R, hw - 1.4, hd - 2.4, Math.PI, { shirt: 0x2a3a5a, lower: 0x2a3a5a });
  addSpot(R, hw - 1.4, 0, hd - 3.5, '🚒', 'Talk to the fire officer', () => ['Fire & Rescue', 'In any fire, flood or accident dial 101. "Never use water on an electrical or oil fire - use the CO2 extinguisher." Engine ready in 60 seconds.'], 1.8);
};
CIVIC.hospital = function (c) {
  const { R, hw, hd, ch } = c;
  const nurse = { shirt: 0xffffff, lower: 0xffffff, hairStyle: 'bun', saree: true, shoe: 0xffffff };
  // OP counter by the entrance, waiting benches, doctor's cubicle, beds behind curtains, wheelchair
  const S = sub(R, -hw + 1.6, hd - 2.6, Math.PI / 2);
  glassCounterRow(S, 2.2, 2, (i) => i ? nurse : { coat: 0xffffff });
  for (let r = 0; r < 2; r++) {
    const T = sub(R, 1.0, 1.4 - r * 1.5, Math.PI);
    bench(T, 0, 0, 3.0, 0, 0x2a6ab0); T.col(0, 0, 1.5, 0.2);
    for (let k = 0; k < 3; k++) if ((k + r) % 2 === 0) npc(T, -1.0 + k * 1.0, 0, 0, 0, { sit: true, seat: 0.44, mundu: k === 0, saree: k === 2, hairStyle: k === 2 ? 'long' : 'short' });
  }
  // Doctor's cubicle (back-right)
  const cx = hw - 2.2, cz = -hd + 1.6;
  R.box('wall', 0.1, 2.2, 3.0, cx - 1.8, 1.1, cz, 0xe8f0ee);
  officeDesk(R, cx, cz - 0.4, 0, { coat: 0xffffff, hold: (P, up, B) => P('metal', B(0.02, 0.3, 0.02), 0, 1.3 + up, 0.1, 0x3a3a3a) });
  npc(R, cx + 0.2, 0, cz + 0.3, Math.PI, { sit: true, seat: 0.47, mundu: true });
  // Examination beds behind curtains (back-left)
  for (let i = 0; i < 2; i++) {
    const B = sub(R, -hw + 1.6 + i * 2.2, -hd + 1.2, 0);
    B.box('metal', 0.9, 0.6, 1.9, 0, 0.3, 0.2, 0xc8ccd0); B.box('cloth', 0.85, 0.12, 1.85, 0, 0.66, 0.2, 0xf4f4f4); B.box('cloth', 0.55, 0.1, 0.3, 0, 0.77, -0.5, 0xffffff);
    B.col(0, 0.2, 0.45, 0.95);
    B.box('metal', 1.6, 0.03, 0.03, 0, 2.2, 1.25, 0xc0c4c8); B.box('cloth', 1.0, 1.9, 0.03, -0.3, 1.2, 1.25, 0x7ab8c8);
    B.cyl('metal', 0.01, 0.01, 1.8, 0.6, 0.9, -0.4, 0xc0c4c8, 4); B.box('cglass', 0.1, 0.18, 0.04, 0.6, 1.75, -0.4);   // IV stand
    if (i === 0) { npc(B, 0, 0.74, 0.3, 0, { sit: true, seat: 0.05, lower: 0x8ab0d0, shirt: 0x8ab0d0 }); }
  }
  // Wheelchair
  const W = sub(R, 3.2, hd - 2.0, -0.5);
  torus(W, 'rubber', 0.3, 0.02, -0.3, 0.3, 0, 0x2a2a2a, 0, Math.PI / 2); torus(W, 'rubber', 0.3, 0.02, 0.3, 0.3, 0, 0x2a2a2a, 0, Math.PI / 2);
  W.box('cloth', 0.5, 0.04, 0.45, 0, 0.5, 0, 0x1a3a6a); W.box('cloth', 0.5, 0.45, 0.04, 0, 0.75, -0.22, 0x1a3a6a);
  shopSpot(S, 0, 1.2, '🏥', 'OP ticket counter', 'hospital', 1.8, c.o && c.o.name);
  for (const x of [-3, 3]) ceilingFan(R, x, ch, 0);
};
CIVIC.school = function (c) {
  const { R, hw, hd, ch } = c;
  // Blackboard on the back wall, teacher, rows of desks with students in uniform, charts
  const B = sub(R, 0, -hd + 0.03, 0);
  B.box('wood', 4.2, 1.3, 0.04, 0, 1.6, 0, 0x5a3a20); B.box('paint', 4.0, 1.15, 0.02, 0, 1.6, 0.03, 0x1f3a2a);
  for (let i = 0; i < 4; i++) B.box('paint', 1.2 + (i % 2) * 0.8, 0.03, 0.005, -1.0 + (i % 2) * 0.4, 1.95 - i * 0.2, 0.045, 0xf0f0e8);
  table(R, -2.6, -hd + 1.4, 1.2, 0.6, 0.76, 0x6a4a2a);
  npc(R, 0.8, 0, -hd + 0.8, Math.PI * 0.1, { pose: 'up', saree: true, hairStyle: 'bun', lower: 0x7a1f46 });
  for (let r = 0; r < 4; r++) for (let k = 0; k < 3; k++) {
    const x = -hw + 2.2 + k * ((2 * hw - 4.4) / 2), z = -hd + 3.0 + r * 1.6;
    if (z > hd - 1.8) continue;
    const D = sub(R, x, z, 0);
    D.box('wood', 2.0, 0.05, 0.45, 0, 0.7, -0.35, 0x8a6a42); D.box('wood', 2.0, 0.65, 0.05, 0, 0.35, -0.55, 0x6a4a2a);
    bench(D, 0, 0.1, 2.0, 0, 0x6a4a2a);
    D.col(0, -0.2, 1.0, 0.45);
    for (let s = 0; s < 3; s++) if ((r + k + s) % 4 !== 0) npc(D, -0.65 + s * 0.65, 0, 0.1, Math.PI, { sit: true, seat: 0.44, k: 0.8, pose: 'front', shirt: 0xf4f4f0, lower: NAVY, hairStyle: (s + r) % 2 ? 'long' : 'short' });
  }
  // Charts and a map on the side walls
  wallFrame(sub(R, -hw + 0.02, -1.5, Math.PI / 2), 0, 1.8, 0, 1.4, 1.0, 0x9ad0a0);
  wallFrame(sub(R, hw - 0.02, -1.5, -Math.PI / 2), 0, 1.8, 0, 1.2, 0.9, 0xf0e0a0);
  addSpot(R, 0, 0, hd - 1.4, '🏫', 'Sit in on a class', () => ['Class in session', pick(['Malayalam: the students recite "Kerala, Keralam..." - a poem by Vallathol.', 'Science: "Teak (Tectona grandis) was first planted in Nilambur in 1846 by H.V. Conolly."', 'Maths: 7 x 8 = 56. Homework is page 42!'])], 2.2);
  for (const x of [-3.5, 0, 3.5]) ceilingFan(R, x, ch, 0);
};
CIVIC.post = function (c) {
  const { R, hw, hd, ch } = c;
  const S = sub(R, 0, -0.6, 0);
  glassCounterRow(S, 2 * hw - 1.6, 3, (i) => ({ shirt: [0xe8e0c8, 0xf0f0e8, 0xd8c8a8][i], saree: i === 1, hairStyle: i === 1 ? 'long' : 'short' }));
  // Pigeon-hole sorting rack, mail bags, parcel scale, the red post box by the door, a queue
  const P = sub(R, 0, -hd + 0.25, 0);
  P.box('wood', 3.0, 1.6, 0.4, 0, 1.3, 0, 0x7a5030);
  for (let r = 0; r < 5; r++) for (let k = 0; k < 10; k++) P.box('wood', 0.26, 0.26, 0.02, -1.35 + k * 0.3, 0.7 + r * 0.3, 0.19, 0x3a2412);
  P.col(0, 0, 1.5, 0.2);
  for (let i = 0; i < 3; i++) heap(R, -hw + 0.6 + i * 0.6, 0, -hd + 1.4, 0.3, 0.55, 0.25, 0xd8c8a0);
  weighingScale(R, hw - 1.0, 1.03, -0.6);
  R.cyl('paint', 0.25, 0.25, 1.2, hw - 0.6, 0.6, hd - 1.2, 0xc8201e, 14); R.cyl('paint', 0.28, 0.28, 0.12, hw - 0.6, 1.26, hd - 1.2, 0xc8201e, 14);
  R.box('paint', 0.3, 0.04, 0.02, hw - 0.6, 1.0, hd - 1.2 + 0.25, 0x151515);
  R.col(hw - 0.6, hd - 1.2, 0.3, 0.3);
  for (let i = 0; i < 3; i++) npc(R, -1.2 + i * 0.1, 0, 0.3 + i * 0.7, Math.PI, { hold: i === 0 ? HOLD.paper : undefined, mundu: i === 1 });
  shopSpot(R, 0.8, 0.3, '✉️', 'Post office counter', 'post', 1.8, c.o && c.o.name);
  ceilingFan(R, 0, ch, 1.5);
};
CIVIC.kseb = function (c) {
  const { R, hw, hd, ch } = c;
  const S = sub(R, -1.6, 0.6, 0);
  glassCounterRow(S, 3.0, 2, (i) => ({ shirt: [0xe8f0f0, 0xf0e8d8][i] }));
  for (let i = 0; i < 2; i++) officeDesk(R, 2.0, -hd + 1.4 + i * 2.2, 0, { shirt: 0xe8e8e0 }, { noVisitor: true });
  // Meter board with dials and switchgear on the left wall
  const M = sub(R, -hw + 0.03, -2.2, Math.PI / 2);
  M.box('paint', 2.0, 1.2, 0.03, 0, 1.6, 0, 0x3a4a5a);
  for (let i = 0; i < 6; i++) { M.box('paint', 0.22, 0.3, 0.06, -0.75 + i * 0.3, 1.7, 0.03, 0xe8e8e8); M.box('screen', 0.14, 0.05, 0.01, -0.75 + i * 0.3, 1.74, 0.065, 0xff6040); }
  for (let i = 0; i < 3; i++) npc(R, -1.6 + i * 0.05, 0, 1.6 + i * 0.7, Math.PI, { mundu: i !== 1, hold: i === 0 ? HOLD.paper : undefined });
  shopSpot(R, -1.6, 1.6, '💡', 'Pay the electricity bill', 'kseb', 1.8, c.o && c.o.name);
  ceilingFan(R, 0, ch, 0);
};
CIVIC.bank = function (c) {
  const { R, hw, hd, ch } = c;
  const S = sub(R, 0, -1.0, 0);
  glassCounterRow(S, 2 * hw - 1.4, 3, (i) => ({ shirt: [0xe8f0f8, 0xf4f0e8, 0xe8e8f0][i], lower: 0x2a2f45, saree: i === 2, hairStyle: i === 2 ? 'long' : 'short' }));
  // Waiting chairs, token display, the ATM by the entrance, the vault door behind the tellers
  for (let i = 0; i < 4; i++) plasticChair(R, -2.6 + i * 0.6, hd - 2.8, 0, 0x2a58d8);
  npc(R, -2.0, 0, hd - 2.8, 0, { sit: true, seat: 0.44, hold: HOLD.paper });
  R.box('paint', 0.8, 0.4, 0.05, 0, 2.4, -1.0, 0x151515); R.box('screen', 0.72, 0.32, 0.01, 0, 2.4, -0.97, 0xff3030);
  const A = sub(R, hw - 0.4, hd - 1.8, -Math.PI / 2);
  A.box('paint', 0.7, 1.7, 0.6, 0, 0.85, 0, 0x1c3a6a); A.box('screen', 0.36, 0.28, 0.01, 0, 1.3, 0.31, 0x40a0ff, -0.15); A.box('paint', 0.3, 0.12, 0.1, 0, 1.02, 0.33, 0x2a2a2a);
  A.col(0, 0, 0.35, 0.3);
  const V = sub(R, 0, -hd + 0.05, 0);
  V.box('metal', 2.0, 2.2, 0.1, 0, 1.1, 0, 0x6a7278); V.cyl('metal', 0.7, 0.7, 0.12, 0, 1.2, 0.06, 0x9aa0a6, 20, Math.PI / 2); V.cyl('metal', 0.12, 0.12, 0.18, 0, 1.2, 0.12, 0xc0c4c8, 10, Math.PI / 2);
  addSpot(A, 0, 0, 0.9, '🏧', 'Use the ATM', () => (typeof ADS !== 'undefined' && ADS.enabled) ? (atmWithAds(), null) : ['ATM', 'Your account balance is ' + rupees(0) + '. Nilambur runs on cash - you have ' + fmtRs(econ.cash) + ' in your pocket. Earn more from the 💼 Jobs board.'], 1.4);
  addSpot(R, -1.0, 0, 0.4, '🏦', 'Talk to the cashier', () => ['Nilambur Co-op Bank', 'Fixed deposit rate 7.5% for one year. "Locker available on the first floor - bring two photos and your Aadhaar."'], 1.6);
  ceilingFan(R, 0, ch, 1.5);
};
CIVIC.theatre = function (c) {
  const { R, hw, hd, ch } = c;
  // Screen on the back wall, stepped rows of red seats, ticket booth by the door, an audience
  R.box('paint', 2 * hw - 1.0, ch - 0.8, 0.05, 0, ch / 2 + 0.2, -hd + 0.05, 0x151515);
  R.box('screen', 2 * hw - 1.4, ch - 1.2, 0.02, 0, ch / 2 + 0.2, -hd + 0.09, 0xd8c8a0);
  for (let r = 0; r < 4; r++) {
    const z = -hd + 3.0 + r * 1.05, y = r * 0.15;
    if (r) R.box('conc', 2 * hw, y, 1.05, 0, y / 2, z, 0x6a3a2a);
    for (let k = 0; k < 8; k++) {
      const x = -hw + 1.1 + k * ((2 * hw - 2.2) / 7);
      if (Math.abs(x) < 0.5) continue;
      const Sx = sub(R, x, z, Math.PI, y);
      Sx.box('cloth', 0.5, 0.1, 0.45, 0, 0.44, 0, 0xa01818); Sx.box('cloth', 0.5, 0.6, 0.08, 0, 0.78, -0.24, 0xa01818);
      if ((r * 3 + k) % 4 === 1) npc(Sx, 0, 0, 0, 0, { sit: true, seat: 0.47, saree: k % 3 === 0, hairStyle: k % 3 === 0 ? 'long' : 'short' });
    }
    R.col(-hw / 2 - 0.25, z, hw / 2 - 0.6, 0.3); R.col(hw / 2 + 0.25, z, hw / 2 - 0.6, 0.3);
  }
  const T = sub(R, hw - 1.1, hd - 1.8, -Math.PI / 2);
  T.box('wood', 1.4, 1.1, 0.6, 0, 0.55, 0, 0x7a1f1f); T.box('cglass', 1.4, 0.8, 0.03, 0, 1.5, 0.3);
  npc(T, 0, 0, -0.6, 0, { sit: true, seat: 0.5, pose: 'front' });
  T.col(0, 0, 0.7, 0.3);
  shopSpot(R, 0, hd - 2.0, '🎬', 'Buy a film ticket & snacks', 'theatre', 1.8, c.o && c.o.name);
};
CIVIC.depot = function (c) {
  const { R, hw, hd, ch } = c;
  const S = sub(R, -hw + 3.0, -hd + 0.9, 0);
  glassCounterRow(S, 4.4, 2, (i) => ({ shirt: KHAKI, lower: KHAKI }));
  // Big timetable board, waiting benches with passengers and luggage
  const B = sub(R, 3.0, -hd + 0.03, 0);
  B.box('paint', 5.0, 1.4, 0.03, 0, 1.9, 0, 0x0b3d91);
  for (let i = 0; i < 7; i++) { B.box('paint', 1.6, 0.06, 0.005, -1.4, 2.45 - i * 0.16, 0.02, 0xffffff); B.box('paint', 0.6, 0.06, 0.005, 1.6, 2.45 - i * 0.16, 0.02, 0xffd166); }
  for (let r = 0; r < 2; r++) {
    const T = sub(R, 2.6, -0.4 + r * 1.6, Math.PI);
    bench(T, 0, 0, 4.0, 0, 0x2a6ab0); T.col(0, 0, 2.0, 0.2);
    for (let k = 0; k < 4; k++) if ((k + r) % 2 === 0) npc(T, -1.5 + k * 1.0, 0, 0, 0, { sit: true, seat: 0.44, mundu: k === 0, saree: k === 2, hairStyle: k === 2 ? 'long' : 'short' });
    R.box('paint', 0.5, 0.35, 0.25, 0.8 + r * 2.6, 0.18, 0.4 + r * 1.6, 0x5a2a12);
  }
  npc(R, -2.0, 0, 1.2, 0.5, { shirt: KHAKI, lower: KHAKI, hold: (P, up, B) => P('paint', B(0.14, 0.2, 0.06), 0.2, 1.05 + up, 0.3, 0x2a2a2a) });   // conductor with ticket machine
  shopSpot(S, 0, 1.2, '🚌', 'Bus tickets & reservation', 'busdepot', 1.8, c.o && c.o.name);
  for (const x of [-5, 0, 5]) ceilingFan(R, x, ch, 0);
};
CIVIC.office = function (c) {
  const { R, hw, hd, ch } = c;
  for (let i = 0; i < 3; i++) officeDesk(R, -hw + 1.8 + i * 2.2, -hd + 1.5, 0, {});
  ceilingFan(R, 0, ch, 0);
};
function furnishCivic(c) {
  const n = c.o.name.toUpperCase();
  const key = /POLICE/.test(n) ? 'police' : /FIRE/.test(n) ? 'fire' : /HOSPITAL/.test(n) ? 'hospital' : /SCHOOL/.test(n) ? 'school'
    : /POST/.test(n) ? 'post' : /KSEB/.test(n) ? 'kseb' : /BANK/.test(n) ? 'bank' : /THEATRE/.test(n) ? 'theatre' : /KSRTC/.test(n) ? 'depot' : 'office';
  for (let i = -1; i <= 1; i += 2) tubeLight(c.R, i * c.hw / 2, c.ch - 0.06, 0, Math.PI / 2);
  CIVIC[key](c);
}

// ======================================================================================================
// Places of worship (their hollow shells are built in town.js; these add what's inside)
// ======================================================================================================
function nilavilakku(T, x, y, z, h) {   // Kerala brass oil lamp
  h = h || 1.2;
  T.cyl('gold', 0.16, 0.2, 0.05, x, y + 0.025, z, undefined, 10);
  T.cyl('gold', 0.025, 0.035, h, x, y + h / 2, z, undefined, 8);
  T.cyl('gold', 0.12, 0.06, 0.05, x, y + h * 0.55, z, undefined, 10);
  T.cyl('gold', 0.16, 0.08, 0.06, x, y + h, z, undefined, 10);
  for (let i = 0; i < 5; i++) T.put('lamp', orbGeo(0.018, 1.8), x + Math.cos(i * 1.257) * 0.13, y + h + 0.06, z + Math.sin(i * 1.257) * 0.13);
}
function furnishTemple(F, W, D) {
  const I = frame(F.bx, F.by, F.bz, F.ry, F.sc, 'int');
  // Inside the sanctum (sreekovil): the deity on a pedestal, lamps, garlands - seen through the door
  const S = sub(I, 0, -1, 0, 0.7);
  S.box('conc', 1.2, 0.5, 0.8, 0, 0.25, -1.8, 0x5a5048);
  S.cyl('paint', 0.18, 0.24, 0.9, 0, 0.95, -1.8, 0x1a1a1c, 10);
  S.put('paint', orbGeo(0.14, 1.2), 0, 1.52, -1.8, 0x1a1a1c);
  S.cyl('gold', 0.06, 0.13, 0.28, 0, 1.78, -1.8, undefined, 8);
  torus(S, 'cloth', 0.22, 0.03, 0, 1.2, -1.66, 0xf0a020, 0.3);
  torus(S, 'cloth', 0.26, 0.025, 0, 1.08, -1.66, 0xf4f0e0, 0.3);
  for (const sx of [-1, 1]) nilavilakku(S, sx * 0.8, 0, -1.4, 1.1);
  for (let i = 0; i < 7; i++) S.put('lamp', orbGeo(0.02, 1.6), -0.9 + i * 0.3, 0.9, -2.4);
  npc(S, 0.9, 0, -0.4, Math.PI * 0.9, { mundu: true, shirt: 0xb07a50, skin: 0xb07a50, hairStyle: 'bun', pose: 'front' });   // priest (bare-chested)
  // Brass barrier at the sanctum door: devotees pray from outside, as in a real Kerala temple
  const B = sub(I, 0, 2.55, 0, 0.7);
  B.cyl('gold', 0.025, 0.025, 1.8, 0, 0.75, 0, undefined, 8, 0, 0, Math.PI / 2);
  for (const sx of [-1, 1]) B.cyl('gold', 0.03, 0.03, 0.8, sx * 0.9, 0.4, 0, undefined, 8);
  B.col(0, 0, 0.9, 0.1);
  // Mandapam: a hanging bell, a big lamp, the offering box; devotees in the courtyard
  const M = sub(I, 0, 2.95, 0, 0.7);
  M.cyl('gold', 0.005, 0.005, 0.7, 0.9, 2.2, 0, undefined, 4); M.cyl('gold', 0.06, 0.16, 0.24, 0.9, 1.75, 0, undefined, 10);
  nilavilakku(M, -0.9, 0, 0.2, 1.4);
  M.box('wood', 0.5, 0.5, 0.4, 1.6, 0.25, 0.3, 0x5a2a12); M.box('gold', 0.3, 0.02, 0.04, 1.6, 0.51, 0.3);
  const C = sub(I, 0, 0, 0);
  [[-3, 4.8, 0, 1], [2.6, 5.2, 0.4, 0], [-1.2, 5.6, -0.2, 1], [5.6, 1.0, 1.3, 1]].forEach(([x, z, yw, woman]) =>
    npc(C, x, 0, z, Math.PI + yw, { pose: 'pray', saree: !!woman, mundu: !woman, shirt: woman ? pick([0xc0392b, 0x2a58d8, 0xf0b820]) : 0xf3efe2, hairStyle: woman ? 'long' : 'short', shoe: woman ? 0xb07a50 : 0xb07a50 }));
  addSpot(M, 0, 0, 0, '🔔', 'Ring the bell and pray', () => { chime([523, 784, 1046], 3.0); return ['Sree Nilambur Temple', 'The priest gives you prasadam - sandal paste and a tulsi leaf. Deeparadhana at 6:30 pm; footwear is left at the gate.']; }, 2.0);
}
function furnishChurch(F, w, d) {
  const I = frame(F.bx, F.by, F.bz, F.ry, F.sc, 'int');
  const R = sub(I, 0, 0, 0, 0.5);
  const hw = w / 2 - 0.3, hd = d / 2 - 0.3;
  // Sanctuary at the back: raised step, altar with white cloth, crucifix, candles, tabernacle
  R.box('wood', 2 * hw, 0.3, 2.6, 0, 0.15, -hd + 1.3, 0x7a4a24);
  R.box('conc', 2.0, 0.95, 0.8, 0, 0.3 + 0.475, -hd + 1.0, 0xf4f0e6); R.box('cloth', 2.1, 0.02, 0.9, 0, 1.26, -hd + 1.0, 0xffffff); R.box('gold', 2.1, 0.08, 0.02, 0, 1.2, -hd + 1.46);
  R.col(0, -hd + 1.0, 1.0, 0.4);
  R.box('wood', 0.14, 2.2, 0.08, 0, 3.6, -hd + 0.06, 0x5a3a20); R.box('wood', 1.2, 0.14, 0.08, 0, 4.1, -hd + 0.06, 0x5a3a20);
  R.box('gold', 0.3, 0.3, 0.25, 0, 1.42, -hd + 0.75);
  for (const sx of [-1, 1]) { R.cyl('gold', 0.03, 0.05, 0.4, sx * 0.7, 1.47, -hd + 1.0, undefined, 8); R.put('lamp', orbGeo(0.025, 1.8), sx * 0.7, 1.72, -hd + 1.0); }
  const lec = sub(R, 2.0, -hd + 2.4, 0.4);
  lec.box('wood', 0.5, 1.1, 0.4, 0, 0.85, 0, 0x5a3a20); lec.box('wood', 0.6, 0.04, 0.45, 0, 1.42, 0.02, 0x5a3a20, 0.3); lec.col(0, 0, 0.25, 0.2);
  npc(R, 0, 0.3, -hd + 1.7, 0, { shirt: 0xffffff, lower: 0xffffff, coat: 0xffffff, pose: 'front', hold: HOLD.book });   // priest
  // Statue of Mother Mary in a side niche, a candle stand by the entrance
  npc(R, -hw + 0.5, 0.3, -hd + 2.2, Math.PI / 2, { saree: true, shirt: 0x5a8ad0, lower: 0x5a8ad0, skin: 0xf2e8dc, hairStyle: 'none', pose: 'pray', cap: 0x5a8ad0 });
  const cand = sub(R, hw - 0.6, hd - 1.2, -Math.PI / 2);
  cand.box('metal', 0.9, 0.9, 0.4, 0, 0.45, 0, 0x3a3a3a); cand.col(0, 0, 0.45, 0.2);
  for (let i = 0; i < 8; i++) { cand.cyl('cloth', 0.015, 0.015, 0.14, -0.35 + (i % 4) * 0.23, 0.97, -0.08 + Math.floor(i / 4) * 0.16, 0xfff8e8, 6); cand.put('lamp', orbGeo(0.012, 1.8), -0.35 + (i % 4) * 0.23, 1.06, -0.08 + Math.floor(i / 4) * 0.16); }
  // Pews in two columns with a centre aisle, a few people at prayer
  for (let r = 0; r < 7; r++) for (const sx of [-1, 1]) {
    const z = -hd + 3.6 + r * 1.05;
    if (z > hd - 1.8) continue;
    const P = sub(R, sx * (hw / 2 + 0.35), z, 0);
    P.box('wood', hw - 0.9, 0.06, 0.4, 0, 0.45, 0, 0x6a3c1c); P.box('wood', hw - 0.9, 0.5, 0.05, 0, 0.72, -0.22, 0x6a3c1c);
    P.box('wood', hw - 0.9, 0.05, 0.15, 0, 0.85, 0.35, 0x6a3c1c); P.box('wood', hw - 0.9, 0.06, 0.2, 0, 0.12, 0.3, 0x5a3a20);   // kneeler + book ledge
    P.col(0, 0.05, (hw - 0.9) / 2, 0.3);
    if ((r + (sx > 0 ? 1 : 0)) % 3 === 0) npc(P, sx * 0.4, 0, 0, Math.PI, { sit: true, seat: 0.47, pose: 'pray', saree: r % 2 === 0, hairStyle: r % 2 === 0 ? 'long' : 'short', shirt: r % 2 ? 0xf0f0e8 : 0xe8c0c8 });
  }
  addSpot(cand, 0, 0, 0.9, '🕯️', 'Light a candle', () => { chime([392, 523], 2.5); return ['St. Thomas Church', 'You light a candle and say a quiet prayer. Holy Mass today at 6:30 am and 9:00 am; the feast of St. Thomas is on 3 July.']; }, 1.6);
  for (const z of [-3, 1]) R.put('lamp', orbGeo(0.22), 0, 6.2, z);
}
function furnishMosque(F, w, d) {
  const I = frame(F.bx, F.by, F.bz, F.ry, F.sc, 'int');
  const R = sub(I, 0, 0, 0, 0.5);
  const hw = w / 2 - 0.3, hd = d / 2 - 0.3;
  // Wall-to-wall prayer carpet with saff (row) lines facing the qibla wall at the back
  R.box('cloth', 2 * hw, 0.02, 2 * hd - 1.2, 0, 0.01, -0.6, 0x1f6a3a);
  for (let r = 0; r < 7; r++) R.box('cloth', 2 * hw, 0.022, 0.06, 0, 0.012, -hd + 1.4 + r * 1.2, 0xe8d8a8);
  // Mihrab niche with gold trim, the minbar pulpit beside it
  const M = sub(R, 0, -hd + 0.05, 0);
  M.box('conc', 1.6, 2.8, 0.08, 0, 1.4, 0.04, 0xf4f0e0); M.box('paint', 1.1, 2.2, 0.06, 0, 1.2, 0.08, 0x2a5a4a);
  M.cyl('gold', 0.56, 0.56, 0.06, 0, 2.3, 0.1, undefined, 16, Math.PI / 2); M.cyl('paint', 0.5, 0.5, 0.07, 0, 2.3, 0.11, 0x2a5a4a, 16, Math.PI / 2);
  const Mb = sub(R, 1.8, -hd + 0.9, 0);
  for (let i = 0; i < 3; i++) Mb.box('wood', 0.8, 0.3, 0.45, 0, 0.15 + i * 0.3, 0.45 - i * 0.45, 0x5a3a20);
  Mb.box('wood', 0.8, 1.2, 0.05, 0, 1.3, -0.5, 0x5a3a20); Mb.col(0, 0, 0.4, 0.7);
  // Quran stands (rehal) and a bookshelf, a chandelier, prayer-time board, ceiling fans
  for (let i = 0; i < 3; i++) { const x = -2.4 + i * 0.9; R.box('wood', 0.3, 0.02, 0.36, x, 0.22, -hd + 2.2, 0x7a4a24, 0.5); R.box('wood', 0.3, 0.02, 0.36, x, 0.22, -hd + 2.35, 0x7a4a24, -0.5); R.box('cloth', 0.22, 0.03, 0.3, x, 0.28, -hd + 2.27, 0x1f5a3a, 0.35); }
  shelving(sub(R, -hw + 0.25, -hd + 2.0, Math.PI / 2), 0, 0, 1.6, 1.8, 0.3, 4, 0x5a3a20, (U, y) => books(U, y, 1.5, [0x1f5a3a, 0x7a1f1f, 0x2a2a6a]));
  for (let i = 0; i < 8; i++) R.put('lamp', orbGeo(0.07), Math.cos(i * 0.785) * 0.8, 5.1, Math.sin(i * 0.785) * 0.8);
  R.cyl('gold', 0.9, 0.9, 0.04, 0, 5.05, 0, undefined, 20); R.cyl('gold', 0.01, 0.01, 0.9, 0, 5.5, 0, undefined, 4);
  const board = sub(R, hw - 0.03, -hd + 1.4, -Math.PI / 2);
  board.box('paint', 1.0, 1.1, 0.03, 0, 1.8, 0, 0x151515);
  for (let i = 0; i < 6; i++) { board.box('paint', 0.35, 0.05, 0.005, -0.2, 2.2 - i * 0.16, 0.02, 0xffffff); board.box('screen', 0.3, 0.06, 0.005, 0.25, 2.2 - i * 0.16, 0.02, 0x40ff80); }
  for (const x of [-3, 3]) ceilingFan(R, x, 6.0, 0);
  // Imam near the mihrab, worshippers in rows (seated for the sermon)
  npc(R, -0.4, 0, -hd + 1.0, 0, { shirt: 0xffffff, lower: 0xffffff, coat: 0xffffff, cap: 0xffffff, pose: 'front' });
  for (let i = 0; i < 6; i++) npc(R, -3 + i * 1.2, 0, -hd + 2.6 + (i % 2) * 1.2, Math.PI, { sit: true, seat: 0.12, pose: 'lap', mundu: true, shirt: 0xf4f4f0, cap: 0xffffff });
  // Footwear rack by the door
  const fr = sub(R, hw - 0.8, hd - 0.3, Math.PI);
  fr.box('wood', 1.4, 0.05, 0.3, 0, 0.3, 0, 0x6a4a2a); fr.box('wood', 1.4, 0.05, 0.3, 0, 0.6, 0, 0x6a4a2a);
  for (let i = 0; i < 6; i++) fr.box('rubber', 0.1, 0.04, 0.24, -0.55 + i * 0.22, 0.34 + (i % 2) * 0.3, 0, 0x3a2a1a);
  addSpot(R, 0, 0, hd - 1.6, '🕌', 'See the prayer times', () => ['Juma Masjid', 'Subh 4:58 - Zuhr 12:26 - Asr 3:44 - Maghrib 6:31 - Isha 7:44. Jumu\'ah khutbah on Friday at 12:45. Visitors are welcome outside prayer times - footwear on the rack, please.'], 2.0);
}

// ======================================================================================================
// Market, fuel station office, bus-stand kiosk, bus station waiting passengers
// ======================================================================================================
function furnishMarket(F) {
  const I = frame(F.bx, F.by, F.bz, F.ry, F.sc, 'int');
  const R = sub(I, 0, 0, 0, 0.25);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) {
    const x = -9 + i * 4.5, z = -3.4 + r * 6.4, fish = (r === 1 && i >= 3);
    R.col(x, z, 1.5, 0.65);
    const woman = (i + r) % 3 === 0;
    npc(R, x, 0, z - 1.0, 0, { pose: 'front', mundu: !woman, saree: woman, hairStyle: woman ? 'long' : 'short', shirt: fish ? 0x3a6a8a : pick(NPC_SHIRTS) });
    // The stall top (cloth) is at 0.96 in this raised frame; fish stalls get real fish on ice instead (below)
    if (!fish) weighingScale(R, x + 1.0, 0.96, z - 0.2);
    if ((i + r) % 2 === 0) npc(R, x + 0.6, 0, z + 1.1, Math.PI + 0.3, { hold: HOLD.paper, saree: i % 2 === 1, hairStyle: i % 2 ? 'long' : 'short' });
  }
  const fishShop = shopSpot(R, 6.5, 4.2, '🐟', 'Buy fresh fish', 'fish', 2.2, 'Nilambur Market - fish stall');
  buildFishStalls(R, [{ x: 4.5, z: 3.0 }, { x: 9, z: 3.0 }], 0.96, fishShop);
  shopSpot(R, -6.5, -1.7, '🥬', 'Buy vegetables at the market', 'veg', 2.2, 'Nilambur Market - vegetable stall');
  { const a = R.w(6.5, 4.2), b = R.w(-6.5, -1.7); FISH_STALL.pos = { x: a[0], z: a[1] }; FISH_STALL.veg = { x: b[0], z: b[1] }; }   // job pickups
  registerRoom(F, 0, 0, 11.8, 7.8, 0.25, 4.6, 'Nilambur Market', 'market');
}
function furnishUmbrellaStall(U) {
  const I = frame(U.bx, U.by, U.bz, U.ry, U.sc, 'int');
  npc(I, 0, 0, 0.1, 0, { pose: 'front', mundu: irng() < 0.5, saree: irng() < 0.3, hairStyle: 'short' });
}
function buildFuelOffice(O) {
  // Hollow kiosk office: glass front with a door, cashier at the counter, lubricant shelf
  O.box('wall', 6, 3.3, 0.2, 0, 1.65, -2.4, 0xf2f0e6);
  for (const sx of [-1, 1]) O.box('wall', 0.2, 3.3, 5, sx * 2.9, 1.65, 0, 0xf2f0e6);
  O.box('wall', 6, 0.2, 5, 0, 3.2, 0, 0xf2f0e6);
  O.box('conc', 5.8, 0.15, 4.8, 0, 0.075, 0, 0xc8c2b2);
  for (const [a, b] of [[-2.8, -0.7], [0.7, 2.8]]) { O.box('cglass', b - a, 2.2, 0.05, (a + b) / 2, 1.25, 2.45); O.col((a + b) / 2, 2.45, (b - a) / 2, 0.1); }
  O.box('wall', 6, 1.1, 0.2, 0, 2.85, 2.45, 0xf2f0e6);
  O.col(0, -2.4, 3, 0.1); O.col(-2.9, 0, 0.1, 2.5); O.col(2.9, 0, 0.1, 2.5);
  const I = frame(O.bx, O.by, O.bz, O.ry, O.sc, 'int'), R = sub(I, 0, 0, 0, 0.15);
  const S = cashCounter(R, -1.0, -0.6, 0, 1.8, { shirt: 0xc8201e, lower: 0x2a2f45, cap: 0xc8201e });
  shelving(sub(R, 1.8, -2.1, 0), 0, 0, 1.6, 1.8, 0.35, 4, 0x8a8e92, (U, y, i, w) => tins(U, y, w, [0xc8201e, 0xe8b820, 0x2a58d8, 0x151515], 0.07, 0.22));
  tubeLight(R, 0, 2.95, 0, 0);
  registerRoom(O, 0, 0, 2.8, 2.3, 0.15, 3.1, 'Fuel Station Office', 'fuel', { floorHW: 3, floorHD: 2.5 });
  shopSpot(R, -1.0, 0.5, '⛽', 'Pay for fuel', 'fuel', 1.8, 'Fuel Station');
}
function buildTeaKiosk(Fk) {
  // Open-fronted bus-stand tea stall: back and side walls, a serving counter, the tea master inside
  Fk.box('wall', 4, 3, 0.15, 0, 1.5, -1.52, 0xf0d8a0);
  for (const sx of [-1, 1]) Fk.box('wall', 0.15, 3, 3.2, sx * 1.92, 1.5, 0, 0xf0d8a0);
  Fk.box('wall', 4.1, 0.15, 3.3, 0, 3.0, 0, 0xf0d8a0);
  Fk.box('wood', 3.7, 1.0, 0.5, 0, 0.5, 1.35, 0x6a4a2a); Fk.box('wood', 3.8, 0.05, 0.6, 0, 1.02, 1.35, 0x4a2c14);
  Fk.col(0, 0, 2, 1.6);
  const I = frame(Fk.bx, Fk.by, Fk.bz, Fk.ry, Fk.sc, 'int');
  I.cyl('metal', 0.22, 0.24, 0.5, -1.0, 1.3, 1.3, 0xd0d4d8, 12);
  for (let i = 0; i < 6; i++) I.cyl('cglass', 0.035, 0.03, 0.1, 0.2 + i * 0.12, 1.1, 1.35);
  I.box('cglass', 0.7, 0.4, 0.4, 1.2, 1.25, 1.3);
  for (let i = 0; i < 4; i++) orb(I, 'cloth', 0.05, 1.0 + (i % 2) * 0.2, 1.12, 1.25 + Math.floor(i / 2) * 0.12, 0xd08a3a, 0.5);
  npc(I, -0.3, 0, 0.4, 0, { pose: 'up', mundu: true, shirt: 0xf0f0e8, hold: HOLD.glass });
  shopSpot(I, 0, 2.3, '☕', 'Tea at the bus stand', 'chaya', 1.8, 'Bus Stand Tea Stall');
  { const k = I.w(0, 2.3); KIOSK.pos = { x: k[0], z: k[1] }; }
}
function busStandPassengers(Fp) {
  const I = frame(Fp.bx, Fp.by, Fp.bz, Fp.ry, Fp.sc, 'int');
  for (let i = 0; i < 5; i++) {
    const x = -8 + i * 4;
    npc(I, x - 0.5 + (i % 2), 0.35, -0.6, 0, { sit: true, seat: 0.4, saree: i % 2 === 1, hairStyle: i % 2 ? 'long' : 'short', mundu: i === 0 });
    I.box('paint', 0.45, 0.32, 0.22, x + 0.4, 0.35 + 0.16, -0.2, [0x5a2a12, 0x1c3a6a, 0x2a2a2a][i % 3]);
  }
  npc(I, 3, 0.35, 1.5, 0, { shirt: KHAKI, lower: KHAKI, hold: (P, up, B) => P('paint', B(0.14, 0.2, 0.06), 0.2, 1.05 + up, 0.3, 0x2a2a2a) });
}

// ======================================================================================================
// Landmarks in world.js (authored in real metres through a world-space frame)
// ======================================================================================================
function furnishMuseum(p, y0, hw, hd, floorY, ceilY) {
  const I = frameAt(p.x, y0, p.z, 0, 1, 'int-museum');
  const R = sub(I, 0, 0, 0, floorY);
  // Teak log cross-sections on stands (showing growth rings), a giant teak root, glass cases of
  // carvings and tools, a dugout canoe, information panels, benches, the ticket desk and a guide
  for (let i = 0; i < 4; i++) {
    const x = -hw + 2.0 + i * 1.8, r = 0.35 + i * 0.12;
    R.box('wood', 0.6, 0.35, 0.4, x, 0.18, -hd + 1.2, 0x3a2412);
    R.cyl('wood', r, r, 0.18, x, 0.35 + r, -hd + 1.2, 0x8a5a2a, 20, Math.PI / 2);
    for (let k = 1; k < 4; k++) torus(R, 'wood', r * k / 4, 0.008, x, 0.35 + r, -hd + 1.12, 0x5a3a1a, 0, 0);
    R.col(x, -hd + 1.2, 0.35, 0.25);
  }
  const root = sub(R, hw - 2.4, -hd + 1.8, 0);
  root.cyl('wood', 0.5, 0.7, 1.4, 0, 0.7, 0, 0x6a4a2a, 10);
  for (let i = 0; i < 6; i++) root.cyl('wood', 0.08, 0.16, 1.4, Math.cos(i) * 0.7, 0.3, Math.sin(i) * 0.7, 0x5a3a20, 6, 0, i, 1.1);
  root.col(0, 0, 1.0, 1.0);
  for (let i = 0; i < 3; i++) {
    const C = sub(R, -hw + 2.2 + i * 3.4, 0.4, 0);
    C.box('wood', 1.6, 0.9, 0.8, 0, 0.45, 0, 0x5a3a20); C.box('cglass', 1.6, 0.7, 0.8, 0, 1.25, 0); C.box('wood', 1.64, 0.05, 0.84, 0, 1.62, 0, 0x5a3a20);
    for (let k = 0; k < 3; k++) {
      if (i === 0) C.cyl('wood', 0.08, 0.1, 0.36, -0.5 + k * 0.5, 1.08, 0, 0x7a4a24, 8);                           // carved figurines
      else if (i === 1) { C.box('wood', 0.04, 0.3, 0.04, -0.5 + k * 0.5, 1.05, 0, 0x6a4a2a, 0, 0, 1.2); C.box('metal', 0.14, 0.05, 0.06, -0.4 + k * 0.5, 1.12, 0, 0x5a5a5a); }   // old tools
      else C.box('cloth', 0.35, 0.02, 0.25, -0.5 + k * 0.5, 0.92, 0, 0xe8d8b0);                                      // old documents
    }
    C.col(0, 0, 0.8, 0.4);
  }
  const canoe = sub(R, 0, -2.0, 0);
  canoe.box('wood', 4.2, 0.3, 0.1, 0, 0.35, 0, 0x3a2412);
  canoe.put('wood', (() => { const g = new THREE.CylinderGeometry(0.4, 0.4, 5.0, 12, 1, false, 0, Math.PI); g.rotateZ(Math.PI / 2); return g; })(), 0, 0.9, 0, 0x6a4a24, Math.PI);
  canoe.col(0, 0, 2.5, 0.4);
  for (let i = 0; i < 4; i++) wallFrame(sub(R, -hw + 0.03, -hd + 1.8 + i * 2.2, Math.PI / 2), 0, 2.0, 0, 1.2, 0.9, [0xe8dcb8, 0xd8e8d0, 0xf0e0c0, 0xe0d8c8][i]);
  wallFrame(sub(R, hw - 0.03, 0.2, -Math.PI / 2), 0, 2.2, 0, 1.4, 1.1, 0x8a7a5a);   // portrait of H.V. Conolly
  for (const z of [1.6]) bench(R, 0, z + 1.0, 2.4, 0, 0x5a3a20);
  const T = sub(R, hw - 2.2, hd - 1.8, Math.PI);
  counter(T, 0, 0, 1.8, 0.6, 0.95, 0x5a3a20);
  npc(T, 0, 0, -0.65, 0, { pose: 'front', shirt: 0xe8e0c8, lower: 0x2a2f45 });
  npc(R, -2.5, 0, -1.0, 0.8, { pose: 'side', shirt: 0x2e5a3a, lower: 0x2e5a3a, cap: 0x2e5a3a });   // forest-department guide
  for (let i = 0; i < 3; i++) npc(R, -hw + 2.3 + i * 3.4, 0, 1.4, Math.PI, { saree: i === 1, hairStyle: i === 1 ? 'long' : 'short', k: i === 2 ? 0.75 : 1 });
  for (let i = 0; i < 4; i++) R.put('lamp', orbGeo(0.18), -hw + 2 + i * ((2 * hw - 4) / 3), ceilY - floorY - 0.4, 0);
  const facts = [
    ['World\'s first teak museum', 'Opened in 1995 by the Kerala Forest Research Institute - everything here tells the story of Nilambur teak (Tectona grandis).'],
    ['Growth rings', 'Each ring is one monsoon year. The biggest cross-section here counts over 150 rings - planted in the 1840s.'],
    ['Conolly\'s Plot', 'H.V. Conolly, Collector of Malabar, started the world\'s first teak plantation here in 1846 with Chathu Menon. The oldest tree is 46 m tall.'],
    ['The dugout canoe', 'Carved from a single teak log - teak\'s natural oils keep it from rotting even in the Chaliyar\'s water.']
  ];
  let fi = 0;
  addSpot(R, 0, 0, -1.0, '🏛️', 'Read the exhibit panels', () => { const f = facts[fi++ % facts.length]; return [f[0], f[1]]; }, 3.0);
  shopSpot(T, 0, 0.9, '🎟️', 'Museum ticket counter', 'museum', 1.8, 'Nilambur Teak Museum');
}
function furnishPalace(p, y0, hw, hd, floorY, ceilY) {
  const I = frameAt(p.x, y0, p.z, 0, 1, 'int-palace');
  const R = sub(I, 0, 0, 0, floorY);
  const teak = 0x4a2412, rose = 0x3a1a10;
  // Carved pillars, the raja's seat on a dais, easy chairs, a swing cot, brass lamps, portraits
  for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) { R.cyl('wood', 0.16, 0.18, ceilY - floorY, sx * (hw - 2.0), (ceilY - floorY) / 2, -hd + 1.8 + i * 2.6, teak, 10); R.col(sx * (hw - 2.0), -hd + 1.8 + i * 2.6, 0.2, 0.2); }
  R.box('wood', 3.6, 0.3, 2.0, 0, 0.15, -hd + 1.2, rose);
  const th = sub(R, 0, -hd + 0.9, 0, 0.3);
  th.box('cloth', 1.0, 0.45, 0.7, 0, 0.3, 0, 0x7a1f1f); th.box('wood', 1.1, 1.4, 0.12, 0, 0.9, -0.35, rose); th.box('gold', 1.1, 0.08, 0.14, 0, 1.62, -0.35);
  for (const sx of [-1, 1]) th.box('wood', 0.1, 0.6, 0.7, sx * 0.55, 0.45, 0, rose);
  R.col(0, -hd + 1.2, 1.8, 1.0);
  for (const sx of [-1, 1]) {
    const E = sub(R, sx * 2.6, -0.2, sx * -0.5);   // charukasera (easy chair)
    E.box('wood', 0.62, 0.04, 1.1, 0, 0.42, 0.05, rose, 0.4); E.box('cloth', 0.52, 0.02, 1.0, 0, 0.44, 0.05, 0xd8c8a0, 0.4);
    for (const s2 of [-1, 1]) E.box('wood', 0.05, 0.06, 1.3, s2 * 0.32, 0.62, 0.05, rose, -0.1);
    E.col(0, 0, 0.35, 0.55);
    nilavilakku(R, sx * 1.4, 0.3, -hd + 1.5, 1.3);
  }
  const sw = sub(R, 0, 1.6, 0);   // aattukattil (swing cot) hung on chains
  sw.box('wood', 2.0, 0.1, 0.9, 0, 0.55, 0, rose); sw.box('wood', 2.0, 0.3, 0.05, 0, 0.72, -0.43, rose);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) sw.cyl('metal', 0.008, 0.008, ceilY - floorY - 0.6, sx * 0.9, 0.6 + (ceilY - floorY - 0.6) / 2, sz * 0.4, 0x6a6a6a, 4);
  sw.col(0, 0, 1.0, 0.45);
  for (let i = 0; i < 3; i++) wallFrame(sub(R, -hw + 0.03, -hd + 2 + i * 2.6, Math.PI / 2), 0, 2.4, 0, 0.9, 1.2, [0x5a4a3a, 0x6a5a4a, 0x4a3a2a][i]);
  for (let i = 0; i < 3; i++) wallFrame(sub(R, hw - 0.03, -hd + 2 + i * 2.6, -Math.PI / 2), 0, 2.4, 0, 0.9, 1.2, [0x6a5a4a, 0x5a4a3a, 0x7a6a5a][i]);
  R.box('cloth', 3.0, 0.01, 4.0, 0, 0.005, 0.4, 0x7a1f1f); R.box('gold', 3.0, 0.012, 0.1, 0, 0.006, -1.55); R.box('gold', 3.0, 0.012, 0.1, 0, 0.006, 2.35);
  npc(R, hw - 1.2, 0, hd - 1.6, -Math.PI * 0.7, { mundu: true, shirt: 0xf3efe2, cap: 0xf3efe2, pose: 'side' });   // caretaker
  npc(R, -1.5, 0, 1.0, 0.5, { saree: true, hairStyle: 'long', shirt: 0xaa3a44, lower: 0xf7f3e6 });
  for (let i = 0; i < 3; i++) R.put('lamp', orbGeo(0.16), -3 + i * 3, ceilY - floorY - 0.5, 0);
  const facts = [
    ['Nilambur Kovilakam', 'Seat of the Nilambur Rajas (the Thirumulpads), who owned vast forests here. The family\'s Thrikkaikunnu temple hosts the Nilambur Pattulsavam every January.'],
    ['The charukasera', 'These rosewood easy chairs with swing-out leg rests were where the elders read their newspapers on the verandah.'],
    ['The aattukattil', 'A swing cot hung from the rafters - rocking babies and grandparents alike to sleep through the hot afternoons.']
  ];
  let fi = 0;
  addSpot(R, 0, 0, 0.4, '👑', 'Learn about the palace', () => { const f = facts[fi++ % facts.length]; return [f[0], f[1]]; }, 3.0);
}
function furnishStation(bx, by, bz, hw, hd, floorY, ceilY) {
  // Local +z faces the platform (world -x); local x runs along the building (world +z)
  const I = frameAt(bx, by, bz, -Math.PI / 2, 1, 'int-station');
  const R = sub(I, 0, 0, 0, floorY);
  // Booking office with the ticket window, waiting room benches, timetable, station master's desk
  R.box('wall', 0.15, ceilY - floorY, 2 * hd, -hw + 4.0, (ceilY - floorY) / 2, 0, 0xf2e6c8);
  R.col(-hw + 4.0, -0.6, 0.08, hd - 0.6);
  R.box('cglass', 0.02, 0.6, 0.8, -hw + 3.9, 1.3, hd - 1.0);
  R.box('wood', 0.5, 0.05, 0.9, -hw + 3.7, 1.0, hd - 1.0, 0x5a3a20);
  npc(R, -hw + 3.2, 0, hd - 1.0, Math.PI / 2, { sit: true, seat: 0.5, pose: 'front', shirt: 0xf4f4f0, lower: 0x22304a });
  officeDesk(R, -hw + 2.0, -hd + 1.2, 0, { shirt: 0xf4f4f0, lower: 0x22304a, cap: 0x22304a });   // station master
  R.box('metal', 0.5, 1.6, 0.4, -hw + 0.5, 0.8, 0.5, 0x7a8288);                                  // ticket rack
  for (let r = 0; r < 2; r++) {
    const T = sub(R, 3.0, -1.0 + r * 1.6, Math.PI);
    bench(T, 0, 0, 5.0, 0, 0x5a3a20); T.col(0, 0, 2.5, 0.2);
    for (let k = 0; k < 4; k++) if ((k + r) % 2 === 0) npc(T, -1.8 + k * 1.2, 0, 0, 0, { sit: true, seat: 0.44, saree: k === 2, hairStyle: k === 2 ? 'long' : 'short', mundu: k === 0 });
  }
  const B = sub(R, 3.5, -hd + 0.03, 0);
  B.box('paint', 3.6, 1.3, 0.03, 0, 1.9, 0, 0x1e4c8a);
  for (let i = 0; i < 6; i++) { B.box('paint', 1.6, 0.06, 0.005, -0.7, 2.4 - i * 0.17, 0.02, 0xffffff); B.box('screen', 0.6, 0.06, 0.005, 1.1, 2.4 - i * 0.17, 0.02, 0xffd060); }
  R.cyl('paint', 0.3, 0.3, 0.06, 3.5, 3.1, -hd + 0.06, 0xf4f4f0, 16, Math.PI / 2);
  for (const x of [-4, 3]) ceilingFan(R, x, ceilY - floorY, 0);
  shopSpot(R, -hw + 4.8, hd - 1.0, '🎟️', 'Buy a train ticket', 'train', 1.8, 'Nilambur Road booking office');
}
