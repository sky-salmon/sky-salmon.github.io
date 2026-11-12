/* candle·kit — "my child of light" demo (avatar.html): an in-game outfit QR (Sky Mirror / Sky AR) → the same kid in 3D.
 *
 * QR format (decoded from real codes): https://sky.thatg.co/o=<base64> → LZ4 block → JSON
 *   { "b": [id,0,0,0,"(primary,secondary)"], "w": …, "h": [hair…], "ms", "n", "f", "hn", "fc", "p", "ht",
 *     "h": <height>, "s": <scale>, "v": 3, … }   (note the two "h" keys: the hair slot, then the height number)
 * Slot ids are the FNV-1a 32-bit hash of the OutfitDefs name; dyes are DyeColorDefs ids ("-" / "none" = none).
 * Everything runs in this browser. */
import { createAvatar, dyeCss } from './avatar-engine.js';

const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
const D = window.CardData;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const QR_SLOTS = { b: 'outfit', w: 'cape', hair: 'hair', ms: 'mask', n: 'neck', f: 'shoes', hn: 'horn', fc: 'face', p: 'prop', ht: 'hat' };
const SLOT_ZH = { cape: t('斗篷'), mask: t('面具'), hair: t('髮型'), outfit: t('服裝'), hat: t('髮飾'), horn: t('頭飾'), neck: t('項鍊'), face: t('面飾'), shoes: t('鞋子'), prop: t('道具') };
const ORDER = ['outfit', 'cape', 'hair', 'hat', 'horn', 'mask', 'face', 'neck', 'shoes', 'prop'];

// ── QR payload ───────────────────────────────────────────────────────────────
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (const c of new TextEncoder().encode(str)) { h ^= c; h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}
function lz4Block(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const tok = src[i++];
    let lit = tok >> 4;
    if (lit === 15) { let b; do { b = src[i++]; lit += b; } while (b === 255); }
    for (let k = 0; k < lit; k++) out.push(src[i++]);
    if (i >= src.length) break;
    const off = src[i] | (src[i + 1] << 8); i += 2;
    let ml = tok & 15;
    if (ml === 15) { let b; do { b = src[i++]; ml += b; } while (b === 255); }
    ml += 4;
    const p = out.length - off;
    if (off <= 0 || p < 0) throw new Error('bad LZ4 data');
    for (let k = 0; k < ml; k++) out.push(out[p + k]);
  }
  return new Uint8Array(out);
}
let NAMES = null;  // FNV-1a → outfit name
function decodeQR(text, index) {
  const m = String(text).match(/\/o=([A-Za-z0-9+/_=-]+)/) || String(text).match(/^([A-Za-z0-9+/_=-]{40,})$/);
  if (!m) throw new Error(t('這不是 Sky 的服裝 QR（找不到 sky.thatg.co/o=…）'));
  let b = m[1].replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  while (b.length % 4) b += '=';
  const bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0));
  const json = new TextDecoder().decode(lz4Block(bytes)).replace(/\0+$/, '').replace(/"h"\s*:\s*\[/, '"hair":[');
  const raw = JSON.parse(json);
  if (!NAMES) { NAMES = new Map(); Object.keys(index.pieces).forEach(n => NAMES.set(fnv1a(n), n)); }
  const pieces = {}, dyes = {}, unknown = {};
  for (const [k, slot] of Object.entries(QR_SLOTS)) {
    const v = raw[k];
    if (!Array.isArray(v)) continue;
    const name = NAMES.get(v[0] >>> 0);
    if (name) pieces[slot] = name; else unknown[slot] = v[0];
    const dm = typeof v[4] === 'string' && v[4].match(/^\((.*?),(.*?)\)$/);
    if (dm) dyes[slot] = [dm[1], dm[2]].map(x => (x && x !== 'none' && x !== '-' ? x.trim() : null));
  }
  return { pieces, dyes, unknown, height: +raw.h || 0, scale: +raw.s || 0, raw };
}

