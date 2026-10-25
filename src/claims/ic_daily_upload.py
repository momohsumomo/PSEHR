# -*- coding: utf-8 -*-
"""???O?d???W???Z 2.0?]???E?^?C???????H?W??A???N?} VPN?B????w??????C"""

from __future__ import annotations

import json
import re
from typing import Any

from src.claims.engine import (
    _billed_quantity,
    _catalog_lookup,
    _extract_med_billing,
    _load_staff_maps,
    _resolve_staff_nhi,
)
from src.claims.yisheng_rules import flat_consult_points, half_up_points, is_order_code, pharmacy_for
from src.core.encounter_extensions import extract_reg_meta

# 6.0 normal sequences are W001-W999. Other letter codes are abnormal uploads.
_W_SEQ = re.compile(r"W\d{3}")
_FORMAT = "nhi-ic-upload-2.0"


def _abnormal_seq(seq: str) -> bool:
    text = (seq or "").strip().upper()
    if _W_SEQ.fullmatch(text):
        return False
    return bool(text) and text[:1].isalpha()


def pack_order_signs(pairs: list[tuple[str, str]]) -> str:
    """One line per card signature: order code, then 40 hex characters."""
    lines: list[str] = []
    for code, sign in pairs:
        token = "".join(ch for ch in str(code or "").upper() if ch.isalnum())[:12]
        hx = "".join(ch for ch in str(sign or "").upper() if ch in "0123456789ABCDEF")
        if token and len(hx) == 40:
            lines.append(f"{token},{hx}")
    return "\n".join(lines)


def order_sign_queues(raw: str) -> dict[str, list[str]]:
    queues: dict[str, list[str]] = {}
    for line in str(raw or "").splitlines():
        code, sep, sign = line.partition(",")
        if not sep:
            continue
        token = "".join(ch for ch in code.upper() if ch.isalnum())[:12]
        hx = sign.strip().upper()
        if token and len(hx) == 40 and all(ch in "0123456789ABCDEF" for ch in hx):
            queues.setdefault(token, []).append(hx)
    return queues


def _take_order_sign(queues: dict[str, list[str]], code: str) -> str:
    bucket = queues.get("".join(ch for ch in str(code or "").upper() if ch.isalnum())[:12])
    if not bucket:
        return ""
    return bucket.pop(0)


def _esc(value: Any) -> str:
    from src.core.plain_text import plain_text

    text = plain_text(str(value or ""))
    return (
        text.replace("&", "\uff06")
        .replace("<", "\uff1c")
        .replace(">", "\uff1e")
        .replace('"', "\uff02")
        .replace("'", "\uff07")
    )


def _tag(name: str, value: Any) -> str | None:
    text = _esc(value).strip()
    if not text:
        return None
    return f"<{name}>{text}</{name}>"


def _roc_date(iso_day: str) -> str:
    year, month, day = (iso_day or "")[:10].split("-")
    return f"{int(year) - 1911:03d}{int(month):02d}{int(day):02d}"


def _visit_time(reg: dict[str, Any], iso_day: str, slot: str) -> str:
    raw = str(reg.get("treatDateTime") or "").strip()
    digits = "".join(ch for ch in raw if ch.isdigit())
    if len(digits) >= 13:
        return digits[:13]
    roc = _roc_date(iso_day) if len(iso_day) >= 10 else ""
    clock = "".join(ch for ch in str(slot or "") if ch.isdigit())
    if len(clock) == 4:
        clock = clock + "00"
    if len(clock) < 6:
        clock = (clock + "000000")[:6]
    if len(roc) == 7:
        return roc + clock[:6]
    return ""


def _bump_stamp(stamp: str) -> str:
    from datetime import datetime, timedelta

    moment = datetime(
        int(stamp[:3]) + 1911,
        int(stamp[3:5]),
        int(stamp[5:7]),
        int(stamp[7:9]),
        int(stamp[9:11]),
        int(stamp[11:13]),
    ) + timedelta(seconds=1)
    return f"{moment.year - 1911:03d}{moment.month:02d}{moment.day:02d}{moment.strftime('%H%M%S')}"


