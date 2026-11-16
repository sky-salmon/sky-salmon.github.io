// Recreation of the player's Days of Mischief photo: the kid (outfit from their QR, Lazy-stance squat) by the brick
// tower, with the game's own brick textures and witch-hat model. All numbers that place things live in CFG so the
// shot can be matched against the photo. Kid units: the kid is ~17 tall standing; it faces -Z.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { createAvatar } from '/assets/js/avatar-engine.js';

const Q = new URLSearchParams(location.search);
const CFG = Object.assign({
  w: 960, h: 600, mirror: false, t: 1.2, anim: false,
  cam: { pos: [-1.6, 2.2, -6.2], tgt: [2.6, 7.6, 2], fov: 62, roll: 0 },
  kid: { pos: [0, 0, 0], ry: 0.35 },
  wall: { a: [16, 0, 9], b: [-3.2, 0, 13], height: 60, brick: 12, teal: [11.2, 13.0] },
  low: { a: [-3.2, 0, 13], b: [-60, 0, 22], height: 9.5, depth: 6 },
  fog: { color: '#7d7556', near: 14, far: 150 },
  sky: { top: '#6d6449', mid: '#8d8266', horizon: '#c2b593' },
  light: { amb: '#5a5a3e', ambI: 1.1, warm: '#ffb45e', warmI: 70, warmPos: [7, 1.2, -6], key: '#c8c49a', keyI: 0.6 },
  towers: [
    { pos: [-48, 0, 70], r: 5.5, h: 34, hat: true, hatS: 1.9 },
    { pos: [-62, 0, 105], r: 13, h: 70, hat: false, spike: 16 }
  ]
}, window.__CFG || {}, JSON.parse(Q.get('cfg') || '{}'));   // a page can bake its CFG in as window.__CFG
window.__cfg = CFG;

const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !CFG.live });
const stage = CFG.live && document.getElementById('stage');
renderer.setPixelRatio(CFG.live ? Math.min(window.devicePixelRatio || 1, 2) : 1);
if (stage) { CFG.w = stage.clientWidth || innerWidth; CFG.h = stage.clientHeight || innerHeight; }
renderer.setSize(CFG.w, CFG.h);
renderer.outputColorSpace = THREE.SRGBColorSpace;
if (CFG.shadows) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
if (CFG.exposure) { renderer.toneMapping = THREE.LinearToneMapping; renderer.toneMappingExposure = CFG.exposure; }   // a plain gain: the look stays, everything is brighter
(stage || document.body).appendChild(renderer.domElement);
if (CFG.mirror) renderer.domElement.style.transform = 'scaleX(-1)';

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(CFG.fog.color, CFG.fog.near, CFG.fog.far);
const camera = new THREE.PerspectiveCamera(CFG.cam.fov, CFG.w / CFG.h, 0.1, 2000);

// ── sky: a gradient dome (unfogged) ─────────────────────────────────────
{
  const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(CFG.sky.top) }, mid: { value: new THREE.Color(CFG.sky.mid) }, hor: { value: new THREE.Color(CFG.sky.horizon) } },
    vertexShader: 'varying vec3 d; void main(){ d = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, hor; varying vec3 d;
      void main(){ float y = max(d.y, 0.0); vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, y)); c = mix(c, top, smoothstep(0.18, 0.7, y));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  sky.renderOrder = -1;
  scene.add(sky);
}

