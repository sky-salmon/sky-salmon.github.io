/* sky-salmon — home page behaviour (a module; the 3D stage in home-stage.js is loaded only when it is needed).
 *   clip      the pause button; a warm light that follows the pointer over the clip; the top bar turns to glass once
 *             the page scrolls
 *   hand-off  as the page scrolls, the clip (pinned behind the page) fades and the stage's kid fades in over the same
 *             spot, drawn through the clip's own camera, then stands up into the stage; the sun rises behind them
 *   index     the six tools as a list; opening one turns the stage to it
 *   stage     the author's own Sky kid: one camera shot and pose per tool, drag to turn; their head follows the
 *             pointer and a tap makes them call, as in the game
 *   per tool  card: a name card that tilts · wardrobe: other capes · height: the height page's formula on the kid's
 *             real body · events: the two-hour clock, live, in game time · music: fifteen keys · album: take a picture
 * Every part checks that its elements exist, so a missing block never stops the rest. */
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
// The clip sits behind the page, so the pointer is followed on the window, for as long as the clip still shows.
const hero = $('hero'), media = hero && hero.querySelector('.hero-media'), clipStage = hero && hero.querySelector('.hero-stage');
let clipGone = false;   // set by the hand-off below once the clip has faded out
if (hero && media && clipStage) {
  const REST = [1000, 545];   // where the light rests: the lamp-lit hair ties under the hat, in the clip's own pixels
  let x = 0, y = 0, tx = 0, ty = 0, held = false, raf = 0, last = 0, started = false;
  const rest = () => {
    const m = media.getBoundingClientRect(), s = clipStage.getBoundingClientRect();
    return [s.left - m.left + REST[0] / 1280 * s.width, s.top - m.top + REST[1] / 802 * s.height];
  };
  const frame = now => {
    raf = 0;
    if (clipGone || document.hidden) return;
    const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now;
    if (!held) [tx, ty] = rest();
    if (!started) { x = tx; y = ty; started = true; }
    const k = 1 - Math.exp(-dt * (held ? 10 : 3));
    x += (tx - x) * k; y += (ty - y) * k;
    media.style.setProperty('--lx', x.toFixed(1) + 'px'); media.style.setProperty('--ly', y.toFixed(1) + 'px');
    if (Math.abs(tx - x) > 0.3 || Math.abs(ty - y) > 0.3) raf = requestAnimationFrame(frame); else last = 0;   // stop once it has arrived
  };
  const wake = () => { if (!raf && !clipGone && !document.hidden) raf = requestAnimationFrame(frame); };
  const letGo = () => { if (held) { held = false; media.classList.remove('is-lit'); wake(); } };
  addEventListener('pointermove', e => {
    if (clipGone || (e.pointerType === 'touch' && !e.buttons)) return;
    const r = media.getBoundingClientRect();
    if (e.clientY > r.bottom || e.clientY < r.top) return letGo();
    held = true; tx = e.clientX - r.left; ty = e.clientY - r.top; media.classList.add('is-lit'); wake();
  }, { passive: true });
  addEventListener('pointerup', e => { if (e.pointerType === 'touch') letGo(); });
  document.documentElement.addEventListener('pointerleave', letGo);
  new ResizeObserver(wake).observe(media);
  document.addEventListener('visibilitychange', wake);
  wake();
}

/* ── the index and the stage ───────────────────────────────────────── */
const stageEl = $('stage'), toolEls = [...document.querySelectorAll('.tool')];
const narrow = matchMedia('(max-width: 920px)');   // the layout where the stage is pinned above the list
let stage = null, active = 'card', hintOff = () => {};
const onShow = {};   // tool → what to do when it opens (each tool below adds its own)

function open(name, { scroll = false } = {}) {
  active = name;
  for (const li of toolEls) {
    const on = li.dataset.tool === name, panel = li.querySelector('.tool-panel');
    li.classList.toggle('is-open', on);
    li.querySelector('.tool-name').setAttribute('aria-expanded', String(on));
    panel.inert = !on;
    // on a narrow screen the stage is pinned above the list: bring the opened row up under it once the list has settled
    if (on && scroll && stageEl && narrow.matches) setTimeout(() => {
      const top = li.getBoundingClientRect().top, want = stageEl.getBoundingClientRect().bottom + 6;
      if (Math.abs(top - want) > 24) scrollBy({ top: top - want, behavior: reduce.matches ? 'auto' : 'smooth' });
    }, 520);
  }
  if (stageEl) stageEl.dataset.tool = name;
  if (stage) stage.shot(name);
  if (onShow[name]) onShow[name]();
}
toolEls.forEach(li => {
  li.querySelector('.tool-panel').inert = !li.classList.contains('is-open');
  li.querySelector('.tool-name').addEventListener('click', () => { if (active !== li.dataset.tool) open(li.dataset.tool, { scroll: true }); });
});

