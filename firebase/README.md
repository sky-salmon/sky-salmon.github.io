# Firebase (card editor cloud save + share links)

`card.html` can save a signed-in user's card to the cloud and create share links. It uses Firebase
Authentication (Google sign-in) and Cloud Firestore on the free Spark plan; no server code.

| File | What |
|---|---|
| `assets/js/firebase-config.js` | The project's web config (public identifiers, not secrets). `null` hides the cloud buttons. |
| `assets/js/cloud.js` | Sign-in, sync and share logic. |
| `assets/js/vendor/firebase.js` | Firebase JS SDK (app, auth, firestore/lite), bundled with esbuild; loaded only when needed. |
| `firebase/firestore.rules` | Security rules: who can read and write what. Paste into the console (or `firebase deploy --only firestore:rules`). |

## Data

- `cards/{uid}`: the user's card as a JSON string (`data`). Only that user can read or write it.
- `shares/{uid}`: the card that user shared. Anyone with the link (`card.html?s=<uid>`) can read it; only the owner can
  change or delete it. One share per account, and nothing can be listed.
- Documents are capped at 1 MiB; the editor refuses to sync or share a card whose images exceed that.

## Setting up a project

1. https://console.firebase.google.com → Add project (Google Analytics not needed).
2. Build → Authentication → Get started → Sign-in method → Google → Enable.
   Settings → Authorized domains → add `chunhao0613.github.io`.
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
export { getFirestore, doc, getDoc, setDoc, deleteDoc, serverTimestamp, connectFirestoreEmulator } from 'firebase/firestore/lite';
JS
npx esbuild entry.js --bundle --format=esm --minify --legal-comments=eof --target=es2020 --outfile=assets/js/vendor/firebase.js
```

## Testing locally

`firebase emulators:start --only auth,firestore --project demo-candle` (uses `firebase.json`), then load the page with
`window.FIREBASE_EMULATOR = true` set before `cloud.js` runs and any config whose `projectId` is `demo-candle`.
