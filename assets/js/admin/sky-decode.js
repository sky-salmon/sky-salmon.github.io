/* Sky game-file decoders: LZ4 block, KTX1 (ETC1 / ETC2 / EAC), .mesh, and the GLB writer.
 *
 * Port of the Python pipeline in sky-fish-mod (tools/sky_glb_extract.py, tools/sky_icon_extract.py and the sky_mesh
 * decoder). Outputs match the Python ones exactly: decodeKTX gives the same pixels as texture2ddecoder (including its
 * quirks, e.g. punch-through transparent pixels keep their colour), parseMesh the same numbers as parse_mesh_any, and
 * buildGLB the same bytes as build_glb when given the same PNG bytes.
 * Plain ES module (imports only ./png.js); runs in a browser (window or Worker) and in Node 18+. */

import { decodePNG } from './png.js';

// ───────────────────────── LZ4 block ─────────────────────────

/** LZ4 block decompress (python-lz4 lz4.block.decompress(src, uncompressed_size=size)): throws on malformed input
 *  or when the output is not exactly `size` bytes. */
export function lz4BlockDecompress(src, size) {
  const out = new Uint8Array(size);
  const n = src.length;
  let ip = 0, op = 0;
  while (ip < n) {
    const token = src[ip++];
    let lit = token >>> 4;
    if (lit === 15) {
      let b;
      do { if (ip >= n) throw new Error('lz4: truncated literal length'); b = src[ip++]; lit += b; } while (b === 255);
    }
    if (ip + lit > n) throw new Error('lz4: literals past end of input');
    if (op + lit > size) throw new Error('lz4: output overrun');
    out.set(src.subarray(ip, ip + lit), op);
    ip += lit; op += lit;
    if (ip >= n) break; // last sequence: literals only
    if (ip + 2 > n) throw new Error('lz4: truncated offset');
    const off = src[ip] | (src[ip + 1] << 8);
    ip += 2;
    if (off === 0 || off > op) throw new Error('lz4: bad offset');
    let len = token & 15;
    if (len === 15) {
      let b;
      do { if (ip >= n) throw new Error('lz4: truncated match length'); b = src[ip++]; len += b; } while (b === 255);
    }
    len += 4;
    if (op + len > size) throw new Error('lz4: output overrun');
    let m = op - off;
    if (off >= len) { out.copyWithin(op, m, m + len); op += len; }
    else { for (const end = op + len; op < end;) out[op++] = out[m++]; }
  }
  if (op !== size) throw new Error(`lz4: decompressor wrote ${op} bytes, but ${size} bytes expected`);
  return out;
}

// ───────────────────────── KTX1 / ETC ─────────────────────────

export const GL = {
  ETC1_RGB8: 0x8D64, R11_EAC: 0x9270, SIGNED_R11_EAC: 0x9271,
  RGB8_ETC2: 0x9274, SRGB8_ETC2: 0x9275, RGB8_A1_ETC2: 0x9276, SRGB8_A1_ETC2: 0x9277,
  RGBA8_ETC2_EAC: 0x9278, SRGB8_ALPHA8_ETC2_EAC: 0x9279,
};
const KTX1_MAGIC = [0xAB, 0x4B, 0x54, 0x58, 0x20, 0x31, 0x31, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A];

/** Header fields Python reads: glInternalFormat (28), pixelWidth (36), pixelHeight (40), bytesOfKeyValueData (60). */
export function ktxHeader(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { format: dv.getUint32(28, true), width: dv.getUint32(36, true), height: dv.getUint32(40, true),
    kvBytes: dv.getUint32(60, true) };
}

/** Decode mip 0 of a KTX1 file to RGBA8 (top row first, as stored: no flip).
 *  mode 'icon'   = sky_icon_extract.decode_ktx_any: EAC R11 (0x9270/0x9271) becomes white with R11 as alpha.
 *  mode 'texture' = sky_mesh decode_ktx_texture: EAC R11 is unsupported (throws), like the Python GLB textures.
 *  Throws for formats Python does not decode (e.g. uncompressed RGBA8 0x8058). */
