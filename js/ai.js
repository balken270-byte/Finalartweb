// ai.js — rival lab brains. Pure logic, drives sim through the same public
// command API the player uses. Ticks once per second per faction.

import {
  GENS, UNIT_TYPES, BUILDING_TYPES,
  countUnits, countBuildings, hqOf, findNode,
  cmdGather, cmdResearch, cmdLobby, cmdAttack, cmdMove,
  recruit, placeBuilding, canPlace, safetyInitiative,
  startTraining, startSI, canStartSI, regulatoryProbe,
} from './sim.js';

const PERSONALITIES = {
  openai:    { aggression: 0.45, safetyAt: 38, lobby: 0.5, raidEvery: 120 },
  anthropic: { aggression: 0.2,  safetyAt: 60, lobby: 0.7, raidEvery: 200 },
  deepmind:  { aggression: 0.35, safetyAt: 45, lobby: 0.9, raidEvery: 150 },
  xai:       { aggression: 0.9,  safetyAt: 25, lobby: 0.2, raidEvery: 75  },
};

export function createAI(game) {
  const brains = [];
  for (const f of game.factions) {
    if (f.isPlayer) continue;
    brains.push({
      fid: f.id,
      p: PERSONALITIES[f.def.key],
      nextRaid: 60 + game.rng() * 60,
      raidSquad: [],
      acc: game.rng(), // desync brains
    });
  }
  return {
    tick(dt) {
      for (const b of brains) {
        b.acc += dt;
        if (b.acc >= 1) { b.acc -= 1; think(game, b); }
      }
    },
  };
}

function think(game, brain) {
  const f = game.factions[brain.fid];
  if (!f.alive || game.over) return;
  const fid = brain.fid, p = brain.p;

  // --- macro: what does the next milestone cost? ---
  const nextGen = f.capability < GENS.length ? GENS[f.capability] : null;
  const wantCompute = nextGen ? nextGen.compute : 3400;
  const wantData = nextGen ? nextGen.data : 2600;

  // --- staffing ---
  const rCount = countUnits(game, fid, 'researcher');
  const rTarget = Math.min(UNIT_TYPES.researcher.cap, 5 + f.capability * 2);
  if (rCount < rTarget && f.funding > UNIT_TYPES.researcher.cost + 80) recruit(game, fid, 'researcher');

  // --- infrastructure: keep compute income ahead of the curve ---
  const dcs = countBuildings(game, fid, 'datacenter');
  const dcTarget = Math.min(BUILDING_TYPES.datacenter.cap, 2 + f.capability);
  const dcCost = Math.round(BUILDING_TYPES.datacenter.cost * (f.def.mods.dcCost || 1));
  if (dcs < dcTarget && f.funding > dcCost + 120) tryBuild(game, fid, 'datacenter');

  // defensive turrets scale with paranoia (1 - aggression) and being attacked
  const turrets = countBuildings(game, fid, 'turret');
  const turretTarget = Math.min(BUILDING_TYPES.turret.cap, 1 + Math.floor(f.capability / 2));
  if (turrets < turretTarget && f.funding > BUILDING_TYPES.turret.cost + 250) tryBuild(game, fid, 'turret');

  // --- worker assignment ---
  assignResearchers(game, brain, f, wantData);

  // --- lobbying ---
  if (p.lobby > 0.4 && countUnits(game, fid, 'lobbyist') < 1 && f.funding > UNIT_TYPES.lobbyist.cost + 150 && f.capability >= 2) {
    recruit(game, fid, 'lobbyist');
  }
  for (const u of game.units) {
    if (u.factionId === fid && u.type === 'lobbyist' && u.state === 'idle') cmdLobby(game, [u.id]);
  }

  // --- perception management ---
  if (f.trust < p.safetyAt && f.funding > 320) safetyInitiative(game, fid);

  // --- regulatory warfare: probe whoever is closest to winning ---
  if (f.favor >= 60) {
    const leader = raceLeader(game, fid);
    if (leader && (leader.capability > f.capability || (leader.training && leader.training.gen === 6))) {
      regulatoryProbe(game, fid, leader.id);
    }
  }

  // --- the race itself ---
  if (!f.training) {
    if (f.capability >= GENS.length) {
      if (canStartSI(f)) startSI(game, fid);
      else if (f.trust < 40 && f.favor < 60 && f.funding > 200) safetyInitiative(game, fid);
    } else if (f.compute >= wantCompute && f.data >= wantData) {
      startTraining(game, fid);
    }
  }

  // --- military ---
  military(game, brain, f);
}

