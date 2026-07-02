// sim.js — pure simulation. No DOM, no THREE. Fixed-timestep tick().
// Everything the renderer/UI needs is read from game state; everything
// transient (shots, explosions, toasts) is emitted through game.events.

export const SIM_DT = 0.1; // seconds per tick

export const GENS = [
  { name: 'Chatbot',   compute: 120,  data: 90,   duration: 25 },
  { name: 'Reasoner',  compute: 260,  data: 200,  duration: 35 },
  { name: 'Agent',     compute: 560,  data: 430,  duration: 45 },
  { name: 'Innovator', compute: 1150, data: 900,  duration: 60 },
  { name: 'AGI',       compute: 2300, data: 1800, duration: 75 },
];
export const SI = { compute: 3400, data: 2600, duration: 100 };

export const UNIT_TYPES = {
  researcher: { hp: 40, speed: 6.5, cost: 120, radius: 0.9, cap: 12 },
  agent:      { hp: 95, speed: 8.5, cost: 160, dps: 11, range: 9,  radius: 0.9, cap: 8 },
  lobbyist:   { hp: 55, speed: 7.0, cost: 220, radius: 0.9, cap: 2 },
};

export const BUILDING_TYPES = {
  hq:         { hp: 1600, size: 11 },
  datacenter: { hp: 480, size: 6.5, cost: 300, buildTime: 16, computeRate: 2.2, cap: 6 },
  turret:     { hp: 320, size: 3.2, cost: 220, buildTime: 11, dps: 15, range: 17, cap: 4 },
};

export const FACTIONS = [
  {
    key: 'openai', name: 'OpenAI', color: 0x10a37f, colorCss: '#10a37f',
    tagline: 'Ship fast, hype faster',
    bonus: 'Blitzscale: training runs 25% faster, hype gains doubled.',
    mods: { trainSpeed: 1.25, hypeMult: 2.0 },
  },
  {
    key: 'anthropic', name: 'Anthropic', color: 0xda7756, colorCss: '#da7756',
    tagline: 'Safety is a strategy',
    bonus: 'Safety Dividend: cheaper safety work, +15 trust per initiative, incidents halved, trust never drops below 40.',
    mods: { safetyCost: 0.5, safetyGain: 15, incidentMult: 0.4, trustFloor: 40 },
  },
  {
    key: 'deepmind', name: 'Google DeepMind', color: 0x4285f4, colorCss: '#4285f4',
    tagline: 'The TPU empire',
    bonus: 'TPU Empire: datacenters cost 33% less and produce 40% more compute.',
    mods: { dcCost: 0.67, dcRate: 1.4 },
  },
  {
    key: 'xai', name: 'xAI', color: 0xd7dbe0, colorCss: '#d7dbe0',
    tagline: 'Colossus does not sleep',
    bonus: 'Colossus: buildings finish 40% faster, cyber agents cost less and hit 25% harder.',
    mods: { buildSpeed: 1.67, agentCost: 0.7, agentDps: 1.25 },
  },
];

const HQ_POS = [ { x: -72, z: -72 }, { x: 72, z: -72 }, { x: -72, z: 72 }, { x: 72, z: 72 } ];
export const WORLD = { size: 200, half: 100 };

let NEXT_ID = 1;
const id = () => NEXT_ID++;

// ---------- construction ----------

