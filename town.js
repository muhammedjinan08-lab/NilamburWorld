/**
 * town.js - Nilambur Town: paved streets, bazaar shops, civic buildings, bus station, market,
 * fuel station, temple / church / mosque, traffic and pedestrians.
 * Depends on proc.js + world.js (TOWN, TOWN_H, M, TEX, ANIM, mk, texBox, addBoxCollider ...).
 * Almost everything static is merged into one mesh per material to keep draw calls low.
 */

const TM = {};                 // town materials
const TB = {};                 // static batches: key -> [{geo, matrix, color}]
const TOWN_ANIM = { movers: [], walkers: [] };
const TX = 178;                          // town is authored in local coordinates (main street x = TX) ...
const OX = TOWN.cx - TX;                 // ... and shifted into the world by OX
const TC = { x: TX, z: 0 };              // main street runs N-S through x = TC.x, cross road E-W through z = 0
const colBox = (x, z, hw, hd) => addBoxCollider(x + OX, z, hw, hd);
const colCirc = (x, z, r) => addCircleCollider(x + OX, z, r);
const LANE_X = 142.5;                    // west lane (N-S)
const RING = 180, RING_Z = 330;          // half-extents of the ring road around the town
const ROAD_Y = 0.13;                     // road surface above terrain
const PAVE_Y = 0.18;                     // pavement top above terrain
const FACE = { e: Math.PI / 2, w: -Math.PI / 2, n: Math.PI, s: 0 };

const _te = new THREE.Euler(0, 0, 0, 'YXZ'), _tq = new THREE.Quaternion(), _tv = new THREE.Vector3(), _ts = new THREE.Vector3(1, 1, 1);

function tbPush(key, geo, matrix, hex) {
  (TB[key] || (TB[key] = [])).push({ geo: geo, matrix: matrix, color: hex === undefined ? null : new THREE.Color(hex) });
}

// Building-local frame: origin at (bx, by, bz), yaw ry. Local +z is the "front".
function frame(bx, by, bz, ry) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const F = { ry: ry, bx: bx, by: by, bz: bz };
  F.w = function (lx, lz) { return [bx + lx * c + lz * s + OX, bz - lx * s + lz * c]; };
  F.put = function (key, geo, lx, ly, lz, hex, rx, lry, rz) {
    const p = F.w(lx, lz);
    _te.set(rx || 0, ry + (lry || 0), rz || 0);
    _tq.setFromEuler(_te);
    _tv.set(p[0], by + ly, p[1]);
    tbPush(key, geo, new THREE.Matrix4().compose(_tv, _tq, _ts), hex);
  };
  F.box = function (key, w, h, d, lx, ly, lz, hex, rx, lry, rz) {
    const g = (key === 'wall' || key === 'conc') ? texBox(w, h, d, 4) : new THREE.BoxGeometry(w, h, d);
    F.put(key, g, lx, ly, lz, hex, rx, lry, rz);
  };
  F.cyl = function (key, rt, rb, h, lx, ly, lz, hex, seg, rx, lry, rz) {
    F.put(key, new THREE.CylinderGeometry(rt, rb, h, seg || 10), lx, ly, lz, hex, rx, lry, rz);
  };
  F.sph = function (key, r, lx, ly, lz, hex, sy) {
    const g = new THREE.SphereGeometry(r, 12, 8);
    if (sy) g.scale(1, sy, 1);
    F.put(key, g, lx, ly, lz, hex);
  };
  F.col = function (lx, lz, hw, hd) {
    const p = F.w(lx, lz), q = Math.abs(Math.sin(ry)) > 0.7;
    addBoxCollider(p[0], p[1], q ? hd : hw, q ? hw : hd);
  };
  return F;
}

// ---------- Sign boards (individual meshes: own texture, glow at night) ----------
function townSign(F, lines, lx, ly, lz, w, opts) {
  opts = Object.assign({ w: 640, h: 110 }, opts || {});
  if (!opts.size) opts.size = Math.max(26, Math.min(48, 540 / (lines[0].length * 0.6)));
  const h = w * opts.h / opts.w;
  const tex = signTexture(lines, opts);
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, emissive: 0xb0b0b0, emissiveMap: tex, emissiveIntensity: 0 });
  ANIM.glowMats.push(m);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.14), [M.woodDark, M.woodDark, M.woodDark, M.woodDark, m, M.woodDark]);
  const p = F.w(lx, lz);
  mesh.position.set(p[0], F.by + ly, p[1]);
  mesh.rotation.y = F.ry;
  mesh.castShadow = true;
  scene.add(mesh);
  return mesh;
}

// ---------- Materials & textures ----------
function townMaterials() {
  const vc = (m) => { const c = m.clone(); c.vertexColors = true; c.color.set(0xffffff); return c; };
  TM.wall = vc(M.plaster);
  TM.roof = vc(M.roof);
  TM.wood = vc(M.wood);
  TM.conc = vc(M.concrete);
  TM.metal = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.8 });
  TM.cloth = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
  TM.paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.55 });
  TM.rubber = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 });
  TM.vglass = new THREE.MeshStandardMaterial({ color: 0x0f1a22, roughness: 0.08, metalness: 0.4 });
  TM.gold = new THREE.MeshStandardMaterial({ color: 0xd4a017, roughness: 0.3, metalness: 0.9 });
  TM.key = { wall: TM.wall, roof: TM.roof, wood: TM.wood, conc: TM.conc, metal: TM.metal, cloth: TM.cloth, paint: TM.paint, rubber: TM.rubber, vglass: TM.vglass, gold: TM.gold, glass: M.glass, lamp: M.lampGlow };

  // Asphalt with lane markings (u along the road, v across it; one tile = 8 m x road width)
  const mkRoad = (markings) => {
    const S = 256;
    const c = mkCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#3b3b3e'; g.fillRect(0, 0, S, S);
    const rng = makeRng(5);
    for (let i = 0; i < 5200; i++) {
      const v = 40 + rng() * 50;
      g.fillStyle = 'rgba(' + v + ',' + v + ',' + (v + 4) + ',' + (0.25 + rng() * 0.4) + ')';
      g.fillRect(rng() * S, rng() * S, 1 + rng() * 2, 1 + rng() * 2);
    }
    for (let i = 0; i < 24; i++) {   // tar patches
      g.fillStyle = 'rgba(20,20,22,0.22)';
      g.beginPath(); g.ellipse(rng() * S, rng() * S, 6 + rng() * 22, 3 + rng() * 9, rng() * 3, 0, 6.3); g.fill();
    }
    if (markings) {
      g.fillStyle = 'rgba(235,235,225,0.92)';
      g.fillRect(0, 10, S, 5); g.fillRect(0, S - 15, S, 5);          // edge lines
      g.fillStyle = 'rgba(240,215,90,0.95)';
      g.fillRect(0, S / 2 - 3, S / 2, 6);                            // dashed centre line
    }
    return canvasTex(c);
  };
  TEX.roadMark = mkRoad(true);
  TEX.roadPlain = mkRoad(false);
  TM.roadMark = new THREE.MeshStandardMaterial({ map: TEX.roadMark, roughness: 0.92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  TM.roadPlain = new THREE.MeshStandardMaterial({ map: TEX.roadPlain, roughness: 0.92, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });

  // Town clock face
  {
    const S = 256, c = mkCanvas(S, S), g = c.getContext('2d');
    g.fillStyle = '#f3ecd8'; g.fillRect(0, 0, S, S);
    g.strokeStyle = '#2a1a10'; g.lineWidth = 8; g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 12, 0, 6.3); g.stroke();
    g.lineWidth = 5;
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      g.beginPath(); g.moveTo(S / 2 + Math.sin(a) * 88, S / 2 - Math.cos(a) * 88); g.lineTo(S / 2 + Math.sin(a) * 106, S / 2 - Math.cos(a) * 106); g.stroke();
    }
    g.lineWidth = 9; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.sin(-1.0) * 62, S / 2 - Math.cos(-1.0) * 62); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(S / 2, S / 2); g.lineTo(S / 2 + Math.sin(2.05) * 92, S / 2 - Math.cos(2.05) * 92); g.stroke();
    TEX.clock = canvasTex(c, { wrap: false });
  }
}

// ---------- Roads ----------
function roadStrip(ax, az, bx, bz, width, mat, yoff, uRep) {
  ax += OX; bx += OX;
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
  const nx = -dz / L, nz = dx / L, n = Math.max(2, Math.ceil(L / 2.5));
  const A = [], B = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = ax + dx * t, z = az + dz * t;
    const x1 = x + nx * width / 2, z1 = z + nz * width / 2, x2 = x - nx * width / 2, z2 = z - nz * width / 2;
    A.push(new THREE.Vector3(x1, heightAt(x1, z1) + yoff, z1));
    B.push(new THREE.Vector3(x2, heightAt(x2, z2) + yoff, z2));
  }
  const g = makeRibbon(A, B, uRep || 8, 1);
  const nor = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < nor.length; i += 3) nor[i + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true;
  scene.add(m);
}

function roadPatch(cx, cz, w, d, yoff) {
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / 8, uv.getY(i) * d / 8);
  const m = new THREE.Mesh(g, TM.roadPlain);
  m.position.set(cx + OX, heightAt(cx + OX, cz) + yoff, cz);
  m.receiveShadow = true;
  scene.add(m);
}

