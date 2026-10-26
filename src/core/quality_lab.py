# -*- coding: utf-8 -*-
"""Daily lab-result file for the cloud query scheme, type code 26.

Field ids follow the bureau daily table. KOH 13017C is report category 1.
The cloud DLL signs the zip on the viewing PC. It does not take the card reader.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

# Order code -> report category. Category 1 is a result value, 2 and 3 are narrative.
QUALITY_ORDERS: dict[str, str] = {
    "13017C": "1",
}

_SEQ_LOCK = threading.Lock()


class QualityLabError(Exception):
    pass


def order_category(code: str) -> str:
    return QUALITY_ORDERS.get(str(code or "").strip().upper(), "")


def _xml_text(value: str) -> str:
    from src.core.plain_text import plain_text

    return (
        plain_text(value or "")
        .replace("&", "\uff06")
        .replace("<", "\uff1c")
        .replace(">", "\uff1e")
        .replace("'", "\u2019")
        .replace('"', "\u201d")
    )


def roc_now(moment: datetime | None = None) -> str:
    now = moment or datetime.now()
    return f"{now.year - 1911:03d}{now.month:02d}{now.day:02d}{now.hour:02d}{now.minute:02d}{now.second:02d}"


def _roc7_from_any(value: str) -> str:
    digits = "".join(ch for ch in str(value or "") if ch.isdigit() or ch == "-")
    if len(digits) >= 7 and digits[0] != "-":
        head = digits[:7]
        if head.isdigit():
            year = int(head[:3])
            if 1 <= year <= 200:
                return head
    compact = "".join(ch for ch in str(value or "") if ch.isdigit())
    if len(compact) >= 8:
        year = int(compact[:4]) - 1911
        if year > 0:
            return f"{year:03d}{compact[4:8]}"
    return ""


def _tag(lines: list[str], indent: str, key: str, value: str) -> None:
    text = _xml_text(value).strip()
    if not text:
        return
    lines.append(f"{indent}<{key}>{text}</{key}>")


@dataclass
class QualityLabDraft:
    order_code: str
    order_name: str
    result: str = ""
    unit: str = ""
    ref_low: str = ""
    ref_high: str = ""
    method: str = ""
    specimen: str = ""
    narrative: str = ""


def build_lab_xml(
    draft: QualityLabDraft,
    *,
    hosp: str,
    id_no: str,
    birthday: str,
    treat_at: str,
    treat_seq: str,
    uploaded_at: str,
    makeup: bool = False,
    visit_kind: str = "01",
) -> bytes:
    category = order_category(draft.order_code)
    if not category:
        raise QualityLabError("\u9019\u9805\u8655\u7f6e\u4e0d\u5728\u8ad6\u8cea\u6aa2\u9a57\u4e0a\u50b3\u6e05\u55ae\u88e1\u3002")
    hosp_code = "".join(ch for ch in hosp if ch.isdigit())
    if len(hosp_code) != 10:
        raise QualityLabError("\u9662\u6240\u4ee3\u78bc\u4e0d\u662f 10 \u78bc\uff0c\u6c92\u6709\u7d44\u6a94\u3002")
    ident = str(id_no or "").strip().upper()
    if len(ident) != 10:
        raise QualityLabError("\u9019\u7b46\u6c92\u6709\u8eab\u5206\u8b49\uff0c\u4e0d\u80fd\u4e0a\u50b3\u3002")
    birth = _roc7_from_any(birthday)
    if len(birth) != 7:
        raise QualityLabError("\u9019\u7b46\u751f\u65e5\u4e0d\u662f\u6c11\u570b 7 \u78bc\uff0c\u4e0d\u80fd\u4e0a\u50b3\u3002")
    card_at = "".join(ch for ch in str(treat_at or "") if ch.isdigit())
    if len(card_at) < 13:
        raise QualityLabError("\u9019\u7b46\u6c92\u6709\u5237\u5361\u6642\u9593\uff0c\u4e0d\u80fd\u4e0a\u50b3\u3002")
    card_at = card_at[:13]
    seq = "".join(ch for ch in str(treat_seq or "") if ch.isalnum()).upper()[:4]
    if len(seq) != 4:
        raise QualityLabError("\u9019\u7b46\u6c92\u6709\u5c31\u91ab\u5e8f\u865f\uff0c\u4e0d\u80fd\u4e0a\u50b3\u3002")
    sent = "".join(ch for ch in str(uploaded_at or "") if ch.isdigit())[:13]
    if len(sent) != 13:
        raise QualityLabError("\u4e0a\u50b3\u6642\u9593\u4e0d\u5168\u3002")
    kind = (visit_kind or "01").strip()[:2] or "01"
    lines = [
        '<?xml version="1.0" encoding="Big5"?>',
        "<checkup>",
        "  <hdata>",
    ]
    fields = [
        ("h1", category),
        ("h2", hosp_code),
        ("h3", "11"),
        ("h4", card_at[:5]),
        ("h5", card_at),
        ("h6", kind),
        ("h7", seq),
        ("h8", "2" if makeup else "1"),
        ("h9", ident),
        ("h10", birth),
        ("h11", card_at[:7]),
        ("h15", draft.order_code.strip().upper()),
        ("h16", sent),
        ("h19", card_at),
        ("h20", sent),
        ("h22", draft.specimen),
    ]
    for key, value in fields:
        _tag(lines, "    ", key, value)
    lines.append("  </hdata>")
    lines.append("  <rdata>")
    _tag(lines, "    ", "r1", "1")
    _tag(lines, "    ", "r2", draft.order_name or draft.order_code)
    _tag(lines, "    ", "r3", draft.method)
    if category == "1":
        result = _xml_text(draft.result).strip()
        if not result:
            raise QualityLabError("\u8acb\u5148\u586b\u5831\u544a\u3002")
        _tag(lines, "    ", "r4", result[:1000])
        _tag(lines, "    ", "r5", draft.unit)
        _tag(lines, "    ", "r6-1", draft.ref_low)
        _tag(lines, "    ", "r6-2", draft.ref_high)
    else:
        story = _xml_text(draft.narrative or draft.result).strip()
        if not story:
            raise QualityLabError("\u8acb\u5148\u586b\u5831\u544a\u3002")
        _tag(lines, "    ", "r7", story[:1000])
    lines.append("  </rdata>")
    lines.append("</checkup>")
    return "\n".join(lines).encode("big5", errors="replace")


def alloc_serial(directory: Path, day_key: str) -> str:
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / "quality_lab_seq.json"
    with _SEQ_LOCK:
        data: dict[str, Any] = {}
        if path.is_file():
            try:
                loaded = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(loaded, dict):
                    data = loaded
            except (OSError, json.JSONDecodeError):
                data = {}
        current = int(data.get(day_key) or 0) + 1
        if current > 999:
            raise QualityLabError("\u4eca\u5929\u7684\u4e0a\u50b3\u6d41\u6c34\u865f\u5df2\u6eff\u3002")
        data[day_key] = current
        path.write_text(json.dumps(data), encoding="utf-8")
    return f"{current:03d}"


def zip_name(hosp: str, uploaded_at: str, serial: str) -> str:
    hosp_code = "".join(ch for ch in hosp if ch.isdigit())
    day = "".join(ch for ch in uploaded_at if ch.isdigit())[:7]
    return f"{hosp_code}{day}{serial}.zip"


def pack_zip(xml_bytes: bytes, name: str, directory: Path) -> Path:
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / name
    xml_name = name[:-4] + ".xml" if name.lower().endswith(".zip") else name + ".xml"
    with ZipFile(target, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr(xml_name, xml_bytes)
    return target
