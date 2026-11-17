/* sky-salmon — home page behaviour (a module; the 3D stage in home-stage.js is loaded only when it is needed).
 *   clip      the pause button; a warm light that follows the pointer over the clip; the top bar turns to glass once
 *             the page scrolls
 *   scroll    hand-off: the clip fades into the stage's kid, who stands up in front of a rising sun. Then the walk:
 *             the six tools go by one at a time, pinned beside the stage; each one's words slide in as the stage
 *             turns to it. Further down, the closing lines come up as they enter the screen.
 *   stage     the author's own Sky kid: one camera shot and pose per tool, drag to turn; their head follows the
 *             pointer and a tap makes them call, as in the game
 *   per tool  card: a name card that tilts · wardrobe: six capes to try on · height: the height page's formula on the kid's
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

/* ── the tools and the stage ───────────────────────────────────────── */
const stageEl = $('stage'), track = $('made'), pin = $('made-pin');
const toolEls = [...document.querySelectorAll('.tool')], NAMES = toolEls.map(li => li.dataset.tool), N = NAMES.length;
const railBs = [...document.querySelectorAll('.rail-b')];
const narrow = matchMedia('(max-width: 920px)');   // the layout where the stage is pinned above the text
let stage = null, active = NAMES[0] || 'card', hintOff = () => {};
const onShow = {};    // tool → what to do when the walk arrives at it (each tool below adds its own)
const weight = {};    // tool → 0…1: how far the stage has turned to it
NAMES.forEach((n, i) => { weight[n] = i ? 0 : 1; });

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
    walked = null; update();
    stageEl.classList.add('is-ready'); hintOff();
    window.__home = { stage, go, get active() { return active; } };
    if (onShow[active]) onShow[active]();
  } catch (e) { console.warn('[home] stage left out', e); still(); }
}
if (stageEl) {
  let asked = false;
  const begin = () => { if (asked) return; asked = true; (window.requestIdleCallback || setTimeout)(mount, { timeout: 1200 }); };
  const near = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { near.disconnect(); if (document.readyState === 'complete') begin(); else addEventListener('load', begin, { once: true }); } }, { rootMargin: '600px' });
  near.observe(stageEl);
  stageEl.addEventListener('stage-grab', () => stageEl.classList.add('is-touched'));
  hintOff = () => setTimeout(() => stageEl.classList.add('is-touched'), 9000);   // the hint leaves on its own after a while
}

/* ── scroll: everything that moves with the page ───────────────────────
 * Two stretches, both read straight off how far the page has scrolled:
 *   hand-off  0 … T          the clip (pinned behind the page) fades, and the stage's kid fades in over the same spot,
 *                            drawn through the clip's own camera, then stands up into the stage; the sun rises
 *   the walk  start … +5½ steps   the text block stays pinned beside the stage, and the tools go by one at a time. Each
 *                            rests for HOLD of its step; over the remainder its words leave upward, the next tool's
 *                            slide in from below one after another, and the stage (camera, pose, sun, and the tool's own
 *                            piece: the name card, the measuring stick, the clock…) goes from one to the other with them.
 * Past the walk, anything marked data-rise comes up into place as it enters the screen. */
const clamp01 = v => Math.min(1, Math.max(0, v));
const smooth = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// The walk needs a screen tall enough to hold a whole tool beside (or under) the stage. On a shorter one (a phone on
// its side) the tools are a plain list that scrolls by, and the stage turns to whichever is in the middle. The height
// that decides is the screen at its smallest (a phone's with its bars showing), so it does not flip as the bars hide.
const root = document.documentElement, probe = document.body.appendChild(Object.assign(document.createElement('i'), { className: 'svh-probe' }));
let scrolly = false;
function setMode() {
  const h = probe.offsetHeight || innerHeight, wide = !narrow.matches;
  const was = scrolly;
  scrolly = !!(track && pin && N && stageEl) && h >= (wide ? 590 : 520);
  root.classList.toggle('scrolly', scrolly);
  root.classList.toggle('short', !wide && h < 700);
  if (was !== scrolly) { parts.flat().forEach(el => { el.style.transform = el.style.opacity = ''; el._put = null; }); walked = null; sv = null; }
}
const HOLD = 0.5, TAIL = 0.5;   // of a step: how long a tool rests before the next begins; how long the last one stays
// the sun's size and place for each tool: scale, x %, y %
const SUN = { card: [1.2, 0, -3], wardrobe: [1, 0, 0], height: [1.06, 0, 2], events: [0.86, 0, 0], music: [1.12, -7, -4], album: [0.9, 3, -12] };
const parts = toolEls.map(li => [...li.querySelectorAll('[data-part]')]);
const risers = [...document.querySelectorAll('[data-rise]')];
let T = 400, start = 0, step = 600, line = 0, vh = innerHeight, queued = 0, last = 0, sv = null, walked = null, pausedByScroll = false;

