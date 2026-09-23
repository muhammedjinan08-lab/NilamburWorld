'use strict';
/**
 * NilamburWorld server: serves the game files and runs the multiplayer backend on one port.
 *   node server.js            (default port 8000, override with PORT=...)
 *
 * WebSocket endpoint: /ws
 *  - Lobby chat is broadcast to everyone online.
 *  - Friend requests / private messages are only ever delivered to the two people involved.
 *  - Player positions are relayed so explorers (and friends) can see each other in the world.
 * Accounts are just a name + a secret token kept in the player's browser; friends and private
 * chat history persist in data/users.json (never served over HTTP).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { WebSocketServer } = require('ws');

const PORT = +process.env.PORT || 8000;
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'users.json');

// ---------- Static file server ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.gd': 'text/plain; charset=utf-8', '.godot': 'text/plain; charset=utf-8', '.tscn': 'text/plain; charset=utf-8'
};
const BLOCKED = /^\/(data|node_modules|server\.js|package(-lock)?\.json)(\/|$)/i;

const httpServer = http.createServer((req, res) => {
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); return res.end(); }
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  const ext = path.extname(file).toLowerCase();
  if (BLOCKED.test(p) || p.split('/').some(s => s.startsWith('.')) || !file.startsWith(ROOT) || !MIME[ext]) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Not found');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
});

// ---------- Persistent accounts ----------
let users = {};          // key(lowercase name) -> { name, tokenHash, friends[], incoming[], outgoing[] }
let dms = {};            // "keyA|keyB" -> [{ f: senderKey, t: text, ts }]
try {
  const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  users = d.users || {}; dms = d.dms || {};
} catch (e) { /* first run */ }
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DATA_FILE + '.tmp', JSON.stringify({ users: users, dms: dms }));
      fs.renameSync(DATA_FILE + '.tmp', DATA_FILE);
    } catch (e) { console.error('save failed', e.message); }
  }, 400);
}
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const pairKey = (a, b) => (a < b ? a + '|' + b : b + '|' + a);
const NAME_RE = /^[A-Za-z0-9_][A-Za-z0-9_ -]{1,14}[A-Za-z0-9_]$/;
const keyOf = (name) => String(name || '').trim().toLowerCase();
const clean = (t, n) => String(t || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n);

// ---------- Appearance (character customization) ----------
// The server never trusts client-picked colours/strings blindly: enums are checked against the same
// option lists the client offers, and colours are just clamped to a valid 24-bit hex range.
const HAIR_STYLES = ['short', 'medium', 'long', 'ponytail', 'braid', 'bun', 'bald', 'cap'];
const OUTFIT_KEYS = ['tshirt_jeans', 'shirt_trousers', 'kurta_leggings', 'shorts_tee', 'mundu_shirt', 'jubba_mundu', 'kasavu_mundu', 'kasavu_saree', 'churidar'];
const SHOE_TYPES = ['sneakers', 'sandals', 'formal', 'barefoot'];
const DEFAULT_APPEARANCE = { skin: 0xc68642, hairStyle: 'short', hairColor: 0x0b0a08, flower: false, outfit: 'tshirt_jeans', shoes: 'sneakers' };
function sanitizeAppearance(a) {
  a = a || {};
  const hex = (v, d) => { v = +v; return Number.isFinite(v) ? (Math.max(0, Math.min(0xffffff, Math.round(v))) | 0) : d; };
  return {
    skin: hex(a.skin, DEFAULT_APPEARANCE.skin),
    hairStyle: HAIR_STYLES.includes(a.hairStyle) ? a.hairStyle : DEFAULT_APPEARANCE.hairStyle,
    hairColor: hex(a.hairColor, DEFAULT_APPEARANCE.hairColor),
    flower: !!a.flower,
    outfit: OUTFIT_KEYS.includes(a.outfit) ? a.outfit : DEFAULT_APPEARANCE.outfit,
    shoes: SHOE_TYPES.includes(a.shoes) ? a.shoes : DEFAULT_APPEARANCE.shoes
  };
}

// ---------- Live sessions ----------
const sessions = new Map();     // key -> { ws, key, name, pos, bucket, veh, appearance }
const lobbyHistory = [];        // last messages for newcomers
let posDirty = false;
let appearanceDirty = false;    // relayed the same way vehicle state is (see vehDirty below)

