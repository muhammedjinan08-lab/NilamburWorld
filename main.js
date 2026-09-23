/**
 * main.js — NilamburWorld 3D Engine & Application Logic
 * Powered by Three.js (r149) & Web Audio API.
 * World content lives in world.js, procedural textures/helpers in proc.js.
 */

// Global State
const state = {
  score: 0,
  currentWeather: 'sunny',
  timeOfDay: 12, // 0 to 24 hours
  isCameraOrbit: true,
  audioMuted: true,
  discoveredLocations: new Set(),
  playerPos: { x: 30, y: 3, z: 14 },
  playerVelocity: { x: 0, y: 0, z: 0 },
  isGrounded: true,
  driving: null,        // the VEHICLES entry currently being driven, or null
  ridingTrain: false
};

// Landmarks Data
const LANDMARKS = {
  conolly: {
    name: "Conolly's Plot Teak Grove",
    desc: "World's oldest teak plantation planted in 1840s by H.M. Conolly.",
    pos: { x: -40, z: -50 },
    radius: 25,
    questId: "quest_conolly"
  },
  bridge: {
    name: "Canoly Suspension Bridge",
    desc: "Famous hanging bridge spanning across the Chaliyar River.",
    pos: { x: 0, z: 0 },
    radius: 20,
    questId: "quest_bridge"
  },
  museum: {
    name: "Nilambur Teak Museum",
    desc: "World's first teak museum showcasing historical wood craftsmanship.",
    pos: { x: 80, z: -60 },
    radius: 30,
    questId: "quest_museum"
  },
  waterfall: {
    name: "Adyanpara Waterfalls",
    desc: "Picturesque natural waterfall cascading down Nilambur forest rocks.",
    pos: { x: -100, z: -120 },
    radius: 30,
    questId: "quest_waterfall"
  },
  palace: {
    name: "Nilambur Kovilakam Palace",
    desc: "Traditional Kerala royal heritage manor of the Nilambur Rajahs.",
    pos: { x: 90, z: 80 },
    radius: 30,
    questId: "quest_palace"
  },
  railway: {
    name: "Nilambur Railway Track",
    desc: "Scenic green forest train line connecting Shoranur to Nilambur Road.",
    pos: { x: -70, z: 70 },
    radius: 25,
    questId: "quest_railway"
  },
  town: {
    name: "Nilambur Town Bazaar",
    desc: "Bustling town centre with textile, gold, bakery and hardware shops, a clock tower and busy traffic.",
    pos: { x: 740, z: 0 },
    radius: 42,
    questId: "quest_town"
  },
  busstation: {
    name: "Nilambur KSRTC Bus Station",
    desc: "The town's bus depot: long-distance buses to Manjeri, Kozhikode, Ooty and Gudalur.",
    pos: { x: 777, z: 55 },
    radius: 24,
    questId: "quest_bus"
  },
  market: {
    name: "Nilambur Fish & Vegetable Market",
    desc: "Covered market hall with fresh fish, vegetables and spices, plus the fuel station next door.",
    pos: { x: 777, z: -62 },
    radius: 22,
    questId: "quest_market"
  },
  temple: {
    name: "Sree Nilambur Temple",
    desc: "Traditional Kerala temple beside the main street, with a lamp pillar and flag mast.",
    pos: { x: 757, z: -100 },
    radius: 20,
    questId: "quest_temple"
  }
};

// Where fast travel drops the player relative to each landmark centre
const TELEPORT = {
  conolly: { dx: 0, dz: 16 },
  bridge: { dx: 0, dz: 0 },
  museum: { dx: 0, dz: 26 },
  waterfall: { dx: 14, dz: 26 },
  palace: { dx: 0, dz: 26 },
  railway: { dx: 4.7, dz: 6 },
  town: { dx: -6, dz: 4 },
  busstation: { dx: 0, dz: -15 },
  market: { dx: -18, dz: 0 },
  temple: { dx: -14, dz: 0 }
};

// Quests Data
const QUESTS = [
  { id: "quest_conolly", title: "The Teak Heritage", desc: "Locate Conolly's Plot and inspect the 180yo teak tree.", score: 250, done: false },
  { id: "quest_bridge", title: "Cross the Chaliyar", desc: "Walk across Canoly Hanging Suspension Bridge.", score: 150, done: false },
  { id: "quest_museum", title: "Teak Scholar", desc: "Visit Nilambur Teak Museum.", score: 200, done: false },
  { id: "quest_waterfall", title: "Adyanpara Cascade", desc: "Reach Adyanpara Waterfall in the rainforest.", score: 300, done: false },
  { id: "quest_palace", title: "Royal Heritage", desc: "Explore Nilambur Kovilakam Palace.", score: 200, done: false },
  { id: "quest_town", title: "Town Explorer", desc: "Walk the Nilambur bazaar past the clock tower and shops.", score: 200, done: false },
  { id: "quest_bus", title: "All Aboard", desc: "Visit the KSRTC bus station.", score: 150, done: false },
  { id: "quest_market", title: "Market Day", desc: "Browse the fish & vegetable market.", score: 150, done: false },
  { id: "quest_temple", title: "Temple Visit", desc: "Reach the temple at the end of the main street.", score: 150, done: false }
];

// Three.js Core Variables
let scene, camera, renderer, sunLight, ambientLight, skyDome;
let playerMesh, waterMesh, rainParticles;
let landmarkObjects = {};
const keyState = {};

// Extra runtime objects
let skyEnv, envScene, pmrem, envRT = null, lastEnvUpdate = 0, lastEnvSun = new THREE.Vector3(9, 9, 9), lastEnvRain = -1;
let cloudGroup, starPoints, moonSprite, cloudDome, birdGroup, fireflies, rainLines, splashPoints;
let worldReady = false;
let playerRig = null;
const camRig = { yaw: 0.35, pitch: 0.32, dist: 16, distTarget: 16, idleTime: 0, dragging: false };
const env = { rain: 0, rainTarget: 0, day: 1, night: 0, sunDir: new THREE.Vector3(0, 1, 0), fog: new THREE.Color(), light: 1 };
const clock = { last: performance.now(), t: 0 };
let baseRatio = 1, perf = { frames: 0, acc: 0 };

// --- Small colour helper: raw display-space RGB (fog is blended after output encoding in r149) ---
function rawColor(target, hex) {
  target.setRGB(((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255);
  return target;
}
const _c1 = new THREE.Color(), _c2 = new THREE.Color();
function mixHex(target, a, b, t) {
  rawColor(_c1, a); rawColor(_c2, b);
  target.copy(_c1).lerp(_c2, clamp(t, 0, 1));
  return target;
}

// --- Initialization ---
function init() {
  const container = document.getElementById('canvas-container');

  // Colour pipeline: linear lighting, sRGB output, ACES filmic tone mapping
  if (THREE.ColorManagement) {
    if ('legacyMode' in THREE.ColorManagement) THREE.ColorManagement.legacyMode = false;
    else THREE.ColorManagement.enabled = true;
  }

  // 1. Scene & Renderer
  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0xaec6d8, 0.0034);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  baseRatio = Math.min(window.devicePixelRatio, 1.75);
  renderer.setPixelRatio(baseRatio);
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.6;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  MAX_ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  // 2. Camera
  camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.3, 4000);
  camera.position.set(45, 14, 40);

  // Loading veil while procedural assets are generated
  const veil = document.createElement('div');
  veil.id = 'loading-veil';
  veil.style.cssText = 'position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;flex-direction:column;background:#070d0a;color:#E8F5E9;font-family:Outfit,sans-serif;letter-spacing:.12em;transition:opacity .8s';
  veil.innerHTML = '<div style="font-size:26px;font-weight:700">NILAMBUR WORLD</div><div id="loading-msg" style="margin-top:10px;font-size:13px;color:#81C784">Growing the teak forest...</div>';
  document.body.appendChild(veil);

  // Build the world after the veil has painted
  requestAnimationFrame(() => setTimeout(() => {
    try {
      buildWorld();
    } catch (err) {
      console.error('World build failed', err);
      const m = document.getElementById('loading-msg');
      if (m) m.textContent = 'Error: ' + err.message;
      return;
    }
    veil.style.opacity = '0';
    setTimeout(() => veil.remove(), 900);
    worldReady = true;
    animate();
  }, 30));

  // UI never depends on the world build finishing
  setupEventListeners();
  renderQuestsUI();
  initMinimap();
  initAudioSynth();
  window.addEventListener('resize', onWindowResize);
}

