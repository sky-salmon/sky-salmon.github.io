// 身高計算 — reads an outfit QR screenshot on-device, finds the height/scale
// parameters, applies the community estimate formula and drives the 3D stage.
// The 3D stage is loaded lazily, so the calculator keeps working without WebGL/CDN.
const { store, toast, loadImage, readFileAsDataURL, bindDropzone } = window.Site;
const $ = id => document.getElementById(id);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const narrowMQ = window.matchMedia('(max-width: 760px)');

const KEY_LAST = 'candle.height.last';    // read by card.html
const KEY_INPUT = 'candle.height.input';  // this page's own memory of the last values

// ── formula ─────────────────────────────────────────────────────────────
// Community-shared estimate: smaller number = taller. The range only depends on scale.
export function compute(height, scale) {
  const base = 7.6 - 8.3 * scale;
  return { current: base - 3 * height, tallest: base - 6, shortest: base + 6, height, scale };
}
// 0 = tallest … 1 = shortest (equals 0.5 − height / 4)
const rangePos = r => (r.current - r.tallest) / (r.shortest - r.tallest);

// ── QR payload parsing ──────────────────────────────────────────────────
const KEYS = {
  height: { height: 0, bodyheight: 0, body_height: 0, h: 1, ht: 1, hgt: 1 },
  scale: { scale: 0, bodyscale: 0, body_scale: 0, s: 1, sc: 1, scl: 1 }
};
const NUM = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?`;
const PAIR_RE = new RegExp(String.raw`(?:^|[^A-Za-z0-9_])["']?([A-Za-z_]{1,12})["']?\s*[:=]\s*["']?(${NUM})(?![\d.])`, 'gi');

function asUrl(s) {
  if (/\s/.test(s)) return null;
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return new URL(s);
    if (/^[\w-]+(\.[\w-]+)+\/\S*/.test(s)) return new URL('https://' + s);
  } catch { /* not a URL */ }
  return null;
}

async function inflate(bytes, format) {
  if (typeof DecompressionStream !== 'function') return null;
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  } catch { return null; }
}

function bytesToText(bytes) {
  if (!bytes || !bytes.length) return null;
  const text = new TextDecoder('utf-8').decode(bytes);
  let printable = 0;
  for (const ch of text) if (/[\p{L}\p{N}\p{P}\p{S}\s]/u.test(ch) && ch !== '�') printable++;
  return printable / [...text].length > 0.85 ? text : null;
}

// base64 / base64url → text (also gzip / zlib payloads)
async function fromBase64(s) {
  const t = s.replace(/\s+/g, '');
  if (t.length < 6 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(t) || /^\d+$/.test(t)) return null;
  let b = t.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (b.length % 4 === 1) return null;
  while (b.length % 4) b += '=';
  let bytes;
  try { bytes = Uint8Array.from(atob(b), c => c.charCodeAt(0)); } catch { return null; }
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await inflate(bytes, 'gzip');
  else if (bytes[0] === 0x78 && [0x01, 0x5e, 0x9c, 0xda].includes(bytes[1])) bytes = await inflate(bytes, 'deflate');
  return bytesToText(bytes);
}

// Breadth-first expansion: URL parts, percent-decoding and (nested) base64.
async function expand(text) {
  const seen = new Set(), out = [], queue = [];
  const push = (s, depth) => {
    if (typeof s !== 'string') return;
    s = s.trim();
    if (!s || s.length > 20000 || seen.has(s)) return;
    seen.add(s); queue.push([s, depth]);
  };
  push(text, 0);
  while (queue.length && out.length < 300) {
    const [s, depth] = queue.shift();
    out.push(s);
    if (depth >= 5) continue;
    const d = depth + 1;
    if (/%[0-9a-f]{2}/i.test(s)) { try { push(decodeURIComponent(s.replace(/\+/g, ' ')), d); } catch { /* malformed */ } }
    const url = asUrl(s);
    if (url) {
      for (const [, v] of url.searchParams) push(v, d);
      const hash = url.hash.replace(/^#[!/?]*/, '');
      if (hash) {
        push(hash, d);
        if (hash.includes('=')) for (const [, v] of new URLSearchParams(hash)) push(v, d);
      }
      url.pathname.split('/').filter(Boolean).forEach(seg => push(seg, d));
    } else if (/^[^\s=&]+=[^&]*(&[^\s=&]+=[^&]*)+$/.test(s)) {
      for (const [, v] of new URLSearchParams(s)) push(v, d);
    }
    const decoded = await fromBase64(s);
    if (decoded) push(decoded, d);
  }
  return out;
}

function consider(found, key, value, order) {
  const k = String(key).toLowerCase();
  const v = typeof value === 'number' ? value : (typeof value === 'string' && new RegExp(`^\\s*${NUM}\\s*$`, 'i').test(value) ? parseFloat(value) : NaN);
  if (!Number.isFinite(v) || Math.abs(v) > 50) return;
  for (const field of ['height', 'scale']) {
    const rank = KEYS[field][k];
    if (rank === undefined) continue;
    const best = found[field];
    if (!best || rank < best.rank || (rank === best.rank && order < best.order)) found[field] = { value: v, rank, order };
  }
}

function walkJson(node, found, counter, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 8) return;
  for (const [k, v] of Object.entries(node)) {
    if (v && typeof v === 'object') walkJson(v, found, counter, depth + 1);
    else consider(found, k, v, counter.n++);
  }
}

// Returns { height?, scale?, text } — values missing when not found.
export async function extractParams(text) {
  const found = {}, counter = { n: 0 };
  for (const s of await expand(text)) {
    if (/^[[{]/.test(s)) { try { walkJson(JSON.parse(s), found, counter); } catch { /* not JSON */ } }
    for (const m of s.matchAll(PAIR_RE)) consider(found, m[1], m[2], counter.n++);
  }
  return { height: found.height?.value, scale: found.scale?.value, text };
}

// ── QR decoding ─────────────────────────────────────────────────────────
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
let work = null;
function pixels(img, w, h, smooth = true) {
  work ||= document.createElement('canvas');
  work.width = w; work.height = h;
  const ctx = work.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = smooth;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);   // transparent PNGs → white background
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

async function decodeQR(img) {
  if (typeof window.jsQR !== 'function') throw Object.assign(new Error('decoder missing'), { code: 'decoder' });
  const W = img.naturalWidth, H = img.naturalHeight, longest = Math.max(W, H);
  // full size (capped) → downscaled copies → an upscaled copy for tiny crops
  const sizes = [Math.min(longest, 2800), 1600, 1000, 640].filter(v => v <= longest);
  if (longest < 480) sizes.push(960);
  for (const size of [...new Set(sizes)]) {
    const k = size / longest, w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    const data = pixels(img, w, h, size <= longest);
    await nextFrame();   // let the busy state paint between attempts
    const code = window.jsQR(data.data, w, h, { inversionAttempts: 'attemptBoth' });
    if (code && code.data) return code.data;
  }
  return null;
}

// ── DOM ─────────────────────────────────────────────────────────────────
const els = {
  studio: $('studio'), stage: $('stage'), masthead: $('masthead'), sheet: $('sheet'), scroll: $('sheet-scroll'),
  grip: $('sheet-grip'), helpBtn: $('help-btn'), help: $('help'),
  drop: $('dropzone'), file: $('file-input'), thumb: $('drop-thumb'), dropIcon: $('drop-icon'), dropLabel: $('drop-label'), status: $('status'),
  manual: $('manual'), form: $('manual-form'), inH: $('in-height'), inS: $('in-scale'), manualMsg: $('manual-msg'),
  result: $('result'), src: $('result-src'), current: $('r-current'), tallest: $('r-tallest'), shortest: $('r-shortest'),
  mark: $('r-mark'), cap: $('r-cap'), rawH: $('r-height'), rawS: $('r-scale'),
  actions: $('actions'), apply: $('apply-btn'), reupload: $('reupload-btn'), toCard: $('to-card')
};

const fmt = (v, d = 2) => (Math.abs(v) < 0.005 && d === 2 ? 0 : v).toFixed(d).replace('-', '−');
const fmtRaw = v => {
  const s = String(+v.toFixed(6));
  return (s.includes('.') ? s : v.toFixed(1)).replace('-', '−');
};

let stage = null;      // 3D stage API once loaded
let pendingStage = null; // latest [t, value] for when the stage finishes loading
let last = null;       // last computed result
let shownCurrent = null;
let countRaf = 0;

function setStatus(msg, kind = '') {
  els.status.textContent = msg;
  els.status.className = 'status' + (kind ? ` is-${kind}` : '');
  els.drop.classList.toggle('is-busy', kind === 'busy');
  els.drop.setAttribute('aria-busy', kind === 'busy');
}

function countTo(value) {
  cancelAnimationFrame(countRaf);
  const from = shownCurrent ?? value;
  shownCurrent = value;
  if (reducedMotion || from === value) { els.current.textContent = fmt(value); return; }
  const t0 = performance.now(), dur = 700;
  const step = now => {
    const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3);
    els.current.textContent = fmt(from + (value - from) * e);
    if (k < 1) countRaf = requestAnimationFrame(step);
  };
  countRaf = requestAnimationFrame(step);
}

const SRC_LABEL = { qr: 'QR 讀取', manual: '手動輸入', saved: '上次結果' };

function showResult(height, scale, src, { quiet = false } = {}) {
  const r = compute(height, scale);
  last = r;
  const t = rangePos(r), tc = Math.min(1, Math.max(0, t));

  countTo(r.current);
  els.tallest.textContent = fmt(r.tallest);
  els.shortest.textContent = fmt(r.shortest);
  els.rawH.textContent = fmtRaw(height);
  els.rawS.textContent = fmtRaw(scale);
  els.src.textContent = SRC_LABEL[src] || src;
  els.src.className = 'chip' + (src === 'qr' ? ' is-ok' : '');
  els.mark.style.setProperty('--t', tc);
  els.result.style.setProperty('--t', tc);
  const where = t < -0.001 || t > 1.001 ? '超出一般範圍，請再確認一次數值'
    : t < 0.34 ? '偏高 ↑' : t < 0.67 ? '中等' : '偏矮 ↓';
  els.cap.innerHTML = `在你這個體型能達到的範圍中：<b>${where}</b>`;

  const firstTime = els.result.hidden;
  els.result.hidden = false;
  els.actions.hidden = false;
  els.toCard.hidden = true;
  if (firstTime && !reducedMotion) {
    els.result.classList.remove('is-in'); void els.result.offsetWidth; els.result.classList.add('is-in');
  }
  document.body.classList.add('has-result');

  if (stage) stage.setResult(tc, r.current);
  pendingStage = [tc, r.current];
  if (src !== 'saved') store.set(KEY_INPUT, { height, scale, src, at: Date.now() });
  window.__heightResult = r;

  if (!quiet) {
    // bring the ticket into view inside the card / sheet
    requestAnimationFrame(() => {
      const box = els.scroll, top = els.result.offsetTop - 12;
      if (box.scrollHeight > box.clientHeight + 4) box.scrollTo({ top, behavior: reducedMotion ? 'auto' : 'smooth' });
    });
  }
  return r;
}

// ── upload flow ─────────────────────────────────────────────────────────
let job = 0;
async function handleFile(file) {
  const my = ++job;
  if (!file || !/^image\//.test(file.type || 'image/')) {
    setStatus('這不是圖片檔，請上傳截圖（PNG / JPG）。', 'error');
    return;
  }
  setStatus('讀取圖片中…', 'busy');
  let img;
  try {
    const url = await readFileAsDataURL(file);
    img = await loadImage(url);
    if (my !== job) return;
    els.thumb.src = url;
    els.thumb.hidden = false;
    els.dropIcon.hidden = true;
    els.dropLabel.textContent = file.name || '截圖';
  } catch {
    if (my === job) setStatus('圖片無法讀取，換一張截圖試試看。', 'error');
    return;
  }

  setStatus('正在尋找 QR…', 'busy');
  let text;
  try {
    text = await decodeQR(img);
  } catch (err) {
    if (my !== job) return;
    setStatus(err.code === 'decoder' ? 'QR 解碼器沒有載入（可能是網路問題），請改用手動輸入。' : '解析時發生問題，請改用手動輸入。', 'error');
    openManual();
    return;
  }
  if (my !== job) return;
  if (!text) {
    setStatus('找不到 QR。請確認截圖裡有完整、清楚的 QR，或改用手動輸入。', 'error');
    openManual();
    return;
  }

  const p = await extractParams(text);
  if (my !== job) return;
  window.__heightLastQR = p;
  const hasH = Number.isFinite(p.height), hasS = Number.isFinite(p.scale);
  if (hasH) els.inH.value = p.height;
  if (hasS) els.inS.value = p.scale;
  if (hasH && hasS) {
    resetManualMsg();
    const r = showResult(p.height, p.scale, 'qr');
    setStatus(`讀到了！目前身高值 ${fmt(r.current)}。`, 'ok');
  } else if (hasH || hasS) {
    setStatus(`QR 裡只找到${hasH ? '身高' : '體型'}參數，請在下方補上${hasH ? '體型 scale' : '身高 height'}。`, 'error');
    openManual(hasH ? els.inS : els.inH);
  } else {
    setStatus('讀到 QR 了，但裡面沒有身高資料。可能不是服裝 QR，或格式不同，請改用手動輸入。', 'error');
    openManual();
  }
}

function resetManualMsg() {
  els.manualMsg.textContent = '兩個欄位都填好就會自動計算。';
  els.manualMsg.className = 'manual-msg hint';
  els.inH.removeAttribute('aria-invalid');
  els.inS.removeAttribute('aria-invalid');
}

function openManual(focusEl) {
  els.manual.open = true;
  requestAnimationFrame(() => {
    els.manual.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
    if (focusEl) focusEl.focus({ preventScroll: true });
  });
}

bindDropzone(els.drop, els.file, handleFile);
els.reupload.addEventListener('click', () => els.file.click());

// ── manual entry ────────────────────────────────────────────────────────
const readNum = input => {
  const raw = input.value.trim().replace('−', '-').replace(',', '.');
  return raw === '' ? NaN : Number(raw);
};
let manualTimer = 0;
function manualCompute(force) {
  const h = readNum(els.inH), s = readNum(els.inS);
  const okH = Number.isFinite(h), okS = Number.isFinite(s);
  els.inH.toggleAttribute('aria-invalid', force && !okH);
  els.inS.toggleAttribute('aria-invalid', force && !okS);
  if (okH && okS) {
    els.manualMsg.textContent = '已更新結果 ✓';
    els.manualMsg.className = 'manual-msg hint is-ok';
    if (last && last.height === h && last.scale === s && els.src.textContent === SRC_LABEL.manual && !force) return;
    showResult(h, s, 'manual', { quiet: !force });
    setStatus('');
  } else if (force) {
    els.manualMsg.textContent = '請輸入兩個數字（可以是小數或負數）。';
    els.manualMsg.className = 'manual-msg hint is-error';
    (okH ? els.inS : els.inH).focus();
  }
}
els.form.addEventListener('input', () => { clearTimeout(manualTimer); manualTimer = setTimeout(() => manualCompute(false), 350); });
els.form.addEventListener('submit', e => { e.preventDefault(); clearTimeout(manualTimer); manualCompute(true); });

// ── help + sheet toggles ────────────────────────────────────────────────
els.helpBtn.addEventListener('click', () => {
  const open = els.help.hidden;
  els.help.hidden = !open;
  els.helpBtn.setAttribute('aria-expanded', open);
  els.helpBtn.classList.toggle('is-on', open);
});

function setExpanded(open) {
  els.sheet.classList.toggle('is-expanded', open);
  els.grip.setAttribute('aria-expanded', open);
  els.grip.setAttribute('aria-label', open ? '收合控制面板' : '展開控制面板');
}
els.grip.addEventListener('click', () => setExpanded(!els.sheet.classList.contains('is-expanded')));
narrowMQ.addEventListener('change', () => setExpanded(false));

// ── apply to card ───────────────────────────────────────────────────────
els.apply.addEventListener('click', () => {
  if (!last) return;
  const { current, tallest, shortest, height, scale } = last;
  const ok = store.set(KEY_LAST, { current, tallest, shortest, height, scale, at: Date.now() });
  if (ok) {
    toast('已套用到名片 ✓');
    els.toCard.hidden = false;
    requestAnimationFrame(() => els.toCard.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' }));
  } else {
    toast('無法儲存：瀏覽器封鎖了本機儲存空間');
  }
});

// ── 3D stage ────────────────────────────────────────────────────────────
let peek = 0;   // mobile: height of the collapsed sheet, so the diorama stays framed above it
function safeRect() {
  const s = els.stage.getBoundingClientRect(), m = els.masthead.getBoundingClientRect();
  if (!narrowMQ.matches) {
    const c = els.sheet.getBoundingClientRect();
    const x = Math.max(0, c.right - s.left + 16), y = Math.max(0, m.bottom - s.top + 6);
    return { x, y, w: Math.max(200, s.width - x - 24), h: Math.max(200, s.height - y - 20), narrow: false };
  }
  if (!els.sheet.classList.contains('is-expanded') || !peek) peek = els.sheet.getBoundingClientRect().height;
  const y = Math.max(0, m.bottom - s.top + 2);
  return { x: 8, y, w: s.width - 16, h: Math.max(150, s.height - peek - y - 4), narrow: true };
}

async function bootStage() {
  try {
    const mod = await import('./height-scene.js');
    stage = await mod.mountStage({
      container: els.stage, canvas: $('stage-canvas'), svg: $('ruler-marks'),
      tag: $('stage-tag'), tagValue: $('stage-tag-v'), note: $('stage-note'), safeRect, reducedMotion
    });
    if (pendingStage) stage.setResult(...pendingStage);
    document.body.classList.add('stage-ready');
  } catch (err) {
    console.warn('[height] 3D stage unavailable:', err);
    $('stage-fallback').hidden = false;
    document.body.classList.add('stage-failed');
    window.__heightModels ||= {};
  }
}

// ── restore last values ─────────────────────────────────────────────────
const saved = store.get(KEY_INPUT, null);
if (saved && Number.isFinite(saved.height) && Number.isFinite(saved.scale)) {
  els.inH.value = saved.height;
  els.inS.value = saved.scale;
  showResult(saved.height, saved.scale, 'saved', { quiet: true });
}

window.__height = { compute, extractParams };
bootStage();
