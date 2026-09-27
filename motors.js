/**
 * motors.js - everything extra about vehicles:
 *  - real vertical motion for road vehicles: a vehicle carries its vertical speed, so taking a crest
 *    fast launches it into the air (and it lands under gravity) instead of being glued to the terrain;
 *  - a speedometer (and altimeter in a helicopter);
 *  - Malabar Auto Garage: drive in, press G, and pay cash for paint, engine tuning, nitro, a spoiler,
 *    neon underglow and off-road suspension (saved per vehicle, and shown to other players);
 *  - Nilambur Heli Services: a helipad with helicopters you can hire (flight fee in cash) and fly
 *    anywhere in the world.
 * Hooks in main.js: vehicleSpec / vehicleVertical (updateVehicleDriving), updateHeli, heliBoard
 * (tryEnterVehicle), canExitVehicle (exitVehicle), tryGarage (G key), motorsTick (animate).
 * Depends on town.js (VEHICLES, movingVehicle, frameAt, townSign, TM), interiors.js (npc, sub, addSpot)
 * and economy.js (spendCash, fmtRs, econ).
 */

const GRAVITY = 9.81;
const GARAGE = { x: 842, z: 60, floorY: 2.85 };       // open front faces west (towards town)
const HELIPAD = { x: 842, z: -60, padY: 2.9 };
const VMODS_LS = 'nw_vmods_v1';
const DIAL_MAX = { car: 200, bike: 200, auto: 100, bus: 120, kayak: 40, heli: 260 };
const VEH_DIMS = { car: [1.75, 4.0], auto: [1.3, 2.6], bike: [0.3, 1.7], bus: [2.5, 10.4] };

// ======================================================================================================
// Upgrades: specs, persistence, visuals
// ======================================================================================================
const ENGINE_STAGES = [
  { name: 'Stock', max: 1, acc: 1, price: 0 },
  { name: 'Stage 1 - air filter & ECU remap', max: 1.15, acc: 1.25, price: 2500 },
  { name: 'Stage 2 - exhaust & turbo', max: 1.3, acc: 1.5, price: 6000 },
  { name: 'Stage 3 - race engine', max: 1.5, acc: 1.9, price: 12000 }
];
const PAINTS = [
  ['Pearl white', 0xf2f2ee], ['Midnight black', 0x14161a], ['Kerala red', 0xc0392b], ['Racing yellow', 0xf2c200],
  ['Teak brown', 0x7a4a24], ['Backwater blue', 0x1f5fa8], ['Paddy green', 0x2e8b3a], ['Sunset orange', 0xe8741e],
  ['Silver', 0xaab2ba], ['Royal purple', 0x6a2a8a], ['Chrome', 0xd8dde2], ['Matte grey', 0x4a4f55]
];
const NEONS = [['Cyan', 0x22e6ff], ['Pink', 0xff3aa8], ['Lime', 0x7cff3a], ['Purple', 0x9a4aff], ['Amber', 0xffb020]];
const PRICE = { paint: 1200, nitro: 5000, spoiler: 1800, neon: 2000, susp: 3000 };

let VMODS = {};
try { VMODS = JSON.parse(localStorage.getItem(VMODS_LS) || '{}') || {}; } catch (e) { VMODS = {}; }
function saveVmods() { try { localStorage.setItem(VMODS_LS, JSON.stringify(VMODS)); } catch (e) { /* private mode */ } }
function modsOf(v) { return v.mods || (v.mods = {}); }

function vehicleSpec(v, dt) {
  const b = VEH_SPECS[v.type] || VEH_SPECS.car, m = modsOf(v), st = ENGINE_STAGES[m.eng || 0];
  let max = b.max * st.max, acc = b.acc * st.acc, turn = b.turn * (m.spoiler ? 1.08 : 1);
  // Nitro: hold SHIFT with the throttle down - 4 s tank, refills in ~12 s
  if (v.nitro === undefined) v.nitro = 1;
  const wantBoost = m.nitro && keyState['ShiftLeft'] || m.nitro && keyState['ShiftRight'];
  v.boosting = !!(wantBoost && v.nitro > 0 && (keyState['KeyW'] || keyState['ArrowUp']));
  if (v.boosting) { v.nitro = Math.max(0, v.nitro - dt / 4); max *= 1.4; acc *= 2.2; }
  else v.nitro = Math.min(1, v.nitro + dt / 12);
  // In the air the wheels have nothing to push against; off-road suspension gives a little air control
  if (v.air) { acc = 0.0001; turn *= m.susp ? 0.5 : 0.15; }
  return { max: max, acc: acc, turn: turn, camDist: b.camDist };
}

