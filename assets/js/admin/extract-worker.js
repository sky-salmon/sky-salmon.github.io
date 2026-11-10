/* Game-file extraction for the admin page: Sky.apks (or .xapk / .apk) -> icons.csv, icon PNGs and GLB models,
 * entirely in the browser. Mirrors tools/sky_icon_extract.py --flat and tools/sky_glb_extract.py from sky-fish-mod.
 *
 * As a module Worker:  new Worker('assets/js/admin/extract-worker.js', { type: 'module' })
 *   post  {type: 'start', file, data: {seasons, items, packs}, options}
 *         data = the parsed data/seasons.json, data/items.json, data/packs.json (whole files)
 *         options: {legacyNames: false, png: 'js' | 'canvas', iconRGBA: false, includeEnvironment: false}
 *   gets  {type: 'progress', phase: 'read' | 'icons' | 'textures' | 'glb', done, total, detail}
 *         {type: 'done', csv, icons: [{path, png, width, height, hash, rgba?}], glbs: [{path, bytes, hash, mesh, texture}],
 *          defsSummary}            (png / bytes are Uint8Array, transferred; paths are relative to assets/icons/
 *                                   and assets/glb/; hash = imageContentHash / glbContentHash from sky-decode.js, the
 *                                   same for a site file holding the same pixels / geometry: use it for the diff)
 *         {type: 'error', message, stack}
 * In Node (tests) import runExtraction directly. */

import { iterateArchive } from './zipstream.js';
import { decodeKTX, ktxHeader, cropRGBA, parseMesh, buildGLB, imageContentHash, glbContentHash } from './sky-decode.js';
import { loadCatalogData, buildIconCatalog, parseUIPackedAtlas, GlbIndex, RESOURCE_FILES, ETC2_DIR, cmpPath } from './sky-catalog.js';
import { encodePNG } from './png.js';

const RES = 'Resources/';
const basename = p => p.slice(p.lastIndexOf('/') + 1);
const stemOf = p => { const b = basename(p), i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };
const textOf = bytes => new TextDecoder().decode(bytes);

/** PNG through OffscreenCanvas (premultiplied: semi-transparent colours may shift by a few levels). */
export async function encodePNGCanvas(rgba, width, height) {
  const c = new OffscreenCanvas(width, height);
  c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, rgba.byteLength), width, height), 0, 0);
  return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
}

/** parse_mesh_any + the LOD-0 checks of sky_glb_extract.main: {ok, meshName, error}. */
export function validateMesh(bytes) {
  try {
    const m = parseMesh(bytes, { decode: [] });
    if (!m.lods.length) return { ok: false, meshName: m.name, error: `LOD 0 missing (mesh has ${m.lods.length})` };
    const l = m.lods[0];
    if (!l.vertexCount || !l.indexCount) return { ok: false, meshName: m.name, error: 'no geometry (stripGeometry / skeleton-only mesh)' };
    return { ok: true, meshName: m.name };
  } catch (e) { return { ok: false, meshName: '', error: `${e.name}: ${e.message}` }; }
}

/**
 * runExtraction(blob, data, opts) -> {csv, icons, glbs, defsSummary, glbPlan}
 *   opts.onProgress({phase, done, total, detail}); opts.png 'js' (default, exact pixels) or 'canvas';
 *   opts.legacyNames (GLB names as when assets/glb was generated); opts.iconRGBA (also return raw RGBA per icon);
 *   opts.includeEnvironment (also build 16_環境素材 meshes, flat); opts.glb === false skips GLBs;
 *   opts.onBuild(job, lod, png) is called before each GLB is built (tests).
 */
