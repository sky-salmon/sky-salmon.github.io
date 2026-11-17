// sky-salmon — home: the author's own Sky kid, live.
// One small stage: the kid (assets/js/avatar-engine.js, wearing the look read from the author's outfit QR) at dusk, lit
// from behind by the sun the page paints there and from the front by what is left of the sky. The page drives it by name:
//   stage.shot('height')      camera, pose and turn for one of the tools
//   stage.body(h)             the kid's height value (the game's own body rules stretch the rig)
//   stage.pose('point')       play one clip now
//   stage.wear(look)          change clothes
//   stage.snap(size, paint)   → a canvas holding a portrait of the kid as they stand
// The canvas is transparent; the page paints the sun behind it.
import * as THREE from 'three';
import { createAvatar } from './avatar-engine.js';
import { createPacer, antialias } from './island/pace.js';
import { canvasTexture } from './island/util.js';

// 魚: the look in the author's outfit QR (pieces, dyes, and the body they set in the game)
export const FISH = {
  pieces: { outfit: 'CharSkyKid_Body_AP08BaggyPants_01', cape: 'CharSkyKid_Wing_Bat', hair: 'CharSkyKid_Hair_WitchHat_01', mask: 'CharSkyKid_Mask_None',
    neck: 'CharSkyKid_Neck_AP24StripesScarf', shoes: 'CharSkyKid_Feet_AuroraSneakers', horn: 'CharSkyKid_Horn_AP06Tassel', face: 'CharSkyKid_Face_None',
    prop: 'CharSkyKid_Prop_MischiefCat', hat: 'CharSkyKid_Hat_None' },
  dyes: { outfit: ['black_black', 'black_black'], horn: ['black_black', null] },
  body: { height: 1.8867949, scale: -0.0049999999 }
};

const KID_UNITS = 15.557, BASE_H = 2.2;   // the default kid's head top in game units → 2.2 on this stage (as on the height page)
const FOV = 26;

// One shot per tool: the clip the kid plays, how far they are turned (0 = facing the camera), and where the camera
// sits (yaw / pitch around `look`, `dist` away). `x` slides the whole picture sideways, in view widths.
export const SHOTS = {
  card:     { clip: 'waveSmall', turn: -0.3, yaw: 0.02, pitch: 0.02, dist: 5.4, look: [0, 2.02, 0], x: 0.17 },
  wardrobe: { clip: 'idle_Sassy', turn: -0.2, yaw: 0, pitch: 0.05, dist: 7.5, look: [0, 1.5, 0], spin: 0.35 },
  height:   { clip: 'idleStand', turn: 0, yaw: 0, pitch: 0.0, dist: 8.3, look: [0, 1.56, 0], x: 0.07 },
  events:   { clip: 'idle_Proud', turn: -0.36, yaw: -0.04, pitch: 0.03, dist: 9.4, look: [0, 1.6, 0], x: -0.12 },
  music:    { clip: 'clap', turn: -0.38, yaw: 0.14, pitch: 0.06, dist: 7.4, look: [0, 1.5, 0] },
  album:    { clip: 'waveSmall', turn: -0.15, yaw: -0.05, pitch: 0.04, dist: 7.5, look: [0, 1.52, 0] }
};
// the framing of a photograph: head and shoulders, the hat whole
const PORTRAIT = { yaw: -0.04, pitch: 0.03, dist: 5.9, look: [0, 1.98, 0] };

// The Bat cape is black with an orange-red band along its scalloped hem (in the game a colour-shifting shader draws
// it). The band is found on the mesh itself: the open edges in the lower part of the cape are the hem.
function batCape(root) {
  root.traverse(o => {
    if (!o.isSkinnedMesh || !o.material.userData.sh || o.material.userData.sh.shader !== 'AvatarCham') return;
    const geo = o.geometry;
    if (!geo.attributes.aRim) {
      o.updateMatrix();
      const pos = geo.attributes.position, n = pos.count, P = [];
      for (let i = 0; i < n; i++) P.push(new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(o.matrix));
      const idx = geo.index.array, edges = new Map();
      for (let f = 0; f < idx.length; f += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
        const i = idx[f + a], j = idx[f + b], k = i < j ? i + ',' + j : j + ',' + i; edges.set(k, (edges.get(k) || 0) + 1);
      }
      let minY = Infinity, maxY = -Infinity;
      for (const v of P) { minY = Math.min(minY, v.y); maxY = Math.max(maxY, v.y); }
      const hem = [];
      for (const [k, c] of edges) if (c === 1) for (const v of k.split(',').map(Number)) if (P[v].y < minY + 0.4 * (maxY - minY)) hem.push(P[v]);
      const rim = new Float32Array(n), R = 0.2;
      for (let i = 0; i < n; i++) { let d = 1e9; for (const h of hem) d = Math.min(d, P[i].distanceToSquared(h)); rim[i] = 1 - THREE.MathUtils.smoothstep(Math.sqrt(d), R * 0.4, R); }
      geo.setAttribute('aRim', new THREE.BufferAttribute(rim, 1));
    }
    const u = o.material.userData.u;
    u.colour0.value.setRGB(0.03, 0.027, 0.03); u.useColour1.value = 0; u.useMask.value = 0;
    const prev = o.material.onBeforeCompile;
    o.material.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRim; varying float vRim;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvRim = aRim;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRim;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.62, 0.06, 0.0), vRim);\n totalEmissiveRadiance += vRim * vec3(0.3, 0.035, 0.0);');
    };
    o.material.customProgramCacheKey = () => 'batcape';
    o.material.needsUpdate = true;
  });
}