// Vertical motion for road vehicles. Returns the body's y. Grounded, the vehicle follows the terrain
// and remembers how fast it's rising; when the ground drops away faster than gravity can pull it down
// (a crest taken fast) it becomes a projectile until it lands again.
function vehicleVertical(v, dt, groundY) {
  if (v.g.rotation.order !== 'YXZ') v.g.rotation.order = 'YXZ';
  if (v.y === undefined || (!v.air && Math.abs(v.y - groundY) > 3)) { v.y = groundY; v.vy = 0; v.air = false; }
  const fwdX = Math.sin(v.yaw), fwdZ = Math.cos(v.yaw);
  if (v.air) {
    v.vy -= GRAVITY * dt;
    v.y += v.vy * dt;
    v.airT += dt;
    v.airDist += Math.abs(v.spd) * dt;
    if (v.y <= groundY) {
      const impact = -v.vy;
      v.y = groundY; v.air = false;
      if (impact > 7 && !modsOf(v).susp) v.spd *= 0.8;
      if (impact > 4 && typeof chime === 'function') chime([70, 55], 0.35);
      if (v.airT > 1.2 && v === state.driving) triggerLandmarkPopup('🛫 Big air!', v.airT.toFixed(1) + ' s in the air, ' + Math.round(v.airDist) + ' m jump at ' + Math.round(v.launchKmh) + ' km/h.');
      v.vy = 0;
    }
    // nose follows the flight path
    const want = -Math.atan2(v.vy, Math.max(4, Math.abs(v.spd)));
    v.g.rotation.x += (THREE.MathUtils.clamp(want, -0.6, 0.6) - v.g.rotation.x) * Math.min(1, dt * 3);
    v.g.rotation.z *= 0.95;
    return v.y;
  }
  // Grounded: would a projectile moving at our current vertical speed still be above the ground?
  const ballistic = v.y + v.vy * dt - 0.5 * GRAVITY * dt * dt;
  if (Math.abs(v.spd) > 9 && groundY < ballistic - 0.04 && v.vy > -8) {
    v.air = true; v.airT = 0; v.airDist = 0; v.launchKmh = Math.abs(v.spd) * 3.6;
    v.vy -= GRAVITY * dt;
    v.y = ballistic;
    return v.y;
  }
  const follow = (groundY - v.y) / Math.max(dt, 1e-3);
  v.vy += (THREE.MathUtils.clamp(follow, -25, 25) - v.vy) * Math.min(1, dt * 12);
  v.y = groundY;
  // pitch to the slope under the wheels
  const L = (VEH_DIMS[v.type] || [1, 3])[1] * 0.5;
  const ga = groundHeight(v.x + fwdX * L, v.z + fwdZ * L), gb = groundHeight(v.x - fwdX * L, v.z - fwdZ * L);
  const want = -Math.atan2(ga - gb, 2 * L);
  v.g.rotation.x += (THREE.MathUtils.clamp(want, -0.5, 0.5) - v.g.rotation.x) * Math.min(1, dt * 8);
  return v.y;
}

function canExitVehicle(v) {
  if (v.type === 'heli' && v.y - heliGround(v.x, v.z) > 0.6) { triggerLandmarkPopup('🚁 Still flying', 'Land first - hold SHIFT to descend until the skids touch down.'); return false; }
  if (v.air) return false;
  if (v.type === 'heli') v.paid = false;
  return true;
}