// ── light ───────────────────────────────────────────────────────────────
scene.add(new THREE.HemisphereLight(CFG.light.key, CFG.light.amb, CFG.light.ambI));
// the warm lamp low at the kid's side: a spot (one shadow map) when CFG.light.spot is set, else a bare point light
const L = CFG.light, warm = L.spot ? new THREE.SpotLight(L.warm, L.warmI, 0, L.spot.angle, L.spot.penumbra, L.decay ?? 1.4) : new THREE.PointLight(L.warm, L.warmI, 0, L.decay ?? 1.4);
warm.position.fromArray(L.warmPos);
if (L.spot) { warm.target.position.fromArray(L.spot.target); scene.add(warm.target); }
if (L.spot && CFG.shadows) {
  warm.castShadow = true; warm.shadow.mapSize.set(2048, 2048); warm.shadow.camera.near = 0.3; warm.shadow.camera.far = 120;
  warm.shadow.bias = -0.0004; warm.shadow.normalBias = 0.04; warm.shadow.radius = 3;
}
scene.add(warm);
if (L.fill) {   // part of the lamp's light without a shadow, so the shadows it casts stay soft (bounce off the wall and grass)
  warm.intensity = L.warmI * (1 - L.fill);
  const f = new THREE.PointLight(L.warm, L.warmI * L.fill, 0, L.decay ?? 1.4); f.position.fromArray(L.warmPos); scene.add(f);
}
if (L.sun) {   // soft light from the open sky above the tower, for the top surfaces
  const sun = new THREE.DirectionalLight(L.sun.color, L.sun.i); sun.position.fromArray(L.sun.dir).multiplyScalar(60); scene.add(sun);
}

// ── textures ────────────────────────────────────────────────────────────
const tl = new THREE.TextureLoader();
const tex = (f, srgb) => new Promise(r => tl.load((CFG.envBase || '/__env/') + f, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 8; r(t); }));
const [brickAlb, brickNrm, stoneAlb, stoneNrm] = await Promise.all([tex('WallBrick.png', true), tex('WallBrickSh.png'), tex('Brick.png', true), tex('BrickSh.png')]);
window.dispatchEvent(new CustomEvent('scene-progress', { detail: 0.25 }));

// a wall slab from a to b (ground points), facing -Z side toward the camera; UVs in world units / tile size
function slab(a, b, height, depth, tile, alb, nrm, tint, opts = {}) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const geo = new THREE.BoxGeometry(len, height, depth);
  const uv = geo.attributes.uv, pos = geo.attributes.position, nor = geo.attributes.normal;
  for (let i = 0; i < uv.count; i++) {   // world-scaled UVs on every face
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), n = [nor.getX(i), nor.getY(i), nor.getZ(i)].map(Math.abs);
    const u = n[0] > 0.5 ? z : x, v = n[1] > 0.5 ? z : y;
    uv.setXY(i, u / tile, (v + height / 2) / tile);
  }
  const map = alb.clone(), nmap = nrm.clone(); map.needsUpdate = nmap.needsUpdate = true;
  const mat = new THREE.MeshStandardMaterial({ map, normalMap: nmap, color: tint, roughness: 0.95, metalness: 0, normalScale: new THREE.Vector2(1.2, 1.2) });
  if (opts.teal) {   // one course of bricks lit teal, as on the event's tower
    const [y0, y1] = opts.teal;
    mat.onBeforeCompile = s => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vWY;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWY = (modelMatrix * vec4(transformed,1.0)).y;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>\nvarying float vWY;`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float band = smoothstep(${y0.toFixed(2)}, ${(y0 + 0.25).toFixed(2)}, vWY) * (1.0 - smoothstep(${(y1 - 0.25).toFixed(2)}, ${y1.toFixed(2)}, vWY));
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.55, 1.25, 1.2), band);
          totalEmissiveRadiance += band * vec3(0.03, 0.11, 0.12) * diffuseColor.r * 4.0;`);
    };
  }
  const m = new THREE.Mesh(geo, mat);
  m.receiveShadow = true;
  m.position.copy(A).add(B).multiplyScalar(0.5).add(new THREE.Vector3(0, height / 2, 0));
  m.rotation.y = -Math.atan2(B.z - A.z, B.x - A.x);
  // push the slab back so its front face runs along a→b
  const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(new THREE.Vector3(0, 1, 0), m.rotation.y);
  if (n.dot(new THREE.Vector3(...CFG.cam.pos).sub(m.position)) > 0) n.negate();   // away from the camera
  m.position.addScaledVector(n, depth / 2);
  return m;
}
scene.add(slab(CFG.wall.a, CFG.wall.b, CFG.wall.height, 8, CFG.wall.brick, brickAlb, brickNrm, CFG.wallTint || '#8a7a62', { teal: CFG.wall.teal }));
if (CFG.tall) {   // the taller tower behind the front block, set back a little
  const sb = CFG.tall.setback || 0, A = new THREE.Vector3(...CFG.tall.a), B = new THREE.Vector3(...CFG.tall.b);
  const dir = B.clone().sub(A).normalize(), back = new THREE.Vector3(-dir.z, 0, dir.x);
  if (back.dot(new THREE.Vector3(...CFG.cam.pos).sub(A)) > 0) back.negate();
  scene.add(slab(A.addScaledVector(back, sb).toArray(), B.addScaledVector(back, sb).toArray(), CFG.tall.height, 8, CFG.wall.brick, brickAlb, brickNrm, CFG.wallTint || '#8a7a62', { teal: CFG.wall.teal.map(y => y + (CFG.tall.tealUp || 0)) }));
}
scene.add(slab(CFG.low.a, CFG.low.b, CFG.low.height, CFG.low.depth, CFG.lowTile || CFG.wall.brick * 1.3, stoneAlb, stoneNrm, CFG.lowTint || '#5c5a44'));

