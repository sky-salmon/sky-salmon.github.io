/* Streaming reader for .apks / .xapk / .apk / plain zip archives held in a Blob (or File).
 *
 * The outer archive is read through its central directory (a Blob can be sliced). Each nested .apk is streamed:
 * blob.slice() in 4 MB chunks -> DecompressionStream('deflate-raw') when deflated -> the inner zip's local file headers
 * are parsed one after another, so an inner APK (split_initial.apk is 1.5 GB) is never held in memory. Only the
 * entries the caller wants are collected. Handles stored and deflated entries, zip64 sizes, data descriptors (bit 3,
 * including entries whose size is only given after the data) and .pack (TAR) members, like
 * sky_glb_extract.stage_source.
 *
 *   for await (const f of iterateArchive(file, { want: path => path.endsWith('.ktx'), onProgress })) f.path, f.bytes
 *
 * `path` is the path under Data/ (assets/Data/Images/Bin/ETC2/X.ktx -> Images/Bin/ETC2/X.ktx; paths without a Data
 * segment are kept whole), exactly sky_glb_extract._rel_under_data. Files are yielded in archive order; a path can
 * occur more than once (split APKs overlap), and as in the Python staging the later one should win.
 * Plain ES module, no dependencies; browser Worker and Node 18+. */

const SIG_LOCAL = 0x04034b50, SIG_CENTRAL = 0x02014b50, SIG_EOCD = 0x06054b50, SIG_EOCD64 = 0x06064b50,
  SIG_EOCD64_LOC = 0x07064b50, SIG_DESCRIPTOR = 0x08074b50;
const EMPTY = new Uint8Array(0);
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const u64 = (b, o) => u32(b, o) + u32(b, o + 4) * 2 ** 32;

const CP437 = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
function decodeName(bytes, flags) {
  if (flags & 0x800) return new TextDecoder().decode(bytes);
  let s = '';
  for (const c of bytes) s += c < 0x80 ? String.fromCharCode(c) : CP437[c - 0x80];
  return s;
}

/** sky_glb_extract._rel_under_data */
export function relUnderData(name) {
  let parts = name.replace(/\\/g, '/').split('/');
  const i = parts.indexOf('Data');
  if (i >= 0) parts = parts.slice(i + 1);
  return parts.filter(p => p !== '' && p !== '.' && p !== '..').join('/');
}
const dirname = p => { const i = p.lastIndexOf('/'); return i < 0 ? '' : p.slice(0, i); };
const basename = p => p.slice(p.lastIndexOf('/') + 1);