export function createGame({ playerFaction = 0, seed = 1 } = {}) {
  NEXT_ID = 1;
  const rng = mulberry32(seed);
  const game = {
    time: 0, tick: 0, rng,
    winner: null, over: false,
    playerFaction,
    events: [],           // drained by main loop each frame
    factions: [], units: [], buildings: [], nodes: [],
    capitol: { x: 0, z: 0, radius: 8 },
  };

  FACTIONS.forEach((def, i) => {
    game.factions.push({
      id: i, def, alive: true,
      isPlayer: i === playerFaction,
      funding: 420, compute: 0, data: 0,
      computeCap: 800 , dataCap: 4000,
      trust: 50, hype: 0, favor: 0,
      capability: 0,                     // highest completed gen (1..5)
      training: null,                    // {gen, progress, duration} gen=6 → SI run
      pausedUntil: 0,                    // regulatory probe freeze
      hq: HQ_POS[i],
      underAttackCooldown: 0,
      stats: { raidsLaunched: 0 },
    });
  });

  // Neutral data nodes ("the open web") — inner ring + contested center pair
  const nodeSpots = [
    { x: -40, z: -40 }, { x: 40, z: -40 }, { x: -40, z: 40 }, { x: 40, z: 40 },
    { x: 0, z: -52 }, { x: 0, z: 52 }, { x: -52, z: 0 }, { x: 52, z: 0 },
    { x: -14, z: -14 }, { x: 14, z: 14 },
  ];
  for (const s of nodeSpots) {
    game.nodes.push({ id: id(), x: s.x, z: s.z, remaining: 3800 + Math.floor(rng() * 800), total: 4400 });
  }

  // Starting base per faction: HQ + one datacenter + staff
  game.factions.forEach((f, i) => {
    addBuilding(game, i, 'hq', f.hq.x, f.hq.z, true);
    const off = f.hq.x < 0 ? 13 : -13;
    addBuilding(game, i, 'datacenter', f.hq.x + off, f.hq.z, true);
    for (let k = 0; k < 4; k++) spawnUnit(game, i, 'researcher', f.hq.x + (k - 1.5) * 3, f.hq.z + (f.hq.z < 0 ? 10 : -10));
    spawnUnit(game, i, 'agent', f.hq.x, f.hq.z + (f.hq.z < 0 ? 14 : -14));
  });

  return game;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function addBuilding(game, factionId, type, x, z, instant = false) {
  const T = BUILDING_TYPES[type];
  const b = {
    id: id(), factionId, type, x, z,
    hp: instant ? T.hp : 1, maxHp: T.hp,
    building: !instant, buildProgress: instant ? 1 : 0,
    cooldown: 0, targetId: null, size: T.size,
  };
  game.buildings.push(b);
  return b;
}

function spawnUnit(game, factionId, type, x, z) {
  const T = UNIT_TYPES[type];
  const u = {
    id: id(), factionId, type,
    x, z, prevX: x, prevZ: z, dir: 0,
    hp: T.hp, maxHp: T.hp, speed: T.speed,
    state: 'idle',          // idle | move | gather | research | lobby | attack
    targetId: null,         // node/building/unit id depending on state
    destX: x, destZ: z,
    cooldown: 0,
  };
  game.units.push(u);
  return u;
}

// ---------- lookups ----------

export function findUnit(game, uid) { return game.units.find(u => u.id === uid); }
export function findBuilding(game, bid) { return game.buildings.find(b => b.id === bid); }
export function findNode(game, nid) { return game.nodes.find(n => n.id === nid); }
export function hqOf(game, fid) { return game.buildings.find(b => b.factionId === fid && b.type === 'hq'); }
export function countUnits(game, fid, type) { return game.units.reduce((n, u) => n + (u.factionId === fid && u.type === type ? 1 : 0), 0); }
export function countBuildings(game, fid, type) { return game.buildings.reduce((n, b) => n + (b.factionId === fid && b.type === type ? 1 : 0), 0); }
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };

// ---------- player/AI commands (shared API) ----------

