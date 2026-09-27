/**
 * football.js - the 5-a-side football ground at (658, 403): the pitch, boards, goals, floodlights and a
 * live scoreboard, plus the client side of the match run by the server (football_server.js):
 * the queue panel, the ball, team jerseys, kickoff positions and the controls -
 *   F  pass (auto-aims at the teammate you're facing; tap = short, hold = long lofted ball)
 *   Q  shoot (hold to charge, release to shoot at the goal you're facing)
 *   C  tackle (poke the ball away from an opponent)
 * Dribbling is just running with the ball at your feet. Needs the multiplayer server (online play).
 */

const FB = { cx: 658, cz: 403, hx: 20, hz: 12, goalHalf: 1.6, goalH: 2.0, y: 3.45 };
const FB_TEAM = [{ name: 'Nilambur Blues', color: 0x1f5fd8, css: '#3d7bff' }, { name: 'Chaliyar Reds', color: 0xd8321f, css: '#ff5a45' }];
const fbState = { ph: 'idle', sc: [0, 0], tl: 420, cd: 0, a: [], bt: [], q: [], lt: '', min: 6, max: 10, ball: null, recvAt: 0 };
let fbBall = null, fbBoard = null, fbBoardCtx = null, fbBoardKey = '';

// ======================================================================================================
// The ground
// ======================================================================================================
function pitchTexture() {
  const PX = 40, W = 48 * PX, H = 32 * PX;            // 48 x 32 m surface incl. 4 m run-off each way
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  for (let i = 0; i < 16; i++) { x.fillStyle = i % 2 ? '#2f8a3a' : '#35963f'; x.fillRect(i * W / 16, 0, W / 16 + 1, H); }
  const m = (v) => v * PX, ox = 4, oz = 4;                 // pitch origin (top-left of the 40 x 24 field)
  x.strokeStyle = 'rgba(255,255,255,0.92)'; x.lineWidth = 0.1 * PX;
  x.strokeRect(m(ox), m(oz), m(40), m(24));
  x.beginPath(); x.moveTo(m(ox + 20), m(oz)); x.lineTo(m(ox + 20), m(oz + 24)); x.stroke();
  x.beginPath(); x.arc(m(ox + 20), m(oz + 12), m(3), 0, Math.PI * 2); x.stroke();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(m(ox + 20), m(oz + 12), m(0.15), 0, Math.PI * 2); x.fill();
  for (const s of [0, 1]) {                                // 6 m penalty arcs + spots, like futsal
    const gx = s ? ox + 40 : ox, dir = s ? -1 : 1;
    x.beginPath();
    x.arc(m(gx), m(oz + 12 - 1.6), m(6), s ? Math.PI / 2 : -Math.PI / 2, s ? Math.PI : 0, !!s);
    x.lineTo(m(gx + dir * 6), m(oz + 12 + 1.6));
    x.arc(m(gx), m(oz + 12 + 1.6), m(6), s ? Math.PI : 0, s ? Math.PI * 1.5 : Math.PI / 2, !!s);
    x.stroke();
    x.beginPath(); x.arc(m(gx + dir * 6), m(oz + 12), m(0.12), 0, Math.PI * 2); x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding;   // canvas colours are sRGB
  return t;
}
function ballTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#f7f7f2'; x.fillRect(0, 0, 256, 128);
  x.fillStyle = '#16181a';
  for (let i = 0; i < 12; i++) {
    const cx = (i % 6) * 43 + (i < 6 ? 10 : 32), cy = i < 6 ? 34 : 94;
    x.beginPath();
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2 - Math.PI / 2; x.lineTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11); }
    x.fill();
  }
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
  return t;
}
function buildFootballGround() {
  const F = frameAt(FB.cx, FB.y, FB.cz, 0);
  GROUND_EXTRAS.push((x, z) => (Math.abs(x - FB.cx) < 26.5 && Math.abs(z - FB.cz) < 18.5) ? FB.y : null);
  // base slab + concrete walkway around, turf on top
  F.box('conc', 53, 1.2, 37, 0, -0.6, 0, 0xa19d92);
  const turf = new THREE.Mesh(new THREE.PlaneGeometry(48, 32), new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.95 }));
  turf.rotation.x = -Math.PI / 2; turf.position.set(FB.cx, FB.y + 0.012, FB.cz); turf.receiveShadow = true;
  scene.add(turf);
  // boards (1 m, sponsor-painted) around the field, open at the goal mouths and at two player gates
  const boardCols = [0xf2f2ee, 0x1f5fd8, 0xffd54f, 0xd8321f];
  const board = (x0, x1, z0, z1) => {
    const w = Math.max(0.12, x1 - x0), d = Math.max(0.12, z1 - z0), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    F.box('paint', w, 1.0, d, cx, 0.5, cz, boardCols[Math.abs(Math.round(cx + cz)) % boardCols.length]);
    F.col(cx, cz, w / 2, d / 2);
  };
  const hx = FB.hx, hz = FB.hz, g = FB.goalHalf;
  for (let x = -hx; x < hx; x += 8) board(x, x + 8, -hz - 0.12, -hz);                       // north side
  for (let x = -hx; x < hx; x += 8) {                                                           // south side with gates at x = ±17..±15.6
    const a = x, b = x + 8;
    if (a < -15.6 && b > -17) { board(a, -17, hz, hz + 0.12); board(-15.6, b, hz, hz + 0.12); }
    else if (a < 17 && b > 15.6) { board(a, 15.6, hz, hz + 0.12); board(17, b, hz, hz + 0.12); }
    else board(a, b, hz, hz + 0.12);
  }
  for (const s of [-1, 1]) {                                                                    // ends, leaving the goal mouth
    board(s > 0 ? hx : -hx - 0.12, s > 0 ? hx + 0.12 : -hx, -hz, -g);
    board(s > 0 ? hx : -hx - 0.12, s > 0 ? hx + 0.12 : -hx, g, hz);
  }
  // goals: posts, crossbar, net box
  const net = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, roughness: 1 });
  for (const s of [-1, 1]) {
    const gx = s * hx;
    for (const pz of [-g, g]) F.cyl('paint', 0.06, 0.06, FB.goalH, gx, FB.goalH / 2, pz, 0xffffff, 10);
    F.cyl('paint', 0.06, 0.06, 2 * g + 0.12, gx, FB.goalH, 0, 0xffffff, 10, Math.PI / 2);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2 * g, FB.goalH), net); back.rotation.y = Math.PI / 2; back.position.set(FB.cx + gx + s * 1.0, FB.y + FB.goalH / 2, FB.cz); scene.add(back);
    for (const pz of [-g, g]) { const side = new THREE.Mesh(new THREE.PlaneGeometry(1.0, FB.goalH), net); side.position.set(FB.cx + gx + s * 0.5, FB.y + FB.goalH / 2, FB.cz + pz); scene.add(side); }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2 * g), net); top.rotation.x = -Math.PI / 2; top.position.set(FB.cx + gx + s * 0.5, FB.y + FB.goalH, FB.cz); scene.add(top);
    F.col(gx + s * 1.05, 0, 0.08, g + 0.1);
    for (const pz of [-g, g]) F.col(gx + s * 0.5, pz, 0.55, 0.08);
  }
  // floodlights
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    F.cyl('metal', 0.14, 0.2, 13, sx * 24.5, 6.5, sz * 16.5, 0x9aa0a6, 8);
    F.box('metal', 2.2, 1.0, 0.4, sx * 24.2, 13.2, sz * 16.2, 0x3a3f45, 0, sx * sz > 0 ? -0.6 : 0.6);
    F.box('lamp', 2.0, 0.8, 0.05, sx * 24.0, 13.2, sz * 16.0, 0xfff6d8, 0, sx * sz > 0 ? -0.6 : 0.6);
  }
  // team benches on the south walkway, a small stand on the north side
  for (const s of [-1, 1]) {
    F.box('wood', 5, 0.1, 0.5, s * 8, 0.45, hz + 2.4, s < 0 ? 0x1f5fd8 : 0xd8321f); F.box('metal', 5, 0.45, 0.08, s * 8, 0.22, hz + 2.4, 0x4a4f55);
    F.box('paint', 5.2, 1.6, 0.06, s * 8, 1.1, hz + 2.75, 0xd8dde2);
  }
  for (let r = 0; r < 3; r++) F.box('conc', 30, 0.45, 0.9, 0, 0.22 + r * 0.45, -hz - 2.2 - r * 0.9, 0xb8b4aa);
  F.col(0, -hz - 3.1, 15, 1.4);
  const I = frame(F.bx, F.by, F.bz, 0, 1, 'int');
  for (let i = 0; i < 9; i++) npc(sub(I, -12 + i * 3.1, -hz - 2.2 - (i % 3) * 0.9, 0, 0.45 + (i % 3) * 0.45), 0, 0, 0, 0, { sit: true, seat: 0.0, pose: i % 2 ? 'up' : 'lap' });
  // Scoreboard on poles above the stand
  const sb = document.createElement('canvas'); sb.width = 512; sb.height = 160;
  fbBoardCtx = sb.getContext('2d');
  fbBoard = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.5), new THREE.MeshBasicMaterial({ map: (() => { const t = new THREE.CanvasTexture(sb); t.encoding = THREE.sRGBEncoding; return t; })(), side: THREE.DoubleSide }));
  fbBoard.position.set(FB.cx, FB.y + 7.5, FB.cz - hz - 6);
  scene.add(fbBoard);
  for (const sx of [-1, 1]) F.cyl('metal', 0.12, 0.12, 7, sx * 3.6, 3.5, -hz - 6.1, 0x6a7078, 8);
  F.box('paint', 8.3, 2.8, 0.15, 0, 7.5, -hz - 6.15, 0x14161a);
  townSign(F, ['NILAMBUR FOOTBALL GROUND', '5-a-side · 7-minute matches'], 0, 2.4, hz + 3.0, 7, { bg: '#0f3d1f', fg: '#ffffff', border: '#ffd54f' });
  for (const sx of [-1, 1]) F.cyl('metal', 0.08, 0.08, 2.4, sx * 3.3, 1.2, hz + 3.0, 0x6a7078, 8);
  addSpot(I, 0, 0, hz + 2.0, '⚽', 'Join / leave the football queue', () => { fbToggleQueue(); return null; }, 4);
  // the ball
  fbBall = new THREE.Mesh(new THREE.SphereGeometry(0.11, 18, 12), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.5 }));
  fbBall.castShadow = true;
  fbBall.position.set(FB.cx, FB.y + 0.11, FB.cz);
  scene.add(fbBall);
  drawScoreboard(true);
}