def unique_visit_times(records: list[dict[str, Any]]) -> None:
    """Two visits cannot share one second. The first keeps the stored clock."""
    used: set[str] = set()
    for rec in records:
        mb = rec.setdefault("mb1", {})
        stamp = str(mb.get("M11") or "")
        if len(stamp) != 13 or not stamp.isdigit():
            continue
        nxt = stamp
        guard = 0
        while nxt in used and guard < 86400:
            nxt = _bump_stamp(nxt)
            guard += 1
        if nxt != stamp:
            mb["M11"] = nxt
            for order in rec.get("orders") or []:
                if str(order.get("D01") or "") == stamp:
                    order["D01"] = nxt
        used.add(nxt)


def _icd(code: str) -> str:
    return str(code or "").replace(".", "").strip()[:9]


def _qty(value: float) -> str:
    scaled = int(float(value) * 10 + 0.5)
    return f"{scaled / 10:.1f}"


def daily_medical_fee(consult: int, line_points: int, pharmacy: int, copay: int) -> int:
    """當次門診醫療費用. Consult and pharmacy are calculated here, not stored on the visit."""
    total = int(consult) + int(line_points) + int(pharmacy) - int(copay)
    return total if total > 0 else 0


def _money(value: Any) -> str:
    text = str(value or "").strip().replace(",", "")
    if not text:
        return ""
    try:
        return str(int(round(float(text))))
    except (TypeError, ValueError):
        return ""


def render_ic_daily_xml(records: list[dict[str, Any]]) -> str:
    """records: mb1 field dict plus orders list of field dicts. Empty fields are omitted."""
    lines = [
        '<?xml version="1.0" encoding="Big5"?>',
        "<RECS>",
    ]
    for rec in records:
        lines.append("<REC>")
        lines.append("<MSH>")
        lines.append("<H00>1</H00>")
        lines.append(f"<H01>{_esc(rec.get('h01') or 'A')}</H01>")
        lines.append("</MSH>")
        lines.append("<MB>")
        lines.append("<MB1>")
        for key in (
            "M01", "M02", "M03", "M04", "M05", "M06", "M07", "M11", "M12", "M13",
            "M14", "M15", "M20", "M23", "M24", "M25", "M35", "M36", "M37", "M38", "M39",
            "M40", "M44", "M45", "M46", "M47", "M49", "M51", "M52", "M53", "M54", "M55", "M56",
        ):
            row = _tag(key, (rec.get("mb1") or {}).get(key))
            if row:
                lines.append(row)
        lines.append("</MB1>")
        orders = rec.get("orders") or []
        for order in orders:
            lines.append("<MB2>")
            for key in ("D01", "D02", "D03", "D04", "D05", "D06", "D08", "D09", "D10", "D11", "D12", "D14"):
                row = _tag(key, order.get(key))
                if row:
                    lines.append(row)
            lines.append("</MB2>")
        lines.append("</MB>")
        lines.append("</REC>")
    lines.append("</RECS>")
    return "\n".join(lines)


def _patient_card(store: Any, patient_id: str) -> str:
    if not patient_id:
        return ""
    try:
        with store._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM resource_cache WHERE resource_type=? AND resource_id=?",
                ("Patient", patient_id),
            ).fetchone()
    except Exception:
        return ""
    if not row or not row[0]:
        return ""
    try:
        payload = json.loads(row[0]) if isinstance(row[0], str) else row[0]
    except json.JSONDecodeError:
        return ""
    for ext in payload.get("extension") or []:
        if "patient-clinic-ext" not in str(ext.get("url") or ""):
            continue
        for sub in ext.get("extension") or []:
            if sub.get("url") == "nhiCardNo" and sub.get("valueString"):
                return str(sub["valueString"]).strip()
    return ""


