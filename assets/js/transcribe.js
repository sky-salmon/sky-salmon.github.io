/* sky-salmon — 音檔轉樂譜: a piano recording → notes (Spotify's Basic Pitch, run in the browser) → a Sky 15-key sheet.
 *
 *   const raw = await transcribeAudio(fileOrPcm, pct => …)        // { duration, out, notes: [{ t, d, midi, amp }] } (seconds)
 *   raw.notes = await notesFrom(raw.out, 'low' | 'mid' | 'high')   // 靈敏度: re-read the model's output, no re-run
 *   const sheet = toSky(raw.notes, { fingers, transpose, octave, quantize })
 *        // { notes: [[ms, key]], bpm, info: { shift, octave, keyName, snapped, folded, dropped, total } }
 *
 * The recording never leaves the browser. Sky's instrument has 15 keys: the white keys from C4 to C6. So the piece is
 * moved to the transposition with the fewest sharps and flats (a major key lands on C major, a minor key on A minor),
 * the melody's octave is fitted into the two octaves, notes outside are folded in, the few left between white keys
 * snap to the neighbour the piece uses more, and every moment keeps at most `fingers` keys: the melody (the top line),
 * then the bass, then the loudest of the rest. */
export const SR = 22050;
export const SKY_MIDI = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79, 81, 83, 84];
const WHITE = new Set([0, 2, 4, 5, 7, 9, 11]);
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const CHORD_S = 0.04;                     // onsets this close are one chord (as the practice mode groups them)
let lib = null;

export async function decodeToMono(file) {
  const data = await file.arrayBuffer();
  const AC = window.AudioContext || window.webkitAudioContext;
  const ctx = new AC();
  let buf;
  try { buf = await ctx.decodeAudioData(data); } finally { if (ctx.close) ctx.close(); }
  const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * SR)), SR);   // downmixes to mono
  const src = off.createBufferSource();
  src.buffer = buf; src.connect(off.destination); src.start();
  return (await off.startRendering()).getChannelData(0);
}

// the model's raw output (frames / onsets / contours, 86 per second) — kept so the notes can be re-read with other
// thresholds without running the model again
export async function runModel(input, onProgress = () => {}, opts = {}) {
  const pcm = input instanceof Float32Array ? input : await decodeToMono(input);
  if (pcm.length > SR * 60 * (opts.maxMinutes || 8)) throw Object.assign(new Error('recording too long'), { code: 'too-long' });
  if (!lib) lib = import(new URL('vendor/basic-pitch.js', import.meta.url).href);
  const { BasicPitch, tf } = await lib;
  try { if (!(await tf.setBackend('webgl'))) throw new Error('no webgl'); } catch { await tf.setBackend('cpu'); }
  await tf.ready();
  const model = new BasicPitch(new URL('../models/basic-pitch/model.json', import.meta.url).href);
  const frames = [], onsets = [], contours = [];
  await model.evaluateModel(pcm, (f, o, c) => { frames.push(...f); onsets.push(...o); contours.push(...c); }, p => onProgress(p));
  return { frames, onsets, contours, duration: pcm.length / SR, backend: tf.getBackend() };
}
// notes from the model's output; a higher onset threshold keeps fewer, surer notes
// (tuned on rendered piano clips with known notes: 0.6 / 0.4 / 11 frames read them best)
export const LEVELS = { low: { onset: 0.7, frame: 0.45, minLen: 11 }, mid: { onset: 0.6, frame: 0.4, minLen: 11 }, high: { onset: 0.5, frame: 0.3, minLen: 7 } };
export async function notesFrom(out, level = 'mid', opts = {}) {
  const { outputToNotesPoly, addPitchBendsToNoteEvents, noteFramesToTime } = await lib;
  const L = LEVELS[level] || LEVELS.mid;
  const events = noteFramesToTime(addPitchBendsToNoteEvents(out.contours,
    outputToNotesPoly(out.frames, out.onsets, opts.onsetThresh ?? L.onset, opts.frameThresh ?? L.frame, opts.minNoteLen ?? L.minLen)));
  return events.map(n => ({ t: n.startTimeSeconds, d: n.durationSeconds, midi: n.pitchMidi, amp: n.amplitude }))
    .sort((a, b) => a.t - b.t || b.midi - a.midi);
}
export async function transcribeAudio(input, onProgress = () => {}, opts = {}) {
  const out = await runModel(input, onProgress, opts);
  return { duration: out.duration, backend: out.backend, out, notes: await notesFrom(out, opts.level || 'mid', opts) };
}

