// sky-salmon — home: the author's own Sky kid, live.
// One small stage: the kid (assets/js/avatar-engine.js, wearing the look read from the author's outfit QR) at dusk, lit
// from behind by the sun the page paints there and from the front by what is left of the sky. The page drives it by name:
//   stage.shot('height')      camera, pose and turn for one of the tools
//   stage.between(a, b, t)    part of the way from tool a's shot to tool b's (the page moves it as it scrolls)
//   stage.handoff(e, frame)   0…1: from the clip's own camera and pose (the kid squatting by the wall, drawn exactly
//                             over the footage in `frame`) to the tool's shot. The page moves it as the page scrolls.
//   stage.body(h)             the kid's height value (the game's own body rules stretch the rig)
//   stage.pose('point')       play one clip now, once
//   stage.wear(look)          change clothes
//   stage.snap(size, paint)   → a canvas holding a portrait of the kid as they stand
// The canvas is transparent; the page paints the sun behind it. The picture is shown mirrored (CSS), like the author's
// clip, so the hat's tip and the tassel sit on the same side in both; everything this module hands out (points on the
// canvas) or takes in (drags, where to look) is in what the visitor sees.
import * as THREE from 'three';
import { createAvatar } from './avatar-engine.js';
import { createPacer, antialias } from './island/pace.js';
import { canvasTexture } from './island/util.js';
import { FISH, batCape, CLIP_LOOK, clipU, clipDir, clipLook } from './fish.js';
export { FISH };

const KID_UNITS = 15.557, BASE_H = 2.2;   // the default kid's head top in game units → 2.2 on this stage (as on the height page)
const FOV = 26;

