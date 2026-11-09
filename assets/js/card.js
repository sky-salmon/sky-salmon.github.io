/* candle·kit — 名片產生器 (card studio).
 * Canvas renderer with six card styles, two-column drag & drop layout, undo/redo and PNG export.
 * Everything drawn here (icons, decorations, textures) is made with canvas paths — the only image is the user's avatar. */
(function () {
  'use strict';
  const { store, toast, readFileAsDataURL, loadImage, bindDropzone } = window.Site;
  const KEY = 'candle.card.v2';
  const TAU = Math.PI * 2;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  // ── sections ──────────────────────────────────────────────────────────────
  const SECTION_META = {
    profile: { label: '個人資料', en: 'Profile' },
    stats: { label: '收藏', en: 'Collection' },
    height: { label: '身高', en: 'Height' },
    favorites: { label: '最愛', en: 'Favourites' },
    seasons: { label: '季節足跡', en: 'Seasons' },
    tags: { label: '標籤', en: 'Tags' },
    links: { label: '社群連結', en: 'Links' },
    note: { label: '留言', en: 'Note' }
  };
  const IDS = Object.keys(SECTION_META);

  const SAMPLE = {
    name: '星砂', code: '7Q2K-M9XD-4LPA', bio: '喜歡在雲海上滑翔、在書庫裡發呆，偶爾當一下迷路新手的領路人。', avatar: '',
    candles: '286', hearts: '74', ascended: '31', season: '12',
    hNow: '1.24', hTall: '2.05', hShort: '0.62',
    map: '霞谷', spirit: '撐傘的先祖', emote: '揮手',
    seasons: '感恩季, 歸屬季, 夢想季, 小王子季, 聚光季', tags: '跑圖, 拍照, 合奏, 夜貓子, 慢慢飛',
    ig: '@starsand.sky', discord: 'starsand', other: 'starsand.carrd.co',
    note: '一起去看雲海上的日落吧！'
  };

  function defaults() {
    return {
      v: 2, style: 'classic', layout: 'single',
      order: IDS.slice(),
      cols: [['profile', 'stats', 'height'], ['favorites', 'seasons', 'tags', 'links', 'note']],
      hidden: {},
      size: { width: 1080, pad: 60, radius: 40, text: 100 },
      looks: {},
      grain: true,
      settings: { scale: 2, date: true, mark: true },
      data: { ...SAMPLE }
    };
  }

  const splitList = (s, max) => String(s || '').split(/[,，、;；\n]/).map(t => t.trim()).filter(Boolean).slice(0, max);
  const filled = v => String(v ?? '').trim() !== '';
  function hasContent(id, d) {
    switch (id) {
      case 'profile': return true;
      case 'stats': return [d.candles, d.hearts, d.ascended, d.season].some(filled);
      case 'height': return [d.hNow, d.hTall, d.hShort].some(filled);
      case 'favorites': return [d.map, d.spirit, d.emote].some(filled);
      case 'seasons': return splitList(d.seasons, 24).length > 0;
      case 'tags': return splitList(d.tags, 16).length > 0;
      case 'links': return [d.ig, d.discord, d.other].some(filled);
      case 'note': return filled(d.note);
    }
    return false;
  }

  // ── colour helpers ────────────────────────────────────────────────────────
  function hexRgb(hex) {
    let h = String(hex).replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [128, 128, 128];
  }
  const alpha = (hex, a) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };
  function mix(a, b, t) {
    const A = hexRgb(a), B = hexRgb(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function luminance(hex) {
    const c = hexRgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  const validHex = v => /^#[0-9a-f]{6}$/i.test(v || '');

  // seeded PRNG so decorations stay put between renders
  function rng(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ── fonts ─────────────────────────────────────────────────────────────────
  const F = {
    sans: '"Outfit", "Noto Sans TC", sans-serif',
    tc: '"Noto Sans TC", "Outfit", sans-serif',
    serif: '"Noto Serif TC", serif',
    iserif: '"Instrument Serif", "Noto Serif TC", serif',
    mono: '"JetBrains Mono", "Noto Sans TC", monospace',
    hand: '"Caveat", "LXGW WenKai TC", cursive',
    kai: '"LXGW WenKai TC", "Noto Sans TC", serif',
    pixel: '"Pixelify Sans", "Noto Sans TC", monospace'
  };
  const FONT_FACES = [
    '500 20px "Noto Sans TC"', '700 20px "Noto Sans TC"', '800 20px "Noto Sans TC"', '700 20px "Noto Serif TC"',
    '400 20px "LXGW WenKai TC"', '700 20px "LXGW WenKai TC"',
    '500 20px Outfit', '800 20px Outfit', '400 20px "Instrument Serif"', 'italic 400 20px "Instrument Serif"',
    '500 20px "JetBrains Mono"', '700 20px "JetBrains Mono"', '600 20px Caveat', '700 20px Caveat',
    '500 20px "Pixelify Sans"', '700 20px "Pixelify Sans"'
  ];
  const STATIC_TEXT = Object.values(SECTION_META).map(m => m.label + m.en).join('') +
    '蠟燭愛心升華季節目前身高最高最矮地圖先祖動作其他光之子名片的剪貼簿所有區塊都藏起來了到版面打開一些吧' +
    'PROFILECARDmadewithcandle·kitPLAYERSYS://IDMINMAXHOLOmyskycardabcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,-#@:/—…“”';
  const requested = new Set();
  // Google Fonts serves CJK in unicode-range slices; canvas text only gets them if we ask for those exact characters.
  async function ensureFonts(text) {
    if (!document.fonts || !document.fonts.load) return false;
    const fresh = [...new Set(text)].filter(c => c.trim() && !requested.has(c));
    if (!fresh.length) return false;
    fresh.forEach(c => requested.add(c));
    const s = fresh.join('');
    await Promise.all(FONT_FACES.map(f => document.fonts.load(f, s).catch(() => null)));
    return true;
  }
  const collectText = () => STATIC_TEXT + Object.entries(state.data).filter(([k]) => k !== 'avatar').map(([, v]) => v).join('');

  // ── canvas primitives ─────────────────────────────────────────────────────
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function chamfer(ctx, x, y, w, h, tl, tr, br, bl) {
    ctx.moveTo(x + tl, y); ctx.lineTo(x + w - tr, y); ctx.lineTo(x + w, y + tr); ctx.lineTo(x + w, y + h - br);
    ctx.lineTo(x + w - br, y + h); ctx.lineTo(x + bl, y + h); ctx.lineTo(x, y + h - bl); ctx.lineTo(x, y + tl); ctx.closePath();
  }
  function stepped(ctx, x, y, w, h, st, n) {
    n = Math.max(0, Math.min(n, Math.floor(Math.min(w, h) / (2 * st))));
    let cx = x + w - n * st, cy = y;
    ctx.moveTo(x + n * st, y); ctx.lineTo(cx, cy);
    for (let i = 0; i < n; i++) { cy += st; ctx.lineTo(cx, cy); cx += st; ctx.lineTo(cx, cy); }
    ctx.lineTo(x + w, y + h - n * st); cx = x + w; cy = y + h - n * st;
    for (let i = 0; i < n; i++) { cx -= st; ctx.lineTo(cx, cy); cy += st; ctx.lineTo(cx, cy); }
    ctx.lineTo(x + n * st, y + h); cx = x + n * st; cy = y + h;
    for (let i = 0; i < n; i++) { cy -= st; ctx.lineTo(cx, cy); cx -= st; ctx.lineTo(cx, cy); }
    ctx.lineTo(x, y + n * st); cx = x; cy = y + n * st;
    for (let i = 0; i < n; i++) { cx += st; ctx.lineTo(cx, cy); cy -= st; ctx.lineTo(cx, cy); }
    ctx.closePath();
  }
  function arch(ctx, x, y, w, h) {
    ctx.moveTo(x, y + h); ctx.lineTo(x, y + w / 2); ctx.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0); ctx.lineTo(x + w, y + h); ctx.closePath();
  }
  function hexagon(ctx, cx, cy, r) {
    for (let i = 0; i < 6; i++) { const a = -Math.PI / 2 + i * Math.PI / 3; ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    ctx.closePath();
  }
  function sparkle(ctx, cx, cy, r) { // four-point star
    ctx.moveTo(cx, cy - r);
    ctx.quadraticCurveTo(cx + r * 0.16, cy - r * 0.16, cx + r, cy);
    ctx.quadraticCurveTo(cx + r * 0.16, cy + r * 0.16, cx, cy + r);
    ctx.quadraticCurveTo(cx - r * 0.16, cy + r * 0.16, cx - r, cy);
    ctx.quadraticCurveTo(cx - r * 0.16, cy - r * 0.16, cx, cy - r);
    ctx.closePath();
  }
  function starPath(ctx, cx, cy, r, inner = 0.45, points = 5) {
    for (let i = 0; i < points * 2; i++) {
      const rad = i % 2 ? r * inner : r, a = -Math.PI / 2 + i * Math.PI / points;
      ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
    }
    ctx.closePath();
  }
  function spaced(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

  // ── CJK-aware text wrapping ───────────────────────────────────────────────
  const CJK_RE = /[⺀-鿿豈-﫿＀-￯　-〿]/;
  const TOKEN_RE = /[⺀-鿿豈-﫿＀-￯　-〿]|[^\s⺀-鿿豈-﫿＀-￯　-〿]+|\s+/g;
  const NO_LINE_START = '，。、！？；：」』）》〉】,.!?;:)]}…%';
  function ellipsize(ctx, s, maxW) {
    s = String(s);
    if (ctx.measureText(s).width <= maxW) return s;
    let base = [...s.replace(/…$/, '')];
    while (base.length && ctx.measureText(base.join('') + '…').width > maxW) base.pop();
    return base.join('').trimEnd() + '…';
  }
  function wrap(ctx, text, maxW, maxLines = 99) {
    const out = [];
    for (const para of String(text ?? '').replace(/\r/g, '').split('\n')) {
      const toks = para.match(TOKEN_RE) || [];
      let line = '';
      for (let t = 0; t < toks.length; t++) {
        const tok = toks[t];
        if (!line && /^\s+$/.test(tok)) continue;
        const next = line + tok;
        if (ctx.measureText(next).width <= maxW) { line = next; continue; }
        if (line && tok.length === 1 && NO_LINE_START.includes(tok)) { line = next; continue; } // kinsoku: hang punctuation
        if (!line) { // a single token wider than the line: break it by characters
          let part = '';
          for (const ch of tok) {
            if (part && ctx.measureText(part + ch).width > maxW) { out.push(part); part = ch; } else part += ch;
          }
          line = part; continue;
        }
        out.push(line.trimEnd());
        line = '';
        if (!/^\s+$/.test(tok)) t--; // re-run this token on the fresh line
      }
      out.push(line.trimEnd());
    }
    while (out.length > 1 && !out[out.length - 1]) out.pop();
    if (out.length > maxLines) {
      const cut = out.slice(0, maxLines);
      cut[maxLines - 1] = ellipsize(ctx, cut[maxLines - 1] + '…', maxW);
      return cut;
    }
    return out;
  }
  function fmtNum(v) {
    const s = String(v ?? '').trim();
    return /^\d{4,}$/.test(s) ? Number(s).toLocaleString('en-US') : s;
  }
  function fmtH(v) {
    const s = String(v ?? '').trim();
    const n = Number(s);
    if (s && Number.isFinite(n) && /\.\d{3,}/.test(s)) return n.toFixed(2);
    return s;
  }
  const numOrNull = v => { const s = String(v ?? '').trim(); const n = Number(s); return s && Number.isFinite(n) ? n : null; };

  // ── icons ─────────────────────────────────────────────────────────────────
  const STROKE_ICONS = new Set(['camera', 'bubble', 'link', 'pin']);
  const PATH = {
    candle(c, x, y, s) {
      c.moveTo(x + s * 0.5, y + s * 0.02);
      c.bezierCurveTo(x + s * 0.8, y + s * 0.28, x + s * 0.7, y + s * 0.45, x + s * 0.5, y + s * 0.46);
      c.bezierCurveTo(x + s * 0.3, y + s * 0.45, x + s * 0.2, y + s * 0.28, x + s * 0.5, y + s * 0.02);
      c.closePath();
      rr(c, x + s * 0.3, y + s * 0.54, s * 0.4, s * 0.43, s * 0.07);
    },
    heart(c, x, y, s) {
      c.moveTo(x + s * 0.5, y + s * 0.9);
      c.bezierCurveTo(x - s * 0.08, y + s * 0.5, x + s * 0.12, y + s * 0.02, x + s * 0.5, y + s * 0.26);
      c.bezierCurveTo(x + s * 0.88, y + s * 0.02, x + s * 1.08, y + s * 0.5, x + s * 0.5, y + s * 0.9);
      c.closePath();
    },
    diamond(c, x, y, s) {
      c.moveTo(x + s * 0.5, y + s * 0.04); c.lineTo(x + s * 0.88, y + s * 0.4); c.lineTo(x + s * 0.5, y + s * 0.96); c.lineTo(x + s * 0.12, y + s * 0.4); c.closePath();
    },
    star(c, x, y, s) { starPath(c, x + s / 2, y + s * 0.53, s * 0.5, 0.46); },
    spark(c, x, y, s) { sparkle(c, x + s / 2, y + s / 2, s * 0.5); },
    cape(c, x, y, s) {
      c.moveTo(x + s * 0.5 + s * 0.15, y + s * 0.2); c.arc(x + s * 0.5, y + s * 0.2, s * 0.15, 0, TAU); c.closePath();
      c.moveTo(x + s * 0.5, y + s * 0.38);
      c.quadraticCurveTo(x + s * 0.74, y + s * 0.4, x + s * 0.9, y + s * 0.94);
      c.quadraticCurveTo(x + s * 0.5, y + s * 0.84, x + s * 0.1, y + s * 0.94);
      c.quadraticCurveTo(x + s * 0.26, y + s * 0.4, x + s * 0.5, y + s * 0.38); c.closePath();
    },
    pin(c, x, y, s) {
      c.moveTo(x + s * 0.5, y + s * 0.95);
      c.bezierCurveTo(x + s * 0.2, y + s * 0.62, x + s * 0.16, y + s * 0.5, x + s * 0.16, y + s * 0.38);
      c.arc(x + s * 0.5, y + s * 0.38, s * 0.34, Math.PI, 0);
      c.bezierCurveTo(x + s * 0.84, y + s * 0.5, x + s * 0.8, y + s * 0.62, x + s * 0.5, y + s * 0.95); c.closePath();
      c.moveTo(x + s * 0.62, y + s * 0.38); c.arc(x + s * 0.5, y + s * 0.38, s * 0.12, 0, TAU);
    },
    camera(c, x, y, s) {
      rr(c, x + s * 0.1, y + s * 0.1, s * 0.8, s * 0.8, s * 0.24);
      c.moveTo(x + s * 0.68, y + s * 0.5); c.arc(x + s * 0.5, y + s * 0.5, s * 0.18, 0, TAU);
      c.moveTo(x + s * 0.72, y + s * 0.27); c.arc(x + s * 0.7, y + s * 0.27, s * 0.02, 0, TAU);
    },
    bubble(c, x, y, s) {
      c.moveTo(x + s * 0.3, y + s * 0.14);
      c.lineTo(x + s * 0.7, y + s * 0.14); c.quadraticCurveTo(x + s * 0.92, y + s * 0.14, x + s * 0.92, y + s * 0.38);
      c.lineTo(x + s * 0.92, y + s * 0.5); c.quadraticCurveTo(x + s * 0.92, y + s * 0.74, x + s * 0.7, y + s * 0.74);
      c.lineTo(x + s * 0.42, y + s * 0.74); c.lineTo(x + s * 0.24, y + s * 0.9); c.lineTo(x + s * 0.26, y + s * 0.73);
      c.quadraticCurveTo(x + s * 0.08, y + s * 0.7, x + s * 0.08, y + s * 0.5);
      c.lineTo(x + s * 0.08, y + s * 0.38); c.quadraticCurveTo(x + s * 0.08, y + s * 0.14, x + s * 0.3, y + s * 0.14); c.closePath();
      c.moveTo(x + s * 0.38, y + s * 0.44); c.arc(x + s * 0.35, y + s * 0.44, s * 0.03, 0, TAU);
      c.moveTo(x + s * 0.68, y + s * 0.44); c.arc(x + s * 0.65, y + s * 0.44, s * 0.03, 0, TAU);
    },
    link(c, x, y, s) {
      c.moveTo(x + s * 0.44, y + s * 0.3); c.lineTo(x + s * 0.56, y + s * 0.18);
      c.arc(x + s * 0.7, y + s * 0.32, s * 0.2, -Math.PI * 0.75, Math.PI * 0.25); c.lineTo(x + s * 0.7, y + s * 0.6);
      c.moveTo(x + s * 0.56, y + s * 0.7); c.lineTo(x + s * 0.44, y + s * 0.82);
      c.arc(x + s * 0.3, y + s * 0.68, s * 0.2, Math.PI * 0.25, Math.PI * 1.25); c.lineTo(x + s * 0.3, y + s * 0.4);
      c.moveTo(x + s * 0.38, y + s * 0.62); c.lineTo(x + s * 0.62, y + s * 0.38);
    }
  };
  // 9×9 bitmaps for the Pixel style: o = outline, a = colour, l = highlight, y = flame core, b = wax
  const BITMAPS = {
    candle: ['....a....', '...aya...', '...aya...', '....a....', '..ooooo..', '..obbbo..', '..olbbo..', '..obbbo..', '..ooooo..'],
    heart: ['.........', '.oo...oo.', 'oaao.oaao', 'oalaoaaao', 'oaaaaaaao', '.oaaaaao.', '..oaaao..', '...oao...', '....o....'],
    diamond: ['....o....', '...oao...', '..olaao..', '.ollaaao.', 'oaaaaaaao', '.oaaaaao.', '..oaaao..', '...oao...', '....o....'],
    star: ['....o....', '...oao...', 'ooooaoooo', 'oaalaaaao', '.oaaaaao.', '..oaaao..', '.oaaoaao.', '.oao.oao.', '.oo...oo.'],
    spark: ['....o....', '...oao...', '...oao...', '.ooaaaoo.', 'oaaalaaao', '.ooaaaoo.', '...oao...', '...oao...', '....o....'],
    cape: ['...ooo...', '..oaaao..', '..oalao..', '...ooo...', '..oaaao..', '.oaaaaao.', '.oaaaaao.', 'oaaaaaaao', 'ooooooooo'],
    pin: ['..ooooo..', '.oaaaaao.', 'oaaoooaao', 'oaao.oaao', 'oaaoooaao', '.oaaaaao.', '..oaaao..', '...oao...', '....o....'],
    camera: ['.ooooooo.', 'oaaaaaala', 'oaaoooaao', 'oaoaaaoao', 'oaoalaoao', 'oaoaaaoao', 'oaaoooaao', 'oaaaaaaao', '.ooooooo.'],
    bubble: ['.ooooooo.', 'oaaaaaaao', 'oaoaaaoao', 'oaaaaaaao', 'oaaoooaao', 'oaaaaaaao', '.oooaooo.', '...oao...', '....o....'],
    link: ['.....ooo.', '....oaaao', '....oa.ao', '...oaaao.', '..oaaao..', '.oaaao...', 'oa.ao....', 'oaaao....', '.ooo.....']
  };

  function drawIcon(ctx, g, name, x, y, s, color) {
    const S = g.S;
    if (S.iconMode === 'pixel') return pixelIcon(ctx, g, name, x, y, s, color);
    ctx.save();
    ctx.beginPath(); PATH[name](ctx, x, y, s);
    if (S.iconGlow) { ctx.shadowColor = color; ctx.shadowBlur = s * 0.45; }
    if (S.iconMode === 'line' || STROKE_ICONS.has(name)) {
      ctx.lineWidth = Math.max(1, s * (S.iconMode === 'line' ? (S.iconStroke || 0.075) : 0.095));
      ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.strokeStyle = color; ctx.stroke();
    } else {
      ctx.fillStyle = color; ctx.fill();
      if (name === 'diamond' || name === 'candle') { // a little facet / flame core
        ctx.beginPath();
        if (name === 'diamond') { ctx.moveTo(x + s * 0.5, y + s * 0.18); ctx.lineTo(x + s * 0.68, y + s * 0.4); ctx.lineTo(x + s * 0.5, y + s * 0.4); }
        else { ctx.ellipse(x + s * 0.5, y + s * 0.32, s * 0.07, s * 0.11, 0, 0, TAU); }
        ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fill();
      }
    }
    ctx.restore();
  }
  function pixelIcon(ctx, g, name, x, y, s, color) {
    const bm = BITMAPS[name]; if (!bm) return;
    const cell = Math.max(1, Math.round(s / 9));
    const ox = Math.round(x + (s - cell * 9) / 2), oy = Math.round(y + (s - cell * 9) / 2);
    const map = { o: g.pal.edge || '#14142b', a: color, l: 'rgba(255,255,255,.8)', y: '#fff3b0', b: '#fff8e8' };
    for (let r = 0; r < 9; r++) for (let c = 0; c < 9; c++) {
      const ch = bm[r][c]; if (ch === '.') continue;
      ctx.fillStyle = map[ch]; ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
    }
  }

  // avatar fill (cover) or a drawn placeholder
  let avatarCache = { src: '', img: null, pix: null };
  function getAvatar() { return avatarCache.src && avatarCache.src === state.data.avatar ? avatarCache.img : null; }
  function syncAvatar() {
    const src = state.data.avatar || '';
    if (src === avatarCache.src) return;
    avatarCache = { src, img: null, pix: null };
    if (!src) { requestRender(); return; }
    loadImage(src).then(img => { if (avatarCache.src === src) { avatarCache.img = img; requestRender(); } })
      .catch(() => { if (avatarCache.src === src) avatarCache.src = ''; });
  }
  function pixelated(img) {
    if (avatarCache.pix) return avatarCache.pix;
    const c = document.createElement('canvas'); c.width = c.height = 36;
    const x = c.getContext('2d'); x.imageSmoothingEnabled = true;
    const s = Math.min(img.width, img.height);
    x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 36, 36);
    return (avatarCache.pix = c);
  }
  function avatarFill(ctx, g, img, x, y, w, h = w) {
    if (img) {
      const pix = g.S.iconMode === 'pixel';
      const src = pix ? pixelated(img) : img;
      const iw = src.width, ih = src.height, s = Math.min(iw / w, ih / h);
      ctx.save(); ctx.imageSmoothingEnabled = !pix;
      ctx.drawImage(src, (iw - w * s) / 2, (ih - h * s) / 2, w * s, h * s, x, y, w, h);
      ctx.restore();
      return;
    }
    const p = g.pal;
    const gr = ctx.createLinearGradient(x, y, x + w * 0.4, y + h);
    gr.addColorStop(0, mix(p.accent, '#ffffff', 0.25)); gr.addColorStop(1, mix(p.accent, p.bg[2], 0.55));
    ctx.fillStyle = g.S.iconMode === 'pixel' ? p.accent : gr; ctx.fillRect(x, y, w, h);
    const s = Math.min(w, h) * 0.46;
    drawIcon(ctx, g, 'candle', x + (w - s) / 2, y + (h - s) / 2, s, g.S.iconMode === 'pixel' ? '#ffffff' : 'rgba(255,255,255,.9)');
  }

  // paper tape strip with zig-zag ends
  function tape(ctx, cx, cy, w, h, ang, color) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(ang);
    const teeth = 4, th = h / teeth, zz = h * 0.12;
    ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2, -h / 2);
    for (let i = 0; i < teeth; i++) { ctx.lineTo(w / 2 - zz, -h / 2 + th * (i + 0.5)); ctx.lineTo(w / 2, -h / 2 + th * (i + 1)); }
    ctx.lineTo(-w / 2, h / 2);
    for (let i = teeth - 1; i >= 0; i--) { ctx.lineTo(-w / 2 + zz, -h / 2 + th * (i + 0.5)); ctx.lineTo(-w / 2, -h / 2 + th * i); }
    ctx.closePath();
    ctx.shadowColor = 'rgba(0,0,0,.12)'; ctx.shadowBlur = h * 0.15; ctx.shadowOffsetY = h * 0.05;
    ctx.fillStyle = color; ctx.fill();
    ctx.shadowColor = 'transparent'; ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = h * 0.16;
    for (let sx = -w / 2 - h; sx < w / 2 + h; sx += h * 0.55) { ctx.beginPath(); ctx.moveTo(sx, h / 2); ctx.lineTo(sx + h, -h / 2); ctx.stroke(); }
    ctx.restore();
  }
  // hand-drawn rectangle (two loose passes)
  function roughRect(ctx, x, y, w, h, r, j) {
    for (let pass = 0; pass < 2; pass++) {
      const J = () => (r() - 0.5) * j;
      ctx.beginPath();
      ctx.moveTo(x + J(), y + J());
      ctx.quadraticCurveTo(x + w / 2 + J(), y + J() * 0.6, x + w + J(), y + J());
      ctx.quadraticCurveTo(x + w + J() * 0.6, y + h / 2 + J(), x + w + J(), y + h + J());
      ctx.quadraticCurveTo(x + w / 2 + J(), y + h + J() * 0.6, x + J(), y + h + J());
      ctx.quadraticCurveTo(x + J() * 0.6, y + h / 2 + J(), x + J() + j * 0.3, y + J());
      ctx.stroke();
    }
  }
  function wobbleLine(ctx, x1, y, x2, r, amp) {
    ctx.beginPath(); ctx.moveTo(x1, y + (r() - 0.5) * amp);
    const seg = Math.max(2, Math.round((x2 - x1) / 60));
    for (let i = 1; i <= seg; i++) {
      const px = x1 + (x2 - x1) * i / seg, mx = px - (x2 - x1) / seg / 2;
      ctx.quadraticCurveTo(mx, y + (r() - 0.5) * amp * 2, px, y + (r() - 0.5) * amp);
    }
    ctx.stroke();
  }

  // ── styles ────────────────────────────────────────────────────────────────
  const BASE = {
    iconMode: 'fill', profileAlign: 'left', avatarH: 1, tileAlign: 'left',
    headH: 64, ip: 34, gap: 26, titleH: 54, footH: 60, radiusK: 0.55,
    clip(ctx, g, W, H) { rr(ctx, 0, 0, W, H, g.R); },
    background(ctx, g, W, H) {
      const p = g.pal, gr = ctx.createLinearGradient(0, 0, W * 0.35, H);
      gr.addColorStop(0, p.bg[0]); gr.addColorStop(0.55, p.bg[1]); gr.addColorStop(1, p.bg[2]);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    },
    header(ctx, g, x, y, w, h) {
      const p = g.pal, u = g.u, cy = y + h * 0.4;
      drawIcon(ctx, g, 'candle', x, cy - 14 * u, 28 * u, p.accent);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.font = g.font('label', 15); spaced(ctx, 3.5 * u); ctx.fillStyle = p.text;
      ctx.fillText('PROFILE CARD', x + 40 * u, cy);
      if (g.st.settings.date) { ctx.textAlign = 'right'; ctx.fillStyle = p.muted; ctx.fillText(g.date, x + w, cy); }
      spaced(ctx, 0); ctx.textAlign = 'left';
    },
    panel(ctx, g, x, y, w, h) {
      ctx.beginPath(); rr(ctx, x, y, w, h, g.pr); ctx.fillStyle = g.pal.panel; ctx.fill();
      ctx.lineWidth = 1.5 * g.k; ctx.strokeStyle = g.pal.line; ctx.stroke();
    },
    title(ctx, g, x, y, w, label, en) {
      const p = g.pal, u = g.u, cy = y + 17 * u;
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.font = g.font('title', 26); ctx.fillStyle = p.accent; ctx.fillText(label, x, cy);
      const lw = ctx.measureText(label).width;
      ctx.font = `italic 400 ${22 * u}px ${F.iserif}`; const ew = ctx.measureText(en).width;
      ctx.fillStyle = p.muted; ctx.textAlign = 'right'; ctx.fillText(en, x + w, cy + u);
      ctx.fillStyle = p.line; ctx.fillRect(x + lw + 16 * g.k, cy + u, Math.max(0, w - lw - ew - 32 * g.k), Math.max(1, 1.2 * g.k));
      ctx.textAlign = 'left';
    },
    tile(ctx, g, x, y, w, h) { ctx.beginPath(); rr(ctx, x, y, w, h, g.pr * 0.7); ctx.fillStyle = alpha(g.pal.accent, 0.09); ctx.fill(); },
    chip(ctx, g, x, y, w, h) {
      ctx.beginPath(); rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = alpha(g.pal.accent, 0.1); ctx.fill();
      ctx.lineWidth = 1.4 * g.k; ctx.strokeStyle = alpha(g.pal.accent, 0.38); ctx.stroke();
    },
    bar(ctx, g, x, y, w, p) {
      const pal = g.pal, h = 12 * g.u;
      ctx.beginPath(); rr(ctx, x, y - h / 2, w, h, h / 2); ctx.fillStyle = alpha(pal.text, 0.1); ctx.fill();
      if (p === null) return;
      const gr = ctx.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, alpha(pal.accent, 0.35)); gr.addColorStop(1, pal.accent);
      ctx.beginPath(); rr(ctx, x, y - h / 2, Math.max(h, w * p), h, h / 2); ctx.fillStyle = gr; ctx.fill();
      ctx.beginPath(); ctx.arc(x + w * p, y, h * 1.05, 0, TAU); ctx.fillStyle = pal.text; ctx.fill();
      ctx.lineWidth = 3 * g.k; ctx.strokeStyle = pal.accent; ctx.stroke();
    },
    rule(ctx, g, x, y, w) { ctx.fillStyle = g.pal.line; ctx.fillRect(x, y, w, Math.max(1, g.k)); },
    avatar(ctx, g, x, y, s, img) {
      const p = g.pal, cx = x + s / 2, cy = y + s / 2, r = s / 2 - 9 * g.k;
      ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip(); avatarFill(ctx, g, img, cx - r, cy - r, r * 2); ctx.restore();
      ctx.lineWidth = 2.5 * g.k; ctx.strokeStyle = p.accent; ctx.beginPath(); ctx.arc(cx, cy, s / 2 - 1.5 * g.k, 0, TAU); ctx.stroke();
    },
    drawName(ctx, g, text, x, y) { ctx.fillStyle = g.pal.text; ctx.fillText(text, x, y); },
    badge(ctx, g, x, y, w, h) { ctx.beginPath(); rr(ctx, x, y, w, h, Math.min(h / 2, 7 * g.k)); ctx.fillStyle = g.pal.accent; ctx.fill(); },
    overlay() {},
    footer(ctx, g, x, y, w, h) {
      const p = g.pal, u = g.u, cy = y + h / 2;
      ctx.font = g.font('label', 14); spaced(ctx, 2 * u); ctx.textBaseline = 'middle';
      const t = 'made with candle·kit', tw = ctx.measureText(t).width, s = 20 * u, sx = x + (w - tw - s - 10 * u) / 2;
      ctx.globalAlpha = 0.75; drawIcon(ctx, g, 'candle', sx, cy - s / 2, s, p.accent);
      ctx.fillStyle = p.muted; ctx.textAlign = 'left'; ctx.fillText(t, sx + s + 10 * u, cy);
      ctx.globalAlpha = 1; spaced(ctx, 0);
    }
  };

  const STYLES = {
    // ── 經典 Classic: warm amber & copper, serif titles, sun glow, double rule frame
    classic: {
      name: '經典', en: 'Classic',
      fonts: { display: [700, F.serif], title: [700, F.serif], body: [500, F.sans], strong: [800, F.sans], num: [800, F.sans], label: [500, F.mono], mono: [500, F.mono], hand: [700, F.hand] },
      variants: [
        { name: '琥珀', bg: ['#fbf1e1', '#f3d3a6', '#e3a46b'], text: '#3a2415', muted: '#8a6446', panel: 'rgba(255,250,240,.68)', line: 'rgba(122,72,32,.2)', accent: '#b45f27' },
        { name: '銅夜', bg: ['#3d261a', '#2a1911', '#140c08'], text: '#fbecd9', muted: '#cfa883', panel: 'rgba(255,232,200,.07)', line: 'rgba(255,205,150,.2)', accent: '#e8a05c', dark: true },
        { name: '蜜桃', bg: ['#fff6ef', '#fbdccb', '#efb091'], text: '#40231a', muted: '#93624f', panel: 'rgba(255,252,248,.72)', line: 'rgba(150,80,50,.18)', accent: '#c4553a' }
      ],
      background(ctx, g, W, H) {
        BASE.background(ctx, g, W, H);
        const p = g.pal, r = rng(11);
        const sun = ctx.createRadialGradient(W * 0.86, H * 0.04, 0, W * 0.86, H * 0.04, W * 0.75);
        sun.addColorStop(0, p.dark ? alpha(p.accent, 0.32) : 'rgba(255,236,196,.9)'); sun.addColorStop(1, 'rgba(255,236,196,0)');
        ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
        ctx.lineWidth = 1.4 * g.k; ctx.strokeStyle = alpha(p.accent, p.dark ? 0.12 : 0.16);
        for (let i = 0; i < 7; i++) { ctx.beginPath(); ctx.arc(-W * 0.04, H * 1.02, W * (0.22 + i * 0.085), -Math.PI / 2, 0); ctx.stroke(); }
        for (let i = 0; i < 16; i++) {
          ctx.beginPath(); sparkle(ctx, r() * W, r() * H, (4 + r() * 9) * g.k);
          ctx.fillStyle = alpha(p.accent, 0.18 + r() * 0.25); ctx.fill();
        }
      },
      overlay(ctx, g, W, H) {
        const p = g.pal, i1 = g.P * 0.42, i2 = i1 + 7 * g.k;
        ctx.lineWidth = 1.6 * g.k; ctx.strokeStyle = alpha(p.accent, 0.4);
        ctx.beginPath(); rr(ctx, i1, i1, W - i1 * 2, H - i1 * 2, Math.max(0, g.R - i1 * 0.6)); ctx.stroke();
        ctx.lineWidth = g.k; ctx.strokeStyle = alpha(p.accent, 0.2);
        ctx.beginPath(); rr(ctx, i2, i2, W - i2 * 2, H - i2 * 2, Math.max(0, g.R - i2 * 0.6)); ctx.stroke();
      }
    },

    // ── 墨夜 Noir: olive black, muted gold hairlines, centred editorial profile
    noir: {
      name: '墨夜', en: 'Noir', iconMode: 'line', iconStroke: 0.065, profileAlign: 'center', tileAlign: 'center', chipAlign: 'center',
      headH: 92, ip: 36, gap: 24, titleH: 50, radiusK: 0.18,
      fonts: { display: [700, F.serif], title: [500, F.mono], body: [500, F.tc], strong: [700, F.serif], num: [400, F.iserif], label: [500, F.mono], mono: [500, F.mono], hand: [700, F.hand] },
      variants: [
        { name: '橄欖', bg: ['#22251a', '#16180f', '#0b0c07'], text: '#ede5cf', muted: '#a49c84', panel: 'rgba(237,229,207,.025)', line: 'rgba(201,168,92,.4)', accent: '#c9a85c', dark: true },
        { name: '炭灰', bg: ['#232325', '#151516', '#09090a'], text: '#ece8df', muted: '#9d978b', panel: 'rgba(255,255,255,.025)', line: 'rgba(201,168,92,.4)', accent: '#c8a660', dark: true },
        { name: '墨綠', bg: ['#14271f', '#0d1a15', '#060d0a'], text: '#e8e6d4', muted: '#93a091', panel: 'rgba(232,230,212,.025)', line: 'rgba(206,178,102,.4)', accent: '#ceb266', dark: true }
      ],
      background(ctx, g, W, H) {
        const p = g.pal;
        ctx.fillStyle = p.bg[1]; ctx.fillRect(0, 0, W, H);
        const top = ctx.createRadialGradient(W / 2, H * 0.12, 0, W / 2, H * 0.12, Math.max(W, H) * 0.7);
        top.addColorStop(0, p.bg[0]); top.addColorStop(1, alpha(p.bg[0], 0)); ctx.fillStyle = top; ctx.fillRect(0, 0, W, H);
        const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
        vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, alpha(p.bg[2], 0.85)); ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
        ctx.save(); ctx.strokeStyle = alpha(p.accent, 0.035); ctx.lineWidth = g.k;
        for (let d = -H; d < W; d += 16 * g.k) { ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + H, H); ctx.stroke(); }
        ctx.restore();
        // a thin moon in the corner
        const mx = W * 0.86, my = g.P + 30 * g.k, mr = W * 0.16;
        ctx.lineWidth = 1.2 * g.k; ctx.strokeStyle = alpha(p.accent, 0.22); ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.stroke();
        ctx.beginPath(); ctx.arc(mx, my, mr * 0.9, Math.PI * 0.62, Math.PI * 1.38); ctx.arc(mx - mr * 0.28, my, mr * 0.78, Math.PI * 1.32, Math.PI * 0.68, true);
        ctx.closePath(); ctx.fillStyle = alpha(p.accent, 0.1); ctx.fill();
        const r = rng(7);
        for (let i = 0; i < 26; i++) { ctx.beginPath(); sparkle(ctx, r() * W, r() * H, (2 + r() * 5) * g.k); ctx.fillStyle = alpha(p.accent, 0.15 + r() * 0.35); ctx.fill(); }
      },
      header(ctx, g, x, y, w, h) {
        const p = g.pal, u = g.u, cx = x + w / 2, cy = y + 20 * u;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.font = g.font('label', 15); spaced(ctx, 7 * u); ctx.fillStyle = p.accent;
        const t = 'PROFILE CARD', tw = ctx.measureText(t).width;
        ctx.fillText(t, cx + 3.5 * u, cy);
        spaced(ctx, 0);
        const gap = tw / 2 + 28 * u;
        ctx.fillStyle = alpha(p.accent, 0.55);
        ctx.fillRect(x + w * 0.08, cy, cx - gap - x - w * 0.08 - 14 * u, g.k); ctx.fillRect(cx + gap + 14 * u, cy, x + w * 0.92 - cx - gap - 14 * u, g.k);
        [cx - gap, cx + gap].forEach(dx => { ctx.beginPath(); ctx.moveTo(dx, cy - 6 * u); ctx.lineTo(dx + 6 * u, cy); ctx.lineTo(dx, cy + 6 * u); ctx.lineTo(dx - 6 * u, cy); ctx.closePath(); ctx.fill(); });
        if (g.st.settings.date) {
          ctx.font = `italic 400 ${22 * u}px ${F.iserif}`; ctx.fillStyle = p.muted; ctx.fillText(g.date, cx, cy + 36 * u);
        }
        ctx.textAlign = 'left';
      },
      panel(ctx, g, x, y, w, h) {
        const p = g.pal, k = g.k, r = Math.min(g.pr, 10 * k);
        ctx.beginPath(); rr(ctx, x, y, w, h, r); ctx.fillStyle = p.panel; ctx.fill();
        ctx.lineWidth = 1.2 * k; ctx.strokeStyle = alpha(p.accent, 0.5); ctx.stroke();
        ctx.beginPath(); rr(ctx, x + 6 * k, y + 6 * k, w - 12 * k, h - 12 * k, Math.max(0, r - 4 * k)); ctx.lineWidth = k; ctx.strokeStyle = alpha(p.accent, 0.16); ctx.stroke();
        const d = 5 * k; ctx.fillStyle = p.accent;
        [[x + w / 2, y], [x + w / 2, y + h]].forEach(([cx, cy]) => { ctx.beginPath(); ctx.moveTo(cx, cy - d); ctx.lineTo(cx + d, cy); ctx.lineTo(cx, cy + d); ctx.lineTo(cx - d, cy); ctx.closePath(); ctx.fill(); });
      },
      title(ctx, g, x, y, w, label, en) {
        const p = g.pal, u = g.u, cy = y + 15 * u, cx = x + w / 2;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.font = g.font('title', 17); spaced(ctx, 5 * u);
        const t = `${label} · ${en.toUpperCase()}`, tw = Math.min(w * 0.8, ctx.measureText(t).width);
        ctx.fillStyle = p.accent; ctx.fillText(ellipsize(ctx, t, w * 0.8), cx + 2.5 * u, cy); spaced(ctx, 0);
        const l = (w - tw) / 2 - 22 * u;
        if (l > 10) {
          let gr = ctx.createLinearGradient(x, 0, x + l, 0); gr.addColorStop(0, alpha(p.accent, 0)); gr.addColorStop(1, alpha(p.accent, 0.55));
          ctx.fillStyle = gr; ctx.fillRect(x, cy, l, g.k);
          gr = ctx.createLinearGradient(x + w - l, 0, x + w, 0); gr.addColorStop(0, alpha(p.accent, 0.55)); gr.addColorStop(1, alpha(p.accent, 0));
          ctx.fillStyle = gr; ctx.fillRect(x + w - l, cy, l, g.k);
        }
        ctx.textAlign = 'left';
      },
      tile(ctx, g, x, y, w, h, i, col, cols) {
        if (col < cols - 1) { ctx.fillStyle = alpha(g.pal.accent, 0.3); ctx.fillRect(x + w + g.tileGap / 2, y + h * 0.15, g.k, h * 0.7); }
      },
      chip(ctx, g, x, y, w, h) { ctx.beginPath(); ctx.rect(x, y, w, h); ctx.lineWidth = g.k; ctx.strokeStyle = alpha(g.pal.accent, 0.5); ctx.stroke(); },
      bar(ctx, g, x, y, w, p) {
        const pal = g.pal, k = g.k;
        ctx.fillStyle = alpha(pal.accent, 0.35); ctx.fillRect(x, y - 0.5 * k, w, k);
        ctx.fillRect(x, y - 8 * k, k, 16 * k); ctx.fillRect(x + w - k, y - 8 * k, k, 16 * k);
        for (let i = 1; i < 10; i++) ctx.fillRect(x + w * i / 10, y - 4 * k, k, 8 * k);
        if (p === null) return;
        ctx.fillStyle = pal.accent; ctx.fillRect(x, y - 1.5 * k, w * p, 3 * k);
        const d = 11 * g.u, cx = x + w * p;
        ctx.beginPath(); ctx.moveTo(cx, y - d); ctx.lineTo(cx + d * 0.7, y); ctx.lineTo(cx, y + d); ctx.lineTo(cx - d * 0.7, y); ctx.closePath(); ctx.fill();
      },
      avatar(ctx, g, x, y, s, img) {
        const p = g.pal, k = g.k, aw = s * 0.76, ax = x + (s - aw) / 2;
        ctx.beginPath(); arch(ctx, ax - 9 * k, y - 9 * k, aw + 18 * k, s + 9 * k); ctx.lineWidth = 1.2 * k; ctx.strokeStyle = alpha(p.accent, 0.6); ctx.stroke();
        ctx.save(); ctx.beginPath(); arch(ctx, ax, y, aw, s - 0 * k); ctx.clip(); avatarFill(ctx, g, img, ax, y, aw, s); ctx.restore();
        ctx.fillStyle = p.accent; ctx.fillRect(ax - 22 * k, y + s, aw + 44 * k, 1.2 * k);
      },
      overlay(ctx, g, W, H) {
        const p = g.pal, k = g.k, i1 = g.P * 0.38, i2 = i1 + 7 * k;
        ctx.lineWidth = 1.5 * k; ctx.strokeStyle = alpha(p.accent, 0.55); ctx.strokeRect(i1, i1, W - i1 * 2, H - i1 * 2);
        ctx.lineWidth = k; ctx.strokeStyle = alpha(p.accent, 0.22); ctx.strokeRect(i2, i2, W - i2 * 2, H - i2 * 2);
        const L = 26 * k; ctx.lineWidth = 2 * k; ctx.strokeStyle = p.accent;
        [[i1, i1, 1, 1], [W - i1, i1, -1, 1], [i1, H - i1, 1, -1], [W - i1, H - i1, -1, -1]].forEach(([cx, cy, sx, sy]) => {
          ctx.beginPath(); ctx.moveTo(cx, cy + sy * L); ctx.lineTo(cx, cy); ctx.lineTo(cx + sx * L, cy); ctx.stroke();
          ctx.beginPath(); const d = 4 * k, ox = cx + sx * 14 * k, oy = cy + sy * 14 * k;
          ctx.moveTo(ox, oy - d); ctx.lineTo(ox + d, oy); ctx.lineTo(ox, oy + d); ctx.lineTo(ox - d, oy); ctx.closePath(); ctx.fillStyle = p.accent; ctx.fill();
        });
      },
      footer(ctx, g, x, y, w, h) {
        const p = g.pal, u = g.u, cy = y + h / 2;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
        ctx.font = `italic 400 ${22 * u}px ${F.iserif}`; ctx.fillStyle = p.muted;
        ctx.fillText('— made with candle·kit —', x + w / 2, cy); ctx.textAlign = 'left';
      }
    },

    // ── 稜鏡 Prism: pearl white, holographic pastel blobs, frosted glass panels
    prism: {
      name: '稜鏡', en: 'Prism', gap: 24, radiusK: 0.62,
      fonts: { display: [800, F.sans], title: [800, F.sans], body: [500, F.sans], strong: [800, F.sans], num: [800, F.sans], label: [700, F.mono], mono: [500, F.mono], hand: [700, F.hand] },
      variants: [
        { name: '珍珠', bg: ['#fdfcff', '#f6f2ff', '#eef6ff'], blobs: ['#ffc8e6', '#d6caff', '#bff0e0', '#ffdcbc'], text: '#28233d', muted: '#7a7393', panel: 'rgba(255,255,255,.62)', line: 'rgba(80,60,140,.12)', accent: '#7b5cff', accent2: '#ff6fae' },
        { name: '薄荷', bg: ['#f6fffc', '#eefbf7', '#f1f9ff'], blobs: ['#b6f0dd', '#c4e8ff', '#fff0a8', '#ddd2ff'], text: '#1d3330', muted: '#5f7d78', panel: 'rgba(255,255,255,.62)', line: 'rgba(30,110,100,.13)', accent: '#0f9e86', accent2: '#2f8cff' },
        { name: '夕霧', bg: ['#fff8fb', '#fff0f5', '#fbf2ff'], blobs: ['#ffc4da', '#ffd5b8', '#e2ccff', '#cbe4ff'], text: '#3a2233', muted: '#8f6b80', panel: 'rgba(255,255,255,.6)', line: 'rgba(140,60,100,.13)', accent: '#e8478d', accent2: '#ff9a52' }
      ],
      background(ctx, g, W, H) {
        BASE.background(ctx, g, W, H);
        const p = g.pal, r = rng(23);
        const spots = [[0.1, 0.08], [0.92, 0.22], [0.18, 0.62], [0.86, 0.78], [0.5, 0.42], [0.3, 0.98]];
        spots.forEach(([sx, sy], i) => {
          const cx = sx * W, cy = sy * H, rad = W * (0.42 + r() * 0.28);
          const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
          gr.addColorStop(0, alpha(p.blobs[i % 4], 0.85)); gr.addColorStop(1, alpha(p.blobs[i % 4], 0));
          ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
        });
        ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(-0.5);
        const D = Math.hypot(W, H);
        [[-0.3, 0.12], [0.02, 0.05], [0.24, 0.09]].forEach(([o, bw]) => {
          const gr = ctx.createLinearGradient(o * D - bw * D / 2, 0, o * D + bw * D / 2, 0);
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = gr; ctx.fillRect(o * D - bw * D / 2, -D / 2, bw * D, D);
        });
        const holo = ctx.createLinearGradient(-D / 2, 0, D / 2, 0);
        ['#ff9ad5', '#ffe08a', '#9df2c8', '#8fd3ff', '#c7a6ff', '#ff9ad5'].forEach((c, i, a) => holo.addColorStop(i / (a.length - 1), alpha(c, 0.12)));
        ctx.fillStyle = holo; ctx.fillRect(-D / 2, -D / 2, D, D);
        ctx.restore();
        for (let i = 0; i < 18; i++) {
          const x = r() * W, y = r() * H, s = (5 + r() * 12) * g.k;
          ctx.save(); ctx.shadowColor = alpha(p.blobs[i % 4], 1); ctx.shadowBlur = s * 1.6;
          ctx.beginPath(); sparkle(ctx, x, y, s); ctx.fillStyle = 'rgba(255,255,255,.95)'; ctx.fill(); ctx.restore();
        }
      },
      header(ctx, g, x, y, w, h) {
        const p = g.pal, u = g.u, cy = y + h * 0.4;
        ctx.font = g.font('label', 14); spaced(ctx, 2.5 * u);
        const t = 'PRISM ID', tw = ctx.measureText(t).width + 30 * u, bh = 34 * u;
        const gr = ctx.createLinearGradient(x, 0, x + tw, 0); gr.addColorStop(0, p.accent); gr.addColorStop(1, p.accent2);
        ctx.beginPath(); rr(ctx, x, cy - bh / 2, tw, bh, bh / 2); ctx.fillStyle = gr; ctx.fill();
        ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.fillText(t, x + tw / 2 + 1.25 * u, cy);
        ctx.textAlign = 'left'; ctx.fillStyle = p.muted; ctx.fillText('PROFILE CARD', x + tw + 16 * u, cy);
        if (g.st.settings.date) { ctx.textAlign = 'right'; ctx.fillText(g.date, x + w, cy); }
        spaced(ctx, 0); ctx.textAlign = 'left';
      },
      panel(ctx, g, x, y, w, h) {
        const p = g.pal, k = g.k;
        ctx.save(); ctx.shadowColor = alpha(p.accent, 0.16); ctx.shadowBlur = 34 * k; ctx.shadowOffsetY = 12 * k;
        ctx.beginPath(); rr(ctx, x, y, w, h, g.pr); ctx.fillStyle = p.panel; ctx.fill(); ctx.restore();
        const gr = ctx.createLinearGradient(x, y, x + w, y + h);
        [p.blobs[0], p.blobs[1], p.blobs[2], p.blobs[3]].forEach((c, i) => gr.addColorStop(i / 3, mix(c, p.accent, 0.12)));
        ctx.beginPath(); rr(ctx, x, y, w, h, g.pr); ctx.lineWidth = 2.2 * k; ctx.strokeStyle = gr; ctx.stroke();
        ctx.beginPath(); rr(ctx, x + 3 * k, y + 3 * k, w - 6 * k, h - 6 * k, Math.max(0, g.pr - 3 * k)); ctx.lineWidth = k; ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.stroke();
      },
      title(ctx, g, x, y, w, label, en, i) {
        const p = g.pal, u = g.u, cy = y + 17 * u;
        const dot = ctx.createLinearGradient(x, cy - 8 * u, x + 16 * u, cy + 8 * u); dot.addColorStop(0, p.accent); dot.addColorStop(1, p.accent2);
        ctx.beginPath(); sparkle(ctx, x + 9 * u, cy, 10 * u); ctx.fillStyle = dot; ctx.fill();
        ctx.font = g.font('title', 26); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const lw = ctx.measureText(label).width, tx = x + 28 * u;
        const gr = ctx.createLinearGradient(tx, 0, tx + lw, 0); gr.addColorStop(0, p.accent); gr.addColorStop(1, p.accent2);
        ctx.fillStyle = gr; ctx.fillText(label, tx, cy);
        ctx.font = g.font('label', 13); spaced(ctx, 2.5 * u); ctx.fillStyle = p.muted; ctx.textAlign = 'right';
        ctx.fillText(String(i + 1).padStart(2, '0') + ' / ' + en.toUpperCase(), x + w, cy); spaced(ctx, 0); ctx.textAlign = 'left';
      },
      tile(ctx, g, x, y, w, h, i) {
        const p = g.pal, c = p.blobs[i % 4];
        const gr = ctx.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, alpha(c, 0.75)); gr.addColorStop(1, alpha(p.blobs[(i + 1) % 4], 0.45));
        ctx.beginPath(); rr(ctx, x, y, w, h, g.pr * 0.75); ctx.fillStyle = gr; ctx.fill();
        ctx.lineWidth = 1.4 * g.k; ctx.strokeStyle = 'rgba(255,255,255,.85)'; ctx.stroke();
        ctx.beginPath(); ctx.arc(x + 20 * g.k + 17 * g.u, y + 20 * g.k + 17 * g.u, 25 * g.u, 0, TAU); ctx.fillStyle = 'rgba(255,255,255,.8)'; ctx.fill();
      },
      tileIcon: 'inset',
      chip(ctx, g, x, y, w, h, kind, i) {
        const p = g.pal, gr = ctx.createLinearGradient(x, y, x + w, y + h);
        gr.addColorStop(0, alpha(p.blobs[i % 4], 0.9)); gr.addColorStop(1, alpha(p.blobs[(i + 1) % 4], 0.9));
        ctx.beginPath(); rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = gr; ctx.fill();
        ctx.lineWidth = 1.4 * g.k; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.stroke();
      },
      bar(ctx, g, x, y, w, p) {
        const pal = g.pal, h = 16 * g.u;
        ctx.beginPath(); rr(ctx, x, y - h / 2, w, h, h / 2); ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fill();
        ctx.lineWidth = g.k; ctx.strokeStyle = pal.line; ctx.stroke();
        if (p === null) return;
        const gr = ctx.createLinearGradient(x, 0, x + w, 0);
        pal.blobs.forEach((c, i) => gr.addColorStop(i / 3, mix(c, pal.accent, 0.25)));
        ctx.beginPath(); rr(ctx, x + 3 * g.k, y - h / 2 + 3 * g.k, Math.max(h, (w - 6 * g.k) * p), h - 6 * g.k, h / 2); ctx.fillStyle = gr; ctx.fill();
        ctx.save(); ctx.shadowColor = alpha(pal.accent, 0.35); ctx.shadowBlur = 12 * g.k;
        ctx.beginPath(); ctx.arc(x + w * p, y, h * 0.95, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.restore();
        ctx.lineWidth = 3 * g.k; ctx.strokeStyle = pal.accent; ctx.beginPath(); ctx.arc(x + w * p, y, h * 0.95, 0, TAU); ctx.stroke();
      },
      avatar(ctx, g, x, y, s, img) {
        const p = g.pal, k = g.k, cx = x + s / 2, cy = y + s / 2;
        let ring;
        if (ctx.createConicGradient) {
          ring = ctx.createConicGradient(0, cx, cy);
          ['#ff9ad5', '#ffd27a', '#8ff0c4', '#7cc8ff', '#b99bff', '#ff9ad5'].forEach((c, i, a) => ring.addColorStop(i / (a.length - 1), c));
        } else ring = p.accent;
        ctx.beginPath(); ctx.arc(cx, cy, s / 2 - 4 * k, 0, TAU); ctx.lineWidth = 8 * k; ctx.strokeStyle = ring; ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, s / 2 - 11 * k, 0, TAU); ctx.fillStyle = '#fff'; ctx.fill();
        const r = s / 2 - 15 * k;
        ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.clip(); avatarFill(ctx, g, img, cx - r, cy - r, r * 2); ctx.restore();
      },
      drawName(ctx, g, text, x, y) {
        const p = g.pal, w = ctx.measureText(text).width;
        const x0 = ctx.textAlign === 'center' ? x - w / 2 : x;
        const gr = ctx.createLinearGradient(x0, 0, x0 + Math.max(w, 1), 0);
        gr.addColorStop(0, p.text); gr.addColorStop(0.55, mix(p.text, p.accent, 0.7)); gr.addColorStop(1, p.accent2);
        ctx.fillStyle = gr; ctx.fillText(text, x, y);
      },
      badge(ctx, g, x, y, w, h) {
        const gr = ctx.createLinearGradient(x, 0, x + w, 0); gr.addColorStop(0, g.pal.accent); gr.addColorStop(1, g.pal.accent2);
        ctx.beginPath(); rr(ctx, x, y, w, h, h / 2); ctx.fillStyle = gr; ctx.fill();
      },
      overlay(ctx, g, W, H) {
        if (!g.st.settings.mark) return;
        const k = g.k, r = 38 * k, cx = W - g.P - r * 0.6, cy = H - g.P - g.footH / 2;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.22);
        ctx.beginPath(); starPath(ctx, 0, 0, r, 0.8, 12);
        let fill = g.pal.accent;
        if (ctx.createConicGradient) { fill = ctx.createConicGradient(0.6, 0, 0); ['#ffb3df', '#fff0a0', '#a8f5d6', '#9fd8ff', '#d2b8ff', '#ffb3df'].forEach((c, i, a) => fill.addColorStop(i / (a.length - 1), c)); }
        ctx.shadowColor = 'rgba(80,60,140,.25)'; ctx.shadowBlur = 12 * k; ctx.fillStyle = fill; ctx.fill();
        ctx.shadowColor = 'transparent'; ctx.lineWidth = 2 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.font = `700 ${13 * g.u}px ${F.mono}`; spaced(ctx, 2 * g.u); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = g.pal.text; ctx.fillText('HOLO', g.u, 0); spaced(ctx, 0);
        ctx.restore(); ctx.textAlign = 'left';
      }
    },

    // ── 未來 Future: deep teal HUD, neon lines with glow, chamfered silhouette
    future: {
      name: '未來', en: 'Future', iconMode: 'line', iconStroke: 0.08, iconGlow: true,
      headH: 76, ip: 32, gap: 24, titleH: 58, radiusK: 0.4,
      fonts: { display: [800, F.sans], title: [800, F.tc], body: [500, F.tc], strong: [800, F.sans], num: [700, F.mono], label: [500, F.mono], mono: [500, F.mono], hand: [700, F.hand] },
      variants: [
        { name: '深海', bg: ['#073034', '#041e21', '#020d0f'], text: '#e3fffa', muted: '#6fa9a3', panel: 'rgba(53,242,208,.045)', line: 'rgba(53,242,208,.28)', accent: '#35f2d0', dark: true },
        { name: '午夜', bg: ['#0e1a3c', '#081028', '#030712'], text: '#e6f0ff', muted: '#7d93c2', panel: 'rgba(76,201,255,.05)', line: 'rgba(76,201,255,.28)', accent: '#4cc9ff', dark: true },
        { name: '霓虹', bg: ['#22103e', '#140a26', '#080412'], text: '#fbeaff', muted: '#a98cc4', panel: 'rgba(255,79,216,.05)', line: 'rgba(255,79,216,.3)', accent: '#ff4fd8', dark: true }
      ],
      clip(ctx, g, W, H) { const c = clamp(g.R * 1.1, 0, 120 * g.k); chamfer(ctx, 0, 0, W, H, c, c * 0.35, c, c * 0.35); },
      background(ctx, g, W, H) {
        const p = g.pal, k = g.k;
        const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, p.bg[0]); gr.addColorStop(0.6, p.bg[1]); gr.addColorStop(1, p.bg[2]);
        ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
        const glow = ctx.createRadialGradient(W * 0.5, 0, 0, W * 0.5, 0, W * 0.8);
        glow.addColorStop(0, alpha(p.accent, 0.2)); glow.addColorStop(1, alpha(p.accent, 0)); ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
        // horizon grid
        const hy = H * 0.72;
        ctx.save(); ctx.beginPath(); ctx.rect(0, hy, W, H - hy); ctx.clip();
        ctx.strokeStyle = alpha(p.accent, 0.16); ctx.lineWidth = k;
        for (let i = 1; i <= 16; i++) { const t = i / 16, y = hy + (H - hy) * t * t; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
        for (let j = -14; j <= 14; j++) { ctx.beginPath(); ctx.moveTo(W / 2 + j * W * 0.018, hy); ctx.lineTo(W / 2 + j * W * 0.16, H); ctx.stroke(); }
        const fade = ctx.createLinearGradient(0, hy, 0, hy + (H - hy) * 0.6); fade.addColorStop(0, p.bg[1]); fade.addColorStop(1, alpha(p.bg[1], 0));
        ctx.fillStyle = fade; ctx.fillRect(0, hy, W, H - hy); ctx.restore();
        // dot grid + scanlines
        ctx.fillStyle = alpha(p.accent, 0.1);
        for (let y = 24 * k; y < H; y += 28 * k) for (let x = 24 * k; x < W; x += 28 * k) ctx.fillRect(x, y, 1.6 * k, 1.6 * k);
        ctx.fillStyle = 'rgba(0,0,0,.16)';
        for (let y = 0; y < H; y += 4 * k) ctx.fillRect(0, y, W, 1.2 * k);
      },
      header(ctx, g, x, y, w, h) {
        const p = g.pal, u = g.u, k = g.k, cy = y + 20 * u;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.font = g.font('label', 16); spaced(ctx, 2.5 * u);
        ctx.save(); ctx.shadowColor = p.accent; ctx.shadowBlur = 10 * k; ctx.fillStyle = p.accent;
        const t = 'SYS://PROFILE.CARD'; ctx.fillText(t, x, cy);
        const tw = ctx.measureText(t).width; ctx.fillRect(x + tw + 8 * u, cy - 9 * u, 10 * u, 18 * u); ctx.restore();
        if (g.st.settings.date) { ctx.textAlign = 'right'; ctx.fillStyle = p.muted; ctx.fillText('T·' + g.date, x + w, cy); }
        spaced(ctx, 0); ctx.textAlign = 'left';
        const ly = y + h - 18 * k;
        ctx.fillStyle = alpha(p.accent, 0.25); ctx.fillRect(x, ly, w, k);
        for (let tx = x; tx <= x + w; tx += 32 * k) ctx.fillRect(tx, ly - 4 * k, k, 5 * k);
        ctx.save(); ctx.shadowColor = p.accent; ctx.shadowBlur = 8 * k; ctx.fillStyle = p.accent; ctx.fillRect(x, ly - k, 96 * k, 3 * k); ctx.restore();
      },
      panel(ctx, g, x, y, w, h) {
        const p = g.pal, k = g.k, c = clamp(g.pr, 8 * k, 34 * k);
        ctx.beginPath(); chamfer(ctx, x, y, w, h, c, 0, c, 0); ctx.fillStyle = p.panel; ctx.fill();
        ctx.save(); ctx.shadowColor = alpha(p.accent, 0.6); ctx.shadowBlur = 14 * k;
        ctx.lineWidth = 1.4 * k; ctx.strokeStyle = alpha(p.accent, 0.6); ctx.stroke(); ctx.restore();
        const L = 18 * k; ctx.lineWidth = 3 * k; ctx.strokeStyle = p.accent;
        ctx.beginPath(); ctx.moveTo(x + w - L, y + 5 * k); ctx.lineTo(x + w - 5 * k, y + 5 * k); ctx.lineTo(x + w - 5 * k, y + L); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + 5 * k, y + h - L); ctx.lineTo(x + 5 * k, y + h - 5 * k); ctx.lineTo(x + L, y + h - 5 * k); ctx.stroke();
      },
      title(ctx, g, x, y, w, label, en, i) {
        const p = g.pal, u = g.u, k = g.k, cy = y + 16 * u;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.font = g.font('label', 16); const num = '//' + String(i + 1).padStart(2, '0');
        ctx.save(); ctx.shadowColor = p.accent; ctx.shadowBlur = 8 * k; ctx.fillStyle = p.accent; ctx.fillText(num, x, cy); ctx.restore();
        const nw = ctx.measureText(num).width;
        ctx.font = g.font('title', 25); ctx.fillStyle = p.text; ctx.fillText(label, x + nw + 14 * u, cy);
        ctx.font = g.font('label', 12); spaced(ctx, 3 * u); ctx.fillStyle = p.muted; ctx.textAlign = 'right';
        ctx.fillText(en.toUpperCase(), x + w, cy); spaced(ctx, 0); ctx.textAlign = 'left';
        const ly = y + 38 * u;
        ctx.fillStyle = alpha(p.accent, 0.22); ctx.fillRect(x, ly, w, k);
        ctx.fillStyle = p.accent; ctx.fillRect(x, ly - k, 56 * k, 3 * k);
      },
      tile(ctx, g, x, y, w, h) {
        const p = g.pal, c = 12 * g.k;
        ctx.beginPath(); chamfer(ctx, x, y, w, h, 0, c, 0, c); ctx.fillStyle = alpha(p.accent, 0.07); ctx.fill();
        ctx.lineWidth = g.k; ctx.strokeStyle = alpha(p.accent, 0.35); ctx.stroke();
      },
      chip(ctx, g, x, y, w, h) {
        const p = g.pal, c = 9 * g.k;
        ctx.beginPath(); chamfer(ctx, x, y, w, h, c, 0, c, 0); ctx.fillStyle = alpha(p.accent, 0.08); ctx.fill();
        ctx.lineWidth = 1.2 * g.k; ctx.strokeStyle = alpha(p.accent, 0.6); ctx.stroke();
      },
      bar(ctx, g, x, y, w, p) {
        const pal = g.pal, k = g.k, sw = 9 * k, step = 14 * k, n = Math.max(4, Math.floor((w + step - sw) / step)), bh = 20 * g.u;
        const off = (w - (n * step - (step - sw))) / 2;
        for (let i = 0; i < n; i++) {
          const lit = p !== null && (i + 0.5) / n <= p;
          ctx.save();
          if (lit) { ctx.shadowColor = pal.accent; ctx.shadowBlur = 10 * k; }
          ctx.fillStyle = lit ? pal.accent : alpha(pal.accent, 0.14);
          ctx.fillRect(x + off + i * step, y - bh / 2, sw, bh); ctx.restore();
        }
      },
      avatar(ctx, g, x, y, s, img) {
        const p = g.pal, k = g.k, cx = x + s / 2, cy = y + s / 2, r = s / 2 - 14 * k;
        ctx.save(); ctx.beginPath(); hexagon(ctx, cx, cy, r); ctx.clip(); avatarFill(ctx, g, img, cx - r, cy - r, r * 2); ctx.restore();
        ctx.save(); ctx.shadowColor = p.accent; ctx.shadowBlur = 14 * k; ctx.beginPath(); hexagon(ctx, cx, cy, r); ctx.lineWidth = 2.4 * k; ctx.strokeStyle = p.accent; ctx.stroke(); ctx.restore();
        ctx.setLineDash([6 * k, 7 * k]); ctx.beginPath(); ctx.arc(cx, cy, s / 2 - 2 * k, 0, TAU); ctx.lineWidth = 1.2 * k; ctx.strokeStyle = alpha(p.accent, 0.5); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = p.accent;
        [0, 1, 2, 3].forEach(i => { const a = i * Math.PI / 2; ctx.save(); ctx.translate(cx + Math.cos(a) * (s / 2 + 4 * k), cy + Math.sin(a) * (s / 2 + 4 * k)); ctx.rotate(a); ctx.fillRect(-6 * k, -1 * k, 12 * k, 2 * k); ctx.restore(); });
      },
      drawName(ctx, g, text, x, y) {
        ctx.save(); ctx.shadowColor = alpha(g.pal.accent, 0.6); ctx.shadowBlur = 22 * g.k; ctx.fillStyle = g.pal.text; ctx.fillText(text, x, y); ctx.restore();
      },
      badge(ctx, g, x, y, w, h) { const c = 7 * g.k; ctx.beginPath(); chamfer(ctx, x, y, w, h, c, 0, c, 0); ctx.fillStyle = g.pal.accent; ctx.fill(); },
      overlay(ctx, g, W, H) {
        const p = g.pal, k = g.k, i = g.P * 0.4, L = 36 * k;
        ctx.save(); ctx.shadowColor = p.accent; ctx.shadowBlur = 10 * k; ctx.lineWidth = 2 * k; ctx.strokeStyle = alpha(p.accent, 0.85);
        const c = clamp(g.R * 1.1, 0, 120 * g.k) * 0.35;
        ctx.beginPath(); ctx.moveTo(W - i - L - c, i); ctx.lineTo(W - i - c * 0.4, i); ctx.lineTo(W - i, i + c * 0.4); ctx.lineTo(W - i, i + L + c); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(i, H - i - L - c); ctx.lineTo(i, H - i - c * 0.4); ctx.lineTo(i + c * 0.4, H - i); ctx.lineTo(i + L + c, H - i); ctx.stroke();
        ctx.restore();
      },
      footer(ctx, g, x, y, w, h) {
        const p = g.pal, u = g.u, k = g.k, cy = y + h / 2;
        ctx.font = g.font('label', 13); spaced(ctx, 2.5 * u); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = p.muted;
        ctx.fillText('MADE WITH CANDLE·KIT', x, cy); spaced(ctx, 0);
        const r = rng(99); let bx = x + w; ctx.fillStyle = alpha(p.accent, 0.7);
        for (let i = 0; i < 34; i++) { const bw = (1 + Math.floor(r() * 3)) * 1.6 * k; bx -= bw + 2 * k; ctx.fillRect(bx, cy - 13 * k, bw, 26 * k); }
      }
    },

    // ── 剪貼簿 Scrapbook: kraft paper, washi tape, tilted notes, handwriting
    scrap: {
      name: '剪貼簿', en: 'Scrapbook', iconMode: 'line', iconStroke: 0.09, avatarH: 1.16,
      headH: 96, ip: 32, gap: 34, titleH: 56, radiusK: 0.12,
      fonts: { display: [700, F.hand], title: [700, F.kai], body: [400, F.kai], strong: [700, F.kai], num: [700, F.hand], label: [700, F.hand], mono: [700, F.hand], hand: [700, F.hand] },
      labelBoost: 1.35,
      variants: [
        { name: '牛皮紙', bg: ['#d6b688', '#cba979', '#b99461'], paper: 'kraft', text: '#2d2217', muted: '#6f5a40', panel: '#fffaf0', line: 'rgba(60,40,20,.28)', accent: '#c2412d' },
        { name: '方格紙', bg: ['#f8f4e8', '#f3eee0', '#ebe4d0'], paper: 'grid', text: '#2a2620', muted: '#71685a', panel: '#fffefa', line: 'rgba(40,40,60,.25)', accent: '#2f6db5' },
        { name: '筆記本', bg: ['#fcf9ef', '#f7f2e3', '#eee7d3'], paper: 'lined', text: '#2b2620', muted: '#736a5b', panel: '#fffefa', line: 'rgba(40,40,60,.25)', accent: '#d0473a' }
      ],
      papers: ['#fffaf0', '#fdf3d4', '#eef4fb', '#fbefee'],
      tapes: ['rgba(244,203,120,.72)', 'rgba(160,205,226,.72)', 'rgba(240,168,178,.7)', 'rgba(180,216,160,.72)'],
      panelAngle(i, id) { return (id === 'note' ? 1.3 : [-0.7, 0.55, -0.4, 0.75, -0.55, 0.35, -0.75, 0.5][i % 8]) * Math.PI / 180; },
      background(ctx, g, W, H) {
        BASE.background(ctx, g, W, H);
        const p = g.pal, k = g.k, r = rng(5);
        if (p.paper === 'kraft') {
          const n = Math.round(W * H / 1500);
          for (let i = 0; i < n; i++) {
            const x = r() * W, y = r() * H, a = r() * Math.PI, l = (4 + r() * 16) * k;
            ctx.strokeStyle = r() > 0.5 ? `rgba(90,60,25,${0.05 + r() * 0.1})` : `rgba(255,240,210,${0.06 + r() * 0.1})`;
            ctx.lineWidth = (0.6 + r()) * k; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
          }
        } else if (p.paper === 'grid') {
          ctx.fillStyle = 'rgba(70,120,190,.16)';
          for (let x = 0; x < W; x += 34 * k) ctx.fillRect(x, 0, k, H);
          for (let y = 0; y < H; y += 34 * k) ctx.fillRect(0, y, W, k);
        } else {
          ctx.fillStyle = 'rgba(80,130,200,.22)';
          for (let y = 120 * k; y < H; y += 42 * k) ctx.fillRect(0, y, W, 1.2 * k);
          ctx.fillStyle = 'rgba(208,71,58,.35)'; ctx.fillRect(g.P * 0.55, 0, 1.6 * k, H); ctx.fillRect(g.P * 0.55 + 5 * k, 0, k, H);
        }
        for (let i = 0; i < W * H / 4000; i++) { ctx.fillStyle = `rgba(60,40,20,${r() * 0.08})`; ctx.fillRect(r() * W, r() * H, 1.5 * k, 1.5 * k); }
        const vig = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
        vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(70,45,15,.18)'); ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
      },
      header(ctx, g, x, y, w, h) {
        const p = g.pal, u = g.u, k = g.k, r = rng(3);
        ctx.save(); ctx.translate(x, y + 38 * u); ctx.rotate(-0.035);
        ctx.font = `700 ${56 * u}px ${F.hand}`; ctx.textBaseline = 'middle'; ctx.fillStyle = p.accent;
        const t = 'my sky card', tw = ctx.measureText(t).width; ctx.fillText(t, 0, 0);
        ctx.lineWidth = 2.6 * k; ctx.strokeStyle = p.accent; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(0, 26 * u);
        for (let i = 1; i <= 12; i++) ctx.quadraticCurveTo(tw * (i - 0.5) / 12, 26 * u + (i % 2 ? -6 : 6) * u, tw * i / 12, 26 * u);
        ctx.stroke();
        ctx.font = `400 ${24 * u}px ${F.kai}`; ctx.fillStyle = p.muted; ctx.fillText('光之子的剪貼簿', tw + 18 * u, 6 * u);
        ctx.restore();
        if (g.st.settings.date) { // rubber stamp
          const R = 46 * u, cx = x + w - R - 4 * k, cy = y + 42 * u;
          ctx.save(); ctx.translate(cx, cy); ctx.rotate(0.18); ctx.globalAlpha = 0.78;
          ctx.strokeStyle = p.accent; ctx.lineWidth = 2.6 * k; ctx.beginPath(); ctx.arc(0, 0, R, 0, TAU); ctx.stroke();
          ctx.lineWidth = 1.2 * k; ctx.beginPath(); ctx.arc(0, 0, R - 7 * k, 0, TAU); ctx.stroke();
          ctx.fillStyle = p.accent; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          const [yy, mm, dd] = g.date.split('.');
          ctx.font = `700 ${34 * u}px ${F.hand}`; ctx.fillText(`${mm}.${dd}`, 0, 2 * u);
          ctx.font = `700 ${16 * u}px ${F.hand}`; ctx.fillText(yy, 0, -22 * u); ctx.fillText('★', 0, 25 * u);
          for (let i = 0; i < 40; i++) { ctx.globalCompositeOperation = 'destination-out'; ctx.fillRect((r() - 0.5) * R * 2, (r() - 0.5) * R * 2, 2.5 * k, 2.5 * k); }
          ctx.restore();
        }
      },
      panel(ctx, g, x, y, w, h, i, id) {
        const S = g.S, k = g.k;
        ctx.save(); ctx.shadowColor = 'rgba(60,40,15,.28)'; ctx.shadowBlur = 16 * k; ctx.shadowOffsetY = 7 * k; ctx.shadowOffsetX = 2 * k;
        ctx.beginPath(); rr(ctx, x, y, w, h, Math.min(g.pr, 8 * k));
        ctx.fillStyle = id === 'note' ? '#fff0a3' : id === 'profile' ? g.pal.panel : S.papers[(i + 1) % 4]; ctx.fill(); ctx.restore();
        if (id === 'note') { // folded corner
          const f = 34 * k; ctx.beginPath(); ctx.moveTo(x + w - f, y + h); ctx.lineTo(x + w, y + h - f); ctx.lineTo(x + w - f, y + h - f); ctx.closePath();
          ctx.fillStyle = 'rgba(160,130,30,.25)'; ctx.fill();
        }
        const tw = clamp(w * 0.28, 90 * k, 150 * k);
        if (i % 2) tape(ctx, x + w * 0.5, y + 2 * k, tw, 34 * k, (i % 4 - 1.5) * 0.04, S.tapes[i % 4]);
        else { tape(ctx, x + 20 * k, y + 14 * k, tw * 0.7, 30 * k, -0.7, S.tapes[i % 4]); tape(ctx, x + w - 20 * k, y + 14 * k, tw * 0.7, 30 * k, 0.7, S.tapes[(i + 2) % 4]); }
      },
      title(ctx, g, x, y, w, label, en, i) {
        const p = g.pal, u = g.u, cy = y + 20 * u;
        ctx.font = g.font('title', 30); ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        const lw = ctx.measureText(label).width;
        ctx.beginPath(); ctx.moveTo(x - 6 * u, cy + 2 * u); ctx.lineTo(x + lw + 10 * u, cy - 1 * u); ctx.lineTo(x + lw + 6 * u, cy + 15 * u); ctx.lineTo(x - 4 * u, cy + 16 * u); ctx.closePath();
        ctx.fillStyle = ['rgba(255,214,70,.6)', 'rgba(120,220,200,.5)', 'rgba(255,150,170,.5)', 'rgba(160,200,255,.55)'][i % 4]; ctx.fill();
        ctx.fillStyle = p.text; ctx.fillText(label, x, cy);
        ctx.font = `700 ${26 * u}px ${F.hand}`; ctx.fillStyle = p.accent; ctx.fillText(en.toLowerCase(), x + lw + 18 * u, cy + 2 * u);
      },
      tile(ctx, g, x, y, w, h, i) {
        const r = rng(40 + i); ctx.lineWidth = 1.8 * g.k; ctx.strokeStyle = alpha(g.pal.text, 0.55); ctx.lineCap = 'round';
        roughRect(ctx, x + 4 * g.k, y + 4 * g.k, w - 8 * g.k, h - 8 * g.k, r, 6 * g.k);
      },
      chip(ctx, g, x, y, w, h, kind, i) {
        const S = g.S; const c = S.tapes[(i + (kind === 'tag' ? 1 : 0)) % 4];
        tape(ctx, x + w / 2, y + h / 2, w, h, ((i * 7) % 5 - 2) * 0.012, c);
      },
      bar(ctx, g, x, y, w, p) {
        const pal = g.pal, k = g.k, r = rng(77);
        ctx.lineWidth = 2.4 * k; ctx.strokeStyle = alpha(pal.text, 0.7); ctx.lineCap = 'round';
        wobbleLine(ctx, x, y, x + w, r, 3 * k);
        ctx.beginPath(); ctx.moveTo(x, y - 10 * k); ctx.lineTo(x + 2 * k, y + 10 * k); ctx.moveTo(x + w, y - 10 * k); ctx.lineTo(x + w - 2 * k, y + 10 * k); ctx.stroke();
        if (p === null) return;
        ctx.strokeStyle = alpha(pal.accent, 0.55); ctx.lineWidth = 10 * k; wobbleLine(ctx, x, y, x + w * p, rng(78), 2 * k);
        const s = 34 * g.u; ctx.save(); ctx.beginPath(); starPath(ctx, x + w * p, y, s / 2, 0.45); ctx.fillStyle = pal.accent; ctx.fill(); ctx.restore();
      },
      rule(ctx, g, x, y, w) { ctx.lineWidth = 1.4 * g.k; ctx.strokeStyle = g.pal.line; ctx.setLineDash([7 * g.k, 6 * g.k]); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + w, y); ctx.stroke(); ctx.setLineDash([]); },
      avatar(ctx, g, x, y, s, img) {
        const k = g.k, h = s * 1.16, cx = x + s / 2, cy = y + h / 2;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.05); ctx.translate(-cx, -cy);
        ctx.save(); ctx.shadowColor = 'rgba(60,40,15,.3)'; ctx.shadowBlur = 14 * k; ctx.shadowOffsetY = 6 * k;
        ctx.fillStyle = '#fffefa'; ctx.fillRect(x, y, s, h); ctx.restore();
        const m = s * 0.07; avatarFill(ctx, g, img, x + m, y + m, s - m * 2);
        ctx.font = `700 ${24 * g.u}px ${F.hand}`; ctx.fillStyle = g.pal.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText("that's me ♥", cx, y + s - m + (h - s + m) / 2); ctx.textAlign = 'left';
        tape(ctx, cx, y + 2 * k, s * 0.42, 30 * k, 0.05, 'rgba(244,203,120,.75)');
        ctx.restore();
      },
      drawName(ctx, g, text, x, y) { ctx.fillStyle = g.pal.text; ctx.fillText(text, x, y); },
      badge(ctx, g, x, y, w, h) { ctx.lineWidth = 1.6 * g.k; ctx.strokeStyle = g.pal.accent; roughRect(ctx, x, y, w, h, rng(9), 3 * g.k); },
      badgeInk: 'accent',
      overlay(ctx, g, W, H) {
        const p = g.pal, k = g.k, r = rng(31);
        tape(ctx, 30 * k, 30 * k, 150 * k, 40 * k, -0.78, 'rgba(240,168,178,.6)');
        tape(ctx, W - 30 * k, H - 30 * k, 150 * k, 40 * k, -0.78, 'rgba(160,205,226,.6)');
        ctx.strokeStyle = alpha(p.accent, 0.6); ctx.lineWidth = 2 * k; ctx.lineJoin = 'round';
        const spots = [[0.035, 0.32], [0.965, 0.46], [0.04, 0.78], [0.955, 0.16]];
        spots.forEach(([sx, sy], i) => {
          const s = (12 + r() * 8) * k;
          ctx.beginPath(); if (i % 2) starPath(ctx, sx * W, sy * H, s, 0.45); else PATH.heart(ctx, sx * W - s, sy * H - s, s * 2);
          ctx.stroke();
        });
      },
      footer(ctx, g, x, y, w, h) {
        const p = g.pal, u = g.u, cy = y + h / 2;
        ctx.save(); ctx.translate(x + w / 2, cy); ctx.rotate(-0.02);
        ctx.font = `700 ${28 * u}px ${F.hand}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = p.muted;
        const t = 'made with candle·kit', tw = ctx.measureText(t).width; ctx.fillText(t, -12 * u, 0);
        ctx.beginPath(); PATH.heart(ctx, tw / 2 - 2 * u, -11 * u, 22 * u); ctx.fillStyle = p.accent; ctx.fill();
        ctx.restore();
      }
    },

    // ── 像素 Pixel: 8-bit banded sky, stepped borders, bitmap icons, pixelated avatar
    pixel: {
      name: '像素', en: 'Pixel', iconMode: 'pixel', headH: 72, ip: 30, gap: 26, titleH: 60, radiusK: 0.5,
      fonts: { display: [700, F.pixel], title: [700, F.pixel], body: [500, F.pixel], strong: [700, F.pixel], num: [700, F.pixel], label: [500, F.pixel], mono: [500, F.pixel], hand: [700, F.hand] },
      variants: [
        { name: '夜空', bg: ['#14163d', '#2a2a6e', '#4b3b8f'], sky: 'night', text: '#fff6d8', muted: '#b9b4f2', panel: '#262a66', edge: '#0b0c24', shadow: '#07081a', accent: '#ffcc33', dark: true },
        { name: '晴天', bg: ['#3fa9f5', '#79c8ff', '#c7ecff'], sky: 'day', text: '#22223a', muted: '#4f5b7c', panel: '#fff7e2', edge: '#22223a', shadow: 'rgba(34,34,58,.35)', accent: '#ff6b4a' },
        { name: '黃昏', bg: ['#2a1450', '#7a2f6e', '#ff8f62'], sky: 'dusk', text: '#fff0d6', muted: '#f6c3aa', panel: '#2f1a4a', edge: '#140a24', shadow: '#0c0616', accent: '#ffd166', dark: true }
      ],
      clip(ctx, g, W, H) { stepped(ctx, 0, 0, W, H, g.px, Math.round(g.R / g.px / 2)); },
      background(ctx, g, W, H) {
        const p = g.pal, px = g.px, N = 14, bh = Math.ceil(H / N / px) * px;
        for (let i = 0; i < N; i++) {
          const t = i / (N - 1), c = t < 0.5 ? mix(p.bg[0], p.bg[1], t * 2) : mix(p.bg[1], p.bg[2], (t - 0.5) * 2);
          ctx.fillStyle = c; ctx.fillRect(0, i * bh, W, bh + 1);
        }
        const r = rng(13), snap = v => Math.round(v / px) * px;
        if (p.sky !== 'day') {
          for (let i = 0; i < 70; i++) {
            const x = snap(r() * W), y = snap(r() * H * 0.9); ctx.fillStyle = `rgba(255,248,220,${0.35 + r() * 0.6})`;
            if (i % 9 === 0) { ctx.fillRect(x, y - px, px, px * 3); ctx.fillRect(x - px, y, px * 3, px); } else ctx.fillRect(x, y, px, px);
          }
          const moon = ['..XXXX..', '.XXX....', 'XXX.....', 'XXX.....', 'XXX.....', 'XXX.....', '.XXX....', '..XXXX..'];
          const ms = px, mx = snap(W * 0.6), my = snap(g.P - 2 * px);
          ctx.fillStyle = p.sky === 'dusk' ? '#ffe3a8' : '#fff4c4';
          moon.forEach((row, ry) => [...row].forEach((ch, cx) => { if (ch === 'X') ctx.fillRect(mx + cx * ms, my + ry * ms, ms, ms); }));
        } else {
          const sun = ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..'];
          const ms = px, mx = snap(W * 0.6), my = snap(g.P - 2 * px);
          ctx.fillStyle = '#ffe066'; sun.forEach((row, ry) => [...row].forEach((ch, cx) => { if (ch === 'X') ctx.fillRect(mx + cx * ms, my + ry * ms, ms, ms); }));
        }
        const cloud = ['.....XXXX.......', '...XXXXXXXX.XX..', '..XXXXXXXXXXXXX.', 'XXXXXXXXXXXXXXXX', 'XXXXXXXXXXXXXXXX', '.XXXXXXXXXXXXXX.'];
        const cs = px * 2;
        [[0.08, 0.3, 1], [0.7, 0.55, 1.4], [0.15, 0.82, 1.2]].forEach(([cx, cy, sc]) => {
          const s = Math.round(cs * sc / px) * px, ox = snap(cx * W), oy = snap(cy * H);
          ctx.fillStyle = p.sky === 'day' ? 'rgba(255,255,255,.92)' : 'rgba(255,255,255,.1)';
          cloud.forEach((row, ry) => [...row].forEach((ch, c) => { if (ch === 'X') ctx.fillRect(ox + c * s, oy + ry * s, s, s); }));
        });
        if (p.sky === 'day') { // grass strip
          const gy = H - snap(g.P * 0.9);
          ctx.fillStyle = '#5cb85c'; ctx.fillRect(0, gy, W, H - gy);
          ctx.fillStyle = '#3e8e41'; for (let x = 0; x < W; x += px * 2) ctx.fillRect(x, gy - (x / px / 2 % 3 === 0 ? px : 0), px * 2, px);
          ctx.fillStyle = '#2f6d33'; ctx.fillRect(0, gy + px * 2, W, px);
        }
      },
      header(ctx, g, x, y, w, h) {
        const p = g.pal, u = g.u, px = g.px, cy = y + 20 * u;
        for (let i = 0; i < 3; i++) pixelIcon(ctx, g, 'heart', x + i * 30 * u, cy - 13 * u, 26 * u, '#ff5a6e');
        ctx.font = g.font('title', 22); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; spaced(ctx, 2 * u);
        const t = 'PLAYER PROFILE', tx = x + 100 * u;
        ctx.fillStyle = p.edge; ctx.fillText(t, tx + px * 0.6, cy + px * 0.6); ctx.fillStyle = p.accent; ctx.fillText(t, tx, cy);
        if (g.st.settings.date) { ctx.font = g.font('label', 18); ctx.textAlign = 'right'; ctx.fillStyle = p.text; ctx.fillText(g.date, x + w, cy); }
        spaced(ctx, 0); ctx.textAlign = 'left';
      },
      panel(ctx, g, x, y, w, h) {
        const p = g.pal, px = g.px, n = clamp(Math.round(g.pr / px / 2), 1, 3);
        x = Math.round(x / px) * px; y = Math.round(y / px) * px; w = Math.round(w / px) * px; h = Math.round(h / px) * px;
        ctx.beginPath(); stepped(ctx, x + px, y + px, w, h, px, n); ctx.fillStyle = p.shadow; ctx.fill();
        ctx.beginPath(); stepped(ctx, x, y, w, h, px, n); ctx.fillStyle = p.edge; ctx.fill();
        ctx.beginPath(); stepped(ctx, x + px, y + px, w - px * 2, h - px * 2, px, Math.max(0, n - 1)); ctx.fillStyle = p.panel; ctx.fill();
        ctx.fillStyle = alpha('#ffffff', p.dark ? 0.12 : 0.6); ctx.fillRect(x + px * (n + 1), y + px * 2, w - px * (n + 1) * 2, px);
        ctx.fillStyle = alpha('#000000', p.dark ? 0.25 : 0.08); ctx.fillRect(x + px * (n + 1), y + h - px * 3, w - px * (n + 1) * 2, px);
      },
      title(ctx, g, x, y, w, label, en) {
        const p = g.pal, u = g.u, px = g.px;
        ctx.font = g.font('title', 22); spaced(ctx, 1.5 * u);
        const lw = ctx.measureText(label).width, bw = Math.round((lw + 28 * u) / px) * px, bh = Math.round(40 * u / px) * px;
        const bx = Math.round(x / px) * px, by = Math.round(y / px) * px;
        ctx.beginPath(); stepped(ctx, bx, by, bw, bh, px, 1); ctx.fillStyle = p.edge; ctx.fill();
        ctx.beginPath(); stepped(ctx, bx + px, by + px, bw - px * 2, bh - px * 2, px, 0); ctx.fillStyle = p.accent; ctx.fill();
        ctx.fillStyle = alpha('#ffffff', 0.45); ctx.fillRect(bx + px * 2, by + px * 2, bw - px * 4, px);
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = p.edge; ctx.fillText(label, bx + 14 * u, by + bh / 2 + u);
        ctx.font = g.font('label', 15); ctx.fillStyle = p.muted; ctx.fillText('> ' + en.toUpperCase(), bx + bw + 14 * u, by + bh / 2);
        spaced(ctx, 0);
      },
      tile(ctx, g, x, y, w, h) {
        const p = g.pal, px = g.px;
        x = Math.round(x / px) * px; y = Math.round(y / px) * px; w = Math.round(w / px) * px; h = Math.round(h / px) * px;
        ctx.beginPath(); stepped(ctx, x, y, w, h, px, 1); ctx.fillStyle = mix(p.panel, p.edge, p.dark ? 0.45 : 0.08); ctx.fill();
        ctx.fillStyle = alpha('#000000', p.dark ? 0.3 : 0.1); ctx.fillRect(x + px, y + px, w - px * 2, px);
      },
      chip(ctx, g, x, y, w, h, kind) {
        const p = g.pal, px = g.px;
        x = Math.round(x / px) * px; y = Math.round(y / px) * px; w = Math.round(w / px) * px; h = Math.round(h / px) * px;
        ctx.beginPath(); stepped(ctx, x, y, w, h, px, 1); ctx.fillStyle = p.edge; ctx.fill();
        ctx.beginPath(); ctx.rect(x + px, y + px, w - px * 2, h - px * 2); ctx.fillStyle = kind === 'tag' ? (p.dark ? mix(p.panel, '#ffffff', 0.12) : mix(p.panel, p.accent, 0.2)) : mix(p.panel, p.muted, p.dark ? 0.24 : 0.3); ctx.fill();
      },
      bar(ctx, g, x, y, w, p) {
        const pal = g.pal, px = g.px, bh = Math.round(28 * g.u / px) * px;
        x = Math.round(x / px) * px; w = Math.round(w / px) * px; const by = Math.round((y - bh / 2) / px) * px;
        ctx.fillStyle = pal.edge; ctx.fillRect(x, by, w, bh);
        const cw = px * 3, n = Math.floor((w - px * 3) / (cw + px)), lit = p === null ? 0 : Math.round(n * p);
        for (let i = 0; i < n; i++) {
          const cx = x + px * 2 + i * (cw + px);
          ctx.fillStyle = i < lit ? pal.accent : mix(pal.panel, pal.edge, 0.5); ctx.fillRect(cx, by + px * 2, cw, bh - px * 4);
          if (i < lit) { ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillRect(cx, by + px * 2, cw, px); }
        }
      },
      rule(ctx, g, x, y, w) { const px = g.px; ctx.fillStyle = g.pal.dark ? alpha('#ffffff', 0.18) : alpha(g.pal.edge, 0.25); for (let i = 0; i < w; i += px * 3) ctx.fillRect(Math.round((x + i) / px) * px, Math.round(y / px) * px, px, px); },
      avatar(ctx, g, x, y, s, img) {
        const p = g.pal, px = g.px; x = Math.round(x / px) * px; y = Math.round(y / px) * px; s = Math.round(s / px) * px;
        ctx.beginPath(); stepped(ctx, x + px, y + px, s, s, px, 2); ctx.fillStyle = p.shadow; ctx.fill();
        ctx.beginPath(); stepped(ctx, x, y, s, s, px, 2); ctx.fillStyle = p.edge; ctx.fill();
        ctx.save(); ctx.beginPath(); stepped(ctx, x + px * 2, y + px * 2, s - px * 4, s - px * 4, px, 1); ctx.clip();
        avatarFill(ctx, g, img, x + px * 2, y + px * 2, s - px * 4); ctx.restore();
      },
      drawName(ctx, g, text, x, y) { const px = g.px; ctx.fillStyle = g.pal.edge; ctx.fillText(text, x + px, y + px); ctx.fillStyle = g.pal.text; ctx.fillText(text, x, y); },
      badge(ctx, g, x, y, w, h) { const px = g.px; ctx.beginPath(); stepped(ctx, x, y, w, h, px, 1); ctx.fillStyle = g.pal.accent; ctx.fill(); },
      footer(ctx, g, x, y, w, h) {
        const p = g.pal, u = g.u, cy = y + h / 2;
        ctx.font = g.font('label', 16); spaced(ctx, 2 * u); ctx.textBaseline = 'middle';
        const t = 'MADE WITH CANDLE·KIT', tw = ctx.measureText(t).width, s = 22 * u, sx = x + (w - tw - s - 12 * u) / 2;
        pixelIcon(ctx, g, 'heart', sx, cy - s / 2, s, p.accent);
        ctx.fillStyle = p.sky === 'day' ? '#ffffff' : p.muted; ctx.textAlign = 'left'; ctx.fillText(t, sx + s + 12 * u, cy); spaced(ctx, 0);
      }
    }
  };
  const STYLE_IDS = Object.keys(STYLES);
  const resolved = {};
  const getStyle = id => resolved[id] || (resolved[id] = Object.assign({}, BASE, STYLES[id]));

  function palette(S, id, st) {
    const look = st.looks[id] || {};
    const v = S.variants[clamp(look.bg | 0, 0, S.variants.length - 1)];
    const accent = validHex(look.accent) ? look.accent : v.accent;
    return Object.assign({}, v, {
      accent, accent2: v.accent2 || mix(accent, v.text, 0.3),
      soft: mix(v.text, v.muted, 0.42),
      onAccent: luminance(accent) > 0.42 ? '#1a1408' : '#ffffff',
      edge: v.edge || mix(v.text, '#000000', 0.5)
    });
  }

  // ── section renderers: lay(g, w) -> {h, …}; draw(g, x, y, w, h, lay) ─────
  const SEC = {
    profile: {
      untitled: true,
      lay(g, w) {
        const { ctx, S, d, k, u } = g;
        const center = S.profileAlign === 'center', side = !center && w >= 560 * k;
        const av = side ? clamp(w * 0.26, 150 * k, 224 * k) : clamp(w * (center ? 0.36 : 0.42), 140 * k, 220 * k);
        const avH = av * (S.avatarH || 1), tw = side ? w - av - 40 * k : w;
        ctx.font = g.font('display', 60); const name = wrap(ctx, d.name.trim() || '光之子', tw, 2);
        ctx.font = g.font('body', 25); const bio = filled(d.bio) ? wrap(ctx, d.bio.trim(), tw, 5) : [];
        const nameLH = 72 * u, bioLH = 40 * u, codeH = filled(d.code) ? 40 * u : 0;
        const th = name.length * nameLH + (codeH ? 14 * k + codeH : 0) + (bio.length ? 20 * k + bio.length * bioLH : 0);
        const h = side ? Math.max(avH, th) : avH + 30 * k + th;
        return { h, side, center, av, avH, tw, th, name, bio, nameLH, bioLH, codeH };
      },
      draw(g, x, y, w, h, L) {
        const { ctx, S, pal, d, k, u } = g;
        const ax = L.center ? x + (w - L.av) / 2 : x;
        S.avatar(ctx, g, ax, L.side ? y + Math.max(0, (L.th - L.avH) / 2) : y, L.av, getAvatar());
        const tx = L.side ? x + L.av + 40 * k : L.center ? x + w / 2 : x;
        let ty = L.side ? y + Math.max(0, (L.avH - L.th) / 2) : y + L.avH + 30 * k;
        ctx.textAlign = L.center ? 'center' : 'left'; ctx.textBaseline = 'middle';
        ctx.font = g.font('display', 60);
        L.name.forEach(line => { S.drawName(ctx, g, line, tx, ty + L.nameLH / 2); ty += L.nameLH; });
        if (L.codeH) { ty += 14 * k; drawCode(g, L.side ? tx : x, ty, L.tw, L.center); ty += L.codeH; }
        if (L.bio.length) {
          ty += 20 * k; ctx.font = g.font('body', 25); ctx.fillStyle = pal.soft;
          ctx.textAlign = L.center ? 'center' : 'left';
          L.bio.forEach(line => { ctx.fillText(line, tx, ty + L.bioLH / 2); ty += L.bioLH; });
        }
        ctx.textAlign = 'left';
      }
    },
    stats: {
      items: d => [['candle', d.candles, '蠟燭'], ['heart', d.hearts, '愛心'], ['diamond', d.ascended, '升華蠟燭'], ['star', d.season, '季節蠟燭']].filter(i => filled(i[1])),
      lay(g, w) {
        const items = this.items(g.d), n = items.length;
        const cols = n > 2 && w >= 720 * g.k ? n : Math.min(2, n);
        const gap = (g.S.tileAlign === 'center' ? 24 : 14) * g.k, th = 138 * g.u, rows = Math.ceil(n / cols);
        g.tileGap = gap;
        return { h: rows * th + (rows - 1) * gap, items, cols, gap, th };
      },
      draw(g, x, y, w, h, L) {
        const { ctx, S, pal, k, u } = g;
        g.tileGap = L.gap;
        const tw = (w - L.gap * (L.cols - 1)) / L.cols;
        L.items.forEach(([icon, value, label], i) => {
          const col = i % L.cols, tx = x + col * (tw + L.gap), ty = y + Math.floor(i / L.cols) * (L.th + L.gap);
          S.tile(ctx, g, tx, ty, tw, L.th, i, col, L.cols);
          ctx.textBaseline = 'middle';
          const lab = 16 * (S.labelBoost || 1);
          if (S.tileAlign === 'center') {
            const cx = tx + tw / 2;
            drawIcon(ctx, g, icon, cx - 15 * u, ty + 10 * u, 30 * u, pal.accent);
            ctx.textAlign = 'center'; ctx.font = g.font('num', 58); ctx.fillStyle = pal.text;
            ctx.fillText(ellipsize(ctx, fmtNum(value), tw - 12 * k), cx, ty + 80 * u);
            ctx.font = g.font('label', 15); spaced(ctx, 2 * u); ctx.fillStyle = pal.muted; ctx.fillText(label, cx, ty + 124 * u); spaced(ctx, 0);
            ctx.textAlign = 'left';
          } else {
            const ix = tx + 20 * k, iy = ty + 20 * k, is = 34 * u;
            drawIcon(ctx, g, icon, ix, iy, is, S.tileIcon === 'inset' ? pal.accent : pal.accent);
            ctx.font = g.font('label', lab); ctx.fillStyle = pal.muted; ctx.textAlign = 'left';
            ctx.fillText(ellipsize(ctx, label, tw - 40 * k - is - 12 * u), ix + is + 12 * u, iy + is / 2);
            ctx.font = g.font('num', 52); ctx.fillStyle = pal.text;
            ctx.fillText(ellipsize(ctx, fmtNum(value), tw - 40 * k), ix, ty + L.th - 38 * u);
          }
        });
      }
    },
    height: {
      lay(g, w) {
        const d = g.d, tall = numOrNull(d.hTall), short = numOrNull(d.hShort);
        const range = tall !== null && short !== null && tall > short;
        const side = range && w >= 620 * g.k, numH = 104 * g.u, barH = range ? 78 * g.u : 0;
        return { h: side ? Math.max(numH, barH) : numH + (range ? 14 * g.k + barH : 0), range, side, numH, tall, short };
      },
      draw(g, x, y, w, h, L) {
        const { ctx, S, pal, d, k, u } = g;
        ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
        ctx.font = g.font('label', 16 * (S.labelBoost || 1)); spaced(ctx, 1.5 * u); ctx.fillStyle = pal.muted; ctx.fillText('目前身高', x, y + 14 * u); spaced(ctx, 0);
        ctx.font = g.font('num', 66); ctx.fillStyle = pal.text; ctx.fillText(ellipsize(ctx, fmtH(d.hNow) || '—', L.side ? 240 * u : w), x, y + 68 * u);
        if (!L.range) return;
        const bx = L.side ? x + 270 * u : x, bw = L.side ? w - 270 * u : w, by = L.side ? y + 22 * u : y + L.numH + 14 * k;
        const now = numOrNull(d.hNow), p = now === null ? null : clamp((now - L.short) / (L.tall - L.short), 0, 1);
        S.bar(ctx, g, bx, by + 18 * u, bw, p);
        ctx.font = g.font('label', 15 * (S.labelBoost || 1)); ctx.fillStyle = pal.muted;
        ctx.textAlign = 'left'; ctx.fillText(`最矮 ${fmtH(d.hShort)}`, bx, by + 62 * u);
        ctx.textAlign = 'right'; ctx.fillText(`最高 ${fmtH(d.hTall)}`, bx + bw, by + 62 * u);
        ctx.textAlign = 'left';
      }
    },
    favorites: {
      rows: d => [['pin', '地圖', d.map], ['cape', '先祖', d.spirit], ['spark', '動作', d.emote]].filter(r => filled(r[2])),
      lay(g, w) { const rows = this.rows(g.d), rh = 60 * g.u; return { h: rows.length * rh, rows, rh }; },
      draw(g, x, y, w, h, L) { drawRows(g, x, y, w, L, 'strong', 26, 92); }
    },
    seasons: {
      lay(g, w) { return layChips(g, w, splitList(g.d.seasons, 24), 'season'); },
      draw(g, x, y, w, h, L) { drawChips(g, x, y, L); }
    },
    tags: {
      lay(g, w) { return layChips(g, w, splitList(g.d.tags, 16), 'tag'); },
      draw(g, x, y, w, h, L) { drawChips(g, x, y, L); }
    },
    links: {
      rows: d => [['camera', 'Instagram', d.ig], ['bubble', 'Discord', d.discord], ['link', '其他', d.other]].filter(r => filled(r[2])),
      lay(g, w) { const rows = this.rows(g.d), rh = 60 * g.u; return { h: rows.length * rh, rows, rh }; },
      draw(g, x, y, w, h, L) { drawRows(g, x, y, w, L, 'mono', 23, 132); }
    },
    note: {
      lay(g, w) {
        const { ctx, u } = g;
        ctx.font = g.font('hand', 42); const lines = wrap(ctx, g.d.note.trim(), w - 56 * u, 6), LH = 52 * u;
        return { h: lines.length * LH + 46 * u, lines, LH };
      },
      draw(g, x, y, w, h, L) {
        const { ctx, pal, u, d } = g;
        ctx.font = `400 ${120 * u}px ${F.iserif}`; ctx.fillStyle = alpha(pal.accent, 0.35); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
        ctx.fillText('“', x - 4 * u, y + 82 * u);
        ctx.save(); ctx.translate(x + 56 * u, y); ctx.rotate(-0.012);
        ctx.font = g.font('hand', 42); ctx.fillStyle = pal.text; ctx.textBaseline = 'middle';
        L.lines.forEach((line, i) => ctx.fillText(line, 0, L.LH * i + L.LH / 2));
        ctx.restore();
        ctx.font = g.font('hand', 26); ctx.fillStyle = pal.muted; ctx.textAlign = 'right';
        ctx.fillText('— ' + (d.name.trim() || '光之子'), x + w, y + L.lines.length * L.LH + 24 * u); ctx.textAlign = 'left';
      }
    }
  };

  function drawCode(g, x, y, w, center) {
    const { ctx, S, pal, u, d } = g; const code = d.code.trim();
    ctx.font = g.font('label', 14 * (S.labelBoost || 1)); spaced(ctx, 2 * u);
    const lw = ctx.measureText('ID').width + 20 * u; spaced(ctx, 0);
    ctx.font = g.font('mono', 22 * (S.labelBoost ? 1.25 : 1)); const cw = Math.min(ctx.measureText(code).width, w - lw - 14 * u);
    const total = lw + 14 * u + cw, sx = center ? x + (w - total) / 2 : x, bh = 30 * u, cy = y + 20 * u;
    S.badge(ctx, g, sx, cy - bh / 2, lw, bh);
    ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
    ctx.font = g.font('label', 14 * (S.labelBoost || 1)); spaced(ctx, 2 * u);
    ctx.fillStyle = S.badgeInk === 'accent' ? pal.accent : pal.onAccent; ctx.fillText('ID', sx + lw / 2 + u, cy + u); spaced(ctx, 0);
    ctx.textAlign = 'left'; ctx.font = g.font('mono', 22 * (S.labelBoost ? 1.25 : 1)); ctx.fillStyle = pal.text;
    ctx.fillText(ellipsize(ctx, code, cw + 1), sx + lw + 14 * u, cy + u);
  }
  function drawRows(g, x, y, w, L, kind, size, labW) {
    const { ctx, S, pal, u } = g;
    ctx.font = g.font('label', 16 * (S.labelBoost || 1));
    labW = Math.min(labW, Math.max(...L.rows.map(r => ctx.measureText(r[1]).width)) / u + 26);
    L.rows.forEach(([icon, label, value], i) => {
      const ry = y + i * L.rh, cy = ry + L.rh / 2, is = 28 * u;
      if (i) S.rule(ctx, g, x, ry, w);
      drawIcon(ctx, g, icon, x, cy - is / 2, is, pal.accent);
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
      ctx.font = g.font('label', 16 * (S.labelBoost || 1)); ctx.fillStyle = pal.muted; ctx.fillText(label, x + is + 14 * u, cy);
      const vx = x + is + 14 * u + labW * u;
      ctx.font = g.font(kind, size * (kind === 'mono' && S.labelBoost ? 1.25 : 1)); ctx.fillStyle = pal.text;
      ctx.fillText(ellipsize(ctx, value.trim(), x + w - vx), vx, cy + u);
    });
  }
  function layChips(g, w, list, kind) {
    const { ctx, u, k } = g;
    ctx.font = g.font('body', 21);
    const ch = 46 * u, padX = 18 * u, mk = kind === 'season' ? 24 * u : 0, gap = 10 * k, pos = [];
    let cx = 0, cy = 0;
    list.forEach(t => {
      const text = kind === 'tag' ? '#' + t : t;
      const tw = Math.min(w, ctx.measureText(text).width + padX * 2 + mk);
      if (cx + tw > w && cx > 0) { cx = 0; cy += ch + gap; }
      pos.push({ text, x: cx, y: cy, w: tw }); cx += tw + gap;
    });
    if (g.S.chipAlign === 'center') { // centre each row
      const rows = {};
      pos.forEach(p => { (rows[p.y] = rows[p.y] || []).push(p); });
      Object.values(rows).forEach(r => { const last = r[r.length - 1], off = (w - (last.x + last.w)) / 2; r.forEach(p => { p.x += off; }); });
    }
    return { h: pos.length ? cy + ch : 0, pos, ch, padX, mk, kind };
  }
  function drawChips(g, x, y, L) {
    const { ctx, S, pal, u } = g;
    L.pos.forEach((p, i) => {
      S.chip(ctx, g, x + p.x, y + p.y, p.w, L.ch, L.kind, i);
      if (L.mk) drawIcon(ctx, g, 'star', x + p.x + L.padX - 2 * u, y + p.y + L.ch / 2 - 9 * u, 18 * u, pal.accent);
      ctx.font = g.font('body', 21); ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; ctx.fillStyle = pal.text;
      ctx.fillText(ellipsize(ctx, p.text, p.w - L.padX * 2 - L.mk), x + p.x + L.padX + L.mk, y + p.y + L.ch / 2 + u);
    });
  }

  // ── card layout + render ──────────────────────────────────────────────────
  const today = () => { const n = new Date(); return `${n.getFullYear()}.${String(n.getMonth() + 1).padStart(2, '0')}.${String(n.getDate()).padStart(2, '0')}`; };

  function layout(ctx, id, st) {
    const S = getStyle(id), pal = palette(S, id, st);
    const W = st.size.width, k = 1 + (W / 1080 - 1) * 0.5, u = k * st.size.text / 100;
    const g = { ctx, S, pal, st, d: st.data, W, k, u, date: today() };
    g.font = (kind, size) => { const [wt, fam] = S.fonts[kind]; return `${wt} ${Math.round(size * u * 10) / 10}px ${fam}`; };
    g.P = st.size.pad * k; g.R = st.size.radius * k; g.pr = clamp(g.R * S.radiusK, 0, 44 * k);
    g.px = Math.max(3, Math.round(5 * k)); g.ip = S.ip * k; g.gap = S.gap * k; g.headH = S.headH * u;
    g.titleH = S.titleH * u; g.footH = st.settings.mark ? S.footH * k : 0;
    const top = g.P + g.headH, innerW = W - g.P * 2;
    const show = sid => !st.hidden[sid] && hasContent(sid, st.data);
    const measure = (sid, w) => {
      const lay = SEC[sid].lay(g, w - g.ip * 2);
      return { lay, h: lay.h + g.ip * 2 + (SEC[sid].untitled ? 0 : g.titleH) };
    };
    const blocks = [];
    let bottom = top;
    let cols = st.layout === 'double' ? st.cols.map(c => c.filter(show)) : [st.order.filter(show)];
    if (cols.length === 2 && (!cols[0].length || !cols[1].length)) cols = [cols[0].concat(cols[1])];
    if (cols.length === 2) {
      const cw = (innerW - g.gap) / 2, ys = [top, top];
      cols.forEach((col, c) => col.forEach(sid => {
        const m = measure(sid, cw);
        blocks.push({ id: sid, col: c, x: g.P + c * (cw + g.gap), y: ys[c], w: cw, h: m.h, lay: m.lay }); ys[c] += m.h + g.gap;
      }));
      bottom = Math.max(...ys) - g.gap;
      [0, 1].forEach(c => { const own = blocks.filter(b => b.col === c), last = own[own.length - 1]; if (last) last.h += bottom - (ys[c] - g.gap); });
    } else {
      let y = top;
      cols[0].forEach(sid => { const m = measure(sid, innerW); blocks.push({ id: sid, col: 0, x: g.P, y, w: innerW, h: m.h, lay: m.lay }); y += m.h + g.gap; });
      bottom = blocks.length ? y - g.gap : top + 200 * k;
    }
    const H = Math.round(Math.max(W * 0.62, bottom + (g.footH ? g.footH + 12 * k : 0) + g.P));
    g.H = H;
    return { g, S, W, H, blocks };
  }

  function paint(ctx, L) {
    const { g, S, W, H, blocks } = L;
    ctx.save();
    ctx.beginPath(); S.clip(ctx, g, W, H); ctx.clip();
    S.background(ctx, g, W, H);
    S.header(ctx, g, g.P, g.P, W - g.P * 2, g.headH);
    blocks.forEach((b, i) => {
      ctx.save();
      const ang = S.panelAngle ? S.panelAngle(i, b.id) : 0;
      if (ang) { const cx = b.x + b.w / 2, cy = b.y + b.h / 2; ctx.translate(cx, cy); ctx.rotate(ang); ctx.translate(-cx, -cy); }
      S.panel(ctx, g, b.x, b.y, b.w, b.h, i, b.id);
      const ix = b.x + g.ip, iw = b.w - g.ip * 2;
      let iy = b.y + g.ip;
      if (!SEC[b.id].untitled) { const m = SECTION_META[b.id]; S.title(ctx, g, ix, iy, iw, m.label, m.en, i); iy += g.titleH; }
      SEC[b.id].draw(g, ix, iy, iw, b.h - (iy - b.y) - g.ip, b.lay);
      ctx.restore();
    });
    if (!blocks.length) {
      ctx.font = g.font('body', 28); ctx.fillStyle = g.pal.muted; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('所有區塊都藏起來了，到「版面」打開一些吧', W / 2, g.P + g.headH + 100 * g.k); ctx.textAlign = 'left';
    }
    S.overlay(ctx, g, W, H, blocks);
    if (g.footH) S.footer(ctx, g, g.P, H - g.P - g.footH, W - g.P * 2, g.footH);
    if (g.st.grain) grain(ctx, g, W, H);
    ctx.restore();
  }

  let grainTex = null;
  function grain(ctx, g, W, H) {
    if (!grainTex) {
      grainTex = document.createElement('canvas'); grainTex.width = grainTex.height = 180;
      const x = grainTex.getContext('2d'), img = x.createImageData(180, 180), r = rng(2024);
      for (let i = 0; i < img.data.length; i += 4) { const v = Math.round(r() * 255); img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 255; }
      x.putImageData(img, 0, 0);
    }
    ctx.save();
    const pat = ctx.createPattern(grainTex, 'repeat');
    const pix = g.S.iconMode === 'pixel';
    if (pix && pat.setTransform) { ctx.imageSmoothingEnabled = false; pat.setTransform(new DOMMatrix().scale(g.px)); }
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = g.pal.dark ? 0.12 : 0.16;
    ctx.fillStyle = pat; ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  // Render a card into a canvas. scale: number, or fn(W,H) -> number. fixed: {w,h} for thumbnails.
  function renderTo(canvas, st, id, scale, fixed) {
    const ctx = canvas.getContext('2d');
    const L = layout(ctx, id, st);
    if (fixed) {
      if (canvas.width !== fixed.w) canvas.width = fixed.w;
      if (canvas.height !== fixed.h) canvas.height = fixed.h;
      const s = fixed.w / L.W;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, fixed.w, fixed.h);
      const oy = Math.max(0, (fixed.h - L.H * s) / 2);
      ctx.setTransform(s, 0, 0, s, 0, oy);
    } else {
      const s = typeof scale === 'function' ? scale(L.W, L.H) : scale;
      canvas.width = Math.round(L.W * s); canvas.height = Math.round(L.H * s);
      ctx.setTransform(s, 0, 0, s, 0, 0);
    }
    ctx.imageSmoothingEnabled = true;
    paint(ctx, L);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return L;
  }

  // ── state ─────────────────────────────────────────────────────────────────
  function merge(saved) {
    const s = defaults();
    if (!saved || typeof saved !== 'object') return s;
    if (STYLES[saved.style]) s.style = saved.style;
    if (saved.layout === 'double') s.layout = 'double';
    const ids = arr => Array.isArray(arr) ? arr.filter(id => SECTION_META[id]) : [];
    const order = [...new Set(ids(saved.order))];
    s.order = [...order, ...IDS.filter(id => !order.includes(id))];
    if (Array.isArray(saved.cols) && saved.cols.length === 2) {
      const a = [...new Set(ids(saved.cols[0]))], b = [...new Set(ids(saved.cols[1]))].filter(id => !a.includes(id));
      const missing = IDS.filter(id => !a.includes(id) && !b.includes(id));
      s.cols = [a, b.concat(missing)];
    }
    if (saved.hidden && typeof saved.hidden === 'object') IDS.forEach(id => { if (saved.hidden[id]) s.hidden[id] = true; });
    if (saved.size && typeof saved.size === 'object') {
      if ([1080, 1440, 1920].includes(saved.size.width)) s.size.width = saved.size.width;
      const num = (v, a, b, f) => Number.isFinite(+v) ? clamp(+v, a, b) : f;
      s.size.pad = num(saved.size.pad, 24, 120, 60); s.size.radius = num(saved.size.radius, 0, 80, 40); s.size.text = num(saved.size.text, 80, 130, 100);
    }
    if (saved.looks && typeof saved.looks === 'object') {
      STYLE_IDS.forEach(id => {
        const l = saved.looks[id]; if (!l || typeof l !== 'object') return;
        s.looks[id] = { accent: validHex(l.accent) ? l.accent : '', bg: clamp(l.bg | 0, 0, 2) };
      });
    }
    if (typeof saved.grain === 'boolean') s.grain = saved.grain;
    if (saved.settings && typeof saved.settings === 'object') {
      s.settings.scale = saved.settings.scale === 1 ? 1 : 2;
      if (typeof saved.settings.date === 'boolean') s.settings.date = saved.settings.date;
      if (typeof saved.settings.mark === 'boolean') s.settings.mark = saved.settings.mark;
    }
    if (saved.data && typeof saved.data === 'object') {
      Object.keys(s.data).forEach(key => { if (typeof saved.data[key] === 'string') s.data[key] = saved.data[key]; });
      if (s.data.avatar && !/^data:image\//.test(s.data.avatar)) s.data.avatar = '';
    }
    return s;
  }
  function migrateV1() {
    const v1 = store.get('candle.card.v1', null);
    if (!v1 || !v1.data) return null;
    const d = v1.data, map = { name: 'name', friendCode: 'code', bio: 'bio', avatar: 'avatar', candles: 'candles', hearts: 'hearts', ascended: 'ascended', season: 'season', heightNow: 'hNow', heightMax: 'hTall', heightMin: 'hShort', realm: 'map', spirit: 'spirit', emote: 'emote', tags: 'tags', ig: 'ig', discord: 'discord', other: 'other' };
    const data = {};
    Object.entries(map).forEach(([a, b]) => { if (typeof d[a] === 'string') data[b] = d[a]; });
    return { data };
  }

  let state = merge(store.get(KEY, null) || migrateV1());

  let saveTimer = 0, warnedSave = false;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!store.set(KEY, state) && !warnedSave) { warnedSave = true; toast('瀏覽器不允許儲存，重新整理後內容會遺失'); }
    }, 300);
  }

  // undo / redo — debounced snapshots, avatars stored once in a pool
  const avatarPool = [];
  function serialize(st) {
    const av = st.data.avatar;
    let ref = '';
    if (av) { let i = avatarPool.indexOf(av); if (i < 0) { avatarPool.push(av); i = avatarPool.length - 1; } ref = '#pool:' + i; }
    return JSON.stringify({ ...st, data: { ...st.data, avatar: ref } });
  }
  function deserialize(json) {
    const o = JSON.parse(json);
    const m = /^#pool:(\d+)$/.exec(o.data.avatar || '');
    o.data.avatar = m ? avatarPool[+m[1]] || '' : '';
    return o;
  }
  const hist = { stack: [], i: -1, timer: 0 };
  function snap() {
    clearTimeout(hist.timer); hist.timer = 0;
    const json = serialize(state);
    if (hist.stack[hist.i] === json) return;
    hist.stack = hist.stack.slice(0, hist.i + 1);
    hist.stack.push(json);
    if (hist.stack.length > 50) hist.stack.shift();
    hist.i = hist.stack.length - 1;
    updateHistory();
  }
  function commit(now) {
    save();
    clearTimeout(hist.timer);
    if (now) snap(); else { hist.timer = setTimeout(snap, 450); updateHistory(true); }
  }
  function updateHistory(pending) {
    $('#btn-undo').disabled = !(hist.i > 0 || (pending && hist.stack.length));
    $('#btn-redo').disabled = !(hist.i < hist.stack.length - 1) || !!pending;
  }
  function stepHistory(dir) {
    if (hist.timer) snap();
    const j = hist.i + dir;
    if (j < 0 || j >= hist.stack.length) return;
    hist.i = j;
    state = merge(deserialize(hist.stack[j]));
    syncUI(); save(); requestRender(); updateHistory();
    toast(dir < 0 ? '已復原' : '已重做', 1200);
  }

  // ── rendering schedule ────────────────────────────────────────────────────
  const canvas = $('#card-canvas'), stage = $('#stage'), frame = $('#stage-frame');
  let zoom = 'fit', ready = false, raf = 0, thumbTimer = 0, lastLayout = null;
  function requestRender(thumbsToo = true) {
    if (!ready) return;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; renderMain(); });
    if (thumbsToo) { clearTimeout(thumbTimer); thumbTimer = setTimeout(renderThumbs, 220); }
  }
  function renderMain() {
    const dpr = window.devicePixelRatio || 1;
    const cs = getComputedStyle(frame);
    const avail = frame.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    lastLayout = renderTo(canvas, state, state.style, (W, H) => {
      const cssW = zoom === 'fit' ? Math.max(120, avail) : W;
      let s = Math.min(2, dpr * cssW / W);
      s = Math.min(s, Math.sqrt(12e6 / (W * H)));
      return Math.max(0.25, s);
    });
    const { W, H } = lastLayout, S = lastLayout.S, v = lastLayout.g.pal;
    canvas.style.width = zoom === 'fit' ? '' : W + 'px';
    $('#stage-style').textContent = `${S.name} ${S.en} · ${v.name}`;
    $('#stage-size').textContent = `${W} × ${H}`;
    $('#out-size').textContent = `${W} × ${H} px`;
    $('#pop-out').textContent = `→ ${W * state.settings.scale} × ${H * state.settings.scale} px`;
    canvas.setAttribute('aria-label', `名片預覽：${S.name}風格（${v.name}），${W} × ${H} 像素，暱稱「${state.data.name.trim() || '光之子'}」`);
  }
  function renderThumbs() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    $$('.style-tile').forEach(tile => {
      const c = tile.querySelector('canvas'), box = c.parentElement;
      const w = Math.max(40, Math.round(box.clientWidth * dpr)), h = Math.max(40, Math.round(box.clientHeight * dpr));
      renderTo(c, state, tile.dataset.style, null, { w, h });
    });
  }

  // ── UI: style strip ───────────────────────────────────────────────────────
  const strip = $('#style-strip');
  STYLE_IDS.forEach(id => {
    const S = STYLES[id];
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'style-tile'; b.dataset.style = id;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', `${S.name} ${S.en} 風格`);
    b.innerHTML = `<span class="badge" aria-hidden="true">編輯中</span><span class="thumb"><canvas aria-hidden="true"></canvas></span>
      <span class="meta"><span class="zh">${S.name}</span><span class="en">${S.en}</span></span>`;
    b.addEventListener('click', () => setStyle(id));
    b.addEventListener('keydown', e => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!dir && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      const i = STYLE_IDS.indexOf(id);
      const j = e.key === 'Home' ? 0 : e.key === 'End' ? STYLE_IDS.length - 1 : (i + dir + STYLE_IDS.length) % STYLE_IDS.length;
      setStyle(STYLE_IDS[j]); strip.querySelector(`[data-style="${STYLE_IDS[j]}"]`).focus();
    });
    strip.append(b);
  });
  function setStyle(id) {
    if (state.style === id) return;
    state.style = id; commit(true); syncStyleUI(); requestRender(false);
  }
  function syncStyleUI() {
    $$('.style-tile').forEach(t => {
      const on = t.dataset.style === state.style;
      t.setAttribute('aria-checked', on); t.tabIndex = on ? 0 : -1;
    });
    const sel = strip.querySelector('[aria-checked="true"]');
    if (sel && strip.scrollWidth > strip.clientWidth) {
      const left = sel.offsetLeft - (strip.clientWidth - sel.offsetWidth) / 2;
      strip.scrollTo({ left, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    buildSwatches(); buildVariants();
    $('#variant-style').textContent = STYLES[state.style].name;
  }

  // ── UI: tabs ──────────────────────────────────────────────────────────────
  const tabs = $$('[role="tab"]');
  function selectTab(tab, focus) {
    tabs.forEach(t => {
      const on = t === tab;
      t.setAttribute('aria-selected', on); t.tabIndex = on ? 0 : -1;
      $('#' + t.getAttribute('aria-controls')).hidden = !on;
    });
    if (focus) tab.focus();
    store.set('candle.card.tab', tab.id);
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', e => {
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (j === undefined) return;
      e.preventDefault(); selectTab(tabs[(j + tabs.length) % tabs.length], true);
    });
  });
  const savedTab = document.getElementById(store.get('candle.card.tab', '') || '');
  if (savedTab && tabs.includes(savedTab)) selectTab(savedTab);

  // ── UI: layout + drag & drop lists ────────────────────────────────────────
  const colsEl = $('#cols'), liveEl = $('#drag-live');
  const ICON = {
    eye: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.8 10S4.8 4.5 10 4.5 18.2 10 18.2 10 15.2 15.5 10 15.5 1.8 10 1.8 10z"/><circle cx="10" cy="10" r="2.6"/></svg>',
    eyeOff: '<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 3l14 14"/><path d="M8.2 5a8.6 8.6 0 0 1 1.8-.2c5.2 0 8.2 5.2 8.2 5.2a14 14 0 0 1-2.4 3M5.2 6.6A13.7 13.7 0 0 0 1.8 10s3 5.5 8.2 5.5c1.3 0 2.5-.3 3.5-.8"/><path d="M8.3 8.4a2.6 2.6 0 0 0 3.4 3.4"/></svg>',
    grip: '<svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><circle cx="7.5" cy="5" r="1.5"/><circle cx="12.5" cy="5" r="1.5"/><circle cx="7.5" cy="10" r="1.5"/><circle cx="12.5" cy="10" r="1.5"/><circle cx="7.5" cy="15" r="1.5"/><circle cx="12.5" cy="15" r="1.5"/></svg>'
  };
  const colNames = () => state.layout === 'double' ? ['左欄', '右欄'] : ['單欄'];
  const colLists = () => state.layout === 'double' ? state.cols : [state.order];

  function renderCols(focusId, focusWhat = 'handle') {
    const double = state.layout === 'double';
    colsEl.classList.toggle('is-double', double);
    colsEl.innerHTML = '';
    colLists().forEach((ids, c) => {
      const name = colNames()[c];
      const box = document.createElement('div'); box.className = 'col-box';
      const vis = ids.filter(id => !state.hidden[id]).length;
      box.innerHTML = `<div class="col-head"><b>${name}</b><span class="mono">${vis}/${double ? ids.length : IDS.length}</span></div>`;
      const ul = document.createElement('ul'); ul.className = 'sec-list'; ul.setAttribute('aria-label', name); ul.dataset.col = c;
      ids.forEach(id => ul.append(rowEl(id)));
      const empty = document.createElement('li'); empty.className = 'col-empty'; empty.textContent = '把區塊拖到這裡'; empty.hidden = ids.length > 0;
      ul.append(empty);
      box.append(ul); colsEl.append(box);
    });
    if (focusId) { const el = colsEl.querySelector(`.sec-row[data-id="${focusId}"] .${focusWhat === 'eye' ? 'eye-btn' : 'handle'}`); if (el) el.focus(); }
  }
  function rowEl(id) {
    const m = SECTION_META[id], hidden = !!state.hidden[id], empty = !hasContent(id, state.data);
    const li = document.createElement('li');
    li.className = 'sec-row' + (hidden ? ' is-hidden' : ''); li.dataset.id = id;
    li.innerHTML = `<button type="button" class="row-btn eye-btn" aria-pressed="${!hidden}" aria-label="在名片上顯示「${m.label}」">${hidden ? ICON.eyeOff : ICON.eye}</button>
      <span class="name">${m.label}${empty ? '<span class="empty-tag">· 空白</span>' : ''}</span>
      <button type="button" class="row-btn handle" aria-label="移動「${m.label}」：拖曳，或用方向鍵">${ICON.grip}</button>`;
    li.querySelector('.eye-btn').addEventListener('click', () => {
      state.hidden[id] = !state.hidden[id];
      if (!state.hidden[id]) delete state.hidden[id];
      commit(true); renderCols(id, 'eye'); updateAccStates(); requestRender();
    });
    const handle = li.querySelector('.handle');
    handle.addEventListener('pointerdown', onHandleDown);
    handle.addEventListener('keydown', onHandleKey);
    return li;
  }

  // Pointer-event drag & drop (mouse, pen and touch). The source row stays in the DOM (hidden) so the
  // handle keeps its pointer capture; a placeholder row moves around instead.
  let drag = null;
  function onHandleDown(e) {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const handle = e.currentTarget, row = handle.closest('.sec-row');
    e.preventDefault();
    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true);
    ghost.classList.add('is-ghost'); ghost.setAttribute('aria-hidden', 'true');
    Object.assign(ghost.style, { width: rect.width + 'px', height: rect.height + 'px', left: rect.left + 'px', top: rect.top + 'px' });
    document.body.append(ghost);
    const ph = document.createElement('li');
    ph.className = 'sec-row is-placeholder'; ph.style.height = rect.height + 'px'; ph.setAttribute('aria-hidden', 'true');
    row.after(ph);
    row.classList.add('is-src');
    document.body.classList.add('is-dragging');
    drag = { id: row.dataset.id, row, ph, ghost, handle, dx: e.clientX - rect.left, dy: e.clientY - rect.top, pid: e.pointerId, before: JSON.stringify(colLists()) };
    try { handle.setPointerCapture(e.pointerId); } catch (err) { /* capture is optional: window listeners below */ }
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
  }
  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    e.preventDefault();
    drag.ghost.style.left = (e.clientX - drag.dx) + 'px';
    drag.ghost.style.top = (e.clientY - drag.dy) + 'px';
    drag.ghost.style.transform = 'rotate(-1.5deg) scale(1.03)';
    const lists = $$('.sec-list', colsEl);
    let target = lists[0], best = Infinity;
    lists.forEach(l => {
      const r = l.parentElement.getBoundingClientRect();
      const dx = e.clientX < r.left ? r.left - e.clientX : e.clientX > r.right ? e.clientX - r.right : 0;
      const dy = e.clientY < r.top ? r.top - e.clientY : e.clientY > r.bottom ? e.clientY - r.bottom : 0;
      const dist = dx * 3 + dy;
      if (dist < best) { best = dist; target = l; }
    });
    $$('.col-box', colsEl).forEach(b => b.classList.toggle('is-target', lists.length > 1 && b.contains(target)));
    const rows = $$('.sec-row:not(.is-placeholder):not(.is-src)', target);
    const before = rows.find(r => { const rr = r.getBoundingClientRect(); return e.clientY < rr.top + rr.height / 2; });
    const ref = before || target.querySelector('.col-empty');
    if (drag.ph.nextElementSibling !== ref || drag.ph.parentNode !== target) target.insertBefore(drag.ph, ref);
    lists.forEach(l => { l.querySelector('.col-empty').hidden = !!l.querySelector('.sec-row:not(.is-src)'); });
    // keep the dragged row reachable on small screens
    if (e.clientY > window.innerHeight - 40) window.scrollBy(0, 12); else if (e.clientY < 70) window.scrollBy(0, -12);
  }
  function onDragEnd(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    const d = drag; drag = null;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    try { d.handle.releasePointerCapture(d.pid); } catch (err) { /* already released */ }
    d.ghost.parentNode.removeChild(d.ghost);
    document.body.classList.remove('is-dragging');
    const orders = $$('.sec-list', colsEl).map(l => [...l.children]
      .filter(li => li.classList.contains('is-placeholder') || (li.classList.contains('sec-row') && !li.classList.contains('is-src')))
      .map(li => li.classList.contains('is-placeholder') ? d.id : li.dataset.id));
    if (e.type === 'pointercancel') { renderCols(); return; }
    if (state.layout === 'double') state.cols = [orders[0], orders[1]]; else state.order = orders[0];
    const changed = JSON.stringify(colLists()) !== d.before;
    renderCols(d.id);
    if (changed) { commit(true); requestRender(); announce(d.id); }
  }
  function onHandleKey(e) {
    const id = e.currentTarget.closest('.sec-row').dataset.id;
    const lists = colLists();
    const c = lists.findIndex(l => l.includes(id)), i = lists[c].indexOf(id);
    let moved = false;
    if (e.key === 'ArrowUp' && i > 0) { lists[c].splice(i, 1); lists[c].splice(i - 1, 0, id); moved = true; }
    else if (e.key === 'ArrowDown' && i < lists[c].length - 1) { lists[c].splice(i, 1); lists[c].splice(i + 1, 0, id); moved = true; }
    else if (lists.length === 2 && ((e.key === 'ArrowLeft' && c === 1) || (e.key === 'ArrowRight' && c === 0))) {
      const t = 1 - c; lists[c].splice(i, 1); lists[t].splice(Math.min(i, lists[t].length), 0, id); moved = true;
    }
    if (!moved) return;
    e.preventDefault();
    commit(true); renderCols(id); requestRender(); announce(id);
  }
  function announce(id) {
    const lists = colLists(), c = lists.findIndex(l => l.includes(id));
    liveEl.textContent = `「${SECTION_META[id].label}」移到${colNames()[c]}第 ${lists[c].indexOf(id) + 1} 個`;
  }
  $$('.layout-opt').forEach(b => b.addEventListener('click', () => {
    if (state.layout === b.dataset.layout) return;
    state.layout = b.dataset.layout; commit(true); syncLayoutUI(); requestRender();
  }));
  function syncLayoutUI() {
    $$('.layout-opt').forEach(b => b.setAttribute('aria-checked', b.dataset.layout === state.layout));
    renderCols();
  }

  // ── UI: size ──────────────────────────────────────────────────────────────
  $$('#width-seg button').forEach(b => b.addEventListener('click', () => {
    state.size.width = +b.dataset.width; commit(true); syncSizeUI(); requestRender();
  }));
  $$('[data-size]').forEach(inp => {
    inp.addEventListener('input', () => { state.size[inp.dataset.size] = +inp.value; syncSizeUI(); requestRender(); commit(); });
  });
  function syncSizeUI() {
    $$('#width-seg button').forEach(b => b.setAttribute('aria-checked', +b.dataset.width === state.size.width));
    $$('[data-size]').forEach(inp => {
      const key = inp.dataset.size; inp.value = state.size[key];
      const pct = (inp.value - inp.min) / (inp.max - inp.min) * 100;
      inp.style.setProperty('--fill', pct + '%');
      $(`[data-out="${key}"]`).textContent = key === 'text' ? `${state.size[key]} %` : `${state.size[key]} px`;
    });
  }

  // ── UI: theme ─────────────────────────────────────────────────────────────
  const PRESETS = [['#e2b25c', '金'], ['#e07a4f', '珊瑚'], ['#d94f6b', '玫瑰'], ['#9b7bff', '紫羅蘭'], ['#4cb7ff', '天空'], ['#2fc4a4', '湖水'], ['#8cc152', '新葉'], ['#2b2b33', '墨']];
  const look = () => (state.looks[state.style] = state.looks[state.style] || { accent: '', bg: 0 });
  function buildSwatches() {
    const box = $('#swatches'), S = getStyle(state.style), cur = look().accent;
    const def = S.variants[look().bg].accent;
    const isPreset = PRESETS.some(([c]) => c === cur);
    box.innerHTML = '';
    const mk = (color, label, extra = '') => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'swatch ' + extra;
      b.style.setProperty('--sw', color || def); b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', label); b.title = label;
      b.setAttribute('aria-checked', (color || '') === (cur || '') || (!color && !cur));
      b.addEventListener('click', () => { look().accent = color; commit(true); buildSwatches(); requestRender(); });
      box.append(b);
    };
    mk('', `風格預設（${def}）`, 'is-default');
    PRESETS.forEach(([c, n]) => mk(c, n));
    const lab = document.createElement('label'); lab.className = 'swatch is-custom'; lab.title = '自訂顏色';
    if (cur && !isPreset) { lab.style.background = cur; lab.setAttribute('aria-checked', 'true'); lab.style.boxShadow = '0 0 0 2px var(--bg), 0 0 0 4px var(--gold)'; }
    lab.innerHTML = `<input type="color" aria-label="自訂強調色" value="${cur || def}"><span class="plus" aria-hidden="true">${cur && !isPreset ? '' : '+'}</span>`;
    const inp = lab.querySelector('input');
    inp.addEventListener('input', () => { look().accent = inp.value; lab.style.background = inp.value; requestRender(); commit(); });
    inp.addEventListener('change', () => { commit(true); buildSwatches(); });
    box.append(lab);
  }
  function buildVariants() {
    const box = $('#variants'), S = getStyle(state.style), cur = look().bg;
    box.innerHTML = '';
    S.variants.forEach((v, i) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'variant'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', i === cur);
      b.style.setProperty('--vbg', `linear-gradient(135deg, ${v.bg[0]}, ${v.bg[1]} 55%, ${v.bg[2]})`);
      b.style.setProperty('--vac', validHex(look().accent) ? look().accent : v.accent);
      b.innerHTML = `<i aria-hidden="true"></i>${v.name}`;
      b.addEventListener('click', () => { look().bg = i; commit(true); buildVariants(); buildSwatches(); requestRender(); });
      box.append(b);
    });
  }
  $('#opt-grain').addEventListener('change', e => { state.grain = e.target.checked; commit(true); requestRender(); });

  // ── UI: content ───────────────────────────────────────────────────────────
  let emptySig = '';
  $$('[data-field]').forEach(el => el.addEventListener('input', () => {
    state.data[el.dataset.field] = el.value;
    requestRender(); commit(); updateAccStates();
    const sig = IDS.map(id => +hasContent(id, state.data)).join('');
    if (sig !== emptySig) { emptySig = sig; if (!drag) renderCols(); }
    ensureFonts(el.value).then(loaded => { if (loaded) requestRender(); });
  }));
  function updateAccStates() {
    $$('.acc').forEach(acc => {
      const id = acc.dataset.sec, el = acc.querySelector('.acc-state');
      el.textContent = state.hidden[id] ? '已隱藏' : hasContent(id, state.data) ? '' : '空白';
    });
  }
  const avatarPreview = $('#avatar-preview'), avatarClear = $('#avatar-clear');
  function syncAvatarUI() {
    const src = state.data.avatar;
    avatarPreview.style.backgroundImage = src ? `url("${src}")` : '';
    avatarPreview.classList.toggle('is-empty', !src);
    avatarClear.hidden = !src;
  }
  async function setAvatar(file) {
    if (!file || !/^image\//.test(file.type)) { toast('請選擇圖片檔'); return; }
    try {
      const img = await loadImage(await readFileAsDataURL(file));
      const s = Math.min(img.width, img.height), size = Math.min(400, s);
      const c = document.createElement('canvas'); c.width = c.height = size;
      const x = c.getContext('2d'); x.imageSmoothingQuality = 'high';
      x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
      x.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      state.data.avatar = c.toDataURL('image/jpeg', 0.86);
      syncAvatar(); syncAvatarUI(); commit(true);
      toast('頭像已更新');
    } catch (err) { toast(err && err.message ? err.message : '圖片無法讀取'); }
  }
  bindDropzone($('#avatar-drop'), $('#avatar-input'), setAvatar);
  avatarClear.addEventListener('click', () => { state.data.avatar = ''; syncAvatar(); syncAvatarUI(); commit(true); $('#avatar-drop').focus(); });

  $('#import-height').addEventListener('click', () => {
    const h = store.get('candle.height.last', null);
    const n = v => (v !== null && v !== '' && Number.isFinite(Number(v))) ? Number(v) : null;
    if (!h || typeof h !== 'object' || n(h.current) === null) { toast('還沒有身高紀錄，先到身高工具量一次吧'); return; }
    const f = v => n(v) === null ? '' : String(Math.round(n(v) * 100) / 100);
    state.data.hNow = f(h.current); state.data.hTall = f(h.tallest); state.data.hShort = f(h.shortest);
    delete state.hidden.height;
    ['hNow', 'hTall', 'hShort'].forEach(key => { $(`[data-field="${key}"]`).value = state.data[key]; });
    commit(true); renderCols(); updateAccStates(); requestRender();
    toast('已從身高工具帶入');
  });

  // ── toolbar ───────────────────────────────────────────────────────────────
  $('#btn-undo').addEventListener('click', () => stepHistory(-1));
  $('#btn-redo').addEventListener('click', () => stepHistory(1));
  $('#btn-zoom').addEventListener('click', e => {
    zoom = zoom === 'fit' ? 'actual' : 'fit';
    stage.dataset.zoom = zoom;
    e.currentTarget.setAttribute('aria-pressed', zoom === 'actual');
    $('#cap-zoom').textContent = zoom === 'fit' ? '縮放' : '100%';
    requestRender(false);
    toast(zoom === 'fit' ? '縮放：符合寬度' : '縮放：100% 原始尺寸', 1400);
  });
  $('#btn-reset').addEventListener('click', () => {
    if (hist.timer) snap();
    const keepSettings = state.settings;
    state = defaults(); state.settings = keepSettings;
    commit(true); syncUI(); requestRender();
    toast('已重設為預設內容 · 按「復原」可以找回', 3200);
  });
  $('#btn-download').addEventListener('click', () => {
    const btn = $('#btn-download'); btn.disabled = true;
    const out = document.createElement('canvas');
    try {
      const L = renderTo(out, state, state.style, state.settings.scale);
      out.toBlob(blob => {
        btn.disabled = false;
        if (!blob) { toast('匯出失敗，請再試一次'); return; }
        const a = document.createElement('a');
        const safe = (state.data.name.trim() || 'profile').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
        a.href = URL.createObjectURL(blob); a.download = `candle-card-${safe}.png`;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast(`已下載 PNG · ${Math.round(L.W * state.settings.scale)} × ${Math.round(L.H * state.settings.scale)}`);
      }, 'image/png');
    } catch (err) { btn.disabled = false; toast('匯出失敗，請再試一次'); }
  });

  // settings popover
  const pop = $('#settings-pop'), popBtn = $('#btn-settings');
  function setPop(open, returnFocus) {
    pop.hidden = !open; popBtn.setAttribute('aria-expanded', open);
    if (open) (pop.querySelector('[aria-checked="true"]') || pop.querySelector('button, input')).focus();
    else if (returnFocus) popBtn.focus();
  }
  popBtn.addEventListener('click', () => setPop(pop.hidden));
  document.addEventListener('pointerdown', e => { if (!pop.hidden && !pop.contains(e.target) && !popBtn.contains(e.target)) setPop(false); });
  pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); setPop(false, true); } });
  $$('#scale-seg button').forEach(b => b.addEventListener('click', () => { state.settings.scale = +b.dataset.scale; commit(true); syncSettingsUI(); requestRender(false); }));
  $('#scale-seg').addEventListener('keydown', e => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault(); state.settings.scale = state.settings.scale === 1 ? 2 : 1; commit(true); syncSettingsUI(); requestRender(false);
    $(`#scale-seg [data-scale="${state.settings.scale}"]`).focus();
  });
  $('#opt-date').addEventListener('change', e => { state.settings.date = e.target.checked; commit(true); requestRender(); });
  $('#opt-mark').addEventListener('change', e => { state.settings.mark = e.target.checked; commit(true); requestRender(); });
  function syncSettingsUI() {
    $$('#scale-seg button').forEach(b => { const on = +b.dataset.scale === state.settings.scale; b.setAttribute('aria-checked', on); b.tabIndex = on ? 0 : -1; });
    $('#opt-date').checked = state.settings.date; $('#opt-mark').checked = state.settings.mark;
  }
  // radiogroups built from plain buttons: arrow keys move the choice
  [['#width-seg', 'button'], ['.layout-pick', 'button']].forEach(([sel]) => {
    $(sel).addEventListener('keydown', e => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!dir) return;
      const btns = $$('button', $(sel)), i = btns.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); const nb = btns[(i + dir + btns.length) % btns.length]; nb.click(); nb.focus();
    });
  });

  // swatches / variants are rebuilt on change, so re-focus by index after the click
  ['#swatches', '#variants'].forEach(sel => {
    const box = $(sel);
    box.addEventListener('keydown', e => {
      const dir = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]; if (!dir) return;
      const btns = $$('button', box), i = btns.indexOf(document.activeElement); if (i < 0) return;
      e.preventDefault(); const j = (i + dir + btns.length) % btns.length; btns[j].click();
      const again = $$('button', box)[j]; if (again) again.focus();
    });
  });

  // keyboard shortcuts
  document.addEventListener('keydown', e => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    const t = e.target;
    if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && /^(text|search|url|email|number|tel)$/i.test(t.type || 'text')))) return; // native field undo
    e.preventDefault();
    stepHistory(key === 'y' || e.shiftKey ? 1 : -1);
  });

  // ── sync everything from state ────────────────────────────────────────────
  function syncUI() {
    syncStyleUI(); syncLayoutUI(); syncSizeUI(); syncSettingsUI();
    $('#opt-grain').checked = state.grain;
    $$('[data-field]').forEach(el => { el.value = state.data[el.dataset.field] || ''; });
    syncAvatar(); syncAvatarUI(); updateAccStates();
    emptySig = IDS.map(id => +hasContent(id, state.data)).join('');
  }

  syncUI();
  snap();

  // re-render on size changes (fit-to-width + thumbnails)
  if ('ResizeObserver' in window) {
    let lastW = 0;
    new ResizeObserver(() => { if (Math.abs(frame.clientWidth - lastW) > 2) { lastW = frame.clientWidth; requestRender(); } }).observe(frame);
  } else window.addEventListener('resize', () => requestRender());
  if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => requestRender());

  (async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    try {
      if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, wait(3000)]);
      await Promise.race([ensureFonts(collectText()), wait(3500)]);
    } catch (err) { /* fonts are progressive enhancement */ }
    ready = true;
    renderMain(); renderThumbs();
    stage.classList.add('is-ready');
  })();
})();