// ground: dark grass
{
  const g = new THREE.Mesh(new THREE.CircleGeometry(400, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: CFG.ground || '#3b4318', roughness: 1 }));
  g.receiveShadow = true;
  scene.add(g);
}

// distant towers: plain stone, the near one capped with the game's witch hat
const gl = new GLTFLoader();
const hatGeo = await new Promise(r => gl.load((CFG.envBase || '/__env/') + 'WitchHat.glb', g => { let geo; g.scene.traverse(o => { if (o.isMesh && !geo) geo = o.geometry; }); r(geo); }));
for (const t of CFG.towers) {
  const mat = new THREE.MeshStandardMaterial({ color: '#4e4a33', roughness: 1 });
  const body = new THREE.Mesh(new THREE.CylinderGeometry(t.r * 0.92, t.r, t.h, 8), mat);
  body.position.set(t.pos[0], t.h / 2, t.pos[2]);
  scene.add(body);
  if (t.spike) { const s = new THREE.Mesh(new THREE.ConeGeometry(t.r * 0.45, t.spike, 6), mat); s.position.set(t.pos[0] + t.r * 0.3, t.h + t.spike / 2, t.pos[2]); scene.add(s); }
  if (t.hat) {
    const hat = new THREE.Mesh(hatGeo, new THREE.MeshStandardMaterial({ color: CFG.hatColor || '#8a5a22', roughness: 1 }));
    hat.scale.setScalar(t.hatScaleAbs || t.hatS * t.r / 3); hat.position.set(t.pos[0], t.h, t.pos[2]); hat.rotation.y = t.hatRy || 0;
    scene.add(hat);
  }
}

// ── the kid ─────────────────────────────────────────────────────────────
// the Lazy squat is not in the site's clip set yet: add it from the test file
const _fetch = window.fetch;
window.fetch = async (u, o) => {
  const r = await _fetch(u, o);
  if (!String(u).endsWith('avatar/index.json')) return r;
  const idx = await r.json();
  for (const id of ['standLazy', 'sitLazy', 'squatLazy', 'sleepLazy', 'squatLazyAct']) idx.clips.push({ id, loop: true, frames: 50, fps: 15, file: CFG.lazyFile || 'clips/__test.glb' });
  return new Response(JSON.stringify(idx), { headers: { 'content-type': 'application/json' } });
};
const look = JSON.parse(Q.get('look') || 'null') || window.__LOOK;
window.dispatchEvent(new CustomEvent('scene-progress', { detail: 0.4 }));
const AV = CFG.avatarBase || 'assets/avatar/';   // where the site's kid files are, seen from the page
const kid = await createAvatar({ base: AV });
kid.object.position.fromArray(CFG.kid.pos);
kid.object.rotation.y = CFG.kid.ry;
scene.add(kid.object);
await kid.wearLook({ ...look, clip: CFG.clip || 'squatLazy' });
kid.object.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = !!CFG.kidSelfShadow; } });
if (CFG.kid.pivot === 'head') {   // turn about the head instead of the feet, so the head (and the matched hat) stays put
  const k = kid.object, h = k.getObjectByName('M_head'), r = k.rotation.y, w = () => (k.updateMatrixWorld(true), h.getWorldPosition(new THREE.Vector3()));
  kid.update(0.001); k.rotation.y = 0; const h0 = w(); k.rotation.y = r; const h1 = w();
  k.position.x -= h1.x - h0.x; k.position.z -= h1.z - h0.z;
}

