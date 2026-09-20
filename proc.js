/**
 * proc.js - procedural noise, canvas textures and geometry helpers for NilamburWorld.
 * Everything is generated at load time; no external image assets are required.
 */

let MAX_ANISO = 8;
const windUniform = { value: 0 };

// ---------- Seeded random + value noise ----------
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, s) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul((s | 0) + 1, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s);
  const c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function fbm(x, y, oct, s) {
  let amp = 0.5, f = 1, sum = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(x * f, y * f, (s || 0) + i * 7);
    f *= 2; amp *= 0.5;
  }
  return sum; // roughly 0..0.94
}

// Periodic (tileable) value noise: px,py are the lattice periods
function pnoise(x, y, px, py, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const wx0 = ((xi % px) + px) % px, wx1 = (wx0 + 1) % px;
  const wy0 = ((yi % py) + py) % py, wy1 = (wy0 + 1) % py;
  const a = hash2(wx0, wy0, s), b = hash2(wx1, wy0, s);
  const c = hash2(wx0, wy1, s), d = hash2(wx1, wy1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Tileable fbm: u,v in 0..1, base lattice frequency fx,fy
function tfbm(u, v, fx, fy, oct, s) {
  let amp = 0.5, sum = 0, tot = 0;
  for (let i = 0; i < oct; i++) {
    const px = fx << i, py = fy << i;
    sum += amp * pnoise(u * px, v * py, px, py, (s || 0) + i * 13);
    tot += amp; amp *= 0.5;
  }
  return sum / tot; // 0..1
}

const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

// ---------- Canvas helpers ----------
function mkCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function canvasTex(canvas, opts) {
  opts = opts || {};
  const t = new THREE.CanvasTexture(canvas);
  if (opts.wrap !== false) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  if (opts.srgb !== false) t.encoding = THREE.sRGBEncoding;
  t.anisotropy = MAX_ANISO;
  t.needsUpdate = true;
  return t;
}

// fn(u, v, out): writes out[0..3] as 0..255 (alpha optional)
function paintPixels(w, h, fn) {
  const c = mkCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[3] = 255;
      fn(x / w, y / h, out);
      const i = (y * w + x) * 4;
      d[i] = out[0]; d[i + 1] = out[1]; d[i + 2] = out[2]; d[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function heightField(w, h, fn) {
  const a = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a[y * w + x] = fn(x / w, y / h);
  return { data: a, w: w, h: h };
}

// Height field -> tangent-space normal map canvas (wraps at edges so tiling is seamless)
function normalMapFromHeight(hf, strength) {
  const w = hf.w, h = hf.h, a = hf.data;
  const c = mkCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const xl = (x + w - 1) % w, xr = (x + 1) % w, yu = (y + h - 1) % h, yd = (y + 1) % h;
      const dx = (a[y * w + xr] - a[y * w + xl]) * strength;
      const dy = (a[yd * w + x] - a[yu * w + x]) * strength;
      let nx = -dx, ny = dy, nz = 1;
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * w + x) * 4;
      d[i] = (nx / l * 0.5 + 0.5) * 255;
      d[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      d[i + 2] = (nz / l * 0.5 + 0.5) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function mixRGB(c1, c2, t) {
  return [c1[0] + (c2[0] - c1[0]) * t, c1[1] + (c2[1] - c1[1]) * t, c1[2] + (c2[2] - c1[2]) * t];
}

// ---------- Texture library ----------
const TEX = {};

function buildTextures() {
  // 1. Grass / ground detail (near-neutral so vertex colours drive hue)
  {
    const S = 512;
    const hf = heightField(S, S, (u, v) => tfbm(u, v, 24, 24, 3, 3) * 0.6 + tfbm(u, v, 6, 6, 3, 9) * 0.4);
    const c = paintPixels(S, S, (u, v, o) => {
      const n = tfbm(u, v, 5, 5, 4, 1);
      const f = tfbm(u, v, 48, 48, 2, 5);
      const val = 150 + n * 90 + (f - 0.5) * 70;
      o[0] = val * 0.98; o[1] = val; o[2] = val * 0.9;
    });
    const ctx = c.getContext('2d');
    const rng = makeRng(11);
    for (let i = 0; i < 2600; i++) {
      const x = rng() * S, y = rng() * S, l = 4 + rng() * 9;
      ctx.strokeStyle = rng() < 0.5 ? 'rgba(255,255,230,0.10)' : 'rgba(30,50,20,0.16)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 3, y - l); ctx.stroke();
    }
    TEX.ground = canvasTex(c, { repeat: [120, 120] });
    TEX.groundN = canvasTex(normalMapFromHeight(hf, 2.2), { repeat: [120, 120], srgb: false });
  }

  // 2. Bark (teak / palm)
  {
    const W = 256, H = 512;
    const hf = heightField(W, H, (u, v) => {
      const n = tfbm(u, v, 12, 3, 4, 21);
      const ridge = 1 - Math.abs(n * 2 - 1);
      return ridge * 0.8 + tfbm(u, v, 40, 10, 2, 5) * 0.2;
    });
    const c = paintPixels(W, H, (u, v, o) => {
      const h = hf.data[Math.floor(v * H) * W + Math.floor(u * W)];
      const col = mixRGB([54, 40, 30], [138, 112, 88], h);
      const m = tfbm(u, v, 4, 2, 3, 40);
      o[0] = col[0] * (0.8 + m * 0.4); o[1] = col[1] * (0.8 + m * 0.4); o[2] = col[2] * (0.8 + m * 0.4);
    });
    TEX.bark = canvasTex(c);
    TEX.barkN = canvasTex(normalMapFromHeight(hf, 5), { srgb: false });
  }

  // 3. Water normal map (tileable)
  {
    const S = 512;
    const hf = heightField(S, S, (u, v) => {
      return tfbm(u, v, 6, 6, 5, 71) * 0.7 + Math.sin(u * 6.2832 * 6 + tfbm(u, v, 4, 4, 2, 3) * 6) * 0.05 + tfbm(u, v, 24, 24, 2, 8) * 0.25;
    });
    TEX.waterN = canvasTex(normalMapFromHeight(hf, 6), { srgb: false });
    TEX.waterN.repeat.set(1, 1);
    TEX.poolN = canvasTex(normalMapFromHeight(hf, 3.5), { repeat: [4, 4], srgb: false });
  }

  // 4. Rock
  {
    const S = 512;
    const hf = heightField(S, S, (u, v) => {
      const n = tfbm(u, v, 5, 5, 5, 91);
      const cr = 1 - Math.abs(tfbm(u, v, 9, 9, 3, 15) * 2 - 1);
      return n * 0.65 + Math.pow(cr, 3) * 0.35;
    });
    const c = paintPixels(S, S, (u, v, o) => {
      const h = hf.data[Math.floor(v * S) * S + Math.floor(u * S)];
      const t = tfbm(u, v, 3, 3, 3, 33);
      const col = mixRGB([70, 66, 62], [160, 152, 140], h);
      const warm = mixRGB(col, [128, 106, 84], t * 0.35);
      o[0] = warm[0]; o[1] = warm[1]; o[2] = warm[2];
    });
    TEX.rock = canvasTex(c);
    TEX.rockN = canvasTex(normalMapFromHeight(hf, 7), { srgb: false });
  }

  // 5. Wood planks (horizontal boards)
  {
    const W = 512, H = 512, planks = 8;
    const hf = heightField(W, H, (u, v) => {
      const row = Math.floor(v * planks);
      const fv = v * planks - row;
      const gap = Math.min(smoothstep(0, 0.06, fv), smoothstep(1, 0.94, fv));
      const grain = tfbm(u + hash2(row, 0, 5), v, 3, 60, 3, 50 + row);
      return gap * (0.6 + grain * 0.4);
    });
    const c = paintPixels(W, H, (u, v, o) => {
      const row = Math.floor(v * planks);
      const g = tfbm(fract1(u + hash2(row, 1, 3)), v, 2, 90, 3, 60 + row);
      const tone = 0.75 + hash2(row, 2, 4) * 0.5;
      const h = hf.data[Math.floor(v * H) * W + Math.floor(u * W)];
      const col = mixRGB([88, 52, 24], [156, 100, 54], g);
      o[0] = col[0] * tone * (0.35 + h * 0.65);
      o[1] = col[1] * tone * (0.35 + h * 0.65);
      o[2] = col[2] * tone * (0.35 + h * 0.65);
    });
    TEX.wood = canvasTex(c);
    TEX.woodN = canvasTex(normalMapFromHeight(hf, 4), { srgb: false });
  }

  // 6. Terracotta roof tiles
  {
    const W = 512, H = 512, cols = 12, rows = 16;
    const hf = heightField(W, H, (u, v) => {
      const r = Math.floor(v * rows);
      const off = (r % 2) * 0.5;
      const fu = (u * cols + off) % 1;
      const fv = (v * rows) % 1;
      const ridge = Math.sin(fu * Math.PI);
      const lip = smoothstep(0.0, 0.25, fv) * (1 - smoothstep(0.85, 1.0, fv) * 0.0);
      return ridge * 0.6 + fv * 0.4 * lip;
    });
    const c = paintPixels(W, H, (u, v, o) => {
      const r = Math.floor(v * rows);
      const off = (r % 2) * 0.5;
      const ci = Math.floor(u * cols + off);
      const tone = hash2(ci, r, 77);
      const fv = (v * rows) % 1;
      const h = hf.data[Math.floor(v * H) * W + Math.floor(u * W)];
      const moss = tfbm(u, v, 8, 8, 3, 66);
      let col = mixRGB([150, 58, 34], [196, 96, 58], tone * 0.8 + h * 0.3);
      col = mixRGB(col, [70, 84, 46], Math.max(0, moss - 0.62) * 1.6);
      const shade = 0.55 + h * 0.5 - (fv > 0.85 ? 0.25 : 0);
      o[0] = col[0] * shade; o[1] = col[1] * shade; o[2] = col[2] * shade;
    });
    TEX.roof = canvasTex(c);
    TEX.roofN = canvasTex(normalMapFromHeight(hf, 5), { srgb: false });
  }

  // 7. Whitewashed plaster with weathering
  {
    const S = 512;
    const hf = heightField(S, S, (u, v) => tfbm(u, v, 20, 20, 3, 44));
    const c = paintPixels(S, S, (u, v, o) => {
      const n = tfbm(u, v, 4, 4, 4, 12);
      const stain = Math.max(0, tfbm(u, v * 0.4, 6, 2, 3, 19) - 0.55) * 2.2;
      let col = mixRGB([236, 228, 208], [206, 196, 172], n);
      col = mixRGB(col, [110, 108, 80], stain * 0.5);
      o[0] = col[0]; o[1] = col[1]; o[2] = col[2];
    });
    TEX.plaster = canvasTex(c);
    TEX.plasterN = canvasTex(normalMapFromHeight(hf, 1.4), { srgb: false });
  }

  // 8. Gravel ballast
  {
    const S = 256;
    const hf = heightField(S, S, (u, v) => tfbm(u, v, 40, 40, 3, 5));
    const c = paintPixels(S, S, (u, v, o) => {
      const h = hf.data[Math.floor(v * S) * S + Math.floor(u * S)];
      const s = 70 + h * 120 + hash2(Math.floor(u * S), Math.floor(v * S), 3) * 30;
      o[0] = s; o[1] = s * 0.97; o[2] = s * 0.92;
    });
    TEX.gravel = canvasTex(c);
    TEX.gravelN = canvasTex(normalMapFromHeight(hf, 5), { srgb: false });
  }

  // 9. Leaf cluster (alpha) - teak-like large leaves. Bottom-right corner is a solid fill patch.
  {
    const S = 512;
    const c = mkCanvas(S, S);
    const g = c.getContext('2d');
    const rng = makeRng(5);
    for (let i = 0; i < 90; i++) {
      const x = 30 + rng() * (S - 60), y = 30 + rng() * (S - 60);
      const ang = rng() * Math.PI * 2, len = 34 + rng() * 34, wid = len * (0.36 + rng() * 0.12);
      const tone = rng();
      const r = 30 + tone * 40, gr = 90 + tone * 70, b = 25 + tone * 25;
      g.save();
      g.translate(x, y); g.rotate(ang);
      g.fillStyle = `rgb(${r | 0},${gr | 0},${b | 0})`;
      g.beginPath();
      g.moveTo(-len / 2, 0);
      g.quadraticCurveTo(0, -wid, len / 2, 0);
      g.quadraticCurveTo(0, wid, -len / 2, 0);
      g.fill();
      g.strokeStyle = `rgba(${r + 40 | 0},${gr + 40 | 0},${b + 20 | 0},0.7)`;
      g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(-len / 2, 0); g.lineTo(len / 2, 0); g.stroke();
      g.restore();
    }
    g.fillStyle = 'rgb(28,64,24)';
    g.fillRect(S - 16, S - 16, 16, 16);
    TEX.leaf = canvasTex(c, { wrap: false });
  }

  // 10. Palm frond (alpha) - u along frond, v across; feathered leaflets
  {
    const W = 512, H = 128;
    const c = mkCanvas(W, H);
    const g = c.getContext('2d');
    g.strokeStyle = '#3f6a1c'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    for (let i = 0; i < 44; i++) {
      const x = 8 + i * (W - 20) / 44;
      const len = (H / 2 - 2) * (1 - Math.pow(i / 44, 2.4) * 0.8);
      for (const dir of [-1, 1]) {
        g.fillStyle = i % 2 ? '#4f8624' : '#3f7020';
        g.beginPath();
        g.moveTo(x, H / 2);
        g.quadraticCurveTo(x + 6, H / 2 + dir * len * 0.7, x + 26, H / 2 + dir * len);
        g.quadraticCurveTo(x + 18, H / 2 + dir * len * 0.4, x + 13, H / 2);
        g.fill();
      }
    }
    TEX.frond = canvasTex(c, { wrap: false });
  }

  // 11. Banana leaf (alpha)
  {
    const W = 512, H = 256;
    const c = mkCanvas(W, H);
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, W, 0);
    grd.addColorStop(0, '#356d1c'); grd.addColorStop(1, '#6aa632');
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(0, H / 2);
    g.bezierCurveTo(W * 0.2, 0, W * 0.75, 6, W, H / 2);
    g.bezierCurveTo(W * 0.75, H - 6, W * 0.2, H, 0, H / 2);
    g.fill();
    g.strokeStyle = 'rgba(200,230,140,0.75)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
    g.lineWidth = 1;
    g.strokeStyle = 'rgba(30,70,15,0.45)';
    for (let i = 0; i < 46; i++) {
      const x = 20 + i * 10.4;
      const edge = Math.sin((x / W) * Math.PI) * H * 0.46;
      g.beginPath(); g.moveTo(x, H / 2); g.lineTo(x + 26, H / 2 - edge); g.moveTo(x, H / 2); g.lineTo(x + 26, H / 2 + edge); g.stroke();
    }
    TEX.banana = canvasTex(c, { wrap: false });
  }

  // 12. Grass tuft (alpha)
  {
    const W = 256, H = 256;
    const c = mkCanvas(W, H);
    const g = c.getContext('2d');
    const rng = makeRng(8);
    for (let i = 0; i < 34; i++) {
      const bx = 20 + rng() * (W - 40);
      const tipx = bx + (rng() - 0.5) * 90;
      const top = 10 + rng() * 110;
      const wdt = 4 + rng() * 5;
      const grd = g.createLinearGradient(0, H, 0, top);
      grd.addColorStop(0, '#1d3d14');
      grd.addColorStop(0.5, rng() < 0.5 ? '#4d8a2a' : '#5f9a30');
      grd.addColorStop(1, rng() < 0.2 ? '#b8c25a' : '#8fbf49');
      g.fillStyle = grd;
      g.beginPath();
      g.moveTo(bx - wdt, H);
      g.quadraticCurveTo(bx - wdt * 0.3, H * 0.5, tipx, top);
      g.quadraticCurveTo(bx + wdt * 0.3, H * 0.5, bx + wdt, H);
      g.fill();
    }
    TEX.grass = canvasTex(c, { wrap: false });
  }

  // 13. Soft radial (mist, glow, cloud puffs)
  {
    const S = 128;
    const c = mkCanvas(S, S);
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grd.addColorStop(0, 'rgba(255,255,255,1)');
    grd.addColorStop(0.4, 'rgba(255,255,255,0.45)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, S, S);
    TEX.soft = canvasTex(c, { wrap: false });
  }
  {
    const W = 512, H = 256;
    const c = paintPixels(W, H, (u, v, o) => {
      const dx = (u - 0.5) * 2, dy = (v - 0.5) * 2.4;
      const r = Math.sqrt(dx * dx + dy * dy);
      const n = fbm(u * 6, v * 5, 4, 12);
      const a = clamp((1 - r) * 1.4 + (n - 0.5) * 1.3, 0, 1);
      o[0] = 255; o[1] = 255; o[2] = 255; o[3] = a * a * 255;
    });
    TEX.cloud = canvasTex(c, { wrap: false });
  }

  // 14. Waterfall streaks (alpha), vertical, tileable
  {
    const W = 128, H = 512;
    const c = paintPixels(W, H, (u, v, o) => {
      const n = tfbm(u, v, 10, 3, 3, 4);
      const n2 = tfbm(u, v, 22, 6, 2, 9);
      const a = clamp((n * 0.6 + n2 * 0.6 - 0.28) * 2.2, 0, 1);
      const edge = Math.sin(u * Math.PI);
      o[0] = 225 + a * 30; o[1] = 240 + a * 15; o[2] = 250; o[3] = a * 255 * Math.min(1, edge * 2.2);
    });
    TEX.fall = canvasTex(c, { repeat: [1, 1] });
  }

  // 15. Steel-mesh / lattice fence (alpha)
  {
    const S = 128;
    const c = mkCanvas(S, S);
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(70,74,78,1)'; g.lineWidth = 4;
    for (let i = -S; i < S * 2; i += 32) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + S, S); g.stroke();
      g.beginPath(); g.moveTo(i, S); g.lineTo(i + S, 0); g.stroke();
    }
    TEX.lattice = canvasTex(c);
  }

  // 16. Teak log end-grain
  {
    const S = 256;
    const c = paintPixels(S, S, (u, v, o) => {
      const dx = u - 0.5, dy = v - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy);
      const rings = 0.5 + 0.5 * Math.sin(r * 90 + fbm(u * 8, v * 8, 3, 2) * 6);
      const col = mixRGB([120, 74, 36], [186, 128, 68], rings);
      o[0] = col[0]; o[1] = col[1]; o[2] = col[2];
    });
    TEX.endgrain = canvasTex(c, { wrap: false });
  }

  // 17. Train coach windows
  {
    const W = 512, H = 128;
    const c = mkCanvas(W, H);
    const g = c.getContext('2d');
    g.fillStyle = '#2b4d8a'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#e8ecef'; g.fillRect(0, H * 0.62, W, H * 0.06);
    g.fillStyle = '#1b2430';
    for (let i = 0; i < 12; i++) g.fillRect(14 + i * 41, 22, 30, 40);
    TEX.coach = canvasTex(c, { wrap: false });
  }

  // 18. Vertical gradient for overcast dome
  {
    const c = mkCanvas(4, 256);
    const g = c.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#5a646c');
    grd.addColorStop(0.5, '#8a959c');
    grd.addColorStop(1, '#c0c8cc');
    g.fillStyle = grd; g.fillRect(0, 0, 4, 256);
    TEX.overcast = canvasTex(c, { wrap: false });
  }
}

function fract1(x) { return x - Math.floor(x); }

function signTexture(lines, opts) {
  opts = opts || {};
  const W = opts.w || 512, H = opts.h || 160;
  const c = mkCanvas(W, H);
  const g = c.getContext('2d');
  g.fillStyle = opts.bg || '#3a2412'; g.fillRect(0, 0, W, H);
  g.strokeStyle = opts.border || '#d9b26a'; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16);
  g.fillStyle = opts.fg || '#f3dfa8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const n = lines.length;
  lines.forEach((ln, i) => {
    const size = i === 0 ? (opts.size || 52) : 26;
    g.font = `bold ${size}px Georgia, serif`;
    g.fillText(ln, W / 2, H * (i + 1) / (n + 1) + (i === 0 && n > 1 ? -4 : 6));
  });
  return canvasTex(c, { wrap: false });
}

// ---------- Geometry helpers ----------
// Merge [{geo, matrix?, color?}] into a single non-indexed BufferGeometry.
function mergeGeos(list) {
  let total = 0;
  const parts = list.map(it => {
    let g = it.geo.index ? it.geo.toNonIndexed() : it.geo.clone();
    if (it.matrix) g.applyMatrix4(it.matrix);
    total += g.attributes.position.count;
    return { g, color: it.color };
  });
  const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3), uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);
  let hasColor = false, o = 0;
  parts.forEach(p => {
    const n = p.g.attributes.position.count;
    pos.set(p.g.attributes.position.array, o * 3);
    if (p.g.attributes.normal) nor.set(p.g.attributes.normal.array, o * 3);
    if (p.g.attributes.uv) uv.set(p.g.attributes.uv.array, o * 2);
    if (p.color) {
      hasColor = true;
      for (let i = 0; i < n; i++) { col[(o + i) * 3] = p.color.r; col[(o + i) * 3 + 1] = p.color.g; col[(o + i) * 3 + 2] = p.color.b; }
    } else {
      for (let i = 0; i < n * 3; i++) col[o * 3 + i] = 1;
    }
    o += n;
  });
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (hasColor) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return out;
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
function mat(px, py, pz, rx, ry, rz, sx, sy, sz) {
  _e.set(rx || 0, ry || 0, rz || 0);
  _q.setFromEuler(_e);
  _v3.set(px || 0, py || 0, pz || 0);
  _s3.set(sx === undefined ? 1 : sx, sy === undefined ? (sx === undefined ? 1 : sx) : sy, sz === undefined ? (sx === undefined ? 1 : sx) : sz);
  return new THREE.Matrix4().compose(_v3, _q, _s3);
}