function buildWorld() {
  buildTextures();
  buildMaterials();
  initHeights();

  // Sky, lights
  skyDome = new THREE.Sky();
  skyDome.scale.setScalar(2500);
  scene.add(skyDome);

  ambientLight = new THREE.HemisphereLight(0xbfd8ff, 0x3a4a26, 0.3);
  scene.add(ambientLight);

  sunLight = new THREE.DirectionalLight(0xfff0d8, 2.4);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  const d = 105;
  Object.assign(sunLight.shadow.camera, { left: -d, right: d, top: d, bottom: -d, near: 20, far: 900 });
  sunLight.shadow.bias = -0.0004;
  sunLight.shadow.normalBias = 0.06;
  scene.add(sunLight);
  scene.add(sunLight.target);

  // Environment (image based lighting from the procedural sky)
  envScene = new THREE.Scene();
  skyEnv = new THREE.Sky();
  skyEnv.scale.setScalar(2500);
  envScene.add(skyEnv);
  pmrem = new THREE.PMREMGenerator(renderer);

  const msg = (t) => { const m = document.getElementById('loading-msg'); if (m) m.textContent = t; };

  // World
  buildTerrain();
  buildChaliyarRiver();
  buildCanolyBridge();
  buildConollyTeakPlot();
  buildTeakMuseum();
  buildNilamburPalace();
  buildAdyanparaWaterfall();
  buildRailwayTrack();
  buildMinorStations();
  buildNilamburTown();
  buildVegetation();
  buildPlayerAvatar();
  buildRainSystem();
  buildSkyExtras();
  buildAmbientLife();

  // Start the player on the ground
  const g = groundHeight(state.playerPos.x, state.playerPos.z);
  playerMesh.parent.position.set(state.playerPos.x, g, state.playerPos.z);
  state.playerPos.y = g;

  updateEnvironment(0, true);
  camRig.yaw = 0.9;
}

// --- Player Avatar (articulated, animated) ---
function buildPlayerAvatar() {
  const playerGroup = new THREE.Group();
  const body = new THREE.Group();     // playerMesh: rotates to face the walking direction
  const S = (c, r) => new THREE.MeshStandardMaterial({ color: c, roughness: r === undefined ? 0.75 : r });
  const skin = S(0xb07a50, 0.65), shirt = S(0x2f8a76, 0.9), mundu = S(0xf0ece0, 0.95), hair = S(0x17110d, 0.6), band = S(0xd98a1a, 0.9), sole = S(0x3a2a1a);
  const add = (parent, geo, m, x, y, z) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; me.receiveShadow = true; parent.add(me); return me; };

  // Pelvis + torso
  const hips = new THREE.Group(); hips.position.y = 0.98; body.add(hips);
  const torso = new THREE.Group(); torso.position.y = 0.06; hips.add(torso);
  const chest = add(torso, new THREE.CapsuleGeometry(0.2, 0.34, 4, 12), shirt, 0, 0.42, 0);
  chest.scale.set(1.2, 1, 0.75);
  add(hips, new THREE.CylinderGeometry(0.22, 0.31, 0.62, 14), mundu, 0, -0.14, 0); // mundu (dhoti)
  add(hips, new THREE.CylinderGeometry(0.235, 0.235, 0.07, 14), band, 0, 0.16, 0);  // waist band
  // Neck and head
  add(torso, new THREE.CylinderGeometry(0.06, 0.07, 0.12, 8), skin, 0, 0.8, 0);
  const head = new THREE.Group(); head.position.y = 0.98; torso.add(head);
  const skull = add(head, new THREE.SphereGeometry(0.13, 16, 14), skin, 0, 0, 0);
  skull.scale.set(0.95, 1.08, 1);
  const hairCap = add(head, new THREE.SphereGeometry(0.138, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 0, 0.012, -0.01);
  hairCap.rotation.x = -0.25;
  add(head, new THREE.SphereGeometry(0.018, 6, 6), S(0x050505, 0.3), -0.045, 0.02, 0.122);
  add(head, new THREE.SphereGeometry(0.018, 6, 6), S(0x050505, 0.3), 0.045, 0.02, 0.122);
  add(head, new THREE.SphereGeometry(0.02, 6, 6), skin, 0, -0.015, 0.135);

  // Arms
  function makeArm(side) {
    const shoulder = new THREE.Group(); shoulder.position.set(side * 0.29, 0.72, 0); torso.add(shoulder);
    add(shoulder, new THREE.CapsuleGeometry(0.06, 0.2, 3, 8), shirt, 0, -0.15, 0);
    const elbow = new THREE.Group(); elbow.position.y = -0.3; shoulder.add(elbow);
    add(elbow, new THREE.CapsuleGeometry(0.048, 0.24, 3, 8), skin, 0, -0.15, 0);
    add(elbow, new THREE.SphereGeometry(0.05, 8, 8), skin, 0, -0.34, 0);
    shoulder.rotation.z = side * 0.08;
    return { shoulder: shoulder, elbow: elbow };
  }
  const armL = makeArm(-1), armR = makeArm(1);

  // Legs
  function makeLeg(side) {
    const hip = new THREE.Group(); hip.position.set(side * 0.11, -0.05, 0); hips.add(hip);
    add(hip, new THREE.CapsuleGeometry(0.085, 0.3, 3, 8), mundu, 0, -0.22, 0);
    const knee = new THREE.Group(); knee.position.y = -0.46; hip.add(knee);
    add(knee, new THREE.CapsuleGeometry(0.065, 0.32, 3, 8), skin, 0, -0.22, 0);
    const foot = add(knee, new THREE.BoxGeometry(0.11, 0.07, 0.24), sole, 0, -0.48, 0.05);
    return { hip: hip, knee: knee, foot: foot };
  }
  const legL = makeLeg(-1), legR = makeLeg(1);

  body.scale.setScalar(1.05);
  playerGroup.add(body);
  playerMesh = body;
  playerRig = { hips: hips, torso: torso, head: head, armL: armL, armR: armR, legL: legL, legR: legR, phase: 0, moveAmt: 0, facing: 0, airborne: 0 };

  playerGroup.position.set(state.playerPos.x, state.playerPos.y, state.playerPos.z);
  scene.add(playerGroup);
}

function animatePlayerRig(dt, speed01, airborne) {
  const r = playerRig;
  r.moveAmt += (speed01 - r.moveAmt) * Math.min(1, dt * 10);
  r.phase += dt * (5 + r.moveAmt * 6.5) * (r.moveAmt > 0.02 ? 1 : 0);
  r.airborne += ((airborne ? 1 : 0) - r.airborne) * Math.min(1, dt * 12);
  const m = r.moveAmt, s = Math.sin(r.phase), c = Math.cos(r.phase);
  const amp = 0.45 + m * 0.35;
  const breathe = Math.sin(clock.t * 1.8) * 0.012;
  const a = 1 - r.airborne;
  r.legL.hip.rotation.x = s * amp * m * a - r.airborne * 0.5;
  r.legR.hip.rotation.x = -s * amp * m * a + r.airborne * 0.35;
  r.legL.knee.rotation.x = Math.max(0, -c) * 0.8 * m * a + r.airborne * 0.7;
  r.legR.knee.rotation.x = Math.max(0, c) * 0.8 * m * a + r.airborne * 0.3;
  r.armL.shoulder.rotation.x = -s * amp * 0.9 * m * a - r.airborne * 1.2;
  r.armR.shoulder.rotation.x = s * amp * 0.9 * m * a - r.airborne * 1.2;
  r.armL.elbow.rotation.x = -0.15 - m * 0.5 * (0.5 + 0.5 * s);
  r.armR.elbow.rotation.x = -0.15 - m * 0.5 * (0.5 - 0.5 * s);
  r.hips.position.y = 0.98 + Math.abs(Math.sin(r.phase)) * 0.045 * m * a + breathe;
  r.torso.rotation.y = s * 0.1 * m;
  r.torso.rotation.x = 0.06 * m;
  r.head.rotation.y = -s * 0.05 * m;
}

// --- Rain (GPU streaks + ground splashes) ---
function buildRainSystem() {
  const N = 6000;
  const pos = new Float32Array(N * 2 * 3), end = new Float32Array(N * 2);
  const rng = makeRng(404);
  for (let i = 0; i < N; i++) {
    const x = rng() * 80, y = rng() * 55, z = rng() * 80;
    for (let k = 0; k < 2; k++) { pos.set([x, y, z], (i * 2 + k) * 3); end[i * 2 + k] = k; }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uOpacity: { value: 0 }, uColor: { value: new THREE.Color(0xb8c8d4) } },
    vertexShader: `
      uniform float uTime; uniform vec3 uCenter; attribute float aEnd; varying float vA;
      void main(){
        vec3 p = position;
        float wy = uCenter.y - 6.0 + mod(p.y - uTime * 34.0, 55.0);
        vec2 w = uCenter.xz + mod(p.xz - uCenter.xz + 40.0, 80.0) - 40.0;
        vec3 wp = vec3(w.x, wy, w.y);
        wp += vec3(0.14, 1.0, 0.03) * aEnd * 1.25;
        vA = 0.25 + 0.75 * aEnd;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uOpacity; uniform vec3 uColor; varying float vA;
      void main(){ gl_FragColor = vec4(uColor, uOpacity * vA * 0.5); }`,
    transparent: true, depthWrite: false
  });
  rainLines = new THREE.LineSegments(geo, mat);
  rainLines.frustumCulled = false;
  rainLines.visible = false;
  rainParticles = rainLines;
  scene.add(rainLines);

  // Ground splashes
  const SN = 320;
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SN * 3), 3));
  sg.setAttribute('aAge', new THREE.BufferAttribute(new Float32Array(SN).fill(9), 1));
  const sm = new THREE.ShaderMaterial({
    uniforms: { uOpacity: { value: 0 } },
    vertexShader: `
      attribute float aAge; varying float vA; uniform float uOpacity;
      void main(){
        vA = clamp(1.0 - aAge / 0.45, 0.0, 1.0) * uOpacity;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = clamp((6.0 + aAge * 40.0) * (36.0 / max(1.0, -mv.z)), 1.0, 26.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying float vA;
      void main(){
        vec2 c = gl_PointCoord - 0.5; float r = length(c) * 2.0;
        float ring = smoothstep(0.35, 0.7, r) * (1.0 - smoothstep(0.75, 1.0, r));
        gl_FragColor = vec4(0.85, 0.92, 1.0, ring * vA * 0.7);
      }`,
    transparent: true, depthWrite: false
  });
  splashPoints = new THREE.Points(sg, sm);
  splashPoints.frustumCulled = false;
  splashPoints.visible = false;
  scene.add(splashPoints);
}

