/**
 * world.js - terrain, vegetation, landmarks and world queries for NilamburWorld.
 * Depends on proc.js (noise + textures) and Three.js (global THREE).
 */

// ---------- World constants ----------
const RAIL_X = -70, RAIL_H = 2.0, BANK_H = 2.7, WATER_Y = -0.8;
const WORLD_SIZE = 800;
const M = {};                 // shared materials
const ANIM = { fallMats: [], glowMats: [], nightLights: [], swayMats: [] };
const COLL = { circles: [], boxes: [], grid: new Map() };
const GROUND_EXTRAS = [];     // functions (x,z) -> y or null (bridge deck, platforms, plinths)
const EXTRA_TREES = [];       // hand-placed teak trees (x,y,z,scale)
const LM_H = {};              // landmark base heights (set by initHeights)

// Landmark footprints used to keep vegetation away
const FOOT = [
  { cx: 90, cz: 82, hw: 22, hd: 19 },        // palace
  { cx: 80, cz: -58, hw: 22, hd: 17 },       // museum
  { cx: RAIL_X + 8, cz: 70, hw: 13, hd: 24 },// station
  { cx: 0, cz: 0, hw: 42, hd: 8 },           // bridge approaches
  { cx: -100, cz: -110, hw: 46, hd: 24 }     // waterfall cliff + pool
];

function isFootprint(x, z, margin) {
  for (let i = 0; i < FOOT.length; i++) {
    const f = FOOT[i];
    if (Math.abs(x - f.cx) < f.hw + margin && Math.abs(z - f.cz) < f.hd + margin) return true;
  }
  return false;
}

// ---------- Height field ----------
function rawHeight(x, z) {
  const ax = Math.abs(x);
  const bed = -2.6 + fbm(z * 0.03, 3.3, 2, 1) * 0.9;
  const t = smoothstep(8, 27, ax);
  let h = lerp(bed, BANK_H, t);
  const hillMask = smoothstep(30, 95, ax);
  const n = fbm(x * 0.011 + 13, z * 0.011 + 7, 5, 2);
  h += Math.max((n - 0.42) * 34, -1.2) * hillMask;
  h += (fbm(x * 0.06, z * 0.06, 3, 5) - 0.4) * 2.4 * smoothstep(20, 45, ax);
  const e = smoothstep(185, 310, Math.max(Math.abs(x), Math.abs(z)));
  h += e * e * 70 * (0.55 + fbm(x * 0.02, z * 0.02, 3, 9));
  return h;
}

const FLATS = [
  { key: 'conolly', r: 20, b: 26 },
  { key: 'museum', r: 30, b: 22 },
  { key: 'palace', r: 30, b: 22 },
  { key: 'waterfall', r: 26, b: 22 },
  { key: 'railway', r: 0, b: 0 }
];

function heightAt(x, z) {
  let h = rawHeight(x, z);
  // Railway embankment / cutting
  const d = Math.abs(x - RAIL_X);
  let w = (1 - smoothstep(5, 20, d)) * (1 - smoothstep(235, 262, Math.abs(z)));
  h = lerp(h, RAIL_H, w);
  // Station yard
  {
    const sx = RAIL_X + 8, sz = 70;
    const dd = Math.sqrt((x - sx) * (x - sx) + (z - sz) * (z - sz));
    h = lerp(h, RAIL_H, 1 - smoothstep(22, 40, dd));
  }
  // Flattened landmark plateaus
  for (let i = 0; i < 4; i++) {
    const f = FLATS[i];
    const lm = LANDMARKS[f.key];
    const dx = x - lm.pos.x, dz = z - lm.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const ww = 1 - smoothstep(f.r, f.r + f.b, dist);
    if (ww > 0) h = lerp(h, LM_H[f.key], ww);
  }
  // Plunge pool basin in front of the waterfall
  {
    const px = LANDMARKS.waterfall.pos.x, pz = LANDMARKS.waterfall.pos.z + 18;
    const dd = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    h -= 1.7 * (1 - smoothstep(4.5, 10.5, dd));
  }
  return h;
}

function initHeights() {
  for (const k in LANDMARKS) LM_H[k] = rawHeight(LANDMARKS[k].pos.x, LANDMARKS[k].pos.z);
  LM_H.railway = RAIL_H;
  LM_H.bridge = BANK_H;
  // Keep the waterfall plateau slightly above the river datum
  LM_H.waterfall = Math.max(LM_H.waterfall, 0.6);
}

function slopeAt(x, z) {
  const e = 1.2;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.sqrt(dx * dx + dz * dz) / (2 * e);
}

function forestMask(x, z) {
  let f = smoothstep(0.40, 0.58, fbm(x * 0.008 + 100, z * 0.008 - 40, 4, 5));
  const lm = LANDMARKS.conolly.pos;
  const d = Math.hypot(x - lm.x, z - lm.z);
  f = Math.max(f, 1 - smoothstep(35, 70, d));
  return f;
}

// Deck of the Canoly bridge (x runs across the river)
function bridgeDeckY(x) { const t = x / 26; return 3.0 - 0.55 * (1 - t * t); }

function groundHeight(x, z) {
  let h = heightAt(x, z);
  for (let i = 0; i < GROUND_EXTRAS.length; i++) {
    const g = GROUND_EXTRAS[i](x, z);
    if (g !== null && g > h) h = g;
  }
  return h;
}

// ---------- Colliders ----------
function addCircleCollider(x, z, r) {
  const c = { x: x, z: z, r: r };
  COLL.circles.push(c);
  const key = Math.floor(x / 12) + ',' + Math.floor(z / 12);
  let arr = COLL.grid.get(key);
  if (!arr) { arr = []; COLL.grid.set(key, arr); }
  arr.push(c);
}
function addBoxCollider(cx, cz, hw, hd) { COLL.boxes.push({ cx: cx, cz: cz, hw: hw, hd: hd }); }

function resolveCollisions(pos, pr) {
  const gx = Math.floor(pos.x / 12), gz = Math.floor(pos.z / 12);
  for (let ix = gx - 1; ix <= gx + 1; ix++) {
    for (let iz = gz - 1; iz <= gz + 1; iz++) {
      const arr = COLL.grid.get(ix + ',' + iz);
      if (!arr) continue;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        const dx = pos.x - c.x, dz = pos.z - c.z;
        const min = c.r + pr;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x = c.x + dx / d * min;
          pos.z = c.z + dz / d * min;
        }
      }
    }
  }
  for (let i = 0; i < COLL.boxes.length; i++) {
    const b = COLL.boxes[i];
    const dx = pos.x - b.cx, dz = pos.z - b.cz;
    const px = b.hw + pr - Math.abs(dx), pz = b.hd + pr - Math.abs(dz);
    if (px > 0 && pz > 0) {
      if (px < pz) pos.x += (dx >= 0 ? px : -px);
      else pos.z += (dz >= 0 ? pz : -pz);
    }
  }
}

function blockedForCamera(x, y, z) {
  const gx = Math.floor(x / 12), gz = Math.floor(z / 12);
  for (let ix = gx - 1; ix <= gx + 1; ix++) for (let iz = gz - 1; iz <= gz + 1; iz++) {
    const arr = COLL.grid.get(ix + ',' + iz);
    if (!arr) continue;
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (y - heightAt(c.x, c.z) < 12 && Math.hypot(x - c.x, z - c.z) < c.r + 0.35) return true;
    }
  }
  for (let i = 0; i < COLL.boxes.length; i++) {
    const b = COLL.boxes[i];
    if (Math.abs(x - b.cx) < b.hw + 0.3 && Math.abs(z - b.cz) < b.hd + 0.3 && y < 14) return true;
  }
  return false;
}