function pavementBox(x0, x1, z0, z1) {   // world-aligned kerb + footpath slab
  const F = frame((x0 + x1) / 2, TOWN_H, (z0 + z1) / 2, 0);
  F.box('conc', x1 - x0, PAVE_Y, z1 - z0, 0, PAVE_Y / 2, 0, 0xb8b2a4);
}

function buildTownRoads() {
  const y = ROAD_Y;
  // A closed ring road encircles the town; the main street, cross road and west lane all run out to it,
  // so no road dead-ends and none leads back towards the Canoly bridge.
  const RW = TC.x - RING, RE = TC.x + RING;
  roadStrip(RW, -RING_Z, RE, -RING_Z, 12, TM.roadMark, y, 8);
  roadStrip(RW, RING_Z, RE, RING_Z, 12, TM.roadMark, y, 8);
  roadStrip(RW, -RING_Z, RW, RING_Z, 12, TM.roadMark, y, 8);
  roadStrip(RE, -RING_Z, RE, RING_Z, 12, TM.roadMark, y, 8);
  roadStrip(RW, 0, RE, 0, 12, TM.roadMark, y + 0.004, 8);                 // cross road
  roadStrip(TC.x, -RING_Z, TC.x, RING_Z, 12, TM.roadMark, y + 0.005, 8);  // main street
  roadStrip(LANE_X, -RING_Z, LANE_X, RING_Z, 7, TM.roadMark, y + 0.005, 8); // west lane
  // Junction patches hide the crossing centre lines
  roadPatch(TC.x, 0, 12, 12, y + 0.02);
  roadPatch(LANE_X, 0, 7, 12, y + 0.02);
  for (const jx of [RW, LANE_X, TC.x, RE]) for (const jz of [-RING_Z, RING_Z]) roadPatch(jx, jz, 12, 12, y + 0.02);
  for (const jz of [0]) for (const jx of [RW, RE]) roadPatch(jx, jz, 12, 12, y + 0.02);
  // Yards
  roadPatch(215, 52, 32, 91, y + 0.01);       // bus station yard
  roadPatch(215, -52, 32, 89, y + 0.01);      // market yard / fuel station forecourt

  // Footpaths (skip the crossings)
  const gapsZ = [[-80, -6], [6, 80]];
  for (const g of gapsZ) {
    pavementBox(TC.x - 8.5, TC.x - 6, g[0], g[1]);
    pavementBox(TC.x + 6, TC.x + 8.5, g[0], g[1]);
  }
  const lz = [[-84, -6], [6, 96]];
  for (const g of lz) { pavementBox(LANE_X - 5, LANE_X - 3.5, g[0], g[1]); pavementBox(LANE_X + 3.5, LANE_X + 5, g[0], g[1]); }
  const cx = [[124, LANE_X - 5], [LANE_X + 5, TC.x - 8.5], [TC.x + 8.5, 232]];
  for (const g of cx) { pavementBox(g[0], g[1], -8.5, -6); pavementBox(g[0], g[1], 6, 8.5); }

  // Zebra crossings
  const Z = frame(0, TOWN_H + ROAD_Y, 0, 0);
  for (let i = -5; i <= 5; i++) {
    for (const zz of [-8.6, 8.6]) Z.box('cloth', 0.55, 0.02, 3, TC.x + i * 1.05, 0.02, zz, 0xf2f2ea);
    for (const xx of [-8, 8]) Z.box('cloth', 3, 0.02, 0.55, TC.x + xx + (xx > 0 ? 3.4 : -3.4), 0.02, i * 1.05, 0xf2f2ea);
  }

  // Street lamps along both streets
  const lamp = (x, z, faceDir) => {
    const F = frame(x, TOWN_H, z, 0);
    F.cyl('metal', 0.07, 0.11, 6.4, 0, 3.2, 0, 0x3a4248, 8);
    F.box('metal', 1.8, 0.07, 0.07, faceDir * 0.9, 6.35, 0, 0x3a4248);
    F.sph('lamp', 0.27, faceDir * 1.7, 6.2, 0, undefined, 0.7);
    F.box('metal', 0.5, 0.06, 0.4, faceDir * 1.7, 6.5, 0, 0x3a4248);
  };
  for (let z = -76; z <= 76; z += 19) {
    if (Math.abs(z) < 8) continue;
    lamp(TC.x - 6.5, z, 1);
    lamp(TC.x + 6.5, z + 9.5 > 80 ? z : z + 9.5, -1);
  }
  for (let x = 130; x <= 226; x += 24) {
    if (Math.abs(x - TC.x) < 8 || Math.abs(x - LANE_X) < 6) continue;
    const F = frame(x, TOWN_H, -7.2, 0);
    F.cyl('metal', 0.07, 0.11, 6.4, 0, 3.2, 0, 0x3a4248, 8);
    F.box('metal', 0.07, 0.07, 1.8, 0, 6.35, 0.9, 0x3a4248);
    F.sph('lamp', 0.27, 0, 6.2, 1.7, undefined, 0.7);
  }
  // Gulmohar-style flag bunting across the bazaar
  const cols = [0xff9933, 0xffffff, 0x2ea043, 0xe03a3a, 0xf5d020, 0x2a7bd8];
  for (const zz of [-24, 24, -54, 54]) {
    const Fb = frame(TC.x, TOWN_H, zz, 0);
    Fb.box('cloth', 17, 0.03, 0.03, 0, 6.9, 0, 0x2a2018);
    for (let i = 0; i < 17; i++) Fb.box('cloth', 0.5, 0.55, 0.02, -8 + i * 1.0, 6.6, 0, cols[i % cols.length], 0, 0, (i % 2 ? 0.7 : -0.7));
  }

  // Clock tower on the central island
  {
    const F = frame(TC.x, TOWN_H + ROAD_Y, 0, 0);
    F.cyl('conc', 1.4, 1.5, 0.35, 0, 0.17, 0, 0xb4ae9e, 20);
    F.box('wall', 0.95, 4.6, 0.95, 0, 2.5, 0, 0xf2ead2);
    F.box('wall', 1.5, 1.5, 1.5, 0, 5.6, 0, 0xf2ead2);
    F.cyl('roof', 0.05, 1.25, 1.4, 0, 6.9, 0, 0xa0402c, 4, 0, Math.PI / 4);
    F.sph('gold', 0.12, 0, 7.7, 0);
    const cm = new THREE.MeshStandardMaterial({ map: TEX.clock, roughness: 0.6 });
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(1.15, 1.15), cm);
      pl.position.set(OX + TC.x + Math.sin(i * Math.PI / 2) * 0.77, TOWN_H + ROAD_Y + 5.6, Math.cos(i * Math.PI / 2) * 0.77);
      pl.rotation.y = i * Math.PI / 2;
      scene.add(pl);
    }
    colCirc(TC.x, 0, 1.5);
  }
}

// ---------- Generic shop / civic building ----------
const KIND_STYLE = {
  textile: { bg: '#7a1f46', fg: '#ffe9a8', border: '#ffd166', awn: [0xc0392b, 0xf7e3b5] },
  gold: { bg: '#4a0d12', fg: '#ffd24a', border: '#ffd24a', awn: [0x6a1520, 0xd4a017] },
  bakery: { bg: '#b5541c', fg: '#fff4d6', border: '#fff4d6', awn: [0xe8873a, 0xfff2d0] },
  tea: { bg: '#1f5a3a', fg: '#fff2cc', border: '#fff2cc', awn: [0x2e7d4f, 0xf2e6c0] },
  grocery: { bg: '#1d6b32', fg: '#ffffff', border: '#f2d64b', awn: [0x2ea043, 0xffffff] },
  pharmacy: { bg: '#0d6b57', fg: '#ffffff', border: '#ffffff', awn: [0x159a7e, 0xffffff] },
  hardware: { bg: '#204a8a', fg: '#ffffff', border: '#f4b400', awn: [0x2a5cb8, 0xf4b400] },
  mobile: { bg: '#151c2b', fg: '#3ee0ff', border: '#3ee0ff', awn: [0x1b6dc2, 0x22262f] },
  fruit: { bg: '#2a7d2a', fg: '#fff36a', border: '#fff36a', awn: [0x3aa63a, 0xf5d020] },
  stationery: { bg: '#8a2a2a', fg: '#ffffff', border: '#ffffff', awn: [0xb83a3a, 0xf0f0f0] },
  hotel: { bg: '#5a2a12', fg: '#ffe3b0', border: '#ffe3b0', awn: [0x8a4a22, 0xf2dcae] },
  salon: { bg: '#5a2a6a', fg: '#ffffff', border: '#ffb3f0', awn: [0x9a4ab0, 0xf7d8f2] },
  electronics: { bg: '#0f3d6e', fg: '#ffffff', border: '#66ccff', awn: [0x1e6bb8, 0xdfeeff] },
  furniture: { bg: '#4a2c14', fg: '#f3dfa8', border: '#d9b26a', awn: [0x7a4a24, 0xe8d4a8] },
  optical: { bg: '#1a3a5a', fg: '#e8f6ff', border: '#9ad6ff', awn: [0x2a5a8a, 0xe8f6ff] },
  civic: { bg: '#123c6b', fg: '#ffffff', border: '#ffd166', awn: [0x8a8a8a, 0xd8d8d8] }
};
const WALLS = [0xf2e6c8, 0xe8c9a0, 0xc9d8c5, 0xf0d0c0, 0xd9e2ee, 0xf4c7c7, 0xf3ecb0, 0xd6c6e6, 0xffffff, 0xe6a97a, 0xbfe0d8, 0xf6d9a4];