function updateRain(dt) {
  const active = env.rain > 0.02;
  rainLines.visible = active;
  splashPoints.visible = active;
  if (!active) return;
  const pp = playerMesh.parent.position;
  rainLines.material.uniforms.uTime.value = clock.t;
  rainLines.material.uniforms.uCenter.value.set(pp.x, pp.y, pp.z);
  rainLines.material.uniforms.uOpacity.value = env.rain * (0.5 + 0.5 * env.light);
  splashPoints.material.uniforms.uOpacity.value = env.rain * (0.4 + 0.6 * env.light);
  const pa = splashPoints.geometry.attributes.position, ag = splashPoints.geometry.attributes.aAge;
  for (let i = 0; i < ag.count; i++) {
    let age = ag.array[i] + dt;
    if (age > 0.45) {
      if (Math.random() < 0.5) {
        const x = pp.x + (Math.random() - 0.5) * 34, z = pp.z + (Math.random() - 0.5) * 34;
        const y = Math.max(groundHeight(x, z), WATER_Y + 0.05) + 0.06;
        pa.setXYZ(i, x, y, z);
        age = 0;
      } else age = 9;
    }
    ag.array[i] = age;
  }
  pa.needsUpdate = true; ag.needsUpdate = true;
}

// --- Sky extras: stars, moon, clouds, overcast dome ---
function buildSkyExtras() {
  // Stars
  const n = 1800, sp = new Float32Array(n * 3), rng = makeRng(31);
  for (let i = 0; i < n; i++) {
    const u = rng(), v = rng() * 0.98 + 0.02;
    const th = u * Math.PI * 2, ph = Math.acos(v);
    sp[i * 3] = Math.sin(ph) * Math.cos(th) * 1800; sp[i * 3 + 1] = Math.cos(ph) * 1800; sp[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 1800;
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
  starPoints = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.7, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
  starPoints.frustumCulled = false;
  starPoints.renderOrder = 1;
  scene.add(starPoints);

  // Moon
  const mc = mkCanvas(128, 128), g = mc.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 20, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,240,0.5)'); gr.addColorStop(0.4, 'rgba(255,255,240,0.15)'); gr.addColorStop(1, 'rgba(255,255,240,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#f4f1e2'; g.beginPath(); g.arc(64, 64, 20, 0, 6.3); g.fill();
  g.fillStyle = 'rgba(160,160,150,0.35)';
  [[58, 58, 5], [72, 66, 4], [62, 74, 3.5], [70, 52, 3]].forEach(c => { g.beginPath(); g.arc(c[0], c[1], c[2], 0, 6.3); g.fill(); });
  moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: canvasTex(mc, { wrap: false }), transparent: true, depthWrite: false, fog: false, toneMapped: false, opacity: 0 }));
  moonSprite.scale.set(260, 260, 1);
  moonSprite.renderOrder = 2;
  scene.add(moonSprite);

  // Overcast dome for monsoon
  cloudDome = new THREE.Mesh(new THREE.SphereGeometry(2000, 24, 12), new THREE.MeshBasicMaterial({ map: TEX.overcast, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false, toneMapped: false }));
  cloudDome.renderOrder = 3;
  cloudDome.scale.y = 0.7;
  scene.add(cloudDome);

  // Cumulus sprites
  cloudGroup = new THREE.Group();
  const cr = makeRng(58);
  for (let i = 0; i < 26; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: TEX.cloud, transparent: true, depthWrite: false, fog: false, toneMapped: false, opacity: 0.85 }));
    const a = cr() * Math.PI * 2, r = 300 + cr() * 1100;
    sp.position.set(Math.cos(a) * r, 260 + cr() * 220, Math.sin(a) * r);
    const w = 500 + cr() * 600;
    sp.scale.set(w, w * (0.28 + cr() * 0.12), 1);
    sp.renderOrder = 4;
    cloudGroup.add(sp);
  }
  scene.add(cloudGroup);
}

// --- Ambient life: birds and fireflies ---
function buildAmbientLife() {
  birdGroup = new THREE.Group();
  const bm = new THREE.MeshBasicMaterial({ color: 0x20201c, side: THREE.DoubleSide, fog: false });
  const wingGeo = new THREE.BufferGeometry();
  wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.35, 1.5, 0, 0.1, 0, 0, -0.3], 3));
  wingGeo.computeVertexNormals();
  const bodyGeo = new THREE.ConeGeometry(0.12, 0.7, 5);
  bodyGeo.rotateX(Math.PI / 2);
  for (let i = 0; i < 12; i++) {
    const b = new THREE.Group();
    b.add(new THREE.Mesh(bodyGeo, bm));
    const wl = new THREE.Mesh(wingGeo, bm), wr = new THREE.Mesh(wingGeo, bm);
    wr.scale.x = -1;
    b.add(wl, wr);
    b.userData = { wl: wl, wr: wr, r: 40 + Math.random() * 70, a: Math.random() * 6.28, sp: 0.12 + Math.random() * 0.1, h: 55 + Math.random() * 40, ph: Math.random() * 6 };
    b.scale.setScalar(1.6);
    birdGroup.add(b);
  }
  scene.add(birdGroup);

  const N = 160;
  const fp = new Float32Array(N * 3), fs = [];
  for (let i = 0; i < N; i++) fs.push({ ox: Math.random() * 6.28, oy: Math.random() * 6.28, sp: 0.4 + Math.random() * 0.8 });
  const fg = new THREE.BufferGeometry();
  fg.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ map: TEX.soft, color: 0xd6ff5a, size: 0.9, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  fireflies.frustumCulled = false;
  fireflies.userData = { seeds: fs, cx: 1e9, cz: 1e9, base: new Float32Array(N * 3) };
  scene.add(fireflies);
}

function updateAmbientLife(dt) {
  const t = clock.t;
  const pp = playerMesh.parent.position;
  // Birds
  const showBirds = env.day > 0.35 && env.rain < 0.5;
  birdGroup.visible = showBirds;
  if (showBirds) {
    birdGroup.children.forEach(b => {
      const u = b.userData;
      u.a += u.sp * dt;
      const x = pp.x * 0.7 + Math.cos(u.a) * u.r, z = pp.z * 0.7 + Math.sin(u.a) * u.r;
      b.position.set(x, u.h + Math.sin(t * 0.5 + u.ph) * 4, z);
      b.rotation.y = -u.a;
      const f = Math.sin(t * 9 + u.ph) * 0.7;
      u.wl.rotation.z = f; u.wr.rotation.z = -f;
    });
  }
  // Fireflies
  const nf = clamp((env.night - 0.4) * 1.7, 0, 1) * (1 - env.rain);
  fireflies.visible = nf > 0.02;
  if (fireflies.visible) {
    fireflies.material.opacity = nf * 0.9;
    const u = fireflies.userData, pa = fireflies.geometry.attributes.position;
    if (Math.hypot(pp.x - u.cx, pp.z - u.cz) > 35) {
      u.cx = pp.x; u.cz = pp.z;
      for (let i = 0; i < pa.count; i++) {
        const x = pp.x + (Math.random() - 0.5) * 90, z = pp.z + (Math.random() - 0.5) * 90;
        u.base[i * 3] = x; u.base[i * 3 + 1] = Math.max(groundHeight(x, z), WATER_Y) + 0.8 + Math.random() * 2.5; u.base[i * 3 + 2] = z;
      }
    }
    for (let i = 0; i < pa.count; i++) {
      const s = u.seeds[i];
      pa.setXYZ(i, u.base[i * 3] + Math.sin(t * s.sp + s.ox) * 1.6, u.base[i * 3 + 1] + Math.sin(t * s.sp * 1.3 + s.oy) * 0.7, u.base[i * 3 + 2] + Math.cos(t * s.sp + s.oy) * 1.6);
    }
    pa.needsUpdate = true;
  }
}

// --- Environment: time of day, weather blending, lighting ---
function computeSunDir(t, out) {
  const a = (t - 6) / 24 * Math.PI * 2;
  return out.set(Math.cos(a) * 0.85, Math.sin(a), 0.42).normalize();
}