// the stage itself: loaded once the section is near, after the page has finished loading
const canvas = $('stage-canvas');
const webgl = () => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } };
async function mount() {
  if (!stageEl || !canvas) return;
  const still = () => { stageEl.classList.add('is-still'); const img = $('stage-still'); if (img) img.hidden = false; canvas.hidden = true; };
  if (!webgl()) return still();
  try {
    const veil = $('stage-veil');
    const { mountStage } = await import('./home-stage.js');
    stage = await mountStage({ canvas, container: stageEl, reducedMotion: reduce.matches, onProgress: p => veil && veil.style.setProperty('--p', Math.round(p * 100) + '%') });
    stage.shot(active);
    handoff();
    stageEl.classList.add('is-ready'); hintOff();
    window.__home = { stage, open };
    if (onShow[active]) onShow[active]();
  } catch (e) { console.warn('[home] stage left out', e); still(); }
}
if (stageEl) {
  let asked = false;
  const go = () => { if (asked) return; asked = true; (window.requestIdleCallback || setTimeout)(mount, { timeout: 1200 }); };
  const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true }); } }, { rootMargin: '600px' });
  near.observe(stageEl);
  stageEl.addEventListener('stage-grab', () => stageEl.classList.add('is-touched'));
  hintOff = () => setTimeout(() => stageEl.classList.add('is-touched'), 9000);   // the hint leaves on its own after a while
}

/* ── hand-off: the clip becomes the stage as the page scrolls ───────── */
// T is how far the page scrolls for the whole change: on a wide screen most of the clip's height; on a narrow one,
// exactly until the list arrives under the pinned stage. Everything else reads how far along that is.
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
let T = 400, queued = 0, pausedByScroll = false;
function measure() {
  if (!hero || !stageEl) return;
  const made = $('made');
  if (narrow.matches && made) {
    const top = parseFloat(getComputedStyle(stageEl).top) || 58;
    T = Math.max(140, made.getBoundingClientRect().top + scrollY - (top + stageEl.offsetHeight + 16));
  } else T = hero.offsetHeight * 0.6;
}
function handoff() {
  queued = 0;
  if (!hero || !stageEl) return;
  const p = Math.min(1, Math.max(0, scrollY / T)), step = reduce.matches ? (p > 0.5 ? 1 : 0) : null;
  const v = { fade: step ?? smooth(0.06, 0.7, p), kid: step ?? smooth(0.2, 0.78, p), rise: step ?? smooth(0.3, 1, p), solid: step ?? smooth(0.5, 0.95, p) };
  for (const k in v) document.body.style.setProperty('--' + k, v[k].toFixed(3));
  document.body.classList.toggle('is-live', p >= 0.9);
  document.body.classList.toggle('is-past', p >= 1);
  clipGone = p >= 1;
  // the clip rests while it cannot be seen
  if (video) {
    if (clipGone && !video.paused) { video.pause(); pausedByScroll = true; }
    else if (!clipGone && pausedByScroll) { pausedByScroll = false; if (!reduce.matches) video.play().catch(() => {}); }
  }
  if (stage && clipStage) {
    const f = clipStage.getBoundingClientRect(), c = stageEl.getBoundingClientRect();
    stage.handoff(step ?? smooth(0.34, 1, p), { x: f.left - c.left, y: f.top - c.top, w: f.width, h: f.height }, v.kid > 0.001);
  }
}
if (hero && stageEl) {
  const ask = () => { if (!queued) queued = requestAnimationFrame(handoff); };
  addEventListener('scroll', ask, { passive: true });
  addEventListener('resize', () => { measure(); ask(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); ask(); });
  measure(); handoff();
}

