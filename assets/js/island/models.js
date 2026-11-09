// Procedural toon props. Every model is built from primitives — no external assets.
import * as THREE from 'three';
import { part, toon, addOutline } from './toon.js';
import { organic, canvasTexture, blobShadow, rng } from './util.js';

// ── caped child ──────────────────────────────────────────────────────────
export function makeCharacter() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const C = {
    cape: '#ec7a3c', tunic: '#f4f0e8', legs: '#3b3944', skin: '#8a6450',
    mask: '#3a2f2a', hair: '#f6f5f2', eye: '#fff6d6', scarf: '#fbf8f2'
  };

  for (const sx of [-0.1, 0.1]) {
    const leg = part(new THREE.CylinderGeometry(0.072, 0.062, 0.5, 12), C.legs);
    leg.position.set(sx, 0.29, 0);
    body.add(leg);
    const foot = part(new THREE.SphereGeometry(0.08, 12, 8), C.legs);
    foot.scale.set(1, 0.62, 1.45);
    foot.position.set(sx, 0.05, 0.035);
    body.add(foot);
  }

  // puffy shorts/tunic
  const tunic = part(new THREE.SphereGeometry(0.2, 20, 14), C.tunic);
  tunic.scale.set(0.9, 0.9, 0.72);
  tunic.position.set(0, 0.64, -0.02);
  body.add(tunic);

  // cape: a lathed shell (outer + inner surface) open at the front, zig-zag hem
  const outer = [[0.12, 1.07], [0.2, 1.0], [0.29, 0.84], [0.37, 0.64], [0.45, 0.43]];
  const inner = outer.slice().reverse().map(([r, y]) => [r - 0.03, y + 0.012]);
  const prof = [...outer, ...inner, outer[0]].map(([r, y]) => new THREE.Vector2(r, y));
  const gap = 0.72;
  const capeGeo = new THREE.LatheGeometry(prof, 40, gap / 2, Math.PI * 2 - gap);
  const cp = capeGeo.attributes.position;
  for (let i = 0; i < cp.count; i++) {
    const y = cp.getY(i);
    if (y < 0.5) {
      const phi = Math.atan2(cp.getX(i), cp.getZ(i));
      cp.setY(i, y + Math.abs(Math.sin(phi * 4.5)) * 0.07 - 0.02);
    }
  }
  capeGeo.computeVertexNormals();
  const cape = part(capeGeo, C.cape, { side: THREE.DoubleSide });
  body.add(cape);

  // fluffy scarf collar
  const scarf = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const puff = part(new THREE.SphereGeometry(0.075, 12, 10), C.scarf);
    puff.position.set(Math.sin(a) * 0.14, 1.07 + Math.cos(a * 2) * 0.01, Math.cos(a) * 0.14);
    scarf.add(puff);
  }
  const drape = part(new THREE.SphereGeometry(0.075, 12, 10), C.scarf);
  drape.scale.set(1, 1.3, 0.7);
  drape.position.set(0, 0.97, 0.16);
  scarf.add(drape);
  body.add(scarf);

  // head
  const head = new THREE.Group();
  head.position.y = 1.32;
  body.add(head);
  const skull = part(new THREE.SphereGeometry(0.27, 24, 18), C.skin);
  head.add(skull);
  const mask = part(new THREE.SphereGeometry(0.21, 22, 16), C.mask);
  mask.scale.set(1.12, 1.05, 0.6);
  mask.position.set(0, -0.01, 0.175);
  head.add(mask);
  const eyeMat = new THREE.MeshBasicMaterial({ color: C.eye });
  for (const sx of [-0.078, 0.078]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.038, 12, 10), eyeMat);
    eye.scale.set(1, 1.25, 0.5);
    eye.position.set(sx, 0.015, 0.298);
    head.add(eye);
  }
  // hair: soft cap + bangs + back tufts + a cowlick
  const cap = part(new THREE.SphereGeometry(0.3, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.55), C.hair);
  cap.position.set(0, 0.04, -0.03);
  cap.rotation.x = -0.55;   // front edge lifts above the eyes, back falls to the nape
  head.add(cap);
  // tufts frame the face from the sides/back; bangs sit high so the mask stays visible
  const tufts = [[-0.25, 0.04, 0.02, 0.11], [0.25, 0.04, 0.02, 0.11], [-0.25, -0.12, -0.05, 0.1], [0.25, -0.12, -0.05, 0.1],
    [-0.15, -0.15, -0.19, 0.12], [0.15, -0.15, -0.19, 0.12], [0, -0.08, -0.25, 0.14], [-0.1, 0.25, 0.1, 0.09], [0.1, 0.25, 0.1, 0.09], [0, 0.27, 0.06, 0.1]];
  for (const [x, y, z, r] of tufts) {
    const t = part(new THREE.SphereGeometry(r, 12, 10), C.hair);
    t.position.set(x, y, z);
    head.add(t);
  }
  const curl = part(new THREE.ConeGeometry(0.06, 0.26, 10), C.hair);
  curl.position.set(0.03, 0.34, -0.02);
  curl.rotation.set(-0.35, 0, -0.5);
  head.add(curl);
  const gem = part(new THREE.OctahedronGeometry(0.035), '#f2c46d');
  gem.position.set(0, 0.215, 0.255);
  head.add(gem);

  const shadow = blobShadow(1.0, 0.7, 0.38);
  root.add(shadow);

  return {
    object: root,
    update(t) {
      body.position.y = Math.sin(t * 1.6) * 0.012;
      head.rotation.y = Math.sin(t * 0.45) * 0.28;
      head.rotation.z = Math.sin(t * 0.7) * 0.05;
      cape.rotation.y = Math.sin(t * 1.1) * 0.035;
      cape.scale.x = 1 + Math.sin(t * 1.6) * 0.015;
    }
  };
}

