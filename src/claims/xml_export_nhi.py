"""NHI outpatient claims XML (outpatient / tdata / ddata / pdata)."""

from __future__ import annotations

import io
import re
import zipfile
from datetime import date, datetime
from typing import Any, Iterable

from src.claims.engine import ClaimEncounterRecord, ClaimsSummary

DEFAULT_INSTITUTION_CODE = "3521013662"
DEFAULT_DEPT = "11"
DEFAULT_CONSULT_FEE_CODE = "00101C"
_VIRTUAL_ORDER = re.compile(r"^(R00[1-8]|S00[1-4])$")


def render_nhi_outpatient_xml(
    summary: ClaimsSummary,
    *,
    institution_code: str = DEFAULT_INSTITUTION_CODE,
    submit_type: str = "songhe",
    submit_date: date | None = None,
    media_type: str = "2",
    dept_code: str = DEFAULT_DEPT,
    consult_fee_code: str = DEFAULT_CONSULT_FEE_CODE,
    default_dispense: str = "0",
    encoding_decl: str = "UTF-8",
) -> str:
    """Render outpatient XML string. submit_type: songhe|bubao."""
    t5 = "2" if submit_type == "bubao" else "1"
    today = submit_date or date.today()
    t6 = _roc_ymd(today)
    t3 = _pad_ym(summary.yearMonthRoc)
    inst = (institution_code or DEFAULT_INSTITUTION_CODE).strip()[:10]

    case_counters: dict[str, int] = {}
    ddata_blocks: list[str] = []

    for rec in summary.records:
        if not rec.claimable:
            continue
        case = _case_no(rec)
        case_counters[case] = case_counters.get(case, 0) + 1
        seq = case_counters[case]

        ddata_blocks.append(
            _render_ddata(
                rec,
                case_no=case,
                serial=seq,
                dept_code=dept_code,
                consult_fee_code=consult_fee_code,
                default_dispense=default_dispense,
                bubao=(t5 == "2"),
            )
        )

    sheet = tdata_totals(summary)
    t_lines = _render_tdata(
        t1="10",
        t2=inst,
        t3=t3,
        t4=str(media_type)[:1] or "2",
        t5=t5,
        t6=t6,
        totals=sheet,
    )

    parts = [
        f'<?xml version="1.0" encoding="{encoding_decl}"?>',
        "<outpatient>",
        "<tdata>",
        *t_lines,
        "</tdata>",
        *ddata_blocks,
        "</outpatient>",
    ]
    return "\n".join(parts) + "\n"


def render_nhi_outpatient_zip(
    summary: ClaimsSummary,
    *,
    institution_code: str = DEFAULT_INSTITUTION_CODE,
    submit_type: str = "songhe",
    submit_date: date | None = None,
    media_type: str = "2",
    dept_code: str = DEFAULT_DEPT,
    consult_fee_code: str = DEFAULT_CONSULT_FEE_CODE,
    default_dispense: str = "0",
    encoding: str = "cp950",
) -> bytes:
    """ZIP with Big5/cp950 XML for NHI upload."""
    xml_text = render_nhi_outpatient_xml(
        summary,
        institution_code=institution_code,
        submit_type=submit_type,
        submit_date=submit_date,
        media_type=media_type,
        dept_code=dept_code,
        consult_fee_code=consult_fee_code,
        default_dispense=default_dispense,
        encoding_decl="Big5",
    )
    enc = "cp950" if encoding.lower() in {"big5", "cp950", "ms950"} else encoding
    try:
        xml_bytes = xml_text.encode(enc)
    except UnicodeEncodeError:
        xml_bytes = xml_text.encode(enc, errors="replace")

    inst = (institution_code or DEFAULT_INSTITUTION_CODE).strip()[:10]
    t3 = _pad_ym(summary.yearMonthRoc)
    t5 = "2" if submit_type == "bubao" else "1"
    inner_name = f"{inst}{t3}{t5}.xml"
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(inner_name, xml_bytes)
    return buf.getvalue()


