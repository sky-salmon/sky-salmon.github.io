// 身高計算 — 3D stage at dusk, as on the home page: a dark stone turntable in front of a setting sun (the page paints
// the sun behind the canvas, where this module says), lit from behind; the lantern tower, the player's character
// (魚 until a visitor reads their own QR), a measuring stick (ticks drawn as an SVG overlay projected from 3D), a crab
// and candles.
// The props are the game's own models (island/sky.js: the lantern post, the crab, the candles, the pebbles); one that
// fails to load is simply left out. The player's kid arrives through setKid.
import * as THREE from 'three';
import { part, toon, addOutline, outlineUniforms } from './island/toon.js';
import { findNodes } from './island/gltf.js';
import { makeFlame } from './island/models.js';
import { skyLantern, skyCrab, skyCandles, skyRocks } from './island/sky.js';
import { createPacer, antialias, setAttr, setStyle } from './island/pace.js';
import { canvasTexture, rng } from './island/util.js';

const BASE_H = 2.2;                       // authored character height (units)
const SCALE_TALL = 1.18, SCALE_SHORT = 0.82;
// the real Sky kid (setKid): sized so the default kid's head top (15.56 game units) stands BASE_H tall.
// Head top vs the height value, measured on the kid (h −2 / 0 / +2 → 12.87 / 15.56 / 17.74): the tallest / shortest
// band is the kid's current head top carried to h = ±2 with this curve, so it fits any stance and body scale.
const KID_UNITS = 15.557;
const kidGrow = h => (h >= 0 ? 1 + 0.0701 * h : 1 + 0.0865 * h);
const RULER_H = 3.0;                      // stick is graduated 0 … 3 units
const FOV = 28;
const ELEV = THREE.MathUtils.degToRad(8); // camera: front view, slightly above
const DISC_R = 3.9, DISC_X = 0.3, DISC_Z = 0.25;

const LAYOUTS = {
  // [x, z, rotationY]; wide = the whole disc in view, narrow (phones) = frame the trio and let the disc bleed
  wide: { character: [-1.05, 0.35, 0.2], ruler: [0.3, 0.2], pillar: [1.72, -0.3, -0.32], critter: [-2.7, 1.3, 0.55], candle: [2.95, 1.05] },
  narrow: { character: [-1.0, 0.35, 0.2], ruler: [0.3, 0.2], pillar: [1.72, -0.3, -0.32], critter: [-1.95, 1.95, 0.5], candle: [2.5, 1.6] }
};

const mix = (a, b, t) => a + (b - a) * t;
const fmt = v => (Math.abs(v) < 0.005 ? 0 : v).toFixed(2).replace('-', '−');

// ── shared bits ─────────────────────────────────────────────────────────
let shadowTex = null;
function softShadow(w, d, opacity = 0.26) {
  shadowTex ||= canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(96,70,44,1)');
    g.addColorStop(0.5, 'rgba(96,70,44,0.5)');
    g.addColorStop(1, 'rgba(96,70,44,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.006;
  m.renderOrder = 1;
  return m;
}

let glowTex = null;
function glowSprite(scale, opacity = 0.8) {
  glowTex ||= canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,232,170,1)');
    g.addColorStop(0.3, 'rgba(255,205,120,0.5)');
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity }));
  sp.scale.setScalar(scale);
  return sp;
}

