/* candle·kit — wardrobe (wardrobe.html): a catalogue of every cosmetic, tried on a 3D Sky kid, and the whole look
 * shareable as a link.
 *
 * Assets (sky-fish-mod/tools/sky_avatar_glb.py → assets/avatar/):
 *   index.json   skeleton, clips, dyes, defaults and every piece { slot, type, file, icon, season, shader, offsets, prop, ... }
 *   skeleton.glb the shared 127-bone Sky kid skeleton with its animation clips
 *   pieces/…glb  one skinned mesh per outfit, joints named like the skeleton (rebound here by name)
 *   tex/…png     ramp / mask textures shared by many outfits
 * A look is { pieces: {slot: outfit}, dyes: {slot: [primary, secondary]}, clip }. It lives in localStorage and in the
 * link (#look=…), so sharing needs no account and no server. */
import { createAvatar, hsvToRgb } from './avatar-engine.js';

const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
const { toast, store } = window.Site;
const D = window.CardData;
const BASE = 'assets/avatar/';
const LOOK_KEY = 'candle.wardrobe.look';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// closet order of the slots; required ones can't be taken off (the game always wears one)
const SLOTS = [
  ['cape', t('斗篷')], ['mask', t('面具')], ['hair', t('髮型')], ['outfit', t('服裝')], ['hat', t('髮飾')], ['horn', t('頭飾')],
  ['neck', t('項鍊')], ['face', t('面飾')], ['shoes', t('鞋子')], ['prop', t('道具')]
];
const SLOT_ZH = Object.fromEntries(SLOTS);
const REQUIRED = new Set(['cape', 'mask', 'hair', 'outfit']);
const CLIP_ZH = { idle: t('待機'), idleStand: t('站姿'), waveSmall: t('揮手'), bow: t('鞠躬'), clap: t('拍手'), cheer: t('歡呼'), shy: t('害羞'),
  point: t('指'), think: t('思考'), sit: t('坐下'), umbrellaHoldPose: t('撐傘') };
const short = n => n.replace(/^CharSkyKid_/, '');
const full = n => (n.startsWith('CharSkyKid_') ? n : 'CharSkyKid_' + n);

let IDX = null;          // index.json
let CAT = new Map();     // outfit name → catalogue entry (label, season, price …) from card-data
let look = { pieces: {}, dyes: {}, clip: 'idle' };
let shared = false;      // showing a look that came in a link
const ui = { slot: 'cape', q: '', season: 'all' };

// ── 3D (assets/js/avatar-engine.js) ─────────────────────────────────────────
const canvas = $('#wd-canvas');
let kid = null, clips = {};
const wear = (slot, name) => kid.wear(slot, name);
const applyDye = slot => kid.setDyes(slot, look.dyes[slot] || []);
const play = id => kid.play(id);

// ── look: storage + link ─────────────────────────────────────────────────────
const b64 = s => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
function encodeLook(l) {
  const p = Object.fromEntries(Object.entries(l.pieces).filter(([, n]) => n).map(([s, n]) => [s, short(n)]));
  const d = Object.fromEntries(Object.entries(l.dyes).filter(([s, v]) => l.pieces[s] && v && v.some(x => x != null)));
  return b64(JSON.stringify({ v: 1, p, d, a: l.clip }));
}
function decodeLook(code) {
  const o = JSON.parse(unb64(code));
  const pieces = {};
  Object.entries(o.p || {}).forEach(([s, n]) => { const f = full(n); if (IDX.pieces[f] && IDX.pieces[f].slot === s) pieces[s] = f; });
  return { pieces, dyes: o.d || {}, clip: o.a || 'idle' };
}
const lookURL = () => (window.Site.pageURL ? window.Site.pageURL() : location.origin + location.pathname) + '#look=' + encodeLook(look);
function saveLook() { if (!shared) store.set(LOOK_KEY, look); }
function changed() {
  if (shared) { shared = false; $('#wd-banner').hidden = true; history.replaceState(null, '', location.pathname); }
  saveLook();
}
function defaults() {
  const p = {};
  Object.entries(IDX.defaults || {}).forEach(([s, n]) => { if (IDX.pieces[n]) p[s] = n; });
  return { pieces: p, dyes: {}, clip: 'idle' };
}
async function applyLook(l) {
  look = { pieces: Object.assign({}, l.pieces), dyes: Object.assign({}, l.dyes || {}), clip: clips[l.clip] ? l.clip : 'idle' };
  Object.keys(look.pieces).forEach(s => { const p = IDX.pieces[look.pieces[s]]; if (!p || !p.file) look.pieces[s] = null; });  // the game's "None" pieces
  REQUIRED.forEach(s => { if (!look.pieces[s] && IDX.defaults && IDX.defaults[s] && (IDX.pieces[IDX.defaults[s]] || {}).file) look.pieces[s] = IDX.defaults[s]; });
  await kid.wearLook(look);
  renderAnims(); renderGrid(); renderDetail();
}