// ── stone bench ──────────────────────────────────────────────────────────
export function makeBench() {
  const g = new THREE.Group();
  const stone = '#ddd3c5';
  const slabGeo = organic(new THREE.BoxGeometry(3.0, 0.3, 0.92, 10, 2, 4), 0.06, 1.6, 2);
  const slab = part(slabGeo, stone, { flat: true });
  slab.position.y = 0.66;
  g.add(slab);
  for (const sx of [-1.0, 1.0]) {
    const legGeo = organic(new THREE.BoxGeometry(0.55, 0.56, 0.66, 3, 3, 3), 0.05, 2.2, sx > 0 ? 5 : 9);
    const leg = part(legGeo, '#cfc3b3', { flat: true });
    leg.position.set(sx, 0.27, 0);
    g.add(leg);
  }
  g.add(blobShadow(3.6, 1.5, 0.3));
  return { object: g, seatY: 0.82 };
}

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

export function makeCandle() {
  const g = new THREE.Group();
  const wax = part(new THREE.CylinderGeometry(0.055, 0.06, 0.46, 14), '#f7f3ea');
  wax.position.y = 0.23;
  g.add(wax);
  const drip = part(new THREE.SphereGeometry(0.035, 10, 8), '#f7f3ea');
  drip.scale.set(1, 1.6, 1);
  drip.position.set(0.05, 0.38, 0.02);
  g.add(drip);
  const wick = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.06, 6), new THREE.MeshBasicMaterial({ color: '#2a231f' }));
  wick.position.y = 0.49;
  g.add(wick);

  const flamePts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    flamePts.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.055 * (1 - t * 0.6), t * 0.2));
  }
  const flame = new THREE.Mesh(new THREE.LatheGeometry(flamePts, 14), new THREE.MeshBasicMaterial({ color: '#ff9b3d' }));
  flame.position.y = 0.5;
  const core = new THREE.Mesh(new THREE.LatheGeometry(flamePts, 12), new THREE.MeshBasicMaterial({ color: '#fff1c2' }));
  core.scale.setScalar(0.55);
  core.position.y = 0.005;
  flame.add(core);
  addOutline(flame);
  g.add(flame);

  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.85 }));
  glow.scale.setScalar(1.1);
  glow.position.y = 0.6;
  g.add(glow);

  const light = new THREE.PointLight('#ffb867', 2.2, 3.5, 1.6);
  light.position.y = 0.65;
  g.add(light);

  // rising sparks
  const N = 14, sparkPos = new Float32Array(N * 3), seeds = [];
  const rand = rng(5);
  for (let i = 0; i < N; i++) seeds.push({ phase: rand(), speed: 0.25 + rand() * 0.25, drift: (rand() - 0.5) * 0.25 });
  const sparkGeo = new THREE.BufferGeometry();
  sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3));
  const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ color: '#ffb35c', size: 0.045, transparent: true, opacity: 0.9, depthWrite: false }));
  g.add(sparks);

  return {
    object: g,
    update(t) {
      const f = 1 + Math.sin(t * 13) * 0.06 + Math.sin(t * 7.3) * 0.05;
      flame.scale.set(1, f, 1);
      flame.rotation.z = Math.sin(t * 3.2) * 0.08;
      glow.material.opacity = 0.7 + Math.sin(t * 9) * 0.08;
      light.intensity = 2 + Math.sin(t * 11) * 0.3;
      for (let i = 0; i < N; i++) {
        const s = seeds[i], k = (t * s.speed + s.phase) % 1;
        sparkPos[i * 3] = Math.sin(k * 9 + i) * 0.05 + s.drift * k;
        sparkPos[i * 3 + 1] = 0.7 + k * 0.9;
        sparkPos[i * 3 + 2] = Math.cos(k * 7 + i) * 0.04;
      }
      sparkGeo.attributes.position.needsUpdate = true;
    }
  };
}

