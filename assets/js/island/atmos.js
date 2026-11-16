// The air around the home island, in the manner of the game's Daylight Prairie: a sky dome with a soft sun, a sea
// of sunlit cloud far below that fades into the haze at the horizon, and drifting motes of light.
// Everything here is drawn by small shaders (one draw call each) and shares one sky function, so the clouds fade
// into exactly the colour of the sky behind them.
import * as THREE from 'three';
import { rng } from './util.js';

const linear = hex => new THREE.Color(hex);   // THREE.Color keeps linear values; shaders convert on output

export const SKY = {
  zenith: linear('#5f97d3'),
  sky: linear('#a9cdec'),
  horizon: linear('#f6eedd'),
  sun: linear('#ffe2a8'),
  sunDir: new THREE.Vector3(-0.62, 0.2, -0.76).normalize(),
  cloudLit: linear('#fffaf0'),
  cloudShade: linear('#c3c8e0'),
  fogNear: 40,
  fogFar: 230
};

const skyUniforms = {
  uZenith: { value: SKY.zenith },
  uSky: { value: SKY.sky },
  uHorizon: { value: SKY.horizon },
  uSunColor: { value: SKY.sun },
  uSunDir: { value: SKY.sunDir }
};

// dir: a unit direction from the eye. Below the horizon the dome is plain haze: the cloud sea covers it there.
const SKY_GLSL = /* glsl */`
  uniform vec3 uZenith, uSky, uHorizon, uSunColor, uSunDir;
  vec3 skyColor(vec3 dir) {
    float y = max(dir.y, 0.0);
    vec3 c = mix(uHorizon, uSky, smoothstep(0.0, 0.22, y));
    c = mix(c, uZenith, smoothstep(0.22, 0.85, y));
    float s = max(dot(dir, uSunDir), 0.0);
    c += uSunColor * (pow(s, 5.0) * 0.32 + pow(s, 40.0) * 0.45 + pow(s, 700.0) * 1.4);
    return c;
  }
  vec3 hazeColor(vec3 dir) { return skyColor(normalize(vec3(dir.x, 0.0, dir.z))); }
`;