function setSkyUniforms(sky, turb, ray, mie, g, sunDir) {
  const u = sky.material.uniforms;
  u.turbidity.value = turb; u.rayleigh.value = ray; u.mieCoefficient.value = mie; u.mieDirectionalG.value = g;
  u.sunPosition.value.copy(sunDir).multiplyScalar(450000);
}

function updateEnvironment(dt, force) {
  env.rain += (env.rainTarget - env.rain) * Math.min(1, dt * 0.9);
  if (Math.abs(env.rain - env.rainTarget) < 0.003) env.rain = env.rainTarget;
  const rain = env.rain;
  const sd = computeSunDir(state.timeOfDay, env.sunDir);
  const elev = sd.y;
  const day = smoothstep(-0.1, 0.2, elev);
  const night = 1 - smoothstep(-0.25, 0.0, elev);
  const warm = smoothstep(0.32, 0.0, elev) * smoothstep(-0.14, 0.02, elev);
  env.day = day; env.night = night;
  const light = clamp(day * (1 - rain * 0.55) + 0.05, 0, 1);
  env.light = light;

  // Fog / horizon colour (display space)
  const fog = env.fog;
  mixHex(fog, 0x0a1220, 0xb2c9dc, day);
  mixHex(_c2, 0, 0, 0); // no-op keeps temp colours defined
  rawColor(_c2, 0xf0a070); fog.lerp(_c2, warm * 0.75 * (1 - rain));
  rawColor(_c2, 0x14181c); const grey = mixHex(new THREE.Color(), 0x0d1216, 0x77828a, day);
  fog.lerp(grey, rain * 0.85);
  scene.fog.color.copy(fog);
  scene.fog.density = lerp(0.0034, 0.0105, rain) + night * 0.0008;

  // Sky
  const turb = 5 + warm * 4 + rain * 14, ray = 1.7 + warm * 1.6 - rain * 1.1, mie = 0.005 + rain * 0.05 + warm * 0.004;
  setSkyUniforms(skyDome, turb, ray, mie, 0.8, sd);
  renderer.toneMappingExposure = lerp(0.85, 0.52, day) * (1 - rain * 0.12);

  // Sun / moon light
  const moonDir = new THREE.Vector3(-sd.x, -sd.y, 0.25).normalize();
  const sunUp = elev > -0.03;
  const ldir = sunUp ? sd : moonDir;
  if (sunUp) {
    const k = smoothstep(0.0, 0.3, elev);
    mixHex(_c1, 0xff7a2c, 0xfff1dc, k);
    sunLight.color.copy(_c1);
    sunLight.color.set(0xffffff).lerp(new THREE.Color(1, 0.55, 0.28), (1 - k) * 0.9).lerp(new THREE.Color(1, 0.94, 0.85), k * 0.3);
    sunLight.intensity = 2.7 * smoothstep(-0.04, 0.09, elev) * (1 - rain * 0.86);
  } else {
    sunLight.color.set(0x8fa8ff);
    sunLight.intensity = 0.55 * night * (1 - rain * 0.7);
  }
  sunLight.userData.dir = ldir.clone();
  ambientLight.color.set(0xffffff).lerp(new THREE.Color(0.55, 0.7, 1.0), 0.4);
  ambientLight.groundColor.set(0x3a4a26);
  ambientLight.intensity = lerp(0.14, 0.32, day) * (1 - rain * 0.2) + night * 0.05;

  // Water
  if (waterMesh) {
    const u = waterMesh.material.uniforms;
    u.sunDirection.value.copy(ldir);
    u.sunColor.value.copy(sunLight.color);
    u.waterColor.value.set(0x2f6d58).lerp(new THREE.Color(0x5a5236), rain * 0.7).multiplyScalar(0.15 + 0.85 * light);
    u.distortionScale.value = 1.4 + rain * 1.6;
  }

  // Stars, moon, clouds, dome
  const cam = camera.position;
  starPoints.material.opacity = night * (1 - rain);
  starPoints.position.copy(cam);
  moonSprite.position.copy(cam).addScaledVector(moonDir, 1700);
  moonSprite.material.opacity = clamp(night * 1.3, 0, 1) * (1 - rain * 0.85);
  cloudDome.position.copy(cam);
  cloudDome.material.opacity = rain * 0.96;
  cloudDome.material.color.copy(rawToLinearTint(fog, 0.9 + light * 0.25));
  cloudGroup.position.set(cam.x, 0, cam.z);
  const cc = mixHex(new THREE.Color(), 0x2a3346, 0xffffff, light);
  rawColor(_c2, 0xff9a60); cc.lerp(_c2, warm * 0.6);
  cc.copySRGBToLinear(cc);
  cloudGroup.children.forEach(s => { s.material.color.copy(cc); s.material.opacity = 0.9 * (1 - rain * 0.6) * (0.3 + 0.7 * light); });
  cloudGroup.visible = rain < 0.98;

  // Night lights and windows
  const glow = clamp(night * 1.2 + rain * 0.25 * (1 - night), 0, 1) * (1 - 0);
  ANIM.glowMats.forEach(m => { m.emissiveIntensity = m === M.lampGlow ? 0.15 + glow * 3.2 : glow * 1.8; });
  ANIM.nightLights.forEach(l => { l.intensity = glow * 2.4; });
  // Waterfall visual brightness follows the light
  ANIM.fallMats.forEach(f => { const L = 0.22 + 0.78 * light; f.mat.color.setRGB(0.9 * L, 0.95 * L, 1.0 * L); });
  if (ANIM.mist) ANIM.mist.pts.material.color.setRGB(0.25 + 0.75 * light, 0.27 + 0.75 * light, 0.3 + 0.75 * light);

  // Wet ground when raining
  M.terrain.roughness = lerp(0.96, 0.6, rain);
  M.terrain.color.setScalar(1 - rain * 0.28);

  // Image-based lighting refresh (throttled)
  const now = performance.now();
  const moved = lastEnvSun.distanceTo(sd) > 0.012 || Math.abs(lastEnvRain - rain) > 0.04;
  if (force || (moved && now - lastEnvUpdate > 400)) {
    setSkyUniforms(skyEnv, turb, ray, mie, 0.8, sd);
    const rt = pmrem.fromScene(envScene, 0.02);
    scene.environment = rt.texture;
    if (envRT) envRT.dispose();
    envRT = rt;
    lastEnvUpdate = now; lastEnvSun.copy(sd); lastEnvRain = rain;
    const ei = lerp(0.12, 0.9, day) * (1 - rain * 0.3);
    if (!scene.userData.envMats) {
      const set = new Set();
      scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => { if (m.isMeshStandardMaterial) set.add(m); }); });
      scene.userData.envMats = Array.from(set);
    }
    scene.userData.envMats.forEach(m => { m.envMapIntensity = ei; });
    if (ANIM.pool) ANIM.pool.material.envMapIntensity = ei * 1.6;
  }
}

function rawToLinearTint(fog, k) {
  const c = new THREE.Color().copy(fog).multiplyScalar(k);
  c.copySRGBToLinear(c);
  return c;
}

// --- Animation & Physics Loop ---
function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now - clock.last) / 1000);
  clock.last = now; clock.t += dt; clock.frames = (clock.frames || 0) + 1;
  windUniform.value = clock.t;

  updatePlayerMovement(dt);
  updateCamera(dt);
  updateEnvironment(dt, false);

  // Follow shadow frustum around the player
  {
    const pp = playerMesh.parent.position;
    const sx = Math.round(pp.x / 2) * 2, sz = Math.round(pp.z / 2) * 2;
    sunLight.target.position.set(sx, pp.y, sz);
    sunLight.position.copy(sunLight.target.position).addScaledVector(sunLight.userData.dir || env.sunDir, 380);
    sunLight.target.updateMatrixWorld();
    sunLight.castShadow = sunLight.intensity > 0.05;
  }
  skyDome.position.copy(camera.position);
  skyEnv.position.set(0, 0, 0);

  // Water animation
  if (waterMesh) waterMesh.material.uniforms.time.value += dt * (0.55 + env.rain * 0.4);

  // Waterfall
  ANIM.fallMats.forEach(f => { f.tex.offset.y += dt * f.speed; });
  if (ANIM.mist) {
    const m = ANIM.mist, pa = m.pts.geometry.attributes.position;
    for (let i = 0; i < m.N; i++) {
      const ph = (clock.t * 0.13 + m.seeds[i * 3]) % 1;
      pa.setXYZ(i, (m.seeds[i * 3 + 1] - 0.5) * 14 + ph * 2.5, 0.4 + ph * 11, 11 + m.seeds[i * 3 + 2] * 9 + ph * 3);
    }
    pa.needsUpdate = true;
    m.pts.material.opacity = 0.34 * (0.4 + 0.6 * env.light);
  }
  if (ANIM.pool) { ANIM.pool.material.normalMap.offset.y = clock.t * 0.02; ANIM.pool.material.normalMap.offset.x = clock.t * 0.013; }

  // Train (stops at each of the 6 stations along the way - see updateTrain in world.js)
  updateTrain(dt);

  if (ANIM.townUpdate) ANIM.townUpdate(dt, clock.t);
  if (window.NW && NW.tick) NW.tick(dt);

  // Clouds drift
  if (cloudGroup) {
    cloudGroup.children.forEach(s => { s.position.x += dt * (4 + s.position.y * 0.01); if (s.position.x > 1500) s.position.x = -1500; });
  }

  updateRain(dt);
  updateAmbientLife(dt);
  checkLandmarkProximity();
  updateMinimap();

  renderer.render(scene, camera);

  // Adaptive resolution: back off on slow machines
  perf.frames++; perf.acc += dt;
  if (perf.acc > 2.5) {
    const fps = perf.frames / perf.acc;
    perf.frames = 0; perf.acc = 0;
    const pr = renderer.getPixelRatio();
    if (fps < 38 && pr > 0.7) { renderer.setPixelRatio(Math.max(0.7, pr - 0.2)); renderer.setSize(window.innerWidth, window.innerHeight); }
  }
}

