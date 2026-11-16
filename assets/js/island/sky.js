// Game models for the height page's stage: meshes taken from Sky's own files (assets/glb/), drawn in the site's toon
// style — the candles, the lantern post, the crab and the pebbles. Each maker returns { object, update? }; the stage
// leaves a model out when its file fails to load.
import * as THREE from 'three';
import { toon, addOutline } from './toon.js';

const GLB = new URL('../../glb/', import.meta.url);

let loaderPromise = null;
const loader = () => (loaderPromise ||= import('three/addons/loaders/GLTFLoader.js').then(m => new m.GLTFLoader()));

// The files hold one bare mesh each (no material): hand back a private copy of its geometry.
async function geometry(file) {
  const gltf = await (await loader()).loadAsync(new URL(file + '.glb', GLB).href);
  let geo = null;
  gltf.scene.traverse(o => { if (o.isMesh && !geo) geo = o.geometry; });
  if (!geo) throw new Error(`${file}.glb holds no mesh`);
  return geo.clone();
}

function empty(name, x, y, z, scale = 1) {
  const o = new THREE.Object3D();
  o.name = name; o.position.set(x, y, z); o.scale.setScalar(scale);
  return o;
}

// Per-vertex colours for meshes whose palette is not among the ramps we have.
function paint(geo, colourAt) {
  const p = geo.attributes.position, uv = geo.attributes.uv, out = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    colourAt(v.fromBufferAttribute(p, i), uv ? uv.getY(i) : 0, c);
    out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return geo;
}

function toonMesh(geo, material) {
  const mesh = new THREE.Mesh(geo, material);
  addOutline(mesh);
  return mesh;
}

// ── candles ──────────────────────────────────────────────────────────────
// One game candle, stood three times at different sizes. Each carries a flame_anchor at its wick tip, and
// userData.settle so main.js can rest it on the uneven seat.
const WAX_TOP = new THREE.Color('#fff8e6'), WAX_FOOT = new THREE.Color('#efcf9d'), WICK = new THREE.Color('#3a2f2a');
const CANDLES = [[0, 0, 2.2, 0.4], [-0.21, 0.09, 1.55, 2.2], [0.16, 0.15, 1.2, 4.4]];   // x, z, size, turn

export async function skyCandles() {
  const src = await geometry('Candles_02');
  const p = src.attributes.position, tip = new THREE.Vector3(0, -1, 0), v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) if (v.fromBufferAttribute(p, i).y > tip.y) tip.copy(v);
  // the wick is the thin strand around the tip; the wax shades from a warm foot to a pale, lit top
  paint(src, (pos, _uvY, c) => {
    if (pos.y > tip.y - 0.034 && Math.hypot(pos.x - tip.x, pos.z - tip.z) < 0.008) c.copy(WICK);
    else c.copy(WAX_FOOT).lerp(WAX_TOP, Math.min(1, pos.y / (tip.y * 0.8)));
  });
  const material = toon('#ffffff', { vertexColors: true });
  const g = new THREE.Group();
  for (const [x, z, size, turn] of CANDLES) {
    const geo = src.clone();
    geo.rotateY(turn);
    geo.scale(size, size, size);
    const candle = toonMesh(geo, material);
    candle.position.set(x, 0, z);
    candle.userData.settle = true;
    const at = tip.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn).multiplyScalar(size);
    const anchor = empty('flame_anchor', at.x, at.y - 0.012 * size, at.z);
    anchor.userData.size = 0.62 + size * 0.2;
    candle.add(anchor);
    g.add(candle);
  }
  return { object: g };
}

// ── height page: lantern post, crab, pebbles ─────────────────────────────
// The lantern post is the game's placeable one. Its own texture is a ramp tinted by the engine, so it is painted
// here in the stage's stone colours, with a glowing core showing through the windows of its cage.
const LANTERN_FILE = '12_家具擺設_Placeable/CharSkyKid_Prop_LanternPost';
const LANTERN_SCALE = 0.21;                 // 16.35 tall in the file → about 3.4
const CAGE = { from: 9.55, to: 12.85, r: 1.35 };   // the windowed cage, in model units

export async function skyLantern() {
  const geo = await geometry(LANTERN_FILE);
  const stone = new THREE.Color('#f2eadc'), foot = new THREE.Color('#ded1bb'), roof = new THREE.Color('#d0814f'), gold = new THREE.Color('#f2c46d');
  paint(geo, (p, _uvY, c) => c.copy(p.y > 14.97 ? gold : p.y > 13.55 ? roof : p.y < 4 ? foot : stone));
  geo.scale(LANTERN_SCALE, LANTERN_SCALE, LANTERN_SCALE);
  const g = new THREE.Group();
  g.add(toonMesh(geo, toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide })));
  const k = LANTERN_SCALE, core = new THREE.Mesh(
    new THREE.CylinderGeometry(CAGE.r * k, CAGE.r * k, (CAGE.to - CAGE.from) * k * 0.92, 8),
    new THREE.MeshBasicMaterial({ color: '#ffd98c' }));
  core.position.y = (CAGE.from + CAGE.to) / 2 * k;
  g.add(core);
  return { object: g, lightAnchor: new THREE.Vector3(0, core.position.y, 0) };
}

// The game's crab: a rock-backed shell on four legs, dark as in the game. It sidles now and then.
export async function skyCrab() {
  const geo = await geometry('CrabA');
  const leg = new THREE.Color('#3f4350'), shell = new THREE.Color('#545a6a'), top = new THREE.Color('#717789');
  paint(geo, (p, _uvY, c) => (p.y < 0.55 ? c.copy(leg) : c.copy(shell).lerp(top, Math.min(1, (p.y - 0.55) / 1.45))));
  geo.rotateY(Math.PI);       // it faces -Z in the file, like the kid
  geo.scale(0.3, 0.3, 0.3);   // about 0.6 tall, 0.8 across
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(toonMesh(geo, toon('#ffffff', { vertexColors: true })));
  root.add(body);
  return {
    object: root,
    update(t) {
      const cycle = t % 8, walk = cycle > 6 && cycle < 7.4 ? Math.sin((cycle - 6) / 1.4 * Math.PI) : 0;
      body.position.x = walk * 0.12;
      body.position.y = walk ? Math.abs(Math.sin(t * 22)) * 0.018 : 0;
      body.scale.y = 1 + Math.sin(t * 2) * 0.015;
      body.rotation.z = walk * Math.sin(t * 22) * 0.04;
    }
  };
}

// The game's small rock cluster as pebbles: spots = [[x, z, size, turn], …], one tint per spot in turn.
export async function skyRocks(spots, tints) {
  const geo = await geometry('SkyRockCluster');
  const mesh = new THREE.InstancedMesh(geo, toon('#ffffff'), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();
  spots.forEach(([x, z, k, turn], i) => {
    mesh.setMatrixAt(i, m.compose(v.set(x, 0.004, z), q.setFromAxisAngle(up, turn), s.set(k, k * 3, k)));
    mesh.setColorAt(i, c.set(tints[i % tints.length]));
  });
  mesh.raycast = () => {};
  return { object: mesh };
}
