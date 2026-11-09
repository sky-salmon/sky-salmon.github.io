/* 名片產生器 — renders a profile card on <canvas> and exports PNG. */
(function () {
  'use strict';
  const { store, readFileAsDataURL, loadImage, bindDropzone } = window.Site;
  const STORAGE_KEY = 'candle.card.v1';
  const FONT = '"Noto Sans TC", "PingFang TC", "Microsoft JhengHei", system-ui, sans-serif';

  // ── themes ──────────────────────────────────────────────────────────────
  const THEMES = {
    night: {
      label: '夜空', bg: ['#0f1530', '#24204a'], panel: 'rgba(255,255,255,0.07)', line: 'rgba(255,255,255,0.12)',
      text: '#f6f1e7', muted: '#b9b6c8', accent: '#f2c46d', decor: 'stars'
    },
    dawn: {
      label: '晨光', bg: ['#fff4e4', '#f6d6c4'], panel: 'rgba(255,255,255,0.65)', line: 'rgba(120,80,60,0.15)',
      text: '#3a2a22', muted: '#8c6f62', accent: '#d9774e', decor: 'sun'
    },
    dusk: {
      label: '霞紅', bg: ['#3b2357', '#e07f6f'], panel: 'rgba(20,10,30,0.25)', line: 'rgba(255,255,255,0.18)',
      text: '#fff3ea', muted: '#f2cfc4', accent: '#ffd38a', decor: 'dunes'
    },
    meadow: {
      label: '草原', bg: ['#e9f4ea', '#b9dccd'], panel: 'rgba(255,255,255,0.6)', line: 'rgba(30,80,60,0.15)',
      text: '#1f3a32', muted: '#55786c', accent: '#2f8f6f', decor: 'petals'
    }
  };

  const SECTION_META = {
    profile: '個人資料', stats: '收藏', height: '身高', favorites: '最愛', tags: '標籤', links: '社群連結'
  };

  const DEFAULT_STATE = {
    theme: 'night',
    layout: 'single',
    order: ['profile', 'stats', 'height', 'favorites', 'tags', 'links'],
    hidden: {},
    data: {
      name: '小光', friendCode: '', bio: '喜歡在雲上飛、在暴風眼前發抖的光之子。',
      avatar: '', candles: '120', hearts: '36', ascended: '8', season: '24',
      heightNow: '', heightMin: '', heightMax: '',
      realm: '雲野', spirit: '', emote: '', tags: '跑圖, 拍照, 合奏', ig: '', discord: '', other: ''
    }
  };

  const state = mergeState(store.get(STORAGE_KEY, null));
  let avatarImg = null;

  function mergeState(saved) {
    const s = JSON.parse(JSON.stringify(DEFAULT_STATE));
    if (!saved || typeof saved !== 'object') return s;
    if (THEMES[saved.theme]) s.theme = saved.theme;
    if (saved.layout === 'double') s.layout = 'double';
    if (Array.isArray(saved.order)) {
      const valid = saved.order.filter(id => SECTION_META[id]);
      s.order = [...new Set([...valid, ...s.order])];
    }
    if (saved.hidden && typeof saved.hidden === 'object') s.hidden = saved.hidden;
    if (saved.data && typeof saved.data === 'object') {
      for (const k of Object.keys(s.data)) if (typeof saved.data[k] === 'string') s.data[k] = saved.data[k];
    }
    return s;
  }

  // ── canvas helpers ──────────────────────────────────────────────────────
  function font(size, weight = 400) { return `${weight} ${size}px ${FONT}`; }

  function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Wrap text for mixed CJK/Latin: CJK breaks anywhere, Latin breaks at spaces.
  function wrap(ctx, text, maxWidth, maxLines = 99) {
    const lines = [];
    for (const para of String(text || '').split('\n')) {
      const tokens = para.match(/[⺀-鿿豈-﫿＀-￯]|[^\s⺀-鿿豈-﫿＀-￯]+|\s+/g) || [''];
      let line = '';
      for (const tok of tokens) {
        const next = line + tok;
        if (ctx.measureText(next).width <= maxWidth || !line) { line = next; continue; }
        lines.push(line.trimEnd());
        line = tok.trimStart();
      }
      lines.push(line);
    }
    if (lines.length > maxLines) {
      const cut = lines.slice(0, maxLines);
      cut[maxLines - 1] = cut[maxLines - 1].replace(/.$/, '…');
      return cut;
    }
    return lines;
  }

  function num(v) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }

  // ── icons (drawn, not images) ───────────────────────────────────────────
  const ICONS = {
    candle(ctx, x, y, s, c) {
      ctx.fillStyle = c;
      rrect(ctx, x + s * 0.32, y + s * 0.45, s * 0.36, s * 0.5, s * 0.08); ctx.fill();
      ctx.beginPath(); ctx.moveTo(x + s * 0.5, y + s * 0.02);
      ctx.quadraticCurveTo(x + s * 0.74, y + s * 0.3, x + s * 0.5, y + s * 0.4);
      ctx.quadraticCurveTo(x + s * 0.26, y + s * 0.3, x + s * 0.5, y + s * 0.02); ctx.fill();
    },
    heart(ctx, x, y, s, c) {
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.9);
      ctx.bezierCurveTo(x - s * 0.1, y + s * 0.45, x + s * 0.15, y - s * 0.05, x + s * 0.5, y + s * 0.28);
      ctx.bezierCurveTo(x + s * 0.85, y - s * 0.05, x + s * 1.1, y + s * 0.45, x + s * 0.5, y + s * 0.9);
      ctx.fill();
    },
    ascended(ctx, x, y, s, c) {
      ctx.fillStyle = c; ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y); ctx.lineTo(x + s * 0.88, y + s * 0.5);
      ctx.lineTo(x + s * 0.5, y + s); ctx.lineTo(x + s * 0.12, y + s * 0.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.beginPath();
      ctx.moveTo(x + s * 0.5, y + s * 0.22); ctx.lineTo(x + s * 0.68, y + s * 0.5);
      ctx.lineTo(x + s * 0.5, y + s * 0.78); ctx.lineTo(x + s * 0.32, y + s * 0.5); ctx.closePath(); ctx.fill();
    },
    star(ctx, x, y, s, c) {
      ctx.fillStyle = c; ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? s * 0.22 : s * 0.5, a = -Math.PI / 2 + i * Math.PI / 5;
        ctx.lineTo(x + s / 2 + Math.cos(a) * r, y + s / 2 + Math.sin(a) * r);
      }
      ctx.closePath(); ctx.fill();
    }
  };

  // ── sections: each has measure(w) -> height and draw(x, y, w) ───────────
  const PAD = 36, TITLE_H = 44, GAP = 24;

  function sectionTitle(ctx, t, title, x, y) {
    ctx.fillStyle = t.accent; ctx.font = font(22, 700);
    ctx.textBaseline = 'top'; ctx.fillText(title, x + PAD, y + PAD - 4);
  }

  const SECTIONS = {
    profile: {
      measure(ctx, w, d) {
        const textW = w - PAD * 3 - 180;
        ctx.font = font(28);
        const bioLines = d.bio ? wrap(ctx, d.bio, textW, 4).length : 0;
        const textH = 70 + (d.friendCode ? 44 : 0) + (bioLines ? 14 + bioLines * 40 : 0);
        return PAD * 2 + Math.max(180, textH);
      },
      draw(ctx, x, y, w, h, d, t) {
        const ax = x + PAD, ay = y + PAD, size = 180;
        ctx.save();
        ctx.beginPath(); ctx.arc(ax + size / 2, ay + size / 2, size / 2, 0, Math.PI * 2); ctx.clip();
        if (avatarImg) {
          const s = Math.min(avatarImg.width, avatarImg.height);
          ctx.drawImage(avatarImg, (avatarImg.width - s) / 2, (avatarImg.height - s) / 2, s, s, ax, ay, size, size);
        } else {
          const g = ctx.createLinearGradient(ax, ay, ax, ay + size);
          g.addColorStop(0, t.accent); g.addColorStop(1, t.muted);
          ctx.fillStyle = g; ctx.fillRect(ax, ay, size, size);
          ICONS.candle(ctx, ax + size * 0.25, ay + size * 0.2, size * 0.5, 'rgba(255,255,255,0.85)');
        }
        ctx.restore();
        ctx.strokeStyle = t.accent; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.arc(ax + size / 2, ay + size / 2, size / 2 + 6, 0, Math.PI * 2); ctx.stroke();

        const tx = ax + size + PAD, textW = w - PAD * 3 - size;
        let ty = ay + 6;
        ctx.textBaseline = 'top';
        ctx.fillStyle = t.text; ctx.font = font(54, 800);
        ctx.fillText(wrap(ctx, d.name || '光之子', textW, 1)[0], tx, ty); ty += 70;
        if (d.friendCode) {
          ctx.fillStyle = t.accent; ctx.font = font(26, 600);
          ctx.fillText(wrap(ctx, 'ID · ' + d.friendCode, textW, 1)[0], tx, ty); ty += 44;
        }
        if (d.bio) {
          ctx.fillStyle = t.muted; ctx.font = font(28);
          ty += 14;
          for (const line of wrap(ctx, d.bio, textW, 4)) { ctx.fillText(line, tx, ty); ty += 40; }
        }
      }
    },
    stats: {
      items: d => [
        ['candle', d.candles, '蠟燭'], ['heart', d.hearts, '愛心'], ['ascended', d.ascended, '升華蠟燭'], ['star', d.season, '季節蠟燭']
      ].filter(i => String(i[1]).trim() !== ''),
      measure(ctx, w, d) {
        const n = this.items(d).length;
        if (!n) return PAD * 2 + TITLE_H + 40;
        const cols = w > 700 ? 4 : 2;
        return PAD * 2 + TITLE_H + Math.ceil(n / cols) * 150 - 14;
      },
      draw(ctx, x, y, w, h, d, t) {
        sectionTitle(ctx, t, '收藏', x, y);
        const items = this.items(d);
        if (!items.length) { ctx.fillStyle = t.muted; ctx.font = font(26); ctx.fillText('尚未填寫', x + PAD, y + PAD + TITLE_H); return; }
        const cols = w > 700 ? 4 : 2, gap = 14;
        const tileW = (w - PAD * 2 - gap * (cols - 1)) / cols;
        items.forEach(([icon, value, label], i) => {
          const tx = x + PAD + (i % cols) * (tileW + gap), ty = y + PAD + TITLE_H + Math.floor(i / cols) * 150;
          ctx.fillStyle = t.panel; rrect(ctx, tx, ty, tileW, 136, 20); ctx.fill();
          ICONS[icon](ctx, tx + 20, ty + 20, 36, t.accent);
          ctx.fillStyle = t.text; ctx.font = font(46, 800); ctx.textBaseline = 'top';
          ctx.fillText(wrap(ctx, String(value), tileW - 40, 1)[0], tx + 20, ty + 62);
          ctx.fillStyle = t.muted; ctx.font = font(20, 500);
          ctx.fillText(label, tx + 66, ty + 28);
        });
      }
    },
    height: {
      measure() { return PAD * 2 + TITLE_H + 130; },
      draw(ctx, x, y, w, h, d, t) {
        sectionTitle(ctx, t, '身高', x, y);
        const now = num(d.heightNow), min = num(d.heightMin), max = num(d.heightMax);
        const by = y + PAD + TITLE_H;
        ctx.textBaseline = 'top';
        ctx.fillStyle = t.text; ctx.font = font(52, 800);
        ctx.fillText(now === null ? '—' : now.toFixed(2), x + PAD, by);
        ctx.fillStyle = t.muted; ctx.font = font(22, 500);
        ctx.fillText(min !== null && max !== null ? `可調整範圍 ${min.toFixed(2)} ～ ${max.toFixed(2)}` : '目前身高（數值越大越高）', x + PAD, by + 64);
        // range track
        const trackX = x + PAD, trackW = w - PAD * 2, trackY = by + 108;
        ctx.fillStyle = t.line; rrect(ctx, trackX, trackY, trackW, 12, 6); ctx.fill();
        if (now !== null && min !== null && max !== null && max > min) {
          const p = Math.min(1, Math.max(0, (now - min) / (max - min)));
          const g = ctx.createLinearGradient(trackX, 0, trackX + trackW, 0);
          g.addColorStop(0, t.muted); g.addColorStop(1, t.accent);
          ctx.fillStyle = g; rrect(ctx, trackX, trackY, Math.max(12, trackW * p), 12, 6); ctx.fill();
          ctx.fillStyle = t.text; ctx.beginPath(); ctx.arc(trackX + trackW * p, trackY + 6, 12, 0, Math.PI * 2); ctx.fill();
        }
      }
    },
    favorites: {
      rows: d => [['地圖', d.realm], ['先祖', d.spirit], ['動作', d.emote]].filter(r => String(r[1]).trim()),
      measure(ctx, w, d) { return PAD * 2 + TITLE_H + Math.max(1, this.rows(d).length) * 50 - 10; },
      draw(ctx, x, y, w, h, d, t) {
        sectionTitle(ctx, t, '最愛', x, y);
        const rows = this.rows(d);
        let ry = y + PAD + TITLE_H;
        ctx.textBaseline = 'top';
        if (!rows.length) { ctx.fillStyle = t.muted; ctx.font = font(26); ctx.fillText('尚未填寫', x + PAD, ry); return; }
        for (const [k, v] of rows) {
          ctx.fillStyle = t.muted; ctx.font = font(24, 500); ctx.fillText(k, x + PAD, ry + 2);
          ctx.fillStyle = t.text; ctx.font = font(28, 700);
          ctx.fillText(wrap(ctx, v, w - PAD * 2 - 100, 1)[0], x + PAD + 100, ry);
          ry += 50;
        }
      }
    },
    tags: {
      list: d => String(d.tags || '').split(/[,，、]/).map(s => s.trim()).filter(Boolean).slice(0, 16),
      layout(ctx, w, d) {
        ctx.font = font(24, 600);
        const maxW = w - PAD * 2, pos = [];
        let cx = 0, cy = 0;
        for (const tag of this.list(d)) {
          const tw = Math.min(maxW, ctx.measureText(tag).width + 40);
          if (cx + tw > maxW && cx > 0) { cx = 0; cy += 58; }
          pos.push({ tag, x: cx, y: cy, w: tw }); cx += tw + 12;
        }
        return { pos, height: pos.length ? cy + 46 : 36 };
      },
      measure(ctx, w, d) { return PAD * 2 + TITLE_H + this.layout(ctx, w, d).height; },
      draw(ctx, x, y, w, h, d, t) {
        sectionTitle(ctx, t, '標籤', x, y);
        const { pos } = this.layout(ctx, w, d);
        const by = y + PAD + TITLE_H;
        ctx.textBaseline = 'middle';
        if (!pos.length) { ctx.fillStyle = t.muted; ctx.font = font(26); ctx.fillText('尚未填寫', x + PAD, by + 16); return; }
        for (const p of pos) {
          ctx.fillStyle = t.panel; rrect(ctx, x + PAD + p.x, by + p.y, p.w, 46, 23); ctx.fill();
          ctx.strokeStyle = t.line; ctx.lineWidth = 2; ctx.stroke();
          ctx.fillStyle = t.text; ctx.font = font(24, 600);
          ctx.fillText(wrap(ctx, p.tag, p.w - 40, 1)[0], x + PAD + p.x + 20, by + p.y + 24);
        }
      }
    },
    links: {
      rows: d => [['Instagram', d.ig], ['Discord', d.discord], ['其他', d.other]].filter(r => String(r[1]).trim()),
      measure(ctx, w, d) { return PAD * 2 + TITLE_H + Math.max(1, this.rows(d).length) * 50 - 10; },
      draw(ctx, x, y, w, h, d, t) {
        sectionTitle(ctx, t, '社群連結', x, y);
        const rows = this.rows(d);
        let ry = y + PAD + TITLE_H;
        ctx.textBaseline = 'top';
        if (!rows.length) { ctx.fillStyle = t.muted; ctx.font = font(26); ctx.fillText('尚未填寫', x + PAD, ry); return; }
        for (const [k, v] of rows) {
          ctx.fillStyle = t.muted; ctx.font = font(24, 500); ctx.fillText(k, x + PAD, ry + 2);
          ctx.fillStyle = t.text; ctx.font = font(28, 700);
          ctx.fillText(wrap(ctx, v, w - PAD * 2 - 150, 1)[0], x + PAD + 150, ry);
          ry += 50;
        }
      }
    }
  };

  // ── background decor ────────────────────────────────────────────────────
  function decor(ctx, W, H, t) {
    ctx.save();
    if (t.decor === 'stars') {
      for (let i = 0; i < 120; i++) {
        const x = (Math.sin(i * 91.7) * 0.5 + 0.5) * W, y = (Math.sin(i * 37.3) * 0.5 + 0.5) * H;
        ctx.fillStyle = `rgba(255,248,230,${0.15 + (i % 5) * 0.08})`;
        ctx.beginPath(); ctx.arc(x, y, 1 + (i % 3), 0, Math.PI * 2); ctx.fill();
      }
    } else if (t.decor === 'sun') {
      const g = ctx.createRadialGradient(W * 0.85, H * 0.08, 0, W * 0.85, H * 0.08, W * 0.6);
      g.addColorStop(0, 'rgba(255,214,150,0.7)'); g.addColorStop(1, 'rgba(255,214,150,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    } else if (t.decor === 'dunes') {
      ctx.fillStyle = 'rgba(30,15,40,0.25)';
      ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H - 140 - Math.sin(x / W * 5) * 50);
      ctx.lineTo(W, H); ctx.fill();
    } else if (t.decor === 'petals') {
      for (let i = 0; i < 40; i++) {
        const x = (Math.sin(i * 53.1) * 0.5 + 0.5) * W, y = (Math.sin(i * 17.9) * 0.5 + 0.5) * H;
        ctx.fillStyle = `rgba(47,143,111,${0.06 + (i % 4) * 0.03})`;
        ctx.beginPath(); ctx.ellipse(x, y, 18, 8, i, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.restore();
  }

  // ── render ──────────────────────────────────────────────────────────────
  const canvas = document.getElementById('card-canvas');
  const ctx = canvas.getContext('2d');

  function render() {
    const t = THEMES[state.theme], d = state.data;
    const visible = state.order.filter(id => !state.hidden[id]);
    const double = state.layout === 'double';
    const W = double ? 1600 : 1080, M = 56, HEADER = 96, FOOTER = 70;
    const colW = double ? (W - M * 2 - GAP) / 2 : W - M * 2;

    // profile spans the full width in double layout; the rest alternate columns
    const placed = [];
    const colY = [HEADER, HEADER];
    for (const id of visible) {
      const full = !double || id === 'profile';
      const w = full ? W - M * 2 : colW;
      const h = SECTIONS[id].measure(ctx, w, d);
      if (full) {
        const y = Math.max(colY[0], colY[1]);
        placed.push({ id, x: M, y, w, h });
        colY[0] = colY[1] = y + h + GAP;
      } else {
        const c = colY[0] <= colY[1] ? 0 : 1;
        placed.push({ id, x: M + c * (colW + GAP), y: colY[c], w, h });
        colY[c] += h + GAP;
      }
    }
    const H = Math.max(double ? 900 : 1080, Math.max(colY[0], colY[1]) - GAP + FOOTER);

    canvas.width = W; canvas.height = H;
    const bg = ctx.createLinearGradient(0, 0, W * 0.3, H);
    bg.addColorStop(0, t.bg[0]); bg.addColorStop(1, t.bg[1]);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    decor(ctx, W, H, t);

    ctx.textBaseline = 'middle';
    ctx.fillStyle = t.accent; ctx.font = font(22, 700);
    ctx.fillText('SKY · PROFILE CARD', M, 52);
    ctx.textAlign = 'right'; ctx.fillStyle = t.muted; ctx.font = font(20, 500);
    ctx.fillText(new Date().toLocaleDateString('zh-TW'), W - M, 52);
    ctx.textAlign = 'left';

    for (const p of placed) {
      ctx.fillStyle = t.panel; rrect(ctx, p.x, p.y, p.w, p.h, 28); ctx.fill();
      ctx.strokeStyle = t.line; ctx.lineWidth = 2; ctx.stroke();
      SECTIONS[p.id].draw(ctx, p.x, p.y, p.w, p.h, d, t);
    }
    if (!placed.length) {
      ctx.fillStyle = t.muted; ctx.font = font(30); ctx.textAlign = 'center';
      ctx.fillText('所有區塊都被隱藏了，到「版面」打開一些吧', W / 2, H / 2); ctx.textAlign = 'left';
    }

    ctx.textBaseline = 'middle'; ctx.fillStyle = t.muted; ctx.font = font(18, 500);
    ctx.fillText('燭光小站 · Sky Fan Toolkit', M, H - 36);
    document.getElementById('card-size').textContent = `${W} × ${H}`;
  }

  let saveTimer = 0;
  function update() {
    render();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!store.set(STORAGE_KEY, state)) setStatus('瀏覽器不允許儲存，重新整理後內容會遺失。', 'error');
    }, 300);
  }

  // ── editor UI ───────────────────────────────────────────────────────────
  const statusEl = document.getElementById('card-status');
  function setStatus(msg, kind = '') { statusEl.textContent = msg; statusEl.className = 'status ' + kind; }

  // content fields
  document.querySelectorAll('[data-field]').forEach(el => {
    el.value = state.data[el.dataset.field] || '';
    el.addEventListener('input', () => { state.data[el.dataset.field] = el.value; update(); });
  });

  // avatar upload: downscale to 400px JPEG so it fits in localStorage
  async function setAvatar(file) {
    if (!file.type.startsWith('image/')) { setStatus('請選擇圖片檔。', 'error'); return; }
    try {
      const img = await loadImage(await readFileAsDataURL(file));
      const s = Math.min(img.width, img.height), out = document.createElement('canvas');
      out.width = out.height = 400;
      out.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 400, 400);
      state.data.avatar = out.toDataURL('image/jpeg', 0.86);
      avatarImg = await loadImage(state.data.avatar);
      setStatus('頭像已更新。', 'ok');
      update();
    } catch (e) { setStatus(e.message, 'error'); }
  }
  bindDropzone(document.getElementById('avatar-drop'), document.getElementById('avatar-input'), setAvatar);
  document.getElementById('avatar-clear').addEventListener('click', () => {
    state.data.avatar = ''; avatarImg = null; update();
  });

  document.getElementById('import-height').addEventListener('click', () => {
    const h = store.get('candle.height.last', null);
    if (!h || !Number.isFinite(h.current)) { setStatus('還沒有身高紀錄，先到「身高」頁計算一次。', 'error'); return; }
    state.data.heightNow = h.current.toFixed(2);
    state.data.heightMin = h.shortest.toFixed(2);
    state.data.heightMax = h.tallest.toFixed(2);
    ['heightNow', 'heightMin', 'heightMax'].forEach(k => { const el = document.querySelector(`[data-field="${k}"]`); if (el) el.value = state.data[k]; });
    state.hidden.height = false; renderSectionList();
    setStatus('已帶入身高。', 'ok'); update();
  });

  // tabs
  const tabs = document.querySelectorAll('[role="tab"]');
  tabs.forEach(tab => tab.addEventListener('click', () => {
    tabs.forEach(t => { const on = t === tab; t.setAttribute('aria-selected', on); document.getElementById(t.getAttribute('aria-controls')).hidden = !on; });
  }));

  // layout: section visibility and order
  const listEl = document.getElementById('section-list');
  function renderSectionList() {
    listEl.innerHTML = '';
    state.order.forEach((id, i) => {
      const li = document.createElement('li');
      li.className = 'section-item' + (state.hidden[id] ? ' is-hidden' : '');
      li.innerHTML = `<label><input type="checkbox" ${state.hidden[id] ? '' : 'checked'}> ${SECTION_META[id]}</label>
        <span class="btn-group"><button class="icon-btn" data-move="-1" aria-label="上移 ${SECTION_META[id]}" ${i === 0 ? 'disabled' : ''}>↑</button>
        <button class="icon-btn" data-move="1" aria-label="下移 ${SECTION_META[id]}" ${i === state.order.length - 1 ? 'disabled' : ''}>↓</button></span>`;
      li.querySelector('input').addEventListener('change', e => { state.hidden[id] = !e.target.checked; renderSectionList(); update(); });
      li.querySelectorAll('[data-move]').forEach(b => b.addEventListener('click', () => {
        const j = i + Number(b.dataset.move);
        [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
        renderSectionList(); update();
      }));
      listEl.append(li);
    });
  }
  document.querySelectorAll('[name="layout"]').forEach(r => {
    r.checked = r.value === state.layout;
    r.addEventListener('change', () => { state.layout = r.value; update(); });
  });

  // themes
  const themeEl = document.getElementById('theme-list');
  Object.entries(THEMES).forEach(([id, t]) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'theme-swatch'; b.dataset.theme = id;
    b.style.background = `linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]})`;
    b.style.color = t.text;
    b.innerHTML = `<span style="background:${t.accent}"></span>${t.label}`;
    b.setAttribute('aria-pressed', id === state.theme);
    b.addEventListener('click', () => {
      state.theme = id;
      themeEl.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
      update();
    });
    themeEl.append(b);
  });

  // export / reset
  document.getElementById('download').addEventListener('click', () => {
    canvas.toBlob(blob => {
      if (!blob) { setStatus('匯出失敗，請再試一次。', 'error'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sky-card-${(state.data.name || 'profile').replace(/[\\/:*?"<>|\s]+/g, '_')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus('已下載圖片。', 'ok');
    }, 'image/png');
  });
  document.getElementById('reset').addEventListener('click', () => {
    if (!confirm('要清除所有內容並回到預設嗎？')) return;
    Object.assign(state, JSON.parse(JSON.stringify(DEFAULT_STATE)));
    avatarImg = null;
    document.querySelectorAll('[data-field]').forEach(el => { el.value = state.data[el.dataset.field] || ''; });
    document.querySelectorAll('[name="layout"]').forEach(r => { r.checked = r.value === state.layout; });
    themeEl.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.theme === state.theme));
    renderSectionList(); update();
  });

  renderSectionList();
  (async () => {
    if (state.data.avatar) { try { avatarImg = await loadImage(state.data.avatar); } catch { state.data.avatar = ''; } }
    // wait for webfonts (if any) so the first render measures text correctly
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    render();
  })();
})();