function measure() {
  if (!hero || !stageEl) return;
  vh = innerHeight;
  setMode();
  const top = parseFloat(getComputedStyle(stageEl).top) || 58;
  // T: how far the page scrolls for the whole hand-off. On a wide screen most of the clip's height; on a narrow one,
  // exactly until the text arrives under the pinned stage.
  if (narrow.matches && track) T = Math.max(140, track.getBoundingClientRect().top + scrollY - (top + stageEl.offsetHeight + 16));
  else T = hero.offsetHeight * 0.6;
  // where things sit on the page with nothing moved (what is below the first screen comes up as it scrolls into it)
  const plain = (el, add = 0) => { const hold = el.style.transform; el.style.transform = 'none'; const r = el.getBoundingClientRect(); el.style.transform = hold; el._y = r.top + scrollY + add; return r; };
  if (scrolly) {
    // beside the stage the pinned block is exactly as tall as the stage, so the two let go of the screen together
    if (narrow.matches) track.style.removeProperty('--pin-h'); else track.style.setProperty('--pin-h', stageEl.offsetHeight + 'px');
    step = Math.max(1, (track.offsetHeight - pin.offsetHeight) / (N - 1 + TAIL));
    start = track.getBoundingClientRect().top + scrollY - (parseFloat(getComputedStyle(pin).top) || 0);
    const unpin = track.getBoundingClientRect().top - pin.getBoundingClientRect().top;   // 0 unless the block is pinned now
    parts[0].forEach(el => plain(el, unpin));
  } else if (track) {
    track.style.removeProperty('--pin-h');
    // the line a tool is read at: the middle of what the stage leaves of the screen
    const under = narrow.matches ? top + stageEl.offsetHeight : 0;
    line = under + (vh - under) * 0.45;
    toolEls.forEach((li, i) => { const r = li.getBoundingClientRect(); li._c = r.top + scrollY + r.height / 2; parts[i].forEach(el => plain(el)); });
  }
  risers.forEach(el => plain(el));
}

function handoff() {
  const p = clamp01(scrollY / T), stepped = reduce.matches ? (p > 0.5 ? 1 : 0) : null;
  const v = { fade: stepped ?? smooth(0.06, 0.7, p), kid: stepped ?? smooth(0.2, 0.78, p), rise: stepped ?? smooth(0.3, 1, p), solid: stepped ?? smooth(0.5, 0.95, p), live: stepped ?? smooth(0.84, 1, p) };
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
    stage.handoff(stepped ?? smooth(0.34, 1, p), { x: f.left - c.left, y: f.top - c.top, w: f.width, h: f.height }, v.kid > 0.001);
  }
}

// one part of a tool's text: o = how much of it is there, y = how far it still has to come (+ below, − gone above).
// A name rolls inside its own line; everything else rises and fades.
const put = (el, o, y) => {
  const key = o.toFixed(3) + '|' + y.toFixed(3);
  if (el._put === key) return;
  el._put = key;
  if (reduce.matches) { el.style.opacity = o > 0.5 ? '1' : '0'; return; }
  if (el.dataset.part === 'name') { el.style.transform = y ? `translate3d(0,${(y * 108).toFixed(2)}%,0)` : ''; el.style.opacity = ''; }
  else {
    el.style.transform = y ? `translate3d(0,${(y * (y > 0 ? 52 : 30)).toFixed(2)}px,0)` : ''; el.style.opacity = o >= 1 ? '' : o.toFixed(3);
    el.style.setProperty('--t', o.toFixed(3));   // for whatever inside it arrives piece by piece (the keys)
  }
};
// something on the page at height y (from the top of the document): 0 while it is below the screen, 1 once it is well in
const risen = y => (y < vh - 12 ? 1 : smooth(vh * 0.99, vh * 0.8, y - scrollY));

