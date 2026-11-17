/* sky-salmon — home page behaviour.
 *   hero      the clip's pause button; a warm light that follows the pointer over the clip;
 *             the top bar turns to glass once the page scrolls
 *   card      a small card that tilts toward the pointer
 *   wardrobe  the catalogue counted by kind; pointing at a bar names it
 *   height    the height page's own formula on one slider
 *   events    the recurring events on their two-hour cycle, live, in game time (America/Los_Angeles)
 *   music     fifteen keys, C4–C6, synthesised with Web Audio
 *   album     three prints from the clip to drag around
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
  if (hero && media && stage) {
    // where the light rests: the lamp-lit hair ties under the hat, in the clip's own pixels
    const REST = [1000, 545];
    let x = 0, y = 0, tx = 0, ty = 0, held = false, seen = true, raf = 0, last = 0, started = false;
    const rest = () => {
      const m = media.getBoundingClientRect(), s = stage.getBoundingClientRect();
      return [s.left - m.left + REST[0] / 1280 * s.width, s.top - m.top + REST[1] / 802 * s.height];
    };
    const frame = now => {
      raf = 0;
      if (!seen || document.hidden) return;
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
      if (!held) [tx, ty] = rest();
      if (!started) { x = tx; y = ty; started = true; }
      const k = 1 - Math.exp(-dt * (held ? 10 : 3));
      x += (tx - x) * k; y += (ty - y) * k;
      media.style.setProperty('--lx', x.toFixed(1) + 'px'); media.style.setProperty('--ly', y.toFixed(1) + 'px');
      // keep going only while the light is still on its way
      if (Math.abs(tx - x) > 0.3 || Math.abs(ty - y) > 0.3) raf = requestAnimationFrame(frame);
      else last = 0;
    };
    const wake = () => { if (!raf && seen && !document.hidden) raf = requestAnimationFrame(frame); };
    const point = e => {
      const r = media.getBoundingClientRect();
      if (e.clientY > r.bottom) return;
      held = true; tx = e.clientX - r.left; ty = e.clientY - r.top; media.classList.add('is-lit'); wake();
    };
    const letGo = () => { held = false; media.classList.remove('is-lit'); wake(); };
    hero.addEventListener('pointermove', e => { if (e.pointerType !== 'touch' || e.buttons) point(e); });
    hero.addEventListener('pointerdown', point);
    hero.addEventListener('pointerleave', letGo);
    hero.addEventListener('pointerup', e => { if (e.pointerType === 'touch') letGo(); });
    new ResizeObserver(wake).observe(media);
    new IntersectionObserver(es => { seen = es[0].isIntersecting; wake(); }).observe(media);
    document.addEventListener('visibilitychange', wake);
    wake();
  }

  /* ── card: tilt toward the pointer ─────────────────────────────────── */
  const cardStage = $('card-stage'), card = $('mini-card');
  if (cardStage && card) {
    cardStage.addEventListener('pointermove', e => {
      if (reduce.matches) return;
      const r = card.getBoundingClientRect();
      const cx = Math.max(-0.2, Math.min(1.2, (e.clientX - r.left) / r.width)), cy = Math.max(-0.2, Math.min(1.2, (e.clientY - r.top) / r.height));
      card.style.setProperty('--rx', ((0.5 - cy) * 22).toFixed(2) + 'deg');
      card.style.setProperty('--ry', ((cx - 0.5) * 28).toFixed(2) + 'deg');
      card.style.setProperty('--gx', (cx * 100).toFixed(1) + '%'); card.style.setProperty('--gy', (cy * 100).toFixed(1) + '%');
      card.classList.add('is-tilted');
    });
    cardStage.addEventListener('pointerleave', () => { card.classList.remove('is-tilted'); card.style.setProperty('--rx', '0deg'); card.style.setProperty('--ry', '0deg'); });
  }

  /* ── wardrobe: pointing at a bar puts its kind and count in the heading ── */
  const hist = $('hist'), histN = $('hist-n'), histK = $('hist-k');
  if (hist && histN && histK) {
    const total = histN.textContent, unit = histK.textContent;
    const show = li => {
      histN.textContent = li ? li.style.getPropertyValue('--n').trim() : total;
      histK.textContent = li ? `件 · ${li.dataset.k}` : unit;
      hist.querySelectorAll('li').forEach(x => x.classList.toggle('is-pick', x === li));
    };
    hist.querySelectorAll('li').forEach(li => {
      li.addEventListener('pointerenter', () => show(li)); li.addEventListener('focus', () => show(li));
      li.addEventListener('pointerleave', () => show(null)); li.addEventListener('blur', () => show(null));
    });
  }

  /* ── height: the page's formula (scale held at 0) ──────────────────── */
  const hIn = $('h-height');
  if (hIn) {
    const kid = $('kid'), FOOT = 192;
    // the figure is a sketch that stretches with the slider; the number is the height page's own estimate
    const show = () => {
      const hgt = Number(hIn.value), cur = 7.6 - 3 * hgt;
      $('h-val').textContent = cur.toFixed(2);
      kid.setAttribute('transform', `translate(75 ${FOOT}) scale(1 ${(1 + hgt * 0.1).toFixed(3)})`);
      hIn.style.setProperty('--p', ((hgt + 2) / 4 * 100) + '%');
    };
    hIn.addEventListener('input', show); show();
  }

  /* ── events: the two-hour cycle ────────────────────────────────────── */
  // the same schedule as the events page: even PT hours, a ten-minute window each
  const EVENTS = [
    { name: '聖島間歇泉', at: 5, color: '#d8a54c' },
    { name: '奶奶的晚餐', at: 35, color: '#d0604f' },
    { name: '聖島海龜', at: 50, color: '#8fb07a' }
  ];
  const DUR = 10, CYCLE = 120;
  const dial = $('dial');
  if (dial) {
    const NS = 'http://www.w3.org/2000/svg', C = 120, R = 96;
    const el = (tag, attrs, parent = dial) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.appendChild(n); return n; };
    const pt = (min, r) => { const a = (min / CYCLE) * 2 * Math.PI - Math.PI / 2; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
    const arc = (m0, m1, r) => { const [x0, y0] = pt(m0, r), [x1, y1] = pt(m1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
    el('circle', { cx: C, cy: C, r: R, class: 'dial-track' });
    for (let m = 0; m < CYCLE; m += 10) {
      const [a, b] = pt(m, R - 14), [c, d] = pt(m, R - 9);
      el('line', { x1: a.toFixed(2), y1: b.toFixed(2), x2: c.toFixed(2), y2: d.toFixed(2), class: m % 60 === 0 ? 'dial-tick is-big' : 'dial-tick' });
    }
    const arcs = EVENTS.map(ev => el('path', { d: arc(ev.at, ev.at + DUR, R), class: 'dial-arc', style: `--c:${ev.color}` }));
    // the hand is a needle across the ring, so the countdown in the middle stays clear
    const hand = el('g', { class: 'dial-hand' });
    el('line', { x1: C, y1: C - R + 16, x2: C, y2: C - R - 10 }, hand);
    el('circle', { cx: C, cy: C - R, r: 5 }, hand);

    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    const clock = sec => { sec = Math.floor(sec); return sec >= 3600 ? `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}` : `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
    const tick = () => {
      const p = {};
      for (const part of fmt.formatToParts(Date.now())) p[part.type] = Number(part.value);
      const pos = (p.hour % 2) * 60 + p.minute + p.second / 60;   // minutes into the cycle
      hand.setAttribute('transform', `rotate(${(pos / CYCLE) * 360} ${C} ${C})`);
      let best = null;
      EVENTS.forEach((ev, i) => {
        const on = pos >= ev.at && pos < ev.at + DUR, wait = on ? -1 : ((ev.at - pos) % CYCLE + CYCLE) % CYCLE;
        arcs[i].classList.toggle('is-on', on);
        if (!best || wait < best.wait) best = { ev, on, wait, left: on ? (ev.at + DUR - pos) * 60 : wait * 60 };
      });
      $('dial-k').textContent = best.on ? '進行中' : '下一場';
      $('dial-name').textContent = best.ev.name;
      $('dial-name').style.color = best.ev.color;
      $('dial-cd').textContent = best.on ? `剩 ${clock(best.left)}` : clock(best.left);
    };
    tick();
    setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
  }

  /* ── music: fifteen keys ───────────────────────────────────────────── */
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
    const lay = () => {
      const { W, H, w, h } = box(), n = prints.length, ROT = [-7, 5, -3], DY = [-0.16, 0.14, -0.02];
      prints.forEach((p, i) => {
        st[i] = { x: (W - w) * (i + 0.5) / n, y: (H - h) / 2 + DY[i % 3] * (H - h), r: ROT[i % 3] };
        clamp(i); put(i, false);
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
    new ResizeObserver(() => { if (moved) prints.forEach((_, i) => { clamp(i); put(i, false); }); else lay(); }).observe(table);
    lay();
  }
})();
