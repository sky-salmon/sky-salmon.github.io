// Floating-island home: scene assembly, render loop and scroll-driven camera.
import * as THREE from 'three';
import { outlineUniforms } from './toon.js';
import { makeIsland, makeGrass, makeFlowers, makePebbles, windUniforms } from './terrain.js';
import { makeCharacter, makeBench, makeCandle, makeFlame, makeBird, makeShelf, decorateShelf, makeBook, makeStarMarker, makeRocks, makeSun, makeButterflies } from './models.js';
import { loadToonModel, wrapGltf, findNodes, modelStatus } from './gltf.js';
import { smoothstep, clamp01 } from './util.js';

// canvas-drawn labels need the webfonts first (don't wait forever if they're blocked)
if (document.fonts) {
  await Promise.race([
    Promise.all([
      document.fonts.load('400 58px "NaniFont"', '名片產生器身高計算樂譜練習活動倒數光影相簿關於這裡'),
      document.fonts.load('600 26px "Caveat"', 'Toolbox')
    ]).catch(() => {}),
    new Promise(r => setTimeout(r, 2500))
  ]);
}

const canvas = document.getElementById('scene');
const isSmall = () => window.innerWidth / window.innerHeight < 0.8;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
} catch (e) {
  document.body.classList.add('no-webgl');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);

// lighting: bright, warm, low contrast — the toon ramp does the stylisation
scene.add(new THREE.HemisphereLight('#fff8ec', '#b9cf9a', 1.5));
const sunLight = new THREE.DirectionalLight('#fff0d6', 2.4);
sunLight.position.set(-6, 10, 7);
scene.add(sunLight);
const fill = new THREE.DirectionalLight('#dfe9ff', 0.6);
fill.position.set(8, 4, -6);
scene.add(fill);

// ── assemble the island ─────────────────────────────────────────────────
const world = new THREE.Group();
scene.add(world);

// Authored models live in assets/models/<name>.glb; anything missing falls back to the
// procedural placeholder in models.js / terrain.js.
async function modelOr(name, fallback, autoplay = ['idle']) {
  const gltf = await loadToonModel(name);
  if (!gltf) return fallback();
  const wrapped = wrapGltf(gltf, autoplay);
  wrapped.isGlb = true;
  return wrapped;
}
const [islandGltf, characterM, benchM, candleM, birdM, shelfM, bookM, rocksGltf] = await Promise.all([
  loadToonModel('island'),
  modelOr('character', makeCharacter),
  modelOr('bench', makeBench),
  modelOr('candle', makeCandle),
  modelOr('bird', makeBird),
  modelOr('shelf', makeShelf),
  modelOr('book', makeBook, []),
  loadToonModel('rocks')
]);
world.add(islandGltf ? islandGltf.scene : makeIsland());

const LAYOUT = {
  character: { x: -2.05, z: 0.85, ry: 0.4, s: 1.32 },
  bench: { x: 0.65, z: 0.05, ry: -0.06 },
  shelf: { x: 3.35, z: -1.75, ry: -0.42 },
  book: { x: 0.35, z: 2.05, ry: 0.22 }
};

const avoid = [
  { x: LAYOUT.book.x, z: LAYOUT.book.z, rx: 0.85, rz: 0.7 },
  { x: LAYOUT.shelf.x, z: LAYOUT.shelf.z, rx: 1.5, rz: 0.6 },
  { x: LAYOUT.character.x, z: LAYOUT.character.z, rx: 0.4, rz: 0.4 }
];
world.add(makeGrass(isSmall() ? 1500 : 2400, avoid));
world.add(makeFlowers(70, avoid));
world.add(makePebbles(46));

const animated = [];
function place(model, { x = 0, y = 0, z = 0, ry = 0, s = 1 } = {}) {
  model.object.position.set(x, y, z);
  model.object.rotation.y = ry;
  model.object.scale.setScalar(s);
  world.add(model.object);
  if (model.update) animated.push(model);
  return model;
}

const SEAT_Y = 0.82; // bench seat height (authored bench.glb must match)
const findIn = (root, name) => { let n = null; root.traverse(o => { if (o.name === name) n = o; }); return n; };

// placeholders were built smaller than the authored spec, so only they get a scale
place(characterM, { ...LAYOUT.character, s: characterM.isGlb ? 1 : LAYOUT.character.s });
place(benchM, LAYOUT.bench);

place(candleM, { x: LAYOUT.bench.x + 0.35, y: SEAT_Y - 0.01, z: -0.05 });
const flameAnchor = findIn(candleM.object, 'flame_anchor') || candleM.object;
const flame = makeFlame();
flameAnchor.add(flame.object);
animated.push(flame);

if (birdM.isGlb && birdM.actions.hop) {   // authored bird: hop every few seconds on top of idle
  const hop = birdM.actions.hop, base = birdM.update;
  hop.setLoop(THREE.LoopOnce, 1);
  let lastHop = 0;
  birdM.update = (t, dt) => { if (t - lastHop > 5.5) { lastHop = t; hop.reset().play(); } base(t, dt); };
}
place(birdM, { x: LAYOUT.bench.x + 1.05, y: SEAT_Y - 0.01, z: 0.08, ry: -0.55, s: birdM.isGlb ? 1 : 1.25 });

place(shelfM, LAYOUT.shelf);
const shelfDeco = decorateShelf(shelfM.object);
const shelf = { object: shelfM.object, icons: shelfDeco.icons, bubbleNode: shelfDeco.bubbleNode, height: shelfDeco.height };