/** Sequential byte reader over a ReadableStream of Uint8Array chunks. */
export class ByteSource {
  constructor(readable) { this.reader = readable.getReader(); this.buf = EMPTY; this.pos = 0; this.eof = false; }
  get avail() { return this.buf.length - this.pos; }
  async more() {
    if (this.eof) return false;
    for (;;) {
      const { value, done } = await this.reader.read();
      if (done) { this.eof = true; return false; }
      if (!value.length) continue;
      const v = value instanceof Uint8Array ? value : new Uint8Array(value.buffer || value);
      const left = this.avail;
      if (!left) { this.buf = v; this.pos = 0; }
      else { const n = new Uint8Array(left + v.length); n.set(this.buf.subarray(this.pos)); n.set(v, left); this.buf = n; this.pos = 0; }
      return true;
    }
  }
  async ensure(n) { while (this.avail < n) if (!await this.more()) return false; return true; }
  async read(n) {
    if (!await this.ensure(n)) throw new Error('zip: unexpected end of data');
    const out = this.buf.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  /** Yields the next n bytes as views into the stream's chunks (no copy). */
  async *chunks(n) {
    while (n > 0) {
      if (!this.avail && !await this.more()) throw new Error('zip: unexpected end of data');
      const k = Math.min(n, this.avail);
      const c = this.buf.subarray(this.pos, this.pos + k);
      this.pos += k; n -= k;
      yield c;
    }
  }
  async skip(n) { for await (const _ of this.chunks(n)); } // eslint-disable-line no-unused-vars
  async drain() { this.buf = EMPTY; this.pos = 0; while (await this.more()) { this.buf = EMPTY; this.pos = 0; } }
  async cancel() { try { await this.reader.cancel(); } catch { /* already closed */ } this.eof = true; }
}

/** blob as a stream of `size`-byte chunks read with blob.slice(); large chunks make DecompressionStream much faster
 *  (Node: 200 -> 340 MB/s) than the 64 KB chunks of blob.stream(). Reads one chunk ahead. */
export function blobChunks(blob, size = 4 << 20, onChunk = null) {
  let off = 0;
  return new ReadableStream({
    async pull(ctl) {
      if (off >= blob.size) { ctl.close(); return; }
      const b = new Uint8Array(await blob.slice(off, off + size).arrayBuffer());
      off += b.length;
      if (onChunk) onChunk(b.length);
      ctl.enqueue(b);
    },
  }, { highWaterMark: 1 });
}

function streamOf(iterable) {
  const it = iterable[Symbol.asyncIterator]();
  return new ReadableStream({
    async pull(ctrl) { const { value, done } = await it.next(); if (done) ctrl.close(); else ctrl.enqueue(value); },
    async cancel() { if (it.return) await it.return(); },
  }, { highWaterMark: 0 });
}

async function collect(readable, size) {
  const reader = readable.getReader();
  let out = new Uint8Array(size || 0), o = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (o + value.length > out.length) { const n = new Uint8Array(Math.max(out.length * 2, o + value.length)); n.set(out.subarray(0, o)); out = n; }
    out.set(value, o); o += value.length;
  }
  return o === out.length ? out : out.slice(0, o);
}

function checkMethod(method, name) {
  if (method !== 8) throw new Error(`zip: ${name}: compression method ${method} is not supported`);
}

/** readable.pipeThrough(new DecompressionStream('deflate-raw')) with bounded read-ahead: at most `limit` bytes are fed
 *  beyond what the consumer has taken out. (Node's DecompressionStream buffers its whole output when the reader is
 *  slower than zlib, which for a 1.5 GB inner APK means hundreds of MB.) */
export function inflateStream(readable, limit = 8 << 20) {
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter(), input = readable.getReader(), output = ds.readable.getReader();
  let fed = 0, taken = 0, wake = null, stop = false;
  (async () => {
    try {
      for (;;) {
        const { value, done } = await input.read();
        if (done || stop) break;
        while (fed - taken > limit && !stop) await new Promise(r => { wake = r; });
        if (stop) break;
        await writer.ready;
        fed += value.length;
        writer.write(value).catch(() => {});
      }
      if (!stop) await writer.close();
    } catch (e) { writer.abort(e).catch(() => {}); }
  })();
  const release = () => { if (wake) { const w = wake; wake = null; w(); } };
  return new ReadableStream({
    async pull(ctl) {
      const { value, done } = await output.read();
      if (done) { ctl.close(); return; }
      taken += value.length; release();
      ctl.enqueue(value);
    },
    async cancel(reason) {
      stop = true; release();
      await Promise.allSettled([input.cancel(reason), output.cancel(reason)]);
    },
  }, { highWaterMark: 0 });
}

function decompress(readable, method, name) { checkMethod(method, name); return inflateStream(readable); }

// ───────────────────── raw inflate (only for deflated entries whose size comes after the data) ─────────────────────

const LBASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEXT = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DBASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073,
  4097, 6145, 8193, 12289, 16385, 24577];
const DEXT = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CLORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