// ── catalogue ────────────────────────────────────────────────────────────────
const iconURL = info => (info.icon ? D.iconURL(info.icon) : '');
function labelOf(name) {
  const c = CAT.get(name);
  return c ? c.label : short(name).replace(/^(Wing|Mask|Hair|Body|Hat|Horn|Neck|Tail|Feet|Face|Prop)_/, '').replace(/_/g, ' ');
}
function seasonOf(name) { const c = CAT.get(name); return c ? c.season : (IDX.pieces[name] || {}).season || null; }
function slotList(slot) {
  return Object.entries(IDX.pieces).filter(([, p]) => p.slot === slot && p.file).map(([n]) => n)
    .sort((a, b) => ((CAT.get(a) || {}).order || 1e9) - ((CAT.get(b) || {}).order || 1e9) || a.localeCompare(b));
}
function renderSlots() {
  $('#wd-slots').innerHTML = SLOTS.filter(([s]) => Object.values(IDX.pieces).some(p => p.slot === s)).map(([s, zh]) =>
    `<button type="button" role="tab" class="wd-slot" data-slot="${s}" aria-selected="${s === ui.slot}">${zh}${look.pieces[s] ? '<i aria-hidden="true"></i>' : ''}</button>`).join('');
}
function renderSeasons() {
  const codes = [...new Set(Object.keys(IDX.pieces).map(seasonOf).filter(Boolean))].sort().reverse();
  $('#wd-season').innerHTML = `<option value="all">${t('全部季節')}</option><option value="none">${t('非季節物品')}</option>` +
    codes.map(c => `<option value="${c}">${esc(D.seasonFull(c))}</option>`).join('');
  $('#wd-season').value = ui.season;
}
function renderGrid() {
  renderSlots();
  const q = ui.q.trim().toLowerCase();
  const list = slotList(ui.slot).filter(n => {
    const s = seasonOf(n);
    if (ui.season === 'none' ? s : (ui.season !== 'all' && s !== ui.season)) return false;
    return !q || (labelOf(n) + ' ' + n + ' ' + (s ? D.seasonFull(s) : '')).toLowerCase().includes(q);
  });
  const on = look.pieces[ui.slot];
  $('#wd-grid').innerHTML = (REQUIRED.has(ui.slot) ? '' : `<button type="button" class="wd-item is-none" data-wear="" aria-pressed="${!on}" title="${t('不穿')}"><span>${t('不穿')}</span></button>`) +
    list.map(n => {
      const s = seasonOf(n), info = IDX.pieces[n];
      return `<button type="button" class="wd-item" data-wear="${esc(n)}" aria-pressed="${on === n}" title="${esc(labelOf(n) + (s ? ' · ' + D.seasonName(s) : ''))}">
        ${s ? `<span class="wd-tag">AP${esc(s)}</span>` : ''}${iconURL(info) ? `<img src="${esc(iconURL(info))}" alt="" loading="lazy" decoding="async">` : `<span class="wd-noimg">${esc(labelOf(n))}</span>`}</button>`;
    }).join('') + (list.length ? '' : `<p class="wd-empty">${t('找不到符合的物品，換個關鍵字試試。')}</p>`);
}
function priceOf(c) { return c && c.usd && c.usd !== '?' ? 'US$' + c.usd : ''; }
function renderDetail() {
  const name = look.pieces[ui.slot];
  if (!name) { $('#wd-detail').innerHTML = `<p class="hint">${t('{slot}：目前沒有穿。', { slot: SLOT_ZH[ui.slot] })}</p>`; return; }
  const info = IDX.pieces[name], c = CAT.get(name), s = seasonOf(name), sh = info.shader || {};
  const facts = [
    s ? `<span>${esc(D.seasonFull(s))}${c && c.ult ? ' · ' + t('畢業禮') : ''}</span>` : '',
    c && c.pack ? `<span>${esc(c.pack)}${priceOf(c) ? ' · ' + priceOf(c) : ''}</span>` : '',
  ].filter(Boolean).join('');
  const dyeable = sh.dyeable || {};
  const [p, sec] = look.dyes[ui.slot] || [];
  const swatches = (which, cur) => `<div class="wd-dyes" role="radiogroup" aria-label="${which ? t('副色') : t('主色')}">
      <button type="button" class="wd-dye is-none" data-dye="${which}" data-id="" aria-checked="${cur == null}" title="${t('原色')}"></button>
      ${IDX.dyes.map(d => `<button type="button" class="wd-dye" data-dye="${which}" data-id="${esc(d.id)}" aria-checked="${cur === d.id}" title="${esc(d.name_en || d.id)}" style="--c:rgb(${hsvToRgb(d.hsv).map(x => Math.round(x * 255)).join(',')})"></button>`).join('')}</div>`;
  $('#wd-detail').innerHTML = `<div class="wd-d-head">${iconURL(info) ? `<img src="${esc(iconURL(info))}" alt="">` : ''}
      <div><b>${esc(labelOf(name))}</b><small class="mono">${esc(short(name))}</small></div>
      ${REQUIRED.has(ui.slot) ? '' : `<button type="button" class="btn btn-sm" data-wear="">${t('卸下')}</button>`}</div>
    ${facts ? `<p class="wd-facts">${facts}</p>` : ''}
    ${dyeable.primary ? `<p class="wd-d-label">${t('主色')}</p>${swatches(0, p)}` : ''}
    ${dyeable.secondary ? `<p class="wd-d-label">${t('副色')}</p>${swatches(1, sec)}` : ''}`;
}
function renderAnims() {
  $('#wd-anims').innerHTML = IDX.clips.filter(c => clips[c.id] && !c.hidden && !/^hold_/.test(c.id) && c.id !== 'umbrellaHoldPose').map(c =>
    `<button type="button" class="wd-chip" data-clip="${esc(c.id)}" aria-pressed="${look.clip === c.id}">${esc(CLIP_ZH[c.id] || c.label_en || c.id)}</button>`).join('');
}
let statusT = 0;
function status(msg) { clearTimeout(statusT); const el = $('#wd-status'); el.textContent = msg; el.hidden = !msg; }