// Leaf-card canopy: N double-sided cards around a centre with outward normals and a solid inner blob.
function makeCanopyGeometry(radius, cards, cardSize, seed, flatten) {
  const rng = makeRng(seed);
  const parts = [];
  for (let i = 0; i < cards; i++) {
    const th = rng() * Math.PI * 2, ph = Math.acos(1 - rng() * 1.6);
    const rr = radius * (0.45 + rng() * 0.6);
    const px = Math.sin(ph) * Math.cos(th) * rr, py = Math.cos(ph) * rr * (flatten || 0.7), pz = Math.sin(ph) * Math.sin(th) * rr;
    const sz = cardSize * (0.75 + rng() * 0.5);
    parts.push({ geo: new THREE.PlaneGeometry(sz, sz), matrix: mat(px, py, pz, rng() * 6.28, rng() * 6.28, rng() * 6.28) });
  }
  const g = mergeGeos(parts);
  // Solid inner blob mapped to the opaque patch of the leaf texture
  const blob = new THREE.IcosahedronGeometry(radius * 0.62, 1);
  blob.scale(1, flatten || 0.7, 1);
  const bg = blob.index ? blob.toNonIndexed() : blob;
  const bn = bg.attributes.position.count;
  const buv = new Float32Array(bn * 2);
  for (let i = 0; i < bn; i++) { buv[i * 2] = 0.985; buv[i * 2 + 1] = 0.015; }
  bg.setAttribute('uv', new THREE.BufferAttribute(buv, 2));
  const merged = mergeGeos([{ geo: g }, { geo: bg }]);
  // Outward radial normals (blended with up) for soft blob-like shading
  const p = merged.attributes.position, n = merged.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    _v3.set(p.getX(i), p.getY(i) / (flatten || 0.7), p.getZ(i)).normalize();
    _v3.y = _v3.y * 0.8 + 0.25;
    _v3.normalize();
    n.setXYZ(i, _v3.x, _v3.y, _v3.z);
  }
  return merged;
}

