"""MedicationRequest billing values kept in FHIR JSON.

Every medication_request_index billing column comes from one of these
extensions (or the dispenseRequest twin for days/quantity). Readers match on
the trailing "/key", so both billing bases on disk are read; new writes use
MEDICATION_BILLING.
"""

from __future__ import annotations

from typing import Any

from src.core.fhir_urls import MEDICATION_BILLING

# (index column, extension key, value type)
BILLING_FIELDS = (
    ("days_supply", "daysSupply", "integer"),
    ("quantity", "quantity", "decimal"),
    ("unit_price", "unitPrice", "decimal"),
    ("pack_version", "packVersion", "string"),
    ("body_site", "bodySite", "string"),
    ("pay_mark", "payMark", "string"),
    ("memo_mark", "memoMark", "string"),
    ("total_qty", "totalQty", "decimal"),
    ("use_type", "useType", "string"),
    ("line_sort", "lineSort", "integer"),
)
_KEY = {col: (key, kind) for col, key, kind in BILLING_FIELDS}
_UCUM = "http://unitsofmeasure.org"


def _is_key(url: str, key: str) -> bool:
    return url.endswith("/" + key)


def has_key(payload: dict[str, Any], key: str) -> bool:
    return any(
        isinstance(e, dict) and _is_key(str(e.get("url") or ""), key) for e in payload.get("extension") or []
    )


def put_billing(payload: dict[str, Any], values: dict[str, Any]) -> None:
    """Set billing columns. None removes the value."""
    exts = [e for e in payload.get("extension") or [] if isinstance(e, dict)]
    for col, value in values.items():
        key, kind = _KEY[col]
        exts = [e for e in exts if not _is_key(str(e.get("url") or ""), key)]
        if value is not None:
            if kind == "integer":
                exts.append({"url": f"{MEDICATION_BILLING}/{key}", "valueInteger": int(value)})
            elif kind == "decimal":
                exts.append({"url": f"{MEDICATION_BILLING}/{key}", "valueDecimal": float(value)})
            else:
                exts.append({"url": f"{MEDICATION_BILLING}/{key}", "valueString": str(value)})
        if col in ("days_supply", "quantity"):
            _put_dispense(payload, col, value)
    if exts:
        payload["extension"] = exts
    else:
        payload.pop("extension", None)


def _put_dispense(payload: dict[str, Any], col: str, value: Any) -> None:
    dispense = payload.get("dispenseRequest")
    dispense = dict(dispense) if isinstance(dispense, dict) else {}
    if col == "quantity":
        if value is None:
            dispense.pop("quantity", None)
        else:
            dispense["quantity"] = {"value": float(value)}
    else:
        if value is None:
            dispense.pop("expectedSupplyDuration", None)
        else:
            dispense["expectedSupplyDuration"] = {"value": int(value), "unit": "d", "system": _UCUM, "code": "d"}
    if dispense:
        payload["dispenseRequest"] = dispense
    else:
        payload.pop("dispenseRequest", None)


def put_useage(payload: dict[str, Any], useage: str | None) -> None:
    if useage is None or not str(useage).strip():
        payload.pop("dosageInstruction", None)
    else:
        payload["dosageInstruction"] = [{"text": str(useage)}]


def carry_billing(old_fields: dict[str, Any] | None, new_payload: dict[str, Any], new_fields: dict[str, Any]) -> None:
    """A later save that leaves a value out keeps the stored one.

    Days, quantity and the original billing marks stay; price and price period
    stay only while the drug code is the same. Body site follows the new save.
    """
    if not old_fields:
        return
    same_drug = old_fields.get("nhi_code") == new_fields.get("nhi_code")
    keep: dict[str, Any] = {}
    for col in ("days_supply", "quantity", "total_qty", "use_type", "line_sort"):
        if new_fields.get(col) is None and old_fields.get(col) is not None:
            keep[col] = old_fields[col]
    for col in ("pay_mark", "memo_mark"):
        if not has_key(new_payload, _KEY[col][0]) and old_fields.get(col) is not None:
            keep[col] = old_fields[col]
    if same_drug:
        for col in ("unit_price", "pack_version"):
            if new_fields.get(col) is None and old_fields.get(col) is not None:
                keep[col] = old_fields[col]
    if keep:
        put_billing(new_payload, keep)
    if "dosageInstruction" not in new_payload and old_fields.get("useage") is not None:
        put_useage(new_payload, old_fields["useage"])