function shopBuilding(o) {
  const F = frame(o.x, TOWN_H, o.z, FACE[o.face]);
  const w = o.w, d = o.d, fl = o.floors || 2, h1 = o.h1 || 4.4, hu = 3.2, H = h1 + (fl - 1) * hu;
  const st = KIND_STYLE[o.kind] || KIND_STYLE.civic;
  const wall = o.wall;
  const fz = d / 2;
  F.box('wall', w, H, d, 0, H / 2, 0, wall);
  F.box('conc', w + 0.1, 0.5, d + 0.1, 0, 0.25, 0, 0x8a8478);
  F.box('wall', w + 0.3, 0.26, d + 0.3, 0, H + 0.02, 0, 0xf6f1e4);
  if (o.roof === 'gable') {
    const g = makeGableRoof(w, d, 2.0, 0.2, 1);
    F.put('roof', g.roof, 0, H + 0.15, 0, o.roofTint || 0xffffff);
    F.put('wall', g.gable, 0, H + 0.15, 0, wall);
  } else {
    const t = 0.22, ph = 0.6;
    F.box('wall', w + 0.2, ph, t, 0, H + 0.4, fz + 0.05, 0xece6d6);
    F.box('wall', w + 0.2, ph, t, 0, H + 0.4, -fz - 0.05, 0xece6d6);
    F.box('wall', t, ph, d + 0.2, w / 2 + 0.05, H + 0.4, 0, 0xece6d6);
    F.box('wall', t, ph, d + 0.2, -w / 2 - 0.05, H + 0.4, 0, 0xece6d6);
    // water tank + stair head
    F.cyl('paint', 0.62, 0.62, 1.1, w * 0.22, H + 1.5, -d * 0.2, 0x1c1c1c, 12);
    F.box('metal', 0.1, 0.9, 0.1, w * 0.22 + 0.4, H + 0.9, -d * 0.2 + 0.4, 0x555555);
    F.box('metal', 0.1, 0.9, 0.1, w * 0.22 - 0.4, H + 0.9, -d * 0.2 - 0.4, 0x555555);
    if (w > 8) F.box('wall', 2.2, 2.4, 2.2, -w * 0.3, H + 1.3, -d * 0.15, wall);
  }

  // Ground floor: glazed shop front, door, rolled shutter and striped awning
  const fw = w - 1.6;
  F.box('wood', fw + 0.3, 3.05, 0.14, 0, 1.85, fz + 0.02, 0x5a3a20);
  F.box('glass', fw, 2.75, 0.2, 0, 1.85, fz + 0.06);
  F.box('wood', 1.05, 2.5, 0.24, fw / 2 - 1.1, 1.55, fz + 0.07, 0x4a2c14);
  F.box('metal', fw + 0.3, 0.42, 0.28, 0, 3.55, fz + 0.12, 0x9ca3a8);
  const n = Math.max(4, Math.round(w / 1.25) & ~1), sw = w / n;
  for (let i = 0; i < n; i++) F.box('cloth', sw, 0.05, 1.7, -w / 2 + sw * (i + 0.5), 3.42, fz + 0.85, st.awn[i % 2], 0.3);
  townSign(F, [o.name, o.sub], 0, h1 - 0.5, fz + 0.1, Math.min(w - 1.6, 7.4), { bg: st.bg, fg: st.fg, border: st.border });
  if (o.kind === 'pharmacy') {
    F.box('cloth', 0.9, 0.3, 0.06, w / 2 - 0.85, h1 - 0.5, fz + 0.2, 0x159a7e);
    F.box('cloth', 0.3, 0.9, 0.06, w / 2 - 0.85, h1 - 0.5, fz + 0.2, 0x159a7e);
  }
  // Upper floors
  for (let f = 1; f < fl; f++) {
    const y = h1 + (f - 1) * hu + hu / 2 + 0.05, cnt = Math.max(2, Math.floor(w / 3.2));
    for (let j = 0; j < cnt; j++) {
      const x = -w / 2 + w * (j + 0.5) / cnt;
      F.box('wood', 1.7, 1.95, 0.14, x, y, fz + 0.03, 0x6a4a2a);
      F.box('glass', 1.35, 1.6, 0.18, x, y, fz + 0.06);
      F.box('conc', 1.95, 0.12, 0.4, x, y - 1.05, fz + 0.15, 0xcfc8b8);
      F.box('wood', 0.06, 1.6, 0.2, x, y, fz + 0.09, 0x6a4a2a);
    }
    F.box('wall', w + 0.1, 0.18, 0.12, 0, h1 + (f - 1) * hu + 0.02, fz + 0.03, 0xf6f1e4);
  }
  shopGoods(F, o, fz, w, h1);
  if (o.extra) o.extra(F, fz, w, d, H);

  const sideways = (o.face === 'e' || o.face === 'w');
  colBox(o.x, o.z, (sideways ? d : w) / 2, (sideways ? w : d) / 2);
}

function shopGoods(F, o, fz, w, h1) {
  const cols = [0xd33a3a, 0x2a8a3a, 0xf0b820, 0x3a5ad0, 0xe08a20, 0x8a3ab0];
  const P = fz + 1.15;   // just outside the awning line on the footpath
  const fx = (i, gap) => -w / 2 + 1.4 + i * gap;
  switch (o.kind) {
    case 'fruit':
      for (let i = 0; i < 4; i++) {
        const x = fx(i, 1.7), c = [0xd8402a, 0x3f9a3a, 0xf3b81c, 0xd87a2a][i];
        F.box('wood', 1.2, 0.5, 0.8, x, 0.45, P, 0x8a5a2a);
        for (let k = 0; k < 6; k++) F.sph('cloth', 0.19, x - 0.4 + (k % 3) * 0.4, 0.86, P - 0.15 + Math.floor(k / 3) * 0.32, c, 0.9);
      }
      for (let i = 0; i < 5; i++) F.box('cloth', 0.22, 0.55, 0.22, fx(i, 1.5) + 0.3, 3.0, fz + 0.4, 0xd8c23a, 0, 0, 0.2);
      break;
    case 'textile':
      for (let i = 0; i < Math.floor((w - 2) / 1.5); i++) F.box('cloth', 0.75, 1.6, 0.03, fx(i, 1.5), 2.25, fz + 0.45, cols[i % cols.length]);
      for (const x of [-w / 2 + 1.6, w / 2 - 3]) {
        F.cyl('cloth', 0.2, 0.3, 1.25, x, 0.85, P, x < 0 ? 0xc0392b : 0x2a58d8, 10);
        F.sph('cloth', 0.13, x, 1.62, P, 0xb07a50);
        F.box('wood', 0.5, 0.05, 0.5, x, 0.22, P, 0x5a3a20);
      }
      break;
    case 'gold':
      F.box('gold', fw3(w), 0.1, 0.1, 0, 3.05, fz + 0.2);
      F.box('vglass', 3.2, 1.0, 0.7, -w / 2 + 2.6, 0.75, P - 0.15, 0x223038);
      break;
    case 'bakery':
      F.box('vglass', 3.0, 1.0, 0.8, -1.2, 0.72, P - 0.1, 0x20302c);
      for (let i = 0; i < 4; i++) F.cyl('cloth', 0.28, 0.28, 0.2, -2.3 + i * 0.75, 1.32, P - 0.1, [0xf4b5c8, 0x8a4a2a, 0xf7e3a0, 0xd97a4a][i], 12);
      break;
    case 'tea':
      F.box('wood', 2.4, 0.08, 0.45, -1.4, 0.6, P + 0.4, 0x6a4a2a);
      F.box('wood', 0.08, 0.6, 0.4, -2.4, 0.3, P + 0.4, 0x6a4a2a);
      F.box('wood', 0.08, 0.6, 0.4, -0.4, 0.3, P + 0.4, 0x6a4a2a);
      F.cyl('metal', 0.26, 0.3, 0.7, w / 2 - 2.5, 1.15, fz + 0.5, 0xcfd4d8, 12);
      F.box('wood', 1.2, 0.9, 0.7, w / 2 - 2.5, 0.65, fz + 0.5, 0x7a5a30);
      for (let i = 0; i < 5; i++) F.box('cloth', 0.2, 0.5, 0.2, fx(i, 1.3), 3.0, fz + 0.35, 0xd8c23a, 0, 0, 0.15);
      break;
    case 'hardware':
      for (let i = 0; i < 3; i++) F.cyl('cloth', 0.08, 0.08, 3.4, -w / 2 + 1.3 + i * 0.2, 0.35 + i * 0.16, P + 0.3, [0x6a8aa8, 0xd8d8d8, 0x2a6ab0][i], 8, 0, 0, Math.PI / 2);
      for (let i = 0; i < 3; i++) F.cyl('cloth', 0.24, 0.3, 0.44, 0.6 + i * 0.75, 0.42, P, [0xd33a3a, 0x2a6ab0, 0xf0b820][i], 12);
      break;
    case 'grocery':
      for (let i = 0; i < 5; i++) F.box('cloth', 0.6, 0.75, 0.38, fx(i, 1.1), 0.55, P, [0xe8dcc0, 0xd8c8a0, 0xf2ead2, 0xc8a870, 0xe8dcc0][i]);
      break;
    case 'stationery':
      F.box('wood', 2.2, 2.0, 0.28, -w / 2 + 2.2, 1.15, P - 0.2, 0x8a5a2a);
      for (let i = 0; i < 9; i++) F.box('cloth', 0.38, 0.08, 0.05, -w / 2 + 1.45 + (i % 3) * 0.75, 0.6 + Math.floor(i / 3) * 0.6, P - 0.04, cols[i % cols.length]);
      break;
    case 'hotel':
      if ((o.floors || 2) >= 2) {
        F.box('conc', w - 0.8, 0.16, 1.3, 0, h1 + 0.05, fz + 0.65, 0xc9c2b2);
        F.box('metal', w - 0.8, 0.07, 0.07, 0, h1 + 0.95, fz + 1.28, 0x333333);
        for (let i = 0; i <= 8; i++) F.box('metal', 0.05, 0.9, 0.05, -(w - 1) / 2 + i * (w - 1) / 8, h1 + 0.5, fz + 1.28, 0x333333);
      }
      F.box('cloth', 1.1, 2.2, 0.04, w / 2 - 0.7, 2.6, fz + 0.3, 0xc0392b);
      break;
    case 'mobile':
      F.box('cloth', 1.0, 2.0, 0.04, -w / 2 + 0.9, 2.6, fz + 0.3, 0x1b6dc2);
      F.box('cloth', 1.0, 2.0, 0.04, w / 2 - 2.4, 2.6, fz + 0.3, 0xe8a020);
      break;
    case 'salon':
      F.cyl('cloth', 0.09, 0.09, 0.9, -w / 2 + 0.7, 1.5, fz + 0.2, 0xd33a3a, 8);
      break;
    case 'furniture':
      F.box('wood', 1.3, 0.55, 0.75, -1.2, 0.5, P, 0x8a5a2a);
      F.box('wood', 1.3, 0.8, 0.15, -1.2, 1.0, P - 0.3, 0x8a5a2a);
      F.box('wood', 1.0, 0.7, 1.0, 1.4, 0.55, P, 0x6a3c1c);
      break;
    case 'electronics':
      F.box('vglass', 1.2, 0.8, 0.12, -1.6, 1.2, P - 0.4, 0x0a1218);
      F.box('vglass', 1.2, 0.8, 0.12, 0.2, 1.2, P - 0.4, 0x0a1218);
      F.box('paint', 0.7, 1.6, 0.6, 2.1, 0.85, P - 0.3, 0xe8ecef);
      break;
  }
}
function fw3(w) { return Math.min(w - 3, 5); }

