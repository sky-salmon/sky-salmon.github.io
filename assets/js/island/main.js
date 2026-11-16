// Floating-island home: scene assembly, render loop and scroll-driven camera.
// Drawn in the game's own manner (soft light, a sky and a cloud sea, motes of light), not the height page's ink.
import * as THREE from 'three';
import { setLook } from './toon.js';
import { makeIsland, makeGrass, makeFlowers, windUniforms, ISLAND_RADIUS } from './terrain.js';
import { makeFlame, decorateShelf, makeBook, makeStarMarker, makeRocks } from './models.js';
import { SKY, makeSkyDome, makeCloudSea, makeMotes, cloudUniforms, moteUniforms } from './atmos.js';
import { loadToonModel, wrapGltf, findNodes, modelStatus } from './gltf.js';
import { skyKid, skyBench, skyCandles, skyFox, skyShelf, skyShelfFrame, skyButterflies, skyGround } from './sky.js';
import { savedLook, KEY_LOOK, KEY_INPUT } from '../saved-look.js';
import { smoothstep, clamp01 } from './util.js';
import { createPacer, antialias, setStyle } from './pace.js';

// canvas-drawn labels need the webfonts first (don't wait forever if they're blocked)
if (document.fonts) {
  await Promise.race([
    Promise.all([
      document.fonts.load('400 58px "NaniFont"', '名片產生器衣櫃圖鑑身高計算活動雷達樂譜練習光影相簿')
    ]).catch(() => {}),
    new Promise(r => setTimeout(r, 2500))
  ]);
}

setLook('soft');
const canvas = document.getElementById('scene');
const isSmall = () => window.innerWidth / window.innerHeight < 0.8;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: antialias(), powerPreference: 'high-performance' });
} catch (e) {
  document.body.classList.add('no-webgl');
  throw e;
}
const pacer = createPacer(renderer, { reducedMotion, onPixelRatio: () => resize() });
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.2, 700);
scene.fog = new THREE.Fog(SKY.horizon, SKY.fogNear, SKY.fogFar);

// daylight: a warm sun, cool sky light from above, a little green bounced up from the lawn
scene.add(new THREE.HemisphereLight('#eef3ff', '#c9d8a2', 1.45));
const sunLight = new THREE.DirectionalLight('#fff0d6', 2.3);
sunLight.position.set(-6, 10, 7);
scene.add(sunLight);
const fill = new THREE.DirectionalLight('#d6e4ff', 0.6);
fill.position.set(8, 4, -6);
scene.add(fill);

// the sky, the cloud sea far below and the motes are cheap and show at once; the models load into them
const dome = makeSkyDome();
scene.add(dome.object, makeCloudSea({ small: isSmall(), islandRadius: ISLAND_RADIUS }).object);

// ── assemble the island ─────────────────────────────────────────────────
const world = new THREE.Group();
scene.add(world);

// The island, book and floating rocks have no game model: an authored assets/models/<name>.glb, else the
// procedural one in terrain.js / models.js.
async function modelOr(name, fallback, autoplay = ['idle']) {
  const gltf = await loadToonModel(name);
  if (!gltf) return fallback();
  const wrapped = wrapGltf(gltf, autoplay);
  wrapped.isGlb = true;
  return wrapped;
}
// Everything else is the game's own model (sky.js); one whose file fails to load is left out.
async function game(name, make) {
  try {
    const model = await make();
    modelStatus[name] = 'game';
    return model;
  } catch (err) {
    console.warn(`[models] game ${name} failed to load, left out`, err);
    modelStatus[name] = 'missing';
    return null;
  }
}
const [islandGltf, benchM, candleM, foxM, shelfM, fliesM, bookM, rocksGltf] = await Promise.all([
  loadToonModel('island'),
  game('bench', skyBench),
  game('candle', skyCandles),
  game('fox', skyFox),
  game('shelf', skyShelf),
  game('butterflies', () => skyButterflies(3)),
  modelOr('book', makeBook, []),
  loadToonModel('rocks')
]);
world.add(islandGltf ? islandGltf.scene : makeIsland());