// ---------- Materials ----------
function buildMaterials() {
  const S = (o) => new THREE.MeshStandardMaterial(o);
  M.terrain = S({ vertexColors: true, map: TEX.ground, normalMap: TEX.groundN, normalScale: new THREE.Vector2(0.9, 0.9), roughness: 0.96, metalness: 0 });
  M.bark = S({ map: TEX.bark, normalMap: TEX.barkN, roughness: 0.95, color: 0xd8c6b0 });
  M.leaf = addWind(S({ map: TEX.leaf, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, color: 0xffffff }), 0.32, 1.6, 6.0);
  M.leafGiant = addWind(S({ map: TEX.leaf, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.75, color: 0xd8f0c0 }), 0.28, 1.2, 14.0);
  M.frond = addWind(S({ map: TEX.frond, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.6, color: 0xffffff }), 0.45, 1.9, 4.0);
  M.banana = addWind(S({ map: TEX.banana, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.55 }), 0.25, 1.4, 2.5);
  M.grass = addWind(S({ map: TEX.grass, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1, color: 0xffffff }), 0.16, 2.4, 0.8);
  M.fern = addWind(S({ map: TEX.frond, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.8, color: 0xa8d080 }), 0.08, 1.6, 0.8);
  M.stem = S({ color: 0x8aa050, roughness: 0.6 });
  M.bamboo = S({ color: 0x9aa63c, roughness: 0.5 });
  M.rock = S({ map: TEX.rock, normalMap: TEX.rockN, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.92, vertexColors: true });
  M.rockPlain = S({ map: TEX.rock, normalMap: TEX.rockN, roughness: 0.9, color: 0xb8b0a4 });
  M.stone = S({ map: TEX.rock, normalMap: TEX.rockN, roughness: 0.9, color: 0xc9bfae });
  M.wood = S({ map: TEX.wood, normalMap: TEX.woodN, roughness: 0.8, color: 0xffffff });
  M.woodDark = S({ map: TEX.wood, normalMap: TEX.woodN, roughness: 0.75, color: 0x8a5a3a });
  M.plaster = S({ map: TEX.plaster, normalMap: TEX.plasterN, roughness: 0.92, color: 0xffffff });
  M.roof = S({ map: TEX.roof, normalMap: TEX.roofN, roughness: 0.7, side: THREE.DoubleSide, color: 0xffffff });
  M.gravel = S({ map: TEX.gravel, normalMap: TEX.gravelN, roughness: 1, color: 0xb0aaa0 });
  M.steel = S({ color: 0x8a949c, roughness: 0.42, metalness: 0.85 });
  M.steelDark = S({ color: 0x3a4248, roughness: 0.5, metalness: 0.8 });
  M.rope = S({ color: 0x2a221a, roughness: 0.9 });
  M.concrete = S({ color: 0x9c9a92, roughness: 0.95, map: TEX.plaster, normalMap: TEX.plasterN });
  M.lattice = new THREE.MeshStandardMaterial({ map: TEX.lattice, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5, color: 0xffffff });
  M.glass = S({ color: 0x1a2a34, roughness: 0.1, metalness: 0.3, emissive: 0xffc870, emissiveIntensity: 0 });
  ANIM.glowMats.push(M.glass);
  M.lampGlow = S({ color: 0xfff0c0, emissive: 0xffd080, emissiveIntensity: 0.2, roughness: 0.4 });
  ANIM.glowMats.push(M.lampGlow);
  M.endgrain = S({ map: TEX.endgrain, roughness: 0.8 });
}

// ---------- Small builder helpers ----------
function texBox(w, h, d, scale) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / scale, uv.getY(k) * dims[f][1] / scale);
    }
  }
  return g;
}

function mk(geo, material, x, y, z, cast, recv) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = cast !== false;
  m.receiveShadow = recv !== false;
  return m;
}

function makeInstanced(geo, material, mats, colors, cast, recv) {
  const im = new THREE.InstancedMesh(geo, material, mats.length);
  for (let i = 0; i < mats.length; i++) im.setMatrixAt(i, mats[i]);
  if (colors) { for (let i = 0; i < colors.length; i++) im.setColorAt(i, colors[i]); }
  im.instanceMatrix.needsUpdate = true;
  im.castShadow = !!cast;
  im.receiveShadow = recv !== false;
  im.frustumCulled = false;
  return im;
}

function signBoard(lines, opts) {
  const g = new THREE.Group();
  const tex = signTexture(lines, opts);
  const w = (opts && opts.bw) || 4.2, h = w * 160 / 512;
  const board = mk(new THREE.BoxGeometry(w, h, 0.18), [M.woodDark, M.woodDark, M.woodDark, M.woodDark, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }), M.woodDark], 0, 2.2, 0);
  const p1 = mk(new THREE.BoxGeometry(0.22, 2.6, 0.22), M.woodDark, -w / 2 + 0.15, 1.3, -0.05);
  const p2 = mk(new THREE.BoxGeometry(0.22, 2.6, 0.22), M.woodDark, w / 2 - 0.15, 1.3, -0.05);
  g.add(board, p1, p2);
  return g;
}

// ---------- Terrain ----------
function buildTerrain() {
  const segs = 240;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, segs, segs);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightAt(pos.getX(i), pos.getZ(i)));
  geo.computeVertexNormals();

  const colors = new Float32Array(pos.count * 3);
  const nor = geo.attributes.normal;
  const cGrassA = new THREE.Color(0x4f7a30), cGrassB = new THREE.Color(0x748f40), cDry = new THREE.Color(0x9a9a4a);
  const cForest = new THREE.Color(0x35501f), cSoil = new THREE.Color(0x6a5034), cMud = new THREE.Color(0x7a6a4a);
  const cGravel = new THREE.Color(0x8d8676), cRock = new THREE.Color(0x77706a), cMount = new THREE.Color(0x2c4a26);
  const cLitter = new THREE.Color(0x4a3a20), cSand = new THREE.Color(0xa89870);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const slope = 1 - nor.getY(i);
    const n1 = fbm(x * 0.045, z * 0.045, 3, 21);
    const n2 = fbm(x * 0.3, z * 0.3, 2, 22);
    c.copy(cGrassA).lerp(cGrassB, smoothstep(0.35, 0.7, n1));
    c.lerp(cDry, smoothstep(0.62, 0.85, fbm(x * 0.02 + 40, z * 0.02, 3, 23)) * 0.55);
    const fm = forestMask(x, z);
    c.lerp(cForest, fm * 0.65);
    c.lerp(cLitter, fm * smoothstep(0.5, 0.75, n2) * 0.35);
    const dConolly = Math.hypot(x - LANDMARKS.conolly.pos.x, z - LANDMARKS.conolly.pos.z);
    c.lerp(cLitter, (1 - smoothstep(6, 36, dConolly)) * 0.55);
    // River banks and bed
    c.lerp(cMud, 1 - smoothstep(-0.4, 1.4, y));
    c.lerp(cSand, (1 - smoothstep(-1.2, -0.2, y)) * 0.6);
    c.lerp(cGravel, 1 - smoothstep(-2.4, -1.0, y));
    // Rail bed & yard get bare soil
    const dr = Math.abs(x - RAIL_X);
    if (Math.abs(z) < 250) c.lerp(cSoil, (1 - smoothstep(3, 8, dr)) * 0.7);
    // Steep slopes show rock
    c.lerp(cRock, smoothstep(0.22, 0.5, slope));
    // Distant mountains: dark forested
    const e = smoothstep(190, 300, Math.max(Math.abs(x), Math.abs(z)));
    c.lerp(cMount, e * 0.85);
    // Cleared ground around buildings
    if (isFootprint(x, z, 2)) c.lerp(cSoil, 0.6);
    const v = 0.9 + n2 * 0.2;
    colors[i * 3] = c.r * v; colors[i * 3 + 1] = c.g * v; colors[i * 3 + 2] = c.b * v;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mesh = new THREE.Mesh(geo, M.terrain);
  mesh.receiveShadow = true;
  scene.add(mesh);
  ANIM.terrain = mesh;
}

// ---------- River ----------
function buildChaliyarRiver() {
  const geo = new THREE.PlaneGeometry(56, 640);
  geo.rotateX(-Math.PI / 2);
  const opts = {
    textureWidth: 512, textureHeight: 512,
    waterNormals: TEX.waterN,
    sunDirection: new THREE.Vector3(0.5, 0.7, 0.3),
    sunColor: 0xfff2d8,
    waterColor: 0x1c4a3c,
    distortionScale: 2.6,
    fog: true,
    alpha: 0.96
  };
  TEX.waterN.wrapS = TEX.waterN.wrapT = THREE.RepeatWrapping;
  waterMesh = new THREE.Water(geo, opts);
  waterMesh.material.uniforms.size.value = 0.9;
  waterMesh.position.set(0, WATER_Y, 0);
  scene.add(waterMesh);
}

// ---------- Rocks ----------
function makeRockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = fbm(x * 1.6 + seed, y * 1.6 + z * 1.3, 3, seed) * 1.3 + 0.55;
    p.setXYZ(i, x * n, y * n * 0.75, z * n);
  }
  g.computeVertexNormals();
  return g;
}