// ---------- Vehicles ----------
function vehicleParts(type, hex) {
  const P = [];
  const add = (key, geo, x, y, z, c, rx, ry, rz) => {
    _te.set(rx || 0, ry || 0, rz || 0); _tq.setFromEuler(_te); _tv.set(x, y, z);
    P.push({ key: key, geo: geo, matrix: new THREE.Matrix4().compose(_tv, _tq, _ts), color: c === undefined ? null : new THREE.Color(c) });
  };
  const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  const wheel = (x, z, r, w) => add('rubber', new THREE.CylinderGeometry(r, r, w, 12), x, r, z, 0x1a1a1a, 0, 0, Math.PI / 2);
  switch (type) {
    case 'car':
      add('paint', B(1.75, 0.72, 4.0), 0, 0.68, 0, hex);
      add('vglass', B(1.55, 0.55, 2.0), 0, 1.3, -0.15);
      add('paint', B(1.5, 0.08, 1.7), 0, 1.6, -0.15, hex);
      add('paint', B(1.6, 0.25, 0.8), 0, 1.02, 1.3, hex);
      for (const sx of [-1, 1]) for (const sz of [-1.25, 1.25]) wheel(sx * 0.85, sz, 0.32, 0.22);
      break;
    case 'auto':
      add('paint', B(1.3, 0.85, 2.1), 0, 0.85, -0.1, 0x151515);
      add('paint', B(1.45, 0.08, 2.1), 0, 1.75, -0.1, hex);
      add('vglass', B(1.2, 0.7, 0.06), 0, 1.35, 0.95);
      for (const sx of [-1, 1]) add('paint', B(0.06, 0.9, 0.06), sx * 0.66, 1.3, 0.9, 0x151515);
      add('paint', B(0.5, 0.5, 0.7), 0, 0.6, 1.2, 0x151515);
      wheel(0, 1.2, 0.28, 0.14); wheel(-0.62, -0.75, 0.28, 0.14); wheel(0.62, -0.75, 0.28, 0.14);
      break;
    case 'bus':
      add('paint', B(2.5, 2.7, 10.4), 0, 1.75, 0, hex);
      add('paint', B(2.52, 0.55, 10.42), 0, 0.85, 0, 0xf4f4ee);
      add('vglass', B(2.53, 0.95, 9.6), 0, 2.35, -0.1);
      add('vglass', B(2.2, 1.2, 0.06), 0, 2.15, 5.2);
      add('paint', B(2.55, 0.12, 10.45), 0, 3.12, 0, 0xf4f4ee);
      for (const sx of [-1, 1]) for (const sz of [-3.3, 3.3]) wheel(sx * 1.12, sz, 0.55, 0.3);
      break;
    case 'bike':
      add('paint', B(0.28, 0.45, 1.3), 0, 0.72, 0, hex);
      add('paint', B(0.3, 0.12, 0.7), 0, 0.98, -0.25, 0x151515);
      add('metal', B(0.7, 0.05, 0.05), 0, 1.15, 0.6, 0x555555);
      add('paint', B(0.14, 0.14, 0.5), 0, 0.95, 0.95, hex);
      wheel(0, 0.68, 0.31, 0.12); wheel(0, -0.68, 0.31, 0.12);
      break;
    case 'van':   // ambulance / jeep / fire truck body
      add('paint', B(2.1, 1.7, hex === 0xc8201e ? 6.6 : 4.9), 0, 1.3, 0, hex);
      add('vglass', B(2.12, 0.6, 1.2), 0, 1.75, hex === 0xc8201e ? 2.6 : 1.7);
      add('paint', B(2.12, 0.3, hex === 0xc8201e ? 6.62 : 4.92), 0, 1.05, 0, 0xf2f2ea);
      add('paint', B(2.0, 0.14, 0.4), 0, 2.25, hex === 0xc8201e ? 2.2 : 1.3, 0x2a58d8);
      if (hex === 0xc8201e) add('metal', B(0.5, 0.25, 4.6), 0, 2.3, -0.8, 0xc9ced2);
      for (const sx of [-1, 1]) for (const sz of (hex === 0xc8201e ? [-2.2, 2.2] : [-1.6, 1.6])) wheel(sx * 1.0, sz, 0.42, 0.28);
      break;
  }
  return P;
}
const VEH_LEN = { car: 4.0, auto: 2.6, bus: 10.4, bike: 1.7, van: 5.0 };

function placeVehicle(type, hex, x, z, yaw, noCollider) {
  const y = heightAt(x + OX, z) + ROAD_Y;
  const M4 = new THREE.Matrix4().compose(new THREE.Vector3(x + OX, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)), new THREE.Vector3(1, 1, 1));
  vehicleParts(type, hex).forEach(p => tbPush(p.key, p.geo, new THREE.Matrix4().multiplyMatrices(M4, p.matrix), p.color ? p.color.getHex() : undefined));
  if (!noCollider && type !== 'bike') {
    const L = (type === 'van' && hex === 0xc8201e ? 6.6 : VEH_LEN[type]) / 2, Wd = type === 'bus' ? 1.3 : 1.0;
    const along = Math.abs(Math.sin(yaw)) > 0.7;
    colBox(x, z, along ? L : Wd, along ? Wd : L);
  }
}

function movingVehicle(type, hex) {
  const byKey = {};
  vehicleParts(type, hex).forEach(p => (byKey[p.key] || (byKey[p.key] = [])).push(p));
  const g = new THREE.Group();
  for (const k in byKey) {
    const m = new THREE.Mesh(mergeGeos(byKey[k]), TM.key[k]);
    m.castShadow = true; m.receiveShadow = true;
    g.add(m);
  }
  scene.add(g);
  return g;
}

