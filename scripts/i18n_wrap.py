"""One-off helper: wrap plain single-quoted Chinese string literals in JS files with t('...').

Skips icon paths ('01_斗篷_Cape/...'), regex fragments and strings already wrapped. Template literals and
strings with variables are converted by hand.
usage: python scripts/i18n_wrap.py assets/js/card.js assets/js/card-data.js
"""
import re
import sys

CJK = r"[㐀-鿿＀-￯　-〿]"
LIT = re.compile(r"(?<![\w.$])'((?:[^'\\\n]|\\.)*" + CJK + r"(?:[^'\\\n]|\\.)*)'")

for path in sys.argv[1:]:
    src = open(path, encoding="utf-8").read()
    out, n = [], 0
    for line in src.split("\n"):
        stripped = line.lstrip()
        if stripped.startswith(("//", "*", "/*")):
            out.append(line)
            continue
        code, _, comment = line.partition(" // ")

        def rep(m):
            global n
            s = m.group(1)
            before = code[:m.start()]
            if re.match(r"\d\d_", s) or "/" in s or re.search(r"(?<![\w.$])t\($", before) or re.search(r"replace\(/[^/]*$", before):
                return m.group(0)
            n += 1
            return f"t('{s}')"

        code = LIT.sub(rep, code)
        out.append(code + (" // " + comment if comment else ""))
    open(path, "w", encoding="utf-8").write("\n".join(out))
    print(path, n, "literals wrapped")
