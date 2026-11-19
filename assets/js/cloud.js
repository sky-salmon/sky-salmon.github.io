/* sky-salmon — cloud save and share links for the card editor (card.html), on Firebase.
 *
 * Load order: firebase-config.js, card.js, cloud.js. The Firebase SDK (vendor/firebase.js) is only fetched when this
 * device has signed in before, when someone opens the cloud or share dialog, or when a share link is opened, so the
 * editor itself works the same where Google services are unreachable.
 *
 * Data (rules: firebase/firestore.rules)
 *   cards/{uid}   { v: 1, data: JSON string {state, assets, lib}, updatedAt }   private to that user
 *   shares/{uid}  older share links (card.html?s=<uid>): still readable, no longer written (the owner's is deleted)
 *   access/{uid}  this account's request for restricted features (window.Cloud.requestAccess); admins decide
 * Share links now carry the card itself (#card=<deflate + base64url>), so nothing is stored anywhere.
 * Sync keeps one card per account. The hash of the last synced copy (per account) decides which side changed:
 * only this device → upload, only the cloud → download, both → ask. */
(function () {
  'use strict';
  const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
  const App = window.CardApp;
  if (!App) return;
  const { store, toast } = window.Site;
  const CFG = window.FIREBASE_CONFIG;
  const ENABLED = !!(CFG && CFG.apiKey && CFG.projectId && CFG.authDomain);
  const SDK_URL = new URL('vendor/firebase.js', document.currentScript.src).href;
  const ON_KEY = 'candle.cloud.on', BASE_KEY = 'candle.cloud.base';
  const MAX_BYTES = 990000;   // Firestore documents are capped at 1 MiB
  const PUSH_DELAY = 2500;

  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bytes = s => new TextEncoder().encode(s).length;
  function hash(str) {  // cyrb53: only compares copies, not a security measure
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  const payload = () => JSON.stringify(App.data(false));
  const base = uid => { const b = store.get(BASE_KEY, null); return b && b.uid === uid ? b.h : null; };
  const setBase = (uid, h) => store.set(BASE_KEY, { uid, h });

  // ── Firebase ──────────────────────────────────────────────────────────────
  let fb = null, auth = null, db = null, sdk = null, authReady = null;
  let user = null, ready = false;   // ready: this device's card has been reconciled with the cloud copy
  function loadSDK() {
    if (!sdk) {
      sdk = import(SDK_URL).then(m => {
        fb = m;
        const app = m.initializeApp(CFG);
        auth = m.initializeAuth(app, { persistence: [m.indexedDBLocalPersistence, m.browserLocalPersistence], popupRedirectResolver: m.browserPopupRedirectResolver });
        db = m.getFirestore(app);
        if (window.FIREBASE_EMULATOR) {  // local testing only (set by the test harness, never by the site)
          m.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
          m.connectFirestoreEmulator(db, '127.0.0.1', 8080);
        }
        authReady = new Promise(res => {
          let first = true;
          m.onAuthStateChanged(auth, u => {
            const was = user && user.uid;
            user = u;
            if (first) { first = false; res(u); return; }
            if (!u && was) { ready = false; setStatus('off'); }
            renderDialog();
          });
        });
        return m;
      }).catch(e => { sdk = null; throw e; });
    }
    return sdk;
  }
  const cardRef = () => fb.doc(db, 'cards', user.uid);
  const shareRef = id => fb.doc(db, 'shares', id);

  // ── sync ──────────────────────────────────────────────────────────────────
  let status = 'off', lastSync = 0, pushTimer = 0, pushing = false;
  function setStatus(s) {
    status = s;
    const dot = $('#cloud-dot'), cap = $('#cloud-cap'), btn = $('#btn-cloud');
    if (dot) dot.dataset.state = s;
    const label = { off: t('雲端'), busy: t('同步中'), dirty: t('同步中'), synced: t('已同步'), error: t('未同步'), toobig: t('未同步') }[s];
    if (cap) cap.textContent = label;
    if (btn) btn.setAttribute('aria-label', t('雲端存檔') + ' · ' + label);
    renderDialog();
  }
  function changed() {  // card.js saved the local copy
    if (!ready || !user || conflict || App.viewing()) return;   // an open conflict waits for the user's choice
    if (hash(payload()) === base(user.uid)) { if (status !== 'synced') setStatus('synced'); return; }
    if (status !== 'busy') setStatus('dirty');
    clearTimeout(pushTimer); pushTimer = setTimeout(push, PUSH_DELAY);
  }
  async function push() {
    clearTimeout(pushTimer);
    if (!user || !ready || conflict) return;
    if (pushing) { pushTimer = setTimeout(push, PUSH_DELAY); return; }
    const d = payload(), h = hash(d), uid = user.uid;
    if (bytes(d) > MAX_BYTES) { setStatus('toobig'); return; }
    pushing = true; setStatus('busy');
    try {
      await fb.setDoc(cardRef(), { v: 1, data: d, updatedAt: fb.serverTimestamp() });
      setBase(uid, h); lastSync = Date.now();
      if (hash(payload()) === h) setStatus('synced'); else { setStatus('dirty'); pushTimer = setTimeout(push, PUSH_DELAY); }
    } catch (e) {
      console.warn('cloud save failed', e); setStatus('error');
    } finally { pushing = false; }
  }
  function useCloud(remote, remoteHash) {
    if (!App.load(JSON.parse(remote), true)) { setStatus('error'); return; }
    const h = hash(payload());
    setBase(user.uid, h); lastSync = Date.now();
    if (h !== remoteHash) push(); else setStatus('synced');  // a copy from an older editor version: store it normalised
  }
  let conflict = null;
  async function reconcile() {
    if (!user || App.viewing()) return;
    ready = false; setStatus('busy');
    let snap;
    try { snap = await fb.getDoc(cardRef()); } catch (e) { console.warn('cloud read failed', e); setStatus('error'); return; }
    const local = payload(), L = hash(local), B = base(user.uid);
    ready = true;
    if (!reconcile.cleaned) { reconcile.cleaned = true; fb.deleteDoc(shareRef(user.uid)).catch(() => {}); }  // older stored share link
    if (!snap.exists()) { push(); return; }
    const remote = snap.data().data, C = hash(remote);
    if (L === C) { setBase(user.uid, C); lastSync = Date.now(); setStatus('synced'); return; }
    if (C === B) { push(); return; }                                  // only this device changed
    if (L === B || App.isSample()) { useCloud(remote, C); return; }   // only the cloud changed
    const at = snap.data().updatedAt;
    conflict = { remote, C, when: at && at.toDate ? at.toDate() : null };
    setStatus('dirty'); openDialog('conflict');
  }
  async function retry() { if (!user) return; if (!ready) await reconcile(); else await push(); }

  async function signIn() {
    try {
      await fb.signInWithPopup(auth, new fb.GoogleAuthProvider());
      store.set(ON_KEY, true);
      await reconcile();
      return true;
    } catch (e) {
      if (!/popup-closed|cancelled-popup/.test(e.code || '')) {
        console.warn('sign-in failed', e);
        const code = e.code || '';
        toast(/popup-blocked/.test(code) ? t('瀏覽器擋住了登入視窗，請允許彈出視窗後再試')
          : /unauthorized-domain/.test(code) ? t('這個網址還不能登入（Firebase 授權網域沒有設定）')
          : t('登入失敗，請稍後再試') + (code ? ` (${code.replace('auth/', '')})` : ''), 5000);
      }
      return false;
    }
  }
  async function signOut() {
    clearTimeout(pushTimer);
    if (ready && status === 'dirty') await push();
    store.set(ON_KEY, false);
    ready = false;
    await fb.signOut(auth);
    setStatus('off');
    toast(t('已登出，名片仍保留在這台裝置'));
  }

  // ── share links: the card itself goes in the link (#card=…), nothing is stored anywhere ──
  const b64url = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
  const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const pipe = async (u8, stream) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(stream)).arrayBuffer());
  const encodeCard = async obj => 'z' + b64url(await pipe(new TextEncoder().encode(JSON.stringify(obj)), new CompressionStream('deflate-raw')));
  async function decodeCard(code) {
    if (code[0] !== 'z') throw new Error('unknown share format');
    return JSON.parse(new TextDecoder().decode(await pipe(unb64url(code.slice(1)), new DecompressionStream('deflate-raw'))));
  }
  function shrink(url, max, type, q) {  // images in a link must be small: scale down and re-encode
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        let out = c.toDataURL(type, q);
        if (type === 'image/webp' && !out.startsWith('data:image/webp')) out = c.toDataURL('image/png');  // Safari can't write webp
        res(out);
      };
      img.onerror = () => res(null);
      img.src = url;
    });
  }
  async function makeShareLink() {
    const d = App.data(true), st = d.state, a = d.assets;
    let dropped = false;  // uploaded wallpapers are too big for a link: those designs fall back to their default background
    Object.entries(st.themes || {}).forEach(([design, th]) => {
      if (!(th && th.wp && !String(th.wp).startsWith('preset:'))) return;
      delete a[th.wp]; th.wp = null;
      if (th.mode === 'image') { th.mode = 'default'; if (design === st.design) dropped = true; }  // only warn when it shows
    });
    const avatar = st.profile && st.profile.avatar;
    for (const id of Object.keys(a)) {
      a[id] = id === avatar ? await shrink(a[id], 160, 'image/jpeg', 0.72) : await shrink(a[id], 64, 'image/webp', 0.8);
      if (!a[id]) delete a[id];
    }
    const base = window.Site.pageURL ? window.Site.pageURL() : location.origin + location.pathname;
    return { url: base + '#card=' + await encodeCard({ v: 1, state: st, assets: a }), dropped };
  }
  let shareLink = null;
  async function openShare(opener) {
    shareLink = null;
    openDialog('share', opener);
    try { shareLink = await makeShareLink(); } catch (e) { console.warn(e); shareLink = { error: true }; }
    renderDialog();
    if (shareLink && shareLink.url) copyLink(true);
  }
  async function copyLink(quiet) {
    const url = shareLink && shareLink.url;
    if (!url) return;
    try { await navigator.clipboard.writeText(url); toast(t('已複製分享連結')); }
    catch { if (quiet) return; const i = $('#cloud-link'); if (i) { i.focus(); i.select(); } toast(t('請長按連結手動複製')); }
  }

  // ── dialog ────────────────────────────────────────────────────────────────
  const modal = $('#cloud-modal');
  let view = null;  // 'account' | 'share' | 'conflict' | 'adopt'
  const inApp = /\b(Line|FBAN|FBAV|Instagram|MicroMessenger|KAKAOTALK|Threads)\b/i.test(navigator.userAgent);
  const fmtTime = d => (d ? d.toLocaleString(document.documentElement.lang || undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const ago = ts => { const s = Math.round((Date.now() - ts) / 1000); return s < 60 ? t('剛剛') : s < 3600 ? t('{n} 分鐘前', { n: Math.floor(s / 60) }) : fmtTime(new Date(ts)); };

  function openDialog(v, opener) {
    view = v;
    renderDialog();
    if (modal.hidden) App.openModal(modal, opener);
  }
  const btn = (id, label, cls = '', dis = false) => `<button type="button" class="btn btn-sm ${cls}" data-act="${id}"${dis ? ' disabled' : ''}>${label}</button>`;
  const GOOGLE = '<svg viewBox="0 0 18 18" aria-hidden="true" class="g-logo"><path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/><path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/><path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05z"/><path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/></svg>';

  function signInBody(why) {
    if (inApp) return `<p>${why}</p><p class="cloud-warn">${t('LINE、Instagram、Facebook 等 App 內建的瀏覽器不能用 Google 登入。請點右上角選單，改用 Safari 或 Chrome 開啟這一頁。')}</p>`;
    return `<p>${why}</p>
      <button type="button" class="btn g-btn" data-act="signin"${fb ? '' : ' disabled'}>${GOOGLE}<span>${fb ? t('用 Google 登入') : t('載入中…')}</span></button>
      <p class="hint">${t('只用你的 Google 帳號來辨認是誰的名片，不會公開你的名字或 Email。')}</p>`;
  }
  function renderDialog() {
    if (!modal || modal.hidden && !view) return;
    const title = $('#cloud-title'), body = $('#cloud-body'), foot = $('#cloud-foot');
    let h = '', f = '';
    if (view === 'conflict' && conflict) {
      title.textContent = t('要用哪一份名片？');
      h = `<p>${t('這台裝置上的名片和雲端上的不一樣。選一份繼續使用，另一份會被取代。')}</p>
        <div class="cloud-choice">
          <button type="button" class="cloud-opt" data-act="use-cloud"><b>${t('用雲端的')}</b><span>${conflict.when ? t('{time} 更新', { time: esc(fmtTime(conflict.when)) }) : ''}</span></button>
          <button type="button" class="cloud-opt" data-act="use-local"><b>${t('用這台裝置的')}</b><span>${t('目前畫面上的名片')}</span></button>
        </div>`;
    } else if (view === 'adopt') {
      title.textContent = t('用這張名片開始編輯？');
      h = `<p>${t('這會取代你在這台裝置上的名片。如果你有開雲端同步，雲端上的也會一起更新。')}</p>`;
      f = btn('close', t('取消')) + btn('adopt-yes', t('取代並開始編輯'), 'btn-primary');
    } else if (view === 'share') {
      title.textContent = t('分享名片');
      if (!shareLink) h = `<p class="hint">${t('產生連結中…')}</p>`;
      else if (shareLink.error) h = `<p>${t('這個瀏覽器無法產生分享連結，請換新版的 Chrome、Safari 或 Edge。')}</p>`;
      else {
        const kb = (shareLink.url.length / 1024).toFixed(1);
        h = `<p>${t('朋友打開這個連結就能看到你的名片，也能複製一份來改。名片內容直接寫在連結裡，不會存到任何伺服器。')}</p>
          <div class="cloud-link"><input class="input mono-input" id="cloud-link" readonly value="${esc(shareLink.url)}" aria-label="${t('分享連結')}">${btn('copy', t('複製'), 'btn-primary')}</div>
          <p class="hint">${t('連結是現在這張名片的樣子；之後改了名片，再按一次分享就會產生新的連結。')}${shareLink.dropped ? ' ' + t('上傳的背景圖太大，不會放進連結，朋友看到的是預設背景。') : ''}${shareLink.url.length > 8000 ? ' ' + t('連結比較長（{kb} KB），有些聊天軟體可能會截斷，可以改傳下載的圖片。', { kb }) : ''}</p>`;
      }
      f = (navigator.share && shareLink && shareLink.url ? btn('native-share', t('傳送…')) : '') + '<span class="spacer"></span>' + btn('close', t('關閉'));
    } else if (!user) {
      title.textContent = t('雲端存檔');
      h = signInBody(t('用 Google 帳號登入後，名片會自動存到雲端。換手機或電腦，登入同一個帳號就能接著編輯。'));
      f = btn('close', t('關閉'));
    } else {
      title.textContent = t('雲端存檔');
      const line = {
        synced: t('已同步 · {when}', { when: lastSync ? ago(lastSync) : t('剛剛') }), busy: t('同步中…'), dirty: t('有變更，稍後自動同步'),
        error: t('同步失敗：可能是網路連不到 Google 服務。名片仍保留在這台裝置。'), toobig: t('名片裡的圖片太大，無法存到雲端。換小一點的頭像、背景或自訂圖示後就會恢復同步。'), off: ''
      }[status] || '';
      h = `<div class="cloud-user"><span class="cloud-avatar" aria-hidden="true">${esc((user.displayName || user.email || '?').trim().charAt(0).toUpperCase())}</span>
          <span class="cloud-who"><b>${esc(user.displayName || '')}</b><small>${esc(user.email || '')}</small></span></div>
        <p class="cloud-status" data-state="${status}">${line}</p>
        <p class="hint">${t('登入後每次修改都會自動存到雲端，其他裝置登入同一個帳號就會看到。')}</p>`;
      f = btn('signout', t('登出')) + '<span class="spacer"></span>' + (status === 'error' || status === 'dirty' ? btn('retry', t('立即同步')) : '') + btn('to-share', t('分享名片'), 'btn-primary');
    }
    body.innerHTML = h;
    foot.innerHTML = f;
    foot.hidden = !f;
  }
  modal && modal.addEventListener('click', async e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const act = b.dataset.act;
    if (act === 'close') { App.closeModal(modal); return; }
    if (act === 'signin') { b.disabled = true; await signIn(); renderDialog(); return; }
    if (act === 'signout') { await signOut(); App.closeModal(modal); return; }
    if (act === 'retry') { retry(); return; }
    if (act === 'to-share') { openShare(); return; }
    if (act === 'copy') { copyLink(); return; }
    if (act === 'native-share') { navigator.share({ title: t('我的 Sky 名片'), url: shareLink.url }).catch(() => {}); return; }
    if (act === 'use-cloud' && conflict) { const c = conflict; conflict = null; useCloud(c.remote, c.C); view = 'account'; App.closeModal(modal); toast(t('已換成雲端的名片')); return; }
    if (act === 'use-local' && conflict) { conflict = null; push(); view = 'account'; App.closeModal(modal); toast(t('已用這台裝置的名片更新雲端')); return; }
    if (act === 'adopt-yes') { App.adopt(); return; }
  });
  modal && modal.addEventListener('modal-close', () => {
    if (conflict) setStatus('dirty');  // closed without choosing: nothing uploads until they choose (cloud button reopens it)
    view = null;
  });

  async function openFromToolbar(v, opener) {
    if (!ENABLED) { toast(t('雲端功能尚未啟用')); return; }
    if (v === 'account' && conflict) v = 'conflict';
    openDialog(v, opener);
    if (!fb) {
      try { await loadSDK(); await authReady; } catch (e) { console.warn(e); toast(t('連不到雲端服務，請檢查網路')); App.closeModal(modal); return; }
      if (user && !ready && !conflict) reconcile();
      renderDialog();
    }
  }

  // ── shared card view: #card=… (decoded here) or the older ?s=<uid> (read from Firestore) ──
  function sharedBanner(msg, ok) {
    const banner = $('#share-banner');
    const home = `<a class="btn btn-sm" href="${esc(location.pathname)}">${t('回到我的名片')}</a>`;
    banner.innerHTML = `<p>${msg}</p><div class="share-actions">${ok ? `<button type="button" class="btn btn-sm btn-primary" id="share-adopt">${t('複製一份來編輯')}</button>` : ''}${home}</div>`;
    banner.hidden = false;
    if (ok) $('#share-adopt').addEventListener('click', e => { if (App.ownIsSample()) App.adopt(); else openDialog('adopt', e.currentTarget); });
  }
  async function openSharedCode(code) {
    try {
      const d = await decodeCard(code);
      if (!App.load(d, false)) throw new Error('bad card');
      sharedBanner(t('這是別人分享的名片，你可以下載圖片，或複製一份來編輯。'), true);
    } catch (e) { console.warn(e); sharedBanner(t('這個分享連結不完整或已損壞，請對方重新分享一次。'), false); }
  }
  async function openShared(id) {
    const banner = $('#share-banner');
    const say = (msg, actions) => { banner.innerHTML = `<p>${msg}</p>${actions ? `<div class="share-actions">${actions}</div>` : ''}`; banner.hidden = false; };
    const home = `<a class="btn btn-sm" href="${esc(location.pathname)}">${t('回到我的名片')}</a>`;
    if (!ENABLED) { say(t('分享功能尚未啟用。'), home); return; }
    say(t('正在讀取分享的名片…'));
    try {
      await loadSDK();
      const s = await fb.getDoc(shareRef(id));
      if (!s.exists()) { say(t('這個分享連結已失效：對方可能已經停止分享。'), home); return; }
      App.load(JSON.parse(s.data().data), false);
      say(t('這是別人分享的名片，你可以下載圖片，或複製一份來編輯。'),
        `<button type="button" class="btn btn-sm btn-primary" id="share-adopt">${t('複製一份來編輯')}</button>${home}`);
      $('#share-adopt').addEventListener('click', e => { if (App.ownIsSample()) App.adopt(); else openDialog('adopt', e.currentTarget); });
    } catch (e) {
      console.warn(e);
      say(t('讀不到分享的名片：可能是網路連不到 Google 服務，請稍後再試。'), home);
    }
  }

  // ── the account, for restricted features (card-value.js) ──────────────────
  async function account() {
    if (!ENABLED) throw Object.assign(new Error('cloud disabled'), { code: 'offline' });
    await loadSDK(); await authReady;
    return { fb, db, user };
  }
  async function accountSignIn() { await loadSDK(); await authReady; return signIn(); }
  const accessRef = () => fb.doc(db, 'access', user.uid);
  async function accessStatus() {   // null = this account hasn't asked yet
    const snap = await fb.getDoc(accessRef());
    return snap.exists() ? snap.data() : null;
  }
  async function requestAccess() {  // pending until an admin approves it in admin.html → 權限
    await fb.setDoc(accessRef(), { label: user.email || '', status: 'pending', perms: {}, createdAt: fb.serverTimestamp(), updatedAt: fb.serverTimestamp() });
    return { status: 'pending', perms: {} };
  }

  // ── start ─────────────────────────────────────────────────────────────────
  window.Cloud = { changed, account, signIn: accountSignIn, accessStatus, requestAccess };
  if (window.FIREBASE_EMULATOR) {  // test harness only: the emulator accepts unsigned Google credentials, no popup needed
    window.__cloudTest = {
      signIn: async (sub, email) => {
        await loadSDK(); await authReady;
        await fb.signInWithCredential(auth, fb.GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: email.split('@')[0] })));
        store.set(ON_KEY, true); await reconcile(); renderDialog();
      },
      status: () => status, uid: () => user && user.uid
    };
  }
  document.querySelectorAll('[data-cloud-only]').forEach(el => { el.hidden = !ENABLED; });
  const code = App.shareCode && App.shareCode();
  if (code) { openSharedCode(code); return; }
  const sid = App.viewing();
  if (sid) { openShared(sid); return; }
  $('#btn-share').addEventListener('click', e => openShare(e.currentTarget));
  if (!ENABLED) return;
  $('#btn-cloud').addEventListener('click', e => openFromToolbar('account', e.currentTarget));
  if (store.get(ON_KEY, false)) {
    loadSDK().then(() => authReady).then(u => { if (u) reconcile(); else store.set(ON_KEY, false); })
      .catch(e => { console.warn('cloud unavailable', e); setStatus('error'); });
  }
  // last chance to save when the page goes to the background (phones rarely fire unload)
  // and coming back to the tab: pick up what another device saved meanwhile (one read)
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') { if (status === 'dirty' && ready) push(); return; }
    if (user && ready && status === 'synced' && modal.hidden && Date.now() - lastCheck > 30000) { lastCheck = Date.now(); reconcile(); }
  });
})();