function buildRocks(rng) {
  const geo = makeRockGeometry(4);
  const cols = [], mats = [];
  const col = new THREE.Color();
  // Colour attribute is required by the vertexColors rock material
  const n = geo.attributes.position.count;
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
  function add(x, z, s, sink) {
    const y = heightAt(x, z);
    mats.push(mat(x, y - sink, z, rng() * 0.3, rng() * 6.28, rng() * 0.3, s * (0.8 + rng() * 0.6), s * (0.6 + rng() * 0.5), s * (0.8 + rng() * 0.6)));
    col.setHSL(0.08 + rng() * 0.05, 0.08 + rng() * 0.1, 0.34 + rng() * 0.22);
    cols.push(col.clone());
    if (s > 1.1) addCircleCollider(x, z, s * 0.85);
  }
  // Boulders along the river
  for (let i = 0; i < 90; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * (10 + rng() * 22), z = (rng() - 0.5) * 520;
    if (Math.abs(z) < 12 && Math.abs(x) < 34) continue;
    add(x, z, 0.5 + Math.pow(rng(), 2) * 2.4, 0.2);
  }
  // Around the waterfall pool
  const wf = LANDMARKS.waterfall.pos;
  for (let i = 0; i < 34; i++) {
    const a = rng() * Math.PI * 2, r = 8 + rng() * 6;
    add(wf.x + Math.cos(a) * r * 1.2, wf.z + 18 + Math.sin(a) * r * 0.8, 0.6 + rng() * 1.8, 0.3);
  }
  // Scattered hillside rocks
  for (let i = 0; i < 90; i++) {
    const x = (rng() - 0.5) * 500, z = (rng() - 0.5) * 500;
    if (Math.abs(x) < 30 || isFootprint(x, z, 4) || Math.abs(x - RAIL_X) < 10) continue;
    add(x, z, 0.5 + rng() * 1.6, 0.25);
  }
  const im = makeInstanced(geo, M.rock, mats, null, true);
  for (let i = 0; i < cols.length; i++) im.setColorAt(i, cols[i]);
  im.instanceColor.needsUpdate = true;
  scene.add(im);
}

// ---------- Vegetation ----------
function makeTrunkGeometry(rTop, rBot, h, flareH, seed) {
  const g = new THREE.CylinderGeometry(rTop, rBot, h, 10, 10, true);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const ang = Math.atan2(z, x);
    let k = 1 + 0.45 * Math.pow(Math.max(0, 1 - y / flareH), 2) * (0.6 + 0.4 * Math.cos(ang * 5 + seed));
    k *= 1 + (vnoise(ang * 3 + seed, y * 0.5, seed) - 0.5) * 0.12;
    p.setXYZ(i, x * k, y, z * k);
    uv.setY(i, uv.getY(i) * h / 4.5);
  }
  g.computeVertexNormals();
  return g;
}

function makeCoconutGeometries() {
  // Curved trunk built from segments, plus crown of fronds at the top
  const segs = 12, h = 13, bend = 2.6;
  const trunkParts = [];
  let top = new THREE.Vector3(), topDir = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const p0 = new THREE.Vector3(bend * t0 * t0, h * t0, 0), p1 = new THREE.Vector3(bend * t1 * t1, h * t1, 0);
    const len = p0.distanceTo(p1);
    const r0 = 0.34 - 0.12 * t0, r1 = 0.34 - 0.12 * t1;
    const cg = new THREE.CylinderGeometry(r1, r0, len, 8, 1, true);
    const uv = cg.attributes.uv;
    for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * len / 1.6);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const dir = p1.clone().sub(p0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    trunkParts.push({ geo: cg, matrix: new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1)) });
    if (i === segs - 1) { top.copy(p1); topDir.copy(dir); }
  }
  const trunk = mergeGeos(trunkParts);
  // Fronds: a bent strip using the frond texture
  const frondParts = [];
  const rng = makeRng(31);
  for (let i = 0; i < 15; i++) {
    const L = 6.0 + rng() * 1.6, wd = 1.9;
    const pg = new THREE.PlaneGeometry(L, wd, 8, 1);
    const pp = pg.attributes.position;
    for (let k = 0; k < pp.count; k++) {
      const x = pp.getX(k) + L / 2; // 0..L
      const t = x / L;
      // arch up then droop; plane lies in XZ afterwards
      pp.setXYZ(k, x, 1.1 * Math.sin(t * 2.2) - 2.6 * t * t * t, pp.getY(k));
    }
    pg.computeVertexNormals();
    frondParts.push({ geo: pg, matrix: mat(top.x, top.y - 0.2, top.z, (rng() - 0.5) * 0.35, (i / 15) * Math.PI * 2 + rng() * 0.3, 0) });
  }
  const crown = mergeGeos(frondParts);
  // Coconut cluster
  const nuts = [];
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2;
    nuts.push({ geo: new THREE.SphereGeometry(0.22, 6, 5), matrix: mat(top.x + Math.cos(a) * 0.35, top.y - 0.55, top.z + Math.sin(a) * 0.35) });
  }
  return { trunk: trunk, crown: crown, nuts: mergeGeos(nuts) };
}

function makeBananaGeometries() {
  const stems = [], leaves = [];
  const rng = makeRng(77);
  for (let s = 0; s < 3; s++) {
    const a = s / 3 * Math.PI * 2 + rng(), r = 0.35 + rng() * 0.2;
    const sx = Math.cos(a) * r, sz = Math.sin(a) * r, sh = 2.3 + rng() * 1.3;
    const cg = new THREE.CylinderGeometry(0.13, 0.19, sh, 7, 1, true);
    stems.push({ geo: cg, matrix: mat(sx, sh / 2, sz) });
    for (let i = 0; i < 6; i++) {
      const L = 2.8 + rng() * 0.9, wd = 1.1;
      const pg = new THREE.PlaneGeometry(L, wd, 6, 1);
      const pp = pg.attributes.position;
      for (let k = 0; k < pp.count; k++) {
        const x = pp.getX(k) + L / 2, t = x / L;
        pp.setXYZ(k, x, 0.75 * Math.sin(t * 1.6) - 1.3 * t * t, pp.getY(k));
      }
      pg.computeVertexNormals();
      leaves.push({ geo: pg, matrix: mat(sx, sh - 0.1, sz, 0, (i / 6) * Math.PI * 2 + rng() * 0.5, (rng() - 0.5) * 0.3) });
    }
  }
  return { stems: mergeGeos(stems), leaves: mergeGeos(leaves) };
}

function makeBambooGeometries() {
  const culms = [], leaves = [];
  const rng = makeRng(90);
  for (let i = 0; i < 11; i++) {
    const a = rng() * Math.PI * 2, r = rng() * 0.9;
    const bx = Math.cos(a) * r, bz = Math.sin(a) * r;
    const h = 8.5 + rng() * 5, lean = 0.06 + rng() * 0.14;
    const la = rng() * Math.PI * 2;
    const dirx = Math.cos(la) * lean, dirz = Math.sin(la) * lean;
    const rad = 0.08 + rng() * 0.05;
    const nodes = 9;
    for (let k = 0; k < nodes; k++) {
      const y0 = k / nodes * h, y1 = (k + 1) / nodes * h;
      const cg = new THREE.CylinderGeometry(rad * (1 - y1 / h * 0.4), rad * (1 - y0 / h * 0.4) * 1.05, y1 - y0 - 0.04, 6, 1, true);
      culms.push({ geo: cg, matrix: mat(bx + dirx * (y0 + y1) / 2 * (1 + y0 / h), (y0 + y1) / 2, bz + dirz * (y0 + y1) / 2 * (1 + y0 / h)) });
    }
    const tx = bx + dirx * h * 1.5, tz = bz + dirz * h * 1.5;
    for (let k = 0; k < 4; k++) {
      const pg = new THREE.PlaneGeometry(1.8, 1.8);
      leaves.push({ geo: pg, matrix: mat(tx, h - 0.6 - k * 0.9, tz, rng() * 6, rng() * 6, rng() * 6) });
    }
  }
  const lg = mergeGeos(leaves);
  const p = lg.attributes.position, n = lg.attributes.normal;
  for (let i = 0; i < p.count; i++) n.setXYZ(i, 0, 1, 0);
  return { culms: mergeGeos(culms), leaves: lg };
}

function makeFernGeometry() {
  const parts = [];
  const rng = makeRng(12);
  for (let i = 0; i < 8; i++) {
    const L = 1.5 + rng() * 0.5;
    const pg = new THREE.PlaneGeometry(L, 0.7, 5, 1);
    const pp = pg.attributes.position;
    for (let k = 0; k < pp.count; k++) {
      const x = pp.getX(k) + L / 2, t = x / L;
      pp.setXYZ(k, x, 0.55 * Math.sin(t * 1.4) - 0.5 * t * t + 0.1, pp.getY(k));
    }
    pg.computeVertexNormals();
    parts.push({ geo: pg, matrix: mat(0, 0, 0, 0, i / 8 * Math.PI * 2 + rng() * 0.4, 0) });
  }
  return mergeGeos(parts);
}

function makeGrassGeometry() {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const pg = new THREE.PlaneGeometry(1.15, 0.78, 1, 2);
    pg.translate(0, 0.39, 0);
    parts.push({ geo: pg, matrix: mat(0, 0, 0, 0, i * Math.PI / 3, 0) });
  }
  const g = mergeGeos(parts);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