/* ── life: the kid looks toward the pointer, and answers a tap with a call ── */
if (stageEl) {
  // the pointer anywhere in the section turns the head a little; leaving lets it go back
  const made = $('scene');
  made.addEventListener('pointermove', e => {
    if (!stage || e.pointerType === 'touch' || reduce.matches) return;
    const r = stageEl.getBoundingClientRect();
    stage.gaze((e.clientX - (r.left + r.width / 2)) / (r.width * 0.7), (e.clientY - (r.top + r.height * 0.36)) / (r.height * 0.7));
  });
  made.addEventListener('pointerleave', () => stage && stage.gaze(0, 0));
  // the call: one ring of light from the kid's chest and one short note
  let ac = null;
  const voice = () => {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      ac = ac || new AC(); if (ac.state === 'suspended') ac.resume();
      const t = ac.currentTime, o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(), g2 = ac.createGain(), lp = ac.createBiquadFilter();
      o.type = 'sine'; o2.type = 'triangle';
      o.frequency.setValueAtTime(700, t); o.frequency.exponentialRampToValueAtTime(880, t + 0.09);
      o2.frequency.setValueAtTime(1400, t); o2.frequency.exponentialRampToValueAtTime(1760, t + 0.09);
      lp.type = 'lowpass'; lp.frequency.value = 2600; g2.gain.value = 0.16;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.22, t + 0.025); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(g); g.connect(ac.destination);
      o.start(t); o2.start(t); o.stop(t + 0.32); o2.stop(t + 0.32);
    } catch { /* no sound is fine */ }
  };
  let lastCall = 0;
  stageEl.addEventListener('stage-tap', () => {
    const now = performance.now();
    if (!stage || now - lastCall < 250) return;   // one tap, one call
    lastCall = now;
    const [x, y] = stage.chest(), ring = document.createElement('i');
    ring.className = 'call-ring'; ring.style.left = x.toFixed(1) + 'px'; ring.style.top = y.toFixed(1) + 'px';
    stageEl.appendChild(ring); setTimeout(() => ring.remove(), 1300);
    voice();
    stageEl.classList.add('is-touched');
  });
}

/* ── card: the name card leans toward the pointer ──────────────────── */
const nameCard = $('stage-card');
if (stageEl && nameCard) {
  stageEl.addEventListener('pointermove', e => {
    if (reduce.matches || active !== 'card' || e.pointerType === 'touch') return;
    const r = stageEl.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    nameCard.style.setProperty('--ry', (px * 16).toFixed(2) + 'deg'); nameCard.style.setProperty('--rx', (-py * 12).toFixed(2) + 'deg');
  });
  stageEl.addEventListener('pointerleave', () => { nameCard.style.setProperty('--ry', '0deg'); nameCard.style.setProperty('--rx', '0deg'); });
}

/* ── wardrobe: the kid stays 魚; the cape changes ──────────────────── */
const wearNext = $('wear-next'), wearBack = $('wear-back');
if (wearNext && wearBack) {
  const CAPES = ['Wing_AP10YellowCape_01', 'Wing_ClassicOne_TGCBlue', 'Wing_AP07Butterfly_01', 'Wing_AP09Phoenix_01', 'Wing_AP06Layered_01'].map(n => 'CharSkyKid_' + n);
  let at = -1, busy = false;
  const wear = async i => {
    if (!stage || busy) return;
    busy = true; wearNext.classList.add('is-playing');
    const { FISH } = await import('./home-stage.js');
    at = i;
    await stage.wear(i < 0 ? FISH : { ...FISH, pieces: { ...FISH.pieces, cape: CAPES[i] } });
    busy = false; wearNext.classList.remove('is-playing');
    wearBack.hidden = at < 0;
  };
  wearNext.addEventListener('click', () => wear(at + 1 >= CAPES.length ? -1 : at + 1));
  wearBack.addEventListener('click', () => wear(-1));
}

