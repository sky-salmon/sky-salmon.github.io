/* 樂譜練習 — 15-key practice stage.
 * Web Audio synthesis (no samples), mouse / multi-touch / keyboard input, song library with
 * community-JSON import & export, playback with cue rings, practice mode and a recorder. */
(function () {
  'use strict';

  const Site = window.Site || { store: { get: (k, f) => f, set: () => false }, toast() {}, bindDropzone() {} };
  const store = Site.store;
  const toast = (msg, ms) => Site.toast(msg, ms);

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const now = () => performance.now();
  const uid = () => 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = ms => { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  function lowerBound(arr, t, get) {
    let lo = 0, hi = arr.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (get(arr[m]) < t) lo = m + 1; else hi = m; }
    return lo;
  }

  // ── constants ───────────────────────────────────────────────────────────
  const SETTINGS_KEY = 'candle.music.settings';
  const LIB_KEY = 'candle.music.library';
  const NOTE_NAMES = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5', 'D5', 'E5', 'F5', 'G5', 'A5', 'B5', 'C6'];
  const MIDI = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
  const FREQ = MIDI.map(m => 440 * Math.pow(2, (m - 69) / 12));
  const ROOTS = new Set([0, 7, 14]);
  const CUE_MS = 420;      // gold ring fades in this long (real time) before a note
  const LEAD_IN = -650;    // song-ms before the first note when starting from the top
  const CHORD_MS = 40;     // notes this close together form one practice step

  const LAYOUTS = {
    qwert: {
      name: 'QWERT · 左側', desc: '左側鍵盤：Q W E R T、A S D F G、Z X C V B',
      codes: ['KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB'],
      keys: ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B']
    },
    yuiop: {
      name: 'YUIOP · 右側', desc: '右側鍵盤：Y U I O P、H J K L ;、N M , . /',
      codes: ['KeyY', 'KeyU', 'KeyI', 'KeyO', 'KeyP', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'KeyN', 'KeyM', 'Comma', 'Period', 'Slash'],
      keys: ['Y', 'U', 'I', 'O', 'P', 'H', 'J', 'K', 'L', ';', 'N', 'M', ',', '.', '/']
    }
  };

  const ICON = {
    piano: '<svg viewBox="0 0 40 40" aria-hidden="true"><rect x="5" y="11" width="30" height="19" rx="3"/><path d="M12.5 11v19M20 11v19M27.5 11v19"/><rect class="is-fill" x="10.6" y="11" width="3.8" height="10" rx="1"/><rect class="is-fill" x="18.1" y="11" width="3.8" height="10" rx="1"/><rect class="is-fill" x="25.6" y="11" width="3.8" height="10" rx="1"/></svg>',
    harp: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M10 34V8.5"/><path d="M10 8.5c4.5-2.6 8.5 1.6 13 .4 3.6-1 6-3.4 8.4-4.4"/><path d="M7.5 34h6"/><path d="M10 33.5 31.4 4.6"/><path d="M14 7.6v20.5M18 8.6v14.1M22 8.9v8.4M26 7.7v4.2"/></svg>',
    musicbox: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M6 18h28v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M6 18l3.5-8h21L34 18"/><path d="M34 24.5h3.5v-4"/><path d="M12 22v5M15 22v6.5M18 22v4M21 22v6.5M24 22v5M27 22v4"/></svg>',
    flute: '<svg viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(-38 20 20)"><rect x="2.5" y="17.6" width="35" height="4.8" rx="2.4"/><circle class="is-fill" cx="9" cy="20" r="1.2"/><circle class="is-fill" cx="17" cy="20" r=".9"/><circle class="is-fill" cx="21.5" cy="20" r=".9"/><circle class="is-fill" cx="26" cy="20" r=".9"/><circle class="is-fill" cx="30.5" cy="20" r=".9"/></g><path d="M27.5 31c1.6 0 2.4 1 3.6 1s2-1 3.4-1M24.5 35c1.6 0 2.4 1 3.6 1s2-1 3.4-1"/></svg>',
    bell: '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5v3"/><path d="M20 8c-6.2 0-9.4 4.6-9.4 10.6v6.2L7.5 29h25l-3.1-4.2v-6.2C29.4 12.6 26.2 8 20 8z"/><path d="M17 29a3 3 0 0 0 6 0"/><path d="M33 9.5c1.4 1.4 2.2 3.2 2.2 5.2M7 9.5c-1.4 1.4-2.2 3.2-2.2 5.2"/></svg>',
    guitar: '<svg viewBox="0 0 40 40" aria-hidden="true"><g transform="rotate(42 20 20)"><path d="M20 38.5c-5.2 0-7.6-3-7.6-6.2 0-2.1 1.2-3.5 2.4-4.5-1-1-1.6-2.3-1.6-3.7 0-3 2.8-5.1 6.8-5.1s6.8 2.1 6.8 5.1c0 1.4-.6 2.7-1.6 3.7 1.2 1 2.4 2.4 2.4 4.5 0 3.2-2.4 6.2-7.6 6.2z"/><circle cx="20" cy="29.5" r="2.2"/><path d="M19 19.2V6M21 19.2V6"/><rect x="17.8" y="1.6" width="4.4" height="4.4" rx="1"/><path d="M17.5 35.2h5"/></g></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="is-fill" d="M8 5.8v12.4l10-6.2z"/></svg>',
    practice: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/></svg>',
    export: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h14M10 7V5h4v2M7 7l.8 12h8.4L17 7"/></svg>'
  };

  const INSTRUMENTS = [
    { id: 'piano', name: '鋼琴', en: 'Piano', note: '圓潤的琴槌聲' },
    { id: 'harp', name: '豎琴', en: 'Harp', note: '撥弦，像月光灑落' },
    { id: 'musicbox', name: '音樂盒', en: 'Music Box', note: '小小的金屬梳片' },
    { id: 'flute', name: '長笛', en: 'Flute', note: '按住就會一直吹' },
    { id: 'bell', name: '鐘', en: 'Bell', note: '餘音繚繞的鐘聲' },
    { id: 'guitar', name: '吉他', en: 'Guitar', note: '低八度的溫柔撥弦' }
  ];
  const INST_BY_ID = Object.fromEntries(INSTRUMENTS.map(i => [i.id, i]));

  // ── settings ────────────────────────────────────────────────────────────
  const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
  const fineMQ = window.matchMedia('(hover: hover) and (pointer: fine)');
  const DEFAULTS = { instrument: 'piano', labels: fineMQ.matches ? 'keys' : 'none', layout: 'qwert', volume: 80, reverb: 35, calm: null, tempo: 100 };

  function sanitizeSettings(raw) {
    const s = Object.assign({}, DEFAULTS);
    if (!raw || typeof raw !== 'object') return s;
    if (INST_BY_ID[raw.instrument]) s.instrument = raw.instrument;
    if (['none', 'keys', 'notes', 'numbers'].includes(raw.labels)) s.labels = raw.labels;
    if (LAYOUTS[raw.layout]) s.layout = raw.layout;
    if (Number.isFinite(raw.volume)) s.volume = clamp(Math.round(raw.volume), 0, 100);
    if (Number.isFinite(raw.reverb)) s.reverb = clamp(Math.round(raw.reverb), 0, 100);
    if (typeof raw.calm === 'boolean') s.calm = raw.calm;
    if (Number.isFinite(raw.tempo)) s.tempo = clamp(Math.round(raw.tempo / 5) * 5, 50, 150);
    return s;
  }
  let settings = sanitizeSettings(store.get(SETTINGS_KEY, null));
  let saveTimer = 0;
  function saveSettings() { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set(SETTINGS_KEY, settings), 150); }
  const isCalm = () => (settings.calm === null ? reduceMQ.matches : settings.calm);

  // ═══════════════════════════════════════════════════════════════════════
  // Audio engine — every timbre is synthesised from oscillators / noise.
  // ═══════════════════════════════════════════════════════════════════════
  const Audio = (() => {
    let ctx = null, bus, dry, wet, master, noise = null, unlocked = false;
    const voices = new Set();
    const ksCache = new Map();

    function ensure() {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { return null; } }
        bus = ctx.createGain();
        dry = ctx.createGain(); wet = ctx.createGain(); master = ctx.createGain();
        const verb = ctx.createConvolver();
        verb.buffer = impulse(2.9, 3.4);
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 3.5; comp.attack.value = 0.003; comp.release.value = 0.25;
        bus.connect(dry); dry.connect(master);
        bus.connect(verb); verb.connect(wet); wet.connect(master);
        master.connect(comp); comp.connect(ctx.destination);
        applyMix(true);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }

    // Touch browsers only allow audio after touchend/pointerup: resume + prime with a silent buffer.
    function unlock() {
      if (!ctx) return;
      if (ctx.state !== 'running') ctx.resume().catch(() => {});
      if (!unlocked) {
        unlocked = true;
        const s = ctx.createBufferSource();
        s.buffer = ctx.createBuffer(1, 1, 22050);
        s.connect(ctx.destination); s.start();
      }
    }

    // Generated stereo impulse response: a short pre-delay, then noise that gets darker as it decays.
    function impulse(seconds, decay) {
      const sr = ctx.sampleRate, len = Math.floor(sr * seconds), pre = Math.floor(sr * 0.014);
      const buf = ctx.createBuffer(2, len, sr);
      for (let c = 0; c < 2; c++) {
        const d = buf.getChannelData(c);
        let lp = 0;
        for (let i = pre; i < len; i++) {
          const t = (i - pre) / (len - pre);
          lp += ((Math.random() * 2 - 1) - lp) * (0.62 - 0.5 * t);
          d[i] = lp * Math.pow(1 - t, decay) * (i - pre < sr * 0.004 ? (i - pre) / (sr * 0.004) : 1);
        }
      }
      return buf;
    }

    function applyMix(instant) {
      if (!ctx) return;
      const t = ctx.currentTime, v = settings.volume / 100, r = settings.reverb / 100, k = instant ? 0.001 : 0.04;
      master.gain.setTargetAtTime(Math.pow(v, 1.6) * 1.1, t, k);
      wet.gain.setTargetAtTime(r * 0.95, t, k);
      dry.gain.setTargetAtTime(1 - r * 0.32, t, k);
    }

    function noiseBuf() {
      if (!noise) {
        const len = ctx.sampleRate * 2;
        noise = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      return noise;
    }

    // small node helpers
    function osc(type, freq) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq; return o; }
    function amp(value) { const g = ctx.createGain(); g.gain.value = value; return g; }
    function filter(type, freq, q) { const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q != null) f.Q.value = q; return f; }
    function noiseSrc() { const s = ctx.createBufferSource(); s.buffer = noiseBuf(); s.loop = true; return s; }
    // percussive envelope: silent → peak in `attack`, then exponential decay with time-constant `tau`
    function env(param, t, peak, attack, tau) {
      param.setValueAtTime(0, t);
      param.linearRampToValueAtTime(peak, t + attack);
      param.setTargetAtTime(0, t + attack, tau);
    }

    // Karplus–Strong plucked string, rendered once per key into a buffer (then pitch-corrected).
    const KS = {
      harp: { seconds: 3.2, t60: 3.3, smooth: 3, pick: 0 },
      guitar: { seconds: 2.5, t60: 2.0, smooth: 1, pick: 0.17 }
    };
    function ksBuffer(kind, k, f) {
      const id = kind + k;
      if (ksCache.has(id)) return ksCache.get(id);
      const P = KS[kind], sr = ctx.sampleRate;
      const N = Math.max(4, Math.round(sr / f + 0.5));
      const f0 = sr / (N - 0.5);
      const len = Math.floor(sr * P.seconds);
      const buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
      let ring = new Float32Array(N), seed = (k + 1) * 2654435761 + kind.length * 97; // seeded: same tone every session
      const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let x = Math.imul(seed ^ (seed >>> 15), 1 | seed); x ^= x + Math.imul(x ^ (x >>> 7), 61 | x); return ((x ^ (x >>> 14)) >>> 0) / 2147483648 - 1; };
      for (let i = 0; i < N; i++) ring[i] = rand();
      if (P.pick) { // pluck position: comb out some harmonics
        const m = Math.max(1, Math.round(N * P.pick)), out = new Float32Array(N);
        for (let i = 0; i < N; i++) out[i] = ring[i] - ring[(i - m + N) % N];
        ring = out;
      }
      for (let s = 0; s < P.smooth; s++) { let prev = ring[N - 1]; for (let i = 0; i < N; i++) { const c = ring[i]; ring[i] = (c + prev) * 0.5; prev = c; } }
      let mean = 0; for (let i = 0; i < N; i++) mean += ring[i]; mean /= N;
      for (let i = 0; i < N; i++) ring[i] -= mean;
      const t60 = P.t60 * (1 - (k / 14) * 0.45);
      const damp = Math.pow(0.001, 1 / (f0 * t60));
      let idx = 0, peak = 1e-6, energy = 0;
      const w0 = Math.floor(sr * 0.02), w1 = Math.floor(sr * 0.25);
      for (let i = 0; i < len; i++) {
        const a = ring[idx], nx = idx + 1 === N ? 0 : idx + 1;
        d[i] = a;
        const abs = a < 0 ? -a : a; if (abs > peak) peak = abs;
        if (i >= w0 && i < w1) energy += a * a;
        ring[idx] = damp * 0.5 * (a + ring[nx]);
        idx = nx;
      }
      // level by the body of the note (not the noisy attack), but never clip
      const g = Math.min(0.3 / Math.sqrt(energy / (w1 - w0) + 1e-9), 0.95 / peak);
      for (let i = 0; i < len; i++) d[i] *= g;
      const res = { buf, f0 };
      ksCache.set(id, res);
      return res;
    }

    // ── timbres: each one wires sources into v.vca and sets v.end (or v.release for sustained) ──
    const SYNTH = {
      piano(v, f, k) {
        const t = v.t, body = amp(0), lp = filter('lowpass', 1000, 0.6);
        lp.frequency.setValueAtTime(Math.min(f * 8, 12000), t);
        lp.frequency.setTargetAtTime(Math.max(f * 2.6, 900), t + 0.005, 0.38);
        lp.connect(body); body.connect(v.vca);
        const o1 = osc('triangle', f), o2 = osc('sawtooth', f), o3 = osc('sine', f * 2);
        o2.detune.value = 5;
        const g2 = amp(0.15), g3 = amp(0);
        env(g3.gain, t, 0.22, 0.003, 0.2);
        o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(g3); g3.connect(lp);
        const decay = 0.42 + ((14 - k) / 14) * 0.55;
        env(body.gain, t, 0.34, 0.004, decay);
        const nz = noiseSrc(), bp = filter('bandpass', Math.min(f * 5, 7000), 1.1), gn = amp(0);
        env(gn.gain, t, 0.07, 0.001, 0.012);
        nz.connect(bp); bp.connect(gn); gn.connect(v.vca);
        v.srcs.push(o1, o2, o3, nz);
        v.end = t + decay * 7;
      },
      harp(v, f, k) { plucked(v, f, k, 'harp', 5400, 0.8); },
      guitar(v, f, k) { plucked(v, f / 2, k, 'guitar', 3600, 0.7); },
      musicbox(v, f, k) {
        const t = v.t, F = f * 2, tau = 0.62 - k * 0.022, out = amp(1);
        out.connect(v.vca);
        const parts = [[1, 0.3, tau], [2, 0.07, tau * 0.35], [5.93, 0.045, 0.05]];
        for (const [r, g, d] of parts) {
          const o = osc('sine', F * r), gg = amp(0);
          env(gg.gain, t, g, r > 5 ? 0.001 : 0.002, d);
          o.connect(gg); gg.connect(out); v.srcs.push(o);
        }
        v.end = t + tau * 7;
      },
      flute(v, f, k, hold) {
        const t = v.t, body = amp(0), lp = filter('lowpass', Math.min(f * 5, 9000), 0.5);
        body.gain.setValueAtTime(0, t);
        body.gain.linearRampToValueAtTime(0.27, t + 0.07);
        body.gain.setTargetAtTime(0.2, t + 0.07, 0.25);
        lp.connect(body); body.connect(v.vca);
        const o1 = osc('sine', f), o2 = osc('triangle', f), o3 = osc('sine', f * 2);
        const g2 = amp(0.2), g3 = amp(0.05);
        o1.connect(lp); o2.connect(g2); g2.connect(lp); o3.connect(g3); g3.connect(lp);
        // delayed vibrato (in cents) on every partial
        const lfo = osc('sine', 5.1), depth = amp(0);
        depth.gain.setValueAtTime(0, t + 0.22);
        depth.gain.linearRampToValueAtTime(13, t + 0.7);
        lfo.connect(depth); depth.connect(o1.detune); depth.connect(o2.detune); depth.connect(o3.detune);
        // breath noise
        const nz = noiseSrc(), bp = filter('bandpass', Math.min(f * 2, 8000), 0.8), gn = amp(0);
        gn.gain.setValueAtTime(0, t);
        gn.gain.linearRampToValueAtTime(0.055, t + 0.03);
        gn.gain.setTargetAtTime(0.013, t + 0.03, 0.12);
        nz.connect(bp); bp.connect(gn); gn.connect(v.vca);
        v.srcs.push(o1, o2, o3, lfo, nz);
        v.sustain = true;
        v.release = rt => {
          if (v.released) return;
          v.released = true; clearTimeout(v.safety);
          rt = Math.max(rt == null ? ctx.currentTime : rt, t + 0.09);
          for (const p of [body.gain, gn.gain]) { p.cancelScheduledValues(rt); p.setTargetAtTime(0, rt, 0.07); }
          v.stopAt(rt + 0.6);
        };
        if (hold != null) v.release(t + hold);
        else v.safety = setTimeout(() => v.release(), 20000);
      },
      bell(v, f, k) {
        const t = v.t, out = amp(1), scale = 1 - (k / 14) * 0.35;
        out.connect(v.vca);
        const parts = [[1, 0.3, 2.4], [2.0, 0.12, 1.5], [3.0, 0.05, 0.8], [4.16, 0.06, 0.55], [5.43, 0.035, 0.32], [6.79, 0.025, 0.22]];
        for (const [r, g, d] of parts) {
          const o = osc('sine', f * r), gg = amp(0);
          env(gg.gain, t, g, 0.002, d * scale);
          o.connect(gg); gg.connect(out); v.srcs.push(o);
        }
        const nz = noiseSrc(), hp = filter('highpass', 3200), gn = amp(0);
        env(gn.gain, t, 0.05, 0.001, 0.008);
        nz.connect(hp); hp.connect(gn); gn.connect(v.vca);
        v.srcs.push(nz);
        v.end = t + 2.4 * scale * 6.2;
      }
    };

    function plucked(v, f, k, kind, cutoff, level) {
      const t = v.t, { buf, f0 } = ksBuffer(kind, k, f);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.playbackRate.value = f / f0;
      const lp = filter('lowpass', cutoff, 0.4), g = amp(0);
      const dur = buf.duration / src.playbackRate.value;
      g.gain.setValueAtTime(level, t);
      g.gain.setValueAtTime(level, t + dur - 0.3);
      g.gain.linearRampToValueAtTime(0, t + dur - 0.02);
      src.connect(lp); lp.connect(g); g.connect(v.vca);
      const o = osc('sine', f), go = amp(0); // a little body warmth under the string
      env(go.gain, t, 0.1, 0.004, 0.32);
      o.connect(go); go.connect(v.vca);
      v.srcs.push(src, o);
      v.end = t + dur;
    }

    function note(k, delay, hold) {
      if (!ensure()) return null;
      const t = ctx.currentTime + Math.max(0, delay || 0) + 0.004;
      const vca = ctx.createGain();
      vca.connect(bus);
      const v = {
        t, k, vca, srcs: [], end: t + 4, sustain: false, released: false, dead: false, onend: null, safety: 0,
        release() {},
        stopAt(when) { for (const s of v.srcs) { try { s.stop(when); } catch (e) { /* already stopped */ } } }
      };
      (SYNTH[settings.instrument] || SYNTH.piano)(v, FREQ[k], k, hold);
      for (const s of v.srcs) s.start(t);
      if (!v.sustain) v.stopAt(v.end);
      v.srcs[0].onended = () => cleanup(v);
      voices.add(v);
      stats.notes++;
      if (voices.size > 44) kill(voices.values().next().value);
      return v;
    }

    function cleanup(v) {
      if (v.dead) return;
      v.dead = true; clearTimeout(v.safety); voices.delete(v);
      try { v.vca.disconnect(); } catch (e) { /* ignore */ }
      if (v.onend) v.onend(v);
    }

    function kill(v) {
      if (!v || v.dead || !ctx) return;
      const t = ctx.currentTime;
      if (v.t > t + 0.002) { // not started yet: silence it outright
        try { v.vca.disconnect(); } catch (e) { /* ignore */ }
      } else {
        v.vca.gain.cancelScheduledValues(t);
        v.vca.gain.setValueAtTime(v.vca.gain.value, t);
        v.vca.gain.setTargetAtTime(0, t, 0.02);
      }
      clearTimeout(v.safety);
      v.released = true;
      v.stopAt(Math.max(t, v.t) + 0.15);
    }

    const stats = { notes: 0 };
    return { ensure, unlock, applyMix, note, kill, stats, get ctx() { return ctx; } };
  })();

  // ═══════════════════════════════════════════════════════════════════════
  // Songs: built-in demos + persisted library
  // ═══════════════════════════════════════════════════════════════════════
  const NOTE_INDEX = Object.fromEntries(NOTE_NAMES.map((n, i) => [n, i]));
  // Mini notation: "C4+C5 D5:0.5 -:2 |" — notes joined by +, optional :beats (default 1), "-" rest, "|" bar line.
  function fromNotation(str, bpm) {
    const beat = 60000 / bpm, notes = [];
    let pos = 0;
    for (const tok of str.trim().split(/\s+/)) {
      if (tok === '|') continue;
      const [body, beats] = tok.split(':');
      if (body !== '-') body.split('+').forEach(n => { if (n in NOTE_INDEX) notes.push([Math.round(pos), NOTE_INDEX[n]]); });
      pos += (beats ? parseFloat(beats) : 1) * beat;
    }
    return notes;
  }

  // Transcribed for this page from the public-domain melodies (arranged with a simple bass on each bar).
  const DEMOS = [
    {
      id: 'demo-twinkle', name: '小星星', author: '法國童謠', bpm: 100, source: 'demo',
      notes: fromNotation(`
        C4+C5 C5 G5 G5 | F4+A5 A5 G5:2 | F4+F5 F5 E5 E5 | G4+D5 D5 C5:2 |
        C4+G5 G5 F5 F5 | E4+E5 E5 D5:2 | C4+G5 G5 F5 F5 | G4+E5 E5 D5:2 |
        C4+C5 C5 G5 G5 | F4+A5 A5 G5:2 | F4+F5 F5 E5 E5 | G4+D5 D5 C4+C5:2`, 100)
    },
    {
      id: 'demo-ode', name: '歡樂頌', author: '貝多芬', bpm: 120, source: 'demo',
      notes: fromNotation(`
        C4+E5 E5 F5 G5 | G4+G5 F5 E5 D5 | C4+C5 C5 D5 E5 | G4+E5:1.5 D5:0.5 D5:2 |
        C4+E5 E5 F5 G5 | G4+G5 F5 E5 D5 | C4+C5 C5 D5 E5 | G4+D5:1.5 C5:0.5 C4+C5:2 |
        G4+D5 D5 E5 C5 | G4+D5 E5:0.5 F5:0.5 E5 C5 | G4+D5 E5:0.5 F5:0.5 E5 D5 | E4+C5 D5 G4:2 |
        C4+E5 E5 F5 G5 | G4+G5 F5 E5 D5 | C4+C5 C5 D5 E5 | G4+D5:1.5 C5:0.5 C4+C5:2`, 120)
    }
  ];

  function normalizeStored(s) {
    if (!s || typeof s !== 'object' || !Array.isArray(s.notes)) return null;
    const notes = s.notes
      .filter(n => Array.isArray(n) && Number.isFinite(n[0]) && Number.isInteger(n[1]) && n[1] >= 0 && n[1] < 15)
      .map(n => [Math.max(0, Math.round(n[0])), n[1]]);
    if (!notes.length) return null;
    return {
      id: String(s.id || uid()), name: String(s.name || '未命名樂譜').slice(0, 80), bpm: clamp(Number(s.bpm) || 120, 20, 400),
      author: String(s.author || '').slice(0, 60), source: s.source === 'record' ? 'record' : 'import',
      created: Number(s.created) || Date.now(), notes
    };
  }
  function loadLibrary() {
    const raw = store.get(LIB_KEY, []);
    return Array.isArray(raw) ? raw.map(normalizeStored).filter(Boolean) : [];
  }
  let library = loadLibrary();
  function saveLibrary() {
    if (!store.set(LIB_KEY, library)) toast('瀏覽器儲存空間不足，這次的變更只會保留到關閉頁面', 3600);
  }
  const allSongs = () => DEMOS.concat(library);
  const songById = id => allSongs().find(s => s.id === id);
  const songLength = s => (s.notes.length ? s.notes[s.notes.length - 1][0] + 500 : 0);

  // Community sheet format: array of songs or one song, { name, bpm, songNotes: [{ time, key: "1Key0" }] }.
  function parseSheets(text) {
    let data;
    try { data = JSON.parse(String(text).replace(/^﻿/, '').trim()); }
    catch (e) { throw new Error('這不是有效的 JSON 文字'); }
    const list = Array.isArray(data) ? data : [data];
    const songs = [];
    let skipped = 0, encrypted = 0;
    for (const raw of list.slice(0, 300)) {
      if (!raw || typeof raw !== 'object') { skipped++; continue; }
      if (raw.isEncrypted === true || typeof raw.songNotes === 'string') { encrypted++; continue; }
      if (!Array.isArray(raw.songNotes)) { skipped++; continue; }
      const notes = [];
      for (const n of raw.songNotes.slice(0, 30000)) {
        if (!n || typeof n !== 'object') continue;
        const t = Number(n.time);
        let k = NaN;
        if (typeof n.key === 'number') k = n.key;
        else { const m = /Key\s*(\d+)/i.exec(String(n.key ?? '')); if (m) k = Number(m[1]); }
        if (!Number.isFinite(t) || !Number.isInteger(k) || k < 0 || k > 14) continue;
        notes.push([Math.max(0, Math.round(t)), k]);
      }
      if (!notes.length) { skipped++; continue; }
      notes.sort((a, b) => a[0] - b[0]);
      songs.push({
        id: uid(), name: String(raw.name || '未命名樂譜').trim().slice(0, 80) || '未命名樂譜',
        bpm: clamp(Math.round(Number(raw.bpm)) || 120, 20, 400), author: String(raw.author || raw.transcribedBy || '').slice(0, 60),
        source: 'import', created: Date.now(), notes
      });
    }
    return { songs, skipped, encrypted };
  }

  // Sheets are often UTF-16 text files; sniff the BOM / zero bytes before decoding.
  function decodeText(buffer) {
    const b = new Uint8Array(buffer);
    if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
    if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
    const n = Math.min(b.length, 512);
    let zeros = 0;
    for (let i = 1; i < n; i += 2) if (b[i] === 0) zeros++;
    if (n > 8 && zeros > n / 5) return new TextDecoder('utf-16le').decode(b);
    return new TextDecoder('utf-8').decode(b).replace(/^﻿/, '');
  }

  function toCommunity(song) {
    return {
      name: song.name, author: song.author || '', transcribedBy: 'sky-salmon', bpm: song.bpm || 120,
      bitsPerPage: 16, pitchLevel: 0, isComposed: true,
      songNotes: song.notes.map(([t, k]) => ({ time: t, key: '1Key' + k }))
    };
  }
  function download(song) {
    try {
      const blob = new Blob([JSON.stringify([toCommunity(song)], null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (song.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'song') + '.json';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      toast('已匯出「' + song.name + '」');
    } catch (e) { toast('匯出失敗：' + e.message); }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DOM
  // ═══════════════════════════════════════════════════════════════════════
  const stage = $('#stage');
  const keysEl = $('#keys');
  const hintEl = $('#hint'), hudEl = $('#hud');
  const tp = {
    play: $('#tp-play'), stop: $('#tp-stop'), kicker: $('#tp-kicker'), title: $('#tp-title'), open: $('#tp-open'),
    seek: $('#tp-seek'), time: $('#tp-time'), tempo: $('#tp-tempo'), tempoOut: $('#tp-tempo-out'), modes: $$('.mu-mode button')
  };
  const scrim = $('#scrim');
  const pills = $$('.mu-pill');
  const drawers = { instrument: $('#drawer-instrument'), library: $('#drawer-library'), compose: $('#drawer-compose'), transcribe: $('#drawer-transcribe'), settings: $('#drawer-settings') };

  // ── keys ────────────────────────────────────────────────────────────────
  const GLYPH = {
    circle: '<circle cx="24" cy="24" r="13"/>',
    diamond: '<path d="M24 10 38 24 24 38 10 24z"/>',
    root: '<path d="M24 8 40 24 24 40 8 24z"/><circle cx="24" cy="24" r="12.5"/>'
  };
  const glyphOf = i => (i % 7 === 0 ? 'root' : (i % 7) % 2 ? 'diamond' : 'circle');
  const keyEls = NOTE_NAMES.map((name, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mu-key' + (ROOTS.has(i) ? ' is-root' : '');
    b.dataset.i = i;
    b.innerHTML = `<svg class="mu-glyph" viewBox="0 0 48 48" aria-hidden="true">${GLYPH[glyphOf(i)]}</svg><span class="mu-key-label" aria-hidden="true"></span>`;
    keysEl.append(b);
    return b;
  });
  const labelEls = keyEls.map(b => b.querySelector('.mu-key-label'));

  function labelFor(i) {
    switch (settings.labels) {
      case 'keys': return LAYOUTS[settings.layout].keys[i];
      case 'notes': return NOTE_NAMES[i];
      case 'numbers': return String(i + 1);
      default: return '';
    }
  }
  function refreshLabels() {
    const L = LAYOUTS[settings.layout];
    keyEls.forEach((b, i) => {
      labelEls[i].textContent = labelFor(i);
      b.setAttribute('aria-label', `第 ${i + 1} 鍵 ${NOTE_NAMES[i]}，鍵盤 ${L.keys[i]}`);
    });
  }

  // visual helpers
  const litTimers = new Array(15).fill(0), missTimers = new Array(15).fill(0);
  let energy = 0;
  function ripple(k) {
    if (isCalm()) return;
    const r = document.createElement('span');
    r.className = 'mu-ripple';
    keyEls[k].append(r);
    setTimeout(() => r.remove(), 850);
  }
  function bump() { energy = Math.min(1, energy + 0.2); kick(); }
  function flash(k, ms) {
    const el = keyEls[k];
    el.classList.add('is-lit'); ripple(k); bump();
    clearTimeout(litTimers[k]);
    litTimers[k] = setTimeout(() => el.classList.remove('is-lit'), ms || 230);
  }
  function missKey(k) {
    const el = keyEls[k];
    el.classList.remove('is-miss'); void el.offsetWidth; el.classList.add('is-miss');
    clearTimeout(missTimers[k]);
    missTimers[k] = setTimeout(() => el.classList.remove('is-miss'), 380);
  }

  // ── input: pointer (multi-touch, glide), keyboard, focused-button activation ──
  const holds = Array.from({ length: 15 }, () => new Set());
  const heldVoice = new Array(15).fill(null);

  function press(k, src) {
    const set = holds[k];
    if (set.has(src)) return;
    set.add(src);
    if (set.size > 1) return;
    Audio.ensure();
    keyEls[k].classList.add('is-down');
    ripple(k); bump();
    heldVoice[k] = Audio.note(k, 0, null);
    recordNote(k);
    practiceInput(k);
  }
  function release(k, src) {
    const set = holds[k];
    if (!set.delete(src) || set.size) return;
    keyEls[k].classList.remove('is-down');
    const v = heldVoice[k];
    heldVoice[k] = null;
    if (v) v.release();
  }
  function releaseAll() {
    holds.forEach((set, k) => [...set].forEach(src => release(k, src)));
    heldCodes.clear(); pointerKey.clear();
  }

  const pointerKey = new Map();
  const keyAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    const key = el && el.closest ? el.closest('.mu-key') : null;
    return key && keysEl.contains(key) ? Number(key.dataset.i) : -1;
  };
  keysEl.addEventListener('pointerdown', e => {
    const key = e.target.closest('.mu-key');
    if (!key || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    try { keysEl.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    const k = Number(key.dataset.i);
    pointerKey.set(e.pointerId, k);
    press(k, 'p' + e.pointerId);
  });
  keysEl.addEventListener('pointermove', e => {
    if (!pointerKey.has(e.pointerId)) return;
    const k = keyAt(e.clientX, e.clientY), prev = pointerKey.get(e.pointerId);
    if (k === prev) return;
    if (prev >= 0) release(prev, 'p' + e.pointerId);
    pointerKey.set(e.pointerId, k);
    if (k >= 0) press(k, 'p' + e.pointerId);
  });
  const endPointer = e => {
    if (!pointerKey.has(e.pointerId)) return;
    const prev = pointerKey.get(e.pointerId);
    pointerKey.delete(e.pointerId);
    if (prev >= 0) release(prev, 'p' + e.pointerId);
  };
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => keysEl.addEventListener(t, endPointer));
  keysEl.addEventListener('contextmenu', e => e.preventDefault());
  // Enter / Space on a focused key (click with detail 0 = keyboard activation)
  keysEl.addEventListener('click', e => {
    if (e.detail !== 0) return;
    const key = e.target.closest('.mu-key');
    if (!key) return;
    const k = Number(key.dataset.i), src = 'c' + now();
    press(k, src);
    setTimeout(() => release(k, src), 200);
  });

  const codeMap = new Map();
  const heldCodes = new Map();
  function rebuildKeymap() { codeMap.clear(); LAYOUTS[settings.layout].codes.forEach((c, i) => codeMap.set(c, i)); }
  function isEditable(el) {
    if (!el || el === document.body) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'color'].includes(el.type);
    return false;
  }
  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') { if (closeTopmost()) e.preventDefault(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    if (e.code === 'Space' && P.song && !e.repeat && !e.target.closest('button, a, input, summary, [role="button"]')) {
      e.preventDefault();
      if (P.playing) pause(); else play();
      return;
    }
    const k = codeMap.get(e.code);
    if (k == null) return;
    e.preventDefault();
    if (e.repeat || heldCodes.has(e.code)) return;
    heldCodes.set(e.code, k);
    press(k, 'k' + e.code);
  });
  window.addEventListener('keyup', e => {
    if (!heldCodes.has(e.code)) return;
    const k = heldCodes.get(e.code);
    heldCodes.delete(e.code);
    release(k, 'k' + e.code);
  });
  window.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { releaseAll(); if (P.playing && P.mode === 'listen') pause(); } });
  ['pointerup', 'touchend', 'keydown'].forEach(t => document.addEventListener(t, () => Audio.unlock(), { capture: true, passive: true }));

  // ═══════════════════════════════════════════════════════════════════════
  // Player: listen (scheduled audio) and practice (waits for the right keys)
  // ═══════════════════════════════════════════════════════════════════════
  const P = {
    song: null, notes: [], steps: [], holds: [], duration: 0, mode: 'listen', rate: settings.tempo / 100,
    playing: false, pos0: LEAD_IN, anchor: 0, nextSched: 0, nextVis: 0,
    step: 0, hits: new Set(), waiting: false, started: false, hit: 0, miss: 0, elapsed: 0, since: 0,
    sched: 0, raf: 0, pending: new Set(), seeking: false, ended: false
  };
  const pos = () => (P.playing ? P.pos0 + (now() - P.anchor) * P.rate : P.pos0);

  function buildSteps(notes) {
    const steps = [];
    for (const [t, k] of notes) {
      const last = steps[steps.length - 1];
      if (last && t - last.t <= CHORD_MS) last.keys.add(k);
      else steps.push({ t, keys: new Set([k]) });
    }
    return steps;
  }
  function computeHolds(notes) { // sustain length for held timbres: until the next onset
    const out = new Array(notes.length);
    let j = 0;
    for (let i = 0; i < notes.length; i++) {
      const t = notes[i][0];
      if (j <= i) j = i + 1;
      while (j < notes.length && notes[j][0] <= t + CHORD_MS) j++;
      out[i] = clamp(((j < notes.length ? notes[j][0] : t + 900) - t) * 0.92, 140, 1500);
    }
    return out;
  }

  function loadSong(song, mode, autoplay) {
    stopPlayback();
    const notes = song.notes.map(n => [n[0], n[1]]).sort((a, b) => a[0] - b[0]);
    P.song = song; P.notes = notes; P.steps = buildSteps(notes); P.holds = computeHolds(notes);
    P.duration = notes.length ? notes[notes.length - 1][0] + 700 : 0;
    if (mode) P.mode = mode;
    P.ended = false;
    setPosition(LEAD_IN);
    hideResult();
    updateTransport(); markCurrentSong();
    if (autoplay) play();
  }
  function unloadSong() {
    stopPlayback();
    P.song = null; P.notes = []; P.steps = []; P.holds = []; P.duration = 0;
    updateTransport(); markCurrentSong(); render(LEAD_IN);
  }

  function setPosition(p) {
    P.pos0 = p; P.anchor = now();
    P.nextSched = P.nextVis = lowerBound(P.notes, p, n => n[0]);
    P.step = lowerBound(P.steps, p, s => s.t);
    P.hits.clear(); P.waiting = false;
    cancelPending(false);
    render(p);
  }
  function cancelPending(all) {
    const ctx = Audio.ctx;
    P.pending.forEach(v => { if (all || !ctx || v.t > ctx.currentTime) { Audio.kill(v); P.pending.delete(v); } });
  }

  function play() {
    if (!P.song || P.playing) return;
    Audio.ensure();
    if (P.mode === 'listen' && P.pos0 >= P.duration) setPosition(LEAD_IN);
    if (P.mode === 'practice' && P.step >= P.steps.length) { resetStats(); setPosition(LEAD_IN); }
    P.playing = true; P.started = true; P.ended = false;
    P.anchor = now(); P.since = now();
    clearInterval(P.sched);
    P.sched = setInterval(schedule, 25);
    schedule(); kick(); updateTransport();
  }
  function pause() {
    if (!P.playing) return;
    P.pos0 = pos(); P.playing = false; P.elapsed += now() - P.since;
    clearInterval(P.sched); P.sched = 0;
    cancelPending(false);
    P.nextSched = lowerBound(P.notes, P.pos0, n => n[0]);
    updateTransport(); render(P.pos0);
  }
  function stopPlayback(letRing) {
    P.playing = false;
    clearInterval(P.sched); P.sched = 0;
    cancelPending(!letRing);
    resetStats();
    keyEls.forEach((el, k) => { el.classList.remove('is-lit'); clearTimeout(litTimers[k]); });
    setPosition(LEAD_IN);
    updateTransport();
  }
  function resetStats() { P.hit = 0; P.miss = 0; P.elapsed = 0; P.started = false; }
  function setRate(r) {
    if (P.playing) { P.pos0 = pos(); P.anchor = now(); }
    P.rate = r;
    render(pos());
  }

  // audio look-ahead scheduler (listen mode only)
  function schedule() {
    if (!P.playing || P.mode !== 'listen' || !Audio.ctx) return;
    const p = pos(), horizon = p + 130 * P.rate;
    while (P.nextSched < P.notes.length && P.notes[P.nextSched][0] <= horizon) {
      const i = P.nextSched++, [t, k] = P.notes[i];
      if (t < p - 80) continue; // fell behind (e.g. throttled tab): skip rather than burst
      const v = Audio.note(k, (t - p) / P.rate / 1000, P.holds[i] / P.rate / 1000);
      if (v) { P.pending.add(v); v.onend = () => P.pending.delete(v); }
    }
  }

  function kick() { if (!P.raf) P.raf = requestAnimationFrame(frame); }
  function frame() {
    P.raf = 0;
    if (P.song && P.playing) {
      let p = pos();
      if (P.mode === 'practice') {
        const st = P.steps[P.step];
        if (st && p >= st.t) { P.pos0 = st.t; P.anchor = now(); p = st.t; P.waiting = true; }
      } else {
        while (P.nextVis < P.notes.length && P.notes[P.nextVis][0] <= p) {
          const i = P.nextVis++;
          flash(P.notes[i][1], settings.instrument === 'flute' ? Math.min(P.holds[i] / P.rate, 900) : 230);
        }
        if (p >= P.duration) finishListen();
      }
      if (P.playing) render(p);
    }
    if (energy > 0.004) { energy *= 0.93; stage.style.setProperty('--energy', energy.toFixed(3)); }
    else if (energy) { energy = 0; stage.style.setProperty('--energy', '0'); }
    if (P.playing || energy) kick();
  }

  // cue rings, practice targets, progress
  const lastCue = new Float32Array(15);
  let targetSig = '';
  function render(p) {
    const cue = new Float32Array(15), win = CUE_MS * P.rate;
    const st = P.mode === 'practice' && P.song ? P.steps[P.step] : null;
    if (P.song && P.mode === 'listen') {
      for (let i = P.nextVis; i < P.notes.length; i++) {
        const dt = P.notes[i][0] - p;
        if (dt > win) break;
        const k = P.notes[i][1], c = 1 - Math.max(0, dt) / win;
        if (c > cue[k]) cue[k] = c;
      }
    } else if (st) {
      const c = P.waiting ? 1 : clamp(1 - (st.t - p) / win, 0, 1);
      st.keys.forEach(k => { if (!P.hits.has(k)) cue[k] = Math.max(cue[k], c); });
      for (let j = P.step + 1; j < P.steps.length; j++) {
        const s2 = P.steps[j], d2 = s2.t - p;
        if (d2 > win) break;
        s2.keys.forEach(k => { if (!st.keys.has(k)) cue[k] = Math.max(cue[k], (1 - d2 / win) * 0.45); });
      }
    }
    for (let k = 0; k < 15; k++) {
      if (Math.abs(cue[k] - lastCue[k]) > 0.008 || (cue[k] === 0 && lastCue[k] !== 0)) {
        lastCue[k] = cue[k];
        keyEls[k].style.setProperty('--cue', cue[k].toFixed(3));
      }
    }
    const waiting = P.waiting && P.playing;
    const sig = st ? `${P.step}|${waiting}|${[...P.hits].join(',')}` : '';
    if (sig !== targetSig) {
      targetSig = sig;
      keyEls.forEach((el, k) => {
        const on = !!st && st.keys.has(k) && !P.hits.has(k);
        el.classList.toggle('is-target', on);
        el.classList.toggle('is-wait', on && waiting);
        el.classList.toggle('is-done', !!st && P.hits.has(k));
      });
    }
    updateProgress(p);
    updateHud();
  }

  let lastTimeText = '';
  function updateProgress(p) {
    const d = P.duration, cur = clamp(p, 0, d || 0);
    if (!P.seeking) tp.seek.value = d ? Math.round((cur / d) * 1000) : 0;
    fill(tp.seek);
    const text = `${fmt(cur / P.rate)} / ${fmt(d / P.rate)}`;
    if (text !== lastTimeText) { tp.time.textContent = text; lastTimeText = text; }
  }

  function finishListen() {
    stopPlayback(true); // let the final chord ring out
    P.ended = true;
    updateTransport();
  }

  // practice
  function practiceInput(k) {
    if (P.mode !== 'practice' || !P.song) return;
    if (!P.playing) {
      if (openName || rec.state === 'rec' || !result.hidden) return; // only auto-start from the bare stage
      const first = P.steps[P.step >= P.steps.length ? 0 : P.step];
      if (!first || !first.keys.has(k)) return;
      play(); // pressing a glowing key starts / resumes practice
    }
    const st = P.steps[P.step];
    if (!st) return;
    if (st.keys.has(k)) {
      if (P.hits.has(k)) return;
      P.hits.add(k); P.hit++;
      if (P.hits.size >= st.keys.size) {
        if (pos() < st.t) { P.pos0 = st.t; P.anchor = now(); }
        P.step++; P.hits.clear(); P.waiting = false;
        if (P.step >= P.steps.length) return finishPractice();
      }
    } else {
      P.miss++; missKey(k);
    }
    render(pos());
  }
  function finishPractice() {
    P.elapsed += now() - P.since;
    P.playing = false;
    clearInterval(P.sched); P.sched = 0;
    const total = P.hit + P.miss, acc = total ? Math.round((P.hit / total) * 100) : 100;
    showResult({ acc, hit: P.hit, miss: P.miss, time: P.elapsed, name: P.song.name });
    P.ended = true;
    render(P.pos0); updateTransport();
  }

  // ── transport UI ────────────────────────────────────────────────────────
  const SOURCE_LABEL = { demo: 'DEMO', import: '匯入', record: '自編', preview: '試聽' };
  function updateTransport() {
    const s = P.song;
    tp.play.disabled = !s; tp.stop.disabled = !s; tp.seek.disabled = !s;
    tp.play.classList.toggle('is-playing', P.playing);
    tp.play.setAttribute('aria-label', P.playing ? '暫停' : '播放');
    tp.open.hidden = !!s;
    tp.modes.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === P.mode)));
    if (s) {
      const modeText = P.mode === 'practice' ? '練習' : '聆聽';
      const state = P.ended ? (P.mode === 'practice' ? '練習完成' : '播放完畢') : P.playing ? (P.mode === 'practice' ? '練習中' : '播放中') : P.started ? '已暫停' : modeText;
      tp.kicker.textContent = `${SOURCE_LABEL[s.source] || '樂譜'} · ${s.bpm} BPM · ${state}`;
      tp.title.textContent = s.name;
    } else {
      tp.kicker.textContent = 'FREE PLAY · 自由演奏';
      tp.title.textContent = '還沒有選曲';
    }
    updateHint();
  }
  function updateHint() {
    const s = P.song, practicing = s && P.mode === 'practice' && P.started;
    hudEl.hidden = !practicing;
    hintEl.hidden = !!practicing;
    if (practicing) return;
    let text;
    if (s && P.mode === 'practice') text = '按下發光的鍵，練習就會開始 ✦';
    else if (s) text = '金色光圈亮起，就是下一個音 ✦';
    else if (fineMQ.matches) text = `點一下琴鍵，或用鍵盤 ${LAYOUTS[settings.layout].keys.slice(0, 5).join(' ')}… 彈奏`;
    else text = '用手指彈奏，可以多指同時按 ✦';
    if (hintEl.textContent !== text) hintEl.textContent = text;
  }
  let lastHud = '';
  function updateHud() {
    if (hudEl.hidden || !P.song) return;
    const total = P.hit + P.miss, acc = total ? Math.round((P.hit / total) * 100) : 100;
    const html = `STEP <b>${Math.min(P.step + 1, P.steps.length)}</b> / ${P.steps.length}<span class="sep" aria-hidden="true"></span>正確率 <b>${acc}%</b><span class="sep" aria-hidden="true"></span>按錯 <b>${P.miss}</b>`;
    if (html !== lastHud) { hudEl.innerHTML = html; lastHud = html; }
  }
  function fill(input) {
    const min = Number(input.min) || 0, max = Number(input.max) || 100;
    input.style.setProperty('--p', ((Number(input.value) - min) / (max - min)) * 100 + '%');
  }

  tp.play.addEventListener('click', () => { if (P.playing) pause(); else play(); });
  tp.stop.addEventListener('click', () => { stopPlayback(); P.ended = false; updateTransport(); });
  tp.open.addEventListener('click', () => openDrawer('library', tp.open));
  tp.modes.forEach(b => b.addEventListener('click', () => {
    if (P.mode === b.dataset.mode) return;
    const wasPlaying = P.playing;
    stopPlayback();
    P.mode = b.dataset.mode; P.ended = false;
    hideResult();
    setPosition(LEAD_IN);
    updateTransport();
    if (wasPlaying && P.mode === 'listen') play();
  }));
  tp.seek.addEventListener('pointerdown', () => { P.seeking = true; });
  ['pointerup', 'pointercancel', 'change', 'blur'].forEach(t => tp.seek.addEventListener(t, () => { P.seeking = false; }));
  tp.seek.addEventListener('input', () => {
    if (!P.song) return;
    const target = (Number(tp.seek.value) / 1000) * P.duration;
    P.ended = false;
    setPosition(target <= 0 ? LEAD_IN : target);
    fill(tp.seek);
  });
  tp.tempo.addEventListener('input', () => {
    const v = Number(tp.tempo.value);
    setRate(v / 100);
    tp.tempoOut.value = v + '%'; tp.tempoOut.textContent = v + '%';
    fill(tp.tempo);
    settings.tempo = v; saveSettings();
  });

  // ── result ticket ───────────────────────────────────────────────────────
  const result = $('#result');
  function showResult(r) {
    $('#result-acc').textContent = r.acc;
    $('#result-hit').textContent = r.hit;
    $('#result-miss').textContent = r.miss;
    $('#result-time').textContent = fmt(r.time);
    $('#result-song').textContent = r.name;
    $('#result-quip').textContent = r.acc >= 98 ? '完美的演出！' : r.acc >= 90 ? 'Bravo! 幾乎沒有失誤' : r.acc >= 75 ? '很棒，再一次會更好' : r.acc >= 50 ? '慢慢來，光會等你' : '多練幾次就熟了 ♡';
    closeDrawer(false);
    result.hidden = false;
    requestAnimationFrame(() => $('#result-again').focus({ preventScroll: true }));
  }
  function hideResult() { result.hidden = true; }
  $('#result-again').addEventListener('click', () => { hideResult(); stopPlayback(); P.ended = false; play(); });
  $('#result-close').addEventListener('click', () => { hideResult(); stopPlayback(); P.ended = false; updateTransport(); tp.play.focus({ preventScroll: true }); });
  result.addEventListener('click', e => { if (e.target === result) $('#result-close').click(); });

  // ═══════════════════════════════════════════════════════════════════════
  // Drawers
  // ═══════════════════════════════════════════════════════════════════════
  let openName = null, returnFocus = null;
  function openDrawer(name, trigger) {
    if (openName === name) return;
    closeDrawer(false);
    const el = drawers[name];
    openName = name;
    returnFocus = trigger || pills.find(p => p.dataset.drawer === name);
    if (name === 'library') renderLibrary();
    if (name === 'compose') updateRecUI();
    if (name === 'transcribe' && window.TranscribeUI) window.TranscribeUI.open();
    el.classList.add('is-open');
    scrim.classList.add('is-on');
    pills.forEach(p => p.setAttribute('aria-expanded', String(p.dataset.drawer === name)));
    requestAnimationFrame(() => el.focus({ preventScroll: true }));
  }
  function closeDrawer(restore = true) {
    if (!openName) return false;
    drawers[openName].classList.remove('is-open');
    scrim.classList.remove('is-on');
    pills.forEach(p => p.setAttribute('aria-expanded', 'false'));
    openName = null;
    if (restore && returnFocus) returnFocus.focus({ preventScroll: true });
    return true;
  }
  function closeTopmost() {
    if (!result.hidden) { $('#result-close').click(); return true; }
    return closeDrawer(true);
  }
  pills.forEach(p => p.addEventListener('click', () => (openName === p.dataset.drawer ? closeDrawer(true) : openDrawer(p.dataset.drawer, p))));
  scrim.addEventListener('click', () => closeDrawer(true));
  $$('.mu-close').forEach(b => b.addEventListener('click', () => closeDrawer(true)));
  $('#rec-chip').addEventListener('click', e => openDrawer('compose', e.currentTarget));

  // ── 樂器 ────────────────────────────────────────────────────────────────
  const instGrid = $('#inst-grid');
  instGrid.innerHTML = INSTRUMENTS.map(it => `<button class="mu-inst" type="button" data-id="${it.id}" aria-pressed="false">${ICON[it.id]}<b>${it.name}</b><span class="mono">${it.en}</span><span class="hand">${it.note}</span></button>`).join('');
  function applyInstrument() {
    const it = INST_BY_ID[settings.instrument];
    $$('.mu-inst', instGrid).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.id === it.id)));
    $('#inst-chip-name').textContent = it.name;
    $('#inst-chip-en').textContent = it.en.toUpperCase();
  }
  instGrid.addEventListener('click', e => {
    const b = e.target.closest('.mu-inst');
    if (!b) return;
    releaseAll();
    settings.instrument = b.dataset.id;
    applyInstrument(); saveSettings();
    if (!Audio.ensure()) return;
    [7, 9, 11, 14].forEach((k, n) => { // a little preview arpeggio
      Audio.note(k, n * 0.12, 0.3);
      setTimeout(() => flash(k, 200), n * 120);
    });
  });

  // ── 樂譜 library ────────────────────────────────────────────────────────
  const songList = $('#song-list');
  function renderLibrary() {
    const songs = allSongs();
    $('#lib-count').textContent = songs.length;
    songList.innerHTML = songs.map((s, i) => {
      const tag = s.source === 'demo' ? '<span class="chip is-demo">DEMO</span>' : `<span class="chip">${SOURCE_LABEL[s.source]}</span>`;
      const name = esc(s.name);
      return `<li class="mu-song${P.song && P.song.id === s.id ? ' is-current' : ''}" data-id="${esc(s.id)}">
        <span class="mu-song-no" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>
        <span class="mu-song-name"><span>${name}</span>${tag}</span>
        <span class="mu-song-meta">${s.notes.length} 音 · ${fmt(songLength(s))} · ${s.bpm} BPM${s.author ? ' · ' + esc(s.author) : ''}</span>
        <span class="mu-song-acts">
          <button class="mu-act is-main" type="button" data-act="play" aria-label="播放「${name}」">${ICON.play}播放</button>
          <button class="mu-act" type="button" data-act="practice" aria-label="練習「${name}」">${ICON.practice}練習</button>
          <button class="mu-act is-icon" type="button" data-act="export" aria-label="匯出「${name}」為 JSON" title="匯出 JSON">${ICON.export}</button>
          ${s.source === 'demo' ? '' : `<button class="mu-act is-icon is-danger" type="button" data-act="delete" aria-label="刪除「${name}」" title="刪除">${ICON.trash}</button>`}
        </span>
      </li>`;
    }).join('');
  }
  function markCurrentSong() {
    $$('.mu-song', songList).forEach(li => li.classList.toggle('is-current', !!P.song && li.dataset.id === P.song.id));
  }
  songList.addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('.mu-song').dataset.id, song = songById(id);
    if (!song) return;
    const act = btn.dataset.act;
    if (act === 'play' || act === 'practice') {
      Audio.ensure();
      closeDrawer(false);
      loadSong(song, act === 'practice' ? 'practice' : 'listen', act === 'play');
      tp.play.focus({ preventScroll: true });
      if (act === 'practice') toast('按下發光的鍵開始練習');
    } else if (act === 'export') {
      download(song);
    } else if (act === 'delete') {
      if (btn.dataset.armed) {
        library = library.filter(s => s.id !== id);
        saveLibrary();
        if (P.song && P.song.id === id) unloadSong();
        renderLibrary();
        toast('已刪除「' + song.name + '」');
        const first = songList.querySelector('.mu-act');
        if (first) first.focus({ preventScroll: true });
      } else {
        btn.dataset.armed = '1';
        btn.classList.add('is-armed');
        btn.innerHTML = ICON.trash + '確定？';
        btn.setAttribute('aria-label', '再按一次以刪除「' + song.name + '」');
        setTimeout(() => {
          if (!btn.isConnected) return;
          delete btn.dataset.armed; btn.classList.remove('is-armed'); btn.innerHTML = ICON.trash;
          btn.setAttribute('aria-label', '刪除「' + song.name + '」');
        }, 3200);
      }
    }
  });

  const importStatus = $('#import-status');
  function setImportStatus(msg, kind) {
    importStatus.textContent = msg;
    importStatus.className = 'status' + (kind ? ' is-' + kind : '');
  }
  function importText(text, label) {
    try {
      const { songs, skipped, encrypted } = parseSheets(text);
      if (!songs.length) throw new Error(encrypted ? '這份樂譜是加密格式，無法讀取' : '找不到可用的 songNotes（key 需為 1Key0–1Key14）');
      library = library.concat(songs);
      saveLibrary(); renderLibrary();
      const extra = (skipped ? `，略過 ${skipped} 首無效樂譜` : '') + (encrypted ? `，${encrypted} 首為加密格式` : '');
      setImportStatus(`已匯入 ${songs.length} 首：${songs.map(s => s.name).join('、')}${extra}`, 'ok');
      toast(`已匯入 ${songs.length} 首樂譜`);
      return true;
    } catch (err) {
      setImportStatus((label ? label + '：' : '') + err.message, 'error');
      return false;
    }
  }
  Site.bindDropzone($('#import-zone'), $('#import-file'), async file => {
    if (file.size > 5 * 1024 * 1024) { setImportStatus(file.name + '：檔案太大（上限 5 MB）', 'error'); return; }
    try { importText(decodeText(await file.arrayBuffer()), file.name); }
    catch (err) { setImportStatus(file.name + '：讀取失敗', 'error'); }
  });
  $('#import-paste').addEventListener('click', () => {
    const ta = $('#import-text');
    if (!ta.value.trim()) { setImportStatus('請先貼上樂譜 JSON', 'error'); ta.focus(); return; }
    if (importText(ta.value)) ta.value = '';
  });

  // ── 編曲 recorder ───────────────────────────────────────────────────────
  const rec = { state: 'idle', start: 0, notes: [], dur: 0, timer: 0, drawn: -1 };
  const recEls = {
    deck: $('#rec-deck'), toggle: $('#rec-toggle'), state: $('#rec-state'), time: $('#rec-time'), count: $('#rec-count'),
    roll: $('#rec-roll'), empty: $('#rec-roll-empty'), form: $('#rec-save'), name: $('#rec-name'), bpm: $('#rec-bpm'),
    chip: $('#rec-chip'), chipTime: $('#rec-chip-time'), help: $('#rec-help')
  };
  function recordNote(k) { if (rec.state === 'rec') rec.notes.push([Math.round(now() - rec.start), k]); }
  function recStart() {
    Audio.ensure();
    rec.state = 'rec'; rec.start = now(); rec.notes = []; rec.dur = 0; rec.drawn = -1;
    clearInterval(rec.timer);
    rec.timer = setInterval(updateRecUI, 100);
    updateRecUI();
  }
  function recStop() {
    clearInterval(rec.timer);
    rec.dur = now() - rec.start;
    if (!rec.notes.length) {
      rec.state = 'idle';
      toast('沒有錄到任何音符');
    } else {
      rec.state = 'done';
      const d = new Date();
      recEls.name.value = `我的旋律 ${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }
    rec.drawn = -1;
    updateRecUI();
    if (rec.state === 'done' && openName === 'compose') recEls.name.focus({ preventScroll: true });
  }
  function recReset() { clearInterval(rec.timer); rec.state = 'idle'; rec.notes = []; rec.dur = 0; rec.drawn = -1; updateRecUI(); }
  function recSong(id) {
    const t0 = rec.notes[0][0];
    return {
      id: id || uid(), name: recEls.name.value.trim().slice(0, 60) || '我的旋律', bpm: clamp(Math.round(Number(recEls.bpm.value)) || 120, 30, 300),
      author: '', source: 'record', created: Date.now(), notes: rec.notes.map(([t, k]) => [t - t0, k])
    };
  }
  function updateRecUI() {
    const recording = rec.state === 'rec', elapsed = recording ? now() - rec.start : rec.dur;
    recEls.deck.dataset.state = rec.state;
    recEls.toggle.setAttribute('aria-label', recording ? '停止錄音' : '開始錄音');
    recEls.state.textContent = recording ? 'RECORDING · 錄音中' : rec.state === 'done' ? 'TAKE READY · 已錄好' : 'STANDBY · 待機';
    const s = elapsed / 1000;
    recEls.time.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(1).padStart(4, '0')}`;
    recEls.count.textContent = `${rec.notes.length} 個音符`;
    recEls.form.hidden = rec.state !== 'done';
    recEls.help.hidden = rec.state === 'done';
    recEls.chip.hidden = !recording;
    recEls.chipTime.textContent = fmt(elapsed);
    stage.classList.toggle('is-recording', recording);
    if (rec.drawn !== rec.notes.length || recording) drawRoll(elapsed);
  }
  function drawRoll(elapsed) {
    rec.drawn = rec.notes.length;
    recEls.empty.hidden = rec.notes.length > 0 || rec.state === 'rec';
    let svg = '';
    for (let k = 0; k < 15; k++) {
      const y = (6 + (14 - k) * 6).toFixed(1);
      svg += `<line class="grid-line${ROOTS.has(k) ? ' is-root' : ''}" x1="0" x2="300" y1="${y}" y2="${y}"/>`;
    }
    const span = Math.max(elapsed || 0, 4000);
    for (const [t, k] of rec.notes) svg += `<rect class="dot" x="${(4 + (t / span) * 288).toFixed(1)}" y="${(4.4 + (14 - k) * 6).toFixed(1)}" width="4" height="3.2" rx="1.4"/>`;
    recEls.roll.innerHTML = svg;
  }
  recEls.toggle.addEventListener('click', () => (rec.state === 'rec' ? recStop() : recStart()));
  recEls.form.addEventListener('submit', e => {
    e.preventDefault();
    if (rec.state !== 'done') return;
    const song = recSong();
    library.push(song); saveLibrary(); renderLibrary();
    toast('已存入樂譜庫：「' + song.name + '」');
    recReset();
  });
  $('#rec-preview').addEventListener('click', () => {
    if (rec.state !== 'done') return;
    const song = recSong('preview');
    song.source = 'preview';
    closeDrawer(false);
    loadSong(song, 'listen', true);
    tp.play.focus({ preventScroll: true });
  });
  $('#rec-export').addEventListener('click', () => { if (rec.state === 'done') download(recSong()); });
  $('#rec-discard').addEventListener('click', () => { recReset(); toast('已捨棄這次錄音'); recEls.toggle.focus({ preventScroll: true }); });

  // ── 設定 ────────────────────────────────────────────────────────────────
  const set = { labels: $('#set-labels'), layout: $('#set-layout'), volume: $('#set-volume'), reverb: $('#set-reverb'), calm: $('#set-calm') };
  set.layout.innerHTML = Object.entries(LAYOUTS).map(([id, L]) => `<button class="mu-layout" type="button" data-value="${id}" aria-pressed="false" aria-label="${esc(L.desc)}">
      <span class="mu-layout-name">${esc(L.name)}</span>
      <span class="mu-caps" aria-hidden="true">${L.keys.map(c => `<span>${esc(c)}</span>`).join('')}</span>
    </button>`).join('');

  function applySettingsUI() {
    $$('button', set.labels).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === settings.labels)));
    $$('button', set.layout).forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === settings.layout)));
    set.volume.value = settings.volume; $('#set-volume-out').textContent = settings.volume; fill(set.volume);
    set.reverb.value = settings.reverb; $('#set-reverb-out').textContent = settings.reverb; fill(set.reverb);
    set.calm.setAttribute('aria-checked', String(isCalm()));
    tp.tempo.value = settings.tempo; tp.tempoOut.textContent = settings.tempo + '%'; fill(tp.tempo);
    stage.classList.toggle('is-calm', isCalm());
    rebuildKeymap(); refreshLabels(); applyInstrument(); updateHint();
  }
  set.labels.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    settings.labels = b.dataset.value; saveSettings(); applySettingsUI();
  });
  set.layout.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    releaseAll();
    settings.layout = b.dataset.value; saveSettings(); applySettingsUI();
  });
  [['volume', set.volume], ['reverb', set.reverb]].forEach(([key, input]) => input.addEventListener('input', () => {
    settings[key] = Number(input.value);
    $('#set-' + key + '-out').textContent = input.value;
    fill(input); Audio.applyMix(); saveSettings();
  }));
  set.calm.addEventListener('click', () => {
    settings.calm = !isCalm(); saveSettings(); applySettingsUI();
  });
  reduceMQ.addEventListener && reduceMQ.addEventListener('change', applySettingsUI);
  $('#set-reset').addEventListener('click', () => {
    releaseAll();
    settings = sanitizeSettings(null);
    saveSettings(); applySettingsUI(); Audio.applyMix(); setRate(settings.tempo / 100);
    toast('已恢復預設設定');
  });

  // ── stage decoration: drifting motes ────────────────────────────────────
  const motes = $('#motes');
  for (let i = 0; i < 16; i++) {
    const m = document.createElement('span');
    m.className = 'mu-mote';
    m.style.cssText = `left:${(4 + Math.random() * 92).toFixed(1)}%;--s:${(1.5 + Math.random() * 2.4).toFixed(1)}px;--d:${(11 + Math.random() * 11).toFixed(1)}s;--delay:${(-Math.random() * 22).toFixed(1)}s;--dx:${Math.round(Math.random() * 70 - 35)}px;--o:${(0.25 + Math.random() * 0.5).toFixed(2)}`;
    motes.append(m);
  }

  // ── boot ────────────────────────────────────────────────────────────────
  applySettingsUI();
  renderLibrary();
  updateTransport();
  updateRecUI();
  render(LEAD_IN);
  fill(tp.seek);

  // read-only hook for debugging / automated checks
  // 轉譜 (music-transcribe-ui.js): put a sheet into the songbook, or play it on the stage without keeping it
  function addSong(raw) {
    const song = normalizeStored(Object.assign({ id: uid(), source: 'import', created: Date.now() }, raw));
    if (!song) return null;
    library.push(song); saveLibrary(); renderLibrary();
    return song;
  }
  function previewSong(raw) {
    const song = normalizeStored(Object.assign({ id: 'preview', source: 'import', created: Date.now() }, raw));
    if (!song) return;
    closeDrawer(false);
    loadSong(song, 'listen', true);
  }
  window.CandleMusic = { addSong, preview: previewSong, get audio() { return Audio.ctx; }, get notesPlayed() { return Audio.stats.notes; }, get state() { return { mode: P.mode, playing: P.playing, step: P.step, song: P.song && P.song.name, hit: P.hit, miss: P.miss }; } };
})();