// Player Physics & Movement
function updatePlayerMovement(dt) {
  if (!playerMesh) return;
  if (state.driving) { updateVehicleDriving(dt); return; }
  if (state.ridingTrain) { updateRidingTrain(dt); return; }
  const parent = playerMesh.parent;
  const sprint = keyState['ShiftLeft'] || keyState['ShiftRight'];
  let speed = sprint ? 17 : 8;

  let inF = 0, inR = 0;
  if (keyState['KeyW'] || keyState['ArrowUp']) inF += 1;
  if (keyState['KeyS'] || keyState['ArrowDown']) inF -= 1;
  if (keyState['KeyD'] || keyState['ArrowRight']) inR += 1;
  if (keyState['KeyA'] || keyState['ArrowLeft']) inR -= 1;

  const p = parent.position;
  const wading = groundHeight(p.x, p.z) < WATER_Y - 0.2;
  if (wading) speed *= 0.55;

  let moving = false, mx = 0, mz = 0;
  if (inF !== 0 || inR !== 0) {
    const sy = Math.sin(camRig.yaw), cy = Math.cos(camRig.yaw);
    mx = -sy * inF + cy * inR;
    mz = -cy * inF - sy * inR;
    const l = Math.hypot(mx, mz);
    mx /= l; mz /= l;
    moving = true;
    p.x += mx * speed * dt;
    p.z += mz * speed * dt;
    // Smoothly turn to face the direction of travel
    const target = Math.atan2(mx, mz);
    let diff = target - playerMesh.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    playerMesh.rotation.y += diff * Math.min(1, dt * 12);
  }

  // Boundary clamp + collisions
  const lim = WORLD_SIZE / 2 - 45;
  p.x = clamp(p.x, -lim, lim);
  p.z = clamp(p.z, -lim, lim);
  resolveCollisions(p, 0.45);

  // Vertical: gravity, jump, terrain following
  const ground = groundHeight(p.x, p.z);
  const vel = state.playerVelocity;
  if (state.isGrounded && keyState['Space']) { vel.y = 9.5; state.isGrounded = false; }
  if (!state.isGrounded) {
    vel.y -= 28 * dt;
    p.y += vel.y * dt;
    if (p.y <= ground && vel.y <= 0) { p.y = ground; vel.y = 0; state.isGrounded = true; }
  } else {
    if (p.y - ground > 0.6) { state.isGrounded = false; vel.y = 0; }
    else p.y += (ground - p.y) * Math.min(1, dt * 22);
  }

  state.playerPos.x = p.x; state.playerPos.y = p.y; state.playerPos.z = p.z;
  animatePlayerRig(dt, moving ? (sprint ? 1 : 0.6) * (wading ? 0.6 : 1) : 0, !state.isGrounded);
  camRig.idleTime = moving ? 0 : camRig.idleTime + dt;

  document.getElementById('coords-text').innerText = `X: ${Math.round(p.x)} | Z: ${Math.round(p.z)}`;
}

function updateCamera(dt) {
  if (window.__freeCam) return;
  const p = playerMesh.parent.position;
  // Distance / pitch presets per camera mode
  const wantDist = state.isCameraOrbit ? camRig.distTarget : Math.min(camRig.distTarget, 10);
  const targetDist = state.isCameraOrbit ? wantDist : 9;
  camRig.dist += (targetDist - camRig.dist) * Math.min(1, dt * 4);

  // While driving or riding the train, lock the camera directly behind, facing the same way it's
  // travelling ("always show the straight/front view") so steering reads correctly - free orbit and
  // the idle auto-rotate are both suspended.
  const lockYaw = state.driving ? state.driving.yaw + Math.PI : (state.ridingTrain ? Math.PI : null);
  if (lockYaw !== null) {
    camRig.yaw = lockYaw;   // hard lock, no lag - the view must stay exactly straight behind while driving
    camRig.pitch += (0.22 - camRig.pitch) * Math.min(1, dt * 4);
  } else if (state.isCameraOrbit && !camRig.dragging && camRig.idleTime > 3) camRig.yaw += dt * 0.07;

  const tx = p.x, ty = p.y + 1.55, tz = p.z;
  const cp = Math.cos(camRig.pitch), sp = Math.sin(camRig.pitch);
  // Pull the camera in when trunks or walls are in the way
  let dist = camRig.dist;
  for (let k = 1; k <= 8; k++) {
    const f = k / 8 * dist;
    const px = tx + Math.sin(camRig.yaw) * cp * f, pz = tz + Math.cos(camRig.yaw) * cp * f, py = ty + sp * f;
    if (blockedForCamera(px, py, pz)) { dist = Math.max(2.2, f - dist / 8 - 0.6); break; }
  }
  camRig.eff = dist;
  let cx = tx + Math.sin(camRig.yaw) * cp * dist;
  let cy = ty + sp * dist;
  let cz = tz + Math.cos(camRig.yaw) * cp * dist;
  const minY = Math.max(groundHeight(cx, cz), WATER_Y) + 0.9;
  if (cy < minY) cy = minY;
  camera.position.set(cx, cy, cz);
  camera.lookAt(tx, ty + 0.2, tz);
}

// Proximity Detection
function checkLandmarkProximity() {
  const px = state.playerPos.x;
  const pz = state.playerPos.z;

  for (const key in LANDMARKS) {
    const lm = LANDMARKS[key];
    const dx = px - lm.pos.x;
    const dz = pz - lm.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < lm.radius && !state.discoveredLocations.has(key)) {
      state.discoveredLocations.add(key);
      triggerLandmarkPopup(lm.name, lm.desc);
      completeQuest(lm.questId);
    }
  }
}

let popupTimer = null;
function triggerLandmarkPopup(title, desc) {
  const popup = document.getElementById('location-popup');
  document.getElementById('popup-title').innerText = title;
  document.getElementById('popup-desc').innerText = desc;

  popup.classList.add('show');
  clearTimeout(popupTimer);
  popupTimer = setTimeout(() => {
    popup.classList.remove('show');
  }, 4500);
}

// --- UI & Quest System ---
function renderQuestsUI() {
  const container = document.getElementById('quest-container');
  container.innerHTML = '';

  QUESTS.forEach(q => {
    const item = document.createElement('div');
    item.className = `quest-item ${q.done ? 'completed' : ''}`;
    item.innerHTML = `
      <div class="quest-checkbox">${q.done ? '✓' : ''}</div>
      <div class="quest-info">
        <h4>${q.title}</h4>
        <p>${q.desc}</p>
      </div>
    `;
    container.appendChild(item);
  });

  document.getElementById('quest-score').innerText = `Score: ${state.score}`;
}

function completeQuest(questId) {
  const q = QUESTS.find(item => item.id === questId);
  if (q && !q.done) {
    q.done = true;
    state.score += q.score;
    renderQuestsUI();
  }
}

// --- Minimap / Full-World-Map Canvas Renderer ---
// The always-on GPS widget and the maximized full map share one drawing routine
// (drawMapContent); only their canvas size and world->canvas mapping differ - the minimap
// follows the player at a fixed 600m span, the full map frames the whole world at once.
let minimapCtx, fullMapCtx;
let mapModalOpen = false;

function initMinimap() {
  const canvas = document.getElementById('minimap-canvas');
  canvas.width = 280;
  canvas.height = 200;
  minimapCtx = canvas.getContext('2d');

  const full = document.getElementById('map-canvas-full');
  if (full) {
    full.width = 1000;
    full.height = 730;
    fullMapCtx = full.getContext('2d');
  }
}

