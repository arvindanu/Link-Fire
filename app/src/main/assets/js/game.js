'use strict';
/* LINKFIRE — game logic, networking logic, rendering and UI flow.

   Authority model (host = phone that created the room):
   - Each phone owns its OWN movement/aim (sent ~30x/s) so controls feel instant.
   - Host owns everything that matters: bullet hits, damage, HP, shields, abilities and
     cooldowns, deaths, respawns, score, timer, match state. Guest only gets results.
   - Bullets are never streamed: a 'fire' message carries origin/angle/seed and both phones
     simulate the same straight-line bullets. Only the host decides hits.            */
(() => {
const $ = id => document.getElementById(id);
const VER = 1;
const cv = $('cv'), cx = cv.getContext('2d', { alpha: false });
const PI2 = Math.PI * 2, DEG = Math.PI / 180;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const r0 = Math.round, r1 = v => Math.round(v * 10) / 10, r2 = v => Math.round(v * 100) / 100;
const angDiff = (a, b) => { let d = (b - a) % PI2; if (d > Math.PI) d -= PI2; if (d < -Math.PI) d += PI2; return d; };
const lerpA = (a, b, k) => a + angDiff(a, b) * k;
function mulberry(a) { return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

/* ------------------------------------------------------------------ settings */
const DEF_CFG = { sens: 1.6, btn: 1, vol: 0.8, auto: true, vib: true,
  pos: { fire: [0.89, 0.68], ab1: [0.73, 0.83], ab2: [0.79, 0.52], rel: [0.95, 0.42], swap: [0.61, 0.88] } };
const BR = { fire: 46, ab1: 34, ab2: 34, rel: 28, swap: 26 };
const BTN = ['fire', 'ab1', 'ab2', 'rel', 'swap'];
const clone = o => JSON.parse(JSON.stringify(o));
function loadCfg() {
  try {
    const c = JSON.parse(localStorage.getItem('lf_cfg') || '{}');
    const d = clone(DEF_CFG);
    for (const k of ['sens', 'btn', 'vol', 'auto', 'vib']) if (c[k] !== undefined) d[k] = c[k];
    if (c.pos) for (const n of BTN) if (Array.isArray(c.pos[n])) d.pos[n] = c.pos[n];
    return d;
  } catch (e) { return clone(DEF_CFG); }
}
let cfg = loadCfg();
const saveCfg = () => { try { localStorage.setItem('lf_cfg', JSON.stringify(cfg)); } catch (e) {} };
function loadLd() {
  try {
    const l = JSON.parse(localStorage.getItem('lf_ld') || 'null');
    if (l && PRIMARIES.includes(l.w) && Array.isArray(l.a) && l.a.length === 2 && AB[l.a[0]] && AB[l.a[1]] && l.a[0] !== l.a[1]) return { w: l.w, a: l.a, ready: false };
  } catch (e) {}
  return { w: 0, a: ['dash', 'heal'], ready: false };
}
const saveLd = () => { try { localStorage.setItem('lf_ld', JSON.stringify({ w: LD.mine.w, a: LD.mine.a })); } catch (e) {} };

/* --------------------------------------------------------------------- state */
let CW = 0, CH = 0, DPR = 1, SC = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.75);
  CW = window.innerWidth; CH = window.innerHeight;
  cv.width = Math.round(CW * DPR); cv.height = Math.round(CH * DPR);
  cv.style.width = CW + 'px'; cv.style.height = CH + 'px';
  SC = CH / RULES.viewH;
}
window.addEventListener('resize', resize); resize();

const G = { state: 'menu', screen: 'menu', role: '', me: 0, map: MAPS[0], tm: 0, ot: false, bullets: [], seq: 0, ld: null,
  winner: -1, endReason: '', rm: [false, false], rmMine: false, oppRm: false, linked: false, rtt: 0, overT: 0, goT: 0, hint: 0,
  snapAcc: 0, pAcc: 0, t: 0, dt: 0.016, toast: null };
let P = [];
const LD = { mine: loadLd(), opp: { w: null, a: null, ready: false } };
const cam = { x: 0, y: 0 };
let shake = 0, hurtA = 0;
const feed = [], nums = [], pulses = [], hm = { t: 0, x: 0, y: 0 };

const me = () => P[G.me], en = () => P[1 - G.me];
const curId = p => p.cur ? PISTOL : p.w[0];
const curW = p => W[curId(p)];
const colFor = i => i === G.me ? '#35d0ff' : '#ff5a3c';
const vib = ms => { if (cfg.vib && Net.native) { try { Android.vibrate(ms); } catch (e) {} } };
const toast = s => { G.toast = { s, t: 1.6 }; };

function mkP(i, ld) {
  return { i, x: 0, y: 0, a: 0, vx: 0, vy: 0, tx: 0, ty: 0, ta: 0, tvx: 0, tvy: 0, tAge: 0, wid: ld.w, rl: 0,
    hp: RULES.hp, alive: true, respT: 0, kills: 0, w: [ld.w, PISTOL], cur: 0, ammo: [W[ld.w].mag, W[PISTOL].mag],
    reloadT: 0, swapT: 0, fireCd: 0, bloom: 0, lastFire: 0, ab: ld.a.slice(), cd: [0, 0],
    shT: 0, shHP: 0, invT: 0, healT: 0, revT: 0, scanT: 0, prot: 0, dashT: 0, ddx: 0, ddy: 0, flash: 0, hitF: 0 };
}

/* ------------------------------------------------------------------ screens */
function show(id) {
  G.screen = id;
  document.querySelectorAll('.scr').forEach(e => e.classList.toggle('on', e.id === id));
}
function showMsg(title, text, label, cb) {
  $('msgT').textContent = title; $('msgP').textContent = text; $('msgBtn').textContent = label || 'OK';
  $('msgBtn').onclick = () => { Snd.play('click'); cb && cb(); };
  show('msg');
}
function goMenu() {
  Net.close(); G.linked = false; G.state = 'menu'; P = []; touches.clear(); $('editBar').classList.remove('on'); show('menu');
}

/* --------------------------------------------------------------------- input */
const IN = { mx: 0, my: 0, aimAct: false, aimA: 0, fire: false };
const touches = new Map();
const pressed = { fire: 0, ab1: 0, ab2: 0, rel: 0, swap: 0 };
const keys = {};
let mouseA = null, mouseDown = false;
const btnRect = n => ({ x: cfg.pos[n][0] * CW, y: cfg.pos[n][1] * CH, r: BR[n] * cfg.btn });
const hasRole = r => { for (const t of touches.values()) if (t.role === r) return true; return false; };
function nearestBtn(x, y) {
  let best = null, bd = 1e9;
  for (const n of BTN) { const b = btnRect(n), d = Math.hypot(x - b.x, y - b.y); if (d < b.r * 1.6 && d < bd) { bd = d; best = n; } }
  return best;
}
function tStart(id, x, y) {
  if (G.state === 'edit') { const n = nearestBtn(x, y); if (n) touches.set(id, { role: 'edit', name: n, x, y }); return; }
  if (G.state !== 'play' && G.state !== 'count') return;
  for (const n of BTN) {
    const b = btnRect(n);
    if (Math.hypot(x - b.x, y - b.y) <= b.r * 1.25) {
      touches.set(id, { role: n === 'fire' ? 'fire' : 'btn', name: n, ax: x, ay: y, x, y });
      if (n === 'ab1') pressAb(0); else if (n === 'ab2') pressAb(1); else if (n === 'rel') pressReload(); else if (n === 'swap') pressSwap();
      return;
    }
  }
  if (x < CW * 0.45) { if (!hasRole('move')) touches.set(id, { role: 'move', ax: x, ay: y, x, y }); }
  else if (!hasRole('aim')) touches.set(id, { role: 'aim', ax: x, ay: y, x, y });
}
function tMove(id, x, y) {
  const t = touches.get(id); if (!t) return;
  t.x = x; t.y = y;
  if (t.role === 'edit') cfg.pos[t.name] = [clamp(x / CW, 0.04, 0.96), clamp(y / CH, 0.1, 0.94)];
}
cv.addEventListener('touchstart', e => { e.preventDefault(); Snd.init(); for (const t of e.changedTouches) tStart(t.identifier, t.clientX, t.clientY); }, { passive: false });
cv.addEventListener('touchmove', e => { e.preventDefault(); for (const t of e.changedTouches) tMove(t.identifier, t.clientX, t.clientY); }, { passive: false });
const tEnd = e => { e.preventDefault(); for (const t of e.changedTouches) touches.delete(t.identifier); };
cv.addEventListener('touchend', tEnd, { passive: false });
cv.addEventListener('touchcancel', tEnd, { passive: false });
document.addEventListener('click', () => Snd.init());
document.addEventListener('touchstart', () => Snd.init(), { passive: true });

// Desktop testing: WASD + mouse, R reload, Q swap, 1/2 abilities.
if (!('ontouchstart' in window)) {
  window.addEventListener('keydown', e => {
    const k = e.key.toLowerCase(); keys[k] = true;
    if (k === 'r') pressReload(); else if (k === 'q') pressSwap(); else if (k === '1' || k === 'e') pressAb(0); else if (k === '2' || k === 'f') pressAb(1);
  });
  window.addEventListener('keyup', e => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('mousemove', e => { mouseA = Math.atan2(e.clientY - CH / 2, e.clientX - CW / 2); });
  window.addEventListener('mousedown', () => { mouseDown = true; });
  window.addEventListener('mouseup', () => { mouseDown = false; });
}

function computeInput() {
  IN.mx = IN.my = 0; IN.aimAct = false; IN.fire = false;
  pressed.fire = pressed.ab1 = pressed.ab2 = pressed.rel = pressed.swap = 0;
  for (const t of touches.values()) {
    if (t.role === 'edit') { pressed[t.name] = 1; continue; }
    if (t.name) pressed[t.name] = 1;
    if (t.role === 'btn') continue;
    const R = t.role === 'move' ? 55 : 60;
    let dx = t.x - t.ax, dy = t.y - t.ay, l = Math.hypot(dx, dy);
    if (l > R * 1.6) { const k = (l - R * 1.6) / l; t.ax += dx * k; t.ay += dy * k; dx = t.x - t.ax; dy = t.y - t.ay; l = Math.hypot(dx, dy); }
    if (t.role === 'move') {
      const m = Math.min(1, l / R);
      if (m > 0.12 && l > 0) { IN.mx = dx / l * m; IN.my = dy / l * m; }
    } else {
      if (l > 14) { IN.aimAct = true; IN.aimA = Math.atan2(dy, dx); if (t.role === 'aim' && cfg.auto && l >= R * 0.9) IN.fire = true; }
      if (t.role === 'fire') IN.fire = true;
    }
  }
  if (!('ontouchstart' in window)) {
    let kx = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    let ky = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
    if (kx || ky) { const l = Math.hypot(kx, ky); IN.mx = kx / l; IN.my = ky / l; }
    if (mouseA !== null) { IN.aimAct = true; IN.aimA = mouseA; }
    if (mouseDown) IN.fire = true;
  }
}

/* ------------------------------------------------------------------- physics */
function resolve(p) {
  const m = G.map, pr = RULES.pr;
  for (const r of m.rects) {
    const cxp = clamp(p.x, r[0], r[0] + r[2]), cyp = clamp(p.y, r[1], r[1] + r[3]);
    const dx = p.x - cxp, dy = p.y - cyp, d2 = dx * dx + dy * dy;
    if (d2 < pr * pr) {
      if (d2 > 1e-4) { const d = Math.sqrt(d2), k = (pr - d) / d; p.x += dx * k; p.y += dy * k; }
      else {
        const l = p.x - r[0], rr = r[0] + r[2] - p.x, t = p.y - r[1], b = r[1] + r[3] - p.y, mn = Math.min(l, rr, t, b);
        if (mn === l) p.x = r[0] - pr; else if (mn === rr) p.x = r[0] + r[2] + pr; else if (mn === t) p.y = r[1] - pr; else p.y = r[1] + r[3] + pr;
      }
    }
  }
  p.x = clamp(p.x, pr, m.w - pr); p.y = clamp(p.y, pr, m.h - pr);
}
function moveCol(p, dx, dy) { p.x += dx; resolve(p); p.y += dy; resolve(p); }
function hitWall(x, y) {
  const m = G.map;
  if (x < 0 || y < 0 || x > m.w || y > m.h) return true;
  for (const r of m.rects) if (x >= r[0] && x <= r[0] + r[2] && y >= r[1] && y <= r[1] + r[3]) return true;
  return false;
}
function segHit(x1, y1, x2, y2, cx0, cy0, r) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
  let t = l2 ? ((cx0 - x1) * dx + (cy0 - y1) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = x1 + dx * t - cx0, py = y1 + dy * t - cy0;
  return px * px + py * py <= r * r;
}

/* ---------------------------------------------------------------- particles */
const PN = 140, pa = { x: new Float32Array(PN), y: new Float32Array(PN), vx: new Float32Array(PN), vy: new Float32Array(PN), l: new Float32Array(PN), ml: new Float32Array(PN), s: new Float32Array(PN) };
const pc = new Array(PN).fill('#fff'); let pk = 0;
function emit(x, y, n, col, sp, life, size) {
  for (let i = 0; i < n; i++) {
    const k = pk; pk = (pk + 1) % PN;
    const a = Math.random() * PI2, v = sp * (0.3 + Math.random() * 0.7);
    pa.x[k] = x; pa.y[k] = y; pa.vx[k] = Math.cos(a) * v; pa.vy[k] = Math.sin(a) * v;
    pa.l[k] = pa.ml[k] = life * (0.6 + Math.random() * 0.4); pa.s[k] = size; pc[k] = col;
  }
}
function clearParticles() { pa.l.fill(0); }
function stepParticles(dt) {
  for (let k = 0; k < PN; k++) if (pa.l[k] > 0) { pa.l[k] -= dt; pa.x[k] += pa.vx[k] * dt; pa.y[k] += pa.vy[k] * dt; pa.vx[k] *= 0.93; pa.vy[k] *= 0.93; }
}

/* ------------------------------------------------------------------- bullets */
function spawnShots(o, id, wid, x, y, a, sd, spread) {
  const w = W[wid], rnd = mulberry(sd);
  for (let i = 0; i < w.pel; i++) {
    const aa = a + (rnd() * 2 - 1) * spread * DEG;
    G.bullets.push({ o, k: id * 16 + i, w: wid, x, y, px: x, py: y, vx: Math.cos(aa) * w.spd, vy: Math.sin(aa) * w.spd, d: 0 });
  }
}
function removeBullet(o, k) {
  const B = G.bullets;
  for (let i = 0; i < B.length; i++) if (B[i].o === o && B[i].k === k) { B[i] = B[B.length - 1]; B.pop(); return; }
}
function falloff(w, d) { const h = w.rng * 0.5; return d <= h ? 1 : 1 + (w.fo - 1) * ((d - h) / h); }
function simBullets(dt) {
  const B = G.bullets;
  for (let i = B.length - 1; i >= 0; i--) {
    const b = B[i], w = W[b.w];
    const steps = Math.max(1, Math.ceil(w.spd * dt / 14)), sdt = dt / steps;
    let rem = false;
    for (let s = 0; s < steps; s++) {
      b.px = b.x; b.py = b.y; b.x += b.vx * sdt; b.y += b.vy * sdt; b.d += w.spd * sdt;
      if (b.d >= w.rng) { rem = true; break; }
      if (hitWall(b.x, b.y)) { emit(b.x, b.y, 3, '#ffcf70', 120, 0.25, 2); rem = true; break; }
      if (G.role === 'h' && G.state === 'play' && hostBulletHit(b)) { rem = true; break; }
    }
    if (rem) { B[i] = B[B.length - 1]; B.pop(); }
  }
}

/* -------------------------------------------------- weapons & abilities (local) */
function shoot(p) {
  const w = curW(p);
  p.ammo[p.cur]--; p.fireCd = w.rate;
  const moving = Math.hypot(p.vx, p.vy) > 40;
  const spread = w.spr + p.bloom + (moving ? w.mvSpr : 0);
  p.bloom = Math.min(w.bmax, p.bloom + w.bloom);
  const sd = (Math.random() * 4294967295) >>> 0;
  const ox = p.x + Math.cos(p.a) * (RULES.pr + 6), oy = p.y + Math.sin(p.a) * (RULES.pr + 6);
  const id = ++G.seq;
  spawnShots(p.i, id, w.id, ox, oy, p.a, sd, spread);
  Net.send({ t: 'f', i: id, w: w.id, x: r1(ox), y: r1(oy), a: r2(p.a), s: sd, sp: r2(spread) });
  p.flash = 0.06; shake = Math.min(12, shake + w.kick * 0.5); Snd.play(w.key);
  if (G.role === 'h') { p.prot = 0; if (p.invT > 0) p.revT = 1.2; }
}
function pressReload() {
  if (G.state !== 'play') return;
  const p = me(); if (!p.alive || p.reloadT > 0) return;
  const w = curW(p); if (p.ammo[p.cur] >= w.mag) return;
  p.reloadT = w.rel; Snd.play('reload');
}
function pressSwap() {
  if (G.state !== 'play') return;
  const p = me(); if (!p.alive || p.swapT > 0) return;
  p.reloadT = 0; p.cur ^= 1; p.swapT = 0.3; p.bloom = 0; Snd.play('swap');
}
function startDash(p) {
  let dx = IN.mx, dy = IN.my; const l = Math.hypot(dx, dy);
  if (l < 0.2) { dx = Math.cos(p.a); dy = Math.sin(p.a); } else { dx /= l; dy /= l; }
  p.dashT = AB.dash.dur; p.ddx = dx; p.ddy = dy;
}
function pressAb(slot) {
  if (G.state !== 'play') return;
  const p = me(); if (!p.alive) return;
  if (G.role === 'h') { useAb(0, slot); return; }
  const ty = p.ab[slot];
  if (p.cd[slot] > 0.05 || (ty === 'heal' && p.hp >= RULES.hp)) return;
  Net.send({ t: 'ar', s: slot });             // request; host validates and applies the effect
  p.cd[slot] = AB[ty].cd;                      // optimistic, host snapshot corrects it
  if (ty === 'dash') startDash(p);
  if (ty !== 'scan') fxAb(G.me, ty, 1);
}
function controlMe(dt) {
  const p = me(), playing = G.state === 'play' && p.alive;
  p.flash = Math.max(0, p.flash - dt); p.hitF = Math.max(0, p.hitF - dt);
  p.fireCd -= dt; p.swapT = Math.max(0, p.swapT - dt);
  p.bloom = Math.max(0, p.bloom - curW(p).brec * dt);
  if (p.reloadT > 0) { p.reloadT -= dt; if (p.reloadT <= 0) { p.reloadT = 0; p.ammo[p.cur] = curW(p).mag; Snd.play('rdone'); } }
  if (!playing) { p.vx = p.vy = 0; return; }
  if (IN.aimAct) p.a = lerpA(p.a, IN.aimA, 1 - Math.exp(-8 * cfg.sens * dt));
  let dx, dy;
  if (p.dashT > 0) { p.dashT -= dt; const s = AB.dash.dist / AB.dash.dur; dx = p.ddx * s; dy = p.ddy * s; }
  else { const s = RULES.speed * curW(p).mv * (p.healT > 0 ? 0.7 : 1); dx = IN.mx * s; dy = IN.my * s; }
  p.vx = dx; p.vy = dy; moveCol(p, dx * dt, dy * dt);
  if (IN.fire && p.fireCd <= 0 && p.reloadT <= 0 && p.swapT <= 0) {
    if (p.ammo[p.cur] > 0) shoot(p); else { p.fireCd = 0.3; if (p.ammo[p.cur] <= 0) { Snd.play('empty'); pressReload(); } }
  }
}

/* ------------------------------------------------ remote player + status decay */
function setTarget(p, a) {
  p.tx = a[0]; p.ty = a[1]; p.ta = a[2]; p.tvx = a[3]; p.tvy = a[4]; p.wid = a[5]; p.rl = a[6]; p.tAge = 0;
}
function remoteStep(p, dt) {
  p.tAge += dt; p.flash = Math.max(0, p.flash - dt); p.hitF = Math.max(0, p.hitF - dt);
  if (!p.alive) { p.vx = p.vy = 0; return; }
  const e = Math.min(p.tAge, 0.12), gx = p.tx + p.tvx * e, gy = p.ty + p.tvy * e;
  if (Math.abs(gx - p.x) > 200 || Math.abs(gy - p.y) > 200) { p.x = gx; p.y = gy; }
  else { const k = 1 - Math.exp(-18 * dt); p.x += (gx - p.x) * k; p.y += (gy - p.y) * k; }
  p.a = lerpA(p.a, p.ta, 1 - Math.exp(-25 * dt)); p.vx = p.tvx; p.vy = p.tvy;
}
function decay(dt) {
  for (const p of P) {
    for (let s = 0; s < 2; s++) if (p.cd[s] > 0) p.cd[s] = Math.max(0, p.cd[s] - dt);
    if (p.shT > 0) { p.shT -= dt; if (p.shT <= 0) { p.shT = 0; p.shHP = 0; } }
    if (p.invT > 0) p.invT -= dt;
    if (p.revT > 0) p.revT -= dt;
    if (p.scanT > 0) p.scanT -= dt;
    if (p.healT > 0) p.healT -= dt;
    if (p.prot > 0) p.prot -= dt;
    if (!p.alive && p.respT > 0) p.respT -= dt;
  }
}

/* ------------------------------------------------- host-authoritative logic */
function useAb(pi, slot) {
  const p = P[pi];
  if (G.state !== 'play' || !p.alive || slot < 0 || slot > 1 || p.cd[slot] > 0.05) return false;
  const ty = p.ab[slot], A = AB[ty];
  if (ty === 'heal' && p.hp >= RULES.hp) return false;
  p.cd[slot] = A.cd;
  let ok = 1;
  if (ty === 'inv') { p.invT = A.dur; p.revT = 0; }
  else if (ty === 'shield') { p.shT = A.dur; p.shHP = A.hp; }
  else if (ty === 'heal') { p.healT = A.dur; }
  else if (ty === 'scan') {
    const e = P[1 - pi];
    ok = e.alive && Math.hypot(e.x - p.x, e.y - p.y) <= A.range ? 1 : 0;
    if (ok) e.scanT = A.dur;
  }
  else if (ty === 'dash' && pi === 0) startDash(p);
  Net.send({ t: 'ab', p: pi, ty, ok });
  fxAb(pi, ty, ok);
  return true;
}
function hostBulletHit(b) {
  const vi = 1 - b.o, v = P[vi];
  if (!v.alive || v.prot > 0) return false;
  if (!segHit(b.px, b.py, b.x, b.y, v.x, v.y, RULES.pr)) return false;
  const w = W[b.w], dm = w.dmg * falloff(w, b.d);
  let d = dm, sb = 0;
  if (v.shT > 0) {
    const a = Math.min(v.shHP, d); v.shHP -= a; d -= a;
    if (v.shHP <= 0.01) { v.shT = 0; v.shHP = 0; sb = 1; }
  }
  v.hp -= d;
  if (v.invT > 0) v.revT = Math.max(v.revT, 0.8);
  const ev = { t: 'h', o: b.o, k: b.k, v: vi, dm: Math.max(1, r0(dm)), x: r0(b.x), y: r0(b.y), sb };
  Net.send(ev); onHit(ev, true);
  if (v.hp <= 0) die(vi, b.o);
  return true;
}
function die(vi, killer) {
  const v = P[vi];
  P[killer].kills++;
  const ev = { t: 'k', v: vi, o: killer, ks: [P[0].kills, P[1].kills], x: r0(v.x), y: r0(v.y) };
  Net.send(ev); onKill(ev);
  if (P[killer].kills >= RULES.win || G.ot) endMatch(killer, 'kills');
}
function pickSpawn(i) {
  const e = P[1 - i]; let best = G.map.spawns[0], bd = -1;
  for (const s of G.map.spawns) { const d = Math.hypot(s[0] - e.x, s[1] - e.y); if (d > bd) { bd = d; best = s; } }
  return best;
}
function respawn(i) {
  const s = pickSpawn(i), m = { t: 'rs', p: i, x: s[0], y: s[1] };
  Net.send(m); onRs(m);
}
function endMatch(w, reason) {
  const m = { t: 'end', w, ks: [P[0].kills, P[1].kills], r: reason };
  Net.send(m); onEnd(m);
}
function hostStep(dt) {
  if (G.state === 'count') {
    if (G.tm <= 0) { G.state = 'play'; G.tm = RULES.time; G.goT = 0.8; Snd.play('go'); }
  } else if (G.state === 'play') {
    if (!G.ot && G.tm <= 0) {
      const a = P[0].kills, b = P[1].kills;
      if (a !== b) endMatch(a > b ? 0 : 1, 'time'); else { G.ot = true; G.tm = 0; toast('SUDDEN DEATH'); }
    }
    for (let i = 0; i < 2; i++) {
      const p = P[i];
      if (p.healT > 0 && p.alive) p.hp = Math.min(RULES.hp, p.hp + AB.heal.amt / AB.heal.dur * dt);
      if (!p.alive && p.respT <= 0) respawn(i);
    }
  }
  if (G.state !== 'over') {
    G.snapAcc += dt;
    if (G.snapAcc >= 1 / 30) { G.snapAcc = 0; sendSnap(); }
  }
}
const pst = p => [r0(p.hp), p.alive ? 1 : 0, r1(p.shT), r0(p.shHP), r1(p.invT), r1(p.healT), r1(p.revT), r1(p.scanT), r1(p.cd[0]), r1(p.cd[1])];
function sendSnap() {
  const h = P[0];
  Net.send({ t: 's', st: G.state, tm: r1(G.tm), ot: G.ot ? 1 : 0, k: [P[0].kills, P[1].kills],
    h: [r1(h.x), r1(h.y), r2(h.a), r0(h.vx), r0(h.vy), curId(h), h.reloadT > 0 ? 1 : 0], p: [pst(P[0]), pst(P[1])] });
}

/* ----------------------------------------------- state changes seen by both */
function onHit(m, own) {
  if (!own) removeBullet(m.o, m.k);
  const v = P[m.v]; v.hitF = 0.12;
  emit(m.x, m.y, 6, '#ffd27a', 160, 0.3, 3);
  if (m.sb) { Snd.play('sbreak'); emit(v.x, v.y, 14, '#35d0ff', 220, 0.5, 3); }
  if (nums.length < 14) nums.push({ x: v.x + (Math.random() - 0.5) * 16, y: v.y - 22, s: m.v === G.me ? '-' + m.dm : '' + m.dm, t: 0.8, c: m.v === G.me ? '#ff6b6b' : '#ffe27a' });
  if (m.v === G.me) { hurtA = 1; shake = Math.min(12, shake + 3); vib(25); Snd.play('hurt'); }
  else { hm.t = 0.18; hm.x = m.x; hm.y = m.y; vib(10); Snd.play('hit'); }
}
function onKill(m) {
  const v = P[m.v];
  v.alive = false; v.hp = 0; v.respT = RULES.respawn; v.shT = v.invT = v.healT = v.scanT = v.revT = 0; v.dashT = 0; v.reloadT = 0;
  P[0].kills = m.ks[0]; P[1].kills = m.ks[1];
  emit(v.x, v.y, 28, colFor(m.v), 260, 0.8, 4); emit(v.x, v.y, 10, '#ffffff', 320, 0.4, 2);
  shake = Math.min(12, shake + 5);
  feed.unshift({ s: (m.o === G.me ? 'YOU' : 'ENEMY') + '  ▸  ' + (m.v === G.me ? 'YOU' : 'ENEMY'), t: 4, mine: m.o === G.me });
  if (feed.length > 3) feed.pop();
  if (m.v === G.me) { Snd.play('die'); vib(70); } else Snd.play('kill');
}
function onRs(m) {
  const p = P[m.p];
  p.alive = true; p.hp = RULES.hp; p.x = p.tx = m.x; p.y = p.ty = m.y; p.vx = p.vy = 0; p.prot = RULES.prot; p.tAge = 0;
  emit(m.x, m.y, 14, colFor(m.p), 200, 0.5, 3);
  if (m.p === G.me) {
    p.ammo = [W[p.w[0]].mag, W[PISTOL].mag]; p.reloadT = 0; p.cur = 0; p.bloom = 0; p.dashT = 0; p.swapT = 0;
    cam.x = p.x - CW / SC / 2; cam.y = p.y - CH / SC / 2;
  }
}
function onEnd(m) {
  G.state = 'over'; G.winner = m.w; G.endReason = m.r; G.overT = 1.6; G.rm = [false, false]; G.oppRm = false;
  P[0].kills = m.ks[0]; P[1].kills = m.ks[1]; touches.clear();
}
function fxAb(pi, ty, ok) {
  const p = P[pi], col = colFor(pi), mine = pi === G.me;
  const v = mine ? 1 : clamp(1 - Math.hypot(p.x - me().x, p.y - me().y) / 900, 0.25, 1);
  if (ty === 'inv') { emit(p.x, p.y, 16, '#9fe8ff', 120, 0.6, 3); Snd.play('inv', v); }
  else if (ty === 'dash') { emit(p.x, p.y, 10, '#ffffff', 160, 0.3, 2); Snd.play('dash', v); }
  else if (ty === 'shield') { Snd.play('shield', v); }
  else if (ty === 'heal') { emit(p.x, p.y, 10, '#46e08a', 80, 0.7, 3); Snd.play('heal', v); }
  else if (ty === 'scan') {
    pulses.push({ x: p.x, y: p.y, t: 0, col }); Snd.play('scan', v);
    if (mine) toast(ok ? 'TARGET FOUND' : 'NO TARGET IN RANGE'); else if (ok) toast('YOU WERE SCANNED');
  }
}
function showResult() {
  const win = G.winner === G.me;
  $('resT').textContent = win ? 'VICTORY' : 'DEFEAT'; $('resT').className = win ? '' : 'lose';
  $('resS').textContent = P[G.me].kills + ' – ' + P[1 - G.me].kills + (G.endReason === 'time' ? '  (time up)' : '');
  $('rmStat').textContent = G.oppRm ? 'Opponent wants a rematch!' : ''; G.rmMine = false; $('bRematch').disabled = false;
  show('result'); Snd.play(win ? 'win' : 'lose');
}

/* ---------------------------------------------------------------- match flow */
function beginMatch(ld) {
  G.ld = ld; G.map = MAPS[0];
  P = [mkP(0, ld[0]), mkP(1, ld[1])]; G.me = G.role === 'h' ? 0 : 1;
  const m = G.map;
  for (let i = 0; i < 2; i++) {
    const s = m.spawns[i], p = P[i];
    p.x = p.tx = s[0]; p.y = p.ty = s[1]; p.a = p.ta = Math.atan2(m.h / 2 - s[1], m.w / 2 - s[0]);
  }
  G.bullets.length = 0; feed.length = 0; nums.length = 0; pulses.length = 0; clearParticles(); touches.clear();
  G.state = 'count'; G.tm = RULES.count; G.ot = false; G.winner = -1; G.rm = [false, false]; G.overT = 0;
  G.hint = 7; G.goT = 0; G.snapAcc = 0; G.pAcc = 0; G.toast = null; shake = 0; hurtA = 0; hm.t = 0;
  const p = me(); cam.x = p.x - CW / SC / 2; cam.y = p.y - CH / SC / 2;
  show(''); Snd.play('start');
}
function hostStartMatch(ld) { Net.send({ t: 'start', ld }); beginMatch(ld); }
function maybeStart() {
  if (G.role === 'h' && G.state === 'loadout' && LD.mine.ready && LD.opp.ready && LD.opp.w !== null)
    hostStartMatch([{ w: LD.mine.w, a: LD.mine.a.slice() }, { w: LD.opp.w, a: LD.opp.a.slice() }]);
}
function checkRematch() { if (G.role === 'h' && G.rm[0] && G.rm[1] && G.ld) hostStartMatch(G.ld); }

function onSnap(m) {
  if (G.state !== 'count' && G.state !== 'play') return;
  if (G.state === 'count' && m.st === 'play') { G.state = 'play'; G.goT = 0.8; Snd.play('go'); }
  G.tm = m.tm; G.ot = !!m.ot; P[0].kills = m.k[0]; P[1].kills = m.k[1];
  setTarget(P[0], m.h);
  for (let i = 0; i < 2; i++) {
    const p = P[i], a = m.p[i];
    p.hp = a[0]; p.alive = !!a[1]; p.shT = a[2]; p.shHP = a[3]; p.invT = a[4]; p.healT = a[5]; p.revT = a[6]; p.scanT = a[7]; p.cd[0] = a[8]; p.cd[1] = a[9];
  }
}
function onFireMsg(m) {
  const ri = 1 - G.me, p = P[ri], w = W[m.w]; if (!w) return;
  if (G.role === 'h') {
    if (!p.alive || G.state !== 'play') return;
    if (m.w !== p.w[0] && m.w !== PISTOL) return;
    const now = performance.now(); if (now - p.lastFire < w.rate * 750) return;
    p.lastFire = now; p.prot = 0; if (p.invT > 0) p.revT = 1.2;
  }
  spawnShots(ri, m.i | 0, m.w, +m.x, +m.y, +m.a, m.s | 0, clamp(+m.sp || 0, 0, 20));
  p.flash = 0.06;
  Snd.play(w.key, clamp(1 - Math.hypot(p.x - me().x, p.y - me().y) / 1000, 0.2, 0.8));
}
const MATCH_MSGS = { p: 1, s: 1, f: 1, ar: 1, ab: 1, h: 1, k: 1, rs: 1, end: 1 };
function onMsg(m) {
  if (MATCH_MSGS[m.t] && G.state !== 'count' && G.state !== 'play' && G.state !== 'over') return;
  switch (m.t) {
    case 'hi': if (m.v !== VER) { Net.drop(); showMsg('VERSION MISMATCH', 'Both phones need the same version of the game.', 'OK', () => lostUi()); } break;
    case 'ld': onLd(m); break;
    case 'start': if (G.role === 'g' && Array.isArray(m.ld)) beginMatch(m.ld); break;
    case 'p': if (G.role === 'h' && P.length) setTarget(P[1], m.p); break;
    case 's': if (G.role === 'g') onSnap(m); break;
    case 'f': onFireMsg(m); break;
    case 'ar': if (G.role === 'h') useAb(1, m.s | 0); break;
    case 'ab': if (G.role === 'g' && (m.p !== G.me || m.ty === 'scan')) fxAb(m.p, m.ty, m.ok); break;
    case 'h': if (G.role === 'g') onHit(m); break;
    case 'k': if (G.role === 'g') onKill(m); break;
    case 'rs': if (G.role === 'g') onRs(m); break;
    case 'end': if (G.role === 'g') onEnd(m); break;
    case 'rm': G.oppRm = true; if (G.role === 'h') { G.rm[1] = true; checkRematch(); } if (G.screen === 'result' && !G.rmMine) $('rmStat').textContent = 'Opponent wants a rematch!'; break;
    case 'lo': enterLoadout(); break;
    case 'pg': Net.send({ t: 'pn', n: m.n }); break;
    case 'pn': G.rtt = Date.now() - m.n; break;
  }
}

/* ---------------------------------------------------------------- per-frame */
function step(dt) {
  computeInput();
  if (G.state === 'count' || (G.state === 'play' && !G.ot)) G.tm -= dt;
  if (G.state === 'over' && G.overT > 0) { G.overT -= dt; if (G.overT <= 0) showResult(); }
  controlMe(dt);
  remoteStep(en(), dt);
  decay(dt);
  simBullets(dt);
  if (G.role === 'h') hostStep(dt);
  else if (G.state === 'count' || G.state === 'play') {
    G.pAcc += dt;
    if (G.pAcc >= 1 / 30) {
      G.pAcc = 0; const p = me();
      Net.send({ t: 'p', p: [r1(p.x), r1(p.y), r2(p.a), r0(p.vx), r0(p.vy), curId(p), p.reloadT > 0 ? 1 : 0] });
    }
  }
  stepParticles(dt);
  shake *= Math.exp(-12 * dt); hurtA = Math.max(0, hurtA - dt * 2.5); hm.t = Math.max(0, hm.t - dt);
  G.goT = Math.max(0, G.goT - dt); G.hint = Math.max(0, G.hint - dt);
  if (G.toast) { G.toast.t -= dt; if (G.toast.t <= 0) G.toast = null; }
  for (let i = feed.length - 1; i >= 0; i--) { feed[i].t -= dt; if (feed[i].t <= 0) feed.splice(i, 1); }
  for (let i = nums.length - 1; i >= 0; i--) { nums[i].t -= dt; nums[i].y -= 30 * dt; if (nums[i].t <= 0) nums.splice(i, 1); }
  for (let i = pulses.length - 1; i >= 0; i--) { pulses[i].t += dt; if (pulses[i].t > 0.6) pulses.splice(i, 1); }
}

/* ------------------------------------------------------------------ drawing */
const circle = (x, y, r) => { cx.beginPath(); cx.arc(x, y, r, 0, PI2); };
function rrect(x, y, w, h, r, fill) {
  r = Math.min(r, w / 2, h / 2); if (w <= 0) return;
  cx.beginPath(); cx.moveTo(x + r, y); cx.arcTo(x + w, y, x + w, y + h, r); cx.arcTo(x + w, y + h, x, y + h, r);
  cx.arcTo(x, y + h, x, y, r); cx.arcTo(x, y, x + w, y, r); cx.closePath(); cx.fillStyle = fill; cx.fill();
}
function text(s, x, y, size, col, align, weight) {
  cx.font = (weight || '700') + ' ' + size + 'px sans-serif-condensed, "Roboto Condensed", "Arial Narrow", sans-serif';
  cx.textAlign = align || 'center'; cx.textBaseline = 'middle'; cx.fillStyle = col; cx.fillText(s, x, y);
}
function enemyAlpha(p) {
  if (!p.alive) return 0;
  if (p.invT <= 0) return 1;
  if (p.scanT > 0) return 1;
  if (p.revT > 0) return 0.85;
  const d = Math.hypot(p.x - me().x, p.y - me().y);   // close-range shimmer = counterplay
  return d < 70 ? 0.06 + 0.18 * (1 - d / 70) : 0;
}
function drawWorld() {
  const m = G.map, T = m.theme;
  cx.fillStyle = T.floor; cx.fillRect(0, 0, m.w, m.h);
  cx.strokeStyle = T.grid; cx.lineWidth = 1; cx.beginPath();
  for (let x = 0; x <= m.w; x += 80) { cx.moveTo(x, 0); cx.lineTo(x, m.h); }
  for (let y = 0; y <= m.h; y += 80) { cx.moveTo(0, y); cx.lineTo(m.w, y); }
  cx.stroke();
  cx.strokeStyle = 'rgba(245,197,66,.16)'; cx.lineWidth = 3; cx.setLineDash([26, 18]); cx.beginPath();
  cx.moveTo(0, m.h / 2); cx.lineTo(m.w, m.h / 2); cx.moveTo(m.w / 2, 0); cx.lineTo(m.w / 2, m.h); cx.stroke(); cx.setLineDash([]);
  cx.lineWidth = 3;
  for (let i = 0; i < m.spawns.length; i++) { cx.strokeStyle = i % 2 ? 'rgba(255,90,60,.25)' : 'rgba(53,208,255,.25)'; circle(m.spawns[i][0], m.spawns[i][1], 30); cx.stroke(); }
  for (const r of m.rects) {
    const crate = r[4] === 'c';
    cx.fillStyle = 'rgba(0,0,0,.4)'; cx.fillRect(r[0] + 5, r[1] + 7, r[2], r[3]);
    cx.fillStyle = crate ? T.crate : T.wall; cx.fillRect(r[0], r[1], r[2], r[3]);
    cx.fillStyle = crate ? T.crateTop : T.wallTop; cx.fillRect(r[0], r[1], r[2], 5);
    if (crate) {
      cx.strokeStyle = 'rgba(0,0,0,.35)'; cx.lineWidth = 2; cx.beginPath();
      cx.moveTo(r[0] + 5, r[1] + 7); cx.lineTo(r[0] + r[2] - 5, r[1] + r[3] - 5); cx.moveTo(r[0] + r[2] - 5, r[1] + 7); cx.lineTo(r[0] + 5, r[1] + r[3] - 5); cx.stroke();
    }
  }
  cx.strokeStyle = T.accent; cx.lineWidth = 6; cx.strokeRect(-3, -3, m.w + 6, m.h + 6);
}
function drawPlayer(p, i) {
  if (!p.alive) return;
  const mine = i === G.me;
  let a = mine ? (p.invT > 0 ? 0.4 : 1) : enemyAlpha(p);
  if (p.prot > 0 && Math.sin(G.t * 30) > 0) a *= 0.45;
  if (a <= 0.01) return;
  const col = colFor(i), wid = mine ? curId(p) : p.wid, w = W[wid] || W[0], pr = RULES.pr;
  const reloading = mine ? p.reloadT > 0 : p.rl;
  cx.save(); cx.globalAlpha = a; cx.translate(p.x, p.y);
  cx.fillStyle = 'rgba(0,0,0,.35)'; circle(3, 5, pr); cx.fill();
  if (p.shT > 0) { cx.strokeStyle = '#35d0ff'; cx.lineWidth = 3; cx.globalAlpha = a * (0.4 + 0.5 * clamp(p.shHP / AB.shield.hp, 0, 1)); circle(0, 0, pr + 7); cx.stroke(); cx.globalAlpha = a; }
  if (p.healT > 0) { cx.strokeStyle = '#46e08a'; cx.lineWidth = 3; circle(0, 0, pr + 4 + Math.sin(G.t * 12) * 2); cx.stroke(); }
  cx.rotate(p.a + (reloading ? Math.sin(G.t * 18) * 0.18 : 0));
  cx.fillStyle = '#d9dce4'; cx.fillRect(9, -3.5, w.len, 7);
  cx.fillStyle = '#6b7080'; cx.fillRect(9, -3.5, 8, 7);
  if (p.flash > 0) {
    cx.fillStyle = '#ffeaa0'; cx.beginPath(); const tx = 9 + w.len;
    cx.moveTo(tx, 0); cx.lineTo(tx + 14, -7); cx.lineTo(tx + 26, 0); cx.lineTo(tx + 14, 7); cx.fill();
  }
  cx.fillStyle = '#0a0b0e'; circle(0, 0, pr + 2.5); cx.fill();
  cx.fillStyle = p.hitF > 0 ? '#ffffff' : col; circle(0, 0, pr); cx.fill();
  cx.fillStyle = 'rgba(0,0,0,.28)'; circle(-2, 0, pr * 0.55); cx.fill();
  cx.fillStyle = '#fff'; cx.fillRect(pr * 0.35, -4, 6, 8);
  cx.restore();
  if (!mine && p.scanT > 0) {
    cx.save(); cx.translate(p.x, p.y); cx.rotate(G.t * 2); cx.strokeStyle = '#ff3b3b'; cx.lineWidth = 2.5;
    const s = pr + 12; cx.strokeRect(-s, -s, s * 2, s * 2); cx.restore();
  }
  cx.globalAlpha = a; rrect(p.x - 19, p.y - pr - 15, 38, 5, 2, 'rgba(0,0,0,.6)');
  rrect(p.x - 19, p.y - pr - 15, 38 * clamp(p.hp / RULES.hp, 0, 1), 5, 2, mine ? '#46e08a' : '#ff6a4d');
  if (mine && p.reloadT > 0) {
    cx.strokeStyle = '#ffe27a'; cx.lineWidth = 3; cx.beginPath();
    cx.arc(p.x, p.y, pr + 11, -Math.PI / 2, -Math.PI / 2 + PI2 * (1 - p.reloadT / curW(p).rel)); cx.stroke();
  }
  cx.globalAlpha = 1;
}
function drawWorldFx(dt) {
  const p = me();
  if (p.alive && G.state === 'play') {
    cx.strokeStyle = 'rgba(255,255,255,.22)'; cx.lineWidth = 2; cx.setLineDash([4, 9]); cx.beginPath();
    const L = curW(p).rng * 0.28 + 30; cx.moveTo(p.x + Math.cos(p.a) * 26, p.y + Math.sin(p.a) * 26);
    cx.lineTo(p.x + Math.cos(p.a) * L, p.y + Math.sin(p.a) * L); cx.stroke(); cx.setLineDash([]);
  }
  for (const pl of pulses) {
    const f = pl.t / 0.6; cx.globalAlpha = 1 - f; cx.strokeStyle = pl.col; cx.lineWidth = 4;
    circle(pl.x, pl.y, AB.scan.range * Math.min(1, pl.t / 0.5)); cx.stroke(); cx.globalAlpha = 1;
  }
  for (const b of G.bullets) {
    const own = b.o === G.me, w = W[b.w], tl = w.id === 3 ? 0.03 : 0.018;
    cx.strokeStyle = own ? 'rgba(255,226,122,.35)' : 'rgba(255,110,80,.35)'; cx.lineWidth = w.pel > 1 ? 4 : 6; cx.beginPath();
    cx.moveTo(b.x - b.vx * tl, b.y - b.vy * tl); cx.lineTo(b.x, b.y); cx.stroke();
    cx.strokeStyle = own ? '#fff3c4' : '#ffd0c4'; cx.lineWidth = w.pel > 1 ? 1.8 : 2.6; cx.stroke();
  }
  for (let k = 0; k < PN; k++) if (pa.l[k] > 0) { cx.globalAlpha = pa.l[k] / pa.ml[k]; cx.fillStyle = pc[k]; const s = pa.s[k]; cx.fillRect(pa.x[k] - s / 2, pa.y[k] - s / 2, s, s); }
  cx.globalAlpha = 1;
  if (hm.t > 0) {
    cx.strokeStyle = '#fff'; cx.lineWidth = 3; cx.globalAlpha = hm.t / 0.18; const s = 9 + (0.18 - hm.t) * 40;
    cx.beginPath(); cx.moveTo(hm.x - s, hm.y - s); cx.lineTo(hm.x + s, hm.y + s); cx.moveTo(hm.x + s, hm.y - s); cx.lineTo(hm.x - s, hm.y + s); cx.stroke(); cx.globalAlpha = 1;
  }
  for (const n of nums) { cx.globalAlpha = clamp(n.t / 0.4, 0, 1); text(n.s, n.x, n.y, 17, n.c, 'center', '900'); }
  cx.globalAlpha = 1;
}
function drawBtn(n, edit) {
  const b = btnRect(n), pr = !!pressed[n];
  cx.save(); cx.globalAlpha = pr ? 0.95 : 0.62;
  cx.fillStyle = pr ? '#3b3420' : '#0e1015'; cx.strokeStyle = n === 'fire' ? '#f5c542' : '#d7d9df'; cx.lineWidth = n === 'fire' ? 4 : 3;
  circle(b.x, b.y, b.r); cx.fill(); cx.stroke(); cx.globalAlpha = 1;
  if (n === 'fire') {
    cx.strokeStyle = '#f5c542'; cx.lineWidth = 3; circle(b.x, b.y, b.r * 0.4); cx.stroke(); cx.beginPath();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { cx.moveTo(b.x + dx * b.r * 0.28, b.y + dy * b.r * 0.28); cx.lineTo(b.x + dx * b.r * 0.62, b.y + dy * b.r * 0.62); }
    cx.stroke();
  } else if (n === 'ab1' || n === 'ab2') {
    const slot = n === 'ab1' ? 0 : 1, ty = edit ? LD.mine.a[slot] : me().ab[slot], A = AB[ty];
    text(A.ico, b.x, b.y + 2, b.r * 0.95, '#fff', 'center', '400');
    if (!edit) {
      const p = me(), cd = p.cd[slot];
      if (cd > 0) {
        cx.fillStyle = 'rgba(0,0,0,.62)'; cx.beginPath(); cx.moveTo(b.x, b.y);
        cx.arc(b.x, b.y, b.r - 1, -Math.PI / 2, -Math.PI / 2 + PI2 * clamp(cd / A.cd, 0, 1)); cx.closePath(); cx.fill();
        text(String(Math.ceil(cd)), b.x, b.y, b.r * 0.7, '#fff', 'center', '900');
      }
      if ((ty === 'inv' && p.invT > 0) || (ty === 'shield' && p.shT > 0) || (ty === 'heal' && p.healT > 0)) {
        cx.strokeStyle = '#f5c542'; cx.lineWidth = 4; circle(b.x, b.y, b.r + 4); cx.stroke();
      }
    }
  } else if (n === 'rel') text('↻', b.x, b.y, b.r * 1.3, '#fff', 'center', '700');
  else text('⇄', b.x, b.y, b.r * 1.1, '#fff', 'center', '700');
  cx.restore();
}
function drawControls(edit) {
  cx.lineWidth = 3;
  let mv = null, am = null;
  for (const t of touches.values()) { if (t.role === 'move') mv = t; else if (t.role === 'aim' || t.role === 'fire') am = t; }
  cx.strokeStyle = 'rgba(255,255,255,.18)';
  if (!mv || edit) { circle(CW * 0.13, CH * 0.72, 55); cx.stroke(); text('MOVE', CW * 0.13, CH * 0.72, 13, 'rgba(255,255,255,.3)'); }
  if (mv && !edit) {
    cx.strokeStyle = 'rgba(255,255,255,.3)'; circle(mv.ax, mv.ay, 55); cx.stroke();
    cx.fillStyle = 'rgba(255,255,255,.35)'; const l = Math.hypot(mv.x - mv.ax, mv.y - mv.ay) || 1, k = Math.min(55, l) / l; circle(mv.ax + (mv.x - mv.ax) * k, mv.ay + (mv.y - mv.ay) * k, 24); cx.fill();
  }
  if (am && !edit) {
    cx.strokeStyle = 'rgba(245,197,66,.45)'; circle(am.ax, am.ay, 60); cx.stroke();
    cx.fillStyle = 'rgba(245,197,66,.4)'; const l = Math.hypot(am.x - am.ax, am.y - am.ay) || 1, k = Math.min(60, l) / l; circle(am.ax + (am.x - am.ax) * k, am.ay + (am.y - am.ay) * k, 24); cx.fill();
  }
  if (edit) text('AIM', CW * 0.55, CH * 0.3, 13, 'rgba(255,255,255,.3)');
  for (const n of BTN) drawBtn(n, edit);
}
function drawHud() {
  const p = me(), w = curW(p), M = 22, mid = CW / 2;
  rrect(M, 12, 190, 16, 5, 'rgba(0,0,0,.55)');
  rrect(M, 12, 190 * clamp(p.hp / RULES.hp, 0, 1), 16, 5, p.hp > 60 ? '#46e08a' : p.hp > 30 ? '#f5c542' : '#ff4d4d');
  if (p.shT > 0) { cx.fillStyle = '#35d0ff'; cx.fillRect(M, 31, 190 * clamp(p.shHP / AB.shield.hp, 0, 1), 4); }
  text(String(Math.ceil(p.hp)), M + 8, 21, 13, '#fff', 'left', '800');
  text(w.name, M, 46, 12, '#aab0bd', 'left');
  text(String(p.ammo[p.cur]), M, 70, 30, p.ammo[p.cur] === 0 ? '#ff4d4d' : '#fff', 'left', '900');
  const aw = cx.measureText(String(p.ammo[p.cur])).width;
  text('/' + w.mag, M + aw + 4, 74, 15, '#8d919c', 'left', '700');
  if (p.reloadT > 0) { rrect(M, 92, 120, 6, 3, 'rgba(0,0,0,.55)'); rrect(M, 92, 120 * (1 - p.reloadT / w.rel), 6, 3, '#ffe27a'); }
  let sy = 108;
  if (p.invT > 0) { text('INVISIBLE ' + p.invT.toFixed(1), M, sy, 13, '#9fe8ff', 'left', '800'); sy += 16; }
  if (p.healT > 0) { text('HEALING', M, sy, 13, '#46e08a', 'left', '800'); sy += 16; }
  // scoreboard
  rrect(mid - 150, 8, 300, 42, 12, 'rgba(0,0,0,.5)');
  text('YOU', mid - 140, 21, 12, '#35d0ff', 'left', '800'); text('ENEMY', mid + 140, 21, 12, '#ff5a3c', 'right', '800');
  for (let i = 0; i < RULES.win; i++) {
    cx.fillStyle = i < p.kills ? '#35d0ff' : 'rgba(255,255,255,.18)'; circle(mid - 134 + i * 15, 38, 5); cx.fill();
    cx.fillStyle = i < en().kills ? '#ff5a3c' : 'rgba(255,255,255,.18)'; circle(mid + 134 - i * 15, 38, 5); cx.fill();
  }
  const t = Math.max(0, Math.ceil(G.tm));
  text(G.ot ? 'OT' : Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'), mid, 29, 22, G.ot ? '#ff5a3c' : '#fff', 'center', '900');
  for (let i = 0; i < feed.length; i++) { cx.globalAlpha = clamp(feed[i].t, 0, 1); text(feed[i].s, CW - M, 22 + i * 18, 14, feed[i].mine ? '#f5c542' : '#d6d8de', 'right', '800'); }
  cx.globalAlpha = 1;
  if (p.scanT > 0 && p.alive) text('⚠ SCANNED', mid, 66, 16, Math.sin(G.t * 14) > 0 ? '#ff4d4d' : '#ffffff', 'center', '900');
  drawControls(false);
  if (Net.native || G.role) text(G.role === 'h' ? 'HOST' : G.rtt + ' ms', mid, CH - 10, 11, 'rgba(255,255,255,.35)');
  if (G.state === 'count') text(String(Math.max(1, Math.ceil(G.tm))), mid, CH * 0.4, 96, '#f5c542', 'center', '900');
  else if (G.goT > 0) text('FIGHT!', mid, CH * 0.4, 72, '#fff', 'center', '900');
  if (!p.alive && G.state === 'play') { text('ELIMINATED', mid, CH * 0.38, 40, '#ff4d4d', 'center', '900'); text('Back in ' + Math.max(0, p.respT).toFixed(1) + 's', mid, CH * 0.38 + 36, 20, '#fff', 'center', '700'); }
  if (G.toast) { cx.globalAlpha = clamp(G.toast.t * 2, 0, 1); text(G.toast.s, mid, CH * 0.25, 26, '#f5c542', 'center', '900'); cx.globalAlpha = 1; }
  if (G.hint > 0) { cx.globalAlpha = clamp(G.hint, 0, 1); text('Left thumb moves. Right thumb aims: push to the edge to fire.', mid, CH - 34, 15, '#fff', 'center', '700'); cx.globalAlpha = 1; }
  if (hurtA > 0) {
    const g = cx.createRadialGradient(mid, CH / 2, CH * 0.35, mid, CH / 2, CH * 0.95);
    g.addColorStop(0, 'rgba(255,30,30,0)'); g.addColorStop(1, 'rgba(255,30,30,' + (hurtA * 0.5) + ')');
    cx.fillStyle = g; cx.fillRect(0, 0, CW, CH);
  }
}
function render() {
  cx.setTransform(1, 0, 0, 1, 0, 0); cx.fillStyle = '#07080b'; cx.fillRect(0, 0, cv.width, cv.height);
  if (G.state === 'edit') {
    cx.setTransform(DPR, 0, 0, DPR, 0, 0); drawControls(true); return;
  }
  if (!P.length || (G.state !== 'count' && G.state !== 'play' && G.state !== 'over')) return;
  const m = G.map, p = me(), vw = CW / SC, vh = CH / SC;
  let tx = p.x - vw / 2, ty = p.y - vh / 2;
  tx = vw >= m.w ? (m.w - vw) / 2 : clamp(tx, 0, m.w - vw); ty = vh >= m.h ? (m.h - vh) / 2 : clamp(ty, 0, m.h - vh);
  const k = 1 - Math.exp(-14 * G.dt); cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
  const s = DPR * SC, sx = (Math.random() - 0.5) * shake * 2, sy = (Math.random() - 0.5) * shake * 2;
  cx.setTransform(s, 0, 0, s, (-cam.x + sx) * s, (-cam.y + sy) * s);
  drawWorld();
  drawPlayer(en(), 1 - G.me); drawPlayer(p, G.me);
  drawWorldFx();
  cx.setTransform(DPR, 0, 0, DPR, 0, 0);
  drawHud();
}
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000)); last = now; G.t += dt; G.dt = dt;
  if (P.length && (G.state === 'count' || G.state === 'play' || G.state === 'over')) step(dt);
  else if (G.state === 'edit') computeInput();
  render();
  requestAnimationFrame(frame);
}

