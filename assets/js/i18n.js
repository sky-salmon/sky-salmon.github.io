/* sky-salmon — i18n for the card editor.
 * Keys are the Traditional Chinese source strings (zh-Hant is the source language and needs no dictionary).
 * Dictionaries come from assets/js/i18n-dict.js, built by scripts/i18n_build.py from i18n/en.json (+ OpenCC zh-Hans).
 * - t(key, vars): translate; {name} placeholders are filled from vars in every language.
 * - Static HTML is translated once, before the page scripts render (load this right after i18n-dict.js).
 * - Switching language stores the choice and reloads; the card itself lives in localStorage, so nothing is lost. */
(function () {
  'use strict';
  const LANGS = [
    { id: 'zh-Hant', name: '繁體中文' },
    { id: 'zh-Hans', name: '简体中文' },
    { id: 'en', name: 'English' }
  ];
  const STORE = 'candle.lang';
  const DICT = window.I18N_DICT || {};

  function detect() {
    try {
      const saved = localStorage.getItem(STORE);
      if (LANGS.some(l => l.id === saved)) return saved;
    } catch { /* storage blocked: fall back to the browser language */ }
    for (const raw of (navigator.languages || [navigator.language || ''])) {
      const l = String(raw).toLowerCase();
      if (l.startsWith('zh')) return /hans|-cn|-sg|-my/.test(l) ? 'zh-Hans' : 'zh-Hant';
      if (l.startsWith('en')) return 'en';
    }
    return 'zh-Hant';
  }
  const lang = detect();
  const table = lang === 'zh-Hant' ? null : (DICT[lang] || null);

  function t(key, vars) {
    let s = (table && table[key]) || key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  }

  // translate the page's static markup (text nodes + user-facing attributes)
  const ATTRS = ['placeholder', 'aria-label', 'title', 'alt'];
  function apply(root) {
    if (!table) return;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement && /^(SCRIPT|STYLE|TEXTAREA)$/.test(n.parentElement.tagName)) || n.parentElement.closest('[translate="no"]')
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    nodes.forEach(n => {
      const v = n.nodeValue, key = v.trim();
      if (key && table[key]) n.nodeValue = v.replace(key, table[key]);
    });
    root.querySelectorAll(ATTRS.map(a => `[${a}]`).join(',')).forEach(el => {
      ATTRS.forEach(a => { const v = el.getAttribute(a); if (v && table[v]) el.setAttribute(a, table[v]); });
    });
  }

  function setLang(id) {
    try { localStorage.setItem(STORE, id); } catch { /* the choice just won't be remembered */ }
    location.reload();
  }

  // <select> for the site header
  function switcher() {
    const label = document.createElement('label');
    label.className = 'lang-switch';
    label.innerHTML = `<span class="sr-only">${t('語言')}</span><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="10" cy="10" r="7.2"/><path d="M2.8 10h14.4M10 2.8c2 2.1 2.9 4.5 2.9 7.2s-.9 5.1-2.9 7.2c-2-2.1-2.9-4.5-2.9-7.2S8 4.9 10 2.8Z"/></svg>
      <select aria-label="${t('語言')}">${LANGS.map(l => `<option value="${l.id}"${l.id === lang ? ' selected' : ''}>${l.name}</option>`).join('')}</select>`;
    label.querySelector('select').addEventListener('change', e => setLang(e.target.value));
    return label;
  }

  document.documentElement.lang = lang;
  if (table) {
    if (table[document.title]) document.title = table[document.title];
    const desc = document.querySelector('meta[name="description"]');
    if (desc && table[desc.content]) desc.content = table[desc.content];
    if (document.body) apply(document.body);
  }
  window.I18N = { lang, LANGS, t, apply, setLang, switcher };
})();
