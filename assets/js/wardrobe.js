/* sky-salmon — wardrobe (wardrobe.html): a catalogue of every closet item, by slot and season.
 * Data: assets/icons/icons.csv with data/ (seasons, item corrections, paid packs) applied by card-data.js.
 * An item can be linked to directly with #item=<name>. Seeing your own kid dressed up lives on the height page
 * (upload the outfit QR there).
 * 3D try-on (wardrobe-3d.js) is a restricted feature, "wardrobe3d": open to everyone, to approved accounts or to
 * listed email addresses, as the admins set it in admin.html → 權限 (access.js asks). Picking an item puts it on the
 * kid in its slot; the look is kept on this device. */
(() => {
  const HERE = document.currentScript.src;
  const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
  const D = window.CardData;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CATS = D.CLOSET_CATS.filter(c => D.CAT_BY_ID[c]);
  // while searching, ui.cat can be 'all' (every tab); a tab picked during a search narrows it, clearing the search
  // goes back to the tab you were on
  const ui = { cat: CATS[0], q: '', season: 'all', sort: 'closet', item: null, tab: CATS[0] };
  let ALL = [];
  // 3D try-on state: gate = the answer from Access.check (ok, or why not); stage = wardrobe-3d.js once mounted
  const LOOK_KEY = 'candle.wardrobe.look3d';
  const REQUIRED = new Set(['cape', 'mask', 'hair', 'outfit']);
  const CLIPS = [['idle', t('待機')], ['waveSmall', t('揮手')], ['bow', t('鞠躬')], ['clap', t('拍手')], ['cheer', t('歡呼')], ['sit', t('坐下')]];
  let gate = { code: 'loading' }, stage = null, look = null, busyGate = false;

  const seasonOf = i => i.season || null;
  const priceOf = i => (i.usd && i.usd !== '?' ? 'US$' + i.usd : '');
  const query = () => ui.q.trim().toLowerCase();
  function matches(i, q) {   // search and season filter, any tab
    const s = seasonOf(i);
    if (ui.season === 'none' ? s : (ui.season !== 'all' && s !== ui.season)) return false;
    return !q || [i.label, i.name, i.nameZh, i.nameEn, s ? D.seasonFull(s) : '', i.pack || ''].join(' ').toLowerCase().includes(q);
  }
  function list() {
    const q = query();
    const out = ALL.filter(i => (ui.cat === 'all' || i.cat === ui.cat) && matches(i, q));
    const sk = i => seasonOf(i) || '';
    const by = {
      closet: (a, b) => a.order - b.order || a.label.localeCompare(b.label),
      new: (a, b) => sk(b).localeCompare(sk(a)) || a.order - b.order,
      old: (a, b) => (sk(a) || '~').localeCompare(sk(b) || '~') || a.order - b.order,
      name: (a, b) => a.label.localeCompare(b.label)
    }[ui.sort];
    return out.sort(by);
  }

  function renderSlots() {
    const q = query(), hits = q ? ALL.filter(i => matches(i, q)) : null;
    const all = hits ? `<button type="button" role="tab" class="wd-slot" data-cat="all" aria-selected="${ui.cat === 'all'}">${t('全部')}<small>${hits.length}</small></button>` : '';
    $('#wd-slots').innerHTML = all + CATS.map(c => {
      const n = ALL.filter(i => i.cat === c).length, m = hits ? hits.filter(i => i.cat === c).length : n;
      return n ? `<button type="button" role="tab" class="wd-slot" data-cat="${c}" aria-selected="${c === ui.cat}"${hits && !m ? ' data-none' : ''}>${esc(D.CAT_BY_ID[c].zh)}<small>${m}</small></button>` : '';
    }).join('');
  }
  function renderSeasons() {
    const codes = [...new Set(ALL.map(seasonOf).filter(Boolean))].sort().reverse();
    $('#wd-season').innerHTML = `<option value="all">${t('全部季節')}</option><option value="none">${t('非季節物品')}</option>` +
      codes.map(c => `<option value="${c}">${esc(D.seasonFull(c))}</option>`).join('');
    $('#wd-season').value = ui.season;
  }
  function renderGrid() {
    renderSlots();
    const items = list();
    $('#wd-count').textContent = t('{n} 件', { n: items.length });
    $('#wd-grid').innerHTML = items.map(i => {
      const s = seasonOf(i);
      return `<button type="button" class="wd-item" data-item="${esc(i.path)}" aria-pressed="${ui.item === i.path}">
        <span class="wd-icon"><img src="${esc(D.iconURL(i.path))}" alt="" loading="lazy" decoding="async"></span>
        <span class="wd-name">${esc(i.label)}</span>
        <span class="wd-meta">${ui.cat === 'all' && D.CAT_BY_ID[i.cat] ? `${esc(D.CAT_BY_ID[i.cat].zh)} · ` : ''}${s ? `AP${esc(s)}` : t('常駐')}${i.ult ? ` · ${t('畢業禮')}` : ''}${priceOf(i) ? ` · ${esc(priceOf(i))}` : ''}</span></button>`;
    }).join('') || `<p class="wd-empty">${t('找不到符合的物品，換個關鍵字試試。')}</p>`;
  }
  function renderDetail() {
    const i = ALL.find(x => x.path === ui.item);
    const box = $('#wd-detail');
    if (!i) { box.hidden = true; return; }
    const s = seasonOf(i);
    const rows = [
      [t('部位'), D.CAT_BY_ID[i.cat] ? D.CAT_BY_ID[i.cat].zh : i.cat],
      [t('季節'), s ? D.seasonFull(s) : t('常駐 / 非季節')],
      i.ult ? [t('取得'), t('季節畢業禮')] : null,
      i.pack ? [t('禮包'), i.pack + (priceOf(i) ? ' · ' + priceOf(i) : '')] : null,
    ].filter(Boolean);
    box.innerHTML = `<button type="button" class="wd-close" data-close aria-label="${t('關閉')}">×</button>
      <div class="wd-d-icon"><img src="${esc(D.iconURL(i.path))}" alt=""></div>
      <h2 class="wd-d-name">${esc(i.label)}</h2>
      <p class="wd-d-id mono">${esc(i.name)}</p>
      <dl class="wd-d-facts">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
      <div class="wd-d-acts">${s ? `<button type="button" class="btn btn-sm" data-season="${esc(s)}">${t('看同一季的物品')}</button>` : ''}${tryOnButton(i)}</div>
      ${lockHTML()}`;
    box.hidden = false;
    renderSide();
  }
  function renderSide() {
    $('#wd-side').hidden = $('#wd-stage').hidden && $('#wd-detail').hidden;
  }

  // ── 3D try-on ──────────────────────────────────────────────────────────────
  const pieceOf = name => (stage && stage.index.pieces[name]) || null;
  function tryOnButton(i) {
    if (!stage) return '';
    const p = pieceOf(i.name);
    if (!p || !p.file) return `<span class="wd-d-note">${t('這件沒有 3D 模型')}</span>`;
    return look.pieces[p.slot] === i.name && !REQUIRED.has(p.slot)
      ? `<button type="button" class="btn btn-sm" data-off="${esc(p.slot)}">${t('脫下')}</button>`
      : look.pieces[p.slot] === i.name ? '' : `<button type="button" class="btn btn-sm btn-primary" data-wear="${esc(i.name)}">${t('穿上')}</button>`;
  }
  // why there is no 3D, and what to do about it (only shown with an item open, so the page stays a plain catalogue)
  function lockHTML() {
    if (gate.ok || ['loading', 'off'].includes(gate.code)) return '';
    const who = gate.email ? `<b>${esc(gate.email)}</b>` : '';
    const btn = (act, label, primary) => `<button type="button" class="btn btn-sm${primary ? ' btn-primary' : ''}" data-g="${act}"${busyGate ? ' disabled' : ''}>${label}</button>`;
    const body = {
      signin: `<p>${t('3D 試穿目前只開放給站長開通的人。用 Google 登入並送出申請；或請站長把你的 Email 加進名單。')}</p>${btn('signin', t('用 Google 登入'), true)}`,
      apply: `<p>${t('這個帳號（{who}）還沒申請 3D 試穿。', { who })}</p>${btn('apply', t('送出申請'), true)}`,
      pending: `<p>${t('已送出申請（{who}），站長核准後按「重新檢查」就能用。', { who })}</p>${btn('retry', t('重新檢查'))}`,
      denied: `<p>${t('這個帳號（{who}）的申請沒有通過。', { who })}</p>`,
      noperm: `<p>${t('這個帳號（{who}）已核准，但還沒開通 3D 試穿。', { who })}</p>${btn('retry', t('重新檢查'))}`,
      offline: `<p>${t('連不到 Google 服務，暫時無法確認 3D 試穿的權限。')}</p>${btn('retry', t('再試一次'))}`,
      nowebgl: `<p>${t('這個瀏覽器顯示不了 3D。')}</p>`
    }[gate.code];
    return body ? `<div class="wd-lock"><p class="wd-lock-head">${t('3D 試穿')}</p>${body}</div>` : '';
  }
  const note = txt => { $('#wd-stage-note').textContent = txt || ''; };
  function defaultsLook() {
    const idx = stage.index, pieces = {};
    Object.entries(idx.defaults || {}).forEach(([sl, n]) => { if ((idx.pieces[n] || {}).file) pieces[sl] = n; });
    return { pieces, dyes: {}, clip: 'idle' };
  }
  function savedLook() {
    let l = null;
    try { l = JSON.parse(localStorage.getItem(LOOK_KEY)); } catch { /* private mode */ }
    if (!l || !l.pieces) return null;
    const base = defaultsLook();
    Object.entries(l.pieces).forEach(([sl, n]) => { const p = pieceOf(n); if (n === null && !REQUIRED.has(sl)) base.pieces[sl] = null; else if (p && p.file && p.slot === sl) base.pieces[sl] = n; });
    return base;
  }
  async function dress() {
    try { localStorage.setItem(LOOK_KEY, JSON.stringify(look)); } catch { /* private mode */ }
    renderWorn(); renderDetail();
    note(t('換裝中…'));
    const shown = await stage.wear(look);
    if (shown) note('');
  }
  function wearItem(name) {
    const p = pieceOf(name);
    if (!p || !p.file) return;
    look.pieces[p.slot] = name;
    dress();
  }
  function takeOff(slot) {
    look.pieces[slot] = REQUIRED.has(slot) ? defaultsLook().pieces[slot] || null : null;
    dress();
  }
  function renderWorn() {
    if (!stage) return;
    const def = defaultsLook().pieces;
    const worn = Object.entries(look.pieces).filter(([sl, n]) => n && n !== def[sl]);
    const byName = new Map(ALL.map(i => [i.name, i]));
    $('#wd-worn').innerHTML = `<p class="wd-worn-head">${t('身上穿的')}${worn.length ? `<button type="button" class="text-link" data-reset>${t('全部換回預設')}</button>` : ''}</p>
      ${worn.length ? `<div class="wd-worn-list">${worn.map(([sl, n]) => {
        const i = byName.get(n);
        return `<span class="wd-chip" title="${esc(i ? i.label : n)}">${i ? `<img src="${esc(D.iconURL(i.path))}" alt="">` : ''}<span>${esc(i ? i.label : n.replace('CharSkyKid_', ''))}</span><button type="button" data-off="${esc(sl)}" aria-label="${esc(t('脫下 {name}', { name: i ? i.label : n }))}">×</button></span>`;
      }).join('')}</div>` : `<p class="hint">${t('點一件物品就會穿上；拖曳角色可以轉動。')}</p>`}`;
  }
  async function startStage() {
    $('#wd-stage').hidden = false; renderSide();
    $('#wd-clips').innerHTML = CLIPS.map(([id, zh]) => `<button type="button" class="chip-btn" data-clip="${id}">${zh}</button>`).join('');
    note(t('3D 角色載入中…'));
    try {
      const m = await import(new URL('wardrobe-3d.js', HERE).href);
      stage = await m.mountStage($('#wd-canvas'));
    } catch (e) {
      console.warn('3D try-on', e);
      stage = null; gate = { code: 'nowebgl' }; $('#wd-stage').hidden = true; renderSide(); renderDetail();
      return;
    }
    look = savedLook() || defaultsLook();
    const i = ALL.find(x => x.path === ui.item);
    if (i && (pieceOf(i.name) || {}).file) look.pieces[pieceOf(i.name).slot] = i.name;   // an #item= link: wear it
    await dress();
  }
  async function checkGate() {
    if (!window.Access || !window.Access.enabled) { gate = { code: 'off' }; return; }
    gate = await window.Access.check('wardrobe3d');
    if (gate.ok && !stage) await startStage();
    renderDetail();
  }
  async function gateAct(kind) {
    busyGate = true; renderDetail();
    try {
      if (kind === 'signin') await window.Access.signIn();
      if (kind === 'apply') await window.Access.request();
    } catch (e) { console.warn('3D access', e); }
    busyGate = false;
    await checkGate();
  }
  function select(path, { scroll = false } = {}) {
    ui.item = path;
    history.replaceState(null, '', path ? '#item=' + encodeURIComponent(path.split('/').pop()) : location.pathname + location.search);
    document.querySelectorAll('.wd-item').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.item === path)));
    renderDetail();
    if (scroll && path) $(stage ? '#wd-side' : '#wd-detail').scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cat) { ui.cat = b.dataset.cat; if (ui.cat !== 'all') ui.tab = ui.cat; ui.item = null; renderGrid(); select(null); return; }
    if (b.dataset.item) {
      const again = ui.item === b.dataset.item;
      select(again ? null : b.dataset.item, { scroll: matchMedia('(max-width: 900px)').matches });
      const i = !again && stage && ALL.find(x => x.path === b.dataset.item);
      if (i && (pieceOf(i.name) || {}).file) wearItem(i.name);
      return;
    }
    if (b.dataset.season) { ui.season = b.dataset.season; $('#wd-season').value = ui.season; ui.q = ''; $('#wd-q').value = ''; if (ui.cat === 'all') ui.cat = ui.tab; renderGrid(); return; }
    if (b.hasAttribute('data-close')) { select(null); return; }
    if (b.dataset.g) { if (!busyGate) gateAct(b.dataset.g); return; }
    if (!stage) return;
    if (b.dataset.wear) { wearItem(b.dataset.wear); return; }
    if (b.dataset.off) { takeOff(b.dataset.off); return; }
    if (b.dataset.clip) { stage.play(b.dataset.clip); return; }
    if (b.hasAttribute('data-reset')) { look = defaultsLook(); dress(); }
  });
  let qT = 0;
  $('#wd-q').addEventListener('input', e => {
    clearTimeout(qT);
    qT = setTimeout(() => {
      const was = !!query();
      ui.q = e.target.value;
      if (query() && !was) ui.cat = 'all';          // a new search looks in every tab
      if (!query() && ui.cat === 'all') ui.cat = ui.tab;
      renderGrid();
    }, 150);
  });
  $('#wd-season').addEventListener('change', e => { ui.season = e.target.value; renderGrid(); });
  $('#wd-sort').addEventListener('change', e => { ui.sort = e.target.value; renderGrid(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && ui.item) select(null); });

  // the detail panel sticks just under the filter bar, whose height changes with the tabs wrapping
  const bar = document.querySelector('.wd-bar');
  if (bar && window.ResizeObserver) new ResizeObserver(() => document.documentElement.style.setProperty('--wd-bar-h', bar.offsetHeight + 'px')).observe(bar);

  D.loadCatalog().then(catalog => {
    // season pendants are their own group for the card editor ("pass"); in the closet they are necklaces
    ALL = catalog.map(i => (i.cat === 'pass' ? Object.assign({}, i, { cat: 'neck' }) : i)).filter(i => CATS.includes(i.cat));
    renderSeasons();
    const m = location.hash.match(/item=([^&]+)/);
    if (m) {
      let name = '';
      try { name = decodeURIComponent(m[1]); } catch { /* a mangled link: just show the catalogue */ }
      const hit = ALL.find(i => i.name === name);
      if (hit) { ui.cat = ui.tab = hit.cat; ui.item = hit.path; }
    } else if (/look=/.test(location.hash)) {
      const bn = $('#wd-banner');
      bn.innerHTML = t('舊版的造型連結已經不能打開了。想看自己的角色，請到 <a href="{href}">身高</a> 頁上傳服裝 QR。', { href: 'height.html' });
      bn.hidden = false;
      history.replaceState(null, '', location.pathname + location.search);
    }
    renderGrid(); renderDetail();
    window.__wardrobeReady = true;
    checkGate();
  }).catch(err => {
    console.error(err);
    $('#wd-grid').innerHTML = `<p class="wd-empty">${t('圖鑑載入失敗，請重新整理再試一次。')}</p>`;
  });
})();
