"""Estimate the NHI non-payment indicators for one claim month.

Rules come from nopay_rules.load_rules(); nothing here is specific to one indicator.
Results are estimates for the clinic to review. They never block the export.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, Callable

from src.claims.engine import ClaimEncounterRecord

_CASE_LIMIT = 30


def _norm(code: Any) -> str:
    return str(code or "").replace(".", "").strip().upper()


def _one(code: str, pattern: str) -> bool:
    body, _, seventh = pattern.partition("@")
    if "-" in body:
        lo, hi = body.split("-", 1)
        width = len(lo)
        if len(code) < width or not (lo <= code[:width] <= hi[:width]):
            return False
    elif not code.startswith(body):
        return False
    if seventh:
        return len(code) >= 7 and code[6] in seventh
    return True


def dx_match(code: str, patterns: list[str]) -> bool:
    text = _norm(code)
    if not text:
        return False
    hit = False
    for pattern in patterns:
        if pattern.startswith("!"):
            if _one(text, _norm(pattern[1:])):
                return False
        elif _one(text, _norm(pattern)):
            hit = True
    return hit


def _age(rec: ClaimEncounterRecord) -> int | None:
    day = (rec.encounterDate or "")[:10]
    birth = (rec.birthDate or "")[:10]
    try:
        if len(birth) == 10:
            by, bm, bd = int(birth[:4]), int(birth[5:7]), int(birth[8:10])
        else:
            digits = "".join(ch for ch in (rec.birthdayRoc or "") if ch.isdigit())
            if len(digits) < 7:
                return None
            by, bm, bd = int(digits[:-4]) + 1911, int(digits[-4:-2]), int(digits[-2:])
        vy, vm, vd = int(day[:4]), int(day[5:7]), int(day[8:10])
    except ValueError:
        return None
    return vy - by - ((vm, vd) < (bm, bd))


@dataclass
class _Drug:
    code: str
    atc: str
    form: str
    points: float
    price: float


@dataclass
class _Visit:
    rec: ClaimEncounterRecord
    dept: str
    month: str
    day: str
    person: str
    doctor: str
    age: int | None
    dx: list[str]
    drugs: list[_Drug] = field(default_factory=list)
    orders: dict[str, tuple[float, float]] = field(default_factory=dict)

    @property
    def case(self) -> str:
        return str(self.rec.caseNo or "")

    @property
    def primary(self) -> str:
        return self.dx[0] if self.dx else ""

    def drug_case(self) -> bool:
        return float(self.rec.drugPoints or 0) > 0 or int(self.rec.daysSupply or 0) > 0 or bool(self.drugs)


def _visits(records: list[ClaimEncounterRecord], dept: str, facts: Callable[[str], dict[str, str]]) -> list[_Visit]:
    out: list[_Visit] = []
    for rec in records:
        if not rec.claimable:
            continue
        day = (rec.encounterDate or "")[:10]
        visit = _Visit(
            rec=rec,
            dept=dept,
            month=day[:7],
            day=day,
            person=(rec.patientId or rec.medicalNo or rec.encounterId or "").strip().upper(),
            doctor=(rec.doctorId or "").strip().upper(),
            age=_age(rec),
            dx=[_norm(code) for code in rec.diagnosisCodes if code],
        )
        for line in rec.medications:
            code = _norm(line.nhiCode)
            if not code:
                continue
            points = float(line.linePoints or 0)
            if len(code) == 10:
                info = facts(code) or {}
                visit.drugs.append(_Drug(code, _norm(info.get("atc")), str(info.get("form") or ""), points,
                                         float(line.unitPrice or 0)))
            else:
                qty, pts = visit.orders.get(code, (0.0, 0.0))
                visit.orders[code] = (qty + float(line.quantity or 1), pts + points)
        out.append(visit)
    return out


def _atc_drugs(visit: _Visit, cond: dict[str, Any]) -> list[_Drug]:
    want = [_norm(p) for p in cond.get("atc") or []]
    skip = [_norm(p) for p in cond.get("atcNot") or []]
    drop = {_norm(c) for c in cond.get("drugNot") or []}
    return [
        d for d in visit.drugs
        if d.atc and any(d.atc.startswith(p) for p in want)
        and not any(d.atc.startswith(p) for p in skip) and d.code not in drop
    ]


def _dx_allowed(visit: _Visit, groups: list[dict[str, Any]], atc_drugs: list[_Drug]) -> bool:
    for group in groups:
        if not any(dx_match(code, group.get("dx") or []) for code in visit.dx):
            continue
        need = group.get("ageMin")
        if need is None:
            return True
        for drug in atc_drugs or [None]:
            floor = int(need)
            for prefix, younger in (group.get("ageMinAtc") or {}).items():
                if drug and drug.atc.startswith(_norm(prefix)):
                    floor = int(younger)
            if visit.age is not None and visit.age >= floor:
                return True
    return False


def _meets(visit: _Visit, cond: dict[str, Any], base: dict[str, Any]) -> bool:
    if cond.get("dept") and visit.dept not in cond["dept"]:
        return False
    if cond.get("deptNot") and visit.dept in cond["deptNot"]:
        return False
    if visit.case in (cond.get("casesNot") or []):
        return False
    if cond.get("primaryDx") and not dx_match(visit.primary, cond["primaryDx"]):
        return False
    for group in cond.get("allDxGroups") or []:
        if not any(dx_match(code, group) for code in visit.dx):
            return False
    if cond.get("drugCase") and not visit.drug_case():
        return False
    if cond.get("consultPositive") and float(visit.rec.consultationPoints or 0) <= 0:
        return False
    if cond.get("orders") and not any(code in visit.orders for code in cond["orders"]):
        return False
    if cond.get("atc") and not _atc_drugs(visit, cond):
        return False
    if cond.get("atcMinDistinct"):
        if len({d.code for d in _atc_drugs(visit, base)}) < int(cond["atcMinDistinct"]):
            return False
    if "dxAllowedNone" in cond and _dx_allowed(visit, cond["dxAllowedNone"], _atc_drugs(visit, base)):
        return False
    return True


def _penalty_points(visit: _Visit, rule: dict[str, Any]) -> float:
    kind = rule.get("penalty")
    hit, base = rule.get("hit") or {}, rule.get("base") or {}
    rec = visit.rec
    if kind == "orders":
        return sum(visit.orders.get(code, (0, 0))[1] for code in hit.get("orders") or [])
    if kind == "atc":
        cond = hit if hit.get("atc") else base
        return sum(d.points for d in _atc_drugs(visit, cond))
    if kind == "drug":
        return float(rec.drugPoints or 0)
    if kind == "apply":
        return float(rec.applyPoints or 0)
    return float(rec.consultationPoints or 0) + float(rec.drugPoints or 0) + float(rec.treatmentPoints or 0) + float(
        rec.pharmacyPoints or 0
    )


def _case_row(visit: _Visit) -> dict[str, str]:
    rec = visit.rec
    return {
        "medicalNo": rec.medicalNo or "",
        "encounterDate": visit.day,
        "caseNo": visit.case,
        "encounterId": rec.encounterId,
        "chartPatientId": rec.chartPatientId or "",
        "patientName": rec.patientName or "",
    }


def _head(rule: dict[str, Any], month: str) -> dict[str, Any]:
    return {
        "id": rule["id"],
        "part": str(rule.get("part") or ""),
        "name": rule["name"],
        "kind": rule["kind"],
        "month": month,
        "note": str(rule.get("note") or ""),
        "applies": True,
        "over": False,
        "deduction": 0,
        "cases": [],
    }


def _rate(rule: dict[str, Any], visits: list[_Visit], month: str, clinic_cases: int) -> dict[str, Any]:
    out = _head(rule, month)
    base, hit = rule.get("base") or {}, rule.get("hit") or {}
    threshold = float(rule["threshold"])
    pool = [v for v in visits if _meets(v, base, base)]
    hits = [v for v in pool if _meets(v, hit, base)]
    if rule.get("unit") == "person":
        den, num = len({v.person for v in pool}), len({v.person for v in hits})
    else:
        den, num = len(pool), len(hits)
    out.update({"threshold": threshold, "numerator": num, "denominator": den,
                "rate": round(num / den, 4) if den else None})
    if den == 0 or den <= int(rule.get("minBase") or 0) or clinic_cases <= int(rule.get("clinicCasesOver") or 0):
        out["applies"] = False
        return out
    excess = num - den * threshold
    if excess > 0 and num:
        points = sum(_penalty_points(v, rule) for v in hits)
        out["over"] = True
        out["deduction"] = int(round(excess / num * points))
        out["cases"] = [_case_row(v) for v in hits[:_CASE_LIMIT]]
    return out


def _group_key(visit: _Visit, group: str) -> str:
    if group == "patient_day":
        return f"{visit.person}|{visit.day}"
    if group == "doctor_month":
        return f"{visit.doctor}|{visit.month}"
    return f"{visit.person}|{visit.month}"


def _cap(rule: dict[str, Any], visits: list[_Visit], month: str) -> dict[str, Any]:
    out = _head(rule, month)
    codes = list(rule.get("orders") or [])
    cap = int(rule["cap"])
    groups: dict[str, list[tuple[_Visit, float, float]]] = defaultdict(list)
    for visit in visits:
        qty = pts = 0.0
        for code in codes:
            q, p = visit.orders.get(code, (0.0, 0.0))
            if rule.get("skipZeroPoints") and p <= 0:
                continue
            qty, pts = qty + q, pts + p
        if qty > 0:
            groups[_group_key(visit, str(rule.get("group") or ""))].append((visit, qty, pts))
    over_rows: list[_Visit] = []
    deduction = 0.0
    total_over = 0.0
    for rows in groups.values():
        qty = sum(r[1] for r in rows)
        if qty <= cap:
            continue
        pts = sum(r[2] for r in rows)
        total_over += qty - cap
        deduction += (qty - cap) / qty * pts
        over_rows.extend(r[0] for r in rows)
    out.update({"cap": cap, "groups": len(groups), "overGroups": sum(1 for r in groups.values() if sum(x[1] for x in r) > cap),
                "excess": total_over})
    out["applies"] = bool(groups)
    if over_rows:
        out["over"] = True
        out["deduction"] = int(round(deduction))
        out["cases"] = [_case_row(v) for v in over_rows[:_CASE_LIMIT]]
    return out


def _rx_dup(rule: dict[str, Any], visits: list[_Visit], month: str) -> dict[str, Any]:
    out = _head(rule, month)
    flagged: list[_Visit] = []
    deduction = 0.0
    seen = 0
    for visit in visits:
        drugs = _atc_drugs(visit, {"atc": rule.get("atc") or []})
        if not drugs:
            continue
        seen += 1
        by_form: dict[str, list[_Drug]] = defaultdict(list)
        for drug in drugs:
            by_form[drug.form if rule.get("sameForm") else ""].append(drug)
        dup = False
        for same in by_form.values():
            distinct: dict[str, _Drug] = {}
            for drug in same:
                distinct.setdefault(drug.code, drug)
            if len(distinct) < 2:
                continue
            dup = True
            ranked = sorted(distinct.values(), key=lambda d: d.price, reverse=True)
            deduction += sum(d.points for d in ranked[1:])
        if dup:
            flagged.append(visit)
    out.update({"numerator": len(flagged), "denominator": seen})
    out["applies"] = seen > 0
    if flagged:
        out["over"] = True
        out["deduction"] = int(round(deduction))
        out["cases"] = [_case_row(v) for v in flagged[:_CASE_LIMIT]]
    return out


def _external(rule: dict[str, Any], visits: list[_Visit], month: str) -> dict[str, Any]:
    out = _head(rule, month)
    base = rule.get("base") or {}
    pool = [v for v in visits if _meets(v, base, base)]
    out.update({"numerator": None, "denominator": len(pool), "applies": bool(pool), "external": True})
    return out


def evaluate(
    records: list[ClaimEncounterRecord],
    rules: dict[str, Any],
    *,
    dept: str,
    facts: Callable[[str], dict[str, str]] | None = None,
) -> dict[str, Any]:
    if facts is None:
        from src.spoke.drug_price import drug_facts

        cache: dict[str, dict[str, str]] = {}

        def facts(code: str) -> dict[str, str]:
            if code not in cache:
                try:
                    cache[code] = drug_facts(code)
                except Exception:
                    cache[code] = {}
            return cache[code]

    visits = _visits(records, dept, facts)
    by_month: dict[str, list[_Visit]] = defaultdict(list)
    for visit in visits:
        by_month[visit.month].append(visit)
    items: list[dict[str, Any]] = []
    for month in sorted(by_month):
        group = by_month[month]
        for rule in rules.get("indicators") or []:
            effective = str(rule.get("effective") or "")[:7]
            if effective and month < effective:
                continue
            kind = rule.get("kind")
            if kind == "rate":
                items.append(_rate(rule, group, month, len(group)))
            elif kind == "cap":
                items.append(_cap(rule, group, month))
            elif kind == "rx_dup":
                items.append(_rx_dup(rule, group, month))
            elif kind == "external":
                items.append(_external(rule, group, month))
    return {
        "version": str(rules.get("version") or ""),
        "title": str(rules.get("title") or ""),
        "sources": rules.get("sources") or [],
        "dept": dept,
        "overCount": sum(1 for item in items if item["over"]),
        "deduction": sum(int(item["deduction"]) for item in items),
        "items": items,
    }
