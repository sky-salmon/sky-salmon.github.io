// Toon look: stepped lighting + screen-space-constant ink outlines (inverted hull).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

let gradientMap = null;
export function getGradientMap() {
  if (gradientMap) return gradientMap;
  // four soft tones — keeps the pastel, illustrated feel rather than harsh cel bands
  const data = new Uint8Array([150, 195, 232, 255]);
  gradientMap = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  gradientMap.minFilter = gradientMap.magFilter = THREE.NearestFilter;
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

// Convenience: toon mesh with outline.
export function part(geometry, color, { outline = true, flat = false, ...matOpts } = {}) {
  if (flat) geometry = facet(geometry);
  const mesh = new THREE.Mesh(geometry, toon(color, matOpts));
  if (outline) addOutline(mesh);
  return mesh;
}