// ── sky dome ─────────────────────────────────────────────────────────────
// Follows the camera (call follow() each frame), so it sits at infinity whatever the camera does.
export function makeSkyDome() {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(300, 40, 20),
    new THREE.ShaderMaterial({
      uniforms: skyUniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: SKY_GLSL + /* glsl */`
        varying vec3 vDir;
        void main() {
          gl_FragColor = vec4(skyColor(normalize(vDir)), 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false
    })
  );
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  return { object: mesh, follow(camera) { mesh.position.copy(camera.position); } };
}

// ── cloud sea ────────────────────────────────────────────────────────────
// A soft floor of cloud far below, and billboard puffs heaped on it (thicker toward the horizon, a few wisps
// hugging the island's underside). The puffs' texture is drawn here once: a 2×2 atlas of cumulus shapes whose red
// channel is how much sun each point catches (lit tops, shaded bellies) and alpha its density.
function puffAtlas() {
  const N = 128, size = N * 2, data = new Uint8Array(size * size * 4), rand = rng(31);
  for (let q = 0; q < 4; q++) {
    const blobs = [];
    const n = 6 + Math.floor(rand() * 4);
    for (let i = 0; i < n; i++) {
      const x = 0.2 + rand() * 0.6, spread = 1 - Math.abs(x - 0.5) * 1.6;
      blobs.push([x, 0.62 - rand() * 0.22 * spread, 0.13 + rand() * 0.12 * (0.5 + spread)]);
    }
    const dens = (x, y) => {
      let d = 0;
      for (const [bx, by, r] of blobs) {
        const k = 1 - Math.hypot(x - bx, y - by) / r;
        if (k > 0) d = Math.max(d, Math.sqrt(k));
      }
      return d * Math.min(1, Math.max(0, (0.8 - y) / 0.12));   // a flat-ish base
    };
    const ox = (q % 2) * N, oy = Math.floor(q / 2) * N;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const x = (i + 0.5) / N, y = (j + 0.5) / N, d = dens(x, y);
        // sunlight comes from the upper left: a point is lit when there is little cloud between it and the sun
        const shade = Math.min(1, dens(x - 0.05, y - 0.08) * 1.25);
        const light = Math.min(1, Math.max(0, 1 - shade * 0.75 - y * 0.25 + 0.15));
        const o = ((oy + j) * size + ox + i) * 4;
        data[o] = Math.round(light * 255);
        data[o + 3] = Math.round(Math.min(1, Math.max(0, (d - 0.04) / 0.3)) * 255);
      }
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.flipY = false;   // row 0 is the top of each puff
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  return tex;
}

export const cloudUniforms = { uTime: { value: 0 } };

export function makeCloudSea({ small = false, floorY = -15, islandRadius = 6 } = {}) {
  const group = new THREE.Group();
  const fogUniforms = { uFogNear: { value: SKY.fogNear }, uFogFar: { value: SKY.fogFar } };

  // the floor: one opaque disc whose shading drifts slowly, so gaps between puffs still read as cloud
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(290, 48).rotateX(-Math.PI / 2),
    new THREE.ShaderMaterial({
      uniforms: { ...skyUniforms, ...fogUniforms, ...cloudUniforms, uLit: { value: SKY.cloudLit }, uShade: { value: SKY.cloudShade } },
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: SKY_GLSL + /* glsl */`
        uniform vec3 uLit, uShade;
        uniform float uFogNear, uFogFar, uTime;
        varying vec3 vWorld;
        void main() {
          vec2 p = vWorld.xz * 0.045 + vec2(uTime * 0.012, 0.0);
          float n = sin(p.x * 1.7 + sin(p.y * 1.3)) * 0.5 + sin(p.y * 2.3 + sin(p.x * 0.9) * 1.4) * 0.35 + sin((p.x + p.y) * 4.1) * 0.15;
          vec3 c = mix(uShade, uLit, smoothstep(-0.6, 0.7, n) * 0.75 + 0.15);
          vec3 eye = vWorld - cameraPosition;
          float d = length(eye);
          c = mix(c, hazeColor(eye / d), smoothstep(uFogNear * 0.5, uFogFar, d));
          gl_FragColor = vec4(c, 1.0);
          #include <colorspace_fragment>
        }`,
      fog: false
    })
  );
  floor.position.y = floorY;
  floor.raycast = () => {};
  group.add(floor);

  // the puffs: [x, y, z, size]
  const rand = rng(9), puffs = [];
  const ring = (count, rMin, rMax, yMin, yMax, sMin, sMax) => {
    for (let i = 0; i < count; i++) {
      const r = rMin + (rMax - rMin) * Math.sqrt(rand()), a = rand() * Math.PI * 2;
      puffs.push([Math.cos(a) * r, yMin + rand() * (yMax - yMin), Math.sin(a) * r, sMin + rand() * (sMax - sMin), rand()]);
    }
  };
  const k = small ? 0.65 : 1;
  ring(Math.round(10 * k), islandRadius * 0.5, islandRadius * 1.05, -4.6, -3.2, 3.2, 5.0);   // wisps under the island
  ring(Math.round(34 * k), 14, 70, floorY + 1, floorY + 4, 10, 18);
  ring(Math.round(30 * k), 70, 190, floorY + 2, floorY + 7, 22, 40);
  ring(Math.round(14 * k), 190, 260, floorY + 4, floorY + 10, 40, 70);   // banks along the horizon

  // transparent instances are not sorted per frame: order them far-to-near from where the camera mostly is
  const eye = new THREE.Vector3(8, 7, 22);
  puffs.sort((a, b) => Math.hypot(b[0] - eye.x, b[1] - eye.y, b[2] - eye.z) - Math.hypot(a[0] - eye.x, a[1] - eye.y, a[2] - eye.z));

  const geo = new THREE.InstancedBufferGeometry();
  const quad = new THREE.PlaneGeometry(1, 1);
  quad.translate(0, 0.42, 0);   // the puff's flat base sits near its anchor
  geo.index = quad.index;
  geo.setAttribute('position', quad.attributes.position);
  geo.setAttribute('uv', quad.attributes.uv);
  geo.setAttribute('aPuff', new THREE.InstancedBufferAttribute(new Float32Array(puffs.flatMap(p => p.slice(0, 4))), 4));
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(new Float32Array(puffs.map(p => p[4])), 1));
  geo.instanceCount = puffs.length;

  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({
    uniforms: { ...skyUniforms, ...fogUniforms, ...cloudUniforms, uMap: { value: puffAtlas() }, uLit: { value: SKY.cloudLit }, uShade: { value: SKY.cloudShade } },
    vertexShader: /* glsl */`
      attribute vec4 aPuff;
      attribute float aSeed;
      uniform float uTime;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        // one of the four atlas shapes, sometimes mirrored
        float q = floor(aSeed * 4.0);
        vec2 uvq = vec2(fract(aSeed * 13.7) > 0.5 ? 1.0 - uv.x : uv.x, 1.0 - uv.y);
        vUv = (uvq + vec2(mod(q, 2.0), floor(q / 2.0))) * 0.5;
        vec3 center = aPuff.xyz;
        center.x += sin(uTime * 0.04 + aSeed * 40.0) * aPuff.w * 0.08;
        // upright billboard: faces the camera around the vertical axis only, so the flat base stays level
        vec3 toCam = cameraPosition - center;
        vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x));
        vec3 w = center + right * position.x * aPuff.w * 1.7 + vec3(0.0, position.y * aPuff.w, 0.0);
        vWorld = w;
        gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: SKY_GLSL + /* glsl */`
      uniform sampler2D uMap;
      uniform vec3 uLit, uShade;
      uniform float uFogNear, uFogFar;
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vec4 t = texture2D(uMap, vUv);
        if (t.a < 0.01) discard;
        vec3 c = mix(uShade, uLit, t.r);
        vec3 eye = vWorld - cameraPosition;
        float d = length(eye);
        c = mix(c, hazeColor(eye / d), smoothstep(uFogNear, uFogFar, d));
        gl_FragColor = vec4(c, t.a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    fog: false
  }));
  mesh.frustumCulled = false;
  mesh.raycast = () => {};
  group.add(mesh);
  return { object: group };
}

// ── motes of light ───────────────────────────────────────────────────────
// Little warm lights that rise and wander around the island and fade in and out, one draw call of points.
export const moteUniforms = { uTime: { value: 0 }, uScale: { value: 1 } };

export function makeMotes(count = 70, radius = 8) {
  const rand = rng(77), pos = new Float32Array(count * 3), seed = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const r = Math.sqrt(rand()) * radius, a = rand() * Math.PI * 2;
    pos[i * 3] = Math.cos(a) * r;
    pos[i * 3 + 1] = -1 + rand() * 5;
    pos[i * 3 + 2] = Math.sin(a) * r;
    seed[i] = rand();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: moteUniforms,
    vertexShader: /* glsl */`
      attribute float aSeed;
      uniform float uTime, uScale;
      varying float vAlpha;
      void main() {
        float life = fract(uTime * (0.035 + aSeed * 0.03) + aSeed * 7.0);
        vec3 p = position;
        p.y += life * 3.0;
        p.x += sin(uTime * 0.37 + aSeed * 31.0) * 0.5;
        p.z += cos(uTime * 0.29 + aSeed * 17.0) * 0.5;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vAlpha = sin(life * 3.14159) * (0.55 + 0.45 * sin(uTime * 2.3 + aSeed * 50.0));
        gl_PointSize = (0.05 + aSeed * 0.08) * uScale / -mv.z;   // world size × (pixels per unit at distance 1)
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */`
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float a = pow(max(0.0, 1.0 - d), 2.2) * vAlpha;
        gl_FragColor = vec4(1.0, 0.9, 0.66, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false
  }));
  points.frustumCulled = false;
  points.raycast = () => {};
  return { object: points };
}
