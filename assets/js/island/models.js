// Procedural props the game has no model for (candle flame, book, rocks, the glowing marker), built from
// primitives, and the round glowing icons the bookshelf menu hangs on its slots. The kid, bench, candles, fox, shelf and butterflies
// are the game's own (sky.js).
import * as THREE from 'three';
import { part, addOutline } from './toon.js';
import { canvasTexture, blobShadow, rng } from './util.js';

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

// ── bookshelf menu ───────────────────────────────────────────────────────
const ICON_DRAW = {
  card(ctx) { ctx.strokeRect(-46, -32, 92, 64); ctx.beginPath(); ctx.arc(-18, -6, 11, 0, 7); ctx.stroke(); ctx.beginPath(); ctx.moveTo(-34, 22); ctx.quadraticCurveTo(-18, 2, -2, 22); ctx.moveTo(12, -12); ctx.lineTo(34, -12); ctx.moveTo(12, 4); ctx.lineTo(34, 4); ctx.moveTo(12, 18); ctx.lineTo(26, 18); ctx.stroke(); },
  height(ctx) {
    const person = (x, s) => { ctx.beginPath(); ctx.arc(x, -26 * s + 8, 8 * s, 0, 7); ctx.fill(); ctx.fillRect(x - 9 * s, -14 * s + 8, 18 * s, 30 * s); ctx.fillRect(x - 8 * s, 16 * s + 8, 6 * s, 20 * s); ctx.fillRect(x + 2 * s, 16 * s + 8, 6 * s, 20 * s); };
    person(-20, 1.15); person(22, 0.8);
    ctx.beginPath(); ctx.moveTo(2, -40); ctx.lineTo(2, 40); ctx.moveTo(-6, -32); ctx.lineTo(2, -40); ctx.lineTo(10, -32); ctx.stroke();
  },
  music(ctx) { ctx.beginPath(); ctx.moveTo(-30, -36); ctx.quadraticCurveTo(-40, 20, 0, 36); ctx.quadraticCurveTo(40, 20, 30, -36); ctx.moveTo(-36, -36); ctx.lineTo(36, -36); ctx.stroke(); ctx.lineWidth = 5; for (const x of [-16, -6, 4, 14]) { ctx.beginPath(); ctx.moveTo(x, -36); ctx.lineTo(x * 0.6, 22); ctx.stroke(); } },
  events(ctx) { ctx.strokeRect(-38, -30, 76, 66); ctx.beginPath(); ctx.moveTo(-38, -12); ctx.lineTo(38, -12); ctx.moveTo(-20, -40); ctx.lineTo(-20, -22); ctx.moveTo(20, -40); ctx.lineTo(20, -22); ctx.stroke(); ctx.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 6 : 15, a = -Math.PI / 2 + i * Math.PI / 4; ctx.lineTo(Math.cos(a) * r, 12 + Math.sin(a) * r); } ctx.closePath(); ctx.fill(); },
  gallery(ctx) { ctx.strokeRect(-40, -26, 80, 58); ctx.beginPath(); ctx.arc(0, 4, 16, 0, 7); ctx.stroke(); ctx.fillRect(-18, -36, 22, 10); ctx.beginPath(); ctx.arc(26, -14, 4, 0, 7); ctx.fill(); },
  wardrobe(ctx) {   // a cape on a hanger
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(0, -30); ctx.arc(7, -30, 7, Math.PI, Math.PI * 1.9); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -24); ctx.lineTo(-38, -6); ctx.lineTo(38, -6); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-28, -2); ctx.quadraticCurveTo(-40, 24, -36, 40); ctx.quadraticCurveTo(0, 30, 36, 40); ctx.quadraticCurveTo(40, 24, 28, -2); ctx.closePath(); ctx.fill();
  }
};

// The game's own interface draws its icons as fine white lines in a round, dusky glass button with a faint halo.
function stickerTexture(kind) {
  return canvasTexture(256, (ctx, s) => {
    const c = s / 2;
    const halo = ctx.createRadialGradient(c, c, 88, c, c, c);
    halo.addColorStop(0, 'rgba(255,246,222,0.55)'); halo.addColorStop(1, 'rgba(255,246,222,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, s, s);
    const glass = ctx.createRadialGradient(c, c - 30, 10, c, c, 98);
    glass.addColorStop(0, 'rgba(70,86,128,0.82)'); glass.addColorStop(1, 'rgba(30,40,72,0.88)');
    ctx.beginPath(); ctx.arc(c, c, 98, 0, Math.PI * 2); ctx.fillStyle = glass; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(255,248,230,0.92)'; ctx.stroke();
    ctx.translate(c, c); ctx.scale(1.02, 1.02);
    ctx.strokeStyle = ctx.fillStyle = '#fffaf0'; ctx.lineWidth = 6.5; ctx.lineCap = ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255,236,190,0.9)'; ctx.shadowBlur = 12;
    ICON_DRAW[kind](ctx);
  });
}

function labelTexture(text) {
  return canvasTexture(512, (ctx, w, h) => {
    ctx.font = '400 58px "NaniFont", "Chiron GoRound TC", "Noto Sans TC", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(24,34,64,0.75)'; ctx.shadowBlur = 14;
    ctx.fillStyle = '#fffaf0';
    ctx.fillText(text, w / 2, h / 2 + 2);
  }, 112);
}