export async function runExtraction(blob, data, opts = {}) {
  const onProgress = opts.onProgress || (() => {});
  const png = opts.png === 'canvas' ? encodePNGCanvas : encodePNG;
  const catData = loadCatalogData(data);
  const warnings = [];
  const res = new Map();     // Resources/<name> -> bytes
  const ktx = new Map();     // KTX bytes we keep
  const ktxSeen = new Map(); // every KTX path -> {width, height, format}
  const meshRaw = new Map(); // mesh bytes kept (before the defs arrive, or planned for the site)
  const meshMeta = new Map();// mesh path -> {ok, meshName, error} for meshes already dropped
  let index = null, keepKtx = null, defsFinal = false;

  const makeIndex = () => {
    const json = n => res.has(RES + n) ? JSON.parse(textOf(res.get(RES + n))) : null;
    const outfitDefs = json('OutfitDefs.json');
    if (!outfitDefs) throw new Error('Resources/OutfitDefs.json not found in the game file');
    const placeableDefs = json('PlaceableDefs.json');
    const lua = n => res.has(RES + n) ? textOf(res.get(RES + n)) : '';
    const uiRegions = parseUIPackedAtlas(lua('UIPackedAtlas.lua'));
    const idx = new GlbIndex({ outfitDefs, placeableDefs, meshDefsLua: lua('MeshDefs.lua'), persistentLua: lua('Persistent.lua'),
      legacyNames: !!opts.legacyNames, includeEnvironment: !!opts.includeEnvironment });
    const keep = idx.candidateTextureKtx();
    const iconKtx = n => { keep.add(`${ETC2_DIR}${n}.ktx`); keep.add(`${ETC2_DIR}UI/${n}.ktx`); };
    for (const r of uiRegions.values()) iconKtx(r.atlas);
    for (const e of [...outfitDefs, ...(placeableDefs || [])]) if (e.icon && !uiRegions.has(e.icon)) iconKtx(e.icon);
    return { idx, keep, outfitDefs, placeableDefs, uiRegions };
  };
  const onMesh = (path, bytes) => {
    if (opts.glb !== false && index.idx.describe(path).folder) { meshRaw.set(path, bytes); meshMeta.delete(path); return; }
    meshRaw.delete(path);
    meshMeta.set(path, validateMesh(bytes));
  };
  const ready = () => {
    index = makeIndex(); keepKtx = index.keep;
    for (const p of [...ktx.keys()]) if (!keepKtx.has(p)) ktx.delete(p);
    for (const [p, b] of [...meshRaw]) onMesh(p, b);
  };

  // ── 1. one streaming pass over the archive ──
  const want = p => p.endsWith('.mesh') || p.endsWith('.ktx') || p.endsWith('.pack') || RESOURCE_FILES.includes(basename(p));
  let lastT = 0;
  const t0 = Date.now();
  for await (const f of iterateArchive(blob, {
    want, onProgress: ({ read, total, container }) => {
      const now = Date.now();
      if (now - lastT > 200 || read === total) { lastT = now; onProgress({ phase: 'read', done: read, total, detail: container }); }
    },
  })) {
    const { path, bytes } = f;
    if (path.endsWith('.ktx')) {
      ktxSeen.set(path, bytes.length >= 64 ? ktxHeader(bytes) : null);
      if (!keepKtx || keepKtx.has(path)) ktx.set(path, bytes); else ktx.delete(path);
    } else if (path.endsWith('.mesh')) {
      if (index && !defsFinal) onMesh(path, bytes); else meshRaw.set(path, bytes);
    } else if (path.startsWith(RES) && !path.slice(RES.length).includes('/')) {
      res.set(path, bytes);
      if (index) { // a resource came again after we started pruning: keep everything from now on
        defsFinal = true; keepKtx = null;
        warnings.push(`${path} appeared twice; files skipped before it may be missing`);
      } else if (RESOURCE_FILES.every(n => res.has(RES + n))) ready();
    }
  }
  const readSeconds = (Date.now() - t0) / 1000;
  if (!index || defsFinal) { index = null; ready(); }
  const { idx, outfitDefs, placeableDefs, uiRegions } = index;

  // ── 2. icons.csv + icon PNGs ──
  const cat = buildIconCatalog({ outfitDefs, placeableDefs, uiRegions, data: catData,
    ktxExists: p => ktxSeen.has(p), ktxSize: p => ktxSeen.get(p) });
  const icons = [];
  const byKtx = new Map();
  for (const ic of cat.icons) { if (!byKtx.has(ic.ktx)) byKtx.set(ic.ktx, []); byKtx.get(ic.ktx).push(ic); }

  // ── 3. GLB plan (needs every mesh's parse result for the name-clash rule) ──
  let plan = [];
  if (opts.glb !== false) {
    for (const [p, b] of meshRaw) if (!meshMeta.has(p)) meshMeta.set(p, validateMesh(b));
    plan = idx.plan([...meshMeta].map(([path, m]) => ({ path, ...m })), p => ktxSeen.has(p));
  }
  const texJobs = new Map(); // ktx -> Map(diffuse -> crop)
  for (const j of plan) if (j.ktx) { if (!texJobs.has(j.ktx)) texJobs.set(j.ktx, new Map()); texJobs.get(j.ktx).set(j.diffuse, j.crop); }

  let done = 0;
  for (const [k, list] of byKtx) {
    const bytes = ktx.get(k);
    if (!bytes) throw new Error(`${k} was not kept`);
    const img = decodeKTX(bytes, 'icon'); // Python stops on a decode error here too
    await Promise.all(list.map(async ic => { // PNG compression runs off the JS thread: overlap the encodes
      const c = ic.rect ? cropRGBA(img.rgba, img.width, img.height, ...ic.rect) : img;
      if (!c.width || !c.height) throw new Error(`empty icon crop for ${ic.path}`);
      const out = { path: ic.path, png: await png(c.rgba, c.width, c.height), width: c.width, height: c.height,
        hash: await imageContentHash(c.width, c.height, c.rgba) };
      if (opts.iconRGBA) out.rgba = c.rgba;
      icons.push(out);
      onProgress({ phase: 'icons', done: ++done, total: cat.icons.length, detail: ic.path });
    }));
    if (!texJobs.has(k)) ktx.delete(k);
  }
  icons.sort((a, b) => cmpPath(a.path, b.path));

  // ── 4. GLB textures (texture_png: one decode per atlas, crop with int()) ──
  const texPng = new Map(); // diffuse -> PNG bytes | null (texture failed)
  const texNote = new Map();
  const texImg = new Map(); // diffuse -> {width, height, rgba} (for the content hash)
  done = 0;
  for (const [k, diffuses] of texJobs) {
    let img = null, err = null;
    try { img = decodeKTX(ktx.get(k), 'texture'); } catch (e) { err = e; }
    for (const [diffuse, crop] of diffuses) {
      try {
        if (err) throw err;
        let c = img;
        if (crop) {
          const [u0, v0, u1, v1] = crop;
          c = cropRGBA(img.rgba, img.width, img.height, Math.trunc(u0 * img.width), Math.trunc(v0 * img.height),
            Math.trunc(u1 * img.width), Math.trunc(v1 * img.height));
          if (!c.width || !c.height) throw new Error('empty crop');
        }
        texPng.set(diffuse, await png(c.rgba, c.width, c.height));
        texImg.set(diffuse, c);
        texNote.set(diffuse, diffuse + (crop ? ' (cropped)' : ''));
      } catch (e) {
        texPng.set(diffuse, null);
        texNote.set(diffuse, `texture failed: ${e.message}`);
      }
    }
    ktx.delete(k);
    onProgress({ phase: 'textures', done: ++done, total: texJobs.size, detail: k });
  }

  // ── 5. GLBs ──
  const glbs = [], glbFailed = [];
  done = 0;
  for (const j of plan) {
    const bytes = meshRaw.get(j.mesh);
    meshRaw.delete(j.mesh);
    try {
      const lod = parseMesh(bytes, { decode: [0] }).lods[0];
      const tex = j.diffuse ? (j.ktx ? texPng.get(j.diffuse) : null) : null;
      if (opts.onBuild) await opts.onBuild(j, lod, tex); // test hook
      const glb = buildGLB(j.name, lod, tex);
      glbs.push({ path: j.out, bytes: glb, hash: await glbContentHash(glb, tex ? texImg.get(j.diffuse) : null), mesh: j.mesh,
        texture: j.diffuse ? (j.ktx ? texNote.get(j.diffuse) : `${j.diffuse} (ktx not found)`) : null });
    } catch (e) { glbFailed.push({ path: j.out, mesh: j.mesh, error: `${e.name}: ${e.message}` }); }
    onProgress({ phase: 'glb', done: ++done, total: plan.length, detail: j.out });
  }

  const meshFailed = [...meshMeta].filter(([, m]) => !m.ok).map(([path, m]) => ({ path, error: m.error }));
  const defsSummary = {
    outfits: outfitDefs.length, placeables: (placeableDefs || []).length, uiRegions: uiRegions.size,
    imageRegions: idx.regions.size, ktxFiles: ktxSeen.size, meshFiles: meshMeta.size, meshFailed,
    csvRows: cat.rows.length, icons: icons.length, iconsMissing: cat.total - cat.ok,
    glbs: glbs.length, glbFailed, glbTextureFailed: [...texNote].filter(([, n]) => n.startsWith('texture failed')).map(([d, n]) => `${d}: ${n}`),
    readSeconds, warnings,
  };
  return { csv: cat.csv, icons, glbs, defsSummary, glbPlan: plan };
}

// ── Worker entry ──
if (typeof self !== 'undefined' && typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = async ev => {
    const msg = ev.data || {};
    if (msg.type !== 'start') return;
    try {
      const o = msg.options || {};
      const r = await runExtraction(msg.file, msg.data, { ...o, onProgress: p => self.postMessage({ type: 'progress', ...p }) });
      const transfer = [...r.icons.map(i => i.png.buffer), ...r.glbs.map(g => g.bytes.buffer)];
      if (o.iconRGBA) for (const i of r.icons) if (i.rgba && !transfer.includes(i.rgba.buffer)) transfer.push(i.rgba.buffer);
      self.postMessage({ type: 'done', csv: r.csv, icons: r.icons, glbs: r.glbs, defsSummary: r.defsSummary }, [...new Set(transfer)]);
    } catch (e) {
      self.postMessage({ type: 'error', message: e && e.message || String(e), stack: e && e.stack });
    }
  };
}