// ── stage disc: a dark stone turntable with a faint dial printed on top ──
function makeStageDisc() {
  const g = new THREE.Group();
  const dial = canvasTexture(1024, (ctx, s) => {
    const c = s / 2, R = s / 2;
    const bg = ctx.createRadialGradient(c, c, 0, c, c, R);
    bg.addColorStop(0, '#8a7a5c'); bg.addColorStop(0.75, '#76684d'); bg.addColorStop(1, '#665a43');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(255,236,200,0.22)';
    ctx.lineCap = 'round';
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2, long = i % 15 === 0, mid = i % 5 === 0;
      const r0 = R * (long ? 0.885 : mid ? 0.91 : 0.93), r1 = R * 0.955;
      ctx.lineWidth = long ? 3 : 1.6;
      ctx.beginPath(); ctx.moveTo(c + Math.cos(a) * r0, c + Math.sin(a) * r0); ctx.lineTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); ctx.stroke();
    }
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(c, c, R * 0.968, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([4, 14]);
    ctx.strokeStyle = 'rgba(255,236,200,0.13)';
    for (const f of [0.36, 0.64]) { ctx.beginPath(); ctx.arc(c, c, R * f, 0, Math.PI * 2); ctx.stroke(); }
    ctx.setLineDash([]);
  });
  const geo = new THREE.CylinderGeometry(DISC_R, DISC_R, 0.2, 128, 1);
  const disc = new THREE.Mesh(geo, [toon('#5e5340'), toon('#ffffff', { map: dial, noCache: true }), toon('#4a4132')]);
  disc.position.y = -0.1;
  addOutline(disc);
  g.add(disc);
  const plinth = part(new THREE.CylinderGeometry(DISC_R * 1.035, DISC_R * 1.0, 0.16, 128), '#4f4534');
  plinth.position.y = -0.28;
  g.add(plinth);
  const ground = softShadow(DISC_R * 2.9, DISC_R * 2.5, 0.2);
  ground.position.y = -0.62;
  g.add(ground);
  g.position.set(DISC_X, 0, DISC_Z);
  return g;
}

// a few pebbles near the rim, in disc space: [x, z, size, turn]
const PEBBLES = (() => {
  const rand = rng(11), out = [];
  for (let i = 0; i < 6; i++) {
    const a = -0.5 + i * 1.05 + rand() * 0.3, r = DISC_R * (0.72 + rand() * 0.12), s = 0.06 + rand() * 0.06;
    out.push([Math.cos(a) * r, Math.sin(a) * r * 0.9, s * 3.4, i * 2]);
  }
  return out;
})();

// ── measuring stick ─────────────────────────────────────────────────────
function makeRulerStick() {
  const g = new THREE.Group();
  const stick = part(new THREE.BoxGeometry(0.15, RULER_H + 0.1, 0.05), '#f4e1bb');
  stick.position.y = (RULER_H + 0.1) / 2;
  g.add(stick);
  const plate = part(new THREE.BoxGeometry(0.36, 0.03, 0.24), '#dcc49c');
  plate.position.set(0, 0.015, -0.06);
  g.add(plate);
  const pin = part(new THREE.SphereGeometry(0.062, 14, 10), '#c2622d');
  pin.position.y = RULER_H + 0.16;
  g.add(pin);
  g.add(softShadow(0.6, 0.4, 0.22));
  return g;
}

