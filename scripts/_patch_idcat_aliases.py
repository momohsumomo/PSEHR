# -*- coding: utf-8 -*-
"""One-shot: fix aliases in import_yisheng_id_categories.py and re-run import."""
from pathlib import Path

p = Path(__file__).with_name("import_yisheng_id_categories.py")
text = p.read_text(encoding="utf-8", errors="replace")

old = '''ALIASES = {
    "d": "D",
    "s": "S",
    "c": "C",
    "a": "A",
    "b": "B",
'''
if '8914' not in text:
    text = text.replace(
        old,
        old
        + '    "\\u8914\\u4fdd": "\\u798f\\u4fdd",  # typo variant of FuBao\n',
    )

needle = "        known.add(code)\n\n    return settings"
insert = '''        known.add(code)

    for code in sorted(free_identities):
        if code and code not in known:
            add(code, deposit=0, reg_fee=0, copay=0)
            known.add(code)

    return settings'''
if "for code in sorted(free_identities)" not in text:
    text = text.replace(needle, insert)

p.write_text(text, encoding="utf-8")
print("patched", p)