// ---------- Town layout ----------
const SHOP_POOL = [
  ['textile', 'Kairali Silks & Sarees', 'Wedding Collection'], ['gold', 'Swarna Jewellers', '916 KDM Hallmark'],
  ['bakery', 'Hot Bakes & Chips', 'Bakery · Sweets'], ['tea', 'Chayakkada', 'Tea · Parippuvada'],
  ['grocery', 'Fresh Mart Supermarket', 'Groceries · Provisions'], ['pharmacy', 'City Medicals', 'Pharmacy · Open 24 Hours'],
  ['hardware', 'Teak Hardware Mart', 'Paints · Pipes · Tools'], ['mobile', 'Mobile World', 'Sales · Service · Recharge'],
  ['fruit', 'Malabar Fruits & Veg', 'Fresh Daily'], ['stationery', 'Book Point', 'Books · Stationery'],
  ['hotel', 'Hotel Malabar', 'Biriyani · Meals · Rooms'], ['salon', 'Trendz Gents Salon', 'Hair · Beard'],
  ['electronics', 'Sree Electronics', 'TV · Fridge · AC'], ['furniture', 'Nilambur Teak Furniture', 'Showroom'],
  ['textile', 'Fashion Hub', 'Readymade Garments'], ['gold', 'Royal Gold & Diamonds', 'Bridal Jewellery'],
  ['bakery', 'Sweet Bites', 'Cakes · Ice Cream'], ['tea', "Nair's Tea Stall", 'Since 1978'],
  ['grocery', 'Malabar Provisions', 'Rice · Spices · Oil'], ['pharmacy', 'Jan Aushadhi Store', 'Generic Medicines'],
  ['optical', 'Vision Opticals', 'Eye Care'], ['mobile', 'Digital Point', 'Laptops · Phones'],
  ['hotel', 'Kerala Kitchen', 'Veg & Non-veg Restaurant'], ['stationery', "Student's Corner", 'Uniforms · Bags'],
  ['salon', 'Glow Beauty Parlour', 'Ladies'], ['hardware', 'Chaliyar Traders', 'Building Materials'],
  ['fruit', 'Spice & Nuts', 'Cashew · Pepper · Cardamom'], ['electronics', 'Tech Bazaar', 'Computers · Cameras'],
  ['textile', "Ammu's Tailoring", 'Ladies & Gents'], ['bakery', 'Thomas Bakery', 'Puffs · Cutlets · Cakes'],
  ['stationery', 'Star Xerox & DTP', 'Photocopy · Print'], ['grocery', 'Gulf Bazaar', 'Imported Goods'],
  ['tea', 'Kanan Devan Tea Depot', 'Fresh Blends'], ['textile', 'Pattu Textiles', 'Kasavu · Silk'],
  ['hotel', 'Sunrise Lodge', 'A/C Rooms Available'], ['fruit', 'Green Basket', 'Organic Vegetables']
];

function buildTownShops(rng) {
  let k = 0;
  const next = () => SHOP_POOL[k++ % SHOP_POOL.length];
  const spec = (kind, name, sub, x, z, w, d, face, floors) => shopBuilding({
    kind: kind, name: name, sub: sub, x: x, z: z, w: w, d: d, face: face,
    floors: floors, wall: WALLS[(rng() * WALLS.length) | 0], roof: rng() < 0.4 ? 'gable' : 'flat',
    roofTint: [0xffffff, 0xe0b8a0, 0xd8a890][(rng() * 3) | 0]
  });
  const bunting = [-24, 24, -54, 54];
  // Main bazaar street: 4 half-rows of 7 shops
  for (const side of [-1, 1]) {
    for (const half of [-1, 1]) {
      for (let i = 0; i < 7; i++) {
        const z = half * (14 + 10 * i), p = next();
        const forced2 = bunting.some(b => Math.abs(b - z) < 6);
        const floors = forced2 ? 3 : 1 + Math.floor(rng() * 3);
        spec(p[0], p[1], p[2], TC.x + side * 14, z, 10, 11, side < 0 ? 'e' : 'w', Math.max(2, floors));
      }
    }
  }
  // West lane, east side: back-to-back with the bazaar, fronts onto the lane
  for (const half of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const p = next();
      spec(p[0], p[1], p[2], LANE_X + 11, half * (32 + 12 * i), 11, 11, 'w', 1 + Math.floor(rng() * 2));
    }
  }
}

function civic(o) {
  o.kind = 'civic'; o.h1 = o.h1 || 4.6;
  shopBuilding(o);
}

function buildTownCivic() {
  const T = (lines, extra) => Object.assign({ w: 640, h: 110 }, extra);
  // Police station (lane, west side)
  civic({
    name: 'POLICE STATION', sub: 'Nilambur · Kerala Police', x: 131.5, z: -34, w: 14, d: 11, face: 'e', floors: 2, roof: 'gable', wall: 0xdfe8f2,
    extra: (F, fz, w) => { F.box('paint', w, 0.5, 0.06, 0, 4.7 - 0.1, fz + 0.18, 0x1c4fa8); }
  });
  placeVehicle('van', 0x1c4fa8, 139.6, -30, Math.PI, false);
  // Fire & rescue
  civic({
    name: 'FIRE & RESCUE STATION', sub: 'Emergency 101', x: 131.5, z: -56, w: 14, d: 11, face: 'e', floors: 1, h1: 5.2, roof: 'flat', wall: 0xf2dcd0,
    extra: (F, fz, w) => { for (const x of [-3.2, 3.2]) F.box('paint', 4.6, 3.9, 0.12, x, 2.2, fz + 0.16, 0xc8201e); }
  });
  placeVehicle('van', 0xc8201e, 141.4, -53, Math.PI, false);
  // Taluk hospital
  civic({
    name: 'GOVT. TALUK HOSPITAL', sub: 'Nilambur · OP 8am - 6pm', x: 131.5, z: 36, w: 18, d: 11, face: 'e', floors: 3, roof: 'flat', wall: 0xf4f6f4,
    extra: (F, fz, w, d, H) => {
      F.box('cloth', 2.2, 0.6, 0.08, 0, H + 1.6, fz - 0.4, 0xd33a3a); F.box('cloth', 0.6, 2.2, 0.08, 0, H + 1.6, fz - 0.4, 0xd33a3a);
    }
  });
  placeVehicle('van', 0xf4f4ee, 140.6, 30, 0, false);
  // Higher secondary school
  civic({ name: 'GOVT. HIGHER SECONDARY SCHOOL', sub: 'Nilambur', x: 131.5, z: 62, w: 18, d: 11, face: 'e', floors: 2, roof: 'gable', wall: 0xf3e2b8 });
  // Post office, KSEB office on the cross road (west of the lane); bank on the east side of the lane
  civic({ name: 'POST OFFICE', sub: 'Nilambur PO · 679329', x: 131.5, z: -15.5, w: 11, d: 11, face: 's', floors: 2, roof: 'gable', wall: 0xf6ead0, extra: (F, fz, w) => F.box('paint', w, 0.5, 0.06, 0, 4.5, fz + 0.18, 0xc8201e) });
  civic({ name: 'KSEB SECTION OFFICE', sub: 'Electricity Board', x: 131.5, z: 15.5, w: 11, d: 11, face: 'n', floors: 2, roof: 'flat', wall: 0xe4e8e0 });
  civic({ name: 'NILAMBUR CO-OP BANK', sub: 'ATM · Locker', x: 152.5, z: -15.5, w: 10, d: 11, face: 's', floors: 3, roof: 'flat', wall: 0xdfe6f2 });
  civic({ name: 'SREEDHAR THEATRE', sub: 'Now Showing · 4 Shows', x: 205.5, z: -15.5, w: 13, d: 11, face: 's', floors: 3, roof: 'flat', wall: 0xead6c8,
    extra: (F, fz, w, d, H) => {
      const pc = [0xd33a3a, 0x2a58d8, 0xe0a020];
      for (let i = 0; i < 3; i++) F.box('cloth', 2.6, 3.4, 0.05, -4 + i * 4, 6.4, fz + 0.14, pc[i]);
    }
  });
}

// ---------- Bus station, market, fuel station ----------
function buildTownBusStation() {
  const Fp = frame(215, TOWN_H, 27, 0);
  Fp.box('conc', 22, 0.35, 5.5, 0, 0.17, 0, 0xb9b3a4);
  for (let x = -10; x <= 10; x += 4) for (const z of [-2.3, 2.3]) Fp.cyl('metal', 0.09, 0.09, 4.0, x, 2.2, z, 0x3a4248, 8);
  Fp.box('metal', 23.5, 0.16, 6.8, 0, 4.25, 0, 0x2f6fb0, -0.05);
  for (let x = -8; x <= 8; x += 4) Fp.box('wood', 2.4, 0.08, 0.5, x, 0.72, -0.6, 0x7a5a30);
  for (let x = -8; x <= 8; x += 4) { Fp.box('wood', 2.4, 0.5, 0.06, x, 0.98, -0.85, 0x7a5a30); }
  townSign(Fp, ['KSRTC BUS STATION', 'Nilambur'], 0, 4.95, 3.3, 9, { bg: '#0b3d91', fg: '#ffffff', border: '#ffd166' });
  townSign(Fp, ['ROUTES', 'Manjeri · Kozhikode · Ooty · Gudalur'], -6.5, 2.4, 2.4, 3.6, { bg: '#1f5a3a', fg: '#fff2cc', border: '#fff2cc', size: 34 });
  colBox(215, 27, 11, 3);
  // Buses in bays facing the platform, autos and bikes at the kerb
  const bc = [0x1c56a6, 0xc0392b, 0x1c56a6, 0xe08a20, 0x1c56a6, 0x2a8a3a];
  for (let i = 0; i < 6; i++) placeVehicle('bus', bc[i], 203 + i * 5.6, 52, Math.PI, false);
  for (let i = 0; i < 5; i++) placeVehicle('auto', 0xf2c200, 202 + i * 2.3, 14.5, 0, true);
  for (let i = 0; i < 4; i++) placeVehicle('bike', [0x2a58d8, 0xc0392b, 0x151515, 0x8a8a8a][i], 227, 14 + i * 1.8, 0, true);
  // Depot office
  civic({ name: 'KSRTC BUS STATION', sub: 'Nilambur Depot · Enquiry', x: 215, z: 87, w: 22, d: 9, face: 'n', floors: 2, roof: 'flat', wall: 0xf0e6cc });
  // Tea kiosk + waiting shed
  const Fk = frame(227, TOWN_H, 38, -Math.PI / 2);
  Fk.box('wall', 4, 3, 3.2, 0, 1.5, 0, 0xf0d8a0);
  Fk.box('cloth', 4.6, 0.06, 1.6, 0, 3.1, 2.3, 0xc0392b, 0.28);
  townSign(Fk, ['Bus Stand Tea Stall', 'Chaya · Vada'], 0, 3.6, 1.7, 3.8, { bg: '#1f5a3a', fg: '#fff2cc', border: '#fff2cc' });
  colBox(227, 38, 1.6, 2);
}