// Visual upgrades live in their own child group so a repaint (which rebuilds the body) keeps them
function applyMods(v) {
  const m = modsOf(v);
  if (!v.modG) { v.modG = new THREE.Group(); v.modG.userData.mod = true; v.g.add(v.modG); }
  const paint = m.c !== undefined ? m.c : v.hex;
  if (paint !== undefined && paint !== v.curHex && v.type !== 'heli' && typeof movingVehicle === 'function' && VEH_DIMS[v.type]) {
    const tmp = movingVehicle(v.type, paint);
    scene.remove(tmp);
    v.g.children.filter(c => !c.userData.mod).forEach(c => { v.g.remove(c); c.geometry && c.geometry.dispose(); });
    tmp.children.slice().forEach(c => v.g.add(c));
    v.curHex = paint;
  }
  const dims = VEH_DIMS[v.type]; if (!dims) return;
  const [W, L] = dims;
  const want = { spoiler: !!m.spoiler && v.type !== 'bike' && v.type !== 'bus', neon: m.neon !== undefined && m.neon !== null, flame: !!m.nitro };
  const byName = {}; v.modG.children.forEach(c => { byName[c.name] = c; });
  if (want.spoiler && !byName.spoiler) {
    const g = new THREE.Group(); g.name = 'spoiler';
    const mat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4, metalness: 0.4 });
    const topY = v.type === 'car' ? 1.04 : 1.79;   // boot lid / auto roof
    const wing = new THREE.Mesh(new THREE.BoxGeometry(W * 0.92, 0.05, 0.38), mat); wing.position.set(0, topY + 0.22, -L / 2 + 0.2); wing.rotation.x = -0.12;
    g.add(wing);
    for (const sx of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.24, 0.12), mat); p.position.set(sx * W * 0.32, topY + 0.1, -L / 2 + 0.22); g.add(p); }
    v.modG.add(g);
  } else if (!want.spoiler && byName.spoiler) v.modG.remove(byName.spoiler);
  if (byName.neon && (!want.neon || byName.neon.userData.hex !== m.neon)) { v.modG.remove(byName.neon); delete byName.neon; }
  if (want.neon && !byName.neon) {
    const g = new THREE.Group(); g.name = 'neon'; g.userData.hex = m.neon;
    const glow = new THREE.MeshBasicMaterial({ color: m.neon, map: neonTex(), transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.9, L + 0.6), glow); pool.rotation.x = -Math.PI / 2; pool.position.y = 0.04;
    g.add(pool);
    const tube = new THREE.MeshBasicMaterial({ color: m.neon });
    for (const sx of [-1, 1]) { const t = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, L * 0.8), tube); t.position.set(sx * W * 0.42, 0.2, 0); g.add(t); }
    v.modG.add(g);
  }
  if (want.flame && !byName.flame) {
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0x5ab8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    f.name = 'flame'; f.rotation.x = -Math.PI / 2; f.position.set(W * 0.25, 0.35, -L / 2 - 0.35); f.visible = false;
    v.modG.add(f);
  } else if (!want.flame && byName.flame) v.modG.remove(byName.flame);
}
let _neonTex = null;
function neonTex() {   // soft radial falloff so the glow pool has no hard edges
  if (_neonTex) return _neonTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 4, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.55, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (_neonTex = new THREE.CanvasTexture(c));
}
function modFlags(v) { const m = modsOf(v); return (m.spoiler ? 1 : 0) | (m.neon !== undefined && m.neon !== null ? 2 : 0) | (v.boosting ? 4 : 0) | (m.nitro ? 8 : 0); }
// Other players' upgrades arrive with their vehicle position (multiplayer.js)
function applyRemoteMods(v, rv) {
  if (rv.c === undefined) return;
  const m = modsOf(v);
  const key = rv.c + '|' + rv.f + '|' + rv.nc;
  if (v._remoteKey === key) { v.boosting = !!(rv.f & 4); return; }
  v._remoteKey = key;
  m.c = rv.c; m.spoiler = !!(rv.f & 1); m.neon = (rv.f & 2) ? rv.nc : null; m.nitro = !!(rv.f & 8);
  v.boosting = !!(rv.f & 4);
  applyMods(v);
}