// ── little round bird ────────────────────────────────────────────────────
export function makeBird() {
  const root = new THREE.Group();
  const b = new THREE.Group();
  root.add(b);
  const orange = '#f49a46', cream = '#fff1db', dark = '#2a231f';
  const body = part(new THREE.SphereGeometry(0.17, 20, 14), orange);
  body.scale.set(1, 0.92, 1.12);
  body.position.y = 0.17;
  b.add(body);
  const belly = part(new THREE.SphereGeometry(0.12, 16, 12), cream);
  belly.scale.set(0.9, 1, 0.5);
  belly.position.set(0, 0.17, 0.115);
  b.add(belly);
  const head = new THREE.Group();
  head.position.set(0, 0.34, 0.06);
  b.add(head);
  head.add(part(new THREE.SphereGeometry(0.115, 18, 12), orange));
  const beak = part(new THREE.ConeGeometry(0.03, 0.07, 8), '#f6c945');
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, -0.01, 0.12);
  head.add(beak);
  for (const sx of [-0.05, 0.05]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: dark }));
    eye.position.set(sx, 0.025, 0.095);
    head.add(eye);
  }
  const tuft = part(new THREE.ConeGeometry(0.025, 0.09, 6), orange);
  tuft.position.set(0, 0.12, -0.01);
  tuft.rotation.x = -0.4;
  head.add(tuft);
  const wings = [];
  for (const sx of [-1, 1]) {
    const w = part(new THREE.SphereGeometry(0.1, 12, 8), '#e07e2e');
    w.scale.set(0.35, 0.75, 1.1);
    w.position.set(sx * 0.15, 0.19, -0.02);
    b.add(w); wings.push(w);
  }
  const tail = part(new THREE.ConeGeometry(0.07, 0.18, 4), '#e07e2e');
  tail.rotation.x = -2.1;
  tail.position.set(0, 0.2, -0.2);
  b.add(tail);
  for (const sx of [-0.05, 0.05]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.05, 5), new THREE.MeshBasicMaterial({ color: dark }));
    leg.position.set(sx, 0.02, 0.02);
    b.add(leg);
  }
  root.add(blobShadow(0.42, 0.32, 0.35));
  return {
    object: root,
    update(t) {
      const cycle = t % 5.5;
      const hop = cycle > 4.6 && cycle < 5.1 ? Math.sin((cycle - 4.6) / 0.5 * Math.PI) : 0;
      b.position.y = hop * 0.12;
      head.rotation.y = Math.sin(t * 0.8) * 0.6 * (Math.sin(t * 0.3) > 0 ? 1 : 0.2);
      head.rotation.x = Math.sin(t * 2.1) * 0.05;
      wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * hop * 0.9; });
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
  about(ctx) { ctx.beginPath(); ctx.moveTo(0, 32); ctx.bezierCurveTo(-46, 4, -26, -38, 0, -14); ctx.bezierCurveTo(26, -38, 46, 4, 0, 32); ctx.fill(); }
};

