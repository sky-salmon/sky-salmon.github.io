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
      <div>sky-salmon · ${t('粉絲自製工具，與 thatgamecompany 無關')} · <a href="${REPO_URL}" target="_blank" rel="noopener">GitHub</a></div>
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

  window.Site = { store, toast, readFileAsDataURL, loadImage, bindDropzone, PAGES, pageURL: () => location.origin + prettyPath(location.pathname) };
  renderChrome();
  rise();
})();
