'use strict';
/**
 * football_server.js - the 5-a-side football ground at world (658, 403), run by the server so every
 * player sees the same ball, score and clock.
 *
 *  - Players join a queue (fb_join / fb_leave). A match needs at least 6 queued players (3 v 3) and
 *    takes at most 10 (5 v 5), always an even number; the rest stay in the queue in order and are the
 *    first to play the next match. Players who just played are not re-queued automatically.
 *  - A match lasts 7 minutes. Goals pause for a kickoff; a team left with nobody forfeits.
 *  - Ball physics run here at 30 Hz: gravity, bounces, rolling friction, the boards around the pitch,
 *    goals. Players dribble by running into the ball (their speed comes from their position updates),
 *    and pass / shoot / tackle with fb_kick and fb_tackle, validated against the player's distance to
 *    the ball.
 */

const FIELD = { cx: 658, cz: 403, hx: 20, hz: 12, goalHalf: 1.6, goalH: 2.0, y: 3.45 };
const BALL_R = 0.11, MIN_PLAYERS = 6, MAX_PLAYERS = 10, MATCH_SECONDS = +process.env.FB_MATCH_SECONDS || 7 * 60;   // override only for tests
const COUNTDOWN = 10, GOAL_PAUSE = 4, END_PAUSE = 10, TICK = 1 / 30;