// Vehicle driving: `i` is the vehicle's index into the client's own (identical, deterministically
// built) VEHICLES array - the server has no notion of the world itself, it just relays whichever
// index a client claims and its live transform, and makes sure only one person can hold a given
// index at a time so two people can't both "drive" the same vehicle.
const vehicleDrivers = new Map();   // i -> { key, name, x, z, yaw, spd }
let vehDirty = false;
function releaseVehicle(me) {
  if (me.veh === null || me.veh === undefined) return;
  const rec = vehicleDrivers.get(me.veh);
  if (rec && rec.key === me.key) { vehicleDrivers.delete(me.veh); vehDirty = true; }
  me.veh = null;
}

function send(ws, obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
function sendTo(key, obj) { const s = sessions.get(key); if (s) send(s.ws, obj); }
function nameOf(k) { return users[k] ? users[k].name : k; }

function socialFor(key) {
  const u = users[key];
  return {
    t: 'social',
    friends: u.friends.map(k => ({ name: nameOf(k), online: sessions.has(k) })),
    incoming: u.incoming.map(nameOf),
    outgoing: u.outgoing.map(nameOf)
  };
}
function pushSocial(key) { if (sessions.has(key)) sendTo(key, socialFor(key)); }
function pushSocialToFriends(key) { users[key].friends.forEach(pushSocial); }
const notice = (key, text, kind, extra) => sendTo(key, Object.assign({ t: 'notice', text: text, kind: kind || 'info' }, extra || {}));

function allow(s, cost, refillPerSec, cap) {
  const now = Date.now();
  s.bucket = s.bucket || { v: cap, ts: now };
  s.bucket.v = Math.min(cap, s.bucket.v + (now - s.bucket.ts) / 1000 * refillPerSec);
  s.bucket.ts = now;
  if (s.bucket.v < cost) return false;
  s.bucket.v -= cost;
  return true;
}

// ---------- WebSocket protocol ----------
const wss = new WebSocketServer({ server: httpServer, path: '/ws', maxPayload: 4096 });

// Abuse limits for public hosting (behind a host's proxy the client address arrives in a header)
const MAX_CONN_PER_IP = 10, MAX_NEW_ACCOUNTS_PER_IP_HOUR = 6, MAX_USERS = 5000;
const connsByIp = new Map();
const newAccountsByIp = new Map();
function clientIp(req) {
  return String(String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '?');
}
function accountBudget(ip) {
  const now = Date.now(), list = (newAccountsByIp.get(ip) || []).filter(t => now - t < 3600000);
  newAccountsByIp.set(ip, list);
  return list.length < MAX_NEW_ACCOUNTS_PER_IP_HOUR ? list : null;
}

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  const n = (connsByIp.get(ip) || 0) + 1;
  if (n > MAX_CONN_PER_IP) { ws.close(1013, 'too many connections'); return; }
  connsByIp.set(ip, n);
  ws.on('close', () => { const c = (connsByIp.get(ip) || 1) - 1; if (c <= 0) connsByIp.delete(ip); else connsByIp.set(ip, c); });
  let me = null;   // session once logged in
  const fail = (text) => { send(ws, { t: 'error', text: text }); };

  ws.on('message', (raw) => {
    let m;
    try { m = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!m || typeof m.t !== 'string') return;

    if (!me) {
      if (m.t !== 'login') return;
      const name = String(m.name || '').trim(), token = String(m.token || '');
      if (!NAME_RE.test(name)) return fail('Name must be 3-16 letters, numbers, spaces, - or _.');
      if (token.length < 16 || token.length > 80) return fail('Bad token.');
      const key = keyOf(name);
      let u = users[key];
      if (u) {
        const a = Buffer.from(u.tokenHash), b = Buffer.from(sha(token));
        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return send(ws, { t: 'error', code: 'name_taken', text: 'That name belongs to another explorer. Pick a different name.' });
      } else {
        const budget = accountBudget(ip);
        if (!budget || Object.keys(users).length >= MAX_USERS) return fail('Too many new explorers from your network right now. Try again later.');
        budget.push(Date.now());
        u = users[key] = { name: name, tokenHash: sha(token), friends: [], incoming: [], outgoing: [] };
        save();
      }
      const old = sessions.get(key);
      if (old) { send(old.ws, { t: 'error', code: 'replaced', text: 'You signed in from another tab.' }); old.ws.close(); }
      me = { ws: ws, key: key, name: u.name, pos: { x: 30, y: 3, z: 14, r: 0, m: 0 }, bucket: null, veh: null, appearance: sanitizeAppearance(m.appearance) };
      sessions.set(key, me);
      send(ws, { t: 'welcome', name: u.name, history: lobbyHistory, online: sessions.size });
      send(ws, socialFor(key));
      pushSocialToFriends(key);
      posDirty = true;
      appearanceDirty = true;
      return;
    }

    switch (m.t) {
      case 'pos': {
        if (!allow(me, 1, 30, 40)) return;
        const x = +m.x, y = +m.y, z = +m.z, r = +m.r;
        if (![x, y, z, r].every(Number.isFinite) || Math.abs(x) > 1200 || Math.abs(z) > 1200 || Math.abs(y) > 400) return;
        me.pos = { x: x, y: y, z: z, r: r, m: m.m ? 1 : 0 };
        posDirty = true;
        break;
      }
      case 'appearance': {
        if (!allow(me, 1, 0.5, 4)) return;
        me.appearance = sanitizeAppearance(m.appearance);
        appearanceDirty = true;
        break;
      }
      case 'chat': {
        const text = clean(m.text, 240);
        if (!text) return;
        if (!allow(me, 1, 0.6, 6)) return send(ws, { t: 'notice', kind: 'warn', text: 'Slow down a little.' });
        const msg = { t: 'chat', from: me.name, text: text, ts: Date.now() };
        lobbyHistory.push(msg); if (lobbyHistory.length > 60) lobbyHistory.shift();
        sessions.forEach(s => send(s.ws, msg));
        break;
      }
      case 'friend_request': {
        if (!allow(me, 1, 0.2, 5)) return send(ws, { t: 'notice', kind: 'warn', text: 'Too many requests, wait a moment.' });
        const tk = keyOf(m.to), you = users[me.key], them = users[tk];
        if (!them) return notice(me.key, 'No explorer named "' + clean(m.to, 20) + '" has joined yet.', 'warn');
        if (tk === me.key) return notice(me.key, "That's you!", 'warn');
        if (you.friends.includes(tk)) return notice(me.key, them.name + ' is already your friend.', 'warn');
        if (you.outgoing.includes(tk)) return notice(me.key, 'Request to ' + them.name + ' is already pending.', 'warn');
        if (you.incoming.includes(tk)) {          // they already asked us: just accept
          you.incoming = you.incoming.filter(k => k !== tk);
          them.outgoing = them.outgoing.filter(k => k !== me.key);
          you.friends.push(tk); them.friends.push(me.key);
          save(); pushSocial(me.key); pushSocial(tk);
          notice(me.key, 'You and ' + them.name + ' are now friends!', 'ok');
          notice(tk, 'You and ' + you.name + ' are now friends!', 'ok');
          return;
        }
        you.outgoing.push(tk); them.incoming.push(me.key);
        save(); pushSocial(me.key); pushSocial(tk);
        notice(me.key, 'Friend request sent to ' + them.name + '.', 'ok');
        notice(tk, you.name + ' sent you a friend request!', 'request', { from: you.name });
        break;
      }
      case 'friend_respond': {
        const fk = keyOf(m.from), you = users[me.key], them = users[fk];
        if (!them || !you.incoming.includes(fk)) return;
        you.incoming = you.incoming.filter(k => k !== fk);
        them.outgoing = them.outgoing.filter(k => k !== me.key);
        if (m.accept) {
          you.friends.push(fk); them.friends.push(me.key);
          notice(me.key, 'You and ' + them.name + ' are now friends!', 'ok');
          notice(fk, you.name + ' accepted your friend request!', 'ok');
        } else {
          notice(fk, you.name + ' declined your friend request.', 'info');
        }
        save(); pushSocial(me.key); pushSocial(fk);
        break;
      }
      case 'friend_remove': {
        const fk = keyOf(m.name), you = users[me.key], them = users[fk];
        if (!them || !you.friends.includes(fk)) return;
        you.friends = you.friends.filter(k => k !== fk);
        them.friends = them.friends.filter(k => k !== me.key);
        save(); pushSocial(me.key); pushSocial(fk);
        break;
      }
      case 'dm': {
        const tk = keyOf(m.to), text = clean(m.text, 240);
        if (!text || !users[tk] || !users[me.key].friends.includes(tk)) return notice(me.key, 'You can only message friends.', 'warn');
        if (!allow(me, 1, 0.6, 6)) return send(ws, { t: 'notice', kind: 'warn', text: 'Slow down a little.' });
        const ts = Date.now(), pk = pairKey(me.key, tk);
        (dms[pk] = dms[pk] || []).push({ f: me.key, t: text, ts: ts });
        if (dms[pk].length > 100) dms[pk].shift();
        save();
        const msg = { t: 'dm', from: me.name, to: users[tk].name, text: text, ts: ts };
        send(ws, msg);            // only the two people in the conversation ever receive it
        sendTo(tk, msg);
        break;
      }
      case 'dm_history': {
        const tk = keyOf(m.with);
        if (!users[tk] || !users[me.key].friends.includes(tk)) return;
        const list = (dms[pairKey(me.key, tk)] || []).map(x => ({ from: nameOf(x.f), text: x.t, ts: x.ts }));
        send(ws, { t: 'dm_history', with: users[tk].name, msgs: list });
        break;
      }
      case 'vehenter': {
        const i = Number.isInteger(m.i) ? m.i : -1;
        if (i < 0 || i > 5000) return;
        const held = vehicleDrivers.get(i);
        if (held && held.key !== me.key) { send(ws, { t: 'veh_denied', i: i }); return; }
        releaseVehicle(me);   // give up whatever they held before, if anything
        me.veh = i;
        vehicleDrivers.set(i, { key: me.key, name: me.name, x: 0, z: 0, yaw: 0, spd: 0 });
        vehDirty = true;
        break;
      }
      case 'vehpos': {
        if (me.veh === null || me.veh === undefined || me.veh !== m.i) return;
        if (!allow(me, 1, 30, 40)) return;
        const x = +m.x, z = +m.z, yaw = +m.yaw, spd = +m.spd;
        if (![x, z, yaw, spd].every(Number.isFinite) || Math.abs(x) > 1200 || Math.abs(z) > 1200) return;
        const rec = vehicleDrivers.get(me.veh);
        if (rec) { rec.x = x; rec.z = z; rec.yaw = yaw; rec.spd = spd; vehDirty = true; }
        break;
      }
      case 'vehexit': {
        if (me.veh === m.i) releaseVehicle(me);
        break;
      }
    }
  });

  ws.on('close', () => {
    if (me && sessions.get(me.key) && sessions.get(me.key).ws === ws) {
      sessions.delete(me.key);
      releaseVehicle(me);
      pushSocialToFriends(me.key);
      posDirty = true;
    }
  });
  ws.on('error', () => {});
});