// Bat cape: black, with an orange-red rim along its scalloped hem (the game's chameleon band; see notes)
const capeFile = (kid.index.pieces[look.pieces.cape] || {}).file;
if (capeFile) {
  const src = await new Promise(r => new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(AV + capeFile, r));
  let s; src.scene.traverse(o => { if (o.isSkinnedMesh && !s) s = o; });
  src.scene.updateMatrixWorld(true);
  const n = s.geometry.attributes.position.count, P = [];
  for (let i = 0; i < n; i++) P.push(s.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(s.matrixWorld));
  const idx = s.geometry.index.array, edges = new Map();
  for (let f = 0; f < idx.length; f += 3) for (const [a, b] of [[0, 1], [1, 2], [2, 0]]) {
    const i = idx[f + a], j = idx[f + b], k = i < j ? i + ',' + j : j + ',' + i; edges.set(k, (edges.get(k) || 0) + 1);
  }
  const ys = P.map(p => p.y), minY = Math.min(...ys), maxY = Math.max(...ys);
  const hem = [];
  for (const [k, c] of edges) if (c === 1) for (const v of k.split(',').map(Number)) if (P[v].y < minY + 0.4 * (maxY - minY)) hem.push(P[v]);
  const rim = new Float32Array(n), R = CFG.rim || 0.32;
  for (let i = 0; i < n; i++) { let d = 1e9; for (const h of hem) d = Math.min(d, P[i].distanceToSquared(h)); rim[i] = 1 - THREE.MathUtils.smoothstep(Math.sqrt(d), R * 0.4, R); }
  kid.object.traverse(o => {
    if (!o.isSkinnedMesh || !o.material.userData.sh || o.material.userData.sh.shader !== 'AvatarCham') return;
    o.geometry.setAttribute('aRim', new THREE.BufferAttribute(rim, 1));
    const u = o.material.userData.u;
    u.colour0.value.setRGB(0.025, 0.022, 0.024); u.useColour1.value = 0; u.useMask.value = 0;
    const prev = o.material.onBeforeCompile;
    o.material.onBeforeCompile = (sh, r) => {
      prev(sh, r);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aRim; varying float vRim;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvRim = aRim;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vRim;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.55, 0.035, 0.0), vRim);\n totalEmissiveRadiance += vRim * vec3(0.18, 0.01, 0.0);');
    };
    o.material.customProgramCacheKey = () => 'batcape';
    o.material.needsUpdate = true;
  });
}

// the kid sits in the tower's shadow: darken its shading (the sky light reaches the walls, not the kid)
if (CFG.kidShade || CFG.kidGamma) kid.object.traverse(o => {
  if (!o.isMesh || !o.material || !o.material.color) return;
  const m = o.material, prev = m.onBeforeCompile, g = (CFG.kidGamma || 1).toFixed(3), k = (CFG.kidShade || 1).toFixed(3);
  const glow = CFG.hairGlow && m.userData.sh === (kid.index.pieces[look.pieces.hair] || {}).shader ? CFG.hairGlow : null;
  m.onBeforeCompile = (sh, r) => {   // a curve, not a plain scale: the black hat and cloth sink, the white hair stays bright
    if (prev) prev(sh, r);
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n float skyLum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));\n diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(' + g + ')) * ' + k + ';' + (glow ? '\n float skyHat = mix(' + (CFG.hatDark || 1).toFixed(3) + ', 1.0, smoothstep(0.45, 0.6, skyLum));' : '')
      + (glow && CFG.hairTint ? '\n diffuseColor.rgb *= mix(vec3(1.0), vec3(' + CFG.hairTint.join(',') + '), smoothstep(0.45, 0.6, skyLum));' : ''));
    // the black hat stays black: scale its final lit colour too (a black cloth still shows ~4% specular under the lamp)
    if (glow) sh.fragmentShader = sh.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight *= skyHat;\n#include <opaque_fragment>');
    if (glow) sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += vec3(' + glow.join(',') + ') * smoothstep(0.45, 0.85, skyLum);');
  };
  const key = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
  m.customProgramCacheKey = () => key() + '|shade' + g + k + (glow ? '|hair' + glow.join(',') + (CFG.hatDark || 1) + (CFG.hairTint || '') : '');
  m.needsUpdate = true;
});
// In game the Bat cape's cloth falls in around the squatting kid; the engine instead spreads it a little outward.
// CFG.capeWrap = [sides, front] in degrees turns those chains inward each frame, about the kid's forward axis.
const wrap = (CFG.capeWrap ? [['L_WingSRoot', 1, 0], ['R_WingSRoot', -1, 0], ['L_WingFRoot', 1, 1], ['R_WingFRoot', -1, 1]] : [])
  .map(([n, sign, i]) => ({ bn: kid.object.getObjectByName(n), rad: sign * CFG.capeWrap[i] * Math.PI / 180, base: new THREE.Quaternion(), last: null }))
  .filter(w => w.bn && w.bn.parent);
