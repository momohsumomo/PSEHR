# -*- coding: utf-8 -*-
"""Chief-complaint phrase book (CC.Dat) for Tab completion and intake wording."""

from __future__ import annotations

import os
import threading
from typing import Any

_lock = threading.Lock()
_phrases: list[tuple[int, str]] | None = None

_LOCATION = {
    "facial": ("face", "facial", "cheek", "scalp", "forehead", "head"),
    "trunk": ("trunk", "back", "chest", "abdomen", "torso"),
    "limbs": ("arm", "leg", "hand", "foot", "nail", "extrem", "finger", "toe"),
    "other": ("refill", "medication", "drug"),
}
_SYMPTOM = {
    "itching_erythema": ("itch", "erythem", "pain", "swell", "red"),
    "sebum_acne": ("acne", "comedone", "pustule", "sebum"),
    "scale": ("scale", "desquam", "lichen", "dry"),
    "spot": ("pigment", "patch", "whitish", "macule", "spot"),
    "refill": ("refill", "medication"),
}
_DURATION = {
    "within_days": ("day", "days"),
    "weeks": ("week", "weeks"),
    "chronic": ("recurrent", "chronic", "month", "months"),
}


def _load() -> list[tuple[int, str]]:
    global _phrases
    with _lock:
        if _phrases is not None:
            return _phrases
        from scripts.import_yisheng_data import read_dbf_records

        path = os.path.join(os.environ.get("YISHENG_DAT", r"Z:\SC\dat"), "CC.Dat")
        found: list[tuple[int, str]] = []
        seen: set[str] = set()
        if os.path.exists(path):
            for row in read_dbf_records(path):
                text = (row.get("REPORT_NAM") or "").strip()
                if not text or text in seen:
                    continue
                seen.add(text)
                try:
                    count = int(float(row.get("COUNT") or 0))
                except (TypeError, ValueError):
                    count = 0
                found.append((count, text))
        found.sort(key=lambda item: (-item[0], len(item[1]), item[1].lower()))
        _phrases = found
        return found


def phrase_texts() -> list[str]:
    return [text for _, text in _load()]


def suggest_suffix(fragment: str) -> str:
    """Return the rest of the best phrase that starts with fragment."""
    frag = (fragment or "").strip()
    if len(frag) < 2:
        return ""
    low = frag.lower()
    best = ""
    best_count = -1
    best_len = 10**9
    for count, text in _load():
        if len(text) <= len(frag):
            continue
        if not text.lower().startswith(low):
            continue
        if count > best_count or (count == best_count and len(text) < best_len):
            best = text[len(frag) :]
            best_count = count
            best_len = len(text)
    return best


def _score(text: str, location: str, symptoms: list[str]) -> int:
    low = text.lower()
    score = 0
    for word in _LOCATION.get(location, ()):
        if word in low:
            score += 3
            break
    for symptom in symptoms:
        for word in _SYMPTOM.get(symptom, ()):
            if word in low:
                score += 2
                break
    return score


def compose_intake(location: str, symptoms: list[str], duration: str, prior_topical: bool) -> str:
    """Pick an existing phrase. Add time or medicine only when the book already says it that way."""
    phrases = _load()
    ranked = sorted(
        (( _score(text, location, symptoms), count, text) for count, text in phrases),
        key=lambda item: (-item[0], -item[1], len(item[2])),
    )
    base = ""
    if ranked and ranked[0][0] > 0:
        base = ranked[0][2]
    if not base:
        place = {"facial": "face", "trunk": "trunk", "limbs": "extremities", "other": ""}.get(location, "")
        feel = {
            "itching_erythema": "Itching erythematous papules",
            "sebum_acne": "Multiple comedones and pustules",
            "scale": "Whitish patches with scales",
            "spot": "Pigmented patches",
            "refill": "Medication refill",
        }
        bits = [feel[s] for s in symptoms if s in feel]
        head = bits[0] if bits else "Skin lesion"
        base = f"O:{head} ON the {place}".rstrip() if place else f"O:{head}"
    low = base.lower()
    extra: list[str] = []
    duration_words = _DURATION.get(duration, ())
    if duration_words and not any(word in low for word in duration_words):
        for _count, text in phrases:
            sample = text.lower()
            if any(word in sample for word in duration_words) and len(text) <= 24:
                piece = text.strip()
                if piece.lower() not in low:
                    extra.append(piece)
                break
    prior_words = ("topical", "ointment", "cream")
    if prior_topical and not any(word in low for word in prior_words):
        for _count, text in phrases:
            sample = text.lower()
            if any(word in sample for word in prior_words) and len(text) <= 28:
                piece = text.strip()
                if piece.lower() not in low:
                    extra.append(piece)
                break
    if extra:
        return base.rstrip(".") + ". " + ". ".join(extra)
    return base
