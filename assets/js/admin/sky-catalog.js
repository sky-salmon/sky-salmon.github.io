/* Item catalogue for the site, built from the game data exactly like the Python tools in sky-fish-mod:
 *   buildIconCatalog  = tools/sky_icon_extract.py --flat  (icons.csv text + which atlas rectangle each PNG is)
 *   GlbIndex          = tools/sky_glb_extract.py naming / textures + the folder layout of assets/glb/
 * Hand-maintained data comes from the site's data/seasons.json, data/items.json and data/packs.json (catalog_data.py).
 * Plain ES module, no dependencies. */

// ───────────────────────── constants (sky_icon_extract.py / sky_glb_package.py) ─────────────────────────

/** Folder names of the card editor's icon tree (assets/icons) — also the cosmetic folders of assets/glb. */
export const SITE_DIRS = {
  wing: '01_斗篷_Cape', mask: '02_面具_Mask', hair: '03_髮型_Hair', body: '04_服裝_Outfit', hat: '05_頭飾_Headwear',
  neck: '06_項鍊_Necklace', horn: '07_角_Horn', feet: '08_鞋子_Shoes', face: '09_臉飾_FaceAccessory', prop: '10_道具_Prop',
};
export const KIND = { wing: 'cape', mask: 'mask', hair: 'hair', body: 'outfit', hat: 'hat', neck: 'neck', horn: 'horn',
  feet: 'shoes', face: 'face', prop: 'prop' };
export const OUTFIT = { wing: '01_斗篷_Cape', mask: '02_面具_Mask', hair: '03_髮型_Hair', body: '04_服裝_Outfit',
  hat: '05_髮飾_HairAccessory', neck: '06_項鍊_Necklace', horn: '07_頭飾_HeadAccessory', feet: '08_鞋子_Shoes',
  face: '09_面飾_FaceAccessory', prop: '10_道具_Prop' };
export const CAPE_FX = '11_斗篷特效_CapeFX', PLACEABLE = '12_家具擺設_Placeable', CREATURE = '13_生物NPC_Creature',
  CINE = '14_過場動畫_Cinematic', COLLISION = '15_碰撞體_Collision', ENV = '16_環境素材_Environment';
export const SPELL_DIR = '11_魔法_Spells';
export const SPELL_EXCLUDE = new Set(['UiMenuBuffSpellShop', 'UiMenuSpellCandleBundle']);
const CREATURE_PREFIX = ['Char', 'Bird', 'Fish', 'Crab', 'Jelly', 'Manta', 'Whale', 'Krill', 'Darkshroom', 'Husk'];
export const CSV_HEADER = ['category', 'name', 'icon', 'atlas', 'status', 'kind', 'season', 'event', 'group', 'ultimate',
  'order', 'iap_usd', 'iap_pack', 'iap_status', 'name_zh', 'name_en', 'iap_pack_zh', 'game_season', 'game_group', 'hidden'];
export const RESOURCE_FILES = ['OutfitDefs.json', 'PlaceableDefs.json', 'MeshDefs.lua', 'Persistent.lua', 'UIPackedAtlas.lua'];
export const ETC2_DIR = 'Images/Bin/ETC2/';

// ───────────────────────── Python semantics helpers ─────────────────────────

/** Python truthiness of a JSON value. */
export const truthy = v => !(v === undefined || v === null || v === false || v === 0 || v === '' ||
  (Array.isArray(v) && v.length === 0) || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0));
const or = (a, b) => truthy(a) ? a : b;

/** Python str comparison (code points). */
export function cmpStr(a, b) {
  if (a === b) return 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    let x = a.codePointAt(i), y = b.codePointAt(i);
    if (x !== y) return x < y ? -1 : 1;
    if (x > 0xffff) i++;
  }
  return a.length < b.length ? -1 : a.length > b.length ? 1 : 0;
}
const cmpVal = (a, b) => typeof a === 'number' && typeof b === 'number' ? (a < b ? -1 : a > b ? 1 : 0) : cmpStr(String(a), String(b));
/** sorted() of lists. */
export const cmpList = (a, b) => {
  for (let i = 0; i < Math.min(a.length, b.length); i++) { const c = cmpVal(a[i], b[i]); if (c) return c; }
  return a.length - b.length;
};
/** sorted() of pathlib paths: compare the parts. */
export const cmpPath = (a, b) => cmpList(a.split('/'), b.split('/'));