export function decodeKTX(bytes, mode = 'texture') {
  const h = ktxHeader(bytes);
  const { format, width, height } = h;
  const off = 64 + h.kvBytes;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const size = dv.getUint32(off, true);
  const data = bytes.subarray(off + 4, off + 4 + size);
  if (format === GL.R11_EAC || format === GL.SIGNED_R11_EAC) {
    if (mode !== 'icon') throw new Error(`Unsupported GL internal format 0x${format.toString(16).toUpperCase()}`);
    const rgba = decodeBlocks(data, width, height, 8, eacR11Block); // R = R11, G = B = 0, A = 255
    for (let i = 0; i < rgba.length; i += 4) { rgba[i + 3] = rgba[i]; rgba[i] = rgba[i + 1] = rgba[i + 2] = 255; }
    return { width, height, rgba, format };
  }
  for (let i = 0; i < 12; i++) if (bytes[i] !== KTX1_MAGIC[i]) throw new Error('Not a KTX1 file');
  if (dv.getUint32(12, true) !== 0x04030201) throw new Error('Big-endian KTX files are not supported');
  let rgba;
  switch (format) {
    case GL.RGB8_ETC2: case GL.SRGB8_ETC2: rgba = decodeBlocks(data, width, height, 8, etc2Block); break;
    case GL.RGBA8_ETC2_EAC: case GL.SRGB8_ALPHA8_ETC2_EAC: rgba = decodeBlocks(data, width, height, 16, etc2a8Block); break;
    case GL.RGB8_A1_ETC2: case GL.SRGB8_A1_ETC2: rgba = decodeBlocks(data, width, height, 8, etc2a1Block); break;
    case GL.ETC1_RGB8: rgba = decodeBlocks(data, width, height, 8, etc1Block); break;
    default: throw new Error(`Unsupported GL internal format 0x${format.toString(16).toUpperCase()}`);
  }
  return { width, height, rgba, format };
}

// Block decoders follow texture2ddecoder 1.0.6 (Texture2DDecoder/etc.cpp), so the pixels match bit for bit.
// A block is written into BUF (16 pixels, row-major, packed r | g<<8 | b<<16 | a<<24 = RGBA bytes on little-endian).
const WRITE_ORDER = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
const WRITE_ORDER_REV = [15, 11, 7, 3, 14, 10, 6, 2, 13, 9, 5, 1, 12, 8, 4, 0];
const ETC1_MOD = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]];
const ETC2A_MOD = [ETC1_MOD.map(([, b]) => [0, b]), ETC1_MOD];
const ETC1_SUB = [[0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1], [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1]];
const ETC2_DIST = [3, 6, 11, 16, 23, 32, 41, 64];
const ALPHA_MOD = [
  [-3, -6, -9, -15, 2, 5, 8, 14], [-3, -7, -10, -13, 2, 6, 9, 12], [-2, -5, -8, -13, 1, 4, 7, 12],
  [-2, -4, -6, -13, 1, 3, 5, 12], [-3, -6, -8, -12, 2, 5, 7, 11], [-3, -7, -9, -11, 2, 6, 8, 10],
  [-4, -7, -8, -11, 3, 6, 7, 10], [-3, -5, -8, -11, 2, 4, 7, 10], [-2, -6, -8, -10, 1, 5, 7, 9],
  [-2, -5, -8, -10, 1, 4, 7, 9], [-2, -4, -8, -10, 1, 3, 7, 9], [-2, -5, -7, -10, 1, 4, 6, 9],
  [-3, -4, -7, -10, 2, 3, 6, 9], [-1, -2, -3, -10, 0, 1, 2, 9], [-4, -6, -8, -9, 3, 5, 7, 8],
  [-3, -5, -7, -9, 2, 4, 6, 8]];
const TRANSPARENT_MASK = 0x00ffffff;
const BUF = new Uint32Array(16);
const BUF8 = new Uint8Array(BUF.buffer);

const clamp = n => n < 0 ? 0 : n > 255 ? 255 : n;
const rgb = (r, g, b, a = 255) => (r | g << 8 | b << 16 | a << 24) >>> 0;
const applyColor = (c, m) => rgb(clamp(c[0] + m), clamp(c[1] + m), clamp(c[2] + m));
const rawColor = c => rgb(c[0], c[1], c[2]);
const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];

function decodeBlocks(data, w, h, blockBytes, blockFn) {
  const rgba = new Uint8Array(w * h * 4);
  const out32 = new Uint32Array(rgba.buffer);
  const bxN = (w + 3) >> 2, byN = (h + 3) >> 2;
  const need = bxN * byN * blockBytes;
  if (data.length < need) throw new Error(`texture data too short: ${data.length} < ${need}`);
  let p = 0;
  for (let by = 0; by < byN; by++) {
    for (let bx = 0; bx < bxN; bx++, p += blockBytes) {
      blockFn(data, p);
      const x0 = bx * 4, xl = Math.min(4, w - x0);
      for (let y = by * 4, r = 0; r < 4 && y < h; r++, y++) {
        const o = y * w + x0;
        for (let x = 0; x < xl; x++) out32[o + x] = BUF[r * 4 + x];
      }
    }
  }
  return rgba;
}