// ======================================================================================================
// Match state from the server
// ======================================================================================================
function fbMyTeam() { const n = window.NW && NW.name; return fbState.a.includes(n) ? 0 : fbState.bt.includes(n) ? 1 : -1; }
function fbPlaying() { return (fbState.ph === 'playing' || fbState.ph === 'goal') && fbMyTeam() >= 0; }
function onFootballMsg(m) {
  if (m.t === 'fb') {
    Object.assign(fbState, { ph: m.ph, sc: m.sc, tl: m.tl, cd: m.cd, a: m.a || [], bt: m.bt || [], q: m.q || [], lt: m.lt, min: m.min, max: m.max });
    fbState.ball = m.b; fbState.recvAt = performance.now();
    applyJerseys();
    renderFootballUI();
    return;
  }
  // events
  const me = window.NW && NW.name;
  if ((m.e === 'start' || m.e === 'kickoff' || m.e === 'sub') && m.spots && m.spots[me]) {
    const s = m.spots[me];
    if (m.e !== 'sub' || m.in === me) fbTeleport(s[0], s[1], s[2]);
  }
  const T = (i) => FB_TEAM[i].name;
  if (m.e === 'start') { fbToast('⚽ Kick-off!', 'Blues vs Reds - 7 minutes. F pass, hold Q to shoot, C to tackle.'); whistle(2); }
  if (m.e === 'goal') {
    fbToast('⚽ GOAL! ' + T(m.team), (m.by ? (m.own ? 'Own goal by ' : 'Scored by ') + m.by + ' - ' : '') + m.sc[0] + ' : ' + m.sc[1]);
    whistle(1);
    if (m.by === me && !m.own && typeof earnCash === 'function') earnCash(50);
  }
  if (m.e === 'sub') fbToast('🔁 Substitution', m.in + ' comes on for ' + m.out + '.');
  if (m.e === 'end') {
    whistle(3);
    const res = m.winner < 0 ? 'Draw' : T(m.winner) + ' win';
    fbToast('🏁 Full time: ' + res, m.sc[0] + ' : ' + m.sc[1] + (m.reason === 'forfeit' ? ' (a team ran out of players)' : '') + '. Next match starts with the players in the queue.');
    const mine = (m.a || []).includes(me) ? 0 : (m.b || []).includes(me) ? 1 : -1;
    if (mine >= 0 && typeof earnCash === 'function') earnCash(m.winner < 0 ? 200 : m.winner === mine ? 300 : 120);   // match fee
  }
}
function fbToast(title, text) { if (typeof triggerLandmarkPopup === 'function') triggerLandmarkPopup(title, text); }
function whistle(n) { if (typeof chime !== 'function') return; for (let i = 0; i < n; i++) setTimeout(() => chime([2093, 2349], 0.25), i * 320); }
function fbTeleport(x, z, team) {
  if (state.driving && typeof exitVehicle === 'function') exitVehicle();
  const p = playerMesh.parent;
  p.position.set(x, FB.y, z);
  state.playerPos.x = x; state.playerPos.y = FB.y; state.playerPos.z = z;
  state.playerVelocity.y = 0; state.isGrounded = true;
  const face = team === 0 ? Math.PI / 2 : -Math.PI / 2;     // face the goal you attack
  playerMesh.rotation.y = face; camRig.yaw = face + Math.PI;
}
function fbToggleQueue() {
  if (!(window.NW && NW.connected)) { fbToast('⚽ Football', 'Matches are played online with other explorers - reload and choose "Play online" to join the queue.'); return; }
  const n = NW.name;
  if (fbState.q.includes(n) || fbMyTeam() >= 0) NW.send({ t: 'fb_leave' });
  else NW.send({ t: 'fb_join' });
}