/** Python float(str): surrounding whitespace, underscores between digits, inf / nan. Throws like ValueError. */
export function pyFloat(s) {
  const t = String(s).trim();
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t[0] === '-' ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(t)) return NaN;
  const d = '\\d(?:_?\\d)*';
  if (!new RegExp(`^[+-]?(?:${d}(?:\\.(?:${d})?)?|\\.${d})(?:[eE][+-]?${d})?$`).test(t)) throw new Error(`could not convert string to float: '${s}'`);
  return Number(t.replace(/_/g, ''));
}
/** Python round(x) to int: half to even. */
export function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  return d < 0.5 ? f : d > 0.5 ? f + 1 : (f % 2 === 0 ? f : f + 1);
}
/** f"{x:.2f}": like toFixed(2), except that an exact binary tie (x = odd/8) rounds to even as Python does. */
export function pyFixed2(x) {
  const e = x * 8;
  if (Number.isInteger(e) && e % 2 !== 0) {
    const c = Math.floor(x * 100); // x*100 = odd*12.5, exact
    return ((c % 2 === 0 ? c : c + 1) / 100).toFixed(2);
  }
  return x.toFixed(2);
}
const cleanField = v => String(or(v, '')).replace(/[,\n]/g, ' ');

/** csv.writer (excel dialect, QUOTE_MINIMAL, \r\n). */
export function csvLine(fields) {
  const out = fields.map(f => {
    const s = f === null || f === undefined ? '' : String(f);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  });
  if (out.length === 1 && out[0] === '') return '""\r\n';
  return out.join(',') + '\r\n';
}

// ───────────────────────── data/*.json (catalog_data.py, sky_season_pack.py) ─────────────────────────

/** data: {seasons, items, packs}, each the whole file object (or just its list / map). */
export function loadCatalogData(data) {
  const pick = (v, key) => (v && !Array.isArray(v) && key in v && typeof v[key] === 'object') ? v[key] : v;
  const seasons = pick(data.seasons, 'seasons') || [], items = pick(data.items, 'items') || {}, packs = pick(data.packs, 'packs') || [];
  const ULTIMATE_NAMES = new Set(seasons.flatMap(s => s.ultimates || []));
  const RANK = { confirmed: 0, 'wiki-only': 1, 'game-only': 2 };
  const key = p => [RANK[p.status] ?? 9, p.usd === null || p.usd === undefined ? 1 : 0];
  const IAP = new Map();
  for (const p of [...packs].sort((a, b) => cmpList(key(a), key(b)))) {
    for (const i of p.items) if (!IAP.has(i)) IAP.set(i, [p.usd ?? null, or(p.name_en, p.id), p.name_zh === undefined ? '' : p.name_zh, p.status]);
  }
  const ITEMS = new Map(Object.entries(items));
  const SUPPLEMENT = new Map(), FLAGS = new Map();
  for (const [n, o] of ITEMS) {
    if (truthy(o.season)) SUPPLEMENT.set(n, parseInt(String(o.season).trim(), 10));
    if (truthy(o.unconfirmed)) FLAGS.set(n, o.unconfirmed);
  }
  return { ITEMS, ULTIMATE_NAMES, IAP, SUPPLEMENT, FLAGS };
}

// ───────────────────────── icons (sky_icon_extract.py --flat) ─────────────────────────

/** sky_glb_package.outfit_category */
export function outfitCategory(otype, abilities) {
  if (otype !== 'prop') return [OUTFIT[otype] || OUTFIT.prop, ''];
  const ab = new Set(abilities || []);
  if (ab.has('SocialPlaceable')) return [OUTFIT.prop, '可擺放_Placeable'];
  if (ab.has('SocialInstrument')) return [OUTFIT.prop, '樂器_Instrument'];
  if (ab.has('SocialFireworksMenu')) return [OUTFIT.prop, '煙火_Fireworks'];
  return [OUTFIT.prop, '手持道具_Held'];
}

export function siteGroup(otype, name, icon, onesie) {
  if (otype === 'neck' && icon.startsWith('UiOutfitPendant')) return 'pass';
  if (otype === 'body') return onesie ? 'outfit' : 'top';
  if (otype === 'hat' || otype === 'horn') return /Earring|Earlobe/.test(name) ? 'ear' : 'head';
  return { feet: 'shoes', mask: 'mask', face: 'face', neck: 'neck', hair: 'hair', wing: 'cape', prop: 'prop' }[otype] || 'prop';
}

