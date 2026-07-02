// controls.js — trackpad-first camera + selection + command input.
// Owns the selection set and the build-placement mode.

import { WORLD, canPlace, placeBuilding, cmdMove, cmdGather, cmdResearch, cmdLobby, cmdAttack, findBuilding, findUnit } from './sim.js';
import { sfx } from './audio.js';

export function createControls(canvas, game, render, ui) {
  const sel = new Set();          // selected entity ids (player's)
  let placing = null;             // building type being placed, or null
  let lastGround = { x: 0, z: 0 };
  const keys = new Set();
  const selbox = document.getElementById('selbox');
  let drag = null;                // {x0,y0,x1,y1, moved}

  const rig = render.rig;
  rig.tx = game.factions[game.playerFaction].hq.x;
  rig.tz = game.factions[game.playerFaction].hq.z;

  const ndc = (e) => ({
    x: (e.clientX / window.innerWidth) * 2 - 1,
    y: -(e.clientY / window.innerHeight) * 2 + 1,
  });

  // ---------------- wheel: two-finger scroll pans, pinch (ctrlKey) zooms
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      rig.dist = clamp(rig.dist * (1 + e.deltaY * 0.011), rig.minD, rig.maxD);
    } else {
      const k = rig.dist * 0.0016 * (e.deltaMode === 1 ? 16 : 1);
      rig.tx = clamp(rig.tx + e.deltaX * k, -WORLD.half, WORLD.half);
      rig.tz = clamp(rig.tz + e.deltaY * k, -WORLD.half, WORLD.half);
      rig.follow = null;
    }
  }, { passive: false });

  // ---------------- pointer
  canvas.addEventListener('pointerdown', (e) => {
    if (e.button === 0) {
      if (placing) { tryPlace(e); return; }
      drag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, moved: false };
    }
  });
  window.addEventListener('pointermove', (e) => {
    if (placing) {
      const p = render.groundPoint(ndc(e).x, ndc(e).y);
      if (p) {
        lastGround = { x: p.x, z: p.z };
        const ok = canPlace(game, game.playerFaction, p.x, p.z, sizeOf(placing));
        render.moveGhost(p.x, p.z, ok);
      }
      return;
    }
    if (!drag) return;
    drag.x1 = e.clientX; drag.y1 = e.clientY;
    if (Math.abs(drag.x1 - drag.x0) + Math.abs(drag.y1 - drag.y0) > 6) drag.moved = true;
    if (drag.moved) {
      const L = Math.min(drag.x0, drag.x1), T = Math.min(drag.y0, drag.y1);
      selbox.style.display = 'block';
      selbox.style.left = L + 'px'; selbox.style.top = T + 'px';
      selbox.style.width = Math.abs(drag.x1 - drag.x0) + 'px';
      selbox.style.height = Math.abs(drag.y1 - drag.y0) + 'px';
    }
  });
  window.addEventListener('pointerup', (e) => {
    if (e.button !== 0 || !drag) return;
    const d = drag; drag = null;
    selbox.style.display = 'none';
    if (d.moved) boxSelect(d, e.shiftKey);
    else clickSelect(e, e.shiftKey);
  });

  // right-click = command (two-finger tap on trackpads fires contextmenu)
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (placing) { setPlacing(null); return; }
    command(e);
  });

  // ---------------- selection
  function clickSelect(e, additive) {
    const hit = render.pickEntity(ndc(e).x, ndc(e).y);
    if (!additive) sel.clear();
    if (hit && (hit.kind === 'unit' || hit.kind === 'building')) {
      const ent = hit.kind === 'unit' ? findUnit(game, hit.id) : findBuilding(game, hit.id);
      if (ent) { sel.add(hit.id); sfx('select'); }
    }
    pushSelection();
  }

  function boxSelect(d, additive) {
    const L = Math.min(d.x0, d.x1), R = Math.max(d.x0, d.x1);
    const T = Math.min(d.y0, d.y1), B = Math.max(d.y0, d.y1);
    if (!additive) sel.clear();
    const w = window.innerWidth, h = window.innerHeight;
    let n = 0;
    for (const u of game.units) {
      if (u.factionId !== game.playerFaction) continue;
      const s = render.projectToScreen(u.x, 1, u.z, w, h);
      if (!s.behind && s.x >= L && s.x <= R && s.y >= T && s.y <= B) { sel.add(u.id); n++; }
    }
    if (n) sfx('select');
    pushSelection();
  }

  function pushSelection() {
    // prune dead
    for (const id of [...sel]) if (!findUnit(game, id) && !findBuilding(game, id)) sel.delete(id);
    render.setSelected(sel);
    ui.onSelectionChanged();
  }

  // ---------------- commands
  function command(e) {
    const myUnits = [...sel].filter(id => {
      const u = findUnit(game, id);
      return u && u.factionId === game.playerFaction;
    });
    if (!myUnits.length) return;
    const n = ndc(e);
    const hit = render.pickEntity(n.x, n.y);
    const g = render.groundPoint(n.x, n.y);

    if (hit && hit.kind === 'node') {
      cmdGather(game, myUnits, hit.id);
      markAt(hit.point, 0x66d9e8, 'GATHER');
    } else if (hit && hit.kind === 'capitol') {
      cmdLobby(game, myUnits);
      markAt(hit.point, 0xb7a5ff, 'LOBBY');
    } else if (hit && (hit.kind === 'unit' || hit.kind === 'building')) {
      const ent = hit.kind === 'unit' ? findUnit(game, hit.id) : findBuilding(game, hit.id);
      if (!ent) return;
      if (ent.factionId !== game.playerFaction) {
        cmdAttack(game, myUnits, hit.id);
        markAt(hit.point, 0xff6b57, 'ATTACK');
      } else if (ent.type === 'hq') {
        cmdResearch(game, myUnits);
        markAt(hit.point, 0x8fd67f, 'RESEARCH');
      } else if (g) {
        cmdMove(game, myUnits, g.x, g.z);
        markAt(g, 0x9fe8ff, null);
      }
    } else if (g) {
      cmdMove(game, myUnits, g.x, g.z);
      markAt(g, 0x9fe8ff, null);
    }
  }
  function markAt(p, color, label) {
    render.addRing(p.x, p.z, color, 0.4, 3.2, 0.45);
    if (label) render.addFloatText(p.x, p.z, label, '#' + color.toString(16).padStart(6, '0'));
    sfx('command');
  }

  // ---------------- placement
  function sizeOf(type) { return { datacenter: 6.5, turret: 3.2 }[type] || 5; }
  function setPlacing(type) {
    placing = type;
    render.showGhost(type);
    if (type) ui.toast(`Placing ${type} — click a green site near your campus. Esc cancels.`, 'info');
  }
  function tryPlace(e) {
    const p = render.groundPoint(ndc(e).x, ndc(e).y) || lastGround;
    if (placeBuilding(game, game.playerFaction, placing, p.x, p.z)) {
      sfx('place');
      setPlacing(null);
    } else sfx('error');
  }

  // ---------------- keyboard
  window.addEventListener('keydown', (e) => {
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    keys.add(e.code);
    if (e.code === 'Escape') {
      if (placing) setPlacing(null);
      else { sel.clear(); pushSelection(); }
    }
    if (e.code === 'KeyH') ui.toggleHelp();
    if (e.code === 'KeyF') {
      const f = game.factions[game.playerFaction];
      rig.tx = f.hq.x; rig.tz = f.hq.z; rig.follow = null;
    }
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  function tick(dt) {
    const k = 42 * dt * (rig.dist / 78);
    if (keys.has('KeyW') || keys.has('ArrowUp')) { rig.tz -= k; rig.follow = null; }
    if (keys.has('KeyS') || keys.has('ArrowDown')) { rig.tz += k; rig.follow = null; }
    if (keys.has('KeyA') || keys.has('ArrowLeft')) { rig.tx -= k; rig.follow = null; }
    if (keys.has('KeyD') || keys.has('ArrowRight')) { rig.tx += k; rig.follow = null; }
    rig.tx = clamp(rig.tx, -WORLD.half, WORLD.half);
    rig.tz = clamp(rig.tz, -WORLD.half, WORLD.half);
    pushSelectionIfStale();
  }

  let staleTimer = 0;
  function pushSelectionIfStale() {
    staleTimer++;
    if (staleTimer % 30 !== 0) return;
    const before = sel.size;
    for (const id of [...sel]) if (!findUnit(game, id) && !findBuilding(game, id)) sel.delete(id);
    if (sel.size !== before) { render.setSelected(sel); ui.onSelectionChanged(); }
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  return {
    tick, setPlacing,
    getSelection: () => sel,
    centerOn(x, z) { rig.tx = x; rig.tz = z; rig.follow = null; },
  };
}