/* ----------------------------------------------------------- lobby + loadout */
function startHost() {
  G.role = 'h'; G.linked = false; $('hostStat').textContent = 'Starting room…'; $('hostIps').textContent = ''; show('host'); Net.host();
}
function doJoin() {
  G.role = 'g'; G.linked = false; $('joinStat').textContent = 'Looking for the host…'; $('bConnect').disabled = true;
  Net.join($('ipIn').value.trim());
}
function bars(b) {
  const L = ['DMG', 'RATE', 'RNG', 'CTRL']; let h = '<div class="bars">';
  for (let i = 0; i < 4; i++) h += '<span>' + L[i] + '</span><i><s style="width:' + Math.round(b[i] * 100) + '%"></s></i>';
  return h + '</div>';
}
function sendLd() { Net.send({ t: 'ld', w: LD.mine.w, a: LD.mine.a, r: LD.mine.ready ? 1 : 0 }); }
function updateOppStat() {
  $('oppStat').textContent = LD.opp.ready ? 'Opponent: ready ✔' : 'Opponent: choosing…';
  $('bReady').textContent = LD.mine.ready ? 'READY ✔  (tap to cancel)' : 'READY';
}
function buildLoadout() {
  const wl = $('wlist'), al = $('alist'); wl.innerHTML = ''; al.innerHTML = '';
  for (const i of PRIMARIES) {
    const w = W[i], d = document.createElement('div');
    d.className = 'card' + (LD.mine.w === i ? ' sel' : ''); d.innerHTML = '<b>' + w.name + '</b>' + bars(w.bars);
    d.onclick = () => { LD.mine.w = i; LD.mine.ready = false; saveLd(); buildLoadout(); sendLd(); Snd.play('click'); };
    wl.appendChild(d);
  }
  for (const id of AB_IDS) {
    const A = AB[id], idx = LD.mine.a.indexOf(id), d = document.createElement('div');
    d.className = 'card' + (idx >= 0 ? ' sel' : '');
    d.innerHTML = '<b>' + A.ico + ' ' + A.name + '</b><div class="ds">' + A.desc + '</div>' + (idx >= 0 ? '<span class="no">' + (idx + 1) + '</span>' : '');
    d.onclick = () => {
      if (idx < 0) { LD.mine.a.push(id); if (LD.mine.a.length > 2) LD.mine.a.shift(); LD.mine.ready = false; saveLd(); buildLoadout(); sendLd(); Snd.play('click'); }
    };
    al.appendChild(d);
  }
  updateOppStat();
}
function enterLoadout() {
  G.state = 'loadout'; P = []; touches.clear(); LD.mine.ready = false; LD.opp.ready = false;
  buildLoadout(); show('loadout'); sendLd();
}
function onLd(m) {
  const a = Array.isArray(m.a) ? m.a.filter(x => AB[x]).slice(0, 2) : [];
  if (!PRIMARIES.includes(m.w) || a.length !== 2 || a[0] === a[1]) return;
  LD.opp = { w: m.w, a, ready: !!m.r };
  if (G.state === 'loadout') updateOppStat();
  maybeStart();
}