function kindOf(otype, abilities) {
  const [, sub] = outfitCategory(otype, abilities);
  if (sub.startsWith('可擺放')) return 'placeable';
  if (sub.startsWith('樂器')) return 'instrument';
  if (sub.startsWith('煙火')) return 'fireworks';
  return KIND[otype] || 'prop';
}

function seasonOf(season, name) {
  const m = /^season_(\d+)$/.exec(or(season, ''));
  if (m) return [String(parseInt(m[1], 10)).padStart(2, '0'), ''];
  if (truthy(season)) return ['', season];
  const a = /AP(\d{2})/.exec(name);
  return a ? [a[1], ''] : ['', ''];
}

function luaNum(s) {
  s = s.trim();
  if (s.includes('/')) {
    const parts = s.split('/');
    if (parts.length !== 2) throw new Error(`UIPackedAtlas.lua: bad uv value '${s}'`);
    const b = pyFloat(parts[1]);
    if (b === 0) throw new Error('float division by zero');
    return pyFloat(parts[0]) / b;
  }
  return pyFloat(s);
}

/** UIPackedAtlas.lua -> Map(region -> {atlas, uv: [u0, v0, u1, v1]}) (REGION_RE of sky_icon_extract.py). */
export function parseUIPackedAtlas(text) {
  const re = /resource\s+"ImageRegion"\s+"([^"]+)"\s*\{\s*image\s*=\s*"([^"]+)"\s*,\s*uv\s*=\s*\{([^}]+)\}/g;
  const regions = new Map();
  for (const m of text.matchAll(re)) {
    const uv = m[3].split(',').map(luaNum);
    if (uv.length === 4) regions.set(m[1], { atlas: m[2], uv });
  }
  return regions;
}

/** Path of the KTX that sky_icon_extract.atlas(name) opens: ETC2/<name>.ktx, else ETC2/UI/<name>.ktx, else null. */
export function iconKtxPath(name, ktxExists) {
  for (const p of [`${ETC2_DIR}${name}.ktx`, `${ETC2_DIR}UI/${name}.ktx`]) if (ktxExists(p)) return p;
  return null;
}

/**
 * Everything sky_icon_extract.py --flat computes, without decoding any texture.
 *   outfitDefs, placeableDefs: parsed Resources/OutfitDefs.json / PlaceableDefs.json (placeableDefs may be null)
 *   uiRegions:  parseUIPackedAtlas(Resources/UIPackedAtlas.lua) (empty Map if the file is missing)
 *   ktxExists(path) -> bool, ktxSize(path) -> {width, height}   (paths under Data/)
 *   data: loadCatalogData(...) result
 * Returns {csv (string with BOM, \r\n), rows, items, icons: [{path, folder, name, icon, atlas, ktx, rect}], ok, total}
 * icons are the PNGs to write: crop `rect` = [left, top, right, bottom] in pixels of the decoded `ktx` (decode it with
 * mode 'icon'), or rect null for the whole image. When two items write the same path the last one wins, as in Python;
 * icons lists each path once with the winning crop.
 */