function setActive(name) {
  if (name === active) return;
  active = name;
  if (stageEl) stageEl.dataset.tool = name;
  toolEls.forEach(li => li.classList.toggle('is-on', li.dataset.tool === name));
  railBs.forEach(b => { if (b.dataset.go === name) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
  if (onShow[name]) onShow[name]();
}

function walk(pos) {
  const a = Math.min(N - 1, Math.floor(pos)), b = Math.min(N - 1, a + 1), f = pos - a, e = f * f * (3 - 2 * f);
  // the words
  const roll = smooth(0.16, 0.74, f);   // the two names share one line: one rolls out as the other rolls in
  if (!scrolly) parts.forEach(list => list.forEach(el => { const r = risen(el._y ?? 0); put(el, r, 1 - r); }));   // a plain list: each part comes up as it enters the screen
  else toolEls.forEach((li, i) => {
    const near = i === a || (i === b && f > 0);
    li.classList.toggle('is-near', near);
    if (!near) return;
    parts[i].forEach((el, k) => {
      if (i === a && f === 0) {   // at rest; the first tool, before the block is pinned, comes up as the page brings it in
        const r = i === 0 && scrollY < start ? risen(el._y ?? 0) : 1;
        return put(el, r, 1 - r);
      }
      if (el.dataset.part === 'name') return put(el, 1, i === a ? -roll : 1 - roll);
      if (i === a) { const out = smooth(0.03 * k, 0.36 + 0.03 * k, f); put(el, 1 - out, -out); }
      else { const d = 0.07 * Math.min(k, 3), inn = smooth(0.43 + d, 0.79 + d, f); put(el, inn, 1 - inn); }
    });
  });
  // the stage
  NAMES.forEach((n, i) => {
    const w = i === a ? 1 - e : i === b ? e : 0;
    if (weight[n] !== w) { weight[n] = w; stageEl.style.setProperty('--w-' + n, w.toFixed(3)); }
  });
  const A = SUN[NAMES[a]] || SUN.wardrobe, B = SUN[NAMES[b]] || A;
  stageEl.style.setProperty('--sun-s', (A[0] + (B[0] - A[0]) * e).toFixed(3));
  stageEl.style.setProperty('--sun-x', (A[1] + (B[1] - A[1]) * e).toFixed(2) + '%');
  stageEl.style.setProperty('--sun-y', (A[2] + (B[2] - A[2]) * e).toFixed(2) + '%');
  if (stage) stage.between(NAMES[a], NAMES[b], e);
  // the candles: each one lights as the walk comes to its tool
  railBs.forEach((btn, i) => btn.style.setProperty('--lit', clamp01(pos - i + 1).toFixed(3)));
  setActive(NAMES[f < 0.5 ? a : b]);
  if (weight.height > 0.01 && onShow.height) onShow.height(500);
}

function update(now = performance.now()) {
  queued = 0;
  if (!hero || !stageEl) return;
  handoff();
  if (scrolly) {
    // the walk follows the page a moment behind, so a wheel's notches come out as one movement
    const target = Math.min(N - 1 + TAIL, Math.max(0, (scrollY - start) / step)), dt = Math.min(0.05, (now - (last || now)) / 1000);
    last = now;
    if (sv === null || reduce.matches || !dt) sv = target; else sv += (target - sv) * (1 - Math.exp(-dt * 13));
    if (Math.abs(target - sv) < 0.0006) { sv = target; last = 0; } else ask();
    const i = Math.min(N - 1, Math.floor(sv));
    let f = i >= N - 1 ? 0 : clamp01((sv - i - HOLD) / (1 - HOLD));
    if (reduce.matches) f = f > 0.5 ? 1 : 0;
    const pos = i + f, key = pos.toFixed(4) + (scrollY < start ? '|' + Math.round(scrollY) : '');
    if (key !== walked) { walked = key; walk(pos); }
  } else if (N && toolEls[0]._c !== undefined) {
    // a plain list: the walk is at the tool whose middle is on the reading line, and part way between two
    const y = scrollY + line;
    let i = 0;
    while (i < N - 1 && toolEls[i + 1]._c <= y) i++;
    let f = i >= N - 1 ? 0 : clamp01(((y - toolEls[i]._c) / (toolEls[i + 1]._c - toolEls[i]._c) - 0.3) / 0.4);
    if (reduce.matches) f = f > 0.5 ? 1 : 0;
    const key = (i + f).toFixed(4) + '|' + Math.round(scrollY);
    if (key !== walked) { walked = key; walk(i + f); }
  }
  // further down, lines come up into place as they enter the screen
  for (const el of risers) {
    const r = reduce.matches ? 1 : smooth(vh * 1.0, vh * 0.78, (el._y ?? 0) - scrollY), key = r.toFixed(3);
    if (el._put === key) continue;
    el._put = key; el.style.opacity = r >= 1 ? '' : key; el.style.transform = r >= 1 ? '' : `translate3d(0,${((1 - r) * 40).toFixed(2)}px,0)`;
  }
}
function ask() { if (!queued) queued = requestAnimationFrame(update); }

// to a tool by name: the page scrolls to where that tool rests
function go(name, instant = false) {
  const i = NAMES.indexOf(name);
  if (i < 0) return;
  measure();
  scrollTo({ top: Math.round(scrolly ? start + (i + 0.18) * step : toolEls[i]._c - line), behavior: instant || reduce.matches ? 'auto' : 'smooth' });
}
if (hero && stageEl) {
  addEventListener('scroll', ask, { passive: true });
  addEventListener('resize', () => { measure(); walked = null; ask(); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { measure(); walked = null; ask(); });
  addEventListener('load', () => { measure(); walked = null; ask(); });
  railBs.forEach(b => b.addEventListener('click', () => go(b.dataset.go)));
  // a tool that is not showing can still take the keyboard: the page goes to it
  const list = $('tools');
  if (list) list.addEventListener('focusin', e => { const li = e.target.closest('.tool'); if (scrolly && li && li.dataset.tool !== active) go(li.dataset.tool); });
  measure(); update();
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
// six capes from the closet, by their in-game icons; the first is the one 魚 wears
const capeBs = [...document.querySelectorAll('.cape')];
if (capeBs.length) {
  let busy = false;
  const wear = async btn => {
    if (!stage || busy || btn.classList.contains('is-on')) return;
    busy = true; btn.classList.add('is-busy');
    const { FISH } = await import('./home-stage.js'), cape = btn.dataset.cape;
    await stage.wear(cape ? { ...FISH, pieces: { ...FISH.pieces, cape: 'CharSkyKid_' + cape } } : FISH);
    busy = false; btn.classList.remove('is-busy');
    capeBs.forEach(b => { const on = b === btn; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', String(on)); });
  };
  capeBs.forEach(b => b.addEventListener('click', () => wear(b)));
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
    if (!stage || !parts || !(weight.height > 0.01)) return;
    ruler.setAttribute('viewBox', `0 0 ${stageEl.clientWidth} ${stageEl.clientHeight}`);
    const X = 1.3, P = y => stage.project(X, y, 0);   // the picture is mirrored: +x is to the visitor's left
    line(parts.axis, P(0), P(3));
    parts.ticks.forEach((t, i) => { const p = P(i * 0.25); line(t, p, [p[0] + (i % 4 === 0 ? 16 : 8), p[1]]); });
    const top = stage.headTop(), a = P(top), b = stage.project(-0.95, top, 0);
    line(parts.head, a, b); parts.dot.setAttribute('cx', a[0].toFixed(1)); parts.dot.setAttribute('cy', a[1].toFixed(1)); parts.dot.setAttribute('r', '3.5');
  };
  let until = 0, raf = 0;
  const follow = () => { raf = 0; draw(); if (performance.now() < until && weight.height > 0.01) raf = requestAnimationFrame(follow); };
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
  onShow.height = (ms = 3200) => watch(ms);
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