export function cmdMove(game, unitIds, x, z) {
  let i = 0;
  for (const uid of unitIds) {
    const u = findUnit(game, uid); if (!u) continue;
    const a = (i / Math.max(1, unitIds.length)) * Math.PI * 2, r = i === 0 ? 0 : 1.6 + i * 0.35;
    u.state = 'move'; u.targetId = null;
    u.destX = clampW(x + Math.cos(a) * r); u.destZ = clampW(z + Math.sin(a) * r);
    i++;
  }
}
export function cmdGather(game, unitIds, nodeId) {
  for (const uid of unitIds) {
    const u = findUnit(game, uid);
    if (u && u.type === 'researcher') { u.state = 'gather'; u.targetId = nodeId; }
    else if (u) { const n = findNode(game, nodeId); if (n) cmdMove(game, [uid], n.x, n.z); }
  }
}
export function cmdResearch(game, unitIds) {
  for (const uid of unitIds) {
    const u = findUnit(game, uid);
    if (u && u.type === 'researcher') { u.state = 'research'; u.targetId = null; }
  }
}
export function cmdLobby(game, unitIds) {
  for (const uid of unitIds) {
    const u = findUnit(game, uid);
    if (u && u.type === 'lobbyist') { u.state = 'lobby'; u.targetId = null; }
    else if (u) cmdMove(game, [uid], game.capitol.x, game.capitol.z);
  }
}
export function cmdAttack(game, unitIds, targetId) {
  for (const uid of unitIds) {
    const u = findUnit(game, uid); if (!u) continue;
    if (u.type === 'agent') { u.state = 'attack'; u.targetId = targetId; }
    else {
      const t = findUnit(game, targetId) || findBuilding(game, targetId);
      if (t) cmdMove(game, [uid], t.x, t.z);
    }
  }
}

export function recruit(game, fid, type) {
  const f = game.factions[fid]; if (!f.alive) return false;
  const T = UNIT_TYPES[type]; if (!T) return false;
  let cost = T.cost;
  if (type === 'agent' && f.def.mods.agentCost) cost = Math.round(cost * f.def.mods.agentCost);
  if (countUnits(game, fid, type) >= T.cap) return fail(game, f, 'Roster full for ' + type + 's');
  if (f.funding < cost) return fail(game, f, 'Not enough funding');
  f.funding -= cost;
  const hq = hqOf(game, fid); if (!hq) return false;
  const a = game.rng() * Math.PI * 2;
  const u = spawnUnit(game, fid, type, hq.x + Math.cos(a) * 9, hq.z + Math.sin(a) * 9);
  game.events.push({ t: 'recruit', fid, x: u.x, z: u.z, type });
  return true;
}

export function placeBuilding(game, fid, type, x, z) {
  const f = game.factions[fid]; if (!f.alive) return false;
  const T = BUILDING_TYPES[type]; if (!T || !T.cost) return false;
  let cost = T.cost;
  if (type === 'datacenter' && f.def.mods.dcCost) cost = Math.round(cost * f.def.mods.dcCost);
  if (countBuildings(game, fid, type) >= T.cap) return fail(game, f, 'Cap reached for ' + type + 's');
  if (f.funding < cost) return fail(game, f, 'Not enough funding');
  if (!canPlace(game, fid, x, z, T.size)) return fail(game, f, 'Invalid site — build near your campus, clear of obstacles');
  f.funding -= cost;
  addBuilding(game, fid, type, x, z, false);
  game.events.push({ t: 'placed', fid, x, z, type });
  return true;
}

export function canPlace(game, fid, x, z, size) {
  if (Math.abs(x) > WORLD.half - 6 || Math.abs(z) > WORLD.half - 6) return false;
  const hq = hqOf(game, fid); if (!hq) return false;
  if (dist2(x, z, hq.x, hq.z) > 45 * 45) return false; // build radius: your campus
  for (const b of game.buildings) {
    const m = (b.size + size) * 0.62;
    if (dist2(x, z, b.x, b.z) < m * m) return false;
  }
  for (const n of game.nodes) if (dist2(x, z, n.x, n.z) < 8 * 8) return false;
  if (dist2(x, z, 0, 0) < 14 * 14) return false; // the Capitol is not for sale
  return true;
}

export function safetyInitiative(game, fid) {
  const f = game.factions[fid];
  const cost = Math.round(150 * (f.def.mods.safetyCost || 1));
  if (f.funding < cost) return fail(game, f, 'Not enough funding');
  f.funding -= cost;
  f.trust = Math.min(100, f.trust + (f.def.mods.safetyGain || 10));
  game.events.push({ t: 'safety', fid });
  return true;
}