function tryBuild(game, fid, type) {
  const hq = hqOf(game, fid); if (!hq) return;
  const size = BUILDING_TYPES[type].size;
  for (let attempt = 0; attempt < 14; attempt++) {
    const a = game.rng() * Math.PI * 2;
    const r = 14 + game.rng() * 26;
    const x = hq.x + Math.cos(a) * r, z = hq.z + Math.sin(a) * r;
    if (canPlace(game, fid, x, z, size)) { placeBuilding(game, fid, type, x, z); return; }
  }
}

function assignResearchers(game, brain, f, wantData) {
  const mine = game.units.filter(u => u.factionId === f.id && u.type === 'researcher');
  const idle = mine.filter(u => u.state === 'idle');
  if (!idle.length) return;

  const needData = f.data < wantData;
  const training = !!f.training;
  const hq = hqOf(game, f.id);

  for (const u of idle) {
    if (training && game.rng() < 0.5) { cmdResearch(game, [u.id]); continue; }
    if (needData) {
      const n = bestNode(game, u);
      if (n) { cmdGather(game, [u.id], n.id); continue; }
    }
    cmdResearch(game, [u.id]);
  }
  // if a run is live, pull some gatherers home to speed it up
  if (training) {
    const gatherers = mine.filter(u => u.state === 'gather');
    for (let i = 0; i < Math.floor(gatherers.length / 2); i++) cmdResearch(game, [gatherers[i].id]);
  }
  void hq; void brain;
}

function bestNode(game, u) {
  let best = null, bd = Infinity;
  for (const n of game.nodes) {
    if (n.remaining <= 0) continue;
    const dx = n.x - u.x, dz = n.z - u.z, d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = n; }
  }
  return best;
}

function military(game, brain, f) {
  const p = brain.p, fid = f.id;
  const agents = game.units.filter(u => u.factionId === fid && u.type === 'agent');
  const agentTarget = Math.min(UNIT_TYPES.agent.cap, Math.round(2 + p.aggression * 4));
  const cost = Math.round(UNIT_TYPES.agent.cost * (f.def.mods.agentCost || 1));
  if (agents.length < agentTarget && f.funding > cost + 200) recruit(game, fid, 'agent');

  brain.raidSquad = brain.raidSquad.filter(uid => game.units.some(u => u.id === uid && u.hp > 0));

  if (game.time >= brain.nextRaid && agents.length >= 3 && game.rng() < p.aggression) {
    brain.nextRaid = game.time + p.raidEvery * (0.7 + game.rng() * 0.6);
    const target = raidTarget(game, fid);
    if (target) {
      const squad = agents.slice(0, Math.max(2, agents.length - 1)).map(u => u.id);
      brain.raidSquad = squad;
      cmdAttack(game, squad, target.id);
      f.stats.raidsLaunched++;
      game.events.push({ t: 'raid', fid, targetFid: target.factionId, x: target.x, z: target.z });
    }
  } else if (game.time >= brain.nextRaid) {
    brain.nextRaid = game.time + 30;
  }

  // recall stragglers with nothing to do
  const hq = hqOf(game, fid);
  if (hq) for (const u of agents) {
    if (u.state === 'idle' && !brain.raidSquad.includes(u.id)) {
      const dx = u.x - hq.x, dz = u.z - hq.z;
      if (dx * dx + dz * dz > 30 * 30) cmdMove(game, [u.id], hq.x, hq.z);
    }
  }
}

function raidTarget(game, fid) {
  // hit the race leader's economy: prefer their datacenters
  const leader = raceLeader(game, fid);
  if (!leader) return null;
  const dcs = game.buildings.filter(b => b.factionId === leader.id && b.type === 'datacenter');
  if (dcs.length) return dcs[Math.floor(game.rng() * dcs.length)];
  return hqOf(game, leader.id);
}

function raceLeader(game, exceptFid) {
  let best = null, bs = -1;
  for (const f of game.factions) {
    if (!f.alive || f.id === exceptFid) continue;
    const s = f.capability + (f.training ? f.training.progress : 0) + (f.training && f.training.gen === 6 ? 3 : 0);
    if (s > bs) { bs = s; best = f; }
  }
  return best;
}
