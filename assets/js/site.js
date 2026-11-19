/* sky-salmon — shared chrome (header, mobile menu, footer) and small helpers.
 * Usage: <body data-page="card"> … <script src="assets/js/site.js"></script> (before page scripts). */
(function () {
  'use strict';
  // i18n (assets/js/i18n.js); pages without it keep the Traditional Chinese source text
  const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);

  // the GitHub repository this copy of the site is published from, so links follow a move: <owner>.github.io/<repo>/
  // for a project site, <owner>.github.io/ for the account's own site (repository <owner>.github.io). The site's root
  // is two folders above this script (assets/js/site.js), whatever page is open.
  const REPO_URL = (() => {
    const h = location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (!h) return 'https://github.com/sky-salmon/sky-salmon.github.io';
    const here = document.currentScript ? document.currentScript.src : location.href;
    const seg = new URL('../../', here).pathname.split('/').filter(Boolean)[0];
    return `https://github.com/${h[1]}/` + (seg || `${h[1]}.github.io`);
  })();
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href="https://github.com/sky-salmon/sky-salmon.github.io"]').forEach(a => { a.href = REPO_URL; });
  });
  // Addresses without ".html": GitHub Pages serves /card from card.html. Local servers (python -m http.server) don't,
  // so keep the file names there.
  const PRETTY = location.protocol !== 'file:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const prettyPath = p => (PRETTY ? p.replace(/\/index\.html$/, '/').replace(/\.html$/, '') : p);
  const pageHref = file => (PRETTY ? (file === 'index.html' ? './' : file.replace(/\.html$/, '')) : file);
  if (PRETTY && /\.html$/.test(location.pathname)) history.replaceState(history.state, '', prettyPath(location.pathname) + location.search + location.hash);
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('a[href]').forEach(a => {
      const h = a.getAttribute('href'), m = h.match(/^([\w-]+\.html)([?#].*)?$/);
      if (m) a.setAttribute('href', pageHref(m[1]) + (m[2] || ''));
    });
  });
  const PAGES = [
    { id: 'home', href: pageHref('index.html'), label: t('首頁') },
    { id: 'card', href: pageHref('card.html'), label: t('名片') },
    { id: 'wardrobe', href: pageHref('wardrobe.html'), label: t('圖鑑') },
    { id: 'height', href: pageHref('height.html'), label: t('身高') },
    { id: 'events', href: pageHref('events.html'), label: t('活動') },
    { id: 'music', href: pageHref('music.html'), label: t('樂譜') },
    { id: 'gallery', href: pageHref('gallery.html'), label: t('相簿') }
  ];

  const HERE = document.currentScript ? document.currentScript.src : location.href;
  const MARK = `<svg viewBox="0 0 36 36" aria-hidden="true">
    <circle cx="18" cy="13" r="11" fill="#f6d68f" opacity=".45"/>
    <path d="M18 4c3.2 4.6 5.2 7.6 5.2 10.4a5.2 5.2 0 0 1-10.4 0C12.8 11.6 14.8 8.6 18 4z" fill="#f0a24a" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
    <path d="M18 10.5c1.3 1.9 2 3.1 2 4.2a2 2 0 0 1-4 0c0-1.1.7-2.3 2-4.2z" fill="#fff4cf"/>
    <rect x="13.5" y="20" width="9" height="12" rx="2.5" fill="#fffdf8" stroke="currentColor" stroke-width="1.6"/>
  </svg>`;

  function links() {
    const current = document.body.dataset.page || '';
    return PAGES.map(p => `<a href="${p.href}"${p.id === current ? ' aria-current="page"' : ''}>${p.label}</a>`).join('');
  }

  function renderChrome() {
    const header = document.createElement('header');
    header.className = 'topbar';
    header.innerHTML = `<div class="wrap">
      <a class="brand" href="${pageHref('index.html')}" aria-label="${t('sky-salmon 首頁')}">${MARK}<span>sky-salmon</span></a>
      <nav class="nav" aria-label="${t('主要導覽')}">${links()}</nav>
      <button class="nav-toggle" type="button" aria-label="${t('開啟選單')}" aria-expanded="false" aria-controls="mobile-menu">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h14M3 10h14M3 14h14"/></svg>
      </button>
    </div>
    <nav class="mobile-menu" id="mobile-menu" aria-label="${t('行動版選單')}">${links()}<button type="button" class="mm-fb" data-feedback>${t('意見箱')}</button></nav>`;
    document.body.prepend(header);
    // language picker, on pages that load assets/js/i18n.js
    if (window.I18N) header.querySelector('.nav-toggle').before(window.I18N.switcher());
    const fbBtn = document.createElement('button');
    fbBtn.type = 'button'; fbBtn.className = 'fb-open'; fbBtn.dataset.feedback = '';
    fbBtn.setAttribute('aria-label', t('意見箱')); fbBtn.title = t('意見箱');
    fbBtn.innerHTML = '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 4.5h13a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1H9l-3.8 3v-3H3.5a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z"/><path d="M6.5 8.3h7M6.5 11h4.5" stroke-linecap="round"/></svg>';
    header.querySelector('.nav-toggle').before(fbBtn);

    const toggle = header.querySelector('.nav-toggle'), menu = header.querySelector('.mobile-menu');
    toggle.addEventListener('click', () => {
      const open = menu.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', open);
      toggle.setAttribute('aria-label', open ? t('關閉選單') : t('開啟選單'));
    });

    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `<div class="wrap">
      <div class="hand">Made with ♡ for every child of the light</div>
      <div>sky-salmon · ${t('粉絲自製工具，與 thatgamecompany 無關')} · <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a> · <button type="button" class="link-btn" data-feedback>${t('意見箱')}</button></div>
    </div>`;
    document.body.append(footer);

    const toast = document.createElement('div');
    toast.className = 'toast'; toast.id = 'site-toast';
    toast.setAttribute('role', 'status'); toast.setAttribute('aria-live', 'polite');
    document.body.append(toast);
  }

  // localStorage can throw (private mode, blocked storage) — never let that break a tool.
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); }
      catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); return true; }
      catch { return false; }
    }
  };

  let toastTimer = 0;
  function toast(message, ms = 2200) {
    const el = document.getElementById('site-toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('is-visible'), ms);
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(t('圖片無法讀取')));
      img.src = src;
    });
  }

  // Wire a .dropzone element to a hidden <input type=file>; calls onFile(file).
  function bindDropzone(zone, input, onFile) {
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { [...input.files].forEach(onFile); input.value = ''; });
    ['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add('is-drag'); }));
    ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.remove('is-drag'); }));
    zone.addEventListener('drop', e => { [...e.dataTransfer.files].forEach(onFile); });
  }

  // Anything marked data-rise comes up into place as it enters the screen (base.css); what is on the first screen
  // rises on load, a little after one another. Nothing is hidden without the means to show it again.
  function rise() {
    if (document.body.dataset.page === 'home') return;   // the home page moves its own (assets/js/home.js)
    const els = [...document.querySelectorAll('[data-rise]')];
    if (!els.length || !('IntersectionObserver' in window) || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.documentElement.classList.add('js-rise');
    const io = new IntersectionObserver(es => {
      let n = 0;
      for (const e of es) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        if (!e.target.style.getPropertyValue('--rd')) e.target.style.setProperty('--rd', Math.min(n++ * 0.09, 0.45) + 's');
        e.target.classList.add('is-in');
      }
    }, { rootMargin: '0px 0px -6% 0px' });
    els.forEach(el => io.observe(el));
    // once it has risen, an element's own transitions (hover, open…) are its own again
    const settle = e => { if (e.target !== e.currentTarget || e.propertyName !== 'transform') return; e.currentTarget.classList.add('is-settled'); e.currentTarget.style.removeProperty('--rd'); e.currentTarget.removeEventListener('transitionend', settle); };
    els.forEach(el => el.addEventListener('transitionend', settle));
  }

  // ── feedback: anyone can send a note; it lands in Firestore feedback/, which only admins can read ─────────
  const FB_KINDS = [['bug', t('問題回報')], ['data', t('資料有誤')], ['idea', t('建議')], ['other', t('其他')]];
  const FB_WAIT = 60000, FB_LAST = 'candle.feedback.last';
  let fbDialog = null, fbDb = null;
  function fbScript(src) {
    return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.append(s); });
  }
  async function feedbackDb() {   // its own Firebase app, no sign-in: works on every page, beside the card's cloud save
    if (fbDb) return fbDb;
    if (!window.FIREBASE_CONFIG) await fbScript(new URL('firebase-config.js', HERE).href);
    const CFG = window.FIREBASE_CONFIG;
    if (!CFG || !CFG.projectId) throw new Error('not configured');
    const m = await import(new URL('vendor/firebase.js', HERE).href);
    const app = m.initializeApp(CFG, 'feedback');
    fbDb = { m, db: m.getFirestore(app) };
    if (window.FIREBASE_EMULATOR) m.connectFirestoreEmulator(fbDb.db, '127.0.0.1', 8080);   // test harness only
    return fbDb;
  }
  function openFeedback(opener) {
    if (!fbDialog) {
      fbDialog = document.createElement('dialog');
      fbDialog.className = 'fb-dialog';
      fbDialog.setAttribute('aria-labelledby', 'fb-title');
      fbDialog.innerHTML = `<form method="dialog" class="fb-form" novalidate>
        <div class="fb-head"><h2 id="fb-title">${t('意見箱')}</h2>
          <button type="button" class="fb-x" data-fb-close aria-label="${t('關閉')}"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15"/></svg></button></div>
        <p class="fb-sub">${t('發現問題、資料錯誤或有想法，都可以直接寫給站長。')}</p>
        <div class="fb-kinds" role="radiogroup" aria-label="${t('意見類型')}">${FB_KINDS.map(([k, z], i) => `<label class="fb-kind"><input type="radio" name="fb-kind" value="${k}"${i === 0 ? ' checked' : ''}><span>${z}</span></label>`).join('')}</div>
        <label class="fb-field"><span>${t('內容')}</span><textarea id="fb-msg" maxlength="2000" rows="5" required placeholder="${t('例如：名片產生器的 IAP 裡找不到某個禮包；估價的結果跟行情差很多…')}"></textarea><small class="fb-count" id="fb-count">0 / 2000</small></label>
        <label class="fb-field"><span>${t('聯絡方式（選填）')}</span><input id="fb-contact" maxlength="200" autocomplete="email" placeholder="${t('想收到回覆再留，例如 Email 或 Discord')}"></label>
        <p class="fb-note">${t('只有站長看得到。請不要寫密碼或帳號登入資料。')}</p>
        <p class="fb-err" id="fb-err" role="alert" hidden></p>
        <div class="fb-foot"><button type="button" class="btn" data-fb-close>${t('取消')}</button><button type="submit" class="btn btn-primary" id="fb-send">${t('送出')}</button></div>
      </form>`;
      document.body.append(fbDialog);
      const msg = fbDialog.querySelector('#fb-msg'), err = fbDialog.querySelector('#fb-err'), send = fbDialog.querySelector('#fb-send');
      msg.addEventListener('input', () => { fbDialog.querySelector('#fb-count').textContent = `${msg.value.length} / 2000`; });
      fbDialog.addEventListener('click', e => { if (e.target.closest('[data-fb-close]') || e.target === fbDialog) fbDialog.close(); });
      fbDialog.querySelector('form').addEventListener('submit', async e => {
        e.preventDefault();
        const text = msg.value.trim();
        err.hidden = true;
        if (!text) { err.textContent = t('請先寫下內容。'); err.hidden = false; msg.focus(); return; }
        const last = store.get(FB_LAST, 0);
        if (Date.now() - last < FB_WAIT) { err.textContent = t('剛剛才送過，請過一分鐘再試。'); err.hidden = false; return; }
        send.disabled = true; send.textContent = t('送出中…');
        try {
          const { m, db } = await feedbackDb();
          await m.setDoc(m.doc(m.collection(db, 'feedback')), {
            kind: (fbDialog.querySelector('input[name="fb-kind"]:checked') || {}).value || 'other', msg: text.slice(0, 2000),
            page: (location.pathname + location.search).slice(0, 300), contact: fbDialog.querySelector('#fb-contact').value.trim().slice(0, 200),
            lang: (document.documentElement.lang || '').slice(0, 20), status: 'new', createdAt: m.serverTimestamp()
          });
          store.set(FB_LAST, Date.now());
          msg.value = ''; fbDialog.querySelector('#fb-contact').value = ''; fbDialog.querySelector('#fb-count').textContent = '0 / 2000';
          fbDialog.close(); toast(t('已送出，謝謝你的意見！'), 2800);
        } catch (ex) {
          console.warn('feedback', ex);
          err.textContent = t('送不出去：可能是網路連不到 Google 服務，請稍後再試。'); err.hidden = false;
        } finally { send.disabled = false; send.textContent = t('送出'); }
      });
      fbDialog.addEventListener('close', () => { if (fbDialog.opener && document.contains(fbDialog.opener)) fbDialog.opener.focus(); });
    }
    fbDialog.opener = opener || document.activeElement;
    fbDialog.showModal();
    fbDialog.querySelector('#fb-msg').focus();
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-feedback]'); if (b) { e.preventDefault(); openFeedback(b); } });

  window.Site = { store, toast, readFileAsDataURL, loadImage, bindDropzone, PAGES, openFeedback, pageURL: () => location.origin + prettyPath(location.pathname) };
  renderChrome();
  rise();
})();
