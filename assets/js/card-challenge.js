/* sky-salmon — 估價挑戰 (card.html#challenge): fills the value model's gaps with people's own price reads.
 *
 * Each round makes up a plausible account from the real catalogue: a start season (spread evenly over four eras so
 * every part of the market gets answers), each later season graduated, half or missed, a number of real paid packs,
 * currencies that grow with the account's age and its bindings. It is shown as a card (read-only, like a shared card)
 * and the player says what it would sell for, how sure they are, and optionally why. Nothing about the model's own
 * estimate is shown, so answers don't lean on it.
 *
 * Answers go to Firestore valueSuggestions with source 'challenge' (admin.html → 估價建議 lists and exports them with the
 * rest), carrying the account the same way the 估價 tab does plus quiz: {v, seed, conf, ms, rep}. The seed rebuilds the
 * exact card. About one round in ten repeats a card this device already answered (rep: true), to see how steady each
 * person's reads are.
 * Who may play is the restricted feature "challenge" (admin.html → 權限: approved accounts, an email list, or everyone). */
(function () {
  'use strict';
  if (!/^#challenge\b/.test(location.hash)) return;
  const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
  const D = window.CardData;
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GEN_V = 1, KEY = 'candle.challenge', REPEAT_EVERY = 10;
  const box = $('#challenge');
  let round = null, busy = false;

  const store = {
    get() { try { return Object.assign({ done: 0, seeds: [] }, JSON.parse(localStorage.getItem(KEY)) || {}); } catch { return { done: 0, seeds: [] }; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* private mode */ } }
  };

  // ── a made-up account, the same every time for the same seed ─────────────
  function rng(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6D2B79F5) | 0; let x = Math.imul(a ^ (a >>> 15), 1 | a); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 4294967296; };
  }
  const ERAS = [['01', '05'], ['06', '12'], ['13', '21'], ['22', '99']];   // start seasons, one era picked evenly
  function generate(seed, catalog) {
    const r = rng(seed), pick = a => a[Math.floor(r() * a.length)];
    const bySeason = new Map();
    catalog.forEach(i => {
      if (!i.season) return;
      if (!bySeason.has(i.season)) bySeason.set(i.season, { pend: null, ults: [] });
      const s = bySeason.get(i.season);
      if (i.cat === 'pass' && !i.ult) { if (!s.pend) s.pend = i.path; } else if (i.ult) s.ults.push(i.path);
    });
    const codes = [...bySeason.keys()].filter(c => bySeason.get(c).pend).sort(), cur = codes[codes.length - 1];
    const era = pick(ERAS), inEra = codes.filter(c => c >= era[0] && c <= era[1] && c < cur);
    const start = pick(inEra.length ? inEra : codes);
    const diligence = 0.4 + 0.6 * r(), halfRate = 0.08 + 0.12 * r();
    const grad = [], half = [], missed = [], pass = [];
    codes.filter(c => c >= start).forEach(c => {
      const s = bySeason.get(c), x = r();
      const st = c === start ? (x < 0.8 ? 'grad' : 'half') : x < diligence ? 'grad' : x < diligence + halfRate ? 'half' : 'missed';
      if (st === 'missed') { missed.push(c); return; }
      pass.push({ k: 'c', p: s.pend });
      if (st === 'grad') { grad.push(c); s.ults.forEach(p => pass.push({ k: 'c', p })); } else half.push(c);
    });
    // paid packs: how many, then which (from those sold since about when the account started)
    const startYear = +String((D.SEASONS[start] || {}).start || '').slice(0, 4) || 2019;
    const nPacks = (() => { const x = r(); return x < 0.15 ? 0 : x < 0.5 ? 1 + Math.floor(r() * 8) : x < 0.8 ? 9 + Math.floor(r() * 17) : 26 + Math.floor(r() * 35); })();
    const pool = D.packs().filter(p => p.items.length && (!+p.year || +p.year >= startYear - 1));
    const packs = [], iap = [], seenItem = new Set();
    for (const p of pool.slice().sort(() => r() - 0.5)) {
      if (packs.length >= nPacks) break;
      packs.push(p.id);
      p.items.forEach(path => { if (!seenItem.has(path)) { seenItem.add(path); iap.push({ k: 'c', p: path }); } });
    }
    // currencies grow with the account's age; bindings: mostly all transferable
    const age = codes.filter(c => c >= start).length, round10 = n => String(Math.max(0, Math.round(n / 10) * 10));
    const cur$ = { candle: round10((60 + r() * 140) * age * (0.5 + diligence)), ascended: String(Math.round(age * (1 + r() * 5))),
      heart: round10((20 + r() * 120) * age), seasonCandle: '0', seasonHeart: '0', ticket: '0' };
    const plats = D.LINKS.map(l => l.id).filter(id => ['google', 'apple', 'nintendo', 'playstation', 'gamecenter', 'facebook'].includes(id));
    const nLinks = 1 + Math.floor(r() * 3), chosen = plats.slice().sort(() => r() - 0.5).slice(0, nLinks);
    const bx = r(), binding = bx < 0.6 ? 'all_free' : bx < 0.9 || chosen.length < 2 ? 'one_locked' : 'more_locked';
    const nDead = binding === 'all_free' ? 0 : binding === 'one_locked' ? 1 : 2;
    const link = chosen.map((id, i) => (i < nDead ? { k: 'l', id, dead: true } : { k: 'l', id }));
    const name = c => D.seasonName(c), list = a => a.map(name).join('、');
    const info = [
      t('從{s}開始', { s: name(start) }),
      t('畢業 {n} 季', { n: grad.length }) + (half.length ? `　${t('半季')}：${list(half)}` : ''),
      missed.length ? `${t('斷')}：${list(missed)}` : t('無斷'),
      t('禮包 {n} 個', { n: packs.length })
    ].join('\n');
    const state = {
      v: 3, design: 'classic', title: t('估價挑戰'),
      // two columns on wide screens; one on phones so the icons stay a readable size
      layout: innerWidth < 700 ? { cols: 1, left: ['profile', 'info', 'pass', 'iap', 'link'], right: [], hidden: { pin: true, spells: true, extra: true } }
        : { cols: 2, left: ['profile', 'pass', 'link', 'info'], right: ['iap'], hidden: { pin: true, spells: true, extra: true } },
      size: { w: null, h: null, bal: 50 }, themes: {},
      profile: { avatar: null, avatarOn: false, cur: cur$, curOn: { candle: true, ascended: true, heart: true, seasonCandle: false }, h: { now: '', tall: '', short: '' }, note: '' },
      items: { pass, pin: [], iap, spells: [], extra: [], link },
      views: { pass: 'grid', pin: 'grid', iap: 'season', extra: 'grid' }, titles: {}, linkNote: '', linkNoteOn: false, info
    };
    const ults = pass.map(x => D.parsePath(x.p)).filter(q => q.ult).map(q => q.name);
    const names = [...new Set(pass.concat(iap).map(x => D.parsePath(x.p).name))];
    const acct = { start, seasons: grad.concat(half).sort(), grad, half, missed, ults, items: names.slice(0, 3000), packs, badges: 0,
      currency: cur$, binding, fake: false, dirty: false, links: link.map(l => l.id + (l.dead ? ':dead' : '')) };
    return { state, acct };
  }

  // ── rounds ───────────────────────────────────────────────────────────────
  async function next() {
    const catalog = await D.loadCatalog(), mem = store.get();
    let seed = (Math.random() * 4294967296) >>> 0, rep = false;
    if (mem.seeds.length >= 3 && mem.done % REPEAT_EVERY === REPEAT_EVERY - 1) { seed = mem.seeds[Math.floor(Math.random() * mem.seeds.length)]; rep = true; }
    const g = generate(seed, catalog);
    round = Object.assign(g, { seed, rep, t0: Date.now(), conf: 0 });
    window.CardApp.load({ v: 1, state: g.state, assets: {} }, false);
    renderForm();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderForm(msg) {
    const mem = store.get();
    box.innerHTML = `<form class="chl-form" id="chl-form" novalidate>
        <div class="chl-head"><b>${t('這個帳號你估多少？')}</b><span class="note">${t('已完成 {n} 題', { n: mem.done })}</span></div>
        <div class="chl-row">
          <label class="chl-price"><span>NT$</span><input class="input" id="chl-price" inputmode="numeric" autocomplete="off" placeholder="${t('例如 6500')}" aria-label="${t('估價（新台幣）')}"></label>
          <div class="seg chl-conf" role="radiogroup" aria-label="${t('把握程度')}">${[[3, t('很有把握')], [2, t('大概')], [1, t('不太確定')]].map(([v, z]) =>
            `<button type="button" role="radio" data-conf="${v}" aria-checked="${round && round.conf === v}">${z}</button>`).join('')}</div>
          <input class="input chl-note" id="chl-note" maxlength="200" placeholder="${t('（選填）為什麼這個價')}" aria-label="${t('備註')}">
          <div class="chl-acts"><button type="button" class="btn btn-sm chl-note-btn" id="chl-note-btn">${t('＋備註')}</button><button type="button" class="btn btn-sm" id="chl-skip">${t('跳過')}</button><button type="submit" class="btn btn-sm btn-primary" id="chl-send">${t('送出，下一題')}</button></div>
        </div>
        <p class="note chl-msg" id="chl-msg" role="status">${msg || ''}</p>
      </form>`;
    box.hidden = false;
    $('#chl-form').addEventListener('submit', send);
    $('#chl-skip').addEventListener('click', () => { if (!busy) next(); });
    $('#chl-note-btn').addEventListener('click', () => { $('#chl-form').classList.add('with-note'); $('#chl-note').focus(); });
    box.querySelectorAll('[data-conf]').forEach(b => b.addEventListener('click', () => {
      round.conf = +b.dataset.conf;
      box.querySelectorAll('[data-conf]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    }));
  }

  async function send(ev) {
    ev.preventDefault();
    if (busy || !round) return;
    const msg = $('#chl-msg'), price = Math.round(parseFloat(($('#chl-price').value || '').replace(/[^\d.]/g, '')));
    if (!(price > 0 && price < 10000000)) { msg.textContent = t('請填一個數字，例如 6500。'); $('#chl-price').focus(); return; }
    if (!round.conf) { msg.textContent = t('選一下把握程度。'); return; }
    busy = true; $('#chl-send').disabled = true; msg.textContent = t('送出中…');
    try {
      const { fb, db, user } = await window.Cloud.account();
      await fb.setDoc(fb.doc(fb.collection(db, 'valueSuggestions')), {
        model: 'challenge-' + GEN_V, cur: 'TWD', price, priceTwd: price, est: {}, source: 'challenge',
        note: $('#chl-note').value.trim().slice(0, 500), acct: round.acct, uid: user ? user.uid : '',
        lang: (window.I18N && window.I18N.lang) || 'zh-Hant', status: 'new', createdAt: fb.serverTimestamp(),
        quiz: { v: GEN_V, seed: round.seed, conf: round.conf, ms: Math.min(Date.now() - round.t0, 3600000), rep: round.rep }
      });
      const mem = store.get();
      mem.done++;
      if (!round.rep) mem.seeds = mem.seeds.concat(round.seed).slice(-30);
      store.set(mem);
      busy = false;
      await next();
      $('#chl-msg').textContent = t('收到了，謝謝！這是下一題。');
    } catch (err) {
      console.warn('challenge', err);
      busy = false; $('#chl-send').disabled = false;
      msg.textContent = t('沒送出去：{why}', { why: err.code === 'permission-denied' ? t('這個帳號還不能參加估價挑戰') : t('連不到 Google 服務，請稍後再試') });
    }
  }

  // ── who may play: the "challenge" feature (readable gated/challenge = allowed, like Access.check) ──
  async function gate() {
    let acc;
    try { acc = await window.Cloud.account(); } catch { return 'offline'; }
    const { fb, db, user } = acc;
    try { await fb.getDoc(fb.doc(db, 'gated', 'challenge')); return 'ok'; } catch (e) {
      if (e.code !== 'permission-denied') return 'offline';
      if (!user) return 'signin';
      let a = null;
      try { a = await window.Cloud.accessStatus(); } catch { return 'offline'; }
      return !a ? 'apply' : a.status === 'denied' ? 'denied' : a.status === 'approved' ? 'noperm' : 'pending';
    }
  }
  function renderGate(code) {
    const say = {
      signin: [t('估價挑戰目前只開放給受邀的玩家。先用 Google 登入。'), `<button type="button" class="btn btn-sm btn-primary" data-chl="signin">${t('用 Google 登入')}</button>`],
      apply: [t('估價挑戰目前只開放給受邀的玩家。送出申請，站長核准後就能開始。'), `<button type="button" class="btn btn-sm btn-primary" data-chl="apply">${t('申請參加')}</button>`],
      pending: [t('申請已送出，等站長核准。'), ''],
      noperm: [t('你的帳號已核准，但還沒開放估價挑戰，請聯絡站長。'), ''],
      denied: [t('這個帳號不能參加估價挑戰。'), ''],
      offline: [t('連不到 Google 服務，請稍後再試。'), '']
    }[code];
    box.innerHTML = `<div class="chl-gate"><p>${say[0]}</p>${say[1]}</div>`;
    box.hidden = false;
    const b = box.querySelector('[data-chl]');
    if (b) b.addEventListener('click', async () => {
      if (busy) return; busy = true;
      try { if (b.dataset.chl === 'signin') await window.Cloud.signIn(); else { await window.Cloud.account(); await window.Cloud.requestAccess(); } } catch (e) { console.warn(e); }
      busy = false; start();
    });
  }

  async function start() {
    box.innerHTML = `<p class="note">${t('載入中…')}</p>`; box.hidden = false;
    const code = await gate();
    if (code === 'ok') next(); else renderGate(code);
  }

  // the page is the card editor in view mode; say what it is now
  const h1 = document.querySelector('.page-head .title, h1.title'), lead = document.querySelector('.page-head .lead, p.lead');
  if (h1) h1.innerHTML = `${t('估價挑戰')} <em>Value Challenge</em>`;
  if (lead) lead.textContent = t('看一張帳號名片，填你認為它在市場上能賣多少。你的答案會用來補足估價模型缺少的資料；不會顯示模型自己的估價，照你的判斷填就好。');
  document.title = t('估價挑戰') + ' — sky-salmon';
  document.body.classList.add('is-challenge');   // no download bar: nothing to export here
  const wait = () => (window.Cloud && window.CardApp ? start() : setTimeout(wait, 50));
  wait();
})();