// Gable roof prism: ridge along X. returns {roof, gable} geometries; base at y=0.
function makeGableRoof(w, d, h, overhang, uvScale) {
  const hw = w / 2 + overhang, hd = d / 2 + overhang;
  const slope = Math.sqrt(hd * hd + h * h);
  const u = (uvScale || 1);
  const pos = [], uv = [], idx = [];
  // Front slope (z+) and back slope (z-)
  function quad(a, b, c, dd, uu, vv) {
    const i = pos.length / 3;
    pos.push(...a, ...b, ...c, ...dd);
    uv.push(0, 0, uu, 0, uu, vv, 0, vv);
    idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  quad([-hw, 0, hd], [hw, 0, hd], [hw, h, 0], [-hw, h, 0], (hw * 2) / 6 * u, slope / 6 * u);
  quad([hw, 0, -hd], [-hw, 0, -hd], [-hw, h, 0], [hw, h, 0], (hw * 2) / 6 * u, slope / 6 * u);
  // Underside so it is visible from below
  quad([hw, 0, hd], [-hw, 0, hd], [-hw, 0, -hd], [hw, 0, -hd], 1, 1);
  const roof = new THREE.BufferGeometry();
  roof.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roof.setIndex(idx);
  roof.computeVertexNormals();
  // Gable end triangles (at x = +-w/2, inset by 0)
  const gx = w / 2;
  const g2 = new THREE.BufferGeometry();
  const gp2 = [
    gx, 0, d / 2, gx, 0, -d / 2, gx, h, 0,
    -gx, 0, -d / 2, -gx, 0, d / 2, -gx, h, 0
  ];
  g2.setAttribute('position', new THREE.Float32BufferAttribute(gp2, 3));
  g2.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1, 0, 0, 1, 0, 0.5, 1], 2));
  g2.computeVertexNormals();
  return { roof: roof, gable: g2 };
}