const LAYOUT = {
  character: { x: -2.05, z: 0.85, ry: 0.4 },
  bench: { x: 0.65, z: 0.05, ry: -0.06 },
  shelf: { x: 3.35, z: -1.75, ry: -0.42 },
  book: { x: 0.35, z: 2.05, ry: 0.22 }
};

const avoid = [
  { x: LAYOUT.book.x, z: LAYOUT.book.z, rx: 0.85, rz: 0.7 },
  { x: LAYOUT.shelf.x, z: LAYOUT.shelf.z, rx: 1.5, rz: 0.6 },
  { x: LAYOUT.character.x, z: LAYOUT.character.z, rx: 0.4, rz: 0.4 }
];
const groundM = await game('ground', () => skyGround(ISLAND_RADIUS, [...avoid, { x: LAYOUT.bench.x, z: LAYOUT.bench.z, rx: 1.7, rz: 0.8 }]));
if (groundM) world.add(groundM.object);
const heightAt = groundM ? groundM.heightAt : undefined;
world.add(makeGrass(isSmall() ? 1500 : 2400, avoid, heightAt));
world.add(makeFlowers(70, avoid, heightAt));

const animated = [];
function place(model, { x = 0, y = 0, z = 0, ry = 0, s = 1 } = {}) {
  model.object.position.set(x, y, z);
  model.object.rotation.y = ry;
  model.object.scale.setScalar(s);
  world.add(model.object);
  if (model.update) animated.push(model);
  return model;
}

// The kid is the heaviest thing here (the avatar engine, its index, a skeleton and ten outfit pieces), so the
// island shows first and the kid steps in when ready. It wears what the visitor last scanned on the height page
// (kept in this browser), else the game's starting outfit.
(async () => {
  let kid;
  try {
    let worn = JSON.stringify(savedLook());
    kid = await skyKid(JSON.parse(worn));
    modelStatus.character = 'game';
    place(kid, { ...LAYOUT.character, s: 0.001 });
    const born = elapsed, base = kid.update;
    kid.update = (t, dt) => {
      const k = reducedMotion ? 1 : clamp01((t - born) / 0.45);
      kid.object.scale.setScalar(Math.max(0.001, 1 - (1 - k) ** 3));
      base(t, dt);
    };
    // a QR scanned in another tab, or a return here through the back button, re-dresses the kid
    const refresh = () => {
      const now = JSON.stringify(savedLook());
      if (now === worn) return;
      worn = now;
      kid.wear(JSON.parse(now)).catch(err => console.warn('[models] kid could not be re-dressed', err));
    };
    addEventListener('pageshow', e => { if (e.persisted) refresh(); });
    addEventListener('storage', e => { if (e.key === null || e.key === KEY_LOOK || e.key === KEY_INPUT) refresh(); });
  } catch (err) {
    console.warn('[models] game character failed to load, left out', err);
    modelStatus.character = 'missing';
  }
})();

if (benchM) place(benchM, LAYOUT.bench);

// The game bench's seat is uneven: rest things on it by casting down onto the stone (the grass without it).
const dropRay = new THREE.Raycaster(), dropFrom = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0);
world.updateMatrixWorld(true);
function seatAt(x, z) {
  if (!benchM) return 0;
  dropRay.set(dropFrom.set(x, 6, z), DOWN);
  const hit = dropRay.intersectObject(benchM.object, true)[0];
  return hit ? hit.point.y : 0;
}

if (candleM) {
  const CANDLE_AT = { x: LAYOUT.bench.x - 0.5, z: -0.02 };
  place(candleM, CANDLE_AT);
  for (const candle of candleM.object.children) {
    if (candle.userData.settle) candle.position.y = seatAt(CANDLE_AT.x + candle.position.x, CANDLE_AT.z + candle.position.z) - 0.008;
  }
  findNodes(candleM.object, 'flame_anchor').forEach((anchor, i) => {   // one candle carries the light and the sparks
    const flame = makeFlame({ light: i === 0, sparks: i === 0, glow: i === 0, phase: i * 1.7 });
    flame.object.scale.setScalar(anchor.userData.size || 1);
    anchor.add(flame.object);
    animated.push(flame);
  });
}

