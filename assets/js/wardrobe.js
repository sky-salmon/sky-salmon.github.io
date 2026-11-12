/* candle·kit — wardrobe (wardrobe.html): a catalogue of every closet item, by slot and season.
 * Data: assets/icons/icons.csv with data/ (seasons, item corrections, paid packs) applied by card-data.js.
 * An item can be linked to directly with #item=<name>. Seeing your own kid dressed up lives on the height page
 * (upload the outfit QR there). */
(() => {
  const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
  const D = window.CardData;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const CATS = D.CLOSET_CATS.filter(c => D.CAT_BY_ID[c]);
  const ui = { cat: CATS[0], q: '', season: 'all', sort: 'closet', item: null };
  let ALL = [];

  const seasonOf = i => i.season || null;
  const priceOf = i => (i.usd && i.usd !== '?' ? 'US$' + i.usd : '');
  function list() {
    const q = ui.q.trim().toLowerCase();
    const out = ALL.filter(i => {
      if (i.cat !== ui.cat) return false;
      const s = seasonOf(i);
      if (ui.season === 'none' ? s : (ui.season !== 'all' && s !== ui.season)) return false;
      return !q || [i.label, i.name, s ? D.seasonFull(s) : '', i.pack || ''].join(' ').toLowerCase().includes(q);
    });
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
    $('#wd-slots').innerHTML = CATS.map(c => {
      const n = ALL.filter(i => i.cat === c).length;
      return n ? `<button type="button" role="tab" class="wd-slot" data-cat="${c}" aria-selected="${c === ui.cat}">${esc(D.CAT_BY_ID[c].zh)}<small>${n}</small></button>` : '';
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
        <span class="wd-meta">${s ? `AP${esc(s)}` : t('常駐')}${i.ult ? ` · ${t('畢業禮')}` : ''}${priceOf(i) ? ` · ${esc(priceOf(i))}` : ''}</span></button>`;
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
      ${s ? `<button type="button" class="btn btn-sm" data-season="${esc(s)}">${t('看同一季的物品')}</button>` : ''}`;
    box.hidden = false;
  }
  function select(path, { scroll = false } = {}) {
    ui.item = path;
    history.replaceState(null, '', path ? '#item=' + encodeURIComponent(path.split('/').pop()) : location.pathname + location.search);
    document.querySelectorAll('.wd-item').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.item === path)));
    renderDetail();
    if (scroll && path) $('#wd-detail').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.cat) { ui.cat = b.dataset.cat; ui.item = null; renderGrid(); select(null); return; }
    if (b.dataset.item) { select(ui.item === b.dataset.item ? null : b.dataset.item, { scroll: matchMedia('(max-width: 900px)').matches }); return; }
    if (b.dataset.season) { ui.season = b.dataset.season; $('#wd-season').value = ui.season; ui.q = ''; $('#wd-q').value = ''; renderGrid(); return; }
    if (b.hasAttribute('data-close')) select(null);
  });
  let qT = 0;
  $('#wd-q').addEventListener('input', e => { clearTimeout(qT); qT = setTimeout(() => { ui.q = e.target.value; renderGrid(); }, 150); });
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
      if (hit) { ui.cat = hit.cat; ui.item = hit.path; }
    } else if (/look=/.test(location.hash)) {
      const bn = $('#wd-banner');
      bn.innerHTML = t('3D 試穿已經移除，這個造型連結無法再打開。想看自己的角色，請到 <a href="{href}">身高</a> 頁上傳服裝 QR。', { href: 'height.html' });
      bn.hidden = false;
      history.replaceState(null, '', location.pathname + location.search);
    }
    renderGrid(); renderDetail();
    window.__wardrobeReady = true;
  }).catch(err => {
    console.error(err);
    $('#wd-grid').innerHTML = `<p class="wd-empty">${t('圖鑑載入失敗，請重新整理再試一次。')}</p>`;
  });
})();