// Relay player positions ~10 times a second, only when something changed
setInterval(() => {
  if (vehDirty) {
    vehDirty = false;
    const vlist = [];
    vehicleDrivers.forEach((rec, i) => vlist.push({ i: i, n: rec.name, x: +rec.x.toFixed(2), z: +rec.z.toFixed(2), yaw: +rec.yaw.toFixed(2), spd: +rec.spd.toFixed(2) }));
    sessions.forEach(s => send(s.ws, { t: 'vehicles', list: vlist }));
  }
  if (appearanceDirty) {
    appearanceDirty = false;
    const alist = [];
    sessions.forEach(s => alist.push({ n: s.name, ap: s.appearance }));
    sessions.forEach(s => send(s.ws, { t: 'appearances', list: alist }));
  }
  if (!posDirty) return;
  posDirty = false;
  const list = [];
  sessions.forEach(s => list.push({ n: s.name, x: +s.pos.x.toFixed(2), y: +s.pos.y.toFixed(2), z: +s.pos.z.toFixed(2), r: +s.pos.r.toFixed(2), m: s.pos.m }));
  sessions.forEach(s => send(s.ws, { t: 'players', list: list.filter(p => p.n !== s.name) }));
}, 100);

httpServer.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  const ips = [].concat(...Object.values(nets)).filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address);
  console.log('NilamburWorld running:');
  console.log('  this computer:  http://localhost:' + PORT);
  ips.forEach(ip => console.log('  same Wi-Fi/LAN: http://' + ip + ':' + PORT));
});