function buildVegetation() {
  const rng = makeRng(2024);
  const col = new THREE.Color();

  // ---- Teak trees ----
  const teakTrunk = makeTrunkGeometry(0.34, 0.62, 19, 3.5, 2);
  const teakCanopy = makeCanopyGeometry(1, 30, 1.25, 11, 0.62);
  const tTrunkM = [], tCanopyM = [], tCanopyC = [];
  function addTeak(x, y, z, s) {
    const hs = 0.75 + rng() * 0.55;
    const yaw = rng() * 6.28;
    tTrunkM.push(mat(x, y - 0.3, z, 0, yaw, 0, s, s * hs, s));
    const topY = y - 0.3 + 19 * s * hs * 0.94;
    const cs = (5.2 + rng() * 2.2) * s;
    tCanopyM.push(mat(x, topY + cs * 0.15, z, 0, yaw, 0, cs, cs * (0.9 + rng() * 0.3), cs));
    col.setHSL(0.24 + rng() * 0.07, 0.42 + rng() * 0.22, 0.34 + rng() * 0.16);
    tCanopyC.push(col.clone());
    addCircleCollider(x, z, 0.55 * s);
  }
  // Natural forest
  let placed = 0, tries = 0;
  while (placed < 520 && tries < 12000) {
    tries++;
    const x = (rng() - 0.5) * 560, z = (rng() - 0.5) * 560;
    if (Math.abs(x) < 34 || Math.abs(x - RAIL_X) < 10 || isFootprint(x, z, 6)) continue;
    const dc = Math.hypot(x - LANDMARKS.conolly.pos.x, z - LANDMARKS.conolly.pos.z);
    if (dc < 46) continue; // handled by planted grove below
    const fm = forestMask(x, z);
    if (rng() > 0.04 + fm * 0.9) continue;
    if (slopeAt(x, z) > 0.75) continue;
    addTeak(x, heightAt(x, z), z, 0.8 + rng() * 0.5);
    placed++;
  }
  // Conolly's Plot: planted in neat rows, as in a real plantation
  {
    const c = LANDMARKS.conolly.pos;
    for (let gx = -44; gx <= 44; gx += 6.2) {
      for (let gz = -44; gz <= 44; gz += 6.2) {
        const x = c.x + gx + (rng() - 0.5) * 1.4, z = c.z + gz + (rng() - 0.5) * 1.4;
        const d = Math.hypot(x - c.x, z - c.z);
        if (d < 15 || d > 46) continue;
        if (Math.abs(x) < 34) continue;
        addTeak(x, heightAt(x, z), z, 1.0 + rng() * 0.35);
      }
    }
  }
  // Trees on top of the waterfall cliff
  EXTRA_TREES.forEach(t => addTeak(t.x, t.y, t.z, t.s));

  const teakT = makeInstanced(teakTrunk, M.bark, tTrunkM, null, true);
  const teakC = makeInstanced(teakCanopy, M.leaf, tCanopyM, tCanopyC, true);
  scene.add(teakT, teakC);

  // ---- Coconut palms ----
  const cg = makeCoconutGeometries();
  const cM = [];
  tries = 0;
  while (cM.length < 110 && tries < 6000) {
    tries++;
    const x = (rng() - 0.5) * 500, z = (rng() - 0.5) * 500;
    const ax = Math.abs(x);
    const nearRiver = ax > 30 && ax < 75;
    const nearPalace = Math.hypot(x - 90, z - 82) < 55;
    const nearMuseum = Math.hypot(x - 80, z + 58) < 55;
    if (!(nearRiver || nearPalace || nearMuseum) || isFootprint(x, z, 3) || Math.abs(x - RAIL_X) < 10) continue;
    if (rng() > 0.55) continue;
    const s = 0.75 + rng() * 0.5;
    cM.push(mat(x, heightAt(x, z) - 0.1, z, 0, rng() * 6.28, 0, s, s, s));
    addCircleCollider(x, z, 0.4);
  }
  const coconutTrunk = makeInstanced(cg.trunk, M.bark, cM, null, true);
  const coconutCrown = makeInstanced(cg.crown, M.frond, cM, null, true);
  const coconutNuts = makeInstanced(cg.nuts, M.stem, cM, null, false);
  scene.add(coconutTrunk, coconutCrown, coconutNuts);

  // ---- Banana clusters ----
  const bg = makeBananaGeometries();
  const bM = [];
  tries = 0;
  while (bM.length < 90 && tries < 5000) {
    tries++;
    const x = (rng() - 0.5) * 400, z = (rng() - 0.5) * 400;
    const ax = Math.abs(x);
    const nearHome = Math.hypot(x - 90, z - 82) < 50 || Math.hypot(x - 80, z + 58) < 50 || (ax > 28 && ax < 60);
    if (!nearHome || isFootprint(x, z, 3) || Math.abs(x - RAIL_X) < 10) continue;
    const s = 0.8 + rng() * 0.5;
    bM.push(mat(x, heightAt(x, z), z, 0, rng() * 6.28, 0, s, s, s));
  }
  scene.add(makeInstanced(bg.stems, M.stem, bM, null, true), makeInstanced(bg.leaves, M.banana, bM, null, true));

  // ---- Bamboo clumps along the river ----
  const bb = makeBambooGeometries();
  const bbM = [];
  for (let i = 0; i < 46; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * (27 + rng() * 22), z = (rng() - 0.5) * 480;
    if (Math.abs(z) < 16 || isFootprint(x, z, 3) || Math.abs(x - RAIL_X) < 10) continue;
    const s = 0.85 + rng() * 0.4;
    bbM.push(mat(x, heightAt(x, z) - 0.15, z, 0, rng() * 6.28, 0, s, s, s));
    addCircleCollider(x, z, 1.0);
  }
  const bambooLeafM = M.leaf.clone();
  bambooLeafM.color = new THREE.Color(0xd8e88a);
  addWind(bambooLeafM, 0.3, 2.0, 8.0);
  scene.add(makeInstanced(bb.culms, M.bamboo, bbM, null, true), makeInstanced(bb.leaves, bambooLeafM, bbM, null, true));

  // ---- Ferns & shrubs ----
  const fg = makeFernGeometry();
  const fM = [], fC = [];
  tries = 0;
  while (fM.length < 700 && tries < 9000) {
    tries++;
    const x = (rng() - 0.5) * 520, z = (rng() - 0.5) * 520;
    if (Math.abs(x) < 26 || isFootprint(x, z, 2) || Math.abs(x - RAIL_X) < 6) continue;
    const fm = forestMask(x, z);
    if (rng() > 0.08 + fm * 0.9) continue;
    const s = 0.7 + rng() * 1.1;
    fM.push(mat(x, heightAt(x, z) - 0.05, z, 0, rng() * 6.28, 0, s, s, s));
    col.setHSL(0.24 + rng() * 0.08, 0.5, 0.5 + rng() * 0.2);
    fC.push(col.clone());
  }
  scene.add(makeInstanced(fg, M.fern, fM, fC, false));

  // ---- Grass tufts ----
  const gg = makeGrassGeometry();
  const gM = [], gC = [];
  tries = 0;
  while (gM.length < 44000 && tries < 130000) {
    tries++;
    const x = (rng() - 0.5) * 520, z = (rng() - 0.5) * 520;
    const h = heightAt(x, z);
    if (h < -0.1 || Math.abs(x - RAIL_X) < 4.5 || isFootprint(x, z, 1)) continue;
    if (Math.abs(x) < 6 && Math.abs(z) < 5) continue;
    const fm = forestMask(x, z);
    if (rng() > 1 - fm * 0.45) continue;
    if (slopeAt(x, z) > 0.55) continue;
    const s = 0.7 + rng() * 0.9;
    gM.push(mat(x, h - 0.03, z, 0, rng() * 6.28, 0, s, s * (0.7 + rng() * 0.7), s));
    col.setHSL(0.2 + rng() * 0.09, 0.3 + rng() * 0.22, 0.4 + rng() * 0.22);
    gC.push(col.clone());
  }
  scene.add(makeInstanced(gg, M.grass, gM, gC, false));

  buildRocks(rng);
}

