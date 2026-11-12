/* candle·kit — 3D Sky kid: the shared skeleton from assets/avatar/, outfit pieces rebound onto it by joint name,
 * the game's ramp / mask / dye colouring, clips, held props, and (when assets/js/avatar-rules.js is present) the
 * game's body-shape and attachment rules. Used by wardrobe.html and the QR character page.
 *
 *   const kid = await createAvatar(canvas, { base: 'assets/avatar/', onStatus })
 *   await kid.wearLook({ pieces: {slot: outfit|null}, dyes: {slot: [primary, secondary]}, clip })
 *   await kid.wear(slot, outfit|null); kid.setDyes(slot, [p, s]); kid.play(clipId); kid.setBody({ height, scale })
 *   kid.index (index.json), kid.clips, kid.worn, kid.snapshot(bg) → PNG blob, kid.frame() re-centres the camera */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export function hsvToRgb([h, s, v]) {
  s /= 100; v /= 100;
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
const hsvColor = h => new THREE.Color().setRGB(...hsvToRgb(h), THREE.SRGBColorSpace);
const colorOf = c => (Array.isArray(c) ? (c.length === 3 && c.some(x => x > 1) ? hsvColor(c) : new THREE.Color(...c)) : new THREE.Color(1, 1, 1));

export async function createAvatar(canvas, opts = {}) {
  const BASE = opts.base || 'assets/avatar/';
  const status = opts.onStatus || (() => {});
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(-10, 20, -15); scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 500);
  camera.position.set(0, 9, -46);  // the kid faces -Z (Sky convention): front view from -Z
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 7.6, 0);
  controls.enableDamping = true; controls.minDistance = 10; controls.maxDistance = 120; controls.enablePan = false;
  controls.update();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));

  const IDX = await (await fetch(BASE + 'index.json', { cache: 'no-cache' })).json();
  const [rg, rules] = await Promise.all([load(BASE + IDX.skeleton), opts.rules === false ? null : import('./avatar-rules.js').catch(() => null)]);
  const rig = rg.scene;
  scene.add(rig);
  const mixer = new THREE.AnimationMixer(rig);
  // Clean clips before use: bone translations other than the hip's don't decode reliably yet (chest/shoulders
  // pushed several times their length), so bones keep their skeleton lengths and only rotate. Cape bones are
  // optionally held at their modelled pose (the game drives them with cloth, not with these keys).
  const CAPE = /^[LMR]_cap[BF](Root|Tip)$/;
  const holdCape = opts.capeFromClips !== true;
  function cleanClip(c) {
    c.tracks = c.tracks.filter(tr => {
      const i = tr.name.lastIndexOf('.'), bone = tr.name.slice(0, i), prop = tr.name.slice(i + 1);
      if (prop === 'position' && bone !== 'M_hip') return false;
      if (holdCape && CAPE.test(bone)) return false;
      return true;
    });
    return c;
  }
  const clips = Object.fromEntries(rg.animations.map(c => [c.name, cleanClip(c)]));
  const worn = {};          // slot → { name, obj }
  const dyes = {};          // slot → [primary, secondary]
  const gltfCache = new Map(), texCache = new Map(), loadToken = {};
  let action = null, clipWanted = 'idle', body = { height: 0, scale: 0 };

  function texture(name, srgb) {
    const def = name && IDX.textures && IDX.textures[name];
    if (!def) return Promise.resolve(null);
    const key = name + (srgb ? '|s' : '');
    if (!texCache.has(key)) texCache.set(key, new Promise(res => new THREE.TextureLoader().load(BASE + def.file, tx => {
      tx.flipY = false;                                   // glTF UV convention
      if (def.disableMips) { tx.magFilter = THREE.LinearFilter; tx.minFilter = THREE.LinearFilter; tx.generateMipmaps = false; }  // ramps: the game disables mips
      tx.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      res(tx);
    }, undefined, () => res(null))));
    return texCache.get(key);
  }
  // The game's Avatar.fs, reduced: rgb = ramp(uv0) · mix(colour0, 1, mask.b), then toward colour1 by mask.r (mask at uv1).
  async function skyMaterial(sh, fallback) {
    sh = sh || {};
    const [ramp, mask] = await Promise.all([texture(sh.ramp, true), texture(sh.mask, false)]);
    const u = {
      maskTex: { value: mask }, useMask: { value: mask ? 1 : 0 },
      colour0: { value: colorOf(sh.color0) }, colour1: { value: colorOf(sh.color1) }, useColour1: { value: sh.color1 ? 1 : 0 }
    };
    const m = new THREE.MeshStandardMaterial({ map: ramp || (fallback && fallback.map) || null, vertexColors: !ramp && !!(fallback && fallback.vertexColors),
      color: ramp || (fallback && fallback.map) ? 0xffffff : (fallback ? fallback.color : 0xdddddd), roughness: 0.85, side: THREE.DoubleSide });
    m.onBeforeCompile = s => {
      Object.assign(s.uniforms, u);
      s.vertexShader = s.vertexShader
        .replace('#include <uv_pars_vertex>', '#include <uv_pars_vertex>\n#ifndef USE_UV1\nattribute vec2 uv1;\n#endif\nvarying vec2 vMaskUv;')
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvMaskUv = uv1;');
      s.fragmentShader = s.fragmentShader
        .replace('#include <map_pars_fragment>', '#include <map_pars_fragment>\nuniform sampler2D maskTex; uniform float useMask, useColour1; uniform vec3 colour0, colour1; varying vec2 vMaskUv;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          vec4 mk = useMask > 0.5 ? texture2D(maskTex, vMaskUv) : vec4(0.0);
          diffuseColor.rgb *= mix(colour0, vec3(1.0), mk.b);
          diffuseColor.rgb = mix(diffuseColor.rgb, colour1, mk.r * useColour1);`);
    };
    m.userData.u = u;
    m.userData.sh = sh;
    return m;
  }
  const dyeDef = id => IDX.dyes.find(d => d.id === id);
  function applyDye(slot) {
    const w = worn[slot]; if (!w) return;
    const sh = (IDX.pieces[w.name] || {}).shader || {}, [p, s] = dyes[slot] || [];
    w.obj.traverse(o => {
      if (!o.material || !o.material.userData.u) return;
      const u = o.material.userData.u;
      u.colour0.value = p != null && dyeDef(p) ? hsvColor(dyeDef(p).hsv) : colorOf(sh.color0);
      if (s != null && dyeDef(s)) { u.colour1.value = hsvColor(dyeDef(s).hsv); u.useColour1.value = 1; }
      else { u.colour1.value = colorOf(sh.color1); u.useColour1.value = sh.color1 ? 1 : 0; }
    });
    (w.obj.userData.attached || []).forEach(a => a.traverse(o => {
      if (!o.material || !o.material.userData.u) return;
      o.material.userData.u.colour0.value = p != null && dyeDef(p) ? hsvColor(dyeDef(p).hsv) : colorOf(sh.color0);
    }));
  }
  function unwear(slot) {
    const w = worn[slot]; if (!w) return;
    (w.obj.userData.attached || []).forEach(o => o.parent && o.parent.remove(o));
    rig.remove(w.obj);
    delete worn[slot];
  }
  // pieces can hide other slots (a one-piece outfit covers the shoes, …)
  function updateHidden() {
    const hidden = new Set();
    Object.values(worn).forEach(w => ((IDX.pieces[w.name] || {}).hides || []).forEach(s => hidden.add(s)));
    Object.entries(worn).forEach(([s, w]) => { w.obj.visible = !hidden.has(s); (w.obj.userData.attached || []).forEach(o => { o.visible = !hidden.has(s); }); });
  }
  let rulesNotes = [];
  // assets/js/avatar-rules.js (read from the game code): offsets between slots, hat→hair clipping, the carried prop.
  // It wants each slot's SkinnedMesh (or, for the prop, the prop's root object).
  function applyRules() {
    if (!rules || !rules.applyPieceRules) return;
    const view = {};
    for (const [slot, w] of Object.entries(worn)) {
      let obj = null;
      if (slot === 'prop') obj = (w.obj.userData.attached || [])[0] || null;
      else w.obj.traverse(o => { if (!obj && o.isSkinnedMesh) obj = o; });
      view[slot] = { name: w.name, obj };
    }
    try { rulesNotes = rules.applyPieceRules(THREE, rig, view, IDX) || []; } catch (e) { console.warn('piece rules', e); }
  }
  async function wear(slot, name) {
    const token = (loadToken[slot] = (loadToken[slot] || 0) + 1);
    if (!name) { unwear(slot); updateHidden(); applyRules(); return; }
    const info = IDX.pieces[name];
    if (!info) { console.warn('not in index.json:', name); unwear(slot); applyRules(); return; }
    if (!info.file) { unwear(slot); worn[slot] = { name, obj: new THREE.Group() }; rig.add(worn[slot].obj); updateHidden(); applyRules(); return; }  // "None" pieces
    status('loading', name);
    let g;
    try {
      if (!gltfCache.has(name)) gltfCache.set(name, load(BASE + info.file));
      g = await gltfCache.get(name);
    } catch (e) { console.warn(e); gltfCache.delete(name); status('error', name); return; }
    if (loadToken[slot] !== token) return;  // another piece was picked meanwhile
    const root = new THREE.Group();
    const meshes = [];
    g.scene.updateMatrixWorld(true);
    g.scene.traverse(o => { if (o.isMesh) meshes.push(o); });
    for (const src of meshes) {
      const mat = await skyMaterial(info.shader, src.material);
      if (loadToken[slot] !== token) return;
      let obj;
      if (src.isSkinnedMesh) {  // rebind the piece's skin to the shared rig's bones, matched by joint name
        obj = new THREE.SkinnedMesh(src.geometry, mat);
        src.matrixWorld.decompose(obj.position, obj.quaternion, obj.scale);  // keeps the dequantisation transform
        root.add(obj);
        obj.updateMatrixWorld(true);
        const bones = src.skeleton.bones.map(b => rig.getObjectByName(b.name) || rig.getObjectByName('M_root'));
        obj.bind(new THREE.Skeleton(bones, src.skeleton.boneInverses), obj.matrixWorld);
      } else {  // a held (or placed) prop: parented to a bone, or to the rig
        obj = new THREE.Group();
        const m = new THREE.Mesh(src.geometry, mat);
        src.matrixWorld.decompose(m.position, m.quaternion, m.scale);
        obj.add(m);
        const p = (info.prop && (rules || info.prop.mode !== 'back' ? info.prop : info.prop.held)) || {};
        obj.position.fromArray(p.position || [0, 0, 0]);
        if (p.rotation) (p.rotation.length === 4 ? obj.quaternion.fromArray(p.rotation) : obj.rotation.fromArray(p.rotation));
        if (Array.isArray(p.scale)) obj.scale.fromArray(p.scale); else if (p.scale != null) obj.scale.setScalar(p.scale);
        (p.mode === 'ground' ? rig : (rig.getObjectByName(p.bone || 'L_hand') || rig)).add(obj);
        root.userData.attached = (root.userData.attached || []).concat(obj);
      }
      obj.frustumCulled = false;
    }
    unwear(slot);
    rig.add(root);
    worn[slot] = { name, obj: root };
    applyDye(slot);
    updateHidden();
    applyRules();
    if (slot === 'prop') play(clipWanted);
    status('ready', name);
  }
  const clipLoads = new Map();
  function ensureClip(id) {  // idle_<Attitude> and hold poses live in their own small GLBs (index.json clips[].file)
    if (clips[id]) return Promise.resolve(clips[id]);
    const def = IDX.clips.find(c => c.id === id);
    if (!def || !def.file || def.file === IDX.skeleton) return Promise.resolve(null);
    if (!clipLoads.has(def.file)) clipLoads.set(def.file, load(BASE + def.file).then(g => { g.animations.forEach(c => { clips[c.name] = cleanClip(c); }); }).catch(e => console.warn(e)));
    return clipLoads.get(def.file).then(() => clips[id] || null);
  }
  async function play(id) {
    clipWanted = id || 'idle';
    // a prop held in the hands brings its hold pose (props carried on the back don't)
    const prop = worn.prop && IDX.pieces[worn.prop.name];
    const hold = prop && prop.prop && (rules ? prop.prop.mode === 'held' : true) && (prop.prop.holdClip || (prop.prop.held || {}).holdClip);
    const idleLike = /^idle/.test(clipWanted);
    const clipId = idleLike && hold ? hold : clipWanted;
    await ensureClip(clipId);
    if ((clipWanted || 'idle') !== (id || 'idle')) return;
    const clip = clips[clipId] || clips.idle || Object.values(clips)[0];
    if (!clip) return;
    if (action && action.getClip() === clip) return;
    if (action) action.fadeOut(0.25);
    if (rules && rules.restoreAvatarFrame) rules.restoreAvatarFrame(rig);  // the mixer must bind the plain pose
    action = mixer.clipAction(clip);
    const def = IDX.clips.find(c => c.id === clip.name);
    action.reset().setLoop(def && def.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = true;
    action.fadeIn(0.25).play();
    groundAt = performance.now() + 350;  // re-measure the feet once the fade is over
  }
  // Some clip packs keep the hip ~1 unit higher than the skeleton they were exported with, so standing poses
  // float. After a clip settles, put the lower toe back on the ground (sitting / kneeling poses are left alone).
  let groundAt = 0, groundY = 0;
  const v1 = new THREE.Vector3();
  function measureGround() {
    rig.position.y = 0; rig.updateMatrixWorld(true);
    const y = n => { const b = rig.getObjectByName(n); return b ? b.getWorldPosition(v1).y : NaN; };
    const toe = Math.min(y('L_toe'), y('R_toe')), hip = y('M_hip');
    const rootS = (rig.getObjectByName('M_root') || rig).getWorldScale(v1).y || 1;
    groundY = Number.isFinite(toe) && hip > 5.5 * rootS && toe > 0.25 * rootS ? 0.07 * rootS - toe : 0;
    rig.position.y = groundY; rig.updateMatrixWorld(true);
  }
  function setDyes(slot, v) { dyes[slot] = v; applyDye(slot); }
  function setBody(b) {
    body = { height: +b.height || 0, scale: +b.scale || 0 };
    if (rules && rules.applyBodyShape) rules.applyBodyShape(THREE, rig, body);
    groundAt = performance.now() + 50;
  }
  async function wearLook(look) {
    Object.keys(dyes).forEach(k => delete dyes[k]);
    Object.assign(dyes, look.dyes || {});
    const slots = new Set([...Object.keys(worn), ...Object.keys(look.pieces || {})]);
    await Promise.all([...slots].map(s => {
      const n = (look.pieces || {})[s] || null;
      if (n && worn[s] && worn[s].name === n) { applyDye(s); return null; }
      return wear(s, n);
    }));
    setBody(look.body || { height: 0, scale: 0 });
    await play(look.clip || 'idle');
    if (opts.autoFrame !== false) {  // after the pose and the rules have run for a couple of frames
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      frame(opts.view || 'front');
    }
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / Math.max(1, r.height);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    if (rules && rules.restoreAvatarFrame) rules.restoreAvatarFrame(rig);
    mixer.update(Math.min(clock.getDelta(), 0.1));
    if (rules && rules.updateAvatarFrame) { try { rules.updateAvatarFrame(THREE, rig); } catch (e) { console.warn('frame rules', e); rules.updateAvatarFrame = null; } }
    if (groundAt && performance.now() >= groundAt) { groundAt = 0; measureGround(); }
    controls.update();
    renderer.render(scene, camera);
  });
  // camera that fits the kid as it is now (height changes how tall it is): front / side / back / head
  const tmp = new THREE.Vector3();
  function frame(view = 'front') {
    rig.updateMatrixWorld(true);
    const head = rig.getObjectByName('M_head');
    const headY = head ? head.getWorldPosition(tmp).y : 12;
    let top = headY + 3.2;                            // hair / hats reach above the head bone: measure the posed meshes
    const box = new THREE.Box3();
    Object.entries(worn).forEach(([slot, w]) => { if (slot !== 'prop' && w.obj.visible) w.obj.traverse(o => { if (o.isSkinnedMesh) { o.computeBoundingBox(); box.union(o.boundingBox.clone().applyMatrix4(o.matrixWorld)); } }); });
    if (!box.isEmpty() && box.max.y > top && box.max.y < headY + 15) top = box.max.y;
    top += 1.5;  // the bone hooks (offsets, height stretch) aren't in computeBoundingBox: leave room
    const fov = THREE.MathUtils.degToRad(camera.fov);
    if (view === 'head') {
      controls.target.set(0, headY + 0.5, 0);
      const d = 4.5 / Math.tan(fov / 2);
      camera.position.set(-d * 0.35, headY + 1.5, -d * 0.94);
    } else {
      // fit 0…top with room for the buttons drawn over the top and bottom of the stage
      const half = top / 2 * 1.22, d = Math.max(half / Math.tan(fov / 2), half / Math.tan(fov / 2) / Math.min(1, camera.aspect));
      const cy = top / 2 - top * 0.02;
      controls.target.set(0, cy, 0);
      const dir = { front: [0, -1], side: [1, 0], back: [0, 1], threeq: [-0.6, -0.8] }[view] || [0, -1];
      camera.position.set(dir[0] * d, cy + top * 0.06, dir[1] * d);
    }
    controls.update();
  }
  function snapshot(bg = ['#2a3331', '#111312']) {
    const w = canvas.width, h = canvas.height, c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(w / 2, h * 0.35, 10, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, bg[0]); grad.addColorStop(1, bg[1]);
    g.fillStyle = grad; g.fillRect(0, 0, w, h);
    g.drawImage(canvas, 0, 0);
    return new Promise(res => c.toBlob(res, 'image/png'));
  }
  return { THREE, index: IDX, rig, clips, worn, dyes, camera, controls, scene, renderer, rules, wear, wearLook, play, setDyes, setBody,
    snapshot, frame, get body() { return body; }, get notes() { return rulesNotes; } };
}