function etc1Block(d, p) {
  const d0 = d[p], d1 = d[p + 1], d2 = d[p + 2], d3 = d[p + 3];
  const code = [d3 >> 5, d3 >> 2 & 7];
  const table = ETC1_SUB[d3 & 1];
  const c = C;
  if (d3 & 2) {
    c[0][0] = d0 & 0xf8; c[0][1] = d1 & 0xf8; c[0][2] = d2 & 0xf8;
    c[1][0] = (c[0][0] + (d0 << 3 & 0x18) - (d0 << 3 & 0x20)) & 0xff;
    c[1][1] = (c[0][1] + (d1 << 3 & 0x18) - (d1 << 3 & 0x20)) & 0xff;
    c[1][2] = (c[0][2] + (d2 << 3 & 0x18) - (d2 << 3 & 0x20)) & 0xff;
    for (let s = 0; s < 2; s++) for (let i = 0; i < 3; i++) c[s][i] |= c[s][i] >> 5;
  } else {
    c[0][0] = (d0 & 0xf0) | d0 >> 4; c[1][0] = ((d0 & 0x0f) | d0 << 4) & 0xff;
    c[0][1] = (d1 & 0xf0) | d1 >> 4; c[1][1] = ((d1 & 0x0f) | d1 << 4) & 0xff;
    c[0][2] = (d2 & 0xf0) | d2 >> 4; c[1][2] = ((d2 & 0x0f) | d2 << 4) & 0xff;
  }
  subblocks(d, p, c, code, table);
}

function subblocks(d, p, c, code, table) {
  let j = d[p + 6] << 8 | d[p + 7], k = d[p + 4] << 8 | d[p + 5];
  for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) {
    const s = table[i];
    const m = ETC1_MOD[code[s]][j & 1];
    BUF[WRITE_ORDER[i]] = applyColor(c[s], k & 1 ? -m : m);
  }
}

// Shared by ETC2 RGB and punch-through: T, H, planar and differential modes. Returns the mode, or 0 if not handled.
function etc2Modes(d, p, punch) {
  const d0 = d[p], d1 = d[p + 1], d2 = d[p + 2], d3 = d[p + 3], d4 = d[p + 4], d5 = d[p + 5], d6 = d[p + 6], d7 = d[p + 7];
  let j = d6 << 8 | d7, k = d4 << 8 | d5;
  const c = C;
  const r = d0 & 0xf8, dr = (d0 << 3 & 0x18) - (d0 << 3 & 0x20);
  const g = d1 & 0xf8, dg = (d1 << 3 & 0x18) - (d1 << 3 & 0x20);
  const b = d2 & 0xf8, db = (d2 << 3 & 0x18) - (d2 << 3 & 0x20);
  const obaq = d3 >> 1 & 1;
  if (r + dr < 0 || r + dr > 255) { // T
    c[0][0] = (d0 << 3 & 0xc0) | (d0 << 4 & 0x30) | (d0 >> 1 & 0xc) | (d0 & 3);
    c[0][1] = (d1 & 0xf0) | d1 >> 4;
    c[0][2] = ((d1 & 0x0f) | d1 << 4) & 0xff;
    c[1][0] = (d2 & 0xf0) | d2 >> 4;
    c[1][1] = ((d2 & 0x0f) | d2 << 4) & 0xff;
    c[1][2] = (d3 & 0xf0) | d3 >> 4;
    const dd = ETC2_DIST[(d3 >> 1 & 6) | (d3 & 1)];
    const set = [rawColor(c[0]), applyColor(c[1], dd), rawColor(c[1]), applyColor(c[1], -dd)];
    k <<= 1;
    for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) {
      const idx = (k & 2) | (j & 1);
      let v = set[idx];
      if (punch && !obaq && idx === 2) v = (v & TRANSPARENT_MASK) >>> 0;
      BUF[WRITE_ORDER[i]] = v;
    }
  } else if (g + dg < 0 || g + dg > 255) { // H
    c[0][0] = (d0 << 1 & 0xf0) | (d0 >> 3 & 0xf);
    c[0][1] = (d0 << 5 & 0xe0) | (d1 & 0x10); c[0][1] |= c[0][1] >> 4;
    c[0][2] = (d1 & 8) | (d1 << 1 & 6) | d2 >> 7; c[0][2] = (c[0][2] | c[0][2] << 4) & 0xff;
    c[1][0] = (d2 << 1 & 0xf0) | (d2 >> 3 & 0xf);
    c[1][1] = (d2 << 5 & 0xe0) | (d3 >> 3 & 0x10); c[1][1] |= c[1][1] >> 4;
    c[1][2] = (d3 << 1 & 0xf0) | (d3 >> 3 & 0xf);
    let dd = (d3 & 4) | (d3 << 1 & 2);
    if (c[0][0] > c[1][0] || (c[0][0] === c[1][0] && (c[0][1] > c[1][1] || (c[0][1] === c[1][1] && c[0][2] >= c[1][2])))) ++dd;
    dd = ETC2_DIST[dd];
    const set = [applyColor(c[0], dd), applyColor(c[0], -dd), applyColor(c[1], dd), applyColor(c[1], -dd)];
    k <<= 1;
    for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) {
      const idx = (k & 2) | (j & 1);
      let v = set[idx];
      if (punch && !obaq && idx === 2) v = (v & TRANSPARENT_MASK) >>> 0;
      BUF[WRITE_ORDER[i]] = v;
    }
  } else if (b + db < 0 || b + db > 255) { // planar
    c[0][0] = (d0 << 1 & 0xfc) | (d0 >> 5 & 3);
    c[0][1] = (d0 << 7 & 0x80) | (d1 & 0x7e) | (d0 & 1);
    c[0][2] = (d1 << 7 & 0x80) | (d2 << 2 & 0x60) | (d2 << 3 & 0x18) | (d3 >> 5 & 4); c[0][2] |= c[0][2] >> 6;
    c[1][0] = (d3 << 1 & 0xf8) | (d3 << 2 & 4) | (d3 >> 5 & 3);
    c[1][1] = (d4 & 0xfe) | d4 >> 7;
    c[1][2] = (d4 << 7 & 0x80) | (d5 >> 1 & 0x7c); c[1][2] |= c[1][2] >> 6;
    c[2][0] = (d5 << 5 & 0xe0) | (d6 >> 3 & 0x1c) | (d5 >> 1 & 3);
    c[2][1] = (d6 << 3 & 0xf8) | (d7 >> 5 & 0x6) | (d6 >> 4 & 1);
    c[2][2] = (d7 << 2 | (d7 >> 4 & 3)) & 0xff;
    for (let y = 0, i = 0; y < 4; y++) {
      for (let x = 0; x < 4; x++, i++) {
        const R = clamp((x * (c[1][0] - c[0][0]) + y * (c[2][0] - c[0][0]) + 4 * c[0][0] + 2) >> 2);
        const G = clamp((x * (c[1][1] - c[0][1]) + y * (c[2][1] - c[0][1]) + 4 * c[0][1] + 2) >> 2);
        const B = clamp((x * (c[1][2] - c[0][2]) + y * (c[2][2] - c[0][2]) + 4 * c[0][2] + 2) >> 2);
        BUF[i] = rgb(R, G, B);
      }
    }
  } else { // differential
    const code = [d3 >> 5, d3 >> 2 & 7];
    const table = ETC1_SUB[d3 & 1];
    c[0][0] = r | r >> 5; c[0][1] = g | g >> 5; c[0][2] = b | b >> 5;
    c[1][0] = r + dr; c[1][1] = g + dg; c[1][2] = b + db;
    c[1][0] |= c[1][0] >> 5; c[1][1] |= c[1][1] >> 5; c[1][2] |= c[1][2] >> 5;
    if (!punch) { subblocks(d, p, c, code, table); return; }
    for (let i = 0; i < 16; i++, j >>= 1, k >>= 1) {
      const s = table[i];
      const m = ETC2A_MOD[obaq][code[s]][j & 1];
      const mm = k & 1 ? -m : m;
      const transparent = !obaq && (k & 1) && !(j & 1);
      BUF[WRITE_ORDER[i]] = rgb(clamp(c[s][0] + mm), clamp(c[s][1] + mm), clamp(c[s][2] + mm), transparent ? 0 : 255);
    }
  }
}