// ── events ───────────────────────────────────────────────────────────────────
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.slot) { ui.slot = b.dataset.slot; ui.q = ''; $('#wd-q').value = ''; ui.season = 'all'; $('#wd-season').value = 'all'; renderGrid(); renderDetail(); $('#wd-grid').scrollTop = 0; return; }
  if (b.dataset.wear !== undefined) {
    const n = b.dataset.wear, slot = n ? IDX.pieces[n].slot : ui.slot;
    if (!n && REQUIRED.has(slot)) { toast(t('這個部位一定要穿一件')); return; }
    if (n && look.pieces[slot] === n && !REQUIRED.has(slot)) { look.pieces[slot] = null; delete look.dyes[slot]; }
    else { look.pieces[slot] = n || null; delete look.dyes[slot]; }
    changed(); renderGrid(); renderDetail();
    await wear(slot, look.pieces[slot]);
    return;
  }
  if (b.dataset.dye !== undefined) {
    const v = look.dyes[ui.slot] || [null, null];
    v[+b.dataset.dye] = b.dataset.id || null;
    look.dyes[ui.slot] = v;
    applyDye(ui.slot); changed(); renderDetail(); return;
  }
  if (b.dataset.clip) { look.clip = b.dataset.clip; play(look.clip); changed(); renderAnims(); return; }
  if (b.id === 'wd-random') {
    const l = { pieces: {}, dyes: {}, clip: look.clip };
    SLOTS.forEach(([s]) => {
      const list = slotList(s);
      if (!list.length) return;
      if (REQUIRED.has(s) || Math.random() < (s === 'prop' ? 0.25 : 0.5)) l.pieces[s] = list[Math.floor(Math.random() * list.length)];
    });
    shared = false; $('#wd-banner').hidden = true;
    await applyLook(l); saveLook(); return;
  }
  if (b.id === 'wd-reset') { shared = false; $('#wd-banner').hidden = true; history.replaceState(null, '', location.pathname); await applyLook(defaults()); saveLook(); return; }
  if (b.id === 'wd-shot') { shot(); return; }
  if (b.id === 'wd-share') { openShare(); return; }
  if (b.id === 'wd-copy') { copyLink(); return; }
  if (b.id === 'wd-native') { navigator.share({ title: t('我的 Sky 造型'), url: $('#wd-link').value }).catch(() => {}); return; }
  if (b.hasAttribute('data-close')) { $('#wd-share-sheet').hidden = true; return; }
  if (b.id === 'wd-mine') {
    shared = false; $('#wd-banner').hidden = true; history.replaceState(null, '', location.pathname);
    await applyLook(store.get(LOOK_KEY, null) || defaults()); return;
  }
});
let qT = 0;
$('#wd-q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { ui.q = e.target.value; renderGrid(); }, 150); });
$('#wd-season').addEventListener('change', e => { ui.season = e.target.value; renderGrid(); });
$('#wd-share-sheet').addEventListener('click', e => { if (e.target.id === 'wd-share-sheet') $('#wd-share-sheet').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#wd-share-sheet').hidden = true; });
window.addEventListener('hashchange', () => { const m = location.hash.match(/look=([\w-]+)/); if (m) openShared(m[1]); });

function openShare() {
  $('#wd-link').value = lookURL();
  $('#wd-native').hidden = !navigator.share;
  $('#wd-share-sheet').hidden = false;
  $('#wd-copy').focus();
}
async function copyLink() {
  const v = $('#wd-link').value;
  try { await navigator.clipboard.writeText(v); toast(t('已複製造型連結')); }
  catch { $('#wd-link').select(); toast(t('請長按連結手動複製')); }
}
async function shot() {
  const bl = await kid.snapshot();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(bl); a.download = 'sky-look.png';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function openShared(code) {
  let l;
  try { l = decodeLook(code); } catch { toast(t('這個造型連結無法讀取')); return; }
  shared = true;
  const banner = $('#wd-banner');
  banner.innerHTML = `<p>${t('這是朋友分享的造型。換任何一件就會變成你的造型。')}</p><button type="button" class="btn btn-sm" id="wd-mine">${t('回到我的造型')}</button>`;
  banner.hidden = false;
  await applyLook(l);
}

// ── start ────────────────────────────────────────────────────────────────────
(async () => {
  try {
    const [k, catalog] = await Promise.all([
      createAvatar(canvas, { base: BASE, onStatus: (st, name) => status(st === 'loading' ? t('載入 {name}…', { name: labelOf(name) }) : st === 'error' ? t('{name} 載入失敗', { name: labelOf(name) }) : '') }),
      D.loadCatalog().catch(() => [])
    ]);
    kid = k; IDX = kid.index; clips = kid.clips;
    catalog.forEach(i => { if (!CAT.has(i.name)) CAT.set(i.name, i); });
    renderSeasons();
    const m = location.hash.match(/look=([\w-]+)/);
    if (m) await openShared(m[1]);
    else await applyLook(store.get(LOOK_KEY, null) || defaults());
    status('');
    window.__wardrobeReady = true;
  } catch (e) {
    console.error(e);
    status(t('衣櫃載入失敗，請重新整理再試一次。'));
  }
})();