// Ribbon between two polylines (arrays of Vector3), repeated uv along length
function makeRibbon(a, b, uRepeat, vRepeat) {
  const pos = [], uv = [], idx = [];
  let len = 0;
  for (let i = 0; i < a.length; i++) {
    if (i > 0) len += a[i].distanceTo(a[i - 1]);
    pos.push(a[i].x, a[i].y, a[i].z, b[i].x, b[i].y, b[i].z);
    uv.push(len / uRepeat, 0, len / uRepeat, vRepeat);
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Wind sway injected into MeshStandardMaterial vertex shader
function addWind(material, amp, freq, heightRef) {
  material.customProgramCacheKey = function () { return 'wind' + amp + '_' + freq + '_' + heightRef; };
  material.onBeforeCompile = function (shader) {
    shader.uniforms.uTime = windUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 iw = vec3(0.0);
          #ifdef USE_INSTANCING
            iw = instanceMatrix[3].xyz;
          #endif
          float ph = iw.x * 0.11 + iw.z * 0.17;
          float hh = clamp(position.y / ${heightRef.toFixed(2)}, 0.0, 2.0);
          float sw = (sin(uTime * ${freq.toFixed(2)} + ph + position.x * 0.4) + 0.5 * sin(uTime * ${(freq * 2.3).toFixed(2)} + ph * 1.7 + position.z * 0.5)) * ${amp.toFixed(3)} * hh * hh;
          transformed.x += sw;
          transformed.z += sw * 0.6;
        }`);
  };
  return material;
}
