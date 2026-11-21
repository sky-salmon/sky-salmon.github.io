/* sky-salmon — restricted features on pages without the card editor's cloud.js (the 圖鑑's 3D try-on).
 * Load after firebase-config.js. Uses the default Firebase app, so a Google sign-in made on the card page carries over.
 *
 *   await Access.check('wardrobe3d')  → { ok: true } or { code: 'signin' | 'apply' | 'pending' | 'denied' | 'noperm' | 'offline', email }
 *   await Access.signIn()             → true when signed in (Google popup)
 *   await Access.request()            → asks the admins (access/{uid}, pending, no features)
 *
 * A feature is open to someone when the rules let them read gated/{feature} (firebase/firestore.rules: admins, accounts
 * approved for it, email addresses the admins listed, or everyone once the feature is public). The document itself
 * doesn't need to exist: a missing one still reads as allowed. */
(function () {
  'use strict';
  const t = window.I18N ? window.I18N.t : (s, v) => (v ? s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)) : s);
  const CFG = window.FIREBASE_CONFIG;
  const ENABLED = !!(CFG && CFG.apiKey && CFG.projectId && CFG.authDomain);
  const SDK_URL = new URL('vendor/firebase.js', document.currentScript.src).href;
  let fb = null, auth = null, db = null, sdk = null, authReady = null, user = null;

  function load() {
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
        authReady = new Promise(res => { let first = true; m.onAuthStateChanged(auth, u => { user = u; if (first) { first = false; res(u); } }); });
        return m;
      }).catch(e => { sdk = null; throw e; });
    }
    return sdk;
  }

  async function check(feature) {
    if (!ENABLED) return { code: 'offline' };
    try { await load(); await authReady; } catch { return { code: 'offline' }; }
    try {
      await fb.getDoc(fb.doc(db, 'gated', feature));
      return { ok: true };
    } catch (e) {
      if (e.code !== 'permission-denied') return { code: 'offline' };
      if (!user) return { code: 'signin' };
      let a = null;
      try { const s = await fb.getDoc(fb.doc(db, 'access', user.uid)); a = s.exists() ? s.data() : null; } catch { return { code: 'offline' }; }
      return { code: !a ? 'apply' : a.status === 'denied' ? 'denied' : a.status === 'approved' ? 'noperm' : 'pending', email: user.email || '' };
    }
  }
  async function signIn() {
    await load(); await authReady;
    try { await fb.signInWithPopup(auth, new fb.GoogleAuthProvider()); return true; } catch (e) {
      const code = e.code || '';
      if (!/popup-closed|cancelled-popup/.test(code) && window.Site && window.Site.toast) {
        window.Site.toast(/popup-blocked/.test(code) ? t('瀏覽器擋住了登入視窗，請允許彈出視窗後再試')
          : t('登入失敗，請稍後再試') + (code ? ` (${code.replace('auth/', '')})` : ''), 5000);
      }
      return false;
    }
  }
  async function request() {
    await load(); await authReady;
    if (!user) return false;
    await fb.setDoc(fb.doc(db, 'access', user.uid), { label: user.email || '', status: 'pending', perms: {}, createdAt: fb.serverTimestamp(), updatedAt: fb.serverTimestamp() });
    return true;
  }
  window.Access = { enabled: ENABLED, check, signIn, request };
  if (window.FIREBASE_EMULATOR) {  // test harness only: the emulator accepts unsigned Google credentials
    window.__accessTest = {
      signIn: async (sub, email) => { await load(); await authReady; await fb.signInWithCredential(auth, fb.GoogleAuthProvider.credential(JSON.stringify({ sub, email, email_verified: true, name: email.split('@')[0] }))); },
      uid: () => user && user.uid
    };
  }
})();
