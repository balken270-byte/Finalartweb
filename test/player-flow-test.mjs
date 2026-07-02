// Player-flow test: scripts a human-like session through the same API the UI
// calls, against live AI rivals. Verifies every player-facing verb works.
import {
  createGame, tickGame, SIM_DT, GENS, SI, canPlace,
  cmdGather, cmdResearch, cmdLobby, cmdAttack, cmdMove,
  recruit, placeBuilding, safetyInitiative, startTraining, startSI, regulatoryProbe,
  countUnits, countBuildings, hqOf,
} from '../js/sim.js';
import { createAI } from '../js/ai.js';

let failures = 0;
const assert = (c, m) => { if (!c) { console.error('FAIL:', m); failures++; } else console.log('ok  :', m); };

const game = createGame({ playerFaction: 1, seed: 123 }); // play as Anthropic
const ai = createAI(game);
const me = game.factions[1];
const P = 1;

const run = (secs, each) => {
  const n = Math.round(secs / SIM_DT);
  for (let i = 0; i < n && !game.over; i++) {
    tickGame(game, SIM_DT); ai.tick(SIM_DT);
    if (each) each();
    game.events.length = 0;
  }
};
const myUnits = type => game.units.filter(u => u.factionId === P && u.type === type);

// --- opening: send researchers to the nearest node, verify data flows
const node = game.nodes.reduce((a, b) => {
  const d = n => (n.x - me.hq.x) ** 2 + (n.z - me.hq.z) ** 2;
  return d(a) < d(b) ? a : b;
});
cmdGather(game, myUnits('researcher').map(u => u.id), node.id);
const data0 = me.data;
run(20);
assert(me.data > data0 + 30, `gathering works (data ${data0.toFixed(0)} → ${me.data.toFixed(0)})`);

// --- recruit + place a datacenter like the UI would
assert(recruit(game, P, 'researcher'), 'recruit researcher');
let placed = false;
for (let a = 0; a < Math.PI * 2 && !placed; a += 0.3) {
  const x = me.hq.x + Math.cos(a) * 22, z = me.hq.z + Math.sin(a) * 22;
  if (canPlace(game, P, x, z, 6.5)) placed = placeBuilding(game, P, 'datacenter', x, z);
}
assert(placed, 'player datacenter placed via canPlace/placeBuilding');
run(20);
assert(countBuildings(game, P, 'datacenter') === 2, 'datacenter finished construction');

// --- macro loop: keep gathering, train every gen as it becomes affordable
let safeties = 0;
const macro = () => {
  // keep researchers busy: half gather, half research
  const idle = myUnits('researcher').filter(u => u.state === 'idle');
  idle.forEach((u, i) => i % 2 ? cmdResearch(game, [u.id]) : cmdGather(game, [u.id], node.id));
  if (!me.training && me.capability < GENS.length) startTraining(game, P);
  if (me.funding > 500 && countBuildings(game, P, 'datacenter') < 5) {
    for (let a = 0; a < Math.PI * 2; a += 0.4) {
      const x = me.hq.x + Math.cos(a) * (16 + (game.tick % 20)), z = me.hq.z + Math.sin(a) * 25;
      if (canPlace(game, P, x, z, 6.5)) { placeBuilding(game, P, 'datacenter', x, z); break; }
    }
  }
  if (me.funding > 400 && countUnits(game, P, 'researcher') < 10) recruit(game, P, 'researcher');
  if (me.trust < 55 && me.funding > 300) { if (safetyInitiative(game, P)) safeties++; }
  // defend like a human who read the raid warning toast
  if (me.funding > 450 && countBuildings(game, P, 'turret') < 3) {
    for (let a = 0; a < Math.PI * 2; a += 0.5) {
      const x = me.hq.x + Math.cos(a) * 14, z = me.hq.z + Math.sin(a) * 14;
      if (canPlace(game, P, x, z, 3.2)) { placeBuilding(game, P, 'turret', x, z); break; }
    }
  }
  if (me.funding > 600 && countUnits(game, P, 'agent') < 4) recruit(game, P, 'agent');
  if (countUnits(game, P, 'lobbyist') < 1 && me.funding > 400 && me.capability >= 2) {
    if (recruit(game, P, 'lobbyist')) cmdLobby(game, myUnits('lobbyist').map(u => u.id));
  }
  if (me.capability >= GENS.length && !me.training && me.compute >= SI.compute && me.data >= SI.data && (me.trust >= 40 || me.favor >= 60)) {
    startSI(game, P);
  }
};
run(380, macro); // early-mid game

assert(me.capability >= 3, `player progressed the tech tree (Gen ${me.capability})`);
assert(safeties > 0, `safety initiatives purchased (${safeties})`);
assert(me.favor > 5 || countUnits(game, P, 'lobbyist') === 0, `lobbying accrues favor (${me.favor.toFixed(1)})`);

// --- combat verbs: raid the NEAREST enemy structure, allow travel time
const hq = hqOf(game, P);
const enemyBs = game.buildings.filter(b => b.factionId !== P);
const enemyB = enemyBs.sort((a, b) =>
  ((a.x - hq.x) ** 2 + (a.z - hq.z) ** 2) - ((b.x - hq.x) ** 2 + (b.z - hq.z) ** 2))[0];
if (enemyB && myUnits('agent').length && !game.over) {
  cmdAttack(game, myUnits('agent').map(u => u.id), enemyB.id);
  const hp0 = enemyB.hp;
  let myShots = 0;
  const nShot = () => { for (const e of game.events) if (e.t === 'shot' && e.fid === P && !e.turret) myShots++; };
  run(75, nShot);
  assert(enemyB.hp < hp0 || !game.buildings.includes(enemyB) || myShots > 0,
    `cmdAttack engages the enemy (shots fired: ${myShots})`);
} else console.log('skip: no agents or enemy structures available for the raid test');

// resume the macro through the late game
run(520, macro);

// --- probe (grant favor to test the verb itself)
if (!game.over) {
  me.favor = 70;
  const rival = game.factions.find(f => f.id !== P && f.alive);
  assert(regulatoryProbe(game, P, rival.id), 'regulatory probe fires at 60+ favor');
  assert(game.time < rival.pausedUntil, 'probe froze rival training clock');
}

// --- let the race conclude
run(1200);
assert(game.over, 'game reached a conclusion');
console.log('outcome:', game.winner !== null ? game.factions[game.winner].def.name + ' wins' : 'player eliminated', '@', Math.round(game.time) + 's');
assert(myUnits('researcher').length >= 0 && Number.isFinite(me.funding), 'state remains finite');
cmdMove(game, myUnits('researcher').map(u => u.id), 0, 0); // verb smoke-test post-game

console.log(failures ? failures + ' FAILURES' : 'ALL PLAYER-FLOW TESTS PASSED');
process.exit(failures ? 1 : 0);
