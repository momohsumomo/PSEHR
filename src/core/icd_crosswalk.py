"""ICD-9-CM to one billable ICD-10-CM for NHI claims.

Sources (public CMS/CDC files under data/icd/):
- 2018 ICD-9-CM to ICD-10-CM GEM (last official diagnosis GEM)
- FY2015 ICD-10-CM order file (codes effective 2014-10-01, the set NHI adopted)
- CMS32 ICD-9-CM long titles

A typed ICD-10 is returned as itself. A typed ICD-9 always yields one
billable ICD-10. Laterality, depth, and a cause the chart does not state
are not invented. When the ICD-10 title does not carry the ICD-9 meaning,
chief_note is one sentence for the chart's chief complaint.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_ICD = _ROOT / "data" / "icd"

_BARE = re.compile(r"[^A-Z0-9]")
_STOP = frozenset(
    """
    a an and by classified due elsewhere for from in including of on or other
    site the to type with without not
    """.split()
)
_SYN = {
    "solar": "uv",
    "sun": "uv",
    "sunlight": "uv",
    "ultraviolet": "uv",
    "eczema": "dermatitis",
}
_AXIS = (
    "left",
    "right",
    "drug",
    "phototoxic",
    "photoallergic",
    "photocontact",
    "allergic",
    "irritant",
    "berloque",
    "bone",
    "muscle",
    "necrosis",
    "heel",
    "calf",
    "thigh",
    "hip",
    "knee",
    "toe",
    "shoulder",
    "elbow",
    "wrist",
    "finger",
    "scalp",
    "buttock",
    "sacrum",
    "back",
    "head",
    "face",
    "neck",
    "chest",
    "abdomen",
    "coccyx",
    "trunk",
    "ankle",
    "leg",
    "foot",
    "hand",
    "arm",
    "eye",
    "ear",
)
_PAIRED = ("ankle", "leg", "foot", "hand", "arm", "eye", "ear", "heel", "knee", "hip")
_CHAPTER_FALLBACK = {
    "L": "L989",
    "A": "B949",
    "B": "B949",
    "C": "C809",
    "D": "D499",
    "E": "E889",
    "F": "F99",
    "G": "G98",
    "H": "H579",
    "I": "I99",
    "J": "J989",
    "K": "K929",
    "M": "M999",
    "N": "N399",
    "O": "O9989",
    "P": "P969",
    "Q": "Q899",
    "R": "R69",
    "S": "T1490",
    "T": "T1490",
    "V": "Y99",
    "W": "Y99",
    "X": "Y99",
    "Y": "Y99",
    "Z": "Z769",
}


@dataclass
class Crosswalk:
    input_kind: str
    kind: str
    icd10: str
    nhi_icd10: str
    title: str
    secondary: list[dict[str, str]] = field(default_factory=list)
    chief_note: str = ""
    review: bool = False

    def as_dict(self) -> dict:
        return {
            "inputKind": self.input_kind,
            "kind": self.kind,
            "icd10": self.icd10,
            "nhiIcd10": self.nhi_icd10,
            "title": self.title,
            "secondary": self.secondary,
            "chiefNote": self.chief_note,
            "review": self.review,
        }


def bare(code: str) -> str:
    return _BARE.sub("", (code or "").upper())


def dot_icd10(code: str) -> str:
    c = bare(code)
    if len(c) <= 3:
        return c
    return c[:3] + "." + c[3:]


def dot_icd9(code: str) -> str:
    c = bare(code)
    if c.startswith("E"):
        if len(c) <= 4:
            return c
        return c[:4] + "." + c[4:]
    if len(c) <= 3:
        return c
    return c[:3] + "." + c[3:]


def _tokens(title: str) -> frozenset[str]:
    words = re.findall(r"[a-z0-9]+", (title or "").lower())
    out = []
    for w in words:
        if w in _STOP or w == "unspecified":
            continue
        out.append(_SYN.get(w, w))
    return frozenset(out)


def _axis_penalty(source_title: str, target_title: str) -> int:
    src = source_title.lower()
    tgt = target_title.lower()
    pen = 0
    for w in _AXIS:
        if re.search(rf"\b{re.escape(w)}\b", tgt) and not re.search(rf"\b{re.escape(w)}\b", src):
            pen += 8
    if "fat layer" in tgt and "fat" not in src:
        pen += 8
    for stage in ("stage 1", "stage 2", "stage 3", "stage 4"):
        if stage in tgt and stage not in src:
            pen += 8
    if "chronic" in tgt and "acute" in src and "chronic" not in src:
        pen += 6
    if "acute" in tgt and "chronic" in src and "acute" not in src:
        pen += 6
    if "unspecified" in tgt and "unspecified" not in src:
        pen += 1
    return pen


def _score(source_title: str, target_title: str, source_tokens: frozenset[str] | None = None) -> int:
    st = source_tokens if source_tokens is not None else _tokens(source_title)
    overlap = len(st & _tokens(target_title))
    return overlap * 5 - _axis_penalty(source_title, target_title)


def _chapter_letters(icd9: str) -> str:
    c = bare(icd9)
    if c.startswith("V"):
        return "Z"
    if c.startswith("E"):
        return "VWXY"
    digits = re.match(r"\d{3}", c)
    if not digits:
        return "R"
    n = int(digits.group(0))
    ranges = (
        (1, 139, "AB"),
        (140, 239, "CD"),
        (240, 279, "DE"),
        (280, 289, "D"),
        (290, 319, "F"),
        (320, 359, "G"),
        (360, 389, "H"),
        (390, 459, "I"),
        (460, 519, "J"),
        (520, 579, "K"),
        (580, 629, "N"),
        (630, 679, "O"),
        (680, 709, "L"),
        (710, 739, "M"),
        (740, 759, "Q"),
        (760, 779, "P"),
        (780, 799, "R"),
        (800, 999, "ST"),
    )
    for lo, hi, letters in ranges:
        if lo <= n <= hi:
            return letters
    return "R"


def _note_suffix(source_title: str, target_title: str, kind: str) -> str:
    src = source_title.lower()
    tgt = target_title.lower()
    parts: list[str] = []
    if "unspecified" in tgt and not any(w in src for w in ("left", "right", "unspecified")):
        if any(w in tgt for w in _PAIRED):
            parts.append("\u672a\u8a18\u5de6\u53f3")
    if "unspecified severity" in tgt or "unspecified stage" in tgt:
        parts.append("\u672a\u8a18\u6df1\u5ea6")
    if "contact dermatitis" in src and "unspecified cause" in tgt:
        parts.append("\u672a\u5206\u904e\u654f\u6216\u523a\u6fc0")
    elif "unspecified cause" in tgt and "unspecified cause" not in src:
        parts.append("\u672a\u5206\u539f\u56e0")
    if not parts and kind in ("approximate", "choice"):
        parts.append("\u672a\u518d\u7d30\u5206")
    if kind == "nomap":
        parts.append("\u6b64\u78bc\u5728 ICD-10 \u7121\u540c\u7fa9\u78bc")
    if not parts:
        return ""
    return "\uff0c" + "\u8207".join(parts)


@dataclass
class _Tables:
    gem: dict[str, list[tuple[str, str]]]
    icd9_title: dict[str, str]
    billable: dict[str, str]
    extra: dict[str, str]
    zh: dict[str, str]
    zh_cm: dict[str, str]
    by_letter: dict[str, list[tuple[str, str, frozenset[str]]]]


def _load() -> _Tables:
    gem: dict[str, list[tuple[str, str]]] = {}
    gem_path = _ICD / "2018_I9gem.txt"
    for raw in gem_path.read_text(encoding="utf-8", errors="replace").splitlines():
        if len(raw) < 19:
            continue
        src = raw[0:5].strip()
        tgt = raw[6:13].strip()
        flags = raw[14:19]
        if not src or not tgt:
            continue
        gem.setdefault(src, []).append((tgt, flags))

    icd9_title: dict[str, str] = {}
    dx_path = _ICD / "CMS32_DESC_LONG_DX.txt"
    for raw in dx_path.read_text(encoding="latin-1", errors="replace").splitlines():
        raw = raw.strip()
        if not raw:
            continue
        code, _, title = raw.partition(" ")
        code = bare(code)
        if code and title.strip():
            icd9_title[code] = title.strip()

    billable: dict[str, str] = {}
    order_path = _ICD / "fy2015" / "icd10cm_order_2015.txt"
    for raw in order_path.read_text(encoding="latin-1", errors="replace").splitlines():
        if len(raw) < 16:
            continue
        code = bare(raw[6:13])
        flag = raw[14:15]
        long_title = raw[76:].strip() if len(raw) > 76 else raw[16:].strip()
        if flag == "1" and code and long_title:
            billable[code] = long_title

    extra: dict[str, str] = {}
    extra_path = _ICD / "codes" / "icd10cm_codes_2018.txt"
    if extra_path.is_file():
        for raw in extra_path.read_text(encoding="latin-1", errors="replace").splitlines():
            raw = raw.strip()
            if not raw:
                continue
            code, _, title = raw.partition(" ")
            code = bare(code)
            title = title.strip()
            if code and title and code not in billable:
                extra[code] = title

    zh: dict[str, str] = {}
    zh_cm: dict[str, str] = {}
    zh_path = _ICD / "yisheng_icd9_zh.json"
    if zh_path.is_file():
        loaded = json.loads(zh_path.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            zh = {bare(str(k)): str(v).strip() for k, v in loaded.items() if str(v).strip()}

    cm_path = _ICD / "icd9_cm_zh.json"
    if cm_path.is_file():
        loaded_cm = json.loads(cm_path.read_text(encoding="utf-8"))
        if isinstance(loaded_cm, dict):
            zh_cm = {bare(str(k)): str(v).strip() for k, v in loaded_cm.items() if str(v).strip()}

    by_letter: dict[str, list[tuple[str, str, frozenset[str]]]] = {}
    for code, title in billable.items():
        by_letter.setdefault(code[0], []).append((code, title, _tokens(title)))
    return _Tables(gem, icd9_title, billable, extra, zh, zh_cm, by_letter)


@lru_cache(maxsize=1)
def tables() -> _Tables:
    return _load()


def _title_of(code: str) -> str:
    data = tables()
    c = bare(code)
    return data.billable.get(c) or data.extra.get(c, "")


def _finish(
    icd9: str,
    claim: str,
    kind: str,
    review: bool,
    text: str | None,
    secondary: list[str] | None = None,
) -> Crosswalk:
    src_title = tables().icd9_title.get(icd9, "")
    nhi = bare(claim)
    if nhi not in tables().billable:
        nhi = _snap(nhi, src_title)
    shown = (text or "").strip()
    if shown and bare(shown) != icd9 and bare(shown) != nhi:
        label = shown
    else:
        label = tables().zh.get(icd9) or src_title or dot_icd9(icd9)
    suffix = _note_suffix(src_title, _title_of(nhi), kind)
    note = ""
    if kind not in ("icd10", "identical"):
        note = f"ICD-9 {dot_icd9(icd9)} {label}{suffix}".strip()
    secs = []
    for sec in secondary or []:
        sc = bare(sec)
        if sc not in tables().billable:
            sc = _snap(sc, src_title)
        if not sc or sc == nhi:
            continue
        secs.append({"icd10": dot_icd10(sc), "nhiIcd10": sc, "title": _title_of(sc)})
    return Crosswalk(
        input_kind="icd9",
        kind=kind,
        icd10=dot_icd10(nhi),
        nhi_icd10=nhi,
        title=_title_of(nhi),
        secondary=secs,
        chief_note=note,
        review=review,
    )


def _snap(code: str, hint: str) -> str:
    data = tables()
    c = bare(code)
    if c in data.billable:
        return c
    while len(c) > 2:
        c = c[:-1]
        kids = [k for k in data.billable if k.startswith(c)]
        if not kids:
            continue
        if c in data.billable and len(kids) == 1:
            return c
        return _best(kids, hint) or kids[0]
    letter = bare(code)[:1] or "R"
    fb = _CHAPTER_FALLBACK.get(letter, "R69")
    if fb in data.billable:
        return fb
    if "R69" in data.billable:
        return "R69"
    return fb


def _best(codes: list[str], source_title: str) -> str:
    data = tables()
    st = _tokens(source_title)
    ranked = []
    for code in codes:
        title = data.billable.get(code, "")
        if not title:
            continue
        ranked.append((_score(source_title, title, st), title.lower().count("unspecified"), code))
    if not ranked:
        return ""
    ranked.sort(key=lambda item: (-item[0], -item[1], len(item[2]), item[2]))
    return ranked[0][2]


def _search_chapter(icd9: str, source_title: str) -> tuple[str, int]:
    data = tables()
    letters = _chapter_letters(icd9)
    st = _tokens(source_title)
    best_key = None
    best_score = 0
    best_code = ""
    for letter in letters:
        for code, title, tokens in data.by_letter.get(letter, []):
            score = len(st & tokens) * 5 - _axis_penalty(source_title, title)
            key = (-score, -title.lower().count("unspecified"), len(code), code)
            if best_key is None or key < best_key:
                best_key = key
                best_score = score
                best_code = code
    if best_code and best_score > 0:
        return best_code, best_score
    letter = letters[:1] or "R"
    fb = _CHAPTER_FALLBACK.get(letter, "R69")
    if fb not in data.billable:
        fb = _snap(letter, source_title)
    return fb, 0


def _icd10_hit(code: str) -> Crosswalk | None:
    data = tables()
    c = bare(code)
    if not c or c[0].isdigit():
        return None
    if c in data.billable:
        return Crosswalk(
            input_kind="icd10",
            kind="icd10",
            icd10=dot_icd10(c),
            nhi_icd10=c,
            title=data.billable[c],
        )
    kids = [k for k in data.billable if k.startswith(c)]
    if not kids:
        return None
    # Category header: unspecified child, not a guessed site.
    unspec = [k for k in kids if "unspecified" in data.billable[k].lower()]
    pick = sorted(unspec or kids, key=lambda k: (len(k), k))[0]
    return Crosswalk(
        input_kind="icd10",
        kind="icd10",
        icd10=dot_icd10(pick),
        nhi_icd10=pick,
        title=data.billable[pick],
    )


def _resolve_icd9(code: str, text: str | None) -> Crosswalk:
    data = tables()
    c = bare(code)
    if c not in data.gem:
        kids = [k for k in data.gem if k.startswith(c) and len(k) <= 5]
        nines = [k for k in kids if k.endswith("9")]
        if len(kids) == 1:
            c = kids[0]
        elif len(nines) == 1:
            c = nines[0]
        else:
            title = (text or "").strip() or data.icd9_title.get(bare(code), "")
            found, score = _search_chapter(bare(code) or "780", title or "unspecified")
            return _finish(bare(code), found, "nomap", True, text)

    rows = data.gem.get(c, [])
    src_title = data.icd9_title.get(c, "")
    if any(flags[1] == "1" or tgt.upper() == "NODX" for tgt, flags in rows):
        found, _score_n = _search_chapter(c, src_title)
        return _finish(c, found, "nomap", True, text)

    plain = [(tgt, flags) for tgt, flags in rows if flags[2] == "0"]
    combo = [(tgt, flags) for tgt, flags in rows if flags[2] == "1"]
    plain_targets = list(dict.fromkeys(tgt for tgt, _flags in plain))

    if len(plain_targets) == 1 and not combo:
        tgt = plain_targets[0]
        approx = plain[0][1][0] == "1"
        return _finish(c, tgt, "approximate" if approx else "identical", False, text)

    if combo and not plain_targets:
        scenario = min(flags[3] for _tgt, flags in combo)
        chosen = [(tgt, flags) for tgt, flags in combo if flags[3] == scenario]
        lists: dict[str, list[str]] = {}
        for tgt, flags in chosen:
            lists.setdefault(flags[4], []).append(tgt)
        picked = []
        for key in sorted(lists):
            options = lists[key]
            safe = [t for t in options if _score(src_title, _title_of(t) or t) > -8]
            pool = safe or options
            picked.append(_best(pool, src_title) or pool[0])
        organisms = [t for t in picked if bare(t).startswith(("B95", "B96", "B97"))]
        manifestations = [
            t for t in picked
            if "classified elsewhere" in (_title_of(t) or "").lower()
        ]
        diseases = [t for t in picked if t not in organisms and t not in manifestations]
        if diseases:
            primary = _best(diseases, src_title) or diseases[0]
        elif picked:
            primary = picked[0]
        else:
            primary = c
        secondary = [t for t in picked if t != primary]
        return _finish(c, primary, "combination", False, text, secondary)

    # One ICD-9, several ICD-10s: keep the code that does not add a new axis.
    ranked = []
    for tgt in plain_targets:
        title = _title_of(tgt)
        ranked.append((_score(src_title, title or tgt), (title or "").lower().count("unspecified"), tgt))
    ranked.sort(key=lambda item: (-item[0], -item[1], len(item[2]), item[2]))
    if ranked and ranked[0][0] > 0:
        return _finish(c, ranked[0][2], "choice", False, text)
    found, score = _search_chapter(c, src_title)
    return _finish(c, found, "kept", score <= 0, text)


def search_codes(query: str, limit: int = 25) -> list[dict]:
    """Find ICD-9 / ICD-10 by Chinese name, English title, or code.

    A combination ICD-9 keeps every required ICD-10 in ``secondary`` so the
    clinic can write one or both.
    """
    q = (query or "").strip()
    if not q:
        return []
    data = tables()
    compact = bare(q)
    needle = q.lower()
    scored: list[tuple[int, str, str]] = []

    for code, title in data.zh.items():
        score = 0
        if title == q or title.lower() == needle:
            score = 400
        elif title.startswith(q):
            score = 280
        elif needle in title.lower():
            score = 180
        if compact and code == compact:
            score = max(score, 360)
        elif compact and len(compact) >= 3 and code.startswith(compact):
            score = max(score, 150)
        if score:
            scored.append((score, code, title))

    looks_icd9 = bool(compact) and (compact[0].isdigit() or compact[0] in ("V", "E"))
    if looks_icd9:
        prefix_hits = 0
        for code, title in data.icd9_title.items():
            if code == compact:
                scored.append((340, code, data.zh.get(code) or title))
            elif len(compact) >= 3 and code.startswith(compact):
                scored.append((80, code, data.zh.get(code) or title))
                prefix_hits += 1
                if prefix_hits >= 40:
                    break
    elif needle.isascii() and len(needle) >= 4:
        word_hits = 0
        for code, title in data.icd9_title.items():
            if needle in title.lower():
                scored.append((60, code, data.zh.get(code) or title))
                word_hits += 1
                if word_hits >= 30:
                    break

    looks_icd10 = bool(compact) and compact[0].isalpha() and compact[0] not in ("V", "E")
    if looks_icd10 and len(compact) >= 2:
        prefix_hits = 0
        for code, title, _tokens in data.by_letter.get(compact[0], []):
            if code == compact:
                scored.append((320, code, title))
            elif code.startswith(compact):
                scored.append((110, code, title))
                prefix_hits += 1
                if prefix_hits >= 30:
                    break
        if needle.isascii() and len(needle) >= 4:
            word_hits = 0
            for code, title, _tokens in data.by_letter.get(compact[0], []):
                if needle in title.lower():
                    scored.append((50, code, title))
                    word_hits += 1
                    if word_hits >= 20:
                        break

    scored.sort(key=lambda item: (-item[0], item[1]))
    seen: set[str] = set()
    out: list[dict] = []
    for _score, code, label in scored:
        if code in seen:
            continue
        seen.add(code)
        text = label if looks_icd9 or code[:1].isdigit() or code[:1] in ("V", "E") else None
        mapped = map_code(code, text)
        if not mapped.icd10:
            continue
        name = data.zh.get(bare(code)) or label or mapped.title
        name_en = data.icd9_title.get(bare(code), "")
        if name_en == name:
            name_en = ""
        out.append(
            {
                "icd9": dot_icd9(code) if mapped.input_kind == "icd9" else "",
                "name": name,
                "nameEn": name_en,
                "icd10": mapped.icd10,
                "nhiIcd10": mapped.nhi_icd10,
                "title": mapped.title,
                "secondary": mapped.secondary,
                "chiefNote": mapped.chief_note,
            }
        )
        if len(out) >= limit:
            break
    return out


def _has_cjk(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _icd10_rows(data: _Tables) -> list[tuple[str, str]]:
    rows = list(data.billable.items())
    for code, title in data.extra.items():
        if code not in data.billable:
            rows.append((code, title))
    return rows


def search_icd10_book(query: str, limit: int = 80) -> list[dict]:
    """Billable ICD-10-CM, including codes the clinic list does not use.

    A code prefix such as W26 stays on that code. An English word such as
    knife searches every title. Chinese matches the ICD-9 name list, then
    keeps the mapped ICD-10.
    """
    q = (query or "").strip()
    if not q or (len(q) < 2 and not _has_cjk(q)):
        return []
    data = tables()
    compact = bare(q)
    needle = q.lower()
    code_like = bool(re.fullmatch(r"[A-Z][0-9][0-9A-Z]{0,6}", compact))
    scored: list[tuple[int, str, str, str, str]] = []

    if compact and compact[0].isalpha() and compact[0] not in "VE" and len(compact) >= 2:
        for code, title in _icd10_rows(data):
            if code == compact:
                scored.append((1000, code, title, "", ""))
            elif code.startswith(compact):
                scored.append((800, code, title, "", ""))

    words = [part for part in re.split(r"[^a-z0-9]+", needle) if len(part) >= 3]
    if words and not code_like and needle.isascii():
        for code, title in _icd10_rows(data):
            hay = title.lower()
            if needle and hay.startswith(needle):
                scored.append((560, code, title, "", ""))
            elif all(part in hay for part in words):
                scored.append((320, code, title, "", ""))

    if _has_cjk(q) or (compact and (compact[0].isdigit() or compact[0] in "VE")):
        seen_icd9: set[str] = set()
        icd9_hits: list[tuple[int, str, str]] = []
        for source in (data.zh, data.zh_cm):
            for code, title in source.items():
                if code in seen_icd9:
                    continue
                score = 0
                if _has_cjk(q) and q in title:
                    score = 420 if title == q else 300
                elif compact and code == compact:
                    score = 400
                elif compact and len(compact) >= 3 and code.startswith(compact):
                    score = 180
                if not score:
                    continue
                seen_icd9.add(code)
                icd9_hits.append((score, code, title))
        icd9_hits.sort(key=lambda item: (-item[0], item[1]))
        for score, code, title in icd9_hits[:24]:
            mapped = map_code(code, title)
            if not mapped.icd10:
                continue
            target = bare(mapped.icd10)
            scored.append((score, target, mapped.title or _title_of(target), title, code))

    scored.sort(key=lambda item: (-item[0], item[1]))
    seen: set[str] = set()
    out: list[dict] = []
    for _score, code, name_en, name_zh, icd9 in scored:
        if not code or code in seen:
            continue
        seen.add(code)
        out.append(
            {
                "icd10": dot_icd10(code),
                "nhiIcd10": code,
                "nameEn": name_en,
                "nameZh": name_zh,
                "icd9": dot_icd9(icd9) if icd9 else "",
            }
        )
        if len(out) >= limit:
            break
    return out


def _browse_pair(data: _Tables, code: str) -> tuple[str, str]:
    """Chinese name and the English title of the same ICD-9 code."""
    zh = data.zh.get(code) or data.zh_cm.get(code) or ""
    en = data.icd9_title.get(code) or ""
    if en == zh:
        en = ""
    return zh, en


def _in_range(code: str, lo: int, hi: int, letter: str) -> str:
    if letter in ("V", "E"):
        if not code.startswith(letter):
            return ""
        width = 4 if letter == "E" else 3
        return code[:width]
    if not code[:3].isdigit():
        return ""
    number = int(code[:3])
    if number < lo or number > hi:
        return ""
    return code[:3]


def browse_headings(lo: int = 0, hi: int = 0, letter: str = "") -> list[dict]:
    """Three-digit ICD-9 groups inside one chapter, for the finder list."""
    data = tables()
    letter = (letter or "").upper()[:1]
    buckets: dict[str, list[tuple[str, str, bool]]] = {}
    seen: set[str] = set()
    for code, title in list(data.zh.items()) + list(data.icd9_title.items()):
        if code in seen:
            continue
        key = _in_range(code, lo, hi, letter)
        if not key:
            continue
        seen.add(code)
        buckets.setdefault(key, []).append((code, title, code in data.zh))
    out = []
    for key in sorted(buckets):
        items = buckets[key]
        zh, en = "", ""
        for candidate in (key, key + "9", key + "0", key + "90"):
            z, e = _browse_pair(data, candidate)
            if z or e:
                zh, en = z, e
                break
        if not zh:
            labeled = [(code, _browse_pair(data, code)[0]) for code, _title, _is_zh in items]
            labeled = [(code, label) for code, label in labeled if label]
            if labeled:
                code, zh = min(labeled, key=lambda item: len(item[1]))
                if not en:
                    en = data.icd9_title.get(code, "")
        if not en:
            for code, _title, _is_zh in items:
                en = data.icd9_title.get(code, "")
                if en:
                    break
        if not zh:
            zh = en
            en = ""
        if en == zh:
            en = ""
        out.append({"code": key, "name": zh, "nameEn": en, "count": len(items)})
    return out


def browse_codes(prefix: str, limit: int = 80) -> list[dict]:
    """ICD-9 rows under one three-digit heading. Mapping happens when the doctor picks one."""
    prefix = bare(prefix)
    if len(prefix) < 3:
        return []
    data = tables()
    found: list[tuple[str, str, str, bool]] = []
    seen: set[str] = set()
    for code, title in list(data.zh.items()) + list(data.icd9_title.items()):
        if code in seen or not code.startswith(prefix):
            continue
        seen.add(code)
        zh, en = _browse_pair(data, code)
        if not zh and title and title != en:
            zh = title
        name = zh or en or title
        if en == name:
            en = ""
        found.append((code, name, en, code in data.zh or code in data.zh_cm))
    found.sort(key=lambda item: (not item[3], len(item[0]), item[0]))
    return [
        {"icd9": dot_icd9(code), "name": name, "nameEn": name_en}
        for code, name, name_en, _is_zh in found[:limit]
    ]


def map_code(code: str, text: str | None = None) -> Crosswalk:
    """Map one entered code. Never raises for an unknown code."""
    raw = (code or "").strip()
    if not raw:
        return Crosswalk(input_kind="unknown", kind="unknown", icd10="", nhi_icd10="", title="", review=True)
    hit = _icd10_hit(raw)
    if hit is not None:
        return hit
    if bare(raw)[:1].isdigit() or bare(raw)[:1] in ("V", "E"):
        return _resolve_icd9(raw, text)
    # Letter code that is not in the 2014/2015 set: still hand back a billable parent.
    snapped = _snap(raw, text or "")
    return Crosswalk(
        input_kind="icd10",
        kind="icd10",
        icd10=dot_icd10(snapped),
        nhi_icd10=snapped,
        title=_title_of(snapped),
        review=True,
    )