export function buildIconCatalog({ outfitDefs, placeableDefs, uiRegions, ktxExists, ktxSize, data }) {
  const { ITEMS, ULTIMATE_NAMES, IAP, SUPPLEMENT, FLAGS } = data;
  const items = [];
  const BASE = new Map();
  for (const e of outfitDefs) {
    if (!truthy(e.icon)) continue;
    const type = e.type ?? '';
    const ab = (e.abilities || []).map(a => a.event ?? null);
    const folder = SITE_DIRS[type] || SITE_DIRS.prop;
    let [season, event] = seasonOf(e.season ?? '', e.name);
    const gameSeason = season;
    if (!truthy(season) && SUPPLEMENT.has(e.name)) { season = String(SUPPLEMENT.get(e.name)).padStart(2, '0'); event = ''; }
    if (FLAGS.has(e.name)) { season = ''; event = 'unconfirmed'; }
    let group = siteGroup(type, e.name, e.icon, truthy(e.isOnesie));
    BASE.set(e.name, [gameSeason, group]);
    group = or((ITEMS.get(e.name) || {}).group, group);
    items.push([folder, e.name, e.icon, kindOf(type, ab), season, event, group, ULTIMATE_NAMES.has(e.name) ? '1' : '']);
  }
  for (const e of placeableDefs || []) if (truthy(e.icon)) items.push([PLACEABLE, e.name, e.icon, 'furniture', '', '', 'prop', '']);

  const prefixCat = [['Body', 'body'], ['Cape', 'wing'], ['Wing', 'wing'], ['Face', 'face'], ['Feet', 'feet'], ['Hair', 'hair'],
    ['Hat', 'hat'], ['Horn', 'horn'], ['Mask', 'mask'], ['Neck', 'neck'], ['Prop', 'prop']];
  const linked = new Set(items.map(it => it[2]));
  const names = [...uiRegions.keys()].sort(cmpStr);
  for (const icon of names.filter(r => r.startsWith('UiOutfit') && !linked.has(r))) {
    const t = (prefixCat.find(([k]) => icon.startsWith('UiOutfit' + k)) || [null, 'prop'])[1];
    items.push([SITE_DIRS[t], icon, icon, KIND[t] || 'prop', ...seasonOf('', icon), siteGroup(t, icon, icon, false), '']);
  }
  for (const icon of names.filter(r => (r.startsWith('UiMenuBuff') || r.startsWith('UiMenuSpell')) && !SPELL_EXCLUDE.has(r))) {
    items.push([SPELL_DIR, icon, icon, 'spell', '', '', 'spell', '']);
  }

  const rows = [], icons = new Map();
  let ok = 0;
  items.forEach(([cat, name, icon, kind, season, event, group, ultimate], order) => {
    let src = '', ktx = null, rect = null, atlasName = null;
    const region = uiRegions.get(icon);
    if (region) {
      ktx = iconKtxPath(region.atlas, ktxExists);
      if (ktx) {
        const { width: w, height: h } = ktxSize(ktx);
        const [u0, v0, u1, v1] = region.uv;
        rect = [pyRound(u0 * w), pyRound(v0 * h), pyRound(u1 * w), pyRound(v1 * h)];
        src = atlasName = region.atlas;
      }
    } else {
      ktx = iconKtxPath(icon, ktxExists);
      if (ktx) { src = `UI/${icon}`; atlasName = icon; }
    }
    let status = 'missing';
    if (ktx) {
      const path = `${cat}/${name}.png`;
      icons.delete(path); // re-insert: last writer wins, and keep the write order
      icons.set(path, { path, folder: cat, name, icon, atlas: atlasName, ktx, rect });
      status = 'ok'; ok++;
    }
    const [usd, pack, packZh, iapStatus] = IAP.get(name) || [null, '', '', ''];
    const fix = ITEMS.get(name) || {};
    const base = BASE.get(name) || [season, group];
    rows.push([cat, name, icon, src, status, kind, season, event, group, ultimate, order,
      usd !== null && usd !== undefined ? pyFixed2(usd) : (truthy(iapStatus) ? '?' : ''),
      cleanField(pack), iapStatus, cleanField(fix.name_zh), cleanField(fix.name_en), cleanField(packZh),
      base[0], base[1], truthy(fix.hidden) ? '1' : '']);
  });
  const sorted = [...rows].sort(cmpList);
  const csv = '﻿' + csvLine(CSV_HEADER) + sorted.map(csvLine).join('');
  return { csv, rows: sorted, items, icons: [...icons.values()], ok, total: items.length };
}

// ───────────────────────── GLB models (sky_glb_extract.py + assets/glb layout) ─────────────────────────

/** difflib.SequenceMatcher(None, a, b).ratio() */
export function sequenceRatio(a, b) {
  a = Array.from(a); b = Array.from(b);
  const b2j = new Map();
  b.forEach((c, i) => { if (!b2j.has(c)) b2j.set(c, []); b2j.get(c).push(i); });
  if (b.length >= 200) { // autojunk: drop popular elements
    const ntest = Math.floor(b.length / 100) + 1;
    for (const [c, idx] of [...b2j]) if (idx.length > ntest) b2j.delete(c);
  }
  const longest = (alo, ahi, blo, bhi) => {
    let bi = alo, bj = blo, bs = 0, j2len = new Map();
    for (let i = alo; i < ahi; i++) {
      const nj = new Map();
      for (const j of b2j.get(a[i]) || []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) || 0) + 1;
        nj.set(j, k);
        if (k > bs) { bi = i - k + 1; bj = j - k + 1; bs = k; }
      }
      j2len = nj;
    }
    while (bi > alo && bj > blo && a[bi - 1] === b[bj - 1]) { bi--; bj--; bs++; }
    while (bi + bs < ahi && bj + bs < bhi && a[bi + bs] === b[bj + bs]) bs++;
    return [bi, bj, bs];
  };
  let matches = 0;
  const queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop();
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  const len = a.length + b.length;
  return len ? 2.0 * matches / len : 1.0;
}