// QR from a screenshot: full image, then smaller and larger copies (jsQR is picky about module size)
async function readQR(file) {
  if (typeof window.jsQR !== 'function') throw new Error(t('QR 解碼器沒有載入，請檢查網路，或改貼 QR 連結。'));
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
  for (const k of [1, 0.75, 0.5, 1.5, 0.35]) {
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    if (w < 80 || w > 4000) continue;
    c.width = w; c.height = h; g.drawImage(img, 0, 0, w, h);
    const r = window.jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'attemptBoth' });
    if (r && r.data) return r.data;
  }
  throw new Error(t('截圖裡找不到 QR，請截清楚一點，或改貼 QR 連結。'));
}

// ── page ─────────────────────────────────────────────────────────────────────
let kid = null, CAT = new Map();
const status = msg => { const el = $('#av-status'); el.textContent = msg || ''; el.hidden = !msg; };
const msg = (text, bad) => { const el = $('#av-msg'); el.textContent = text || ''; el.hidden = !text; el.classList.toggle('bad', !!bad); };
const labelOf = n => (CAT.get(n) ? CAT.get(n).label : n.replace(/^CharSkyKid_/, '').replace(/_/g, ' '));
const swatch = id => { const d = kid.index.dyes.find(x => x.id === id); return d ? `<i class="av-dye" title="${esc(d.name_en || id)}" style="--c:${dyeCss(d.hsv)}"></i>` : ''; };

let QRNAMES = null;
async function decode(text) {
  const R = kid.rules;
  if (!R || !R.decodeOutfitQR) return decodeQR(text, kid.index);
  if (!/o=|^[A-Za-z0-9+/_=-]{40,}$/.test(String(text).trim())) throw new Error(t('這不是 Sky 的服裝 QR（找不到 sky.thatg.co/o=…）'));
  if (!QRNAMES) QRNAMES = await (await fetch('assets/avatar/' + (kid.index.qrNames || 'qr-names.json'))).json();
  const o = R.decodeOutfitQR(text, QRNAMES), unknown = {};
  Object.entries(o.pieces).forEach(([s, n]) => { if (n && n.startsWith('#')) { unknown[s] = n.slice(1); o.pieces[s] = null; } });
  return Object.assign(o, { unknown });
}
const ATT_ZH = { Neutral: t('一般'), ColdWind: t('怕冷'), HandsOut: t('張開雙手'), Proud: t('驕傲'), Sneaky: t('偷偷摸摸'), Tough: t('強悍'), Solemn: t('莊重'),
  Sassy: t('俏皮'), Lazy: t('慵懶'), Wise: t('智者'), Timid: t('害羞'), Nerdy: t('書呆'), Injured: t('受傷'), Sad: t('難過'), Guard: t('戒備') };
async function show(text) {
  let o;
  try { o = await decode(text); } catch (e) { msg(e.message && /[^\x00-\x7f]/.test(e.message) ? e.message : t('QR 內容無法解析'), true); return; }
  msg('');
  const clip = kid.rules && kid.rules.attitudeClip ? kid.rules.attitudeClip(kid.index, o.attitude) : 'idle';
  const look = { pieces: {}, dyes: o.dyes, clip, body: { height: o.height, scale: o.scale } };
  ORDER.forEach(s => { look.pieces[s] = o.pieces[s] && kid.index.pieces[o.pieces[s]] ? o.pieces[s] : null; });
  status(t('組裝中…'));
  await kid.wearLook(look);
  status('');
  // 0 = tallest … 1 = shortest within the same body type (community formula, as on the height page)
  const rank = Math.min(1, Math.max(0, 0.5 - o.height / 4));
  $('#av-body').innerHTML = `<div><span>${t('身高')}</span><b class="mono">${o.height.toFixed(3)}</b><small>${t('同體型中比 {p}% 的人高', { p: Math.round((1 - rank) * 100) })}</small></div>
    <div><span>${t('體型')}</span><b class="mono">${o.scale.toFixed(3)}</b><small>${o.scale < -0.05 ? t('偏小') : o.scale > 0.05 ? t('偏大') : t('標準')}</small></div>
    ${o.attitudeName ? `<div><span>${t('姿態')}</span><b>${esc(ATT_ZH[o.attitudeName] || o.attitudeName)}</b><small class="mono">${esc(o.attitudeName)}</small></div>` : ''}`;
  $('#av-body').hidden = false;
  $('#av-list').innerHTML = ORDER.map(s => {
    const n = o.pieces[s], info = n && kid.index.pieces[n];
    if (!n && o.unknown[s] == null) return '';
    const none = info && !info.file;
    const icon = info && info.icon ? `<img src="${esc(D.iconURL(info.icon))}" alt="">` : '<span class="av-noimg"></span>';
    const note = o.unknown[s] != null ? t('不認得的物品（#{id}）', { id: o.unknown[s] }) : !info ? t('網站還沒有這件的模型') : none ? t('沒穿') : '';
    const dy = (o.dyes[s] || []).filter(Boolean).map(swatch).join('');
    return `<div class="av-row${note ? ' is-off' : ''}">${icon}<span class="av-slot">${SLOT_ZH[s]}</span>
      <span class="av-name">${esc(n ? labelOf(n) : '—')}${note ? `<small>${esc(note)}</small>` : ''}</span><span class="av-dyes">${dy}</span></div>`;
  }).join('');
}

