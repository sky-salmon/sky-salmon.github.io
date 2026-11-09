#!/usr/bin/env python3
"""Cut NaniFont (23,739 glyphs, ~7.8 MB) down to what this site needs.

Outputs two files in assets/fonts/:
  NaniFont-subset.woff2  every character that appears in the site's HTML/JS/CSS
                         (plus ASCII and common CJK punctuation) — loaded on every page.
  NaniFont-common.woff2  the rest of Big5 level-1 (the ~5,400 everyday Traditional
                         Chinese characters) — only fetched when user-entered text
                         (card names, captions…) needs a character the first file lacks.

NaniFont is © 2016-2020 Nanigashitei, released under the SIL Open Font License 1.1
(no Reserved Font Name), which allows modified versions such as these subsets as long
as they stay under the OFL — see assets/fonts/OFL.txt.

Re-run after changing site copy:   pip install fonttools brotli && python3 scripts/subset_font.py
"""
from __future__ import annotations

import pathlib
import urllib.request

from fontTools import subset

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "assets" / "fonts"
CACHE = ROOT / ".cache" / "fonts"
VERSION = "1.036"
FONT_URL = f"https://cdn.jsdelivr.net/gh/max32002/nanifont@{VERSION}/webfont/NaniFont-Regular.woff2"

ALWAYS = "".join(chr(c) for c in range(32, 127)) + (
    "　、。〈〉《》「」『』【】〔〕・…—～‧·°±×÷≈≠≤≥←→↑↓↗↘■□●○◆◇★☆♡✦"
    "！＂＃＄％＆＇（）＊＋，－．／：；＜＝＞？＠［＼］＾＿｀｛｜｝０１２３４５６７８９"
)


def site_text() -> str:
    parts = []
    for pattern in ("*.html", "assets/**/*.js", "assets/**/*.css"):
        for path in ROOT.glob(pattern):
            parts.append(path.read_text(encoding="utf-8", errors="ignore"))
    return "".join(parts)


def big5_level1() -> set[str]:
    chars = set()
    for lead in range(0xA4, 0xC7):
        for trail in list(range(0x40, 0x7F)) + list(range(0xA1, 0xFF)):
            if (lead, trail) > (0xC6, 0x7E):
                break
            try:
                ch = bytes([lead, trail]).decode("big5")
            except UnicodeDecodeError:
                continue
            if "一" <= ch <= "鿿":
                chars.add(ch)
    return chars


def fetch_font() -> pathlib.Path:
    CACHE.mkdir(parents=True, exist_ok=True)
    path = CACHE / f"NaniFont-Regular-{VERSION}.woff2"
    if not path.exists():
        print(f"downloading {FONT_URL}")
        with urllib.request.urlopen(FONT_URL) as resp:
            path.write_bytes(resp.read())
    return path


def make_subset(src: pathlib.Path, chars: set[str], out: pathlib.Path) -> int:
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]          # keep copyright / license names
    opts.notdef_outline = True
    font = subset.load_font(str(src), opts)
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=[ord(c) for c in chars])
    sub.subset(font)
    present = set(font.getBestCmap())
    subset.save_font(font, str(out), opts)
    return len(present)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    src = fetch_font()
    used = {c for c in site_text() if not c.isspace()} | set(ALWAYS)
    common = big5_level1() - used
    n1 = make_subset(src, used, OUT / "NaniFont-subset.woff2")
    n2 = make_subset(src, common, OUT / "NaniFont-common.woff2")
    for name, n in (("NaniFont-subset.woff2", n1), ("NaniFont-common.woff2", n2)):
        size = (OUT / name).stat().st_size
        print(f"{name}: {n} chars, {size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