function stickerTexture(kind) {
  return canvasTexture(256, (ctx, s) => {
    const r = (x, y, w, h, rad) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, rad); };
    r(10, 10, s - 20, s - 20, 46); ctx.fillStyle = '#fbf7ef'; ctx.fill();
    ctx.setLineDash([14, 10]); ctx.lineWidth = 6; ctx.strokeStyle = '#2a231f'; ctx.stroke(); ctx.setLineDash([]);
    r(34, 34, s - 68, s - 68, 34); ctx.fillStyle = '#231e1b'; ctx.fill();
    ctx.translate(s / 2, s / 2); ctx.scale(1.15, 1.15);
    ctx.strokeStyle = ctx.fillStyle = '#fbf3e4'; ctx.lineWidth = 8; ctx.lineCap = ctx.lineJoin = 'round';
    ICON_DRAW[kind](ctx);
  });
}

function labelTexture(text) {
  return canvasTexture(512, (ctx, w, h) => {
    ctx.fillStyle = '#2a231f';
    ctx.font = '700 56px "Noto Sans TC", "Outfit", sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(text, w / 2, h / 2 + 2);
  }, 112);
}

export const SHELF_ITEMS = [
  { kind: 'card', label: '名片產生器', href: 'card.html' },
  { kind: 'height', label: '身高計算', href: 'height.html' },
  { kind: 'music', label: '樂譜練習', href: 'music.html' },
  { kind: 'events', label: '活動倒數', href: 'events.html' },
  { kind: 'gallery', label: '光影相簿', href: '#' },
  { kind: 'about', label: '關於這裡', href: '#about' }
];