export function startTraining(game, fid) {
  const f = game.factions[fid];
  if (f.training) return fail(game, f, 'A run is already in progress');
  if (f.capability >= GENS.length) return false;
  const g = GENS[f.capability];
  if (f.compute < g.compute || f.data < g.data) return fail(game, f, `Need ${g.compute} compute + ${g.data} data`);
  f.compute -= g.compute; f.data -= g.data;
  f.training = { gen: f.capability + 1, progress: 0, duration: g.duration / (f.def.mods.trainSpeed || 1) };
  game.events.push({ t: 'trainStart', fid, gen: f.training.gen });
  return true;
}

export function canStartSI(f) {
  return f.capability >= GENS.length && !f.training &&
    f.compute >= SI.compute && f.data >= SI.data &&
    (f.trust >= 40 || f.favor >= 60);
}
export function startSI(game, fid) {
  const f = game.factions[fid];
  if (f.training) return fail(game, f, 'A run is already in progress');
  if (f.capability < GENS.length) return fail(game, f, 'AGI must be reached first');
  if (f.compute < SI.compute || f.data < SI.data) return fail(game, f, `Need ${SI.compute} compute + ${SI.data} data`);
  if (f.trust < 40 && f.favor < 60) return fail(game, f, 'Deployment license denied: raise Trust to 40 or Favor to 60');
  f.compute -= SI.compute; f.data -= SI.data;
  f.training = { gen: 6, progress: 0, duration: SI.duration / (f.def.mods.trainSpeed || 1) };
  game.events.push({ t: 'siStart', fid });
  return true;
}

export function regulatoryProbe(game, fid, targetFid) {
  const f = game.factions[fid], t = game.factions[targetFid];
  if (!t || !t.alive || targetFid === fid) return false;
  if (f.favor < 60) return fail(game, f, 'Need 60 Government Favor');
  f.favor -= 60;
  t.pausedUntil = game.time + 20;
  t.trust = Math.max(t.def.mods.trustFloor || 0, t.trust - 8);
  game.events.push({ t: 'probe', fid, target: targetFid });
  return true;
}

function fail(game, f, msg) {
  if (f.isPlayer) game.events.push({ t: 'toast', kind: 'warn', msg });
  return false;
}
const clampW = v => Math.max(-WORLD.half + 3, Math.min(WORLD.half - 3, v));

// ---------- the tick ----------

export function tickGame(game, dt = SIM_DT) {
  if (game.over) return;
  game.time += dt; game.tick++;

  for (const f of game.factions) {
    if (!f.alive) continue;
    economy(game, f, dt);
    trainingTick(game, f, dt);
  }
  for (const u of game.units) unitTick(game, u, dt);
  for (const b of game.buildings) buildingTick(game, b, dt);
  for (const n of game.nodes) n.remaining = Math.min(n.total, n.remaining + 0.6 * dt); // the web keeps writing

  // remove the dead
  for (let i = game.units.length - 1; i >= 0; i--) {
    const u = game.units[i];
    if (u.hp <= 0) {
      game.events.push({ t: 'die', x: u.x, z: u.z, fid: u.factionId, unit: true });
      game.units.splice(i, 1);
    }
  }
  for (let i = game.buildings.length - 1; i >= 0; i--) {
    const b = game.buildings[i];
    if (b.hp <= 0) {
      game.events.push({ t: 'demolish', x: b.x, z: b.z, fid: b.factionId, type: b.type });
      game.buildings.splice(i, 1);
      if (b.type === 'hq') eliminate(game, b.factionId);
    }
  }
  checkVictory(game);
}