def collect_ic_day(store: Any, day: str, institution: str) -> dict[str, Any]:
    """One calendar day. Finished NHI visits with a 20-char treatment id go in the file."""
    iso = day[:10]
    with store._connect() as conn:
        rows = conn.execute(
            """
            SELECT ei.resource_id, ei.patient_id, ei.queue_number, ei.queue_status,
                   ei.encounter_date, ei.slot_time, ei.treat_seq, ei.claim_doctor_id,
                   ei.fee_copay, pi.id_no, pi.birthday_roc, pi.family_name, pi.given_name
            FROM encounter_index ei
            LEFT JOIN patient_index pi ON pi.resource_id = ei.patient_id
            WHERE (
                (COALESCE(ei.ic_upload_date, '') = '' AND ei.encounter_date = ?)
                OR ei.ic_upload_date = ?
            )
            ORDER BY ei.queue_number ASC
            """,
            (iso, iso),
        ).fetchall()
    staff_by_id, staff_by_name = _load_staff_maps(store)
    usages, routes = _catalog_lookup(store)
    included: list[dict[str, Any]] = []
    blocked: list[dict[str, Any]] = []
    warnings: list[str] = []
    finished = 0

    for row in rows:
        status = str(row[3] or "")
        if status == "cancelled":
            continue
        if status == "finished":
            finished += 1
        eid = str(row[0])
        name = f"{row[11] or ''}{row[12] or ''}".strip()
        queue = row[2]
        if status != "finished":
            continue
        reg = _load_reg(store, eid)
        if not str(reg.get("hcId") or "").strip():
            card = _patient_card(store, str(row[1] or ""))
            if card:
                reg["hcId"] = card
        reasons = _assess(
            reg=reg,
            institution=institution,
            id_no=str(row[9] or ""),
            birthday=str(row[10] or ""),
            treat_seq=str(row[6] or ""),
            doctor_raw=str(reg.get("doctorId") or row[7] or ""),
            staff_by_id=staff_by_id,
            staff_by_name=staff_by_name,
        )
        if reasons:
            blocked.append(
                {
                    "encounterId": eid,
                    "queueNumber": queue,
                    "patientName": name,
                    "reasons": reasons,
                }
            )
            continue
        rec, note = _compose(
            reg=reg,
            institution=institution,
            id_no=str(row[9] or "").strip().upper(),
            birthday=str(row[10] or "").strip(),
            treat_seq=str(reg.get("treatSeq") or row[6] or "").strip(),
            doctor_raw=str(reg.get("doctorId") or row[7] or ""),
            staff_by_id=staff_by_id,
            staff_by_name=staff_by_name,
            iso_day=str(row[4] or iso),
            slot=str(row[5] or ""),
            fee_copay=row[8],
            card_fallback="",
            store=store,
            encounter_id=eid,
            usages=usages,
            routes=routes,
        )
        if note:
            warnings.append(note)
        included.append(rec)

    from src.claims.ic_sign_lookup import fill_signs, unsigned_normal

    fill_signs(included, iso)
    unique_visit_times(included)
    xml = render_ic_daily_xml(included)
    return {
        "date": iso,
        "institutionCode": institution,
        "format": _FORMAT,
        "total": len(rows),
        "finished": finished,
        "readyForExport": len(included),
        "unsignedNormal": unsigned_normal(included),
        "blockedCount": len(blocked),
        "blocked": blocked[:40],
        "warnings": warnings[:8],
        "note": (
            "\u5065\u4fdd\u5361\u8cc7\u6599\u4e0a\u50b3\u683c\u5f0f 2.0\u3002"
            "\u9ede IC\u4e0a\u50b3\u6642\u7528\u9662\u6240\u5b89\u5168\u6a21\u7d44\u7c3d\u7ae0\u5f8c\u9001\u51fa\uff0c\u4e0d\u7528\u91ab\u4e8b\u4eba\u54e1\u5361\u3002"
        ),
        "records": [
            {
                "encounterId": "",
                "queueNumber": None,
                "queueStatus": "finished",
            }
            for _ in included
        ],
        "xml": xml,
    }


def _load_reg(store: Any, encounter_id: str) -> dict[str, Any]:
    try:
        with store._connect() as conn:
            row = conn.execute(
                "SELECT payload_json FROM resource_cache WHERE resource_type=? AND resource_id=?",
                ("Encounter", encounter_id),
            ).fetchone()
    except Exception:
        return {}
    if not row or not row[0]:
        return {}
    try:
        payload = json.loads(row[0]) if isinstance(row[0], str) else row[0]
    except json.JSONDecodeError:
        return {}
    return extract_reg_meta(payload if isinstance(payload, dict) else {})