// ---------- Landmark: Canoly Suspension Bridge ----------
function buildCanolyBridge() {
  const g = new THREE.Group();
  const HALF = 26, W = 6.4;

  // Deck planks (instanced), following the sagging profile
  const plankGeo = texBox(0.46, 0.14, W, 2.5);
  const plankM = [], plankC = [];
  const col = new THREE.Color();
  const rng = makeRng(5);
  for (let x = -HALF + 0.25; x <= HALF; x += 0.5) {
    const y = bridgeDeckY(x);
    const slope = Math.atan2(bridgeDeckY(x + 0.25) - bridgeDeckY(x - 0.25), 0.5);
    plankM.push(mat(x, y, 0, 0, 0, slope, 1, 1 + (rng() - 0.5) * 0.1, 1));
    col.setHSL(0.07 + rng() * 0.02, 0.4, 0.28 + rng() * 0.15);
    plankC.push(col.clone());
  }
  g.add(makeInstanced(plankGeo, M.wood, plankM, plankC, true));

  // Stringers below the deck
  for (const sz of [-2.6, 0, 2.6]) {
    const pts = [];
    for (let x = -HALF; x <= HALF; x += 2) pts.push(new THREE.Vector3(x, bridgeDeckY(x) - 0.22, sz));
    g.add(mk(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.12, 6, false), M.steelDark, 0, 0, 0));
  }

  // Cable profile
  function cableY(x) {
    const a = Math.abs(x);
    if (a <= 20) return 4.4 + (14.6 - 4.4) * (a / 20) * (a / 20);
    return 14.6 - (14.6 - 3.8) * (a - 20) / 13;
  }
  for (const sz of [-3.5, 3.5]) {
    const pts = [];
    for (let x = -33; x <= 33; x += 1.5) pts.push(new THREE.Vector3(x, cableY(x), sz));
    g.add(mk(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 120, 0.14, 6, false), M.steelDark, 0, 0, 0));
    // Hand rail rope
    const rp = [];
    for (let x = -HALF; x <= HALF; x += 2) rp.push(new THREE.Vector3(x, bridgeDeckY(x) + 1.15, sz * 0.93));
    g.add(mk(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rp), 40, 0.06, 5, false), M.steel, 0, 0, 0));
    // Wire mesh side panel
    const lo = [], hi = [];
    for (let x = -HALF; x <= HALF; x += 1) { lo.push(new THREE.Vector3(x, bridgeDeckY(x) + 0.05, sz * 0.93)); hi.push(new THREE.Vector3(x, bridgeDeckY(x) + 1.15, sz * 0.93)); }
    const rib = makeRibbon(lo, hi, 1.2, 1);
    const ribMesh = mk(rib, M.lattice, 0, 0, 0, false, false);
    g.add(ribMesh);
  }
  // Hangers
  const hangGeo = new THREE.CylinderGeometry(0.035, 0.035, 1, 4);
  const hM = [];
  for (const sz of [-3.5, 3.5]) {
    for (let x = -24; x <= 24; x += 2) {
      const y0 = bridgeDeckY(x) + 0.1, y1 = cableY(x);
      hM.push(mat(x, (y0 + y1) / 2, sz, 0, 0, 0, 1, y1 - y0, 1));
    }
  }
  g.add(makeInstanced(hangGeo, M.steelDark, hM, null, false));

  // Steel A-frame towers at each bank
  for (const sx of [-20, 20]) {
    for (const sz of [-3.7, 3.7]) {
      g.add(mk(new THREE.BoxGeometry(0.7, 18, 0.7), M.steel, sx, 6.0, sz));
      g.add(mk(new THREE.BoxGeometry(1.6, 1.6, 1.6), M.concrete, sx, -0.2, sz));
    }
    g.add(mk(new THREE.BoxGeometry(0.6, 0.7, 8.2), M.steel, sx, 14.6, 0));
    g.add(mk(new THREE.BoxGeometry(0.5, 0.5, 7.6), M.steel, sx, 9.0, 0));
    const bl = Math.hypot(7.4, 5.6), ba = Math.atan2(5.6, 7.4);
    for (const sgn of [-1, 1]) {
      const br = mk(new THREE.BoxGeometry(0.22, 0.22, bl), M.steelDark, sx, 11.8, 0);
      br.rotation.x = sgn * ba;
      g.add(br);
    }
  }
  // Concrete anchorages and approach ramps
  for (const sx of [-1, 1]) {
    g.add(mk(texBox(5, 3.6, 8.6, 3), M.stone, sx * 31.5, 1.6, 0));
    g.add(mk(texBox(4, 1.2, 8, 3), M.stone, sx * 27.8, 1.9, 0));
    addBoxCollider(sx * 31.5, 0, 2.5, 4.3);
  }
  // Bridge name board at the east bank
  const sb = signBoard(['CANOLY BRIDGE', 'Chaliyar River - Nilambur'], { bw: 4.6, size: 44 });
  sb.position.set(36, BANK_H, 8);
  sb.rotation.y = -0.4;
  g.add(sb);

  scene.add(g);

  GROUND_EXTRAS.push((x, z) => (Math.abs(x) <= 26.3 && Math.abs(z) <= 3.3) ? bridgeDeckY(clamp(x, -26, 26)) + 0.08 : null);
}

// ---------- Landmark: Conolly's Plot ----------
function buildConollyTeakPlot() {
  const g = new THREE.Group();
  const p = LANDMARKS.conolly.pos;
  const y0 = LM_H.conolly;
  g.position.set(p.x, y0, p.z);

  // Giant "Kannimara"-style teak: buttressed trunk, big limbs, huge canopy
  const trunkGeo = makeTrunkGeometry(1.35, 2.5, 30, 7, 4);
  const trunk = mk(trunkGeo, M.bark, 0, -0.5, 0);
  g.add(trunk);
  const limbs = [];
  const rng = makeRng(99);
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * Math.PI * 2 + rng() * 0.5;
    const L = 12 + rng() * 5;
    const cg = new THREE.CylinderGeometry(0.4, 0.9, L, 7, 3, true);
    cg.translate(0, L / 2, 0);
    const uv = cg.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setY(k, uv.getY(k) * L / 4);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a, 0)).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -0.75 - rng() * 0.3)));
    limbs.push({ geo: cg, matrix: new THREE.Matrix4().compose(new THREE.Vector3(0, 21 + rng() * 4, 0), q, new THREE.Vector3(1, 1, 1)) });
  }
  g.add(mk(mergeGeos(limbs), M.bark, 0, 0, 0));
  const canopyGeo = makeCanopyGeometry(1, 90, 1.15, 7, 0.55);
  const canopyMesh = mk(canopyGeo, M.leafGiant, 0, 33, 0);
  canopyMesh.scale.set(15, 12, 15);
  g.add(canopyMesh);
  addCircleCollider(p.x, p.z, 3.6);

  // Fence around the tree (with a gap at the front)
  const postGeo = new THREE.CylinderGeometry(0.1, 0.12, 1.3, 6);
  const postM = [];
  const R = 9.5;
  for (let i = 0; i < 26; i++) {
    const a = 0.5 + i / 26 * (Math.PI * 2 - 1.0) + Math.PI * 0.5;
    postM.push(mat(Math.cos(a) * R, heightAt(p.x + Math.cos(a) * R, p.z + Math.sin(a) * R) - y0 + 0.6, Math.sin(a) * R));
  }
  g.add(makeInstanced(postGeo, M.woodDark, postM, null, true));
  for (const hy of [0.55, 1.05]) {
    const tor = new THREE.TorusGeometry(R, 0.05, 5, 48, Math.PI * 2 - 1.0);
    const tm = mk(tor, M.woodDark, 0, hy + 0.05, 0, true, false);
    tm.rotation.x = Math.PI / 2;
    tm.rotation.z = 0.5 + Math.PI * 0.5;
    g.add(tm);
  }

  // Information board and a lantern-post
  const sb = signBoard(["CONOLLY'S PLOT", "World's oldest teak plantation - 1840s"], { bw: 4.6, size: 44 });
  sb.position.set(6, 0.1, R + 2.5);
  sb.rotation.y = 0.15;
  g.add(sb);

  scene.add(g);
}

