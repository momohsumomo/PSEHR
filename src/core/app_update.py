"""Whole-tree program update from the public GitHub repo.

Clinic files under data/ stay where they are. A folder that still contains
.git is a development tree and will not overwrite itself.
"""

from __future__ import annotations

import json
import re
import subprocess
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from src.core.github_release import recent_releases

REPO = "momohsumomo/PSEHR"
ROOT = Path(__file__).resolve().parents[2]
RELEASES_URL = f"https://api.github.com/repos/{REPO}/releases?per_page=30"
PROGRAM_PREFIX = "program-"
# Latest, plus four older files so a new publish still reaches two or three back.
PROGRAM_WINDOW = 5
VERSION_RE = re.compile(r"^program-\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?$")
DEV_TREE_MSG = "\u9019\u53f0\u662f\u958b\u767c\u7528\u7684\u7a0b\u5f0f\u8cc7\u6599\u593e\uff0c\u8acb\u63a8\u4e0a GitHub\u3002\u4e0d\u8981\u5728\u9019\u88e1\u84cb\u6a94\u3002"
WINDOW_MSG = "\u53ea\u80fd\u63db\u6210\u6700\u8fd1\u9019\u5e7e\u4efd\u66f4\u65b0\u6a94\u3002"
NO_RELEASE_MSG = "\u9084\u6c92\u6709\u8edf\u9ad4\u66f4\u65b0\u6a94\u3002"
_BACK_LABEL = {
    1: "\u4e0a\u4e00\u500b\u7248\u672c",
    2: "\u5169\u500b\u7248\u672c\u524d",
    3: "\u4e09\u500b\u7248\u672c\u524d",
    4: "\u56db\u500b\u7248\u672c\u524d",
}


def stamp_path(root: Path) -> Path:
    return root / "program.json"


def _read_stamp(root: Path) -> dict[str, str]:
    path = stamp_path(root)
    if not path.is_file():
        return {"commit": "", "version": ""}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"commit": "", "version": ""}
    if not isinstance(data, dict):
        return {"commit": "", "version": ""}
    return {
        "commit": str(data.get("commit") or "").strip(),
        "version": str(data.get("version") or "").strip(),
    }


def read_stamp(root: Path) -> str:
    return _read_stamp(root)["commit"]


def read_version(root: Path) -> str:
    return _read_stamp(root)["version"]


def git_head(root: Path) -> str:
    git = root / ".git"
    if not git.exists():
        return ""
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            timeout=8,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    if out.returncode != 0:
        return ""
    return (out.stdout or "").strip()


def local_commit(root: Path | None = None) -> str:
    root = root or ROOT
    stamped = read_stamp(root)
    if stamped:
        return stamped
    return git_head(root)


def _github_json(url: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={"Accept": "application/vnd.github+json", "User-Agent": "psehr-app-update"},
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def list_releases() -> list[dict[str, Any]]:
    payload = _github_json(RELEASES_URL)
    if not isinstance(payload, list):
        return []
    return [item for item in payload if isinstance(item, dict)]


def _row(item: dict[str, Any]) -> dict[str, str]:
    return {
        "version": str(item.get("tag_name") or "").strip(),
        "commit": str(item.get("target_commitish") or "").strip(),
        "zipUrl": str(item.get("zipball_url") or "").strip(),
    }


def program_window(items: list[dict[str, Any]]) -> list[dict[str, str]]:
    return [_row(item) for item in recent_releases(items, PROGRAM_PREFIX, PROGRAM_WINDOW)]


def select_program(items: list[dict[str, Any]], version: str = "") -> dict[str, str]:
    rows = program_window(items)
    if not rows:
        raise RuntimeError(NO_RELEASE_MSG)
    chosen = version.strip()
    if not chosen:
        return rows[0]
    if not VERSION_RE.fullmatch(chosen):
        raise RuntimeError(WINDOW_MSG)
    for row in rows:
        if row["version"] == chosen:
            return row
    raise RuntimeError(WINDOW_MSG)


def remote_program() -> dict[str, str] | None:
    try:
        return select_program(list_releases())
    except RuntimeError:
        return None


def describe(root: Path | None = None) -> dict:
    root = root or ROOT
    dev = (root / ".git").is_dir()
    local = local_commit(root)
    local_version = read_version(root)
    detail = ""
    remote_version = ""
    remote_commit = ""
    history: list[dict[str, str]] = []
    hit: dict[str, str] | None = None
    try:
        history = program_window(list_releases())
        hit = history[0] if history else None
    except Exception as exc:
        detail = "\u9023\u4e0d\u4e0a GitHub\u3002" + str(exc)
    if hit:
        remote_version = hit["version"]
        remote_commit = hit["commit"]
    same = bool(remote_version) and remote_version == local_version
    rollback: list[dict[str, Any]] = []
    if history:
        for index, row in enumerate(history[1:], start=1):
            rollback.append(
                {
                    "version": row["version"],
                    "commit": row["commit"],
                    "stepsBack": index,
                    "label": _BACK_LABEL.get(index, ""),
                    "installed": bool(row["version"]) and row["version"] == local_version,
                    "canApply": (not dev) and bool(row["zipUrl"]) and row["version"] != local_version,
                }
            )
    if dev:
        detail = detail or DEV_TREE_MSG
    elif not remote_version:
        detail = detail or "\u9084\u6c92\u6709\u8edf\u9ad4\u66f4\u65b0\u6a94\u3002\u85e5\u50f9\u662f\u53e6\u4e00\u689d\uff0c\u4e0d\u6703\u6539\u5230\u7a0b\u5f0f\u3002"
    elif same:
        detail = detail or "\u8edf\u9ad4\u5df2\u662f\u9019\u4efd\u66f4\u65b0\u6a94\u3002\u8981\u56de\u5230\u5169\u500b\u6216\u4e09\u500b\u7248\u672c\u524d\uff0c\u6309\u4e0b\u9762\u7684\u56de\u6efe\u3002"
    else:
        detail = detail or "\u6709\u4e00\u4efd\u8edf\u9ad4\u66f4\u65b0\u6a94\u3002\u53ea\u63db\u7a0b\u5f0f\uff0c\u75c5\u6b77\u6a94\u7559\u5728\u539f\u4f86\u7684\u4f4d\u7f6e\u3002\u65b0\u6b04\u4f4d\u6703\u5728\u555f\u52d5\u6642\u88dc\u4e0a\u3002"
    return {
        "localCommit": local,
        "localVersion": local_version,
        "remoteCommit": remote_commit,
        "remoteVersion": remote_version,
        "updateAvailable": bool(remote_version) and not same,
        "devTree": dev,
        "canApply": (not dev) and bool(remote_version) and not same and bool(hit and hit.get("zipUrl")),
        "rollback": rollback,
        "detail": detail,
    }


def _download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "psehr-app-update"})
    with urllib.request.urlopen(req, timeout=180) as resp, dest.open("wb") as out:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            out.write(chunk)