function createFootball(sessions, send) {
  const S = {
    phase: 'idle',          // idle | countdown | playing | goal | ended
    queue: [],              // session keys, in order
    teams: { a: [], b: [] },// session keys
    score: [0, 0],
    timeLeft: MATCH_SECONDS,
    until: 0,               // end of countdown / goal pause / end screen (ms)
    ball: { x: FIELD.cx, y: FIELD.y + BALL_R, z: FIELD.cz, vx: 0, vy: 0, vz: 0 },
    lastTouch: null,
    dirty: true
  };
  const now = () => Date.now();
  const online = (k) => sessions.has(k);
  const nameOf = (k) => { const s = sessions.get(k); return s ? s.name : k; };
  const inMatch = (k) => S.teams.a.includes(k) || S.teams.b.includes(k);
  const teamOf = (k) => S.teams.a.includes(k) ? 0 : S.teams.b.includes(k) ? 1 : -1;
  const broadcast = (o) => sessions.forEach(s => send(s.ws, o));
  const running = () => S.phase === 'playing' || S.phase === 'goal';

  function resetBall() { Object.assign(S.ball, { x: FIELD.cx, y: FIELD.y + BALL_R, z: FIELD.cz, vx: 0, vy: 0, vz: 0 }); S.lastTouch = null; }

  // Kickoff spots: team A (index 0) defends the west goal (x < cx), team B the east goal
  function kickoffSpots() {
    const spots = {};
    const lay = [[-3, 0], [-8, -5], [-8, 5], [-14, 0], [-18.3, 0]];   // striker, two mids, defender, keeper
    [S.teams.a, S.teams.b].forEach((team, t) => {
      const side = t === 0 ? 1 : -1;
      team.forEach((k, i) => { const p = lay[i % lay.length]; spots[nameOf(k)] = [FIELD.cx + side * p[0], FIELD.cz + p[1] * (t === 0 ? 1 : -1), t]; });
    });
    return spots;
  }
  function kickoff(kind) {
    resetBall();
    broadcast({ t: 'fb_event', e: kind, spots: kickoffSpots(), sc: S.score });
  }

  function startMatch() {
    const ready = S.queue.filter(online);
    const n = Math.min(MAX_PLAYERS, ready.length - (ready.length % 2));
    const players = ready.slice(0, n);
    S.queue = S.queue.filter(k => !players.includes(k));
    S.teams = { a: [], b: [] };
    players.forEach((k, i) => (i % 2 ? S.teams.b : S.teams.a).push(k));
    S.score = [0, 0];
    S.timeLeft = MATCH_SECONDS;
    S.phase = 'playing';
    kickoff('start');
  }
  function endMatch(reason) {
    S.phase = 'ended';
    S.until = now() + END_PAUSE * 1000;
    const w = S.score[0] === S.score[1] ? -1 : S.score[0] > S.score[1] ? 0 : 1;
    broadcast({ t: 'fb_event', e: 'end', sc: S.score, winner: w, reason: reason || 'time', a: S.teams.a.map(nameOf), b: S.teams.b.map(nameOf) });
    resetBall();
    S.dirty = true;
  }

  // Somebody left mid-match: bring in the first person waiting, on the same team
  function substitute(k) {
    const t = teamOf(k); if (t < 0) return;
    const team = t === 0 ? S.teams.a : S.teams.b;
    team.splice(team.indexOf(k), 1);
    const sub = S.queue.find(online);
    if (sub && running()) {
      S.queue.splice(S.queue.indexOf(sub), 1);
      team.push(sub);
      broadcast({ t: 'fb_event', e: 'sub', out: nameOf(k), in: nameOf(sub), spots: kickoffSpots() });
    }
    if (running() && (!S.teams.a.some(online) || !S.teams.b.some(online))) endMatch('forfeit');
    S.dirty = true;
  }

  function handle(me, m) {
    switch (m.t) {
      case 'fb_join':
        if (!S.queue.includes(me.key) && !inMatch(me.key)) { S.queue.push(me.key); S.dirty = true; }
        return true;
      case 'fb_leave':
        if (S.queue.includes(me.key)) S.queue.splice(S.queue.indexOf(me.key), 1);
        if (inMatch(me.key) && S.phase !== 'ended') substitute(me.key);
        S.dirty = true;
        return true;
      case 'fb_kick': {
        if (S.phase !== 'playing' || !inMatch(me.key)) return true;
        const t = now();
        if (me.fbKickAt && t - me.fbKickAt < 300) return true;
        const b = S.ball, p = me.pos;
        if (Math.hypot(b.x - p.x, b.z - p.z) > 1.8 || b.y > FIELD.y + 2.2) return true;
        let dx = +m.dx, dz = +m.dz; const L = Math.hypot(dx, dz);
        if (!Number.isFinite(L) || L < 1e-3) return true;
        dx /= L; dz /= L;
        const pw = Math.max(0, Math.min(1, +m.p || 0));
        const shoot = m.k === 'shoot';
        const sp = shoot ? 15 + 13 * pw : 8 + 8 * pw;
        b.vx = dx * sp; b.vz = dz * sp; b.vy = shoot ? 1.5 + 4.5 * pw : (pw > 0.85 ? 5 : 0.4);   // a hard pass is a lofted ball
        b.x = p.x + dx * 0.5; b.z = p.z + dz * 0.5;
        me.fbKickAt = t; me.fbGrab = t + 350;   // don't instantly re-dribble your own kick
        S.lastTouch = me.key;
        broadcast({ t: 'fb_event', e: shoot ? 'shot' : 'pass', by: me.name });
        return true;
      }
      case 'fb_tackle': {
        if (S.phase !== 'playing' || !inMatch(me.key)) return true;
        const t = now();
        if (me.fbTackleAt && t - me.fbTackleAt < 1000) return true;
        me.fbTackleAt = t;
        const b = S.ball, p = me.pos;
        if (Math.hypot(b.x - p.x, b.z - p.z) > 2.3 || b.y > FIELD.y + 1.2) return true;
        // poke the ball away from whoever has it, towards the tackler's facing direction
        const fx = Math.sin(me.pos.r || 0), fz = Math.cos(me.pos.r || 0);
        b.vx = fx * 6; b.vz = fz * 6; b.vy = 0.6;
        b.x = p.x + fx * 0.7; b.z = p.z + fz * 0.7;
        S.lastTouch = me.key;
        sessions.forEach(s => { if (s !== me && inMatch(s.key)) s.fbGrab = t + 500; });   // everyone else loses it for a moment
        broadcast({ t: 'fb_event', e: 'tackle', by: me.name });
        return true;
      }
    }
    return false;
  }
  function onClose(me) {
    if (S.queue.includes(me.key)) { S.queue.splice(S.queue.indexOf(me.key), 1); S.dirty = true; }
    if (inMatch(me.key) && S.phase !== 'ended') substitute(me.key);
  }

  function physics(dt) {
    const b = S.ball, F = FIELD, floor = F.y + BALL_R;
    // players: dribbling is just running into the ball
    const t = now();
    [S.teams.a, S.teams.b].forEach(team => team.forEach(k => {
      const s = sessions.get(k); if (!s) return;
      const p = s.pos, v = s.fbVel || { x: 0, z: 0 };
      if (s.fbGrab && t < s.fbGrab) return;
      const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz);
      if (d < 0.6 && b.y < floor + 0.9 && d > 1e-4) {
        const nx = dx / d, nz = dz / d, vsp = Math.hypot(v.x, v.z);
        b.x = p.x + nx * 0.6; b.z = p.z + nz * 0.6;
        if (vsp > 0.5) { b.vx = v.x * 1.12 + nx * 0.8; b.vz = v.z * 1.12 + nz * 0.8; }   // ball runs ahead at your feet
        else { b.vx *= 0.2; b.vz *= 0.2; }                                                 // stopped player = the ball stops (a block / trap)
        if (b.vy > 0) b.vy *= 0.3;
        S.lastTouch = k;
      }
    }));
    // integrate
    b.vy -= 9.81 * dt;
    b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
    if (b.y <= floor) {
      b.y = floor;
      if (b.vy < -1.2) b.vy = -b.vy * 0.55; else b.vy = 0;
    }
    const onGround = b.y <= floor + 0.01;
    const drag = onGround ? 0.55 : 0.08;                                   // rolling friction vs air drag (per second)
    const k = Math.max(0, 1 - drag * dt);
    b.vx *= k; b.vz *= k;
    if (onGround) { const s = Math.hypot(b.vx, b.vz); if (s < 0.25) { b.vx = 0; b.vz = 0; } else { const f = Math.max(0, s - 0.9 * dt) / s; b.vx *= f; b.vz *= f; } }
    // goals and boards
    const gx = b.x - F.cx, gz = b.z - F.cz;
    const inMouth = Math.abs(gz) < F.goalHalf - BALL_R && b.y < F.y + F.goalH;
    if (Math.abs(gx) > F.hx - BALL_R) {
      if (inMouth) {
        if (Math.abs(gx) > F.hx + 0.35 && S.phase === 'playing') {
          const scorer = gx > 0 ? 0 : 1;                                  // ball in the east goal = team A scored
          S.score[scorer]++;
          S.phase = 'goal'; S.until = now() + GOAL_PAUSE * 1000;
          const by = S.lastTouch ? nameOf(S.lastTouch) : '';
          const own = S.lastTouch && teamOf(S.lastTouch) !== scorer;
          broadcast({ t: 'fb_event', e: 'goal', team: scorer, by: by, own: !!own, sc: S.score });
          b.vx *= 0.1; b.vz *= 0.1;
        }
        if (Math.abs(gx) > F.hx + 1.0) { b.x = F.cx + Math.sign(gx) * (F.hx + 1.0); b.vx = 0; }   // back of the net
        if (Math.abs(gz) > F.goalHalf - BALL_R - 0.01) { b.z = F.cz + Math.sign(gz) * (F.goalHalf - BALL_R); b.vz *= -0.4; }
      } else {
        b.x = F.cx + Math.sign(gx) * (F.hx - BALL_R); b.vx = -b.vx * 0.65;
      }
    }
    if (Math.abs(b.z - F.cz) > F.hz - BALL_R) { b.z = F.cz + Math.sign(b.z - F.cz) * (F.hz - BALL_R); b.vz = -b.vz * 0.65; }
  }

  let bcast = 0;
  function tick() {
    const t = now();
    // player velocities from their (10 Hz) position updates
    sessions.forEach(s => {
      if (!inMatch(s.key)) return;
      const p = s.pos, last = s.fbLast;
      if (last && (p.x !== last.x || p.z !== last.z)) {
        const dt = Math.max(0.05, (t - last.t) / 1000);
        s.fbVel = { x: (p.x - last.x) / dt, z: (p.z - last.z) / dt };
        if (Math.hypot(s.fbVel.x, s.fbVel.z) > 12) s.fbVel = { x: 0, z: 0 };   // teleports aren't runs
        s.fbLast = { x: p.x, z: p.z, t: t };
      } else if (!last) s.fbLast = { x: p.x, z: p.z, t: t };
      else if (t - last.t > 250) s.fbVel = { x: 0, z: 0 };
    });
    // drop offline players from the queue
    const q0 = S.queue.length; S.queue = S.queue.filter(online); if (S.queue.length !== q0) S.dirty = true;

    switch (S.phase) {
      case 'idle':
        if (S.queue.length >= MIN_PLAYERS) { S.phase = 'countdown'; S.until = t + COUNTDOWN * 1000; S.dirty = true; }
        break;
      case 'countdown':
        if (S.queue.length < MIN_PLAYERS) { S.phase = 'idle'; S.dirty = true; }
        else if (t >= S.until) startMatch();
        break;
      case 'playing':
        S.timeLeft -= TICK;
        physics(TICK);
        if (S.timeLeft <= 0) { S.timeLeft = 0; endMatch('time'); }
        break;
      case 'goal':
        S.timeLeft -= TICK;           // the clock keeps running through celebrations, like real futsal-lite
        physics(TICK);
        if (S.timeLeft <= 0) { S.timeLeft = 0; endMatch('time'); }
        else if (t >= S.until) { S.phase = 'playing'; kickoff('kickoff'); }
        break;
      case 'ended':
        if (t >= S.until) { S.phase = 'idle'; S.teams = { a: [], b: [] }; S.score = [0, 0]; S.timeLeft = MATCH_SECONDS; S.dirty = true; }
        break;
    }
    // ~15 Hz state broadcast while a match runs, 2 Hz otherwise
    bcast += TICK;
    const every = running() ? 1 / 15 : 0.5;
    if (bcast >= every || S.dirty) {
      bcast = 0; S.dirty = false;
      const b = S.ball, r2 = (v) => Math.round(v * 100) / 100;
      broadcast({
        t: 'fb', ph: S.phase, sc: S.score, tl: Math.ceil(S.timeLeft),
        cd: S.phase === 'countdown' || S.phase === 'ended' || S.phase === 'goal' ? Math.max(0, Math.ceil((S.until - t) / 1000)) : 0,
        b: [r2(b.x), r2(b.y), r2(b.z), r2(b.vx), r2(b.vy), r2(b.vz)],
        a: S.teams.a.map(nameOf), bt: S.teams.b.map(nameOf), q: S.queue.map(nameOf),
        lt: S.lastTouch ? nameOf(S.lastTouch) : '', min: MIN_PLAYERS, max: MAX_PLAYERS
      });
    }
  }
  setInterval(tick, TICK * 1000);
  return { handle: handle, onClose: onClose, state: S, FIELD: FIELD };
}

module.exports = { createFootball: createFootball, FIELD: FIELD };