function parseUvValues(s) { // TextureResolver._parse_uv_values: lenient
  const out = [];
  for (const raw of s.split(',')) {
    const p = raw.trim();
    if (!p) continue;
    try {
      if (p.includes('/')) {
        const i = p.indexOf('/');
        const den = pyFloat(p.slice(i + 1).trim());
        out.push(den === 0 ? 0.0 : pyFloat(p.slice(0, i).trim()) / den);
      } else out.push(pyFloat(p));
    } catch { out.push(0.0); }
  }
  return out;
}

/** Persistent.lua ImageRegions (sky_mesh TextureResolver): Map(name -> {image, uv}). */
export function parsePersistentRegions(text) {
  const re = /resource\s+"ImageRegion"\s+"([^"]+)"\s*\{[^}]*image\s*=\s*"([^"]+)"[^}]*uv\s*=\s*\{([^}]+)\}/g;
  const out = new Map();
  for (const m of text.matchAll(re)) {
    const uv = parseUvValues(m[3]);
    if (uv.length === 4) out.set(m[1], { image: m[2], uv });
  }
  return out;
}

/** MeshDefs.lua: logical mesh name -> source file stem. */
export function parseMeshDefs(text) {
  const out = new Map();
  for (const m of text.matchAll(/resource\s+"Mesh"\s+"([^"]+)"\s*\{[^}]*?source\s*=\s*"([^"]+?)(?:\.fbx)?"/g)) out.set(m[1], m[2]);
  return out;
}

const stemOf = path => { const b = path.slice(path.lastIndexOf('/') + 1); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(0, i) : b; };

/** sky_glb_package.classify for a mesh with no outfit type: folder by mesh-name prefix. */
export function classifyStem(stem) {
  if (stem.includes('_Collision') || stem.endsWith('Collision') || stem.startsWith('Col_')) return COLLISION;
  if (stem.startsWith('Cape') || stem.startsWith('Wing')) return CAPE_FX;
  if (['P_', 'Prop', 'EnvProp', 'Furniture', 'CharSkyKid_Prop', 'Placeable'].some(p => stem.startsWith(p))) return PLACEABLE;
  if (stem.startsWith('Cine') || stem.startsWith('Cin_')) return CINE;
  if (CREATURE_PREFIX.some(p => stem.startsWith(p))) return CREATURE;
  return ENV;
}

/**
 * Mesh -> GLB decisions of sky_glb_extract.py, with the folders of the site's assets/glb/:
 *   cosmetic (mesh named by an OutfitDefs entry with a type) -> SITE_DIRS[type] (01..10),
 *   otherwise by name prefix -> 11_斗篷特效 / 12_家具擺設 / 13_生物NPC / 14_過場動畫 / 15_碰撞體; environment meshes
 *   (16_環境素材) are not on the site and are skipped unless includeEnvironment. Files are flat: <folder>/<name>.glb.
 * legacyNames: name cosmetics after the FIRST outfit using the mesh and never fall back to the mesh name, as the
 *   Python did when assets/glb was generated (16 files differ); default is the current Python behaviour.
 */
export class GlbIndex {
  constructor({ outfitDefs, placeableDefs, meshDefsLua, persistentLua, legacyNames = false, includeEnvironment = false }) {
    this.legacy = legacyNames; this.includeEnv = includeEnvironment;
    this.byMesh = new Map();
    for (const e of outfitDefs || []) {
      const meshes = or(e.mesh, []);
      for (const m of typeof meshes === 'string' ? [meshes] : meshes) {
        if (!this.byMesh.has(m)) this.byMesh.set(m, []);
        this.byMesh.get(m).push(e);
      }
    }
    const sourceOf = parseMeshDefs(meshDefsLua || '');
    this.placeable = new Map();
    for (const e of placeableDefs || []) {
      if (!truthy(e.mesh)) continue;
      const src = sourceOf.has(e.mesh) ? sourceOf.get(e.mesh) : e.mesh;
      if (!this.placeable.has(src)) this.placeable.set(src, e);
      if (!this.placeable.has(e.mesh)) this.placeable.set(e.mesh, e);
    }
    this.regions = parsePersistentRegions(persistentLua || '');
  }

  static longestPrefix(map, stem) {
    if (map.has(stem)) return map.get(stem);
    let best = null;
    for (const m of map.keys()) if (stem.startsWith(m + '_') && (best === null || m.length > best.length)) best = m;
    return best === null ? null : map.get(best);
  }

