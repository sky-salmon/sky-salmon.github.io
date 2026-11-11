/* candle·kit — 名片產生器 (Sky Profile card editor).
 * The card is plain DOM edited in place (contenteditable + click targets) and rasterised with
 * html2canvas on export. State lives in localStorage; images (avatar, wallpaper, custom icons)
 * are kept in a separate asset store so undo snapshots stay small. */
(function () {
  'use strict';
  // i18n (assets/js/i18n.js); pages without it keep the Traditional Chinese source text
  const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);

  const { store, toast, readFileAsDataURL, loadImage, bindDropzone } = window.Site;
  const D = window.CardData;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const KEY = 'candle.card.v3', KEY_ASSETS = 'candle.card.v3.assets', KEY_LIB = 'candle.card.v3.lib', KEY_EXPORT = 'candle.card.export', KEY_TAB = 'candle.card.tab';

  // ── model ─────────────────────────────────────────────────────────────────
  const SECTIONS = {
    profile: { title: 'PROFILE', zh: t('個人資料') },
    pass: { title: 'PASS', zh: t('季節'), picker: 'catalog', views: ['grid', 'tile'] },
    pin: { title: 'PIN & STAR', zh: t('徽章'), picker: 'pins', views: ['grid', 'tile'] },
    iap: { title: 'IAP', zh: t('內購'), picker: 'catalog', views: ['grid', 'tile', 'row'] },
    spells: { title: 'SPELLS', zh: t('魔法'), picker: 'catalog', views: ['grid'] },
    extra: { title: 'CLOSET', zh: t('衣櫃'), picker: 'catalog', views: ['grid', 'tile'] },  // was EXTRA; key kept for saved cards
    link: { title: 'LINK', zh: t('綁定'), picker: 'links' },
    info: { title: 'INFO', zh: t('備註') }
  };
  const SEC_IDS = Object.keys(SECTIONS);
  const ITEM_SECS = ['pass', 'pin', 'iap', 'spells', 'extra', 'link'];

  const DESIGNS = [
    { id: 'classic', zh: t('經典'), en: 'Classic', tone: 'dark' },
    { id: 'noir', zh: t('墨夜'), en: 'Noir', tone: 'dark' },
    { id: 'prism', zh: t('稜鏡'), en: 'Prism', tone: 'light', mast: d => `<span class="mast-title" data-bind="title"></span><span class="mast-tag">PRISM / 01</span>` },
    { id: 'future', zh: t('未來'), en: 'Future', tone: 'dark', mast: d => `<span class="mast-kicker">ISSUE / 01</span><span class="mast-title" data-bind="title"></span>` },
    { id: 'scrapbook', zh: t('剪貼簿'), en: 'Scrapbook', tone: 'light', mast: d => `<span class="mast-tag">✦ SKY JOURNAL / MEMORIES</span><span class="mast-title" data-bind="title"></span>` },
    { id: 'pixel', zh: t('像素'), en: 'Pixel', tone: 'dark', mast: d => `<span class="mast-l">LV.99</span><span class="mast-title" data-bind="title"></span><span class="mast-r">HP 5/5</span>` }
  ];
  const DESIGN = Object.fromEntries(DESIGNS.map(d => [d.id, d]));

  const THEME_DEFAULT = { mode: 'default', grad: 'aurora', solid: '#1e3a5f', wp: null, wpName: '', wpLum: 0.35, overlay: 35, blur: false, blurPx: 8, paper: 'linen', font: 'default' };
  const CUR_DEFAULT_ON = { candle: true, ascended: true, heart: true, seasonCandle: true };

  const SAMPLE_ITEMS = {
    // PASS: a season pendant and that season's 畢業禮; IAP: items sold in paid packs, with their official USD price
    pass: ['06_項鍊_Necklace/CharSkyKid_Neck_AP31Pendant', '01_斗篷_Cape/CharSkyKid_Wing_AP31AlmondBlossom', '03_髮型_Hair/CharSkyKid_Hair_AP31AlmondBlossom', '10_道具_Prop/CharSkyKid_Prop_AP31BlossomTea'],
    iap: ['01_斗篷_Cape/CharSkyKid_Wing_AP16ButterflyYellow', '01_斗篷_Cape/CharSkyKid_Wing_AnnivTuxedo', '01_斗篷_Cape/CharSkyKid_Wing_Bat']
  };

  function blank() {
    return {
      v: 3, design: 'classic', title: 'SKY PROFILE',
      layout: { cols: 1, left: SEC_IDS.slice(), right: [], hidden: { pin: true, spells: true, extra: true, info: true } },
      size: { w: null, h: null, bal: 50 },
      themes: {},
      profile: { avatar: null, avatarOn: true, cur: { candle: '0', ascended: '0', heart: '0', seasonCandle: '0', seasonHeart: '0', ticket: '0' }, curOn: { ...CUR_DEFAULT_ON }, h: { now: '', tall: '', short: '' }, note: '' },
      items: { pass: [], pin: [], iap: [], spells: [], extra: [], link: [] },
      views: { pass: 'grid', pin: 'grid', iap: 'grid', extra: 'grid' },
      titles: {}, linkNote: '', linkNoteOn: false, info: '', currency: 'US$', totalHidden: false
    };
  }
  function sample() {
    const s = blank();
    Object.assign(s.profile.cur, { candle: '201', ascended: '12', heart: '119', seasonCandle: '24' });
    s.items.pass = SAMPLE_ITEMS.pass.map(p => ({ k: 'c', p }));
    s.items.iap = SAMPLE_ITEMS.iap.map((p, i) => ({ k: 'c', p, price: ['24.99', '14.99', '17.99'][i] }));
    s.items.link = [{ k: 'l', id: 'google' }, { k: 'l', id: 'apple' }];
    return s;
  }
  // Deep-merge saved data over a blank model so new fields always exist.
  function normalize(raw) {
    const b = blank();
    if (!raw || typeof raw !== 'object' || raw.v !== 3) return null;
    const s = Object.assign(b, raw);
    s.design = DESIGN[s.design] ? s.design : 'classic';
    s.layout = Object.assign(blank().layout, raw.layout || {});
    const seen = new Set();
    ['left', 'right'].forEach(k => { s.layout[k] = (Array.isArray(s.layout[k]) ? s.layout[k] : []).filter(id => SECTIONS[id] && !seen.has(id) && seen.add(id)); });
    SEC_IDS.forEach(id => { if (!seen.has(id)) s.layout.left.push(id); });
    s.layout.cols = s.layout.cols === 2 ? 2 : 1;
    if (s.layout.cols === 1 && s.layout.right.length) { s.layout.left.push(...s.layout.right); s.layout.right = []; }
    s.size = Object.assign(blank().size, raw.size || {});
    s.profile = Object.assign(blank().profile, raw.profile || {});
    s.profile.cur = Object.assign(blank().profile.cur, s.profile.cur || {});
    s.profile.curOn = Object.assign({}, s.profile.curOn || CUR_DEFAULT_ON);
    s.profile.h = Object.assign({ now: '', tall: '', short: '' }, s.profile.h || {});
    s.items = Object.assign(blank().items, raw.items || {});
    ITEM_SECS.forEach(k => { if (!Array.isArray(s.items[k])) s.items[k] = []; });
    s.views = Object.assign(blank().views, raw.views || {});
    s.titles = Object.assign({}, raw.titles || {});
    s.themes = Object.assign({}, raw.themes || {});
    return s;
  }
  // One-time import of the basics from the previous canvas-based card.
  function fromV2() {
    const v2 = store.get('candle.card.v2', null);
    if (!v2 || !v2.data) return null;
    const s = blank(), d = v2.data;
    if (DESIGN[v2.style]) s.design = v2.style;
    const num = v => String(v ?? '').replace(/[^\d]/g, '').slice(0, 7);
    s.profile.cur.candle = num(d.candles) || '0'; s.profile.cur.heart = num(d.hearts) || '0';
    s.profile.cur.ascended = num(d.ascended) || '0'; s.profile.cur.seasonCandle = num(d.season) || '0';
    s.profile.h = { now: d.hNow || '', tall: d.hTall || '', short: d.hShort || '' };
    s.profile.note = String(d.bio || d.note || '').slice(0, 60);
    if (d.avatar && String(d.avatar).startsWith('data:image')) s.profile.avatar = putAsset(d.avatar);
    if (d.name) s.title = String(d.name).slice(0, 24);
    return s;
  }

  // assets: id → data URL (avatar, uploaded wallpaper, custom icons)
  const assets = store.get(KEY_ASSETS, {}) || {};
  let lib = (store.get(KEY_LIB, []) || []).filter(id => assets[id]);
  function putAsset(url) {
    const id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    assets[id] = url; return id;
  }
  const assetURL = id => (id && assets[id]) || '';

  // A shared card: #card=<code> carries the card itself (assets/js/cloud.js decodes it); ?s=<id> is the older kind that
  // was stored in Firestore. Nothing is saved while viewing one.
  const SHARE_ID = (new URLSearchParams(location.search).get('s') || '').replace(/[^\w-]/g, '').slice(0, 64) || null;
  const SHARE_CODE = (location.hash.match(/(?:^#|&)card=([\w-]+)/) || [])[1] || null;
  let viewing = !!(SHARE_ID || SHARE_CODE);
  window.addEventListener('hashchange', () => { if (/card=/.test(location.hash) || SHARE_CODE) location.reload(); });
  let state = viewing ? blank() : (normalize(store.get(KEY, null)) || fromV2() || sample());

  // ── history + persistence ────────────────────────────────────────────────
  const history = { stack: [], index: -1 };
  const snap = () => JSON.stringify(state);
  function pushHistory() {
    const s = snap();
    if (history.stack[history.index] === s) return;
    history.stack.splice(history.index + 1);
    history.stack.push(s);
    if (history.stack.length > 80) history.stack.shift();
    history.index = history.stack.length - 1;
    syncHistoryUI();
  }
  let saveTimer = 0, warned = false;
  function save() {
    clearTimeout(saveTimer);
    if (viewing) return;
    saveTimer = setTimeout(() => {
      // drop assets nothing refers to any more (current state, undo history, icon library)
      const refs = new Set(lib);
      [snap(), ...history.stack].forEach(s => { (s.match(/"a[0-9a-z]{6,}"/g) || []).forEach(m => refs.add(m.slice(1, -1))); });
      Object.keys(assets).forEach(id => { if (!refs.has(id)) delete assets[id]; });
      const ok = store.set(KEY, state) && store.set(KEY_ASSETS, assets) && store.set(KEY_LIB, lib);
      if (!ok && !warned) { warned = true; toast(t('瀏覽器空間不足或封鎖儲存，重新整理後可能遺失內容')); }
      if (window.Cloud) window.Cloud.changed();
    }, 250);
  }
  let commitTimer = 0;
  function commit(now = true) {
    clearTimeout(commitTimer);
    if (now) { pushHistory(); save(); scheduleThumbs(); }
    else commitTimer = setTimeout(() => commit(true), 650);
  }
  function stepHistory(dir) {
    flushText();
    const i = history.index + dir;
    if (i < 0 || i >= history.stack.length) return;
    history.index = i;
    state = normalize(JSON.parse(history.stack[i])) || state;
    closePop(); renderAll(); save(); syncHistoryUI();
  }
  function syncHistoryUI() {
    $('#btn-undo').disabled = history.index <= 0;
    $('#btn-redo').disabled = history.index >= history.stack.length - 1;
  }

  // ── theme helpers ────────────────────────────────────────────────────────
  const themeOf = (s, design) => Object.assign({}, THEME_DEFAULT, s.themes[design] || {});
  function editTheme(patch) {
    state.themes[state.design] = Object.assign(themeOf(state, state.design), patch);
  }
  function hexRgb(hex) {
    const h = String(hex).replace('#', '');
    const n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const bright = hex => { const [r, g, b] = hexRgb(hex); return (r * .299 + g * .587 + b * .114) / 255; };
  function wallpaperSrc(th) {
    if (!th.wp) return '';
    if (th.wp.startsWith('preset:')) return D.wallpaperURL(th.wp.slice(7));
    return assetURL(th.wp);
  }
  function toneOf(design, th) {
    let lum;
    if (th.mode === 'gradient') { const g = D.GRADIENTS.find(x => x.id === th.grad) || D.GRADIENTS[0]; lum = (bright(g.stops[0]) + bright(g.stops[1]) * 2 + bright(g.stops[2])) / 4; }
    else if (th.mode === 'solid') lum = bright(th.solid);
    else if (th.mode === 'image' && wallpaperSrc(th)) lum = (th.wpLum ?? .35) * (1 - th.overlay / 100);
    else return DESIGN[design].tone;
    return lum > .58 ? 'light' : 'dark';
  }
  const FUTURE_LINES = `url("data:image/svg+xml,${encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 500 1000' preserveAspectRatio='none'><g fill='none' stroke='rgba(236,244,241,.16)' stroke-width='1.3'><path d='M-20 250 C 140 210 330 120 540 40'/><path d='M-20 690 C 160 640 330 590 540 470'/><path d='M-20 990 C 200 910 380 860 540 790'/><path d='M300 -10 C 380 200 430 300 540 360'/></g></svg>")}")`;

  // ── card rendering ───────────────────────────────────────────────────────
  const fmtPrice = p => { const n = parseFloat(String(p).replace(/[^\d.]/g, '')); return Number.isFinite(n) ? n : null; };
  const money = (n, cur) => cur + (Math.round(n * 100) / 100).toFixed(/[¥NT]/.test(cur) && Number.isInteger(n) ? 0 : 2);
  function itemInfo(it) {
    if (it.k === 'c') { const p = D.parsePath(it.p); return { label: p.label, sub: [p.catZh, p.season && D.seasonName(p.season)].filter(Boolean).join(' · '), season: p.season, html: `<img src="${esc(D.iconURL(it.p))}" alt="" draggable="false">` }; }
    if (it.k === 'g') { const g = D.PINS.find(x => x.id === it.id) || D.PINS[0]; return { label: g.zh, sub: t('徽章'), html: g.svg }; }
    if (it.k === 'l') { const l = D.LINKS.find(x => x.id === it.id) || D.LINKS[0]; return { label: l.name, sub: t('綁定平台'), html: l.svg }; }
    const url = assetURL(it.id);
    return { label: t('自訂圖示'), sub: t('我的圖示'), html: url ? `<img src="${url}" alt="" draggable="false">` : '' };
  }
  const itemKey = it => it.k + ':' + (it.p || it.id);
  function isEmpty(sec, s) {
    if (sec === 'profile') return !s.profile.avatar && !Object.values(s.profile.curOn).some(Boolean) && !s.profile.h.now && !s.profile.note.trim();
    if (sec === 'info') return !s.info.trim();
    if (sec === 'link') return !s.items.link.length && !s.linkNote.trim();
    return !s.items[sec].length;
  }
  const ICON = {
    plus: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M8 3.5v9M3.5 8h9"/></svg>',
    pen: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M10.6 2.6a1.6 1.6 0 0 1 2.3 2.3L5.4 12.4l-3 .8.8-3z"/></svg>',
    grid: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="2.5" width="4.2" height="4.2" rx="1.2"/><rect x="9.3" y="2.5" width="4.2" height="4.2" rx="1.2"/><rect x="2.5" y="9.3" width="4.2" height="4.2" rx="1.2"/><rect x="9.3" y="9.3" width="4.2" height="4.2" rx="1.2"/></svg>',
    tile: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><rect x="2.5" y="3" width="11" height="10" rx="1.6"/><path d="M5 10.5h6"/></svg>',
    row: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><rect x="2.5" y="3" width="11" height="4" rx="1.2"/><rect x="2.5" y="9" width="11" height="4" rx="1.2"/></svg>',
    eye: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8S4 3.6 8 3.6 14.5 8 14.5 8 12 12.4 8 12.4 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/></svg>',
    eyeOff: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M1.5 8S4 3.6 8 3.6 14.5 8 14.5 8 12 12.4 8 12.4 1.5 8 1.5 8z"/><path d="m2.5 2.5 11 11"/></svg>'
  };
  const VIEW_LABEL = { grid: t('格狀'), tile: t('卡片'), row: t('清單') };

  function itemsHTML(sec, s, clean) {
    const list = s.items[sec], view = sec === 'spells' || sec === 'link' ? 'grid' : (s.views[sec] || 'grid');
    // WYSIWYG: what the editor lays out is exactly what gets exported — an empty section is
    // just its title in both, and editor-only controls float on top without taking space.
    if (!list.length) return '';
    const btns = list.map((it, i) => {
      const info = itemInfo(it), name = it.label || info.label;
      let cap = '';
      if (sec === 'spells') cap = `<span class="item-badge">${String(clamp(parseInt(it.n, 10) || 1, 1, 9999)).padStart(2, '0')}</span>`;
      else if (sec === 'iap' && view !== 'grid') { const pr = fmtPrice(it.price); cap = `<span class="item-cap">${view === 'row' ? esc(name) + (pr !== null ? ' · ' : '') : ''}${pr !== null ? esc(money(pr, s.currency)) : (view === 'row' ? '' : '—')}</span>`; }
      else if (view !== 'grid') cap = `<span class="item-cap">${esc(sec === 'pass' && !it.label && info.season ? D.seasonName(info.season) : name)}</span>`;
      const tag = clean ? 'span' : 'button';
      return `<${tag} ${clean ? '' : 'type="button" '}class="item${it.k === 'c' ? ' is-cat' : ''}${it.dead ? ' is-dead' : ''}" data-act="item" data-sec="${sec}" data-i="${i}" title="${esc(name)}"${clean ? '' : ` aria-label="${t('{name}，點一下編輯', { name: esc(name) })}"`}><span class="item-ico">${info.html}</span>${cap}</${tag}>`;
    }).join('');
    let total = '';
    if (sec === 'iap') {
      const sum = list.reduce((a, it) => a + (fmtPrice(it.price) || 0), 0);
      if (hasPrices(s) && !s.totalHidden) total = `<div class="iap-total"><span>TOTAL</span><b>${esc(money(sum, s.currency))}</b></div>`;
    }
    return `<div class="items" data-sec="${sec}" data-view="${view}">${btns}</div>${total}`;
  }

  const hasPrices = s => s.items.iap.some(it => fmtPrice(it.price) !== null);
  function editable(bind, ph, clean, extra = '') {
    return clean ? `data-bind="${bind}"` : `data-bind="${bind}" contenteditable="true" spellcheck="false" data-ph="${esc(ph)}" ${extra}`;
  }

  function panelHTML(sec, s, clean) {
    const meta = SECTIONS[sec], cls = `cp cp-${sec}`;
    if (sec === 'profile') {
      const p = s.profile, av = assetURL(p.avatar), showAv = p.avatarOn !== false;
      const curs = D.CURRENCIES.filter(c => p.curOn[c.id]).map(c =>
        `<span class="cur" title="${c.zh}">${c.svg}<span class="cur-val" ${editable('cur.' + c.id, '0', clean, 'inputmode="numeric" role="textbox" aria-label="' + c.zh + '"')}>${esc(p.cur[c.id] || '0')}</span></span>`).join('');
      const h = p.h, hasH = String(h.now).trim() !== '';
      const range = [h.tall && t('最高 {h}', { h: esc(h.tall) }), h.short && t('最矮 {h}', { h: esc(h.short) })].filter(Boolean).join(' · ');
      return `<section class="${cls}" data-sec="profile">
        ${clean ? '' : `<span class="cp-tools ed"><button type="button" class="cp-btn" data-act="profile" aria-label="${t('編輯個人資料')}">${ICON.pen}</button></span>`}
        <div class="pf${showAv ? '' : ' no-avatar'}">
          ${showAv ? `<div class="pf-avatar${av ? '' : ' is-empty'}" ${clean ? '' : `data-act="avatar" role="button" tabindex="0" aria-label="${av ? t('更換頭像') : t('上傳頭像')}"`}>${av ? `<img src="${av}" alt="">` : D.GLYPH.avatar}${!av && !clean ? `<span class="pf-avatar-hint ed">${t('點我加頭像')}</span>` : ''}</div>` : ''}
          <div class="pf-main">
            ${curs ? `<div class="pf-cur">${curs}</div>` : ''}
            ${hasH ? `<div class="pf-height" ${clean ? '' : `data-act="height" role="button" tabindex="0" aria-label="${t('修改身高')}"`}>${D.GLYPH.height}<b>${esc(h.now)}</b>${range ? `<span class="sep">|</span><small>${range}</small>` : ''}</div>` : ''}
            ${p.note.trim() ? `<div class="pf-note">${D.GLYPH.pencil}<div class="pf-note-val" ${editable('note', t('加一句備註'), clean, `role="textbox" aria-label="${t('個人備註')}"`)}>${esc(p.note)}</div></div>` : ''}
          </div>
        </div>
      </section>`;
    }
    const tools = [];
    if (!clean) {
      if (meta.views && meta.views.length > 1) {
        const v = s.views[sec] || 'grid', next = meta.views[(meta.views.indexOf(v) + 1) % meta.views.length];
        tools.push(`<button type="button" class="cp-btn" data-act="view" data-sec="${sec}" aria-label="${t('切換顯示方式（目前：{cur}，下一個：{next}）', { cur: VIEW_LABEL[v], next: VIEW_LABEL[next] })}" title="${t('顯示方式：{v}', { v: VIEW_LABEL[v] })}">${ICON[v]}</button>`);
      }
      if (sec === 'link') tools.push(`<button type="button" class="cp-btn" data-act="link-note" aria-pressed="${s.linkNoteOn}" aria-label="${s.linkNoteOn ? t('收起') : t('加入')}${t('備註')}">${ICON.pen}</button>`);
      if (sec === 'iap' && hasPrices(s)) tools.push(`<button type="button" class="cp-btn" data-act="total" aria-pressed="${!s.totalHidden}" aria-label="${s.totalHidden ? t('在名片上顯示總價') : t('從名片上隱藏總價')}" title="${t('總價：')}${s.totalHidden ? t('隱藏中') : t('顯示中')}">${s.totalHidden ? ICON.eyeOff : ICON.eye}</button>`);
      if (meta.picker) tools.push(`<button type="button" class="cp-btn" data-act="add" data-sec="${sec}" aria-label="${t('加入{sec}物品', { sec: meta.zh })}">${ICON.plus}</button>`);
    }
    let body = '';
    if (sec === 'info') body = `<div class="info-note" ${editable('info', t('寫點備註、聯絡方式或想說的話…'), clean, `data-multiline="true" role="textbox" aria-multiline="true" aria-label="${t('INFO 內容')}"`)}>${esc(s.info)}</div>`;
    else {
      if (sec === 'link' && (s.linkNoteOn || s.linkNote.trim())) body += `<div class="link-note" ${editable('linkNote', t('加一句說明，例如：信箱已綁定'), clean, `role="textbox" aria-label="${t('LINK 備註')}"`)}>${esc(s.linkNote)}</div>`;
      body += itemsHTML(sec, s, clean);
    }
    return `<section class="${cls}" data-sec="${sec}">
      <div class="cp-head"><span class="cp-title" ${editable('secTitle.' + sec, meta.title, clean, `role="textbox" aria-label="${t('區塊標題')}"`)}>${esc(s.titles[sec] || meta.title)}</span>${tools.length ? `<span class="cp-tools ed">${tools.join('')}</span>` : ''}</div>
      ${body ? `<div class="cp-body">${body}</div>` : ''}
    </section>`;
  }

  function cardSize(s) {
    const w = s.size.w || (s.layout.cols === 2 ? 760 : 520);
    return { w, h: s.size.h || 0 };
  }
  // Paint state `s` (optionally in another design) into a .card element.
  function renderCard(card, s, { design = s.design, clean = false } = {}) {
    const th = themeOf(s, design), shell = card.parentElement;
    card.dataset.design = design;
    card.dataset.cols = s.layout.cols;
    const tone = toneOf(design, th);
    card.dataset.tone = tone;
    // panel ink: scrapbook panels are always light paper, pixel panels always dark
    card.dataset.pink = design === 'scrapbook' || (tone === 'light' && design !== 'pixel') ? 'dark' : 'light';
    if (shell) shell.dataset.design = design;
    card.classList.toggle('is-clean', clean);
    const { w, h } = cardSize(s);
    card.style.setProperty('--card-w', w + 'px');
    if (h) card.style.setProperty('--card-h', h + 'px'); else card.style.removeProperty('--card-h');
    card.style.setProperty('--bal-l', s.size.bal + 'fr');
    card.style.setProperty('--bal-r', (100 - s.size.bal) + 'fr');
    const font = D.FONTS.find(f => f.id === th.font);
    if (font && font.css) card.style.setProperty('--card-font', font.css); else card.style.removeProperty('--card-font');
    card.style.setProperty('--tex-grain', `url("${D.textureURL('grain')}")`);
    card.style.setProperty('--tex-dither', `url("${D.textureURL('dither')}")`);
    const paper = th.paper && th.paper !== 'plain' ? D.textureURL(th.paper) : '';
    if (paper) card.style.setProperty('--tex-paper', `url("${paper}")`); else card.style.setProperty('--tex-paper', 'none');
    card.style.setProperty('--future-lines', FUTURE_LINES);
    const wp = th.mode === 'image' ? wallpaperSrc(th) : '';
    card.classList.toggle('has-blur', !!wp && th.blur);
    card.style.setProperty('--blur', th.blurPx + 'px');

    let bg = '';
    if (th.mode === 'gradient') bg = D.gradientCSS(D.GRADIENTS.find(g => g.id === th.grad) || D.GRADIENTS[0]);
    else if (th.mode === 'solid') bg = th.solid;
    else if (wp) bg = `url("${wp}") center / cover no-repeat`;
    const L = s.layout, cols = L.cols === 2 ? [['left', L.left], ['right', L.right]] : [['left', [...L.left, ...L.right]]];
    const des = DESIGN[design];
    card.innerHTML = `<div class="card-bg"${bg ? ` style="background:${esc(bg)}"` : ''}></div>`
      + `<div class="card-overlay"${wp ? ` style="background:rgba(0,0,0,${th.overlay / 100})"` : ''}></div>`
      + `<div class="card-tex"></div><div class="card-deco"></div>`
      + (des.mast ? `<header class="card-mast">${des.mast()}</header>` : '')
      + `<div class="card-cols">${cols.map(([key, ids]) => `<div class="card-col" data-col="${key}">${ids.filter(id => !L.hidden[id]).map(id => panelHTML(id, s, clean)).join('')}</div>`).join('')}</div>`;
    const t = card.querySelector('.mast-title');
    if (t) {
      t.textContent = s.title;
      if (!clean) { t.setAttribute('contenteditable', 'true'); t.setAttribute('spellcheck', 'false'); t.dataset.ph = 'SKY PROFILE'; t.setAttribute('role', 'textbox'); t.setAttribute('aria-label', t('名片標題')); }
    }
  }

  // ── main card, stage scaling ─────────────────────────────────────────────
  const cardEl = $('#card'), shellEl = $('#card-shell'), scaleEl = $('#stage-scale'), frameEl = $('#stage-frame');
  let previewMode = false;
  function renderMain() {
    renderCard(cardEl, state, { clean: previewMode });
    snapHeight(cardEl);
    watchContent();
    fitStage();
    updateMeta();
  }
  function fitStage() {
    const avail = frameEl.clientWidth - parseFloat(getComputedStyle(frameEl).paddingLeft) * 2;
    const w = shellEl.offsetWidth, h = shellEl.offsetHeight;
    const k = Math.min(1, avail / w);
    shellEl.style.transform = k < 1 ? `scale(${k})` : '';
    scaleEl.style.width = w * k + 'px';
    scaleEl.style.height = h * k + 'px';
    scaleEl.dataset.k = k;
  }
  // Round the card's height up to a whole CSS pixel, on screen and in the export alike, so the
  // image never ends in a half-covered (semi-transparent) row and both are the same size.
  function snapHeight(card) {
    card.style.minHeight = '';
    const h = parseFloat(getComputedStyle(card).height);
    if (Number.isFinite(h) && Math.abs(h - Math.round(h)) > .001) card.style.minHeight = Math.max(Math.ceil(h), state.size.h || 0) + 'px';
  }
  new ResizeObserver(() => fitStage()).observe(frameEl);
  new ResizeObserver(() => { fitStage(); updateMeta(); }).observe(cardEl);
  // The card's own box can't report shrinking content (its min-height holds it), so watch the
  // content — fonts arriving late or typed text — and re-snap from there.
  const contentRO = new ResizeObserver(() => snapHeight(cardEl));
  function watchContent() {
    contentRO.disconnect();
    $$(':scope > .card-cols, :scope > .card-mast', cardEl).forEach(el => contentRO.observe(el));
  }
  function updateMeta() {
    const W = cardEl.offsetWidth, H = cardEl.offsetHeight;
    $('#stage-size').textContent = `${W} × ${H}`;
    $('#out-size').textContent = `${W * 2} × ${H * 2} px`;
    const d = DESIGN[state.design];
    $('#stage-style').textContent = d.zh === d.en ? d.zh : `${d.zh} ${d.en}`;
    syncSizeUI();
    const ex = $('#export-modal');
    if (!ex.hidden) syncExportUI();
  }

  // ── on-card editing ──────────────────────────────────────────────────────
  function readBind(el) {
    const multi = el.dataset.multiline === 'true';
    let v = multi ? el.innerText.replace(/\n{3,}/g, '\n\n') : el.textContent.replace(/\s+/g, ' ');
    if (!el.textContent.trim()) v = '';
    return multi ? v.replace(/\n$/, '') : v;
  }
  function writeBind(bind, v) {
    if (bind === 'title') state.title = v.slice(0, 28);
    else if (bind === 'note') state.profile.note = v.slice(0, 60);
    else if (bind === 'linkNote') state.linkNote = v.slice(0, 80);
    else if (bind === 'info') state.info = v.slice(0, 400);
    else if (bind.startsWith('cur.')) state.profile.cur[bind.slice(4)] = v.replace(/[^\d,.kKwW萬+]/g, '').slice(0, 9);
    else if (bind.startsWith('secTitle.')) {
      const sec = bind.slice(9), t = v.trim().slice(0, 24);
      if (!t || t === SECTIONS[sec].title) delete state.titles[sec]; else state.titles[sec] = t;
    }
  }
  let dirtyText = false;
  function flushText() { if (dirtyText) { dirtyText = false; commit(true); } }
  cardEl.addEventListener('input', e => {
    const el = e.target.closest('[data-bind]');
    if (!el) return;
    writeBind(el.dataset.bind, readBind(el));
    dirtyText = true; save(); commit(false);
  });
  cardEl.addEventListener('focusout', e => {
    const el = e.target.closest('[data-bind]');
    if (!el) return;
    const b = el.dataset.bind;
    if (b.startsWith('cur.')) { const v = state.profile.cur[b.slice(4)] || '0'; state.profile.cur[b.slice(4)] = v; el.textContent = v; }
    if (b.startsWith('secTitle.') && !el.textContent.trim()) el.textContent = SECTIONS[b.slice(9)].title;
    if (b === 'title' && !el.textContent.trim()) { state.title = 'SKY PROFILE'; el.textContent = state.title; }
    // an emptied profile note disappears from the card (and the export); drop just that row
    // instead of re-rendering, so a click already under way elsewhere on the card still lands
    if (b === 'note' && !state.profile.note.trim()) el.closest('.pf-note')?.remove();
    if (dirtyText) { dirtyText = false; commit(true); }
    renderCols();
  });
  cardEl.addEventListener('keydown', e => {
    const el = e.target.closest('[data-bind]');
    if (el && e.key === 'Enter' && el.dataset.multiline !== 'true') { e.preventDefault(); el.blur(); }
    if (el && e.key === 'Escape') el.blur();
    if (!el && (e.key === 'Enter' || e.key === ' ')) {
      const t = e.target.closest('[role="button"][data-act]');
      if (t) { e.preventDefault(); t.click(); }
    }
  });
  cardEl.addEventListener('paste', e => {
    const el = e.target.closest('[data-bind]');
    if (!el) return;
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, el.dataset.multiline === 'true' ? text : text.replace(/\s+/g, ' '));
  });
  cardEl.addEventListener('click', e => {
    const t = e.target.closest('[data-act]');
    if (!t || previewMode) return;
    const act = t.dataset.act, sec = t.dataset.sec;
    if (act === 'add') openPicker(sec, t);
    else if (act === 'view') {
      const views = SECTIONS[sec].views, v = state.views[sec] || 'grid';
      state.views[sec] = views[(views.indexOf(v) + 1) % views.length];
      commit(); renderMain();
      toast(t('顯示方式：{v}', { v: VIEW_LABEL[state.views[sec]] }), 1200);
      $(`[data-act="view"][data-sec="${sec}"]`, cardEl)?.focus();
    }
    else if (act === 'item') openPop(sec, +t.dataset.i);
    else if (act === 'profile') openProfile(t);
    else if (act === 'height') openProfile(t, 'height');
    else if (act === 'avatar') { avatarOpener = t; $('#avatar-input').click(); }
    else if (act === 'total') { state.totalHidden = !state.totalHidden; commit(); renderMain(); $('[data-act="total"]', cardEl)?.focus(); }
    else if (act === 'link-note') {
      state.linkNoteOn = !state.linkNoteOn;
      if (!state.linkNoteOn) state.linkNote = '';
      commit(); renderMain();
      if (state.linkNoteOn) $('.link-note', cardEl)?.focus();
    }
  });

  // ── preview / reset / undo ───────────────────────────────────────────────
  $('#btn-preview').addEventListener('click', e => {
    flushText();
    previewMode = !previewMode;
    e.currentTarget.setAttribute('aria-pressed', previewMode);
    closePop(); renderMain();
    toast(previewMode ? t('預覽：這就是匯出後的樣子') : t('回到編輯模式'), 1500);
  });
  $('#btn-reset').addEventListener('click', () => {
    flushText();
    const keep = { design: state.design, themes: state.themes, title: state.title };
    state = Object.assign(blank(), keep);
    closePop(); renderAll(); commit();
    toast(t('已清空名片內容，可以按「復原」找回'));
  });
  $('#btn-undo').addEventListener('click', () => stepHistory(-1));
  $('#btn-redo').addEventListener('click', () => stepHistory(1));
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod || e.altKey) return;
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))) return;
    if (anyModalOpen()) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); stepHistory(-1); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); stepHistory(1); }
  });

  // ── design strip with live thumbnails ────────────────────────────────────
  const strip = $('#style-strip');
  strip.innerHTML = DESIGNS.map(d => `<button type="button" role="radio" class="style-tile" data-design="${d.id}" aria-checked="false" aria-label="${d.zh === d.en ? d.zh : d.zh + ' ' + d.en}">
      <span class="thumb" aria-hidden="true"><span class="thumb-inner"><span class="card-shell"><span class="card"></span></span></span></span>
      <span class="meta"><span class="zh">${d.zh}</span>${d.zh === d.en ? '' : `<span class="en">${d.en}</span>`}<span class="state">${t('編輯中')}</span></span>
    </button>`).join('');
  strip.addEventListener('click', e => {
    const tile = e.target.closest('.style-tile');
    if (!tile || tile.dataset.design === state.design) return;
    flushText();
    state.design = tile.dataset.design;
    commit(); renderMain(); syncStrip(); syncThemeUI();
  });
  strip.addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    const i = DESIGNS.findIndex(d => d.id === state.design), n = (i + (e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 1) + DESIGNS.length) % DESIGNS.length;
    $$('.style-tile', strip)[n].click(); $$('.style-tile', strip)[n].focus();
  });
  function syncStrip() {
    $$('.style-tile', strip).forEach(t => {
      const on = t.dataset.design === state.design;
      t.setAttribute('aria-checked', on); t.tabIndex = on ? 0 : -1;
    });
  }
  let thumbTimer = 0;
  function scheduleThumbs() { clearTimeout(thumbTimer); thumbTimer = setTimeout(renderThumbs, 350); }
  function renderThumbs() {
    $$('.style-tile', strip).forEach(tile => {
      const card = $('.card', tile), inner = $('.thumb-inner', tile), box = $('.thumb', tile);
      renderCard(card, state, { design: tile.dataset.design, clean: true });
      card.querySelectorAll('img').forEach(img => { img.loading = 'lazy'; });
      const k = box.clientWidth / card.offsetWidth;
      inner.style.transform = `translateX(-50%) scale(${k})`;
    });
  }

  // ── inspector: tabs ───────────────────────────────────────────────────────
  const tabs = $$('[role="tab"]');
  function selectTab(tab, focus) {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    store.set(KEY_TAB, tab.id);
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); selectTab(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  const savedTab = document.getElementById(store.get(KEY_TAB, '') || '');
  if (savedTab && tabs.includes(savedTab)) selectTab(savedTab);

  // ── inspector: layout (columns + drag lists) ─────────────────────────────
  const colsEl = $('#cols'), live = $('#drag-live');
  const EYE = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 10s3-5.4 8-5.4S18 10 18 10s-3 5.4-8 5.4S2 10 2 10z"/><circle cx="10" cy="10" r="2.4"/></svg>';
  const EYE_OFF = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 10s3-5.4 8-5.4S18 10 18 10s-3 5.4-8 5.4S2 10 2 10z"/><path d="m3.5 3.5 13 13"/></svg>';
  const GRIP = '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="7.5" cy="5" r="1.4"/><circle cx="12.5" cy="5" r="1.4"/><circle cx="7.5" cy="10" r="1.4"/><circle cx="12.5" cy="10" r="1.4"/><circle cx="7.5" cy="15" r="1.4"/><circle cx="12.5" cy="15" r="1.4"/></svg>';
  function renderCols(focusSec) {
    const L = state.layout, dbl = L.cols === 2;
    colsEl.classList.toggle('is-double', dbl);
    const lists = dbl ? [['left', t('左欄')], ['right', t('右欄')]] : [['left', t('區塊')]];
    colsEl.innerHTML = lists.map(([key, label]) => {
      const ids = L[key], shown = ids.filter(id => !L.hidden[id]).length;
      return `<div class="col-box" data-col="${key}">
        <div class="col-head"><i class="${dbl ? 'is-' + key : ''}" aria-hidden="true"></i><b>${label}</b><span class="mono">${shown}/${ids.length}</span></div>
        <ul class="sec-list" data-col="${key}" aria-label="${label}">${ids.map(rowHTML).join('')}${ids.length ? '' : `<li class="col-empty">${t('把區塊拖到這裡')}</li>`}</ul>
      </div>`;
    }).join('');
    $$('.layout-opt').forEach(b => b.setAttribute('aria-checked', String(+b.dataset.cols === L.cols)));
    if (focusSec) $(`.sec-row[data-sec="${focusSec}"] .handle`, colsEl)?.focus();
  }
  function rowHTML(id) {
    const hidden = !!state.layout.hidden[id], meta = SECTIONS[id], name = state.titles[id] || meta.title;
    return `<li class="sec-row${hidden ? ' is-hidden' : ''}" data-sec="${id}">
      <button type="button" class="row-btn eye-btn" data-act="eye" aria-pressed="${!hidden}" aria-label="${hidden ? t('顯示') : t('隱藏')} ${esc(name)}">${hidden ? EYE_OFF : EYE}</button>
      <span class="name">${esc(name)}${isEmpty(id, state) && !hidden ? `<span class="empty-tag">${t('（空）')}</span>` : ''}</span>
      <button type="button" class="row-btn handle" aria-label="${t('拖曳或用方向鍵移動：{name}', { name: esc(name) })}" aria-roledescription="${t('可拖曳')}">${GRIP}</button>
    </li>`;
  }
  $$('.layout-opt').forEach(b => b.addEventListener('click', () => setCols(+b.dataset.cols)));
  function setCols(n) {
    const L = state.layout;
    if (L.cols === n) return;
    if (n === 1) { L.left = [...L.left, ...L.right]; L.right = []; }
    else {
      const vis = L.left.filter(id => !L.hidden[id]), cut = vis[Math.ceil(vis.length / 2)];
      const at = cut ? L.left.indexOf(cut) : L.left.length;
      L.right = L.left.slice(at); L.left = L.left.slice(0, at);
    }
    L.cols = n;
    if (state.size.w === 520 || state.size.w === 760) state.size.w = null;
    commit(); renderMain(); renderCols(); syncSizeUI();
  }
  colsEl.addEventListener('click', e => {
    const b = e.target.closest('[data-act="eye"]');
    if (!b) return;
    const id = b.closest('.sec-row').dataset.sec;
    state.layout.hidden[id] = !state.layout.hidden[id];
    if (!state.layout.hidden[id]) delete state.layout.hidden[id];
    commit(); renderMain(); renderCols();
    $(`.sec-row[data-sec="${id}"] .eye-btn`, colsEl)?.focus();
  });
  function moveSec(id, col, index) {
    const L = state.layout;
    ['left', 'right'].forEach(k => { const i = L[k].indexOf(id); if (i >= 0) L[k].splice(i, 1); });
    L[col].splice(clamp(index, 0, L[col].length), 0, id);
    commit(); renderMain(); renderCols(id);
    const name = state.titles[id] || SECTIONS[id].title;
    live.textContent = t('{name} 移到{col}第 {n} 個', { name, col: L.cols === 2 ? (col === 'left' ? t('左欄') : t('右欄')) : '', n: L[col].indexOf(id) + 1 });
  }
  colsEl.addEventListener('keydown', e => {
    const h = e.target.closest('.handle');
    if (!h) return;
    const id = h.closest('.sec-row').dataset.sec, L = state.layout;
    const col = L.left.includes(id) ? 'left' : 'right', i = L[col].indexOf(id);
    if (e.key === 'ArrowUp' && i > 0) { e.preventDefault(); moveSec(id, col, i - 1); }
    else if (e.key === 'ArrowDown' && i < L[col].length - 1) { e.preventDefault(); moveSec(id, col, i + 1); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && L.cols === 2) {
      const to = e.key === 'ArrowLeft' ? 'left' : 'right';
      if (to !== col) { e.preventDefault(); moveSec(id, to, Math.min(i, L[to].length)); }
    }
  });
  // pointer drag
  let drag = null;
  colsEl.addEventListener('pointerdown', e => {
    const h = e.target.closest('.handle');
    if (!h || e.button > 0) return;
    e.preventDefault();
    const row = h.closest('.sec-row'), r = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('is-ghost');
    Object.assign(ghost.style, { width: r.width + 'px', left: r.left + 'px', top: r.top + 'px' });
    document.body.append(ghost);
    const ph = document.createElement('li');
    ph.className = 'sec-row is-placeholder'; ph.style.height = r.height + 'px';
    row.after(ph); row.classList.add('is-src');
    drag = { id: row.dataset.sec, row, ghost, ph, dy: e.clientY - r.top, x: r.left };
    document.body.classList.add('is-dragging');
    h.setPointerCapture(e.pointerId);
  });
  colsEl.addEventListener('pointermove', e => {
    if (!drag) return;
    drag.ghost.style.top = e.clientY - drag.dy + 'px';
    drag.ghost.style.left = drag.x + (e.clientX - drag.x - drag.ghost.offsetWidth / 2) * .15 + 'px';
    const lists = $$('.sec-list', colsEl);
    let list = lists.find(l => { const b = l.closest('.col-box').getBoundingClientRect(); return e.clientX >= b.left && e.clientX <= b.right; }) || lists[0];
    $$('.col-box', colsEl).forEach(b => b.classList.toggle('is-target', b.contains(list)));
    const rows = $$('.sec-row:not(.is-src):not(.is-placeholder)', list);
    const before = rows.find(r => { const b = r.getBoundingClientRect(); return e.clientY < b.top + b.height / 2; });
    $('.col-empty', list)?.remove();
    if (before) list.insertBefore(drag.ph, before); else list.append(drag.ph);
  });
  function endDrag() {
    if (!drag) return;
    const list = drag.ph.parentElement, col = list.dataset.col;
    const index = $$('.sec-row:not(.is-src)', list).indexOf(drag.ph);
    drag.ghost.remove();
    document.body.classList.remove('is-dragging');
    const id = drag.id; drag = null;
    moveSec(id, col, index);
  }
  colsEl.addEventListener('pointerup', endDrag);
  colsEl.addEventListener('pointercancel', endDrag);

  // ── inspector: size ───────────────────────────────────────────────────────
  const inW = $('#in-width'), inH = $('#in-height'), inB = $('#in-balance');
  function fill(r) { r.style.setProperty('--fill', ((r.value - r.min) / (r.max - r.min) * 100) + '%'); }
  function syncSizeUI() {
    const W = cardEl.offsetWidth, H = cardEl.offsetHeight, s = state.size;
    inW.value = s.w || W; inW.classList.toggle('is-auto', !s.w); fill(inW);
    $('#out-width').textContent = s.w ? s.w + 'px' : t('自動');
    $('#auto-width').setAttribute('aria-pressed', !s.w);
    inH.value = s.h || H; inH.classList.toggle('is-auto', !s.h); fill(inH);
    $('#out-height').textContent = s.h ? s.h + 'px' : t('自動');
    $('#auto-height').setAttribute('aria-pressed', !s.h);
    $('#row-balance').hidden = state.layout.cols !== 2;
    inB.value = s.bal; fill(inB);
    const left = $('.card-col[data-col="left"]', cardEl);
    $('#out-balance').textContent = left ? `${Math.round(left.offsetWidth)}px` : '—';
  }
  inW.addEventListener('input', () => { state.size.w = +inW.value; renderMain(); commit(false); });
  inH.addEventListener('input', () => { state.size.h = +inH.value; renderMain(); commit(false); });
  inB.addEventListener('input', () => { state.size.bal = +inB.value; renderMain(); commit(false); });
  $('#auto-width').addEventListener('click', () => { state.size.w = state.size.w ? null : cardEl.offsetWidth; renderMain(); commit(); });
  $('#auto-height').addEventListener('click', () => { state.size.h = state.size.h ? null : cardEl.offsetHeight; renderMain(); commit(); });

  // ── inspector: theme ──────────────────────────────────────────────────────
  const gradGrid = $('#grad-grid'), solidPresets = $('#solid-presets'), wpGrid = $('#wp-grid'), paperGrid = $('#paper-grid'), fontGrid = $('#font-grid');
  gradGrid.innerHTML = D.GRADIENTS.map(g => `<button type="button" role="radio" class="grad-opt" data-grad="${g.id}" aria-checked="false"><i style="--g:${D.gradientCSS(g)}"></i>${g.zh}</button>`).join('');
  solidPresets.innerHTML = D.SOLIDS.map(c => `<button type="button" role="radio" class="swatch" data-solid="${c}" style="--sw:${c}" aria-label="${c}" aria-checked="false"></button>`).join('');
  paperGrid.innerHTML = D.PAPERS.map(p => `<button type="button" role="radio" class="paper-opt" data-paper="${p.id}" aria-checked="false"><i${p.id !== 'plain' ? ` style="background-image:url('${D.textureURL(p.id)}')"` : ''}></i>${p.zh}</button>`).join('');
  fontGrid.innerHTML = D.FONTS.map(f => `<button type="button" role="radio" class="font-opt" data-font="${f.id}" aria-checked="false"${f.css ? ` style="font-family:${esc(f.css)}"` : ''}>${f.label}</button>`).join('');
  let wpThumbsDone = false;
  function buildWallpaperThumbs() {
    if (wpThumbsDone) return; wpThumbsDone = true;
    wpGrid.innerHTML = D.WALLPAPERS.map(w => `<button type="button" role="radio" class="wp-opt" data-wp="preset:${w.id}" aria-checked="false" style="background-image:url('${D.wallpaperURL(w.id)}')"><span>${w.zh}</span></button>`).join('');
    syncThemeUI();
  }
  function syncThemeUI() {
    const th = themeOf(state, state.design), d = DESIGN[state.design];
    $$('#bg-seg [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === th.mode)));
    $$('.bg-group').forEach(g => { g.hidden = g.dataset.group !== th.mode; });
    $('#default-style-name').textContent = d.zh;
    $$('.grad-opt', gradGrid).forEach(b => b.setAttribute('aria-checked', String(th.mode === 'gradient' && b.dataset.grad === th.grad)));
    $('#in-solid').value = th.solid; $('#solid-chip').style.background = th.solid; $('#solid-hex').textContent = th.solid;
    $('#in-custom-color').value = th.solid;
    $$('.swatch', solidPresets).forEach(b => b.setAttribute('aria-checked', String(b.dataset.solid.toLowerCase() === th.solid.toLowerCase())));
    const own = th.wp && !th.wp.startsWith('preset:') && assetURL(th.wp);
    $('#wp-current').hidden = !own;
    if (own) { $('#wp-thumb').style.backgroundImage = `url("${own}")`; $('#wp-name').textContent = th.wpName || t('我的桌布'); }
    $$('.wp-opt', wpGrid).forEach(b => b.setAttribute('aria-checked', String(b.dataset.wp === th.wp)));
    $('#in-overlay').value = th.overlay; fill($('#in-overlay')); $('#out-overlay').textContent = th.overlay + '%';
    $('#in-blur').checked = th.blur;
    $('#in-blur-px').value = th.blurPx; fill($('#in-blur-px')); $('#out-blur').textContent = th.blurPx + 'px';
    $('#row-blur').classList.toggle('is-off', !th.blur);
    $('#paper-box').hidden = state.design !== 'scrapbook';
    $$('.paper-opt', paperGrid).forEach(b => b.setAttribute('aria-checked', String(b.dataset.paper === th.paper)));
    $$('.font-opt', fontGrid).forEach(b => b.setAttribute('aria-checked', String(b.dataset.font === th.font)));
    if (th.mode === 'image') buildWallpaperThumbs();
  }
  function applyTheme(patch, hist = true) { editTheme(patch); renderMain(); syncThemeUI(); commit(hist); }
  $('#bg-seg').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (!b) return;
    const mode = b.dataset.mode, th = themeOf(state, state.design);
    const patch = { mode };
    if (mode === 'image' && !th.wp) patch.wp = 'preset:' + D.WALLPAPERS[0].id, patch.wpLum = wallpaperLum(D.wallpaperURL(D.WALLPAPERS[0].id));
    applyTheme(patch);
  });
  gradGrid.addEventListener('click', e => { const b = e.target.closest('[data-grad]'); if (b) applyTheme({ mode: 'gradient', grad: b.dataset.grad }); });
  solidPresets.addEventListener('click', e => { const b = e.target.closest('[data-solid]'); if (b) applyTheme({ mode: 'solid', solid: b.dataset.solid }); });
  $('#in-solid').addEventListener('input', e => applyTheme({ mode: 'solid', solid: e.target.value }, false));
  $('#in-custom-color').addEventListener('input', e => applyTheme({ mode: 'solid', solid: e.target.value }, false));
  wpGrid.addEventListener('click', e => { const b = e.target.closest('[data-wp]'); if (b) applyTheme({ mode: 'image', wp: b.dataset.wp, wpLum: wallpaperLum(D.wallpaperURL(b.dataset.wp.slice(7))) }); });
  $('#in-overlay').addEventListener('input', e => applyTheme({ overlay: +e.target.value }, false));
  $('#in-blur').addEventListener('change', e => applyTheme({ blur: e.target.checked }));
  $('#in-blur-px').addEventListener('input', e => applyTheme({ blurPx: +e.target.value }, false));
  paperGrid.addEventListener('click', e => { const b = e.target.closest('[data-paper]'); if (b) applyTheme({ paper: b.dataset.paper }); });
  fontGrid.addEventListener('click', e => { const b = e.target.closest('[data-font]'); if (b) applyTheme({ font: b.dataset.font }); });
  [gradGrid, solidPresets, wpGrid, paperGrid, fontGrid, $('#bg-seg')].forEach(g => g.addEventListener('keydown', e => {
    const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!d) return;
    const opts = $$('[role="radio"]', g), i = opts.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault(); const n = opts[(i + d + opts.length) % opts.length]; n.focus(); n.click();
  }));

  const lumCache = {};
  function wallpaperLum(url) {
    if (lumCache[url] !== undefined) return lumCache[url];
    lumCache[url] = .35;
    loadImage(url).then(img => {
      const c = document.createElement('canvas'); c.width = c.height = 12;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 12, 12);
      const d = ctx.getImageData(0, 0, 12, 12).data; let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += d[i] * .299 + d[i + 1] * .587 + d[i + 2] * .114;
      lumCache[url] = sum / (d.length / 4) / 255;
      const th = themeOf(state, state.design);
      if (th.mode === 'image' && wallpaperSrc(th) === url && Math.abs((th.wpLum ?? 0) - lumCache[url]) > .02) { editTheme({ wpLum: lumCache[url] }); renderMain(); save(); }
    }).catch(() => {});
    return lumCache[url];
  }
  async function shrinkImage(file, max, type = 'image/jpeg', q = .86) {
    const img = await loadImage(await readFileAsDataURL(file));
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(type, q);
  }
  bindDropzone($('#wp-drop'), $('#wp-input'), async file => {
    if (!/^image\//.test(file.type)) { toast(t('請選擇圖片檔')); return; }
    try {
      const url = await shrinkImage(file, 1400, 'image/jpeg', .82); // keeps localStorage use modest
      const id = putAsset(url);
      applyTheme({ mode: 'image', wp: id, wpName: file.name.slice(0, 40), wpLum: wallpaperLum(url) });
      toast(t('桌布已套用'));
    } catch { toast(t('圖片無法讀取')); }
  });
  $('#wp-change').addEventListener('click', () => $('#wp-input').click());
  $('#wp-remove').addEventListener('click', () => applyTheme({ wp: 'preset:' + D.WALLPAPERS[0].id, wpName: '', wpLum: wallpaperLum(D.wallpaperURL(D.WALLPAPERS[0].id)) }));

  // ── modal plumbing ───────────────────────────────────────────────────────
  const openers = new Map();
  const anyModalOpen = () => $$('.modal').some(m => !m.hidden);
  function openModal(m, opener) {
    openers.set(m, opener || document.activeElement);
    m.hidden = false;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => ($('[autofocus]', m) || $('.modal-dialog input:not([type=hidden]), .modal-dialog select, .modal-dialog button', m))?.focus({ preventScroll: true }));
  }
  function closeModal(m) {
    if (!m || m.hidden) return;
    m.hidden = true;
    if (!anyModalOpen()) document.body.style.overflow = '';
    const o = openers.get(m);
    if (o && document.contains(o)) o.focus({ preventScroll: true });
    m.dispatchEvent(new Event('modal-close'));
  }
  $$('.modal').forEach(m => {
    m.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(m); });
    m.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.stopPropagation(); closeModal(m); return; }
      if (e.key !== 'Tab') return;
      const f = $$('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])', $('.modal-dialog', m)).filter(x => !x.disabled && x.offsetParent !== null);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    });
  });

  // ── item picker ───────────────────────────────────────────────────────────
  const picker = $('#picker-modal'), pBody = $('#picker-body');
  const PRICES = ['auto', '', '0.99', '1.99', '2.99', '4.99', '9.99', '14.99', '19.99', '24.99', '29.99', '49.99', '99.99'];
  let pk = null; // { sec, mode, sel: Map(key → item), order: [keys], cat, season, q, price }
  const PICK_TITLES = { pass: t('PASS · 項鍊（含畢業禮）'), pin: t('PIN & STAR · 徽章'), iap: t('IAP · 內購禮包'), spells: t('SPELLS · 魔法'), extra: t('CLOSET · 衣櫃'), link: t('LINK · 綁定平台') };
  // which catalogue categories each section offers
  const SEC_CATS = { pass: ['pass'], iap: D.CLOSET_CATS, spells: ['spell'], extra: D.CLOSET_CATS };
  function inSection(i, sec) {
    if (sec === 'pass') return i.cat === 'pass' || i.ult;          // season pendants + 畢業禮
    if (sec === 'iap') return !!i.iap && D.CLOSET_CATS.includes(i.cat); // items sold in paid packs
    return (SEC_CATS[sec] || []).includes(i.cat);
  }
  const usdLabel = i => (i.usd && i.usd !== '?' ? 'US$' + i.usd : (i.usd === '?' ? t('價格未知') : ''));
  function openPicker(sec, opener) {
    closePop();
    const meta = SECTIONS[sec];
    const cats = SEC_CATS[sec] || [];
    pk = { sec, mode: meta.picker, sel: new Map(), cat: sec === 'iap' ? 'packs' : cats.length === 1 ? cats[0] : 'all', season: 'all', q: '',
      price: sec === 'iap' ? 'auto' : '', group: 'closet', series: '__recent', only: false };
    state.items[sec].forEach(it => pk.sel.set(itemKey(it), it));
    $('#picker-title').textContent = PICK_TITLES[sec];
    $('#picker-tools').hidden = pk.mode === 'links';
    $('#picker-price').hidden = sec !== 'iap';
    $('#picker-q').value = '';
    $('#picker-q').placeholder = sec === 'pass' ? t('找季節或畢業禮，例如 梵谷、Moomin、31') : sec === 'iap' ? t('搜尋全部禮包，例如 Bat、Moomin、Fortune') : t('搜尋名稱、季節，例如 Deer、AP21、感恩');
    $('.picker-search').hidden = pk.mode !== 'catalog';
    $('#picker-cats').closest('.picker-row').hidden = sec === 'extra';
    $('#picker-season').hidden = sec !== 'extra';
    $('#picker-group').hidden = sec !== 'extra';
    $('#picker-only').hidden = sec !== 'extra' && sec !== 'pass';
    $('#picker-only').setAttribute('aria-pressed', 'false');
    $('#picker-only').textContent = t('只看已選');
    $('#picker-group').value = pk.group;
    if (sec === 'iap') $('#price-chips').innerHTML = PRICES.map(p => `<button type="button" role="radio" class="chip-btn" data-price="${p}" aria-checked="${p === pk.price}">${p === 'auto' ? t('官方價格') : p ? '$' + p : t('不標價')}</button>`).join('');
    openModal(picker, opener);
    renderPickerChrome();
    renderPicker();
  }
  function renderPickerChrome() {
    let cats = null;
    if (pk.mode === 'pins') cats = [['all', t('徽章')], ['mine', t('我的圖示')]];
    else if (pk.mode === 'catalog') {
      if (pk.sec === 'pass') cats = [['pass', t('季節')], ['mine', t('我的圖示')]];
      else if (pk.sec === 'iap') cats = [['packs', t('禮包')], ['mine', t('我的圖示')]];
      else if (pk.sec === 'spells') cats = [['spell', D.CAT_BY_ID.spell.zh], ['mine', t('我的圖示')]];
    }
    if (cats) $('#picker-cats').innerHTML = cats.map(([id, zh]) => `<button type="button" class="chip-btn" data-cat="${id}" aria-pressed="${id === pk.cat}">${zh}</button>`).join('');
  }
  const priceOf = it => fmtPrice(it.price);
  function updatePickerStatus() {
    const items = [...pk.sel.values()];
    const sum = pk.sec === 'iap' ? items.reduce((a, it) => a + (priceOf(it) || 0), 0) : 0;
    $('#picker-status').textContent = sum ? t('已選 {n} 個 · 合計 {sum}', { n: items.length, sum: money(sum, 'US$') }) : t('已選 {n} 個', { n: items.length });
    $('#picker-tray').innerHTML = [...pk.sel.entries()].map(([k, it]) => {
      const info = itemInfo(it);
      return `<span class="tray-it" title="${esc(it.label || info.label)}">${info.html}<button type="button" data-unpick="${esc(k)}" aria-label="${esc(t('移除 {name}', { name: it.label || info.label }))}">×</button></span>`;
    }).join('');
  }
  function pickBtn(key, html, label, extra = '') {
    return `<button type="button" class="pick${extra}" data-key="${esc(key)}" aria-pressed="${pk.sel.has(key)}" title="${esc(label)}" aria-label="${esc(label)}">${html}</button>`;
  }
  function mineHTML() {
    const ids = lib.filter(id => assets[id]);
    const btns = ids.map(id => `<span class="pick-wrap" style="position:relative">${pickBtn('u:' + id, `<img src="${assets[id]}" alt="">`, t('自訂圖示'))}<button type="button" class="pick-del" data-del="${id}" aria-label="${t('從圖庫刪除')}">×</button></span>`).join('');
    return `<div class="picker-group"><p class="picker-group-head">${t('我的圖示')} <span class="mono">${ids.length}</span></p>${ids.length ? `<div class="picker-grid">${btns}</div>` : `<p class="picker-empty">${t('還沒有自己的圖示 — 按「上傳自己的圖示」加入截圖或圖片，會自動裁成正方形。')}</p>`}</div>`;
  }
  const iconImg = path => `<img src="${esc(D.iconURL(path))}" alt="" loading="lazy" decoding="async">`;
  const catRank = c => { const r = D.CLOSET_CATS.indexOf(c); return r < 0 ? (c === 'pass' ? -1 : 99) : r; };
  // item grid, grouped by closet category (game order) or by season
  function groupsHTML(list, bySeason) {
    list.sort((a, b) => catRank(a.cat) - catRank(b.cat) || a.order - b.order);
    const groups = new Map();
    list.forEach(i => {
      const g = bySeason ? (i.season || '—') : i.cat;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(i);
    });
    const keys = [...groups.keys()];
    if (bySeason) keys.sort((a, b) => (a === '—') - (b === '—') || b.localeCompare(a));
    else keys.sort((a, b) => catRank(a) - catRank(b));
    return keys.map(g => {
      const items = groups.get(g);
      const head = bySeason ? (g === '—' ? t('非季節') : `<span class="mono">AP${g}</span>${esc(D.seasonLabel(g))}`)
        : `${esc(D.CATS.find(c => c.id === g)?.zh || g)} <span class="mono">${items.length}</span>`;
      return `<div class="picker-group"><p class="picker-group-head">${head}<button type="button" class="text-link" data-all="${esc(items.map(i => 'c:' + i.path).join('|'))}">${t('全選這組')}</button></p>
        <div class="picker-grid">${items.map(i => pickBtn('c:' + i.path, iconImg(i.path), `${i.label}${i.season ? ' · ' + D.seasonName(i.season) : ''}`)).join('')}</div></div>`;
    }).join('');
  }
  const matches = (i, q) => !q || (i.label + ' ' + i.name + ' ' + i.catZh + ' ' + (i.season ? D.seasonFull(i.season) : '')).toLowerCase().includes(q);

  // PASS: one compact pill per season. The pendant toggles the whole season, the small icons single ultimate gifts.
  function passSeasons() {
    const by = new Map();
    pk.catalog.forEach(i => {
      if (!i.season || !(i.cat === 'pass' || i.ult)) return;
      if (!by.has(i.season)) by.set(i.season, { code: i.season, pend: null, ults: [] });
      const s = by.get(i.season);
      if (i.cat === 'pass') { if (!s.pend) s.pend = i; } else s.ults.push(i);
    });
    const list = [...by.values()].sort((a, b) => b.code.localeCompare(a.code));
    list.forEach(s => s.ults.sort((a, b) => catRank(a.cat) - catRank(b.cat) || a.order - b.order));
    return list;
  }
  const seasonKeys = s => [...(s.pend ? ['c:' + s.pend.path] : []), ...s.ults.map(u => 'c:' + u.path)];
  function renderPass() {
    const q = pk.q.trim().toLowerCase(), all = passSeasons();
    pk.seasons = all;
    const st = s => { const keys = seasonKeys(s), n = keys.filter(k => pk.sel.has(k)).length; return { n, on: n > 0, full: n === keys.length }; };
    const list = all.filter(s => (!pk.only || st(s).on) &&
      (!q || (`ap${s.code} ` + D.seasonFull(s.code)).toLowerCase().includes(q) || s.ults.some(u => matches(u, q))));
    const nOn = all.filter(s => st(s).on).length;
    $('#picker-only').textContent = t('只看已選（{n} 季）', { n: nOn });
    pBody.innerHTML = `<div class="pk-bar"><p class="pk-how">${t('點季節掛墜＝整季全選或取消；點旁邊的小圖示＝只切換那件畢業禮。灰色是沒選的。')}</p>
        <button type="button" class="text-link" data-pass-all>${t('全部季節都有')}</button></div>
      ${list.length ? `<div class="pk-pills">${list.map(s => {
        const x = st(s);
        return `<div class="pk-pill${x.on ? ' on' : ''}${x.full ? ' full' : ''}">
          <button type="button" class="pk-pend" data-season-toggle="${s.code}" aria-pressed="${x.full}" title="${esc(t('{season}：點一下{act}', { season: D.seasonFull(s.code), act: x.full ? t('取消整季') : t('選整季') }))}">${s.pend ? iconImg(s.pend.path) : `<span class="mono">AP${s.code}</span>`}</button>
          <span class="pk-pill-body"><span class="pk-pill-name"><span class="mono">AP${s.code}</span><b>${esc(D.seasonName(s.code))}</b></span>
            <span class="pk-ults">${s.ults.map(u => `<button type="button" class="pk-ult" data-ult="c:${esc(u.path)}" data-season="${s.code}" aria-pressed="${pk.sel.has('c:' + u.path)}" title="${esc(t('畢業禮：{name}', { name: u.label }))}">${iconImg(u.path)}</button>`).join('')}</span></span></div>`;
      }).join('')}</div>` : `<p class="picker-empty">${pk.only ? t('還沒選任何季節。') : t('找不到符合的季節，換個關鍵字試試。')}</p>`}`;
  }
  function setSeason(code, on) {
    const s = pk.seasons.find(x => x.code === code);
    if (s) seasonKeys(s).forEach(k => togglePick(k, on));
  }

  // IAP: series index on the left (recent, picked, seasons, events, other), the packs of that series on the right
  const packKeys = p => p.items.map(path => 'c:' + path);
  const seriesName = (kind, series) => kind === 'season' ? D.seasonFull(series) : kind === 'other' ? t('常駐與其他') : series;
  function iapIndex(P) {
    const by = new Map();
    P.forEach(p => {
      const k = p.kind + '|' + p.series;
      if (!by.has(k)) by.set(k, { key: k, kind: p.kind, series: p.series, packs: [], latest: '' });
      const s = by.get(k); s.packs.push(p); if (p.year > s.latest) s.latest = p.year;
    });
    const all = [...by.values()];
    const maxSeason = Math.max(0, ...P.filter(p => p.kind === 'season').map(p => +p.series));
    const maxYear = Math.max(0, ...P.map(p => +p.year || 0));
    return {
      season: all.filter(s => s.kind === 'season').sort((a, b) => b.series.localeCompare(a.series)),
      event: all.filter(s => s.kind === 'event').sort((a, b) => b.latest.localeCompare(a.latest) || b.packs.length - a.packs.length),
      other: all.filter(s => s.kind === 'other'),
      recent: P.filter(p => (p.kind === 'season' && +p.series >= maxSeason - 4) || (p.kind === 'event' && +p.year >= maxYear - 1))
    };
  }
  function renderIap() {
    const P = D.packs(), I = pk.iapIndex || (pk.iapIndex = iapIndex(P));
    const q = pk.q.trim().toLowerCase();
    const packState = p => { const keys = packKeys(p), n = keys.filter(k => pk.sel.has(k)).length; return n === 0 ? 0 : n === keys.length ? 2 : 1; };
    const picked = list => list.filter(p => packState(p)).length;
    let packs, title;
    if (q) {
      packs = P.filter(p => (p.name + ' ' + p.id + ' ' + p.series + ' ' + seriesName(p.kind, p.series) + ' ' + p.items.map(x => D.parsePath(x).label).join(' ')).toLowerCase().includes(q));
      title = t('搜尋「{q}」', { q: pk.q.trim() });
    } else if (pk.series === '__recent') { packs = I.recent; title = t('最近的禮包'); }
    else if (pk.series === '__picked') { packs = P.filter(p => packState(p)); title = t('已選的禮包'); }
    else { const s = [...I.season, ...I.event, ...I.other].find(x => x.key === pk.series); packs = s ? s.packs : []; title = s ? esc(seriesName(s.kind, s.series)) : ''; }
    const idxBtn = (key, label, list) => { const k = picked(list); return `<button type="button" data-series="${esc(key)}" aria-pressed="${!q && pk.series === key}"><span>${label}</span><span>${k ? `<span class="sel">${k}✓</span> ` : ''}<span class="n">${list.length}</span></span></button>`; };
    // events: newest year first; seasons and "other" in one block
    const blocks = new Map();
    packs.slice().sort((a, b) => (b.year || '').localeCompare(a.year || '') || (b.kind === 'season' ? b.series.localeCompare(a.series) : 0)).forEach(p => {
      const y = p.kind === 'event' ? p.year : p.kind === 'season' ? D.seasonFull(p.series) : '';
      if (!blocks.has(y)) blocks.set(y, []);
      blocks.get(y).push(p);
    });
    const tile = p => {
      const st = packState(p), n = Math.min(p.items.length, 3);
      const contents = p.items.map(x => D.parsePath(x).label).join('、');
      return `<button type="button" class="pk-pack${st === 1 ? ' part' : ''}" data-pack="${esc(p.id)}" aria-pressed="${st === 2}" title="${esc(p.name)}${p.items.length > 1 ? esc(t('（{n} 件：{list}）', { n: p.items.length, list: contents })) : ''}${p.status !== 'confirmed' ? ' · ' + esc(p.status === 'game-only' ? t('僅遊戲資料') : t('已下架')) : ''}">
        ${p.status !== 'confirmed' ? '<span class="pk-flag" aria-hidden="true"></span>' : ''}
        <span class="pk-stack n${n}">${p.items.slice(0, 3).map(iconImg).join('')}</span>
        <span class="pk-price">${p.usd != null ? money(p.usd, 'US$') : t('價格未知')}</span>
        <span class="pk-nm">${esc(p.name)}</span></button>`;
    };
    pBody.innerHTML = `<div class="pk-split">
      <nav class="pk-nav" aria-label="${t('禮包分類')}">
        ${idxBtn('__recent', t('最近'), I.recent)}${idxBtn('__picked', t('已選'), P.filter(p => packState(p)))}
        <span class="pk-sec">${t('季節')}</span>${I.season.map(s => idxBtn(s.key, `<span class="mono">AP${s.series}</span> ${esc(D.seasonName(s.series))}`, s.packs)).join('')}
        <span class="pk-sec">${t('節日活動')}</span>${I.event.map(s => idxBtn(s.key, esc(s.series.replace(/^Days of /, '')), s.packs)).join('')}
        ${I.other.length ? `<span class="pk-sec">${t('其他')}</span>${I.other.map(s => idxBtn(s.key, t('常駐與其他'), s.packs)).join('')}` : ''}
      </nav>
      <div class="pk-main"><p class="picker-group-head">${title} <span class="mono">${packs.length}</span></p>
        ${packs.length ? [...blocks].map(([y, ps]) => `${blocks.size > 1 && y ? `<p class="pk-year">${esc(y)}</p>` : ''}<div class="pk-packs">${ps.map(tile).join('')}</div>`).join('')
          : `<p class="picker-empty">${t('沒有符合的禮包。')}</p>`}
        <p class="pk-legend"><span><i class="pk-flag" aria-hidden="true"></i>${t('灰點：只在遊戲內購清單或已下架，wiki 沒有對到')}</span></p>
      </div></div>`;
  }
  function togglePack(id) {
    const p = D.packs().find(x => x.id === id);
    if (!p) return;
    const keys = packKeys(p), full = keys.every(k => pk.sel.has(k));
    if (full) { keys.forEach(k => togglePick(k, false)); return; }
    keys.forEach((k, i) => {  // the pack price goes on its first item, so the card total counts each pack once
      if (pk.sel.has(k)) return;
      const it = { k: 'c', p: p.items[i] };
      const price = pk.price === 'auto' ? (i === 0 && p.usd != null ? p.usd.toFixed(2) : '') : (i === 0 ? pk.price : '');
      if (price) it.price = price;
      pk.sel.set(k, it);
    });
  }

  // CLOSET: category rail + item grid
  function renderCloset() {
    const q = pk.q.trim().toLowerCase();
    const inSec = pk.catalog.filter(i => inSection(i, 'extra'));
    const ok = i => (pk.season === 'all' || (pk.season === 'none' ? !i.season : i.season === pk.season)) && (!pk.only || pk.sel.has('c:' + i.path)) && matches(i, q);
    const rail = [['all', t('全部')], ...D.CLOSET_CATS.map(c => [c, D.CAT_BY_ID[c].zh]), ['mine', t('我的圖示')]].map(([c, zh]) => {
      const n = c === 'mine' ? lib.filter(id => assets[id]).length : inSec.filter(i => c === 'all' || i.cat === c).length;
      const k = c === 'mine' ? lib.filter(id => pk.sel.has('u:' + id)).length : inSec.filter(i => (c === 'all' || i.cat === c) && pk.sel.has('c:' + i.path)).length;
      return `<button type="button" data-rail="${c}" aria-pressed="${pk.cat === c}"><span>${zh}${k ? ` <span class="sel">· ${k}</span>` : ''}</span><span class="n">${n}</span></button>`;
    }).join('');
    let main;
    if (pk.cat === 'mine') main = mineHTML();
    else {
      const list = inSec.filter(i => (pk.cat === 'all' || i.cat === pk.cat) && ok(i));
      main = list.length ? groupsHTML(list, pk.group === 'season' || (pk.season !== 'all' && pk.season !== 'none')) : `<p class="picker-empty">${t('找不到符合的物品，換個關鍵字試試。')}</p>`;
    }
    pBody.innerHTML = `<div class="pk-split is-closet"><nav class="pk-nav" aria-label="${t('衣櫃分類')}">${rail}</nav><div class="pk-main">${main}</div></div>`;
  }

  async function renderPicker() {
    updatePickerStatus();
    if (pk.mode === 'links') {
      pBody.innerHTML = `<div class="picker-grid is-links">${D.LINKS.map(l => pickBtn('l:' + l.id, `${l.svg}<span>${l.name}</span>`, l.name, ' is-link')).join('')}</div>
        <p class="hint" style="margin-top:14px">${t('選好之後，點名片上的平台圖示可以標記成「已失效」。')}</p>`;
      return;
    }
    if (pk.mode === 'pins') {
      pBody.innerHTML = pk.cat === 'mine' ? mineHTML() : `<div class="picker-grid">${D.PINS.map(g => pickBtn('g:' + g.id, g.svg, g.zh)).join('')}</div>${mineHTML()}`;
      return;
    }
    if (pk.cat === 'mine' && pk.sec !== 'extra') { pBody.innerHTML = mineHTML(); return; }
    if (!pk.catalog) {
      pBody.innerHTML = `<p class="picker-empty">${t('正在載入物品圖示…')}</p>`;
      try { pk.catalog = await D.loadCatalog(); }
      catch { pBody.innerHTML = `<p class="picker-empty">${t('物品清單載入失敗，請檢查網路後再試一次。')}</p>`; return; }
      if (!pk || picker.hidden) return;
      const seasons = [...new Set(pk.catalog.map(i => i.season).filter(Boolean))].sort().reverse();
      $('#picker-season').innerHTML = `<option value="all">${t('全部季節')}</option><option value="none">${t('非季節物品（常駐、活動、內購）')}</option>`
        + seasons.map(c => `<option value="${c}">${esc(D.seasonFull(c))}</option>`).join('');
      $('#picker-season').value = pk.season;
    }
    if (pk.sec === 'pass') return renderPass();
    if (pk.sec === 'iap') return renderIap();
    if (pk.sec === 'extra') return renderCloset();
    const q = pk.q.trim().toLowerCase();
    const list = pk.catalog.filter(i => inSection(i, pk.sec) && matches(i, q));
    pBody.innerHTML = groupsHTML(list, false) || `<p class="picker-empty">${t('找不到符合的物品，換個關鍵字試試。')}</p>`;
  }
  function keyToItem(key) {
    const i = key.indexOf(':'), k = key.slice(0, i), v = key.slice(i + 1);
    const it = k === 'c' ? { k, p: v } : { k, id: v };
    if (pk.sec === 'iap') {
      if (pk.price === 'auto') {  // official price of the pack the item was sold in (USD)
        const c = k === 'c' && pk.catalog && pk.catalog.find(x => x.path === v);
        if (c && c.usd && c.usd !== '?') it.price = c.usd;
      } else if (pk.price) it.price = pk.price;
    }
    if (pk.sec === 'spells') it.n = 1;
    return it;
  }
  function togglePick(key, on) {
    if (on === undefined) on = !pk.sel.has(key);
    if (on && !pk.sel.has(key)) pk.sel.set(key, keyToItem(key));
    if (!on) pk.sel.delete(key);
    $$(`.pick[data-key="${CSS.escape(key)}"]`, pBody).forEach(b => b.setAttribute('aria-pressed', on));
  }
  function refreshPicker() { const top = pBody.scrollTop; renderPicker(); pBody.scrollTop = top; }
  pBody.addEventListener('click', e => {
    const b2 = e.target.closest('[data-season-toggle], [data-ult], [data-pass-all], [data-series], [data-pack], [data-rail]');
    if (b2) {
      const d = b2.dataset;
      if (d.seasonToggle) { const s = pk.seasons.find(x => x.code === d.seasonToggle); setSeason(d.seasonToggle, !seasonKeys(s).every(k => pk.sel.has(k))); }
      else if (d.ult) {  // one ultimate gift; having any gift of a season means having its pendant
        const on = !pk.sel.has(d.ult);
        togglePick(d.ult, on);
        const s = pk.seasons.find(x => x.code === d.season);
        if (on && s && s.pend) togglePick('c:' + s.pend.path, true);
      }
      else if (b2.hasAttribute('data-pass-all')) pk.seasons.forEach(s => setSeason(s.code, true));
      else if (d.series) { pk.series = d.series; pk.q = ''; $('#picker-q').value = ''; renderPicker(); pBody.scrollTop = 0; return; }
      else if (d.pack) togglePack(d.pack);
      else if (d.rail) { pk.cat = d.rail; renderPicker(); pBody.scrollTop = 0; return; }
      refreshPicker(); return;
    }
    const del = e.target.closest('[data-del]');
    if (del) { lib = lib.filter(id => id !== del.dataset.del); pk.sel.delete('u:' + del.dataset.del); save(); renderPicker(); return; }
    const all = e.target.closest('[data-all]');
    if (all) {
      const keys = all.dataset.all.split('|'), on = !keys.every(k => pk.sel.has(k));
      keys.forEach(k => togglePick(k, on)); updatePickerStatus(); if (pk.sec === 'extra') refreshPicker(); return;
    }
    const b = e.target.closest('.pick');
    if (b) { togglePick(b.dataset.key); updatePickerStatus(); if (pk.sec === 'extra' && pk.catalog) refreshPicker(); }
  });
  $('#picker-tray').addEventListener('click', e => {
    const b = e.target.closest('[data-unpick]');
    if (!b) return;
    togglePick(b.dataset.unpick, false);
    if (pk.mode === 'catalog' && pk.catalog) refreshPicker(); else updatePickerStatus();
  });
  $('#picker-only').addEventListener('click', e => {
    pk.only = !pk.only;
    e.currentTarget.setAttribute('aria-pressed', String(pk.only));
    pBody.scrollTop = 0; renderPicker();
  });
  $('#picker-cats').addEventListener('click', e => {
    const b = e.target.closest('[data-cat]');
    if (!b) return;
    pk.cat = b.dataset.cat;
    $$('[data-cat]', $('#picker-cats')).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    pBody.scrollTop = 0; renderPicker();
  });
  $('#picker-season').addEventListener('change', e => { pk.season = e.target.value; pBody.scrollTop = 0; renderPicker(); });
  $('#picker-group').addEventListener('change', e => { pk.group = e.target.value; pBody.scrollTop = 0; renderPicker(); });
  let qTimer = 0;
  $('#picker-q').addEventListener('input', e => { clearTimeout(qTimer); qTimer = setTimeout(() => { pk.q = e.target.value; pBody.scrollTop = 0; renderPicker(); }, 180); });
  $('#price-chips').addEventListener('click', e => {
    const b = e.target.closest('[data-price]');
    if (!b) return;
    pk.price = b.dataset.price;
    $$('[data-price]', $('#price-chips')).forEach(x => x.setAttribute('aria-checked', String(x === b)));
  });
  $('#picker-clear').addEventListener('click', () => { [...pk.sel.keys()].forEach(k => togglePick(k, false)); if (pk.mode === 'catalog' && pk.catalog) refreshPicker(); else updatePickerStatus(); });
  $('#picker-upload').addEventListener('click', () => $('#custom-input').click());
  $('#custom-input').addEventListener('change', async e => {
    const files = [...e.target.files].filter(f => /^image\//.test(f.type));
    e.target.value = '';
    for (const f of files) {
      try {
        const img = await loadImage(await readFileAsDataURL(f));
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const s = Math.min(img.naturalWidth, img.naturalHeight);
        c.getContext('2d').drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, 128, 128);
        const id = putAsset(c.toDataURL('image/png'));
        lib.unshift(id);
        if (pk) pk.sel.set('u:' + id, keyToItem('u:' + id));
      } catch { toast(t('有圖片無法讀取')); }
    }
    if (files.length) { save(); if (pk) { pk.cat = 'mine'; renderPickerChrome(); renderPicker(); } toast(t('已加入 {n} 個圖示', { n: files.length })); }
  });
  $('#picker-ok').addEventListener('click', () => {
    const sec = pk.sec, kept = state.items[sec].filter(it => pk.sel.has(itemKey(it)));
    const keptKeys = new Set(kept.map(itemKey));
    const added = [...pk.sel.entries()].filter(([k]) => !keptKeys.has(k)).map(([, it]) => it);
    state.items[sec] = [...kept, ...added];
    if (state.layout.hidden[sec] && state.items[sec].length) delete state.layout.hidden[sec];
    closeModal(picker);
    commit(); renderMain(); renderCols();
    if (added.length) toast(t('已加入 {n} 個物品', { n: added.length }), 1500);
  });
  picker.addEventListener('modal-close', () => { pk = null; });

  // ── item popover ──────────────────────────────────────────────────────────
  const pop = $('#item-pop');
  let popAt = null; // { sec, i }
  function openPop(sec, i) {
    flushText();
    popAt = { sec, i };
    const it = state.items[sec][i];
    if (!it) return closePop();
    const info = itemInfo(it);
    $('#pop-ico').innerHTML = info.html;
    $('#pop-name').textContent = it.label || info.label;
    $('#pop-sub').textContent = info.sub;
    $('#pop-price-row').hidden = sec !== 'iap';
    $('#pop-count-row').hidden = sec !== 'spells';
    $('#pop-dead-row').hidden = sec !== 'link';
    $('#pop-label-row').hidden = sec === 'link' || sec === 'spells' || (state.views[sec] || 'grid') === 'grid' && sec !== 'iap';
    $('#pop-price').value = it.price || '';
    $('#pop-currency').value = state.currency;
    $('#pop-count').value = it.n || 1;
    $('#pop-dead').checked = !!it.dead;
    $('#pop-label').value = it.label || '';
    $('#pop-label').placeholder = info.label;
    $('#pop-left').disabled = i === 0;
    $('#pop-right').disabled = i === state.items[sec].length - 1;
    pop.hidden = false;
    placePop();
    // on touch screens don't pop the keyboard up before the person chose a field
    const field = $('#pop-price-row').hidden ? ($('#pop-count-row').hidden ? null : $('#pop-count')) : $('#pop-price');
    ((matchMedia('(pointer: fine)').matches && field) || $('#pop-close')).focus({ preventScroll: true });
  }
  function placePop() {
    if (!popAt || pop.hidden) return;
    const el = $(`.item[data-sec="${popAt.sec}"][data-i="${popAt.i}"]`, cardEl);
    if (!el) return closePop();
    const r = el.getBoundingClientRect(), pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = r.left + r.width / 2 - pw / 2 + scrollX, y = r.bottom + 10 + scrollY;
    x = clamp(x, scrollX + 8, scrollX + document.documentElement.clientWidth - pw - 8);
    if (r.bottom + ph + 16 > innerHeight && r.top - ph - 10 > 0) y = r.top - ph - 10 + scrollY;
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function closePop() {
    if (pop.hidden) return;
    const at = popAt;
    pop.hidden = true; popAt = null;
    if (at) $(`.item[data-sec="${at.sec}"][data-i="${at.i}"]`, cardEl)?.focus({ preventScroll: true });
  }
  function popItem() { return popAt && state.items[popAt.sec][popAt.i]; }
  function popChanged(hist = false) { renderMain(); placePop(); commit(hist); }
  $('#pop-close').addEventListener('click', closePop);
  $('#pop-price').addEventListener('input', e => { const it = popItem(); if (!it) return; const v = e.target.value.replace(/[^\d.]/g, ''); if (v) it.price = v; else delete it.price; popChanged(); });
  $('#pop-currency').addEventListener('change', e => { state.currency = e.target.value; popChanged(true); });
  const setCount = n => { const it = popItem(); if (!it) return; it.n = clamp(n || 1, 1, 9999); $('#pop-count').value = it.n; popChanged(); };
  $('#pop-count').addEventListener('input', e => setCount(parseInt(e.target.value.replace(/\D/g, ''), 10)));
  $('#pop-minus').addEventListener('click', () => setCount((popItem()?.n || 1) - 1));
  $('#pop-plus').addEventListener('click', () => setCount((popItem()?.n || 1) + 1));
  $('#pop-dead').addEventListener('change', e => { const it = popItem(); if (!it) return; if (e.target.checked) it.dead = true; else delete it.dead; popChanged(true); });
  $('#pop-label').addEventListener('input', e => { const it = popItem(); if (!it) return; const v = e.target.value.trim(); if (v) it.label = v; else delete it.label; $('#pop-name').textContent = v || itemInfo(it).label; popChanged(); });
  function popMove(d) {
    const { sec, i } = popAt, list = state.items[sec], j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    commit(); renderMain(); openPop(sec, j);
    (d < 0 ? $('#pop-left') : $('#pop-right')).focus();
  }
  $('#pop-left').addEventListener('click', () => popMove(-1));
  $('#pop-right').addEventListener('click', () => popMove(1));
  $('#pop-remove').addEventListener('click', () => {
    const { sec, i } = popAt;
    state.items[sec].splice(i, 1);
    pop.hidden = true; popAt = null;
    commit(); renderMain(); renderCols();
    const next = $(`.item[data-sec="${sec}"][data-i="${Math.min(i, state.items[sec].length - 1)}"]`, cardEl) || $(`[data-act="add"][data-sec="${sec}"]`, cardEl);
    next?.focus();
    toast(t('已移除，可以按「復原」找回'), 1600);
  });
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closePop(); } });
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.item')) closePop(); });
  addEventListener('resize', () => placePop());
  pop.addEventListener('focusout', () => commit(false));

  // ── avatar upload + crop ─────────────────────────────────────────────────
  let avatarOpener = null;
  const crop = { img: null, z: 1, x: 0, y: 0, S: 300 };
  const cropModal = $('#crop-modal'), cropImg = $('#crop-img'), cropStage = $('#crop-stage');
  $('#avatar-input').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    if (!/^image\//.test(f.type)) { toast(t('請選擇圖片檔')); return; }
    try {
      const url = await readFileAsDataURL(f);
      crop.img = await loadImage(url);
      cropImg.src = url;
      openModal(cropModal, avatarOpener);
      requestAnimationFrame(() => { crop.S = cropStage.clientWidth; crop.z = 1; $('#crop-zoom').value = 1; centerCrop(); });
    } catch { toast(t('圖片無法讀取')); }
  });
  const cropScale = () => crop.S / Math.min(crop.img.naturalWidth, crop.img.naturalHeight) * crop.z;
  function clampCrop() {
    const s = cropScale(), w = crop.img.naturalWidth * s, h = crop.img.naturalHeight * s;
    crop.x = clamp(crop.x, crop.S - w, 0); crop.y = clamp(crop.y, crop.S - h, 0);
  }
  function drawCrop() {
    clampCrop();
    cropImg.style.transform = `translate(${crop.x}px, ${crop.y}px) scale(${cropScale()})`;
    $('#out-zoom').textContent = crop.z.toFixed(2) + '×';
    fill($('#crop-zoom'));
  }
  function centerCrop() {
    const s = cropScale();
    crop.x = (crop.S - crop.img.naturalWidth * s) / 2; crop.y = (crop.S - crop.img.naturalHeight * s) / 2;
    drawCrop();
  }
  $('#crop-zoom').addEventListener('input', e => {
    const old = cropScale(), c = crop.S / 2;
    crop.z = +e.target.value;
    const k = cropScale() / old;
    crop.x = c - (c - crop.x) * k; crop.y = c - (c - crop.y) * k;
    drawCrop();
  });
  let cropDrag = null;
  cropStage.addEventListener('pointerdown', e => { cropDrag = { x: e.clientX - crop.x, y: e.clientY - crop.y }; cropStage.setPointerCapture(e.pointerId); });
  cropStage.addEventListener('pointermove', e => { if (!cropDrag) return; crop.x = e.clientX - cropDrag.x; crop.y = e.clientY - cropDrag.y; drawCrop(); });
  cropStage.addEventListener('pointerup', () => { cropDrag = null; });
  cropStage.addEventListener('wheel', e => { e.preventDefault(); const z = $('#crop-zoom'); z.value = clamp(+z.value - e.deltaY * .002, 1, 3); z.dispatchEvent(new Event('input')); }, { passive: false });
  $('#crop-center').addEventListener('click', centerCrop);
  $('#crop-apply').addEventListener('click', () => {
    const s = cropScale(), c = document.createElement('canvas'); c.width = c.height = 512;
    const ctx = c.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(crop.img, -crop.x / s, -crop.y / s, crop.S / s, crop.S / s, 0, 0, 512, 512);
    state.profile.avatar = putAsset(c.toDataURL('image/jpeg', .9));
    if (state.layout.hidden.profile) delete state.layout.hidden.profile;
    closeModal(cropModal);
    commit(); renderMain(); renderCols(); syncProfileUI();
    toast(t('頭像已更新'));
  });

  // ── profile modal ────────────────────────────────────────────────────────
  const profileModal = $('#profile-modal');
  function openProfile(opener, focus) {
    flushText(); closePop();
    syncProfileUI();
    openModal(profileModal, opener);
    if (focus === 'height') requestAnimationFrame(() => { $('#pm-height-sec').scrollIntoView({ block: 'nearest' }); $('[data-h="now"]').focus(); });
  }
  function syncProfileUI() {
    const p = state.profile, av = assetURL(p.avatar);
    $('#pm-avatar').style.backgroundImage = av ? `url("${av}")` : '';
    $('#pm-avatar-remove').disabled = !av;
    $('#pm-avatar-on').checked = p.avatarOn !== false;
    $('#pm-cur').innerHTML = D.CURRENCIES.map(c => `<div class="pm-cur-item${p.curOn[c.id] ? '' : ' is-off'}">
        <button type="button" class="row-btn pm-cur-eye" data-cur-eye="${c.id}" aria-pressed="${!!p.curOn[c.id]}" aria-label="${p.curOn[c.id] ? t('隱藏{name}', { name: c.zh }) : t('顯示{name}', { name: c.zh })}">${p.curOn[c.id] ? EYE : EYE_OFF}</button>
        ${c.svg}<small>${c.zh}</small><input class="input" data-cur-in="${c.id}" value="${esc(p.cur[c.id] || '0')}" inputmode="numeric" maxlength="9" aria-label="${t('{name}數量', { name: c.zh })}">
      </div>`).join('');
    $('#pm-cur-all').textContent = Object.values(p.curOn).some(Boolean) ? t('全部隱藏') : t('全部顯示');
    $$('[data-h]').forEach(i => { if (document.activeElement !== i) i.value = p.h[i.dataset.h] || ''; });
    if (document.activeElement !== $('#pm-note')) $('#pm-note').value = p.note;
  }
  $('#pm-cur').addEventListener('click', e => {
    const b = e.target.closest('[data-cur-eye]');
    if (!b) return;
    const id = b.dataset.curEye;
    state.profile.curOn[id] = !state.profile.curOn[id];
    commit(); renderMain(); syncProfileUI();
    $(`[data-cur-eye="${id}"]`).focus();
  });
  $('#pm-cur').addEventListener('input', e => {
    const i = e.target.closest('[data-cur-in]');
    if (!i) return;
    state.profile.cur[i.dataset.curIn] = i.value.replace(/[^\d,.kKwW萬+]/g, '').slice(0, 9);
    renderMain(); commit(false);
  });
  $('#pm-cur-all').addEventListener('click', () => {
    const any = Object.values(state.profile.curOn).some(Boolean);
    state.profile.curOn = any ? {} : { ...CUR_DEFAULT_ON };
    commit(); renderMain(); syncProfileUI();
  });
  $$('[data-h]').forEach(i => i.addEventListener('input', () => {
    state.profile.h[i.dataset.h] = i.value.replace(/[^\d.]/g, '').slice(0, 8);
    renderMain(); commit(false);
  }));
  $('#pm-note').addEventListener('input', e => { state.profile.note = e.target.value.slice(0, 60); renderMain(); commit(false); });
  $('#pm-avatar-on').addEventListener('change', e => { state.profile.avatarOn = e.target.checked; commit(); renderMain(); });
  $('#pm-avatar-change').addEventListener('click', () => { avatarOpener = $('#pm-avatar-change'); $('#avatar-input').click(); });
  $('#pm-avatar-remove').addEventListener('click', () => { state.profile.avatar = null; commit(); renderMain(); syncProfileUI(); $('#pm-avatar-change').focus(); });
  $('#pm-height-clear').addEventListener('click', () => { state.profile.h = { now: '', tall: '', short: '' }; commit(); renderMain(); syncProfileUI(); });
  $('#pm-height-import').addEventListener('click', () => {
    const h = store.get('candle.height.last', null);
    const n = v => (v !== null && v !== '' && Number.isFinite(Number(v))) ? Number(v) : null;
    if (!h || typeof h !== 'object' || n(h.current) === null) { toast(t('還沒有身高紀錄，先到身高工具量一次吧')); return; }
    const f = v => n(v) === null ? '' : String(Math.round(n(v) * 100) / 100);
    state.profile.h = { now: f(h.current), tall: f(h.tallest), short: f(h.shortest) };
    commit(); renderMain(); syncProfileUI();
    toast(t('已從身高工具帶入'));
  });
  profileModal.addEventListener('modal-close', () => commit(true));

  // ── export ────────────────────────────────────────────────────────────────
  const exportModal = $('#export-modal');
  const exportPrefs = Object.assign({ format: 'png', scale: 3, quality: 92, transparent: true, name: 'sky-profile-{date}' }, store.get(KEY_EXPORT, {}) || {});
  const today = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
  const fileName = (tpl, ext) => ((tpl || 'sky-profile-{date}').replace(/\{date\}/g, today()).replace(/[\\/:*?"<>|]+/g, '-').trim() || 'sky-profile') + '.' + ext;
  function syncExportUI() {
    const P = exportPrefs;
    $('#ex-format').value = P.format; $('#ex-scale').value = String(P.scale);
    $('#ex-quality').value = P.quality; fill($('#ex-quality')); $('#out-quality').textContent = P.quality + '%';
    $('#ex-quality').disabled = P.format !== 'jpeg';
    $('#ex-quality-row').classList.toggle('is-off', P.format !== 'jpeg');
    $('#ex-transparent').checked = P.transparent; $('#ex-transparent').disabled = P.format !== 'png';
    $('#ex-name').value = P.name;
    $('#ex-name-demo').textContent = fileName(P.name, P.format === 'jpeg' ? 'jpg' : 'png');
    $('#ex-out').textContent = `${shellEl.offsetWidth * P.scale} × ${shellEl.offsetHeight * P.scale} px`;
  }
  function readExportUI() {
    exportPrefs.format = $('#ex-format').value; exportPrefs.scale = +$('#ex-scale').value;
    exportPrefs.quality = +$('#ex-quality').value; exportPrefs.transparent = $('#ex-transparent').checked;
    exportPrefs.name = $('#ex-name').value.trim() || 'sky-profile-{date}';
    store.set(KEY_EXPORT, exportPrefs); syncExportUI();
  }
  ['#ex-format', '#ex-scale', '#ex-quality', '#ex-transparent', '#ex-name'].forEach(s => $(s).addEventListener('input', readExportUI));
  $('#btn-export').addEventListener('click', e => { flushText(); closePop(); syncExportUI(); openModal(exportModal, e.currentTarget); });
  $('#ex-go').addEventListener('click', async () => { readExportUI(); closeModal(exportModal); await doExport(exportPrefs); });
  $('#btn-download').addEventListener('click', () => doExport({ format: 'png', scale: 2, transparent: true, name: exportPrefs.name }));

  let h2cPromise = null;
  function loadH2C() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);
    if (!h2cPromise) h2cPromise = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'assets/js/vendor/html2canvas.min.js';
      s.onload = () => res(window.html2canvas); s.onerror = () => { h2cPromise = null; rej(new Error('html2canvas')); };
      document.head.append(s);
    });
    return h2cPromise;
  }
  // html2canvas ignores backdrop-filter: paint each panel with a pre-blurred slice of the wallpaper.
  async function blurredWallpaper(src, W, H, px) {
    const img = await loadImage(src);
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const ctx = c.getContext('2d');
    const k = Math.max(W / img.naturalWidth, H / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
    const small = document.createElement('canvas'), f = Math.max(2, px / 1.6);
    small.width = Math.max(1, Math.round(W / f)); small.height = Math.max(1, Math.round(H / f));
    const sctx = small.getContext('2d');
    sctx.drawImage(img, (W - w) / 2 / f, (H - h) / 2 / f, w / f, h / f);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, W, H);
    return c.toDataURL('image/jpeg', .9);
  }
  // ── native export ───────────────────────────────────────────────────────
  // The browser paints the card itself: the card's DOM goes into an SVG <foreignObject> together
  // with the page's own CSS, so the file is the same pixels as the preview. An SVG drawn into a
  // canvas cannot fetch anything, so fonts and images are inlined as data URLs first.
  const dataURLs = new Map();
  function toDataURL(url) {
    if (!url || url.startsWith('data:')) return Promise.resolve(url);
    if (!dataURLs.has(url)) {
      dataURLs.set(url, fetch(url, { cache: 'force-cache' })
        .then(r => { if (!r.ok) throw new Error(`${r.status} ${url}`); return r.blob(); })
        .then(b => new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsDataURL(b); }))
        .catch(err => { dataURLs.delete(url); throw err; }));
    }
    return dataURLs.get(url);
  }
  const famKey = f => String(f || '').trim().replace(/^["']|["']$/g, '').toLowerCase();
  const normWeight = w => ({ normal: '400', bold: '700', '': '400' }[String(w || '').trim()] || String(w).trim().replace(/\s+/g, ' '));
  const normStyle = s => (String(s || '').trim() || 'normal');
  function parseRanges(s) {
    return String(s || 'U+0-10FFFF').split(',').map(t => t.trim().replace(/^u\+/i, '')).filter(Boolean).map(t => {
      if (t.includes('?')) return [parseInt(t.replace(/\?/g, '0'), 16), parseInt(t.replace(/\?/g, 'F'), 16)];
      const [a, b] = t.split('-');
      return [parseInt(a, 16), parseInt(b || a, 16)];
    });
  }
  const rangeKey = s => parseRanges(s).map(r => r.join('-')).join(',');
  let facesPromise = null;
  // Every @font-face the page declares: same-origin sheets through the CSSOM, Google Fonts
  // (cross-origin, CORS-enabled) by fetching the stylesheet text.
  function allFontFaces() {
    if (facesPromise) return facesPromise;
    facesPromise = (async () => {
      const faces = [], urlOf = (src, base) => { const m = String(src).match(/url\(\s*["']?([^"')]+)["']?\s*\)/); return m ? new URL(m[1], base).href : ''; };
      for (const sheet of document.styleSheets) {
        let rules = null;
        try { rules = sheet.cssRules; } catch { /* cross-origin: read the text below */ }
        if (rules) {
          for (const r of rules) {
            if (!(r instanceof CSSFontFaceRule)) continue;
            const st = r.style, url = urlOf(st.getPropertyValue('src'), sheet.href || location.href);
            if (url) faces.push({ family: st.getPropertyValue('font-family').trim(), style: st.getPropertyValue('font-style'), weight: st.getPropertyValue('font-weight'), range: st.getPropertyValue('unicode-range'), url });
          }
        } else if (sheet.href) {
          const text = await fetch(sheet.href).then(r => r.ok ? r.text() : '').catch(() => '');
          for (const m of text.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
            const prop = n => ((m[1].match(new RegExp(`(?:^|;)\\s*${n}\\s*:\\s*([^;]+)`)) || [])[1] || '').trim();
            const url = urlOf(prop('src'), sheet.href);
            if (url) faces.push({ family: prop('font-family'), style: prop('font-style'), weight: prop('font-weight'), range: prop('unicode-range'), url });
          }
        }
      }
      return faces;
    })().catch(err => { facesPromise = null; throw err; });
    return facesPromise;
  }
  // Only the faces the card can actually draw with: a family it names, a unicode-range that
  // covers some of its text, and (when the browser tracks it) a face the page really loaded.
  async function fontFaceCSS(root) {
    const fams = new Set(), chars = new Set();
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const pseudo of [null, '::before', '::after']) {
        const cs = getComputedStyle(el, pseudo);
        if (pseudo) {
          if (!cs.content || cs.content === 'none' || cs.content === 'normal') continue;
          for (const ch of cs.content.replace(/^["']|["']$/g, '')) chars.add(ch.codePointAt(0));
        }
        cs.fontFamily.split(',').forEach(f => fams.add(famKey(f)));
      }
    }
    for (const ch of root.textContent) chars.add(ch.codePointAt(0));
    const status = new Map();
    if (document.fonts) document.fonts.forEach(f => status.set([famKey(f.family), normStyle(f.style), normWeight(f.weight), rangeKey(f.unicodeRange)].join('|'), f.status));
    const used = (await allFontFaces()).filter(f => {
      if (!fams.has(famKey(f.family))) return false;
      const ranges = parseRanges(f.range);
      let hit = false;
      for (const c of chars) { if (ranges.some(([a, b]) => c >= a && c <= b)) { hit = true; break; } }
      if (!hit) return false;
      const st = status.get([famKey(f.family), normStyle(f.style), normWeight(f.weight), rangeKey(f.range)].join('|'));
      return st === undefined || st === 'loaded';
    });
    const rules = await Promise.all(used.map(async f => {
      try {
        return `@font-face{font-family:"${famKey(f.family)}";font-style:${normStyle(f.style)};font-weight:${normWeight(f.weight)};${f.range ? `unicode-range:${f.range};` : ''}src:url(${await toDataURL(f.url)});}`;
      } catch { return ''; }
    }));
    return rules.join('\n');
  }
  // The page's own stylesheets as written (CSSOM re-serialisation can mangle var() shorthands);
  // @font-face blocks are dropped because fontFaceCSS() supplies inlined versions.
  let pageCSSPromise = null;
  function pageCSS() {
    if (pageCSSPromise) return pageCSSPromise;
    pageCSSPromise = Promise.all([...document.styleSheets].map(async sheet => {
      let rules;
      try { rules = sheet.cssRules; } catch { return ''; } // cross-origin (Google Fonts): fonts only
      const text = sheet.href ? await fetch(sheet.href, { cache: 'force-cache' }).then(r => r.ok ? r.text() : null).catch(() => null) : null;
      if (text !== null) return text.replace(/@font-face\s*\{[^}]*\}/g, '');
      return [...rules].filter(r => !(r instanceof CSSFontFaceRule)).map(r => r.cssText).join('\n');
    })).then(parts => parts.join('\n')).catch(err => { pageCSSPromise = null; throw err; });
    return pageCSSPromise;
  }
  const INHERITED = ['font-family', 'font-size', 'line-height', 'color', 'letter-spacing', 'font-synthesis', 'text-rendering', '-webkit-font-smoothing', 'font-kerning', 'word-break', 'overflow-wrap'];
  async function renderNative(opts) {
    // a clean (preview-mode) copy of the card, laid out off-screen at its real size
    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText = 'position:fixed;left:-20000px;top:0;z-index:-1;pointer-events:none;';
    host.innerHTML = '<div class="card-shell"><div class="card"></div></div>';
    scaleEl.append(host); // same ancestors (and inherited styles) as the on-screen card
    const shell = host.firstChild, card = shell.firstChild;
    try {
      renderCard(card, state, { clean: true });
      await Promise.all($$('img', card).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
      snapHeight(card);
      const box = shell.getBoundingClientRect(), W = box.width, H = box.height, s = opts.scale;
      const [fonts, css] = await Promise.all([fontFaceCSS(card), pageCSS()]);
      const clone = shell.cloneNode(true);
      await Promise.all($$('img', clone).map(async img => { img.setAttribute('src', await toDataURL(img.src)); }));
      const root = document.createElement('div'), pcs = getComputedStyle(host);
      root.setAttribute('style', INHERITED.map(p => `${p}:${pcs.getPropertyValue(p)}`).join(';') + `;width:${W}px;height:${H}px;margin:0;padding:0;`);
      const style = document.createElement('style');
      style.textContent = css + '\n' + fonts;
      root.append(style, clone);
      // laid out at 1× and scaled by the viewBox (CSS zoom was measurably less faithful)
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W * s}" height="${H * s}" viewBox="0 0 ${W} ${H}"><foreignObject x="0" y="0" width="${W}" height="${H}">${new XMLSerializer().serializeToString(root)}</foreignObject></svg>`;
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('svg render')); img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
      try { await img.decode(); } catch { /* already decoded */ }
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(W * s); canvas.height = Math.ceil(H * s);
      const ctx = canvas.getContext('2d');
      const paint = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (opts.format === 'jpeg' || !opts.transparent) { ctx.fillStyle = opts.format === 'jpeg' ? '#ffffff' : '#111312'; ctx.fillRect(0, 0, canvas.width, canvas.height); }
        ctx.drawImage(img, 0, 0, W * s, H * s); // exact size: never stretch by a rounding pixel
      };
      paint();
      await new Promise(r => setTimeout(r, 80)); // WebKit can paint images nested in an SVG a beat late
      paint();
      return canvas;
    } finally { host.remove(); }
  }
  const canvasBlob = (canvas, opts) => new Promise((res, rej) => {
    try { canvas.toBlob(b => (b ? res(b) : rej(new Error('blob'))), opts.format === 'jpeg' ? 'image/jpeg' : 'image/png', (opts.quality || 92) / 100); }
    catch (err) { rej(err); } // a tainted canvas (older WebKit) throws here → fall back to html2canvas
  });

  let exporting = false;
  async function doExport(opts) {
    if (exporting) return;
    exporting = true;
    flushText(); closePop();
    const btn = $('#btn-download');
    btn.classList.add('is-busy');
    toast(t('正在產生圖片…'), 6000);
    const wasPreview = previewMode;
    try {
      renderMain(); // re-derive the on-screen card from state so the screen and the file match
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      let blob = null;
      try { blob = await canvasBlob(await renderNative(opts), opts); }
      catch (err) { console.warn('native export failed, using html2canvas', err); }
      if (!blob) blob = await canvasBlob(await renderH2C(opts), opts);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName(opts.name, opts.format === 'jpeg' ? 'jpg' : 'png');
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast(t('已下載 {file}', { file: a.download }));
    } catch (err) {
      console.error(err);
      toast(t('匯出失敗，請重新整理後再試一次'));
    } finally {
      previewMode = wasPreview; renderMain();
      btn.classList.remove('is-busy');
      exporting = false;
    }
  }
  // Fallback for browsers that refuse to read back an SVG-painted canvas.
  async function renderH2C(opts) {
    {
      const h2c = await loadH2C();
      previewMode = true; renderMain();
      await Promise.all($$('img', cardEl).map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
      const th = themeOf(state, state.design), W = cardEl.offsetWidth, H = cardEl.offsetHeight;
      const blurURL = cardEl.classList.contains('has-blur') ? await blurredWallpaper(wallpaperSrc(th), W, H, th.blurPx).catch(() => '') : '';
      return h2c(shellEl, {
        scale: opts.scale, useCORS: true, logging: false,
        backgroundColor: opts.format === 'jpeg' ? '#ffffff' : (opts.transparent ? null : '#111312'),
        windowWidth: Math.max(document.documentElement.clientWidth, shellEl.offsetWidth + 64),
        onclone: doc => {
          const shell = doc.getElementById('card-shell'), card = doc.getElementById('card');
          shell.style.transform = 'none';
          const win = doc.defaultView;
          card.querySelectorAll('svg').forEach(svg => svg.setAttribute('color', win.getComputedStyle(svg).color));
          if (blurURL) {
            const cr = card.getBoundingClientRect();
            card.querySelectorAll('.cp').forEach(p => {
              const r = p.getBoundingClientRect(), cs = win.getComputedStyle(p), bg = cs.backgroundColor;
              const bl = parseFloat(cs.borderLeftWidth) || 0, bt = parseFloat(cs.borderTopWidth) || 0;
              p.style.backgroundImage = `linear-gradient(${bg}, ${bg}), linear-gradient(rgba(0,0,0,${th.overlay / 100}), rgba(0,0,0,${th.overlay / 100})), url("${blurURL}")`;
              p.style.backgroundSize = `auto, auto, ${W}px ${H}px`;
              p.style.backgroundPosition = `0 0, 0 0, ${cr.left - r.left - bl}px ${cr.top - r.top - bt}px`;
              p.style.backgroundRepeat = 'no-repeat';
            });
          }
        }
      });
    }
  }

  // ── cloud save + share links (assets/js/cloud.js) ────────────────────────
  const refsIn = str => (str.match(/"a[0-9a-z]{6,}"/g) || []).map(m => m.slice(1, -1));
  const isSampleState = s => JSON.stringify(s) === JSON.stringify(normalize(sample()));
  // the card plus the images it uses; a share leaves out the private icon library
  function cardData(forShare) {
    flushText();
    const s = snap(), used = new Set(refsIn(s));
    if (!forShare) lib.forEach(id => used.add(id));
    const a = {};
    used.forEach(id => { if (assets[id]) a[id] = assets[id]; });
    return forShare ? { state: JSON.parse(s), assets: a } : { state: JSON.parse(s), assets: a, lib: lib.filter(id => a[id]) };
  }
  function loadCardData(d, keep) {
    const s = normalize(d && d.state);
    if (!s) return false;
    Object.keys(assets).forEach(k => delete assets[k]);
    Object.entries((d && d.assets) || {}).forEach(([k, v]) => { if (/^a[0-9a-z]{6,}$/.test(k) && /^data:image\//.test(v)) assets[k] = v; });
    if (Array.isArray(d.lib)) lib = d.lib.filter(id => assets[id]);
    state = s;
    history.stack = []; history.index = -1;
    closePop(); renderAll(); pushHistory();
    if (keep) save();
    return true;
  }
  // keep the shared card being viewed as this device's card; the viewer's own icon library stays
  function adoptShared() {
    const mine = store.get(KEY_ASSETS, {}) || {}, myLib = (store.get(KEY_LIB, []) || []).filter(id => mine[id]);
    myLib.forEach(id => { if (!assets[id]) assets[id] = mine[id]; });
    lib = myLib;
    flushText();
    if (!(store.set(KEY, state) && store.set(KEY_ASSETS, assets) && store.set(KEY_LIB, lib))) { toast(t('瀏覽器空間不足或封鎖儲存，重新整理後可能遺失內容')); return; }
    location.replace(location.pathname + location.search.replace(/[?&]s=[^&]*/, '').replace(/^&/, '?'));
  }
  window.CardApp = {
    data: cardData, load: loadCardData, adopt: adoptShared, openModal, closeModal,
    viewing: () => (viewing ? SHARE_ID : null),
    shareCode: () => (viewing ? SHARE_CODE : null),
    isSample: () => isSampleState(state),
    ownIsSample: () => { const own = normalize(store.get(KEY, null)); return !own || isSampleState(own); }
  };
  if (viewing) {  // show exactly what the image would contain, without the editing controls
    document.body.classList.add('is-viewing');
    cardEl.inert = true;
    previewMode = true;
  }

  // ── boot ──────────────────────────────────────────────────────────────────
  function renderAll() { renderMain(); syncStrip(); renderCols(); syncThemeUI(); syncSizeUI(); renderThumbs(); }
  renderAll();
  pushHistory(); save();
  // Seasons and categories come from icons.csv; redraw once it is in so saved items show the right ones.
  D.loadCatalog().then(() => { renderMain(); renderCols(); renderThumbs(); }).catch(() => {});
  if (document.fonts) document.fonts.ready.then(() => { fitStage(); updateMeta(); renderThumbs(); });
  addEventListener('load', () => { fitStage(); renderThumbs(); });
  window.addEventListener('pageshow', e => { if (e.persisted && !viewing) { state = normalize(store.get(KEY, null)) || state; renderAll(); } });
})();