/* --------------------------------------------------------------- connection */
Net.on.hosting = ips => {
  $('hostStat').textContent = 'Waiting for your opponent…';
  $('hostIps').textContent = ips ? 'Room address: ' + ips.split(',').filter(Boolean).join('   ') : '';
};
Net.on.connected = () => {
  G.linked = true; $('bConnect').disabled = false; Net.send({ t: 'hi', v: VER }); enterLoadout();
};
Net.on.msg = onMsg;
Net.on.closed = () => lost();
Net.on.error = txt => {
  if (G.role === 'h') $('hostStat').textContent = 'Could not open the room: ' + txt;
  else { $('joinStat').textContent = String(txt); $('bConnect').disabled = false; }
};
function lostUi() {
  if (G.role === 'h') { show('host'); $('hostStat').textContent = 'Waiting for your opponent…'; }
  else { Net.close(); G.linked = false; show('menu'); }
}
function lost() {
  if (!G.linked) return;
  G.linked = false; touches.clear(); G.state = 'menu'; P = [];
  if (G.role === 'h') showMsg('OPPONENT LEFT', 'Your room is still open. A new opponent can join.', 'OK', lostUi);
  else showMsg('DISCONNECTED', 'Lost the connection to the host.', 'MENU', lostUi);
}
setInterval(() => {
  if (!G.linked) return;
  Net.send({ t: 'hb' });
  if (G.role === 'g') Net.send({ t: 'pg', n: Date.now() });
  if (performance.now() - Net.lastRx > 4500) { Net.drop(); setTimeout(lost, 300); }
}, 1000);

