"""One-off: move the hand-maintained catalogue data into data/{seasons,items,packs}.json.

Before this, the same facts lived in several places: season names in sky-fish-mod/tools/sky_glb_package.py,
assets/js/card-data.js and i18n/en.json; ultimate gifts in sky-fish-mod/tools/season_ultimates.json; seasonal
corrections as SUPPLEMENT / FLAGS dicts in sky_season_pack.py; packs in sky-fish-mod/tools/iap_catalog.json.
usage: python scripts/migrate_catalog.py ../sky-fish-mod ../sky-fish-mod/game/0.35.2-426499/apk/x/split_initial.apk
"""
import csv
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FISH = Path(sys.argv[1]).resolve()
APK = Path(sys.argv[2]).resolve()
sys.path.insert(0, str(FISH / "tools"))
from sky_glb_package import SEASONS as ZH  # noqa: E402
from sky_season_pack import SUPPLEMENT, FLAGS  # noqa: E402

en = json.loads((ROOT / "i18n" / "en.json").read_text(encoding="utf-8"))
icons = list(csv.DictReader(open(ROOT / "assets" / "icons" / "icons.csv", encoding="utf-8-sig")))
od = {e["name"]: e for e in json.loads(zipfile.ZipFile(APK).read("assets/Data/Resources/OutfitDefs.json"))}
ult = json.loads((FISH / "tools" / "season_ultimates.json").read_text(encoding="utf-8"))["seasons"]
by_icon_season = {}
for r in icons:
    by_icon_season.setdefault((r["season"], r["icon"]), []).append(r["name"])
by_icon = {}
for r in icons:
    by_icon.setdefault(r["icon"], []).append(r["name"])

# ── seasons ────────────────────────────────────────────────────────────────
seasons = []
for n, zh in sorted(ZH.items()):
    code = f"{n:02d}"
    zh = zh.replace("(暫譯)", "")
    ultimates = []
    for icon in ult.get(code, []):
        names = by_icon_season.get((code, icon)) or by_icon.get(icon, [])
        ultimates += [x for x in names if od.get(x, {}).get("inCloset")]
    seasons.append({"code": code, "zh": zh, "zh_hans": "", "en": en.get(zh, en.get(zh + "季", "")),
                    "ultimates": list(dict.fromkeys(ultimates)), "start": "", "end": "",
                    "note": "暫譯：官方中文名稱尚未公布" if n == 32 else ""})

# ── items: only the corrections ────────────────────────────────────────────
items = {}
for name, (n, origin, conf) in SUPPLEMENT.items():
    items[name] = {"season": f"{n:02d}", "source": f"wiki: {origin}", "confidence": conf,
                   "note": "OutfitDefs 沒有季節標記，依 wiki 補上"}
for name, reason in FLAGS.items():
    items[name] = {"season": None, "unconfirmed": reason,
                   "note": f"OutfitDefs 標為 {od.get(name, {}).get('season', '')}，wiki 沒列在該季"}

# ── packs ──────────────────────────────────────────────────────────────────
packs = []
for p in json.loads((FISH / "tools" / "iap_catalog.json").read_text(encoding="utf-8"))["packs"]:
    tags = [od.get(i, {}).get("season", "") for i in p["items"]]
    tag = next((t for t in tags if t), "")
    packs.append({"id": p["id"], "name_en": p["name"], "name_zh": "", "usd": p["usd"], "items": p["items"],
                  "event": tag, "year": p.get("year", ""), "status": p["status"], "note": p.get("note", "")})

DATA = ROOT / "data"
DATA.mkdir(exist_ok=True)


def dump(name, about, fields, key, value):
    (DATA / name).write_text(json.dumps({"_about": about, "_fields": fields, key: value}, ensure_ascii=False, indent=1) + "\n",
                             encoding="utf-8")


dump("seasons.json", "季節清單：網站、翻譯與抽取腳本的唯一來源。code = 遊戲資料的 season_NN（第 NN-1 個季節）。",
     {"code": "兩位數季號", "zh": "繁中名（粉絲 wiki 譯名）", "zh_hans": "簡中名；留空時由 OpenCC 從 zh 轉換",
      "en": "英文名", "ultimates": "畢業禮（物品內部名稱）", "start": "開始日期 YYYY-MM-DD", "end": "結束日期", "note": "備註"},
     "seasons", seasons)
dump("items.json", "物品修正：只列需要覆寫遊戲資料的物品，key 是物品內部名稱（OutfitDefs name）。沒列到的欄位沿用遊戲資料。",
     {"name_zh": "繁中顯示名稱", "name_en": "英文顯示名稱", "group": "網站分類（pass/top/shoes/outfit/mask/face/neck/hair/head/ear/cape/prop）",
      "season": "季號；null = 不算季節物品", "hidden": "true = 網站不顯示", "unconfirmed": "待確認原因",
      "source": "資料來源", "confidence": "對應可信度", "note": "備註"},
     "items", items)
dump("packs.json", "內購禮包。usd 是整包價格；items 是禮包內容（物品內部名稱）。",
     {"id": "遊戲內購 ID（wiki-only 的以 wiki: 開頭）", "name_en": "英文名稱", "name_zh": "繁中名稱",
      "usd": "美金價格；null = 未知", "items": "內容物", "event": "季節或活動標記（遊戲資料，如 season_31、mischief_26）",
      "year": "年份", "status": "confirmed / game-only / wiki-only", "note": "備註"},
     "packs", packs)
print(len(seasons), "seasons,", sum(len(s["ultimates"]) for s in seasons), "ultimates;", len(items), "item overrides;",
      len(packs), "packs")