// ── to Sky ──────────────────────────────────────────────────────────────────
// onset groups: notes starting within CHORD_S of the group's first note
function groups(notes) {
  const out = [];
  for (const n of notes) {
    const g = out[out.length - 1];
    if (g && n.t - g.t <= CHORD_S) g.notes.push(n); else out.push({ t: n.t, notes: [n] });
  }
  out.forEach(g => g.notes.sort((a, b) => b.midi - a.midi));   // top line first
  return out;
}
const weight = n => Math.max(0.05, Math.min(n.d || 0.2, 1.5)) * (n.amp || 0.5);
// the transposition (−6 … +5 semitones) that puts the most of the piece on white keys. Neighbouring keys share six of
// their seven notes, so a few misheard notes can tip the count: within 1 % of the best, the smallest move wins.
function bestShift(notes) {
  const hist = new Array(12).fill(0);
  notes.forEach(n => { hist[((Math.round(n.midi) % 12) + 12) % 12] += weight(n); });
  const total = hist.reduce((a, b) => a + b, 0) || 1, score = {};
  for (let s = -6; s <= 5; s++) score[s] = hist.reduce((a, w, pc) => a + (WHITE.has(((pc + s) % 12 + 12) % 12) ? w : 0), 0) / total;
  const top = Math.max(...Object.values(score));
  const shift = Object.keys(score).map(Number).filter(s => score[s] >= top - 0.01).sort((a, b) => Math.abs(a) - Math.abs(b) || score[b] - score[a])[0];
  return { shift, fit: score[shift], hist };
}
// the octave that puts the melody (each chord's top note) inside C4–C6
function bestOctave(gs, shift) {
  let best = 0, bestScore = -1;
  for (let o = -48; o <= 48; o += 12) {
    let sc = 0;
    gs.forEach(g => {
      const m = Math.round(g.notes[0].midi) + shift + o;
      if (m >= 60 && m <= 84) sc += 3;
      g.notes.slice(1).forEach(n => { const k = Math.round(n.midi) + shift + o; if (k >= 60 && k <= 84) sc += 0.5; });
    });
    if (sc > bestScore || (sc === bestScore && Math.abs(o) < Math.abs(best))) { best = o; bestScore = sc; }
  }
  return best;
}
// Sky key index for a MIDI note already moved by shift + octave: folded into range, snapped to a white key
function toKey(m, hist, shift, stats) {
  let x = m;
  while (x < 60) { x += 12; stats.folded++; }
  while (x > 84) { x -= 12; stats.folded++; }
  if (!WHITE.has(x % 12)) {
    stats.snapped++;
    const up = x + 1 <= 84 ? x + 1 : null, down = x - 1 >= 60 ? x - 1 : null;
    const w = k => (k == null ? -1 : hist[((k - shift) % 12 + 12) % 12]);   // how much the piece uses that pitch
    x = up == null ? down : down == null ? up : (w(up) > w(down) ? up : down);
  }
  return SKY_MIDI.indexOf(x);
}
// beat length (seconds) from the onsets: autocorrelation of an onset train, 60–180 BPM
function beatOf(times) {
  if (times.length < 8) return 0.5;
  const BIN = 0.01, end = times[times.length - 1] + 1, n = Math.ceil(end / BIN), x = new Float32Array(n);
  times.forEach(t => { const i = Math.round(t / BIN); for (let j = -2; j <= 2; j++) if (i + j >= 0 && i + j < n) x[i + j] += Math.exp(-(j * j) / 2); });
  let best = 50, bestR = -1;
  for (let lag = 33; lag <= 100; lag++) {   // 0.33 s … 1.0 s
    let r = 0;
    for (let i = 0; i + lag < n; i++) r += x[i] * x[i + lag];
    for (let i = 0; i + 2 * lag < n; i++) r += 0.5 * x[i] * x[i + 2 * lag];   // a beat also lines up two beats on
    r /= Math.sqrt(lag);
    if (r > bestR) { bestR = r; best = lag; }
  }
  return best * BIN;
}

