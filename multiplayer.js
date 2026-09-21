/**
 * multiplayer.js - client side of the NilamburWorld multiplayer layer.
 *  - minimise buttons on every side panel
 *  - live lobby chat, private (friends-only) chat, friend requests
 *  - other explorers appear in the world with name tags; friends can be joined with one click
 * Talks to server.js over a WebSocket at /ws. Everything shown from the network goes through
 * textContent, never innerHTML.
 */
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }
  };

  const NW = window.NW = {
    connected: false, name: null, friends: [], incoming: [], outgoing: [],
    remote: new Map(), onlineNames: []
  };

  // ------------------------------------------------------------------ minimise buttons
  function initPanels() {
    let saved = {};
    try { saved = JSON.parse(LS.get('nw_collapsed', '{}')) || {}; } catch (e) { saved = {}; }
    document.querySelectorAll('.collapsible').forEach(el => {
      const key = el.dataset.key, head = el.querySelector('.widget-header');
      if (!key || !head) return;
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'btn-min';
      const apply = (c) => { el.classList.toggle('collapsed', c); btn.textContent = c ? '+' : '–'; btn.title = c ? 'Expand' : 'Minimise'; };
      apply(!!saved[key]);
      btn.addEventListener('click', () => {
        const c = !el.classList.contains('collapsed');
        apply(c); saved[key] = c; LS.set('nw_collapsed', JSON.stringify(saved));
      });
      head.appendChild(btn);
    });
  }

  // ------------------------------------------------------------------ chat threads
  const threads = new Map();     // 'lobby' | 'dm:<name>' -> { el, unread, loaded }
  let active = 'lobby';
  const msgBox = $('chat-messages'), tabsBox = $('chat-tabs'), chatInput = $('chat-input');

  function thread(key) {
    let t = threads.get(key);
    if (!t) { t = { el: document.createElement('div'), unread: 0, loaded: false, msgs: [] }; threads.set(key, t); }
    return t;
  }
  function fmtTime(ts) { const d = new Date(ts || Date.now()); return d.getHours().toString().padStart(2, '0') + ':' + d.getMinutes().toString().padStart(2, '0'); }

  function addMsg(key, who, text, opts) {
    opts = opts || {};
    const t = thread(key);
    const row = document.createElement('div');
    row.className = 'chat-msg' + (opts.me ? ' me' : '') + (opts.sys ? ' sys' : '');
    if (opts.sys) row.textContent = text;
    else {
      const w = document.createElement('span'); w.className = 'chat-sender'; w.textContent = who + ':';
      const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = fmtTime(opts.ts);
      row.appendChild(ts); row.appendChild(w); row.appendChild(document.createTextNode(' ' + text));
    }
    t.msgs.push(row);
    if (t.msgs.length > 120) t.msgs.shift();
    if (key === active) { msgBox.appendChild(row); while (msgBox.children.length > 120) msgBox.removeChild(msgBox.firstChild); msgBox.scrollTop = msgBox.scrollHeight; }
    else if (!opts.sys && !opts.me) { t.unread++; renderTabs(); }
  }

  function renderTabs() {
    tabsBox.textContent = '';
    for (const key of threads.keys()) {
      if (key !== 'lobby' && !threads.get(key).open) continue;
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'chat-tab' + (key === active ? ' active' : '');
      b.appendChild(document.createTextNode(key === 'lobby' ? '🌍 Lobby' : '🔒 ' + key.slice(3)));
      const u = threads.get(key).unread;
      if (u > 0) { const bd = document.createElement('span'); bd.className = 'badge'; bd.textContent = u; b.appendChild(bd); }
      if (key !== 'lobby') {
        const x = document.createElement('span'); x.className = 'x'; x.textContent = '×';
        x.addEventListener('click', (e) => { e.stopPropagation(); threads.get(key).open = false; if (active === key) openTab('lobby'); else renderTabs(); });
        b.appendChild(x);
      }
      b.addEventListener('click', () => openTab(key));
      tabsBox.appendChild(b);
    }
  }

  function openTab(key) {
    const t = thread(key);
    if (key !== 'lobby') {
      t.open = true;
      if (!t.loaded && NW.connected) { t.loaded = true; send({ t: 'dm_history', with: key.slice(3) }); }
    }
    active = key; t.unread = 0;
    msgBox.textContent = ''; msgBox.classList.toggle('dm', key !== 'lobby');
    t.msgs.forEach(r => msgBox.appendChild(r));
    msgBox.scrollTop = msgBox.scrollHeight;
    chatInput.placeholder = key === 'lobby' ? 'Say something to everyone...' : 'Private message to ' + key.slice(3) + ' (only they can see it)';
    renderTabs();
  }

  // ------------------------------------------------------------------ toasts
  function toast(text, kind, buttons) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    const sp = document.createElement('span'); sp.textContent = text; el.appendChild(sp);
    (buttons || []).forEach(b => {
      const bt = document.createElement('button'); bt.type = 'button'; bt.textContent = b.label; if (b.no) bt.className = 'no';
      bt.addEventListener('click', () => { b.fn(); el.remove(); });
      el.appendChild(bt);
    });
    $('toast-area').appendChild(el);
    setTimeout(() => el.remove(), buttons && buttons.length ? 14000 : 4500);
  }

  // ------------------------------------------------------------------ socket
  let ws = null, retry = 0, retryTimer = null, wantOnline = false, creds = null, everConnected = false, attempts = 0;
  function send(o) { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); }

  // Where is the game server? ?server=wss://host/ws overrides; the game's own host is used when it runs
  // server.js; a static host (GitHub Pages) looks for a published server.json {"url": "wss://host/ws"}.
  let discovered = '';
  function serverUrl() { return discovered; }
  function discoverServer() {
    const q = new URLSearchParams(location.search).get('server');
    if (q) LS.set('nw_server', q);
    const custom = LS.get('nw_server', '');
    if (custom) return Promise.resolve(custom);
    if (location.protocol === 'file:') return Promise.resolve('');
    if (!/\.github\.io$/.test(location.hostname)) return Promise.resolve((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
    return fetch('server.json?ts=' + Date.now(), { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : null))
      .then(j => (j && typeof j.url === 'string' && /^wss?:\/\//.test(j.url) ? j.url : ''))
      .catch(() => '');
  }

  function setStatus(txt, cls) { const s = $('net-status'); s.textContent = txt; s.className = 'net-status ' + (cls || ''); }

  function connect() {
    clearTimeout(retryTimer);
    const url = serverUrl();
    if (!url) { setStatus('offline (no server)'); addMsg('lobby', '', 'No game server is published for this site yet, so chat and friends are offline. Run "node server.js" (see README) to play with others.', { sys: true }); return; }
    setStatus('connecting…', 'connecting');
    try { ws = new WebSocket(url); } catch (e) { scheduleRetry(); return; }
    ws.onopen = () => { retry = 0; send({ t: 'login', name: creds.name, token: creds.token }); };
    ws.onmessage = (ev) => { let m; try { m = JSON.parse(ev.data); } catch (e) { return; } handle(m); };
    ws.onclose = () => {
      const was = NW.connected;
      NW.connected = false; clearRemote(); renderSocial();
      setStatus(wantOnline ? 'reconnecting…' : 'offline', wantOnline ? 'connecting' : '');
      if (was) addMsg('lobby', '', 'Disconnected from the server. Trying to reconnect…', { sys: true });
      if (wantOnline) scheduleRetry();
    };
    ws.onerror = () => {};
  }
  function scheduleRetry() {
    attempts++;
    if (!everConnected && attempts >= 4) {      // never reached it: the server is probably down
      wantOnline = false; setStatus('offline (server down)');
      addMsg('lobby', '', 'The game server is not reachable right now. Reload the page later to try again.', { sys: true });
      return;
    }
    retry = Math.min(retry + 1, 6); retryTimer = setTimeout(connect, 1000 * retry);
  }

  function handle(m) {
    switch (m.t) {
      case 'welcome':
        NW.connected = true; NW.name = m.name; wantOnline = true; everConnected = true; attempts = 0;
        LS.set('nw_name', m.name);
        setStatus('online', 'online'); $('net-me').textContent = 'You: ' + m.name;
        thread('lobby').msgs = []; if (active === 'lobby') { msgBox.textContent = ''; }
        (m.history || []).forEach(h => addMsg('lobby', h.from, h.text, { ts: h.ts, me: h.from === NW.name }));
        addMsg('lobby', '', 'Welcome, ' + m.name + '! ' + m.online + ' explorer' + (m.online === 1 ? '' : 's') + ' online. Messages here are seen by everyone.', { sys: true });
        threads.forEach((t, k) => { if (k !== 'lobby') t.loaded = false; });
        if (active !== 'lobby') openTab(active);
        break;
      case 'error':
        if (m.code === 'name_taken') { wantOnline = false; showNameDialog(m.text); }
        else if (m.code === 'replaced') { wantOnline = false; addMsg('lobby', '', m.text, { sys: true }); }
        else toast(m.text, 'warn');
        break;
      case 'chat': addMsg('lobby', m.from, m.text, { ts: m.ts, me: m.from === NW.name }); break;
      case 'dm': {
        const other = m.from === NW.name ? m.to : m.from, key = 'dm:' + other, t = thread(key);
        t.loaded = t.loaded || false;
        if (!t.open) { t.open = true; renderTabs(); }
        addMsg(key, m.from, m.text, { ts: m.ts, me: m.from === NW.name });
        if (m.from !== NW.name && active !== key) toast('🔒 ' + m.from + ': ' + m.text.slice(0, 60), 'request', [{ label: 'Open', fn: () => openTab(key) }]);
        break;
      }
      case 'dm_history': {
        const key = 'dm:' + m.with, t = thread(key);
        t.msgs = [];
        m.msgs.forEach(h => {
          const row = document.createElement('div'); row.className = 'chat-msg' + (h.from === NW.name ? ' me' : '');
          const ts = document.createElement('span'); ts.className = 'ts'; ts.textContent = fmtTime(h.ts);
          const w = document.createElement('span'); w.className = 'chat-sender'; w.textContent = h.from + ':';
          row.appendChild(ts); row.appendChild(w); row.appendChild(document.createTextNode(' ' + h.text));
          t.msgs.push(row);
        });
        if (active === key) openTab(key);
        break;
      }
      case 'social':
        NW.friends = m.friends; NW.incoming = m.incoming; NW.outgoing = m.outgoing;
        renderSocial(); break;
      case 'notice':
        if (m.kind === 'request') {
          toast(m.from + ' wants to be your friend.', 'request', [
            { label: 'Accept', fn: () => send({ t: 'friend_respond', from: m.from, accept: true }) },
            { label: 'Decline', no: true, fn: () => send({ t: 'friend_respond', from: m.from, accept: false }) }]);
          addMsg('lobby', '', 'Friend request from ' + m.from + ' (see the Friends panel).', { sys: true });
        } else toast(m.text, m.kind === 'warn' ? 'warn' : '');
        break;
      case 'players': updateRemote(m.list); break;
    }
  }

  // ------------------------------------------------------------------ friends panel
  const isFriend = (n) => NW.friends.some(f => f.name === n);
  function row(cls) { const r = document.createElement('div'); r.className = 'friend-row ' + (cls || ''); return r; }
  function btn(label, title, fn, cls) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.title = title; if (cls) b.className = cls; b.addEventListener('click', fn); return b; }
  function nm(text) { const s = document.createElement('span'); s.className = 'nm'; s.textContent = text; return s; }

  function renderSocial() {
    const req = $('friend-requests'), fl = $('friend-list'), ol = $('online-list');
    req.textContent = ''; fl.textContent = ''; ol.textContent = '';
    NW.incoming.forEach(n => {
      const r = row('friend-req');
      r.appendChild(nm('✉ ' + n + ' wants to be friends'));
      r.appendChild(btn('✔', 'Accept', () => send({ t: 'friend_respond', from: n, accept: true })));
      r.appendChild(btn('✖', 'Decline', () => send({ t: 'friend_respond', from: n, accept: false }), 'no'));
      req.appendChild(r);
    });
    if (!NW.friends.length) { const d = document.createElement('div'); d.className = 'friend-empty'; d.textContent = NW.connected ? 'No friends yet. Add someone by name above.' : 'Go online to add friends.'; fl.appendChild(d); }
    NW.friends.slice().sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name)).forEach(f => {
      const r = row();
      const dot = document.createElement('span'); dot.className = 'dot' + (f.online ? ' on' : ''); r.appendChild(dot);
      r.appendChild(nm(f.name));
      r.appendChild(btn('💬', 'Private chat', () => openTab('dm:' + f.name)));
      if (f.online) r.appendChild(btn('📍', 'Join ' + f.name + ' in the world', () => joinPlayer(f.name)));
      r.appendChild(btn('✖', 'Remove friend', () => { if (confirm('Remove ' + f.name + ' from your friends?')) send({ t: 'friend_remove', name: f.name }); }, 'no'));
      fl.appendChild(r);
    });
    const others = [];
    NW.remote.forEach((_, n) => { if (!isFriend(n)) others.push(n); });
    if (!others.length) { const d = document.createElement('div'); d.className = 'friend-empty'; d.textContent = 'Nobody else is online.'; ol.appendChild(d); }
    others.sort().forEach(n => {
      const r = row(); const dot = document.createElement('span'); dot.className = 'dot on'; r.appendChild(dot); r.appendChild(nm(n));
      if (NW.outgoing.includes(n)) { const p = document.createElement('span'); p.className = 'friend-empty'; p.textContent = 'request sent'; r.appendChild(p); }
      else r.appendChild(btn('＋', 'Send friend request', () => send({ t: 'friend_request', to: n })));
      ol.appendChild(r);
    });
    // friends tab names stay in sync with online state
    renderTabs();
  }

  function joinPlayer(name) {
    const rp = NW.remote.get(name);
    if (!rp || typeof playerMesh === 'undefined' || !playerMesh) return;
    const x = rp.target.x + 1.6, z = rp.target.z + 1.6, g = groundHeight(x, z);
    playerMesh.parent.position.set(x, g, z);
    state.playerPos.x = x; state.playerPos.y = g; state.playerPos.z = z;
    state.playerVelocity.y = 0; state.isGrounded = true;
  }

  // ------------------------------------------------------------------ remote avatars
  const avatarMats = {};
  function mat(c, r) { const k = c + '_' + r; return avatarMats[k] || (avatarMats[k] = new THREE.MeshStandardMaterial({ color: c, roughness: r })); }
  function hashHue(s) { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; }

  function labelSprite(text, friend) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = friend ? 'rgba(0,120,60,0.85)' : 'rgba(10,20,15,0.8)';
    g.beginPath(); g.roundRect ? g.roundRect(4, 8, 248, 48, 14) : g.rect(4, 8, 248, 48); g.fill();
    g.strokeStyle = friend ? '#00E676' : 'rgba(255,255,255,0.35)'; g.lineWidth = 3; g.stroke();
    g.fillStyle = '#fff'; g.font = 'bold 28px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText((friend ? '★ ' : '') + text, 128, 33);
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(2.6, 0.65, 1); sp.position.y = 2.55; sp.renderOrder = 10;
    return sp;
  }

  function makeAvatar(name) {
    const h = hashHue(name);
    const shirts = [0xd33a3a, 0x2a58d8, 0xe0a020, 0x8a3ab0, 0x1c8a8a, 0xe8e0c0, 0xf08a8a, 0x3a9a4a];
    const skins = [0xb07a50, 0x9a6a44, 0xc89060, 0x8a5a38];
    const root = new THREE.Group(), body = new THREE.Group(); root.add(body);
    const part = (geo, m, x, y, z, parent) => { const me = new THREE.Mesh(geo, m); me.position.set(x, y, z); me.castShadow = true; (parent || body).add(me); return me; };
    const shirt = mat(shirts[h % shirts.length], 0.9), skin = mat(skins[(h >> 4) % skins.length], 0.65), low = mat((h >> 8) % 2 ? 0xf0ece0 : 0x2a2f45, 0.95);
    part(new THREE.CapsuleGeometry(0.22, 0.4, 4, 10), shirt, 0, 1.3, 0);
    part(new THREE.SphereGeometry(0.16, 12, 10), skin, 0, 1.86, 0);
    part(new THREE.SphereGeometry(0.165, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), mat(0x17110d, 0.6), 0, 1.89, -0.01);
    const legs = [], arms = [];
    for (const sx of [-1, 1]) {
      const lg = new THREE.Group(); lg.position.set(sx * 0.11, 0.95, 0); body.add(lg);
      part(new THREE.CylinderGeometry(0.1, 0.085, 0.9, 8), low, 0, -0.45, 0, lg); legs.push(lg);
      const ar = new THREE.Group(); ar.position.set(sx * 0.3, 1.5, 0); body.add(ar);
      part(new THREE.CylinderGeometry(0.06, 0.055, 0.6, 8), skin, 0, -0.28, 0, ar); arms.push(ar);
    }
    return { root: root, body: body, legs: legs, arms: arms };
  }

  function updateRemote(list) {
    const seen = new Set();
    list.forEach(p => {
      seen.add(p.n);
      let r = NW.remote.get(p.n);
      if (!r) {
        const av = makeAvatar(p.n);
        r = { name: p.n, av: av, label: null, friend: null, target: { x: p.x, y: p.y, z: p.z, r: p.r }, mv: 0, phase: 0 };
        av.root.position.set(p.x, p.y, p.z);
        scene.add(av.root);
        NW.remote.set(p.n, r);
        renderSocial();
      }
      r.target.x = p.x; r.target.y = p.y; r.target.z = p.z; r.target.r = p.r; r.mv = p.m;
      if (r.friend !== isFriend(p.n)) {
        r.friend = isFriend(p.n);
        if (r.label) { r.av.root.remove(r.label); r.label.material.map.dispose(); r.label.material.dispose(); }
        r.label = labelSprite(p.n, r.friend); r.av.root.add(r.label);
      }
    });
    NW.remote.forEach((r, n) => { if (!seen.has(n)) removeRemote(n); });
  }
  function removeRemote(n) {
    const r = NW.remote.get(n); if (!r) return;
    scene.remove(r.av.root);
    r.av.root.traverse(o => { if (o.geometry) o.geometry.dispose(); });
    if (r.label) { r.label.material.map.dispose(); r.label.material.dispose(); }
    NW.remote.delete(n); renderSocial();
  }
  function clearRemote() { Array.from(NW.remote.keys()).forEach(removeRemote); }

  // Called every frame from the main loop
  let sendTimer = 0, last = { x: 0, z: 0 };
  NW.tick = function (dt) {
    NW.remote.forEach(r => {
      const g = r.av.root, k = Math.min(1, dt * 9);
      if (Math.hypot(r.target.x - g.position.x, r.target.z - g.position.z) > 40) g.position.set(r.target.x, r.target.y, r.target.z);
      g.position.x += (r.target.x - g.position.x) * k;
      g.position.y += (r.target.y - g.position.y) * k;
      g.position.z += (r.target.z - g.position.z) * k;
      let d = r.target.r - r.av.body.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d));
      r.av.body.rotation.y += d * Math.min(1, dt * 10);
      r.phase += dt * (r.mv ? 9 : 0);
      const sw = r.mv ? Math.sin(r.phase) * 0.7 : 0;
      r.av.legs[0].rotation.x = sw; r.av.legs[1].rotation.x = -sw;
      r.av.arms[0].rotation.x = -sw * 0.8; r.av.arms[1].rotation.x = sw * 0.8;
    });
    if (!NW.connected || typeof playerMesh === 'undefined' || !playerMesh) return;
    sendTimer += dt;
    if (sendTimer < 0.1) return;
    const p = playerMesh.parent.position;
    const moving = Math.hypot(p.x - last.x, p.z - last.z) / sendTimer > 0.6;
    send({ t: 'pos', x: +p.x.toFixed(2), y: +p.y.toFixed(2), z: +p.z.toFixed(2), r: +playerMesh.rotation.y.toFixed(2), m: moving ? 1 : 0 });
    last.x = p.x; last.z = p.z; sendTimer = 0;
  };

  // Other explorers on the minimap (friends in gold, others in blue)
  NW.drawMinimap = function (ctx, mapX, mapZ) {
    NW.remote.forEach(r => {
      const x = mapX(r.target.x), z = mapZ(r.target.z);
      if (x < 0 || z < 0 || x > 280 || z > 200) return;
      ctx.fillStyle = r.friend ? '#FFD54F' : '#40C4FF';
      ctx.beginPath(); ctx.arc(x, z, 4, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke();
    });
  };

  // ------------------------------------------------------------------ name dialog + startup
  function newToken() { const a = new Uint8Array(16); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => a[i] = Math.random() * 256); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); }

  function showNameDialog(err) {
    const m = $('name-modal'); m.classList.add('open');
    $('name-error').textContent = err || '';
    const inp = $('name-input'); inp.value = LS.get('nw_name', ''); setTimeout(() => inp.focus(), 50);
  }

  function startOnline(name) {
    creds = { name: name, token: LS.get('nw_token', '') || (function () { const t = newToken(); LS.set('nw_token', t); return t; })() };
    wantOnline = true; connect();
  }

  function init() {
    initPanels();
    const t = thread('lobby'); t.open = true; renderTabs(); msgBox.textContent = '';

    $('name-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('name-input').value.trim();
      if (!/^[A-Za-z0-9_][A-Za-z0-9_ -]{1,14}[A-Za-z0-9_]$/.test(name)) { $('name-error').textContent = 'Use 3-16 letters, numbers, spaces, - or _.'; return; }
      LS.set('nw_name', name); $('name-modal').classList.remove('open');
      startOnline(name);
    });
    $('name-offline').addEventListener('click', () => { $('name-modal').classList.remove('open'); wantOnline = false; setStatus('offline'); addMsg('lobby', '', 'Playing offline. Reload the page to go online.', { sys: true }); });

    $('chat-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const text = chatInput.value.trim(); if (!text) return;
      chatInput.value = '';
      if (!NW.connected) { addMsg(active, '', 'You are offline, so nobody can see that. Reconnecting when the server is available.', { sys: true }); return; }
      if (active === 'lobby') send({ t: 'chat', text: text });
      else send({ t: 'dm', to: active.slice(3), text: text });
    });
    $('friend-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const n = $('friend-input').value.trim(); if (!n) return;
      if (!NW.connected) { toast('Go online first to add friends.', 'warn'); return; }
      send({ t: 'friend_request', to: n }); $('friend-input').value = '';
    });

    renderSocial();
    setStatus('looking for server…', 'connecting');
    discoverServer().then(url => {
      discovered = url;
      if (!url) { connect(); return; }                 // no server: stay offline, explain in the lobby tab
      const saved = LS.get('nw_name', '');
      if (saved && LS.get('nw_token', '')) startOnline(saved); else showNameDialog();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