/* ── height: the height page's formula, on the kid's real body ─────── */
const hIn = $('h-height'), ruler = $('stage-ruler');
if (hIn) {
  const FISH_H = 1.8867949, FISH_S = -0.0049999999;
  const SVG = 'http://www.w3.org/2000/svg';
  const mk = (tag, cls) => { const n = document.createElementNS(SVG, tag); n.setAttribute('class', cls); ruler.appendChild(n); return n; };
  const parts = ruler ? { axis: mk('line', 'ruler-axis'), ticks: Array.from({ length: 13 }, () => mk('line', 'ruler-tick')), head: mk('line', 'ruler-head'), dot: mk('circle', 'ruler-dot') } : null;
  const line = (el, a, b) => { el.setAttribute('x1', a[0].toFixed(1)); el.setAttribute('y1', a[1].toFixed(1)); el.setAttribute('x2', b[0].toFixed(1)); el.setAttribute('y2', b[1].toFixed(1)); };
  // the stick stands beside the kid, in the stage's own space, so it follows the camera
  const draw = () => {
    if (!stage || !parts || active !== 'height') return;
    ruler.setAttribute('viewBox', `0 0 ${stageEl.clientWidth} ${stageEl.clientHeight}`);
    const X = 1.3, P = y => stage.project(X, y, 0);   // the picture is mirrored: +x is to the visitor's left
    line(parts.axis, P(0), P(3));
    parts.ticks.forEach((t, i) => { const p = P(i * 0.25); line(t, p, [p[0] + (i % 4 === 0 ? 16 : 8), p[1]]); });
    const top = stage.headTop(), a = P(top), b = stage.project(-0.95, top, 0);
    line(parts.head, a, b); parts.dot.setAttribute('cx', a[0].toFixed(1)); parts.dot.setAttribute('cy', a[1].toFixed(1)); parts.dot.setAttribute('r', '3.5');
  };
  let until = 0, raf = 0;
  const follow = () => { raf = 0; draw(); if (performance.now() < until && active === 'height') raf = requestAnimationFrame(follow); };
  const watch = ms => { until = performance.now() + ms; if (!raf) raf = requestAnimationFrame(follow); };
  const show = () => {
    const h = Number(hIn.value);
    $('h-val').textContent = (7.6 - 8.3 * FISH_S - 3 * h).toFixed(2);
    hIn.style.setProperty('--p', ((h + 2) / 4 * 100) + '%');
    if (stage) stage.body(h, FISH_S);
    watch(700);
  };
  $('h-fish').style.setProperty('--at', String((FISH_H + 2) / 4));
  hIn.addEventListener('input', show);
  hIn.style.setProperty('--p', ((Number(hIn.value) + 2) / 4 * 100) + '%');
  onShow.height = () => watch(3200);
  addEventListener('resize', () => watch(400));
}