if (bookM.isGlb) {   // authored book: scrub its `open` clip and float a sparkle above it
  const open = bookM.actions.open, star = makeStarMarker(), base = bookM.update;
  if (open) { open.play(); open.paused = true; }
  bookM.object.add(star);
  let amount = 0;
  bookM.setOpen = v => { amount = v; if (open) open.time = v * open.getClip().duration; };
  bookM.update = (t, dt) => {
    star.position.set(0, 0.75 + Math.sin(t * 2) * 0.08 + amount * 0.6, 0);
    star.scale.setScalar(Math.max(0.001, 1 - amount));
    star.rotation.y = t * 1.2;
    base(t, dt);
  };
}
place(bookM, LAYOUT.book);

const ROCK_SPOTS = [[1.75, 2.6, -1.3, 0.16], [1.35, 1.95, -0.9, 0.11], [5.4, 3.1, -2.6, 0.13], [-4.6, 1.6, -1.8, 0.12]];
place(makeRocks(ROCK_SPOTS, rocksGltf ? findNodes(rocksGltf.scene, 'rock_') : null));
window.__models = modelStatus;
const sun = place(makeSun(), { x: -3.2, y: 4.5, z: -4.0 });
place(makeButterflies(3));

// ── camera keyframes ────────────────────────────────────────────────────
const shelfCenter = new THREE.Vector3(LAYOUT.shelf.x, shelf.height * 0.55, LAYOUT.shelf.z);
const shelfNormal = new THREE.Vector3(Math.sin(LAYOUT.shelf.ry), 0, Math.cos(LAYOUT.shelf.ry));
const shelfRight = new THREE.Vector3(Math.cos(LAYOUT.shelf.ry), 0, -Math.sin(LAYOUT.shelf.ry));
const bookPos = new THREE.Vector3(LAYOUT.book.x, 0, LAYOUT.book.z);

let keyframes = function () {
  const small = isSmall();
  return [
    small
      ? { pos: new THREE.Vector3(6.2, 9.2, 24.5), tgt: new THREE.Vector3(1.1, 0.6, 0) }
      : { pos: new THREE.Vector3(8.6, 6.6, 20.8), tgt: new THREE.Vector3(-2.3, 0.0, 0.4) },
    { pos: shelfCenter.clone().addScaledVector(shelfNormal, small ? 9.2 : 7.4).addScaledVector(shelfRight, small ? 1.6 : 0).add(new THREE.Vector3(0, small ? 1.6 : 0.35, 0)), tgt: shelfCenter.clone().add(new THREE.Vector3(0, 0.2, 0)) },
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
  hero.style.opacity = heroO;
  hero.style.transform = `translateY(${(1 - heroO) * -30}px)`;
  hero.style.visibility = heroO < 0.01 ? 'hidden' : 'visible';

  const hintO = 1 - smoothstep(0.12, 0.3, Math.abs(k - 1));
  hint.style.opacity = hintO;
  hint.style.visibility = hintO < 0.01 ? 'hidden' : 'visible';

  const folioO = smoothstep(2.55, 2.95, k);
  folio.style.opacity = folioO;
  folio.style.transform = `translate(-50%, -50%) scale(${0.94 + folioO * 0.06})`;
  folio.classList.toggle('is-open', folioO > 0.6);

  backBtn.classList.toggle('is-visible', k > 0.25);
  topbar.classList.toggle('is-scrolled', k > 0.2);
  bookM.setOpen(smoothstep(2.35, 2.85, k));

  // speech bubble follows the shelf crown
  shelf.bubbleNode.getWorldPosition(anchorWorld);
  anchorNdc.copy(anchorWorld).project(camera);
  const bubbleO = 1 - smoothstep(0.4, 0.85, k);
  if (anchorNdc.z < 1 && bubbleO > 0.01) {
    bubble.style.visibility = 'visible';
    bubble.style.opacity = bubbleO;
    bubble.style.transform = `translate(${(anchorNdc.x * 0.5 + 0.5) * window.innerWidth}px, ${(-anchorNdc.y * 0.5 + 0.5) * window.innerHeight}px) translate(-50%, -100%)`;
  } else {
    bubble.style.visibility = 'hidden';
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
  const dpr = renderer.getPixelRatio();
  outlineUniforms.uResolution.value.set(w * dpr, h * dpr);
  outlineUniforms.uThickness.value = (isSmall() ? 1.4 : 1.75) * dpr;
  sun.object.position.x = isSmall() ? -2.4 : -3.2;
  KEYS = keyframes();
}
window.addEventListener('resize', resize);
resize();
readScroll();
k = progressToK(scrollP);
cameraAt(k, camPos, camTgt);

const clock = new THREE.Clock();
let elapsed = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += reducedMotion ? 0 : dt;
  windUniforms.uTime.value = elapsed;

  // ease scroll progress and pointer for a soft, weighty camera
  const targetK = progressToK(scrollP);
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

  for (const m of animated) m.update(elapsed, dt);
  for (const icon of shelf.icons) {
    const want = icon === hovered ? 1.12 : 1;
    icon.scale.setScalar(icon.scale.x + (want - icon.scale.x) * (1 - Math.exp(-dt * 12)));
  }

  updateOverlays();
  renderer.render(scene, camera);
  window.__island = { ready: true, k, scrollP };
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.body.classList.add('is-ready');