function huffman(lengths) {
  const count = new Uint16Array(16), symbol = new Uint16Array(lengths.length), offs = new Uint16Array(16);
  for (const l of lengths) count[l]++;
  count[0] = 0;
  for (let i = 1; i < 16; i++) offs[i] = offs[i - 1] + count[i - 1];
  for (let s = 0; s < lengths.length; s++) if (lengths[s]) symbol[offs[lengths[s]]++] = s;
  return { count, symbol };
}
let FIXED = null;

/** Inflate a raw deflate stream that starts at src's position, stopping exactly at its end (puff.c algorithm). */
export async function inflateRawFrom(src) {
  let out = new Uint8Array(1 << 16), o = 0;
  const grow = n => { if (o + n > out.length) { const b = new Uint8Array(Math.max(out.length * 2, o + n)); b.set(out.subarray(0, o)); out = b; } };
  let bitbuf = 0, bitcnt = 0;
  const bits = n => {
    while (bitcnt < n) {
      if (src.pos >= src.buf.length) throw new Error('inflate: unexpected end of data');
      bitbuf |= src.buf[src.pos++] << bitcnt; bitcnt += 8;
    }
    const v = bitbuf & ((1 << n) - 1);
    bitbuf >>>= n; bitcnt -= n;
    return v;
  };
  const decode = h => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const c = h.count[len];
      if (code - c < first) return h.symbol[index + (code - first)];
      index += c; first = (first + c) << 1; code <<= 1;
    }
    throw new Error('inflate: bad code');
  };
  const refill = async () => { if (src.avail < 16 && !src.eof) await src.ensure(16); };
  let last;
  do {
    await refill();
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      bitbuf = 0; bitcnt = 0;
      const h = await src.read(4);
      const len = u16(h, 0);
      if ((len ^ 0xffff) !== u16(h, 2)) throw new Error('inflate: stored block length mismatch');
      grow(len);
      for await (const c of src.chunks(len)) { out.set(c, o); o += c.length; }
      continue;
    }
    let lit, dist;
    if (type === 1) {
      if (!FIXED) {
        const l = new Uint8Array(288).fill(8, 0, 144).fill(9, 144, 256).fill(7, 256, 280).fill(8, 280, 288);
        FIXED = [huffman(l), huffman(new Uint8Array(30).fill(5))];
      }
      [lit, dist] = FIXED;
    } else if (type === 2) {
      const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      const cl = new Uint8Array(19);
      for (let i = 0; i < ncode; i++) { await refill(); cl[CLORDER[i]] = bits(3); }
      const ch = huffman(cl);
      const lengths = new Uint8Array(nlen + ndist);
      for (let i = 0; i < nlen + ndist;) {
        await refill();
        const sym = decode(ch);
        if (sym < 16) { lengths[i++] = sym; continue; }
        let rep, val = 0;
        if (sym === 16) { if (!i) throw new Error('inflate: repeat with no first length'); val = lengths[i - 1]; rep = 3 + bits(2); }
        else if (sym === 17) rep = 3 + bits(3);
        else rep = 11 + bits(7);
        if (i + rep > nlen + ndist) throw new Error('inflate: too many lengths');
        while (rep--) lengths[i++] = val;
      }
      lit = huffman(lengths.subarray(0, nlen)); dist = huffman(lengths.subarray(nlen));
    } else throw new Error('inflate: invalid block type');
    for (;;) {
      await refill();
      const sym = decode(lit);
      if (sym < 256) { grow(1); out[o++] = sym; continue; }
      if (sym === 256) break;
      const li = sym - 257;
      if (li >= 29) throw new Error('inflate: bad length symbol');
      const len = LBASE[li] + bits(LEXT[li]);
      const ds = decode(dist);
      if (ds >= 30) throw new Error('inflate: bad distance symbol');
      const d = DBASE[ds] + bits(DEXT[ds]);
      if (d > o) throw new Error('inflate: distance too far back');
      grow(len);
      for (let k = 0; k < len; k++, o++) out[o] = out[o - d];
    }
  } while (!last);
  return out.slice(0, o);
}

