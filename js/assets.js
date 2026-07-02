// assets.js — hybrid character pipeline.
// 1) Tries to fetch the rigged Soldier.glb (skeletal Idle/Walk/Run clips) from
//    the three.js example CDN for cyber-ops agents.
// 2) Researchers & lobbyists — and agents too, if the download fails — use a
//    procedural articulated rig (hip/shoulder pivots) with hand-written walk,
//    work and fight cycles. Guaranteed to run offline.

import * as THREE from 'three';

const SOLDIER_URL = 'https://threejs.org/examples/models/gltf/Soldier.glb';

let soldierAsset = null; // { scene, animations } or null

export async function loadAssets(onStatus = () => {}) {
  onStatus('Contacting asset CDN for rigged characters…');
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
    const gltf = await withTimeout(new GLTFLoader().loadAsync(SOLDIER_URL), 9000);
    if (gltf && gltf.animations && gltf.animations.length) {
      soldierAsset = gltf;
      onStatus('Rigged soldier model loaded — agents get real skeletal animation.');
    }
  } catch (e) {
    console.warn('Soldier.glb unavailable, using procedural rigs everywhere.', e);
    onStatus('CDN model unavailable — deploying procedural rigs (fully offline).');
  }
  if (soldierAsset) {
    const { clone } = await import('three/addons/utils/SkeletonUtils.js');
    soldierAsset.cloneFn = clone;
  }
  return { makeUnit };
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

// ---------------------------------------------------------------- factory

export function makeUnit(type, colorHex) {
  if (type === 'agent' && soldierAsset) return makeSoldier(colorHex);
  return makeProcedural(type, colorHex);
}

// ---------- path A: real skinned GLTF with AnimationMixer ----------

function makeSoldier(colorHex) {
  const root = new THREE.Group();
  const model = soldierAsset.cloneFn(soldierAsset.scene);
  model.scale.setScalar(1.25);
  model.rotation.y = Math.PI; // soldier faces -Z by default; our units face +Z
  const tint = new THREE.Color(colorHex);
  model.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = true;
      o.material = o.material.clone();
      if (o.material.color) o.material.color.lerp(tint, 0.45);
    }
  });
  root.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const clips = {};
  for (const c of soldierAsset.animations) clips[c.name.toLowerCase()] = mixer.clipAction(c, model);
  const pick = (...names) => { for (const n of names) if (clips[n]) return clips[n]; return Object.values(clips)[0]; };
  const actions = { idle: pick('idle'), walk: pick('run', 'walk'), work: pick('idle'), fight: pick('idle') };
  let current = null;
  const setAnim = a => {
    const next = actions[a] || actions.idle;
    if (next === current) return;
    if (current) current.fadeOut(0.18);
    next.reset().fadeIn(0.18).play();
    current = next;
  };
  setAnim('idle');

  return {
    root, height: 2.3,
    update(dt, anim) { setAnim(anim); mixer.update(dt); },
  };
}

// ---------- path B: procedural articulated rig ----------

const skinMat = memoMat(0xd9b38c);
function memoMat(c) { let m; return () => (m ||= new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 })); }
const matCache = new Map();
function mat(c, emissive = 0) {
  const key = c + ':' + emissive;
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial({
    color: c, roughness: 0.75, metalness: 0.08,
    emissive: emissive ? c : 0x000000, emissiveIntensity: emissive,
  }));
  return matCache.get(key);
}
function box(w, h, d, m) {
  const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  g.castShadow = true;
  return g;
}