def _assess(
    *,
    reg: dict[str, Any],
    institution: str,
    id_no: str,
    birthday: str,
    treat_seq: str,
    doctor_raw: str,
    staff_by_id: dict[str, str],
    staff_by_name: dict[str, str],
) -> list[str]:
    case = str(reg.get("caseNo") or "").strip().upper()
    seq = str(reg.get("treatSeq") or treat_seq or "").strip()
    if case in {"9X"} or str(reg.get("payType") or "") == "\u81ea\u8cbb":
        return ["\u81ea\u8cbb\uff0c\u4e0d\u9032\u6bcf\u65e5\u4e0a\u50b3"]
    if not seq:
        return ["\u6c92\u6709\u5c31\u91ab\u5e8f\u865f"]
    reasons: list[str] = []
    if len(institution) != 10:
        reasons.append("\u9662\u6240\u4ee3\u78bc\u4e0d\u662f 10 \u78bc")
    if len(id_no.strip()) != 10:
        reasons.append("\u6c92\u6709\u8eab\u5206\u8b49")
    birth = "".join(ch for ch in birthday if ch.isdigit())
    if len(birth) != 7:
        reasons.append("\u751f\u65e5\u4e0d\u662f\u6c11\u570b 7 \u78bc")
    doctor = _resolve_staff_nhi(doctor_raw, staff_by_id, staff_by_name)
    if len(doctor) != 10:
        reasons.append("\u91ab\u5e2b\u8eab\u5206\u8b49\u5c0d\u4e0d\u5230")
    treat_id = str(reg.get("treatmentNumber") or "").strip()
    if len(treat_id) != 20:
        reasons.append("\u6c92\u6709\u5c31\u91ab\u8b58\u5225\u78bc")
    abnormal = _abnormal_seq(seq)
    card = str(reg.get("hcId") or "").strip()
    if not abnormal and len(card) != 12:
        reasons.append("\u6c92\u6709\u5065\u4fdd\u5361\u865f")
    return reasons


def _compose(
    *,
    reg: dict[str, Any],
    institution: str,
    id_no: str,
    birthday: str,
    treat_seq: str,
    doctor_raw: str,
    staff_by_id: dict[str, str],
    staff_by_name: dict[str, str],
    iso_day: str,
    slot: str,
    fee_copay: Any,
    card_fallback: str,
    store: Any,
    encounter_id: str,
    usages: dict,
    routes: dict,
) -> tuple[dict[str, Any], str]:
    seq = treat_seq.strip()
    abnormal = _abnormal_seq(seq)
    when = _visit_time(reg, iso_day, slot)
    doctor = _resolve_staff_nhi(doctor_raw, staff_by_id, staff_by_name)
    card = str(reg.get("hcId") or card_fallback or "").strip()
    visit_type = str(reg.get("icCaseNo") or "01").strip() or "01"
    remark = str(reg.get("icRemark") or "1").strip() or "1"
    dispense = str(reg.get("dispense") or "0").strip()[:1] or "0"
    meds = store.list_medication_requests(encounter_id=encounter_id)
    orders, oral_days, drug_days, has_general, has_chronic, line_points = _orders(
        meds, when, dispense, usages, routes, sign_queues=order_sign_queues(str(reg.get("orderSigns") or ""))
    )
    if drug_days <= 0:
        m23 = "2"
        m20 = "0"
    elif dispense == "1":
        m23 = "1"
        m20 = "0"
    else:
        m23 = "0"
        m20 = str(oral_days or drug_days or 0)
    # M45 is the sum. M53 is the basic copay. M54 is the drug copay.
    # A stored drugCopay is that amount by itself. Older rows keep the previous split.
    if "drugCopay" in reg:
        try:
            basic_copay = int(_money(reg.get("copayAmt")) or _money(fee_copay) or "0")
        except ValueError:
            basic_copay = 0
        try:
            drug_copay = int(_money(reg.get("drugCopay")) or "0")
        except ValueError:
            drug_copay = 0
        copay_total = basic_copay + drug_copay
        copay = str(copay_total)
    else:
        copay = _money(reg.get("icCopay")) or _money(fee_copay) or _money(reg.get("copayAmt")) or "0"
        try:
            copay_total = int(copay or 0)
        except ValueError:
            copay_total = 0
        if copay_total <= 0:
            basic_copay = 0
            drug_copay = 0
        elif copay_total < 50:
            basic_copay = 0
            drug_copay = copay_total
        else:
            basic_copay = 50
            drug_copay = copay_total - 50
    _pharm_code, pharm_pts = pharmacy_for(drug_days, dispense)
    fee = str(
        daily_medical_fee(
            flat_consult_points(birthday, iso_day),
            int(line_points),
            int(pharm_pts),
            copay_total,
        )
    )
    codes = _dx(store, encounter_id)
    card_again = remark in {"2", "3", "4"}
    mb1: dict[str, str] = {
        "M03": id_no,
        "M04": "".join(ch for ch in birthday if ch.isdigit())[:7],
        "M05": institution,
        "M06": doctor,
        "M07": visit_type[:2],
        "M11": when,
        "M12": remark[:1],
        "M13": seq[:4],
        "M14": str(reg.get("securitySign") or "").strip(),
        "M15": str(reg.get("treatmentNumber") or "").strip(),
        "M20": m20,
        "M23": m23,
        "M35": codes[0] if codes else "",
        "M44": fee,
        "M45": copay,
        "M46": "0",
        "M47": "0",
        "M51": "4",
        "M53": str(basic_copay),
        "M54": str(drug_copay),
        "M55": "0",
        "M56": "11",
    }
    if card_again:
        actual_when = "".join(ch for ch in str(reg.get("actualTreatWhen") or "") if ch.isdigit())
        actual_id = str(reg.get("actualTreatId") or "").strip()
        if len(actual_when) >= 13:
            mb1["M49"] = actual_when[:13]
        if len(actual_id) == 20:
            mb1["M52"] = actual_id
    if not abnormal:
        mb1["M01"] = str(reg.get("samId") or "").strip()
        mb1["M02"] = card
    if has_general:
        mb1["M24"] = "1"
    if has_chronic:
        mb1["M25"] = "1"
    for idx, code in enumerate(codes[1:6], start=36):
        mb1[f"M{idx}"] = code
    return {"h01": "B" if abnormal else "A", "mb1": mb1, "orders": orders}, ""


