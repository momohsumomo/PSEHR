"""Principal diagnosis for an outpatient claim.

V/W/X/Y and manifestation codes cannot be d19. The chart text stays whatever
the doctor typed. This module only reorders codes. It does not change the database.
The filing book is the FY2015 ICD-10-CM order file: T14.1 and T14.0 are not in it.
An unspecified injury is T1490.
"""

from __future__ import annotations

from src.core.icd_crosswalk import bare, dot_icd10, tables

_OPEN = ("knife", "lacer", "stab", "\u5200", "\u5272", "\u523a")
_FALL = ("fall", "contus", "bruise", "\u8dcc", "\u6454", "\u632b")
_CAR = ("motor", "traffic", "\u8eca\u798d", "\u4ea4\u901a")

_KNIFE = (
    ("\u5200\u5272\u50b7 - \u624b\u90e8/\u624b\u6307", "S61209A", "W260XXA"),
    ("\u5200\u5272\u50b7 - \u524d\u81c2/\u4e0a\u80a2", "S51809A", "W260XXA"),
    ("\u5200\u5272\u50b7 - \u672a\u660e\u793a\u90e8\u4f4d", "T1490", "W260XXA"),
)
_FALL_ROWS = (
    ("\u8dcc\u5012\u632b\u50b7 - \u672a\u660e\u793a\u90e8\u4f4d", "T1490", "W19XXXA"),
)
_CAR_ROWS = (
    ("\u8eca\u798d\u50b7 - \u672a\u660e\u793a\u90e8\u4f4d", "T1490", "V892XXA"),
)


def is_external(code: str) -> bool:
    text = bare(code)
    return len(text) >= 3 and text[0] in {"V", "W", "X", "Y"}


def is_manifestation(code: str) -> bool:
    title = tables().billable.get(bare(code), "").lower()
    return "classified elsewhere" in title


def is_legal_primary(code: str) -> bool:
    text = bare(code)
    if not text or text[0].isdigit():
        return True
    return not is_external(text) and not is_manifestation(text)


def _family(query: str) -> str:
    q = (query or "").strip().lower()
    compact = bare(query)
    if any(word in q for word in _OPEN) or compact.startswith("W26"):
        return "knife"
    if any(word in q for word in _FALL) or compact.startswith(("W00", "W01", "W18", "W19")):
        return "fall"
    if any(word in q for word in _CAR) or (compact.startswith("V") and len(compact) >= 3):
        return "car"
    return ""


def _title(code: str) -> str:
    return tables().billable.get(bare(code), "")


def _chapter_unspecified(code: str) -> str:
    prefix = bare(code)[:3]
    if len(prefix) < 3:
        return ""
    kids = []
    for key, title in tables().billable.items():
        if not key.startswith(prefix):
            continue
        low = title.lower()
        if "unspecified" not in low or "classified elsewhere" in low:
            continue
        if is_external(key):
            continue
        kids.append(key)
    initial = [key for key in kids if key.endswith("A")]
    pool = initial or kids
    if not pool:
        return ""
    return sorted(pool, key=lambda key: (len(key), key))[0]


def filler_code(text: str, code: str) -> str:
    """Billable stand-in when the chosen code cannot be the principal."""
    if _family(f"{text} {code}") in {"knife", "fall", "car"} or is_external(code):
        if "T1490" in tables().billable:
            return "T1490"
    found = _chapter_unspecified(code)
    if found:
        return found
    return "T1490" if "T1490" in tables().billable else ""


def primary_suggestions(query: str) -> list[dict]:
    family = _family(query)
    rows = {"knife": _KNIFE, "fall": _FALL_ROWS, "car": _CAR_ROWS}.get(family, ())
    out = []
    billable = tables().billable
    for label, principal, cause in rows:
        if principal not in billable or cause not in billable:
            continue
        out.append(
            {
                "name": label,
                "nameZh": label,
                "nameEn": _title(principal),
                "icd9": "",
                "icd10": dot_icd10(principal),
                "nhiIcd10": principal,
                "title": _title(principal),
                "secondary": [
                    {
                        "icd10": dot_icd10(cause),
                        "nhiIcd10": cause,
                        "title": _title(cause),
                    }
                ],
                "chiefNote": "",
            }
        )
    return out


def hide_from_primary_list(code: str) -> bool:
    text = bare(code)
    if not text:
        return True
    return is_external(text) or is_manifestation(text) or text[0].isdigit()


def arrange_codes(codes: list[str]) -> list[str]:
    rows = [{"icd10": code, "nhiIcd10": code, "text": ""} for code in codes if str(code or "").strip()]
    arranged = arrange_rows(rows)
    out = []
    for row in arranged:
        code = bare(str(row.get("nhiIcd10") or row.get("icd10") or ""))
        if code and code not in out:
            out.append(code)
    return out


def arrange_rows(rows: list[dict]) -> list[dict]:
    """Legal principal first. The typed disease name stays on its row."""
    kept = [dict(row) for row in rows if isinstance(row, dict)]
    if not kept:
        return []
    if is_legal_primary(str(kept[0].get("nhiIcd10") or kept[0].get("icd10") or "")):
        return kept
    for index in range(1, len(kept)):
        code = str(kept[index].get("nhiIcd10") or kept[index].get("icd10") or "")
        if is_legal_primary(code):
            return [kept[index], *kept[:index], *kept[index + 1 :]]
    source = kept[0]
    filler = filler_code(str(source.get("text") or ""), str(source.get("nhiIcd10") or source.get("icd10") or ""))
    if not filler or bare(filler) == bare(str(source.get("nhiIcd10") or source.get("icd10") or "")):
        return kept
    present = {bare(str(row.get("nhiIcd10") or row.get("icd10") or "")) for row in kept}
    if bare(filler) in present:
        return kept
    head = dict(source)
    head["icd10"] = dot_icd10(filler)
    head["nhiIcd10"] = filler
    head["text"] = source.get("text") or ""
    head["id"] = ""
    merged = [head, *kept]
    return merged[:5]
