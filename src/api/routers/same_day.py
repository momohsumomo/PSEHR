# -*- coding: utf-8 -*-
"""Same-day encounters: local shadow + optional NHI cloud (Treatment/NoNeedHPC)."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.app.bootstrap import get_shadow_store
from src.core.encounter_extensions import extract_reg_meta
from src.core.nhi_cshis6_client import DEFAULT_CONSOLE_BASE
from src.core.nhi_treatment_bridge import query_recent_treatments

router = APIRouter(prefix="/nhi/v1/same-day", tags=["SameDay"])


def _roc7_from_iso(day: str) -> str:
    # YYYY-MM-DD -> YYYMMDD
    try:
        y, m, d = day[:10].split("-")
        return f"{int(y) - 1911:03d}{m}{d}"
    except Exception:
        return ""


@router.get("")
def list_same_day(
    patient_id: str = Query(..., alias="patientId"),
    date_day: str = Query(..., alias="date", description="YYYY-MM-DD"),
    include_cloud: bool = Query(True, alias="includeCloud"),
    console_base: str = Query(DEFAULT_CONSOLE_BASE, alias="consoleBase"),
) -> dict[str, Any]:
    pid = patient_id.strip()
    day = date_day[:10]
    if not pid or len(day) < 10:
        raise HTTPException(status_code=400, detail="patientId and date required")
    store = get_shadow_store()
    with store._connect() as conn:
        rows = conn.execute(
            """
            SELECT resource_id, queue_number, queue_status, encounter_date
            FROM encounter_index
            WHERE patient_id = ?
              AND encounter_date = ?
              AND IFNULL(queue_status,'') != 'cancelled'
            ORDER BY queue_number ASC
            """,
            (pid, day),
        ).fetchall()
    hits: list[dict[str, Any]] = []
    for r in rows:
        eid = r[0]
        reg: dict[str, Any] = {}
        try:
            with store._connect() as conn:
                payload = conn.execute(
                    "SELECT payload_json FROM resource_cache WHERE resource_type=? AND resource_id=?",
                    ("Encounter", eid),
                ).fetchone()
                if payload and payload[0]:
                    enc = json.loads(payload[0]) if isinstance(payload[0], str) else payload[0]
                    reg = extract_reg_meta(enc or {})
        except Exception:
            reg = {}
        hits.append(
            {
                "encounterId": eid,
                "queueNumber": r[1],
                "queueStatus": r[2],
                "encounterDate": r[3],
                "treatSeq": reg.get("treatSeq") or "",
                "caseNo": reg.get("caseNo") or "",
                "doctorName": reg.get("doctorName") or "",
                "hospitalId": "",
                "source": "local_shadow",
                "prebook": (
                    (bool(reg.get("prebook")) or str(reg.get("forespeak") or "") == "\u9810")
                    and str(r[2] or "") == "waiting"
                ),
            }
        )

    cloud_note = ""
    cloud_error = ""
    cloud_hits: list[dict[str, Any]] = []
    if include_cloud:
        q = query_recent_treatments(console_base=console_base)
        if not q.ok:
            cloud_error = q.reason or "cloud query failed"
            cloud_note = "cloud unavailable; local only"
        else:
            roc7 = _roc7_from_iso(day)
            for t in q.treatments:
                dt = (t.treatDateTime or "")[:7]
                if roc7 and dt and dt != roc7:
                    continue
                cloud_hits.append(
                    {
                        "encounterId": "",
                        "queueNumber": None,
                        "queueStatus": "",
                        "encounterDate": day,
                        "treatSeq": t.hospitalVisit,
                        "caseNo": t.treatmentItem,
                        "doctorName": "",
                        "hospitalId": t.hospitalId,
                        "treatDateTime": t.treatDateTime,
                        "outpatientFee": t.outpatientFee,
                        "source": "nhi_cloud",
                    }
                )
            cloud_note = f"cloud treatments matched day: {len(cloud_hits)} / returned {len(q.treatments)}"

    all_hits = hits + cloud_hits
    return {
        "patientId": pid,
        "date": day,
        "count": len(all_hits),
        "localCount": len(hits),
        "cloudCount": len(cloud_hits),
        "isSameDay": len(all_hits) > 0,
        "encounters": all_hits,
        "cloudOk": bool(include_cloud and not cloud_error),
        "cloudError": cloud_error,
        "note": cloud_note or "local clinic shadow",
    }