// World-space rectangle that contains every landmark, station and the river/railway, with a
// little padding. This is what the maximized map frames.
function computeFullMapBox() {
  let minX = -70, maxX = 70, minZ = -340, maxZ = 340; // river + spawn area, always included
  for (const key in LANDMARKS) {
    const lm = LANDMARKS[key], r = lm.radius || 20;
    minX = Math.min(minX, lm.pos.x - r); maxX = Math.max(maxX, lm.pos.x + r);
    minZ = Math.min(minZ, lm.pos.z - r); maxZ = Math.max(maxZ, lm.pos.z + r);
  }
  if (typeof STATIONS !== 'undefined') {
    minX = Math.min(minX, RAIL_X - 20); maxX = Math.max(maxX, RAIL_X + 20);
    STATIONS.forEach(st => { minZ = Math.min(minZ, st.z - 20); maxZ = Math.max(maxZ, st.z + 20); });
  }
  const padX = (maxX - minX) * 0.06, padZ = (maxZ - minZ) * 0.06;
  return { minX: minX - padX, maxX: maxX + padX, minZ: minZ - padZ, maxZ: maxZ + padZ };
}

// Draws the river, roads, railway, landmarks, stations, train, other players and the local
// player into any canvas context, given its own world->canvas mapping. When `labels` is set,
// each marker gets a small name tag underneath it so it's clear what's being pointed at.
function drawMapContent(ctx, w, h, mapX, mapZ, sc, labels) {
  ctx.fillStyle = '#0a1d12';
  ctx.fillRect(0, 0, w, h);

  const line = (x1, z1, x2, z2) => { ctx.moveTo(mapX(x1), mapZ(z1)); ctx.lineTo(mapX(x2), mapZ(z2)); };
  // Small canvas (the GPS widget) gets a tighter tag so several close-together landmarks -
  // the forest cluster especially - stay legible instead of piling into one blob of text.
  const fontPx = w < 400 ? 8 : 11, tagH = w < 400 ? 10 : 13;
  const tag = (x, y, text, color) => {
    if (!labels || !text) return;
    ctx.font = fontPx + 'px Segoe UI, sans-serif';
    ctx.textAlign = 'center';
    const tw = ctx.measureText(text).width + 6;
    ctx.fillStyle = 'rgba(0,0,0,0.62)';
    ctx.fillRect(x - tw / 2, y, tw, tagH);
    ctx.fillStyle = color || '#fff';
    ctx.fillText(text, x, y + tagH - 3);
  };

  // Draw River
  ctx.strokeStyle = '#00B0FF';
  ctx.lineWidth = Math.max(1.5, 14 * sc * 2);
  ctx.beginPath();
  line(0, -320, 0, 320);
  ctx.stroke();
  tag(mapX(0), mapZ(-300) + 6, 'Chaliyar River', '#40C4FF');

  // Town streets: ring road plus main street, cross road and west lane
  {
    const RW = TOWN.cx - 180, RE = TOWN.cx + 180, RZ = 330, lx = TOWN.cx - 35.5;
    ctx.strokeStyle = 'rgba(190,190,180,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.beginPath();
    line(RW, -RZ, RE, -RZ); line(RE, -RZ, RE, RZ); line(RE, RZ, RW, RZ); line(RW, RZ, RW, -RZ);
    line(RW, 0, RE, 0); line(TOWN.cx, -RZ, TOWN.cx, RZ); line(lx, -RZ, lx, RZ);
    ctx.stroke();
  }

  // Railway line
  ctx.strokeStyle = 'rgba(200,200,200,0.7)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  line(RAIL_X, -260, RAIL_X, 260);
  ctx.stroke();
  ctx.setLineDash([]);

  // Draw Landmark Markers (those off the map are pinned to its edge - skip their label there,
  // there's no room to place text meaningfully once a marker has been clamped to the border)
  for (const key in LANDMARKS) {
    const lm = LANDMARKS[key];
    const raw = { x: mapX(lm.pos.x), z: mapZ(lm.pos.z) };
    const off = raw.x < 6 || raw.x > w - 6 || raw.z < 6 || raw.z > h - 6;
    const lx = Math.min(w - 6, Math.max(6, raw.x)), lz = Math.min(h - 6, Math.max(6, raw.z));
    const discovered = state.discoveredLocations.has(key);

    ctx.globalAlpha = off ? 0.55 : 1;
    ctx.fillStyle = discovered ? '#FFB300' : '#81C784';
    ctx.beginPath();
    ctx.arc(lx, lz, off ? 3 : 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Labelled above the marker (stations/train are labelled below theirs) so landmarks that
    // sit close to the railway - several do - don't get their name tags overlapping.
    if (!off) tag(lx, lz - 18, lm.name, discovered ? '#FFD54F' : '#A5D6A7');
  }

  // Draw the 6 train stations and the train itself
  if (typeof STATIONS !== 'undefined') {
    STATIONS.forEach((st, i) => {
      const sx = mapX(RAIL_X), sz = mapZ(st.z);
      const atStop = TRAIN_STATE.state === 'dwell' && TRAIN_STATE.i === i;
      ctx.fillStyle = atStop ? '#FFD54F' : '#B0BEC5';
      ctx.fillRect(sx - 3, sz - 3, 6, 6);
      tag(sx, sz + 5, st.name, atStop ? '#FFD54F' : '#CFD8DC');
    });
    if (ANIM.train) {
      const tx = mapX(RAIL_X), tz = mapZ(ANIM.train.position.z);
      ctx.fillStyle = '#E53935';
      ctx.beginPath();
      ctx.arc(tx, tz, 4, 0, Math.PI * 2);
      ctx.fill();
      tag(tx, tz - 16, 'Train', '#FF8A80');
    }
  }

  if (window.NW && NW.drawMinimap) NW.drawMinimap(ctx, mapX, mapZ, { w, h, tag });

  // Draw Player Position Dot
  const px = mapX(state.playerPos.x);
  const pz = mapZ(state.playerPos.z);

  ctx.fillStyle = '#00E676';
  ctx.beginPath();
  ctx.arc(px, pz, 6, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Facing tick
  if (playerMesh) {
    const f = playerMesh.rotation.y;
    ctx.beginPath();
    ctx.moveTo(px, pz);
    ctx.lineTo(px + Math.sin(f) * 12, pz + Math.cos(f) * 12);
    ctx.stroke();
  }
  tag(px, pz + 8, 'You', '#69F0AE');
}

function updateMinimap() {
  if (minimapCtx) {
    const w = 280, h = 200;
    const psx = state.playerPos.x, psz = state.playerPos.z, sc = w / 600;
    drawMapContent(minimapCtx, w, h, (x) => (x - psx) * sc + w / 2, (z) => (z - psz) * sc + h / 2, sc, true);
  }
  if (mapModalOpen) updateFullMap();
}

function updateFullMap() {
  if (!fullMapCtx) return;
  const w = fullMapCtx.canvas.width, h = fullMapCtx.canvas.height;
  const box = computeFullMapBox();
  const boxW = box.maxX - box.minX, boxH = box.maxZ - box.minZ;
  const sc = Math.min(w / boxW, h / boxH);
  const cx = (box.minX + box.maxX) / 2, cz = (box.minZ + box.maxZ) / 2;
  drawMapContent(fullMapCtx, w, h, (x) => (x - cx) * sc + w / 2, (z) => (z - cz) * sc + h / 2, sc, true);

  const count = document.getElementById('map-discovered-count');
  if (count) count.innerText = `${state.discoveredLocations.size} / ${Object.keys(LANDMARKS).length} landmarks discovered`;
}

function openFullMap() {
  mapModalOpen = true;
  document.getElementById('map-modal').classList.add('open');
  updateFullMap();
}

function closeFullMap() {
  mapModalOpen = false;
  document.getElementById('map-modal').classList.remove('open');
}

// --- Weather & Environment System ---
function formatTime(val) {
  const hh = Math.floor(val) % 24;
  const mm = Math.floor((val - Math.floor(val)) * 60);
  const ap = hh >= 12 ? 'PM' : 'AM';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, '0')} ${ap}`;
}

function setTime(val) {
  state.timeOfDay = val;
  const slider = document.getElementById('time-range');
  if (slider) slider.value = val;
  document.getElementById('time-display').innerText = formatTime(val);
}

function setWeather(type) {
  state.currentWeather = type;
  document.querySelectorAll('.btn-weather').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.weather === type);
  });

  env.rainTarget = type === 'rain' ? 1 : 0;
  if (type === 'sunset') setTime(17.6);
  else if (type === 'night') setTime(22.5);
  else if (type === 'sunny' && (state.timeOfDay < 7.5 || state.timeOfDay > 16.5)) setTime(12);
  else if (type === 'rain' && (state.timeOfDay < 6.5 || state.timeOfDay > 19)) setTime(15);
}

// --- Web Audio Synthesizer: wind, river, rain, birds, crickets ---
let audioCtx, audioNodes = null;
function noiseBuffer(ctx, secs) {
  const b = ctx.createBuffer(1, ctx.sampleRate * secs, ctx.sampleRate);
  const d = b.getChannelData(0);
  let last = 0;
  for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.04 * w) / 1.04; d[i] = w * 0.5 + last * 3; }
  return b;
}

function initAudioSynth() {
  const btn = document.getElementById('btn-audio-toggle');
  document.getElementById('audio-icon').innerText = '🔇';
  btn.addEventListener('click', () => {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      startSoundscape();
    }
    state.audioMuted = !state.audioMuted;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    audioNodes.master.gain.setTargetAtTime(state.audioMuted ? 0 : 0.9, audioCtx.currentTime, 0.2);
    btn.classList.toggle('active', !state.audioMuted);
    document.getElementById('audio-icon').innerText = state.audioMuted ? '🔇' : '🔊';
  });
}

function startSoundscape() {
  const ctx = audioCtx;
  const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  const nb = noiseBuffer(ctx, 3);
  function loop(filterType, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = nb; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q || 0.7;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master); src.start();
    return { g: g, f: f };
  }
  const wind = loop('lowpass', 420, 0.6), river = loop('bandpass', 1100, 0.4), fall = loop('bandpass', 2400, 0.3), rainN = loop('highpass', 2500, 0.5);
  // Crickets: amplitude-modulated high tone
  const cr = ctx.createOscillator(); cr.type = 'sine'; cr.frequency.value = 4300;
  const crg = ctx.createGain(); crg.gain.value = 0;
  const lfo = ctx.createOscillator(); lfo.frequency.value = 14;
  const lfoG = ctx.createGain(); lfoG.gain.value = 0.5;
  const crMod = ctx.createGain(); crMod.gain.value = 0.5;
  lfo.connect(lfoG); lfoG.connect(crMod.gain); cr.connect(crMod); crMod.connect(crg); crg.connect(master);
  cr.start(); lfo.start();
  audioNodes = { master: master, wind: wind, river: river, fall: fall, rain: rainN, crick: crg };

  // Bird chirps
  setInterval(() => {
    if (state.audioMuted || env.day < 0.4 || env.rain > 0.5 || Math.random() < 0.5) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    const base = 2200 + Math.random() * 1800;
    for (let i = 0; i < 3; i++) o.frequency.setValueAtTime(base * (1 + (Math.random() - 0.4) * 0.5), t + i * 0.09);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05, t + 0.02); g.gain.linearRampToValueAtTime(0, t + 0.3);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.35);
  }, 1400);

  setInterval(updateSoundscape, 250);
}

function updateSoundscape() {
  if (!audioNodes || !playerMesh) return;
  const t = audioCtx.currentTime, p = state.playerPos;
  const dRiver = Math.max(0, Math.abs(p.x) - 12);
  const wf = LANDMARKS.waterfall.pos;
  const dFall = Math.hypot(p.x - wf.x, p.z - (wf.z + 12));
  audioNodes.wind.g.gain.setTargetAtTime(0.06 + 0.05 * Math.sin(clock.t * 0.3) + p.y * 0.002, t, 0.5);
  audioNodes.river.g.gain.setTargetAtTime(0.16 * Math.exp(-dRiver / 35), t, 0.4);
  audioNodes.fall.g.gain.setTargetAtTime(0.5 * Math.exp(-dFall / 40), t, 0.4);
  audioNodes.rain.g.gain.setTargetAtTime(0.22 * env.rain, t, 0.6);
  audioNodes.crick.g.gain.setTargetAtTime(0.012 * clamp((env.night - 0.3) * 1.5, 0, 1) * (1 - env.rain), t, 0.8);
}

// --- Event Listeners Setup ---
function setupEventListeners() {
  // Keypress tracking (ignore while typing in chat)
  const typing = (e) => e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA');
  window.addEventListener('keydown', (e) => {
    if (typing(e)) return;
    if (mapModalOpen) { if (e.code === 'Escape') closeFullMap(); return; }
    keyState[e.code] = true;
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'KeyE' && !e.repeat) interactNearest();
  });
  window.addEventListener('keyup', (e) => { keyState[e.code] = false; });
  window.addEventListener('blur', () => { for (const k in keyState) keyState[k] = false; });

  // Mouse look: drag to orbit, wheel to zoom
  const cont = document.getElementById('canvas-container');
  let lx = 0, ly = 0;
  cont.addEventListener('mousedown', (e) => { if (state.driving || state.ridingTrain) return; camRig.dragging = true; lx = e.clientX; ly = e.clientY; });
  window.addEventListener('mouseup', () => { camRig.dragging = false; });
  window.addEventListener('mousemove', (e) => {
    if (!camRig.dragging) return;
    camRig.yaw -= (e.clientX - lx) * 0.005;
    camRig.pitch = clamp(camRig.pitch + (e.clientY - ly) * 0.004, 0.04, 1.35);
    lx = e.clientX; ly = e.clientY;
    camRig.idleTime = 0;
  });
  cont.addEventListener('wheel', (e) => {
    camRig.distTarget = clamp(camRig.distTarget + Math.sign(e.deltaY) * 2.5, 6, 60);
    e.preventDefault();
  }, { passive: false });

  // Fast Travel Teleport Buttons
  document.querySelectorAll('.btn-teleport').forEach(btn => {
    btn.addEventListener('click', () => {
      const locKey = btn.dataset.location;
      if (LANDMARKS[locKey] && playerMesh) {
        const target = LANDMARKS[locKey].pos;
        const off = TELEPORT[locKey] || { dx: 0, dz: 10 };
        const x = target.x + off.dx, z = target.z + off.dz;
        const g = groundHeight(x, z);
        const pm = playerMesh.parent;
        pm.position.set(x, g, z);
        state.playerPos.x = x; state.playerPos.y = g; state.playerPos.z = z;
        state.playerVelocity.y = 0; state.isGrounded = true;
        camRig.yaw = 0;
      }
    });
  });

  // Weather Buttons
  document.querySelectorAll('.btn-weather').forEach(btn => {
    btn.addEventListener('click', () => setWeather(btn.dataset.weather));
  });

  // Time Slider
  document.getElementById('time-range').addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    state.timeOfDay = val;
    document.getElementById('time-display').innerText = formatTime(val);
  });

  // Camera Toggle Button
  document.getElementById('btn-camera-mode').addEventListener('click', () => {
    state.isCameraOrbit = !state.isCameraOrbit;
    const btn = document.getElementById('btn-camera-mode');
    btn.classList.toggle('active', !state.isCameraOrbit);
    document.getElementById('camera-icon').innerText = state.isCameraOrbit ? '🎥' : '👤';
    if (state.isCameraOrbit) { camRig.pitch = 0.36; camRig.distTarget = 16; }
    else { camRig.pitch = 0.22; camRig.distTarget = 9; }
  });

  // Godot Code Inspector Modal
  const modal = document.getElementById('godot-modal');
  document.getElementById('btn-godot-inspector').addEventListener('click', () => {
    modal.classList.add('open');
    loadGodotFile('GameManager.gd');
  });
  document.getElementById('btn-close-modal').addEventListener('click', () => {
    modal.classList.remove('open');
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadGodotFile(btn.dataset.file);
    });
  });

  // Full World Map Modal
  const mapModal = document.getElementById('map-modal');
  const btnMaxMap = document.getElementById('btn-maximize-map');
  if (btnMaxMap) btnMaxMap.addEventListener('click', openFullMap);
  document.getElementById('btn-close-map').addEventListener('click', closeFullMap);
  mapModal.addEventListener('click', (e) => { if (e.target === mapModal) closeFullMap(); });

  // Initial time display
  document.getElementById('time-display').innerText = formatTime(state.timeOfDay);
}

// ---------------------------------------------------------------------------
// Driving: cars, motorcycles (bikes) and buses. VEHICLES is built in town.js;
// each entry is { type, g (THREE.Group), x, z, yaw, spd, collider, radius, mover, occupied }.
// ---------------------------------------------------------------------------
const VEH_SPECS = {
  car: { max: 24, acc: 16, turn: 2.0, camDist: 15 },
  bike: { max: 28, acc: 20, turn: 2.9, camDist: 11 },
  bus: { max: 15, acc: 7, turn: 1.0, camDist: 22 }
};
const ENTER_RANGE = 3.5;

function nearestFreeVehicle() {
  if (typeof VEHICLES === 'undefined') return null;
  let best = null, bd = 1e9;
  for (let i = 0; i < VEHICLES.length; i++) {
    const v = VEHICLES[i];
    if (v.occupied) continue;
    // Still under script control (traffic loop): its x/z fields are only a stale placeholder, so
    // check against its live transform instead.
    const vx = v.mover ? v.g.position.x : v.x, vz = v.mover ? v.g.position.z : v.z;
    const d = Math.hypot(state.playerPos.x - vx, state.playerPos.z - vz);
    if (d < bd) { bd = d; best = v; }
  }
  return best && bd < best.radius + ENTER_RANGE ? best : null;
}

function tryEnterVehicle() {
  const v = nearestFreeVehicle();
  if (!v) return false;
  enterVehicle(v);
  return true;
}

function enterVehicle(v) {
  if (v.mover) {
    // Hand off from the scripted traffic loop to the player, keeping its current speed/heading.
    v.x = v.g.position.x; v.z = v.g.position.z; v.yaw = v.g.rotation.y;
    v.spd = v.mover.dir * v.mover.sp;
    const idx = TOWN_ANIM.movers.indexOf(v.mover);
    if (idx >= 0) TOWN_ANIM.movers.splice(idx, 1);
    v.mover = null;
  } else if (v.collider) {
    removeCircleCollider(v.collider);
    v.collider = null;
  }
  v.occupied = true;
  state.driving = v;
  playerMesh.parent.visible = false;
  camRig._savedDist = camRig.distTarget;
  camRig.distTarget = (VEH_SPECS[v.type] || VEH_SPECS.car).camDist;
  camRig.yaw = v.yaw + Math.PI;   // snap straight in behind it - see updateCamera for the ongoing lock
  const icon = v.type === 'bus' ? '🚌' : v.type === 'bike' ? '🏍️' : '🚗';
  triggerLandmarkPopup(icon + ' Driving', 'WASD to steer, SPACE to brake, E to get out.');
}

function exitVehicle() {
  const v = state.driving;
  if (!v) return;
  v.occupied = false;
  v.spd = 0;
  v.collider = addCircleCollider(v.x, v.z, v.radius);
  const ex = v.x + Math.cos(v.yaw) * (v.radius + 1.1), ez = v.z - Math.sin(v.yaw) * (v.radius + 1.1);
  const g = groundHeight(ex, ez);
  playerMesh.parent.visible = true;
  playerMesh.parent.position.set(ex, g, ez);
  state.playerPos.x = ex; state.playerPos.y = g; state.playerPos.z = ez;
  state.playerVelocity.y = 0; state.isGrounded = true;
  camRig.distTarget = camRig._savedDist || 16;
  state.driving = null;
  triggerLandmarkPopup('🚶 On foot', 'You parked the vehicle. Walk up to any vehicle and press E to drive it.');
}

function updateVehicleDriving(dt) {
  const v = state.driving;
  const s = VEH_SPECS[v.type] || VEH_SPECS.car;
  let inF = 0, inR = 0;
  if (keyState['KeyW'] || keyState['ArrowUp']) inF += 1;
  if (keyState['KeyS'] || keyState['ArrowDown']) inF -= 1;
  if (keyState['KeyD'] || keyState['ArrowRight']) inR -= 1;
  if (keyState['KeyA'] || keyState['ArrowLeft']) inR += 1;

  if (keyState['Space']) v.spd += (0 - v.spd) * Math.min(1, dt * 6);
  else if (inF > 0) v.spd = Math.min(s.max, v.spd + s.acc * dt);
  else if (inF < 0) v.spd = Math.max(-s.max * 0.5, v.spd - s.acc * dt);
  else v.spd += (0 - v.spd) * Math.min(1, dt * 1.6);

  if (inR !== 0 && Math.abs(v.spd) > 0.15) {
    const turnDir = v.spd >= 0 ? 1 : -1;
    const speedFactor = Math.min(1, Math.abs(v.spd) / (s.max * 0.4));
    v.yaw += inR * s.turn * dt * turnDir * speedFactor;
  }

  v.x += Math.sin(v.yaw) * v.spd * dt;
  v.z += Math.cos(v.yaw) * v.spd * dt;
  const lim = WORLD_SIZE / 2 - 10;
  v.x = clamp(v.x, -lim, lim); v.z = clamp(v.z, -lim, lim);

  const pos = { x: v.x, z: v.z };
  resolveCollisions(pos, v.radius);
  if (Math.abs(pos.x - v.x) > 1e-4 || Math.abs(pos.z - v.z) > 1e-4) v.spd *= 0.55;
  v.x = pos.x; v.z = pos.z;

  const gy = groundHeight(v.x, v.z);
  v.g.position.set(v.x, gy + ROAD_Y, v.z);
  v.g.rotation.y = v.yaw;

  const parent = playerMesh.parent;
  parent.position.set(v.x, gy + 1.0, v.z);
  state.playerPos.x = v.x; state.playerPos.y = gy + 1.0; state.playerPos.z = v.z;
  camRig.idleTime = 0;
  document.getElementById('coords-text').innerText = `X: ${Math.round(v.x)} | Z: ${Math.round(v.z)}`;
}

// ---------------------------------------------------------------------------
// The train: 6 stops (STATIONS, world.js). Board/exit only while it is dwelling at a station.
// ---------------------------------------------------------------------------
const TRAIN_BOARD_RANGE = 10;

function tryBoardTrain() {
  if (!ANIM.train || TRAIN_STATE.state !== 'dwell') return false;
  const st = STATIONS[TRAIN_STATE.i];
  const d = Math.hypot(state.playerPos.x - st.board, state.playerPos.z - st.z);
  if (d > TRAIN_BOARD_RANGE) return false;
  boardTrain(st);
  return true;
}

function boardTrain(st) {
  state.ridingTrain = true;
  playerMesh.parent.visible = false;
  camRig._savedDist = camRig.distTarget;
  camRig.distTarget = 22;
  camRig.yaw = Math.PI;   // snap straight in behind it (the train always travels toward +z)
  const next = STATIONS[(TRAIN_STATE.i + 1) % STATIONS.length];
  triggerLandmarkPopup('🚆 Boarded the train', 'Riding towards ' + next.name + '. Press E to get off at any stop.');
}

function tryExitTrain() {
  if (TRAIN_STATE.state !== 'dwell') {
    triggerLandmarkPopup('🚆 Still moving', 'Wait for the train to stop at a station before getting off.');
    return;
  }
  const st = STATIONS[TRAIN_STATE.i];
  state.ridingTrain = false;
  playerMesh.parent.visible = true;
  const ex = st.board, ez = st.z;
  const g = groundHeight(ex, ez);
  playerMesh.parent.position.set(ex, g, ez);
  state.playerPos.x = ex; state.playerPos.y = g; state.playerPos.z = ez;
  state.playerVelocity.y = 0; state.isGrounded = true;
  camRig.distTarget = camRig._savedDist || 16;
  triggerLandmarkPopup('🚉 ' + st.name, 'You got off the train. Press E near the train when it stops here again to ride on.');
}

function updateRidingTrain(dt) {
  const wx = RAIL_X + 0.4, wy = RAIL_H + 2.7, wz = ANIM.train ? ANIM.train.position.z : state.playerPos.z;
  playerMesh.parent.position.set(wx, wy, wz);
  state.playerPos.x = wx; state.playerPos.y = wy; state.playerPos.z = wz;
  camRig.idleTime = 0;
  document.getElementById('coords-text').innerText = `X: ${Math.round(wx)} | Z: ${Math.round(wz)}`;
}

// E key: drive/exit a vehicle, board/exit the train, or show the info card of the closest landmark
function interactNearest() {
  if (state.driving) { exitVehicle(); return; }
  if (state.ridingTrain) { tryExitTrain(); return; }
  if (tryBoardTrain()) return;
  if (tryEnterVehicle()) return;

  let best = null, bd = 1e9;
  for (const key in LANDMARKS) {
    const lm = LANDMARKS[key];
    const d = Math.hypot(state.playerPos.x - lm.pos.x, state.playerPos.z - lm.pos.z);
    if (d < bd) { bd = d; best = lm; }
  }
  if (best && bd < best.radius * 1.4) triggerLandmarkPopup(best.name, best.desc);
}

// Load Godot Files Into Inspector Modal
function loadGodotFile(filename) {
  const viewer = document.getElementById('code-viewer-content');
  const godotFiles = {
    'GameManager.gd': `extends Node\nsignal score_updated(new_score: int)\nsignal location_discovered(location_name: String)\n\nvar player_name: String = "Explorer"\nvar current_score: int = 0\nvar discovered_locations: Array = []\n\nfunc discover_location(loc_name: String):\n\tif not discovered_locations.has(loc_name):\n\t\tdiscovered_locations.append(loc_name)\n\t\tadd_score(100)`,
    'PlayerController.gd': `extends CharacterBody3D\nconst SPEED = 7.0\nconst JUMP_VELOCITY = 4.5\nvar gravity = ProjectSettings.get_setting("physics/3d/default_gravity")\n\nfunc _physics_process(delta):\n\tif not is_on_floor():\n\t\tvelocity.y -= gravity * delta\n\tmove_and_slide()`,
    'QuestManager.gd': `extends Node\nvar quests = {\n\t"quest_conolly": {"title": "The Teak Heritage", "reward_points": 250},\n\t"quest_bridge": {"title": "Cross the Chaliyar", "reward_points": 150}\n}`,
    'MultiplayerManager.gd': `extends Node\nconst DEFAULT_PORT = 7000\nvar peer: ENetMultiplayerPeer\n\nfunc host_game():\n\tpeer = ENetMultiplayerPeer.new()\n\tpeer.create_server(DEFAULT_PORT, 32)`,
    'project.godot': `[application]\nconfig/name="NilamburWorld"\nconfig/description="An open-world exploration and multiplayer game set in Nilambur, Malappuram, Kerala, India."\nrun/main_scene="res://scenes/MainMenu.tscn"`
  };

  viewer.innerText = godotFiles[filename] || `# File ${filename} loaded.`;
}

function onWindowResize() {
  if (!camera) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

// Start Engine when window loads
window.addEventListener('load', init);
