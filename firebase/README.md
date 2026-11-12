# Firebase (card cloud save + admin sign-in)

`card.html` can save a signed-in user's card to the cloud, and `admin.html` uses the same Google sign-in to decide
who may manage the site. Both use Firebase Authentication (Google) and Cloud Firestore on the free Spark plan; no
server code. Share links do not use Firebase: the card travels inside the link (`card#card=…`).

| File | What |
|---|---|
| `assets/js/firebase-config.js` | The project's web config (public identifiers, not secrets). `null` hides the cloud buttons. |
| `assets/js/cloud.js` | Card editor: sign-in, sync, share links. |
| `assets/js/admin.js` | Admin page: sign-in gate, admin list, the GitHub token it saves with. |
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
