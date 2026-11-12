import * as THREE from 'three';

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
