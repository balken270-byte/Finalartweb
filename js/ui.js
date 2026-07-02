// ui.js — DOM HUD. Reads sim state a few times a second; sends player intents
// back through the shared sim command API.

import {
  FACTIONS, GENS, SI, UNIT_TYPES, BUILDING_TYPES, WORLD,
  countUnits, countBuildings, findUnit, findBuilding, hqOf,
  recruit, safetyInitiative, startTraining, startSI, regulatoryProbe, canStartSI,
} from './sim.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);

export function showStartScreen(onPick) {
  const grid = $('faction-grid');
  FACTIONS.forEach((f, i) => {
    const card = document.createElement('button');
    card.className = 'fcard';
    card.style.setProperty('--fc', f.colorCss);
    card.innerHTML = `<div class="dot"></div><h2>${f.name}</h2><div class="tg">${f.tagline.toUpperCase()}</div><div class="bn">${f.bonus}</div>`;
    card.addEventListener('click', () => onPick(i));
    grid.appendChild(card);
  });
}
export function setLoadStatus(msg) { $('load-status').textContent = msg; }
export function hideStartScreen() { $('start').style.display = 'none'; }

export function createUI(game) {
  let controls = null;
  const fid = game.playerFaction;
  const me = () => game.factions[fid];

  ['resbar', 'race', 'selpanel', 'minimap-wrap', 'helpbtn'].forEach(id => ($(id).style.display = ''));

  // ---------------- race lanes
  const lanesEl = $('lanes');
  const laneEls = game.factions.map(f => {
    const el = document.createElement('div');
    el.className = 'lane';
    el.innerHTML = `
      <div class="who"><span class="nm" style="color:${f.def.colorCss}">${f.def.name}${f.isPlayer ? ' ◂ you' : ''}</span><span class="st"></span></div>
      <div class="track"><div class="pips">${'<i></i>'.repeat(6)}</div><div class="fill" style="background:${f.def.colorCss};color:${f.def.colorCss}"></div></div>`;
    lanesEl.appendChild(el);
    return { el, st: el.querySelector('.st'), fill: el.querySelector('.fill') };
  });

  // ---------------- help
  const helpModal = $('help-modal');
  const toggleHelp = (force) => {
    const open = force !== undefined ? force : !helpModal.classList.contains('open');
    helpModal.classList.toggle('open', open);
  };
  $('helpbtn').addEventListener('click', () => toggleHelp());
  $('help-close').addEventListener('click', () => toggleHelp(false));
  helpModal.addEventListener('click', e => { if (e.target === helpModal) toggleHelp(false); });

  // ---------------- toasts
  const toastsEl = $('toasts');
  function toast(msg, kind = 'info') {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'warn' ? ' warn' : kind === 'big' ? ' big' : '');
    el.textContent = msg;
    toastsEl.appendChild(el);
    while (toastsEl.children.length > 4) toastsEl.firstChild.remove();
    setTimeout(() => el.remove(), 4900);
  }

  // ---------------- action buttons
  const actionsEl = $('sel-actions');
  const probeRow = $('probe-row');
  const probeBtns = $('probe-btns');
  const btns = {};

  function mkBtn(key, label, cost, onClick, cls = '') {
    const b = document.createElement('button');
    b.className = 'act ' + cls;
    b.innerHTML = `${label}<span class="cost">${cost}</span>`;
    b.addEventListener('click', () => { onClick(); refreshButtons(); });
    actionsEl.appendChild(b);
    btns[key] = b;
    return b;
  }
  const ok = fn => { if (fn()) sfx('command'); else sfx('error'); };

  mkBtn('researcher', 'Hire Researcher', `${UNIT_TYPES.researcher.cost} fund`, () => ok(() => recruit(game, fid, 'researcher')));
  mkBtn('agent', 'Hire Cyber Agent', '', () => ok(() => recruit(game, fid, 'agent')));
  mkBtn('lobbyist', 'Hire Lobbyist', `${UNIT_TYPES.lobbyist.cost} fund`, () => ok(() => recruit(game, fid, 'lobbyist')));
  mkBtn('datacenter', 'Build Datacenter', '', () => controls && controls.setPlacing('datacenter'));
  mkBtn('turret', 'Build Turret', `${BUILDING_TYPES.turret.cost} fund`, () => controls && controls.setPlacing('turret'));
  mkBtn('safety', 'Safety Initiative', '', () => { if (safetyInitiative(game, fid)) sfx('safety'); else sfx('error'); });
  mkBtn('train', 'Train Model', '', () => ok(() => startTraining(game, fid)), 'hot');
  mkBtn('si', 'LAUNCH SUPERINTELLIGENCE RUN', `${SI.compute} FLOPs · ${SI.data} data · Trust≥40 or Favor≥60`, () => { if (startSI(game, fid)) sfx('siStart'); else sfx('error'); }, 'si');

  FACTIONS.forEach((f, i) => {
    if (i === fid) return;
    const b = document.createElement('button');
    b.className = 'act';
    b.style.borderColor = f.colorCss;
    b.textContent = 'Probe ' + f.name.split(' ').pop();
    b.addEventListener('click', () => { if (regulatoryProbe(game, fid, i)) sfx('probe'); else sfx('error'); refreshButtons(); });
    probeBtns.appendChild(b);
    b.dataset.target = i;
  });

  function refreshButtons() {
    const f = me();
    const agentCost = Math.round(UNIT_TYPES.agent.cost * (f.def.mods.agentCost || 1));
    const dcCost = Math.round(BUILDING_TYPES.datacenter.cost * (f.def.mods.dcCost || 1));
    const safetyCost = Math.round(150 * (f.def.mods.safetyCost || 1));

    setBtn('researcher', f.funding >= UNIT_TYPES.researcher.cost && countUnits(game, fid, 'researcher') < UNIT_TYPES.researcher.cap);
    btns.agent.querySelector('.cost').textContent = `${agentCost} fund`;
    setBtn('agent', f.funding >= agentCost && countUnits(game, fid, 'agent') < UNIT_TYPES.agent.cap);
    setBtn('lobbyist', f.funding >= UNIT_TYPES.lobbyist.cost && countUnits(game, fid, 'lobbyist') < UNIT_TYPES.lobbyist.cap);
    btns.datacenter.querySelector('.cost').textContent = `${dcCost} fund`;
    setBtn('datacenter', f.funding >= dcCost && countBuildings(game, fid, 'datacenter') < BUILDING_TYPES.datacenter.cap);
    setBtn('turret', f.funding >= BUILDING_TYPES.turret.cost && countBuildings(game, fid, 'turret') < BUILDING_TYPES.turret.cap);
    btns.safety.querySelector('.cost').textContent = `${safetyCost} fund · +${f.def.mods.safetyGain || 10} trust`;
    setBtn('safety', f.funding >= safetyCost);

    if (f.capability < GENS.length) {
      const g = GENS[f.capability];
      btns.train.firstChild.textContent = `Train Gen ${f.capability + 1} — ${g.name}`;
      btns.train.querySelector('.cost').textContent = f.training ? 'run in progress…' : `${g.compute} FLOPs · ${g.data} data`;
      setBtn('train', !f.training && f.compute >= g.compute && f.data >= g.data);
      btns.train.style.display = '';
      btns.si.style.display = 'none';
    } else {
      btns.train.style.display = 'none';
      btns.si.style.display = '';
      if (f.training) btns.si.querySelector('.cost').textContent = 'THE FINAL RUN IS LIVE';
      setBtn('si', canStartSI(f));
    }

    probeRow.style.display = f.favor >= 25 ? '' : 'none';
    for (const b of probeBtns.children) {
      const t = game.factions[+b.dataset.target];
      b.disabled = f.favor < 60 || !t.alive;
    }
  }
  function setBtn(k, enabled) { btns[k].disabled = !enabled; }

  // ---------------- selection panel text
  function onSelectionChanged() { renderSelection(); }
  function renderSelection() {
    const sel = controls ? controls.getSelection() : new Set();
    const title = $('sel-title'), sub = $('sel-sub'), hp = $('sel-hp');
    if (!sel.size) {
      title.textContent = me().def.name + ' — Mission Control';
      sub.textContent = me().def.bonus;
      hp.textContent = '';
      return;
    }
    const ids = [...sel];
    if (ids.length === 1) {
      const u = findUnit(game, ids[0]);
      const b = u ? null : findBuilding(game, ids[0]);
      const ent = u || b;
      if (!ent) { title.textContent = '—'; return; }
      const owner = game.factions[ent.factionId].def;
      const kind = u ? u.type : b.type;
      title.textContent = `${owner.name} · ${label(kind)}`;
      sub.textContent = u ? stateLabel(u) : (b.building ? `under construction — ${Math.round(b.buildProgress * 100)}%` : hint(kind));
      hp.textContent = `HP ${Math.max(0, Math.round(ent.hp))} / ${ent.maxHp}`;
    } else {
      const counts = {};
      for (const id of ids) { const u = findUnit(game, id); if (u) counts[u.type] = (counts[u.type] || 0) + 1; }
      title.textContent = `${ids.length} units selected`;
      sub.textContent = Object.entries(counts).map(([k, n]) => `${n}× ${label(k)}`).join(' · ');
      hp.textContent = 'right-click: data cluster = gather · HQ = research · Capitol = lobby · enemy = attack';
    }
  }
  const label = k => ({ researcher: 'Researcher', agent: 'Cyber Ops Agent', lobbyist: 'Lobbyist', hq: 'Lab HQ', datacenter: 'Datacenter', turret: 'Security Turret' }[k] || k);
  const hint = k => ({ hq: 'the campus — lose this, lose everything', datacenter: 'generating FLOPs', turret: 'auto-fires at intruders' }[k] || '');
  const stateLabel = u => ({ idle: 'idle — awaiting orders', move: 'moving', gather: 'scraping data', research: 'researching at HQ (+15% run speed)', lobby: 'lobbying the Capitol (+favor)', attack: 'engaging target' }[u.state] || u.state);

  // ---------------- resource bar + race panel refresh (call ~5 Hz)
  function refreshHUD() {
    const f = me();
    $('r-fund').textContent = Math.floor(f.funding);
    $('r-fund-rate').textContent = `+${(f.fundingRate || 0).toFixed(1)}/s`;
    $('r-comp').textContent = Math.floor(f.compute);
    $('r-comp-rate').textContent = `+${(f.computeRate || 0).toFixed(1)}/s`;
    $('r-data').textContent = Math.floor(f.data);
    $('r-trust').textContent = Math.round(f.trust);
    $('r-favor').textContent = Math.floor(f.favor);

    game.factions.forEach((fx, i) => {
      const L = laneEls[i];
      L.el.classList.toggle('dead', !fx.alive);
      let prog = fx.capability, st = fx.capability ? `GEN ${fx.capability}` : 'PRE-TRAINING';
      if (fx.training) {
        prog = (fx.training.gen - 1) + fx.training.progress;
        const pct = Math.round(fx.training.progress * 100);
        st = fx.training.gen === 6 ? `SI RUN ${pct}%` : `TRAINING G${fx.training.gen} ${pct}%`;
        if (game.time < fx.pausedUntil) st = 'FROZEN BY PROBE';
      } else if (fx.capability >= GENS.length) st = 'AGI — PREPPING SI';
      L.st.textContent = fx.alive ? st : '';
      L.fill.style.width = Math.min(100, (prog / 6) * 100) + '%';
      L.fill.classList.toggle('si-run', !!fx.training && fx.training.gen === 6);
    });

    refreshButtons();
    renderSelection();
  }

  // ---------------- minimap
  const mm = $('minimap');
  const mctx = mm.getContext('2d');
  const toPx = v => ((v + WORLD.half) / WORLD.size) * 176;
  function drawMinimap(rig) {
    mctx.fillStyle = '#0a121a'; mctx.fillRect(0, 0, 176, 176);
    mctx.strokeStyle = 'rgba(102,217,232,0.25)'; mctx.strokeRect(0.5, 0.5, 175, 175);
    // capitol
    mctx.fillStyle = '#b7a5ff'; mctx.beginPath(); mctx.arc(88, 88, 3.5, 0, 7); mctx.fill();
    for (const n of game.nodes) {
      const r = 1.5 + 2 * (n.remaining / n.total);
      mctx.fillStyle = 'rgba(102,217,232,0.85)';
      mctx.beginPath(); mctx.arc(toPx(n.x), toPx(n.z), r, 0, 7); mctx.fill();
    }
    for (const b of game.buildings) {
      mctx.fillStyle = game.factions[b.factionId].def.colorCss;
      const s = b.type === 'hq' ? 7 : 4;
      mctx.fillRect(toPx(b.x) - s / 2, toPx(b.z) - s / 2, s, s);
    }
    for (const u of game.units) {
      mctx.fillStyle = game.factions[u.factionId].def.colorCss;
      mctx.fillRect(toPx(u.x) - 1, toPx(u.z) - 1, 2, 2);
    }
    // camera
    const half = rig.dist * 0.62;
    mctx.strokeStyle = 'rgba(223,232,238,0.7)';
    mctx.strokeRect(toPx(rig.tx - half), toPx(rig.tz - half * 0.72), (half * 2 / WORLD.size) * 176, (half * 1.44 / WORLD.size) * 176);
  }
  mm.addEventListener('pointerdown', e => {
    const r = mm.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * WORLD.size - WORLD.half;
    const z = ((e.clientY - r.top) / r.height) * WORLD.size - WORLD.half;
    if (controls) controls.centerOn(x, z);
  });

  // ---------------- end screen
  function showEnd(title, subtext, colorCss) {
    $('end-title').textContent = title;
    $('end-title').style.color = colorCss;
    $('end-sub').textContent = subtext;
    $('end').classList.add('open');
  }

  refreshHUD();
  return {
    toast, refreshHUD, drawMinimap, showEnd, toggleHelp, onSelectionChanged,
    bindControls(c) { controls = c; renderSelection(); },
  };
}
