/* candle·kit — shared chrome (header, mobile menu, footer) and small helpers.
 * Usage: <body data-page="card"> … <script src="assets/js/site.js"></script> (before page scripts). */
(function () {
  'use strict';
  // i18n (assets/js/i18n.js); pages without it keep the Traditional Chinese source text
  const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);

  const PAGES = [
    { id: 'home', href: 'index.html', label: t('首頁') },
    { id: 'card', href: 'card.html', label: t('名片') },
    { id: 'height', href: 'height.html', label: t('身高') },
    { id: 'events', href: 'events.html', label: t('活動') },
    { id: 'music', href: 'music.html', label: t('樂譜') },
    { id: 'gallery', href: 'gallery.html', label: t('相簿') }
  ];

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
      <a class="brand" href="index.html" aria-label="${t('candle·kit 首頁')}">${MARK}<span>candle·kit</span></a>
      <nav class="nav" aria-label="${t('主要導覽')}">${links()}</nav>
      <button class="nav-toggle" type="button" aria-label="${t('開啟選單')}" aria-expanded="false" aria-controls="mobile-menu">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 6h14M3 10h14M3 14h14"/></svg>
      </button>
    </div>
    <nav class="mobile-menu" id="mobile-menu" aria-label="${t('行動版選單')}">${links()}</nav>`;
    document.body.prepend(header);
    // language picker, on pages that load assets/js/i18n.js
    if (window.I18N) header.querySelector('.nav-toggle').before(window.I18N.switcher());

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
      <div>candle·kit · ${t('粉絲自製工具，與 thatgamecompany 無關')} · <a href="https://github.com/chunhao0613/sky-cotl" target="_blank" rel="noopener">GitHub</a></div>
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

  window.Site = { store, toast, readFileAsDataURL, loadImage, bindDropzone, PAGES };
  renderChrome();
})();
