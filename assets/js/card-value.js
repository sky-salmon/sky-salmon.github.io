// Account value estimate (beta) for the card maker. Reads the seasons, ultimate gifts and paid packs already on the
// card, asks the few things a card can't show (binding, refunds) and prices it with the value model.
// The model is a restricted feature: it lives in Firestore gated/value, readable by admins, by accounts an admin
// approved for "value" (admin.html → 權限), or by everyone if the admins open the feature (firebase/firestore.rules).
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
  // t('（第一季是半季，有{item}）') t('（第一季是半季，沒有{item}）')
  // t('傘') t('篝火') t('白鳥') t('耳墜') t('阿努') t('不死鳥') t('玫瑰') t('羽毛') t('白梟') t('眼鏡')

  // how close the model came on accounts it had not seen (leave-one-out over the posts it was fitted on), for models
  // uploaded before they carried their own `accuracy`. in_range: share of asking prices inside the 常見行情 band.
  const ACCURACY = {
    '0.4': { n: 85, in_range: 0.49, within30: 0.53, median_miss: 0.25, segments: [
      { from: '00', to: '06', n: 15, in_range: 0.67, bias: -0.01 }, { from: '07', to: '15', n: 34, in_range: 0.53, bias: -0.07 },
      { from: '16', to: '24', n: 15, in_range: 0.33, bias: 0.14 }, { from: '25', to: '99', n: 21, in_range: 0.43, bias: 0.03 }] }
  };
  const SG_KEY = 'candle.card.value.sent';
  let model = null, modelP = null, items = null, profileCur = null, timer = 0, gate = null, busy = false, last = null;
  const answers = Object.assign({ fake: false, half: false, binding: 'unknown', dirty: false, cur: 'TWD' }, read());

  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } }
  function write() { try { localStorage.setItem(KEY, JSON.stringify(answers)); } catch { /* private mode */ } }
  const fail = (code, email) => Object.assign(new Error(code), { code, email });
  function loadModel() {
    if (model) return Promise.resolve(model);
    if (!modelP) modelP = (async () => {
      const C = window.Cloud;
      if (!C || !C.account) throw fail('offline');
      const { fb, db, user } = await C.account();
      try {
        const snap = await fb.getDoc(fb.doc(db, 'gated', 'value'));
        if (!snap.exists()) throw fail('missing');
        model = JSON.parse(snap.data().data); gate = null;
        return model;
      } catch (e) {
        if (e.code !== 'permission-denied') throw e.code ? e : fail('offline');
        if (!user) throw fail('signin');
        const a = await C.accessStatus();
        throw fail(!a ? 'apply' : a.status === 'denied' ? 'denied' : a.status === 'approved' ? 'noperm' : 'pending', user.email);
      }
    })().catch(e => { modelP = null; gate = { code: ['signin', 'apply', 'pending', 'denied', 'noperm', 'missing'].includes(e.code) ? e.code : 'offline', email: e.email || '' }; throw e; });
    return modelP;
  }
  // what to show instead of the estimate, by where this visitor stands
  function renderGate() {
    const g = $('#val-gate'), code = gate ? gate.code : 'loading', who = gate && gate.email ? `<b>${esc(gate.email)}</b>` : '';
    const btn = (act, label, primary) => `<button type="button" class="btn${primary ? ' btn-primary' : ''} btn-sm" data-val="${act}"${busy ? ' disabled' : ''}>${label}</button>`;
    const html = {
      loading: `<p class="hint">${t('載入中…')}</p>`,
      offline: `<p>${t('連不到 Google 服務，估價暫時不能用。')}</p>${btn('retry', t('再試一次'))}`,
      signin: `<p>${t('估價是需要站長核准的功能。用 Google 登入並送出申請，核准後就能使用。')}</p>${btn('signin', t('用 Google 登入'), true)}
        <p class="hint">${t('登入後名片也會同步到雲端；站長會看到你的 Email，用來核准。')}</p>`,
      apply: `<p>${t('這個帳號（{who}）還沒申請估價功能。', { who })}</p>${btn('apply', t('送出申請'), true)}`,
      pending: `<p>${t('已送出申請（{who}），等站長核准。核准後按「重新檢查」就能使用。', { who })}</p>${btn('retry', t('重新檢查'))}`,
      denied: `<p>${t('這個帳號（{who}）的申請沒有通過。', { who })}</p>`,
      noperm: `<p>${t('這個帳號（{who}）已核准，但還沒開通估價功能。', { who })}</p>${btn('retry', t('重新檢查'))}`,
      missing: `<p>${t('估價資料還沒上傳。')}</p>`,
    }[code];
    g.innerHTML = `<div class="val-lock"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="4" y="9" width="12" height="8.5" rx="2"/><path d="M7 9V6.5a3 3 0 0 1 6 0V9"/></svg></div>${html}`;
    g.hidden = false; $('#val-body').hidden = true;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // what the card says about the account
  function analyse(cardItems) {
    const seasons = new Set(), grad = new Set(), ults = new Set(), names = new Set();
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
      if (i.ult) { ults.add(i.name); if (i.season) grad.add(i.season); }
      names.add(i.name);
      const p = packOf.get(it.p);
      if (p) packs.set(p.id, p);
    }));
    const badges = ((cardItems || {}).pin || []).length;   // 徽章 (traders call them 數據)
    return { seasons, grad, ults, names, badges, packs: [...packs.values()] };
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

  // v0.5 models (form "coverage"): the start season sets the level, and how much of the run since then is held moves
  // it smoothly, so every season counts and nothing jumps. A season is graduated when one of its ultimate gifts is on
  // the card; the first season can be marked as joined halfway. The best of all owned starts wins (adding a season can
  // only raise it).
  function coverageSeasons(a) {
    const B = model.base, codes = Object.keys(B).sort(), cur = model.current_season, cv = model.coverage;
    const owned = codes.filter(c => a.seasons.has(c));
    if (!owned.length) return null;
    const first = owned[0], fin = codes.filter(c => c < cur);
    const state = c => (!a.seasons.has(c) ? null : answers.half && c === first ? 'h' : a.grad.has(c) ? 'g' : 'p');
    const held = c => (state(c) ? 1 : answers.fake ? model.fake_presence : 0);
    // a first season joined halfway is worth what its sought-after ultimate says (魔法 → 耳墜, 預言 → 阿努, 小王子 → 玫瑰 …):
    // with it, a little under the whole season; without it, most of the way down to the next start; no such item: halfway
    const HW = model.half || { with_hot_level: 0.9, without_hot_gap: 0.25, no_hot_gap: model.half_weight || 0.5 };
    const hotOf = c => Object.entries(model.hot_ultimates).filter(([, v]) => v.season === c);
    const halfInfo = c => { const h = hotOf(c); return { nick: h.length ? h[0][1].nick : '', has: h.some(([k]) => a.ults.has(k)) }; };
    const halfLevel = (t, nxt) => {
      const gap = w => B[nxt] + w * (B[t] - B[nxt]), hi = halfInfo(t);
      return !hi.nick ? gap(HW.no_hot_gap) : hi.has ? Math.max(gap(HW.without_hot_gap), B[t] * HW.with_hot_level) : gap(HW.without_hot_gap);
    };
    let best = null;
    owned.forEach(t => {
      const span = fin.filter(c => c >= t);
      if (!span.length) return;
      const cov = span.reduce((n, c) => n + held(c), 0) / span.length, grads = span.filter(c => a.grad.has(c)).length;   // a half first season can still be graduated
      const nxt = codes[Math.min(codes.indexOf(t) + 1, codes.length - 1)];
      const level = state(t) === 'h' ? halfLevel(t, nxt) : B[t];
      const value = level * (cv.lo + (cv.hi - cv.lo) * Math.pow(cov, cv.k)) * (1 + model.grad_bonus * grads / span.length);
      if (!best || value > best.value) best = { value, start: t, cov, grads, span: span.length, missing: span.filter(c => !state(c)).length };
    });
    if (!best) best = { value: B[first] * cv.lo, start: first, cov: 0, grads: 0, span: 0, missing: 0 };   // only the running season
    best.kind = !best.missing ? '無斷' : answers.fake ? '偽無斷' : best.missing <= 2 ? '微斷' : best.cov >= 0.7 ? '斷季' : best.cov >= 0.3 ? '大斷' : '簡號';
    best.older = owned.filter(c => c < best.start).length;
    best.half = answers.half && best.start === first ? halfInfo(first) : null;
    return best;
  }
  // candles typed on the card: 5800, 5,800, 5.8k, 1.2萬 / 1.2w
  const countOf = v => {
    const m = String(v || '').replace(/[,\s+]/g, '').match(/^(\d+(?:\.\d+)?)([kKwW萬]?)$/);
    return m ? Math.round(parseFloat(m[1]) * ({ k: 1e3, K: 1e3, w: 1e4, W: 1e4, 萬: 1e4 }[m[2]] || 1)) : 0;
  };

  function estimate(cardItems) {
    const a = analyse(cardItems), cover = model.form === 'coverage', h = cover ? coverageSeasons(a) : history(a.seasons);
    if (!h) return { empty: true };
    const hot = [...a.ults].map(n => model.hot_ultimates[n]).filter(Boolean)
      .sort((x, y) => (x.season || '').localeCompare(y.season || ''));
    // traders price these as items of their own; a half first season's own item counts a little less (like its level)
    const halfCut = h.half && h.half.has ? ((model.half || {}).with_hot_level || 1) : 1;
    const ultVal = hot.reduce((v, u) => v + u.twd * (u.season === h.start && halfCut < 1 ? halfCut : 1), 0);
    const items = [...a.names].map(n => (model.hot_items || {})[n]).filter(Boolean);
    const itemVal = items.reduce((v, u) => v + u.twd, 0);
    const badgeVal = a.badges * (model.badge_twd || 0);
    const tierCount = { S: 0, A: 0, B: 0, C: 0 };
    const packVal = a.packs.reduce((v, p) => { tierCount[p.tier]++; return v + model.pack_value[p.tier]; }, 0);
    let mult = model.binding[answers.binding] || 1;
    if (answers.dirty) mult *= model.dirty;
    const candles = cover ? countOf((profileCur || {}).candle) : 0;            // 0 = not filled in: a typical count
    const candleVal = cover ? Math.min(candles || model.candle_default, model.candle_cap) * model.candle_twd : 0;
    const center = (h.value + ultVal + itemVal + badgeVal + packVal + candleVal) * mult;   // TWD, Taiwan market; money() converts
    const near = model.comparables.filter(c => Math.abs(+c.start - +h.start) <= 2);
    const rg = model.range || { low: 0.75, high: 1.3 };
    return { h, cover, hot, ultVal, items, itemVal, badges: a.badges, badgeVal, tierCount, packVal, candles, candleVal, mult, center,
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
    if (!pane || !items) return;
    if (!model) { renderGate(); return; }
    $('#val-gate').hidden = true; $('#val-body').hidden = false;
    const e = estimate(items);
    const range = $('#val-range'), why = $('#val-why'), basis = $('#val-basis');
    $('#val-fake-row').hidden = e.empty || !e.h.missing;
    $('#val-half-row').hidden = e.empty || !e.cover;
    if (e.empty) {
      range.innerHTML = `<span class="val-empty">${t('先在名片的 PASS 區加入季卡和畢業禮，就能估價。')}</span>`;
      why.innerHTML = ''; basis.textContent = ''; $('#val-acc').hidden = true; $('#val-sg').hidden = true; last = null;
      return;
    }
    range.innerHTML = `<small class="val-cap">${t('常見行情')}</small><span class="val-band">${money(e.rangeLow)}<span class="val-dash" aria-hidden="true">–</span>${money(e.rangeHigh)}</span>
      <span class="val-points"><span class="val-pt"><small>${t('快出價')}</small><b>${money(e.quick)}</b></span><span class="val-pt is-hi"><small>${t('耐心價')}</small><b>${money(e.patient)}</b></span></span>`;
    const h = e.h, lines = [];
    const kind = h.kind === '無斷' && h.older ? t('{season}起無斷，另有 {n} 個更早的季節', { season: seasonName(h.start), n: h.older })
      : h.missing ? t('{season}起{kind}（缺 {n} 季）', { season: seasonName(h.start), kind: t(h.kind), n: h.missing })
        : t('{season}起{kind}', { season: seasonName(h.start), kind: t(h.kind) });
    const half = !h.half ? '' : !h.half.nick ? t('（第一季是半季）')
      : t(h.half.has ? '（第一季是半季，有{item}）' : '（第一季是半季，沒有{item}）', { item: t(h.half.nick) });
    lines.push([t('季節'), kind + half, '']);
    if (e.cover && h.span) lines.push([t('畢業'), t('{g} / {n} 季', { g: h.grads, n: h.span }), '']);
    if (e.hot.length) lines.push([t('老畢業禮'), e.hot.map(u => t(u.nick)).join('、'), '+' + money(e.ultVal)]);
    if (e.items.length) lines.push([t('熱門物品'), e.items.map(u => t(u.nick)).join('、'), '+' + money(e.itemVal)]);
    if (e.badges) lines.push([t('徽章'), t('{n} 個', { n: e.badges }), '+' + money(e.badgeVal)]);
    if (e.candles) lines.push([t('蠟燭'), t('{n} 根', { n: e.candles.toLocaleString('en-US') }), '+' + money(e.candleVal)]);
    const tc = e.tierCount, nPacks = tc.S + tc.A + tc.B + tc.C;
    if (nPacks) lines.push([t('禮包'), t('絕版 {s}・少見 {ab}・常見 {c}', { s: tc.S, ab: tc.A + tc.B, c: tc.C }), '+' + money(e.packVal)]);
    const adj = [];
    if (answers.binding !== 'unknown') adj.push(t({ all_free: '綁定全可換', one_locked: '1 個綁定不能出', more_locked: '2 個以上綁定不能出' }[answers.binding]));
    if (answers.dirty) adj.push(t('刷退或髒號'));
    if (adj.length) lines.push([t('調整'), adj.join('、'), '×' + e.mult.toFixed(2)]);
    why.innerHTML = lines.map(([k, v, x]) => `<li><span class="k">${k}</span><span class="v">${v}</span><span class="x mono">${x}</span></li>`).join('');
    const n = e.near.length, level = n >= 5 ? t('中') : n >= 2 ? t('偏低') : t('很低');
    basis.textContent = t('可信度：{level}。相近起點的參考貼文 {n} 筆（{from}～{to}，公開社團）。衣櫃、蠟燭和名片上沒放的東西都會讓實際價格差很多。', {
      level, n, from: model.basis.from, to: model.basis.to }) + (!h.half ? '' : ' ' + (h.half.nick
      ? t('半季看有沒有拿到當季的熱門畢業禮：有的話比整季便宜一點，沒有就接近從下一季起算。折多少還沒有足夠的成交資料。')
      : t('這季沒有特別熱門的畢業禮，半季先算在「從這季起」和「從下一季起」的正中間。')));
    renderAccuracy(h.start);
    last = e; $('#val-sg').hidden = false;
    $('#val-sg-cur').textContent = CUR[answers.cur].trim();
  }
  const pct = x => Math.round(x * 100) + '%';
  function renderAccuracy(start) {
    const A = model.accuracy || ACCURACY[model.version], box = $('#val-acc');
    if (!A) { box.hidden = true; return; }
    const seg = (A.segments || []).find(g => start >= g.from && start <= g.to);
    const segName = seg && (seg.from <= '02' ? t('{to}以前起', { to: seasonName(seg.to) }) : seg.to >= '90' ? t('{from}以後起', { from: seasonName(seg.from) })
      : t('{from}～{to}起', { from: seasonName(seg.from), to: seasonName(seg.to) }));
    const lean = !seg ? '' : seg.bias > 0.05 ? t('實際開價平均比估價高約 {p}，可以往上緣看。', { p: pct(seg.bias) })
      : seg.bias < -0.05 ? t('實際開價平均比估價低約 {p}。', { p: pct(-seg.bias) }) : t('沒有明顯估高或估低。');
    box.hidden = false;
    box.innerHTML = `<p class="val-acc-head">${t('準度參考')}<span class="hint">${t('v{v}・用 {n} 筆真實開價回測', { v: esc(model.version), n: A.n })}</span></p>
      <div class="val-acc-grid">
        <div><b>${pct(A.in_range)}</b><small>${t('開價落在常見行情內')}</small></div>
        <div><b>${pct(A.within30)}</b><small>${t('誤差在 ±30% 內')}</small></div>
        <div><b>±${pct(A.median_miss)}</b><small>${t('一般誤差（中位數）')}</small></div>
      </div>
      ${seg ? `<p class="hint">${t('你這類帳號（{name}，{n} 筆）：{p} 落在常見行情內。', { name: segName, n: seg.n, p: pct(seg.in_range) })}${lean}</p>` : ''}`;
  }

  // ── "你認為值多少": a suggested price, with what the estimate saw, for refitting item values later ──
  function snapshot() {
    const a = analyse(items), h = last.h, names = new Set();
    Object.entries(items || {}).forEach(([sec, list]) => (list || []).forEach(it => { if (it.k === 'c' && it.p && sec !== 'spells') names.add(D.parsePath(it.p).name); }));
    const cur = {};
    ['candle', 'ascended', 'heart', 'seasonCandle', 'seasonHeart', 'ticket'].forEach(k => { cur[k] = String((profileCur || {})[k] || '').slice(0, 12); });
    return { start: h.start, kind: h.kind, missing: h.missing || 0, older: h.older || 0, seasons: [...a.seasons].sort().slice(0, 80),
      ults: [...a.ults].slice(0, 200), items: [...names].slice(0, 3000), packs: a.packs.map(p => p.id).slice(0, 600), badges: a.badges,
      currency: cur, binding: answers.binding, fake: !!answers.fake, half: !!answers.half, dirty: !!answers.dirty };
  }
  const toTwd = (v, cur) => v / ((model.market || {})[cur] || 1) * (model.fx[cur] || 1);
  async function sendSuggestion(ev) {
    ev.preventDefault();
    const msg = $('#val-sg-msg'), btn = $('#val-sg-send'), raw = $('#val-sg-price').value.replace(/[^\d.]/g, ''), price = Math.round(parseFloat(raw));
    if (!model || !last || last.empty) return;
    if (!(price > 0 && price < 10000000)) { msg.textContent = t('請填一個數字，例如 6500。'); $('#val-sg-price').focus(); return; }
    let sent = {}; try { sent = JSON.parse(localStorage.getItem(SG_KEY)) || {}; } catch { /* private mode */ }
    if (sent.at && Date.now() - sent.at < 60000) { msg.textContent = t('剛送過一筆，等一分鐘再送。'); return; }
    btn.disabled = true; msg.textContent = t('送出中…');
    try {
      const { fb, db, user } = await window.Cloud.account();
      const e = last, r = n => Math.round(n);
      await fb.setDoc(fb.doc(fb.collection(db, 'valueSuggestions')), {   // auto id (the bundled SDK has no addDoc)
        model: String(model.version), cur: answers.cur, price, priceTwd: r(toTwd(price, answers.cur)),
        est: { center: r(e.center), low: r(e.rangeLow), high: r(e.rangeHigh), quick: r(e.quick), patient: r(e.patient) },
        source: $('#val-sg-source').value, note: $('#val-sg-note').value.trim().slice(0, 500), acct: snapshot(),
        uid: user ? user.uid : '', lang: (window.I18N && window.I18N.lang) || 'zh-Hant', status: 'new', createdAt: fb.serverTimestamp()
      });
      try { localStorage.setItem(SG_KEY, JSON.stringify({ at: Date.now() })); } catch { /* private mode */ }
      $('#val-sg-price').value = ''; $('#val-sg-note').value = '';
      msg.textContent = t('收到了，謝謝！累積夠多之後會拿來調整估價。');
    } catch (err) {
      console.warn('value suggestion', err);
      msg.textContent = t('沒送出去：{why}', { why: err.code === 'permission-denied' ? t('這個帳號還不能使用估價') : t('連不到 Google 服務，請稍後再試') });
    }
    btn.disabled = false;
  }

  function refresh(cardItems, cur) {
    items = cardItems; if (cur) profileCur = cur;
    clearTimeout(timer);
    if ($('#pane-value').hidden) return;   // nothing to fetch until the tab is open
    timer = setTimeout(() => loadModel().then(() => D.loadCatalog()).then(render).catch(() => render()), 120);
  }
  async function act(kind) {
    busy = true; renderGate();
    try {
      if (kind === 'signin') { const ok = await window.Cloud.signIn(); if (!ok) { busy = false; renderGate(); return; } }
      if (kind === 'apply') await window.Cloud.requestAccess();
    } catch (e) { console.warn('value access', e); }
    busy = false; modelP = null;
    loadModel().then(() => D.loadCatalog()).then(render).catch(() => render());
  }

  function wire() {
    const fake = $('#val-fake'), half = $('#val-half'), bind = $('#val-binding'), dirty = $('#val-dirty'), cur = $('#val-cur');
    if (!fake) return;
    fake.checked = answers.fake; half.checked = answers.half; bind.value = answers.binding; dirty.checked = answers.dirty; cur.value = answers.cur;
    const on = () => {
      Object.assign(answers, { fake: fake.checked, half: half.checked, binding: bind.value, dirty: dirty.checked, cur: cur.value });
      write(); render();
    };
    [fake, half, bind, dirty, cur].forEach(el => el.addEventListener('change', on));
    $('#val-gate').addEventListener('click', e => { const b = e.target.closest('[data-val]'); if (b && !busy) act(b.dataset.val); });
    $('#val-sg').addEventListener('submit', sendSuggestion);
    $('#val-sg-price').addEventListener('input', () => { $('#val-sg-msg').textContent = ''; });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();

  window.CardValue = { refresh, estimate: c => (model ? estimate(c) : null), loadModel, gate: () => gate && gate.code };
  if (window.FIREBASE_EMULATOR) Object.assign(window.CardValue, {   // tests only
    __setModel: m => { model = m; modelP = Promise.resolve(m); gate = null; }, __setAnswers: a => Object.assign(answers, a) });
})();