// ---------- Landmark: Teak Museum ----------
function buildTeakMuseum() {
  const g = new THREE.Group();
  const p = LANDMARKS.museum.pos;
  const y0 = LM_H.museum;
  g.position.set(p.x, y0, p.z);
  const PL = 0.7;

  g.add(mk(texBox(38, PL, 28, 3), M.stone, 0, PL / 2, 2));
  g.add(mk(texBox(12, 0.45, 1.2, 3), M.stone, 0, 0.225, 16.6, false, true));
  g.add(mk(texBox(12, 0.22, 1.2, 3), M.stone, 0, 0.11, 17.6, false, true));

  // Teak-plank walls with plaster pilasters
  g.add(mk(texBox(30, 10, 20, 3.2), M.wood, 0, PL + 5, 0));
  for (let x = -15; x <= 15; x += 7.5) {
    g.add(mk(texBox(0.9, 10.2, 0.9, 3), M.plaster, x, PL + 5.1, 10.15));
  }
  // Roof: Kerala style, two-tier
  const r1 = makeGableRoof(30, 20, 6.2, 3.4, 1);
  const roof1 = mk(r1.roof, M.roof, 0, PL + 10, 0);
  const gab1 = mk(r1.gable, M.wood, 0, PL + 10, 0);
  g.add(roof1, gab1);
  const r2 = makeGableRoof(14, 10, 3.8, 1.8, 1);
  g.add(mk(r2.roof, M.roof, 0, PL + 15.4, 0), mk(r2.gable, M.woodDark, 0, PL + 15.4, 0));
  g.add(mk(texBox(12.6, 2.6, 8.6, 3), M.wood, 0, PL + 15.0, 0));

  // Verandah with carved teak pillars
  const pillarGeo = new THREE.CylinderGeometry(0.32, 0.36, 6, 10);
  for (let i = 0; i < 8; i++) {
    const x = -14 + i * 4;
    g.add(mk(pillarGeo, M.woodDark, x, PL + 3, 12.8));
    g.add(mk(new THREE.BoxGeometry(0.9, 0.35, 0.9), M.wood, x, PL + 0.18, 12.8));
    g.add(mk(new THREE.BoxGeometry(0.9, 0.4, 0.9), M.wood, x, PL + 5.9, 12.8));
  }
  const vr = mk(texBox(32, 0.35, 6, 3), M.roof, 0, PL + 6.4, 11.6);
  vr.rotation.x = 0.16;
  g.add(vr);
  g.add(mk(texBox(32, 0.5, 0.5, 3), M.woodDark, 0, PL + 6.0, 12.8));
  // Floor of verandah
  g.add(mk(texBox(32, 0.15, 5, 2.5), M.wood, 0, PL + 0.08, 12.6, false, true));

  // Doors and windows
  g.add(mk(new THREE.BoxGeometry(4.6, 6, 0.3), M.woodDark, 0, PL + 3, 10.1));
  g.add(mk(new THREE.BoxGeometry(0.15, 6, 0.4), M.wood, 0, PL + 3, 10.15));
  for (const x of [-11, -6.5, 6.5, 11]) {
    g.add(mk(new THREE.BoxGeometry(2.4, 3.2, 0.2), M.glass, x, PL + 5, 10.1));
    g.add(mk(new THREE.BoxGeometry(2.8, 0.25, 0.4), M.woodDark, x, PL + 6.7, 10.15));
    g.add(mk(new THREE.BoxGeometry(2.8, 0.25, 0.4), M.woodDark, x, PL + 3.35, 10.2));
    g.add(mk(new THREE.BoxGeometry(0.2, 3.2, 0.4), M.woodDark, x, PL + 5, 10.2));
  }
  // Sign over the entrance
  const st = signTexture(['NILAMBUR TEAK MUSEUM', 'Est. 1995 - Kerala Forest Research'], { w: 768, h: 160, size: 42 });
  const board = mk(new THREE.PlaneGeometry(9.6, 2), new THREE.MeshStandardMaterial({ map: st, roughness: 0.7 }), 0, PL + 8.0, 13.05);
  g.add(board);

  // Stack of teak logs beside the museum
  const logGeo = new THREE.CylinderGeometry(0.6, 0.62, 7, 12);
  const logMats = [M.bark, M.endgrain, M.endgrain];
  const logRows = [5, 4, 3, 2];
  logRows.forEach((n, row) => {
    for (let i = 0; i < n; i++) {
      const lg = mk(logGeo, logMats, 22 + (i - (n - 1) / 2) * 1.25 + 0.02, 0.62 + row * 1.05, 4 - 0.2 * row);
      lg.rotation.z = Math.PI / 2;
      lg.rotation.y = 0.1 * (i % 2);
      g.add(lg);
    }
  });
  // A single showpiece log on display stand
  const showLog = mk(new THREE.CylinderGeometry(1.0, 1.15, 5, 14), logMats, -23, 1.6, 12);
  showLog.rotation.z = Math.PI / 2;
  g.add(showLog);
  g.add(mk(new THREE.BoxGeometry(0.5, 0.8, 2.6), M.woodDark, -24.6, 0.4, 12));
  g.add(mk(new THREE.BoxGeometry(0.5, 0.8, 2.6), M.woodDark, -21.4, 0.4, 12));

  // Lanterns at the steps
  for (const x of [-7.5, 7.5]) {
    g.add(mk(new THREE.CylinderGeometry(0.08, 0.1, 3, 6), M.steelDark, x, 1.5, 17.5));
    g.add(mk(new THREE.SphereGeometry(0.3, 8, 8), M.lampGlow, x, 3.1, 17.5, false));
  }

  scene.add(g);
  addBoxCollider(p.x, p.z, 15.2, 10.2);
  GROUND_EXTRAS.push((x, z) => (Math.abs(x - p.x) < 19 && Math.abs(z - (p.z + 2)) < 14) ? y0 + PL : null);
}

// ---------- Landmark: Nilambur Kovilakam Palace ----------
function buildNilamburPalace() {
  const g = new THREE.Group();
  const p = LANDMARKS.palace.pos;
  const y0 = LM_H.palace;
  g.position.set(p.x, y0, p.z);
  const PL = 0.9;

  // Stone plinth and steps
  g.add(mk(texBox(36, PL, 30, 3), M.stone, 0, PL / 2, 2));
  g.add(mk(texBox(10, 0.6, 1.3, 3), M.stone, 0, 0.3, 17.6, false, true));
  g.add(mk(texBox(10, 0.3, 1.3, 3), M.stone, 0, 0.15, 18.7, false, true));

  // Main hall
  g.add(mk(texBox(26, 8, 18, 4), M.plaster, 0, PL + 4, 0));
  // Timber band and plinth moulding
  g.add(mk(texBox(26.6, 0.5, 18.6, 3), M.woodDark, 0, PL + 8.0, 0));
  g.add(mk(texBox(26.5, 0.7, 18.5, 3), M.stone, 0, PL + 0.35, 0));
  // Upper storey
  g.add(mk(texBox(16, 5, 11, 4), M.plaster, 0, PL + 8.25 + 2.5, 0));
  g.add(mk(texBox(16.6, 0.4, 11.6, 3), M.woodDark, 0, PL + 13.25, 0));

  // Roofs: lower wide gable, upper smaller gable, cross-gable over entrance
  const r1 = makeGableRoof(26, 18, 5.6, 3.6, 1);
  g.add(mk(r1.roof, M.roof, 0, PL + 8.2, 0), mk(r1.gable, M.plaster, 0, PL + 8.2, 0));
  const r2 = makeGableRoof(16, 11, 4.6, 2.4, 1);
  g.add(mk(r2.roof, M.roof, 0, PL + 13.4, 0), mk(r2.gable, M.plaster, 0, PL + 13.4, 0));
  const r3 = makeGableRoof(9, 7, 3.0, 1.8, 1);
  const cross = mk(r3.roof, M.roof, 0, PL + 8.2, 10.5);
  cross.rotation.y = Math.PI / 2;
  const crossG = mk(r3.gable, M.plaster, 0, PL + 8.2, 10.5);
  crossG.rotation.y = Math.PI / 2;
  g.add(cross, crossG);
  // Ridge finials
  for (const x of [-13.6, 13.6]) g.add(mk(new THREE.ConeGeometry(0.28, 1.4, 6), M.steelDark, x, PL + 8.2 + 5.6 * 0.02 + 5.9, 0));
  g.add(mk(new THREE.ConeGeometry(0.3, 1.6, 6), M.steelDark, 0, PL + 13.4 + 4.6 + 0.6, 0));

  // Veranda (padippura) pillars and lean-to roof
  const pillarGeo = new THREE.CylinderGeometry(0.3, 0.34, 6.4, 10);
  for (let i = 0; i < 9; i++) {
    const x = -12 + i * 3;
    g.add(mk(pillarGeo, M.woodDark, x, PL + 3.2, 12.2));
    g.add(mk(new THREE.BoxGeometry(0.85, 0.35, 0.85), M.stone, x, PL + 0.18, 12.2));
    g.add(mk(new THREE.BoxGeometry(0.85, 0.45, 0.85), M.wood, x, PL + 6.3, 12.2));
  }
  const vr = mk(texBox(29, 0.3, 6.4, 3), M.roof, 0, PL + 6.95, 11.8);
  vr.rotation.x = 0.17;
  g.add(vr);
  g.add(mk(texBox(28, 0.5, 0.5, 3), M.woodDark, 0, PL + 6.55, 12.2));
  g.add(mk(texBox(28, 0.14, 4, 2.5), M.wood, 0, PL + 0.08, 11.2, false, true));
  // Low veranda parapet with lattice gaps
  for (const sx of [-1, 1]) g.add(mk(texBox(8, 0.9, 0.4, 3), M.plaster, sx * 10, PL + 0.5, 12.2));

  // Entrance door, windows with timber shutters
  g.add(mk(new THREE.BoxGeometry(3.6, 5.6, 0.3), M.woodDark, 0, PL + 2.8, 9.1));
  g.add(mk(new THREE.BoxGeometry(4.6, 0.4, 0.5), M.wood, 0, PL + 5.8, 9.2));
  for (const x of [-10, -6, 6, 10]) {
    g.add(mk(new THREE.BoxGeometry(2, 3, 0.2), M.glass, x, PL + 4.5, 9.05));
    g.add(mk(new THREE.BoxGeometry(2.5, 0.25, 0.4), M.woodDark, x, PL + 6.1, 9.15));
    g.add(mk(new THREE.BoxGeometry(2.5, 0.25, 0.4), M.woodDark, x, PL + 2.9, 9.2));
    g.add(mk(new THREE.BoxGeometry(0.7, 3, 0.15), M.woodDark, x - 1.3, PL + 4.5, 9.2));
    g.add(mk(new THREE.BoxGeometry(0.7, 3, 0.15), M.woodDark, x + 1.3, PL + 4.5, 9.2));
  }
  for (const x of [-4, 0, 4]) {
    g.add(mk(new THREE.BoxGeometry(1.6, 2.4, 0.2), M.glass, x, PL + 10.8, 5.6));
    g.add(mk(new THREE.BoxGeometry(2, 0.22, 0.35), M.woodDark, x, PL + 12.1, 5.65));
    g.add(mk(new THREE.BoxGeometry(2, 0.22, 0.35), M.woodDark, x, PL + 9.55, 5.7));
  }

  // Oil lamps in front (glow at night) and courtyard lantern posts
  for (const x of [-6.5, 6.5]) {
    g.add(mk(new THREE.CylinderGeometry(0.09, 0.12, 3.2, 6), M.steelDark, x, 1.6, 19.5));
    g.add(mk(new THREE.SphereGeometry(0.32, 8, 8), M.lampGlow, x, 3.3, 19.5, false));
    const pl = new THREE.PointLight(0xffb060, 0, 28, 1.8);
    pl.position.set(x, 3.4, 19.5);
    g.add(pl);
    ANIM.nightLights.push(pl);
  }
  // Signboard
  const sb = signBoard(['NILAMBUR KOVILAKAM', 'Seat of the Nilambur Rajas'], { bw: 5, size: 40 });
  sb.position.set(-11, 0.1, 22);
  sb.rotation.y = 0.2;
  g.add(sb);

  scene.add(g);
  addBoxCollider(p.x, p.z, 13.2, 9.2);
  GROUND_EXTRAS.push((x, z) => (Math.abs(x - p.x) < 18 && Math.abs(z - (p.z + 2)) < 15) ? y0 + PL : null);
}