function softDisc(inner, outer, size = 128) {
  return canvasTexture(size, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, inner); g.addColorStop(1, outer);
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
}

export async function mountStage({ canvas, container, reducedMotion = false, onProgress = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: antialias(), alpha: true, powerPreference: 'high-performance' });
  const pacer = createPacer(renderer, { reducedMotion, onPixelRatio: () => resize() });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 200);

  // dusk, with the sun behind the kid: little light from the front (so black cloth stays black), a strong warm edge
  // from both sides behind, and a breath of cool sky from above-left so the face and scarf still read
  scene.add(new THREE.HemisphereLight('#c8b9a0', '#231d14', 0.62));
  const front = new THREE.DirectionalLight('#ffe2c2', 0.95);
  front.position.set(-3.5, 4.5, 8);
  scene.add(front);
  const rimR = new THREE.DirectionalLight('#ffa860', 3.6);
  rimR.position.set(5.5, 4.5, -6.5);
  scene.add(rimR);
  const rimL = new THREE.DirectionalLight('#ffc27a', 2.6);
  rimL.position.set(-6, 5, -6);
  scene.add(rimL);
  const sky = new THREE.DirectionalLight('#a9c4d6', 0.5);
  sky.position.set(-2, 9, 2);
  scene.add(sky);

  // the ground is only light: the sun's glow lying on it, and the kid's shadow falling toward the camera
  const pool = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 2.6),
    new THREE.MeshBasicMaterial({ map: softDisc('rgba(255,170,96,0.2)', 'rgba(255,170,96,0)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  pool.rotation.x = -Math.PI / 2; pool.position.set(0, 0.004, -0.35);
  scene.add(pool);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.1, 1.9),
    new THREE.MeshBasicMaterial({ map: softDisc('rgba(10,8,4,0.8)', 'rgba(10,8,4,0)'), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, 0.008, 0.25); shadow.renderOrder = 1;
  scene.add(shadow);

  onProgress(0.15);
  // the kid
  const holder = new THREE.Group(), turner = new THREE.Group();
  holder.scale.setScalar(BASE_H / KID_UNITS);
  holder.rotation.y = Math.PI;   // Sky kids face −Z; the camera looks from +Z
  turner.add(holder); scene.add(turner);
  const kid = await createAvatar({ base: new URL('../avatar/', import.meta.url).href });
  onProgress(0.5);
  holder.add(kid.object);
  let look = FISH;
  await kid.wearLook({ ...look, clip: SHOTS.card.clip });
  if (look.pieces.cape === FISH.pieces.cape) batCape(kid.object);
  onProgress(0.95);

  // ── camera ──────────────────────────────────────────────────────────────
  let W = 1, H = 1, dirty = true, visible = true;
  const cur = { turn: SHOTS.card.turn, yaw: SHOTS.card.yaw, pitch: SHOTS.card.pitch, dist: SHOTS.card.dist, look: new THREE.Vector3(...SHOTS.card.look), x: SHOTS.card.x || 0 };
  let goal = { ...SHOTS.card, look: new THREE.Vector3(...SHOTS.card.look) }, shotName = 'card';
  let drag = 0, dragV = 0, spinT = 0, fit = 1, busyUntil = 0, grab = null;
  const place = () => {
    const d = cur.dist * fit, cp = Math.cos(cur.pitch);
    camera.position.set(cur.look.x + Math.sin(cur.yaw) * cp * d, cur.look.y + Math.sin(cur.pitch) * d, cur.look.z + Math.cos(cur.yaw) * cp * d);
    camera.lookAt(cur.look);
    if (cur.x) camera.setViewOffset(W, H, -cur.x * W * Math.min(1, Math.max(0.35, (W - 300) / 320)), 0, W, H); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
  };
  function resize() {
    W = Math.max(1, container.clientWidth); H = Math.max(1, container.clientHeight);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    // a narrow stage steps back so the whole kid (hat and cape included) stays in the picture
    fit = Math.max(1, 0.78 / camera.aspect);
    dirty = true;
  }
  new ResizeObserver(resize).observe(container);
  resize();
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(container);

  let frames = 0;
  const ease = (a, b, k) => a + (b - a) * k;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!visible && !dirty) return;
    const moving = dirty || now < busyUntil || Math.abs(dragV) > 1e-3 || !!goal.spin || !!grab;
    const dt = pacer.tick(now, moving);
    if (!dt) return;
    dirty = false;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
    cur.yaw = ease(cur.yaw, goal.yaw, k); cur.pitch = ease(cur.pitch, goal.pitch, k); cur.dist = ease(cur.dist, goal.dist, k);
    cur.x = ease(cur.x, goal.x || 0, k); cur.look.lerp(goal.look, k);
    // the kid's turn: the shot's own angle, a slow turntable where the shot asks for one, and whatever the visitor dragged
    if (goal.spin && !reducedMotion) spinT += dt * goal.spin;
    drag += dragV * dt; dragV *= Math.exp(-dt * 3.5);
    cur.turn = ease(cur.turn, goal.turn, k);
    turner.rotation.y = cur.turn + spinT + drag;
    kid.update(reducedMotion ? 0 : dt);
    place();
    renderer.render(scene, camera);
    frames++;
    window.__homeStage = { ready: true, frames, shot: shotName };
  }
  requestAnimationFrame(frame);
  onProgress(1);

  // drag across the stage to turn the kid
  canvas.addEventListener('pointerdown', e => { if (e.button > 0) return; grab = { x: e.clientX, d: drag, t: performance.now(), lx: e.clientX }; canvas.setPointerCapture(e.pointerId); dragV = 0; canvas.dispatchEvent(new CustomEvent('stage-grab', { bubbles: true })); });
  canvas.addEventListener('pointermove', e => {
    if (!grab) return;
    const now = performance.now(), dx = e.clientX - grab.lx;
    drag = grab.d + (e.clientX - grab.x) * 0.012;
    dragV = dx * 0.012 / Math.max(0.008, (now - grab.t) / 1000); grab.t = now; grab.lx = e.clientX; dirty = true;
  });
  const release = () => { grab = null; };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);

  return {
    kid, shots: SHOTS,
    get shotName() { return shotName; },
    shot(name, over = {}) {
      const s = SHOTS[name]; if (!s) return;
      shotName = name;
      goal = { ...s, ...over, look: new THREE.Vector3(...(over.look || s.look)) };
      // unwind what the visitor dragged and what the turntable added, by the short way round
      const full = Math.PI * 2, extra = spinT + drag, wrapped = ((extra + Math.PI) % full + full) % full - Math.PI;
      cur.turn += wrapped; spinT = 0; drag = 0; dragV = 0;
      kid.play(goal.clip);
      busyUntil = performance.now() + 2600; dirty = true;
    },
    pose(clip, restart = false) { kid.play(clip, restart); dirty = true; },
    body(height, scale = look.body.scale) { kid.setBody({ height, scale }); dirty = true; },
    async wear(next) { look = next; const ok = await kid.wearLook({ ...next, clip: goal.clip }); if (ok && next.pieces.cape === FISH.pieces.cape) batCape(kid.object); dirty = true; return ok; },
    headTop() { return kid.headTop() * (BASE_H / KID_UNITS); },
    // where a point of the stage lands on the canvas, in CSS pixels
    project(x, y, z) { const v = new THREE.Vector3(x, y, z).project(camera); return [(v.x + 1) * 0.5 * W, (1 - v.y) * 0.5 * H]; },
    // a square portrait of the kid as they stand now, on whatever `paint` draws first. The stage shows the portrait's
    // framing for the one frame it takes; the next frame puts the tool's own shot back.
    snap(size = 480, paint = null) {
      const keep = { yaw: cur.yaw, pitch: cur.pitch, dist: cur.dist, x: cur.x, look: cur.look.clone(), fit };
      Object.assign(cur, { yaw: PORTRAIT.yaw, pitch: PORTRAIT.pitch, dist: PORTRAIT.dist, x: 0 }); cur.look.set(...PORTRAIT.look); fit = 1;
      place(); renderer.render(scene, camera);
      const out = document.createElement('canvas'); out.width = out.height = size;
      const ctx = out.getContext('2d');
      if (paint) paint(ctx, size);
      const s = Math.min(canvas.width, canvas.height), sx = (canvas.width - s) / 2, sy = (canvas.height - s) / 2;
      ctx.drawImage(canvas, sx, sy, s, s, 0, 0, size, size);
      Object.assign(cur, { yaw: keep.yaw, pitch: keep.pitch, dist: keep.dist, x: keep.x }); cur.look.copy(keep.look); fit = keep.fit;
      dirty = true;
      return out;
    },
    refresh() { dirty = true; }
  };
}