// Team jerseys over the players' shirts (local player and everyone else's avatar)
const _jerseyMat = FB_TEAM.map(t => new THREE.MeshStandardMaterial({ color: t.color, roughness: 0.7 }));
let _jerseyGeo = null;
function setJersey(rig, team) {
  if (!rig || !rig.torso) return;
  if (rig._jerseyTeam === team) return;
  if (rig._jersey) { rig.torso.remove(rig._jersey); rig._jersey = null; }
  rig._jerseyTeam = team;
  if (team < 0) return;
  _jerseyGeo = _jerseyGeo || new THREE.CapsuleGeometry(0.2, 0.28, 4, 12);
  const j = new THREE.Mesh(_jerseyGeo, _jerseyMat[team]); j.position.y = 0.43; j.castShadow = true;
  rig.torso.add(j); rig._jersey = j;
}
function applyJerseys() {
  const on = fbState.ph === 'playing' || fbState.ph === 'goal' || fbState.ph === 'ended';
  const teamOf = (n) => !on ? -1 : fbState.a.includes(n) ? 0 : fbState.bt.includes(n) ? 1 : -1;
  if (typeof playerRig !== 'undefined' && window.NW) setJersey(playerRig, teamOf(NW.name));
  if (window.NW && NW.remote) NW.remote.forEach((r, name) => setJersey(r.av, teamOf(name)));
}