// ======================================================================================================
// Malabar Auto Garage
// ======================================================================================================
function inGarageBay(x, z) { return x > GARAGE.x - 12.5 && x < GARAGE.x + 4.5 && Math.abs(z - GARAGE.z) < 5.6; }
function buildGarage() {
  const F = frameAt(GARAGE.x, GARAGE.floorY, GARAGE.z, -Math.PI / 2);   // local +z = world -x (the open front)
  const I = frame(F.bx, F.by, F.bz, F.ry, 1, 'int');
  GROUND_EXTRAS.push((x, z) => (x > GARAGE.x - 13.5 && x < GARAGE.x + 5.3 && Math.abs(z - GARAGE.z) < 6.3) ? GARAGE.floorY : null);
  F.box('conc', 12.4, 0.5, 18.6, 0, -0.25, 4.0, 0x9a968e);                                // slab + apron
  for (let i = 0; i < 5; i++) F.box('paint', 0.12, 0.01, 4.5, -4 + i * 2, 0.005, 9.5, 0xf2f2ee);   // apron bay lines
  F.box('wall', 12.4, 5, 0.25, 0, 2.5, -5.1, 0xd8d0c0);                                   // back wall
  for (const sx of [-1, 1]) F.box('wall', 0.25, 5, 10.2, sx * 6.1, 2.5, 0, 0xd8d0c0);     // side walls
  F.box('metal', 12.6, 0.25, 10.6, 0, 5.1, 0, 0x8a9098);                                  // roof
  F.box('metal', 12.2, 0.55, 0.5, 0, 4.55, 5.0, 0x6a7078);                                // rolled-up shutter
  F.box('paint', 12.4, 0.12, 0.3, 0, 4.2, 5.05, 0xc0392b);
  F.col(0, -5.1, 6.2, 0.15); for (const sx of [-1, 1]) F.col(sx * 6.1, 0, 0.15, 5.1);
  townSign(F, ['MALABAR AUTO GARAGE', 'Paint · Tuning · Nitro · Mods'], 0, 5.9, 5.2, 8, { bg: '#1c1c1c', fg: '#ffd54f', border: '#ffd54f' });
  // Car lift (two posts, arms) on the left bay, with a mechanic under it
  for (const sz of [-1, 1]) I.box('paint', 0.3, 3.6, 0.3, -4.9, 1.8, sz * 2.2, 0x2a58d8);
  for (const sz of [-1, 1]) I.box('metal', 1.6, 0.1, 0.15, -4.1, 1.2, sz * 1.4, 0x9aa0a6);
  // Pegboard with tools on the back wall, workbench, tyre stack, oil drums, compressor
  I.box('wood', 6, 1.8, 0.04, 1.2, 2.2, -4.95, 0xc8a878);
  for (let i = 0; i < 18; i++) I.box('metal', 0.04, 0.25 + (i % 3) * 0.08, 0.03, -1.4 + (i % 9) * 0.6, 1.7 + Math.floor(i / 9) * 0.8, -4.9, [0xc0392b, 0x9aa0a6, 0x1a1a1a][i % 3]);
  I.box('wood', 4, 0.08, 0.9, 1.2, 0.95, -4.4, 0x6a4a2a); for (const sx of [-1, 1]) I.box('metal', 0.08, 0.9, 0.8, 1.2 + sx * 1.9, 0.47, -4.4, 0x3a3a3a);
  I.box('paint', 0.5, 0.35, 0.3, 0.2, 1.17, -4.4, 0xc0392b);                                 // toolbox
  for (let i = 0; i < 5; i++) I.put('rubber', new THREE.TorusGeometry(0.3, 0.12, 6, 14), 5.2, 0.12 + i * 0.24, -4.3, 0x1a1a1a, Math.PI / 2);
  for (let i = 0; i < 3; i++) I.cyl('paint', 0.3, 0.3, 0.9, 5.3, 0.45, -2.4 + i * 0.65, [0x2a58d8, 0xc0392b, 0x2e8b3a][i], 12);
  I.cyl('paint', 0.28, 0.28, 0.8, 5.2, 0.4, 2.8, 0xc0392b, 12, 0, 0, Math.PI / 2);          // compressor
  I.box('paint', 1.6, 2.2, 0.05, 3.8, 1.3, -4.95, 0x2a2a2a);                                  // paint booth screen
  for (let i = 0; i < 6; i++) I.cyl('paint', 0.08, 0.08, 0.2, 3.2 + i * 0.24, 1.0, -4.5, PAINTS[i * 2][1], 10);
  npc(I, -3.6, 0, -1.8, 0.4, { shirt: 0x2a4a8a, lower: 0x2a4a8a, pose: 'up', cap: 0xc0392b });
  npc(I, 1.2, 0, -3.8, 0, { shirt: 0x2a4a8a, lower: 0x2a4a8a, pose: 'front' });
  npc(I, 4.4, 0, 3.8, -2.4, { shirt: 0x2a4a8a, lower: 0x2a4a8a, pose: 'front', hold: HOLD.paper });
  placeVehicle('car', 0x8a1c1c, GARAGE.x - 9 - OX, GARAGE.z + 9.5, 0, false);   // a customer's car waiting outside
  addSpot(I, 0, 0, 2.0, '🔧', 'Malabar Auto Garage - drive a vehicle in and press G to modify it', () => ['Malabar Auto Garage', 'Bring any car, auto, bike or bus into the bay and press G: paint, engine tuning, nitro, spoiler, neon and off-road suspension.'], 3.5);
}