// ── SVG overlay helpers ─────────────────────────────────────────────────
const SVGNS = 'http://www.w3.org/2000/svg';
function svgEl(name, attrs = {}, parent) {
  const el = document.createElementNS(SVGNS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (parent) parent.append(el);
  return el;
}

// ── mount ───────────────────────────────────────────────────────────────
export async function mountStage({ container, canvas, svg, tag, tagValue, note, kidNote, safeRect, reducedMotion }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: antialias(), alpha: true, powerPreference: 'high-performance' });
  const pacer = createPacer(renderer, { reducedMotion, onPixelRatio: () => resize() });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

  // dusk, with the sun low behind the stage (as on the home page): a soft warm sky from above, a little light from
  // the front so the props and the kid's colours still read, and a strong warm edge from both sides behind
  scene.add(new THREE.HemisphereLight('#e6d2b0', '#3a3122', 0.95));
  const key = new THREE.DirectionalLight('#ffe2c2', 1.05);
  key.position.set(-5, 7, 8);
  scene.add(key);
  const rimR = new THREE.DirectionalLight('#ffa860', 3.6);
  rimR.position.set(5.5, 4.5, -6.5);
  scene.add(rimR);
  const rimL = new THREE.DirectionalLight('#ffc27a', 2.6);
  rimL.position.set(-6, 5, -6);
  scene.add(rimL);

  const disc = makeStageDisc();
  scene.add(disc);

  // the game's props (island/sky.js); one that fails to load is left out
  const status = {};
  window.__heightModels = status;
  const game = (name, make) => make()
    .then(m => { status[name] = 'game'; return m; })
    .catch(err => { console.warn(`[height] game ${name} failed to load, left out`, err); status[name] = 'missing'; return null; });
  const [pillarM, critterM, candleM, pebblesM] = await Promise.all([
    game('pillar', skyLantern),
    game('critter', skyCrab),
    game('candle', skyCandles),
    game('pebbles', () => skyRocks(PEBBLES, ['#5c5140', '#6a5e49']))   // the cluster is flat: a shade off the disc
  ]);
  if (pebblesM) disc.add(pebblesM.object);
  const animated = critterM ? [critterM] : [];

  // the player's kid stands here once setKid hands it over; until then the band and leader assume BASE_H
  const charRoot = new THREE.Group();
  scene.add(charRoot);
  const charH = BASE_H;
  const charShadow = softShadow(1.25, 0.85, 0.34);
  scene.add(charShadow);

  // lantern post + the light in its cage
  const pillarRoot = new THREE.Group();
  scene.add(pillarRoot);
  let lanternLight = null, lanternGlow = null;
  if (pillarM) {
    const lantern = new THREE.Group();
    lantern.position.copy(pillarM.lightAnchor);
    lanternGlow = glowSprite(1.6, 0.375);   // the cage is closed: a small, soft halo keeps the stone from washing out
    lanternLight = new THREE.PointLight('#ffc469', 2.6, 5.5, 1.4);
    lantern.add(lanternGlow, lanternLight);
    pillarRoot.add(pillarM.object, lantern, softShadow(1.9, 1.3, 0.3));
  }
  // the camera frames the lantern's spot either way, so the stage doesn't jump if it is missing
  const pillarTop = pillarM ? new THREE.Box3().setFromObject(pillarM.object).max.y : 3.43;
  if (note && !pillarM) note.style.display = 'none';   // the "ref. tower" note points at the lantern

  // ruler, crab, candles
  const ruler = makeRulerStick();
  scene.add(ruler);
  const critterRoot = new THREE.Group();
  scene.add(critterRoot);
  if (critterM) critterRoot.add(critterM.object, softShadow(0.85, 0.6, 0.3));
  const candleRoot = new THREE.Group();
  scene.add(candleRoot);
  if (candleM) {
    candleM.object.scale.setScalar(1.3);
    candleRoot.add(candleM.object, softShadow(0.75, 0.5, 0.3));
    findNodes(candleM.object, 'flame_anchor').forEach((anchor, i) => {   // one candle carries the light and the sparks
      const flame = makeFlame({ light: i === 0, sparks: i === 0, glow: i === 0, phase: i * 1.7 });
      flame.object.scale.setScalar(anchor.userData.size || 1);
      anchor.add(flame.object);
      animated.push(flame);
    });
  }

  // drifting dust in the warm light
  const MOTES = 34, motePos = new Float32Array(MOTES * 3), moteSeed = [];
  const rand = rng(23);
  for (let i = 0; i < MOTES; i++) {
    moteSeed.push({ x: -3 + rand() * 6.8, z: -1.2 + rand() * 2.6, y: rand() * 4, sp: 0.05 + rand() * 0.08, ph: rand() * 6.28 });
  }
  const moteGeo = new THREE.BufferGeometry();
  moteGeo.setAttribute('position', new THREE.BufferAttribute(motePos, 3));
  const dot = canvasTexture(32, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,214,140,1)'); g.addColorStop(1, 'rgba(255,214,140,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
  const motes = new THREE.Points(moteGeo, new THREE.PointsMaterial({ map: dot, size: 0.09, transparent: true, opacity: 0.7, depthWrite: false, color: '#f4c27a' }));
  scene.add(motes);

  // ── layout ─────────────────────────────────────────────────────────────
  let L = LAYOUTS.wide;
  function applyLayout(narrow) {
    L = narrow ? LAYOUTS.narrow : LAYOUTS.wide;
    charRoot.position.set(L.character[0], 0, L.character[1]);
    charRoot.rotation.y = L.character[2];
    charShadow.position.set(L.character[0], 0.008, L.character[1]);
    ruler.position.set(L.ruler[0], 0, L.ruler[1]);
    pillarRoot.position.set(L.pillar[0], 0, L.pillar[1]);
    pillarRoot.rotation.y = L.pillar[2];
    critterRoot.position.set(L.critter[0], 0, L.critter[1]);
    critterRoot.rotation.y = L.critter[2];
    candleRoot.position.set(L.candle[0], 0, L.candle[1]);
  }

  // ── overlay (ticks, labels, band, leader) ──────────────────────────────
  svg.textContent = '';
  const gBand = svgEl('g', { class: 'rm-band' }, svg);
  const bandPoly = svgEl('polygon', {}, gBand);
  const bandTop = svgEl('line', {}, gBand), bandBot = svgEl('line', {}, gBand);
  const bandTopTxt = svgEl('text', { 'text-anchor': 'end', 'dominant-baseline': 'middle' }, gBand);
  const bandBotTxt = svgEl('text', { 'text-anchor': 'end', 'dominant-baseline': 'middle' }, gBand);
  bandTopTxt.textContent = '最高';
  bandBotTxt.textContent = '最矮';
  const gTicks = svgEl('g', { class: 'rm-ticks' }, svg);
  const ticks = [];
  for (let i = 0; i <= RULER_H * 10; i++) {
    ticks.push({ y: i / 10, kind: i % 10 === 0 ? 'major' : i % 5 === 0 ? 'mid' : 'minor', el: svgEl('line', { class: `rm-${i % 10 === 0 ? 'major' : i % 5 === 0 ? 'mid' : 'minor'}` }, gTicks) });
  }
  const gLabels = svgEl('g', { class: 'rm-labels' }, svg);
  const labels = [];
  for (let i = 0; i <= RULER_H; i++) {
    const t = svgEl('text', { 'dominant-baseline': 'middle' }, gLabels);
    t.textContent = String(i);
    labels.push({ y: i, el: t });
  }
  const gLead = svgEl('g', { class: 'rm-lead' }, svg);
  const leader = svgEl('line', {}, gLead);
  const leadDot = svgEl('circle', { r: 3.6 }, gLead);
  const headDot = svgEl('circle', { r: 2.2, class: 'rm-head' }, gLead);

  let W = 1, H = 1;
  const pv = new THREE.Vector3();
  const project = (x, y, z) => { pv.set(x, y, z).project(camera); return [(pv.x + 1) * 0.5 * W, (1 - pv.y) * 0.5 * H]; };
  const pt = p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
  const setLine = (el, a, b) => { setAttr(el, 'x1', a[0].toFixed(1)); setAttr(el, 'y1', a[1].toFixed(1)); setAttr(el, 'x2', b[0].toFixed(1)); setAttr(el, 'y2', b[1].toFixed(1)); };

  const STICK_HALF = 0.075, FACE_Z = 0.026;
  function updateOverlay(headY) {
    const rx = L.ruler[0], rz = L.ruler[1] + FACE_Z;
    const left = y => project(rx - STICK_HALF, y, rz), right = y => project(rx + STICK_HALF, y, rz);
    for (const tk of ticks) {
      const a = left(tk.y), b = right(tk.y);
      const f = tk.kind === 'major' ? 1 : tk.kind === 'mid' ? 0.62 : 0.36;
      setLine(tk.el, a, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    }
    const cur = left(headY), curR = right(headY);
    for (const lb of labels) {
      const p = right(lb.y);
      setAttr(lb.el, 'x', (p[0] + 6).toFixed(1));
      setAttr(lb.el, 'y', p[1].toFixed(1));
      setStyle(lb.el, 'opacity', String(Math.abs(p[1] - cur[1]) < 16 ? 0 : 1));
    }
    const yT = kid ? kid.base * kidGrow(2) : charH * SCALE_TALL, yS = kid ? kid.base * kidGrow(-2) : charH * SCALE_SHORT;
    const lT = left(yT), rT = right(yT), lS = left(yS), rS = right(yS);
    setAttr(bandPoly, 'points', [lS, rS, rT, lT].map(pt).join(' '));
    setLine(bandTop, [lT[0] - 5, lT[1]], rT);
    setLine(bandBot, [lS[0] - 5, lS[1]], rS);
    setAttr(bandTopTxt, 'x', (lT[0] - 9).toFixed(1)); setAttr(bandTopTxt, 'y', lT[1].toFixed(1));
    setAttr(bandBotTxt, 'x', (lS[0] - 9).toFixed(1)); setAttr(bandBotTxt, 'y', lS[1].toFixed(1));
    setStyle(bandTopTxt, 'opacity', String(Math.abs(lT[1] - cur[1]) < 12 ? 0 : 1));
    setStyle(bandBotTxt, 'opacity', String(Math.abs(lS[1] - cur[1]) < 12 ? 0 : 1));

    // leader from the top of the character's head to the stick
    const cx = charRoot.position.x, cz = charRoot.position.z;
    const head = project(cx, headY, cz);
    setLine(leader, head, cur);
    setAttr(headDot, 'cx', head[0].toFixed(1)); setAttr(headDot, 'cy', head[1].toFixed(1));
    setAttr(leadDot, 'cx', cur[0].toFixed(1)); setAttr(leadDot, 'cy', cur[1].toFixed(1));
    setStyle(tag, 'translate', `${(curR[0] + 9).toFixed(1)}px ${cur[1].toFixed(1)}px`);

    if (note) {
      const n = project(pillarRoot.position.x + 0.62, pillarTop * 0.86, pillarRoot.position.z);
      setStyle(note, 'translate', `${n[0].toFixed(1)}px ${n[1].toFixed(1)}px`);
    }
    // "這是魚" sits above and to the left of the kid's head, its arrow pointing down at it
    if (kidNote) setStyle(kidNote, 'translate', `${head[0].toFixed(1)}px ${head[1].toFixed(1)}px`);
  }

  // ── camera framing ─────────────────────────────────────────────────────
  // Solve distance + view offset so a set of key points fits the free area beside the card.
  const target = new THREE.Vector3(0.35, 1.45, 0.3);
  let dist = 18;
  const fitPts = [];
  function buildFitPoints(narrow) {
    fitPts.length = 0;
    const P = (x, y, z) => fitPts.push(new THREE.Vector3(x, y, z));
    const tallest = charH * SCALE_TALL + 0.12;
    const [cx, cz] = L.character, [px, pz] = L.pillar;
    P(cx - 0.75, 0, cz); P(cx + 0.75, 0, cz); P(cx, tallest, cz);
    P(px - 0.72, 0, pz + 0.4); P(px + 0.72, 0, pz + 0.4); P(px, pillarTop + 0.08, pz);
    P(L.ruler[0], RULER_H + 0.3, L.ruler[1]);
    if (narrow) {
      P(L.critter[0] - 0.35, 0, L.critter[1]); P(L.candle[0] + 0.3, 0, L.candle[1]);
      P(DISC_X, 0, DISC_Z + DISC_R * 0.55);
    } else {
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * Math.PI * 2, x = DISC_X + Math.cos(a) * DISC_R * 1.035, z = DISC_Z + Math.sin(a) * DISC_R * 1.035;
        P(x, 0, z); P(x, -0.36, z);
      }
    }
  }
  function placeCamera(d, px = 0, py = 0) {
    camera.position.set(target.x + px * d * 0.07, target.y + Math.sin(ELEV) * d - py * d * 0.035, target.z + Math.cos(ELEV) * d);
    camera.lookAt(target);
    camera.updateMatrixWorld();
  }
  function fitBounds() {
    const b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const p of fitPts) {
      const [x, y] = project(p.x, p.y, p.z);
      b.x0 = Math.min(b.x0, x); b.x1 = Math.max(b.x1, x); b.y0 = Math.min(b.y0, y); b.y1 = Math.max(b.y1, y);
    }
    return b;
  }
  function fitCamera(safe) {
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const pad = safe.narrow ? 0.94 : 0.93;
    for (let i = 0; i < 6; i++) {
      placeCamera(dist);
      const b = fitBounds();
      dist *= Math.max((b.x1 - b.x0) / (safe.w * pad), (b.y1 - b.y0) / (safe.h * pad));
      dist = THREE.MathUtils.clamp(dist, 6, 80);
    }
    placeCamera(dist);
    const b = fitBounds();
    const offX = safe.x + safe.w / 2 - (b.x0 + b.x1) / 2, offY = safe.y + safe.h / 2 - (b.y0 + b.y1) / 2;
    camera.setViewOffset(W, H, -offX, -offY, W, H);
    camera.updateProjectionMatrix();
  }

  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    W = w; H = h;
    renderer.setSize(w, h, false);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const safe = safeRect();
    applyLayout(safe.narrow);
    buildFitPoints(safe.narrow);
    camera.aspect = w / h;
    camera.fov = FOV;
    fitCamera(safe);
    const dpr = renderer.getPixelRatio();
    outlineUniforms.uResolution.value.set(w * dpr, h * dpr);
    outlineUniforms.uThickness.value = (safe.narrow ? 1.3 : 1.6) * dpr;
    container.classList.toggle('is-narrow', safe.narrow);
    // where the page paints the sun: low behind the kid and the stick, as far back as the lantern is tall
    const sunC = project(L.character[0] + 0.85, 1.55, -5.5), sunE = project(L.character[0] + 0.85 + 2.15, 1.55, -5.5);
    container.style.setProperty('--sun-x', sunC[0].toFixed(1) + 'px');
    container.style.setProperty('--sun-y', sunC[1].toFixed(1) + 'px');
    container.style.setProperty('--sun-r', Math.abs(sunE[0] - sunC[0]).toFixed(1) + 'px');
    renderNow = true;
  }

  // ── interaction + state ────────────────────────────────────────────────
  const pointer = { x: 0, y: 0, sx: 0, sy: 0 };
  if (!reducedMotion) {
    window.addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse') return;
      pointer.x = e.clientX / window.innerWidth - 0.5;
      pointer.y = e.clientY / window.innerHeight - 0.5;
    }, { passive: true });
  }
  const spring = { x: 1, v: 0, target: 1 };
  let hasValue = false, renderNow = true;
  let kid = null;   // { api, holder } once the page hands over the player's own kid

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(resize);
  window.addEventListener('resize', resize);
  resize();

  let visible = true;
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(container);

  let elapsed = 0, frames = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible && !renderNow) return;
    // full rate while the height spring or the parallax is still moving; ~30 fps for the idle ambience
    const active = renderNow || Math.abs(spring.target - spring.x) > 1e-4 || Math.abs(spring.v) > 1e-3
      || Math.abs(pointer.x - pointer.sx) > 1e-3 || Math.abs(pointer.y - pointer.sy) > 1e-3;
    const dt = pacer.tick(now, active);
    if (!dt) return;
    renderNow = false;
    if (!reducedMotion) elapsed += dt;

    // character height spring (slightly underdamped for a soft "pop")
    if (reducedMotion) { spring.x = spring.target; spring.v = 0; }
    else {
      const k = 70, c = 2 * Math.sqrt(k) * 0.58;
      spring.v += ((spring.target - spring.x) * k - spring.v * c) * dt;
      spring.x += spring.v * dt;
    }
    const stretch = reducedMotion ? 0 : THREE.MathUtils.clamp(spring.v * 0.05, -0.06, 0.06);
    const bob = reducedMotion || kid ? 0 : (0.5 + 0.5 * Math.sin(elapsed * 1.7)) * 0.035;
    if (kid) {
      kid.api.update(reducedMotion ? 0 : dt);   // 0 still applies the pose; it just doesn't play the idle
      kid.top = kid.api.headTop() * (BASE_H / KID_UNITS);   // once per frame: it walks the whole rig
      // head top at h = 0 for this kid, eased so breathing in the idle doesn't shake the band
      const base = kid.top / kidGrow(kid.api.body.height || 0);
      kid.base = kid.base ? kid.base + (base - kid.base) * Math.min(1, dt * 4) : base;
    }
    charRoot.scale.set(spring.x * (1 - stretch * 0.5), spring.x * (1 + stretch), spring.x * (1 - stretch * 0.5));
    charRoot.position.y = bob;
    const shadowK = spring.x * (1 - bob * 2.5);
    charShadow.scale.set(shadowK, shadowK, 1);

    for (const m of animated) m.update(elapsed, dt);
    const flick = reducedMotion ? 1 : 1 + Math.sin(elapsed * 2.3) * 0.06 + Math.sin(elapsed * 5.1) * 0.03;
    if (lanternLight) {
      lanternLight.intensity = 2.6 * flick;
      lanternGlow.material.opacity = 0.36 * flick;
    }

    for (let i = 0; i < MOTES; i++) {
      const s = moteSeed[i], y = (s.y + elapsed * s.sp) % 4;
      motePos[i * 3] = s.x + Math.sin(elapsed * 0.4 + s.ph) * 0.15;
      motePos[i * 3 + 1] = 0.2 + y;
      motePos[i * 3 + 2] = s.z;
    }
    moteGeo.attributes.position.needsUpdate = true;

    // camera with gentle pointer parallax
    pointer.sx += (pointer.x - pointer.sx) * (1 - Math.exp(-dt * 3));
    pointer.sy += (pointer.y - pointer.sy) * (1 - Math.exp(-dt * 3));
    placeCamera(dist, pointer.sx, pointer.sy);

    updateOverlay(kid ? kid.top * spring.x * (1 + stretch) : charH * spring.x * (1 + stretch) + bob);
    renderer.render(scene, camera);
    frames++;
    window.__heightStage = { ready: true, frames, scale: spring.x, target: spring.target, hasValue, dist, pixelRatio: pacer.pixelRatio };
  }
  requestAnimationFrame(frame);

  return {
    // the player's kid (avatar-engine createAvatar(null, { host: true })) replaces the stand-in; its height comes
    // from the game's own body rules, so the stage no longer scales it
    setKid(api) {
      if (kid && kid.api === api) { renderNow = true; return; }
      if (kid) charRoot.remove(kid.holder);
      const holder = new THREE.Group();
      holder.scale.setScalar(BASE_H / KID_UNITS);
      holder.rotation.y = Math.PI;              // Sky kids face −Z; the stage camera looks from +Z
      holder.add(api.object);
      charRoot.add(holder);
      kid = { api, holder, base: 0, top: 0 };
      if (!reducedMotion) { spring.x = 0.86; spring.v = 0; }
      spring.target = 1;
      renderNow = true;
    },
    setResult(t, value) {
      spring.target = kid ? 1 : mix(SCALE_TALL, SCALE_SHORT, Math.min(1, Math.max(0, t)));
      hasValue = true;
      tagValue.textContent = fmt(value);
      tag.classList.add('has-value');
      if (!reducedMotion) { tag.classList.remove('is-pop'); void tag.offsetWidth; tag.classList.add('is-pop'); }
      renderNow = true;
    }
  };
}