if (foxM) {
  const FOX_AT = { x: LAYOUT.bench.x + 0.62, z: 0.06 };
  place(foxM, { ...FOX_AT, y: seatAt(FOX_AT.x, FOX_AT.z) - 0.01, ry: -0.5 });
}

const shelfModel = shelfM || skyShelfFrame();
place(shelfModel, LAYOUT.shelf);
const shelfDeco = decorateShelf(shelfModel.object);
const shelf = { object: shelfModel.object, icons: shelfDeco.icons, bubbleNode: shelfDeco.bubbleNode, height: shelfModel.height };

if (bookM.isGlb) {   // authored book: scrub its `open` clip and float a sparkle above it
  const open = bookM.actions.open, star = makeStarMarker(), base = bookM.update;
  if (open) { open.play(); open.paused = true; }
  bookM.object.add(star);
  let amount = 0;
  bookM.setOpen = v => { amount = v; if (open) open.time = v * open.getClip().duration; };
  bookM.update = (t, dt) => {
    star.position.set(0, 0.75 + Math.sin(t * 2) * 0.08 + amount * 0.6, 0);
    star.scale.setScalar(Math.max(0.001, 1 - amount));
    star.userData.twinkle(t);
    base(t, dt);
  };
}
place(bookM, LAYOUT.book);

const ROCK_SPOTS = [[1.75, 2.6, -1.3, 0.16], [1.35, 1.95, -0.9, 0.11], [5.4, 3.1, -2.6, 0.13], [-4.6, 1.6, -1.8, 0.12]];
place(makeRocks(ROCK_SPOTS, rocksGltf ? findNodes(rocksGltf.scene, 'rock_') : null));
window.__models = modelStatus;
world.add(makeMotes(isSmall() ? 45 : 70, ISLAND_RADIUS + 2).object);
if (fliesM) place(fliesM);

// ── camera keyframes ────────────────────────────────────────────────────
const shelfCenter = new THREE.Vector3(LAYOUT.shelf.x, shelf.height * 0.55, LAYOUT.shelf.z);
const shelfNormal = new THREE.Vector3(Math.sin(LAYOUT.shelf.ry), 0, Math.cos(LAYOUT.shelf.ry));
const shelfRight = new THREE.Vector3(Math.cos(LAYOUT.shelf.ry), 0, -Math.sin(LAYOUT.shelf.ry));
const bookPos = new THREE.Vector3(LAYOUT.book.x, 0, LAYOUT.book.z);

let keyframes = function () {
  const small = isSmall(), back = shelf.height / 3.86;   // the shelf stop was framed for a 3.86-tall shelf
  return [
    small
      ? { pos: new THREE.Vector3(6.2, 9.2, 24.5), tgt: new THREE.Vector3(1.1, 0.6, 0) }
      : { pos: new THREE.Vector3(8.6, 6.6, 20.8), tgt: new THREE.Vector3(-2.3, 0.0, 0.4) },
    { pos: shelfCenter.clone().addScaledVector(shelfNormal, (small ? 9.2 : 7.4) * back).addScaledVector(shelfRight, small ? 1.6 : 0).add(new THREE.Vector3(0, small ? 1.6 : 0.35, 0)), tgt: shelfCenter.clone().add(new THREE.Vector3(0, 0.2, 0)) },
    { pos: new THREE.Vector3(0.6, small ? 15 : 11, 2.9), tgt: new THREE.Vector3(0.6, 0, 1.3) },
    { pos: bookPos.clone().add(new THREE.Vector3(0.05, small ? 7 : 5.4, 0.45)), tgt: bookPos.clone() }
  ];
}
// ?cam=px,py,pz,tx,ty,tz pins the camera (handy for inspecting a single model)
const camOverride = new URLSearchParams(location.search).get('cam');
if (camOverride) {
  const [px, py, pz, tx, ty, tz] = camOverride.split(',').map(Number);
  const pinned = { pos: new THREE.Vector3(px, py, pz), tgt: new THREE.Vector3(tx, ty, tz) };
  keyframes = () => [pinned, pinned, pinned, pinned];
}
let KEYS = keyframes();