let _garageV = null, _garageMsg = '';
function tryGarage() {
  const v = state.driving;
  if (!v || v.type === 'kayak' || v.type === 'heli') return;
  if (!inGarageBay(v.x, v.z)) { triggerLandmarkPopup('🔧 Garage', 'Drive into Malabar Auto Garage (east of town) and press G to modify your vehicle.'); return; }
  if (Math.abs(v.spd) > 3) return;
  v.spd = 0;
  openGarage(v);
}
function openGarage(v) {
  _garageV = v; _garageMsg = '';
  if (typeof openModal === 'function') openModal('garage-modal'); else document.getElementById('garage-modal').classList.add('open');
  renderGarage();
}
function buyMod(price, fn, label) {
  if (!spendCash(price)) { _garageMsg = 'Not enough cash for ' + label + ' (' + fmtRs(price) + ') - you have ' + fmtRs(econ.cash) + '. Take a job from 💼 Jobs.'; renderGarage(); return; }
  fn(modsOf(_garageV));
  const i = VEHICLES.indexOf(_garageV);
  VMODS[i] = Object.assign({}, modsOf(_garageV));
  saveVmods();
  applyMods(_garageV);
  if (typeof chime === 'function') chime([523, 659, 784], 0.4);
  _garageMsg = label + ' done - paid ' + fmtRs(price) + ' cash.';
  renderGarage();
}
function renderGarage() {
  const v = _garageV; if (!v) return;
  const m = modsOf(v), box = document.getElementById('garage-list');
  const E = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
  document.getElementById('garage-sub').textContent = 'Your ' + ({ car: 'car', bike: 'motorcycle', auto: 'auto-rickshaw', bus: 'bus' })[v.type] + ' · cash in hand ' + fmtRs(econ.cash);
  box.textContent = '';
  const section = (title) => { box.appendChild(E('div', 'garage-h', title)); };
  const row = (emoji, name, note, price, done, fn) => {
    const r = E('div', 'shop-row');
    r.appendChild(E('span', 'shop-emoji', emoji));
    const n = E('div', 'shop-name', name); if (note) n.appendChild(E('small', '', note)); r.appendChild(n);
    r.appendChild(E('span', 'shop-price', done ? '' : fmtRs(price)));
    const b = E('button', 'btn-teleport btn-use', done ? 'Fitted ✓' : 'Buy'); b.type = 'button'; b.disabled = !!done;
    b.onclick = fn; r.appendChild(b);
    box.appendChild(r);
  };
  section('🎨 Paint - ' + fmtRs(PRICE.paint));
  const sw = E('div', 'garage-swatches');
  PAINTS.forEach(([name, hex]) => {
    const b = E('button', 'garage-swatch' + ((m.c !== undefined ? m.c : v.hex) === hex ? ' on' : '')); b.type = 'button';
    b.style.background = '#' + hex.toString(16).padStart(6, '0'); b.title = name;
    b.onclick = () => buyMod(PRICE.paint, (mm) => { mm.c = hex; }, name + ' paint job');
    sw.appendChild(b);
  });
  box.appendChild(sw);
  section('⚙️ Engine');
  const cur = m.eng || 0;
  ENGINE_STAGES.forEach((st, i) => { if (i > 0) row('🏎️', st.name, '+' + Math.round((st.max - 1) * 100) + '% top speed, +' + Math.round((st.acc - 1) * 100) + '% acceleration', st.price, cur >= i, () => { if (i !== cur + 1) { _garageMsg = 'Fit ' + ENGINE_STAGES[cur + 1].name.split(' -')[0] + ' first.'; renderGarage(); return; } buyMod(st.price, (mm) => { mm.eng = i; }, st.name.split(' -')[0]); }); });
  section('🔥 Performance & looks');
  row('🧪', 'Nitro kit', 'Hold SHIFT while accelerating: +40% speed for 4 s, refills itself', PRICE.nitro, m.nitro, () => buyMod(PRICE.nitro, (mm) => { mm.nitro = true; }, 'Nitro kit'));
  if (v.type !== 'bike' && v.type !== 'bus') row('🪽', 'Sport spoiler', 'Sharper steering at speed', PRICE.spoiler, m.spoiler, () => buyMod(PRICE.spoiler, (mm) => { mm.spoiler = true; }, 'Spoiler'));
  row('🛞', 'Off-road suspension', 'Soft landings off jumps and a little steering in the air', PRICE.susp, m.susp, () => buyMod(PRICE.susp, (mm) => { mm.susp = true; }, 'Off-road suspension'));
  section('💡 Neon underglow - ' + fmtRs(PRICE.neon));
  const nw = E('div', 'garage-swatches');
  NEONS.forEach(([name, hex]) => {
    const b = E('button', 'garage-swatch neon' + (m.neon === hex ? ' on' : '')); b.type = 'button';
    b.style.background = '#' + hex.toString(16).padStart(6, '0'); b.title = name;
    b.onclick = () => buyMod(PRICE.neon, (mm) => { mm.neon = hex; }, name + ' neon');
    nw.appendChild(b);
  });
  box.appendChild(nw);
  const msg = document.getElementById('garage-msg'); msg.textContent = _garageMsg;
  msg.className = 'shop-msg' + (/Not enough|first/.test(_garageMsg) ? ' warn' : '');
}