function etc2Block(d, p) {
  const d0 = d[p], d1 = d[p + 1], d2 = d[p + 2], d3 = d[p + 3];
  if (d3 & 2) { etc2Modes(d, p, false); return; }
  const code = [d3 >> 5, d3 >> 2 & 7];
  const table = ETC1_SUB[d3 & 1];
  const c = C;
  c[0][0] = (d0 & 0xf0) | d0 >> 4; c[1][0] = ((d0 & 0x0f) | d0 << 4) & 0xff;
  c[0][1] = (d1 & 0xf0) | d1 >> 4; c[1][1] = ((d1 & 0x0f) | d1 << 4) & 0xff;
  c[0][2] = (d2 & 0xf0) | d2 >> 4; c[1][2] = ((d2 & 0x0f) | d2 << 4) & 0xff;
  subblocks(d, p, c, code, table);
}

function etc2a1Block(d, p) { etc2Modes(d, p, true); }

// 48 bits of 3-bit indices, big-endian, pixel 0 (a) in the top bits. Returns [hi16, lo32] for shifting.
function alphaBlock(d, p, base, mul, table, write) {
  // l = bton64(*(uint64_t*)data); l >>= 3 per pixel from i = 0 (pixel 15) — use two 32-bit halves.
  let hi = (d[p] << 24 | d[p + 1] << 16 | d[p + 2] << 8 | d[p + 3]) >>> 0;
  let lo = (d[p + 4] << 24 | d[p + 5] << 16 | d[p + 6] << 8 | d[p + 7]) >>> 0;
  for (let i = 0; i < 16; i++) {
    write(WRITE_ORDER_REV[i], table[lo & 7]);
    lo = ((lo >>> 3) | ((hi & 7) << 29)) >>> 0;
    hi = hi >>> 3;
  }
}

function etc2a8Block(d, p) {
  etc2Block(d, p + 8);
  const base = d[p], d1 = d[p + 1];
  if (d1 & 0xf0) {
    const mul = d1 >> 4;
    alphaBlock(d, p, base, mul, ALPHA_MOD[d1 & 0xf], (px, t) => { BUF8[px * 4 + 3] = clamp(base + mul * t); });
  } else {
    for (let i = 0; i < 16; i++) BUF8[i * 4 + 3] = base;
  }
}

