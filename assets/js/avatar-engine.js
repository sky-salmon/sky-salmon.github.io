/* sky-salmon — 3D Sky kid: the shared skeleton from assets/avatar/, outfit pieces rebound onto it by joint name,
 * the game's ramp / mask / dye colouring, clips, the carried prop, and the game's body-shape and attachment rules
 * (assets/js/avatar-rules.js). It has no renderer of its own: the height page's stage adds `kid.object` to its scene
 * and calls `kid.update(dt)` every frame.
 *
 *   const kid = await createAvatar()                        // loads index.json, the skeleton and the rules
 *   await kid.wearLook({ pieces: {slot: outfit|null}, dyes: {slot: [primary, secondary]}, clip, body: {height, scale} })
 *   kid.play(clip), kid.setBody({height, scale})          // change only the clip or the body shape
 *   kid.object, kid.update(dt), kid.headTop(), kid.body, kid.index, kid.rules */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export function hsvToRgb([h, s, v]) {
  s /= 100; v /= 100;
  const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return [f(5), f(3), f(1)];
}
// Dye / tint HSV is linear colour around a neutral of V 50 (DyeColorDefs "none" = 0,0,50; white_white = 85): scale by 2
// so "no dye" multiplies by 1. Checked against the game: black_black leaves cloth slate grey, the Robe tint turns its
// pale-peach ramp orange.
const hsvColor = h => new THREE.Color().setRGB(...hsvToRgb(h).map(x => 2 * x), THREE.LinearSRGBColorSpace);
const toSrgb = x => (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055);
/** CSS colour of a dye as it shows on white cloth. */
export const dyeCss = hsv => `rgb(${hsvToRgb(hsv).map(x => Math.round(255 * toSrgb(x))).join(',')})`;
const HEAD_TOP = 0.75;  // head bone → top of the skull, in head-bone units (measured on the bare kid: 14.86 vs 14.11)
const colorOf = c => (Array.isArray(c) ? (c.length === 3 && c.some(x => x > 1) ? hsvColor(c) : new THREE.Color(...c)) : new THREE.Color(1, 1, 1));

