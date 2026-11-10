/* candle·kit — catalogue admin (admin.html).
 * Edits data/seasons.json, data/items.json and data/packs.json and commits them straight to GitHub.
 *
 * Access: sign-in takes a GitHub token. The page only opens for the site owner (OWNER) with push access to REPO, and
 * saving is a normal commit made with that token, so GitHub itself enforces who may change anything; the page holds no
 * secret of its own. The token is kept in sessionStorage (or localStorage with "remember") and is only sent to
 * api.github.com. The card editor applies data/ at runtime, so a save is live once GitHub Pages has rebuilt. */
(function () {
  'use strict';
  const OWNER = 'chunhao0613', REPO = OWNER + '/sky-cotl', BRANCH = 'main', API = 'https://api.github.com';
  const TOKEN_KEY = 'candle.admin.token', DRAFT_KEY = 'candle.admin.draft.v1';
  const KINDS = ['seasons', 'items', 'packs'];
  const PATH = { seasons: 'data/seasons.json', items: 'data/items.json', packs: 'data/packs.json' };
  const SEASONS_JS = 'assets/js/seasons-data.js';
  const SDK_URL = new URL('vendor/firebase.js', document.currentScript.src).href;
  const FB_CFG = window.FIREBASE_CONFIG;

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const store = {
    get(k) { try { return sessionStorage.getItem(k) || localStorage.getItem(k); } catch { return null; } },
    set(k, v, keep) { try { (keep ? localStorage : sessionStorage).setItem(k, v); } catch { /* memory only */ } },
    del(k) { try { sessionStorage.removeItem(k); localStorage.removeItem(k); } catch { /* nothing stored */ } }
  };

  // ── GitHub ───────────────────────────────────────────────────────────────
  let token = null;
  async function gh(path, { method = 'GET', body, raw } = {}) {
    const headers = { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', Authorization: 'Bearer ' + token, 'X-GitHub-Api-Version': '2022-11-28' };
    if (body) headers['Content-Type'] = 'application/json';
    let r;
    try { r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', referrerPolicy: 'no-referrer' }); }
    catch { throw Object.assign(new Error('連不上 GitHub，請檢查網路'), { status: 0 }); }
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw Object.assign(new Error(j.message || ('GitHub ' + r.status)), { status: r.status });
    }
    return raw ? r.text() : r.json();
  }
  const writeHint = e => (e.status === 403 || e.status === 404) ? '權杖沒有這個 repo 的 Contents 寫入權限（Read and write）。' : e.message;

  async function signIn(t) {
    token = t;
    const me = await gh('/user').catch(e => { throw new Error(e.status === 401 ? '權杖無效或已過期。' : e.message); });
    if (String(me.login).toLowerCase() !== OWNER) throw new Error(`這個權杖屬於 @${me.login}，只有網站擁有者能管理。`);
    const repo = await gh('/repos/' + REPO).catch(e => { throw new Error(e.status === 404 ? `權杖看不到 ${REPO}，請在 Repository access 加入它。` : e.message); });
    if (!repo.permissions || !repo.permissions.push) throw new Error(`這個帳號沒有 ${REPO} 的寫入權限。`);
    return me.login;
  }

  // a consistent snapshot of the data files at one commit of main
  async function fetchRemote() {
    const ref = await gh(`/repos/${REPO}/git/ref/heads/${BRANCH}`);
    const sha = ref.object.sha;
    const files = [...KINDS.map(k => PATH[k]), SEASONS_JS];
    const texts = await Promise.all(files.map(p => gh(`/repos/${REPO}/contents/${p}?ref=${sha}`, { raw: true })));
    const text = Object.fromEntries(files.map((p, i) => [p, texts[i]]));
    const docs = Object.fromEntries(KINDS.map(k => [k, JSON.parse(text[PATH[k]])]));
    let hans = {};
    try {
      const m = text[SEASONS_JS].match(/window\.SKY_SEASONS\s*=\s*([\s\S]*);\s*$/);
      hans = Object.fromEntries(JSON.parse(m[1]).map(s => [s.code, { zh: s.zh, zh_hans: s.zh_hans }]));
    } catch { /* keep empty: zh_hans falls back to zh */ }
    return { sha, text, docs, hans };
  }

  // ── state ────────────────────────────────────────────────────────────────
  let REMOTE = null;      // last snapshot of main the working copy is based on
  let ORIG = null;        // { seasons: [...], items: {...}, packs: [...] } parsed from REMOTE
  let W = null;           // working copy
  let ITEMS = [], ITEM = {};
  const body = (docs) => ({ seasons: docs.seasons.seasons, items: docs.items.items, packs: docs.packs.packs });
  function saveDraft() {
    try {
      if (changeCount(diff())) localStorage.setItem(DRAFT_KEY, JSON.stringify({ orig: ORIG, w: W }));
      else localStorage.removeItem(DRAFT_KEY);
    } catch { /* draft only lives in memory */ }
  }

  // Apply the changes between o and w on top of r (a newer remote copy). Keys changed on both sides take w's value.
  function rebase(o, w, r) {
    const res = clone(r);
    const byKey = (list, k) => Object.fromEntries(list.map(x => [x[k], x]));
    const so = byKey(o.seasons, 'code'), sw = byKey(w.seasons, 'code');
    Object.keys({ ...so, ...sw }).forEach(c => {
      if (same(so[c], sw[c])) return;
      res.seasons = res.seasons.filter(x => x.code !== c);
      if (sw[c]) res.seasons.push(clone(sw[c]));
    });
    res.seasons.sort((a, b) => a.code.localeCompare(b.code));
    Object.keys({ ...o.items, ...w.items }).forEach(n => {
      if (same(o.items[n], w.items[n])) return;
      if (w.items[n]) res.items[n] = clone(w.items[n]); else delete res.items[n];
    });
    const po = byKey(o.packs, 'id'), pw = byKey(w.packs, 'id');
    Object.keys({ ...po, ...pw }).forEach(id => {
      if (same(po[id], pw[id])) return;
      const i = res.packs.findIndex(p => p.id === id);
      if (pw[id]) { if (i >= 0) res.packs[i] = clone(pw[id]); else res.packs.unshift(clone(pw[id])); }
      else if (i >= 0) res.packs.splice(i, 1);
    });
    return res;
  }

  // ── item list: the game's own values, from the icon list the site uses ────
  function label(name) {
    let n = name.replace(/^(CharSkyKid|CharSkyNPC|NPC)_/, '')
      .replace(/^(Wing|Mask|Hair|Body|Hat|Horn|Neck|Tail|Feet|Face|Prop)_/, '')
      .replace(/AP\d{0,2}(?=[A-Z_]|$)/, '').replace(/_\d+$/, '').replace(/_/g, ' ');
    n = n.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/\s+/g, ' ').trim();
    return n || name;
  }
  async function loadItems() {
    const r = await fetch('assets/icons/icons.csv', { cache: 'no-cache' });
    if (!r.ok) throw new Error('讀不到 assets/icons/icons.csv');
    const lines = (await r.text()).replace(/^﻿/, '').split(/\r?\n/);
    const head = lines[0].split(',');
    const out = [];
    lines.slice(1).forEach(line => {
      const f = line.split(','), c = Object.fromEntries(head.map((h, i) => [h, (f[i] || '').trim()]));
      if (!c.name || c.status !== 'ok' || c.group === 'spell') return;
      out.push({ n: c.name, src: encodeURI(`assets/icons/${c.category}/${c.name}.png`), l: label(c.name),
        g: c.game_group || c.group, gs: 'game_season' in c ? c.game_season : c.season, ge: c.event, o: parseInt(c.order, 10) || 0 });
    });
    out.sort((a, b) => a.o - b.o);
    ITEMS = out;
    ITEM = Object.fromEntries(out.map(i => [i.n, i]));
  }

  // ── lookups (effective value = game data + correction) ─────────────────────
  const GROUPS = [['pass', '季節掛墜'], ['top', '上衣'], ['shoes', '鞋子'], ['outfit', '服裝'], ['mask', '面具'], ['face', '面飾'], ['neck', '項鍊'], ['hair', '頭髮'], ['head', '頭飾'], ['ear', '耳飾'], ['cape', '斗篷'], ['prop', '道具']];
  const GZ = Object.fromEntries(GROUPS);
  const STATUS = { confirmed: '已驗證', 'game-only': '僅遊戲資料', 'wiki-only': '已下架（wiki）' };
  const icon = it => (it ? `<img src="${it.src}" alt="" loading="lazy" decoding="async">` : '');
  const fix = n => W.items[n] || {};
  const seasonOf = it => ('season' in fix(it.n)) ? (fix(it.n).season || '') : it.gs;
  const groupOf = it => fix(it.n).group || it.g;
  const nameOf = it => fix(it.n).name_zh || fix(it.n).name_en || it.l;
  const nameOfKey = n => (ITEM[n] ? nameOf(ITEM[n]) : n);
  const isUlt = it => W.seasons.some(s => (s.ultimates || []).includes(it.n));
  const packsOf = n => W.packs.filter(p => p.items.includes(n));
  const seasonByCode = c => W.seasons.find(s => s.code === c);
  const seasonText = c => { const s = seasonByCode(c); return s ? `AP${c} ${s.zh}` : (c ? `AP${c}` : ''); };
  const sortedSeasons = () => W.seasons.slice().sort((a, b) => b.code.localeCompare(a.code));

  // ── change list ──────────────────────────────────────────────────────────
  const FIELD_ZH = { code: '季號', id: 'ID', zh: '繁中名', zh_hans: '簡中名', en: '英文名', start: '開始', end: '結束', note: '備註', ultimates: '畢業禮', name_zh: '繁中名', name_en: '英文名', group: '分類', season: '季節', hidden: '隱藏', unconfirmed: '待確認', usd: '價格', items: '內容物', event: '活動', year: '年份', status: '狀態', source: '來源', confidence: '可信度' };
  const changedFields = (a, b) => Object.keys({ ...a, ...b }).filter(k => !same(a[k], b[k])).map(k => FIELD_ZH[k] || k).join('、');
  function diff() {
    const out = { seasons: [], items: [], packs: [] };
    const byKey = (list, k) => Object.fromEntries(list.map(x => [x[k], x]));
    const so = byKey(ORIG.seasons, 'code'), sw = byKey(W.seasons, 'code');
    Object.keys({ ...so, ...sw }).sort().forEach(c => {
      if (!so[c]) out.seasons.push({ key: c, kind: 'new', label: `AP${c} ${sw[c].zh}` });
      else if (!sw[c]) out.seasons.push({ key: c, kind: 'del', label: `AP${c} ${so[c].zh}` });
      else if (!same(so[c], sw[c])) out.seasons.push({ key: c, kind: 'edit', label: `AP${c} ${sw[c].zh}`, what: changedFields(so[c], sw[c]) });
    });
    Object.keys({ ...ORIG.items, ...W.items }).sort().forEach(n => {
      const a = ORIG.items[n], b = W.items[n], lbl = ITEM[n] ? ITEM[n].l : n;
      if (!a) out.items.push({ key: n, kind: 'new', label: lbl, what: Object.keys(b).map(k => FIELD_ZH[k] || k).join('、') });
      else if (!b) out.items.push({ key: n, kind: 'del', label: lbl, what: '還原為遊戲資料' });
      else if (!same(a, b)) out.items.push({ key: n, kind: 'edit', label: lbl, what: changedFields(a, b) });
    });
    const po = byKey(ORIG.packs, 'id'), pw = byKey(W.packs, 'id');
    Object.keys({ ...po, ...pw }).forEach(id => {
      const p = pw[id] || po[id], lbl = p.name_zh || p.name_en || id;
      if (!po[id]) out.packs.push({ key: id, kind: 'new', label: lbl });
      else if (!pw[id]) out.packs.push({ key: id, kind: 'del', label: lbl });
      else if (!same(po[id], pw[id])) out.packs.push({ key: id, kind: 'edit', label: lbl, what: changedFields(po[id], pw[id]) });
    });
    return out;
  }
  const changeCount = d => d.seasons.length + d.items.length + d.packs.length;

  // same checks as scripts/build_catalog.py, so a save never breaks the build
  function problems() {
    const out = [], codes = W.seasons.map(s => s.code);
    if (new Set(codes).size !== codes.length) out.push('季號重複');
    W.seasons.forEach(s => { if (!/^\d\d$/.test(s.code) || !s.zh.trim() || !s.en.trim()) out.push(`AP${s.code}：季號要兩位數，繁中名和英文名都要填`); });
    Object.entries(W.items).forEach(([n, o]) => {
      if ('group' in o && !GZ[o.group]) out.push(`${nameOfKey(n)}：未知的分類 ${o.group}`);
      if (o.season && !codes.includes(o.season)) out.push(`${nameOfKey(n)}：季節 AP${o.season} 不存在`);
    });
    const ids = W.packs.map(p => p.id);
    if (new Set(ids).size !== ids.length) out.push('禮包 ID 重複');
    W.packs.forEach(p => {
      const nm = p.name_zh || p.name_en || p.id;
      if (!STATUS[p.status]) out.push(`${nm}：驗證狀態不正確`);
      if (p.usd != null && typeof p.usd !== 'number') out.push(`${nm}：價格要是數字或留空`);
      if (!p.items.length) out.push(`${nm}：還沒有內容物`);
    });
    return out;
  }

  // ── file output (same layout as the Python tools write) ───────────────────
  function fileText(k) {
    const src = REMOTE.docs[k];
    const data = k === 'seasons' ? W.seasons.slice().sort((a, b) => a.code.localeCompare(b.code)) : W[k];
    return JSON.stringify({ _about: src._about, _fields: src._fields, [k]: data }, null, 1) + '\n';
  }
  // zh_hans left empty is converted with OpenCC by build_catalog.py; here we keep the last converted name while the
  // Traditional name is unchanged, else fall back to the Traditional text until the script is run again
  const hansOf = s => s.zh_hans || (REMOTE.hans[s.code] && REMOTE.hans[s.code].zh === s.zh ? REMOTE.hans[s.code].zh_hans : s.zh);
  function seasonsJsText() {
    const out = W.seasons.slice().sort((a, b) => a.code.localeCompare(b.code)).map(s => ({ code: s.code, zh: s.zh, zh_hans: hansOf(s), en: s.en,
      start: s.start || '', end: s.end || '', note: s.note || '' }));
    return '/* generated by scripts/build_catalog.py from data/seasons.json; do not edit by hand */\n' +
      'window.SKY_SEASONS = ' + JSON.stringify(out, null, 1).replace(/^ +/gm, '') + ';\n';
  }
  function changedFiles() {
    const files = [];
    KINDS.forEach(k => { const t = fileText(k); if (t !== REMOTE.text[PATH[k]]) files.push({ path: PATH[k], content: t }); });
    const js = seasonsJsText();
    if (js !== REMOTE.text[SEASONS_JS]) files.push({ path: SEASONS_JS, content: js });
    return files;
  }

  // ── lists ────────────────────────────────────────────────────────────────
  const ui = { tab: 'seasons', sel: null, q: '', group: 'all', season: 'all', only: 'all', status: 'all', limit: 200, confirmDel: false };
  function refreshCount() {
    const n = changeCount(diff());
    $('#change-count').textContent = n;
    $('#open-changes').classList.toggle('dirty', n > 0);
  }
  function render() {
    refreshCount();
    $('#n-seasons').textContent = W.seasons.length;
    $('#n-items').textContent = ITEMS.length;
    $('#n-packs').textContent = W.packs.length;
    document.querySelectorAll('.tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)));
    renderList();
    renderEditor();
  }
  function renderList() {
    const focus = document.activeElement && document.activeElement.id === 'q', pos = focus ? document.activeElement.selectionStart : 0;
    const d = diff()[ui.tab];
    if (ui.tab === 'seasons') renderSeasons(d); else if (ui.tab === 'items') renderItems(d); else renderPacks(d);
    if (focus) { const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos); }
  }
  const tagFor = (key, d) => {
    const c = d.find(x => x.key === key);
    return c ? `<span class="tag ${c.kind === 'new' ? 'new' : c.kind === 'del' ? 'del' : 'gold'}">${c.kind === 'new' ? '新增' : c.kind === 'del' ? '刪除' : '已修改'}</span>` : '';
  };
  const searchBox = (ph, aria) => `<label class="search"><span aria-hidden="true">⌕</span><input id="q" type="search" placeholder="${ph}" value="${esc(ui.q)}" aria-label="${aria}"></label>`;

  function renderSeasons(d) {
    $('#filters').innerHTML = searchBox('找季節，例如 梵谷、Moomin、24', '搜尋季節') + '<button class="btn" type="button" id="new-season">＋ 新增季節</button>';
    const q = ui.q.toLowerCase();
    const list = sortedSeasons().filter(s => !q || (s.code + s.zh + s.en + (s.zh_hans || '')).toLowerCase().includes(q));
    const count = {};
    ITEMS.forEach(it => { const s = seasonOf(it); if (s) count[s] = (count[s] || 0) + 1; });
    $('#rows').innerHTML = `<p class="count-line">${list.length} 季 · 依季號排序（新到舊）</p>` + list.map(s => {
      const pend = ITEMS.find(it => seasonOf(it) === s.code && groupOf(it) === 'pass');
      return `<button type="button" class="row" data-season="${esc(s.code)}" aria-current="${ui.sel === 'S:' + s.code}">
        ${pend ? icon(pend) : '<span></span>'}
        <span class="main"><span class="t"><span class="code">AP${esc(s.code)}</span> ${esc(s.zh)} · ${esc(s.en)}</span><span class="s">${esc(s.start || '日期未填')}${s.end ? ' – ' + esc(s.end) : ''}</span></span>
        <span class="tags">${tagFor(s.code, d)}<span class="tag">${count[s.code] || 0} 件</span><span class="tag gold">畢業禮 ${(s.ultimates || []).length}</span>${s.note ? '<span class="tag info">有備註</span>' : ''}</span></button>`;
    }).join('') + (list.length ? '' : '<p class="empty">找不到這個季節。</p>');
  }

  function renderItems(d) {
    $('#filters').innerHTML = searchBox('名稱或內部名稱，例如 Pearl、Mask_AP02', '搜尋物品') +
      `<select id="f-group" aria-label="分類"><option value="all">全部分類</option>${GROUPS.map(([g, z]) => `<option value="${g}"${ui.group === g ? ' selected' : ''}>${z}</option>`).join('')}</select>
      <select id="f-season" aria-label="季節"><option value="all">全部季節</option><option value="none"${ui.season === 'none' ? ' selected' : ''}>非季節物品</option>${sortedSeasons().map(s => `<option value="${esc(s.code)}"${ui.season === s.code ? ' selected' : ''}>AP${esc(s.code)} ${esc(s.zh)}</option>`).join('')}</select>
      ${[['all', '全部'], ['fixed', '有修正'], ['review', '待確認'], ['hidden', '已隱藏'], ['noname', '沒有中文名']].map(([k, z]) => `<button type="button" class="chip" data-only="${k}" aria-pressed="${ui.only === k}">${z}</button>`).join('')}`;
    const q = ui.q.toLowerCase();
    const price = new Map();
    W.packs.forEach(p => p.items.forEach(n => { if (!price.has(n) || (price.get(n) == null && p.usd != null)) price.set(n, p.usd); }));
    const list = ITEMS.filter(it => {
      const f = fix(it.n), s = seasonOf(it);
      if (ui.group !== 'all' && groupOf(it) !== ui.group) return false;
      if (ui.season === 'none' ? s : (ui.season !== 'all' && s !== ui.season)) return false;
      if (ui.only === 'fixed' && !W.items[it.n]) return false;
      if (ui.only === 'review' && !f.unconfirmed) return false;
      if (ui.only === 'hidden' && !f.hidden) return false;
      if (ui.only === 'noname' && f.name_zh) return false;
      return !q || (it.l + ' ' + it.n + ' ' + (f.name_zh || '') + ' ' + (f.name_en || '')).toLowerCase().includes(q);
    });
    const shown = list.slice(0, ui.limit);
    $('#rows').innerHTML = `<p class="count-line">${list.length} 件${list.length > shown.length ? ` · 先顯示 ${shown.length} 件` : ''}</p>` + shown.map(it => {
      const f = fix(it.n), s = seasonOf(it), paid = price.has(it.n), usd = price.get(it.n);
      return `<button type="button" class="row" data-item="${esc(it.n)}" aria-current="${ui.sel === 'I:' + it.n}">
        ${icon(it)}<span class="main"><span class="t">${esc(nameOf(it))}${f.name_zh && f.name_en ? ` <span class="was">· ${esc(f.name_en)}</span>` : ''}</span><span class="s">${esc(it.n)}</span></span>
        <span class="tags">${tagFor(it.n, d)}<span class="tag">${GZ[groupOf(it)] || esc(groupOf(it))}</span>${s ? `<span class="tag">AP${esc(s)}</span>` : ''}${isUlt(it) ? '<span class="tag gold">畢業禮</span>' : ''}${paid ? `<span class="tag info">${usd == null ? '內購' : 'US$' + Number(usd).toFixed(2)}</span>` : ''}${f.unconfirmed ? '<span class="tag del">待確認</span>' : ''}${f.hidden ? '<span class="tag del">隱藏</span>' : ''}</span></button>`;
    }).join('') + (list.length > shown.length ? '<button class="btn ghost more" type="button" id="more">再顯示 200 件</button>' : '') +
      (list.length ? '' : '<p class="empty"><b>沒有符合的物品</b>換個關鍵字或篩選條件試試。</p>');
  }

  function renderPacks(d) {
    $('#filters').innerHTML = searchBox('禮包、內容物或 ID，例如 Bat、Moomin、SNC12', '搜尋禮包') +
      [['all', '全部'], ['confirmed', '已驗證'], ['game-only', '僅遊戲資料'], ['wiki-only', '已下架'], ['noname', '沒有中文名'], ['noprice', '價格未知']].map(([k, z]) => `<button type="button" class="chip" data-status="${k}" aria-pressed="${ui.status === k}">${z}</button>`).join('') +
      '<button class="btn" type="button" id="new-pack">＋ 新增禮包</button>';
    const q = ui.q.toLowerCase();
    const list = W.packs.filter(p => (ui.status === 'all' || (ui.status === 'noname' ? !p.name_zh : ui.status === 'noprice' ? p.usd == null : p.status === ui.status)) &&
      (!q || (p.id + ' ' + p.name_en + ' ' + (p.name_zh || '') + ' ' + p.event + ' ' + p.items.map(nameOfKey).join(' ') + ' ' + p.items.map(n => (ITEM[n] ? ITEM[n].l : n)).join(' ')).toLowerCase().includes(q)));
    $('#rows').innerHTML = `<p class="count-line">${list.length} 個禮包</p>` + list.map(p => `<button type="button" class="row" data-pack="${esc(p.id)}" aria-current="${ui.sel === 'P:' + p.id}">
        <span class="stack">${p.items.slice(0, 3).map(n => icon(ITEM[n])).join('')}</span>
        <span class="main"><span class="t">${esc(p.name_zh || p.name_en || p.id)}${p.name_zh && p.name_en ? ` <span class="was">· ${esc(p.name_en)}</span>` : ''}</span><span class="s">${esc(p.id)} · ${esc(p.event || '常駐')}${p.year ? ' · ' + esc(p.year) : ''}</span></span>
        <span class="tags">${tagFor(p.id, d)}<span class="tag gold">${p.usd != null ? 'US$' + Number(p.usd).toFixed(2) : '價格未知'}</span><span class="tag">${p.items.length} 件</span>${p.status !== 'confirmed' ? `<span class="tag info">${esc(STATUS[p.status] || p.status)}</span>` : ''}</span></button>`).join('') +
      (list.length ? '' : '<p class="empty">沒有符合的禮包。</p>');
  }

  // ── editors ──────────────────────────────────────────────────────────────
  const selKind = () => ui.sel.slice(0, 1), selKey = () => ui.sel.slice(2);
  function renderEditor() {
    const ed = $('#editor');
    if (!ui.sel) {
      ed.innerHTML = '<p class="empty"><b>從左邊選一筆來編輯</b>修改會先記在「變更」裡，確認後按「儲存到 GitHub」。</p>';
      ed.classList.toggle('closed', window.innerWidth <= 860);
      return;
    }
    ed.classList.remove('closed');
    const k = selKind(), key = selKey();
    ed.innerHTML = k === 'S' ? seasonEditor(seasonByCode(key)) : k === 'I' ? itemEditor(ITEM[key]) : packEditor(W.packs.find(p => p.id === key));
  }
  const closeBtn = '<button class="close" type="button" data-close aria-label="關閉">×</button>';
  const delBlock = what => (ui.confirmDel
    ? `<div class="confirm">確定要刪除${what}？<button class="btn danger small" type="button" data-del-yes>刪除</button><button class="btn ghost small" type="button" data-del-no>取消</button></div>`
    : `<button class="btn danger small" type="button" data-del>刪除${what}</button>`);
  const miniItem = (n, role) => `<span class="it">${icon(ITEM[n])}<span title="${esc(n)}">${esc(nameOfKey(n))}</span><button type="button" data-rm="${role}" data-n="${esc(n)}" aria-label="移除">×</button></span>`;
  const itemPicker = (role, ph) => `<div class="picker"><input class="input" data-pick="${role}" placeholder="${ph}" autocomplete="off"><div class="results" data-results="${role}" hidden></div></div>`;

  function seasonEditor(s) {
    if (!s) return '<p class="empty">這個季節已刪除。</p>';
    const orig = ORIG.seasons.find(x => x.code === s.code);
    const pend = ITEMS.find(it => seasonOf(it) === s.code && groupOf(it) === 'pass');
    const inSeason = ITEMS.filter(it => seasonOf(it) === s.code).length;
    const hansStale = !s.zh_hans && !(REMOTE.hans[s.code] && REMOTE.hans[s.code].zh === s.zh);
    return `<div class="ed-head">${pend ? icon(pend) : ''}<span class="ttl"><b>AP${esc(s.code)} ${esc(s.zh)}</b><small>${inSeason} 件季節物品</small></span>${closeBtn}</div>
      <div class="ed-body">
        <label class="field"><span>季號</span><input class="input" data-s="code" value="${esc(s.code)}" ${orig ? 'readonly' : ''} inputmode="numeric" maxlength="2"><span class="hint">${orig ? '既有季節的季號不能改（物品資料用它對應）。' : '兩位數，遊戲資料裡的 season_NN。'}</span></label>
        <div class="pair"><label class="field"><span>繁中名</span><input class="input" data-s="zh" value="${esc(s.zh)}"></label>
          <label class="field"><span>英文名</span><input class="input" data-s="en" value="${esc(s.en)}"></label></div>
        <label class="field"><span>簡中名 <span class="hint">留空 = 自動轉換</span></span><input class="input" data-s="zh_hans" value="${esc(s.zh_hans || '')}" placeholder="${esc(hansOf(s))}">
          ${hansStale ? '<span class="warn">繁中名改過了：簡中先沿用繁中字，要正確的簡體請直接填，或之後跑 build_catalog.py。</span>' : ''}</label>
        <div class="pair"><label class="field"><span>開始日期</span><input class="input" type="date" data-s="start" value="${esc(s.start || '')}"></label>
          <label class="field"><span>結束日期</span><input class="input" type="date" data-s="end" value="${esc(s.end || '')}"></label></div>
        <div class="field"><span>畢業禮 <span class="hint">${(s.ultimates || []).length} 件 · 從這季的物品裡加</span></span>
          <div class="mini">${(s.ultimates || []).map(n => miniItem(n, 'ult')).join('') || '<span class="hint">還沒有畢業禮</span>'}</div>
          ${itemPicker('ult', '加入畢業禮：搜尋這季的物品')}</div>
        <label class="field"><span>備註</span><textarea data-s="note">${esc(s.note || '')}</textarea></label>
        <div class="actions">${orig ? '' : '<span class="tag new">新季節</span>'}${delBlock('這個季節')}</div>
      </div>`;
  }

  function itemEditor(it) {
    if (!it) return '<p class="empty">找不到這個物品。</p>';
    const f = fix(it.n), s = seasonOf(it), packs = packsOf(it.n);
    const seasonSel = 'season' in f ? (f.season === null ? 'none' : f.season) : 'game';
    const gameSeason = it.gs ? seasonText(it.gs) : (it.ge ? '活動 ' + it.ge : '非季節');
    return `<div class="ed-head">${icon(it)}<span class="ttl"><b>${esc(nameOf(it))}</b><small>${esc(it.n)}</small></span>${closeBtn}</div>
      <div class="ed-body">
        <div class="pair"><label class="field"><span>繁中名</span><input class="input" data-i="name_zh" value="${esc(f.name_zh || '')}" placeholder="${esc(it.l)}"></label>
          <label class="field"><span>英文名</span><input class="input" data-i="name_en" value="${esc(f.name_en || '')}" placeholder="${esc(it.l)}"></label></div>
        <label class="field"><span>網站分類</span><select data-i="group"><option value="">依遊戲資料（${GZ[it.g] || esc(it.g)}）</option>${GROUPS.map(([g, z]) => `<option value="${g}"${f.group === g ? ' selected' : ''}>${z}</option>`).join('')}</select></label>
        <label class="field"><span>季節</span><select data-i="season">
            <option value="game"${seasonSel === 'game' ? ' selected' : ''}>依遊戲資料（${esc(gameSeason)}）</option>
            <option value="none"${seasonSel === 'none' ? ' selected' : ''}>不算季節物品</option>
            ${sortedSeasons().map(x => `<option value="${esc(x.code)}"${seasonSel === x.code ? ' selected' : ''}>AP${esc(x.code)} ${esc(x.zh)}</option>`).join('')}</select>
          ${'season' in f ? `<span class="was">遊戲資料：<b>${esc(gameSeason)}</b></span>` : ''}</label>
        <label class="switch"><input type="checkbox" data-i="ultimate" ${isUlt(it) ? 'checked' : ''} ${s ? '' : 'disabled'}><span>這季的畢業禮${s ? '' : '<span class="hint">（先設定季節）</span>'}</span></label>
        <label class="switch"><input type="checkbox" data-i="hidden" ${f.hidden ? 'checked' : ''}><span>在網站上隱藏</span></label>
        <label class="field"><span>待確認原因 <span class="hint">填了就會列在季節包的 99_待確認</span></span><input class="input" data-i="unconfirmed" value="${esc(f.unconfirmed || '')}"></label>
        <label class="field"><span>來源</span><input class="input" data-i="source" value="${esc(f.source || '')}" placeholder="例如 wiki、遊戲內確認"></label>
        <label class="field"><span>備註</span><textarea data-i="note">${esc(f.note || '')}</textarea>${f.confidence ? `<span class="was">對應可信度：<b>${esc(f.confidence)}</b></span>` : ''}</label>
        ${packs.length ? `<div class="field"><span>內購禮包</span><div class="mini">${packs.map(p => `<span class="it"><span>${esc(p.name_zh || p.name_en || p.id)}</span><button type="button" data-goto-pack="${esc(p.id)}" aria-label="打開禮包">→</button></span>`).join('')}</div></div>` : ''}
        <div class="actions">${W.items[it.n] ? '<button class="btn ghost small" type="button" data-reset-item>還原為遊戲資料</button>' : '<span class="hint">目前沒有修正，全部沿用遊戲資料。</span>'}</div>
      </div>`;
  }

  function packEditor(p) {
    if (!p) return '<p class="empty">這個禮包已刪除。</p>';
    const orig = ORIG.packs.find(x => x.id === p.id);
    return `<div class="ed-head"><span class="stack">${p.items.slice(0, 2).map(n => icon(ITEM[n])).join('')}</span><span class="ttl"><b>${esc(p.name_zh || p.name_en || p.id)}</b><small>${esc(p.id)}</small></span>${closeBtn}</div>
      <div class="ed-body">
        <label class="field"><span>ID</span><input class="input" data-p="id" value="${esc(p.id)}" ${orig ? 'readonly' : ''}><span class="hint">${orig ? '遊戲內購 ID，不能改。' : '遊戲內購 ID；已下架、只在 wiki 上的用 wiki: 開頭。'}</span></label>
        <div class="pair"><label class="field"><span>繁中名</span><input class="input" data-p="name_zh" value="${esc(p.name_zh || '')}" placeholder="例如 蝙蝠斗篷"></label>
          <label class="field"><span>英文名</span><input class="input" data-p="name_en" value="${esc(p.name_en || '')}"></label></div>
        <div class="pair"><label class="field"><span>價格（美金）</span><input class="input" data-p="usd" inputmode="decimal" value="${p.usd == null ? '' : esc(p.usd)}" placeholder="未知"></label>
          <label class="field"><span>年份</span><input class="input" data-p="year" inputmode="numeric" value="${esc(p.year || '')}" maxlength="4"></label></div>
        <div class="pair"><label class="field"><span>季節 / 活動</span><input class="input" data-p="event" value="${esc(p.event || '')}" placeholder="season_31、mischief_26…"></label>
          <label class="field"><span>驗證狀態</span><select data-p="status">${Object.entries(STATUS).map(([k, z]) => `<option value="${k}"${p.status === k ? ' selected' : ''}>${z}</option>`).join('')}</select></label></div>
        <div class="field"><span>內容物 <span class="hint">${p.items.length} 件</span></span>
          <div class="mini">${p.items.map(n => miniItem(n, 'pack')).join('') || '<span class="hint">還沒有內容物</span>'}</div>
          ${itemPicker('pack', '加入物品：搜尋名稱或內部名稱')}</div>
        <label class="field"><span>備註</span><textarea data-p="note">${esc(p.note || '')}</textarea></label>
        <div class="actions">${orig ? '' : '<span class="tag new">新禮包</span>'}${delBlock('這個禮包')}</div>
      </div>`;
  }

  // ── mutations ────────────────────────────────────────────────────────────
  function setItemFix(n, k, v) {
    const f = { ...(W.items[n] || {}) };
    if (v === undefined || v === '' || v === false) delete f[k]; else f[k] = v;
    if (Object.keys(f).length) W.items[n] = f; else delete W.items[n];
  }
  function setUltimate(n, on) {
    W.seasons.forEach(s => { if ((s.ultimates || []).includes(n)) s.ultimates = s.ultimates.filter(x => x !== n); });
    if (on) { const s = seasonByCode(seasonOf(ITEM[n])); if (s) (s.ultimates = s.ultimates || []).push(n); }
  }
  function changed(soft) { saveDraft(); if (soft) { refreshCount(); renderList(); } else render(); }

  function showResults(input) {
    const role = input.dataset.pick, box = document.querySelector(`[data-results="${role}"]`), q = input.value.trim().toLowerCase();
    if (!q) { box.hidden = true; return; }
    const pool = role === 'ult' ? ITEMS.filter(it => seasonOf(it) === selKey() && groupOf(it) !== 'pass') : ITEMS;
    const hits = pool.filter(it => (it.l + ' ' + it.n + ' ' + (fix(it.n).name_zh || '') + ' ' + (fix(it.n).name_en || '')).toLowerCase().includes(q)).slice(0, 30);
    box.innerHTML = hits.map(it => `<button type="button" data-add="${role}" data-n="${esc(it.n)}">${icon(it)}<span>${esc(nameOf(it))}</span><small>${GZ[groupOf(it)] || ''}</small></button>`).join('') ||
      '<p class="hint p6">沒有符合的物品</p>';
    box.hidden = false;
  }

  let toastT;
  function toast(html, ms) {
    const el = $('#toast'); el.innerHTML = html; el.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, ms || 2200);
  }

  function onInput(e) {
    const el = e.target;
    if (el.id === 'q') { ui.q = el.value; ui.limit = 200; renderList(); return; }
    if (!ui.sel) { if (el.dataset.pick) showResults(el); return; }
    if (el.dataset.s) {
      if (el.dataset.s === 'code') return;
      seasonByCode(selKey())[el.dataset.s] = el.value; changed(true); return;
    }
    if (el.dataset.p) {
      const p = W.packs.find(x => x.id === selKey()), k = el.dataset.p;
      if (k === 'id' || k === 'status') return;
      if (k === 'usd') { const v = el.value.trim(); if (v === '') p.usd = null; else if (!isNaN(parseFloat(v)) && isFinite(v)) p.usd = parseFloat(v); }
      else p[k] = el.value;
      changed(true); return;
    }
    if (el.dataset.i && /^(name_zh|name_en|unconfirmed|source|note)$/.test(el.dataset.i)) { setItemFix(selKey(), el.dataset.i, el.value.trim()); changed(true); return; }
    if (el.dataset.pick) showResults(el);
  }
  function onChange(e) {
    const el = e.target;
    if (el.id === 'f-group') { ui.group = el.value; ui.limit = 200; renderList(); return; }
    if (el.id === 'f-season') { ui.season = el.value; ui.limit = 200; renderList(); return; }
    if (!ui.sel) return;
    if (el.dataset.s === 'code') {  // new seasons only
      const s = seasonByCode(selKey()), v = el.value.trim();
      if (!/^\d\d$/.test(v) || (v !== s.code && seasonByCode(v))) { toast('季號要兩位數，而且不能和其他季重複'); el.value = s.code; return; }
      s.code = v; ui.sel = 'S:' + v; changed(); return;
    }
    if (el.dataset.p === 'id') {
      const p = W.packs.find(x => x.id === selKey()), v = el.value.trim();
      if (!v || (v !== p.id && W.packs.some(x => x.id === v))) { toast('ID 不能空白，也不能和其他禮包重複'); el.value = p.id; return; }
      p.id = v; ui.sel = 'P:' + v; changed(); return;
    }
    if (el.dataset.p === 'status') { W.packs.find(x => x.id === selKey()).status = el.value; changed(); return; }
    if (el.dataset.p === 'usd') { el.value = W.packs.find(x => x.id === selKey()).usd ?? ''; return; }
    if (el.dataset.i) {
      const n = selKey(), k = el.dataset.i;
      if (k === 'group') setItemFix(n, 'group', el.value || undefined);
      else if (k === 'season') {
        const f = { ...(W.items[n] || {}) };
        if (el.value === 'game') delete f.season; else f.season = el.value === 'none' ? null : el.value;
        if (Object.keys(f).length) W.items[n] = f; else delete W.items[n];
        if (isUlt(ITEM[n])) setUltimate(n, !!seasonOf(ITEM[n]));  // the ultimate follows its season
      } else if (k === 'ultimate') setUltimate(n, el.checked);
      else if (k === 'hidden') setItemFix(n, 'hidden', el.checked || undefined);
      else return;
      changed();
    }
  }
  function onClick(e) {
    const t = e.target.closest('button');
    if (!t) { document.querySelectorAll('.results').forEach(r => { if (!r.contains(e.target)) r.hidden = true; }); return; }
    const ds = t.dataset;
    if (ds.tab) { ui.tab = ds.tab; ui.sel = null; ui.q = ''; ui.confirmDel = false; render(); return; }
    if (ds.season) { ui.sel = 'S:' + ds.season; ui.confirmDel = false; render(); return; }
    if (ds.item) { ui.sel = 'I:' + ds.item; ui.confirmDel = false; render(); return; }
    if (ds.pack) { ui.sel = 'P:' + ds.pack; ui.confirmDel = false; render(); return; }
    if (ds.gotoPack) { ui.tab = 'packs'; ui.q = ''; ui.status = 'all'; ui.sel = 'P:' + ds.gotoPack; render(); return; }
    if (ds.only) { ui.only = ds.only; ui.limit = 200; renderList(); return; }
    if (ds.status) { ui.status = ds.status; renderList(); return; }
    if (t.id === 'more') { ui.limit += 200; renderList(); return; }
    if (t.hasAttribute('data-close')) { ui.sel = null; render(); return; }
    if (t.id === 'new-season') {
      const code = String(Math.max(0, ...W.seasons.map(s => +s.code)) + 1).padStart(2, '0');
      W.seasons.push({ code, zh: '新季節', zh_hans: '', en: 'New Season', ultimates: [], start: '', end: '', note: '' });
      ui.sel = 'S:' + code; ui.q = ''; changed(); toast(`已新增 AP${code}，填好名稱就完成了`); return;
    }
    if (t.id === 'new-pack') {
      let i = 1; while (W.packs.some(p => p.id === 'NEW' + i)) i++;
      W.packs.unshift({ id: 'NEW' + i, name_en: '', name_zh: '新禮包', usd: null, items: [], event: '', year: String(new Date().getFullYear()), status: 'confirmed', note: '' });
      ui.sel = 'P:NEW' + i; ui.q = ''; ui.status = 'all'; changed(); toast('已新增禮包，記得改成遊戲的內購 ID'); return;
    }
    if (ds.add) {
      const n = ds.n;
      if (ds.add === 'ult') setUltimate(n, true);
      else { const p = W.packs.find(x => x.id === selKey()); if (!p.items.includes(n)) p.items.push(n); }
      changed(); return;
    }
    if (ds.rm) {
      const n = ds.n;
      if (ds.rm === 'ult') { const s = seasonByCode(selKey()); s.ultimates = s.ultimates.filter(x => x !== n); }
      else { const p = W.packs.find(x => x.id === selKey()); p.items = p.items.filter(x => x !== n); }
      changed(); return;
    }
    if (t.hasAttribute('data-reset-item')) { delete W.items[selKey()]; changed(); toast('已還原，改用遊戲資料'); return; }
    if (t.hasAttribute('data-del')) { ui.confirmDel = true; renderEditor(); return; }
    if (t.hasAttribute('data-del-no')) { ui.confirmDel = false; renderEditor(); return; }
    if (t.hasAttribute('data-del-yes')) {
      const k = selKind(), key = selKey();
      if (k === 'S') W.seasons = W.seasons.filter(s => s.code !== key); else W.packs = W.packs.filter(p => p.id !== key);
      ui.sel = null; ui.confirmDel = false; changed(); toast('已刪除，可以在「變更」裡還原'); return;
    }
    if (t.id === 'open-changes') { openDrawer(); return; }
    if (t.hasAttribute('data-drawer-close')) { closeDrawer(); return; }
    if (ds.jump) { ui.tab = { S: 'seasons', I: 'items', P: 'packs' }[ds.jump[0]]; ui.sel = ds.jump; ui.q = ''; closeDrawer(); render(); return; }
    if (ds.revert) { revert(ds.revert); render(); openDrawer(); return; }
    if (t.id === 'discard') { W = clone(ORIG); ui.sel = null; saveDraft(); closeDrawer(); render(); toast('已放棄所有變更'); return; }
    if (t.id === 'save') { save(); return; }
    if (t.id === 'reload') { reload(); return; }
    if (t.id === 'logout') { logout(); return; }
  }

  // ── changes drawer + save ────────────────────────────────────────────────
  let saving = false;
  function openDrawer() {
    const d = diff(), n = changeCount(d), probs = n ? problems() : [];
    const K = { new: ['new', '新增'], edit: ['gold', '修改'], del: ['del', '刪除'] };
    const pref = { seasons: 'S', items: 'I', packs: 'P' };
    $('#drawer').innerHTML = `<div class="drawer-in" role="dialog" aria-modal="true" aria-label="變更">
      <div class="drawer-head"><b>變更</b><span class="tag">${n} 筆</span><span class="spacer"></span><button class="btn ghost small" type="button" data-drawer-close>關閉</button></div>
      <div class="drawer-body">
        <p class="note">以 <code>${esc(REMOTE.sha.slice(0, 7))}</code> 為基準。儲存會在 <code>${BRANCH}</code> 上建立一個 commit，網站約 1–2 分鐘後更新。尚未儲存的變更會留在這個瀏覽器。</p>
        ${probs.length ? `<div class="problems"><b>要先修正才能儲存</b><ul>${probs.map(p => `<li>${esc(p)}</li>`).join('')}</ul></div>` : ''}
        ${KINDS.map(k => `<div class="file"><div class="file-head"><span class="fn">${PATH[k]}</span><span class="tag">${d[k].length} 筆</span></div>
          ${d[k].map(c => `<div class="chg"><span class="tag ${K[c.kind][0]}">${K[c.kind][1]}</span><button type="button" data-jump="${pref[k]}:${esc(c.key)}">${esc(c.label)}</button><span class="what">${esc(c.what || '')}</span><span class="spacer"></span><button type="button" class="what" data-revert="${k}|${esc(c.key)}">還原</button></div>`).join('') || '<div class="chg"><span class="what">沒有變更</span></div>'}</div>`).join('')}
      </div>
      <div class="drawer-foot">
        <input class="input" id="commit-msg" placeholder="${esc(defaultMessage(d))}" aria-label="commit 訊息（可留空）"${n ? '' : ' disabled'}>
        <button class="btn" type="button" id="save"${n && !probs.length && !saving ? '' : ' disabled'}>${saving ? '儲存中…' : '儲存到 GitHub'}</button>
        <button class="btn danger" type="button" id="discard"${n ? '' : ' disabled'}>放棄所有變更</button>
        <span class="spacer"></span>
        <button class="btn ghost small" type="button" id="reload">重新載入最新資料</button>
      </div></div>`;
    $('#drawer').hidden = false;
  }
  function closeDrawer() { $('#drawer').hidden = true; }
  function revert(spec) {
    const i = spec.indexOf('|'), k = spec.slice(0, i), key = spec.slice(i + 1);
    if (k === 'items') { if (ORIG.items[key]) W.items[key] = clone(ORIG.items[key]); else delete W.items[key]; }
    if (k === 'seasons') { const o = ORIG.seasons.find(s => s.code === key); W.seasons = W.seasons.filter(s => s.code !== key); if (o) W.seasons.push(clone(o)); }
    if (k === 'packs') {
      const o = ORIG.packs.find(p => p.id === key), at = W.packs.findIndex(p => p.id === key);
      if (at >= 0) W.packs.splice(at, 1);
      if (o) W.packs.splice(Math.min(ORIG.packs.indexOf(o), W.packs.length), 0, clone(o));
    }
    saveDraft();
  }
  function defaultMessage(d) {
    const parts = [['seasons', '季節'], ['items', '物品'], ['packs', '禮包']].filter(([k]) => d[k].length).map(([k, z]) => `${z} ${d[k].length}`);
    return parts.length ? `目錄管理：更新${parts.join('、')}` : '目錄管理';
  }
  function commitMessage(d) {
    const title = ($('#commit-msg') && $('#commit-msg').value.trim()) || defaultMessage(d);
    const K = { new: '新增', edit: '修改', del: '刪除' };
    const lines = KINDS.flatMap(k => d[k].map(c => `- ${PATH[k]}：${K[c.kind]} ${c.label}${c.what ? `（${c.what}）` : ''}`));
    return title + '\n\n' + lines.slice(0, 60).join('\n') + (lines.length > 60 ? `\n…另外 ${lines.length - 60} 筆` : '') + '\n\n由 admin.html 儲存';
  }

  // Re-read main; if any data file moved on since we loaded, carry the working changes over onto it.
  async function catchUp() {
    const fresh = await fetchRemote();
    if (fresh.sha === REMOTE.sha) return false;
    const moved = KINDS.some(k => fresh.text[PATH[k]] !== REMOTE.text[PATH[k]]) || fresh.text[SEASONS_JS] !== REMOTE.text[SEASONS_JS];
    const newOrig = body(fresh.docs);
    W = rebase(ORIG, W, newOrig); ORIG = clone(newOrig); REMOTE = fresh; saveDraft();
    return moved;
  }

  async function save() {
    if (saving) return;
    const probs = problems();
    if (probs.length) { openDrawer(); return; }
    saving = true; openDrawer();
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await catchUp()) {  // someone else (or another tab) saved: let the owner look at the merged result first
          saving = false; render(); openDrawer();
          toast('GitHub 上的資料有新版本，已把你的變更套用到最新版，請再確認一次後儲存。', 6000);
          return;
        }
        const d = diff(), files = changedFiles();
        if (!files.length) { saving = false; W = clone(ORIG); saveDraft(); render(); closeDrawer(); toast('沒有需要儲存的變更'); return; }
        const head = await gh(`/repos/${REPO}/git/commits/${REMOTE.sha}`);
        const tree = await gh(`/repos/${REPO}/git/trees`, { method: 'POST', body: { base_tree: head.tree.sha, tree: files.map(f => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) } });
        const commit = await gh(`/repos/${REPO}/git/commits`, { method: 'POST', body: { message: commitMessage(d), tree: tree.sha, parents: [REMOTE.sha] } });
        try {
          await gh(`/repos/${REPO}/git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: commit.sha, force: false } });
        } catch (e) {
          if (e.status === 422 && attempt === 0) continue;  // main moved between our read and write: catch up and retry
          throw e;
        }
        files.forEach(f => { REMOTE.text[f.path] = f.content; });
        REMOTE.sha = commit.sha;
        REMOTE.hans = Object.fromEntries(W.seasons.map(s => [s.code, { zh: s.zh, zh_hans: hansOf(s) }]));
        ORIG = clone(W); saveDraft();
        saving = false; closeDrawer(); render();
        toast(`已儲存 ${files.length} 個檔案 · <a href="https://github.com/${REPO}/commit/${commit.sha}" target="_blank" rel="noopener">${commit.sha.slice(0, 7)}</a> · 網站約 1–2 分鐘後更新`, 8000);
        return;
      }
      throw new Error('main 一直在變動，請稍後再試');
    } catch (e) {
      saving = false; openDrawer();
      toast('儲存失敗：' + esc(writeHint(e)), 8000);
    }
  }

  async function reload() {
    try {
      const moved = await catchUp();
      render(); openDrawer();
      toast(moved ? '已載入最新資料，你的變更已套用在上面' : '已經是最新資料');
    } catch (e) { toast('載入失敗：' + esc(e.message), 6000); }
  }

  async function logout() {
    store.del(TOKEN_KEY); token = null;  // an unsaved draft stays in this browser for the next sign-in
    if (fb && fauth && fauth.currentUser) await fb.signOut(fauth).catch(() => {});
    location.reload();
  }

  // ── start ────────────────────────────────────────────────────────────────
  let wired = false;
  async function open(login) {
    $('#gate').hidden = true; $('#app').hidden = false;
    $('#who').innerHTML = `<b>@${esc(login)}</b><button class="btn ghost small" type="button" id="logout">登出</button>`;
    if (!wired) {
      wired = true;
      document.addEventListener('input', onInput);
      document.addEventListener('change', onChange);
      document.addEventListener('click', onClick);
      document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!$('#drawer').hidden) closeDrawer(); else if (ui.sel) { ui.sel = null; render(); } } });
      $('#drawer').addEventListener('click', e => { if (e.target.id === 'drawer') closeDrawer(); });
      window.addEventListener('beforeunload', e => { if (W && changeCount(diff()) && saving) { e.preventDefault(); e.returnValue = ''; } });
    }
    try {
      const [remote] = await Promise.all([fetchRemote(), loadItems()]);
      REMOTE = remote; ORIG = body(remote.docs); W = clone(ORIG);
      let restored = 0;
      try {
        const dr = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
        if (dr && dr.orig && dr.w) { W = rebase(dr.orig, dr.w, ORIG); restored = changeCount(diff()); }
      } catch { W = clone(ORIG); }
      ui.sel = 'S:' + W.seasons.map(s => s.code).sort().pop();
      render();
      if (restored) toast(`已還原上次未儲存的 ${restored} 筆變更`, 4000);
    } catch (e) {
      $('#rows').innerHTML = `<p class="empty"><b>載入失敗</b>${esc(e.message)}</p>`;
    }
  }

  // ── sign-in: Google (Firebase) with the GitHub token kept in Firestore, or a GitHub token pasted here ──
  // admin/{uid} in Firestore holds the token; firebase/firestore.rules lets only the listed admin accounts read it.
  let fb = null, fauth = null, fdb = null, guser = null, mode = 'google';
  const gateShow = id => ['#g-start', '#g-denied', '#g-setup'].forEach(x => { $(x).hidden = x !== id; });
  const gateErr = msg => { $('#g-err').textContent = msg || ''; $('#g-err').hidden = !msg; };
  function loadFirebase() {
    if (!FB_CFG) return Promise.reject(new Error('Firebase 尚未設定'));
    if (!loadFirebase.p) loadFirebase.p = import(SDK_URL).then(m => {
      fb = m;
      const app = m.initializeApp(FB_CFG);
      fauth = m.initializeAuth(app, { persistence: [m.indexedDBLocalPersistence, m.browserLocalPersistence], popupRedirectResolver: m.browserPopupRedirectResolver });
      fdb = m.getFirestore(app);
      if (window.FIREBASE_EMULATOR) {  // test harness only
        m.connectAuthEmulator(fauth, 'http://127.0.0.1:9099', { disableWarnings: true });
        m.connectFirestoreEmulator(fdb, '127.0.0.1', 8080);
        window.__adminTest = { signIn: (sub, email) => fb.signInWithCredential(fauth, fb.GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true }))).then(r => afterGoogle(r.user)) };
      }
      return new Promise(res => { const off = m.onAuthStateChanged(fauth, u => { off(); res(u); }); });
    });
    return loadFirebase.p;
  }
  const adminRef = () => fb.doc(fdb, 'admin', guser.uid);
  async function afterGoogle(user) {
    guser = user; gateErr('');
    let snap;
    try { snap = await fb.getDoc(adminRef()); }
    catch (e) {
      if (e.code === 'permission-denied') return showDenied(user);
      gateShow('#g-start'); gateErr('讀取管理設定失敗：' + (e.message || e.code)); return;
    }
    const saved = snap.exists() && snap.data().githubToken;
    if (!saved) return showSetup('第一次使用：貼上 GitHub 權杖。它會存在只有你的 Google 帳號讀得到的地方，之後用 Google 登入就好。');
    try { open(await signIn(saved)); }
    catch (ex) { token = null; showSetup('存著的 GitHub 權杖不能用了（' + ex.message + '）請貼一個新的。'); }
  }
  function showSetup(why) {
    mode = 'google';
    $('#g-setup-why').textContent = why;
    $('#remember-row').hidden = true;
    $('#login-btn').textContent = '儲存並進入';
    gateShow('#g-setup');
    $('#g-alt').hidden = true;
  }
  async function showDenied(user) {
    $('#g-who').textContent = user.email || user.uid;
    let rules = '';
    try { rules = await (await fetch('firebase/firestore.rules', { cache: 'no-cache' })).text(); } catch { /* shown empty */ }
    $('#g-rules').value = rules.replace(/function isAdmin\(uid\) \{ return uid in \[(.*?)\]; \}/, (m, list) => {
      const ids = list.split(',').map(x => x.trim()).filter(Boolean);
      if (!ids.includes(`'${user.uid}'`)) ids.push(`'${user.uid}'`);
      return `function isAdmin(uid) { return uid in [${ids.join(', ')}]; }`;
    });
    gateShow('#g-denied');
  }
  $('#g-signin').addEventListener('click', async () => {
    const b = $('#g-signin');
    b.disabled = true; gateErr('');
    try { const r = await fb.signInWithPopup(fauth, new fb.GoogleAuthProvider()); await afterGoogle(r.user); }
    catch (e) {
      if (!/popup-closed|cancelled-popup/.test(e.code || '')) gateErr(/popup-blocked/.test(e.code || '') ? '瀏覽器擋住了登入視窗，請允許彈出視窗後再試。' : '登入失敗：' + (e.code || e.message));
    } finally { b.disabled = false; }
  });
  document.addEventListener('click', async e => {
    if (e.target.closest('[data-signout]')) { if (fauth) await fb.signOut(fauth); location.reload(); }
  });
  $('#g-copy').addEventListener('click', async () => {
    const ta = $('#g-rules');
    try { await navigator.clipboard.writeText(ta.value); toast('已複製規則'); } catch { ta.focus(); ta.select(); }
  });
  $('#g-alt').addEventListener('click', () => {  // fallback when Google sign-in isn't available
    mode = 'token';
    $('#g-setup-why').textContent = '用 GitHub 權杖登入：權杖只存在這個瀏覽器，只會送到 GitHub。';
    $('#remember-row').hidden = false;
    $('#login-btn').textContent = '登入';
    gateShow('#g-setup'); $('#g-alt').hidden = true;
  });

  $('#login').addEventListener('submit', async e => {
    e.preventDefault();
    const t = $('#token').value.trim(), err = $('#login-err'), btn = $('#login-btn'), label = btn.textContent;
    if (!t) return;
    err.hidden = true; btn.disabled = true; btn.textContent = '確認中…';
    try {
      const login = await signIn(t);
      if (mode === 'google' && guser) await fb.setDoc(adminRef(), { githubToken: t, updatedAt: fb.serverTimestamp() });
      else { store.del(TOKEN_KEY); store.set(TOKEN_KEY, t, $('#remember').checked); }
      $('#token').value = '';
      open(login);
    } catch (ex) {
      token = null; err.textContent = ex.code === 'permission-denied' ? '這個 Google 帳號不能儲存權杖。' : ex.message; err.hidden = false;
    } finally { btn.disabled = false; btn.textContent = label; }
  });

  // start: a token remembered on this device (fallback mode), else Google
  const saved = store.get(TOKEN_KEY);
  if (saved) {
    mode = 'token';
    signIn(saved).then(open).catch(ex => {
      token = null; store.del(TOKEN_KEY);
      $('#g-alt').click(); $('#login-err').textContent = '請重新登入：' + ex.message; $('#login-err').hidden = false;
    });
  } else if (!FB_CFG) $('#g-alt').click();
  else {
    loadFirebase().then(u => {
      const b = $('#g-signin'); b.disabled = false; b.querySelector('span').textContent = '用 Google 登入';
      if (u) afterGoogle(u);
    }).catch(e => { console.warn(e); gateErr('連不到 Google 登入服務，可以改用 GitHub 權杖登入。'); });
  }
})();
