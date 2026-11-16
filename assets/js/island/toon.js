// Two looks share these helpers:
// - 'toon' (the height page): stepped lighting + screen-space-constant ink outlines (inverted hull);
// - 'soft' (the home island, in the game's own manner): smooth wrapped light with lifted, cool shadows and no
//   outlines. A page picks one with setLook() before it builds anything.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

let soft = false;
export function setLook(name) { soft = name === 'soft'; }

let gradientMap = null;
export function getGradientMap() {
  if (gradientMap) return gradientMap;
  let data;
  if (soft) {
    // MeshToonMaterial looks this up at dot(N, L) * 0.5 + 0.5 (a half-Lambert wrap): a smooth ramp whose dark end
    // stays well lifted, so a shaded side reads as soft daylight rather than a cel band
    data = new Uint8Array(64);
    for (let i = 0; i < data.length; i++) {
      const x = i / (data.length - 1), k = x * x * (3 - 2 * x);
      data[i] = Math.round(255 * (0.42 + 0.58 * k));
    }
  } else {
    // four soft tones — keeps the pastel, illustrated feel rather than harsh cel bands
    data = new Uint8Array([150, 195, 232, 255]);
  }
  gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradientMap.minFilter = gradientMap.magFilter = soft ? THREE.LinearFilter : THREE.NearestFilter;
  gradientMap.generateMipmaps = false;
  gradientMap.needsUpdate = true;
  return gradientMap;
}

const materialCache = new Map();
export function toon(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!opts.noCache && materialCache.has(key)) return materialCache.get(key);
  const { noCache, ...rest } = opts;
  const m = new THREE.MeshToonMaterial({ color, gradientMap: getGradientMap(), ...rest });
  if (!noCache) materialCache.set(key, m);
  return m;
}

export const outlineUniforms = {
  uThickness: { value: 1.7 },
  uResolution: { value: new THREE.Vector2(1, 1) },
  uColor: { value: new THREE.Color('#2a231f') }
};

export const outlineMaterial = new THREE.ShaderMaterial({
  uniforms: outlineUniforms,
  vertexShader: /* glsl */`
    uniform float uThickness;
    uniform vec2 uResolution;
    void main() {
      vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      vec3 vn = normalize(normalMatrix * normal);
      vec2 dir = (projectionMatrix * vec4(vn, 0.0)).xy;
      float len = length(dir);
      dir = len > 1e-5 ? dir / len : vec2(0.0);
      clip.xy += dir * uThickness * 2.0 / uResolution * clip.w;
      gl_Position = clip;
    }`,
  fragmentShader: /* glsl */`
    uniform vec3 uColor;
    void main() {
      gl_FragColor = vec4(uColor, 1.0);
      #include <colorspace_fragment>
    }`,
  side: THREE.BackSide
});

const outlineGeoCache = new WeakMap();
function outlineGeometry(geometry) {
  let g = outlineGeoCache.get(geometry);
  if (g) return g;
  g = geometry.clone();
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g = mergeVertices(g, 1e-3);   // shared vertices -> smooth normals -> unbroken outline at hard edges
  g.computeVertexNormals();
  outlineGeoCache.set(geometry, g);
  return g;
}

export function addOutline(mesh) {
  if (soft) return null;
  const o = new THREE.Mesh(outlineGeometry(mesh.geometry), outlineMaterial);
  o.raycast = () => {};
  o.name = 'outline';
  mesh.add(o);
  return o;
}

// MeshToonMaterial has no flatShading, so split faces to get per-face normals (low-poly facets).
export function facet(geometry) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  g.computeVertexNormals();
  return g;
}

// Convenience: toon mesh with outline (none in the soft look).
export function part(geometry, color, { outline = true, flat = false, ...matOpts } = {}) {
  if (flat) geometry = facet(geometry);
  const mesh = new THREE.Mesh(geometry, toon(color, matOpts));
  if (outline) addOutline(mesh);
  return mesh;
}
