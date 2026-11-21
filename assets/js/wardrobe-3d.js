/* sky-salmon — the 圖鑑's 3D try-on stage: the Sky kid from avatar-engine.js on a small dusk stage, turned by
 * dragging. Imported by wardrobe.js only for visitors the 3D feature is open to.
 *
 *   const stage = await mountStage(canvas)
 *   await stage.wear(look)     // { pieces: {slot: name|null}, dyes, clip }  (avatar-engine wearLook)
 *   stage.play(clip)           // once, then back to idle; stage.index = assets/avatar/index.json */
import * as THREE from 'three';
import { createAvatar } from './avatar-engine.js';

const KID_UNITS = 15.557, KID_H = 2.2;      // the default kid's head top in game units → 2.2 on this stage (as elsewhere)

export async function mountStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  // the site's dusk light (as on the height page): warm sky, a soft key from the front, warm rims from behind
  scene.add(new THREE.HemisphereLight('#e6d2b0', '#3a3122', 1.0));
  const key = new THREE.DirectionalLight('#ffe2c2', 1.25); key.position.set(-4, 6, 8); scene.add(key);
  const rimR = new THREE.DirectionalLight('#ffa860', 2.6); rimR.position.set(5, 4, -6); scene.add(rimR);
  const rimL = new THREE.DirectionalLight('#ffc27a', 1.8); rimL.position.set(-6, 5, -6); scene.add(rimL);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.15, 48), new THREE.MeshBasicMaterial({ color: '#f3d9a0', transparent: true, opacity: 0.14 }));
  disc.rotation.x = -Math.PI / 2; scene.add(disc);

  const turner = new THREE.Group(), holder = new THREE.Group();
  holder.scale.setScalar(KID_H / KID_UNITS);
  holder.rotation.y = Math.PI;                 // Sky kids face −Z; the camera looks from +Z
  turner.add(holder); scene.add(turner);
  const kid = await createAvatar({ base: new URL('../avatar/', import.meta.url).href });
  holder.add(kid.object);

  // drag to turn (with a little glide), a slow drift back toward the front when left alone
  let yaw = -0.35, vel = 0, grab = null, idleSince = 0;
  canvas.addEventListener('pointerdown', e => { if (e.button > 0) return; grab = { x: e.clientX, yaw, last: e.clientX, t: performance.now() }; vel = 0; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', e => {
    if (!grab) return;
    const now = performance.now(), dx = e.clientX - grab.last;
    yaw = grab.yaw + (e.clientX - grab.x) * 0.012;
    vel = dx * 0.012 / Math.max(8, now - grab.t) * 16; grab.last = e.clientX; grab.t = now;
  });
  const release = () => { grab = null; idleSince = performance.now(); };
  canvas.addEventListener('pointerup', release); canvas.addEventListener('pointercancel', release);

  function resize() {
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 300;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // fit the kid with a wide cape or a held prop: about 2.9 tall and 2.3 wide in view
    const fitH = 2.9, fitW = 2.3, vfov = THREE.MathUtils.degToRad(camera.fov);
    const dist = Math.max(fitH / 2 / Math.tan(vfov / 2), fitW / 2 / Math.tan(vfov / 2) / camera.aspect);
    camera.position.set(0, 1.25, dist); camera.lookAt(0, 1.08, 0);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();

  // render only while the stage is on screen and the tab is visible
  let onScreen = true, last = performance.now(), frames = 0;
  new IntersectionObserver(es => { onScreen = es[0].isIntersecting; }).observe(canvas);
  function frame(now) {
    requestAnimationFrame(frame);
    if (!onScreen || document.hidden) { last = now; return; }
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (!grab) {
      yaw += vel; vel *= 0.92;
      if (Math.abs(vel) < 1e-4 && now - idleSince > 4000) yaw += (-0.35 - yaw) * 0.01;   // drift back to a three-quarter view
    }
    turner.rotation.y = yaw;
    kid.update(dt);
    renderer.render(scene, camera);
    frames++;
    window.__wardrobeStage = { frames, ready: true };
  }
  requestAnimationFrame(frame);

  return {
    index: kid.index,
    rules: kid.rules,
    wear: look => kid.wearLook(look),
    play: id => kid.play(id, true, 'idle'),
  };
}