/* ── events: the two-hour cycle on the sun's rim ───────────────────── */
// the same schedule as the events page: even PT hours, a ten-minute window each
const EVENTS = [
  { name: '聖島間歇泉', short: '間歇泉', at: 5, color: '#e0ae52' },
  { name: '奶奶的晚餐', short: '奶奶', at: 35, color: '#dc6a58' },
  { name: '聖島海龜', short: '海龜', at: 50, color: '#9cc088' }
];
const DUR = 10, CYCLE = 120, ring = $('ring');
if (ring) {
  const NS = 'http://www.w3.org/2000/svg', C = 200, R = 190;
  const el = (tag, attrs, parent = ring) => { const n = document.createElementNS(NS, tag); for (const k in attrs) n.setAttribute(k, attrs[k]); parent.appendChild(n); return n; };
  const pt = (min, r) => { const a = (min / CYCLE) * 2 * Math.PI - Math.PI / 2; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
  const arc = (m0, m1, r) => { const [x0, y0] = pt(m0, r), [x1, y1] = pt(m1, r); return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`; };
  el('circle', { cx: C, cy: C, r: R, class: 'ring-track' });
  for (let m = 0; m < CYCLE; m += 5) {
    const big = m % 30 === 0, [a, b] = pt(m, R - (big ? 12 : 6)), [c, d] = pt(m, R);
    el('line', { x1: a.toFixed(2), y1: b.toFixed(2), x2: c.toFixed(2), y2: d.toFixed(2), class: big ? 'ring-tick is-big' : 'ring-tick' });
  }
  const arcs = EVENTS.map(ev => el('path', { d: arc(ev.at, ev.at + DUR, R), class: 'ring-arc', style: `--c:${ev.color}` }));
  // each window's name sits just outside its arc; the names show while 活動雷達 is open
  for (const ev of EVENTS) {
    const [x, y] = pt(ev.at + DUR / 2, R + 14), t = el('text', { x: x.toFixed(1), y: (y + 4).toFixed(1), class: 'ring-name', style: `--c:${ev.color}`, 'text-anchor': 'start' });
    t.textContent = `${ev.short} :${pad(ev.at)}`;
  }
  const hand = el('g', { class: 'ring-hand' });
  el('line', { x1: C, y1: C - R + 16, x2: C, y2: C - R - 12 }, hand);
  el('circle', { cx: C, cy: C - R, r: 5 }, hand);

  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hourCycle: 'h23', hour: 'numeric', minute: 'numeric', second: 'numeric' });
  const clock = sec => { sec = Math.floor(sec); return sec >= 3600 ? `${Math.floor(sec / 3600)}:${pad(Math.floor(sec / 60) % 60)}:${pad(sec % 60)}` : `${Math.floor(sec / 60)}:${pad(sec % 60)}`; };
  const evK = $('ev-k'), evName = $('ev-name'), evCd = $('ev-cd'), evReset = $('ev-reset');
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
    if (evK) { evK.textContent = best.on ? '進行中' : '下一場'; evName.textContent = best.ev.name; evName.style.color = best.ev.color; evCd.textContent = best.on ? `剩 ${clock(best.left)}` : clock(best.left); }
    // the day turns over at midnight, game time
    if (evReset) { const left = 86400 - ((p.hour % 24) * 3600 + p.minute * 60 + p.second); evReset.textContent = `${Math.floor(left / 3600)}:${pad(Math.floor(left / 60) % 60)}:${pad(left % 60)}`; }
  };
  tick();
  setTimeout(() => { tick(); setInterval(tick, 1000); }, 1000 - (Date.now() % 1000));
}

/* ── music: fifteen keys; every note rings out from the sun and the kid claps ── */
const harp = $('harp');
if (harp) {
  const STEPS = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];   // C major from C4
  const CODES = [
    ['KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
    ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB']
  ];
  const keys = [...harp.querySelectorAll('.key')], sky = stageEl && stageEl.querySelector('.stage-sky'), disc = stageEl && stageEl.querySelector('.stage-disc');
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
  let lastClap = 0;
  const show = i => {
    const k = keys[i]; if (!k) return;
    k.classList.remove('is-on'); void k.offsetWidth; k.classList.add('is-on');
    clearTimeout(k._t); k._t = setTimeout(() => k.classList.remove('is-on'), 420);
    if (sky && !reduce.matches) { const r = document.createElement('i'); r.className = 'note-ring'; sky.appendChild(r); setTimeout(() => r.remove(), 1050); }
    if (disc) { disc.classList.remove('is-pulse'); void disc.offsetWidth; disc.classList.add('is-pulse'); }
    const now = performance.now();
    if (stage && active === 'music' && now - lastClap > 380) { lastClap = now; stage.clap(); }
  };
  const play = i => { pluck(i); show(i); };
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
        timers.push(setTimeout(() => show(i), (0.08 + at * beat) * 1000));
      });
      pos += Number(len || 1);
    }
    demo.classList.add('is-playing');
    timers.push(setTimeout(() => demo.classList.remove('is-playing'), (pos * beat + 0.6) * 1000));
  });
}

/* ── album: the kid strikes a pose, the stage flashes, a print lands in the list ── */
const snapBtn = $('snap-btn'), prints = $('prints'), flash = $('stage-flash');
if (snapBtn && prints) {
  // poses that read well as a still, each with the moment (ms after it starts) it looks best
  const POSES = [['waveSmall', 700], ['point', 800], ['shy', 450], ['clap', 620]];
  let n = 0, busy = false;
  snapBtn.addEventListener('click', () => {
    if (!stage || busy) return;
    busy = true;
    const [pose, at] = POSES[n % POSES.length]; n++;
    stage.pose(pose, true);
    setTimeout(() => {
      if (flash) { flash.classList.remove('is-on'); void flash.offsetWidth; flash.classList.add('is-on'); }
      // the picture: the sun, then a portrait of the kid as they stand
      const shot = stage.snap(420, (ctx, s) => {
        ctx.fillStyle = '#1f1d12'; ctx.fillRect(0, 0, s, s);
        const halo = ctx.createRadialGradient(s * 0.5, s * 0.46, s * 0.3, s * 0.5, s * 0.46, s * 0.72);
        halo.addColorStop(0, 'rgba(242,150,80,0.45)'); halo.addColorStop(1, 'rgba(242,150,80,0)');
        ctx.fillStyle = halo; ctx.fillRect(0, 0, s, s);
        const g = ctx.createRadialGradient(s * 0.5, s * 0.44, 0, s * 0.5, s * 0.46, s * 0.4);
        g.addColorStop(0, '#ffedbb'); g.addColorStop(0.36, '#fbc77c'); g.addColorStop(0.7, '#ee9a52'); g.addColorStop(1, '#c5653a');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s * 0.5, s * 0.46, s * 0.4, 0, Math.PI * 2); ctx.fill();
      });
      const fig = document.createElement('figure'), img = new Image();
      fig.className = 'print'; fig.style.setProperty('--r', (Math.random() * 14 - 7).toFixed(1) + 'deg');
      img.alt = `第 ${n} 張：魚在舞台上`; img.src = shot.toDataURL('image/jpeg', 0.88);
      fig.appendChild(img); prints.append(fig);   // the newest lies on top
      while (prints.children.length > 3) prints.firstElementChild.remove();
      busy = false;
    }, at);
  });
}