def _dx(store: Any, encounter_id: str) -> list[str]:
    out: list[str] = []
    for cond in store.list_conditions(encounter_id=encounter_id):
        meta = cond.get("indexMeta") or {}
        code = _icd(str(meta.get("icd10Code") or meta.get("nhiIcd10Code") or ""))
        # Two shortcuts can share one ICD. The upload lists that code twice.
        if code:
            out.append(code)
        if len(out) >= 6:
            break
    return out


def _line_sort(med: dict[str, Any]) -> int:
    raw = (med.get("indexMeta") or {}).get("lineSort")
    try:
        return int(raw)
    except (TypeError, ValueError):
        return 10**9


def outside_lab_id() -> str:
    """Sc.ini [OTHER] outside-lab id. D12 is the 10-character code, without the name."""
    cached = getattr(outside_lab_id, "_value", None)
    if cached is not None:
        return cached
    from pathlib import Path

    found = ""
    path = Path(r"Z:\SC\Sc.ini")
    needle = "\u552f\u4e00\u6aa2\u9a57\u6a5f\u69cb\u4ee3\u865f"
    if path.is_file():
        for raw in path.read_bytes().decode("cp950", errors="ignore").splitlines():
            if needle not in raw or "=" not in raw:
                continue
            token = raw.split("=", 1)[1].strip().split("(", 1)[0].strip()
            if token:
                found = token[:10]
            break
    setattr(outside_lab_id, "_value", found)
    return found


def _order_casts() -> dict[str, str]:
    """MEDICAL.CAST decides the daily-upload order class. Higher rank wins."""
    from pathlib import Path

    from scripts.backfill_cash_book import _iter_fields

    path = Path(r"Z:\SC\dat\MEDICAL.Dat")
    if not path.is_file():
        path = Path(r"Z:\SC\DAT\MEDICAL.Dat")
    if not path.is_file():
        return {}
    rank = {"\u865b\u64ec": 3, "\u6aa2\u67e5": 2, "\u6cbb\u7642": 1}
    best: dict[str, tuple[int, str]] = {}
    for row in _iter_fields(path, ("CODE", "CAST")):
        code = str(row.get("CODE") or "").strip().upper()
        cast = str(row.get("CAST") or "").strip()
        if not code or not cast:
            continue
        score = rank.get(cast, 0)
        prev = best.get(code)
        if prev is None or score > prev[0]:
            best[code] = (score, cast)
    return {code: cast for code, (_score, cast) in best.items()}


