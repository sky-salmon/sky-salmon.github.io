/* 光影相簿 — a polaroid wall stored in IndexedDB (falls back to memory when unavailable). */
(function () {
  'use strict';

  const Site = window.Site || {};
  const store = Site.store || { get: (k, f) => f, set: () => false };
  const toast = Site.toast || (() => {});
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pad = n => String(n).padStart(2, '0');

  const MAX_EDGE = 1600, QUALITY = 0.85;   // stored image
  const THUMB_EDGE = 560, THUMB_Q = 0.8;   // wall thumbnail
  const CAPTION_MAX = 80;
  const DB_NAME = 'candlekit-gallery', STORE = 'photos';

  /* ── storage ─────────────────────────────────────────────────────────── */
  function openIDB() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window) || !window.indexedDB) { reject(new Error('IndexedDB not supported')); return; }
      let req;
      try { req = indexedDB.open(DB_NAME, 1); } catch (e) { reject(e); return; }
      const timer = setTimeout(() => reject(new Error('IndexedDB timed out')), 5000);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onblocked = () => { clearTimeout(timer); reject(new Error('IndexedDB blocked')); };
      req.onerror = () => { clearTimeout(timer); reject(req.error || new Error('IndexedDB error')); };
      req.onsuccess = () => {
        clearTimeout(timer);
        const db = req.result;
        const run = (mode, fn) => new Promise((res, rej) => {
          try {
            const t = db.transaction(STORE, mode);
            const r = fn(t.objectStore(STORE));
            t.oncomplete = () => res(r.result);
            t.onerror = () => rej(t.error);
            t.onabort = () => rej(t.error || new Error('transaction aborted'));
          } catch (e) { rej(e); }
        });
        resolve({
          persistent: true,
          all: () => run('readonly', s => s.getAll()),
          put: rec => run('readwrite', s => s.put(rec)),
          del: id => run('readwrite', s => s.delete(id))
        });
      };
    });
  }
  function memoryRepo() {
    const m = new Map();
    return {
      persistent: false,
      all: async () => [...m.values()],
      put: async rec => { m.set(rec.id, rec); },
      del: async id => { m.delete(id); }
    };
  }

  /* ── state ───────────────────────────────────────────────────────────── */
  let repo = null, photos = [], query = '';
  let sort = store.get('gallery.sort', 'new') === 'old' ? 'old' : 'new';
  const thumbs = new Map(); // id → object URL

  const el = {
    drop: $('drop'), file: $('file'), status: $('status'), banner: $('banner'), board: $('board'),
    wall: $('wall'), empty: $('empty'), nomatch: $('nomatch'), nomatchText: $('nomatch-text'), clearQ: $('clear-q'),
    q: $('q'), count: $('count'), memoText: $('memo-text'), memoStats: $('memo-stats'),
    lb: $('lb'), lbPhoto: $('lb-photo'), lbImg: $('lb-img'), lbCaption: $('lb-caption'), lbMeta: $('lb-meta'), lbPos: $('lb-pos'),
    lbPrev: $('lb-prev'), lbNext: $('lb-next'), lbClose: $('lb-close'), lbDownload: $('lb-download'), lbDelete: $('lb-delete'),
    lbConfirm: $('lb-confirm'), lbCancel: $('lb-cancel'), lbYes: $('lb-confirm-yes')
  };
  const sortBtns = [...document.querySelectorAll('.ga-sort [data-sort]')];

  /* ── helpers ─────────────────────────────────────────────────────────── */
  const ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`; };
  const ymdhm = ms => { const d = new Date(ms); return `${ymd(ms)} ${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  function bytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  }
  function hash(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function randomTilt() { const t = 0.8 + Math.random() * 2.8; return +(Math.random() < 0.5 ? -t : t).toFixed(2); }
  function newId() { return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
  function thumbURL(p) {
    if (!thumbs.has(p.id)) thumbs.set(p.id, URL.createObjectURL(p.thumb || p.blob));
    return thumbs.get(p.id);
  }
  function dropThumb(id) { const u = thumbs.get(id); if (u) { URL.revokeObjectURL(u); thumbs.delete(id); } }
  function setStatus(msg, kind) {
    el.status.textContent = msg || '';
    el.status.className = 'status ga-status' + (kind ? ' is-' + kind : '');
  }
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── image processing ────────────────────────────────────────────────── */
  async function decode(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file); } catch { /* fall back below */ }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = await (Site.loadImage ? Site.loadImage(url) : new Promise((res, rej) => {
        const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url;
      }));
      img._url = url;
      return img;
    } catch (e) { URL.revokeObjectURL(url); throw e; }
  }
  function encode(src, w, h, max, q) {
    const s = Math.min(1, max / Math.max(w, h));
    const cw = Math.max(1, Math.round(w * s)), ch = Math.max(1, Math.round(h * s));
    const c = document.createElement('canvas');
    c.width = cw; c.height = ch;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, cw, ch);
    return new Promise((res, rej) => c.toBlob(b => (b ? res({ blob: b, w: cw, h: ch }) : rej(new Error('encode failed'))), 'image/jpeg', q));
  }
  async function processFile(file) {
    const src = await decode(file);
    try {
      const w = src.width || src.naturalWidth, h = src.height || src.naturalHeight;
      if (!w || !h) throw new Error('empty image');
      const full = await encode(src, w, h, MAX_EDGE, QUALITY);
      const thumb = await encode(src, w, h, THUMB_EDGE, THUMB_Q);
      return {
        id: newId(), blob: full.blob, thumb: thumb.blob, w: full.w, h: full.h,
        caption: '', date: file.lastModified || Date.now(), added: Date.now(),
        tilt: randomTilt(), name: file.name || 'photo'
      };
    } finally {
      if (src.close) src.close();
      if (src._url) URL.revokeObjectURL(src._url);
    }
  }
  const isImage = f => (f.type && f.type.startsWith('image/')) || /\.(jpe?g|png|webp|gif|avif|bmp)$/i.test(f.name || '');

  /* ── upload queue ────────────────────────────────────────────────────── */
  const queue = [];
  let draining = false;
  function enqueue(file) {
    queue.push(file);
    if (!draining) { draining = true; setTimeout(drain, 0); }
  }
  async function drain() {
    if (!repo) { setTimeout(drain, 120); return; }
    let done = 0, added = 0, skipped = 0, failed = 0, quota = false;
    el.drop.classList.add('is-busy');
    while (queue.length) {
      const total = done + queue.length, file = queue.shift();
      setStatus(`沖洗中… ${done + 1} / ${total}`);
      if (!isImage(file)) { skipped++; done++; continue; }
      try {
        const rec = await processFile(file);
        try { await repo.put(rec); }
        catch (e) { if (e && e.name === 'QuotaExceededError') quota = true; throw e; }
        photos.push(rec); added++;
        render(rec.id);
      } catch (e) {
        failed++;
        console.warn('[gallery] could not add', file && file.name, e);
      }
      done++;
    }
    draining = false;
    el.drop.classList.remove('is-busy');
    const bits = [];
    if (added) bits.push(`貼上了 ${added} 張照片`);
    if (skipped) bits.push(`略過 ${skipped} 個不是圖片的檔案`);
    if (failed) bits.push(quota ? `${failed} 張因為儲存空間不足沒有存起來` : `${failed} 張讀不出來`);
    setStatus(bits.join('，') + (bits.length ? '。' : ''), failed && !added ? 'error' : added ? 'ok' : '');
    if (added) toast(`✦ 貼上了 ${added} 張照片`);
  }

  /* ── wall rendering ──────────────────────────────────────────────────── */
  function view() {
    const q = query.trim().toLowerCase();
    const list = photos.filter(p => !q || (p.caption || '').toLowerCase().includes(q));
    list.sort((a, b) => (b.date - a.date) || (b.added - a.added));
    if (sort === 'old') list.reverse();
    return list;
  }
  function itemHTML(p, isNew) {
    const h = hash(p.id), tape = h % 4, tr = ((h >> 3) % 13) - 6, tx = ((h >> 7) % 31) - 15;
    const cap = p.caption ? esc(p.caption) : '';
    const label = `開啟照片：${p.caption || '未命名'}，${ymd(p.date)}`;
    return `<li class="ga-item${isNew ? ' is-new' : ''}" style="--tilt:${p.tilt}deg">
      <button type="button" class="ga-pol" data-id="${esc(p.id)}" aria-label="${esc(label)}">
        <span class="ga-tape t${tape}" style="--tr:${tr}deg;--tx:${tx}px" aria-hidden="true"></span>
        <span class="ga-img"><img src="${thumbURL(p)}" alt="" width="${p.w}" height="${p.h}" decoding="async"></span>
        <span class="ga-cap${cap ? '' : ' is-empty'}">${cap || 'untitled ✦'}</span>
        <span class="ga-date mono">${ymd(p.date)}</span>
      </button>
    </li>`;
  }
  function render(newId) {
    const list = view();
    el.wall.innerHTML = list.map(p => itemHTML(p, p.id === newId && !reduceMotion())).join('');
    const ready = !!repo;
    el.empty.hidden = !ready || photos.length > 0;
    el.nomatch.hidden = !(photos.length && !list.length);
    el.wall.hidden = !list.length;
    if (!el.nomatch.hidden) el.nomatchText.textContent = `找不到說明裡有「${query.trim()}」的照片`;
    el.count.textContent = query.trim() ? `${list.length} / ${photos.length} 張` : `${photos.length} 張`;
    const size = photos.reduce((s, p) => s + (p.blob ? p.blob.size : 0) + (p.thumb ? p.thumb.size : 0), 0);
    el.memoStats.textContent = `${photos.length} PHOTOS · ${bytes(size)}`;
  }

  /* ── toolbar ─────────────────────────────────────────────────────────── */
  function setSort(s, focus) {
    sort = s;
    sortBtns.forEach(b => {
      const on = b.dataset.sort === s;
      b.setAttribute('aria-checked', on);
      b.tabIndex = on ? 0 : -1;
      if (on && focus) b.focus();
    });
    store.set('gallery.sort', s);
    render();
  }
  sortBtns.forEach((b, i) => {
    b.addEventListener('click', () => setSort(b.dataset.sort));
    b.addEventListener('keydown', e => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
        e.preventDefault();
        setSort(sortBtns[(i + 1) % sortBtns.length].dataset.sort, true);
      }
    });
  });
  let qTimer = 0;
  el.q.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { query = el.q.value; render(); }, 120); });
  el.q.addEventListener('keydown', e => { if (e.key === 'Escape' && el.q.value) { e.preventDefault(); el.q.value = ''; query = ''; render(); } });
  el.clearQ.addEventListener('click', () => { el.q.value = ''; query = ''; render(); el.q.focus(); });

  /* ── adding photos ───────────────────────────────────────────────────── */
  if (Site.bindDropzone) Site.bindDropzone(el.drop, el.file, enqueue);
  const hasFiles = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  ['dragenter', 'dragover'].forEach(t => el.board.addEventListener(t, e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); el.board.classList.add('is-drag');
  }));
  el.board.addEventListener('dragleave', e => { if (!el.board.contains(e.relatedTarget)) el.board.classList.remove('is-drag'); });
  el.board.addEventListener('drop', e => {
    if (!hasFiles(e)) return;
    e.preventDefault(); el.board.classList.remove('is-drag');
    [...e.dataTransfer.files].forEach(enqueue);
  });
  document.addEventListener('paste', e => {
    if (el.lb.open || (e.target && e.target.matches && e.target.matches('input, textarea'))) return;
    const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter(isImage);
    if (files.length) { e.preventDefault(); files.forEach(enqueue); }
  });

  /* ── lightbox ────────────────────────────────────────────────────────── */
  let lbList = [], lbIndex = 0, lbURL = '', capTimer = 0, lastFocusId = '';
  const current = () => lbList[lbIndex];

  function openLightbox(id) {
    lbList = view();
    lbIndex = lbList.findIndex(p => p.id === id);
    if (lbIndex < 0) return;
    lastFocusId = id;
    showCurrent();
    if (!el.lb.open) el.lb.showModal();
    el.lbClose.focus();
  }
  function showCurrent() {
    const p = current();
    if (!p) return;
    hideConfirm();
    if (lbURL) URL.revokeObjectURL(lbURL);
    lbURL = URL.createObjectURL(p.blob);
    el.lbImg.src = lbURL;
    el.lbImg.alt = p.caption || '未命名照片';
    el.lbImg.width = p.w; el.lbImg.height = p.h;
    el.lbPhoto.style.setProperty('--tilt', `${Math.max(-1.2, Math.min(1.2, p.tilt / 2.5)).toFixed(2)}deg`);
    el.lbCaption.value = p.caption || '';
    el.lbMeta.textContent = `${ymdhm(p.date)} · ${p.w}×${p.h} · ${bytes(p.blob.size)}`;
    el.lbPos.textContent = `${lbIndex + 1} / ${lbList.length}`;
    const single = lbList.length < 2;
    el.lbPrev.disabled = single; el.lbNext.disabled = single;
    lastFocusId = p.id;
  }
  function step(d) {
    if (lbList.length < 2) return;
    saveCaption();
    lbIndex = (lbIndex + d + lbList.length) % lbList.length;
    showCurrent();
  }
  async function saveCaption() {
    clearTimeout(capTimer);
    const p = current();
    if (!p) return;
    const v = el.lbCaption.value.trim().slice(0, CAPTION_MAX);
    if (v === (p.caption || '')) return;
    p.caption = v;
    el.lbImg.alt = v || '未命名照片';
    render();
    try { await repo.put(p); }
    catch (e) { console.warn('[gallery] caption not saved', e); toast('說明沒有存起來，請再試一次'); }
  }
  function showConfirm() { el.lbConfirm.hidden = false; el.lb.classList.add('is-confirming'); el.lbCancel.focus(); }
  function hideConfirm() { el.lbConfirm.hidden = true; el.lb.classList.remove('is-confirming'); }
  async function deleteCurrent() {
    const p = current();
    if (!p) return;
    try { await repo.del(p.id); }
    catch (e) { console.warn('[gallery] delete failed', e); toast('刪除失敗，請再試一次'); return; }
    photos = photos.filter(x => x !== p);
    dropThumb(p.id);
    lbList.splice(lbIndex, 1);
    render();
    toast('已刪除這張照片');
    if (!lbList.length) { lastFocusId = ''; el.lb.close(); return; }
    lbIndex = Math.min(lbIndex, lbList.length - 1);
    showCurrent();
    el.lbNext.disabled ? el.lbClose.focus() : el.lbNext.focus();
  }
  function fileName(p) {
    // ASCII-only: some browsers drop non-ASCII download names and fall back to "download".
    const slug = (p.caption || '').normalize('NFKD').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase().slice(0, 32);
    return `candlekit-${ymd(p.date).replace(/\./g, '')}-${slug || p.id}.jpg`;
  }
  function download() {
    const p = current();
    if (!p) return;
    const url = URL.createObjectURL(p.blob), a = document.createElement('a');
    a.href = url; a.download = fileName(p);
    (el.lb.open ? el.lb : document.body).append(a); // outside an open modal the link would be inert
    a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  el.wall.addEventListener('click', e => {
    const b = e.target.closest('.ga-pol');
    if (b) openLightbox(b.dataset.id);
  });
  el.lbPrev.addEventListener('click', () => step(-1));
  el.lbNext.addEventListener('click', () => step(1));
  el.lbClose.addEventListener('click', () => el.lb.close());
  el.lbDownload.addEventListener('click', download);
  el.lbDelete.addEventListener('click', showConfirm);
  el.lbCancel.addEventListener('click', () => { hideConfirm(); el.lbDelete.focus(); });
  el.lbYes.addEventListener('click', deleteCurrent);
  el.lbCaption.addEventListener('input', () => { clearTimeout(capTimer); capTimer = setTimeout(saveCaption, 400); });
  el.lbCaption.addEventListener('blur', saveCaption);
  el.lbCaption.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); saveCaption(); el.lbPhoto.focus({ preventScroll: true }); toast('說明已儲存'); }
  });
  document.addEventListener('keydown', e => {
    if (!el.lb.open || !el.lbConfirm.hidden || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.target && e.target.matches && e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
  });
  el.lb.addEventListener('cancel', e => {
    if (!el.lbConfirm.hidden) { e.preventDefault(); hideConfirm(); el.lbDelete.focus(); }
  });
  el.lb.addEventListener('click', e => { if (e.target === el.lb) el.lb.close(); });
  el.lb.addEventListener('close', () => {
    saveCaption();
    hideConfirm();
    if (lbURL) { URL.revokeObjectURL(lbURL); lbURL = ''; }
    el.lbImg.removeAttribute('src');
    const back = lastFocusId && el.wall.querySelector(`.ga-pol[data-id="${CSS.escape(lastFocusId)}"]`);
    (back || el.drop).focus();
  });

  /* ── boot ────────────────────────────────────────────────────────────── */
  setSort(sort);
  (async () => {
    let r;
    try { r = await openIDB(); }
    catch (e) {
      console.warn('[gallery] IndexedDB unavailable, using memory only', e);
      r = memoryRepo();
      el.banner.hidden = false;
      el.banner.textContent = '這個瀏覽器目前無法使用 IndexedDB（可能是私密瀏覽或網站資料被封鎖），照片只會暫時顯示在這個分頁，重新整理後就會消失。';
      el.memoText.textContent = '暫存模式：照片只留在這個分頁，關掉就不見了。';
    }
    try { photos = (await r.all()).filter(p => p && p.id && p.blob); }
    catch (e) { console.warn('[gallery] could not read photos', e); photos = []; }
    repo = r;
    render();
    document.body.dataset.galleryReady = '1';
  })();
})();
