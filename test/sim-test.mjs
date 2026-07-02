import { createGame, tickGame, SIM_DT, GENS } from '../js/sim.js';
import { createAI } from '../js/ai.js';

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exitCode = 1; } else console.log('ok  :', msg); }

// Player faction is also AI-driven here: mark nobody as player so all 4 race.
const game = createGame({ playerFaction: 0, seed: 42 });
game.factions[0].isPlayer = false; // silence player toasts, let AI drive all
const ai = createAI(game);
// createAI skips the player — rebuild with all four brains:
game.factions.forEach(f => (f.isPlayer = false));
const ai2 = createAI(game);

const maxTicks = Math.round((25 * 60) / SIM_DT);
let events = { complete: 0, incident: 0, raid: 0, shot: 0, win: 0, built: 0 };
let winnerAt = null;

for (let t = 0; t < maxTicks && !game.over; t++) {
  tickGame(game, SIM_DT);
  ai2.tick(SIM_DT);
  for (const e of game.events) if (events[e.t] !== undefined) events[e.t]++;
  if (game.over) winnerAt = game.time;
  game.events.length = 0;

  // NaN sentinel every ~10s
  if (t % 100 === 0) {
    for (const f of game.factions) {
      for (const k of ['funding', 'compute', 'data', 'trust', 'favor', 'hype']) {
        if (!Number.isFinite(f[k])) { console.error('NaN in faction', f.def.key, k, 'at', game.time); process.exit(1); }
      }
    }
    for (const u of game.units) if (!Number.isFinite(u.x + u.z + u.hp)) { console.error('NaN unit', u); process.exit(1); }
  }
}

console.log('--- after', Math.round(game.time), 'sim seconds ---');
for (const f of game.factions) {
  console.log(
    f.def.key.padEnd(10),
    'cap:', f.capability,
    'fund:', Math.round(f.funding),
    'comp:', Math.round(f.compute),
    'data:', Math.round(f.data),
    'trust:', Math.round(f.trust),
    'favor:', Math.round(f.favor),
    'alive:', f.alive,
    'training:', f.training ? f.training.gen + '@' + f.training.progress.toFixed(2) : '-'
  );
}
console.log('events:', events, 'units:', game.units.length, 'buildings:', game.buildings.length);

assert(events.built > 0, 'AI constructed buildings');
assert(events.complete >= 4, 'multiple training runs completed across factions');
assert(game.factions.some(f => f.capability >= 3), 'someone reached at least Gen 3');
assert(events.shot > 0 || events.raid > 0, 'combat happened');
assert(game.units.length > 8, 'labs kept staffing up');
assert(game.over && game.winner !== null, 'game produced a winner within 25 sim-minutes');
if (game.over && game.winner !== null) console.log('WINNER:', game.factions[game.winner].def.name, 'at', Math.round(winnerAt), 's');
assert(GENS.length === 5, 'five generations before SI');
console.log(process.exitCode ? 'TEST FAILED' : 'ALL TESTS PASSED');
