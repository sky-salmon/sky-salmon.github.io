// Game models on the home island and the height stage: meshes taken from Sky's own files (assets/glb/),
// coloured with the game's colour ramps (assets/avatar/tex/) where the mesh's UVs index one, and drawn in the
// island's toon style.
// Each maker returns { object, update? }; a page leaves a model out when its file fails to load.
import * as THREE from 'three';
import { toon, addOutline } from './toon.js';
import { blobShadow, rng } from './util.js';

const GLB = new URL('../../glb/', import.meta.url);
const RAMPS = new URL('../../avatar/tex/', import.meta.url);

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

// A colour ramp is a tiny palette the mesh UVs point into; the game samples it without mips.
async function ramp(name) {
  const tx = await new THREE.TextureLoader().loadAsync(new URL(name + '.png', RAMPS).href);
  tx.flipY = false;
  tx.colorSpace = THREE.SRGBColorSpace;
  tx.generateMipmaps = false;
  tx.minFilter = tx.magFilter = THREE.LinearFilter;
  return tx;
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

// ── the kid ──────────────────────────────────────────────────────────────
// Assembled by the same engine as the height page. `look` = { pieces, dyes, attitude, height, scale } (saved-look.js);
// pieces null = the game's starting outfit. wear(look) re-dresses the same kid.
const KID_UNITS = 15.557;   // head top of the default kid, in game units
const KID_HEIGHT = 2.2;     // …and how tall that stands on the island
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : 0));

export async function skyKid(look) {
  const { createAvatar } = await import('../avatar-engine.js');
  const api = await createAvatar();
  const idx = api.index, rules = api.rules || {};
  // the starting outfit, minus the game's empty "None" pieces
  const defaults = Object.fromEntries(Object.entries(idx.defaults || {}).filter(([, n]) => (idx.pieces[n] || {}).file));
  async function wear(l) {
    const pieces = {};
    if (l.pieces) for (const [slot, name] of Object.entries(l.pieces)) pieces[slot] = idx.pieces[name] ? name : null;
    else Object.assign(pieces, defaults);
    if (!pieces.outfit) pieces.outfit = defaults.outfit || null;   // the body piece carries the head too
    return api.wearLook({
      pieces,
      dyes: l.pieces ? l.dyes || {} : {},
      clip: l.pieces && rules.attitudeClip ? rules.attitudeClip(idx, l.attitude) : 'idle',
      body: { height: clamp(l.height, rules.HEIGHT_RANGE || [-2, 2]), scale: clamp(l.scale, rules.SCALE_RANGE || [-0.2, 0.2]) }
    });
  }
  if (!(await wear(look))) throw new Error('the kid could not be dressed');

  const root = new THREE.Group(), holder = new THREE.Group();
  holder.scale.setScalar(KID_HEIGHT / KID_UNITS);
  holder.rotation.y = Math.PI;   // the game's kid faces -Z
  holder.add(api.object);
  root.add(holder, blobShadow(1.0, 0.7, 0.38));
  return { object: root, update: (t, dt) => api.update(dt), wear };
}