// ---------- Landmark: Adyanpara Waterfalls ----------
function makeRockMass(w, h, d, seed, wx, wz, groove) {
  const g = new THREE.BoxGeometry(w, h, d, Math.round(w * 0.7), Math.round(h * 0.7), Math.round(d * 0.6));
  const p = g.attributes.position;
  const front = d / 2;
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const yy = y + h / 2; // 0..h
    const w1 = smoothstep(0, 6, yy); // keep base anchored
    const nx = fbm(x * 0.09 + y * 0.05 + seed, z * 0.09, 3, seed) - 0.5;
    const nz = fbm(z * 0.09 + y * 0.06 + seed * 2, x * 0.08, 3, seed + 4) - 0.5;
    const ny = fbm(x * 0.12 + seed, z * 0.12 + y * 0.1, 3, seed + 8) - 0.5;
    let dz = nz * 9 * w1, dx = nx * 8 * w1;
    const dy = ny * 4 * w1;
    // tiered ledges
    dz += Math.sin(yy * 0.55 + seed) * 0.8 * w1;
    if (groove) {
      const gw = 1 - smoothstep(4.5, 8, Math.abs(x));
      if (z > front - 0.01) dz = dz * (1 - gw) - 3.2 * gw;
    }
    // taper toward the top
    const taper = 1 - 0.18 * (yy / h);
    p.setXYZ(i, x * taper + dx, y + dy, z + dz);
  }
  g.computeVertexNormals();
  // moss/rock vertex colours
  const nor = g.attributes.normal, cols = new Float32Array(p.count * 3);
  const rock = new THREE.Color(0x8a8378), dark = new THREE.Color(0x4c4a44), moss = new THREE.Color(0x4a6a2a), warm = new THREE.Color(0x8a6a4a);
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const n = fbm(p.getX(i) * 0.15 + seed, p.getY(i) * 0.15 + p.getZ(i) * 0.1, 3, 40);
    c.copy(rock).lerp(dark, smoothstep(0.35, 0.7, n) * 0.7).lerp(warm, smoothstep(0.55, 0.8, fbm(p.getX(i) * 0.05, p.getY(i) * 0.2, 2, 3)) * 0.4);
    const up = nor.getY(i);
    c.lerp(moss, smoothstep(0.35, 0.8, up) * 0.85);
    c.lerp(moss, smoothstep(0.55, 0.85, fbm(p.getX(i) * 0.2, p.getY(i) * 0.08 + p.getZ(i) * 0.2, 3, 31)) * 0.5);
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 5), uv.getY(i) * (h / 5));
  return g;
}

function buildAdyanparaWaterfall() {
  const g = new THREE.Group();
  const p = LANDMARKS.waterfall.pos;
  const y0 = LM_H.waterfall;
  g.position.set(p.x, y0, p.z);

  const H = 36;
  g.add(mk(makeRockMass(62, H, 24, 3, 0, 0, true), M.rock, 0, H / 2 - 1, 0));
  g.add(mk(makeRockMass(26, 27, 22, 8, 0, 0, false), M.rock, -40, 27 / 2 - 1, 3));
  g.add(mk(makeRockMass(28, 22, 20, 13, 0, 0, false), M.rock, 42, 22 / 2 - 1, 4));

  // Falling water: two layered scrolling streak sheets
  for (let i = 0; i < 2; i++) {
    const t = TEX.fall.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(i === 0 ? 1 : 1.6, i === 0 ? 1.4 : 2.2);
    const m = new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide, opacity: 0.92 - i * 0.2, color: 0xeaf6ff });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(i === 0 ? 9.5 : 11, H - 4.5, 1, 1), m);
    plane.position.set(0, (H - 4.5) / 2 + 1.2, 9.6 + i * 0.4);
    plane.rotation.x = -0.05;
    g.add(plane);
    ANIM.fallMats.push({ mat: m, tex: t, speed: 0.55 + i * 0.35 });
  }
  // Water spilling at the lip
  const lip = mk(new THREE.BoxGeometry(11, 0.5, 5), new THREE.MeshStandardMaterial({ color: 0x6a8a90, roughness: 0.2, metalness: 0.2 }), 0, H - 3.5, 8, false, true);
  lip.rotation.x = 0.25;
  g.add(lip);

  // Plunge pool
  const poolMat = new THREE.MeshStandardMaterial({ color: 0x2c6a66, roughness: 0.06, metalness: 0.1, normalMap: TEX.poolN, normalScale: new THREE.Vector2(0.6, 0.6), transparent: true, opacity: 0.88, envMapIntensity: 1.6 });
  const pool = mk(new THREE.CircleGeometry(9.6, 40), poolMat, 0, -0.55, 18.0, false, true);
  pool.rotation.x = -Math.PI / 2;
  g.add(pool);
  ANIM.pool = pool;
  // Foam patch where water lands
  const foamMat = new THREE.MeshBasicMaterial({ map: TEX.soft, transparent: true, opacity: 0.85, depthWrite: false, color: 0xffffff });
  const foam = mk(new THREE.PlaneGeometry(14, 8), foamMat, 0, -0.5, 13.2, false, false);
  foam.rotation.x = -Math.PI / 2;
  g.add(foam);

  // Mist cloud (particles)
  const N = 110;
  const mp = new Float32Array(N * 3), seeds = new Float32Array(N * 3);
  const rr = makeRng(6);
  for (let i = 0; i < N; i++) {
    seeds[i * 3] = rr(); seeds[i * 3 + 1] = rr(); seeds[i * 3 + 2] = rr();
  }
  const mg = new THREE.BufferGeometry();
  mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
  const mm = new THREE.PointsMaterial({ map: TEX.soft, size: 9, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false, color: 0xf4fbff });
  const mist = new THREE.Points(mg, mm);
  mist.frustumCulled = false;
  g.add(mist);
  ANIM.mist = { pts: mist, seeds: seeds, N: N };

  // Some teak trees standing on the clifftop
  const tr = makeRng(15);
  for (let i = 0; i < 12; i++) {
    EXTRA_TREES.push({ x: p.x + (tr() - 0.5) * 46, y: y0 + H - 3.4, z: p.z - 2 - tr() * 6, s: 0.55 + tr() * 0.3 });
  }

  // Signboard at viewpoint
  const sb = signBoard(['ADYANPARA FALLS', 'Nilambur - Malappuram'], { bw: 4.2, size: 42 });
  sb.position.set(16, 0.6, 30);
  sb.rotation.y = -0.4;
  g.add(sb);

  scene.add(g);
  addBoxCollider(p.x, p.z - 1, 31, 12);
  addBoxCollider(p.x - 40, p.z + 2, 12, 10);
  addBoxCollider(p.x + 42, p.z + 3, 13, 9);
}