// scroll progress -> keyframe index, with holds at each stop
const STOPS = [[0, 0], [0.1, 0], [0.32, 1], [0.44, 1], [0.66, 2], [0.72, 2], [0.92, 3], [1, 3]];
function progressToK(p) {
  for (let i = 1; i < STOPS.length; i++) {
    const [p0, k0] = STOPS[i - 1], [p1, k1] = STOPS[i];
    if (p <= p1) return k0 + (k1 - k0) * smoothstep(p0, p1, p);
  }
  return 3;
}
function cameraAt(k, outPos, outTgt) {
  const i = Math.min(KEYS.length - 2, Math.floor(k)), f = k - i;
  outPos.lerpVectors(KEYS[i].pos, KEYS[i + 1].pos, f);
  outTgt.lerpVectors(KEYS[i].tgt, KEYS[i + 1].tgt, f);
}

const camPos = new THREE.Vector3(), camTgt = new THREE.Vector3();
const wantPos = new THREE.Vector3(), wantTgt = new THREE.Vector3();
let scrollP = 0, k = 0;
const pointer = { x: 0, y: 0, sx: 0, sy: 0 };

function readScroll() {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  scrollP = max > 0 ? clamp01(window.scrollY / max) : 0;
}
window.addEventListener('scroll', readScroll, { passive: true });

// ── overlays ────────────────────────────────────────────────────────────
const el = id => document.getElementById(id);
const hero = el('hero'), bubble = el('bubble'), hint = el('shelf-hint'), folio = el('folio'), backBtn = el('back');
const topbar = document.querySelector('.topbar');
const anchorWorld = new THREE.Vector3(), anchorNdc = new THREE.Vector3();

function updateOverlays() {
  const heroO = 1 - smoothstep(0.05, 0.45, k);
  setStyle(hero, 'opacity', heroO.toFixed(3));
  setStyle(hero, 'transform', `translateY(${((1 - heroO) * -30).toFixed(1)}px)`);
  setStyle(hero, 'visibility', heroO < 0.01 ? 'hidden' : 'visible');

  const hintO = 1 - smoothstep(0.12, 0.3, Math.abs(k - 1));
  setStyle(hint, 'opacity', hintO.toFixed(3));
  setStyle(hint, 'visibility', hintO < 0.01 ? 'hidden' : 'visible');

  const folioO = smoothstep(2.55, 2.95, k);
  setStyle(folio, 'opacity', folioO.toFixed(3));
  setStyle(folio, 'transform', `translate(-50%, -50%) scale(${(0.94 + folioO * 0.06).toFixed(4)})`);
  folio.classList.toggle('is-open', folioO > 0.6);

  backBtn.classList.toggle('is-visible', k > 0.25);
  topbar.classList.toggle('is-scrolled', k > 0.2);
  bookM.setOpen(smoothstep(2.35, 2.85, k));

  // speech bubble follows the shelf crown
  shelf.bubbleNode.getWorldPosition(anchorWorld);
  anchorNdc.copy(anchorWorld).project(camera);
  const bubbleO = 1 - smoothstep(0.4, 0.85, k);
  if (anchorNdc.z < 1 && bubbleO > 0.01) {
    setStyle(bubble, 'visibility', 'visible');
    setStyle(bubble, 'opacity', bubbleO.toFixed(3));
    setStyle(bubble, 'transform', `translate(${((anchorNdc.x * 0.5 + 0.5) * window.innerWidth).toFixed(1)}px, ${((-anchorNdc.y * 0.5 + 0.5) * window.innerHeight).toFixed(1)}px) translate(-50%, -100%)`);
  } else {
    setStyle(bubble, 'visibility', 'hidden');
  }
}