function eacR11Block(d, p) {
  BUF.fill(rgb(0, 0, 0, 255));
  const base = d[p], d1 = d[p + 1];
  let mul = d1 >> 1 & 0x78;
  if (mul === 0) mul = 1;
  alphaBlock(d, p, base, mul, ALPHA_MOD[d1 & 0xf], (px, t) => {
    const v = base * 8 + mul * t + 4;
    BUF8[px * 4] = v < 0 ? 0 : v >= 2048 ? 0xff : v >> 3;
  });
}

/** PIL Image.crop((l, t, r, b)) on an RGBA buffer: areas outside the image are transparent black. */
export function cropRGBA(src, w, h, l, t, r, b) {
  if (r < l || b < t) throw new Error('crop: right/lower is less than left/upper');
  const cw = r - l, ch = b - t;
  const out = new Uint8Array(cw * ch * 4);
  const x0 = Math.max(l, 0), x1 = Math.min(r, w);
  if (x1 <= x0) return { width: cw, height: ch, rgba: out };
  for (let y = Math.max(t, 0); y < Math.min(b, h); y++) {
    out.set(src.subarray((y * w + x0) * 4, (y * w + x1) * 4), ((y - t) * cw + (x0 - l)) * 4);
  }
  return { width: cw, height: ch, rgba: out };
}

// ───────────────────────── .mesh ─────────────────────────

class Stream {
  constructor(bytes, pos = 0) {
    this.b = bytes; this.dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); this.pos = pos;
  }
  _adv(n) {
    const p = this.pos;
    if (p + n > this.b.length) throw new RangeError(`unpack requires ${n} bytes at 0x${p.toString(16)}`);
    this.pos = p + n; return p;
  }
  u32() { return this.dv.getUint32(this._adv(4), true); }
  i32() { return this.dv.getInt32(this._adv(4), true); }
  f32() { return this.dv.getFloat32(this._adv(4), true); }
  bool() { if (this.pos >= this.b.length) throw new RangeError('index out of range'); return this.b[this.pos++] !== 0; }
  vec3() { const p = this._adv(12); return [this.dv.getFloat32(p, true), this.dv.getFloat32(p + 4, true), this.dv.getFloat32(p + 8, true)]; }
  floats(n) { const p = this._adv(4 * n); const a = []; for (let i = 0; i < n; i++) a.push(this.dv.getFloat32(p + 4 * i, true)); return a; }
  /** read_bytes: returns the start offset of n bytes (EOFError if past end). */
  bytes(n) {
    const end = this.pos + n;
    if (end > this.b.length) throw new RangeError(`Read past end: wanted ${n} bytes at 0x${this.pos.toString(16)}, only ${this.b.length - this.pos} remaining`);
    const p = this.pos; this.pos = end; return p;
  }
  skip(n) { this.pos += n; }
  string(n) {
    const p = this.bytes(n);
    let s = '';
    for (let i = p; i < p + n && this.b[i] !== 0; i++) s += this.b[i] < 0x80 ? String.fromCharCode(this.b[i]) : '�';
    return s;
  }
}

const F16_TABLE = (() => {
  const t = new Float64Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 0x1f, f = h & 0x3ff;
    t[h] = e === 0 ? s * f * 2 ** -24 : e === 31 ? (f ? NaN : s * Infinity) : s * (1 + f / 1024) * 2 ** (e - 15);
  }
  return t;
})();

export const MESH_MIN_VERSION = 0x19, MESH_MAX_VERSION = 0x20;

/** Parse a .mesh file like sky_glb_extract.parse_mesh_any (0x19-0x1E through sky_mesh, 0x1F/0x20 with the marker
 *  list, the skinned box for compressed positions and float16 UVs). Every LOD is read (so truncated files fail as in
 *  Python), but only the LODs listed in opts.decode (default [0]) get vertex arrays.
 *  Returns {name, version, lods: [{vertexCount, indexCount, positions: Float64Array(3n), normals: Float64Array(3n)|null,
 *  uvs: Float64Array(2n)|null (u0, v0), indices: Uint32Array, ...}]}.
 *  Not ported: AnimPack parsing for versions <= 0x1E with hasAnimation (no such meshes in Sky 0.35; Python would also
 *  fail the mesh if that block were corrupt). */
export function parseMesh(bytes, opts = {}) {
  const decode = new Set(opts.decode || [0]);
  const s = new Stream(bytes);
  const version = s.u32();
  if (version < MESH_MIN_VERSION) throw new Error(`Mesh version 0x${hex2(version)} out of range (expected 0x19–0x1E)`);
  if (version > 0x20) throw new Error(`mesh version 0x${hex2(version)} is newer than 0x20; layout unverified`);
  const name = s.string(0x40);
  const lodCount = s.i32();
  const hasAnim = s.bool(), hasOcc = s.bool();
  const v20 = version > 0x1E;
  if (v20) { const markers = s.u32(); s.bytes(markers * 112); }
  let mode = 0;
  if (v20 || version > 0x1A) mode = s.i32();
  let ls = s;
  if (mode === 1) {
    const csize = s.u32(), usize = s.u32();
    const p = s.bytes(csize);
    ls = new Stream(lz4BlockDecompress(bytes.subarray(p, p + csize), usize));
  }
  const lods = parseLods(ls, v20 ? 0x1E : version, lodCount, hasAnim, hasOcc, v20, decode);
  return { name, version, hasAnimation: hasAnim, hasOcclusion: hasOcc, lods };
}

