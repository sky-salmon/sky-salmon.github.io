# Firebase (card cloud save, admin sign-in, feature access, feedback)

`card.html` can save a signed-in user's card to the cloud, and `admin.html` uses the same Google sign-in to decide
who may manage the site. Both use Firebase Authentication (Google) and Cloud Firestore on the free Spark plan; no
server code. Share links do not use Firebase: the card travels inside the link (`card#card=…`).

| File | What |
|---|---|
| `assets/js/firebase-config.js` | The project's web config (public identifiers, not secrets). `null` hides the cloud buttons. |
| `assets/js/cloud.js` | Card editor: sign-in, sync, share links; the account and access requests for restricted features. |
| `assets/js/card-value.js` | The 估價 tab: reads `gated/value`, or shows sign-in / request / pending. |
| `assets/js/site.js` | Every page: the feedback form (its own Firebase app, no sign-in). |
| `assets/js/admin.js` | Admin page: sign-in gate, admin list, the GitHub token it saves with; 權限 (features, model upload, requests) and 回饋 (feedback inbox). |
| `assets/js/vendor/firebase.js` | Firebase JS SDK (app, auth, firestore/lite), bundled with esbuild; loaded only when needed. |
| `firebase/firestore.rules` | Security rules: who can read and write what. Paste into the console (or `firebase deploy --only firestore:rules`). |

## Data

- `cards/{uid}`: the user's card as a JSON string (`data`). Only that user can read or write it. Documents are capped
  at 1 MiB; the editor refuses to sync a card whose images exceed that.
- `shares/{uid}`: legacy. Older share links (`card?s=<uid>`) stored the card here; they can still be read, and the
  owner's copy is deleted the next time they sign in. Nothing writes here any more.
- `config/admins`: `{ uids, labels }` — the accounts that may use `admin.html` (plus `rootAdmins()` in the rules, which
  can never be locked out). Admins only.
- `config/github`: `{ token, repo }` — the GitHub token and repository the admin page commits with. Admins only.
- `requests/{uid}`: an access request from a signed-in account that is not an admin yet; its `label` must be that
  account's own email. Admins approve or dismiss it in admin.html → 設定.
- `admin/{uid}`: legacy (a token per account, before `config/github`); only read once to migrate, then deleted.
- `access/{uid}`: `{ label, status, perms, createdAt, updatedAt }` — an account's request for restricted features. The
  account creates it (pending, no features, labelled with its own verified email) from the card editor's 估價 tab;
  only admins change it (admin.html → 權限: approve / deny, tick features) or delete it (the account may then ask again).
- `config/features`: `{ public: { feature: true } }` — restricted features an admin opened to everyone. Anyone can read it.
- `gated/{feature}`: `{ data, version, updatedAt }` — the data a restricted feature needs. `gated/value` is the
  account-value model (JSON string): readable by admins, by accounts approved with `perms.value`, or by everyone when
  `config/features.public.value` is on. Uploaded in admin.html → 權限 → 上傳估價模型.
- `feedback/{id}`: `{ kind, msg, page, contact, lang, status, createdAt }` — the site-wide feedback form (site.js). Anyone
  can create one well-formed message, nothing in it names an account; admins read, mark done and delete them in
  admin.html → 回饋.

After changing `firestore.rules`, paste it into the Firebase console (Firestore Database → Rules → Publish) or run
`firebase deploy --only firestore:rules`; the site's new features need the new rules to work.

## Setting up a project

1. https://console.firebase.google.com → Add project (Google Analytics not needed).
2. Build → Authentication → Get started → Sign-in method → Google → Enable.
   Settings → Authorized domains → add the site's domain (e.g. `<account>.github.io`; add the new one if the site moves).
3. Build → Firestore Database → Create database → Production mode, location `asia-east1` (Taiwan).
   Rules tab → paste `firebase/firestore.rules` → Publish.
4. Project settings → Your apps → Web (`</>`) → register → copy the `firebaseConfig` object into
   `assets/js/firebase-config.js` as `window.FIREBASE_CONFIG = {…};`.

## Rebuilding the SDK bundle

```bash
npm i firebase esbuild
cat > entry.js <<'JS'
export { initializeApp } from 'firebase/app';
export { initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserPopupRedirectResolver, GoogleAuthProvider,
  signInWithPopup, signInWithCredential, signOut, onAuthStateChanged, connectAuthEmulator } from 'firebase/auth';
export { getFirestore, doc, getDoc, setDoc, deleteDoc, collection, getDocs, serverTimestamp, connectFirestoreEmulator } from 'firebase/firestore/lite';
JS
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=eof --target=es2020 --outfile=assets/js/vendor/firebase.js
```

## Testing locally

`firebase emulators:start --only auth,firestore --project demo-candle` (uses `firebase.json`), then load the page with
`window.FIREBASE_EMULATOR = true` set before `cloud.js` runs and any config whose `projectId` is `demo-candle`.

`admin.html` has a Content-Security-Policy that names this project's `firebaseapp.com` host and does not allow the
emulator's `127.0.0.1` ports: testing it against the emulator needs the policy relaxed by the test harness, and a move
to another Firebase project needs the `frame-src` host in `admin.html` changed along with `firebase-config.js`.
