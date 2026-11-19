// Account value estimate (beta) for the card maker. Reads the seasons, ultimate gifts and paid packs already on the
// card, asks the few things a card can't show (binding, refunds, height) and prices it with data/value-model.json.
// The model is anchored on asking prices from public trading groups; see the file's "_about" and "basis".
(function () {
  'use strict';
  const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
  const D = window.CardData;
  const $ = s => document.querySelector(s);
  const KEY = 'candle.card.value';
  const CUR = { TWD: 'NT$', CNY: 'RMB ', MYR: 'RM', HKD: 'HK$' };
  const TIER_RANK = { C: 0, B: 1, A: 2, S: 3 };
  // looked up by value below, listed here for the translation build:
  // t('無斷') t('偽無斷') t('微斷') t('斷季') t('大斷') t('簡號') t('綁定全可換') t('1 個綁定不能出') t('2 個以上綁定不能出')
  // t('五週年斗') t('小白花')
  // t('傘') t('篝火') t('白鳥') t('耳墜') t('阿努') t('不死鳥') t('玫瑰') t('羽毛') t('白梟') t('眼鏡')

  let model = null, modelP = null, items = null, timer = 0;
  const answers = Object.assign({ fake: false, binding: 'unknown', dirty: false, cur: 'TWD' }, read());

  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
  function write() { try { localStorage.setItem(KEY, JSON.stringify(answers)); } catch { /* private mode */ } }
  function loadModel() {
    if (!modelP) modelP = fetch('data/value-model.json', { cache: 'no-cache' }).then(r => (r.ok ? r.json() : null))
      .then(m => (model = m)).catch(() => null);
    return modelP;
  }

  // what the card says about the account
  function analyse(cardItems) {
    const seasons = new Set(), ults = new Set(), names = new Set();
    const packOf = new Map();
    D.packs().forEach(p => p.items.forEach(path => {
      const tier = model.pack_tiers[p.id] || 'C', cur = packOf.get(path);
      // an item sold in several packs (re-releases): assume the commonest one
      if (!cur || TIER_RANK[tier] < TIER_RANK[cur.tier]) packOf.set(path, { id: p.id, usd: p.usd, tier });
    }));
    const packs = new Map();
    Object.values(cardItems || {}).forEach(list => (list || []).forEach(it => {
      if (it.k !== 'c' || !it.p) return;
      const i = D.parsePath(it.p);
      if (i.season && (i.cat === 'pass' || i.ult)) seasons.add(i.season);
      if (i.ult) ults.add(i.name);
      names.add(i.name);
      const p = packOf.get(it.p);
      if (p) packs.set(p.id, p);
    }));
    const badges = ((cardItems || {}).pin || []).length;   // 徽章 (traders call them 數據)
    return { seasons, ults, names, badges, packs: [...packs.values()] };
  }

  // best reading of the season history, the way a seller would title it ("歐若拉偽無斷", "聖島微斷", ...)
  function history(seasons) {
    const B = model.base, codes = Object.keys(B).sort(), cur = model.current_season;
    const owned = codes.filter(c => seasons.has(c));
    if (!owned.length) return null;
    const need = s => codes.filter(c => c >= s && c < cur);   // the running season may not be on the card yet
    let best = null, title = null;
    const offer = (value, start, kind, missing, older) => {
      if (!best || value > best.value) best = { value, start, kind, missing, older };
    };
    owned.forEach(s => {
      const span = need(s), miss = span.filter(c => !seasons.has(c)).length;
      let kind = null;
      if (!miss) kind = '無斷';
      else if (answers.fake && miss <= Math.max(2, span.length * 0.3)) kind = '偽無斷';
      else if (miss <= 2) kind = '微斷';
      else if (miss <= Math.max(2, span.length * 0.3)) kind = '斷季';
      if (kind) {
        offer(B[s] * model.streak[kind], s, kind, miss, 0);
        if (!title) title = { start: s, kind, missing: miss, older: 0 };   // sellers name the account from its oldest season
      }
    });
    // an unbroken run up to now, plus older seasons owned before it
    let run = null;
    for (let i = codes.indexOf(cur) - 1; i >= 0 && seasons.has(codes[i]); i--) run = codes[i];
    if (run) {
      const older = owned.filter(c => c < run);
      const extra = older.reduce((a, c) => {
        const next = codes[codes.indexOf(c) + 1];
        return a + model.older_season_share * Math.max(0, B[c] - (B[next] || 0));
      }, 0);
      offer(B[run] * model.streak['無斷'] + extra, run, '無斷', 0, older.length);
    }
    if (!best) {  // scattered seasons: a thin old account (簡號) or a mostly broken one, from the oldest season
      const s = owned[0], span = need(s), miss = span.filter(c => !seasons.has(c)).length;
      const kind = span.length && (span.length - miss) / span.length < 0.3 ? '簡號' : '大斷';
      offer(B[s] * model.streak[kind], s, kind, miss, 0);
    }
    // the price takes the best reading; the label keeps the seller's way of naming it when there is one
    return title ? Object.assign({}, best, title) : best;
  }

  function estimate(cardItems) {
    const a = analyse(cardItems), h = history(a.seasons);
    if (!h) return { empty: true };
    const hot = [...a.ults].map(n => model.hot_ultimates[n]).filter(Boolean)
      .sort((x, y) => (x.season || '').localeCompare(y.season || ''));
    const ultVal = hot.reduce((v, u) => v + u.twd, 0);        // traders price these as items of their own
    const items = [...a.names].map(n => (model.hot_items || {})[n]).filter(Boolean);
    const itemVal = items.reduce((v, u) => v + u.twd, 0);
    const badgeVal = a.badges * (model.badge_twd || 0);
    const tierCount = { S: 0, A: 0, B: 0, C: 0 };
    const packVal = a.packs.reduce((v, p) => { tierCount[p.tier]++; return v + model.pack_value[p.tier]; }, 0);
    let mult = model.binding[answers.binding] || 1;
    if (answers.dirty) mult *= model.dirty;
    const center = (h.value + ultVal + itemVal + badgeVal + packVal) * mult;   // TWD, Taiwan market; money() converts
    const near = model.comparables.filter(c => Math.abs(+c.start - +h.start) <= 2);
    const rg = model.range || { low: 0.75, high: 1.3 };
    return { h, hot, ultVal, items, itemVal, badges: a.badges, badgeVal, tierCount, packVal, mult, center,
      rangeLow: center * rg.low, rangeHigh: center * rg.high,          // where half of real asks for such accounts fall
      quick: center * model.spread.low, patient: center * model.spread.high, near, nSeasons: a.seasons.size };
  }

  function money(twd) {
    const cur = answers.cur, v = twd * ((model.market || {})[cur] || 1) / (model.fx[cur] || 1);
    const step = cur === 'TWD' ? 100 : 10;
    return CUR[cur] + (Math.round(v / step) * step).toLocaleString('en-US');
  }
  const seasonName = c => (D.seasonName ? D.seasonName(c) : c);

  function render() {
    const pane = $('#pane-value');
    if (!pane || !model || !items) return;
    const e = estimate(items);
    const range = $('#val-range'), why = $('#val-why'), basis = $('#val-basis');
    $('#val-fake-row').hidden = e.empty || !e.h.missing;
    if (e.empty) {
      range.innerHTML = `<span class="val-empty">${t('先在名片的 PASS 區加入季卡和畢業禮，就能估價。')}</span>`;
      why.innerHTML = ''; basis.textContent = '';
      return;
    }
    range.innerHTML = `<small class="val-cap">${t('常見行情')}</small><span class="val-band">${money(e.rangeLow)}<span class="val-dash" aria-hidden="true">–</span>${money(e.rangeHigh)}</span>
      <span class="val-points"><span class="val-pt"><small>${t('快出價')}</small><b>${money(e.quick)}</b></span><span class="val-pt is-hi"><small>${t('耐心價')}</small><b>${money(e.patient)}</b></span></span>`;
    const h = e.h, lines = [];
    const kind = h.kind === '無斷' && h.older ? t('{season}起無斷，另有 {n} 個更早的季節', { season: seasonName(h.start), n: h.older })
      : h.missing ? t('{season}起{kind}（缺 {n} 季）', { season: seasonName(h.start), kind: t(h.kind), n: h.missing })
        : t('{season}起{kind}', { season: seasonName(h.start), kind: t(h.kind) });
    lines.push([t('季節'), kind, '']);
    if (e.hot.length) lines.push([t('老畢業禮'), e.hot.map(u => t(u.nick)).join('、'), '+' + money(e.ultVal)]);
    if (e.items.length) lines.push([t('熱門物品'), e.items.map(u => t(u.nick)).join('、'), '+' + money(e.itemVal)]);
    if (e.badges) lines.push([t('徽章'), t('{n} 個', { n: e.badges }), '+' + money(e.badgeVal)]);
    const tc = e.tierCount, nPacks = tc.S + tc.A + tc.B + tc.C;
    if (nPacks) lines.push([t('禮包'), t('絕版 {s}・少見 {ab}・常見 {c}', { s: tc.S, ab: tc.A + tc.B, c: tc.C }), '+' + money(e.packVal)]);
    const adj = [];
    if (answers.binding !== 'unknown') adj.push(t({ all_free: '綁定全可換', one_locked: '1 個綁定不能出', more_locked: '2 個以上綁定不能出' }[answers.binding]));
    if (answers.dirty) adj.push(t('刷退或髒號'));
    if (adj.length) lines.push([t('調整'), adj.join('、'), '×' + e.mult.toFixed(2)]);
    why.innerHTML = lines.map(([k, v, x]) => `<li><span class="k">${k}</span><span class="v">${v}</span><span class="x mono">${x}</span></li>`).join('');
    const n = e.near.length, level = n >= 5 ? t('中') : n >= 2 ? t('偏低') : t('很低');
    const err = Math.round((model.typical_error || 0.35) * 100);
    let txt = t('可信度：{level}。相近起點的參考貼文 {n} 筆（{from}～{to}，公開社團）。同類帳號的實際開價常差 ±{err}%：衣櫃、徽章、蠟燭這些名片外的東西影響很大。', {
      level, n, from: model.basis.from, to: model.basis.to, err });
    if (h.start >= '16' && h.start <= '24') txt += ' ' + t('這段季節起的號，模型平均估得偏低約一成半，可以往常見行情的上緣看。');
    basis.textContent = txt;
  }

  function refresh(cardItems) {
    items = cardItems;
    clearTimeout(timer);
    timer = setTimeout(() => loadModel().then(() => D.loadCatalog()).then(render).catch(() => {}), 120);
  }

  function wire() {
    const fake = $('#val-fake'), bind = $('#val-binding'), dirty = $('#val-dirty'), cur = $('#val-cur');
    if (!fake) return;
    fake.checked = answers.fake; bind.value = answers.binding; dirty.checked = answers.dirty; cur.value = answers.cur;
    const on = () => {
      Object.assign(answers, { fake: fake.checked, binding: bind.value, dirty: dirty.checked, cur: cur.value });
      write(); render();
    };
    [fake, bind, dirty, cur].forEach(el => el.addEventListener('change', on));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  window.CardValue = { refresh, estimate: c => (model ? estimate(c) : null), loadModel };
})();