// ── stone bench ──────────────────────────────────────────────────────────
export async function skyBench() {
  const geo = await geometry('BenchStone');
  geo.scale(0.2, 0.2, 0.2);   // 2.8 long, seat about 0.8 up
  const g = new THREE.Group();
  g.add(toonMesh(geo, toon('#ddd3c5')), blobShadow(3.5, 1.6, 0.3));
  return { object: g };
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

// ── fox ──────────────────────────────────────────────────────────────────
export async function skyFox() {
  const [geo, tex] = await Promise.all([geometry('Prop_AP11Fox_CompOcc'), ramp('CharRampS11')]);
  geo.translate(-0.2, 0, 0.3);   // sit the body (not the tail) over the origin
  geo.scale(0.15, 0.15, 0.15);   // about 0.55 tall
  const root = new THREE.Group(), body = new THREE.Group();
  body.add(toonMesh(geo, toon('#ffffff', { noCache: true, map: tex, side: THREE.DoubleSide })));
  root.add(body, blobShadow(0.62, 0.5, 0.32));
  return {
    object: root,
    update(t) {
      // a plush has no bones: it breathes, tilts its head a little, and hops now and then
      const cycle = t % 6.5;
      const hop = cycle > 5.6 && cycle < 6.05 ? Math.sin((cycle - 5.6) / 0.45 * Math.PI) : 0;
      body.position.y = hop * 0.09;
      body.scale.set(1 - hop * 0.04, 1 + Math.sin(t * 1.7) * 0.012 + hop * 0.06, 1 - hop * 0.04);
      body.rotation.z = Math.sin(t * 0.8) * 0.025;
      body.rotation.y = Math.sin(t * 0.45) * 0.12;
    }
  };
}

// ── bookshelf menu ───────────────────────────────────────────────────────
// Board tops under each of the six stickers (left, right per row, top row first), in model units.
const SHELF_BOARDS = [[2.52, 2.6], [1.5, 1.42], [0.42, 0.5]];
const SHELF_HEIGHT = 4.41;

// the empties decorateShelf() hangs the stickers, their labels and the speech bubble on
function shelfFrame() {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) {
    const col = i % 2, top = SHELF_BOARDS[Math.floor(i / 2)][col], x = (col ? 1 : -1) * 0.66;
    g.add(empty(`slot_${i + 1}`, x, top + 0.52, 0.47, 0.9));
    g.add(empty(`label_${i + 1}`, x, top + 0.14, 0.48, 0.9));
  }
  g.add(empty('bubble_anchor', -0.9, SHELF_HEIGHT + 0.6, 0));
  return g;
}

export async function skyShelf() {
  const [geo, tex] = await Promise.all([geometry('CharSkyKid_Prop_AP10Bookshelf_01'), ramp('CharRampS10')]);
  const g = shelfFrame();
  g.add(toonMesh(geo, toon('#ffffff', { noCache: true, map: tex, side: THREE.DoubleSide })), blobShadow(4.4, 2.2, 0.3));
  return { object: g, height: SHELF_HEIGHT };
}

// The shelf is also the site's menu: if its file fails to load, the stickers still hang where its boards would be.
export function skyShelfFrame() {
  return { object: shelfFrame(), height: SHELF_HEIGHT };
}

// ── ground: grassy mounds and pebbles ────────────────────────────────────
// The game has no grass model (its engine grows the blades), so the blades stay ours; the lawn's low mounds are
// the game's soil patch and the pebbles its small rock cluster. `avoid` = ellipses {x, z, rx, rz} to keep clear.
// heightAt(x, z) tells the grass and flowers how far a mound lifts the ground there.
const PEBBLE_TINTS = ['#f7c6c7', '#bfe0f2', '#fbe3a1', '#d9cdf5', '#f5f1e8'];

export async function skyGround(radius, avoid = []) {
  const [mound, rocks] = await Promise.all([geometry('SoilPatch'), geometry('SkyRockCluster')]);
  const rand = rng(52), g = new THREE.Group();
  const clear = (x, z, pad) => !avoid.some(o => (x - o.x) ** 2 / (o.rx + pad) ** 2 + (z - o.z) ** 2 / (o.rz + pad) ** 2 < 1);
  const spots = (count, pad, reach) => {
    const out = [];
    for (let guard = 0; out.length < count && guard < count * 40; guard++) {
      const r = Math.sqrt(rand()) * reach, a = rand() * Math.PI * 2, x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (clear(x, z, pad) && !out.some(s => Math.hypot(s[0] - x, s[1] - z) < pad * 2.2)) out.push([x, z]);
    }
    return out;
  };
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), c = new THREE.Color();

  // the patch is a lens 1 unit in radius and 0.22 high
  const MOUND_R = 1.35, MOUND_Y = 0.85, SINK = 0.012, PATCH_H = 0.22;
  const moundSpots = spots(8, MOUND_R, radius - MOUND_R - 0.25), edge = new THREE.Color('#a9d277'), hills = [];
  const mounds = new THREE.InstancedMesh(mound, toon('#ffffff'), moundSpots.length);
  moundSpots.forEach(([x, z], i) => {
    const k = MOUND_R * (0.7 + rand() * 0.3), kz = k * (0.8 + rand() * 0.2), turn = rand() * Math.PI * 2;
    m.compose(v.set(x, -SINK, z), q.setFromAxisAngle(up, turn), s.set(k, MOUND_Y, kz));
    mounds.setMatrixAt(i, m);
    hills.push({ x, z, cos: Math.cos(turn), sin: Math.sin(turn), k, kz });
    // the lawn's own green out here (terrain.js), so a mound reads as a soft rise rather than a patch
    mounds.setColorAt(i, c.copy(edge).multiplyScalar(0.97 + rand() * 0.04));
  });
  mounds.raycast = () => {};
  g.add(mounds);

  const rockSpots = spots(11, 0.35, radius - 0.5);
  const pebbles = new THREE.InstancedMesh(rocks, toon('#ffffff'), rockSpots.length);
  rockSpots.forEach(([x, z], i) => {
    const k = 0.55 + rand() * 0.45;
    m.compose(v.set(x, 0.005, z), q.setFromAxisAngle(up, rand() * Math.PI * 2), s.set(k, k * 1.5, k));
    pebbles.setMatrixAt(i, m);
    pebbles.setColorAt(i, c.set(PEBBLE_TINTS[Math.floor(rand() * PEBBLE_TINTS.length)]));
  });
  pebbles.raycast = () => {};
  g.add(pebbles);

  function heightAt(x, z) {
    let h = 0;
    for (const hill of hills) {
      const dx = x - hill.x, dz = z - hill.z;
      const lx = (dx * hill.cos - dz * hill.sin) / hill.k, lz = (dx * hill.sin + dz * hill.cos) / hill.kz, d2 = lx * lx + lz * lz;
      if (d2 < 1) h = Math.max(h, PATCH_H * MOUND_Y * (1 - d2) - SINK);
    }
    return h;
  }
  return { object: g, heightAt };
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

