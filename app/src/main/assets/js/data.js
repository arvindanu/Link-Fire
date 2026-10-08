'use strict';
/* LINKFIRE — shared data. Tune balance here; both phones run the same file. */

const GAME_NAME = 'LINKFIRE';
const PORT = 47821;

const RULES = {
  win: 5,        // kills to win
  time: 300,     // max match seconds (tie => sudden death)
  respawn: 2,    // seconds
  count: 3,      // pre-match countdown
  prot: 1.0,     // spawn protection seconds
  hp: 100,
  pr: 16,        // player radius (world units)
  speed: 230,    // base move speed
  viewH: 560     // world units visible vertically
};

// dmg = per pellet · rate = seconds between shots · spd/rng in world units
// fo = damage multiplier at max range (falloff starts at 50% of range)
// spr = base spread° · bloom = spread added per shot (recoil) up to bmax, recovering at brec°/s
// mvSpr = extra spread while moving · mv = move-speed multiplier · kick = screen shake per shot
const W = [
  { id: 0, key: 'ar',  name: 'ASSAULT RIFLE', dmg: 15, pel: 1, rate: 0.12,  mag: 30, rel: 1.9, spd: 950,  rng: 650,  fo: 0.55, spr: 1.2, bloom: 0.9, bmax: 6, brec: 14, mvSpr: 2.5, mv: 0.95, kick: 1.2, len: 26, bars: [0.45, 0.70, 0.65, 0.60] },
  { id: 1, key: 'smg', name: 'SMG',           dmg: 9,  pel: 1, rate: 0.065, mag: 40, rel: 1.7, spd: 850,  rng: 420,  fo: 0.50, spr: 3.0, bloom: 0.7, bmax: 8, brec: 12, mvSpr: 1.5, mv: 1.06, kick: 0.8, len: 22, bars: [0.30, 1.00, 0.40, 0.45] },
  { id: 2, key: 'sg',  name: 'SHOTGUN',       dmg: 9,  pel: 8, rate: 0.85,  mag: 6,  rel: 2.4, spd: 800,  rng: 330,  fo: 0.30, spr: 7.0, bloom: 0,   bmax: 0, brec: 10, mvSpr: 0,   mv: 0.97, kick: 4.0, len: 24, bars: [0.95, 0.25, 0.25, 0.30] },
  { id: 3, key: 'sn',  name: 'SNIPER',        dmg: 70, pel: 1, rate: 1.25,  mag: 5,  rel: 2.8, spd: 2000, rng: 1300, fo: 1.00, spr: 0,   bloom: 0,   bmax: 0, brec: 10, mvSpr: 5,   mv: 0.85, kick: 3.5, len: 34, bars: [0.90, 0.15, 1.00, 0.20] },
  { id: 4, key: 'pt',  name: 'PISTOL',        dmg: 22, pel: 1, rate: 0.28,  mag: 12, rel: 1.1, spd: 1000, rng: 520,  fo: 0.60, spr: 1.0, bloom: 1.6, bmax: 5, brec: 9,  mvSpr: 2,   mv: 1.00, kick: 1.2, len: 18, bars: [0.40, 0.45, 0.50, 0.55] }
];
const PISTOL = 4;      // always carried as the sidearm
const PRIMARIES = [0, 1, 2, 3];

const AB = {
  inv:    { id: 'inv',    name: 'INVISIBILITY', ico: '👻', cd: 18, dur: 5,    desc: 'Vanish for 5s. Shooting or taking damage reveals you. Scan counters it.' },
  dash:   { id: 'dash',   name: 'DASH',         ico: '💨', cd: 6,  dur: 0.16, dist: 150, desc: 'Quick burst in your move direction.' },
  shield: { id: 'shield', name: 'SHIELD',       ico: '🛡️', cd: 20, dur: 3.5,  hp: 50, desc: 'Absorbs 50 damage for 3.5s. Heavy fire breaks it.' },
  scan:   { id: 'scan',   name: 'SCAN',         ico: '📡', cd: 14, dur: 2.5,  range: 560, desc: 'Reveals the enemy in range for 2.5s. They get warned.' },
  heal:   { id: 'heal',   name: 'HEAL',         ico: '💚', cd: 28, dur: 2,    amt: 40, desc: 'Restore 40 HP over 2s, but you move slower. Needs missing HP.' }
};
const AB_IDS = ['inv', 'dash', 'shield', 'scan', 'heal'];

// Maps: add an entry here and it is selectable by the host later.
// rects: [x, y, w, h, 'w'(wall)|'c'(crate)] — mirrored around the centre so both spawns are fair.
function mirrorRects(list, w, h) {
  return list.concat(list.map(r => [w - r[0] - r[2], h - r[1] - r[3], r[2], r[3], r[4]]));
}
const MAPS = [
  {
    id: 'warehouse', name: 'WAREHOUSE', w: 1280, h: 800,
    rects: mirrorRects([
      [180, 140, 200, 40, 'w'], [180, 140, 40, 160, 'w'],
      [330, 300, 70, 70, 'c'],  [120, 440, 90, 90, 'c'],
      [440, 500, 60, 160, 'w'], [520, 170, 90, 60, 'c'],
      [270, 620, 120, 40, 'w'], [550, 330, 50, 140, 'w']
    ], 1280, 800),
    spawns: [[90, 90], [1190, 710], [100, 700], [1180, 100]], // 0/1 = start spots, all 4 used for respawns
    theme: { floor: '#13151a', grid: '#1b1e25', wall: '#2a2e38', wallTop: '#454c5e', crate: '#4b3a1b', crateTop: '#7a5e28', accent: '#f5c542' }
  }
];
