# -*- coding: utf-8 -*-
"""Open this clinic's own window on this PC. Only the lobby and the kiosk."""

from __future__ import annotations

import subprocess
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_KINDS = {"main", "kiosk", "intake"}


def open_desktop_window(target: str = "main") -> str:
    kind = (target or "main").strip().lower()
    if kind not in _KINDS:
        raise ValueError(kind)
    bat = _ROOT / "scripts" / "open_desktop_window.bat"
    if not bat.is_file():
        raise RuntimeError("desktop launcher missing")
    subprocess.Popen(
        ["cmd", "/c", str(bat), "" if kind == "main" else kind],
        cwd=str(_ROOT),
        close_fds=True,
    )
    return kind