$('#av-file').addEventListener('change', async e => {
  const f = e.target.files[0]; e.target.value = '';
  if (!f) return;
  try { await show(await readQR(f)); } catch (err) { msg(err.message, true); }
});
$('#av-go').addEventListener('click', () => { const v = $('#av-url').value.trim(); if (v) show(v); });
$('#av-url').addEventListener('keydown', e => { if (e.key === 'Enter') $('#av-go').click(); });
const drop = $('#av-drop');
drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async e => {
  e.preventDefault(); drop.classList.remove('over');
  const f = e.dataTransfer.files[0];
  if (f) { try { await show(await readQR(f)); } catch (err) { msg(err.message, true); } }
});
document.addEventListener('paste', e => {
  const f = [...(e.clipboardData || {}).files || []].find(x => /^image\//.test(x.type));
  if (f) readQR(f).then(show).catch(err => msg(err.message, true));
});
$('#av-front').addEventListener('click', () => kid.frame('front'));
$('#av-side').addEventListener('click', () => kid.frame('side'));
$('#av-shot').addEventListener('click', async () => {
  const bl = await kid.snapshot(), a = document.createElement('a');
  a.href = URL.createObjectURL(bl); a.download = 'my-sky-kid.png';
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});
function renderAnims() {
  const ZH = { idle: t('待機'), idleStand: t('站姿'), waveSmall: t('揮手'), bow: t('鞠躬'), clap: t('拍手'), cheer: t('歡呼'), shy: t('害羞'), point: t('指'), think: t('思考'), sit: t('坐下') };
  $('#av-anims').innerHTML = kid.index.clips.filter(c => kid.clips[c.id] && ZH[c.id]).map(c => `<button type="button" class="wd-chip" data-clip="${c.id}">${ZH[c.id]}</button>`).join('');
}
$('#av-anims').addEventListener('click', e => {
  const b = e.target.closest('[data-clip]'); if (!b) return;
  kid.play(b.dataset.clip);
  $('#av-anims').querySelectorAll('[data-clip]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
});

(async () => {
  try {
    const [k, catalog] = await Promise.all([createAvatar($('#av-canvas'), { onStatus: st => status(st === 'loading' ? t('載入素材…') : '') }), D.loadCatalog().catch(() => [])]);
    kid = k;
    catalog.forEach(i => { if (!CAT.has(i.name)) CAT.set(i.name, i); });
    renderAnims();
    const d = {}; Object.entries(kid.index.defaults || {}).forEach(([s, n]) => { if ((kid.index.pieces[n] || {}).file) d[s] = n; });
    await kid.wearLook({ pieces: d, dyes: {}, clip: 'idle' });
    status(t('上傳 QR 截圖，或貼上 QR 連結'));
    const q = location.hash.match(/qr=([^&]+)/);
    if (q) show(decodeURIComponent(q[1]));
    window.__avatarReady = true;
    window.__decodeQR = decode;
    window.__kid = kid;
  } catch (e) { console.error(e); status(t('載入失敗，請重新整理再試一次。')); }
})();