const hex2 = v => v.toString(16).toUpperCase().padStart(2, '0');

function parseLods(s, version, lodCount, hasAnim, hasOcc, v20, decode) {
  const lods = [];
  const skinnedBoxes = []; // 0x20: the n-th compressed-position decode uses the n-th LOD's skinned box (Python quirk)
  let compressedCalls = 0;
  const b = s.b, dv = s.dv;
  for (let li = 0; li < lodCount; li++) {
    const want = decode.has(li);
    const switchDistance = s.f32();
    const aabbMin = s.vec3(), aabbMax = s.vec3();
    let skMin = aabbMin, skMax = aabbMax;
    if (version >= 0x1C) { skMin = s.vec3(); skMax = s.vec3(); }
    skinnedBoxes.push([skMin, skMax]);
    let uvMin = null, uvMax = null;
    if (version > 0x1C) { uvMin = s.floats(8); uvMax = s.floats(8); }
    const n = s.u32(), indexCount = s.u32();
    let indexFormat = 1;
    if (version > 0x1D) indexFormat = s.i32();
    const morph = s.i32(), edge = s.i32(), adj = s.i32(), boneW = s.i32(), extra = s.i32();
    let hasNormals = true, hasSecondary = true, cPos = 0, cUv = 0, cExtra = 0;
    if (version > 0x1C) {
      hasNormals = s.bool(); hasSecondary = s.bool(); s.bool();
      cPos = s.i32(); cUv = s.i32(); cExtra = s.i32();
    }
    s.bytes(16); // bone influence partition
    const istride = indexFormat === 0 ? 2 : 4;
    let positions = null, normals = null, uvs = null, indices = null;
    if (version < 0x1D || cPos === 0) {
      const p = s.bytes(n * 16);
      if (want) {
        positions = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) positions[i * 3 + c] = dv.getFloat32(p + i * 16 + c * 4, true);
      }
    }
    if (hasNormals) {
      const p = s.bytes(n * 4);
      if (want) {
        normals = new Float64Array(n * 3);
        for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) normals[i * 3 + c] = dv.getInt8(p + i * 4 + c) / 128.0;
      }
    }
    if (version < 0x1D || cUv === 0) {
      const p = s.bytes(n * 16);
      if (want) {
        uvs = new Float64Array(n * 2);
        if (v20) for (let i = 0; i < n; i++) { uvs[i * 2] = F16_TABLE[dv.getUint16(p + i * 16, true)]; uvs[i * 2 + 1] = F16_TABLE[dv.getUint16(p + i * 16 + 2, true)]; }
        else for (let i = 0; i < n; i++) { uvs[i * 2] = dv.getFloat32(p + i * 16, true); uvs[i * 2 + 1] = dv.getFloat32(p + i * 16 + 4, true); }
      }
    }
    if (hasAnim) s.bytes(n * 8);
    {
      const p = s.bytes(indexCount * istride);
      if (want) {
        indices = new Uint32Array(indexCount);
        if (indexFormat === 0) for (let i = 0; i < indexCount; i++) indices[i] = dv.getUint16(p + i * 2, true);
        else for (let i = 0; i < indexCount; i++) indices[i] = dv.getUint32(p + i * 4, true);
      }
    }
    if (hasSecondary) s.skip(indexCount * istride);
    if (morph > 0) s.skip(n * istride);
    if (edge > 0) s.skip(n * istride);
    if (adj > 0) s.skip(adj * istride);
    if (boneW > 0) s.skip(boneW * 4);
    if (extra > 0) s.skip(extra * 2 * istride);
    if (version >= 0x1D) s.skip(Math.floor(indexCount / 3) * 4);
    if (cPos > 0) {
      const p = s.bytes(n * 4);
      s.bytes(n);
      let [mn, mx] = [aabbMin, aabbMax];
      if (v20) [mn, mx] = skinnedBoxes[compressedCalls++];
      if (want) {
        positions = new Float64Array(n * 3);
        const dx = mx[0] - mn[0], dy = mx[1] - mn[1], dz = mx[2] - mn[2];
        for (let i = 0; i < n; i++) {
          const v = dv.getUint32(p + i * 4, true);
          positions[i * 3] = (((v >>> 20) & 0x3FF) / 1023.0) * dx + mn[0];
          positions[i * 3 + 1] = (((v >>> 10) & 0x3FF) / 1023.0) * dy + mn[1];
          positions[i * 3 + 2] = ((v & 0x3FF) / 1023.0) * dz + mn[2];
        }
      }
    }
    if (cUv > 0) {
      const p = s.bytes(n * 4);
      if (want && uvMin && uvMax) {
        uvs = new Float64Array(n * 2);
        for (let i = 0; i < n; i++) {
          uvs[i * 2] = (b[p + i * 4] / 255.0) * (uvMax[0] - uvMin[0]) + uvMin[0];
          uvs[i * 2 + 1] = (b[p + i * 4 + 1] / 255.0) * (uvMax[1] - uvMin[1]) + uvMin[1];
        }
      }
    }
    if (cExtra > 0) s.skip(n * 4);
    lods.push({ switchDistance, aabbMin, aabbMax, skinnedAabbMin: skMin, skinnedAabbMax: skMax, vertexCount: n, indexCount,
      indexFormat, hasNormals, compressedPosCount: cPos, compressedUvCount: cUv, positions, normals, uvs, indices });
  }
  if (hasOcc) {
    const tri = s.u32(), vert = s.u32();
    s.bytes(tri * 3 * 4); s.bytes(vert * 4);
  }
  return lods;
}