/** Data of a stored entry whose size is only in the data descriptor: scan for the descriptor signature whose
 *  compressed-size field equals the bytes read so far. */
async function storedUntilDescriptor(src) {
  let out = new Uint8Array(1 << 16), o = 0, scan = 0;
  for (;;) {
    if (!src.avail && !await src.more()) throw new Error('zip: data descriptor not found');
    const c = src.buf.subarray(src.pos);
    if (o + c.length > out.length) { const b = new Uint8Array(Math.max(out.length * 2, o + c.length)); b.set(out.subarray(0, o)); out = b; }
    out.set(c, o); o += c.length; src.pos = src.buf.length;
    for (; scan + 16 <= o; scan++) {
      if (u32(out, scan) === SIG_DESCRIPTOR && u32(out, scan + 8) === scan) {
        const rest = new Uint8Array(o - scan);
        rest.set(out.subarray(scan, o));
        src.buf = rest; src.pos = 0;
        return out.slice(0, scan);
      }
    }
  }
}

// ───────────────────────── TAR (.pack) ─────────────────────────

const tarStr = (b, o, n) => { let s = ''; for (let i = o; i < o + n && b[i]; i++) s += String.fromCharCode(b[i]); return s; };
const tarNum = (b, o, n) => {
  if (b[o] & 0x80) { let v = 0; for (let i = o + 1; i < o + n; i++) v = v * 256 + b[i]; return v; }
  return parseInt(tarStr(b, o, n).trim() || '0', 8);
};

/** Members of a TAR (optionally gzip) archive: [{name, bytes}] for regular files. */
export async function tarMembers(bytes) {
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await collect(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));
  const out = [];
  let p = 0, longName = null, paxPath = null;
  while (p + 512 <= bytes.length) {
    const h = bytes.subarray(p, p + 512);
    if (h.every(v => v === 0)) break;
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : h[i];
    if (sum !== tarNum(h, 148, 8)) throw new Error('tar: bad header checksum');
    const size = tarNum(h, 124, 12), type = String.fromCharCode(h[156] || 48);
    const data = bytes.subarray(p + 512, p + 512 + size);
    p += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = tarStr(data, 0, data.length); continue; }
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(new TextDecoder().decode(data));
      if (m) paxPath = m[1];
      continue;
    }
    let name = tarStr(h, 0, 100);
    if (tarStr(h, 257, 6) === 'ustar' && h[345]) name = tarStr(h, 345, 155) + '/' + name;
    name = paxPath || longName || name;
    longName = paxPath = null;
    if (type === '0' || type === '7') out.push({ name, bytes: data });
  }
  return out;
}

// ───────────────────────── zip walking ─────────────────────────

function parseExtra64(extra, fields) { // fields: which of usize, csize, offset are 0xFFFFFFFF, in that order
  for (let p = 0; p + 4 <= extra.length;) {
    const id = u16(extra, p), len = u16(extra, p + 2);
    if (id === 1) {
      let q = p + 4;
      const r = {};
      for (const f of fields) { if (q + 8 <= p + 4 + len) { r[f] = u64(extra, q); q += 8; } }
      return r;
    }
    p += 4 + len;
  }
  return null;
}