def tdata_totals(summary: ClaimsSummary) -> dict[str, int]:
    """Same figures written into tdata. Western general = case 01; project = 04+09."""
    case_counts: dict[str, int] = {}
    case_points: dict[str, float] = {}
    copay_n = 0
    copay_pts = 0
    for rec in summary.records:
        if not rec.claimable:
            continue
        case = _case_no(rec)
        case_counts[case] = case_counts.get(case, 0) + 1
        case_points[case] = case_points.get(case, 0.0) + float(rec.applyPoints or rec.totalPoints)
        if float(rec.copayPoints or 0) > 0:
            copay_n += 1
            copay_pts += int(round(float(rec.copayPoints)))

    def pts(case: str) -> int:
        return int(round(case_points.get(case, 0.0)))

    t7 = int(case_counts.get("01", 0))
    t8 = pts("01")
    t9 = int(case_counts.get("04", 0)) + int(case_counts.get("09", 0))
    t10 = pts("04") + pts("09")
    t17 = t7 + t9
    t18 = t8 + t10
    return {
        "t7": t7,
        "t8": t8,
        "t9": t9,
        "t10": t10,
        "t17": t17,
        "t18": t18,
        "t37": t17,
        "t38": t18,
        "t39": copay_n,
        "t40": copay_pts,
    }


def nhi_total_sheet(
    summary: ClaimsSummary,
    *,
    institution_code: str = DEFAULT_INSTITUTION_CODE,
    submit_type: str = "songhe",
    submit_date: date | None = None,
    media_type: str = "2",
) -> dict[str, Any]:
    """Header plus the tdata figures that go into the upload file."""
    return {
        "t1": "10",
        "t2": (institution_code or DEFAULT_INSTITUTION_CODE).strip()[:10],
        "t3": _pad_ym(summary.yearMonthRoc),
        "t4": str(media_type)[:1] or "2",
        "t5": "2" if submit_type == "bubao" else "1",
        "t6": _roc_ymd(submit_date or date.today()),
        **tdata_totals(summary),
    }


def _render_tdata(
    *,
    t1: str,
    t2: str,
    t3: str,
    t4: str,
    t5: str,
    t6: str,
    totals: dict[str, int],
) -> list[str]:
    lines = [
        _t("t1", t1),
        _t("t2", t2),
        _t("t3", t3),
        _t("t4", t4),
        _t("t5", t5),
        _t("t6", t6),
        _t("t7", totals["t7"]),
        _t("t8", totals["t8"]),
        _t("t9", totals["t9"]),
        _t("t10", totals["t10"]),
        _t("t17", totals["t17"]),
        _t("t18", totals["t18"]),
        _t("t37", totals["t37"]),
        _t("t38", totals["t38"]),
        _t("t39", totals["t39"]),
        _t("t40", totals["t40"]),
    ]
    return lines