export function toSky(notesIn, opts = {}) {
  const fingers = opts.fingers || 0;                       // 0 = no limit
  const minAmp = opts.minAmp ?? 0;
  const all = notesIn.filter(n => n.midi >= 21 && n.midi <= 108);
  const notes = all.filter(n => (n.amp ?? 1) >= minAmp);
  const stats = { snapped: 0, folded: 0, dropped: all.length - notes.length, total: all.length, merged: 0 };
  if (!notes.length) return { notes: [], bpm: 120, info: Object.assign({ shift: 0, octave: 0, keyName: '' }, stats) };
  const sh = bestShift(notes);
  const shift = Number.isFinite(opts.transpose) ? opts.transpose : sh.shift;
  const gs = groups(notes);
  const octave = Number.isFinite(opts.octave) ? opts.octave : bestOctave(gs, shift);
  // each moment: melody (top), bass (bottom), then the inner notes from the top down; at most `fingers` different keys
  // (by pitch, not loudness: the heard loudness of inner notes is unsteady, the pitch isn't — 3 fingers read 90 % → 92 %)
  let steps = gs.map(g => {
    const ordered = [g.notes[0]];
    if (g.notes.length > 1) ordered.push(g.notes[g.notes.length - 1]);
    g.notes.slice(1, -1).forEach(n => ordered.push(n));
    const keys = [];
    for (const n of ordered) {
      const k = toKey(Math.round(n.midi) + shift + octave, sh.hist, shift, stats);
      if (k >= 0 && !keys.includes(k)) keys.push(k);
      if (fingers && keys.length >= fingers) break;
    }
    return { t: g.t, keys };
  }).filter(s => s.keys.length);
  // with one or two fingers, a moment right on the heels of the last one can't be played: keep the earlier one
  const gap = fingers === 1 ? 0.09 : fingers === 2 ? 0.06 : 0;
  if (gap) {
    const kept = [];
    steps.forEach(s => { const p = kept[kept.length - 1]; if (p && s.t - p.t < gap) stats.merged++; else kept.push(s); });
    steps = kept;
  }
  // timing: as played, or on a grid of quarter beats
  const t0 = steps.length ? steps[0].t : 0;
  const bpm = Math.round(60 / beatOf(steps.map(s => s.t - t0)));
  let times = steps.map(s => s.t - t0);
  if (opts.quantize) {
    const grid = 60 / bpm / 4;                                // the grid of the BPM the sheet states, so they agree
    times = times.map(t => Math.round(t / grid) * grid);
    const merged = [];
    steps.forEach((s, i) => {
      const p = merged[merged.length - 1];
      if (p && Math.abs(p.t - times[i]) < 1e-6) { s.keys.forEach(k => { if (!p.keys.includes(k) && (!fingers || p.keys.length < fingers)) p.keys.push(k); }); stats.merged++; }
      else merged.push({ t: times[i], keys: s.keys.slice() });
    });
    steps = merged; times = steps.map(s => s.t);
  }
  const out = [];
  steps.forEach((s, i) => s.keys.forEach(k => out.push([Math.round(times[i] * 1000), k])));
  // the piece's key, read back from the move: major → C, minor → A
  const tonicMajor = ((0 - shift) % 12 + 12) % 12, tonicMinor = ((9 - shift) % 12 + 12) % 12;
  return { notes: out, bpm, t0, info: Object.assign({ shift, autoShift: sh.shift, octave, fit: sh.fit,
    keyName: `${NAMES[tonicMajor]} 大調／${NAMES[tonicMinor]} 小調`, steps: steps.length }, stats) };
}
