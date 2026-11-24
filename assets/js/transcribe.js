/* sky-salmon — 音檔轉樂譜: a piano recording → notes (Spotify's Basic Pitch, run in the browser) → a Sky 15-key sheet.
 *
 *   const raw = await transcribeAudio(fileOrPcm, pct => …)        // { duration, out, notes: [{ t, d, midi, amp }] } (seconds)
 *   raw.notes = await notesFrom(raw.out, 'low' | 'mid' | 'high')   // 靈敏度: re-read the model's output, no re-run
 *   const sheet = toSky(raw.notes, { fingers, transpose, octave, quantize })
 *        // { notes: [[ms, key]], bpm, t0, info: { shift, octave, keyName, tune, bass, acc, snapped, folded, dropped, ghosts, total } }
 *
 * The recording never leaves the browser. Sky's instrument has 15 keys: the white keys from C4 to C6. The notes are
 * sorted into the tune, the bass and the accompaniment; the piece is moved to the transposition with the fewest sharps
 * and flats (a major key lands on C major, a minor key on A minor); the tune is fitted into the two octaves and the
 * rest is placed under it. Finger counts are layers: 1 = the tune, 2 = + the bass, 3 and up = + the accompaniment. */
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
// Notes from the model's output. How sure the model is of a note's onset depends on the recording: a loud, clean
// one gives most real notes an onset above 0.8, a soft home recording with pedal and room sound often under 0.6. So the
// onset threshold follows the recording: a share (by 靈敏度) of `sure`, the 90th percentile of the onset peaks of all
// candidate notes. Every note needs its own onset — basic-pitch's "melodia trick" (turning leftover ringing into notes)
// stays off: on a piano that is mostly the pedal and the strings' overtones. Then `tidy` drops the doubles and
// overtones a lower threshold lets in. A note needs to ring 5 frames (58 ms): 11 lost real fast and soft notes.
// (Tuned on 34 rendered piano clips with known notes, clean to soft.)
export const LEVELS = { low: { k: 0.8, lo: 0.5, hi: 0.75 }, mid: { k: 0.72, lo: 0.45, hi: 0.65 }, high: { k: 0.62, lo: 0.4, hi: 0.6 } };
function onsetPeak(onsets, f0, k) {
  let p = 0;
  for (let f = Math.max(0, f0 - 2); f <= Math.min(onsets.length - 1, f0 + 2); f++) p = Math.max(p, onsets[f][k]);
  return p;
}
// A light Gaussian blur along time (σ = 1 frame, 12 ms) of the model's output before notes are read: a note's onset or
// ringing that flickers for a frame no longer makes a second note or a stray one (noise 5 → 3 %). Only for a clear
// recording (sure ≥ 0.85): in a soft one it also smooths away real quiet notes (the first test song lost 76 of 593).
function blurTime(m, sig = 1) {
  const R = Math.ceil(sig * 3), k = [];
  for (let i = -R; i <= R; i++) k.push(Math.exp(-i * i / (2 * sig * sig)));
  const ks = k.reduce((a, b) => a + b, 0), n = m.length, w = n ? m[0].length : 0, out = new Array(n);
  for (let t = 0; t < n; t++) {
    const row = new Float32Array(w);
    for (let i = -R; i <= R; i++) { const src = m[Math.min(n - 1, Math.max(0, t + i))], kk = k[i + R] / ks; for (let j = 0; j < w; j++) row[j] += src[j] * kk; }
    out[t] = Array.from(row);
  }
  return out;
}
export async function notesFrom(out, level = 'mid', opts = {}) {
  const { outputToNotesPoly, noteFramesToTime } = await lib;
  if (out.sure == null) {
    const peaks = outputToNotesPoly(out.frames, out.onsets, 0.3, 0.3, 7, true, null, null, false).map(e => onsetPeak(out.onsets, e.startFrame, e.pitchMidi - 21)).sort((a, b) => a - b);
    out.sure = peaks.length ? peaks[Math.floor(peaks.length * 0.9)] : 0.9;
  }
  if (!out.soft && out.sure < 0.85) out.soft = { frames: out.frames, onsets: out.onsets };
  if (!out.soft) {   // blurred once; the onsets scaled back to their old peak so the thresholds keep their meaning
    const on = blurTime(out.onsets), top = m => m.reduce((a, r) => Math.max(a, ...r), 0), g = top(out.onsets) / (top(on) || 1);
    out.soft = { frames: blurTime(out.frames), onsets: on.map(r => r.map(v => v * g)) };
  }
  const read = (on, fr, len) => outputToNotesPoly(out.soft.frames, out.soft.onsets, on, fr, len, true, null, null, false);
  const L = LEVELS[level] || LEVELS.mid;
  const th = opts.onsetThresh ?? Math.max(L.lo, Math.min(L.hi, L.k * out.sure));
  const toNotes = ev => noteFramesToTime(ev).map((n, i) => ({ t: n.startTimeSeconds, d: n.durationSeconds, midi: n.pitchMidi, amp: n.amplitude,
    on: onsetPeak(out.soft.onsets, ev[i].startFrame, ev[i].pitchMidi - 21) })).sort((a, b) => a.t - b.t || b.midi - a.midi);
  const len = opts.minNoteLen ?? 5;
  const main = toNotes(read(th, opts.frameThresh ?? Math.max(0.3, th - 0.2), len));
  return tidy(opts.weak === false ? main : withWeak(main, toNotes(read(th, 0.3, len))));
}
// Notes with a clear onset whose ringing the model hears only faintly (between 0.3 and the frame threshold): mostly an
// overtone of a note sounding then, or the same key again — but those that are neither are mostly real (a soft note
// under a louder chord), so they are added back.
export function withWeak(main, wide) {
  const same = (a, b) => a.midi === b.midi && Math.abs(a.t - b.t) < 0.03;
  const add = wide.filter(x => !main.some(m => same(m, x)) && !wide.some(m => m !== x && (
    (m.midi === x.midi && Math.abs(m.t - x.t) < 0.3)
    || ([12, 19, 24, 28].includes(x.midi - m.midi) && m.t <= x.t + 0.05 && x.t <= m.t + m.d + 0.05))));
  return main.concat(add).sort((a, b) => a.t - b.t || b.midi - a.midi);
}
// Reading at a lower threshold also lets in the same key heard twice (a late second onset, or the pedal ringing on
// read as a new strike) and quiet overtones over a ringing note. Each has a much weaker onset than the real note
// next to it (`on`: the onset peak each note starts from), so dropped are: the same key again within 0.3 s with under
// 85 % of the first one's onset, or right after it stopped with under 60 %; and an octave / octave + fifth / two
// octaves over a note struck at most 0.15 s before, with a weaker onset and a quieter tone (an overtone rings with
// its string's attack — a tune note a twelfth over a held bass a beat later is real).
const OVER = new Set([12, 19, 24, 28]);
export function tidy(notes, t = {}) {
  const T = Object.assign({ dup: 0.85, ring: 0.6, over: 0.8, overWin: 0.15 }, t), keep = notes.map(() => true);
  for (let i = 0; i < notes.length; i++) {
    const x = notes[i];
    for (let j = i - 1; j >= 0 && x.t - notes[j].t < 3; j--) {
      const m = notes[j];
      if (!keep[j]) continue;
      if (m.midi === x.midi && ((x.t - m.t < 0.3 && x.on < T.dup * m.on) || (x.t - (m.t + m.d) < 0.1 && x.on < T.ring * m.on))) { keep[i] = false; break; }
      if (m.midi < x.midi && OVER.has(x.midi - m.midi) && x.t - m.t <= T.overWin && x.on < T.over * m.on && x.amp < m.amp) { keep[i] = false; break; }
    }
    for (let j = i + 1; keep[i] && j < notes.length && notes[j].t - x.t <= 0.05; j++) {
      const m = notes[j];
      if (m.midi < x.midi && OVER.has(x.midi - m.midi) && x.on < T.over * m.on && x.amp < m.amp) keep[i] = false;
    }
  }
  return notes.filter((_, i) => keep[i]);
}
export async function transcribeAudio(input, onProgress = () => {}, opts = {}) {
  const out = await runModel(input, onProgress, opts);
  return { duration: out.duration, backend: out.backend, out, notes: await notesFrom(out, opts.level || 'mid', opts) };
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

// ── to Sky ──────────────────────────────────────────────────────────────────
// A piano cover is a tune over an accompaniment. Every finger count keeps the same tune: 1 finger is the tune alone;
// 2, 3, 4 add the bass and the accompaniment with at most that many keys at a time (the tune first, then the bass,
// then the accompaniment from the top down); no limit keeps everything.
// The accompaniment is always placed under the tune: Sky has only two octaves, and a left hand folded up into the
// tune's octave is what makes a sheet sound muddy.
const OVERTONES = new Set([12, 19, 24, 28]);   // octave, octave + fifth, two octaves, two octaves + third
const GHOST = 0.6;                             // an overtone heard as a note is quieter than the string it rings on
// notes starting together (within 50 ms) where the upper one sits on an overtone of a louder lower one: the string
// ringing, not a key (a real octave doubling is played about as loud as the note under it)
function dropGhosts(notes, ratio = GHOST) {
  const amp = n => n.amp ?? 0.5;
  return notes.filter((n, i) => {
    for (let j = i - 1; j >= 0 && n.t - notes[j].t <= 0.05; j--) if (isGhost(n, notes[j])) return false;
    for (let j = i + 1; j < notes.length && notes[j].t - n.t <= 0.05; j++) if (isGhost(n, notes[j])) return false;
    return true;
  });
  function isGhost(n, m) { return m.midi < n.midi && OVERTONES.has(Math.round(n.midi) - Math.round(m.midi)) && amp(n) < amp(m) * ratio; }
}
// onset groups: notes starting within CHORD_S of the group's first note → group index per note
function groupIds(notes) {
  const id = new Array(notes.length); let g = -1, gt = -Infinity;
  notes.forEach((n, i) => { if (n.t - gt > CHORD_S) { g++; gt = n.t; } id[i] = g; });
  return { id, count: g + 1 };
}
// a percentile of the pitches within ±2.5 s of each note: where the top (or bottom) of the texture is around it
function around(notes, q) {
  const out = new Array(notes.length); let lo = 0, hi = 0;
  for (let i = 0; i < notes.length; i++) {
    while (notes[lo].t < notes[i].t - 2.5) lo++;
    while (hi < notes.length && notes[hi].t <= notes[i].t + 2.5) hi++;
    const w = []; for (let k = lo; k < hi; k++) w.push(notes[k].midi);
    w.sort((a, b) => a - b); out[i] = w[Math.min(w.length - 1, Math.floor(w.length * q))];
  }
  return out;
}
// The tune: the best single line through the piece, one note per moment. A note is a good tune note when it is near
// the top of the texture around it and played firmly; the line prefers steps to leaps, does not dip under a tune note
// still ringing above it (that is the accompaniment moving), and is penalised for passing under a higher note it skips.
function findTune(notes, w = {}) {
  const W = Object.assign({ top: 0.3, low: 1.5, amp: 2, leap: 1.2, ring: 0.6, skip: 1, rest: 0.5 }, w);
  const N = notes.length, { id } = groupIds(notes);
  const top = []; notes.forEach((n, i) => { if (top[id[i]] == null || n.midi > notes[top[id[i]]].midi) top[id[i]] = i; });
  const amps = notes.map(n => n.amp ?? 0.5).sort((a, b) => a - b), med = amps[amps.length >> 1] || 0.5;
  const hiRef = around(notes, 0.85);
  const gain = i => { const n = notes[i]; return 1 + W.amp * ((n.amp ?? 0.5) - med) - W.low * Math.max(0, hiRef[i] - n.midi) / 12 + (top[id[i]] === i ? W.top : 0); };
  const best = new Float64Array(N), prev = new Int32Array(N).fill(-1);
  let farBest = 0, farIdx = -1, far = 0;            // the best line ending more than 3 s back (a rest, then a new phrase)
  for (let i = 0; i < N; i++) {
    const n = notes[i];
    while (far < i && notes[far].t < n.t - 3) { if (best[far] > farBest) { farBest = best[far]; farIdx = far; } far++; }
    let b = farIdx >= 0 ? farBest - W.rest : 0, bp = farIdx;
    if (b < 0) { b = 0; bp = -1; }
    for (let j = i - 1; j >= far; j--) {
      if (id[j] === id[i]) continue;
      const m = notes[j], leap = Math.abs(n.midi - m.midi);
      let c = W.leap * Math.max(0, leap - 2) / 12 + (leap > 12 ? 0.8 : 0);
      const ring = m.t + m.d - n.t;
      if (n.midi < m.midi && ring > 0.08) c += W.ring * Math.min(1, ring / 0.3);
      const hiSide = Math.max(m.midi, n.midi);
      for (let k = id[j] + 1; k < id[i]; k++) { const x = notes[top[k]]; if (x.midi > hiSide) c += W.skip * (x.amp ?? 0.5) / med; }
      if (best[j] - c > b) { b = best[j] - c; bp = j; }
    }
    best[i] = gain(i) + b; prev[i] = bp;
  }
  const tune = new Set();
  let i = 0; for (let k = 1; k < N; k++) if (best[k] > best[i]) i = k;
  for (; i >= 0 && N; i = prev[i]) tune.add(i);
  // a figure under the tune (tune, E, tune, E, …): a pitch struck 3+ times within ±2.5 s that the line took only now
  // and then, each time as a dip between higher tune notes — taken out, so the line doesn't flicker in and out of it
  const line = [...tune].sort((a, b) => a - b), out = [];
  line.forEach((k, j) => {
    const n = notes[k], a = notes[line[j - 1]], b = notes[line[j + 1]];
    if (!a || !b || a.midi <= n.midi || b.midi <= n.midi) return;
    let reps = 0, taken = 0;
    for (let q = 0; q < N; q++) if (notes[q].midi === n.midi && Math.abs(notes[q].t - n.t) <= 2.5) { reps++; if (tune.has(q)) taken++; }
    if (reps >= 3 && taken / reps < 0.5) out.push(k);
  });
  out.forEach(k => tune.delete(k));
  return tune;
}
const weight = n => Math.max(0.05, Math.min(n.d || 0.2, 1.5)) * (n.amp || 0.5);
// the transposition (−6 … +5 semitones) that puts the most of the piece on white keys (the tune counts double: its
// sharps must snap, the accompaniment's are left out). Neighbouring keys share six of their seven notes, so a few
// misheard notes can tip the count: within 1 % of the best, the smallest move wins.
function bestShift(notes, w = weight) {
  const hist = new Array(12).fill(0);
  notes.forEach(n => { hist[((Math.round(n.midi) % 12) + 12) % 12] += w(n); });
  const total = hist.reduce((a, b) => a + b, 0) || 1, score = {};
  for (let s = -6; s <= 5; s++) score[s] = hist.reduce((a, x, pc) => a + (WHITE.has(((pc + s) % 12 + 12) % 12) ? x : 0), 0) / total;
  const top = Math.max(...Object.values(score));
  const shift = Object.keys(score).map(Number).filter(s => score[s] >= top - 0.01).sort((a, b) => Math.abs(a) - Math.abs(b) || score[b] - score[a])[0];
  return { shift, fit: score[shift], hist };
}
// the octave that puts the most of the tune inside C4–C6, a little higher when it is a tie (room for the left hand)
function tuneOctave(tune, shift) {
  let best = 0, bestScore = -Infinity;
  for (let o = -48; o <= 48; o += 12) {
    let sc = 0;
    tune.forEach(n => { const m = Math.round(n.midi) + shift + o; if (m >= 60 && m <= 84) sc += 1; if (m >= 67 && m <= 84) sc += 0.15; });
    if (sc > bestScore + 1e-9) { best = o; bestScore = sc; }
  }
  return best;
}
// a tune note: folded into range, snapped to a white key (the neighbour the piece uses more)
function tuneKey(m, hist, shift, stats) {
  let x = m;
  while (x < 60) { x += 12; stats.folded++; }
  while (x > 84) { x -= 12; stats.folded++; }
  if (!WHITE.has(x % 12)) {
    stats.snapped++;
    const up = x + 1 <= 84 ? x + 1 : null, down = x - 1 >= 60 ? x - 1 : null;
    const w = k => (k == null ? -1 : hist[((k - shift) % 12 + 12) % 12]);
    x = up == null ? down : down == null ? up : (w(up) > w(down) ? up : down);
  }
  return x;
}
// an accompaniment note: on a white key, under the tune note sounding then; the bass as low as it goes, the rest as
// near its own octave as fits. null when it has no place (between keys, or no room under the tune).
function underKey(m, natural, ceiling, bass) {
  if (!WHITE.has(((m % 12) + 12) % 12)) return null;
  const c = [];
  for (let x = m - 60; x <= m + 60; x += 12) if (x >= 60 && x <= 84 && x < ceiling) c.push(x);
  if (!c.length) return null;
  return bass ? c[0] : c.reduce((a, b) => (Math.abs(b - natural) < Math.abs(a - natural) ? b : a));
}

export function toSky(notesIn, opts = {}) {
  const fingers = opts.fingers || 0;                       // 0 = no limit
  const all = notesIn.filter(n => n.midi >= 21 && n.midi <= 108).slice().sort((a, b) => a.t - b.t || b.midi - a.midi);
  const notes = opts.ghosts === false ? all : dropGhosts(all, opts.ghostRatio);
  const stats = { snapped: 0, folded: 0, dropped: 0, ghosts: all.length - notes.length, total: all.length, merged: 0, tune: 0, bass: 0, acc: 0 };
  const fate = opts.trace ? new Map() : null, mark = (n, f) => { if (fate) fate.set(n, f); };
  if (fate) { const kept = new Set(notes); all.forEach(n => { if (!kept.has(n)) mark(n, 'ghost'); }); }
  if (!notes.length) return { notes: [], bpm: 120, t0: 0, info: Object.assign({ shift: 0, autoShift: 0, octave: 0, keyName: '', steps: 0 }, stats) };
  // who plays what
  const tuneIdx = findTune(notes, opts.tuneWeights);
  const loRef = around(notes, 0.1), { id } = groupIds(notes);
  const low = []; notes.forEach((n, i) => { if (low[id[i]] == null || n.midi < notes[low[id[i]]].midi) low[id[i]] = i; });
  const tuneList = [...tuneIdx].sort((a, b) => a - b).map(i => notes[i]);
  // the tune note sounding at t (or the next one, if it comes within 0.6 s)
  let tp = 0;
  const tuneAt = t => {
    while (tp + 1 < tuneList.length && tuneList[tp + 1].t <= t + 0.03) tp++;
    const a = tuneList[tp];
    if (a && a.t <= t + 0.03 && a.t + Math.max(a.d, 0.3) + 0.1 >= t) return a;
    const b = a && a.t <= t + 0.03 ? tuneList[tp + 1] : a;
    return b && b.t - t < 0.6 ? b : null;
  };
  const role = notes.map((n, i) => {
    if (tuneIdx.has(i)) return 'tune';
    const tn = tuneAt(n.t);
    return low[id[i]] === i && n.midi <= loRef[i] + 4 && (!tn || n.midi <= tn.midi - 9) ? 'bass' : 'acc';
  });
  // where it goes
  const roleOf = new Map(notes.map((n, i) => [n, role[i]]));
  const sh = bestShift(notes, n => weight(n) * (roleOf.get(n) === 'tune' ? 2 : 1));
  const shift = Number.isFinite(opts.transpose) ? opts.transpose : sh.shift;
  const tuneNotes = notes.filter((n, i) => role[i] === 'tune');
  const octave = Number.isFinite(opts.octave) ? opts.octave : tuneOctave(tuneNotes.length ? tuneNotes : notes, shift);
  // phrase by phrase (split at rests over 1.5 s), each at the octave, one down or one up: a note outside the two
  // octaves costs 1, one below F4 a quarter (it would fold back and break the line), changing octave between phrases costs 1 plus the size of
  // the jump it makes — so a part of the song that climbs too high moves down as a whole
  const tuneSky = new Map(), phrases = [];
  tuneNotes.forEach((n, j) => { if (!j || n.t - tuneNotes[j - 1].t > 1.5) phrases.push([]); phrases[phrases.length - 1].push(n); });
  const OCT = Number.isFinite(opts.octave) ? [octave] : [octave, octave - 12, octave + 12];
  // a tune note low in the range leaves the accompaniment no room under it: a smaller cost, so a low phrase moves up
  const LOWC = opts.lowCost ?? 0.25;
  const outside = (ph, o) => ph.reduce((c, n) => { const m = Math.round(n.midi) + shift + o; return c + (m < 60 || m > 84 ? 1 : m < 65 ? LOWC : 0); }, 0);
  let cost = OCT.map(o => outside(phrases[0] || [], o)), back = [];
  for (let p = 1; p < phrases.length; p++) {
    const last = phrases[p - 1][phrases[p - 1].length - 1].midi, first = phrases[p][0].midi;
    const step = OCT.map(o => {
      let bc = Infinity, bi = 0;
      OCT.forEach((po, b) => { const c = cost[b] + (o === po ? 0 : 1 + 0.1 * Math.max(0, Math.abs(first + o - last - po) - 7)); if (c < bc) { bc = c; bi = b; } });
      return [bc + outside(phrases[p], o), bi];
    });
    cost = step.map(x => x[0]); back.push(step.map(x => x[1]));
  }
  const pick = new Array(phrases.length);
  let k = cost.indexOf(Math.min(...cost));
  for (let p = phrases.length - 1; p >= 0; p--) { pick[p] = OCT[k]; if (p) k = back[p - 1][k]; }
  phrases.forEach((ph, p) => ph.forEach(n => tuneSky.set(n, tuneKey(Math.round(n.midi) + shift + pick[p], sh.hist, shift, stats))));
  // 精簡度 (opts.simplify): a Sky key always sounds at full strength, so the soft fills of a left hand — under the
  // tune in the original — come out as loud as the tune and crowd it. The tune, the bass and the notes struck with a
  // tune note (its harmony) always stay; the other accompaniment notes are taken most important first (loudest ×
  // longest × surest onset) and kept only if no kept moment is closer than the spacing: 0.2 s at 1, 0.35 s at 2. So a
  // slow arpeggio (a note every 0.25 s or more) stays almost whole and a fast run is thinned, at the song's own pace.
  const simplify = opts.simplify || 0, fillKeep = new Set();
  if (simplify) {
    const GAP = simplify >= 2 ? 0.35 : 0.2, kept = [], fills = [];
    const tuneT = tuneList.map(x => x.t);
    const near = t => { let lo = 0, hi = tuneT.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (tuneT[mid] <= t) lo = mid + 1; else hi = mid; } return [tuneT[lo - 1], tuneT[lo]]; };
    notes.forEach((n, i) => {
      if (role[i] !== 'acc') { kept.push(n.t); return; }
      const [prev, next] = near(n.t);
      if ((prev != null && n.t - prev <= 0.07) || (next != null && next - n.t <= 0.1)) { fillKeep.add(n); kept.push(n.t); }
      else fills.push(n);
    });
    kept.sort((x, y) => x - y);
    const clear = t => { let lo = 0, hi = kept.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (kept[mid] < t) lo = mid + 1; else hi = mid; }
      return (lo >= kept.length || kept[lo] - t >= GAP) && (lo === 0 || t - kept[lo - 1] >= GAP); };
    fills.sort((x, y) => (y.amp ?? 0.5) * Math.min(1, y.d || 0.2) * (y.on ?? 0.7) - (x.amp ?? 0.5) * Math.min(1, x.d || 0.2) * (x.on ?? 0.7));
    fills.forEach(n => { if (clear(n.t)) { fillKeep.add(n); const j = kept.findIndex(t => t > n.t); kept.splice(j < 0 ? kept.length : j, 0, n.t); } });
  }
  tp = 0;
  const items = [];
  notes.forEach((n, i) => {
    const r = role[i];
    if (simplify && r === 'acc' && !fillKeep.has(n)) { mark(n, 'simplified'); return; }
    if (r === 'tune') { items.push({ t: n.t, x: tuneSky.get(n), pr: 0, n }); stats.tune++; return; }
    if (fingers === 1) { mark(n, 'tune-only'); return; }
    const tn = tuneAt(n.t), m = Math.round(n.midi) + shift;
    let x = underKey(m, m + octave, tn ? tuneSky.get(tn) : 85, r === 'bass');
    // no room under the tune (it runs low there): a note struck between tune notes keeps its own octave instead of
    // being lost; one struck with a tune note is still left out, so no chord sits over the tune
    if (x == null && opts.roomFallback !== false && tn && Math.abs(tn.t - n.t) > 0.07) x = underKey(m, m + octave, 85, false);
    if (x == null) { stats.dropped++; mark(n, WHITE.has(((m % 12) + 12) % 12) ? 'no-room' : 'black-key'); return; }
    items.push({ t: n.t, x, pr: r === 'bass' ? 1 : 2, n }); stats[r]++;
  });
  items.sort((a, b) => a.t - b.t || a.pr - b.pr || b.x - a.x);
  // moments: notes within 70 ms are played together, and a left hand up to 100 ms ahead of the tune joins its chord (at
  // the tune's time); a key already struck in the last 150 ms by another voice is not struck again
  let steps = [];
  const lastHit = new Map();
  items.forEach(it => {
    const h = lastHit.get(it.x);
    if (it.pr > 0 && h != null && it.t - h < (opts.rehit ?? 0.1)) { stats.merged++; mark(it.n, 'same-key-150ms'); return; }
    lastHit.set(it.x, it.t);
    const s = steps[steps.length - 1];
    if (s && it.t - s.t0 <= (it.pr === 0 && !s.tuned ? 0.1 : 0.07)) { s.items.push(it); if (it.pr === 0 && !s.tuned) { s.t = it.t; s.tuned = true; } }
    else steps.push({ t: it.t, t0: it.t, items: [it], tuned: it.pr === 0 });
  });
  steps = steps.map(s => {
    const keys = [], pr = Math.min(...s.items.map(it => it.pr));
    s.items.sort((a, b) => a.pr - b.pr || b.x - a.x).forEach(it => {
      const k = SKY_MIDI.indexOf(it.x);
      if (k >= 0 && !keys.includes(k) && (!fingers || keys.length < fingers)) { keys.push(k); mark(it.n, 'kept'); }
      else mark(it.n, keys.includes(k) ? 'same-key-chord' : 'finger-cap');
    });
    return { t: s.t, keys, pr, items: s.items };
  }).filter(s => s.keys.length);
  // with one or two fingers, a moment right on the heels of the last one can't be played: the tune's moment stays
  const gap = fingers === 1 ? 0.09 : fingers === 2 ? 0.06 : 0;
  if (gap) {
    const kept = [];
    steps.forEach(s => {
      const p = kept[kept.length - 1];
      if (!p || s.t - p.t >= gap) kept.push(s);
      else { stats.merged++; const lost = s.pr < p.pr ? p : s; lost.items.forEach(it => { if (fate && fate.get(it.n) === 'kept') mark(it.n, 'too-close'); }); if (s.pr < p.pr) kept[kept.length - 1] = s; }
    });
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
  return { notes: out, bpm, t0, fates: fate ? notesIn.map(n => fate.get(n) || 'out-of-range') : undefined, roles: opts.roles ? notes.map((n, i) => ({ t: n.t, midi: n.midi, role: role[i] })) : undefined,
    info: Object.assign({ shift, autoShift: sh.shift, octave, fit: sh.fit, keyName: `${NAMES[tonicMajor]} 大調／${NAMES[tonicMinor]} 小調`, steps: steps.length }, stats) };
}