  findAll(stem) { return GlbIndex.longestPrefix(this.byMesh, stem) || []; }

  find(stem) {
    const cands = this.findAll(stem);
    if (!cands.length) return null;
    if (this.legacy) return cands[0];
    const base = stem.toLowerCase();
    let best = cands[0], bestR = -1;
    for (const o of cands) {
      const r = sequenceRatio(base, String(o.name).toLowerCase().replaceAll('charskykid_', ''));
      if (r > bestR) { bestR = r; best = o; }
    }
    return best;
  }

  /** What Python decides from the mesh path alone (no mesh bytes needed). folder null = not built for the site. */
  describe(path) {
    const stem = stemOf(path);
    const outfit = this.find(stem);
    const generic = !this.legacy && outfit !== null && this.findAll(stem).length >= 5;
    let folder;
    if (outfit && truthy(outfit.type)) folder = SITE_DIRS[outfit.type] || SITE_DIRS.prop;
    else folder = classifyStem(stem);
    if (folder === ENV && !this.includeEnv) folder = null;
    let diffuse = null, placeable = null;
    if (outfit) diffuse = truthy(outfit.diffuseTex) ? outfit.diffuseTex : ((outfit.texture || [])[0] || {}).diffuse ?? null;
    else {
      placeable = GlbIndex.longestPrefix(this.placeable, stem);
      if (placeable) diffuse = or(placeable.diffuse2Tex, placeable.diffuse1Tex) ?? null;
    }
    return { path, stem, outfit: outfit ? outfit.name : null, outfitType: outfit ? (outfit.type ?? '') : null, generic,
      folder, diffuse: truthy(diffuse) ? diffuse : null, placeable: placeable ? placeable.name : null };
  }

  /** texture_png's lookup: {ktx, crop (uv fractions, or null)} or null when no KTX is found. */
  texture(diffuse, ktxExists) {
    const region = this.regions.get(diffuse);
    let ktx = null;
    if (region && ktxExists(`${ETC2_DIR}${region.image}.ktx`)) ktx = `${ETC2_DIR}${region.image}.ktx`;
    else if (ktxExists(`${ETC2_DIR}${diffuse}.ktx`)) ktx = `${ETC2_DIR}${diffuse}.ktx`;
    return ktx ? { ktx, crop: region ? region.uv : null } : null;
  }

  /** All diffuse textures any outfit / placeable could use (KTX paths), to keep while streaming. */
  candidateTextureKtx() {
    const out = new Set();
    const add = d => {
      if (!truthy(d)) return;
      const r = this.regions.get(d);
      if (r) out.add(`${ETC2_DIR}${r.image}.ktx`);
      out.add(`${ETC2_DIR}${d}.ktx`);
    };
    for (const list of this.byMesh.values()) for (const o of list) add(truthy(o.diffuseTex) ? o.diffuseTex : ((o.texture || [])[0] || {}).diffuse);
    for (const p of this.placeable.values()) add(or(p.diffuse2Tex, p.diffuse1Tex));
    return out;
  }

  /**
   * Final GLB list. meshes: [{path, ok, meshName}] for EVERY .mesh in the game data (ok = parse_mesh_any succeeded and
   * LOD 0 has geometry; meshName = the name inside the file). Name clashes get "<name>__<mesh stem>.glb", decided in
   * sorted path order over all meshes, as in Python. Returns [{out: '<folder>/<file>.glb', folder, file, name, mesh,
   * outfit, generic, diffuse, ktx, crop}] for the meshes the site keeps.
   */
  plan(meshes, ktxExists) {
    const written = new Set(), out = [];
    for (const m of [...meshes].sort((a, b) => cmpPath(a.path, b.path))) {
      if (!m.ok) continue;
      const d = this.describe(m.path);
      const name = (d.generic || !d.outfit) ? (m.meshName || d.stem) : d.outfit;
      let file = `${name}.glb`;
      if (written.has(file)) file = `${name}__${d.stem}.glb`;
      written.add(file);
      if (!d.folder) continue;
      const tex = d.diffuse ? this.texture(d.diffuse, ktxExists) : null;
      out.push({ out: `${d.folder}/${file}`, folder: d.folder, file, name, mesh: m.path, outfit: d.generic ? null : d.outfit,
        generic: d.generic, diffuse: d.diffuse, ktx: tex ? tex.ktx : null, crop: tex ? tex.crop : null });
    }
    return out;
  }
}