async function readCentralDirectory(blob) {
  const size = blob.size;
  if (size < 22) return null;
  const tailLen = Math.min(size, 65557 + 20);
  const tail = new Uint8Array(await blob.slice(size - tailLen).arrayBuffer());
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (u32(tail, i) === SIG_EOCD) { e = i; break; }
  if (e < 0) return null;
  let count = u16(tail, e + 10), cdSize = u32(tail, e + 12), cdOff = u32(tail, e + 16);
  if (e >= 20 && u32(tail, e - 20) === SIG_EOCD64_LOC) {
    const off64 = u64(tail, e - 12);
    const z = new Uint8Array(await blob.slice(off64, off64 + 56).arrayBuffer());
    if (u32(z, 0) === SIG_EOCD64) { count = u64(z, 32); cdSize = u64(z, 40); cdOff = u64(z, 48); }
  }
  // Data before the archive (self-extractor): Python's zipfile corrects offsets by the difference.
  const eocdPos = size - tailLen + e;
  const concat = eocdPos - (cdOff + cdSize) - (e >= 20 && u32(tail, e - 20) === SIG_EOCD64_LOC ? 76 : 0);
  const cd = new Uint8Array(await blob.slice(cdOff + Math.max(concat, 0), cdOff + Math.max(concat, 0) + cdSize).arrayBuffer());
  const entries = [];
  for (let p = 0; p < cd.length && entries.length < count;) {
    if (u32(cd, p) !== SIG_CENTRAL) throw new Error('zip: bad central directory');
    const flags = u16(cd, p + 8), method = u16(cd, p + 10);
    let csize = u32(cd, p + 20), usize = u32(cd, p + 24), offset = u32(cd, p + 42);
    const nlen = u16(cd, p + 28), xlen = u16(cd, p + 30), clen = u16(cd, p + 32);
    const name = decodeName(cd.subarray(p + 46, p + 46 + nlen), flags);
    const want = [];
    if (usize === 0xFFFFFFFF) want.push('usize');
    if (csize === 0xFFFFFFFF) want.push('csize');
    if (offset === 0xFFFFFFFF) want.push('offset');
    if (want.length) {
      const z = parseExtra64(cd.subarray(p + 46 + nlen, p + 46 + nlen + xlen), want) || {};
      if (z.usize != null) usize = z.usize;
      if (z.csize != null) csize = z.csize;
      if (z.offset != null) offset = z.offset;
    }
    entries.push({ name, flags, method, csize, usize, offset: offset + Math.max(concat, 0) });
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}

/**
 * iterateArchive(blob, opts) -> async iterator of {path, name, container, bytes}
 *   opts.want(path, name)  which files to return (path = under Data/); default: none
 *   opts.isNested(name)    which entries are nested archives to walk into; default name.endsWith('.apk')
 *   opts.onProgress({read, total, container})  outer bytes consumed so far
 *   opts.packs             expand wanted .pack (TAR) files into their members (default true)
 */
export async function* iterateArchive(blob, opts = {}) {
  const want = opts.want || (() => false);
  const isNested = opts.isNested || (n => n.endsWith('.apk'));
  const total = blob.size;
  let base = 0, inEntry = 0;
  const report = container => { if (opts.onProgress) opts.onProgress({ read: Math.min(base + inEntry, total), total, container }); };
  const ctx = { want, isNested, packs: opts.packs !== false };

  const entries = await readCentralDirectory(blob);
  if (!entries) { // not a readable zip directory: stream it from the start
    const counted = blobChunks(blob, 4 << 20, n => { inEntry += n; report(''); });
    const src = new ByteSource(counted);
    yield* walkStream(src, '', ctx);
    await src.cancel();
    base = total; inEntry = 0; report('');
    return;
  }
  for (const e of entries) {
    base = e.offset; inEntry = 0;
    const lh = new Uint8Array(await blob.slice(e.offset, e.offset + 30).arrayBuffer());
    if (u32(lh, 0) !== SIG_LOCAL) throw new Error(`zip: bad local header for ${e.name}`);
    const start = e.offset + 30 + u16(lh, 26) + u16(lh, 28);
    const raw = blob.slice(start, start + e.csize);
    if (isNested(e.name)) {
      let st = blobChunks(raw, 4 << 20, n => { inEntry += n; report(e.name); });
      if (e.method !== 0) st = decompress(st, e.method, e.name);
      const src = new ByteSource(st);
      yield* walkStream(src, e.name, ctx);
      await src.cancel(); // the inner central directory and signing block follow the last local entry
    } else if (!e.name.endsWith('/')) {
      const path = relUnderData(e.name);
      if (want(path, e.name)) {
        const bytes = e.method === 0 ? new Uint8Array(await raw.arrayBuffer()) : await collect(decompress(blobChunks(raw), e.method, e.name), e.usize);
        yield* emit(ctx, path, e.name, '', bytes);
      }
    }
    inEntry = e.csize; report(e.name);
  }
}

async function* emit(ctx, path, name, container, bytes) {
  if (ctx.packs && path.endsWith('.pack')) { yield* emitPack(ctx, bytes, dirname(path), container + '/' + name); return; }
  yield { path, name, container, bytes };
}

async function* emitPack(ctx, bytes, prefix, container) {
  let members;
  try { members = await tarMembers(bytes); } catch { return; } // "skip pack: not a TAR"
  for (const m of members) {
    const rel = relUnderData(prefix ? prefix + '/' + m.name : m.name);
    const b = basename(m.name);
    if (b.endsWith('.pack')) { yield* emitPack(ctx, m.bytes, dirname(rel), container + '/' + m.name); continue; }
    if (ctx.want(rel, m.name)) yield { path: rel, name: m.name, container, bytes: m.bytes };
  }
}

/** Walk a zip from a sequential stream of its bytes (local headers only). */
async function* walkStream(src, container, ctx) {
  for (;;) {
    if (!await src.ensure(4) || u32(src.buf, src.pos) !== SIG_LOCAL) return; // central directory / signing block / end
    const h = await src.read(30);
    const flags = u16(h, 6), method = u16(h, 8);
    let csize = u32(h, 18), usize = u32(h, 22);
    const nlen = u16(h, 26), xlen = u16(h, 28);
    const name = decodeName((await src.read(nlen)).slice(), flags);
    const extra = (await src.read(xlen)).slice();
    let zip64 = false;
    if (csize === 0xFFFFFFFF || usize === 0xFFFFFFFF) {
      const z = parseExtra64(extra, ['usize', 'csize']);
      if (z) { zip64 = true; if (z.usize != null) usize = z.usize; if (z.csize != null) csize = z.csize; }
    }
    const unknown = (flags & 8) && csize === 0 && !(method === 0 && usize > 0);
    const nested = ctx.isNested(name);
    const path = relUnderData(name);
    const wanted = !nested && !name.endsWith('/') && ctx.want(path, name);
    if (unknown) {
      const bytes = method === 0 ? await storedUntilDescriptor(src) : method === 8 ? await inflateRawFrom(src) : null;
      if (!bytes) throw new Error(`zip: ${name}: compression method ${method} with data descriptor is not supported`);
      await skipDescriptor(src, zip64);
      if (nested) yield* iterateArchive(new Blob([bytes]), { want: ctx.want, isNested: ctx.isNested, packs: ctx.packs });
      else if (wanted) yield* emit(ctx, path, name, container, bytes);
      continue;
    }
    if (method === 0 && (flags & 8) && csize === 0) csize = usize;
    if (nested) {
      let st = streamOf(src.chunks(csize));
      if (method !== 0) st = decompress(st, method, name);
      const inner = new ByteSource(st);
      yield* walkStream(inner, container + '/' + name, ctx);
      await inner.drain();
    } else if (wanted) {
      let bytes;
      if (method === 0) {
        bytes = new Uint8Array(csize);
        let o = 0;
        for await (const c of src.chunks(csize)) { bytes.set(c, o); o += c.length; }
      } else {
        bytes = await collect(decompress(streamOf(src.chunks(csize)), method, name), usize);
      }
      yield* emit(ctx, path, name, container, bytes);
    } else {
      await src.skip(csize);
    }
    if (flags & 8) await skipDescriptor(src, zip64);
  }
}

async function skipDescriptor(src, zip64) {
  const n = zip64 ? 16 : 8;
  if (!await src.ensure(4)) return;
  if (u32(src.buf, src.pos) === SIG_DESCRIPTOR) await src.read(4);
  await src.read(4 + n); // crc32 + sizes
}