// One shot per tool: the clip the kid plays (`once`: one time, then the idle), how far they are turned (0 = facing the
// camera), and where the camera sits (yaw / pitch around `look`, `dist` away). `x` slides the whole picture sideways,
// in view widths, to the visitor's right. Full-body shots keep the hat's tip and the feet inside the unfaded canvas.
export const SHOTS = {
  card:     { clip: 'waveSmall', once: true, turn: -0.3, yaw: 0.02, pitch: 0.02, dist: 5.4, look: [0, 2.06, 0], x: 0.17 },
  wardrobe: { clip: 'idle_Sassy', turn: -0.2, yaw: 0, pitch: 0.04, dist: 7.9, look: [0, 1.27, 0], spin: 0.35 },
  height:   { clip: 'idleStand', turn: 0, yaw: 0, pitch: 0.0, dist: 8.5, look: [0, 1.36, 0], x: 0.07 },
  events:   { clip: 'idle_Proud', turn: -0.36, yaw: -0.04, pitch: 0.03, dist: 9.6, look: [0, 1.45, 0], x: -0.12 },
  music:    { clip: 'clap', turn: -0.72, yaw: 0.42, pitch: 0.05, dist: 6.3, look: [0, 1.72, 0], x: 0.03 },
  album:    { clip: 'idle', turn: -0.12, yaw: -0.1, pitch: -0.13, dist: 6.9, look: [0, 1.62, 0] }
};
// the framing of a photograph: head and shoulders, the hat whole
const PORTRAIT = { yaw: -0.04, pitch: 0.03, dist: 5.9, look: [0, 1.98, 0] };
// The author's clip, as a camera: where it stood and looked in the game's units when the kid squats at the origin,
// turned CLIP.ry (the camera from the photo-scene branch's fit, the turn refitted to this footage by laying the
// kid's outline over it). The footage is 1280×802, mirrored.
// `pivot` is the upright line (x, z in game units) that turn was made about. zoom and shift then lay that picture
// exactly over the kid in the footage: zoom about the middle of the stage, shift in footage widths / heights, toward
// the visitor's right / down.
const CLIP = { pos: [1.425, 3.5, -9.521], tgt: [-4.345, 6.466, -1.911], pivot: [0.0479, -0.8356], fov: 60, ry: 0.04, zoom: 1.085, shift: [-0.0133, 0.0529], pose: 'squatLazy', file: 'clips/squatLazy.glb' };

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
  scene.add(new THREE.HemisphereLight('#c8b9a0', '#231d14', 0.5));
  const front = new THREE.DirectionalLight('#ffe2c2', 0.6);
  front.position.set(-3.5, 4.5, 8);
  scene.add(front);
  const rimR = new THREE.DirectionalLight('#ffa860', 4.4);
  rimR.position.set(5.5, 4.5, -6.5);
  scene.add(rimR);
  const rimL = new THREE.DirectionalLight('#ffc27a', 3.2);
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
  const S = BASE_H / KID_UNITS;
  const holder = new THREE.Group(), turner = new THREE.Group();
  holder.scale.setScalar(S);
  holder.rotation.y = Math.PI;   // Sky kids face −Z; the camera looks from +Z
  turner.add(holder); scene.add(turner);
  const kid = await createAvatar({ base: new URL('../avatar/', import.meta.url).href });
  kid.index.clips.push({ id: CLIP.pose, loop: true, file: CLIP.file });   // the squat in the author's clip
  onProgress(0.5);
  holder.add(kid.object);
  const bone = n => kid.object.getObjectByName(n);

  // ── the cape goes with the arms ────────────────────────────────────────
  // The engine keeps the cape's chains at their modelled pose (the game moves them with cloth). Here each side of the
  // cape follows its upper arm part of the way, as the cloth would: lift an arm to wave and the cape on that side is
  // drawn up and aside instead of being run through. Measured in the chest's space, against the arm at rest.
  const chest = bone('M_chest'), capeSides = [];
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), qI = new THREE.Quaternion();
  const armDir = (root, elbow, out) => {
    chest.getWorldQuaternion(qa).invert();
    return out.copy(elbow.getWorldPosition(va)).sub(root.getWorldPosition(vb)).applyQuaternion(qa).normalize();
  };
  for (const side of ['L', 'R']) {
    const root = bone(side + '_armRoot'), elbow = bone(side + '_elbow');
    if (!chest || !root || !elbow) continue;
    const chains = [[side + '_WingSRoot', 0.82], [side + '_WingFRoot', 0.5], [side + '_WingBRoot', 0.16]]
      .map(([n, f]) => ({ b: bone(n), f })).filter(c => c.b).map(c => ({ ...c, base: c.b.quaternion.clone() }));
    capeSides.push({ root, elbow, rest: null, chains, q: new THREE.Quaternion() });
  }
  // "at rest" is the arm as it hangs in the standing idle: that is the pose the cape was modelled to hang over
  const measureRest = () => { kid.object.updateMatrixWorld(true); for (const s of capeSides) s.rest = armDir(s.root, s.elbow, new THREE.Vector3()); };
  function capeFollow(dt) {
    for (const s of capeSides) {
      if (!s.rest) continue;
      qb.setFromUnitVectors(s.rest, armDir(s.root, s.elbow, va));
      s.q.slerp(qb, reducedMotion ? 1 : 1 - Math.exp(-dt * 12));   // a little behind the arm, like cloth
      chest.getWorldQuaternion(qa);
      // a small move of the arm (hands on hips) barely stirs the cloth; a raised arm carries it
      const angle = 2 * Math.acos(Math.min(1, Math.abs(s.q.w))), carry = 0.3 + 0.7 * THREE.MathUtils.smoothstep(angle, 0.5, 1.5);
      for (const c of s.chains) {
        // the turn, as seen from the chain's parent: P⁻¹ · (C · q^f · C⁻¹) · P, then the chain's own modelled pose
        c.b.parent.getWorldQuaternion(qc);
        qb.copy(qI).slerp(s.q, c.f * carry);
        c.b.quaternion.copy(qc).invert().multiply(qa).multiply(qb).multiply(qa.clone().invert()).multiply(qc).multiply(c.base);
      }
    }
  }

  let look = FISH;
  await kid.wearLook({ ...look, clip: CLIP.pose });
  if (look.pieces.cape === FISH.pieces.cape) batCape(kid.object);
  clipLook(kid.object);
  onProgress(0.9);

  // ── the clip's camera, in this stage's space ───────────────────────────
  // In the fitted scene the kid was turned CLIP.ry about CLIP.pivot; here the kid stays put and the camera moves
  // round instead. Then game units → stage units, and the half-turn the holder gives the kid.
  const clipCam = { pos: new THREE.Vector3(), tgt: new THREE.Vector3(), q: new THREE.Quaternion() };
  function fitClip() {
    const [hx, hz] = CLIP.pivot, c = Math.cos(CLIP.ry), s = Math.sin(CLIP.ry);
    const kx = hx - (c * hx + s * hz), kz = hz - (-s * hx + c * hz);   // where the fitted kid stood after its turn
    const toStage = (p, out) => { const x = p[0] - kx, z = p[2] - kz; return out.set(-(c * x - s * z) * S, p[1] * S, -(s * x + c * z) * S); };
    toStage(CLIP.pos, clipCam.pos); toStage(CLIP.tgt, clipCam.tgt);
    clipCam.q.setFromRotationMatrix(new THREE.Matrix4().lookAt(clipCam.pos, clipCam.tgt, new THREE.Vector3(0, 1, 0)));
  }
  fitClip();
  // stand in the idle for a moment to measure the arms at rest, then go back to the squat
  const headAt = () => { scene.updateMatrixWorld(true); return bone('M_head').getWorldPosition(new THREE.Vector3()); };
  await kid.play('idle');
  for (let i = 0; i < 6; i++) kid.update(0.1);
  measureRest();
  const headStand = headAt();   // where the head is when the kid stands on the stage
  await kid.play(CLIP.pose);
  for (let i = 0; i < 6; i++) kid.update(0.1);
  const headSquat = headAt();   // and when they squat by the wall
  onProgress(0.95);

  // ── camera ──────────────────────────────────────────────────────────────
  let W = 1, H = 1, dirty = true, visible = true;
  const cur = { turn: SHOTS.card.turn, yaw: SHOTS.card.yaw, pitch: SHOTS.card.pitch, dist: SHOTS.card.dist, look: new THREE.Vector3(...SHOTS.card.look), x: SHOTS.card.x || 0 };
  let goal = { ...SHOTS.card, look: new THREE.Vector3(...SHOTS.card.look) }, shotName = 'card';
  let drag = 0, dragV = 0, spinT = 0, fit = 1, busyUntil = 0, grab = null, held = true;
  // take off what the visitor dragged and what the turntable added, by the short way round
  const unwind = () => {
    const full = Math.PI * 2, extra = spinT + drag, wrapped = ((extra + Math.PI) % full + full) % full - Math.PI;
    cur.turn += wrapped; spinT = 0; drag = 0; dragV = 0;
  };
  // hand-off: 0 = the clip's camera and pose, 1 = the shot. `frame` is the footage on the page, relative to the canvas.
  const hand = { e: 0, frame: null, stood: false, shown: true };
  const camA = new THREE.PerspectiveCamera(CLIP.fov, 1, 0.1, 200), projB = new THREE.Matrix4(), posB = new THREE.Vector3(), quatB = new THREE.Quaternion();
  const vH = new THREE.Vector3(), vA = new THREE.Vector3(), vB = new THREE.Vector3(), qSwing = new THREE.Quaternion(), qT = new THREE.Quaternion();
  const place = () => {
    const d = cur.dist * fit, cp = Math.cos(cur.pitch);
    camera.position.set(cur.look.x - Math.sin(cur.yaw) * cp * d, cur.look.y + Math.sin(cur.pitch) * d, cur.look.z + Math.cos(cur.yaw) * cp * d);   // yaw is mirrored with the picture
    camera.lookAt(cur.look);
    if (cur.x) camera.setViewOffset(W, H, cur.x * W * Math.min(1, Math.max(0.35, (W - 300) / 320)), 0, W, H); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    if (hand.e >= 1 || !hand.frame) return;
    // Between the clip's camera (A) and the shot (B): the footage is a 60° view, F.w × F.h, of which the canvas shows
    // one window. The camera swings round the kid's head from A's side to B's and backs away so the kid shrinks
    // evenly, while its aim and lens go from A's to B's. At 0 it is A exactly, at 1 it is B.
    const F = hand.frame, t = hand.e;
    camA.aspect = F.w / F.h;
    // mirrored: the window counts from the footage's right edge. Then the fit's zoom (about the window's middle) and shift.
    const z = CLIP.zoom, x0 = F.w + F.x - W, y0 = -F.y;
    camA.setViewOffset(F.w * z, F.h * z, (x0 + W / 2) * z - W / 2 - CLIP.shift[0] * F.w * z, (y0 + H / 2) * z - H / 2 - CLIP.shift[1] * F.h * z, W, H);
    camA.updateProjectionMatrix();
    projB.copy(camera.projectionMatrix); posB.copy(camera.position); quatB.copy(camera.quaternion);
    const a = camA.projectionMatrix.elements, b = projB.elements, o = camera.projectionMatrix.elements;
    for (let i = 0; i < 16; i++) o[i] = a[i] + (b[i] - a[i]) * t;
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.quaternion.copy(clipCam.q).slerp(quatB, t);
    // the head the camera goes round: the squat's at first, the live one while the kid stands up, the stage's at the end
    head.getWorldPosition(vH);
    if (t < 0.3) vH.lerpVectors(headSquat, vH, t / 0.3); else if (t > 0.7) vH.lerp(headStand, (t - 0.7) / 0.3);
    vA.copy(clipCam.pos).sub(headSquat); vB.copy(posB).sub(headStand);
    const dA = vA.length(), dB = vB.length(), size = Math.pow(a[5] / dA, 1 - t) * Math.pow(b[5] / dB, t);   // how big the kid is drawn
    vA.normalize(); vB.normalize();
    qSwing.setFromUnitVectors(vA, vB); qT.identity().slerp(qSwing, t);
    camera.position.copy(vA).applyQuaternion(qT).multiplyScalar(o[5] / size).add(vH);
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

  // The kid's head leans toward a point the page gives (the visitor's pointer), a little, on top of whatever the clip
  // does. The clip rewrites the head every frame; if it ever does not, the lean is taken off before it is put on again.
  const head = bone('M_head'), gaze = { x: 0, y: 0, tx: 0, ty: 0 };
  const qW = new THREE.Quaternion(), qP = new THREE.Quaternion(), qE = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'YXZ');
  const mine = new THREE.Quaternion(), plain = new THREE.Quaternion();
  let leaned = false;
  function lookAt(dt) {
    if (!head) return;
    if (leaned && head.quaternion.equals(mine)) head.quaternion.copy(plain);
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 5);
    gaze.x += (gaze.tx - gaze.x) * k; gaze.y += (gaze.ty - gaze.y) * k;
    const amount = hand.e;   // by the wall the kid keeps the clip's own pose
    leaned = amount > 0.01 && (Math.abs(gaze.x) > 1e-3 || Math.abs(gaze.y) > 1e-3);
    if (!leaned) return;
    plain.copy(head.quaternion);
    head.parent.updateWorldMatrix(true, false);
    head.parent.getWorldQuaternion(qP);
    qW.copy(qP).multiply(head.quaternion);
    eul.set(gaze.y * 0.3 * amount, -gaze.x * 0.55 * amount, 0);   // mirrored with the picture
    qW.premultiply(qE.setFromEuler(eul));
    head.quaternion.copy(qP.invert().multiply(qW));
    mine.copy(head.quaternion);
  }

  // which clip plays: the squat while the footage still shows, the shot's own once the kid has stood up
  const playShot = () => kid.play(goal.clip, !!goal.once, goal.once ? 'idle' : null);
  function stand() {
    const up = hand.e > (hand.stood ? 0.42 : 0.55);
    if (up === hand.stood) return;
    hand.stood = up;
    if (up) playShot(); else kid.play(CLIP.pose);
  }

  let frames = 0;
  const ease = (a, b, k) => a + (b - a) * k;
  function frame(now) {
    requestAnimationFrame(frame);
    if (!hand.shown || (!visible && !dirty)) return;
    const moving = dirty || now < busyUntil || Math.abs(dragV) > 1e-3 || !!goal.spin || !!grab || Math.abs(gaze.tx - gaze.x) > 0.01 || Math.abs(gaze.ty - gaze.y) > 0.01;
    const dt = pacer.tick(now, moving);
    if (!dt) return;
    dirty = false;
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 4.2);
    cur.yaw = ease(cur.yaw, goal.yaw, k); cur.pitch = ease(cur.pitch, goal.pitch, k); cur.dist = ease(cur.dist, goal.dist, k);
    cur.x = ease(cur.x, goal.x || 0, k); cur.look.lerp(goal.look, k);
    // the kid's turn: the shot's own angle, a slow turntable where the shot asks for one, and whatever the visitor
    // dragged — all of it faded out toward the clip's pose, and mirrored with the picture
    if (goal.spin && !reducedMotion && hand.e >= 1) spinT += dt * goal.spin;
    drag += dragV * dt; dragV *= Math.exp(-dt * 3.5);
    cur.turn = ease(cur.turn, goal.turn, k);
    turner.rotation.y = -(cur.turn + spinT + drag) * hand.e;
    kid.update(reducedMotion ? 0 : dt);
    capeFollow(dt);
    lookAt(dt);
    pool.material.opacity = shadow.material.opacity = hand.e;   // no stage floor by the wall
    clipU.value = 1 - THREE.MathUtils.smoothstep(hand.e, 0.1, 0.7);   // … and the footage's light there
    place();
    renderer.render(scene, camera);
    frames++;
    window.__homeStage = { ready: true, frames, shot: shotName, handoff: hand.e };
  }
  window.__homeStage = { ready: true, frames: 0, shot: shotName, handoff: hand.e };   // nothing is drawn while the clip covers the stage
  requestAnimationFrame(frame);
  onProgress(1);

  // drag across the stage to turn the kid; a tap that does not move is a call
  canvas.addEventListener('pointerdown', e => { if (e.button > 0) return; grab = { x: e.clientX, d: drag, t: performance.now(), t0: performance.now(), lx: e.clientX }; canvas.setPointerCapture(e.pointerId); dragV = 0; });
  canvas.addEventListener('pointermove', e => {
    if (!grab) return;
    const now = performance.now(), dx = e.clientX - grab.lx;
    if (!grab.moved && Math.abs(e.clientX - grab.x) > 6) { grab.moved = true; canvas.dispatchEvent(new CustomEvent('stage-grab', { bubbles: true })); }
    drag = grab.d + (e.clientX - grab.x) * 0.012;
    dragV = dx * 0.012 / Math.max(0.008, (now - grab.t) / 1000); grab.t = now; grab.lx = e.clientX; dirty = true;
  });
  canvas.addEventListener('pointerup', e => {
    if (grab && !grab.moved && performance.now() - grab.t0 < 500) canvas.dispatchEvent(new CustomEvent('stage-tap', { bubbles: true }));
    grab = null;
  });
  canvas.addEventListener('pointercancel', () => { grab = null; });

  const onCanvas = v => { v.project(camera); return [W - (v.x + 1) * 0.5 * W, (1 - v.y) * 0.5 * H]; };   // mirrored with the picture
  return {
    kid, shots: SHOTS,
    get shotName() { return shotName; },
    shot(name, over = {}) {
      const s = SHOTS[name]; if (!s) return;
      shotName = name;
      goal = { ...s, ...over, look: new THREE.Vector3(...(over.look || s.look)) };
      unwind(); held = true;
      if (hand.stood) playShot();
      busyUntil = performance.now() + 2600; dirty = true;
    },
    // t of the way from tool a's shot to tool b's: the camera, the kid's turn and the picture's slide go evenly; the
    // pose changes over once, near the middle. The page calls this as it scrolls from one tool to the next.
    between(a, b, t) {
      const A = SHOTS[a], B = SHOTS[b] || A; if (!A) return;
      t = Math.max(0, Math.min(1, t));
      const L = (x, y) => x + (y - x) * t;
      goal.yaw = L(A.yaw, B.yaw); goal.pitch = L(A.pitch, B.pitch); goal.dist = L(A.dist, B.dist);
      goal.turn = L(A.turn, B.turn); goal.x = L(A.x || 0, B.x || 0);
      goal.look.set(L(A.look[0], B.look[0]), L(A.look[1], B.look[1]), L(A.look[2], B.look[2]));
      // the nearer tool's pose, holding on a little past half-way so it does not flicker there
      const near = shotName === b ? (t < 0.42 ? a : b) : shotName === a ? (t > 0.58 ? b : a) : (t < 0.5 ? a : b);
      if (near !== shotName) { shotName = near; goal.clip = SHOTS[near].clip; goal.once = SHOTS[near].once; if (hand.stood) playShot(); }
      // the turntable and the visitor's own turning belong to a tool at rest: on the way to the next they unwind
      const rest = t <= 0.001 || t >= 0.999;
      if (!rest && held) unwind();
      held = rest; goal.spin = rest ? SHOTS[near].spin : 0;
      busyUntil = performance.now() + 900; dirty = true;
    },
    // e: 0 = the author's clip (its camera, the squat), 1 = the tool's shot. frame: where the footage is on the page,
    // relative to the canvas, { x, y, w, h } in CSS pixels.
    // shown: false while the canvas cannot be seen at all, so nothing is drawn
    handoff(e, frame, shown = true) { hand.e = Math.max(0, Math.min(1, e)); hand.frame = frame || hand.frame; hand.shown = shown; stand(); if (shown) { busyUntil = performance.now() + 400; dirty = true; } },
    pose(clip, restart = false) { kid.play(clip, restart, 'idle'); dirty = true; },
    clap() { kid.play('clap', true); dirty = true; },
    body(height, scale = look.body.scale) { kid.setBody({ height, scale }); dirty = true; },
    async wear(next) { look = next; const ok = await kid.wearLook({ ...next, clip: hand.stood ? goal.clip : CLIP.pose }); if (ok && next.pieces.cape === FISH.pieces.cape) batCape(kid.object); clipLook(kid.object); dirty = true; return ok; },
    headTop() { return kid.headTop() * S; },
    // x, y in −1…1 across the stage: where the kid should look (0, 0 = straight ahead)
    gaze(x, y) { gaze.tx = Math.max(-1, Math.min(1, x)); gaze.ty = Math.max(-1, Math.min(1, y)); dirty = true; },
    // a point of the stage, and the kid's chest, on the canvas in CSS pixels
    project(x, y, z) { return onCanvas(new THREE.Vector3(x, y, z)); },
    chest() { return onCanvas((chest || head).getWorldPosition(new THREE.Vector3())); },
    // a square portrait of the kid as they stand now, on whatever `paint` draws first (mirrored, as the stage shows
    // them). The stage draws the portrait's framing for the one frame it takes; the next frame puts the shot back.
    snap(size = 480, paint = null) {
      const keep = { yaw: cur.yaw, pitch: cur.pitch, dist: cur.dist, x: cur.x, look: cur.look.clone(), fit, e: hand.e };
      Object.assign(cur, { yaw: PORTRAIT.yaw, pitch: PORTRAIT.pitch, dist: PORTRAIT.dist, x: 0 }); cur.look.set(...PORTRAIT.look); fit = 1; hand.e = 1; clipU.value = 0;
      place(); renderer.render(scene, camera);
      const out = document.createElement('canvas'); out.width = out.height = size;
      const ctx = out.getContext('2d');
      if (paint) paint(ctx, size);
      const s = Math.min(canvas.width, canvas.height), sx = (canvas.width - s) / 2, sy = (canvas.height - s) / 2;
      ctx.translate(size, 0); ctx.scale(-1, 1);
      ctx.drawImage(canvas, sx, sy, s, s, 0, 0, size, size);
      Object.assign(cur, { yaw: keep.yaw, pitch: keep.pitch, dist: keep.dist, x: keep.x }); cur.look.copy(keep.look); fit = keep.fit; hand.e = keep.e;
      dirty = true;
      return out;
    },
    refresh() { dirty = true; },
    _fit(o) { Object.assign(CLIP, o); fitClip(); dirty = true; return { ...CLIP }; },   // for fitting the clip camera by eye
    _look(o, dir) {   // … and the clip's light: { slot: { tint, gamma, lo, floor, dark, warm } }, [x, y, z]
      for (const k in o) Object.assign(CLIP_LOOK[k] || (CLIP_LOOK[k] = {}), o[k]);
      if (dir) clipDir.value.set(...dir).normalize();
      kid.object.traverse(n => {
        const u = n.isMesh && n.material.userData.clipLook, L = u && (CLIP_LOOK[n.material.userData.slot] || CLIP_LOOK.other);
        if (!u) return;
        u.uClipTint.value.set(...L.tint); u.uClipShape.value.set(L.gamma, L.lo); u.uClipFloor.value.set(...(L.floor || [0, 0, 0]));
        u.uStage.value.set(...(L.warm || [1, 1, 1]), L.dark ?? 1);
      });
      dirty = true;
    }
  };
}
