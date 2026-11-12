// avatar-rules.js — Sky: Children of the Light kid assembly rules (used by avatar-engine.js for the height page's character).
// Dependency-free ES module: pass THREE in, nothing is imported.
//
// Every rule below was read out of the game's native code (libBootloader.so, Sky 0.35.2, arm64) unless it says
// "inferred". Function addresses are given so the next game update can be re-checked.
//
// Per-frame use (after the AnimationMixer has posed the rig):
//   applyBodyShape(THREE, rig, { height, scale });      // whenever the values change
//   applyPieceRules(THREE, rig, worn, index);            // whenever the worn set changes
//   mixer.update(dt); updateAvatarFrame(THREE, rig);     // every frame, AFTER mixer.update
// rig = skeleton.glb's scene (bones are Object3Ds named like the game bones).
// worn = { slot: { name, obj } } where obj is the piece's SkinnedMesh (rebound to the rig) or, for the prop slot,
// the prop GLB's root Object3D (applyPieceRules parents it to the right bone).

// ───────────────────────── outfit QR ─────────────────────────

// slot keys of the compact QR JSON (FUN_0256dde4 key table; slot enum order body,wing,hair,mask,neck,feet,horn,
// face,prop,hat — the same order as the game's kOutfitSlot_* enum)
export const QR_SLOT_KEYS = { b: 'outfit', w: 'cape', h: 'hair', ms: 'mask', n: 'neck', f: 'shoes', hn: 'horn',
  fc: 'face', p: 'prop', ht: 'hat' };
// non-slot QR keys (long names in the uncompressed outfit JSON, FUN_01a6d47c): h=height, s=scale, v=voice,
// a=attitude, e=seed, r=refreshversion
export const ATTITUDES = ['Neutral', 'ColdWind', 'HandsOut', 'Proud', 'Sneaky', 'Tough', 'Solemn', 'Sassy', 'Lazy',
  'Wise', 'Timid', 'Nerdy', 'Injured', 'Sad', 'Guard'];

export function lz4BlockDecode(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const token = src[i++];
    let lit = token >> 4;
    if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255); }
    for (let k = 0; k < lit; k++) out.push(src[i++]);
    if (i >= src.length) break;               // last sequence has literals only
    const off = src[i] | (src[i + 1] << 8); i += 2;
    let len = token & 15;
    if (len === 15) { let b; do { b = src[i++]; len += b; } while (b === 255); }
    len += 4;
    let p = out.length - off;
    if (off <= 0 || p < 0) throw new Error('lz4: bad offset');
    for (let k = 0; k < len; k++) out.push(out[p++]);
  }
  return new Uint8Array(out);
}

function b64ToBytes(s) {
  s = s.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, '');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return u;
}