export function makeShelf() {
  const g = new THREE.Group();
  const W = 2.5, H = 3.2, D = 0.56;
  const wood = '#dcb57f', woodDark = '#c99c62';

  for (const sx of [-1, 1]) {
    const post = part(organic(new THREE.BoxGeometry(0.24, H, D, 1, 8, 2), 0.03, 1.4, sx > 0 ? 3 : 8), wood, { flat: true });
    post.position.set(sx * (W / 2), H / 2, 0);
    g.add(post);
  }
  const back = part(new THREE.BoxGeometry(W, H - 0.3, 0.05), '#f7f0e2');
  back.position.set(0, (H - 0.3) / 2 + 0.05, -D / 2 + 0.04);
  g.add(back);

  const boardYs = [0.3, 1.25, 2.18];
  for (const [i, y] of boardYs.entries()) {
    const board = part(organic(new THREE.BoxGeometry(W, 0.13, D, 6, 1, 2), 0.025, 2, 10 + i), woodDark, { flat: true });
    board.position.set(0, y, 0.02);
    board.rotation.z = (i - 1) * 0.015;
    g.add(board);
  }

  // crown with a hand-cut, bumpy top edge
  const hw = W / 2 + 0.34;
  const s = new THREE.Shape();
  s.moveTo(-hw, 0); s.lineTo(hw, 0); s.lineTo(hw + 0.06, 0.24);
  [[hw - 0.12, 0.4], [hw * 0.62, 0.36], [hw * 0.38, 0.52], [0.12, 0.74], [-0.22, 0.6], [-hw * 0.48, 0.48], [-hw * 0.78, 0.38], [-hw + 0.04, 0.42]]
    .forEach(([x, y]) => s.lineTo(x, y));
  s.lineTo(-hw - 0.06, 0.24); s.closePath();
  const crownGeo = new THREE.ExtrudeGeometry(s, { depth: D + 0.16, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 1 });
  crownGeo.translate(0, 0, -(D + 0.16) / 2);
  const crown = part(crownGeo, wood, { flat: true });
  crown.position.y = H - 0.12;
  g.add(crown);

  // stickers + labels
  const icons = [];
  SHELF_ITEMS.forEach((item, i) => {
    const row = Math.floor(i / 2), col = i % 2;
    const boardY = boardYs[2 - row];
    const x = (col ? 1 : -1) * 0.58;
    const sticker = new THREE.Mesh(
      new THREE.PlaneGeometry(0.56, 0.56),
      new THREE.MeshBasicMaterial({ map: stickerTexture(item.kind), transparent: true, alphaTest: 0.05 })
    );
    sticker.position.set(x, boardY + 0.42, 0.02);
    sticker.rotation.x = -0.08;
    sticker.userData = { item, baseScale: 1 };
    g.add(sticker);
    icons.push(sticker);
    const label = new THREE.Mesh(
      new THREE.PlaneGeometry(0.95, 0.21),
      new THREE.MeshBasicMaterial({ map: labelTexture(item.label), transparent: true })
    );
    label.position.set(x, boardY + 0.005, D / 2 + 0.035);
    label.raycast = () => {};
    g.add(label);
  });

  g.add(blobShadow(3.4, 1.4, 0.3));
  return { object: g, icons, height: H, bubbleAnchor: new THREE.Vector3(-0.9, H + 0.75, 0) };
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
  const top = part(new THREE.BoxGeometry(1.0, 0.05, 0.74), cover);
  top.position.y = 0.175;
  g.add(top);
  const band = part(new THREE.BoxGeometry(0.06, 0.012, 0.745), '#f2c46d', { outline: false });
  band.position.set(-0.32, 0.205, 0);
  g.add(band);
  g.add(blobShadow(1.5, 1.1, 0.35));

  // four-point star marker
  const s = new THREE.Shape();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 ? 0.07 : 0.2, a = i * Math.PI / 4;
    i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(r, 0);
  }
  const star = part(new THREE.ExtrudeGeometry(s, { depth: 0.04, bevelEnabled: false }), '#f6cf6e', { emissive: '#7a5a10' });
  star.geometry.translate(0, 0, -0.02);
  g.add(star);

  return {
    object: g,
    update(t) {
      star.position.set(0, 0.75 + Math.sin(t * 2) * 0.08, 0);
      star.rotation.y = t * 1.2;
    }
  };
}