function buildTownMarket() {
  const F = frame(215, TOWN_H, -62, 0);
  F.box('conc', 24, 0.25, 16, 0, 0.12, 0, 0xa8a294);
  for (let x = -11; x <= 11; x += 5.5) for (const z of [-7.6, 7.6]) F.box('conc', 0.4, 4.6, 0.4, x, 2.5, z, 0xc8c2b2);
  F.box('conc', 24, 0.3, 0.3, 0, 4.6, 7.6, 0xc8c2b2);
  const g = makeGableRoof(24, 16, 3.2, 0.7, 1);
  F.put('roof', g.roof, 0, 4.75, 0, 0xffffff);
  F.put('wall', g.gable, 0, 4.75, 0, 0xe8dcc0);
  townSign(F, ['NILAMBUR MARKET', 'Fish · Vegetables · Spices'], 0, 4.05, 7.75, 9, { bg: '#7a1f1f', fg: '#ffe9a8', border: '#ffe9a8' });
  const veg = [0xd8402a, 0x3f9a3a, 0xf3b81c, 0x8a3ab0, 0xe08a20, 0x2f7a3a, 0xf0e6a0];
  for (let r = 0; r < 2; r++) for (let i = 0; i < 5; i++) {
    const x = -9 + i * 4.5, z = -3.4 + r * 6.4;
    F.box('wood', 3.0, 0.9, 1.3, x, 0.7, z, 0x8a5a2a);
    F.box('cloth', 3.2, 0.06, 1.5, x, 1.18, z, 0xe8e8e0);
    for (let k = 0; k < 9; k++) {
      const fish = (r === 1 && i >= 3);
      if (fish) F.sph('metal', 0.2, x - 1.0 + (k % 5) * 0.5, 1.3, z - 0.3 + Math.floor(k / 5) * 0.6, 0x9aa8b4, 0.4);
      else F.sph('cloth', 0.2, x - 1.1 + (k % 5) * 0.55, 1.33, z - 0.3 + Math.floor(k / 5) * 0.55, veg[(i * 2 + k) % veg.length], 0.85);
    }
    F.box('cloth', 0.6, 0.55, 0.5, x + 1.6, 0.5, z + 0.9, veg[(i + r) % veg.length]);
  }
  colBox(215, -62, 12, 8);
  // Umbrella stalls in the yard
  const cols = [0xd33a3a, 0x2a58d8, 0xe0a020, 0x2ea043];
  for (let i = 0; i < 6; i++) {
    const x = 203 + (i % 3) * 10, z = -84 + Math.floor(i / 3) * 5.2;
    const U = frame(x, TOWN_H, z, 0);
    U.cyl('wood', 0.05, 0.05, 2.4, 0, 1.2, 0, 0x5a3a20, 6);
    U.cyl('cloth', 0.05, 1.9, 0.6, 0, 2.55, 0, cols[i % 4], 10);
    U.box('wood', 2.0, 0.85, 1.0, 0, 0.45, 1.0, 0x8a5a2a);
    for (let k = 0; k < 6; k++) U.sph('cloth', 0.2, -0.75 + (k % 3) * 0.75, 0.98, 0.75 + Math.floor(k / 3) * 0.5, veg[(i + k) % veg.length], 0.85);
    colBox(x, z + 1, 1.0, 0.6);
  }
  // Delivery vehicles
  placeVehicle('van', 0xf4f4ee, 203, -42, 0, false);
  placeVehicle('auto', 0x2a8a3a, 226, -44, Math.PI / 2, true);
}

function buildTownPetrol() {
  const F = frame(221, TOWN_H, -22, 0);
  F.box('paint', 15, 0.55, 10, 0, 5.2, 0, 0xe8e8e0);
  F.box('paint', 15.1, 0.2, 10.1, 0, 4.98, 0, 0xc8201e);
  for (const x of [-6.5, 6.5]) for (const z of [-3.5, 3.5]) F.cyl('metal', 0.18, 0.18, 5.2, x, 2.6, z, 0xcfd4d8, 10);
  for (const x of [-3.5, 3.5]) {
    F.box('conc', 4.5, 0.22, 1.4, x, 0.11, 0, 0x9a9488);
    for (const dx of [-1.1, 1.1]) {
      F.box('paint', 0.65, 1.6, 0.5, x + dx, 1.0, 0, dx > 0 ? 0xc8201e : 0xe8b820);
      F.box('vglass', 0.45, 0.35, 0.05, x + dx, 1.5, 0.27, 0x0a1a10);
    }
  }
  const O = frame(221, TOWN_H, -33, 0);
  O.box('wall', 6, 3.3, 5, 0, 1.65, 0, 0xf2f0e6);
  O.box('wall', 6.3, 0.3, 5.3, 0, 3.4, 0, 0xc8201e);
  O.box('glass', 4, 1.6, 0.12, 0, 1.6, 2.55);
  townSign(O, ['FUEL STATION', 'Petrol · Diesel · Air'], 0, 4.1, 2.6, 4.6, { bg: '#c8201e', fg: '#ffffff', border: '#ffffff' });
  colBox(221, -33, 3.1, 2.6);
  F.cyl('metal', 0.1, 0.1, 8, 9.5, 4, 5.5, 0x3a4248, 8);
  townSign(F, ['PETROL 104.7', 'Diesel 93.4'], 9.5, 7.6, 5.55, 2.6, { bg: '#111111', fg: '#ffd24a', border: '#ffd24a', size: 30 });
  placeVehicle('car', 0xe8e8e0, 221, -21, 0, false);
  placeVehicle('auto', 0xf2c200, 228, -21, 0, false);
}