// ───────────────────────── Python-compatible JSON ─────────────────────────

/** A float for pyJSON (Python float repr: 1.0, 1e-05, 1e+16). Plain JS numbers are written as Python ints. */
export class PyFloat { constructor(v) { this.v = v; } }

export function pyFloatRepr(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  let s = x.toExponential(), sign = '';
  if (s[0] === '-') { sign = '-'; s = s.slice(1); }
  const ei = s.indexOf('e');
  const digits = s.slice(0, ei).replace('.', '');
  const decpt = parseInt(s.slice(ei + 1), 10) + 1;
  if (decpt > -4 && decpt <= 16) {
    if (decpt <= 0) return sign + '0.' + '0'.repeat(-decpt) + digits;
    if (decpt >= digits.length) return sign + digits + '0'.repeat(decpt - digits.length) + '.0';
    return sign + digits.slice(0, decpt) + '.' + digits.slice(decpt);
  }
  const e = decpt - 1;
  return sign + digits[0] + (digits.length > 1 ? '.' + digits.slice(1) : '') + 'e' + (e < 0 ? '-' : '+') + String(Math.abs(e)).padStart(2, '0');
}

function pyStr(s) {
  let o = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) o += '\\"';
    else if (c === 0x5c) o += '\\\\';
    else if (c >= 0x20 && c <= 0x7e) o += s[i];
    else if (c === 0x0a) o += '\\n';
    else if (c === 0x0d) o += '\\r';
    else if (c === 0x09) o += '\\t';
    else if (c === 0x08) o += '\\b';
    else if (c === 0x0c) o += '\\f';
    else o += '\\u' + c.toString(16).padStart(4, '0');
  }
  return o + '"';
}

/** json.dumps(obj, separators=(",", ":")) with ensure_ascii. Numbers are ints unless wrapped in PyFloat. */
export function pyJSON(v) {
  if (v instanceof PyFloat) return pyFloatRepr(v.v);
  if (v === null || v === undefined) return 'null';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') { if (!Number.isInteger(v)) throw new Error('pyJSON: non-integer number ' + v); return String(v); }
  if (typeof v === 'string') return pyStr(v);
  if (Array.isArray(v)) return '[' + v.map(pyJSON).join(',') + ']';
  return '{' + Object.keys(v).map(k => pyStr(k) + ':' + pyJSON(v[k])).join(',') + '}';
}

// ───────────────────────── GLB ─────────────────────────

const pad4 = n => (n + 3) & ~3;
function packF32(src, count) { // struct.pack('<Nf'): OverflowError for finite values beyond float32 range
  const out = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const f = Math.fround(src[i]);
    if (!Number.isFinite(f) && Number.isFinite(src[i])) throw new RangeError('float too large to pack with f format');
    out[i] = f;
  }
  return new Uint8Array(out.buffer);
}

/** build_glb(name, lod, png): one node / mesh / material, POSITION (+NORMAL, TEXCOORD_0), uint32 indices,
 *  optional PNG baseColorTexture. Byte-identical to Python given the same PNG bytes (or null). */
