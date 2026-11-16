// Floating island: grassy top, a rocky underside that cools into the haze below, wind-swept instanced grass and
// flowers. Coloured like the game's Daylight Prairie.
import * as THREE from 'three';
import { toon, addOutline, facet } from './toon.js';
import { rng, noise3, canvasTexture } from './util.js';

export const ISLAND_RADIUS = 6;
export const LAWN_EDGE = '#9fcb6e';

export function makeIsland() {
  const R = ISLAND_RADIUS;
  const group = new THREE.Group();

  // top surface with a soft radial colour gradient (lighter centre, warmer edge)
  const top = new THREE.CircleGeometry(R, 96);
  top.rotateX(-Math.PI / 2);
  const colors = [];
  const cCenter = new THREE.Color('#cfe596'), cEdge = new THREE.Color(LAWN_EDGE), c = new THREE.Color();
  const p = top.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const r = Math.hypot(p.getX(i), p.getZ(i)) / R;
    c.copy(cCenter).lerp(cEdge, Math.pow(r, 1.6));
    colors.push(c.r, c.g, c.b);
  }
  top.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const topMesh = new THREE.Mesh(top, toon('#ffffff', { vertexColors: true }));
  group.add(topMesh);

  // rim band: the turf's edge
  const rimGeo = new THREE.CylinderGeometry(R, R * 0.985, 0.42, 96, 1, false);
  rimGeo.translate(0, -0.21, 0);
  const rim = new THREE.Mesh(rimGeo, toon('#8dbb5f'));
  addOutline(rim);
  group.add(rim);

  // faceted underside: a bulging rock belly that tapers to a point, warm earth under the turf cooling to the
  // lavender of the haze at its tip; displacement fades out near the rim
  const belly = [[0.0, -3.6], [0.16, -3.15], [0.36, -2.55], [0.57, -1.95], [0.76, -1.38], [0.9, -0.88], [0.985, -0.42]]
    .map(([r, y]) => new THREE.Vector2(r * R, y));
  const under = facet(new THREE.LatheGeometry(belly, 22));
  const up = under.attributes.position;
  // displace per *unique* position so split faces stay welded
  const key = (x, y, z) => `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
  const moved = new Map();
  const uc = [], cTop = new THREE.Color('#c2ab86'), cBottom = new THREE.Color('#8f8cab'), tmp = new THREE.Color();
  for (let i = 0; i < up.count; i++) {
    const x = up.getX(i), y = up.getY(i), z = up.getZ(i);
    const k = key(x, y, z);
    if (!moved.has(k)) {
      const depth = Math.min(1, Math.max(0, (-0.42 - y) / 0.6));
      const n = noise3(x * 0.7, y * 1.1, z * 0.7, 4.2);
      const radial = 1 + n * 0.16 * depth;
      moved.set(k, [x * radial, y + n * 0.32 * depth, z * radial]);
    }
    const [nx, ny, nz] = moved.get(k);
    up.setXYZ(i, nx, ny, nz);
    tmp.copy(cTop).lerp(cBottom, Math.min(1, (-0.42 - ny) / 3));
    uc.push(tmp.r, tmp.g, tmp.b);
  }
  under.setAttribute('color', new THREE.Float32BufferAttribute(uc, 3));
  under.computeVertexNormals();
  const underMesh = new THREE.Mesh(under, toon('#ffffff', { vertexColors: true }));
  addOutline(underMesh);
  group.add(underMesh);

  return group;
}

// ── grass ─────────────────────────────────────────────────────────────────
function bladeGeometry() {
  const segs = 4, w = 0.075, pos = [], idx = [], hAttr = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, width = w * (1 - t * 0.92), bend = t * t * 0.22;
    pos.push(-width / 2, t, bend, width / 2, t, bend);
    hAttr.push(t, t);
  }
  for (let i = 0; i < segs; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('h', new THREE.Float32BufferAttribute(hAttr, 1));
  g.setIndex(idx);
  return g;
}

export const windUniforms = { uTime: { value: 0 } };

// heightAt(x, z): how far the ground is raised there (game mounds); flat when omitted
export function makeGrass(count, avoid = [], heightAt = () => 0) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      ...windUniforms,
      uBase: { value: new THREE.Color('#4c8a3c') },
      uMid: { value: new THREE.Color('#79b24f') },
      uTip: { value: new THREE.Color('#d6e78c') }
    },
    vertexShader: /* glsl */`
      #include <fog_pars_vertex>
      uniform float uTime;
      attribute float h;
      varying float vH;
      varying vec3 vTint;
      void main() {
        vH = h;
        vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vec4 root = modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float gust = sin(uTime * 1.3 + root.x * 0.45 + root.z * 0.3);
        float flutter = sin(uTime * 3.1 + root.x * 2.1 + root.z * 1.7) * 0.35;
        float w = (gust * 0.7 + flutter) * h * h;
        world.x += w * 0.13;
        world.z += w * 0.07;
        vTint = instanceColor;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */`
      #include <fog_pars_fragment>
      uniform vec3 uBase; uniform vec3 uMid; uniform vec3 uTip;
      varying float vH;
      varying vec3 vTint;
      void main() {
        vec3 c = vH < 0.45 ? mix(uBase, uMid, vH / 0.45) : mix(uMid, uTip, (vH - 0.45) / 0.55);
        gl_FragColor = vec4(c * vTint, 1.0);
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
    side: THREE.DoubleSide,
    fog: true
  });

  const mesh = new THREE.InstancedMesh(bladeGeometry(), material, count);
  const rand = rng(7), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const s = new THREE.Vector3(), v = new THREE.Vector3(), col = new THREE.Color();
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 20) {
    const r = Math.sqrt(rand()) * (ISLAND_RADIUS - 0.25), a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (avoid.some(o => (x - o.x) ** 2 / o.rx ** 2 + (z - o.z) ** 2 / o.rz ** 2 < 1)) continue;
    // patchy density: clumps and clearings so the ground shows through (a raised mound stays fully grown)
    const patch = noise3(x * 0.7, 0, z * 0.7, 11), lift = heightAt(x, z);
    if (patch < -0.05 && lift <= 0 && rand() < 0.88) continue;
    const height = 0.2 + rand() * 0.24 + Math.max(0, patch) * 0.3;
    e.set((rand() - 0.5) * 0.5, rand() * Math.PI * 2, (rand() - 0.5) * 0.5);
    q.setFromEuler(e);
    s.set(0.7 + rand() * 0.5, height, 1);
    v.set(x, lift, z);
    m.compose(v, q, s);
    mesh.setMatrixAt(placed, m);
    col.setScalar(0.82 + rand() * 0.3);
    mesh.setColorAt(placed, col);
    placed++;
  }
  mesh.count = placed;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  return mesh;
}

// ── flowers & pebbles ─────────────────────────────────────────────────────
export function makeFlowers(count, avoid = [], heightAt = () => 0) {
  const tex = canvasTexture(128, (ctx, sz) => {
    ctx.translate(sz / 2, sz / 2);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 5; i++) {
      ctx.rotate((Math.PI * 2) / 5);
      ctx.beginPath(); ctx.ellipse(0, -26, 17, 26, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = '#f6c945';
    ctx.beginPath(); ctx.arc(0, 0, 14, 0, Math.PI * 2); ctx.fill();
  });
  const mesh = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.4 }),
    count
  );
  const rand = rng(21), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
  const s = new THREE.Vector3(), v = new THREE.Vector3();
  let placed = 0, guard = 0;
  while (placed < count && guard++ < count * 30) {
    const r = Math.sqrt(rand()) * (ISLAND_RADIUS - 0.4), a = rand() * Math.PI * 2;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (avoid.some(o => (x - o.x) ** 2 / o.rx ** 2 + (z - o.z) ** 2 / o.rz ** 2 < 1)) continue;
    e.set(-Math.PI / 2 + (rand() - 0.5) * 0.4, 0, rand() * Math.PI * 2);
    q.setFromEuler(e);
    const k = 0.7 + rand() * 0.7;
    s.set(k, k, k);
    v.set(x, heightAt(x, z) + 0.03 + rand() * 0.06, z);
    m.compose(v, q, s);
    mesh.setMatrixAt(placed++, m);
  }
  mesh.count = placed;
  mesh.raycast = () => {};
  return mesh;
}
