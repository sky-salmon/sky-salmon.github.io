/* 燭光小站 — shared header, footer and helpers */
(function () {
  'use strict';

  const PAGES = [
    { id: 'home', href: 'index.html', label: '首頁' },
    { id: 'card', href: 'card.html', label: '名片' },
    { id: 'height', href: 'height.html', label: '身高' },
    { id: 'music', href: 'music.html', label: '樂譜' },
    { id: 'events', href: 'events.html', label: '活動' }
  ];

  const MARK = `<svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true">
    <defs><radialGradient id="g-flame" cx="50%" cy="60%" r="60%">
      <stop offset="0" stop-color="#fff6d8"/><stop offset=".55" stop-color="#f2c46d"/><stop offset="1" stop-color="#e8a54b" stop-opacity="0"/>
    </radialGradient></defs>
    <circle cx="16" cy="12" r="11" fill="url(#g-flame)" opacity=".55"/>
    <path d="M16 3c3 4.5 5 7.4 5 10.2A5 5 0 0 1 16 18a5 5 0 0 1-5-4.8C11 10.4 13 7.5 16 3z" fill="#f7d58c"/>
    <path d="M16 9c1.4 2 2.2 3.3 2.2 4.6a2.2 2.2 0 0 1-4.4 0c0-1.3.8-2.6 2.2-4.6z" fill="#fffbe9"/>
    <rect x="12" y="19" width="8" height="10" rx="2" fill="#f3eee4"/>
  </svg>`;

  function renderChrome() {
    const current = document.body.dataset.page || '';
    const header = document.createElement('header');
    header.className = 'site-header';
    header.innerHTML = `<div class="wrap">
      <a class="brand" href="index.html">${MARK}<span>燭光小站<small>Sky Fan Toolkit</small></span></a>
      <nav class="nav" aria-label="主要導覽">${PAGES.map(p =>
        `<a href="${p.href}"${p.id === current ? ' aria-current="page"' : ''}>${p.label}</a>`).join('')}</nav>
    </div>`;
    document.body.prepend(header);

    const footer = document.createElement('footer');
    footer.className = 'site-footer';
    footer.innerHTML = `<div class="wrap">
      <span>© ${new Date().getFullYear()} 燭光小站 · 粉絲自製工具，與 thatgamecompany 無關。</span>
      <span>Sky: Children of the Light 為 thatgamecompany 的商標。</span>
    </div>`;
    document.body.append(footer);
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
      img.onerror = () => reject(new Error('圖片無法讀取'));
      img.src = src;
    });
  }

  // Wire a .dropzone element to a hidden file input; calls onFile(file).
  function bindDropzone(zone, input, onFile) {
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('change', () => { if (input.files[0]) onFile(input.files[0]); input.value = ''; });
    ['dragenter', 'dragover'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(t => zone.addEventListener(t, e => { e.preventDefault(); zone.classList.remove('drag'); }));
    zone.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) onFile(f); });
  }

  window.Site = { store, readFileAsDataURL, loadImage, bindDropzone };
  renderChrome();
})();