def _render_ddata(
    rec: ClaimEncounterRecord,
    *,
    case_no: str,
    serial: int,
    dept_code: str,
    consult_fee_code: str,
    default_dispense: str,
    bubao: bool,
) -> str:
    visit = _roc_ymd_from_iso(rec.encounterDate) or "0000000"
    birth = rec.birthdayRoc or _roc_ymd_from_iso(rec.birthDate) or "0000000"
    id_no = (rec.patientId or "")[:10]
    dx = _diag_codes(rec)
    primary = dx[0] if dx else ""
    secondaries = dx[1:5]
    dispense = (rec.dispense or default_dispense or "0")[:1]
    treat_seq = _treat_seq(rec.treatSeq)
    doctor = (rec.doctorId or "")[:10]
    pharmacist = (rec.pharmacistId or "")[:10]
    copay_code = _copay_code(rec.copayCode)
    consult_pts = int(round(float(rec.consultationPoints or 0)))
    drug_pts = int(round(float(rec.drugPoints or 0)))
    tx_pts = int(round(float(rec.treatmentPoints or 0)))
    pharm_pts = int(round(float(rec.pharmacyPoints or 0)))
    copay_pts = int(round(float(rec.copayPoints or 0)))
    total_pts = int(round(float(rec.totalPoints or (consult_pts + drug_pts + tx_pts + pharm_pts))))
    apply_pts = int(round(float(rec.applyPoints or max(total_pts - copay_pts, 0))))
    fee_code = (rec.consultCode or consult_fee_code or "")[:12]
    days = int(rec.daysSupply or 0)

    dbody: list[str] = [
        _t("d3", id_no),
    ]
    dbody.append(_t("d8", (dept_code or DEFAULT_DEPT)[:2].zfill(2)))
    dbody.append(_t("d9", visit))
    dbody.append(_t("d11", birth))
    if bubao:
        dbody.append(_t("d12", "1"))
    dbody.append(_t("d14", "4"))
    if copay_code:
        dbody.append(_t("d15", copay_code))
    dbody.append(_t("d17", "N"))
    dbody.append(_t("d18", "N"))
    if primary:
        dbody.append(_t("d19", primary[:9]))
    for i, code in enumerate(secondaries):
        dbody.append(_t(f"d{20 + i}", code[:9]))
    if days:
        dbody.append(_t("d27", days))
    dbody.append(_t("d28", dispense))
    if treat_seq:
        dbody.append(_t("d29", treat_seq))
    dbody.append(_t("d30", doctor))
    if pharmacist:
        dbody.append(_t("d31", pharmacist))
    dbody.append(_t("d32", drug_pts))
    if tx_pts:
        dbody.append(_t("d33", tx_pts))
    if fee_code:
        dbody.append(_t("d35", fee_code))
    dbody.append(_t("d36", consult_pts))
    if rec.pharmacyCode:
        dbody.append(_t("d37", rec.pharmacyCode[:12]))
        dbody.append(_t("d38", pharm_pts))
    dbody.append(_t("d39", total_pts))
    dbody.append(_t("d40", copay_pts))
    dbody.append(_t("d41", apply_pts))
    if rec.patientName:
        dbody.append(_t("d49", rec.patientName[:20]))
    dbody.append(_t("d57", int(rec.basicCopayPoints)))
    dbody.append(_t("d58", int(rec.drugCopayPoints)))
    if len(rec.treatmentId) == 20:
        dbody.append(_t("d60", rec.treatmentId))

    pdata_blocks = _render_pdata_lines(
        rec,
        consult_fee_code=consult_fee_code,
        consult_pts=consult_pts,
        dispense=dispense,
        visit_roc=visit,
    )

    lines = [
        "<ddata>",
        "<dhead>",
        _t("d1", case_no[:2].zfill(2)),
        _t("d2", str(serial)),
        "</dhead>",
        "<dbody>",
        *dbody,
        *pdata_blocks,
        "</dbody>",
        "</ddata>",
    ]
    return "\n".join(lines)


def _render_pdata_lines(
    rec: ClaimEncounterRecord,
    *,
    consult_fee_code: str,
    consult_pts: int,
    dispense: str,
    visit_roc: str,
) -> list[str]:
    from src.claims.yisheng_rules import is_order_code

    blocks: list[str] = []
    order = 1
    fee = (rec.consultCode or consult_fee_code or "")[:12]
    if consult_pts > 0 or fee:
        base = float(rec.consultBase or consult_pts)
        rate = float(rec.consultRate or 100)
        blocks.append(
            _pdata(
                [
                    ("p3", "0"),
                    ("p4", fee),
                    ("p8", f"{rate:.2f}"),
                    ("p10", "1.0"),
                    ("p11", _money(base)),
                    ("p12", consult_pts),
                    ("p13", order),
                    ("p14", f"{visit_roc}0000" if len(visit_roc) == 7 else ""),
                    ("p15", f"{visit_roc}0000" if len(visit_roc) == 7 else ""),
                    ("p17", "4"),
                ]
            )
        )
        order += 1

    if rec.pharmacyCode:
        blocks.append(
            _pdata(
                [
                    ("p3", "9"),
                    ("p4", rec.pharmacyCode[:12]),
                    ("p8", f"{float(getattr(rec, 'pharmacyRate', 100.0) or 100):.2f}"),
                    ("p10", "1.0"),
                    ("p11", _money(float(getattr(rec, "pharmacyBase", 0) or 0))),
                    ("p12", int(round(float(rec.pharmacyPoints or 0)))),
                    ("p13", order),
                    ("p14", f"{visit_roc}0000" if len(visit_roc) == 7 else ""),
                    ("p15", f"{visit_roc}0000" if len(visit_roc) == 7 else ""),
                    ("p17", "4"),
                ]
            )
        )
        order += 1

    for med in rec.medications:
        code = (med.nhiCode or "").strip()
        if not code:
            continue
        qty = float(med.quantity or 0)
        unit = float(med.unitPrice or 0)
        # 0 是交付檢驗／不計價，不能改回單價乘數量。
        raw_pts = med.linePoints if med.linePoints is not None else unit * qty
        pts = int(round(float(raw_pts)))
        rate = float(getattr(med, "ratePercent", 100.0) or 100.0)
        unpriced_drug = not getattr(med, "billable", True) and not is_order_code(code)
        if _VIRTUAL_ORDER.match(code.upper()):
            kind = "G"
            pts = 0
        elif is_order_code(code):
            kind = "2" if pts > 0 else "4"
        elif unpriced_drug:
            kind = "4"
            unit = 0.0
            pts = 0
        else:
            kind = "1"
        fields: list[tuple[str, Any]] = [
            ("p3", kind),
            ("p4", code[:12]),
            ("p8", f"{rate:.2f}"),
            ("p10", "0" if kind == "G" else (_qty(qty) if kind != "1" else f"{qty:.1f}" if qty else "1.0")),
            ("p11", _money(0 if kind == "G" else unit)),
            ("p12", 0 if kind == "G" else pts),
            ("p13", order),
            ("p17", "4"),
        ]
        if kind == "1" or unpriced_drug:
            days = int(med.daysSupply or 0)
            dose = med.doseEach
            fields = [
                ("p1", days if days > 0 else None),
                ("p2", dispense[:1] or "0"),
                ("p3", kind),
                ("p4", code[:12]),
                ("p5", f"{float(dose):.2f}" if dose is not None and float(dose) > 0 else None),
                ("p7", _freq_code(med.useage)),
                ("p8", "100.00"),
                ("p9", (med.routeCode or "").strip() or None),
                ("p10", f"{qty:.1f}" if qty else "1.0"),
                ("p11", _money(unit)),
                ("p12", pts),
                ("p13", order),
                ("p17", "4"),
            ]
        blocks.append(_pdata(fields))
        order += 1
    return blocks