def _apply_script(root: Path, sha: str, version: str) -> Path:
    stage = root / "data" / "updates"
    stage.mkdir(parents=True, exist_ok=True)
    script = stage / "apply.ps1"
    log = root / "data" / "logs" / "app-update.log"
    text = "\n".join(
        [
            "$ErrorActionPreference = 'Continue'",
            f"$Root = '{root}'",
            f"$Sha = '{sha}'",
            f"$Version = '{version}'",
            f"$Log = '{log}'",
            "$Stage = Join-Path $Root 'data\\updates\\expanded'",
            "$Zip = Join-Path $Root 'data\\updates\\main.zip'",
            "New-Item -ItemType Directory -Force -Path (Split-Path $Log) | Out-Null",
            "function Note([string]$Line) { Add-Content -Path $Log -Value ((Get-Date).ToString('s') + ' ' + $Line) }",
            "Start-Sleep -Seconds 3",
            "Note 'stop'",
            "& (Join-Path $Root 'scripts\\host_service.ps1') -Action stop",
            "if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }",
            "New-Item -ItemType Directory -Force -Path $Stage | Out-Null",
            "Expand-Archive -Path $Zip -DestinationPath $Stage -Force",
            "$Top = Get-ChildItem $Stage -Directory | Select-Object -First 1",
            "if (-not $Top) { Note 'zip has no folder'; exit 1 }",
            "Note ('copy ' + $Top.FullName)",
            "& robocopy $Top.FullName $Root /E /XD data .venv .git node_modules /NFL /NDL /NJH /NJS /NC /NS /NP",
            "if ($LASTEXITCODE -ge 8) { Note ('robocopy ' + $LASTEXITCODE); exit 1 }",
            "$stamp = @{ commit = $Sha; version = $Version; installedAt = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json",
            "Set-Content -Path (Join-Path $Root 'program.json') -Value $stamp -Encoding UTF8",
            "$py = Join-Path $Root '.venv\\Scripts\\python.exe'",
            "if (Test-Path $py) {",
            "  Note 'pip'",
            "  & $py -m pip install -q -r (Join-Path $Root 'requirements.txt')",
            "  if ($LASTEXITCODE -ne 0) { Note 'pip failed' }",
            "}",
            "Note 'npm'",
            "Push-Location (Join-Path $Root 'frontend')",
            "& npm install --silent",
            "if ($LASTEXITCODE -ne 0) { Note 'npm failed' }",
            "Pop-Location",
            "Note 'start'",
            "& (Join-Path $Root 'scripts\\host_service.ps1') -Action start",
            "Note 'done'",
            "",
        ]
    )
    script.write_text(text, encoding="utf-8")
    return script


def begin_apply(root: Path | None = None, version: str = "") -> dict:
    root = root or ROOT
    if (root / ".git").is_dir():
        raise RuntimeError(DEV_TREE_MSG)
    try:
        remote = select_program(list_releases(), version)
    except RuntimeError:
        raise
    except Exception as exc:
        raise RuntimeError("\u9023\u4e0d\u4e0a GitHub\u3002" + str(exc)) from exc
    if not remote.get("zipUrl"):
        raise RuntimeError(NO_RELEASE_MSG)
    if read_version(root) == remote["version"]:
        return {"ok": True, "already": True, "remoteVersion": remote["version"]}
    folder = root / "data" / "updates"
    folder.mkdir(parents=True, exist_ok=True)
    _download(remote["zipUrl"], folder / "main.zip")
    script = _apply_script(root, remote["commit"], remote["version"])
    subprocess.Popen(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            "Start-Process -WindowStyle Hidden -FilePath powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File','"
            + str(script).replace("'", "''")
            + "')",
        ],
        cwd=str(root),
        creationflags=0x08000000,
        close_fds=True,
    )
    return {
        "ok": True,
        "restarting": True,
        "remoteVersion": remote["version"],
        "detail": "\u670d\u52d9\u6703\u505c\u4e00\u4e0b\u518d\u8d77\u4f86\u3002\u75c5\u6b77\u7559\u5728\u539f\u4f86\u7684\u4f4d\u7f6e\u3002",
    }


def write_stamp(root: Path, commit: str, version: str = "") -> None:
    stamp_path(root).write_text(
        json.dumps(
            {
                "commit": commit,
                "version": version,
                "installedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )
