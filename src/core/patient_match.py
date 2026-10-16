"""Match an incoming person to a chart already in the clinic database.

Identity card number wins. A different number is attached to an existing chart
only when the name and birthday are exactly the same and only one chart hits.
The stored identity number is never rewritten from the incoming source.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

_ISO_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def compact_person_name(name: str) -> str:
    return "".join((name or "").split())


def birth_iso_from_any(raw: str) -> str | None:
    text = (raw or "").strip()
    iso = _ISO_RE.match(text)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
    digits = re.sub(r"\D", "", text)
    if len(digits) == 8 and digits[:2] in {"19", "20"}:
        return f"{digits[:4]}-{digits[4:6]}-{digits[6:8]}"
    if len(digits) in {6, 7}:
        roc = digits.zfill(7)
        year = int(roc[:3]) + 1911
        month, day = int(roc[3:5]), int(roc[5:7])
        if 1 <= month <= 12 and 1 <= day <= 31 and year >= 1912:
            return f"{year:04d}-{month:02d}-{day:02d}"
    return None


def roc7_from_iso(iso: str) -> str | None:
    match = _ISO_RE.match((iso or "").strip())
    if not match:
        return None
    year = int(match.group(1))
    if year < 1912:
        return None
    return f"{year - 1911:03d}{match.group(2)}{match.group(3)}"


@dataclass(frozen=True)
class PatientMatch:
    patient_id: str | None
    kind: str


def match_patient(store, *, id_no: str, name: str, birth_iso: str | None) -> PatientMatch:
    """kind is id, name_birth, or new. Two or more name hits stay new."""
    found = store.find_patient_id_by_id_no(id_no)
    if found:
        return PatientMatch(found, "id")
    compact = compact_person_name(name)
    iso = (birth_iso or "").strip()[:10]
    if not compact or len(iso) != 10:
        return PatientMatch(None, "new")
    hits = store.find_patient_ids_by_exact_name_birth(compact, iso)
    if len(hits) == 1:
        return PatientMatch(hits[0], "name_birth")
    return PatientMatch(None, "new")