function economy(game, f, dt) {
  // Funding flows from investors: perception is the multiplier.
  const trustMult = 0.5 + (f.trust / 100) * 1.5;
  const fundingRate = 6 * trustMult * (1 + f.hype);
  f.funding += fundingRate * dt;
  f.hype = Math.max(0, f.hype - f.hype * 0.06 * dt);
  f.fundingRate = fundingRate;

  // Compute from live datacenters
  let comp = 0;
  for (const b of game.buildings) {
    if (b.factionId === f.id && b.type === 'datacenter' && !b.building)
      comp += BUILDING_TYPES.datacenter.computeRate * (f.def.mods.dcRate || 1);
  }
  f.computeRate = comp;
  f.compute = Math.min(f.computeCap + countBuildings(game, f.id, 'datacenter') * 700, f.compute + comp * dt);
}

function trainingTick(game, f, dt) {
  if (!f.training) return;
  if (game.time < f.pausedUntil) return; // frozen by a probe
  const researchers = game.units.reduce((n, u) =>
    n + (u.factionId === f.id && u.state === 'research' && u.atWork ? 1 : 0), 0);
  const speed = 1 + 0.15 * researchers;
  f.training.progress += (dt * speed) / f.training.duration;
  if (f.training.progress >= 1) {
    const gen = f.training.gen;
    f.training = null;
    if (gen === 6) { game.winner = f.id; game.over = true; game.events.push({ t: 'win', fid: f.id }); return; }
    f.capability = gen;
    f.hype += 0.5 * (f.def.mods.hypeMult || 1);
    game.events.push({ t: 'complete', fid: f.id, gen, name: GENS[gen - 1].name });
    // capability without care: chance of a public incident
    const chance = 0.28 * (f.def.mods.incidentMult || 1);
    if (game.rng() < chance) {
      f.trust = Math.max(f.def.mods.trustFloor || 0, f.trust - 15);
      game.events.push({ t: 'incident', fid: f.id });
    }
  }
}

function unitTick(game, u, dt) {
  u.prevX = u.x; u.prevZ = u.z;
  u.atWork = false;
  const f = game.factions[u.factionId];
  if (u.cooldown > 0) u.cooldown -= dt;

  switch (u.state) {
    case 'move': {
      if (approach(u, u.destX, u.destZ, dt, 0.6)) u.state = 'idle';
      break;
    }
    case 'gather': {
      const n = findNode(game, u.targetId);
      if (!n || n.remaining <= 0) { u.state = 'idle'; u.targetId = null; break; }
      if (approach(u, n.x, n.z, dt, 3.4)) {
        u.atWork = true;
        const take = Math.min(3.2 * dt, n.remaining, f.dataCap - f.data);
        n.remaining -= take; f.data += take;
        if (n.remaining <= 0) game.events.push({ t: 'toast', kind: 'info', msg: 'A data source has been scraped dry.' });
      }
      break;
    }
    case 'research': {
      const hq = hqOf(game, u.factionId);
      if (!hq) { u.state = 'idle'; break; }
      if (approach(u, hq.x, hq.z, dt, hq.size * 0.75)) {
        u.atWork = true;
        // Gen 3+ labs distill synthetic data in-house
        if (f.capability >= 3) f.data = Math.min(f.dataCap, f.data + 0.9 * dt);
      }
      break;
    }
    case 'lobby': {
      if (approach(u, game.capitol.x, game.capitol.z, dt, game.capitol.radius + 1.5)) {
        u.atWork = true;
        f.favor = Math.min(100, f.favor + 0.55 * dt);
      }
      break;
    }
    case 'attack': {
      const t = findUnit(game, u.targetId) || findBuilding(game, u.targetId);
      if (!t || t.hp <= 0) { u.state = 'idle'; u.targetId = null; break; }
      const T = UNIT_TYPES.agent;
      const range = T.range + (t.size ? t.size * 0.5 : 0);
      if (dist2(u.x, u.z, t.x, t.z) > range * range) approach(u, t.x, t.z, dt, range * 0.92);
      else {
        u.dir = Math.atan2(t.x - u.x, t.z - u.z);
        u.atWork = true; // fight stance
        if (u.cooldown <= 0) {
          u.cooldown = 0.8;
          const dps = T.dps * (f.def.mods.agentDps || 1);
          damage(game, t, dps * 0.8, u.factionId);
          game.events.push({ t: 'shot', fx: u.x, fz: u.z, tx: t.x, tz: t.z, fid: u.factionId, high: !!t.size });
        }
      }
      break;
    }
    default: { // idle agents guard: auto-acquire nearby enemies
      if (u.type === 'agent') {
        const e = nearestEnemy(game, u.factionId, u.x, u.z, 15);
        if (e) { u.state = 'attack'; u.targetId = e.id; }
      }
    }
  }
}