// ---------- Places of worship ----------
// All three stand beside the streets (never across them) so every road runs straight through to the ring road.
function buildTownWorship() {
  const wallW = 0xf3ecd8;
  // --- Temple: east of the main street beyond the last shops, gate facing the street ---
  {
    const F = frame(TC.x + 17, TOWN_H, -100, -Math.PI / 2), W = 17, D = 8;
    const wall = (x, z, w, d) => { F.box('wall', w, 2.3, d, x, 1.15, z, wallW); F.box('wall', w + 0.1, 0.22, d + 0.1, x, 2.35, z, 0xd97a2a); };
    wall(0, -D, 2 * W, 0.5);
    wall(-W, 0, 0.5, 2 * D);
    wall(W, 0, 0.5, 2 * D);
    wall(-10.25, D, 13.5, 0.5);
    wall(10.25, D, 13.5, 0.5);
    for (const x of [-2.9, 2.9]) F.box('wall', 1.1, 4.4, 1.1, x, 2.2, D, 0xe8dcc0);
    const gt = makeGableRoof(7, 2.6, 1.7, 0.4, 1);
    F.put('roof', gt.roof, 0, 4.4, D, 0xffffff);
    F.put('wall', gt.gable, 0, 4.4, D, 0xe8dcc0);
    // sanctum
    F.box('conc', 9, 0.7, 9, 0, 0.35, -1, 0xb8b2a4);
    F.box('wall', 6.4, 3.4, 6.4, 0, 2.4, -1, 0xb39a78);
    F.box('wood', 1.4, 2.4, 0.2, 0, 1.9, 2.25, 0x3a2412);
    F.cyl('roof', 0.3, 5.3, 3.0, 0, 5.6, -1, 0xffffff, 4, 0, Math.PI / 4);
    F.cyl('roof', 0.2, 3.4, 2.2, 0, 8.0, -1, 0xffffff, 4, 0, Math.PI / 4);
    F.cyl('gold', 0.08, 0.35, 1.3, 0, 9.7, -1, undefined, 8);
    F.sph('gold', 0.3, 0, 8.9, -1);
    // mandapam porch
    for (const x of [-2, 2]) F.box('wood', 0.35, 2.6, 0.35, x, 1.9, 3.6, 0x6a3c1c);
    F.box('roof', 5.2, 0.14, 2.6, 0, 3.35, 3.4, 0xffffff, 0.22);
    // lamp pillar and flag mast
    F.cyl('conc', 0.35, 0.45, 3.4, 8, 1.7, 3.4, 0xb8b2a4, 10);
    F.cyl('conc', 0.6, 0.6, 0.35, 8, 3.5, 3.4, 0xb8b2a4, 10);
    F.cyl('gold', 0.14, 0.18, 11, -8, 5.5, 3.4, undefined, 8);
    F.sph('gold', 0.3, -8, 11.2, 3.4);
    townSign(F, ['SREE NILAMBUR TEMPLE', 'Vishnu Kshetram'], 0, 5.6, D + 1.2, 7.5, { bg: '#7a1f0a', fg: '#ffe9a8', border: '#ffd166' });
    F.col(0, -1, 5, 5);
    F.col(0, -D, W, 0.4);
    F.col(-W, 0, 0.4, D);
    F.col(W, 0, 0.4, D);
    F.col(-10.25, D, 6.75, 0.4);
    F.col(10.25, D, 6.75, 0.4);
  }
  // --- Church: west of the main street, tower and door facing the street ---
  {
    const F = frame(TC.x - 24, TOWN_H, 100, Math.PI / 2), d = 15, w = 9;
    F.box('conc', w + 1, 0.5, d + 1, 0, 0.25, 0, 0xb8b2a4);
    F.box('wall', w, 7.2, d, 0, 4.1, 0, 0xf8f4ea);
    const g = makeGableRoof(d, w, 3.4, 0.5, 1);
    F.put('roof', g.roof, 0, 7.7, 0, 0x9a4a3a, 0, Math.PI / 2);
    F.put('wall', g.gable, 0, 7.7, 0, 0xf8f4ea, 0, Math.PI / 2);
    F.box('wall', 4.4, 13, 4.4, 0, 6.5, d / 2 + 1.6, 0xf8f4ea);
    F.cyl('roof', 0.1, 3.4, 6.5, 0, 16.3, d / 2 + 1.6, 0x9a4a3a, 4, 0, Math.PI / 4);
    F.box('gold', 0.2, 1.6, 0.2, 0, 20.4, d / 2 + 1.6);
    F.box('gold', 0.9, 0.2, 0.2, 0, 20.5, d / 2 + 1.6);
    F.box('wood', 2.2, 3.4, 0.2, 0, 1.9, d / 2 + 3.85, 0x3a2412);
    F.cyl('glass', 1.0, 1.0, 0.2, 0, 9.5, d / 2 + 3.8, undefined, 20, Math.PI / 2);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) { F.box('wood', 0.9, 2.6, 0.12, s * (w / 2 + 0.02), 4.2, -5 + i * 3.4, 0x3a2412, 0, Math.PI / 2); F.box('glass', 0.6, 2.2, 0.16, s * (w / 2 + 0.05), 4.2, -5 + i * 3.4, undefined, 0, Math.PI / 2); }
    townSign(F, ['ST. THOMAS CHURCH', 'Nilambur · Holy Mass 6:30 / 9:00'], 0, 5.0, d / 2 + 3.95, 4.2, { bg: '#f4f0e4', fg: '#2a1a10', border: '#8a6a3a', size: 32 });
    F.col(0, 0, w / 2, d / 2);
    F.col(0, d / 2 + 1.6, 2.2, 2.2);
  }
  // --- Mosque: west of the lane, facing it ---
  {
    const F = frame(LANE_X - 11, TOWN_H, -100, Math.PI / 2), w = 13, d = 11;
    F.box('conc', w + 1, 0.5, d + 1, 0, 0.25, 0, 0xb8b2a4);
    F.box('wall', w, 6.0, d, 0, 3.5, 0, 0xf8f6ee);
    F.box('wall', w + 0.3, 0.35, d + 0.3, 0, 6.6, 0, 0xd8d2c0);
    F.cyl('wall', 4.3, 4.6, 1.0, 0, 7.1, 0, 0xf8f6ee, 20);
    const dome = new THREE.SphereGeometry(4.2, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    F.put('paint', dome, 0, 7.6, 0, 0x1f7a4a);
    F.cyl('gold', 0.06, 0.2, 1.6, 0, 12.2, 0, undefined, 8);
    F.sph('gold', 0.25, 0, 11.9, 0);
    for (const sx of [-1, 1]) {
      F.cyl('wall', 0.85, 1.0, 13, sx * (w / 2 + 0.6), 6.5, d / 2 - 1, 0xf8f6ee, 12);
      F.cyl('conc', 1.15, 1.15, 0.3, sx * (w / 2 + 0.6), 10.2, d / 2 - 1, 0xd8d2c0, 12);
      F.put('paint', new THREE.SphereGeometry(1.0, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), sx * (w / 2 + 0.6), 13.0, d / 2 - 1, 0x1f7a4a);
      F.cyl('gold', 0.04, 0.1, 1.0, sx * (w / 2 + 0.6), 14.5, d / 2 - 1, undefined, 6);
    }
    for (let i = -1; i <= 1; i++) { F.box('vglass', 1.6, 3.2, 0.12, i * 3.6, 2.4, d / 2 + 0.06, 0x142a22); F.box('glass', 1.3, 2.6, 0.16, i * 3.6, 2.4, d / 2 + 0.08); }
    townSign(F, ['JUMA MASJID', 'Nilambur'], 0, 5.5, d / 2 + 0.1, 5.2, { bg: '#0f5a34', fg: '#ffffff', border: '#ffd166' });
    F.col(0, 0, w / 2 + 1.5, d / 2);
  }
}

// ---------- Street trees ----------
function buildTownTrees(rng) {
  const canopy = makeCanopyGeometry(1, 26, 1.5, 21, 0.58);
  const trunk = makeTrunkGeometry(0.2, 0.42, 6.5, 1.1, 4);
  const tM = [], cM = [], cC = [], col = new THREE.Color();
  const pts = [
    [TC.x - 7.3, -40], [TC.x + 7.3, 41], [TC.x - 7.3, 62], [TC.x + 7.3, -63],
    [199.5, 8], [199.5, 40], [199.5, 78], [232, 60], [232, 80], [199.5, -35], [199.5, -75], [230, -92], [232, -40],
    [126, 4], [136, 92], [150, 84], [150, -92], [126, -110], [200, 96], [200, 110], [163, 112], [160, -112], [128, 25], [128, -6]
  ];
  // Avenue trees along the roads beyond the built-up centre (both sides, every ~36 m)
  for (let z = 132; z < RING_Z - 8; z += 36) for (const sgn of [-1, 1]) {
    pts.push([TC.x - 8.5, sgn * (z + rng() * 8)], [TC.x + 8.5, sgn * (z + 18 + rng() * 8)], [LANE_X - 5.5, sgn * (z + 9 + rng() * 8)]);
  }
  for (let x = TC.x + 70; x < TC.x + RING - 8; x += 36) pts.push([x + rng() * 8, -8.5], [x + 18 + rng() * 8, 8.5]);
  for (let x = TC.x - 70; x > TC.x - RING + 8; x -= 36) pts.push([x - rng() * 8, -8.5], [x - 18 - rng() * 8, 8.5]);
  for (let x = TC.x - RING + 30; x < TC.x + RING - 20; x += 40) pts.push([x, -RING_Z + 8.5], [x + 20, RING_Z - 8.5]);
  for (let z = -RING_Z + 40; z < RING_Z - 20; z += 40) pts.push([TC.x - RING + 8.5, z], [TC.x + RING - 8.5, z + 20]);
  pts.forEach(p => {
    const y = heightAt(p[0] + OX, p[1]), s = 0.9 + rng() * 0.4, yaw = rng() * 6.28;
    tM.push(mat(p[0] + OX, y, p[1], 0, yaw, 0, s, s, s));
    const cs = (4.6 + rng() * 1.6) * s;
    cM.push(mat(p[0] + OX, y + 6.4 * s, p[1], 0, yaw, 0, cs, cs * 0.85, cs));
    col.setHSL(0.26 + rng() * 0.06, 0.45 + rng() * 0.2, 0.32 + rng() * 0.12); cC.push(col.clone());
    colCirc(p[0], p[1], 0.5);
  });
  scene.add(makeInstanced(trunk, M.bark, tM, null, true), makeInstanced(canopy, M.leaf, cM, cC, true));
}