function unwrapCape() { for (const w of wrap) if (w.last && w.bn.quaternion.equals(w.last)) w.bn.quaternion.copy(w.base); }
function wrapCape() {
  if (!wrap.length) return;
  kid.object.updateMatrixWorld(true);
  const axis = new THREE.Vector3(0, 0, 1).applyQuaternion(kid.object.getWorldQuaternion(new THREE.Quaternion())), pq = new THREE.Quaternion();
  for (const w of wrap) {
    w.bn.parent.getWorldQuaternion(pq);
    const spin = pq.clone().invert().multiply(new THREE.Quaternion().setFromAxisAngle(axis, w.rad)).multiply(pq);
    w.base.copy(w.bn.quaternion); w.bn.quaternion.premultiply(spin); w.last = w.bn.quaternion.clone();
  }
}
const tick = d => { unwrapCape(); kid.update(d); wrapCape(); };
const step = dt => { while (dt > 1e-6) { const d = Math.min(0.05, dt); tick(d); dt -= d; } };
step(0.4 + CFG.t);

function place() {
  camera.position.fromArray(CFG.cam.pos);
  camera.lookAt(new THREE.Vector3(...CFG.cam.tgt));
  camera.rotateZ(CFG.cam.roll || 0);
  camera.fov = CFG.cam.fov; camera.updateProjectionMatrix();
}
place();
if (CFG.grid) {   // contact sheet of candidate cameras: CFG.grid = [{pos,tgt,fov}], CFG.cols
  const cols = CFG.cols || 4, rows = Math.ceil(CFG.grid.length / cols), tw = CFG.w / cols, th = CFG.h / rows;
  renderer.setScissorTest(true);
  CFG.grid.forEach((c, i) => {
    camera.position.fromArray(c.pos); camera.lookAt(new THREE.Vector3(...c.tgt)); camera.fov = c.fov; camera.aspect = tw / th; camera.updateProjectionMatrix();
    const x = (i % cols) * tw, y = (rows - 1 - Math.floor(i / cols)) * th;
    renderer.setViewport(x, y, tw, th); renderer.setScissor(x, y, tw, th); renderer.render(scene, camera);
  });
  renderer.setScissorTest(false); camera.aspect = CFG.w / CFG.h; place();
} else renderer.render(scene, camera);
// screen-space positions (in a 1920x1200 frame) of named bones, for matching the shot
function project(names) {
  kid.object.updateMatrixWorld(true);
  const out = {};
  for (const n of names) {
    const b = kid.object.getObjectByName(n); if (!b) continue;
    const w = b.getWorldPosition(new THREE.Vector3()), p = w.clone().project(camera);
    out[n] = { world: w.toArray().map(x => +x.toFixed(2)), px: [+((p.x * 0.5 + 0.5) * 1920).toFixed(0), +((-p.y * 0.5 + 0.5) * 1200).toFixed(0)] };
  }
  return out;
}
window.__scene = { THREE, scene, camera, kid, renderer, CFG, place, step, project };
// 2-D box (photo pixels) of a worn piece's skinned vertices, e.g. the witch-hat hair
function pieceBox(slot) {
  kid.object.updateMatrixWorld(true);
  let lo = [1e9, 1e9], hi = [-1e9, -1e9]; const v = new THREE.Vector3();
  kid.object.traverse(o => {
    if (!o.isSkinnedMesh || o.material.userData.sh !== (kid.index.pieces[look.pieces[slot]] || {}).shader) return;
    const n = o.geometry.attributes.position.count;
    for (let i = 0; i < n; i += 3) {
      o.getVertexPosition(i, v); v.applyMatrix4(o.matrixWorld).project(camera);
      const px = (v.x * 0.5 + 0.5) * 1920, py = (-v.y * 0.5 + 0.5) * 1200;
      lo = [Math.min(lo[0], px), Math.min(lo[1], py)]; hi = [Math.max(hi[0], px), Math.max(hi[1], py)];
    }
  });
  return [lo, hi].map(p => p.map(Math.round));
}
window.__box = { hair: pieceBox('hair') };
{ // what is drawn at a few photo pixels (debug)
  const slotOf = sh => Object.entries(look.pieces).find(([, n]) => n && kid.index.pieces[n] && kid.index.pieces[n].shader === sh);
  const rc = new THREE.Raycaster(), out = {};
  kid.object.traverse(o => { if (o.isSkinnedMesh) o.computeBoundingSphere && (o.boundingSphere = null); });
  for (const [x, y] of [[300, 520], [600, 560], [470, 420], [520, 600]]) {
    rc.setFromCamera(new THREE.Vector2(x / 1920 * 2 - 1, -(y / 1200 * 2 - 1)), camera);
    const hits = rc.intersectObject(kid.object, true);
    const h = hits[0];
    out[x + ',' + y] = h ? { name: h.object.name, slot: (slotOf(h.object.material.userData.sh) || ['?'])[0], dist: +h.distance.toFixed(2) } : null;
  }
  window.__box.hits = out;
}
{ const b = CFG.wall.b, p = new THREE.Vector3(b[0], CFG.wall.height, b[2]).project(camera); window.__box.cornerTop = [Math.round((p.x * 0.5 + 0.5) * 1920), Math.round((-p.y * 0.5 + 0.5) * 1200)]; }
window.__proj = project(['M_head', 'M_hairCenter', 'L_hand', 'R_hand', 'L_knee', 'R_knee', 'L_elbow', 'R_elbow', 'M_chest', 'M_hip', 'L_foot', 'R_foot']);
window.__done = true;