function buildingTick(game, b, dt) {
  const f = game.factions[b.factionId];
  if (b.building) {
    const rate = (f.def.mods.buildSpeed || 1) / BUILDING_TYPES[b.type].buildTime;
    b.buildProgress += rate * dt;
    b.hp = Math.min(b.maxHp, b.maxHp * b.buildProgress + 1);
    if (b.buildProgress >= 1) {
      b.building = false; b.hp = b.maxHp;
      game.events.push({ t: 'built', fid: b.factionId, x: b.x, z: b.z, type: b.type });
    }
    return;
  }
  if (b.type === 'turret') {
    if (b.cooldown > 0) b.cooldown -= dt;
    let t = (b.targetId && (findUnit(game, b.targetId))) || null;
    const R = BUILDING_TYPES.turret.range;
    if (!t || t.hp <= 0 || dist2(b.x, b.z, t.x, t.z) > R * R) {
      t = nearestEnemy(game, b.factionId, b.x, b.z, R, true);
      b.targetId = t ? t.id : null;
    }
    if (t && b.cooldown <= 0) {
      b.cooldown = 0.9;
      damage(game, t, BUILDING_TYPES.turret.dps * 0.9, b.factionId);
      game.events.push({ t: 'shot', fx: b.x, fz: b.z, tx: t.x, tz: t.z, fid: b.factionId, turret: true });
    }
  }
}

function nearestEnemy(game, fid, x, z, range, unitsOnly = false) {
  let best = null, bd = range * range;
  for (const u of game.units) {
    if (u.factionId === fid || u.hp <= 0) continue;
    const d = dist2(x, z, u.x, u.z);
    if (d < bd) { bd = d; best = u; }
  }
  if (!unitsOnly) for (const b of game.buildings) {
    if (b.factionId === fid || b.hp <= 0) continue;
    const d = dist2(x, z, b.x, b.z);
    if (d < bd) { bd = d; best = b; }
  }
  return best;
}

function damage(game, t, amount, byFid) {
  t.hp -= amount;
  const tf = game.factions[t.factionId];
  if (tf && game.time > tf.underAttackCooldown) {
    tf.underAttackCooldown = game.time + 8;
    game.events.push({ t: 'underAttack', fid: t.factionId, x: t.x, z: t.z, byFid });
  }
}

function approach(u, tx, tz, dt, stopDist) {
  const dx = tx - u.x, dz = tz - u.z;
  const d = Math.hypot(dx, dz);
  if (d <= stopDist) return true;
  const step = Math.min(u.speed * dt, d - stopDist * 0.9);
  u.x += (dx / d) * step; u.z += (dz / d) * step;
  u.dir = Math.atan2(dx, dz);
  u.moving = true;
  return false;
}

function eliminate(game, fid) {
  const f = game.factions[fid];
  if (!f.alive) return;
  f.alive = false; f.training = null;
  for (const u of game.units) if (u.factionId === fid) u.hp = 0;
  for (const b of game.buildings) if (b.factionId === fid) b.hp = Math.min(b.hp, 0);
  game.events.push({ t: 'eliminated', fid });
}

function checkVictory(game) {
  if (game.over) return;
  const alive = game.factions.filter(f => f.alive);
  if (alive.length === 1) {
    game.winner = alive[0].id; game.over = true;
    game.events.push({ t: 'win', fid: alive[0].id, byElimination: true });
  }
  const pf = game.factions[game.playerFaction];
  if (pf.isPlayer && !pf.alive && !game.over) {
    game.over = true; game.winner = null;
    game.events.push({ t: 'defeat' });
  }
}