// ---------- Parked and moving traffic ----------
function buildTownVehicles(rng) {
  const cc = [0xe8e8e0, 0xb0b4b8, 0x2a3a5a, 0x8a1c1c, 0x1c1c22, 0xd8d0b8, 0x3a6a4a, 0xc8a020];
  const pc = () => cc[(rng() * cc.length) | 0];
  // Kerb parking along the main street and lane
  const parkZ = [-72, -60, -47, -36, -19, 20, 32, 45, 58, 70];
  parkZ.forEach((z, i) => {
    const west = i % 2 === 0;
    const t = rng();
    const x = TC.x + (west ? -4.9 : 4.9), yaw = west ? Math.PI : 0;   // left-hand kerb parking
    if (t < 0.45) placeVehicle('car', pc(), x, z, yaw, false);
    else if (t < 0.75) placeVehicle('auto', 0xf2c200, x, z, yaw, false);
    else placeVehicle('bike', [0x2a58d8, 0xc0392b, 0x151515, 0x8a8a8a][(rng() * 4) | 0], x, z, yaw, true);
  });
  for (let i = 0; i < 6; i++) placeVehicle('bike', [0x2a58d8, 0xc0392b, 0x151515, 0x8a8a8a][i % 4], TC.x + (i % 2 ? 4.9 : -4.9), 24 + i * 9, 0, true);
  // Auto-rickshaw stand near the clock tower
  for (let i = 0; i < 4; i++) placeVehicle('auto', 0xf2c200, TC.x + 4.9, -12 - i * 2.6, 0, false);
  // Cross road parking
  placeVehicle('car', 0xe8e8e0, 186, -4.9, Math.PI / 2, false);
  placeVehicle('car', 0x2a3a5a, 168, 4.9, -Math.PI / 2, false);
  placeVehicle('auto', 0xf2c200, 156, -4.9, Math.PI / 2, false);

  // Moving traffic (left-hand drive)
  const movers = [
    { t: 'car', c: 0xb0b4b8, axis: 'z', fixed: TC.x - 2.6, dir: -1, sp: 6.5, a: -130, b: 130, pos: 60 },
    { t: 'auto', c: 0xf2c200, axis: 'z', fixed: TC.x - 2.6, dir: -1, sp: 5.2, a: -130, b: 130, pos: -20 },
    { t: 'bus', c: 0x1c56a6, axis: 'z', fixed: TC.x - 2.6, dir: -1, sp: 5.0, a: -130, b: 130, pos: 10 },
    { t: 'bike', c: 0x2a58d8, axis: 'z', fixed: TC.x - 2.6, dir: -1, sp: 8.0, a: -130, b: 130, pos: 40 },
    { t: 'car', c: 0x8a1c1c, axis: 'z', fixed: TC.x + 2.6, dir: 1, sp: 7.0, a: -130, b: 130, pos: -60 },
    { t: 'auto', c: 0xf2c200, axis: 'z', fixed: TC.x + 2.6, dir: 1, sp: 5.4, a: -130, b: 130, pos: 30 },
    { t: 'bus', c: 0xc0392b, axis: 'z', fixed: TC.x + 2.6, dir: 1, sp: 5.0, a: -130, b: 130, pos: -30 },
    { t: 'bike', c: 0x151515, axis: 'z', fixed: TC.x + 2.6, dir: 1, sp: 8.5, a: -130, b: 130, pos: 60 },
    { t: 'car', c: 0x3a6a4a, axis: 'x', fixed: -2.6, dir: 1, sp: 8.0, a: 60, b: 296, pos: 90 },
    { t: 'auto', c: 0xf2c200, axis: 'x', fixed: -2.6, dir: 1, sp: 5.4, a: 60, b: 296, pos: 180 },
    { t: 'car', c: 0xd8d0b8, axis: 'x', fixed: 2.6, dir: -1, sp: 7.5, a: 60, b: 296, pos: 120 },
    { t: 'bus', c: 0x1c56a6, axis: 'x', fixed: 2.6, dir: -1, sp: 5.5, a: 60, b: 296, pos: 210 },
    { t: 'bike', c: 0xc0392b, axis: 'x', fixed: 2.6, dir: -1, sp: 8.5, a: 60, b: 296, pos: 70 },
    { t: 'car', c: 0xc8a020, axis: 'z', fixed: LANE_X - 1.7, dir: -1, sp: 5.5, a: -130, b: 130, pos: 50 },
    { t: 'auto', c: 0xf2c200, axis: 'z', fixed: LANE_X + 1.7, dir: 1, sp: 5.0, a: -130, b: 130, pos: -40 }
  ];
  movers.forEach(m => {
    m.g = movingVehicle(m.t, m.c);
    TOWN_ANIM.movers.push(m);
  });
}

// ---------- Pedestrians (instanced) ----------
function buildTownPeople(rng) {
  const N = 40;
  const torsoG = new THREE.CylinderGeometry(0.2, 0.24, 0.72, 8); torsoG.translate(0, 1.25, 0);
  const legG = new THREE.CylinderGeometry(0.2, 0.17, 0.9, 8); legG.translate(0, 0.45, 0);
  const headG = new THREE.SphereGeometry(0.14, 10, 8); headG.translate(0, 1.82, 0);
  const bm = new THREE.MeshStandardMaterial({ roughness: 0.85 });
  const torso = new THREE.InstancedMesh(torsoG, bm, N), legs = new THREE.InstancedMesh(legG, bm, N), head = new THREE.InstancedMesh(headG, bm, N);
  [torso, legs, head].forEach(m => { m.castShadow = true; m.frustumCulled = false; scene.add(m); });
  const shirts = [0xd33a3a, 0x2a58d8, 0xf0f0e8, 0xe0a020, 0x2ea043, 0x8a3ab0, 0xe8e0c0, 0x1c8a8a, 0xf08a8a];
  const lows = [0xf6f2e4, 0xf6f2e4, 0x2a2f45, 0x3a3a3a, 0xf6f2e4, 0x7a5a3a, 0xb04a7a];
  const skins = [0xb07a50, 0x9a6a44, 0xc89060, 0x8a5a38];
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    c.setHex(shirts[(rng() * shirts.length) | 0]); torso.setColorAt(i, c);
    c.setHex(lows[(rng() * lows.length) | 0]); legs.setColorAt(i, c);
    c.setHex(skins[(rng() * skins.length) | 0]); head.setColorAt(i, c);
  }
  torso.instanceColor.needsUpdate = legs.instanceColor.needsUpdate = head.instanceColor.needsUpdate = true;
  // Routes: footpaths and plazas
  const routes = [
    [TC.x - 7.3, -78, TC.x - 7.3, -8], [TC.x - 7.3, 8, TC.x - 7.3, 78], [TC.x + 7.3, -78, TC.x + 7.3, -8], [TC.x + 7.3, 8, TC.x + 7.3, 78],
    [148, -7.2, 168, -7.2], [186, 7.2, 230, 7.2], [186, -7.2, 230, -7.2], [148, 7.2, 172, 7.2],
    [LANE_X - 4.2, -80, LANE_X - 4.2, -8], [LANE_X + 4.2, 8, LANE_X + 4.2, 90],
    [204, 24, 226, 24], [204, 40, 226, 40], [208, -72, 226, -72], [201, -55, 201, -75], [TC.x - 6, 0, TC.x - 6, 12]
  ];
  for (let i = 0; i < N; i++) {
    const r = routes[i % routes.length];
    const o = (rng() - 0.5) * 1.0;
    const horiz = Math.abs(r[3] - r[1]) < 0.5;
    const a = [r[0] + (horiz ? 0 : o), r[1] + (horiz ? o : 0)], b = [r[2] + (horiz ? 0 : o), r[3] + (horiz ? o : 0)];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    TOWN_ANIM.walkers.push({ a: a, b: b, len: len, u: rng(), dir: rng() < 0.5 ? 1 : -1, sp: 1.0 + rng() * 0.9, ph: rng() * 6.28 });
  }
  TOWN_ANIM.people = { torso: torso, legs: legs, head: head };
}

function updateTown(dt, t) {
  const _o = updateTown.o || (updateTown.o = new THREE.Object3D());
  TOWN_ANIM.movers.forEach(m => {
    m.pos += m.dir * m.sp * dt;
    if (m.pos > m.b) m.pos = m.a; else if (m.pos < m.a) m.pos = m.b;
    const x = m.axis === 'x' ? m.pos : m.fixed, z = m.axis === 'z' ? m.pos : m.fixed;
    m.g.position.set(x + OX, heightAt(x + OX, z) + ROAD_Y, z);
    m.g.rotation.y = m.axis === 'z' ? (m.dir > 0 ? 0 : Math.PI) : (m.dir > 0 ? Math.PI / 2 : -Math.PI / 2);
  });
  const P = TOWN_ANIM.people;
  if (!P) return;
  TOWN_ANIM.walkers.forEach((w, i) => {
    w.u += w.dir * w.sp * dt / w.len;
    if (w.u > 1) { w.u = 1; w.dir = -1; } else if (w.u < 0) { w.u = 0; w.dir = 1; }
    const x = w.a[0] + (w.b[0] - w.a[0]) * w.u, z = w.a[1] + (w.b[1] - w.a[1]) * w.u;
    const ang = Math.atan2((w.b[0] - w.a[0]) * w.dir, (w.b[1] - w.a[1]) * w.dir);
    const bob = Math.abs(Math.sin(t * 5.5 * w.sp + w.ph)) * 0.06;
    _o.position.set(x + OX, PAVE_Y + TOWN_H + bob, z);
    _o.rotation.set(0, ang, Math.sin(t * 5.5 * w.sp + w.ph) * 0.04);
    _o.updateMatrix();
    P.torso.setMatrixAt(i, _o.matrix); P.legs.setMatrixAt(i, _o.matrix); P.head.setMatrixAt(i, _o.matrix);
  });
  P.torso.instanceMatrix.needsUpdate = P.legs.instanceMatrix.needsUpdate = P.head.instanceMatrix.needsUpdate = true;
}

// ---------- Entry point ----------
function flushTownBatches() {
  for (const key in TB) {
    const geo = mergeGeos(TB[key]);
    const m = new THREE.Mesh(geo, TM.key[key]);
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
}

function buildNilamburTown() {
  const rng = makeRng(2026);
  townMaterials();
  buildTownRoads();
  buildTownShops(rng);
  buildTownCivic();
  buildTownBusStation();
  buildTownMarket();
  buildTownPetrol();
  buildTownWorship();
  buildTownTrees(rng);
  buildTownVehicles(rng);
  buildTownPeople(rng);
  flushTownBatches();
  ANIM.townUpdate = updateTown;
}
