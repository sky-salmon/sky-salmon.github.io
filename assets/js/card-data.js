/* candle·kit — static data for the card editor: item catalogue (assets/icons), season names,
 * small SVG glyphs, colour/gradient/font presets and procedurally drawn wallpapers & textures.
 * Every SVG here carries explicit colours so html2canvas can rasterise it on its own. */
(function () {
  'use strict';

  // ── item catalogue (folders under assets/icons, listed in icons.csv) ──────────
  // Icons live in one folder per game type (dir); saved cards store those paths, so dirs never change.
  // The display category comes from icons.csv `group` (built from the game's OutfitDefs):
  //   pass   = season pendants; the season's ultimate gifts (畢業禮, csv `ultimate`) are listed here too
  //   top    = outfits that can be worn with shoes; outfit = one-piece outfits that can't (isOnesie)
  //   head   = hair and head accessories (game types hat + horn); ear = earrings
  // `season` also comes from OutfitDefs (plus props the wiki attaches to a season), not from APxx in names.
  const CATS = [
    { id: 'pass', zh: '項鍊（含畢業禮）' },
    { id: 'top', zh: '上衣' },
    { id: 'shoes', zh: '鞋子' },
    { id: 'outfit', zh: '服裝' },
    { id: 'mask', zh: '面具' },
    { id: 'face', zh: '面飾' },
    { id: 'neck', zh: '項鍊' },
    { id: 'hair', zh: '頭髮' },
    { id: 'head', zh: '頭飾' },
    { id: 'ear', zh: '耳飾' },
    { id: 'cape', zh: '斗篷' },
    { id: 'prop', zh: '道具' },
    { id: 'spell', zh: '魔法' }
  ];
  // the closet's category order (used by CLOSET and IAP, and for the default "closet order" browsing)
  const CLOSET_CATS = ['top', 'shoes', 'outfit', 'mask', 'face', 'neck', 'hair', 'head', 'ear', 'cape', 'prop'];
  const CAT_BY_ID = Object.fromEntries(CATS.map(c => [c.id, c]));
  // icon folder → category, used until icons.csv has loaded (and as the fallback for older csv files)
  const DIR_CAT = {
    '01_斗篷_Cape': 'cape', '02_面具_Mask': 'mask', '03_髮型_Hair': 'hair', '04_服裝_Outfit': 'top',
    '05_頭飾_Headwear': 'head', '06_項鍊_Necklace': 'neck', '07_角_Horn': 'head', '08_鞋子_Shoes': 'shoes',
    '09_臉飾_FaceAccessory': 'face', '10_道具_Prop': 'prop', '11_魔法_Spells': 'spell'
  };

  // Season number as used in the game data (season_NN = the (N-1)th season since global launch).
  // Traditional Chinese names follow the zh Sky fan wiki; 32 (Season of Pearl) has no published
  // Chinese name yet, so 珍珠季 is provisional.
  const SEASONS = {
    '01': { en: '' },
    '02': { zh: '感恩季', en: 'Gratitude' },
    '03': { zh: '追光季', en: 'Lightseekers' },
    '04': { zh: '歸屬季', en: 'Belonging' },
    '05': { zh: '音韻季', en: 'Rhythm' },
    '06': { zh: '魔法季', en: 'Enchantment' },
    '07': { zh: '聖島季', en: 'Sanctuary' },
    '08': { zh: '預言季', en: 'Prophecy' },
    '09': { zh: '夢想季', en: 'Dreams' },
    '10': { zh: '集結季', en: 'Assembly' },
    '11': { zh: '小王子季', en: 'The Little Prince' },
    '12': { zh: '飛翔季', en: 'Flight' },
    '13': { zh: '深淵季', en: 'Abyss' },
    '14': { zh: '表演季', en: 'Performance' },
    '15': { zh: '破曉季', en: 'Shattering' },
    '16': { zh: 'AURORA季', en: 'AURORA' },
    '17': { zh: '緬懷季', en: 'Remembrance' },
    '18': { zh: '夜行季', en: 'Passage' },
    '19': { zh: '拾光季', en: 'Moments' },
    '20': { zh: '歸巢季', en: 'Revival' },
    '21': { zh: '九色鹿季', en: 'Nine-Colored Deer' },
    '22': { zh: '築巢季', en: 'Nesting' },
    '23': { zh: '二重奏季', en: 'Duets' },
    '24': { zh: '姆明季', en: 'Moomin' },
    '25': { zh: '彩染季', en: 'Radiance' },
    '26': { zh: '青鳥季', en: 'Blue Bird' },
    '27': { zh: '雙星季', en: 'Two Embers' },
    '28': { zh: '遷徙季', en: 'Migration' },
    '29': { zh: '織光季', en: 'Lightmending' },
    '30': { zh: '狂歡季', en: 'Carnival' },
    '31': { zh: '致梵谷', en: 'Dear Van Gogh' },
    '32': { zh: '珍珠季', en: 'Pearl' }
  };
  function seasonName(code) {
    const s = SEASONS[code];
    return (s && (s.zh || s.en)) || `AP${code}`;
  }
  function seasonFull(code) {
    const s = SEASONS[code] || {};
    return [`AP${code}`, s.zh, s.en].filter(Boolean).join(' · ');
  }

  // path → { cat, season, ult, order, usd, pack, iap } from icons.csv, filled by loadCatalog()
  const META = new Map();

  // "03_髮型_Hair/CharSkyKid_Hair_AP21FancyUpdo" → readable bits
  function parsePath(path) {
    const slash = path.indexOf('/');
    const dir = path.slice(0, slash), name = path.slice(slash + 1);
    const label = name
      .replace(/^(CharSkyKid|CharSkyNPC|NPC|Nest)_/, '')
      .replace(/^UiOutfit(Body|Cape|Wing|Face|Feet|Hair|Hat|Horn|Mask|Neck|Prop)/, '')
      .replace(/^(Wing|Mask|Hair|Body|Hat|Horn|Neck|Tail|Feet|Face|Prop)_/, '')
      .replace(/AP\d{0,2}(?=[A-Z_]|$)/, '')
      .replace(/_\d+$/, '')
      .replace(/[_$]+/g, ' ')
      .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
      .replace(/\s+/g, ' ').trim() || name;
    const meta = META.get(path);
    let season, catId, ult = false;
    if (meta) {
      season = meta.season;
      catId = meta.cat;
      ult = meta.ult;
    } else { // catalogue not loaded yet (or an old csv): fall back to the folder and the file name
      const m = name.match(/_AP(\d{2})/);
      season = m ? m[1] : null;
      catId = DIR_CAT[dir] || 'prop';
    }
    const cat = CAT_BY_ID[catId];
    return { dir, name, season, label, cat: catId, catZh: (cat ? cat.zh : '') + (ult ? '・畢業禮' : ''), ult,
      order: meta ? meta.order : 1e9, usd: meta ? meta.usd : '', pack: meta ? meta.pack : '', iap: meta ? meta.iap : '' };
  }
  function iconURL(path) {
    return 'assets/icons/' + path.split('/').map(encodeURIComponent).join('/') + '.png';
  }

  let catalogPromise = null;
  // Fetches icons.csv once; returns [{path, dir, name, season, label, cat, catZh}] de-duplicated by atlas icon.
  function loadCatalog() {
    if (catalogPromise) return catalogPromise;
    catalogPromise = fetch('assets/icons/icons.csv')
      .then(r => { if (!r.ok) throw new Error('icons.csv ' + r.status); return r.text(); })
      .then(text => {
        const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
        const head = lines[0].split(',').map(h => h.trim());
        const col = n => head.indexOf(n);
        const iDir = col('category'), iName = col('name'), iIcon = col('icon'), iStatus = col('status'),
          iSeason = col('season'), iGroup = col('group'), iUlt = col('ultimate'), iOrder = col('order'),
          iUsd = col('iap_usd'), iPack = col('iap_pack'), iIap = col('iap_status');
        const rows = [];
        lines.slice(1).forEach(line => {
          const f = line.split(',');
          const dir = f[iDir], name = f[iName], status = (f[iStatus] || '').trim();
          if (!dir || !name || (status && status !== 'ok') || !DIR_CAT[dir]) return;
          const path = dir + '/' + name;
          const group = iGroup >= 0 ? (f[iGroup] || '').trim() : '';
          const season = iSeason >= 0 ? ((f[iSeason] || '').trim() || null) : undefined;
          if (group || season !== undefined) META.set(path, {
            cat: CAT_BY_ID[group] ? group : DIR_CAT[dir],
            season: season === undefined ? ((name.match(/_AP(\d{2})/) || [])[1] || null) : season,
            ult: iUlt >= 0 && (f[iUlt] || '').trim() === '1',
            order: iOrder >= 0 ? (parseInt(f[iOrder], 10) || 0) : 0,
            usd: iUsd >= 0 ? (f[iUsd] || '').trim() : '',   // pack price in USD, '?' = paid but price unknown
            pack: iPack >= 0 ? (f[iPack] || '').trim() : '',
            iap: iIap >= 0 ? (f[iIap] || '').trim() : ''    // confirmed / game-only / wiki-only
          });
          rows.push({ path, dir, icon: f[iIcon] || name });
        });
        const seen = new Set(), out = [];
        rows.forEach(r => {
          const key = r.dir + '|' + r.icon;
          if (seen.has(key)) return;
          seen.add(key);
          out.push(Object.assign({ path: r.path }, parsePath(r.path)));
        });
        return out;
      })
      .catch(err => { catalogPromise = null; throw err; });
    return catalogPromise;
  }

  // ── glyphs ────────────────────────────────────────────────────────────────
  const svg = (body, vb = '0 0 24 24') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="24" height="24" aria-hidden="true">${body}</svg>`;
  const flame = (fill = '#ffc35a') => `<path d="M12 1.8c1.9 2.6 3 4.3 3 5.9a3 3 0 0 1-6 0c0-1.6 1.1-3.3 3-5.9z" fill="${fill}"/><path d="M12 5.2c.8 1.1 1.2 1.8 1.2 2.5a1.2 1.2 0 0 1-2.4 0c0-.7.4-1.4 1.2-2.5z" fill="#fff6d8"/>`;
  const HEART_D = 'M12 20.6 4.6 13.3a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9a4.6 4.6 0 0 1 6.5 6.5z';

  const CURRENCIES = [
    { id: 'candle', zh: '蠟燭', svg: svg(flame() + '<rect x="8.4" y="11" width="7.2" height="11" rx="1.7" fill="#f7f2e8"/><path d="M8.4 14c1.2.6 2.3-.3 3.6.3s2.4-.4 3.6.1" stroke="#cfc3ad" stroke-width=".9" fill="none"/>') },
    { id: 'ascended', zh: '升華蠟燭', svg: svg(flame('#ff9d5c') + '<rect x="8.4" y="11" width="7.2" height="11" rx="1.7" fill="#f6c27e"/><path d="M8.4 14.4h7.2" stroke="#d98b45" stroke-width="1.1"/><path d="M19.3 13.2l.7 1.6 1.6.7-1.6.7-.7 1.6-.7-1.6-1.6-.7 1.6-.7z" fill="#ffe3a8"/>') },
    { id: 'heart', zh: '愛心', svg: svg(`<path d="${HEART_D}" fill="#ff7d8e"/><path d="M8 9.4a2.2 2.2 0 0 1 2.4-.6" stroke="#ffd1d8" stroke-width="1.3" stroke-linecap="round" fill="none"/>`) },
    { id: 'seasonCandle', zh: '季節蠟燭', svg: svg(flame('#ffd75a') + '<rect x="8.4" y="11" width="7.2" height="11" rx="1.7" fill="#ffe27a"/><circle cx="12" cy="16.4" r="1.6" fill="#e0a92c"/>') },
    { id: 'seasonHeart', zh: '季節愛心', svg: svg(`<path d="${HEART_D}" fill="#ffd04d"/><path d="${HEART_D}" fill="none" stroke="#c98a12" stroke-width="1.2"/>`) },
    { id: 'ticket', zh: '活動代幣', svg: svg('<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h15A1.5 1.5 0 0 1 21 7.5V10a2 2 0 0 0 0 4v2.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5V14a2 2 0 0 0 0-4z" fill="#8fd3ff"/><path d="M15 6.5v11" stroke="#4a9fd0" stroke-width="1.2" stroke-dasharray="1.6 1.4"/><path d="m9.2 9.4.9 1.8 2 .3-1.4 1.4.3 2-1.8-.9-1.8.9.3-2-1.4-1.4 2-.3z" fill="#fff"/>') }
  ];

  const GLYPH = {
    height: svg('<circle cx="8" cy="5" r="2.3" fill="currentColor"/><path d="M5.2 21.5 6 13H4.8V9.6A1.8 1.8 0 0 1 6.6 7.8h2.8a1.8 1.8 0 0 1 1.8 1.8V13H10l.8 8.5z" fill="currentColor"/><circle cx="17" cy="11" r="1.8" fill="currentColor"/><path d="M15 21.5l.5-5.5h-.8v-2.4a1.4 1.4 0 0 1 1.4-1.4h1.8a1.4 1.4 0 0 1 1.4 1.4V16h-.8l.5 5.5z" fill="currentColor"/>'),
    pencil: svg('<path d="M15.6 3.6a2.2 2.2 0 0 1 3.1 0l1.7 1.7a2.2 2.2 0 0 1 0 3.1L9.2 19.6l-5.3 1.2 1.2-5.3z" fill="currentColor"/><path d="M14.2 5l4.8 4.8" stroke="rgba(0,0,0,.35)" stroke-width="1.2"/>'),
    avatar: svg('<rect width="24" height="24" fill="#2a3448"/><circle cx="12" cy="13" r="9" fill="#ffe7a8" opacity=".18"/><path d="M12 5.2c2.3 0 4 1.7 4 3.9 0 2.3-1.7 4.1-4 4.1s-4-1.8-4-4.1c0-2.2 1.7-3.9 4-3.9z" fill="#f4ead8"/><path d="M5 24c.6-5.2 3.4-8.4 7-8.4s6.4 3.2 7 8.4z" fill="#f4ead8"/><path d="M8.4 8.2c1-2.2 2.4-3 3.6-3 1.6 0 3.2 1.1 3.8 3-1.2-.8-2.3-1-3.8-.9-1.3 0-2.5.3-3.6.9z" fill="#c8b48e"/>')
  };

  // PIN & STAR — enamel-pin style badges (merch is not part of the cosmetics catalogue)
  const pin = (bg, body) => svg(`<circle cx="12" cy="12" r="11" fill="${bg}"/><circle cx="12" cy="12" r="10" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width="1"/>${body}`);
  const STAR_D = 'M12 4.6l2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.9l5-.7z';
  const PINS = [
    { id: 'star', zh: '星星', svg: pin('#f2b632', `<path d="${STAR_D}" fill="#fff6d6"/>`) },
    { id: 'heart', zh: '愛心', svg: pin('#ef6a85', `<path d="M12 18.2 6.6 12.9a3.4 3.4 0 0 1 4.8-4.8l.6.6.6-.6a3.4 3.4 0 0 1 4.8 4.8z" fill="#fff"/>`) },
    { id: 'candle', zh: '蠟燭', svg: pin('#d9874b', '<path d="M12 4.2c1.4 1.9 2.2 3.2 2.2 4.3a2.2 2.2 0 0 1-4.4 0c0-1.1.8-2.4 2.2-4.3z" fill="#fff3c8"/><rect x="9.3" y="11.2" width="5.4" height="8" rx="1.2" fill="#fff"/>') },
    { id: 'moon', zh: '月亮', svg: pin('#3e4f8f', '<path d="M14.6 5.2a7 7 0 1 0 4.2 11.6A6 6 0 0 1 14.6 5.2z" fill="#ffe9a8"/>') },
    { id: 'sun', zh: '太陽', svg: pin('#f08a3c', '<circle cx="12" cy="12" r="3.6" fill="#fff4cf"/><path d="M12 4.5v2.2M12 17.3v2.2M4.5 12h2.2M17.3 12h2.2M6.7 6.7l1.6 1.6M15.7 15.7l1.6 1.6M6.7 17.3l1.6-1.6M15.7 8.3l1.6-1.6" stroke="#fff4cf" stroke-width="1.6" stroke-linecap="round"/>') },
    { id: 'cloud', zh: '雲朵', svg: pin('#6fb3e0', '<path d="M7.6 16.6a3.2 3.2 0 0 1-.3-6.4 4.6 4.6 0 0 1 8.8-.9 3.6 3.6 0 0 1 .5 7.3z" fill="#fff"/>') },
    { id: 'butterfly', zh: '蝴蝶', svg: pin('#7b6cd9', '<path d="M12 8.6c-1.6-2.6-5.6-3.4-6.2-.8-.5 2.2 1.6 3.6 3.4 3.8-1.8.6-2.7 2.6-1.4 3.8 1.5 1.3 3.5-.4 4.2-2.6.7 2.2 2.7 3.9 4.2 2.6 1.3-1.2.4-3.2-1.4-3.8 1.8-.2 3.9-1.6 3.4-3.8-.6-2.6-4.6-1.8-6.2.8z" fill="#ffe0f2"/><path d="M12 8.2v8.6" stroke="#4b3fa6" stroke-width="1.1" stroke-linecap="round"/>') },
    { id: 'manta', zh: '魟魚', svg: pin('#2f8f9d', '<path d="M3.6 11.2c2.8-.4 5.2-2.6 8.4-2.6s5.6 2.2 8.4 2.6c-2.2 1.6-4.6 3-6.4 3.2L12 19.4l-2-5c-1.8-.2-4.2-1.6-6.4-3.2z" fill="#e7fbff"/><circle cx="10.4" cy="11" r=".7" fill="#2f8f9d"/><circle cx="13.6" cy="11" r=".7" fill="#2f8f9d"/>') },
    { id: 'crab', zh: '螃蟹', svg: pin('#c4473a', '<ellipse cx="12" cy="13.4" rx="4.6" ry="3.4" fill="#ffd9cf"/><path d="M7.4 13.4 4.6 15.6M7.6 15 5.4 17.8M16.6 13.4l2.8 2.2M16.4 15l2.2 2.8M8.6 10.6 6.8 7.2M15.4 10.6l1.8-3.4" stroke="#ffd9cf" stroke-width="1.3" stroke-linecap="round"/><circle cx="10.6" cy="12.6" r=".8" fill="#c4473a"/><circle cx="13.4" cy="12.6" r=".8" fill="#c4473a"/>') },
    { id: 'note', zh: '音符', svg: pin('#2c2c3a', '<path d="M10 16.4V7.2l7-1.6v8.6" stroke="#ffe9a8" stroke-width="1.6" fill="none" stroke-linejoin="round"/><circle cx="8.4" cy="16.6" r="2" fill="#ffe9a8"/><circle cx="15.4" cy="14.6" r="2" fill="#ffe9a8"/>') },
    { id: 'flower', zh: '花朵', svg: pin('#e58fb3', '<g fill="#fff3f8"><circle cx="12" cy="7.6" r="2.6"/><circle cx="16.2" cy="10.7" r="2.6"/><circle cx="14.6" cy="15.6" r="2.6"/><circle cx="9.4" cy="15.6" r="2.6"/><circle cx="7.8" cy="10.7" r="2.6"/></g><circle cx="12" cy="12" r="2.2" fill="#f2b632"/>') },
    { id: 'kid', zh: '光之子', svg: pin('#2c3a5c', '<circle cx="12" cy="8" r="2.8" fill="#f4ead8"/><path d="M7 19.4c.4-4.4 2.4-7.2 5-7.2s4.6 2.8 5 7.2z" fill="#f4ead8"/><path d="M12 12.4 4.8 17.6M12 12.4l7.2 5.2" stroke="#9fb6e8" stroke-width="1.3" stroke-linecap="round"/>') }
  ];

  // LINK — platforms a Sky account can be bound to. Simple monogram badges, not brand artwork.
  const mono = (bg, fg, text, size = 11) => svg(`<circle cx="12" cy="12" r="12" fill="${bg}"/><text x="12" y="12" dy=".36em" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${size}" fill="${fg}">${text}</text>`);
  const LINKS = [
    { id: 'gamecenter', name: 'Game Center', svg: svg('<circle cx="12" cy="12" r="12" fill="#fff"/><circle cx="9.4" cy="9" r="3.6" fill="#ff5fa2"/><circle cx="15" cy="9.6" r="3.2" fill="#ffc93c"/><circle cx="9.8" cy="15" r="3.2" fill="#38b6ff"/><circle cx="14.6" cy="15" r="3.6" fill="#57d36b" opacity=".92"/>') },
    { id: 'google', name: 'Google', svg: mono('#fff', '#4285f4', 'G', 14) },
    { id: 'apple', name: 'Apple', svg: svg('<circle cx="12" cy="12" r="12" fill="#111"/><path d="M12 8.6c1.2-1 2.6-1.2 3.6-.6 1.4.8 1.8 2.6 1.4 4.6-.5 2.6-2 5-3.6 5-.6 0-.9-.3-1.4-.3s-.8.3-1.4.3c-1.6 0-3.1-2.4-3.6-5-.4-2 0-3.8 1.4-4.6 1-.6 2.4-.4 3.6.6z" fill="#f2f2f2"/><path d="M12.2 8.2c0-1.6.8-2.6 2-3" stroke="#f2f2f2" stroke-width="1.2" stroke-linecap="round" fill="none"/>') },
    { id: 'facebook', name: 'Facebook', svg: mono('#1877f2', '#fff', 'f', 15) },
    { id: 'steam', name: 'Steam', svg: mono('#1b2838', '#c7d5e0', 'S', 13) },
    { id: 'nintendo', name: 'Nintendo', svg: mono('#e60012', '#fff', 'N', 13) },
    { id: 'playstation', name: 'PlayStation', svg: mono('#0070d1', '#fff', 'PS', 9.5) },
    { id: 'huawei', name: 'Huawei', svg: mono('#cf0a2c', '#fff', 'H', 13) },
    { id: 'twitch', name: 'Twitch', svg: mono('#9146ff', '#fff', 'T', 13) }
  ];

  // ── presets ───────────────────────────────────────────────────────────────
  const GRADIENTS = [
    { id: 'aurora', zh: '極光藍', stops: ['#0a1426', '#2850b4', '#73b2da'] },
    { id: 'twilight', zh: '暮光紫', stops: ['#150e28', '#6339b0', '#b673cf'] },
    { id: 'ocean', zh: '深海', stops: ['#08141d', '#106d86', '#69a9c9'] },
    { id: 'forest', zh: '森林', stops: ['#0a1712', '#1a663f', '#76913a'] },
    { id: 'ember', zh: '夕燼', stops: ['#22110d', '#a35029', '#d88f42'] },
    { id: 'berry', zh: '莓果', stops: ['#1b1221', '#90406e', '#8b69bf'] },
    { id: 'slate', zh: '霧岩', stops: ['#101924', '#4c5c70', '#98a6b6'] },
    { id: 'ruby', zh: '紅寶', stops: ['#280e13', '#a6343f', '#de7a81'] },
    { id: 'candy', zh: '糖雲', stops: ['#22111c', '#a24f7e', '#d293b4'] },
    { id: 'royal', zh: '皇家靛', stops: ['#0a1121', '#384aa0', '#8292d0'] },
    { id: 'coral', zh: '珊瑚沙', stops: ['#26170f', '#b35e34', '#dfa37a'] },
    { id: 'onyx', zh: '黑曜', stops: ['#0b0b0d', '#35353d', '#7e7e89'] },
    { id: 'plum', zh: '午夜梅', stops: ['#160b19', '#6c2b52', '#bf6c90'] },
    { id: 'zest', zh: '檸檬', stops: ['#1f1a0a', '#a87d1a', '#d8c372'] },
    { id: 'lava', zh: '熔岩', stops: ['#2a1010', '#bf4c3b', '#d8883a'] },
    { id: 'mint', zh: '薄荷葉', stops: ['#06201a', '#16805d', '#5ec99b'] }
  ];
  const gradientCSS = g => `linear-gradient(135deg, ${g.stops[0]} 0%, ${g.stops[1]} 48%, ${g.stops[2]} 100%)`;
  const SOLIDS = ['#1e3a5f', '#232a3d', '#2b2b33', '#3d2a1e', '#263d2f', '#4a2338', '#5b3a8c', '#c2622d', '#e2b25c', '#efe6d6', '#dfe7ee', '#f4d7dc'];

  const CJK = `'NaniFont', 'NaniFont Common', 'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif`;
  const FONTS = [
    { id: 'default', label: '預設', css: '' },
    { id: 'inter', label: 'Inter', css: `'Inter', ${CJK}` },
    { id: 'playfair', label: 'Playfair Display', css: `'Playfair Display', 'Noto Serif TC', ${CJK}` },
    { id: 'cinzel', label: 'Cinzel', css: `'Cinzel', 'Noto Serif TC', ${CJK}` },
    { id: 'jakarta', label: 'Plus Jakarta Sans', css: `'Plus Jakarta Sans', ${CJK}` },
    { id: 'cormorant', label: 'Cormorant Garamond', css: `'Cormorant Garamond', 'Noto Serif TC', ${CJK}` },
    { id: 'dmsans', label: 'DM Sans', css: `'DM Sans', ${CJK}` },
    { id: 'archivo', label: 'Archivo Black', css: `'Archivo Black', ${CJK}` },
    { id: 'barlow', label: 'Barlow Condensed', css: `'Barlow Condensed', ${CJK}` },
    { id: 'mono', label: 'JetBrains Mono', css: `'JetBrains Mono', ${CJK}` },
    { id: 'patrick', label: 'Patrick Hand', css: `'Patrick Hand', 'LXGW WenKai TC', ${CJK}` },
    { id: 'lora', label: 'Lora', css: `'Lora', 'Noto Serif TC', ${CJK}` },
    { id: 'notosans', label: '思源黑體', css: `'Noto Sans TC', ${CJK}` },
    { id: 'notoserif', label: '思源宋體', css: `'Noto Serif TC', ${CJK}` },
    { id: 'wenkai', label: '霞鶩文楷', css: `'LXGW WenKai TC', ${CJK}` },
    { id: 'nani', label: 'Nani 手寫', css: `'NaniFont', 'NaniFont Common', ${CJK}` }
  ];

  // ── procedural images (cached data URLs) ─────────────────────────────────
  function rng(seed) {
    let s = seed >>> 0;
    return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
  function vgrad(ctx, h, stops) { const g = ctx.createLinearGradient(0, 0, 0, h); stops.forEach(([o, c]) => g.addColorStop(o, c)); return g; }

  const WALLPAPERS = [
    { id: 'starry', zh: '星夜', draw(ctx, W, H, r) {
      ctx.fillStyle = vgrad(ctx, H, [[0, '#060a1c'], [.55, '#16224a'], [1, '#2e2a5a']]); ctx.fillRect(0, 0, W, H);
      const band = ctx.createLinearGradient(0, H * .2, W, H * .7); band.addColorStop(0, 'rgba(120,140,255,0)'); band.addColorStop(.5, 'rgba(170,160,255,.16)'); band.addColorStop(1, 'rgba(120,140,255,0)');
      ctx.fillStyle = band; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 420; i++) { const s = r() * 1.6 + .3; ctx.globalAlpha = .35 + r() * .65; ctx.fillStyle = r() > .85 ? '#ffe7b0' : '#fff'; ctx.beginPath(); ctx.arc(r() * W, r() * H, s, 0, 7); ctx.fill(); }
      ctx.globalAlpha = 1; ctx.fillStyle = '#0b0f24'; ctx.beginPath(); ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 20) ctx.lineTo(x, H * .86 - Math.sin(x / W * 5 + 1) * 26 - r() * 10); ctx.lineTo(W, H); ctx.fill();
    } },
    { id: 'clouds', zh: '雲海', draw(ctx, W, H, r) {
      ctx.fillStyle = vgrad(ctx, H, [[0, '#6fa8e6'], [.6, '#b9d8f2'], [1, '#f2e6dc']]); ctx.fillRect(0, 0, W, H);
      for (let layer = 0; layer < 4; layer++) {
        ctx.fillStyle = `rgba(255,255,255,${.5 + layer * .15})`;
        const y0 = H * (.55 + layer * .12);
        for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.arc(r() * W, y0 + r() * 40, 40 + r() * 70, 0, 7); ctx.fill(); }
        ctx.fillRect(0, y0 + 30, W, H);
      }
    } },
    { id: 'dunes', zh: '霞谷', draw(ctx, W, H, r) {
      ctx.fillStyle = vgrad(ctx, H, [[0, '#2a1640'], [.45, '#c4566a'], [.75, '#f2a35e'], [1, '#f7d08a']]); ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(255,236,190,.85)'; ctx.beginPath(); ctx.arc(W * .68, H * .5, W * .1, 0, 7); ctx.fill();
      ['#8a3d4f', '#5c2840', '#3a1a30'].forEach((c, i) => {
        ctx.fillStyle = c; ctx.beginPath(); ctx.moveTo(0, H); const base = H * (.62 + i * .1);
        for (let x = 0; x <= W; x += 10) ctx.lineTo(x, base - Math.sin(x / W * (3 + i) + i * 2) * (30 + i * 10)); ctx.lineTo(W, H); ctx.fill();
      });
    } },
    { id: 'aurora', zh: '極光', draw(ctx, W, H, r) {
      ctx.fillStyle = vgrad(ctx, H, [[0, '#030b14'], [1, '#0d2a33']]); ctx.fillRect(0, 0, W, H);
      [['rgba(80,255,180,', .5, .22], ['rgba(140,110,255,', .4, .34], ['rgba(60,200,255,', .35, .46]].forEach(([c, a, y]) => {
        for (let k = 0; k < 40; k++) {
          ctx.strokeStyle = c + (a * (1 - k / 40)) + ')'; ctx.lineWidth = 6; ctx.beginPath();
          for (let x = 0; x <= W; x += 12) { const yy = H * y + Math.sin(x / W * 6 + y * 9) * 40 + k * 6; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }
          ctx.stroke();
        }
      });
      for (let i = 0; i < 160; i++) { ctx.fillStyle = `rgba(255,255,255,${r() * .8})`; ctx.fillRect(r() * W, r() * H * .6, 1.4, 1.4); }
    } },
    { id: 'rain', zh: '雨林', draw(ctx, W, H, r) {
      ctx.fillStyle = vgrad(ctx, H, [[0, '#1c2a2c'], [.6, '#2e4740'], [1, '#41605a']]); ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(200,230,230,.18)'; ctx.lineWidth = 1.2;
      for (let i = 0; i < 360; i++) { const x = r() * W, y = r() * H, l = 18 + r() * 30; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - l * .22, y + l); ctx.stroke(); }
      for (let i = 0; i < 9; i++) { ctx.fillStyle = 'rgba(220,240,235,.06)'; ctx.fillRect(0, H * (.55 + i * .05), W, 30); }
    } },
    { id: 'candles', zh: '燭光', draw(ctx, W, H, r) {
      ctx.fillStyle = vgrad(ctx, H, [[0, '#120c08'], [1, '#2a1a10']]); ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 70; i++) {
        const x = r() * W, y = r() * H, s = 10 + r() * 46, g = ctx.createRadialGradient(x, y, 0, x, y, s);
        g.addColorStop(0, `rgba(255,${180 + r() * 50 | 0},110,${.25 + r() * .35})`); g.addColorStop(1, 'rgba(255,170,90,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, s, 0, 7); ctx.fill();
      }
    } }
  ];
  const wpCache = {};
  function wallpaperURL(id) {
    if (wpCache[id]) return wpCache[id];
    const wp = WALLPAPERS.find(w => w.id === id);
    if (!wp) return '';
    const [c, ctx] = canvas(720, 960);
    wp.draw(ctx, 720, 960, rng(id.length * 7919 + id.charCodeAt(0)));
    return (wpCache[id] = c.toDataURL('image/jpeg', .86));
  }

  // tileable textures for card surfaces
  const texCache = {};
  function textureURL(kind) {
    if (texCache[kind] !== undefined) return texCache[kind];
    const r = rng(kind.length * 131 + 17);
    let c, ctx;
    if (kind === 'grain') {
      [c, ctx] = canvas(128, 128);
      const img = ctx.createImageData(128, 128);
      for (let i = 0; i < img.data.length; i += 4) { const v = r() * 255 | 0; img.data[i] = img.data[i + 1] = img.data[i + 2] = v; img.data[i + 3] = 22; }
      ctx.putImageData(img, 0, 0);
    } else if (kind === 'linen') {
      [c, ctx] = canvas(64, 64);
      for (let i = 0; i < 64; i += 2) { ctx.fillStyle = `rgba(60,70,90,${.03 + r() * .04})`; ctx.fillRect(0, i, 64, 1); ctx.fillStyle = `rgba(60,70,90,${.02 + r() * .04})`; ctx.fillRect(i, 0, 1, 64); }
    } else if (kind === 'fleck') {
      [c, ctx] = canvas(160, 160);
      for (let i = 0; i < 140; i++) { ctx.fillStyle = r() > .5 ? `rgba(90,80,60,${.12 + r() * .2})` : `rgba(255,255,255,${.25 + r() * .3})`; ctx.save(); ctx.translate(r() * 160, r() * 160); ctx.rotate(r() * 3); ctx.fillRect(0, 0, 1 + r() * 3, .8 + r() * 1.2); ctx.restore(); }
    } else if (kind === 'ruled') {
      [c, ctx] = canvas(8, 28);
      ctx.fillStyle = 'rgba(70,110,160,.22)'; ctx.fillRect(0, 27, 8, 1);
    } else if (kind === 'crosshatch') {
      [c, ctx] = canvas(12, 12);
      ctx.strokeStyle = 'rgba(40,50,70,.07)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, 12); ctx.lineTo(12, 0); ctx.moveTo(0, 0); ctx.lineTo(12, 12); ctx.stroke();
    } else if (kind === 'dither') {
      [c, ctx] = canvas(4, 4);
      ctx.fillStyle = 'rgba(255,255,255,.035)'; ctx.fillRect(0, 0, 2, 2); ctx.fillRect(2, 2, 2, 2);
    } else { return (texCache[kind] = ''); }
    return (texCache[kind] = c.toDataURL('image/png'));
  }
  const PAPERS = [
    { id: 'plain', zh: '素面' }, { id: 'linen', zh: '布紋' }, { id: 'fleck', zh: '紙漿' }, { id: 'ruled', zh: '橫線' }, { id: 'crosshatch', zh: '斜紋' }
  ];

  window.CardData = {
    CATS, CAT_BY_ID, CLOSET_CATS, SEASONS, seasonName, seasonFull, parsePath, iconURL, loadCatalog,
    CURRENCIES, GLYPH, PINS, LINKS, GRADIENTS, gradientCSS, SOLIDS, FONTS,
    WALLPAPERS, wallpaperURL, textureURL, PAPERS
  };
})();
