"""Stop a second same-shift visit or a reused queue number until the desk confirms."""

from __future__ import annotations

_DEAD = {"cancelled", "entered-in-error"}

_PERSON = (
    "\u9019\u500b\u4eba\u9019\u500b\u6642\u6bb5\u5df2\u7d93\u6709\u4e00\u7b46\u3002"
    "\u78ba\u5b9a\u8981\u518d\u639b\uff0c\u8981\u518d\u78ba\u8a8d\u4e00\u6b21\u3002"
)
_NUMBER = (
    "\u9019\u500b\u6642\u6bb5\u9019\u500b\u865f\u78bc\u5df2\u7d93\u6709\u4eba\u3002"
    "\u78ba\u5b9a\u8981\u91cd\u865f\uff0c\u8981\u518d\u78ba\u8a8d\u4e00\u6b21\u3002"
)


def duplicate_register_message(
    entries: list[dict],
    *,
    patient_id: str,
    shift: str,
    queue_number: int | None,
    confirm: bool,
) -> str:
    if confirm:
        return ""
    want_shift = (shift or "").strip()
    pid = (patient_id or "").strip().split("/")[-1]
    want_q = int(queue_number or 0)
    for entry in entries:
        meta = entry.get("queueMeta") or {}
        status = str(meta.get("queueStatus") or "")
        if status in _DEAD:
            continue
        their_shift = str(meta.get("shift") or "").strip()
        if want_shift and their_shift and want_shift != their_shift:
            continue
        their_pid = str(meta.get("patientId") or "").split("/")[-1]
        if pid and their_pid == pid:
            return _PERSON
        try:
            their_q = int(meta.get("queueNumber") or 0)
        except (TypeError, ValueError):
            their_q = 0
        if want_q and their_q == want_q:
            return _NUMBER
    return ""