// ---------- Landmark: Railway and Station ----------
function buildRailwayTrack() {
  const g = new THREE.Group();
  g.position.set(RAIL_X, RAIL_H, 0);
  const LEN = 520;

  // Ballast bed (trapezoid via scaled box + slanted sides)
  const bed = mk(texBox(5.6, 0.4, LEN, 2.5), M.gravel, 0, 0.0, 0, false, true);
  g.add(bed);
  const shoulders = [];
  for (const sx of [-1, 1]) {
    const sh = mk(texBox(1.6, 0.3, LEN, 2.5), M.gravel, sx * 3.1, -0.12, 0, false, true);
    sh.rotation.z = sx * 0.5;
    g.add(sh);
  }
  // Sleepers (instanced)
  const sleeperGeo = new THREE.BoxGeometry(2.7, 0.2, 0.32);
  const sM = [], sC = [];
  const col = new THREE.Color();
  const rng = makeRng(3);
  for (let z = -LEN / 2; z < LEN / 2; z += 0.68) {
    sM.push(mat(0, 0.28, z));
    col.setHSL(0.06, 0.05 + rng() * 0.05, 0.38 + rng() * 0.08);
    sC.push(col.clone());
  }
  g.add(makeInstanced(sleeperGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, map: TEX.plaster }), sM, sC, false));
  // Rails
  for (const sx of [-0.72, 0.72]) {
    g.add(mk(new THREE.BoxGeometry(0.16, 0.2, LEN), M.steel, sx, 0.48, 0, false, true));
    g.add(mk(new THREE.BoxGeometry(0.34, 0.06, LEN), M.steelDark, sx, 0.4, 0, false, true));
    g.add(mk(new THREE.BoxGeometry(0.11, 0.09, LEN), M.steel, sx, 0.62, 0, false, true));
  }

  // ---- Station ----
  const SZ = 70, PH = 0.95;
  // Platform
  g.add(mk(texBox(4.6, PH, 38, 3), M.stone, 4.7, PH / 2 - 0.05, SZ));
  g.add(mk(texBox(4.8, 0.12, 38.2, 3), M.plaster, 4.7, PH - 0.02, SZ, false, true));
  g.add(mk(new THREE.BoxGeometry(0.15, 0.03, 38), new THREE.MeshStandardMaterial({ color: 0xe8c020, roughness: 0.8 }), 2.55, PH + 0.06, SZ, false, true));

  // Station building behind the platform
  const bx = 11.8;
  g.add(mk(texBox(8.5, 0.5, 20, 3), M.stone, bx, 0.25, SZ));
  g.add(mk(texBox(8, 4.6, 19, 4), M.plaster, bx, 0.5 + 2.3, SZ));
  g.add(mk(texBox(8.2, 0.4, 19.2, 3), M.woodDark, bx, 0.5 + 4.65, SZ));
  const sr = makeGableRoof(19, 8, 3.2, 2.2, 1);
  const stRoof = mk(sr.roof, M.roof, bx, 0.5 + 4.85, SZ);
  stRoof.rotation.y = Math.PI / 2;
  const stGab = mk(sr.gable, M.plaster, bx, 0.5 + 4.85, SZ);
  stGab.rotation.y = Math.PI / 2;
  g.add(stRoof, stGab);
  for (const z of [SZ - 6, SZ - 2, SZ + 2, SZ + 6]) {
    g.add(mk(new THREE.BoxGeometry(0.2, 2.2, 1.5), M.glass, bx - 4.05, 2.4, z));
    g.add(mk(new THREE.BoxGeometry(0.3, 0.2, 1.9), M.woodDark, bx - 4.05, 3.6, z));
  }
  g.add(mk(new THREE.BoxGeometry(0.3, 3.2, 2), M.woodDark, bx - 4.05, 2.1, SZ));
  // Platform canopy on steel posts
  for (let z = SZ - 15; z <= SZ + 15; z += 5) {
    g.add(mk(new THREE.CylinderGeometry(0.1, 0.1, 4.2, 8), M.steelDark, 6.6, PH + 2.0, z));
  }
  const canopy = mk(texBox(4.6, 0.18, 34, 3), M.roof, 8.2, PH + 4.35, SZ);
  canopy.rotation.z = 0.09;
  g.add(canopy);
  // Name boards
  const nb = new THREE.MeshStandardMaterial({ map: signTexture(['NILAMBUR ROAD', 'NBR - Shoranur Nilambur Line'], { w: 768, h: 160, size: 58, bg: '#1e4c8a', fg: '#ffffff', border: '#ffffff' }), roughness: 0.6 });
  for (const z of [SZ - 10, SZ + 10]) {
    const b = mk(new THREE.BoxGeometry(5.5, 1.1, 0.12), nb, 6.55, PH + 3.4, z);
    b.rotation.y = Math.PI / 2;
    g.add(b);
  }
  // Benches
  for (const z of [SZ - 8, SZ, SZ + 8]) {
    g.add(mk(new THREE.BoxGeometry(0.6, 0.12, 2.2), M.woodDark, 7.6, PH + 0.5, z));
    g.add(mk(new THREE.BoxGeometry(0.1, 0.5, 2.2), M.woodDark, 7.9, PH + 0.75, z));
    g.add(mk(new THREE.BoxGeometry(0.5, 0.5, 0.1), M.steelDark, 7.6, PH + 0.25, z - 0.9));
    g.add(mk(new THREE.BoxGeometry(0.5, 0.5, 0.1), M.steelDark, 7.6, PH + 0.25, z + 0.9));
  }
  // Signal post
  g.add(mk(new THREE.CylinderGeometry(0.1, 0.13, 6, 8), M.steelDark, -3.8, 3, SZ - 25));
  g.add(mk(new THREE.BoxGeometry(0.5, 1.3, 0.4), M.steelDark, -3.8, 5.8, SZ - 25));
  g.add(mk(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshStandardMaterial({ color: 0x00e060, emissive: 0x00c040, emissiveIntensity: 1.2 }), -3.8, 6.05, SZ - 24.75, false));
  g.add(mk(new THREE.SphereGeometry(0.18, 8, 8), new THREE.MeshStandardMaterial({ color: 0xff2020, emissive: 0xc01010, emissiveIntensity: 0.6 }), -3.8, 5.55, SZ - 24.75, false));
  // Platform lamps
  for (const z of [SZ - 12, SZ, SZ + 12]) {
    g.add(mk(new THREE.SphereGeometry(0.22, 8, 8), M.lampGlow, 6.4, PH + 3.9, z, false));
  }
  const stl = new THREE.PointLight(0xffd090, 0, 34, 1.6);
  stl.position.set(6.4, PH + 3.4, SZ);
  g.add(stl);
  ANIM.nightLights.push(stl);

  // ---- Train (loops along the line) ----
  const train = new THREE.Group();
  const bodyM = new THREE.MeshStandardMaterial({ color: 0x1e3f7a, roughness: 0.45, metalness: 0.3 });
  const loco = new THREE.Group();
  loco.add(mk(new THREE.BoxGeometry(3.1, 3.5, 13), bodyM, 0, 2.55, 0));
  loco.add(mk(new THREE.BoxGeometry(3.15, 0.9, 13.05), new THREE.MeshStandardMaterial({ color: 0xe8d040, roughness: 0.5 }), 0, 1.35, 0));
  loco.add(mk(new THREE.BoxGeometry(2.4, 1.2, 0.2), M.glass, 0, 3.4, -6.5));
  loco.add(mk(new THREE.SphereGeometry(0.22, 8, 8), M.lampGlow, 0.7, 1.8, -6.55, false));
  loco.add(mk(new THREE.SphereGeometry(0.22, 8, 8), M.lampGlow, -0.7, 1.8, -6.55, false));
  train.add(loco);
  const coachMats = [null, null, TEX.coach, TEX.coach];
  for (let i = 0; i < 4; i++) {
    const cm = new THREE.MeshStandardMaterial({ color: 0x2b4d8a, roughness: 0.5, metalness: 0.2 });
    const wm = new THREE.MeshStandardMaterial({ map: TEX.coach, roughness: 0.5, metalness: 0.2 });
    const body = mk(new THREE.BoxGeometry(3.0, 3.5, 17), [wm, wm, cm, cm, cm, cm], 0, 2.6, 15.5 + i * 18);
    train.add(body);
  }
  // Bogies (wheels as dark blocks)
  for (let i = 0; i < 5; i++) {
    for (const zz of [-4, 4]) train.add(mk(new THREE.BoxGeometry(2.4, 0.7, 2.6), M.steelDark, 0, 0.75, (i === 0 ? 0 : 15.5 + (i - 1) * 18) + zz));
  }
  train.position.set(0, 0.5, -300);
  g.add(train);
  ANIM.train = train;

  scene.add(g);
  addBoxCollider(RAIL_X + bx, SZ, 4.2, 9.7);
  GROUND_EXTRAS.push((x, z) => (Math.abs(x - (RAIL_X + 4.7)) < 2.4 && Math.abs(z - SZ) < 19) ? RAIL_H + PH : null);
}
