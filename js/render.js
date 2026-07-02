// render.js — everything visual. Reads sim state, never mutates it.

import * as THREE from 'three';
import { BUILDING_TYPES, FACTIONS, WORLD, findUnit, findBuilding, hqOf } from './sim.js';

export function createRenderer(canvas, game, assets) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05080c);
  scene.fog = new THREE.Fog(0x05080c, 140, 340);

  const camera = new THREE.PerspectiveCamera(48, 1, 1, 600);
  const rig = { tx: 0, tz: 0, dist: 78, minD: 26, maxD: 150, pitch: 0.96, shakeT: 0, shakeMag: 0, follow: null };

  // ------------------------------------------------ lights
  scene.add(new THREE.HemisphereLight(0x8fb3cc, 0x0a0f14, 0.55));
  const sun = new THREE.DirectionalLight(0xffe9c9, 1.7);
  sun.position.set(70, 110, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const S = 135;
  Object.assign(sun.shadow.camera, { left: -S, right: S, top: S, bottom: -S, near: 20, far: 300 });
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const rim = new THREE.DirectionalLight(0x3a6b8f, 0.5);
  rim.position.set(-60, 40, -80); scene.add(rim);

  // ------------------------------------------------ ground
  const groundGeo = new THREE.PlaneGeometry(WORLD.size + 60, WORLD.size + 60, 72, 72);
  groundGeo.rotateX(-Math.PI / 2);
  const colors = [];
  const base = new THREE.Color(0x0f1720), alt = new THREE.Color(0x142230);
  const pos = groundGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const n = 0.5 + 0.5 * Math.sin(x * 0.11 + Math.sin(z * 0.07) * 2) * Math.cos(z * 0.09);
    const c = base.clone().lerp(alt, n * 0.8);
    colors.push(c.r, c.g, c.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const ground = new THREE.Mesh(groundGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0.02 }));
  ground.receiveShadow = true;
  ground.userData = { kind: 'ground' };
  scene.add(ground);
  const grid = new THREE.GridHelper(WORLD.size, 40, 0x1e3140, 0x16242f);
  grid.position.y = 0.02; grid.material.transparent = true; grid.material.opacity = 0.5;
  scene.add(grid);
  // world edge glow
  const edge = new THREE.Mesh(
    new THREE.RingGeometry(WORLD.half * 1.408, WORLD.half * 1.415, 4),
    new THREE.MeshBasicMaterial({ color: 0x66d9e8, transparent: true, opacity: 0.35, side: THREE.DoubleSide })
  );
  edge.rotation.x = -Math.PI / 2; edge.rotation.z = Math.PI / 4; edge.position.y = 0.05;
  scene.add(edge);

  // territory discs: build radius per faction
  for (const f of game.factions) {
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(45, 48),
      new THREE.MeshBasicMaterial({ color: f.def.color, transparent: true, opacity: 0.045 })
    );
    disc.rotation.x = -Math.PI / 2; disc.position.set(f.hq.x, 0.03, f.hq.z);
    scene.add(disc);
    const ringB = new THREE.Mesh(
      new THREE.RingGeometry(44.4, 45, 64),
      new THREE.MeshBasicMaterial({ color: f.def.color, transparent: true, opacity: 0.16 })
    );
    ringB.rotation.x = -Math.PI / 2; ringB.position.set(f.hq.x, 0.04, f.hq.z);
    scene.add(ringB);
  }

  // ------------------------------------------------ capitol
  const capitol = buildCapitol();
  capitol.position.set(0, 0, 0);
  capitol.userData = { kind: 'capitol' };
  scene.add(capitol);

  // ------------------------------------------------ dynamic registries
  const unitVis = new Map();      // id → {h, hpBar, selRing, colorCss}
  const buildingVis = new Map();  // id → {group, parts, hpBar, selRing}
  const nodeVis = new Map();      // id → {group, mats, glow}
  const effects = [];             // {update(dt) → alive?}
  const pickables = [ground, capitol];

  // ------------------------------------------------ materials & helpers
  const beamGeo = new THREE.CylinderGeometry(0.09, 0.09, 1, 6, 1, true);
  const addMat = c => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });

  function mat(c, opts = {}) { return new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.15, ...opts }); }
  function emis(c, i = 1) { return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.5 }); }
  function bx(w, h, d, m, x = 0, y = 0, z = 0, shadow = true) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y, z); b.castShadow = shadow; b.receiveShadow = true; return b;
  }

  // ------------------------------------------------ node visuals
  function addNode(n) {
    const g = new THREE.Group(); g.position.set(n.x, 0, n.z);
    const m = new THREE.MeshStandardMaterial({ color: 0x1a4c55, emissive: 0x66d9e8, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0.4, flatShading: true });
    const crystals = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const c = new THREE.Mesh(new THREE.IcosahedronGeometry(0.9 + Math.random() * 0.9, 0), m);
      const a = (i / 5) * Math.PI * 2;
      c.position.set(Math.cos(a) * 1.6, 0.9 + Math.random() * 1.4, Math.sin(a) * 1.6);
      c.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      c.castShadow = true;
      crystals.add(c);
    }
    g.add(crystals);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0x66d9e8, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.setScalar(9); glow.position.y = 1.6;
    g.add(glow);
    g.userData = { kind: 'node', id: n.id };
    scene.add(g); pickables.push(g);
    nodeVis.set(n.id, { group: g, crystals, m, glow });
  }

  let _glowTex = null;
  function glowTex() {
    if (_glowTex) return _glowTex;
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const x = c.getContext('2d');
    const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
    _glowTex = new THREE.CanvasTexture(c); return _glowTex;
  }

  // create data-node visuals (must run after _glowTex is initialized above)
  for (const n of game.nodes) addNode(n);

  // ------------------------------------------------ capitol
  function buildCapitol() {
    const g = new THREE.Group();
    const white = mat(0xd8d4c8, { roughness: 0.55 });
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(8, 8.6, 1, 24), white);
    plinth.position.y = 0.5; plinth.castShadow = plinth.receiveShadow = true; g.add(plinth);
    const hall = new THREE.Mesh(new THREE.CylinderGeometry(4.6, 4.6, 3.2, 20), white);
    hall.position.y = 2.6; hall.castShadow = true; g.add(hall);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 3.4, 8), white);
      col.position.set(Math.cos(a) * 5.8, 2.7, Math.sin(a) * 5.8);
      col.castShadow = true; g.add(col);
    }
    const dome = new THREE.Mesh(new THREE.SphereGeometry(4.2, 24, 14, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xcfc9b8, { roughness: 0.4, metalness: 0.25 }));
    dome.position.y = 4.2; dome.castShadow = true; g.add(dome);
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.4, 10, 8), emis(0xb7a5ff, 1.6));
    beacon.position.y = 8.7; g.add(beacon);
    g.userData_beacon = beacon;
    return g;
  }

  // ------------------------------------------------ building visuals
  function addBuildingVis(b) {
    const f = game.factions[b.factionId];
    const fc = f.def.color;
    const g = new THREE.Group(); g.position.set(b.x, 0, b.z);
    const parts = {};

    if (b.type === 'hq') {
      g.add(bx(11, 0.8, 11, mat(0x1b232c), 0, 0.4, 0));
      const tower = bx(4.6, 8.2, 4.6, mat(0x232c36, { metalness: 0.35, roughness: 0.4 }), -1.4, 4.9, -1.2);
      g.add(tower);
      g.add(bx(4.9, 0.7, 4.9, emis(fc, 1.1), -1.4, 8.6, -1.2)); // crown band
      g.add(bx(5.5, 2.6, 4.2, mat(0x2a343f), 2.6, 1.7, 2.4));   // lab wing
      g.add(bx(5.5, 0.3, 4.2, emis(fc, 0.7), 2.6, 3.1, 2.4));
      // window strips
      for (let y = 2; y <= 7; y += 1.4) g.add(bx(4.7, 0.16, 4.7, emis(0x9fd8e8, 0.55), -1.4, y, -1.2, false));
      const ant = bx(0.14, 3.4, 0.14, mat(0x555f6a), -1.4, 10.6, -1.2);
      g.add(ant);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.32, 8, 8), emis(fc, 2));
      lamp.position.set(-1.4, 12.4, -1.2); g.add(lamp);
      parts.lamp = lamp;
    } else if (b.type === 'datacenter') {
      g.add(bx(6.5, 0.4, 5.4, mat(0x1b232c), 0, 0.2, 0));
      const hall = bx(6, 2.7, 4.8, mat(0x20282f, { metalness: 0.3, roughness: 0.45 }), 0, 1.75, 0);
      g.add(hall);
      g.add(bx(6.1, 0.5, 4.9, emis(fc, 0.8), 0, 3.0, 0)); // roof trim
      for (const zz of [-1.6, 0, 1.6]) g.add(bx(6.05, 0.22, 0.5, emis(0x9fe8ff, 0.9), 0, 1.4, zz, false));
      parts.fans = [];
      for (const xx of [-1.7, 1.7]) {
        const fan = new THREE.Group(); fan.position.set(xx, 3.35, 0);
        fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.18, 12), mat(0x2c363f)));
        for (let i = 0; i < 3; i++) {
          const blade = bx(1.5, 0.06, 0.24, mat(0x8fa2ad), 0, 0.12, 0, false);
          blade.rotation.y = (i / 3) * Math.PI * 2; fan.add(blade);
        }
        g.add(fan); parts.fans.push(fan);
      }
    } else if (b.type === 'turret') {
      g.add(bx(2.6, 1.2, 2.6, mat(0x1f2830), 0, 0.6, 0));
      const head = new THREE.Group(); head.position.y = 1.7;
      head.add(bx(1.5, 1, 1.5, mat(0x2a343f, { metalness: 0.4 })));
      const barrel = bx(0.3, 0.3, 2.4, mat(0x39434d, { metalness: 0.5 }), 0, 0.15, 1.2);
      head.add(barrel);
      const tip = bx(0.16, 0.16, 0.3, emis(fc, 1.6), 0, 0.15, 2.4, false);
      head.add(tip);
      g.add(head);
      parts.head = head;
      g.add(bx(2.7, 0.2, 2.7, emis(fc, 0.7), 0, 1.25, 0, false));
    }

    // construction scaffold hologram
    const size = BUILDING_TYPES[b.type].size;
    const scaffold = new THREE.Mesh(
      new THREE.BoxGeometry(size, size * 0.8, size),
      new THREE.MeshBasicMaterial({ color: fc, wireframe: true, transparent: true, opacity: 0.4 })
    );
    scaffold.position.y = size * 0.4;
    g.add(scaffold);
    parts.scaffold = scaffold;

    g.userData = { kind: 'building', id: b.id };
    scene.add(g); pickables.push(g);

    const hpBar = makeBar(f.def.colorCss);
    hpBar.sprite.position.y = b.type === 'hq' ? 13.5 : b.type === 'datacenter' ? 5 : 4;
    hpBar.sprite.visible = false;
    g.add(hpBar.sprite);

    const selRing = makeSelRing(size * 0.72, 0x9fe8ff);
    g.add(selRing);

    buildingVis.set(b.id, { group: g, parts, hpBar, selRing, type: b.type });
  }

  // ------------------------------------------------ unit visuals
  function addUnitVis(u) {
    const f = game.factions[u.factionId];
    const h = assets.makeUnit(u.type, f.def.color);
    h.root.position.set(u.x, 0, u.z);
    h.root.userData = { kind: 'unit', id: u.id };
    scene.add(h.root); pickables.push(h.root);

    const hpBar = makeBar(f.def.colorCss);
    hpBar.sprite.position.y = h.height + 0.7;
    hpBar.sprite.visible = false;
    h.root.add(hpBar.sprite);

    const selRing = makeSelRing(1.25, 0x9fe8ff);
    h.root.add(selRing);

    unitVis.set(u.id, { h, hpBar, selRing, lastRatio: 1 });
  }

  // ------------------------------------------------ HP bars & selection rings
  function makeBar(colorCss) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 10;
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(2.6, 0.4, 1);
    const draw = ratio => {
      const x = c.getContext('2d');
      x.clearRect(0, 0, 64, 10);
      x.fillStyle = 'rgba(0,0,0,0.65)'; x.fillRect(0, 0, 64, 10);
      x.fillStyle = ratio > 0.55 ? colorCss : ratio > 0.25 ? '#ffb64d' : '#ff6b57';
      x.fillRect(1, 1, 62 * Math.max(0, ratio), 8);
      tex.needsUpdate = true;
    };
    draw(1);
    return { sprite, draw, last: -1 };
  }
  function makeSelRing(r, color) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(r * 0.86, r, 32),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06; ring.visible = false;
    return ring;
  }

  // ------------------------------------------------ effects
  function addBeam(fx, fz, tx, tz, color, y0 = 1.6, y1 = 1.4) {
    const from = new THREE.Vector3(fx, y0, fz), to = new THREE.Vector3(tx, y1, tz);
    const dir = to.clone().sub(from); const len = dir.length();
    const m = new THREE.Mesh(beamGeo, addMat(color));
    m.position.copy(from).addScaledVector(dir, 0.5);
    m.scale.set(1, len, 1);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    scene.add(m);
    const flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    flash.position.copy(from); flash.scale.setScalar(2.2); scene.add(flash);
    let life = 0.13;
    effects.push({ update(dt) {
      life -= dt;
      m.material.opacity = Math.max(0, life / 0.13);
      flash.material.opacity = m.material.opacity;
      if (life <= 0) { scene.remove(m, flash); m.material.dispose(); flash.material.dispose(); return false; }
      return true;
    } });
  }

  function addBurst(x, z, color, count = 26, big = false) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3), v = [];
    for (let i = 0; i < count; i++) {
      p[i * 3] = x; p[i * 3 + 1] = 1 + Math.random(); p[i * 3 + 2] = z;
      const a = Math.random() * Math.PI * 2, sp = (big ? 9 : 5) * (0.4 + Math.random());
      v.push([Math.cos(a) * sp, 4 + Math.random() * (big ? 9 : 5), Math.sin(a) * sp]);
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size: big ? 0.7 : 0.4, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    scene.add(pts);
    let life = big ? 1.1 : 0.8;
    const total = life;
    effects.push({ update(dt) {
      life -= dt;
      const arr = g.attributes.position.array;
      for (let i = 0; i < count; i++) {
        v[i][1] -= 18 * dt;
        arr[i * 3] += v[i][0] * dt; arr[i * 3 + 1] = Math.max(0.05, arr[i * 3 + 1] + v[i][1] * dt); arr[i * 3 + 2] += v[i][2] * dt;
      }
      g.attributes.position.needsUpdate = true;
      pts.material.opacity = Math.max(0, life / total);
      if (life <= 0) { scene.remove(pts); g.dispose(); pts.material.dispose(); return false; }
      return true;
    } });
  }

  function addRing(x, z, color, r0 = 0.5, r1 = 4, dur = 0.5) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), addMat(color));
    ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.08, z);
    scene.add(ring);
    let t = 0;
    effects.push({ update(dt) {
      t += dt / dur;
      const r = r0 + (r1 - r0) * t;
      ring.scale.setScalar(r);
      ring.material.opacity = Math.max(0, 0.9 * (1 - t));
      if (t >= 1) { scene.remove(ring); ring.material.dispose(); return false; }
      return true;
    } });
  }

  function addFloatText(x, z, text, colorCss, big = false) {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96;
    const g2 = c.getContext('2d');
    g2.font = `700 ${big ? 56 : 44}px 'Space Grotesk', sans-serif`;
    g2.textAlign = 'center'; g2.textBaseline = 'middle';
    g2.shadowColor = 'rgba(0,0,0,0.9)'; g2.shadowBlur = 10;
    g2.fillStyle = colorCss; g2.fillText(text, 256, 48);
    const tex = new THREE.CanvasTexture(c);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(big ? 22 : 14, big ? 4.1 : 2.6, 1);
    sp.position.set(x, big ? 10 : 4, z);
    scene.add(sp);
    let life = big ? 3 : 1.7;
    const total = life;
    effects.push({ update(dt) {
      life -= dt; sp.position.y += dt * 2.2;
      sp.material.opacity = Math.min(1, life / (total * 0.4));
      if (life <= 0) { scene.remove(sp); sp.material.dispose(); tex.dispose(); return false; }
      return true;
    } });
  }

  function addWinBeacon(x, z, color) {
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 5, 240, 20, 1, true), addMat(color));
    beam.material.opacity = 0.0; beam.material.side = THREE.DoubleSide;
    beam.position.set(x, 120, z);
    scene.add(beam);
    let t = 0;
    effects.push({ update(dt) {
      t += dt;
      beam.material.opacity = Math.min(0.55, t * 0.5) * (0.8 + 0.2 * Math.sin(t * 6));
      beam.rotation.y += dt * 0.4;
      if (Math.floor(t * 2) !== Math.floor((t - dt) * 2)) addRing(x, z, color, 2, 26, 1.4);
      return t < 30;
    } });
  }

  // ------------------------------------------------ sim → visual event router
  function handleEvent(e) {
    const F = fid => FACTIONS[fid];
    switch (e.t) {
      case 'shot': addBeam(e.fx, e.fz, e.tx, e.tz, F(e.fid).color, e.turret ? 2 : 1.6, e.high ? 2.2 : 1.3); break;
      case 'die': addBurst(e.x, e.z, F(e.fid).color, 22); break;
      case 'demolish': addBurst(e.x, e.z, 0xff8844, 46, true); addRing(e.x, e.z, 0xff6b57, 1, 12, 0.8); shake(0.7); break;
      case 'placed': addRing(e.x, e.z, F(e.fid).color, 1, 7, 0.6); break;
      case 'built': addRing(e.x, e.z, F(e.fid).color, 2, 9, 0.7); addBurst(e.x, e.z, F(e.fid).color, 18); break;
      case 'recruit': addRing(e.x, e.z, F(e.fid).color, 0.4, 3, 0.45); break;
      case 'complete': {
        const hq = hqOf(game, e.fid);
        if (hq) { addFloatText(hq.x, hq.z, `${F(e.fid).name}: ${e.name} SHIPPED`, F(e.fid).colorCss, true); addRing(hq.x, hq.z, F(e.fid).color, 3, 30, 1.4); }
        break;
      }
      case 'incident': {
        const hq = hqOf(game, e.fid);
        if (hq) addFloatText(hq.x, hq.z, 'PUBLIC INCIDENT', '#ff6b57', true);
        break;
      }
      case 'probe': {
        const hq = hqOf(game, e.target);
        if (hq) { addFloatText(hq.x, hq.z, 'REGULATORY PROBE', '#b7a5ff', true); addRing(hq.x, hq.z, 0xb7a5ff, 2, 20, 1.2); }
        break;
      }
      case 'siStart': {
        const hq = hqOf(game, e.fid);
        if (hq) { addFloatText(hq.x, hq.z, `${F(e.fid).name}: FINAL RUN INITIATED`, F(e.fid).colorCss, true); addRing(hq.x, hq.z, F(e.fid).color, 2, 40, 2); }
        break;
      }
      case 'underAttack': if (e.fid === game.playerFaction) { shake(0.5); addRing(e.x, e.z, 0xff6b57, 1, 9, 0.8); } break;
      case 'win': {
        const hq = hqOf(game, e.fid) || { x: game.factions[e.fid].hq.x, z: game.factions[e.fid].hq.z };
        addWinBeacon(hq.x, hq.z, F(e.fid).color);
        rig.follow = { x: hq.x, z: hq.z, dist: 62 };
        break;
      }
    }
  }

  function shake(mag) { rig.shakeMag = Math.max(rig.shakeMag, mag); rig.shakeT = 0.5; }

  // ------------------------------------------------ per-frame sync
  const seenU = new Set(), seenB = new Set();
  function sync(alpha, dt) {
    // units
    seenU.clear();
    for (const u of game.units) {
      seenU.add(u.id);
      let v = unitVis.get(u.id);
      if (!v) { addUnitVis(u); v = unitVis.get(u.id); }
      const x = u.prevX + (u.x - u.prevX) * alpha;
      const z = u.prevZ + (u.z - u.prevZ) * alpha;
      v.h.root.position.set(x, 0, z);
      const moving = Math.abs(u.x - u.prevX) + Math.abs(u.z - u.prevZ) > 0.004;
      if (moving || u.state === 'attack') {
        // models face +Z; dir = atan2(dx, dz) maps straight to rotation.y
        v.h.root.rotation.y = dampAngle(v.h.root.rotation.y, u.dir, 12, dt);
      }
      const anim = moving ? 'walk' : u.atWork ? (u.state === 'attack' ? 'fight' : 'work') : 'idle';
      v.h.update(dt, anim);
      const ratio = u.hp / u.maxHp;
      if (ratio !== v.hpBar.last) { v.hpBar.draw(ratio); v.hpBar.last = ratio; }
      v.hpBar.sprite.visible = ratio < 0.999 || v.selRing.visible;
    }
    for (const [id, v] of unitVis) if (!seenU.has(id)) {
      scene.remove(v.h.root);
      const pi = pickables.indexOf(v.h.root); if (pi >= 0) pickables.splice(pi, 1);
      unitVis.delete(id);
    }

    // buildings
    seenB.clear();
    for (const b of game.buildings) {
      seenB.add(b.id);
      let v = buildingVis.get(b.id);
      if (!v) { addBuildingVis(b); v = buildingVis.get(b.id); }
      const g = v.group;
      if (b.building) {
        const p = Math.min(1, b.buildProgress);
        g.scale.y = 0.12 + 0.88 * p;
        v.parts.scaffold.visible = true;
        v.parts.scaffold.material.opacity = 0.45 * (1 - p * 0.6);
        v.parts.scaffold.rotation.y += dt * 0.8;
      } else {
        g.scale.y = 1;
        v.parts.scaffold.visible = false;
      }
      if (v.parts.fans) for (const f of v.parts.fans) f.rotation.y += dt * 7;
      if (v.parts.lamp) v.parts.lamp.material.emissiveIntensity = 1.4 + Math.sin(performance.now() * 0.004) * 0.8;
      if (v.parts.head) {
        const t = b.targetId ? findUnit(game, b.targetId) : null;
        if (t) {
          const want = Math.atan2(t.x - b.x, t.z - b.z);
          v.parts.head.rotation.y = dampAngle(v.parts.head.rotation.y, want, 10, dt);
        }
      }
      const ratio = b.hp / b.maxHp;
      if (ratio !== v.hpBar.last) { v.hpBar.draw(ratio); v.hpBar.last = ratio; }
      v.hpBar.sprite.visible = (ratio < 0.999 && !b.building) || v.selRing.visible;
    }
    for (const [id, v] of buildingVis) if (!seenB.has(id)) {
      scene.remove(v.group);
      const pi = pickables.indexOf(v.group); if (pi >= 0) pickables.splice(pi, 1);
      buildingVis.delete(id);
    }

    // nodes
    for (const n of game.nodes) {
      const v = nodeVis.get(n.id);
      if (!v) continue;
      const ratio = Math.max(0.12, n.remaining / n.total);
      v.crystals.scale.setScalar(0.3 + 0.7 * ratio);
      v.crystals.rotation.y += dt * 0.25;
      v.m.emissiveIntensity = 0.25 + ratio * 1.1;
      v.glow.material.opacity = 0.15 + ratio * 0.4;
    }
    capitol.userData_beacon.material.emissiveIntensity = 1.2 + Math.sin(performance.now() * 0.003) * 0.6;

    // effects
    for (let i = effects.length - 1; i >= 0; i--) if (!effects[i].update(dt)) effects.splice(i, 1);

    // camera
    if (rig.follow) {
      rig.tx += (rig.follow.x - rig.tx) * Math.min(1, dt * 1.5);
      rig.tz += (rig.follow.z - rig.tz) * Math.min(1, dt * 1.5);
      rig.dist += (rig.follow.dist - rig.dist) * Math.min(1, dt * 1.5);
    }
    let sx = 0, sz = 0;
    if (rig.shakeT > 0) {
      rig.shakeT -= dt;
      const m = rig.shakeMag * (rig.shakeT / 0.5);
      sx = (Math.random() - 0.5) * m; sz = (Math.random() - 0.5) * m;
      if (rig.shakeT <= 0) rig.shakeMag = 0;
    }
    camera.position.set(rig.tx + sx, rig.dist * Math.sin(rig.pitch), rig.tz + rig.dist * Math.cos(rig.pitch) + sz);
    camera.lookAt(rig.tx + sx, 0, rig.tz + sz);
    sun.target.position.set(rig.tx, 0, rig.tz);
    sun.position.set(rig.tx + 70, 110, rig.tz + 45);

    renderer.render(scene, camera);
  }

  function dampAngle(cur, target, lambda, dt) {
    let d = target - cur;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return cur + d * Math.min(1, lambda * dt);
  }

  // ------------------------------------------------ picking & selection
  const raycaster = new THREE.Raycaster();
  function pickEntity(ndcX, ndcY) {
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const hits = raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.kind) {
          return { kind: o.userData.kind, id: o.userData.id ?? null, point: h.point };
        }
        o = o.parent;
      }
    }
    return null;
  }
  function groundPoint(ndcX, ndcY) {
    raycaster.setFromCamera({ x: ndcX, y: ndcY }, camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    return hit;
  }
  const _v3 = new THREE.Vector3();
  function projectToScreen(x, y, z, w, h) {
    _v3.set(x, y, z).project(camera);
    return { x: (_v3.x * 0.5 + 0.5) * w, y: (-_v3.y * 0.5 + 0.5) * h, behind: _v3.z > 1 };
  }
  function setSelected(ids) {
    for (const [id, v] of unitVis) v.selRing.visible = ids.has(id);
    for (const [id, v] of buildingVis) v.selRing.visible = ids.has(id);
  }

  // ------------------------------------------------ build ghost
  let ghost = null;
  function showGhost(type) {
    hideGhost();
    if (!type) return;
    const size = BUILDING_TYPES[type].size;
    ghost = new THREE.Group();
    const bxm = new THREE.Mesh(new THREE.BoxGeometry(size, size * 0.55, size),
      new THREE.MeshBasicMaterial({ color: 0x66d9e8, transparent: true, opacity: 0.3, depthWrite: false }));
    bxm.position.y = size * 0.28;
    const ring = new THREE.Mesh(new THREE.RingGeometry(size * 0.72, size * 0.8, 32),
      new THREE.MeshBasicMaterial({ color: 0x66d9e8, transparent: true, opacity: 0.7, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07;
    ghost.add(bxm, ring);
    ghost.userData_parts = { bxm, ring };
    scene.add(ghost);
  }
  function moveGhost(x, z, ok) {
    if (!ghost) return;
    ghost.position.set(x, 0, z);
    const c = ok ? 0x7fd67f : 0xff6b57;
    ghost.userData_parts.bxm.material.color.setHex(c);
    ghost.userData_parts.ring.material.color.setHex(c);
  }
  function hideGhost() { if (ghost) { scene.remove(ghost); ghost = null; } }

  // ------------------------------------------------ resize
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    rig, sync, handleEvent, shake,
    pickEntity, groundPoint, projectToScreen, setSelected,
    showGhost, moveGhost, hideGhost,
    addRing, addFloatText,
  };
}