// ── floating faceted rocks ───────────────────────────────────────────────
export function makeRocks(spots) {
  const g = new THREE.Group();
  const rocks = spots.map(([x, y, z, s], i) => {
    const r = part(new THREE.DodecahedronGeometry(s, 0), '#f1e8d8', { flat: true });
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

// ── hand-drawn sun with twinkling stars ──────────────────────────────────
export function makeSun() {
  const g = new THREE.Group();
  const sunTex = canvasTexture(512, (ctx, s) => {
    const c = s / 2;
    const glow = ctx.createRadialGradient(c, c, 60, c, c, c);
    glow.addColorStop(0, 'rgba(255,236,140,0.85)'); glow.addColorStop(1, 'rgba(255,236,140,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, s, s);
    const disc = ctx.createRadialGradient(c - 30, c - 30, 10, c, c, 120);
    disc.addColorStop(0, '#fff7b8'); disc.addColorStop(1, '#fde467');
    ctx.fillStyle = disc;
    ctx.beginPath(); ctx.arc(c, c, 112, 0, Math.PI * 2); ctx.fill();
    ctx.lineWidth = 9; ctx.strokeStyle = '#2a231f';
    // slightly wobbly ink line
    ctx.beginPath();
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2, rr = 112 + Math.sin(a * 5) * 1.6;
      i ? ctx.lineTo(c + Math.cos(a) * rr, c + Math.sin(a) * rr) : ctx.moveTo(c + rr, c);
    }
    ctx.stroke();
  });
  const sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: sunTex, transparent: true, depthWrite: false }));
  sun.scale.setScalar(2.6);
  g.add(sun);

  const starTex = canvasTexture(64, (ctx, s) => {
    ctx.translate(s / 2, s / 2); ctx.fillStyle = '#fbd85a';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) { const r = i % 2 ? 6 : 28, a = i * Math.PI / 4 - Math.PI / 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
  });
  const stars = [];
  for (let i = 0; i < 9; i++) {
    const st = new THREE.Sprite(new THREE.SpriteMaterial({ map: starTex, transparent: true, depthWrite: false }));
    const a = (i / 9) * Math.PI * 2;
    st.position.set(Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0.01);
    st.userData.phase = i * 0.7;
    g.add(st); stars.push(st);
  }
  return {
    object: g,
    update(t) {
      stars.forEach(st => st.scale.setScalar(0.22 + Math.sin(t * 2.2 + st.userData.phase) * 0.07));
      g.rotation.z = Math.sin(t * 0.3) * 0.05;
    }
  };
}

// ── butterflies ──────────────────────────────────────────────────────────
export function makeButterflies(n) {
  const g = new THREE.Group();
  const wingTex = canvasTexture(128, (ctx, s) => {
    const gr = ctx.createLinearGradient(0, 0, s, s);
    gr.addColorStop(0, '#ffd27a'); gr.addColorStop(1, '#f39a46');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.ellipse(s * 0.55, s * 0.38, s * 0.42, s * 0.3, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(s * 0.45, s * 0.74, s * 0.26, s * 0.2, 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(42,35,31,0.7)'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(s * 0.55, s * 0.38, s * 0.42, s * 0.3, -0.3, 0, Math.PI * 2); ctx.stroke();
  });
  const mat = new THREE.MeshBasicMaterial({ map: wingTex, transparent: true, side: THREE.DoubleSide, alphaTest: 0.1, depthWrite: false });
  const flies = [];
  for (let i = 0; i < n; i++) {
    const fly = new THREE.Group();
    const wings = [-1, 1].map(side => {
      const pivot = new THREE.Group();
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28), mat);
      w.rotation.x = -Math.PI / 2;
      w.position.x = side * 0.14;
      w.scale.x = side;
      pivot.add(w);
      fly.add(pivot);
      return pivot;
    });
    g.add(fly);
    flies.push({ fly, wings, seed: i * 2.3, center: [-0.5 + i * 1.6, 1.8 + i * 0.5, 0.6 - i * 0.8] });
  }
  return {
    object: g,
    update(t) {
      for (const f of flies) {
        const k = t * 0.35 + f.seed;
        f.fly.position.set(f.center[0] + Math.sin(k) * 1.6, f.center[1] + Math.sin(k * 2.3) * 0.35, f.center[2] + Math.cos(k * 1.3) * 1.1);
        f.fly.rotation.y = Math.atan2(Math.cos(k), -Math.sin(k * 1.3));
        const flap = Math.sin(t * 16 + f.seed) * 0.9;
        f.wings[0].rotation.z = -flap; f.wings[1].rotation.z = flap;
      }
    }
  };
}