// ── butterflies ──────────────────────────────────────────────────────────
// The game's butterfly is one rigid mesh (wings along ±X, head toward -Z). Split it at the body so each wing
// can flap on its own hinge.
export async function skyButterflies(n) {
  const src = (await geometry('ButterflyA')).toNonIndexed();
  const p = src.attributes.position, parts = { left: [], right: [], body: [] };
  for (let i = 0; i < p.count; i += 3) {
    const xs = [p.getX(i), p.getX(i + 1), p.getX(i + 2)];
    const side = Math.max(...xs.map(Math.abs)) < 0.09 ? 'body' : xs[0] + xs[1] + xs[2] < 0 ? 'left' : 'right';
    for (let k = i; k < i + 3; k++) parts[side].push(p.getX(k), p.getY(k), p.getZ(k));
  }
  const pale = new THREE.Color('#fffbe6'), warm = new THREE.Color('#ffb648'), dark = new THREE.Color('#5a4636');
  const make = (list, isBody) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(list, 3));
    return paint(geo, (pos, _uvY, c) => (isBody ? c.copy(dark) : c.copy(pale).lerp(warm, Math.min(1, Math.abs(pos.x) / 0.95) ** 1.4)));
  };
  const geos = { left: make(parts.left), right: make(parts.right), body: make(parts.body, true) };
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });   // they glow in game: unlit

  const g = new THREE.Group(), flies = [];
  for (let i = 0; i < n; i++) {
    const fly = new THREE.Group(), model = new THREE.Group();
    model.scale.setScalar(0.27);
    model.rotation.y = Math.PI;   // flight code moves along +Z
    const wings = ['left', 'right'].map(side => { const w = new THREE.Mesh(geos[side], material); w.raycast = () => {}; model.add(w); return w; });
    const body = new THREE.Mesh(geos.body, material);
    body.raycast = () => {};
    model.add(body);
    fly.add(model);
    g.add(fly);
    flies.push({ fly, wings, seed: i * 2.3, center: [-0.5 + i * 1.6, 1.8 + i * 0.5, 0.6 - i * 0.8] });
  }
  return {
    object: g,
    update(t) {
      for (const f of flies) {
        const k = t * 0.35 + f.seed;
        f.fly.position.set(f.center[0] + Math.sin(k) * 1.6, f.center[1] + Math.sin(k * 2.3) * 0.35, f.center[2] + Math.cos(k * 1.3) * 1.1);
        f.fly.rotation.y = Math.atan2(Math.cos(k), -Math.sin(k * 1.3));
        const flap = 0.3 + Math.sin(t * 15 + f.seed) * 0.8;
        f.wings[0].rotation.z = -flap; f.wings[1].rotation.z = flap;
      }
    }
  };
}
