/* sky-salmon — home page behaviour.
 *   hero    the clip's pause button; a warm light that follows the pointer over the clip, with motes of light rising
 *           through it; the top bar turns to glass once the page scrolls
 *   radar   the recurring events on their two-hour cycle, live, in game time (America/Los_Angeles)
 *   harp    fifteen keys, C4–C6, synthesised with Web Audio
 *   height  the height page's own formula on two sliders
 *   card    a small card that tilts toward the pointer
 *   album   three shots from the clip; a click sends the top one to the back
 * Every part checks that its elements exist, so a missing block never stops the rest. */
(() => {
  const $ = id => document.getElementById(id);
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const pad = n => String(n).padStart(2, '0');

  /* ── the clip: pause button, reduced motion ────────────────────────── */
  const video = $('home-video'), pauseBtn = $('hero-pause');
  if (video && pauseBtn) {
    const sync = () => {
      pauseBtn.dataset.state = video.paused ? 'paused' : 'playing';
      pauseBtn.setAttribute('aria-label', video.paused ? '播放影片' : '暫停影片');
    };
    if (reduce.matches) { video.removeAttribute('autoplay'); video.pause(); }
    pauseBtn.addEventListener('click', () => { if (video.paused) video.play().catch(() => {}); else video.pause(); });
    video.addEventListener('play', sync); video.addEventListener('pause', sync); sync();
  }
  const scrolled = () => document.body.classList.toggle('home-scrolled', scrollY > 24);
  addEventListener('scroll', scrolled, { passive: true }); scrolled();

  /* ── the light over the clip ───────────────────────────────────────── */
  const hero = $('hero'), media = hero && hero.querySelector('.hero-media'), stage = hero && hero.querySelector('.hero-stage');
  const canvas = $('hero-motes');
  if (hero && media && stage) {
    // where the light rests: the lamp-lit hair ties under the hat, in the clip's own pixels
    const REST = [1000, 545];
    let W = 0, H = 0, dpr = 1, x = 0, y = 0, tx = 0, ty = 0, held = false, seen = true, raf = 0, last = 0, t0 = performance.now();
    const ctx = canvas && canvas.getContext('2d');
    const rest = () => {
      const m = media.getBoundingClientRect(), s = stage.getBoundingClientRect();
      return [s.left - m.left + REST[0] / 1280 * s.width, s.top - m.top + REST[1] / 802 * s.height];
    };
    const size = () => {
      const r = media.getBoundingClientRect(); W = r.width; H = r.height; dpr = Math.min(devicePixelRatio || 1, 2);
      if (canvas) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
      if (!held) { [tx, ty] = rest(); if (!last) { x = tx; y = ty; } }
    };
    // motes: a few dozen specks drifting upward, brighter near the light
    const motes = [];
    const spawn = (m, anywhere) => {
      m.x = Math.random() * W; m.y = anywhere ? Math.random() * H : H * (0.75 + Math.random() * 0.3);
      m.r = 0.6 + Math.random() * 1.6; m.v = 6 + Math.random() * 16; m.ph = Math.random() * 6.28; m.sw = 6 + Math.random() * 14;
      return m;
    };
    const frame = now => {
      raf = 0;
      if (!seen || document.hidden) return;
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      if (!held) {
        const [rx, ry] = rest(), t = (now - t0) / 1000;
        tx = rx + (reduce.matches ? 0 : Math.sin(t * 0.7) * 14); ty = ry + (reduce.matches ? 0 : Math.cos(t * 0.9) * 8);
      }
      const k = 1 - Math.exp(-dt * (held ? 10 : 3));
      x += (tx - x) * k; y += (ty - y) * k;
      media.style.setProperty('--lx', x.toFixed(1) + 'px'); media.style.setProperty('--ly', y.toFixed(1) + 'px');
      if (ctx && !reduce.matches) {
        if (!motes.length) for (let i = 0; i < 46; i++) motes.push(spawn({}, true));
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.globalCompositeOperation = 'lighter';
        for (const m of motes) {
          m.y -= m.v * dt; m.ph += dt * 0.8;
          // near the light the specks lean toward it and glow
          const dx = x - m.x, dy = y - m.y, d = Math.hypot(dx, dy), near = Math.max(0, 1 - d / 260);
          m.x += (Math.sin(m.ph) * m.sw * dt) + dx * near * dt * 0.35;
          if (m.y < -10 || m.x < -20 || m.x > W + 20) spawn(m, false);
          const fade = Math.min(1, m.y / (H * 0.25)) * Math.min(1, (H - m.y) / (H * 0.2) + 0.2);
          const a = Math.max(0, fade) * (0.16 + near * 0.5), r = m.r * (1 + near * 0.7);
          const g = ctx.createRadialGradient(m.x, m.y, 0, m.x, m.y, r * 3);
          g.addColorStop(0, `rgba(255, 226, 170, ${a})`); g.addColorStop(1, 'rgba(255, 190, 110, 0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(m.x, m.y, r * 3, 0, 6.283); ctx.fill();
        }
      }
      raf = requestAnimationFrame(frame);
    };
    const wake = () => { if (!raf && seen && !document.hidden) { last = 0; raf = requestAnimationFrame(frame); } };
    const point = e => {
      const r = media.getBoundingClientRect();
      if (e.clientY > r.bottom) return;
      held = true; tx = e.clientX - r.left; ty = e.clientY - r.top; media.classList.add('is-lit');
    };
    hero.addEventListener('pointermove', e => { if (e.pointerType !== 'touch' || e.buttons) point(e); });
    hero.addEventListener('pointerdown', point);
    hero.addEventListener('pointerleave', () => { held = false; media.classList.remove('is-lit'); });
    hero.addEventListener('pointerup', e => { if (e.pointerType === 'touch') { held = false; media.classList.remove('is-lit'); } });
    new ResizeObserver(size).observe(media);
    new IntersectionObserver(es => { seen = es[0].isIntersecting; wake(); }).observe(media);
    document.addEventListener('visibilitychange', wake);
    size(); wake();
  }

  /* ── radar: the two-hour cycle ─────────────────────────────────────── */
  // the same schedule as the events page: even PT hours, a ten-minute window each
  const EVENTS = [
    { id: 'geyser', name: '聖島間歇泉', at: 5, color: '#d8a54c' },
    { id: 'grandma', name: '奶奶的晚餐', at: 35, color: '#d0604f' },
    { id: 'turtle', name: '聖島海龜', at: 50, color: '#8fb07a' }
  ];
  const DUR = 10, CYCLE = 120;
  const dial = $('dial');
  if (dial) {
    const NS = 'http://www.w3.org/2000/svg', C = 120, R = 92;
    const el = (tag, attrs, parent = dial) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.appendChild(n); return n; };
    const pt = (min, r) => { const a = (min / CYCLE) * 2 * Math.PI - Math.PI / 2; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
    const arc = (m0, m1, r) => { const [x0, y0] = pt(m0, r), [x1, y1] = pt(m1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${m1 - m0 > CYCLE / 2 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
    el('circle', { cx: C, cy: C, r: R, class: 'dial-track' });
    for (let m = 0; m < CYCLE; m += 5) {
      const big = m % 30 === 0, [a, b] = pt(m, R - (big ? 14 : 9)), [c, d] = pt(m, R - 5);
      el('line', { x1: a.toFixed(2), y1: b.toFixed(2), x2: c.toFixed(2), y2: d.toFixed(2), class: big ? 'dial-tick is-big' : 'dial-tick' });
    }
    const label = (m, text) => { const [a, b] = pt(m, R - 26); const t = el('text', { x: a.toFixed(1), y: (b + 3.5).toFixed(1), class: 'dial-num' }); t.textContent = text; };
    label(0, '偶數時'); label(60, '+1 小時');
    const arcs = {};
    for (const ev of EVENTS) {
      arcs[ev.id] = el('path', { d: arc(ev.at, ev.at + DUR, R), class: 'dial-arc', style: `--c:${ev.color}` });
      const [a, b] = pt(ev.at + DUR / 2, R + 15), t = el('text', { x: a.toFixed(1), y: (b + 3.5).toFixed(1), class: 'dial-lbl', style: `--c:${ev.color}` });
      t.textContent = ':' + pad(ev.at);
    }
    // the hand is a needle across the ring, so the countdown in the middle stays clear
    const hand = el('g', { class: 'dial-hand' });
    el('line', { x1: C, y1: C - R + 18, x2: C, y2: C - R - 9 }, hand);
    el('circle', { cx: C, cy: C - R, r: 5 }, hand);

    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const local = ms => new Date(ms).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const mmss = sec => { sec = Math.floor(sec); return sec >= 3600 ? `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}` : `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
    const rows = Object.fromEntries([...document.querySelectorAll('#ev-list li')].map(li => [li.dataset.id, li]));
    const tick = () => {
      const now = Date.now(), p = {};
      for (const part of fmt.formatToParts(now)) p[part.type] = Number(part.value);
      const h = p.hour % 24, sec = h * 3600 + p.minute * 60 + p.second;
      const pos = (h % 2) * 60 + p.minute + p.second / 60;   // minutes into the cycle
      hand.setAttribute('transform', `rotate(${(pos / CYCLE) * 360} ${C} ${C})`);
      let best = null;
      for (const ev of EVENTS) {
        const row = rows[ev.id], on = pos >= ev.at && pos < ev.at + DUR;
        const wait = on ? 0 : ((ev.at - pos) % CYCLE + CYCLE) % CYCLE;   // minutes until it starts
        const left = on ? (ev.at + DUR - pos) * 60 : wait * 60;
        arcs[ev.id].classList.toggle('is-on', on);
        if (row) {
          row.classList.toggle('is-on', on);
          row.querySelector('.ev-t').textContent = local(now + (on ? -(pos - ev.at) : wait) * 60000);
          const mins = Math.ceil(wait);
          row.querySelector('.ev-s').textContent = on ? `進行中 · 剩 ${mmss(left)}` : mins < 60 ? `${mins} 分後` : `${Math.floor(mins / 60)} 小時 ${mins % 60} 分後`;
        }
        const rank = on ? -1 : wait;
        if (!best || rank < best.rank) best = { ev, on, left, rank };
      }
      $('dial-k').textContent = best.on ? '進行中' : '下一場';
      $('dial-name').textContent = best.ev.name;
      $('dial-name').style.color = best.ev.color;
      $('dial-cd').textContent = best.on ? `剩 ${mmss(best.left)}` : mmss(best.left);
      const toReset = 86400 - sec;
      $('reset-cd').textContent = `${pad(Math.floor(toReset / 3600))}:${pad(Math.floor(toReset / 60) % 60)}:${pad(toReset % 60)}`;
      $('reset-bar').style.width = (sec / 864).toFixed(2) + '%';
      $('pt-now').textContent = `${pad(h)}:${pad(p.minute)}`;
    };
    tick();
    setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
  }

  /* ── harp: fifteen keys ────────────────────────────────────────────── */
  const harp = $('harp');
  if (harp) {
    const STEPS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];   // C major from C4
    const CODES = [
      ['KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
      ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB']
    ];
    const keys = [...harp.querySelectorAll('.key')];
    let ac = null, out = null;
    const audio = () => {
      if (!ac) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null;
        ac = new AC(); out = ac.createGain(); out.gain.value = 0.55;
        const comp = ac.createDynamicsCompressor(); out.connect(comp); comp.connect(ac.destination);
      }
      if (ac.state === 'suspended') ac.resume();
      return ac;
    };
    // a plucked, harp-like tone: triangle + an octave of sine, a quick attack and a long fall, the brightness closing as it rings
    const pluck = (i, when) => {
      const c = audio(); if (!c) return;
      const t = Math.max(when || 0, c.currentTime), f = 261.63 * Math.pow(2, STEPS[i] / 12);
      const g = c.createGain(), lp = c.createBiquadFilter(), o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(f * 7, 12000), t); lp.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.9);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.8);
      o1.type = 'triangle'; o1.frequency.value = f; o2.type = 'sine'; o2.frequency.value = f * 2; g2.gain.value = 0.28;
      o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(out);
      o1.start(t); o2.start(t); o1.stop(t + 1.9); o2.stop(t + 1.9);
    };
    const flash = i => {
      const k = keys[i]; if (!k) return;
      k.classList.remove('is-on'); void k.offsetWidth; k.classList.add('is-on');
      clearTimeout(k._t); k._t = setTimeout(() => k.classList.remove('is-on'), 420);
    };
    const play = i => { pluck(i); flash(i); };
    keys.forEach((k, i) => k.addEventListener('pointerdown', e => { e.preventDefault(); play(i); }));
    keys.forEach((k, i) => k.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); play(i); } }));
    harp.addEventListener('keydown', e => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      for (const map of CODES) { const i = map.indexOf(e.code); if (i >= 0) { e.preventDefault(); play(i); return; } }
    });
    // the first lines of 小星星, as the music page writes them
    const SONG = 'C4+C5 C5 G5 G5 | F4+A5 A5 G5:2 | F4+F5 F5 E5 E5 | G4+D5 D5 C4+C5:2';
    const NAMES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'];
    const demo = $('harp-demo'); let timers = [];
    if (demo) demo.addEventListener('click', () => {
      timers.forEach(clearTimeout); timers = [];
      const c = audio(); if (!c) return;
      const beat = 60 / 108, start = c.currentTime + 0.08;
      let pos = 0;
      for (const tok of SONG.split(/\s+/)) {
        if (tok === '|') continue;
        const [body, len] = tok.split(':'), at = pos;
        body.split('+').forEach(n => {
          const i = NAMES.indexOf(n); if (i < 0) return;
          pluck(i, start + at * beat);
          timers.push(setTimeout(() => flash(i), (0.08 + at * beat) * 1000));
        });
        pos += Number(len || 1);
      }
      demo.classList.add('is-playing');
      timers.push(setTimeout(() => demo.classList.remove('is-playing'), (pos * beat + 0.6) * 1000));
    });
  }

  /* ── height: the page's formula on two sliders ─────────────────────── */
  const hIn = $('h-height'), sIn = $('h-scale');
  if (hIn && sIn) {
    const kid = $('kid'), ghost = $('kid-ghost'), gKid = $('guide-kid'), gGhost = $('guide-ghost');
    const TOP = 108, FOOT = 192;   // the kid shape is 108 units tall, standing on y = 192
    // the figure is a sketch: scale sets the overall size, height stretches it; the numbers are the height page's own
    const shape = (hgt, scl) => { const s = 1 + scl * 1.6, sy = s * (1 + hgt * 0.07); return { s, sy }; };
    const place = (g, line, hgt, scl) => {
      const { s, sy } = shape(hgt, scl);
      g.setAttribute('transform', `translate(75 ${FOOT}) scale(${s.toFixed(3)} ${sy.toFixed(3)})`);
      const y = (FOOT - TOP * sy).toFixed(1); line.setAttribute('y1', y); line.setAttribute('y2', y);
    };
    place(ghost, gGhost, 0, 0);
    const show = () => {
      const hgt = Number(hIn.value), scl = Number(sIn.value);
      const base = 7.6 - 8.3 * scl, cur = base - 3 * hgt, tall = base - 6, short = base + 6;
      $('o-height').textContent = hgt.toFixed(2); $('o-scale').textContent = scl.toFixed(2);
      $('h-val').textContent = cur.toFixed(2); $('h-tall').textContent = tall.toFixed(2); $('h-short').textContent = short.toFixed(2);
      $('h-mark').style.left = ((cur - tall) / 12 * 100).toFixed(1) + '%';
      place(kid, gKid, hgt, scl);
      hIn.style.setProperty('--p', ((hgt + 2) / 4 * 100) + '%'); sIn.style.setProperty('--p', ((scl + 0.2) / 0.4 * 100) + '%');
    };
    hIn.addEventListener('input', show); sIn.addEventListener('input', show); show();
  }

  /* ── card: tilt toward the pointer ─────────────────────────────────── */
  const cardStage = $('card-stage'), card = $('mini-card');
  if (cardStage && card) {
    const tilt = e => {
      if (reduce.matches) return;
      const r = card.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      const cx = Math.max(-0.2, Math.min(1.2, px)), cy = Math.max(-0.2, Math.min(1.2, py));
      card.style.setProperty('--rx', ((0.5 - cy) * 22).toFixed(2) + 'deg');
      card.style.setProperty('--ry', ((cx - 0.5) * 28).toFixed(2) + 'deg');
      card.style.setProperty('--gx', (cx * 100).toFixed(1) + '%'); card.style.setProperty('--gy', (cy * 100).toFixed(1) + '%');
      card.classList.add('is-tilted');
    };
    const tile = cardStage.closest('.tile') || cardStage;
    tile.addEventListener('pointermove', tilt);
    tile.addEventListener('pointerleave', () => { card.classList.remove('is-tilted'); card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
  }

  /* ── album: prints on a light table, dragged with a pointer or moved with the arrow keys ── */
  const table = $('snaps');
  if (table) {
    const prints = [...table.querySelectorAll('.snap')];
    let top = prints.length, moved = false;
    const st = prints.map(() => ({ x: 0, y: 0, r: 0 }));
    const box = () => ({ W: table.clientWidth, H: table.clientHeight, w: prints[0].offsetWidth, h: prints[0].offsetHeight });
    const put = (i, animate = true) => {
      const p = prints[i], s = st[i];
      p.classList.toggle('no-anim', !animate);
      p.style.setProperty('--x', s.x.toFixed(1) + 'px'); p.style.setProperty('--y', s.y.toFixed(1) + 'px'); p.style.setProperty('--r', s.r.toFixed(1) + 'deg');
    };
    const clamp = i => { const { W, H, w, h } = box(); st[i].x = Math.max(0, Math.min(W - w, st[i].x)); st[i].y = Math.max(0, Math.min(H - h, st[i].y)); };
    const lay = (scatter, animate) => {
      const { W, H, w, h } = box(), n = prints.length;
      const ROT = [-7, 4, -3], DY = [-0.18, 0.12, -0.04];
      prints.forEach((p, i) => {
        const cx = scatter ? w / 2 + Math.random() * (W - w) : (W - w) * (i + 0.5) / n + w / 2;
        const cy = scatter ? h / 2 + Math.random() * (H - h) : H / 2 + DY[i % 3] * (H - h);
        st[i] = { x: cx - w / 2, y: cy - h / 2, r: scatter ? Math.random() * 16 - 8 : ROT[i % 3] };
        clamp(i); put(i, animate);
      });
    };
    const front = i => { prints[i].style.zIndex = String(++top); };
    prints.forEach((p, i) => {
      let sx = 0, sy = 0, ox = 0, oy = 0, id = null;
      p.addEventListener('pointerdown', e => {
        if (e.button > 0) return;
        id = e.pointerId; p.setPointerCapture(id); front(i);
        sx = e.clientX; sy = e.clientY; ox = st[i].x; oy = st[i].y;
        p.classList.add('is-drag'); st[i].r *= 0.3; put(i, false);
      });
      p.addEventListener('pointermove', e => {
        if (e.pointerId !== id) return;
        st[i].x = ox + e.clientX - sx; st[i].y = oy + e.clientY - sy; clamp(i); put(i, false); moved = true;
      });
      const drop = e => {
        if (e.pointerId !== id) return;
        id = null; p.classList.remove('is-drag');
        st[i].r = Math.max(-8, Math.min(8, st[i].r + (Math.random() * 6 - 3))); put(i, true);
      };
      p.addEventListener('pointerup', drop); p.addEventListener('pointercancel', drop);
      p.addEventListener('keydown', e => {
        const step = e.shiftKey ? 36 : 12, d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
        if (d) { e.preventDefault(); front(i); st[i].x += d[0]; st[i].y += d[1]; clamp(i); put(i, true); moved = true; }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); front(i); }
      });
    });
    const shuffle = $('snaps-shuffle');
    if (shuffle) shuffle.addEventListener('click', () => { lay(true, true); moved = true; });
    new ResizeObserver(() => { if (moved) prints.forEach((_, i) => { clamp(i); put(i, false); }); else lay(false, false); }).observe(table);
    lay(false, false);
  }
})();
