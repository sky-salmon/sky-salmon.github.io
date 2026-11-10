/* Minimal lossless PNG encode / decode (8-bit), no dependencies.
 * encodePNG keeps every RGBA value exactly (a canvas round trip premultiplies alpha and can change the colour of
 * semi-transparent pixels). Compression uses the platform's CompressionStream('deflate'), so it works in browsers,
 * Workers and Node 18+. decodePNG reads 8-bit grey / RGB / palette / grey+alpha / RGBA, non-interlaced, which covers
 * everything Pillow writes for the site's icons and GLB textures. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes, crc = 0) {
  crc = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return ~crc >>> 0;
}

async function streamThrough(bytes, transform) {
  const out = new Response(new Blob([bytes]).stream().pipeThrough(transform));
  return new Uint8Array(await out.arrayBuffer());
}
export const zlibDeflate = bytes => streamThrough(bytes, new CompressionStream('deflate'));
export const zlibInflate = bytes => streamThrough(bytes, new DecompressionStream('deflate'));

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

const paeth = (a, b, c) => {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
};

/** RGBA8 (Uint8Array w*h*4) -> PNG bytes (colour type 6). Per-row filter chosen by minimum sum of abs values. */
export async function encodePNG(rgba, width, height) {
  const bpp = 4, stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  const f1 = new Uint8Array(stride), f2 = new Uint8Array(stride), f3 = new Uint8Array(stride), f4 = new Uint8Array(stride);
  const zero = new Uint8Array(stride);
  const sa = v => v < 128 ? v : 256 - v;
  for (let y = 0; y < height; y++) {
    const row = rgba.subarray(y * stride, (y + 1) * stride);
    const prev = y ? rgba.subarray((y - 1) * stride, y * stride) : zero;
    let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
    for (let i = 0; i < stride; i++) {
      const x = row[i], b = prev[i];
      let a = 0, c = 0;
      if (i >= bpp) { a = row[i - bpp]; c = prev[i - bpp]; }
      const p = a + b - c, pa = p > a ? p - a : a - p, pb = p > b ? p - b : b - p, pc = p > c ? p - c : c - p;
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      const v1 = (x - a) & 0xff, v2 = (x - b) & 0xff, v3 = (x - ((a + b) >> 1)) & 0xff, v4 = (x - pr) & 0xff;
      f1[i] = v1; f2[i] = v2; f3[i] = v3; f4[i] = v4;
      s0 += sa(x); s1 += sa(v1); s2 += sa(v2); s3 += sa(v3); s4 += sa(v4);
    }
    let best = 0, bs = s0;
    if (s1 < bs) { best = 1; bs = s1; }
    if (y && s2 < bs) { best = 2; bs = s2; }
    if (s3 < bs) { best = 3; bs = s3; }
    if (y && s4 < bs) { best = 4; bs = s4; }
    const o = y * (stride + 1);
    raw[o] = best;
    raw.set(best === 0 ? row : best === 1 ? f1 : best === 2 ? f2 : best === 3 ? f3 : f4, o + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const idat = await zlibDeflate(raw);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** PNG bytes -> {width, height, rgba} (RGBA8). 8-bit, non-interlaced only. */
export async function decodePNG(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) throw new Error('not a PNG');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 8, width = 0, height = 0, depth = 0, ctype = 0, interlace = 0, palette = null, trns = null;
  const idat = [];
  while (p + 8 <= bytes.length) {
    const len = dv.getUint32(p), type = String.fromCharCode(...bytes.subarray(p + 4, p + 8));
    const data = bytes.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { width = dv.getUint32(p + 8); height = dv.getUint32(p + 12); depth = data[8]; ctype = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace) throw new Error(`PNG: unsupported depth ${depth} / interlace ${interlace}`);
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  if (!ch) throw new Error('PNG: bad colour type ' + ctype);
  const z = new Uint8Array(idat.reduce((n, d) => n + d.length, 0));
  let o = 0;
  for (const d of idat) { z.set(d, o); o += d.length; }
  const raw = await zlibInflate(z);
  const stride = width * ch;
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = px.subarray(y * stride, (y + 1) * stride);
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? row[i - ch] : 0, b = prev ? prev[i] : 0, c = prev && i >= ch ? prev[i - ch] : 0;
      row[i] = (src[i] + (f === 0 ? 0 : f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : paeth(a, b, c))) & 0xff;
    }
  }
  if (ctype === 6) return { width, height, rgba: px };
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, n = width * height; i < n; i++) {
    let r, g, b, a = 255;
    if (ctype === 0) { r = g = b = px[i]; if (trns && trns.length >= 2 && px[i] === trns[1]) a = 0; }
    else if (ctype === 4) { r = g = b = px[i * 2]; a = px[i * 2 + 1]; }
    else if (ctype === 2) {
      r = px[i * 3]; g = px[i * 3 + 1]; b = px[i * 3 + 2];
      if (trns && trns.length >= 6 && r === trns[1] && g === trns[3] && b === trns[5]) a = 0;
    } else { const k = px[i]; r = palette[k * 3]; g = palette[k * 3 + 1]; b = palette[k * 3 + 2]; if (trns && k < trns.length) a = trns[k]; }
    rgba[i * 4] = r; rgba[i * 4 + 1] = g; rgba[i * 4 + 2] = b; rgba[i * 4 + 3] = a;
  }
  return { width, height, rgba };
}