// ======================================================================================================
// Nilambur Heli Services
// ======================================================================================================
const HELI_FEE = 500;
function heliGround(x, z) { return Math.max(groundHeight(x, z), WATER_Y + 0.3); }
function makeHelicopter(livery) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const tilt = new THREE.Group(); tilt.rotation.order = 'YXZ'; g.add(tilt);
  const body = new THREE.MeshStandardMaterial({ color: livery, roughness: 0.35, metalness: 0.3 });
  const white = new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.35, metalness: 0.2 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262a, roughness: 0.5, metalness: 0.5 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2a38, roughness: 0.05, metalness: 0.6, transparent: true, opacity: 0.75 });
  const add = (geo, mat, x, y, z, sx, sy, sz, rx, ry, rz, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx || 1, sy || 1, sz || 1); m.rotation.set(rx || 0, ry || 0, rz || 0); m.castShadow = true; (parent || tilt).add(m); return m; };
  add(new THREE.SphereGeometry(1, 20, 14), body, 0, 1.55, 0, 1.0, 0.95, 1.9);                   // cabin (2 m wide, 3.8 m long)
  add(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI / 2), glass, 0, 1.6, 0.85, 0.92, 0.85, 1.1, 0.35);
  add(new THREE.BoxGeometry(2.02, 0.12, 2.2), white, 0, 1.2, -0.1);                              // livery stripe
  add(new THREE.CylinderGeometry(0.1, 0.24, 4.6, 10), body, 0, 1.85, -3.8, 1, 1, 1, Math.PI / 2); // tail boom
  add(new THREE.BoxGeometry(0.08, 1.1, 0.7), body, 0, 2.3, -5.9, 1, 1, 1, -0.3);                 // tail fin
  add(new THREE.BoxGeometry(1.1, 0.06, 0.4), body, 0, 1.9, -5.7);                                 // stabiliser
  for (const sx of [-1, 1]) {                                                                      // skids
    add(new THREE.CylinderGeometry(0.05, 0.05, 3.4, 8), dark, sx * 0.95, 0.06, 0.1, 1, 1, 1, Math.PI / 2);
    for (const sz of [-0.8, 0.9]) add(new THREE.CylinderGeometry(0.04, 0.04, 0.8, 6), dark, sx * 0.8, 0.45, sz, 1, 1, 1, 0, 0, sx * 0.35);
  }
  add(new THREE.CylinderGeometry(0.1, 0.12, 0.5, 10), dark, 0, 2.65, 0);                          // mast
  const rotor = new THREE.Group(); rotor.position.set(0, 2.92, 0); tilt.add(rotor);
  for (let i = 0; i < 4; i++) add(new THREE.BoxGeometry(0.28, 0.035, 4.6), dark, Math.sin(i * Math.PI / 2) * 2.35, 0, Math.cos(i * Math.PI / 2) * 2.35, 1, 1, 1, 0, i * Math.PI / 2, 0, rotor);
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.12, 10), dark, 0, 0, 0, 1, 1, 1, 0, 0, 0, rotor);
  const trotor = new THREE.Group(); trotor.position.set(0.12, 2.1, -6.0); tilt.add(trotor);
  for (let i = 0; i < 2; i++) add(new THREE.BoxGeometry(0.02, 1.0, 0.1), dark, 0, 0, 0, 1, 1, 1, i * Math.PI / 2, 0, 0, trotor);
  scene.add(g);
  return { g: g, tilt: tilt, rotor: rotor, trotor: trotor };
}
function buildHelipad() {
  const F = frameAt(HELIPAD.x, HELIPAD.padY, HELIPAD.z, 0);
  const I = frame(F.bx, F.by, F.bz, 0, 1, 'int');
  GROUND_EXTRAS.push((x, z) => (Math.abs(x - HELIPAD.x) < 18.5 && Math.abs(z - HELIPAD.z) < 11) ? HELIPAD.padY : null);
  F.box('conc', 37, 0.6, 22, 0, -0.3, 0, 0x8e8c86);
  for (const px of [-9, 9]) {
    F.cyl('paint', 6.2, 6.2, 0.01, px, 0.006, 0, 0x2a2e33, 40);
    F.put('paint', new THREE.TorusGeometry(5.4, 0.18, 4, 48), px, 0.02, 0, 0xffd54f, Math.PI / 2);
    F.box('paint', 0.5, 0.012, 3.4, px - 1.1, 0.02, 0, 0xf2f2ee); F.box('paint', 0.5, 0.012, 3.4, px + 1.1, 0.02, 0, 0xf2f2ee); F.box('paint', 1.7, 0.012, 0.5, px, 0.02, 0, 0xf2f2ee);
  }
  for (let i = 0; i < 12; i++) F.cyl('lamp', 0.1, 0.1, 0.12, -18 + (i % 6) * 7.2, 0.06, i < 6 ? -10.6 : 10.6, 0xffd54f, 8);   // edge lights
  // Terminal booth + windsock
  const B = frameAt(HELIPAD.x, HELIPAD.padY, HELIPAD.z - 14, 0);
  GROUND_EXTRAS.push((x, z) => (Math.abs(x - HELIPAD.x) < 4 && z > HELIPAD.z - 17 && z < HELIPAD.z - 11) ? HELIPAD.padY : null);
  B.box('conc', 8, 0.6, 6, 0, -0.3, 0, 0x8e8c86);
  B.box('wall', 5, 3, 0.2, 0, 1.5, -1.9, 0xeceae4); for (const sx of [-1, 1]) B.box('wall', 0.2, 3, 3.8, sx * 2.5, 1.5, 0, 0xeceae4);
  B.box('roof', 5.6, 0.2, 4.4, 0, 3.1, 0, 0x2a58d8);
  B.col(0, -1.9, 2.6, 0.15); for (const sx of [-1, 1]) B.col(sx * 2.5, 0, 0.15, 1.9);
  counter(B, 0, 0.3, 3.0, 0.6, 1.0, 0xe8e4dc);
  townSign(B, ['NILAMBUR HELI SERVICES', 'Joy rides · ₹' + HELI_FEE + ' per flight'], 0, 3.7, 2.25, 5, { bg: '#1c3a6e', fg: '#ffffff', border: '#ffd54f' });
  npc(frame(B.bx, B.by, B.bz, 0, 1, 'int'), 0, 0, -0.5, 0, { shirt: 0xf2f2ee, lower: 0x1c2a4a, cap: 0x1c2a4a, pose: 'front' });
  const pole = frameAt(HELIPAD.x + 17, HELIPAD.padY, HELIPAD.z - 9, 0);
  pole.cyl('metal', 0.05, 0.06, 5, 0, 2.5, 0, 0xc8ccd0, 8);
  pole.put('cloth', new THREE.CylinderGeometry(0.12, 0.3, 1.4, 10, 1, true), 0.75, 4.8, 0, 0xff6a1a, 0, 0, Math.PI / 2);
  addSpot(I, 0, 0, -9.5, '🚁', 'Helicopter joy ride - walk up to a helicopter and press E (₹' + HELI_FEE + ' flight fee)', () => ['Nilambur Heli Services', 'Walk to either helicopter and press E. The ₹' + HELI_FEE + ' flight fee is paid in cash when you board. SPACE climbs, SHIFT descends, W/S fly forward and back, A/D turn.'], 4);
  // Two helicopters on the pads
  [[-9, 0xc0392b], [9, 0x1f5fa8]].forEach(([px, col], k) => {
    const h = makeHelicopter(col);
    const x = HELIPAD.x + px, z = HELIPAD.z, y = HELIPAD.padY;
    h.g.position.set(x, y, z); h.g.rotation.y = k ? Math.PI : 0;
    VEHICLES.push({ type: 'heli', hex: col, g: h.g, x: x, z: z, y: y, vy: 0, yaw: h.g.rotation.y, spd: 0, collider: addCircleCollider(x, z, 2.2), radius: 2.2, mover: null, occupied: false, heli: h });
  });
}
function heliBoard(v) {
  if (v.paid) return true;
  if (typeof ADS !== 'undefined' && ADS.enabled) { heliChoice(v, HELI_FEE); return false; }   // pay, or watch an ad for a free flight (ads.js)
  if (!spendCash(HELI_FEE)) { triggerLandmarkPopup('🚁 Flight fee ' + fmtRs(HELI_FEE), 'You have ' + fmtRs(econ.cash) + ' cash. Earn money from the 💼 Jobs board, then come back for your joy ride.'); return false; }
  v.paid = true;
  return true;
}
function updateHeli(v, dt) {
  const s = VEH_SPECS.heli, h = v.heli;
  let inF = 0, inR = 0, up = 0;
  if (keyState['KeyW'] || keyState['ArrowUp']) inF += 1;
  if (keyState['KeyS'] || keyState['ArrowDown']) inF -= 1;
  if (keyState['KeyD'] || keyState['ArrowRight']) inR -= 1;
  if (keyState['KeyA'] || keyState['ArrowLeft']) inR += 1;
  if (keyState['Space']) up += 1;
  if (keyState['ShiftLeft'] || keyState['ShiftRight']) up -= 1;
  const gY = heliGround(v.x, v.z);
  if (v.y === undefined) v.y = gY;
  const landed = v.y - gY < 0.05;
  h.spin = Math.min(1, (h.spin || 0) + dt * 0.5);                 // rotor spools up before it can lift
  const lift = h.spin > 0.8;
  // vertical: SPACE climbs 7 m/s, SHIFT descends 5 m/s, otherwise it holds altitude
  const targetVy = lift ? (up > 0 ? 7 : up < 0 ? -5 : 0) : 0;
  v.vy += (targetVy - v.vy) * Math.min(1, dt * 2.5);
  v.y += v.vy * dt;
  if (v.y < gY) { v.y = gY; v.vy = 0; }
  v.y = Math.min(v.y, gY + 380);
  // horizontal: only once off the ground
  if (!landed || up > 0) {
    if (inF !== 0) v.spd = THREE.MathUtils.clamp(v.spd + inF * s.acc * dt, -s.max * 0.3, s.max);
    else v.spd += (0 - v.spd) * Math.min(1, dt * 0.7);
    v.yaw += inR * s.turn * dt;
  } else { v.spd *= 0.8; }
  v.x += Math.sin(v.yaw) * v.spd * dt;
  v.z += Math.cos(v.yaw) * v.spd * dt;
  const lim = WORLD_SIZE / 2 - 10;
  v.x = clamp(v.x, -lim, lim); v.z = clamp(v.z, -lim, lim);
  if (v.y - gY < 4) {   // low enough to hit buildings
    const pos = { x: v.x, z: v.z };
    resolveCollisions(pos, v.radius);
    if (Math.abs(pos.x - v.x) > 1e-4 || Math.abs(pos.z - v.z) > 1e-4) v.spd *= 0.5;
    v.x = pos.x; v.z = pos.z;
  }
  v.g.position.set(v.x, v.y, v.z);
  v.g.rotation.y = v.yaw;
  // nose dips when flying forward, banks into turns
  h.tilt.rotation.x += ((landed ? 0 : v.spd / s.max * 0.28 + inF * 0.06) - h.tilt.rotation.x) * Math.min(1, dt * 3);
  h.tilt.rotation.z += ((landed ? 0 : -inR * 0.22) - h.tilt.rotation.z) * Math.min(1, dt * 3);
  const parent = playerMesh.parent;
  parent.position.set(v.x, v.y + 0.6, v.z);
  state.playerPos.x = v.x; state.playerPos.y = v.y + 0.6; state.playerPos.z = v.z;
  camRig.idleTime = 0;
  updateCoordsPanel();
}