export const SHELF_ITEMS = [
  { kind: 'card', label: '名片產生器', href: 'card.html' },
  { kind: 'wardrobe', label: '衣櫃圖鑑', href: 'wardrobe.html' },
  { kind: 'height', label: '身高計算', href: 'height.html' },
  { kind: 'events', label: '活動雷達', href: 'events.html' },
  { kind: 'music', label: '樂譜練習', href: 'music.html' },
  { kind: 'gallery', label: '光影相簿', href: 'gallery.html' }
];

// Hang the round icons + labels on the shelf at its slot_N / label_N empties. Returns the clickable icons and the
// speech-bubble anchor.
export function decorateShelf(root) {
  root.updateMatrixWorld(true);
  const find = name => { let n = null; root.traverse(o => { if (o.name === name) n = o; }); return n; };
  const icons = [];
  SHELF_ITEMS.forEach((item, i) => {
    const slot = find(`slot_${i + 1}`), labelSlot = find(`label_${i + 1}`);
    if (!slot) return;
    const sticker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.56),
      new THREE.MeshBasicMaterial({ map: stickerTexture(item.kind), transparent: true, alphaTest: 0.05 })
    );
    sticker.userData = { item };
    slot.add(sticker);
    icons.push(sticker);
    if (labelSlot) {
      const label = new THREE.Mesh(
        new THREE.PlaneGeometry(0.95, 0.21),
        new THREE.MeshBasicMaterial({ map: labelTexture(item.label), transparent: true })
      );
      label.raycast = () => {};
      labelSlot.add(label);
    }
  });
  let anchor = find('bubble_anchor');
  if (!anchor) { anchor = empty('bubble_anchor', -0.9, 3.95, 0); root.add(anchor); }
  const box = new THREE.Box3().setFromObject(root);
  return { icons, bubbleNode: anchor, height: box.max.y - box.min.y };
}

function empty(name, x, y, z, rx = 0) {
  const o = new THREE.Object3D();
  o.name = name; o.position.set(x, y, z); o.rotation.x = rx;
  return o;
}

// ── book lying on the grass + floating sparkle marker ────────────────────
export function makeBook() {
  const g = new THREE.Group();
  const cover = '#3f6fb8', paper = '#fbf8f1';
  const bottom = part(new THREE.BoxGeometry(1.0, 0.05, 0.74), cover);
  bottom.position.y = 0.03;
  g.add(bottom);
  const pages = part(new THREE.BoxGeometry(0.95, 0.1, 0.7), paper);
  pages.position.set(0.015, 0.1, 0);
  g.add(pages);
  // front cover hinges on the spine (x = -0.5) so the book can open at the end of the scroll
  const hinge = new THREE.Group();
  hinge.position.set(-0.5, 0.175, 0);
  g.add(hinge);
  const top = part(new THREE.BoxGeometry(1.0, 0.05, 0.74), cover);
  top.position.x = 0.5;
  hinge.add(top);
  const band = part(new THREE.BoxGeometry(0.06, 0.012, 0.745), '#f2c46d', { outline: false });
  band.position.set(0.18, 0.03, 0);
  hinge.add(band);
  g.add(blobShadow(1.5, 1.1, 0.35));

  const star = makeStarMarker();
  g.add(star);

  let openAmount = 0;
  return {
    object: g,
    setOpen(v) { openAmount = v; },
    update(t) {
      hinge.rotation.z = openAmount * Math.PI * 0.98;
      star.position.set(0, 0.75 + Math.sin(t * 2) * 0.08 + openAmount * 0.6, 0);
      star.scale.setScalar(Math.max(0.001, 1 - openAmount));
      star.userData.twinkle(t);
    }
  };
}

// The marker the game floats over things you can touch: a small four-pointed light in a soft halo.
// userData.twinkle(t) turns and pulses it.
export function makeStarMarker() {
  const starTex = canvasTexture(128, (ctx, s) => {
    const c = s / 2;
    ctx.translate(c, c);
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, c);
    core.addColorStop(0, 'rgba(255,255,248,1)'); core.addColorStop(0.18, 'rgba(255,240,200,0.9)'); core.addColorStop(1, 'rgba(255,220,150,0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? c * 0.12 : c * 0.98, a = i * Math.PI / 4; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
  });
  const g = new THREE.Group();
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.75, fog: false }));
  halo.scale.setScalar(1.0);
  const star = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
  star.scale.setScalar(0.55);
  g.add(halo, star);
  g.userData.twinkle = t => {
    star.material.rotation = Math.sin(t * 0.8) * 0.25;
    const k = 1 + Math.sin(t * 2.6) * 0.08;
    star.scale.setScalar(0.55 * k);
    halo.material.opacity = 0.6 + Math.sin(t * 2.6) * 0.15;
  };
  return g;
}

// ── floating faceted rocks ───────────────────────────────────────────────
// spots: [x, y, z, size]; authored: optional rock nodes from rocks.glb (cloned round-robin, size ignored)
export function makeRocks(spots, authored = null) {
  const g = new THREE.Group();
  const rocks = spots.map(([x, y, z, s], i) => {
    const r = authored && authored.length
      ? authored[i % authored.length].clone()
      : part(new THREE.DodecahedronGeometry(s, 0), '#f1e8d8', { flat: true });
    r.position.set(x, y, z);
    r.rotation.set(i, i * 2, i * 3);
    r.userData.base = y;
    g.add(r);
    return r;
  });
  return {
    object: g,
    update(t) {
      rocks.forEach((r, i) => {
        r.position.y = r.userData.base + Math.sin(t * 0.9 + i * 1.7) * 0.12;
        r.rotation.y += 0.004; r.rotation.x += 0.002;
      });
    }
  };
}
