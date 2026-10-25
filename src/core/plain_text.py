"""Characters XML 1.0 forbids. A leftover null from a card name breaks a whole file."""

from __future__ import annotations

import re
from typing import Any

_ILLEGAL = re.compile(r"[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]")


def plain_text(value: str | None) -> str:
    return _ILLEGAL.sub("", str(value or ""))


def sanitize_patient_names(payload: dict[str, Any]) -> None:
    """Drop illegal characters before a patient name is stored."""
    for name in payload.get("name") or []:
        if not isinstance(name, dict):
            continue
        if name.get("family") is not None:
            name["family"] = plain_text(str(name["family"]))
        given = name.get("given")
        if isinstance(given, list):
            name["given"] = [plain_text(str(part)) for part in given]
        if name.get("text") is not None:
            name["text"] = plain_text(str(name["text"]))