// ── shelf interaction ───────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let hovered = null;
canvas.addEventListener('pointermove', e => {
  pointer.x = e.clientX / window.innerWidth - 0.5;
  pointer.y = e.clientY / window.innerHeight - 0.5;
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(shelf.icons, false)[0];
  hovered = hit ? hit.object : null;
  canvas.style.cursor = hovered ? 'pointer' : '';
});
canvas.addEventListener('click', e => {
  ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObjects(shelf.icons, false)[0];
  if (!hit) return;
  const { href, label } = hit.object.userData.item;
  if (href === '#about') scrollToProgress(1);
  else if (href === '#') toast(`「${label}」即將推出`);
  else window.location.href = href;
});

function scrollToProgress(p) {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo({ top: max * p, behavior: reducedMotion ? 'auto' : 'smooth' });
}
document.querySelectorAll('[data-goto]').forEach(a => a.addEventListener('click', e => {
  e.preventDefault();
  scrollToProgress(Number(a.dataset.goto));
}));

let toastTimer = 0;
function toast(msg) {
  const t = el('toast');
  t.textContent = msg;
  t.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-visible'), 2200);
}

// local time pill
function tickClock() {
  const now = new Date();
  el('clock-time').textContent = now.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hour12: false });
  el('clock-date').textContent = now.toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
}
tickClock();
setInterval(tickClock, 15000);

// ── resize & loop ───────────────────────────────────────────────────────
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = isSmall() ? 40 : 30;
  camera.updateProjectionMatrix();
  // a mote's size in pixels = world size × this ÷ distance
  moteUniforms.uScale.value = h * renderer.getPixelRatio() / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  KEYS = keyframes();
}
window.addEventListener('resize', resize);
resize();
readScroll();
k = progressToK(scrollP);
cameraAt(k, camPos, camTgt);

let elapsed = 0;
function frame(now) {
  requestAnimationFrame(frame);
  // full rate while the camera, the pointer or a hovered sticker is still easing; ~30 fps for the idle ambience
  const targetK = progressToK(scrollP);
  const active = Math.abs(targetK - k) > 1e-4 || Math.abs(pointer.x - pointer.sx) > 1e-3 || Math.abs(pointer.y - pointer.sy) > 1e-3
    || camPos.distanceToSquared(wantPos) > 1e-6 || camTgt.distanceToSquared(wantTgt) > 1e-6
    || shelf.icons.some(icon => Math.abs(icon.scale.x - (icon === hovered ? 1.12 : 1)) > 1e-3);
  const dt = pacer.tick(now, active);
  if (!dt) return;
  elapsed += reducedMotion ? 0 : dt;
  windUniforms.uTime.value = cloudUniforms.uTime.value = moteUniforms.uTime.value = elapsed;

  // ease scroll progress and pointer for a soft, weighty camera
  k += (targetK - k) * (1 - Math.exp(-dt * 5));
  pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt * 3));
  pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt * 3));

  cameraAt(k, wantPos, wantTgt);
  const parallax = 1 - smoothstep(0, 1, k) * 0.7;
  wantPos.x += pointer.sx * 1.2 * parallax;
  wantPos.y += -pointer.sy * 0.6 * parallax;
  camPos.lerp(wantPos, 1 - Math.exp(-dt * 6));
  camTgt.lerp(wantTgt, 1 - Math.exp(-dt * 6));
  camera.position.copy(camPos);
  camera.lookAt(camTgt);
  dome.follow(camera);

  const modelDt = reducedMotion ? 0 : dt;
  for (const m of animated) m.update(elapsed, modelDt);
  for (const icon of shelf.icons) {
    const want = icon === hovered ? 1.12 : 1;
    icon.scale.setScalar(icon.scale.x + (want - icon.scale.x) * (1 - Math.exp(-dt * 12)));
  }

  updateOverlays();
  renderer.render(scene, camera);
  window.__island = { ready: true, k, scrollP, pixelRatio: pacer.pixelRatio };
}
requestAnimationFrame(frame);
document.body.classList.add('is-ready');