export function buildGLB(name, lod, png) {
  const n = lod.positions.length / 3;
  const parts = [], views = [], accessors = [];
  let binLen = 0;
  const addView = (data, target) => {
    const v = { buffer: 0, byteOffset: binLen, byteLength: data.length };
    if (target) v.target = target;
    parts.push(data); binLen += pad4(data.length);
    views.push(v);
    return views.length - 1;
  };
  const addAcc = (data, ctype, count, type, extra) => {
    const view = addView(data, type === 'SCALAR' ? 34963 : 34962);
    accessors.push(Object.assign({ bufferView: view, componentType: ctype, count, type }, extra || {}));
    return accessors.length - 1;
  };
  const P = lod.positions;
  const mn = [P[0], P[1], P[2]], mx = [P[0], P[1], P[2]];
  for (let i = 1; i < n; i++) for (let c = 0; c < 3; c++) { // Python min()/max(): keep the first on ties / NaN
    const v = P[i * 3 + c];
    if (v < mn[c]) mn[c] = v;
    if (v > mx[c]) mx[c] = v;
  }
  if (n === 0) throw new Error('min() arg is an empty sequence');
  const attrs = { POSITION: addAcc(packF32(P, 3 * n), 5126, n, 'VEC3', { min: mn.map(x => new PyFloat(x)), max: mx.map(x => new PyFloat(x)) }) };
  if (lod.normals && lod.normals.length / 3 === n) attrs.NORMAL = addAcc(packF32(lod.normals, 3 * n), 5126, n, 'VEC3');
  if (lod.uvs && lod.uvs.length / 2 === n) attrs.TEXCOORD_0 = addAcc(packF32(lod.uvs, 2 * n), 5126, n, 'VEC2');
  const idx = lod.indices;
  const indices = addAcc(new Uint8Array(idx.buffer, idx.byteOffset, idx.byteLength), 5125, idx.length, 'SCALAR');
  const material = { name, doubleSided: true, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } };
  const gltf = { asset: { version: '2.0', generator: 'sky-fish-mod tools/sky_glb_extract.py' },
    scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [{ attributes: attrs, indices, material: 0 }] }],
    materials: [material], accessors, bufferViews: views };
  if (png != null && 'TEXCOORD_0' in attrs) {
    const iv = addView(png, null);
    gltf.images = [{ bufferView: iv, mimeType: 'image/png' }];
    gltf.textures = [{ source: 0 }];
    material.pbrMetallicRoughness.baseColorTexture = { index: 0, texCoord: 0 };
  }
  gltf.buffers = [{ byteLength: binLen }];
  const js = new TextEncoder().encode(pyJSON(gltf));
  const jsLen = pad4(js.length);
  const total = 12 + 8 + jsLen + 8 + binLen;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546C67, true); dv.setUint32(4, 2, true); dv.setUint32(8, total, true);
  dv.setUint32(12, jsLen, true); dv.setUint32(16, 0x4E4F534A, true);
  out.set(js, 20); out.fill(0x20, 20 + js.length, 20 + jsLen);
  dv.setUint32(20 + jsLen, binLen, true); dv.setUint32(24 + jsLen, 0x004E4942, true);
  let o = 28 + jsLen;
  for (const p of parts) { out.set(p, o); o += pad4(p.length); }
  return out;
}

/** Split a GLB into {json (object), jsonText, bin (Uint8Array)}. */
export function readGLB(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not a GLB');
  const jl = dv.getUint32(12, true);
  const jsonText = new TextDecoder().decode(bytes.subarray(20, 20 + jl));
  let bin = new Uint8Array(0);
  if (bytes.length > 28 + jl) { const bl = dv.getUint32(20 + jl, true); bin = bytes.subarray(28 + jl, 28 + jl + bl); }
  return { json: JSON.parse(jsonText), jsonText, bin };
}

// ───────────────────────── content hashes (for diffing against files already on the site) ─────────────────────────
// The site's PNGs (and the PNGs inside its GLBs) were written by Pillow; ours decode to the same pixels but are
// compressed differently, so compare content, not bytes.

const toHex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
function sizeHeader(w, h) { const b = new Uint8Array(8); const dv = new DataView(b.buffer); dv.setUint32(0, w, true); dv.setUint32(4, h, true); return b; }
const concat = parts => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };

/** SHA-256 (hex) of an image's pixels: width, height (uint32 LE) + RGBA. */
export async function imageContentHash(width, height, rgba) {
  return toHex(await crypto.subtle.digest('SHA-256', concat([sizeHeader(width, height), rgba])));
}
/** imageContentHash of a PNG file. */
export async function pngContentHash(png) { const d = await decodePNG(png); return imageContentHash(d.width, d.height, d.rgba); }

/** SHA-256 (hex) of a GLB's content: its JSON (with the image and buffer byte lengths zeroed), the geometry bytes,
 *  and the embedded image's pixels. Equal for our GLB and Python's when only the PNG compression differs. */
export async function glbContentHash(glb, image = null) { // image: the embedded PNG's {width, height, rgba}, if known
  const { json, bin } = readGLB(glb);
  let end = json.buffers && json.buffers[0] ? json.buffers[0].byteLength : bin.length, img = new Uint8Array(0);
  if (json.images && json.images.length) {
    const v = json.bufferViews[json.images[0].bufferView];
    end = v.byteOffset;
    const d = image || await decodePNG(bin.subarray(v.byteOffset, v.byteOffset + v.byteLength));
    img = concat([sizeHeader(d.width, d.height), d.rgba]);
    v.byteLength = 0;
  }
  if (json.buffers && json.buffers[0]) json.buffers[0].byteLength = 0;
  const parts = [new TextEncoder().encode(JSON.stringify(json)), new Uint8Array(1), bin.subarray(0, end), new Uint8Array(1), img];
  return toHex(await crypto.subtle.digest('SHA-256', concat(parts)));
}
