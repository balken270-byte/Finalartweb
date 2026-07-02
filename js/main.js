// main.js — bootstrap + the loop. Simulation runs at a fixed 10 Hz timestep,
// rendering runs at display rate and interpolates between sim ticks.

import { createGame, tickGame, SIM_DT, FACTIONS, GENS } from './sim.js';
import { createAI } from './ai.js';
import { loadAssets } from './assets.js';
import { createRenderer } from './render.js';
import { createControls } from './controls.js';
import { createUI, showStartScreen, hideStartScreen, setLoadStatus } from './ui.js';
import { initAudio, sfx, setIntensity } from './audio.js';

showStartScreen(async (factionIdx) => {
  try {
    initAudio(); // must happen inside the click gesture
    document.getElementById('faction-grid').style.pointerEvents = 'none';
    setLoadStatus('Preparing the race…');
    const assets = await loadAssets(setLoadStatus);
    start(factionIdx, assets);
  } catch (err) {
    console.error(err);
    setLoadStatus('Failed to start: ' + err.message + ' — check your connection for the three.js CDN, then reload.');
  }
});

function start(factionIdx, assets) {
  const game = createGame({ playerFaction: factionIdx, seed: (Math.random() * 1e9) | 0 });
  const ai = createAI(game);
  const canvas = document.getElementById('game-canvas');
  const render = createRenderer(canvas, game, assets);
  const ui = createUI(game);
  const controls = createControls(canvas, game, render, ui);
  ui.bindControls(controls);
  hideStartScreen();

  ui.toast(`You are ${FACTIONS[factionIdx].name}. First lab to finish the Superintelligence Run wins.`, 'big');
  setTimeout(() => ui.toast('Press H for the field guide. Right-click the glowing clusters to scrape data.', 'info'), 1800);

  // ---------------- sim event routing
  let lastShotSfx = 0, lastDieSfx = 0;
  const near = (x, z) => {
    const dx = x - render.rig.tx, dz = z - render.rig.tz;
    return dx * dx + dz * dz < 75 * 75;
  };
  function routeEvent(e) {
    render.handleEvent(e);
    const nm = fid => FACTIONS[fid].name;
    const isMe = fid => fid === game.playerFaction;
    switch (e.t) {
      case 'toast': ui.toast(e.msg, e.kind); if (e.kind === 'warn') sfx('error'); break;
      case 'shot': {
        const now = performance.now();
        if (now - lastShotSfx > 90 && near(e.fx, e.fz)) { lastShotSfx = now; sfx(e.turret ? 'turret' : 'laser'); }
        break;
      }
      case 'die': {
        const now = performance.now();
        if (now - lastDieSfx > 150 && near(e.x, e.z)) { lastDieSfx = now; sfx('explosion'); }
        break;
      }
      case 'demolish':
        if (near(e.x, e.z) || isMe(e.fid)) sfx('demolish');
        if (isMe(e.fid)) ui.toast(`Your ${e.type} was destroyed!`, 'warn');
        break;
      case 'recruit': if (isMe(e.fid)) sfx('recruit'); break;
      case 'built': if (isMe(e.fid)) { sfx('built'); ui.toast(`${e.type === 'datacenter' ? 'Datacenter online — FLOPs flowing.' : 'Security turret online.'}`); } break;
      case 'trainStart': if (isMe(e.fid)) ui.toast(`Training run started: Gen ${e.gen} — ${GENS[e.gen - 1].name}. Researchers at HQ speed it up.`); break;
      case 'complete':
        ui.toast(`${nm(e.fid)} ships ${e.name} (Gen ${e.gen})`, isMe(e.fid) ? 'big' : 'info');
        if (isMe(e.fid) || near(0, 0)) sfx('complete');
        break;
      case 'incident': ui.toast(`Public incident at ${nm(e.fid)} — trust craters`, 'warn'); sfx('incident'); break;
      case 'safety': if (isMe(e.fid)) ui.toast('Safety initiative published. Trust rises.'); break;
      case 'siStart': ui.toast(`⚠ ${nm(e.fid)} HAS BEGUN THE SUPERINTELLIGENCE RUN`, 'big'); sfx('siStart'); if (!isMe(e.fid)) sfx('alarm'); break;
      case 'probe': ui.toast(`Government opens a regulatory probe into ${nm(e.target)} — training frozen 20s`, isMe(e.target) ? 'warn' : 'info'); sfx('probe'); break;
      case 'raid': if (isMe(e.targetFid)) { ui.toast(`${nm(e.fid)} is raiding your infrastructure!`, 'warn'); sfx('alarm'); } break;
      case 'underAttack': if (isMe(e.fid)) sfx('alarm'); break;
      case 'eliminated': ui.toast(`${nm(e.fid)} has been shut down.`, 'big'); break;
      case 'win': {
        const winnerName = nm(e.fid);
        const how = e.byElimination ? 'is the last lab standing.' : 'has reached superintelligence.';
        if (isMe(e.fid)) { sfx('win'); ui.showEnd('SUPERINTELLIGENCE ACHIEVED', `${winnerName} ${how} The future is yours to align.`, FACTIONS[e.fid].colorCss); }
        else { sfx('defeat'); ui.showEnd(`${winnerName.toUpperCase()} WINS`, `${winnerName} ${how} Your lab is a footnote in their model card.`, FACTIONS[e.fid].colorCss); }
        break;
      }
      case 'defeat': sfx('defeat'); ui.showEnd('LAB SHUT DOWN', 'Your HQ has fallen. The race continues without you.', '#ff6b57'); break;
    }
  }

  // ---------------- the loop
  const helpModal = document.getElementById('help-modal');
  let last = performance.now();
  let acc = 0, hudTimer = 0, mapTimer = 0;

  function frame(now) {
    requestAnimationFrame(frame);
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.25) dt = 0.25; // tab was hidden: don't fast-forward the war

    const paused = helpModal.classList.contains('open');
    if (!paused && !game.over) {
      acc += dt;
      while (acc >= SIM_DT) {
        acc -= SIM_DT;
        tickGame(game, SIM_DT);
        ai.tick(SIM_DT);
      }
    }
    // drain sim events every frame (win/defeat events can arrive on the last tick)
    if (game.events.length) {
      for (const e of game.events) routeEvent(e);
      game.events.length = 0;
    }

    controls.tick(dt);
    const alpha = game.over ? 1 : Math.min(1, acc / SIM_DT);
    render.sync(alpha, dt);

    hudTimer += dt;
    if (hudTimer > 0.2) { hudTimer = 0; ui.refreshHUD(); updateIntensity(); }
    mapTimer += dt;
    if (mapTimer > 0.15) { mapTimer = 0; ui.drawMinimap(render.rig); }
  }

  function updateIntensity() {
    let m = 0, siLive = false;
    for (const f of game.factions) {
      if (!f.alive) continue;
      const p = (f.capability + (f.training ? f.training.progress : 0)) / 6;
      m = Math.max(m, p);
      if (f.training && f.training.gen === 6) siLive = true;
    }
    setIntensity(siLive ? 1 : m * 0.85);
  }

  requestAnimationFrame(frame);
}
