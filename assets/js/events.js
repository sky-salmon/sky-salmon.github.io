/* 活動雷達 — live countdowns for Sky's recurring events, converted to the viewer's local time. */
(function () {
  'use strict';

  /* ══════════════════════════════════════════════════════════════════════
   * SCHEDULE — edit here when the game changes.
   *
   * Every time below is GAME TIME: America/Los_Angeles (PT). Daylight
   * saving is resolved through Intl at runtime, never with fixed offsets.
   *
   *   hours    PT wall-clock hours (0–23) on which an occurrence starts
   *   minute   start minute inside that hour
   *   duration minutes the event stays active
   *   weekday  (resets) 0 = Sunday … 6 = Saturday
   *
   * If a PT wall-clock time does not exist (the skipped hour when DST
   * starts), that single occurrence is dropped.
   *
   * Times follow community-shared info and may change with game updates.
   * ══════════════════════════════════════════════════════════════════════ */
  const GAME_TZ = 'America/Los_Angeles';
  const EVEN_HOURS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22];

  const SCHEDULE = {
    recurring: [
      {
        id: 'geyser', name: '聖島間歇泉', en: 'Sanctuary Geyser', short: '間歇泉',
        place: '雲野 · 聖島', hours: EVEN_HOURS, minute: 5, duration: 10, color: '#d8a54c',
        desc: '清掉泉口周圍的黑暗植物，等泉水噴發，接住灑下來的燭蠟。'
      },
      {
        id: 'grandma', name: '奶奶的晚餐', en: "Grandma's Dinner", short: '奶奶',
        place: '雨林 · 高地空地', hours: EVEN_HOURS, minute: 35, duration: 10, color: '#d0604f',
        desc: '奶奶在雨林的空地擺好晚餐，點亮蠟燭坐在桌邊，一起收集光芒。'
      },
      {
        id: 'turtle', name: '聖島海龜', en: 'Sanctuary Turtle', short: '海龜',
        place: '雲野 · 聖島', hours: EVEN_HOURS, minute: 50, duration: 10, color: '#8fb07a',
        desc: '大海龜背上長滿黑暗植物，幫牠清乾淨，換來一場燭蠟雨。'
      }
    ],
    resets: [
      {
        id: 'daily', name: '每日重置', en: 'Daily Reset', short: '每日重置',
        hour: 0, minute: 0, color: '#e8e2d0',
        note: '每日任務、燭火與季節蠟燭重新整理。'
      },
      {
        id: 'weekly', name: '每週重置', en: 'Weekly Reset', short: '每週重置',
        weekday: 0, hour: 0, minute: 0, color: '#e8e2d0',
        note: '伊甸之眼 升華蠟燭上限重置。'
      }
    ]
  };
  /* ══════════════════════════════════════════════════════════════════════ */

  const store = (window.Site && window.Site.store) || { get: (k, f) => f, set: () => false };
  const toast = (window.Site && window.Site.toast) || (() => {});
  const $ = id => document.getElementById(id);
  const MIN = 60000, HOUR = 3600000, DAY = 86400000;
  const WD = ['日', '一', '二', '三', '四', '五', '六'];
  const pad = n => String(n).padStart(2, '0');
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ── time-zone math (Intl only) ──────────────────────────────────────── */
  const fmtCache = new Map();
  function partsFmt(tz) {
    if (!fmtCache.has(tz)) {
      fmtCache.set(tz, new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric'
      }));
    }
    return fmtCache.get(tz);
  }
  /** Wall-clock parts of an instant in a zone. */
  function zoneParts(ms, tz) {
    const o = {};
    for (const p of partsFmt(tz).formatToParts(ms)) if (p.type !== 'literal') o[p.type] = +p.value;
    return { y: o.year, mo: o.month, d: o.day, h: o.hour % 24, mi: o.minute, s: o.second };
  }
  /** Zone offset from UTC in minutes at an instant (PDT → -420). */
  function zoneOffset(ms, tz) {
    const p = zoneParts(ms, tz);
    const floored = Math.floor(ms / 1000) * 1000;
    return Math.round((Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - floored) / MIN);
  }
  /** Instant for a wall-clock time in a zone, or null if that time is skipped by DST. */
  function zonedToUtc(y, mo, d, h, mi, tz) {
    const naive = Date.UTC(y, mo - 1, d, h, mi);
    let t = naive - zoneOffset(naive, tz) * MIN;
    t = naive - zoneOffset(t, tz) * MIN;
    const p = zoneParts(t, tz), want = new Date(naive);
    if (p.y !== want.getUTCFullYear() || p.mo !== want.getUTCMonth() + 1 || p.d !== want.getUTCDate() || p.h !== h || p.mi !== mi) return null;
    return t;
  }
  /** PT calendar days covering [from, to], padded by one day each side. */
  function gameDays(from, to) {
    const a = zoneParts(from, GAME_TZ), b = zoneParts(to, GAME_TZ), out = [];
    const end = Date.UTC(b.y, b.mo - 1, b.d) + DAY;
    for (let t = Date.UTC(a.y, a.mo - 1, a.d) - DAY; t <= end; t += DAY) {
      const dt = new Date(t);
      out.push({ y: dt.getUTCFullYear(), mo: dt.getUTCMonth() + 1, d: dt.getUTCDate(), wd: dt.getUTCDay() });
    }
    return out;
  }
  function abbr(ms, tz) {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' }).formatToParts(ms);
      return (p.find(x => x.type === 'timeZoneName') || {}).value || '';
    } catch { return ''; }
  }
  function offsetLabel(min) {
    const sign = min < 0 ? '−' : '+', a = Math.abs(min);
    return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + pad(a % 60) : ''}`;
  }

  /* ── occurrences ─────────────────────────────────────────────────────── */
  function buildOccurrences(from, to) {
    const days = gameDays(from, to), out = [];
    for (const ev of SCHEDULE.recurring) {
      for (const day of days) for (const h of ev.hours) {
        const start = zonedToUtc(day.y, day.mo, day.d, h, ev.minute, GAME_TZ);
        if (start === null) continue;
        const end = start + ev.duration * MIN;
        if (end > from && start < to) out.push({ ev, kind: 'event', start, end, ptH: h, ptM: ev.minute });
      }
    }
    for (const ev of SCHEDULE.resets) {
      for (const day of days) {
        if (ev.weekday !== undefined && day.wd !== ev.weekday) continue;
        const start = zonedToUtc(day.y, day.mo, day.d, ev.hour, ev.minute, GAME_TZ);
        if (start === null || start < from || start >= to) continue;
        out.push({ ev, kind: 'reset', start, end: start, ptH: ev.hour, ptM: ev.minute });
      }
    }
    return out.sort((a, b) => a.start - b.start || a.end - b.end);
  }

  let cache = null;
  function occ(now) {
    if (!cache || Math.abs(now - cache.at) > HOUR) {
      cache = { at: now, list: buildOccurrences(now - 26 * HOUR, now + 8 * DAY) };
    }
    return cache.list;
  }
  const events = (now) => occ(now).filter(o => o.kind === 'event');
  function nextOf(ev, now) { return occ(now).find(o => o.ev === ev && o.end > now); }
  function prevOf(ev, now) {
    const l = occ(now); let p = null;
    for (const o of l) { if (o.ev !== ev) continue; if (o.end <= now) p = o; else break; }
    return p;
  }
  function nextReset(ev, now) { return occ(now).find(o => o.ev === ev && o.start > now); }
  function prevReset(ev, now) {
    let p = null;
    for (const o of occ(now)) { if (o.ev !== ev) continue; if (o.start <= now) p = o; else break; }
    return p;
  }

  /* ── formatting ──────────────────────────────────────────────────────── */
  const hm = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const hms = ms => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const localDate = ms => { const d = new Date(ms); return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} 週${WD[d.getDay()]}`; };
  const ptHM = (h, m) => `${pad(h)}:${pad(m)}`;
  function split(ms) {
    let s = Math.max(0, Math.ceil(ms / 1000));
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    return { d, h, m, s };
  }
  /** Countdown as HTML with dimmed separators: "07:42", "1:07:42", "3d 04:07:42". */
  function cd(ms) {
    const { d, h, m, s } = split(ms), sep = '<i>:</i>';
    if (d) return `${d}<small>d</small> ${pad(h)}${sep}${pad(m)}${sep}${pad(s)}`;
    if (h) return `${h}${sep}${pad(m)}${sep}${pad(s)}`;
    return `${pad(m)}${sep}${pad(s)}`;
  }
  function cdText(ms) {
    const { d, h, m, s } = split(ms);
    return [d && `${d} 天`, h && `${h} 小時`, (m || d || h) && `${m} 分`, `${s} 秒`].filter(Boolean).join(' ');
  }
  function setText(el, t) { if (el && el.textContent !== t) el.textContent = t; }
  function setHTML(el, h) { if (el && el._h !== h) { el.innerHTML = h; el._h = h; } }
  function setBar(el, f) { if (el) el.style.setProperty('--p', Math.max(0, Math.min(1, f)).toFixed(4)); }
  const reduceMotion = () => window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ── icons & art (original inline SVG) ───────────────────────────────── */
  const INK = '#1f1a16';
  const ICON = {
    pin: '<svg class="i-pin" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M8 14.6s4.6-4.3 4.6-8A4.6 4.6 0 0 0 3.4 6.6c0 3.7 4.6 8 4.6 8z"/><circle cx="8" cy="6.5" r="1.7"/></svg>',
    repeat: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 7V6a2.5 2.5 0 0 1 2.5-2.5h8"/><path d="M11 1.5l2 2-2 2"/><path d="M13.5 9v1a2.5 2.5 0 0 1-2.5 2.5H3"/><path d="M5 14.5l-2-2 2-2"/></svg>',
    geyser: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 20.5h17"/><path d="M9.5 20.5c.4-4 .2-7.6-.8-11M14.5 20.5c-.4-4-.2-7.6.8-11"/><path d="M8.7 9.5C6.4 9 5.8 6.4 7.6 5.3 8 3 11 2.4 12 4.3c1-1.9 4-1.3 4.4 1 1.8 1.1 1.2 3.7-1.1 4.2"/><path d="M5 13.2v.01M19 12.4v.01M4 9.8v.01M20.2 8.6v.01"/></svg>',
    grandma: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 12.5h17a8.5 7.5 0 0 1-17 0z"/><path d="M8 20.5h8"/><path d="M8.5 9.5c-.9-1.2.9-2.2 0-3.6M12 9.5c-.9-1.2.9-2.2 0-3.6M15.5 9.5c-.9-1.2.9-2.2 0-3.6"/></svg>',
    turtle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><ellipse cx="11" cy="13" rx="6.5" ry="5"/><path d="M17.3 11.6c1.4-1.6 3.6-1.1 3.9.6.3 1.6-1.5 2.5-3.6 2.1"/><path d="M6.8 16.8 5 19.4M14.8 16.9l1.7 2.5M6.6 9.4 5.2 7M14.6 9.2l1.4-2.4"/><path d="M8 11l3-1.6 3 1.6v3.2L11 16l-3-1.8z"/><path d="M4.6 13.6 2.8 14.4"/></svg>',
    daily: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12a8 8 0 0 0 14.3 4.9"/><path d="M20 12A8 8 0 0 0 5.7 7.1"/><path d="M5.4 3v4.3h4.3M18.6 21v-4.3h-4.3"/><path d="M12 8.5v3.8l2.4 1.4"/></svg>',
    weekly: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 9.5h17M8 3v4M16 3v4"/><path d="m12 11.8 1.1 2.2 2.4.3-1.8 1.7.5 2.4-2.2-1.2-2.2 1.2.5-2.4-1.8-1.7 2.4-.3z"/></svg>',
    moon: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M13.6 10.2A6 6 0 0 1 5.8 2.4a6 6 0 1 0 7.8 7.8z"/></svg>'
  };

  // Larger ink-on-paper illustrations for the hero ticket (viewBox 120×120).
  const ART = {
    geyser: `<svg viewBox="0 0 120 120" aria-hidden="true">
      <ellipse cx="60" cy="101" rx="46" ry="9" fill="#b9ae8a" stroke="${INK}" stroke-width="2"/>
      <path d="M30 100c3-6 10-8 15-6M90 100c-3-6-10-8-15-6" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round"/>
      <path d="M49 99c-1-21-2-37-6-55 9-6 25-6 34 0-4 18-5 34-6 55z" fill="#a9cfd1" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M55 92V62M65 86V56" stroke="#eef7f5" stroke-width="2.4" stroke-linecap="round"/>
      <path d="M43 44c-9-3-10-14-2-18 3-9 15-11 19-4 4-7 16-5 19 4 8 4 7 15-2 18" fill="#e9f3f0" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <g fill="#a9cfd1" stroke="${INK}" stroke-width="1.6"><circle cx="27" cy="38" r="3.2"/><circle cx="93" cy="34" r="3.6"/><circle cx="22" cy="58" r="2.4"/><circle cx="99" cy="56" r="2.6"/><circle cx="60" cy="9" r="2.6"/></g>
      <g fill="#f5c76b" stroke="${INK}" stroke-width="1.4"><path d="M33 20l1.6 3.4 3.4 1.6-3.4 1.6-1.6 3.4-1.6-3.4-3.4-1.6 3.4-1.6z"/><path d="M88 14l1.2 2.6 2.6 1.2-2.6 1.2-1.2 2.6-1.2-2.6-2.6-1.2 2.6-1.2z"/></g>
    </svg>`,
    grandma: `<svg viewBox="0 0 120 120" aria-hidden="true">
      <ellipse cx="60" cy="104" rx="46" ry="7" fill="#b9ae8a" stroke="${INK}" stroke-width="2"/>
      <path d="M22 64h76c0 21-17 36-38 36S22 85 22 64z" fill="#c9483b" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M30 78c8 6 18 9 30 9s22-3 30-9" fill="none" stroke="#f3d3a8" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="1 7"/>
      <ellipse cx="60" cy="64" rx="38" ry="8" fill="#f1dfb8" stroke="${INK}" stroke-width="2"/>
      <circle cx="49" cy="63" r="3.4" fill="#e9a34a" stroke="${INK}" stroke-width="1.4"/><circle cx="66" cy="62" r="2.8" fill="#9db77a" stroke="${INK}" stroke-width="1.4"/><circle cx="74" cy="65" r="2.2" fill="#e9a34a" stroke="${INK}" stroke-width="1.2"/>
      <path d="M44 50c-5-6 5-10 0-17M60 48c-5-7 5-11 0-19M76 50c-5-6 5-10 0-17" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity=".55"/>
      <path d="M91 40l14-22M96 42l13-21" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`,
    turtle: `<svg viewBox="0 0 120 120" aria-hidden="true">
      <path d="M8 96c10-5 20-5 30 0s20 5 30 0 20-5 30 0 14 4 18 2" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity=".45"/>
      <g fill="#9db77a" stroke="${INK}" stroke-width="2" stroke-linejoin="round">
        <path d="M34 50c-10-8-22-8-26-2 6 5 15 8 25 9z"/><path d="M34 76c-10 6-20 10-25 6 3-7 13-11 24-13z"/>
        <path d="M80 50c6-8 14-11 18-8-2 6-8 10-16 12z"/><path d="M80 76c6 7 13 10 17 7-2-6-8-10-15-11z"/>
        <ellipse cx="99" cy="63" rx="11" ry="9"/>
      </g>
      <circle cx="103" cy="60" r="1.8" fill="${INK}"/>
      <ellipse cx="58" cy="63" rx="30" ry="22" fill="#7d9a5f" stroke="${INK}" stroke-width="2"/>
      <path d="M58 46l11 7v13l-11 7-11-7V53z" fill="#a9c286" stroke="${INK}" stroke-width="1.8" stroke-linejoin="round"/>
      <path d="M47 53l-12-4M69 53l12-4M47 66l-12 5M69 66l12 5M58 73v11M58 46v-6" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"/>
      <g fill="#3b3a2c" stroke="${INK}" stroke-width="1.2"><path d="M40 44c-2-6 2-9 4-6"/><path d="M76 82c3 5 0 8-3 6"/></g>
    </svg>`,
    quiet: `<svg viewBox="0 0 120 120" aria-hidden="true">
      <path d="M78 26a30 30 0 1 0 22 46 26 26 0 0 1-22-46z" fill="#f2dfa8" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <g fill="#f5c76b" stroke="${INK}" stroke-width="1.4"><path d="M28 24l1.8 3.6 3.6 1.8-3.6 1.8-1.8 3.6-1.8-3.6-3.6-1.8 3.6-1.8z"/><path d="M98 18l1.2 2.4 2.4 1.2-2.4 1.2-1.2 2.4-1.2-2.4-2.4-1.2 2.4-1.2z"/><path d="M104 46l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/></g>
      <path d="M14 94c0-7 6-12 13-11 2-8 13-11 19-4 6-2 12 2 12 8 6 0 9 4 9 7z" fill="#e8e2d0" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      <path d="M58 84c2-5 10-7 14-2 5-1 9 3 9 7h-23" fill="#e8e2d0" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
    </svg>`
  };

  /* ── DOM refs ─────────────────────────────────────────────────────────── */
  const el = {
    pt: $('clock-pt'), ptDate: $('clock-pt-date'), ptAbbr: $('pt-abbr'),
    local: $('clock-local'), localDate: $('clock-local-date'), localAbbr: $('local-abbr'),
    live: $('live-ticket'), next: $('next-ticket'), dial: $('dial'), legend: $('legend'),
    grid: $('cycle-grid'), timeline: $('timeline'), tlSub: $('tl-sub'), tlFilters: $('tl-filters'), tlNow: $('tl-now'),
    resets: $('resets')
  };
  const localTZ = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } })();

  /* ── header clocks ───────────────────────────────────────────────────── */
  function renderClocks(now) {
    const p = zoneParts(now, GAME_TZ), off = zoneOffset(now, GAME_TZ);
    setText(el.pt, `${pad(p.h)}:${pad(p.mi)}:${pad(p.s)}`);
    el.pt.setAttribute('datetime', new Date(now).toISOString());
    const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay();
    setText(el.ptDate, `${pad(p.mo)}/${pad(p.d)} 週${WD[wd]} · ${offsetLabel(off)}`);
    setText(el.ptAbbr, abbr(now, GAME_TZ) || 'PT');
    setText(el.local, hms(now));
    el.local.setAttribute('datetime', new Date(now).toISOString());
    const loff = -new Date(now).getTimezoneOffset();
    setText(el.localAbbr, offsetLabel(loff));
    setText(el.localDate, localDate(now));
    el.localAbbr.title = localTZ;
  }

  /* ── hero tickets ────────────────────────────────────────────────────── */
  let heroKey = '', lastLiveKey = null;
  function serial(o) {
    const p = zoneParts(o.start, GAME_TZ);
    return `№ ${pad(p.mo)}${pad(p.d)}-${pad(o.ptH)}${pad(o.ptM)}`;
  }
  function renderHero(now) {
    const list = events(now);
    const live = list.filter(o => o.start <= now && now < o.end).sort((a, b) => a.end - b.end)[0] || null;
    const upcoming = list.filter(o => o.start > now);
    const main = live || upcoming[0];
    const next = live ? upcoming[0] : upcoming[1];
    const after = live ? upcoming[1] : upcoming[2];
    if (!main) return;

    const key = `${live ? 'L' : 'Q'}:${main.ev.id}:${main.start}|${next ? next.start + next.ev.id : ''}`;
    if (key !== heroKey) {
      heroKey = key;
      el.live.classList.toggle('is-quiet', !live);
      el.live.innerHTML = live ? `
        <div class="ev-t-top">
          <span class="chip is-red is-live">Live now</span>
          <span class="ev-t-serial mono">${serial(main)}</span>
        </div>
        <div class="ev-t-body">
          <div class="ev-t-text">
            <h2 class="ev-t-name">${esc(main.ev.name)}</h2>
            <p class="ev-t-en">${esc(main.ev.en)}</p>
            <p class="ev-place">${ICON.pin}${esc(main.ev.place)}</p>
          </div>
          <div class="ev-t-art">${ART[main.ev.id] || ''}</div>
        </div>
        <div class="ev-t-count">
          <span class="ev-t-label mono">Ends in · 距離結束</span>
          <span class="ev-t-cd mono" role="timer" data-cd></span>
        </div>
        <div class="ev-bar is-live" aria-hidden="true"><span></span></div>
        <div class="ev-t-foot mono"><span>${hm(main.start)} → ${hm(main.end)}</span><span>本地時間 · ${main.ev.duration} 分鐘</span></div>`
        : `
        <div class="ev-t-top">
          <span class="chip ev-quiet-chip">${ICON.moon}Quiet</span>
          <span class="ev-t-serial mono">${serial(main)}</span>
        </div>
        <div class="ev-t-body">
          <div class="ev-t-text">
            <p class="ev-t-quiet hand">此刻雲上很安靜，喝口水、整理一下背包吧。</p>
            <p class="ev-t-kicker mono">下一場 · Next</p>
            <h2 class="ev-t-name">${esc(main.ev.name)}</h2>
            <p class="ev-place">${ICON.pin}${esc(main.ev.place)}</p>
          </div>
          <div class="ev-t-art">${ART.quiet}</div>
        </div>
        <div class="ev-t-count">
          <span class="ev-t-label mono">Starts in · 距離開始</span>
          <span class="ev-t-cd mono" role="timer" data-cd></span>
        </div>
        <div class="ev-bar" aria-hidden="true"><span></span></div>
        <div class="ev-t-foot mono"><span>本地 ${hm(main.start)} 開始</span><span>持續 ${main.ev.duration} 分鐘</span></div>`;

      el.next.innerHTML = next ? `
        <div class="ev-n-main">
          <span class="ev-n-label mono">Next up · 接下來</span>
          <h3 class="ev-n-name"><span class="ev-n-icon" style="--c:${next.ev.color}">${ICON[next.ev.id]}</span>${esc(next.ev.name)}</h3>
          <p class="ev-place">${ICON.pin}${esc(next.ev.place)}<span class="ev-n-dot">·</span><span class="mono">本地 ${hm(next.start)}</span></p>
        </div>
        <div class="ev-n-side">
          <span class="ev-n-label mono">Starts in</span>
          <span class="ev-n-cd mono" role="timer" data-cd></span>
          ${after ? `<span class="ev-n-after hand">再來是 ${esc(after.ev.short)} ${hm(after.start)}</span>` : ''}
        </div>` : '';
    }

    // per-second bits
    const cdEl = el.live.querySelector('[data-cd]');
    const bar = el.live.querySelector('.ev-bar');
    if (live) {
      setHTML(cdEl, cd(live.end - now));
      cdEl.setAttribute('aria-label', `距離結束 ${cdText(live.end - now)}`);
      setBar(bar, (now - live.start) / (live.end - live.start));
    } else {
      const prev = prevOf(main.ev, now);
      const from = prev ? prev.end : main.start - 2 * HOUR;
      setHTML(cdEl, cd(main.start - now));
      cdEl.setAttribute('aria-label', `距離開始 ${cdText(main.start - now)}`);
      setBar(bar, (now - from) / (main.start - from));
    }
    const ncd = el.next.querySelector('[data-cd]');
    if (ncd && next) { setHTML(ncd, cd(next.start - now)); ncd.setAttribute('aria-label', `距離開始 ${cdText(next.start - now)}`); }

    const liveKey = live ? live.ev.id + live.start : '';
    if (lastLiveKey !== null && liveKey && liveKey !== lastLiveKey) toast(`✦ ${live.ev.name} 開始了！`, 3200);
    lastLiveKey = liveKey;
  }

  /* ── radar dial ──────────────────────────────────────────────────────── */
  const DIAL = { c: 160, r: 128, arcR: 104 };
  const polar = (deg, r) => {
    const a = (deg - 90) * Math.PI / 180;
    return [DIAL.c + r * Math.cos(a), DIAL.c + r * Math.sin(a)];
  };
  const fx = n => n.toFixed(2);
  function arcPath(m0, m1, r) {
    const a0 = m0 / 120 * 360, a1 = m1 / 120 * 360;
    const [x0, y0] = polar(a0, r), [x1, y1] = polar(a1, r);
    return `M${fx(x0)} ${fx(y0)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${fx(x1)} ${fx(y1)}`;
  }
  let dialHand = null, dialArcs = {}, dialMin = null, dialMinLabel = null, legendRows = {};
  function buildDial() {
    const { c, r, arcR } = DIAL;
    let ticks = '';
    for (let m = 0; m < 120; m += 2) {
      const major = m % 10 === 0, [x0, y0] = polar(m * 3, r), [x1, y1] = polar(m * 3, r - (major ? 11 : 5));
      ticks += `<line x1="${fx(x0)}" y1="${fx(y0)}" x2="${fx(x1)}" y2="${fx(y1)}" class="${major ? 'tk-major' : 'tk'}"/>`;
    }
    const labels = [[0, '00'], [30, '30'], [60, '60'], [90, '90']].map(([m, t]) => {
      const [x, y] = polar(m * 3, r + 15);
      return `<text x="${fx(x)}" y="${fx(y)}" class="dl-label">${t}′</text>`;
    }).join('');
    const arcs = SCHEDULE.recurring.map(ev =>
      `<path d="${arcPath(ev.minute, ev.minute + ev.duration, arcR)}" class="dl-arc" data-id="${ev.id}" style="--c:${ev.color}"/>`).join('');
    let sweep = '';
    for (let i = 0; i < 14; i++) {
      const a0 = -i * 2.4 - 2.4, a1 = -i * 2.4, [x0, y0] = polar(a0, r - 2), [x1, y1] = polar(a1, r - 2);
      sweep += `<path d="M${c} ${c}L${fx(x0)} ${fx(y0)}A${r - 2} ${r - 2} 0 0 1 ${fx(x1)} ${fx(y1)}Z" opacity="${(0.22 * (1 - i / 14)).toFixed(3)}"/>`;
    }
    el.dial.innerHTML = `<svg viewBox="-10 -10 340 340" role="img" aria-label="兩小時循環雷達：顯示三個週期活動在遊戲時間兩小時內的位置，以及現在的指針">
      <circle cx="${c}" cy="${c}" r="${r}" class="dl-face"/>
      <circle cx="${c}" cy="${c}" r="${arcR}" class="dl-track"/>
      <circle cx="${c}" cy="${c}" r="78" class="dl-ring"/><circle cx="${c}" cy="${c}" r="52" class="dl-ring"/>
      <line x1="${c}" y1="${c - r}" x2="${c}" y2="${c + r}" class="dl-cross"/><line x1="${c - r}" y1="${c}" x2="${c + r}" y2="${c}" class="dl-cross"/>
      ${ticks}${labels}${arcs}
      <g class="dl-hand"><g class="dl-sweep">${sweep}</g><line x1="${c}" y1="${c}" x2="${c}" y2="${c - r + 4}" class="dl-needle"/><circle cx="${c}" cy="${c - r + 4}" r="4.5" class="dl-tip"/></g>
      <circle cx="${c}" cy="${c}" r="38" class="dl-hub"/>
      <text x="${c}" y="${c + 4}" class="dl-min" id="dl-min">--′</text>
      <text x="${c}" y="${c + 22}" class="dl-min-label" id="dl-min-label">/ 120′</text>
    </svg>`;
    dialHand = el.dial.querySelector('.dl-hand');
    dialMin = el.dial.querySelector('#dl-min');
    dialMinLabel = el.dial.querySelector('#dl-min-label');
    el.dial.querySelectorAll('.dl-arc').forEach(p => { dialArcs[p.dataset.id] = p; });

    el.legend.innerHTML = SCHEDULE.recurring.map(ev => `
      <li data-id="${ev.id}"><span class="lg-dot" style="--c:${ev.color}"></span><span class="lg-name">${esc(ev.name)}</span>
      <span class="lg-win mono">:${pad(ev.minute)}–:${pad((ev.minute + ev.duration) % 60)}</span><span class="lg-state mono"></span></li>`).join('');
    el.legend.querySelectorAll('li').forEach(li => { legendRows[li.dataset.id] = li.querySelector('.lg-state'); });
  }
  function renderDial(now) {
    const p = zoneParts(now, GAME_TZ);
    const m = (p.h % 2) * 60 + p.mi + p.s / 60;
    dialHand.setAttribute('transform', `rotate(${(m * 3).toFixed(2)} ${DIAL.c} ${DIAL.c})`);
    setText(dialMin, `${Math.floor(m)}′`);
    setText(dialMinLabel, `${p.h % 2 ? '奇數時' : '偶數時'} / 120′`);
    for (const ev of SCHEDULE.recurring) {
      const o = nextOf(ev, now), isLive = o && o.start <= now;
      dialArcs[ev.id].classList.toggle('is-live', !!isLive);
      setText(legendRows[ev.id], o ? (isLive ? '進行中' : hm(o.start)) : '');
      legendRows[ev.id].classList.toggle('is-live', !!isLive);
    }
  }

  /* ── recurring cards ─────────────────────────────────────────────────── */
  const cards = {};
  function parityHint(o) {
    // How the PT even-hour rule looks in the viewer's zone (only meaningful for whole-hour differences).
    const diff = (-new Date(o.start).getTimezoneOffset()) - zoneOffset(o.start, GAME_TZ);
    if (diff === 0) return '';
    if (diff % 60 !== 0) return `你的時區：每 2 小時，於 :${pad(new Date(o.start).getMinutes())} 開始`;
    return `你的時區：逢${new Date(o.start).getHours() % 2 ? '奇' : '偶'}數整點`;
  }
  function buildCards() {
    el.grid.innerHTML = SCHEDULE.recurring.map(ev => `
      <article class="dashed-card ev-card" data-id="${ev.id}" style="--c:${ev.color}" aria-labelledby="card-${ev.id}-name">
        <span class="tape top" aria-hidden="true"></span>
        <div class="ev-card-top">
          <span class="chip" data-status></span>
          <span class="chip ev-win" data-win></span>
        </div>
        <div class="ev-card-count">
          <span class="ev-card-icon">${ICON[ev.id]}</span>
          <div>
            <span class="ev-card-cd mono" role="timer" data-cd></span>
            <span class="ev-card-cdl mono" data-cdl></span>
          </div>
        </div>
        <div class="ev-bar" aria-hidden="true"><span></span></div>
        <h3 class="ev-card-name" id="card-${ev.id}-name">${esc(ev.name)} <em>${esc(ev.en)}</em></h3>
        <p class="ev-card-desc">${esc(ev.desc)}</p>
        <div class="ev-card-meta">
          <span class="ev-rule">${ICON.repeat}<span>每 2 小時，於 :${pad(ev.minute)} 開始<small data-hint></small></span></span>
          <span class="ev-place">${ICON.pin}${esc(ev.place)}</span>
        </div>
      </article>`).join('') + `
      <aside class="dashed-card ev-card ev-note" aria-label="旅人筆記">
        <span class="tape top" aria-hidden="true"></span>
        <p class="ev-note-kicker mono">Field notes · 旅人筆記</p>
        <p class="ev-note-hand hand">一輪的順序：間歇泉 → 奶奶 → 海龜，剛好在整點前收尾，接著休息一小時。</p>
        <ol class="ev-note-strip" aria-label="遊戲時間偶數整點後的活動順序">
          ${SCHEDULE.recurring.map(ev => `<li style="--c:${ev.color};--s:${ev.minute};--d:${ev.duration}"><span>:${pad(ev.minute)}</span></li>`).join('')}
        </ol>
        <div class="ev-note-scale mono" aria-hidden="true"><span>:00</span><span>:30</span><span>+1h</span><span>+1:30</span><span>+2h</span></div>
        <p class="ev-note-small">倒數會自動換算成你裝置的時區；同一個活動要飛過去通常需要一點時間，記得提早出發。</p>
      </aside>`;
    el.grid.querySelectorAll('.ev-card[data-id]').forEach(card => {
      cards[card.dataset.id] = {
        card, status: card.querySelector('[data-status]'), win: card.querySelector('[data-win]'),
        cd: card.querySelector('[data-cd]'), cdl: card.querySelector('[data-cdl]'),
        bar: card.querySelector('.ev-bar'), hint: card.querySelector('[data-hint]')
      };
    });
  }
  function renderCards(now) {
    for (const ev of SCHEDULE.recurring) {
      const c = cards[ev.id], o = nextOf(ev, now);
      if (!o) continue;
      const live = o.start <= now, soon = !live && o.start - now <= 30 * MIN;
      c.card.classList.toggle('is-live', live);
      c.status.className = 'chip ' + (live ? 'is-ok is-live' : soon ? 'is-red' : 'ev-later');
      setText(c.status, live ? '進行中' : soon ? '即將開始' : '等待中');
      const s = new Date(o.start), e = new Date(o.end);
      setText(c.win, `:${pad(s.getMinutes())} – :${pad(e.getMinutes())} (${ev.duration}m)`);
      if (live) {
        setHTML(c.cd, cd(o.end - now));
        c.cd.setAttribute('aria-label', `距離結束 ${cdText(o.end - now)}`);
        setText(c.cdl, `距離結束 · ${hm(o.start)}–${hm(o.end)}`);
        setBar(c.bar, (now - o.start) / (o.end - o.start));
      } else {
        const prev = prevOf(ev, now), from = prev ? prev.end : o.start - 2 * HOUR;
        setHTML(c.cd, cd(o.start - now));
        c.cd.setAttribute('aria-label', `距離開始 ${cdText(o.start - now)}`);
        setText(c.cdl, `距離開始 · 本地 ${hm(o.start)}`);
        setBar(c.bar, (now - from) / (o.start - from));
      }
      c.bar.classList.toggle('is-live', live);
      const hint = parityHint(o);
      setText(c.hint, hint ? `（${hint}）` : '');
    }
  }

  /* ── today's timeline ────────────────────────────────────────────────── */
  const ALL_IDS = [...SCHEDULE.recurring.map(e => e.id), 'reset'];
  let filters = store.get('events.filters', null);
  if (!filters || typeof filters !== 'object') filters = {};
  ALL_IDS.forEach(id => { if (typeof filters[id] !== 'boolean') filters[id] = true; });
  let tlDay = '', tlItems = [], tlMarker = null, tlScrolled = false;

  function buildFilters() {
    const label = { reset: '重置' };
    el.tlFilters.innerHTML = ALL_IDS.map(id => {
      const ev = SCHEDULE.recurring.find(e => e.id === id);
      return `<button type="button" class="ev-filter" data-id="${id}" aria-pressed="${filters[id]}" style="--c:${ev ? ev.color : 'var(--ink-soft)'}"><span class="lg-dot"></span>${ev ? esc(ev.short) : label[id]}</button>`;
    }).join('');
    el.tlFilters.addEventListener('click', e => {
      const b = e.target.closest('.ev-filter'); if (!b) return;
      filters[b.dataset.id] = !filters[b.dataset.id];
      b.setAttribute('aria-pressed', filters[b.dataset.id]);
      store.set('events.filters', filters);
      tlDay = ''; renderTimeline(Date.now(), true);
    });
  }
  function dayBounds(now) {
    const a = new Date(now); a.setHours(0, 0, 0, 0);
    const b = new Date(a); b.setDate(b.getDate() + 1); b.setHours(0, 0, 0, 0);
    return [a.getTime(), b.getTime()];
  }
  function renderTimeline(now, scroll) {
    const [d0, d1] = dayBounds(now), key = String(d0);
    if (key !== tlDay) {
      tlDay = key;
      const list = occ(now).filter(o => o.start >= d0 && o.start < d1 && filters[o.kind === 'reset' ? 'reset' : o.ev.id]);
      setText(el.tlSub, `${localDate(now)} · ${localTZ || offsetLabel(-new Date(now).getTimezoneOffset())} · 共 ${list.length} 場`);
      el.timeline.innerHTML = list.length ? list.map((o, i) => {
        const isReset = o.kind === 'reset';
        return `<li class="tl-item${isReset ? ' is-reset' : ''}" data-i="${i}" style="--c:${o.ev.color}">
          <div class="tl-time"><b class="mono">${hm(o.start)}</b><span class="mono">PT ${ptHM(o.ptH, o.ptM)}</span></div>
          <span class="tl-dot" aria-hidden="true"></span>
          <div class="tl-body">
            <span class="tl-icon" aria-hidden="true">${ICON[o.ev.id]}</span>
            <div class="tl-text">
              <span class="tl-name">${esc(o.ev.name)}</span>
              <span class="tl-meta">${isReset ? esc(o.ev.note) : `${esc(o.ev.place)} · <span class="nw">${hm(o.start)}–${hm(o.end)}</span>`}</span>
            </div>
            <span class="tl-state chip" data-state></span>
          </div>
        </li>`;
      }).join('') : '<li class="tl-empty hand">今天沒有符合篩選的活動，打開上面的篩選看看吧。</li>';
      tlItems = list.map((o, i) => ({ o, li: el.timeline.querySelector(`[data-i="${i}"]`), state: '' }));
      tlMarker = document.createElement('li');
      tlMarker.className = 'tl-now';
      tlMarker.setAttribute('aria-label', '現在');
      tlMarker.innerHTML = '<span class="tl-now-time mono"></span><span class="tl-now-line" aria-hidden="true"></span>';
      tlMarker._at = -1;
      if (list.length) el.timeline.append(tlMarker);
      tlScrolled = false;
    }
    // statuses
    let firstFuture = tlItems.length;
    tlItems.forEach((it, i) => {
      const { o } = it;
      const st = o.kind === 'reset' ? (o.start <= now ? 'past' : 'future') : (o.end <= now ? 'past' : o.start <= now ? 'live' : 'future');
      if (st === 'future' && i < firstFuture) firstFuture = i;
      if (st !== it.state) {
        it.state = st;
        it.li.dataset.state = st;
        const chip = it.li.querySelector('[data-state]');
        chip.className = 'tl-state chip' + (st === 'live' ? ' is-ok is-live' : st === 'future' ? '' : ' is-past');
        chip.textContent = st === 'live' ? '進行中' : st === 'past' ? (o.kind === 'reset' ? '已重置' : '已結束') : '稍後';
        if (st === 'live') it.li.setAttribute('aria-current', 'true'); else it.li.removeAttribute('aria-current');
      }
    });
    if (tlItems.length && tlMarker) {
      if (tlMarker._at !== firstFuture) {
        tlMarker._at = firstFuture;
        const ref = tlItems[firstFuture] ? tlItems[firstFuture].li : null;
        el.timeline.insertBefore(tlMarker, ref);
      }
      setText(tlMarker.firstChild, hms(now));
    }
    if ((scroll || !tlScrolled) && !$('panel-today').hidden) scrollToNow(false);
  }
  function scrollToNow(smooth) {
    if (!tlMarker || !tlMarker.isConnected) return;
    const list = el.timeline;
    const top = tlMarker.offsetTop - list.clientHeight * 0.32;
    list.scrollTo({ top: Math.max(0, top), behavior: smooth && !reduceMotion() ? 'smooth' : 'auto' });
    tlScrolled = true;
  }

  /* ── resets ──────────────────────────────────────────────────────────── */
  const resetRefs = {};
  function buildResets() {
    el.resets.innerHTML = SCHEDULE.resets.map(ev => `
      <article class="ticket ev-reset" data-id="${ev.id}" aria-labelledby="reset-${ev.id}">
        <div class="ev-reset-main">
          <div class="ev-reset-top">
            <span class="ev-reset-icon">${ICON[ev.id]}</span>
            <div>
              <span class="ev-reset-kicker mono">${esc(ev.en)}</span>
              <h3 class="ev-reset-name" id="reset-${ev.id}">${esc(ev.name)}</h3>
            </div>
          </div>
          <span class="ev-reset-cd mono" role="timer" data-cd></span>
          <div class="ev-bar" aria-hidden="true"><span></span></div>
          ${ev.weekday !== undefined ? `<ol class="ev-week" aria-label="遊戲時間的本週進度" data-week>${WD.map(w => `<li>${w}</li>`).join('')}</ol>` : ''}
          <p class="ev-reset-note">${esc(ev.note)}</p>
        </div>
        <div class="ev-reset-stub">
          <span class="ev-reset-kicker mono">本地時間</span>
          <b class="ev-reset-time mono" data-time></b>
          <span class="ev-reset-date mono" data-date></span>
          <span class="ev-reset-pt mono">PT ${ev.weekday !== undefined ? '週日 ' : ''}${ptHM(ev.hour, ev.minute)}</span>
        </div>
      </article>`).join('');
    el.resets.querySelectorAll('.ev-reset').forEach(t => {
      resetRefs[t.dataset.id] = { cd: t.querySelector('[data-cd]'), bar: t.querySelector('.ev-bar'), time: t.querySelector('[data-time]'), date: t.querySelector('[data-date]'), week: t.querySelector('[data-week]') };
    });
  }
  function renderResets(now) {
    for (const ev of SCHEDULE.resets) {
      const r = resetRefs[ev.id], n = nextReset(ev, now), p = prevReset(ev, now);
      if (!n) continue;
      setHTML(r.cd, cd(n.start - now));
      r.cd.setAttribute('aria-label', `距離${ev.name} ${cdText(n.start - now)}`);
      const from = p ? p.start : n.start - (ev.weekday !== undefined ? 7 : 1) * DAY;
      setBar(r.bar, (now - from) / (n.start - from));
      setText(r.time, hm(n.start));
      setText(r.date, localDate(n.start));
      if (r.week) {
        const pp = zoneParts(now, GAME_TZ), wd = new Date(Date.UTC(pp.y, pp.mo - 1, pp.d)).getUTCDay();
        [...r.week.children].forEach((li, i) => {
          li.className = i < wd ? 'is-done' : i === wd ? 'is-today' : '';
        });
      }
    }
  }

  /* ── tabs ────────────────────────────────────────────────────────────── */
  const TABS = ['cycle', 'today', 'reset'];
  const tabBtns = TABS.map(t => $('tab-' + t));
  function selectTab(name, focus) {
    if (!TABS.includes(name)) name = 'cycle';
    TABS.forEach((t, i) => {
      const on = t === name;
      tabBtns[i].setAttribute('aria-selected', on);
      tabBtns[i].tabIndex = on ? 0 : -1;
      $('panel-' + t).hidden = !on;
    });
    if (focus) tabBtns[TABS.indexOf(name)].focus();
    store.set('events.tab', name);
    if (name === 'today') { renderTimeline(Date.now()); scrollToNow(false); }
  }
  tabBtns.forEach((b, i) => {
    b.addEventListener('click', () => selectTab(TABS[i]));
    b.addEventListener('keydown', e => {
      let j = null;
      if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') j = 0;
      else if (e.key === 'End') j = TABS.length - 1;
      if (j !== null) { e.preventDefault(); selectTab(TABS[j], true); }
    });
  });
  el.tlNow.addEventListener('click', () => scrollToNow(true));

  /* ── loop ────────────────────────────────────────────────────────────── */
  function tick() {
    const now = Date.now();
    renderClocks(now);
    renderHero(now);
    renderDial(now);
    renderCards(now);
    renderTimeline(now);
    renderResets(now);
  }
  let timer = 0;
  function loop() {
    tick();
    timer = setTimeout(loop, 1000 - (Date.now() % 1000) + 20);
  }
  function stop() { clearTimeout(timer); timer = 0; }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if (!timer) { cache = null; loop(); }
  });

  buildDial();
  buildCards();
  buildFilters();
  buildResets();
  const hashTab = location.hash.replace('#', '');
  selectTab(TABS.includes(hashTab) ? hashTab : store.get('events.tab', 'cycle'));
  if (!document.hidden) loop(); else tick();

  // Exposed for debugging and tests.
  window.EventsRadar = { SCHEDULE, zonedToUtc, zoneParts, buildOccurrences, tick };
})();