function makeProcedural(type, colorHex) {
  const fc = new THREE.Color(colorHex);
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);

  const palette = {
    researcher: { torso: 0xe8ecef, legs: 0x2a3138, trim: colorHex },      // lab coat
    agent:      { torso: 0x21262c, legs: 0x14181d, trim: colorHex },      // tactical dark
    lobbyist:   { torso: 0x2b3a52, legs: 0x1d2736, trim: colorHex },      // navy suit
  }[type] || { torso: 0x888888, legs: 0x555555, trim: colorHex };

  // torso (pivot at hips, y=1.05)
  const torso = box(0.78, 0.85, 0.42, mat(palette.torso));
  torso.position.y = 1.05 + 0.425; body.add(torso);
  // faction trim band across the chest
  const band = box(0.8, 0.14, 0.44, mat(palette.trim, 0.55));
  band.position.set(0, 1.62, 0); body.add(band);
  // head
  const head = box(0.42, 0.42, 0.42, type === 'agent' ? mat(0x181c21) : skinMat());
  head.position.y = 2.12; body.add(head);
  if (type === 'agent') { // glowing visor
    const visor = box(0.34, 0.1, 0.06, mat(palette.trim, 1.4));
    visor.position.set(0, 2.16, 0.22); body.add(visor);
  }
  if (type === 'researcher') { // AR goggles up on the forehead
    const gg = box(0.4, 0.09, 0.1, mat(0x66d9e8, 0.9));
    gg.position.set(0, 2.28, 0.16); body.add(gg);
  }

  // limbs with true pivots
  function limb(w, len, m, px, py) {
    const pivot = new THREE.Group(); pivot.position.set(px, py, 0);
    const seg = box(w, len, w, m); seg.position.y = -len / 2; pivot.add(seg);
    body.add(pivot); return pivot;
  }
  const armL = limb(0.2, 0.78, mat(palette.torso), -0.5, 1.85);
  const armR = limb(0.2, 0.78, mat(palette.torso), 0.5, 1.85);
  const legL = limb(0.24, 1.02, mat(palette.legs), -0.2, 1.04);
  const legR = limb(0.24, 1.02, mat(palette.legs), 0.2, 1.04);

  // props
  let prop = null;
  if (type === 'lobbyist') {
    prop = box(0.34, 0.26, 0.1, mat(0x6b4a2f));
    prop.position.set(0, -0.72, 0.05); armR.add(prop);
  }
  if (type === 'agent') { // sidearm emitter
    prop = box(0.1, 0.1, 0.42, mat(0x0c0f12));
    prop.position.set(0, -0.75, 0.2); armR.add(prop);
    const tip = box(0.06, 0.06, 0.08, mat(palette.trim, 1.6));
    tip.position.set(0, 0, 0.25); prop.add(tip);
  }
  if (type === 'researcher') { // data slate
    prop = box(0.3, 0.02, 0.22, mat(0x66d9e8, 0.8));
    prop.position.set(0, -0.72, 0.1); armL.add(prop);
  }

  let phase = Math.random() * 10;
  const rig = { body, armL, armR, legL, legR, fc };

  return {
    root, height: 2.5,
    update(dt, anim) {
      phase += dt * (anim === 'walk' ? 9.5 : anim === 'work' ? 7 : anim === 'fight' ? 12 : 2.2);
      const s = Math.sin(phase), c = Math.cos(phase);
      switch (anim) {
        case 'walk':
          rig.legL.rotation.x = s * 0.75; rig.legR.rotation.x = -s * 0.75;
          rig.armL.rotation.x = -s * 0.6; rig.armR.rotation.x = s * 0.6;
          rig.armR.rotation.z = 0; rig.body.position.y = Math.abs(c) * 0.07;
          rig.body.rotation.x = 0.06;
          break;
        case 'work': // hunched over, hammering/typing with the right arm
          rig.body.rotation.x = 0.28;
          rig.legL.rotation.x = -0.18; rig.legR.rotation.x = -0.18;
          rig.armL.rotation.x = -0.85;
          rig.armR.rotation.x = -0.7 + s * 0.5; rig.armR.rotation.z = 0;
          rig.body.position.y = 0;
          break;
        case 'fight': // combat stance, weapon arm raised, recoil jitter
          rig.body.rotation.x = 0.1;
          rig.legL.rotation.x = 0.25; rig.legR.rotation.x = -0.25;
          rig.armR.rotation.x = -1.45 + Math.max(0, s) * 0.12;
          rig.armL.rotation.x = -1.1;
          rig.body.position.y = 0;
          break;
        default: // idle breathing
          rig.legL.rotation.x = rig.legR.rotation.x = 0;
          rig.armL.rotation.x = s * 0.06; rig.armR.rotation.x = -s * 0.06;
          rig.armR.rotation.z = 0;
          rig.body.rotation.x = 0; rig.body.position.y = Math.sin(phase * 0.8) * 0.02;
      }
    },
  };
}