// ======================================================================================================
// Controls
// ======================================================================================================
let _qDown = 0, _fDown = 0;
function fbPos(name) {
  if (window.NW && name === NW.name) return state.playerPos;
  const r = window.NW && NW.remote.get(name); return r ? r.av.root.position : null;
}
function fbKick(kind, power) {
  if (!fbPlaying()) return;
  const f = playerMesh.rotation.y, fx = Math.sin(f), fz = Math.cos(f), me = state.playerPos, my = fbMyTeam();
  let dx = fx, dz = fz;
  if (kind === 'pass') {
    // the teammate closest to where you're facing (within 50 degrees)
    let best = null, bs = -1;
    (my === 0 ? fbState.a : fbState.bt).forEach(n => {
      if (n === NW.name) return; const p = fbPos(n); if (!p) return;
      const vx = p.x - me.x, vz = p.z - me.z, d = Math.hypot(vx, vz); if (d < 1.5) return;
      const cos = (vx * fx + vz * fz) / d;
      if (cos > 0.64 && cos * 30 - d * 0.3 > bs) { bs = cos * 30 - d * 0.3; best = { vx: vx / d, vz: vz / d, d: d }; }
    });
    if (best) { dx = best.vx; dz = best.vz; if (power < 0.3) power = Math.min(0.8, best.d / 30); }
  } else {
    // shooting: aim inside the goal you're facing, left or right post depending on your angle
    const gx = FB.cx + (my === 0 ? FB.hx : -FB.hx), gz = FB.cz;
    const vx = gx - me.x, vz = gz - me.z, d = Math.hypot(vx, vz);
    if ((vx * fx + vz * fz) / d > 0.3) {
      const side = (fx * vz - fz * vx) > 0 ? -1 : 1;
      const tz = gz + side * FB.goalHalf * 0.55;
      const ax = gx - me.x, az = tz - me.z, L = Math.hypot(ax, az);
      dx = ax / L; dz = az / L;
    }
  }
  NW.send({ t: 'fb_kick', k: kind, dx: +dx.toFixed(3), dz: +dz.toFixed(3), p: +power.toFixed(2) });
}
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') || e.repeat) return;
  if (!fbPlaying()) return;
  if (e.code === 'KeyQ') _qDown = performance.now();
  if (e.code === 'KeyF') _fDown = performance.now();
  if (e.code === 'KeyC') NW.send({ t: 'fb_tackle' });
});
window.addEventListener('keyup', (e) => {
  if (!fbPlaying()) { _qDown = _fDown = 0; return; }
  if (e.code === 'KeyQ' && _qDown) { fbKick('shoot', Math.min(1, (performance.now() - _qDown) / 900)); _qDown = 0; }
  if (e.code === 'KeyF' && _fDown) { fbKick('pass', Math.min(1, (performance.now() - _fDown) / 900)); _fDown = 0; }
});
// Real footballer pace on the pitch instead of the open-world run/sprint (main.js asks for it)
function footballSpeed(sprint) {
  if (!fbPlaying()) return 0;
  const p = state.playerPos;
  if (Math.abs(p.x - FB.cx) > FB.hx + 4 || Math.abs(p.z - FB.cz) > FB.hz + 4) return 0;
  return sprint ? 7.0 : 4.2;
}

