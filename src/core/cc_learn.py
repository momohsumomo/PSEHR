# -*- coding: utf-8 -*-
"""Learn repeated chief-complaint lines from visits already on this computer.

Whole notes rarely repeat. Lines and the next line do. Each save updates the
counts, so the suggestions follow what this clinic actually types.
"""

from __future__ import annotations

import logging
import re
import sqlite3
import threading
import time
from collections import Counter, defaultdict
from pathlib import Path

from src.core.patient_visit_history import chief_complaint_text

log = logging.getLogger("cc_learn")

_SPLIT = set(".,;\uff0c\u3002\u3001\uff1b")
_NOISE = re.compile(r"^[\d\W_]+$", re.UNICODE)
_LOCK = threading.Lock()
_STARTED = False
_STALE_SEC = 60


def _norm(text: str) -> str:
    return " ".join(text.split()).lower()


# A word starts after a non-letter, so "5th" does not become the word "th".
_WORD = re.compile(r"(?:^|[^A-Za-z])([A-Za-z][A-Za-z'-]*)")


def words_of(text: str) -> list[tuple[str, str]]:
    """One (lowercase, original) pair per distinct word in this note."""
    raw = chief_complaint_text(text)
    found: list[tuple[str, str]] = []
    seen: set[str] = set()
    for surface in _WORD.findall(raw):
        if len(surface) < 2:
            continue
        norm = surface.lower()
        if norm in seen:
            continue
        seen.add(norm)
        found.append((norm, surface))
    return found


def _clauses(line: str) -> list[str]:
    buf: list[str] = []
    found: list[str] = []
    for ch in line:
        if ch in _SPLIT:
            piece = " ".join("".join(buf).split())
            if 4 <= len(piece) <= 60 and piece != line:
                found.append(piece)
            buf = []
        else:
            buf.append(ch)
    piece = " ".join("".join(buf).split())
    if 4 <= len(piece) <= 60 and piece != line:
        found.append(piece)
    return found


def analyze(text: str) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """Return (unique chunks as norm/surface, adjacent chunk pairs as norms)."""
    raw = chief_complaint_text(text)
    if not raw:
        return [], []
    unigrams: dict[str, str] = {}
    seq: list[str] = []
    for line in raw.replace("\r", "\n").split("\n"):
        line = " ".join(line.split())
        if len(line) < 4 or _NOISE.match(line):
            continue
        if len(line) <= 80:
            seq.append(line)
            unigrams.setdefault(_norm(line), line)
            for clause in _clauses(line):
                if not _NOISE.match(clause):
                    unigrams.setdefault(_norm(clause), clause)
            continue
        for clause in _clauses(line):
            if _NOISE.match(clause):
                continue
            seq.append(clause)
            unigrams.setdefault(_norm(clause), clause)
    pairs: list[tuple[str, str]] = []
    seen: set[tuple[str, str]] = set()
    norms = [_norm(piece) for piece in seq]
    for prev, nxt in zip(norms, norms[1:]):
        if not prev or not nxt or prev == nxt or (prev, nxt) in seen:
            continue
        seen.add((prev, nxt))
        pairs.append((prev, nxt))
    return list(unigrams.items()), pairs


def _connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=8000")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("PRAGMA case_sensitive_like=ON")
    return conn


def ensure_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cc_learn_meta (
            k TEXT PRIMARY KEY,
            v TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cc_learn_chunk (
            norm TEXT PRIMARY KEY,
            surface TEXT NOT NULL,
            n INTEGER NOT NULL,
            surface_n INTEGER NOT NULL,
            alt_surface TEXT NOT NULL DEFAULT '',
            alt_n INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cc_learn_pair (
            prev_norm TEXT NOT NULL,
            nxt_norm TEXT NOT NULL,
            n INTEGER NOT NULL,
            PRIMARY KEY (prev_norm, nxt_norm)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cc_learn_visit (
            encounter_id TEXT PRIMARY KEY,
            body TEXT NOT NULL
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cc_learn_word (
            norm TEXT PRIMARY KEY,
            surface TEXT NOT NULL,
            n INTEGER NOT NULL
        )
        """
    )


def _status(conn: sqlite3.Connection) -> str:
    row = conn.execute("SELECT v FROM cc_learn_meta WHERE k = 'status'").fetchone()
    return str(row["v"]) if row else ""


def _words_ready(conn: sqlite3.Connection) -> bool:
    row = conn.execute("SELECT v FROM cc_learn_meta WHERE k = 'words'").fetchone()
    return bool(row and str(row["v"]) == "done")


def _heartbeat(conn: sqlite3.Connection) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO cc_learn_meta(k, v) VALUES ('heartbeat', ?)",
        (str(time.time()),),
    )


def _claim(conn: sqlite3.Connection) -> bool:
    conn.execute("BEGIN IMMEDIATE")
    ensure_schema(conn)
    status = _status(conn)
    if status == "done":
        conn.commit()
        return False
    beat = conn.execute("SELECT v FROM cc_learn_meta WHERE k = 'heartbeat'").fetchone()
    if status == "running" and beat:
        try:
            age = time.time() - float(beat["v"])
        except ValueError:
            age = _STALE_SEC + 1
        if age < _STALE_SEC:
            conn.commit()
            return False
    conn.execute("INSERT OR REPLACE INTO cc_learn_meta(k, v) VALUES ('status', 'running')")
    _heartbeat(conn)
    conn.commit()
    return True


def _like_prefix(norm: str) -> str:
    escaped = norm.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return escaped + "%"


def _remember_surface(conn: sqlite3.Connection, norm: str, surface: str, delta: int) -> None:
    row = conn.execute(
        "SELECT surface, n, surface_n, alt_surface, alt_n FROM cc_learn_chunk WHERE norm = ?",
        (norm,),
    ).fetchone()
    if row is None:
        if delta > 0:
            conn.execute(
                """
                INSERT INTO cc_learn_chunk(norm, surface, n, surface_n, alt_surface, alt_n)
                VALUES (?, ?, ?, ?, '', 0)
                """,
                (norm, surface, delta, delta),
            )
        return
    n = int(row["n"]) + delta
    if n <= 0:
        conn.execute("DELETE FROM cc_learn_chunk WHERE norm = ?", (norm,))
        return
    surface_n = int(row["surface_n"])
    alt_surface = str(row["alt_surface"] or "")
    alt_n = int(row["alt_n"])
    winner = str(row["surface"])
    if delta > 0:
        if surface == winner:
            surface_n += 1
        elif surface == alt_surface:
            alt_n += 1
            if alt_n > surface_n:
                winner, alt_surface = alt_surface, winner
                surface_n, alt_n = alt_n, surface_n
        else:
            alt_surface = surface
            alt_n = 1
    conn.execute(
        """
        UPDATE cc_learn_chunk
        SET surface = ?, n = ?, surface_n = ?, alt_surface = ?, alt_n = ?
        WHERE norm = ?
        """,
        (winner, n, surface_n, alt_surface, alt_n, norm),
    )


def _apply(conn: sqlite3.Connection, text: str, delta: int) -> None:
    chunks, pairs = analyze(text)
    for norm, surface in chunks:
        _remember_surface(conn, norm, surface, delta)
    for prev, nxt in pairs:
        row = conn.execute(
            "SELECT n FROM cc_learn_pair WHERE prev_norm = ? AND nxt_norm = ?",
            (prev, nxt),
        ).fetchone()
        if row is None:
            if delta > 0:
                conn.execute(
                    "INSERT INTO cc_learn_pair(prev_norm, nxt_norm, n) VALUES (?, ?, ?)",
                    (prev, nxt, delta),
                )
            continue
        n = int(row["n"]) + delta
        if n <= 0:
            conn.execute(
                "DELETE FROM cc_learn_pair WHERE prev_norm = ? AND nxt_norm = ?",
                (prev, nxt),
            )
        else:
            conn.execute(
                "UPDATE cc_learn_pair SET n = ? WHERE prev_norm = ? AND nxt_norm = ?",
                (n, prev, nxt),
            )


def _apply_words(conn: sqlite3.Connection, text: str, delta: int) -> None:
    if not _words_ready(conn):
        return
    for norm, surface in words_of(text):
        row = conn.execute("SELECT surface, n FROM cc_learn_word WHERE norm = ?", (norm,)).fetchone()
        if row is None:
            if delta > 0:
                conn.execute(
                    "INSERT INTO cc_learn_word(norm, surface, n) VALUES (?, ?, ?)",
                    (norm, surface, delta),
                )
            continue
        n = int(row["n"]) + delta
        if n <= 0:
            conn.execute("DELETE FROM cc_learn_word WHERE norm = ?", (norm,))
            continue
        kept = str(row["surface"])
        if delta > 0 and surface[:1].isupper() and not kept[:1].isupper():
            kept = surface
        conn.execute(
            "UPDATE cc_learn_word SET surface = ?, n = ? WHERE norm = ?",
            (kept, n, norm),
        )


def index_words(db_path: Path) -> None:
    """Count words in stored chief complaints. A line is not a completion unit."""
    conn = _connect(db_path)
    try:
        ensure_schema(conn)
        if _words_ready(conn):
            return
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'encounter_index'"
        ).fetchone()
        counts: Counter[str] = Counter()
        surfaces: dict[str, Counter[str]] = defaultdict(Counter)
        if exists:
            read = _connect(db_path)
            try:
                loaded = read.execute(
                    """
                    SELECT chief_complaint FROM encounter_index
                    WHERE chief_complaint IS NOT NULL AND length(trim(chief_complaint)) > 0
                    """
                ).fetchall()
            finally:
                read.close()
            for row in loaded:
                for norm, surface in words_of(str(row["chief_complaint"] or "")):
                    counts[norm] += 1
                    surfaces[norm][surface] += 1
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM cc_learn_word")
        rows = []
        for norm, n in counts.items():
            surface = surfaces[norm].most_common(1)[0][0]
            rows.append((norm, surface, n))
        for start in range(0, len(rows), 2000):
            conn.executemany(
                "INSERT INTO cc_learn_word(norm, surface, n) VALUES (?, ?, ?)",
                rows[start : start + 2000],
            )
        conn.execute("INSERT OR REPLACE INTO cc_learn_meta(k, v) VALUES ('words', 'done')")
        conn.commit()
        log.info("cc words ready distinct=%s", len(rows))
    except Exception:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        raise
    finally:
        conn.close()


def _suffix_from(surface: str, fragment: str) -> str:
    typed = fragment.strip()
    if not typed:
        return surface
    if len(surface) <= len(typed):
        return ""
    if not surface.lower().startswith(typed.lower()):
        return ""
    return surface[len(typed) :]


def suggest_suffix(db_path: Path, fragment: str, previous: str = "") -> str:
    """Rest of the current word. A site plus a symptom is not one completion."""
    del previous
    typed = (fragment or "").strip()
    match = _WORD.search(" " + typed)
    word = match.group(1) if match else ""
    if word != typed or len(word) < 2:
        return ""
    conn = _connect(db_path)
    try:
        ensure_schema(conn)
        if not _words_ready(conn):
            return ""
        row = conn.execute(
            """
            SELECT surface FROM cc_learn_word
            WHERE n >= 2 AND norm LIKE ? ESCAPE '\\' AND length(surface) > ?
            ORDER BY n DESC, length(surface) ASC
            LIMIT 1
            """,
            (_like_prefix(word.lower()), len(word)),
        ).fetchone()
        if not row:
            return ""
        return _suffix_from(str(row["surface"]), word)
    finally:
        conn.close()


def top_phrases(db_path: Path, limit: int = 400) -> list[str]:
    conn = _connect(db_path)
    try:
        ensure_schema(conn)
        if _status(conn) != "done":
            return []
        rows = conn.execute(
            """
            SELECT surface FROM cc_learn_chunk
            WHERE n >= 2
            ORDER BY n DESC, length(surface) ASC
            LIMIT ?
            """,
            (max(1, limit),),
        ).fetchall()
        return [str(row["surface"]) for row in rows]
    finally:
        conn.close()


def observe(db_path: Path, encounter_id: str, text: str) -> None:
    """Count this visit's chief complaint. Editing the same visit moves the counts."""
    eid = (encounter_id or "").strip()
    if not eid:
        return
    body = chief_complaint_text(text)
    with _LOCK:
        conn = _connect(db_path)
        try:
            ensure_schema(conn)
            if _status(conn) != "done":
                return
            conn.execute("BEGIN IMMEDIATE")
            row = conn.execute(
                "SELECT body FROM cc_learn_visit WHERE encounter_id = ?",
                (eid,),
            ).fetchone()
            old = str(row["body"]) if row else ""
            if old == body:
                conn.rollback()
                return
            if old:
                _apply(conn, old, -1)
                _apply_words(conn, old, -1)
            if body:
                _apply(conn, body, 1)
                _apply_words(conn, body, 1)
                conn.execute(
                    """
                    INSERT INTO cc_learn_visit(encounter_id, body) VALUES (?, ?)
                    ON CONFLICT(encounter_id) DO UPDATE SET body = excluded.body
                    """,
                    (eid, body),
                )
            else:
                conn.execute("DELETE FROM cc_learn_visit WHERE encounter_id = ?", (eid,))
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def bootstrap(db_path: Path) -> None:
    """One pass over stored chief complaints. Later saves update the same tables."""
    conn = _connect(db_path)
    try:
        if not _claim(conn):
            return
        exists = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'encounter_index'"
        ).fetchone()
        if not exists:
            conn.execute("INSERT OR REPLACE INTO cc_learn_meta(k, v) VALUES ('status', 'done')")
            conn.commit()
            return
        chunk_n: Counter[str] = Counter()
        surfaces: dict[str, Counter[str]] = defaultdict(Counter)
        pair_n: Counter[tuple[str, str]] = Counter()
        visits: list[tuple[str, str]] = []
        read = _connect(db_path)
        try:
            loaded = read.execute(
                """
                SELECT resource_id, chief_complaint FROM encounter_index
                WHERE chief_complaint IS NOT NULL AND length(trim(chief_complaint)) > 0
                """
            ).fetchall()
        finally:
            read.close()
        for index, row in enumerate(loaded, start=1):
            if index % 20000 == 0:
                beat = _connect(db_path)
                try:
                    _heartbeat(beat)
                    beat.commit()
                finally:
                    beat.close()
            body = chief_complaint_text(row["chief_complaint"] or "")
            if not body:
                continue
            eid = str(row["resource_id"] or "").strip()
            if not eid:
                continue
            chunks, pairs = analyze(body)
            for norm, surface in chunks:
                chunk_n[norm] += 1
                surfaces[norm][surface] += 1
            pair_n.update(pairs)
            visits.append((eid, body))
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM cc_learn_chunk")
        conn.execute("DELETE FROM cc_learn_pair")
        conn.execute("DELETE FROM cc_learn_visit")
        conn.commit()
        chunk_rows = []
        for norm, n in chunk_n.items():
            ranking = surfaces[norm].most_common(2)
            surface, surface_n = ranking[0]
            alt_surface, alt_n = ranking[1] if len(ranking) > 1 else ("", 0)
            chunk_rows.append((norm, surface, n, surface_n, alt_surface, alt_n))
        for start in range(0, len(chunk_rows), 2000):
            conn.executemany(
                """
                INSERT INTO cc_learn_chunk(norm, surface, n, surface_n, alt_surface, alt_n)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                chunk_rows[start : start + 2000],
            )
            _heartbeat(conn)
            conn.commit()
        pair_rows = [(prev, nxt, n) for (prev, nxt), n in pair_n.items()]
        for start in range(0, len(pair_rows), 2000):
            conn.executemany(
                "INSERT INTO cc_learn_pair(prev_norm, nxt_norm, n) VALUES (?, ?, ?)",
                pair_rows[start : start + 2000],
            )
            _heartbeat(conn)
            conn.commit()
        for start in range(0, len(visits), 2000):
            conn.executemany(
                "INSERT INTO cc_learn_visit(encounter_id, body) VALUES (?, ?)",
                visits[start : start + 2000],
            )
            _heartbeat(conn)
            conn.commit()
        conn.execute("INSERT OR REPLACE INTO cc_learn_meta(k, v) VALUES ('status', 'done')")
        _heartbeat(conn)
        conn.commit()
        ready = sum(1 for n in chunk_n.values() if n >= 2)
        log.info("cc learn ready visits=%s repeated_lines=%s", len(visits), ready)
    except Exception:
        try:
            conn.rollback()
        except sqlite3.Error:
            pass
        log.exception("cc learn bootstrap failed")
        raise
    finally:
        conn.close()
        try:
            index_words(Path(db_path))
        except Exception:
            log.exception("cc word index failed")


def start_cc_learner(db_path: Path) -> None:
    global _STARTED
    with _LOCK:
        if _STARTED:
            return
        _STARTED = True

    def run() -> None:
        try:
            bootstrap(Path(db_path))
        except Exception:
            log.exception("cc learn background failed")

    threading.Thread(target=run, name="cc-learn", daemon=True).start()