// text: the QR text ("https://sky.thatg.co/o=<base64>") or just the base64 part.
// names: { "<fnv1a32>": "CharSkyKid_..." } (assets/avatar/qr-names.json) — ids not in it come back as "#<id>".
export function decodeOutfitQR(text, names = {}) {
  const m = String(text).match(/o=([A-Za-z0-9+/=_-]+)/);
  const bytes = lz4BlockDecode(b64ToBytes(m ? m[1] : String(text)));
  let json = new TextDecoder().decode(bytes);
  json = json.replace(/"h":\s*\[/, '"hair":[');   // the hair slot and the height share the key "h"
  const raw = JSON.parse(json);
  const pieces = {}, dyes = {}, parts = {};
  for (const [k, slot] of Object.entries(QR_SLOT_KEYS)) {
    const arr = k === 'h' ? raw.hair : raw[k];
    if (!Array.isArray(arr)) continue;
    const id = arr[0] >>> 0;
    pieces[slot] = id ? (names[String(id)] || `#${id}`) : null;
    parts[slot] = { tex: arr[1], pattern: arr[2], mask: arr[3] };
    const d = typeof arr[4] === 'string' ? arr[4].match(/^\(?([^,()]*),([^,()]*)\)?$/) : null;
    const clean = v => (!v || v === '-' || v === 'none') ? null : v;
    dyes[slot] = d ? [clean(d[1]), clean(d[2])] : [null, null];
  }
  return {
    pieces, dyes, parts,
    height: typeof raw.h === 'number' ? raw.h : 0,
    scale: typeof raw.s === 'number' ? raw.s : 0,
    attitude: Number.isInteger(raw.a) ? raw.a : 0, attitudeName: Number.isInteger(raw.a) ? ATTITUDES[raw.a] ?? null : null,
    voice: raw.v ?? null, seed: raw.e ?? null, refreshVersion: raw.r ?? null,
    raw,
  };
}

// ───────────────────────── height / scale ─────────────────────────

// FUN_00fe7508 + table @0x2e01ee8: per-bone [posX,posY,posZ, negX,negY,negZ] factors, chosen by sign(height).
// stretch(bone) = 1 + factor * 0.18 * height   (non-inherited "axis stretch", see updateAvatarFrame)
const HEIGHT_FACTORS = {
  M_hip: [0.25, 1.0, 0.1, 0.5, 0.5, 0.05],
  L_legRoot: [0.4, 0.5, 0.5, 0.6, 0.1, 0.1], L_knee: [0.5, 0.5, 0.5, 0.6, 0.1, 0.1],
  L_foot: [0.5, 0.0, 0.0, 0.5, 0.1, 0.1], L_toe: [0.5, 0.5, 0.5, 0.5, 0.1, 0.1],
  M_spine: [1.0, 1.0, 0.0, 1.0, 0.1, 0.1], M_chest: [0.0, 0.5, 0.2, 0.4, 0.5, 0.3],
  M_neckRoot: [0.35, 0.5, 0.5, 0.35, 0.25, 0.25], M_neckTop: [0.15, 0.0, 0.0, 0.25, 0.0, 0.0],
  M_head: [0.2, 0.0, 0.0, 0.25, 0.0, 0.0], M_headAUX: [0.2, 0.0, 0.0, 0.25, 0.0, 0.0],
  M_hairCenter: [0.2, 0.2, 0.2, 0.0, 0.0, 0.0], M_hairCenterAUX: [0.2, 0.2, 0.2, 0.0, 0.0, 0.0],
  L_shoulder: [0.2, 0.0, 0.0, 0.7, 0.0, 0.0], L_armRoot: [0.4, 0.6, 0.6, 0.55, 0.1, 0.1],
  L_elbow: [0.4, 0.6, 0.6, 0.55, 0.1, 0.1], L_hand: [0.5, 0.0, 0.0, 0.5, 0.0, 0.0],
  R_shoulder: [0.2, 0.0, 0.0, 0.7, 0.0, 0.0], R_armRoot: [0.4, 0.6, 0.6, 0.55, 0.1, 0.1],
  R_elbow: [0.4, 0.6, 0.6, 0.55, 0.1, 0.1], R_hand: [0.5, 0.0, 0.0, 0.5, 0.0, 0.0],
  L_capBRoot: [1, 0, 0, 0.5, 0, 0], L_capBTip: [1, 0, 0, 0.5, 0, 0], L_capFRoot: [1, 0, 0, 0.5, 0, 0],
  L_capFTip: [1, 0, 0, 0.5, 0, 0], R_capBRoot: [1, 0, 0, 0.5, 0, 0], R_capBTip: [1, 0, 0, 0.5, 0, 0],
  R_capFRoot: [1, 0, 0, 0.5, 0, 0], R_capFTip: [1, 0, 0, 0.5, 0, 0], M_capFRoot: [1, 0, 0, 0.5, 0, 0],
  M_capFTip: [1, 0, 0, 0.5, 0, 0], M_capBRoot: [1, 0, 0, 0.5, 0, 0], M_capBTip: [1, 0, 0, 0.5, 0, 0],
  R_legRoot: [0.4, 0.5, 0.5, 0.6, 0.1, 0.1], R_knee: [0.5, 0.5, 0.5, 0.6, 0.1, 0.1],
  R_foot: [0.5, 0.0, 0.0, 0.5, 0.1, 0.1], R_toe: [0.5, 0.5, 0.5, 0.5, 0.1, 0.1],
  M_chestWing: [0.0, 0.0, 0.0, 0.1, 0.1, 0.1], M_WingBRootAUX: [0.4, 0.0, 0.8, 0.5, 1.2, 1.0],
  L_WingBRootAUX: [0.2, 0.0, 0.2, -0.2, 0.0, 0.2], L_WingSRootAUX: [0.2, 0.0, 0.2, 0.75, 0.0, 0.3],
  L_WingFRootAUX: [0.2, 0.0, 0.2, 0.75, 0.0, 0.0], R_WingBRootAUX: [0.2, 0.0, 0.2, -0.2, 0.0, 0.2],
  R_WingSRootAUX: [0.2, 0.0, 0.2, 0.75, 0.0, 0.3], R_WingFRootAUX: [0.2, 0.0, 0.2, 0.75, 0.0, 0.0],
  M_WingBRoot: [0.25, 0.25, 0.25, 0.25, 0.25, 0.25],
  L_WingBRoot: [0.8, 0.5, 0.5, 0.25, 0.1, 0.1], L_WingSRoot: [0.8, 0.5, 0.5, 0.25, 0.1, 0.1],
  L_WingFRoot: [0.8, 0.8, 0.5, 0.25, 0.1, 0.1], R_WingBRoot: [0.8, 0.5, 0.5, 0.25, 0.1, 0.1],
  R_WingSRoot: [0.8, 0.5, 0.5, 0.25, 0.1, 0.1], R_WingFRoot: [0.8, 0.8, 0.5, 0.25, 0.1, 0.1],
  M_WingBTip: [0.5, 0.8, 0.8, 0.2, 0.02, 0.02], L_WingBTip: [0.5, 0.8, 0.8, 0.2, 0.02, 0.02],
  L_WingSTip: [0.5, 0.8, 0.8, 0.2, 0.02, 0.02], L_WingFTip: [0.5, 0.8, 0.8, 0.4, 0.2, 0.2],
  R_WingBTip: [0.5, 0.8, 0.8, 0.2, 0.02, 0.02], R_WingSTip: [0.5, 0.8, 0.8, 0.2, 0.02, 0.02],
  R_WingFTip: [0.5, 0.8, 0.8, 0.4, 0.2, 0.2],
};
export const HEIGHT_RANGE = [-2, 2];      // community-observed range; the client code applies no clamp
export const SCALE_RANGE = [-0.2, 0.2];   // community-observed range; no clamp in code either

function state(rig) {
  if (!rig.userData.skyRules) {
    const bones = {};
    rig.traverse(o => { if (o.name) bones[o.name] = o; });
    rig.userData.skyRules = { bones, height: 0, scale: 0, stretch: {}, worn: {}, acc: null, slotMats: {},
      chan: new Map(), hooked: new WeakSet(), clip: null };
  }
  return rig.userData.skyRules;
}

export function applyBodyShape(THREE, rig, { height = 0, scale = 0 } = {}) {
  const st = state(rig);
  st.height = Number(height) || 0;
  st.scale = Number(scale) || 0;
  const hh = 0.18 * st.height;
  st.stretch = {};
  for (const [name, f] of Object.entries(HEIGHT_FACTORS)) {
    const k = st.height > 0 ? f.slice(0, 3) : f.slice(3, 6);
    st.stretch[name] = new THREE.Vector3(1 + k[0] * hh, 1 + k[1] * hh, 1 + k[2] * hh);
  }
  st.hipFactor = Math.sqrt(Math.max(0, 1 + hh));   // M_hip translation.y *= sqrt(1 + 0.18 h)
  st.rootScale = 1 + 0.18 * st.scale;               // FUN_00fe6930: M_root scale *= 1 + 0.18 s
  return { stretch: Object.keys(st.stretch).length, hipFactor: st.hipFactor, rootScale: st.rootScale };
}

// ───────────────────────── outfit offsets ─────────────────────────

const SLOT_TO_TYPE = { outfit: 'body', cape: 'wing', hair: 'hair', mask: 'mask', neck: 'neck', shoes: 'feet',
  horn: 'horn', face: 'face', prop: 'prop', hat: 'hat' };
const TYPE_ENUM = { body: 0, wing: 1, hair: 2, mask: 3, neck: 4, feet: 5, horn: 6, face: 7, prop: 8, hat: 9 };
const v3 = (a, d = [0, 0, 0]) => (Array.isArray(a) ? a : d).slice(0, 3).map(Number);
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const len2 = a => a[0] * a[0] + a[1] * a[1] + a[2] * a[2];

// FUN_0125e508: combine the offsets of every worn piece. A piece's own *Offset usually moves OTHER slots:
//   hair: moved by hairOffset/hairScale of every slot except hair & hat (applied to bone M_hairCenter)
//   mask: moved by maskOffset/maskScale of every slot except mask & face (bones M_headAUX and M_head)
//   cape: moved by wingOffset/wingScale of every slot except cape & neck (M_chestWing; wingScale.y on wing roots)
//   neck: neckOffset of others, masked per axis by the neck item's own neckOffset (0/1 flags), scale neckScale
//   hat:  the HAIR item's hairOffset, masked by the hat's hairOffset flags; scale = hair's hairScale
//   face: the MASK item's maskOffset, masked by the face item's maskOffset flags
//   prop: propOffset / propRot summed and propScale multiplied over all slots
export function combineOffsets(entries) {
  const A = { hairScale: 1, hairOff: [0, 0, 0], maskScale: 1, maskOff: [0, 0, 0], wingScale: [1, 1, 1],
    wingOff: [0, 0, 0], neckScaleOthers: 1, neckOffOthers: [0, 0, 0], propScale: 1, propOff: [0, 0, 0],
    propRot: [0, 0, 0], hairOwnScale: 1, hairOwnOff: [0, 0, 0], maskOwnOff: [0, 0, 0],
    hatScale: 1, hatOff: [0, 0, 0], neckScale: 1, neckOff: [0, 0, 0], faceOff: [0, 0, 0], hornOff: [0, 0, 0] };
  for (const e of entries) {
    const t = TYPE_ENUM[e.type], o = e.offsets || {};
    const hairScale = o.hairScale ?? 1, maskScale = o.maskScale ?? 1, neckScale = o.neckScale ?? 1;
    const propScale = o.propScale ?? 1;
    const wingScale = Array.isArray(o.wingScale) ? v3(o.wingScale, [1, 1, 1]) : [1, 1, 1];
    let doMaskAcc = true, doWing = true, doNeck = true;
    if (t === 9) { /* hat: no hair contribution */ }
    else if (t === 2) { A.hairOwnScale *= hairScale; A.hairOwnOff = add(A.hairOwnOff, v3(o.hairOffset)); }
    else {
      A.hairScale *= hairScale; A.hairOff = add(A.hairOff, v3(o.hairOffset));
      if (t === 7) doMaskAcc = false;                                       // face: skips mask accumulation
      if (t === 3) { A.maskOwnOff = add(A.maskOwnOff, v3(o.maskOffset)); doMaskAcc = false; } // mask: own only
    }
    if (doMaskAcc) {
      A.maskScale *= maskScale; A.maskOff = add(A.maskOff, v3(o.maskOffset));
      if (t === 1) doWing = false;                                          // cape: skips wing accumulation
      if (t === 4) { doWing = false; doNeck = false; }                      // neck: prop only
    }
    if (doWing) { A.wingScale = mul(A.wingScale, wingScale); A.wingOff = add(A.wingOff, v3(o.wingOffset)); }
    if (doNeck) { A.neckScaleOthers *= neckScale; A.neckOffOthers = add(A.neckOffOthers, v3(o.neckOffset)); }
    A.propScale *= propScale; A.propOff = add(A.propOff, v3(o.propOffset)); A.propRot = add(A.propRot, v3(o.propRot));
  }
  for (const e of entries) {                                                // second pass
    const t = TYPE_ENUM[e.type], o = e.offsets || {};
    if (t === 4) { A.neckOff = add(A.neckOff, mul(v3(o.neckOffset), A.neckOffOthers)); A.neckScale *= A.neckScaleOthers; }
    else if (t === 6) { /* horn: maskOffset * 0 — no own offset */ }
    else if (t === 9) { A.hatOff = add(A.hatOff, mul(v3(o.hairOffset), A.hairOwnOff)); A.hatScale *= A.hairOwnScale; }
    else if (t === 7) { A.faceOff = add(A.faceOff, mul(v3(o.maskOffset), A.maskOwnOff)); }
  }
  return A;
}

// FUN_01252f0c: whole-piece matrix (scale s, translation t) applied in the attach bone's local frame
// (FUN_01262100: neck→M_neckRoot, horn→M_headAUX, face→M_headAUX, hat→M_hairCenterAUX)
function slotMatrix(slot, A, entry) {
  const o = (entry && entry.offsets) || {};
  if (slot === 'hat') return { bone: 'M_hairCenterAUX', s: A.hairScale * A.hatScale,
    t: add(A.hairOff, A.hatOff.map(v => v / A.hatScale)) };
  if (slot === 'neck') return { bone: 'M_neckRoot', s: A.neckScale * A.neckScale,
    t: A.neckOff.map(v => v / A.neckScale) };
  if (slot === 'horn') return len2(v3(o.maskOffset)) > 0
    ? { bone: 'M_headAUX', s: A.maskScale, t: add(A.maskOff, A.hornOff) } : null;
  if (slot === 'face') return len2(v3(o.maskOffset)) > 0
    ? { bone: 'M_headAUX', s: A.maskScale, t: add(A.maskOff, A.faceOff) }
    : (len2(A.faceOff) > 0 ? { bone: 'M_headAUX', s: 1, t: A.faceOff } : null);
  return null;
}

// carried prop (FUN_0128d2c8, back branch): child of M_WingBRoot, position = Σ propOffset (bone-local),
// rotation = Rz·Ry·Rx(Σ propRot°) · F with F = columns (-e1, -e0, -e2), uniform scale = Π propScale
function carriedPropTransform(THREE, A) {
  const [x, y, z] = A.propRot.map(d => d * Math.PI / 180);
  const cx = Math.cos(x), sx = Math.sin(x), cy = Math.cos(y), sy = Math.sin(y), cz = Math.cos(z), sz = Math.sin(z);
  const c0 = [cz * cy, sz * cy, -sy];
  const c1 = [cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx];
  const c2 = [cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx];
  const m = new THREE.Matrix4().set(
    -c1[0], -c0[0], -c2[0], 0,
    -c1[1], -c0[1], -c2[1], 0,
    -c1[2], -c0[2], -c2[2], 0,
    0, 0, 0, 1);
  return { position: new THREE.Vector3(...A.propOff), quaternion: new THREE.Quaternion().setFromRotationMatrix(m),
    scale: A.propScale };
}

// Hat → hair clipping (clippingParams). Planes are defined in a bone's local frame; the hair shader drops
// fragments on the inner side of a plane within its radius. Sign/union semantics are inferred (shader not
// decompiled) — see notes.
// A material is patched once and keeps one set of uniform holders for its whole life: the compiled program holds on
// to the objects it was built with, so later looks write new values into the same holders (count 0 = no clipping).
function hairClipUniforms(THREE, mat) {
  if (mat.userData.skyClipUniforms) return mat.userData.skyClipUniforms;
  const uniforms = { skyClipCount: { value: 0 },
    skyClipO: { value: [0, 1, 2].map(() => new THREE.Vector3()) },
    skyClipN: { value: [0, 1, 2].map(() => new THREE.Vector3()) }, skyClipR2: { value: [0, 0, 0] } };
  const prev = mat.onBeforeCompile;
  mat.userData.skyClipUniforms = uniforms;
  mat.onBeforeCompile = (sh, r) => {
    if (prev) prev.call(mat, sh, r);
    Object.assign(sh.uniforms, mat.userData.skyClipUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vSkyClipPos;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvSkyClipPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vSkyClipPos;
uniform int skyClipCount; uniform vec3 skyClipO[3]; uniform vec3 skyClipN[3]; uniform float skyClipR2[3];`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
for (int i = 0; i < 3; i++) {
  if (i >= skyClipCount) break;
  vec3 d = vSkyClipPos - skyClipO[i];
  if (dot(d, d) < skyClipR2[i] && dot(d, skyClipN[i]) < 0.0) discard;
}`);
  };
  const prevKey = mat.customProgramCacheKey ? mat.customProgramCacheKey.bind(mat) : () => '';
  mat.customProgramCacheKey = () => prevKey() + '|skyclip';
  mat.needsUpdate = true;
  return uniforms;
}

// worn: { slot: { name, obj } }, index: assets/avatar/index.json
export function applyPieceRules(THREE, rig, worn, index) {
  const st = state(rig), notes = [];
  st.worn = worn;
  const entries = [];
  for (const [slot, w] of Object.entries(worn)) {
    const e = w && w.name && index.pieces[w.name];
    if (e) entries.push({ slot, name: w.name, type: e.type || SLOT_TO_TYPE[slot], offsets: e.offsets, e, w });
  }
  const A = combineOffsets(entries);
  st.acc = A;
  st.slotMats = {};
  for (const x of entries) {
    const sm = slotMatrix(x.slot, A, x.e);
    if (sm && (sm.s !== 1 || len2(sm.t) > 0)) { st.slotMats[x.slot] = sm; notes.push(`${x.slot}: offset ${sm.t.map(v => v.toFixed(3))} scale ${sm.s.toFixed(3)} in ${sm.bone}`); }
    if (x.w.obj && x.w.obj.isSkinnedMesh) hookSkeleton(THREE, st, x.w.obj, x.slot);
  }
  if (len2(A.hairOff) || A.hairScale !== 1) notes.push(`hair bone offset ${A.hairOff} scale ${A.hairScale}`);
  if (len2(A.maskOff) || A.maskScale !== 1) notes.push(`mask bones offset ${A.maskOff} scale ${A.maskScale}`);
  if (len2(A.wingOff) || A.wingScale.some(v => v !== 1)) notes.push(`cape offset ${A.wingOff} scale ${A.wingScale}`);

  // prop: carried on the back unless the page chose a held pose (prop.held / holdClip)
  const prop = entries.find(x => x.slot === 'prop');
  if (prop && prop.w.obj && prop.e.prop) {
    const bone = st.bones[prop.e.prop.bone] || st.bones.M_WingBRoot;
    const tr = carriedPropTransform(THREE, A);
    if (prop.w.obj.parent !== bone) bone.add(prop.w.obj);
    prop.w.obj.position.copy(tr.position); prop.w.obj.quaternion.copy(tr.quaternion);
    prop.w.obj.scale.setScalar(tr.scale);
    notes.push(`prop carried on ${bone.name}: offset ${A.propOff} rot ${A.propRot} scale ${A.propScale}`);
  }

  // hat → hair clipping
  const hat = entries.find(x => x.slot === 'hat'), hair = entries.find(x => x.slot === 'hair');
  const dp = hat && hat.e.clippingParams && hat.e.clippingParams.driverParams;
  const rp = hair && hair.e.clippingParams && hair.e.clippingParams.receiverParams;
  st.clip = null;
  const hairMats = hair && hair.w.obj && hair.w.obj.material ? [].concat(hair.w.obj.material) : [];
  let planes = [];
  if (dp && rp && (rp.clipAcceptTypes || []).includes(9) && !(rp.clipExclude || []).includes(hat.name)) {
    planes = ['planeA', 'planeB', 'planeC'].map(k => dp[k]).filter(p => p && len2(p.normal) > 0);
  }
  if (planes.length && hairMats.length) {
    const sets = hairMats.map(m => hairClipUniforms(THREE, m));
    sets.forEach(u => { u.skyClipCount.value = planes.length; });
    st.clip = { planes, sets };
    notes.push(`hair clipped by ${hat.name} (${planes.length} planes)`);
  } else {
    hairMats.forEach(m => { if (m.userData.skyClipUniforms) m.userData.skyClipUniforms.skyClipCount.value = 0; });  // hat gone
  }
  return notes;
}

// Bone-matrix hooks: non-inherited axis stretch (height) and whole-piece slot matrices.
function hookSkeleton(THREE, st, mesh, slot) {
  const sk = mesh.skeleton;
  mesh.userData.skySlot = slot;
  if (st.hooked.has(sk)) return;
  st.hooked.add(sk);
  const m = new THREE.Matrix4(), S = new THREE.Matrix4(), W = new THREE.Matrix4(), Wi = new THREE.Matrix4();
  const orig = sk.update.bind(sk);
  sk.update = function () {
    orig();
    const stretch = st.stretch, bm = this.boneMatrices;
    this.bones.forEach((b, i) => {
      const s = stretch[b.name];
      if (!s) return;
      S.makeScale(s.x, s.y, s.z);
      m.multiplyMatrices(b.matrixWorld, S).multiply(this.boneInverses[i]);
      m.toArray(bm, i * 16);
    });
    const sm = st.slotMats[mesh.userData.skySlot];
    const bone = sm && st.bones[sm.bone];
    if (bone) {
      W.copy(bone.matrixWorld);
      const bs = stretch[bone.name];
      if (bs) W.multiply(S.makeScale(bs.x, bs.y, bs.z));
      Wi.copy(W).invert();
      const M = new THREE.Matrix4().makeScale(sm.s, sm.s, sm.s).setPosition(sm.t[0], sm.t[1], sm.t[2]);
      const R = W.clone().multiply(M).multiply(Wi);                 // offset in the bone's local frame
      for (let i = 0; i < this.bones.length; i++) {
        m.fromArray(bm, i * 16); m.premultiply(R); m.toArray(bm, i * 16);
      }
    }
    if (this.boneTexture) this.boneTexture.needsUpdate = true;
  };
}

// Write a channel without fighting the AnimationMixer: if the mixer did not touch it since our last write,
// start again from the stored base value. All edits of one channel in a frame are composed, then written once.
function writeChannel(st, obj, key, fns) {
  const tag = obj.uuid + key;
  const cur = obj[key];
  let rec = st.chan.get(tag);
  if (!rec) { rec = { obj, key, base: cur.clone(), last: null }; st.chan.set(tag, rec); }
  if (!(rec.last && cur.equals(rec.last))) rec.base.copy(cur);   // mixer wrote a fresh value
  const v = rec.base.clone();
  for (const fn of fns) fn(v);
  cur.copy(v);
  rec.last = v.clone();
}

// Call every frame BEFORE mixer.update() (and before creating or fading AnimationActions): puts back the values
// updateAvatarFrame changed, so the mixer only ever sees — and, when it binds a new clip, saves as the original
// state — the plain skeleton pose. Without it the stretch was applied on top of an already stretched pose after
// every clip change (the kid shrank or grew, and pieces drifted off their bones).
export function restoreAvatarFrame(rig) {
  const st = rig.userData.skyRules;
  if (!st) return;
  for (const rec of st.chan.values()) {
    const cur = rec.obj[rec.key];
    if (rec.last && cur.equals(rec.last)) cur.copy(rec.base);
  }
}

// Call every frame after mixer.update(). Order follows the game: outfit bone offsets/scales
// (tibik_anon_7 @0x126c75c), root scale (FUN_00fe6930), height (FUN_00fe7508); the axis stretch is applied
// to children's translations here and to skinning in the skeleton hook.
export function updateAvatarFrame(THREE, rig) {
  const st = state(rig), B = st.bones, A = st.acc;
  const ops = new Map();
  const q = (obj, key, fn) => {
    const k = obj.uuid + key;
    if (!ops.has(k)) ops.set(k, { obj, key, fns: [] });
    ops.get(k).fns.push(fn);
  };
  if (A) {
    const offs = [['M_hairCenter', A.hairOff, A.hairScale], ['M_headAUX', A.maskOff, A.maskScale],
      ['M_head', A.maskOff, A.maskScale], ['M_chestWing', A.wingOff, A.wingScale[0]]];
    for (const [n, off, s] of offs) {
      if (!B[n]) continue;
      if (len2(off)) q(B[n], 'position', v => v.add(new THREE.Vector3(...off)));
      if (s !== 1) q(B[n], 'scale', v => v.setScalar(s));
    }
    if (A.wingScale[1] !== 1) for (const n of ['M_WingBRoot', 'L_WingBRoot', 'R_WingBRoot', 'L_WingFRoot',
      'R_WingFRoot', 'L_WingSRoot', 'R_WingSRoot']) if (B[n]) q(B[n], 'scale', v => v.setScalar(A.wingScale[1]));
  }
  if (B.M_root && st.rootScale && st.rootScale !== 1) q(B.M_root, 'scale', v => v.multiplyScalar(st.rootScale));
  if (st.height) {
    if (B.M_hip) q(B.M_hip, 'position', v => { v.y *= st.hipFactor; });
    for (const [name, s] of Object.entries(st.stretch)) {           // children translate along the stretched axes
      const p = B[name];
      if (!p) continue;
      for (const c of p.children) if (c.isObject3D && B[c.name] === c) q(c, 'position', v => v.multiply(s));
    }
  }
  for (const { obj, key, fns } of ops.values()) writeChannel(st, obj, key, fns);
  // channels no longer modified (e.g. height set back to 0): restore their base value once
  for (const [tag, rec] of [...st.chan]) {
    if (ops.has(tag)) continue;
    const cur = rec.obj[rec.key];
    if (rec.last && cur.equals(rec.last)) cur.copy(rec.base);
    st.chan.delete(tag);
  }
  rig.updateMatrixWorld(true);
  if (st.clip) {                                                     // hair clip planes → world space
    const { planes, sets } = st.clip, nm = new THREE.Matrix3();
    planes.forEach((p, i) => {
      const bone = B[p.parent] || B.M_hairCenterAUX;
      const o = new THREE.Vector3(...p.origin).applyMatrix4(bone.matrixWorld);
      nm.getNormalMatrix(bone.matrixWorld);
      const n = new THREE.Vector3(...p.normal).applyMatrix3(nm).normalize();
      const sc = new THREE.Vector3().setFromMatrixScale(bone.matrixWorld).x;
      for (const u of sets) { u.skyClipO.value[i].copy(o); u.skyClipN.value[i].copy(n); u.skyClipR2.value[i] = p.radiusSq * sc * sc; }
    });
  }
}

// attitude (QR "a") → clip id (index.json "attitudes")
export function attitudeClip(index, attitude) {
  const a = (index.attitudes || []).find(x => x.id === attitude);
  return a ? a.clip : 'idle';
}
