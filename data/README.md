# Catalogue data

Hand-maintained data for seasons, items and paid packs. This folder is the only place to edit it.
The card editor, its translations and the extraction tools in `sky-fish-mod` all read from here.

| File | What | Key |
|---|---|---|
| `seasons.json` | Season names (繁中 / 简中 / English), ultimate gifts, start and end dates | `code` (two digits; game data `season_NN` is the (NN−1)th season) |
| `items.json` | Corrections only: display names, category, season, hidden, needs-review reason | outfit internal name (`CharSkyKid_…`) |
| `packs.json` | Paid packs: names, USD price, contents, verification status | pack `id` (game IAP id, or `wiki:…` for retired packs) |

Each file starts with `_fields`, which explains every field.

## Editing

**Admin page:** `admin.html` on the site (not linked from the menu). Sign in with Google: admin accounts are listed in
Firestore (`config/admins`, approved from the page's Settings) plus `rootAdmins()` in `firebase/firestore.rules`.
The GitHub token and the repository to save to are kept in Firestore `config/github`, readable by admins only. Each
save is one commit on `main` (the three files plus `assets/js/seasons-data.js`). The repository defaults to the one
the site is published from (`<account>.github.io/<repo>/`), so the site can move to another GitHub account; change it
under Settings for a custom domain. Nothing secret is stored in the repo; GitHub's own write permission still decides
who can save.

The card editor reads these files at runtime and applies them over `assets/icons/icons.csv` (which keeps the game's
own values in `game_season` / `game_group`), so item, pack and season edits are live once GitHub Pages has rebuilt.

**By hand:** edit the JSON, then

```bash
python scripts/build_catalog.py      # validates the three files, regenerates assets/js/seasons-data.js
```

`build_catalog.py` also fills empty `zh_hans` season names with OpenCC; the admin page keeps the last converted name
and falls back to the Traditional text when the Traditional name changes.

New items arrive with a game update: admin.html → 遊戲更新 reads a new `Sky.apks` in the browser and commits the
changed icons, models and `assets/icons/icons.csv` (it tells changed files apart with `assets/content-hashes.json`,
which it also updates). The same can be done by hand in `sky-fish-mod` (it reads this folder from `../sky-cotl/data`,
or from `$SKY_DATA`):

```bash
python tools/sky_icon_extract.py game/<version>/apk/Sky.apks -o out/site_icons --flat
cp out/site_icons/icons.csv ../sky-cotl/assets/icons/icons.csv
```