// ======================================================================================================
// Speedometer / altimeter
// ======================================================================================================
function drawSpeedo() {
  const cv = document.getElementById('speedo'); if (!cv) return;
  const v = state.driving;
  cv.classList.toggle('show', !!v);
  if (!v) return;
  const ctx = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2 + 6, R = W / 2 - 14;
  const kmh = Math.abs(v.spd) * 3.6, max = DIAL_MAX[v.type] || 200;
  const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, ang = (k) => a0 + (a1 - a0) * Math.min(1, k / max);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(10, 16, 14, 0.78)'; ctx.beginPath(); ctx.arc(cx, cy - 6, W / 2 - 4, 0, Math.PI * 2); ctx.fill();
  ctx.lineWidth = 7; ctx.strokeStyle = 'rgba(255,255,255,0.12)'; ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
  ctx.strokeStyle = v.boosting ? '#5ab8ff' : kmh > max * 0.8 ? '#ff5252' : '#00e676';
  ctx.beginPath(); ctx.arc(cx, cy, R, a0, ang(kmh)); ctx.stroke();
  ctx.fillStyle = '#cfd8dc'; ctx.font = '600 10px Outfit, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const step = max > 150 ? 40 : 20;
  for (let k = 0; k <= max; k += step) {
    const a = ang(k);
    ctx.fillText(String(k), cx + Math.cos(a) * (R - 18), cy + Math.sin(a) * (R - 18));
  }
  const a = ang(kmh);
  ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + Math.cos(a) * (R - 6), cy + Math.sin(a) * (R - 6)); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  ctx.font = '800 26px Outfit, sans-serif'; ctx.fillText(String(Math.round(kmh)), cx, cy + 30);
  ctx.font = '600 10px Outfit, sans-serif'; ctx.fillStyle = '#9fb3aa'; ctx.fillText('km/h', cx, cy + 48);
  let tag = '';
  if (v.type === 'heli') tag = 'ALT ' + Math.round(v.y - heliGround(v.x, v.z)) + ' m  ' + (v.vy > 0.5 ? '▲' : v.vy < -0.5 ? '▼' : '');
  else if (v.air) tag = 'AIR ' + (v.airT || 0).toFixed(1) + ' s';
  else if (modsOf(v).nitro) tag = 'NITRO ' + Math.round((v.nitro === undefined ? 1 : v.nitro) * 100) + '%';
  if (tag) { ctx.font = '800 12px Outfit, sans-serif'; ctx.fillStyle = v.air || v.type === 'heli' ? '#ffd54f' : '#5ab8ff'; ctx.fillText(tag, cx, cy - 26); }
}

