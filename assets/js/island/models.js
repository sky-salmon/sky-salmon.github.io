// The candle flame (flame, glow, flickering light, rising sparks), built from primitives; the height page's stage
// lights its candles with it.
import * as THREE from 'three';
import { addOutline } from './toon.js';
import { canvasTexture, rng } from './util.js';

// ── candle with flame, glow and sparks ───────────────────────────────────
let glowTex = null;
function glowTexture() {
  glowTex ||= canvasTexture(128, (ctx, s) => {
    const gr = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,236,180,1)');
    gr.addColorStop(0.25, 'rgba(255,200,120,0.55)');
    gr.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, s, s);
  });
  return glowTex;
}

// Flame + glow + flickering light + rising sparks; origin = base of the flame.
// With several candles side by side, only one needs the light and the sparks; `phase` keeps them out of step.
export function makeFlame({ light: withLight = true, sparks: withSparks = true, glow: withGlow = true, phase = 0 } = {}) {
  const g = new THREE.Group();
  const flamePts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    flamePts.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.055 * (1 - t * 0.6), t * 0.2));
  }
  const flame = new THREE.Mesh(new THREE.LatheGeometry(flamePts, 14), new THREE.MeshBasicMaterial({ color: '#ff9b3d' }));
  const core = new THREE.Mesh(new THREE.LatheGeometry(flamePts, 12), new THREE.MeshBasicMaterial({ color: '#fff1c2' }));
  core.scale.setScalar(0.55);
  core.position.y = 0.005;
  flame.add(core);
  addOutline(flame);
  g.add(flame);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
  glow.scale.setScalar(1.1);
  glow.position.y = 0.1;
  if (withGlow) g.add(glow);

  const light = withLight ? new THREE.PointLight('#ffb867', 2.2, 3.5, 1.6) : null;
  if (light) { light.position.y = 0.15; g.add(light); }

  // rising sparks
  const N = withSparks ? 14 : 0, sparkPos = new Float32Array(N * 3), seeds = [];
  const rand = rng(5);
  for (let i = 0; i < N; i++) seeds.push({ phase: rand(), speed: 0.25 + rand() * 0.25, drift: (rand() - 0.5) * 0.25 });
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: '#ffb35c', size: 0.045, transparent: true, opacity: 0.9, depthWrite: false }));
  g.add(sparks);

  return {
    object: g,
    update(time) {
      const t = time + phase;
      const f = 1 + Math.sin(t * 13) * 0.06 + Math.sin(t * 7.3) * 0.05;
      flame.scale.set(1, f, 1);
      flame.rotation.z = Math.sin(t * 3.2) * 0.08;
      glow.material.opacity = 0.7 + Math.sin(t * 9) * 0.08;
      if (light) light.intensity = 2 + Math.sin(t * 11) * 0.3;
      for (let i = 0; i < N; i++) {
        const s = seeds[i], k = (t * s.speed + s.phase) % 1;
        sparkPos[i * 3] = Math.sin(k * 9 + i) * 0.05 + s.drift * k;
        sparkPos[i * 3 + 1] = 0.2 + k * 0.9;
        sparkPos[i * 3 + 2] = Math.cos(k * 7 + i) * 0.04;
      }
      sparkGeo.attributes.position.needsUpdate = true;
    }
  };
}