// ======================================================================================================
// UI + per-frame
// ======================================================================================================
const fmtClock = (s) => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
function drawScoreboard(force) {
  if (!fbBoardCtx) return;
  const key = fbState.ph + fbState.sc.join() + fbState.tl + fbState.cd + fbState.q.length;
  if (!force && key === fbBoardKey) return;
  fbBoardKey = key;
  const x = fbBoardCtx;
  x.fillStyle = '#0b0d0f'; x.fillRect(0, 0, 512, 160);
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'bold 30px Outfit, sans-serif'; x.fillStyle = FB_TEAM[0].css; x.fillText('BLUES', 90, 42);
  x.fillStyle = FB_TEAM[1].css; x.fillText('REDS', 422, 42);
  x.font = 'bold 76px Outfit, sans-serif'; x.fillStyle = '#ffd54f';
  x.fillText(fbState.sc[0] + ' - ' + fbState.sc[1], 256, 70);
  x.font = 'bold 30px Outfit, sans-serif'; x.fillStyle = '#ffffff';
  const sub = fbState.ph === 'playing' || fbState.ph === 'goal' ? fmtClock(fbState.tl) + (fbState.ph === 'goal' ? '  GOAL!' : '')
    : fbState.ph === 'countdown' ? 'KICK-OFF IN ' + fbState.cd : fbState.ph === 'ended' ? 'FULL TIME'
    : 'QUEUE ' + fbState.q.length + '/' + fbState.min;
  x.fillText(sub, 256, 132);
  fbBoard.material.map.needsUpdate = true;
}
function renderFootballUI() {
  const panel = document.getElementById('fb-panel'), hud = document.getElementById('fb-hud');
  if (!panel) return;
  const me = window.NW && NW.name, myTeam = fbMyTeam(), qi = fbState.q.indexOf(me);
  const p = state.playerPos, near = Math.hypot(p.x - FB.cx, p.z - FB.cz) < 60;
  panel.classList.toggle('show', near || qi >= 0 || myTeam >= 0);
  const E = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x !== undefined) e.textContent = x; return e; };
  const body = document.getElementById('fb-body'); body.textContent = '';
  const status = fbState.ph === 'idle' ? 'Waiting for players: ' + fbState.q.length + ' in the queue, ' + fbState.min + ' needed (3 v 3, up to 5 v 5).'
    : fbState.ph === 'countdown' ? 'Kick-off in ' + fbState.cd + ' s - the first ' + Math.min(fbState.max, fbState.q.length - fbState.q.length % 2) + ' in the queue will play.'
    : fbState.ph === 'ended' ? 'Full time. Next match starts from the queue.'
    : 'Match on: Blues ' + fbState.sc[0] + ' - ' + fbState.sc[1] + ' Reds, ' + fmtClock(fbState.tl) + ' left.';
  body.appendChild(E('div', 'fb-status', status));
  if (fbState.a.length) {
    const t = E('div', 'fb-teams');
    [[fbState.a, 0], [fbState.bt, 1]].forEach(([list, i]) => { const c = E('div', 'fb-team'); c.style.borderColor = FB_TEAM[i].css; c.appendChild(E('b', '', FB_TEAM[i].name)); list.forEach(n => c.appendChild(E('div', n === me ? 'fb-me' : '', n))); t.appendChild(c); });
    body.appendChild(t);
  }
  body.appendChild(E('div', 'fb-qh', 'Queue (next to play)'));
  const q = E('ol', 'fb-queue');
  if (!fbState.q.length) q.appendChild(E('li', 'fb-empty', 'Nobody waiting.'));
  fbState.q.forEach(n => q.appendChild(E('li', n === me ? 'fb-me' : '', n)));
  body.appendChild(q);
  const btn = document.getElementById('fb-join');
  const online = !!(window.NW && NW.connected);
  btn.disabled = !online;
  btn.textContent = !online ? 'Play online to join' : myTeam >= 0 ? 'Leave the match' : qi >= 0 ? 'Leave the queue (#' + (qi + 1) + ')' : 'Join the queue';
  document.getElementById('fb-keys').style.display = myTeam >= 0 ? '' : 'none';
  // scoreboard HUD while a match is on and you're nearby / playing
  const live = fbState.ph !== 'idle' && (near || myTeam >= 0);
  hud.classList.toggle('show', live);
  if (live) {
    hud.textContent = '';
    const s = (t, c) => { const e = E('span', '', t); if (c) e.style.color = c; hud.appendChild(e); };
    s('🟦 Blues ', FB_TEAM[0].css); s(fbState.sc[0] + ' : ' + fbState.sc[1]); s(' Reds 🟥', FB_TEAM[1].css);
    s('  ·  ' + (fbState.ph === 'countdown' ? 'kick-off in ' + fbState.cd + ' s' : fbState.ph === 'ended' ? 'full time' : fmtClock(fbState.tl)));
  }
  drawScoreboard();
}
let _fbUiT = 0;
function footballTick(dt) {
  // ball: extrapolate the last server state with its velocity, then ease towards it
  const b = fbState.ball;
  if (fbBall && b) {
    const age = Math.min(0.25, (performance.now() - fbState.recvAt) / 1000);
    const tx = b[0] + b[3] * age, tz = b[2] + b[5] * age;
    let ty = b[1] + b[4] * age - 4.9 * age * age; ty = Math.max(FB.y + 0.11, ty);
    const k = Math.min(1, dt * 18);
    const px = fbBall.position.x, pz = fbBall.position.z;
    fbBall.position.x += (tx - fbBall.position.x) * k;
    fbBall.position.y += (ty - fbBall.position.y) * k;
    fbBall.position.z += (tz - fbBall.position.z) * k;
    const mx = fbBall.position.x - px, mz = fbBall.position.z - pz, d = Math.hypot(mx, mz);
    if (d > 1e-4) fbBall.rotateOnWorldAxis(new THREE.Vector3(mz / d, 0, -mx / d), d / 0.11);   // roll
  }
  // charge bar while holding Q / F
  const bar = document.getElementById('fb-charge');
  const held = _qDown || _fDown;
  if (bar) {
    bar.classList.toggle('show', !!held && fbPlaying());
    if (held) bar.firstElementChild.style.width = Math.round(Math.min(1, (performance.now() - held) / 900) * 100) + '%';
  }
  _fbUiT += dt;
  if (_fbUiT > 0.5) { _fbUiT = 0; renderFootballUI(); }
}
window.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('fb-join'); if (b) b.addEventListener('click', fbToggleQueue);
});