def _order_kind(code: str, cast: str, deliver: bool, pay_mark: str = "") -> str:
    label = (cast or "").strip()
    if label == "\u865b\u64ec":
        return "G"
    if (pay_mark or "").strip() == "\u4ea4":
        return "R"
    if is_order_code(code):
        return "2"
    if code[:2] == "05":
        return "9"
    return "M" if deliver else "1"


def _orders(
    meds: list[dict[str, Any]],
    when: str,
    dispense: str,
    usages: dict,
    routes: dict,
    casts: dict[str, str] | None = None,
    sign_queues: dict[str, list[str]] | None = None,
) -> tuple[list[dict[str, str]], int, int, bool, bool, int]:
    orders: list[dict[str, str]] = []
    oral_days = 0
    drug_days = 0
    has_general = False
    has_chronic = False
    points = 0
    seq = 1
    deliver = dispense == "1"
    table = casts if casts is not None else _order_casts()
    queues = sign_queues if sign_queues is not None else {}

    def _rank(med: dict[str, Any]) -> tuple:
        code = str((med.get("indexMeta") or {}).get("nhiCode") or "").strip()
        mark = str((med.get("indexMeta") or {}).get("payMark") or "")
        kind = _order_kind(code, table.get(code.upper(), ""), deliver, mark)
        return (0 if kind in {"1", "M"} else 1, code, _line_sort(med))

    for med in sorted(meds, key=_rank):
        meta = med.get("indexMeta") or {}
        code = str(meta.get("nhiCode") or "").strip()
        if not code:
            continue
        if str(meta.get("payMark") or "").strip() == "\u81ea" or "[" in str(meta.get("memo") or ""):
            continue
        resource = med.get("resource") or {}
        billing = _extract_med_billing(resource, meta)
        days = int(billing["daysSupply"] or 0)
        unit = billing["unitPrice"]
        sig = str(meta.get("useage") or "").strip()
        stored = meta.get("totalQty")
        try:
            stored_n = float(stored) if stored is not None else None
        except (TypeError, ValueError):
            stored_n = None
        _dose, billed = _billed_quantity(
            raw_qty=float(billing["quantity"] or 0),
            qty_known=meta.get("quantity") is not None,
            days=days,
            sig=sig,
            nhi_code=code,
            usages=usages,
            total_qty=stored_n,
        )
        kind = _order_kind(code, table.get(code.upper(), ""), deliver, str(meta.get("payMark") or ""))
        row: dict[str, str] = {
            "D01": when,
            "D02": kind,
            "D03": str(seq),
            "D06": code[:12],
        }
        if unit is not None and str(meta.get("payMark") or "") not in {"\u4ea4", "\u8f49", "\u4e0d", "\u6750"} and kind != "G":
            points += int(half_up_points(float(unit) * float(billed or 0)))
        if kind in {"1", "M"}:
            use_type = str(meta.get("useType") or "").strip().upper()
            route = "TOPI" if use_type == "T" else "PO"
            kind_rx = "A" if days <= 7 else "B"
            row["D04"] = kind_rx
            row["D05"] = "1" if deliver else "0"
            if sig:
                row["D08"] = sig[:18]
            if days > 0:
                row["D09"] = str(days)
            row["D10"] = _qty(billed)
            row["D14"] = route
            if route == "PO" and days > oral_days:
                oral_days = days
            if days > drug_days:
                drug_days = days
            if kind_rx == "A":
                has_general = True
            else:
                has_chronic = True
        elif kind == "G":
            row["D10"] = "0.0"
        elif kind == "R":
            row["D05"] = "4"
            row["D10"] = _qty(billed or 1)
            lab = outside_lab_id()
            if lab:
                row["D12"] = lab
        else:
            row["D05"] = "0"
            row["D10"] = _qty(billed or 1)
        if kind in {"1", "2", "3"}:
            signed = _take_order_sign(queues, code)
            if signed:
                row["D11"] = signed
        orders.append(row)
        seq += 1
    return orders, oral_days, drug_days, has_general, has_chronic, points
