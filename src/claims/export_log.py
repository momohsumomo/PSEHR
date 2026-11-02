"""Which visits already went into a monthly file made here.

A supplementary file (bubao) may only carry visits that no earlier file of the
month carried; otherwise the whole month is claimed twice.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import date, datetime
from typing import Any

from src.claims.engine import ClaimsSummary

_KEY = "claims_export_log:%s"
_HISTORY_KEEP = 20

ALREADY_FILED = "\u5df2\u5728\u9019\u500b\u6708\u4e4b\u524d\u7684\u7533\u5831\u6a94\uff0c\u88dc\u5831\u4e0d\u518d\u653e"
NO_SONGHE = (
    "\u9019\u500b\u6708\u6c92\u6709\u5728\u672c\u7cfb\u7d71\u7522\u904e\u9001\u6838\u6a94\uff0c"
    "\u4e0d\u77e5\u9053\u54ea\u4e9b\u5df2\u7533\u5831\uff0c\u4e0d\u80fd\u88dc\u5831\u3002"
    "\u9001\u6838\u6a94\u5982\u679c\u5df2\u7d93\u4e0a\u50b3\u904e\uff0c\u4e0d\u8981\u518d\u9001\u4e00\u6b21\uff0c\u8acb\u554f\u8ca0\u8cac\u7684\u4eba\u3002"
)
NOTHING_NEW = "\u9001\u6838\u4e4b\u5f8c\u6c92\u6709\u65b0\u88dc\u4e0a\u7684\u770b\u8a3a\uff0c\u4e0d\u7528\u88dc\u5831"
MONTH_OPEN = (
    "\u9019\u500b\u6708\u9084\u6c92\u904e\u5b8c\uff0c\u73fe\u5728\u53ea\u80fd\u6aa2\u67e5\uff0c"
    "\u4e0d\u80fd\u7522\u7533\u5831\u6a94\u3002\u6708\u5e95\u904e\u4e86\u518d\u505a\u3002"
)


def month_open(date_month: str, today: date | None = None) -> bool:
    """A fee month can be filed only after it ends."""
    day = today or date.today()
    return (date_month or "")[:7] >= f"{day.year:04d}-{day.month:02d}"


def load(store: Any, date_month: str) -> dict[str, Any]:
    raw = store.get_json_setting(_KEY % date_month[:7]) or {}
    if not isinstance(raw, dict):
        raw = {}
    filed = raw.get("filed") if isinstance(raw.get("filed"), list) else []
    history = raw.get("history") if isinstance(raw.get("history"), list) else []
    return {"filed": [str(x) for x in filed], "history": [h for h in history if isinstance(h, dict)]}


def has_songhe(log: dict[str, Any]) -> bool:
    return any(h.get("kind") == "songhe" for h in log.get("history") or [])


def record(store: Any, summary: ClaimsSummary, submit_type: str, now: datetime | None = None) -> dict[str, Any]:
    log = load(store, summary.yearMonth)
    ids = [rec.encounterId for rec in summary.records if rec.claimable]
    filed = sorted(set(log["filed"]) | set(ids))
    points = sum(int(round(float(rec.applyPoints or rec.totalPoints or 0))) for rec in summary.records if rec.claimable)
    entry = {
        "at": (now or datetime.now()).replace(microsecond=0).isoformat(sep=" "),
        "kind": "bubao" if submit_type == "bubao" else "songhe",
        "count": len(ids),
        "points": points,
    }
    history = (log["history"] + [entry])[-_HISTORY_KEEP:]
    saved = {"filed": filed, "history": history}
    store.set_json_setting(_KEY % summary.yearMonth[:7], saved)
    return saved


def only_new(summary: ClaimsSummary, log: dict[str, Any]) -> ClaimsSummary:
    """Supplementary file: drop every visit an earlier file of this month already carried."""
    filed = set(log.get("filed") or [])
    records = []
    for rec in summary.records:
        if rec.claimable and rec.encounterId in filed:
            rec = replace(rec, claimable=False, caseReason=ALREADY_FILED)
        records.append(rec)
    kept = [r for r in records if r.claimable]
    consult = round(sum(r.consultationPoints for r in kept), 2)
    drug = round(sum(r.drugPoints for r in kept), 2)
    pharm = round(sum(float(r.pharmacyPoints or 0) for r in kept), 2)
    tx = round(sum(float(r.treatmentPoints or 0) for r in kept), 2)
    return replace(
        summary,
        records=records,
        finishedEncounters=len(kept),
        totalConsultationPoints=consult,
        totalDrugPoints=drug,
        totalPharmacyPoints=pharm,
        totalTreatmentPoints=tx,
        totalPoints=round(consult + drug + pharm + tx, 2),
    )