if (CFG.live) startLive();
function startLive() {
  // Drag turns the camera round the kid's head and carries the photo's framing with it (the kid keeps its place on
  // screen while the world turns behind it); wheel or pinch moves in and out. The camera stays above the grass and in
  // front of the tower wall. With the picture mirrored, a drag to the right still turns the view to the right.
  const el = renderer.domElement, Y = new THREE.Vector3(0, 1, 0), K = new THREE.Vector3();
  kid.object.updateMatrixWorld(true); kid.object.getObjectByName('M_head').getWorldPosition(K);
  const P0 = new THREE.Vector3(...CFG.cam.pos), T0 = new THREE.Vector3(...CFG.cam.tgt), Q0 = new THREE.Quaternion();
  const A = new THREE.Vector3(...CFG.wall.a), B = new THREE.Vector3(...CFG.wall.b);
  const wn = new THREE.Vector3(-(B.z - A.z), 0, B.x - A.x).normalize(); if (wn.dot(P0.clone().sub(A)) < 0) wn.negate();
  const st = { yaw: 0, pitch: 0, zoom: 1 }, goal = { ...st }, LIM = { pitch: [-0.3, 1.15], zoom: [0.45, 2.2] };
  const clamp = (v, [a, b]) => Math.min(b, Math.max(a, v));
  let mirror = !!CFG.mirror, back = 1;   // back: phone-shaped screens start a little further out
  function pose(s) {
    const off = P0.clone().sub(K).multiplyScalar(s.zoom * back), axis = new THREE.Vector3(-off.z, 0, off.x).normalize();
    const q = new THREE.Quaternion().setFromAxisAngle(Y, s.yaw).multiply(new THREE.Quaternion().setFromAxisAngle(axis, s.pitch));
    return { pos: K.clone().add(off.applyQuaternion(q)), quat: q.multiply(Q0) };
  }
  const allowed = s => { const p = pose(s).pos; return p.y > 0.8 && wn.dot(p.clone().sub(A)) > 1.5; };
  function aim(ch) {   // take each change that keeps the camera somewhere it may be
    for (const [k, v] of Object.entries(ch)) { const n = { ...goal, [k]: LIM[k] ? clamp(v, LIM[k]) : v }; if (allowed(n)) goal[k] = n[k]; }
  }
  function fit() {   // phone-shaped screens: look a little toward the kid and widen the lens so it stays in view
    const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight, a = w / h;
    renderer.setSize(w, h); camera.aspect = a;
    const t = Math.min(1, Math.max(0, (1.45 - a) / 0.9));
    camera.fov = CFG.cam.fov + 18 * t; camera.updateProjectionMatrix(); back = 1 + 0.3 * t;
    const m = new THREE.Matrix4().lookAt(P0, T0.clone().lerp(K, t * 0.85), Y); Q0.setFromRotationMatrix(m);
  }
  fit(); addEventListener('resize', fit);
  const setMirror = on => { mirror = on; el.style.transform = on ? 'scaleX(-1)' : ''; window.dispatchEvent(new CustomEvent('scene-mirror', { detail: on })); };
  setMirror(mirror);
  const touched = () => window.dispatchEvent(new Event('scene-touched'));
  el.style.touchAction = 'none';
  const pts = new Map(); let pinch0 = 1, zoom0 = 1;
  const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]) || 1; };
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId); pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 2) { pinch0 = spread(); zoom0 = goal.zoom; }
    touched();
  });
  el.addEventListener('pointermove', e => {
    const was = pts.get(e.pointerId); if (!was) return;
    pts.set(e.pointerId, [e.clientX, e.clientY]);
    if (pts.size === 1) {
      const k = 3.2 / Math.max(el.clientHeight, 300), dx = (e.clientX - was[0]) * (mirror ? -1 : 1);
      aim({ yaw: goal.yaw - dx * k, pitch: goal.pitch + (e.clientY - was[1]) * k });
    } else if (pts.size === 2) aim({ zoom: zoom0 * pinch0 / spread() });
  });
  const lift = e => pts.delete(e.pointerId);
  el.addEventListener('pointerup', lift); el.addEventListener('pointercancel', lift);
  el.addEventListener('wheel', e => { e.preventDefault(); aim({ zoom: goal.zoom * Math.exp(e.deltaY * 0.0012) }); touched(); }, { passive: false });
  const reset = () => Object.assign(goal, { yaw: 0, pitch: 0, zoom: 1 });
  el.addEventListener('dblclick', reset);
  addEventListener('keydown', e => {
    const step = { ArrowLeft: { yaw: goal.yaw + 0.12 * (mirror ? -1 : 1) }, ArrowRight: { yaw: goal.yaw - 0.12 * (mirror ? -1 : 1) },
      ArrowUp: { pitch: goal.pitch + 0.08 }, ArrowDown: { pitch: goal.pitch - 0.08 }, '+': { zoom: goal.zoom * 0.9 }, '=': { zoom: goal.zoom * 0.9 }, '-': { zoom: goal.zoom * 1.1 } }[e.key];
    if (step && !/^(INPUT|BUTTON|SELECT|TEXTAREA)$/.test(document.activeElement && document.activeElement.tagName)) { e.preventDefault(); aim(step); touched(); }
  });
  window.__view = { reset, mirror: on => setMirror(on === undefined ? !mirror : on), goal, st };
  let last = performance.now();
  renderer.setAnimationLoop(now => {
    const dt = Math.min(0.1, (now - last) / 1000), a = 1 - Math.exp(-dt * 9); last = now;
    for (const k of ['yaw', 'pitch', 'zoom']) st[k] += (goal[k] - st[k]) * a;
    const p = pose(st); camera.position.copy(p.pos); camera.quaternion.copy(p.quat);
    tick(dt); renderer.render(scene, camera);
  });
  window.dispatchEvent(new Event('scene-ready'));
}
if (CFG.anim) {
  let last = performance.now();
  renderer.setAnimationLoop(now => { tick(Math.min(0.1, (now - last) / 1000)); last = now; renderer.render(scene, camera); });
}