/* ------------------------------------------------------------------- wiring */
function enterEdit() {
  G.state = 'edit'; P = []; touches.clear(); show(''); $('editBar').classList.add('on');
}
function exitEdit() { $('editBar').classList.remove('on'); saveCfg(); G.state = 'menu'; touches.clear(); show('settings'); }
function syncSettings() {
  $('sSens').value = cfg.sens; $('sBtn').value = cfg.btn; $('sVol').value = cfg.vol; $('sAuto').checked = cfg.auto; $('sVib').checked = cfg.vib;
}
$('gname').textContent = GAME_NAME; document.title = GAME_NAME;
$('bLocal').onclick = () => show('local');
$('bSet').onclick = () => { syncSettings(); show('settings'); };
$('bHost').onclick = startHost;
$('bJoin').onclick = () => { $('joinStat').textContent = ''; $('bConnect').disabled = false; show('join'); };
$('bConnect').onclick = doJoin;
$('bHotspot').onclick = () => { try { Android.openHotspotSettings(); } catch (e) {} };
$('bWifi').onclick = () => { try { Android.openWifiSettings(); } catch (e) {} };
document.querySelectorAll('[data-back]').forEach(b => b.onclick = () => {
  const to = b.getAttribute('data-back'); if (G.screen === 'host' || G.screen === 'join') { Net.close(); G.linked = false; } show(to);
});
$('bReady').onclick = () => { LD.mine.ready = !LD.mine.ready; sendLd(); updateOppStat(); Snd.play('click'); maybeStart(); };
$('bLeave').onclick = goMenu;
$('bRematch').onclick = () => {
  G.rmMine = true; $('bRematch').disabled = true; $('rmStat').textContent = 'Waiting for your opponent…'; Net.send({ t: 'rm' });
  if (G.role === 'h') { G.rm[0] = true; checkRematch(); }
};
$('bLoadout').onclick = () => { Net.send({ t: 'lo' }); enterLoadout(); };
$('bResMenu').onclick = goMenu;
$('bStay').onclick = () => show('');
$('bLeaveYes').onclick = goMenu;
$('sSens').oninput = e => { cfg.sens = +e.target.value; saveCfg(); };
$('sBtn').oninput = e => { cfg.btn = +e.target.value; saveCfg(); };
$('sVol').oninput = e => { cfg.vol = +e.target.value; Snd.setVol(cfg.vol); saveCfg(); };
$('sAuto').onchange = e => { cfg.auto = e.target.checked; saveCfg(); };
$('sVib').onchange = e => { cfg.vib = e.target.checked; saveCfg(); };
$('bEdit').onclick = enterEdit;
$('bEditDone').onclick = exitEdit;
$('bEditReset').onclick = () => { cfg.pos = clone(DEF_CFG.pos); cfg.btn = 1; };
Snd.setVol(cfg.vol);

function onBack() {
  const s = G.screen;
  if (s === 'msg') { $('msgBtn').click(); return true; }
  if (s === 'leave') { show(''); return true; }
  if (G.state === 'edit') { exitEdit(); return true; }
  if ((G.state === 'play' || G.state === 'count' || G.state === 'over') && s === '') { show('leave'); return true; }
  switch (s) {
    case 'local': case 'settings': show('menu'); return true;
    case 'host': case 'join': Net.close(); G.linked = false; show('local'); return true;
    case 'loadout': case 'result': goMenu(); return true;
  }
  return false;
}
window.Game = { onBack, _dbg: { G, IN, LD, touches, cfg, step, frame, get P() { return P; }, useAb, pressAb, pressSwap, pressReload } };
requestAnimationFrame(frame);
})();