def _freq_code(sig: str | None) -> str | None:
    text = (sig or "").strip()
    if not text:
        return None
    return text.replace("&", "\uff06")


def _pdata(fields: Iterable[tuple[str, Any]]) -> str:
    body = "\n".join(_t(k, v) for k, v in fields if v is not None and str(v) != "")
    return f"<pdata>\n{body}\n</pdata>"


def _diag_codes(rec: ClaimEncounterRecord) -> list[str]:
    codes = [ _icd(c) for c in (rec.diagnosisCodes or []) if c ]
    if not codes and rec.diagnoses:
        codes = [_icd(x) for x in str(rec.diagnoses).split(",") if x.strip()]
    return [c for c in codes if c]


def _icd(raw: str) -> str:
    return str(raw).strip().replace(".", "").upper()[:9]


def _case_no(rec: ClaimEncounterRecord) -> str:
    raw = (rec.caseNo or "01").strip()
    digits = "".join(ch for ch in raw if ch.isalnum())[:2]
    return (digits or "01").zfill(2) if digits.isdigit() else (digits or "01")


def _copay_code(raw: str | None) -> str:
    text = (raw or "").strip().upper()
    if not text or text in {"-", "\u2014"}:
        return ""
    return text[:3]


def _treat_seq(raw: str | None) -> str:
    text = str(raw or "").strip().upper()
    if len(text) >= 4 and text[0].isalpha() and text[:4].isalnum():
        return text[:4]
    digits = "".join(ch for ch in text if ch.isdigit())
    if not digits:
        return ""
    return digits[-4:].zfill(4)


def _pad_ym(roc_ym: str) -> str:
    s = "".join(ch for ch in str(roc_ym) if ch.isdigit())
    if len(s) == 5:
        return s
    if len(s) == 4:  # YYM M rare
        return s.zfill(5)
    if len(s) >= 5:
        return s[-5:]
    return s.zfill(5)


def _roc_ymd(d: date) -> str:
    return f"{d.year - 1911:03d}{d.month:02d}{d.day:02d}"


def _roc_ymd_from_iso(iso: str | None) -> str:
    if not iso:
        return ""
    text = str(iso).strip()[:10]
    try:
        dt = datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        # already ROC?
        digits = "".join(ch for ch in text if ch.isdigit())
        return digits[:7].zfill(7) if digits else ""
    return _roc_ymd(dt)


def _money(v: float) -> str:
    return f"{float(v):.2f}"


def _qty(v: float) -> str:
    if abs(v - round(v)) < 1e-9:
        return str(int(round(v)))
    return f"{float(v):.1f}"


def _t(name: str, value: Any) -> str:
    return f"<{name}>{_esc(value)}</{name}>"


def _esc(value: Any) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