export async function createAvatar(opts = {}) {
  const BASE = opts.base || 'assets/avatar/';
  const scene = new THREE.Group();
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const load = url => new Promise((res, rej) => loader.load(url, res, undefined, rej));

  const IDX = await (await fetch(BASE + 'index.json', { cache: 'no-cache' })).json();
  const [rg, rules] = await Promise.all([load(BASE + IDX.skeleton), import('./avatar-rules.js').catch(() => null)]);
  const rig = rg.scene;
  scene.add(rig);
  const mixer = new THREE.AnimationMixer(rig);
  // Clean clips before use: bone translations other than the hip's don't decode reliably yet (chest/shoulders
  // pushed several times their length), so bones keep their skeleton lengths and only rotate. Cape bones are
  // held at their modelled pose (the game drives them with cloth, not with these keys): capes skin to the Wing
  // chains (front / side / back), a few to the cap bones.
  const CAPE = /^([LMR]_cap[BF](Root|Tip)|[LMR]_Wing[BFS](Root|Tip)(AUX)?)$/;
  function cleanClip(c) {
    c.tracks = c.tracks.filter(tr => {
      const i = tr.name.lastIndexOf('.'), bone = tr.name.slice(0, i), prop = tr.name.slice(i + 1);
      if (prop === 'position' && bone !== 'M_hip') return false;
      if (CAPE.test(bone)) return false;
      return true;
    });
    return c;
  }
  const clips = Object.fromEntries(rg.animations.map(c => [c.name, cleanClip(c)]));
  // In game cloth lets the cape hang out over the arms; at its modelled pose it reads narrow. Spread the side and
  // front chains outward a little (fitted to an in-game shot of the Robe: 15° sides, 6° front).
  {
    rig.updateMatrixWorld(true);
    const fwd = new THREE.Vector3(0, 0, 1), pq = new THREE.Quaternion();
    for (const [n, deg] of [['L_WingSRoot', -15], ['R_WingSRoot', 15], ['L_WingFRoot', -6], ['R_WingFRoot', 6]]) {
      const bn = rig.getObjectByName(n);
      if (!bn || !bn.parent) continue;
      bn.parent.getWorldQuaternion(pq);
      const spin = new THREE.Quaternion().setFromAxisAngle(fwd, deg * Math.PI / 180);
      bn.quaternion.premultiply(pq.clone().invert().multiply(spin).multiply(pq));
    }
  }
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
    // each wear makes its own material and skeleton (geometry and textures are shared and stay cached)
    const free = o => { if (o.material && o.material.dispose) o.material.dispose(); if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose(); };
    (w.obj.userData.attached || []).forEach(o => { o.traverse(free); if (o.parent) o.parent.remove(o); });
    w.obj.traverse(free);
    rig.remove(w.obj);
    delete worn[slot];
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
    if (!name) { unwear(slot); applyRules(); return; }
    const info = IDX.pieces[name];
    if (!info) { console.warn('not in index.json:', name); unwear(slot); applyRules(); return; }
    if (!info.file) { unwear(slot); worn[slot] = { name, obj: new THREE.Group() }; rig.add(worn[slot].obj); applyRules(); return; }  // "None" pieces
    let g;
    try {
      if (!gltfCache.has(name)) gltfCache.set(name, load(BASE + info.file));
      g = await gltfCache.get(name);
    } catch (e) { console.warn(e); gltfCache.delete(name); return; }
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
    applyRules();
    if (slot === 'prop') play(clipWanted);
  }
  const clipLoads = new Map();
  function ensureClip(id) {  // idle_<Attitude> and hold poses live in their own small GLBs (index.json clips[].file)
    if (clips[id]) return Promise.resolve(clips[id]);
    const def = IDX.clips.find(c => c.id === id);
    if (!def || !def.file || def.file === IDX.skeleton) return Promise.resolve(null);
    if (!clipLoads.has(def.file)) clipLoads.set(def.file, load(BASE + def.file).then(g => { g.animations.forEach(c => { clips[c.name] = cleanClip(c); }); }).catch(e => console.warn(e)));
    return clipLoads.get(def.file).then(() => clips[id] || null);
  }
  async function play(id, restart = false) {   // restart: run a one-shot clip again from its first frame
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
    if (action && action.getClip() === clip) { if (restart) action.reset().play(); return; }
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
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  function measureGround() {
    rig.position.y = 0; rig.updateMatrixWorld(true);
    // measured in the rig's parent space, so a hosted (scaled) rig grounds the same way
    const y = n => { const b = rig.getObjectByName(n); return b ? rig.parent.worldToLocal(b.getWorldPosition(v1)).y : NaN; };
    const toe = Math.min(y('L_toe'), y('R_toe')), hip = y('M_hip');
    const rootS = ((rig.getObjectByName('M_root') || rig).getWorldScale(v1).y / rig.parent.getWorldScale(v2).y) || 1;
    groundY = Number.isFinite(toe) && hip > 5.5 * rootS && toe > 0.25 * rootS ? 0.07 * rootS - toe : 0;
    rig.position.y = groundY; rig.updateMatrixWorld(true);
  }
  function setBody(b) {
    body = { height: +b.height || 0, scale: +b.scale || 0 };
    if (rules && rules.applyBodyShape) rules.applyBodyShape(THREE, rig, body);
    groundAt = performance.now() + 50;
  }
  // Resolves true when this look is the one now showing, false when a later wearLook() replaced it meanwhile.
  let lookGen = 0;
  async function wearLook(look) {
    const gen = ++lookGen;
    Object.keys(dyes).forEach(k => delete dyes[k]);
    Object.assign(dyes, look.dyes || {});
    const slots = new Set([...Object.keys(worn), ...Object.keys(look.pieces || {})]);
    await Promise.all([...slots].map(s => {
      const n = (look.pieces || {})[s] || null;
      if (n && worn[s] && worn[s].name === n) { loadToken[s] = (loadToken[s] || 0) + 1; applyDye(s); return null; }  // also drops an older load still on its way
      return wear(s, n);
    }));
    if (gen !== lookGen) return false;
    setBody(look.body || { height: 0, scale: 0 });
    await play(look.clip || 'idle');
    return gen === lookGen;
  }

  let frameRules = !!(rules && rules.updateAvatarFrame);   // switched off if it ever throws, rather than throwing every frame
  function update(dt) {
    if (rules && rules.restoreAvatarFrame) rules.restoreAvatarFrame(rig);
    mixer.update(Math.min(dt, 0.1));
    if (frameRules) { try { rules.updateAvatarFrame(THREE, rig); } catch (e) { console.warn('frame rules', e); frameRules = false; } }
    if (groundAt && performance.now() >= groundAt) { groundAt = 0; measureGround(); }
  }
  // height of the top of the head (not the hat) above the feet, in the units of the rig's parent
  function headTop() {
    rig.updateMatrixWorld(true);
    const h = rig.getObjectByName('M_head');
    if (!h) return 15;
    const y = rig.parent.worldToLocal(h.getWorldPosition(v1)).y;
    const s = h.getWorldScale(v2).y / rig.parent.getWorldScale(v1).y;
    return y + HEAD_TOP * s;
  }
  return { index: IDX, rules, object: scene, wearLook, play, setBody, update, headTop, get body() { return body; }, get notes() { return rulesNotes; } };
}
