# Catalogue data

Hand-maintained data for seasons, items and paid packs. This folder is the only place to edit it.
The card editor, its translations and the extraction tools in `sky-fish-mod` all read from here.

| File | What | Key |
|---|---|---|
| `seasons.json` | Season names (繁中 / 简中 / English), ultimate gifts, start and end dates | `code` (two digits; game data `season_NN` is the (NN−1)th season) |
| `items.json` | Corrections only: display names, category, season, hidden, needs-review reason | outfit internal name (`CharSkyKid_…`) |
| `packs.json` | Paid packs: names, USD price, contents, verification status | pack `id` (game IAP id, or `wiki:…` for retired packs) |

Each file starts with `_fields`, which explains every field.

## After editing

```bash
python scripts/build_catalog.py      # validates the three files, regenerates assets/js/seasons-data.js
```

Item and pack changes reach the site through the icon list. Rebuild it in `sky-fish-mod` (it reads this folder from
`../sky-cotl/data`, or from `$SKY_DATA`), then copy the CSV here:

```bash
python tools/sky_icon_extract.py game/<version>/apk/Sky.apks -o out/site_icons --flat
cp out/site_icons/icons.csv ../sky-cotl/assets/icons/icons.csv
```

Season-name changes only need `build_catalog.py`. New seasons and new items need the icon rebuild too, because
the icons come from the game files.