// ======================================================================================================
// Per-frame
// ======================================================================================================
let _garagePromptOn = false;
function motorsTick(dt) {
  for (const v of VEHICLES) {
    if (v.type === 'heli') {
      const h = v.heli;
      if (!v.occupied) { h.spin = Math.max(0, (h.spin || 0) - dt * 0.25); }
      else if (v !== state.driving) { h.spin = 1; h.tilt.rotation.x = (v.spd || 0) / 45 * 0.28; }   // flown by another player
      h.rotor.rotation.y += dt * h.spin * 38;
      h.trotor.rotation.x += dt * h.spin * 60;
    } else if (v.modG) {
      const f = v.modG.getObjectByName('flame');
      if (f) { f.visible = !!v.boosting; if (f.visible) f.scale.set(1, 0.7 + Math.random() * 0.6, 1); }
    }
  }
  drawSpeedo();
  const v = state.driving, el = document.getElementById('garage-prompt');
  const show = !!(v && v.type !== 'heli' && v.type !== 'kayak' && inGarageBay(v.x, v.z) && Math.abs(v.spd) < 3);
  if (el && show !== _garagePromptOn) {
    _garagePromptOn = show;
    el.textContent = '';
    if (show) { const k = document.createElement('span'); k.className = 'key-badge'; k.textContent = 'G'; el.appendChild(k); el.appendChild(document.createTextNode(' 🔧 Modify this vehicle')); }
    el.classList.toggle('show', show);
  }
}

function buildMotorsExtras() {
  buildGarage();
  buildHelipad();
  // Re-apply saved upgrades (indices are stable: the world is built the same way on every load)
  for (const k in VMODS) { const v = VEHICLES[+k]; if (v && v.type !== 'heli') { v.mods = Object.assign({}, VMODS[k]); applyMods(v); } }
}
