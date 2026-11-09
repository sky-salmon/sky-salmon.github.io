import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

// Small seeded PRNG so the scene looks the same on every load.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Cheap smooth pseudo-noise in [-1, 1].
export function noise3(x, y, z, seed = 0) {
  return (
    Math.sin(x * 1.7 + seed) * Math.cos(y * 2.3 + seed * 1.3) +
    Math.sin(z * 1.9 + x * 0.7 + seed * 2.1) * 0.6 +
    Math.sin((x + y + z) * 3.1 + seed) * 0.25
  ) / 1.85;
}

// Merge vertices (so displacement keeps the surface closed) and push each one
// along its normal by noise. weight(x,y,z) can fade the effect out.
export function organic(geometry, amp, freq, seed = 1, weight = null) {
  let g = geometry;
  for (const name of Object.keys(g.attributes)) if (name !== 'position') g.deleteAttribute(name);
  g = mergeVertices(g, 1e-4);
  g.computeVertexNormals();
  const pos = g.attributes.position, nrm = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const w = weight ? weight(x, y, z) : 1;
    const n = noise3(x * freq, y * freq, z * freq, seed) * amp * w;
    pos.setXYZ(i, x + nrm.getX(i) * n, y + nrm.getY(i) * n, z + nrm.getZ(i) * n);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

export function canvasTexture(size, draw, h = size) {
  const c = document.createElement('canvas');
  c.width = size; c.height = h;
  draw(c.getContext('2d'), size, h);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

let blobTex = null;
export function blobShadow(w, d, opacity = 0.32) {
  blobTex ||= canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(40,52,30,1)');
    g.addColorStop(0.55, 'rgba(40,52,30,0.55)');
    g.addColorStop(1, 'rgba(40,52,30,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  });
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, opacity, depthWrite: false })
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.012;
  m.renderOrder = 1;
  m.raycast = () => {};
  return m;
}

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const clamp01 = x => Math.min(1, Math.max(0, x));
