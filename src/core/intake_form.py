# -*- coding: utf-8 -*-
"""Waiting-room intake answers, written in the chart's usual wording."""

from __future__ import annotations

SITE_LABEL = {
    "scalp": "\u982d\u76ae",
    "forehead": "\u984d\u982d",
    "forehead-r": "\u53f3\u984d",
    "forehead-l": "\u5de6\u984d",
    "glabella": "\u7709\u5fc3",
    "temple-r": "\u53f3\u592a\u967d\u7a74",
    "temple-l": "\u5de6\u592a\u967d\u7a74",
    "face-r": "\u53f3\u9830",
    "face-l": "\u5de6\u9830",
    "nose": "\u9f3b\u5b50",
    "chin": "\u4e0b\u5df4",
    "undereye-r": "\u53f3\u773c\u4e0b",
    "undereye-l": "\u5de6\u773c\u4e0b",
    "jaw-r": "\u53f3\u4e0b\u984e",
    "jaw-l": "\u5de6\u4e0b\u984e",
    "ear-r": "\u53f3\u8033",
    "ear-l": "\u5de6\u8033",
    "neck": "\u8116\u5b50",
    "chest-r": "\u53f3\u80f8",
    "chest-l": "\u5de6\u80f8",
    "abdomen-r": "\u53f3\u8179",
    "abdomen-l": "\u5de6\u8179",
    "groin-r": "\u53f3\u9f20\u8c6c",
    "groin-l": "\u5de6\u9f20\u8c6c",
    "eyelid-r": "\u53f3\u773c\u76ae",
    "eyelid-l": "\u5de6\u773c\u76ae",
    "lip": "\u5634\u5507",
    "arm-r": "\u53f3\u4e0a\u81c2",
    "arm-l": "\u5de6\u4e0a\u81c2",
    "forearm-r": "\u53f3\u524d\u81c2",
    "forearm-l": "\u5de6\u524d\u81c2",
    "hand-r": "\u53f3\u624b",
    "hand-l": "\u5de6\u624b",
    "thigh-r": "\u53f3\u5927\u817f",
    "thigh-l": "\u5de6\u5927\u817f",
    "knee-r": "\u53f3\u819d\u84cb",
    "knee-l": "\u5de6\u819d\u84cb",
    "shin-r": "\u53f3\u5c0f\u817f",
    "shin-l": "\u5de6\u5c0f\u817f",
    "foot-r": "\u53f3\u8173",
    "foot-l": "\u5de6\u8173",
    "occiput": "\u5f8c\u8166",
    "nape": "\u5f8c\u9838",
    "back-upper-r": "\u53f3\u4e0a\u80cc",
    "back-upper-l": "\u5de6\u4e0a\u80cc",
    "back-lower-r": "\u53f3\u4e0b\u80cc",
    "back-lower-l": "\u5de6\u4e0b\u80cc",
    "buttock-r": "\u53f3\u81c0",
    "buttock-l": "\u5de6\u81c0",
    "arm-r-back": "\u53f3\u4e0a\u81c2\u5f8c\u9762",
    "arm-l-back": "\u5de6\u4e0a\u81c2\u5f8c\u9762",
    "forearm-r-back": "\u53f3\u524d\u81c2\u5f8c\u9762",
    "forearm-l-back": "\u5de6\u524d\u81c2\u5f8c\u9762",
    "hand-r-back": "\u53f3\u624b\u80cc",
    "hand-l-back": "\u5de6\u624b\u80cc",
    "thigh-r-back": "\u53f3\u5927\u817f\u5f8c",
    "thigh-l-back": "\u5de6\u5927\u817f\u5f8c",
    "knee-r-back": "\u53f3\u819d\u7aa9",
    "knee-l-back": "\u5de6\u819d\u7aa9",
    "calf-r": "\u53f3\u5c0f\u817f\u5f8c",
    "calf-l": "\u5de6\u5c0f\u817f\u5f8c",
    "foot-r-back": "\u53f3\u8173\u5f8c",
    "foot-l-back": "\u5de6\u8173\u5f8c",
    "ear-r-back": "\u53f3\u8033\u5f8c",
    "ear-l-back": "\u5de6\u8033\u5f8c",
    "finger-r-thumb": "\u53f3\u62c7\u6307",
    "finger-r-index": "\u53f3\u98df\u6307",
    "finger-r-middle": "\u53f3\u4e2d\u6307",
    "finger-r-ring": "\u53f3\u7121\u540d\u6307",
    "finger-r-little": "\u53f3\u5c0f\u6307",
    "nail-r": "\u53f3\u624b\u6307\u7532",
    "finger-l-thumb": "\u5de6\u62c7\u6307",
    "finger-l-index": "\u5de6\u98df\u6307",
    "finger-l-middle": "\u5de6\u4e2d\u6307",
    "finger-l-ring": "\u5de6\u7121\u540d\u6307",
    "finger-l-little": "\u5de6\u5c0f\u6307",
    "nail-l": "\u5de6\u624b\u6307\u7532",
    "body_head": "\u982d\u9838",
    "body_chest_abdomen": "\u80f8\u8179",
    "body_back": "\u80cc\u90e8",
    "body_arm_right": "\u53f3\u4e0a\u80a2",
    "body_arm_left": "\u5de6\u4e0a\u80a2",
    "body_leg_right": "\u53f3\u4e0b\u80a2",
    "body_leg_left": "\u5de6\u4e0b\u80a2",
    "body_genital_buttock": "\u751f\u6b96\u81c0\u90e8",
    "face_forehead": "\u984d\u982d",
    "face_nose_glabella": "\u5370\u5802\u9f3b\u90e8",
    "face_left_cheek": "\u5de6\u81c9\u9830",
    "face_right_cheek": "\u53f3\u81c9\u9830",
    "face_perioral": "\u53e3\u5468",
    "face_chin": "\u4e0b\u5df4",
    "hand_right_palmar_fingers": "\u53f3\u624b\u638c\u9762\u624b\u6307",
    "hand_right_palmar_palm": "\u53f3\u624b\u638c",
    "hand_right_dorsal_fingers": "\u53f3\u624b\u80cc\u9762\u624b\u6307",
    "hand_right_dorsal_dorsum": "\u53f3\u624b\u80cc",
    "hand_left_palmar_fingers": "\u5de6\u624b\u638c\u9762\u624b\u6307",
    "hand_left_palmar_palm": "\u5de6\u624b\u638c",
    "hand_left_dorsal_fingers": "\u5de6\u624b\u80cc\u9762\u624b\u6307",
    "hand_left_dorsal_dorsum": "\u5de6\u624b\u80cc",
}

SITE_EN = {
    "scalp": "scalp",
    "forehead": "forehead",
    "forehead-r": "R forehead",
    "forehead-l": "L forehead",
    "glabella": "glabella",
    "temple-r": "R temple",
    "temple-l": "L temple",
    "face-r": "R cheek",
    "face-l": "L cheek",
    "nose": "nose",
    "chin": "chin",
    "undereye-r": "R under-eye",
    "undereye-l": "L under-eye",
    "jaw-r": "R jaw",
    "jaw-l": "L jaw",
    "ear-r": "R ear",
    "ear-l": "L ear",
    "neck": "neck",
    "chest-r": "R chest",
    "chest-l": "L chest",
    "abdomen-r": "R abdomen",
    "abdomen-l": "L abdomen",
    "groin-r": "R groin",
    "groin-l": "L groin",
    "eyelid-r": "R eyelid",
    "eyelid-l": "L eyelid",
    "lip": "lip",
    "arm-r": "R upper arm",
    "arm-l": "L upper arm",
    "forearm-r": "R forearm",
    "forearm-l": "L forearm",
    "hand-r": "R hand",
    "hand-l": "L hand",
    "thigh-r": "R thigh",
    "thigh-l": "L thigh",
    "knee-r": "R knee",
    "knee-l": "L knee",
    "shin-r": "R shin",
    "shin-l": "L shin",
    "foot-r": "R foot",
    "foot-l": "L foot",
    "occiput": "occiput",
    "nape": "nape",
    "back-upper-r": "R upper back",
    "back-upper-l": "L upper back",
    "back-lower-r": "R lower back",
    "back-lower-l": "L lower back",
    "buttock-r": "R buttock",
    "buttock-l": "L buttock",
    "arm-r-back": "R posterior upper arm",
    "arm-l-back": "L posterior upper arm",
    "forearm-r-back": "R posterior forearm",
    "forearm-l-back": "L posterior forearm",
    "hand-r-back": "R dorsum of hand",
    "hand-l-back": "L dorsum of hand",
    "thigh-r-back": "R posterior thigh",
    "thigh-l-back": "L posterior thigh",
    "knee-r-back": "R popliteal fossa",
    "knee-l-back": "L popliteal fossa",
    "calf-r": "R calf",
    "calf-l": "L calf",
    "foot-r-back": "R heel",
    "foot-l-back": "L heel",
    "ear-r-back": "R posterior ear",
    "ear-l-back": "L posterior ear",
    "finger-r-thumb": "R thumb",
    "finger-r-index": "R index finger",
    "finger-r-middle": "R middle finger",
    "finger-r-ring": "R ring finger",
    "finger-r-little": "R little finger",
    "nail-r": "R fingernails",
    "finger-l-thumb": "L thumb",
    "finger-l-index": "L index finger",
    "finger-l-middle": "L middle finger",
    "finger-l-ring": "L ring finger",
    "finger-l-little": "L little finger",
    "nail-l": "L fingernails",
    "body_head": "head and neck",
    "body_chest_abdomen": "chest and abdomen",
    "body_back": "back",
    "body_arm_right": "R arm",
    "body_arm_left": "L arm",
    "body_leg_right": "R leg",
    "body_leg_left": "L leg",
    "body_genital_buttock": "genital area and buttocks",
    "face_forehead": "forehead",
    "face_nose_glabella": "nose and glabella",
    "face_left_cheek": "L cheek",
    "face_right_cheek": "R cheek",
    "face_perioral": "perioral area",
    "face_chin": "chin",
    "hand_right_palmar_fingers": "R palmar fingers",
    "hand_right_palmar_palm": "R palm",
    "hand_right_dorsal_fingers": "R dorsal fingers",
    "hand_right_dorsal_dorsum": "R dorsum of hand",
    "hand_left_palmar_fingers": "L palmar fingers",
    "hand_left_palmar_palm": "L palm",
    "hand_left_dorsal_fingers": "L dorsal fingers",
    "hand_left_dorsal_dorsum": "L dorsum of hand",
}

SYMPTOM_LABEL = {
    "itch": "\u7662",
    "red": "\u7d05",
    "swell": "\u816b",
    "pain": "\u523a\u75db",
    "peel": "\u812b\u76ae",
    "dry": "\u4e7e\u71e5",
    "oil": "\u51fa\u6cb9",
    "acne": "\u75d8\u75d8",
    "comedone": "\u7c89\u523a",
    "spot": "\u6591",
    "blister": "\u6c34\u6ce1",
    "ooze": "\u6ef2\u6db2",
    "crust": "\u7d50\u75c2",
    "wound": "\u50b7\u53e3",
}

SYMPTOM_EN = {
    "itch": "itching",
    "red": "erythema",
    "swell": "swelling",
    "pain": "pain",
    "peel": "scaling",
    "dry": "dryness",
    "oil": "oiliness",
    "acne": "acne",
    "comedone": "comedones",
    "spot": "pigmented macules",
    "blister": "vesicles",
    "ooze": "oozing",
    "crust": "crust",
    "wound": "wound",
}

DAY_LABEL = {
    "0": "\u4eca\u5929\u525b\u958b\u59cb",
    "1": "1\u5929",
    "2": "2\u5929",
    "3": "3\u5929",
    "4": "4\u5929",
    "5": "5\u5929",
    "6": "6\u5929",
    "7": "7\u5929",
    "2w": "\u8d85\u904e\u5169\u9031",
    "1m": "\u4e00\u500b\u6708",
    "months": "\u597d\u5e7e\u500b\u6708",
    "forgot": "\u4e0d\u8a18\u5f97\u4e86",
}

DAY_EN = {
    "0": "since today",
    "1": "for 1 day",
    "2": "for 2 days",
    "3": "for 3 days",
    "4": "for 4 days",
    "5": "for 5 days",
    "6": "for 6 days",
    "7": "for 7 days",
    "2w": "for over 2 weeks",
    "1m": "for 1 month",
    "months": "for several months",
    "forgot": "duration not recalled",
}

def _on(place: str) -> str:
    if place.startswith("both "):
        return f"on {place}"
    return f"on the {place}"


def _join(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + " and " + items[-1]


def _has_finger(sites: list[str], side: str) -> bool:
    prefix = f"finger-{side}-"
    nail = f"nail-{side}"
    return any(item.startswith(prefix) or item == nail for item in sites)


# Both sides of one trunk region become the plain word. One side keeps R/L.
_PAIRS = (
    ("chest-r", "chest-l", "chest", "R chest", "L chest"),
    ("abdomen-r", "abdomen-l", "abdomen", "R abdomen", "L abdomen"),
    ("groin-r", "groin-l", "groin", "R groin", "L groin"),
    ("back-upper-r", "back-upper-l", "upper back", "R upper back", "L upper back"),
    ("back-lower-r", "back-lower-l", "lower back", "R lower back", "L lower back"),
)
_PAIR_OF = {side: row for row in _PAIRS for side in row[:2]}

_FACE_RIGHT = {"face-r", "eyelid-r", "forehead-r", "temple-r", "undereye-r", "jaw-r", "face_right_cheek"}
_FACE_LEFT = {"face-l", "eyelid-l", "forehead-l", "temple-l", "undereye-l", "jaw-l", "face_left_cheek"}
_FACE_MID = {"forehead", "glabella", "nose", "lip", "chin", "face_forehead", "face_nose_glabella", "face_perioral", "face_chin"}
_FACE_ALL = _FACE_RIGHT | _FACE_LEFT | _FACE_MID

CONCERN_LABEL = {
    "spot": "\u9664\u6591",
    "ipl": "\u8108\u885d\u5149",
    "toning": "\u6de8\u819a",
    "fraxel": "\u98db\u68ad",
    "nevus": "\u9664\u75e3",
    "botox": "\u8089\u6bd2",
    "hair": "\u9664\u6bdb",
}
CONCERN_EN = {
    "spot": "spot removal",
    "ipl": "IPL",
    "toning": "laser toning",
    "fraxel": "fractional laser",
    "nevus": "nevus removal",
    "botox": "botox",
    "hair": "hair removal",
}
PRIOR_LABEL = {
    "never": "\u6c92\u6709\uff0c\u7b2c\u4e00\u6b21",
    "before": "\u6709\u505a\u904e",
}
COURSE_LABEL = {
    "darker": "\u984f\u8272\u6bd4\u8f03\u6df1",
    "lighter": "\u6709\u6bd4\u8f03\u6de1",
    "same": "\u5dee\u4e0d\u591a",
    "unsure": "\u4e0d\u78ba\u5b9a",
}


def _term(item: str, english: dict[str, str], chinese: dict[str, str]) -> str:
    if item in english:
        return english[item]
    return chinese.get(item, "")


def _face_phrase(sites: list[str]) -> str:
    face = [item for item in sites if item in _FACE_ALL]
    if not face:
        return ""
    left = [item for item in face if item in _FACE_LEFT]
    right = [item for item in face if item in _FACE_RIGHT]
    mid = [item for item in face if item in _FACE_MID]
    # Several facial spots, across the finer map, is how the charts say "whole face".
    if len(face) >= 6:
        return "whole face"
    if set(face) == {"face-r", "face-l"}:
        return "both cheeks"
    if left and not right and not mid and len(left) >= 2:
        return "left face"
    if right and not left and not mid and len(right) >= 2:
        return "right face"
    return ""


def _place_terms(sites: list[str]) -> list[str]:
    chosen = set(sites)
    skip = set()
    if _has_finger(sites, "r"):
        skip.update({"hand-r", "hand-r-back"})
    if _has_finger(sites, "l"):
        skip.update({"hand-l", "hand-l-back"})
    phrase = _face_phrase(sites)
    emitted: set[str] = set()
    terms: list[str] = []
    face_done = False
    for item in sites:
        if item in _FACE_ALL and phrase:
            if not face_done:
                terms.append(phrase)
                face_done = True
            continue
        pair = _PAIR_OF.get(item)
        if pair:
            if pair[0] in emitted:
                continue
            emitted.add(pair[0])
            left_id, right_id, both, only_left, only_right = pair
            if left_id in chosen and right_id in chosen:
                terms.append(both)
            elif left_id in chosen:
                terms.append(only_left)
            else:
                terms.append(only_right)
            continue
        if item in skip:
            continue
        term = _term(item, SITE_EN, SITE_LABEL)
        if term:
            terms.append(term)
    return terms


def compose_kiosk_note(
    *,
    sites: list[str],
    symptoms: list[str],
    days: str,
    severity: str = "",
    seen_other_doctor: bool = False,
    refill_only: bool = False,
    course: str = "",
    prior_topical: bool = False,
) -> str:
    del course, prior_topical
    if refill_only:
        return "Medication refill"
    places = _place_terms(sites)
    feels = [_term(item, SYMPTOM_EN, SYMPTOM_LABEL) for item in symptoms]
    feels = [item for item in feels if item]
    feel = _join(feels)
    if feel:
        feel = feel[0].upper() + feel[1:]
    place = _join(places)
    if feel and place:
        head = f"{feel} {_on(place)}"
    elif feel:
        head = feel
    else:
        head = place
    bits = [head] if head else []
    day = DAY_EN.get(days) or DAY_LABEL.get(days, "")
    if day:
        bits.append(day)
    sentence = ", ".join(bits)
    if sentence:
        sentence += "."
    if severity.isdigit():
        sentence = f"{sentence} Severity {int(severity)}/10.".strip()
    seen = "Seen by another doctor." if seen_other_doctor else "Not seen by another doctor."
    return f"{sentence} {seen}".strip()


def compose_cosmetic_note(*, sites: list[str], concerns: list[str], prior: str, course: str = "") -> str:
    names = [CONCERN_EN[item] for item in concerns if item in CONCERN_EN]
    goal = _join(names) or "cosmetic treatment"
    place = _join(_place_terms(sites))
    if place:
        sentence = f"Cosmetic consult for {goal} {_on(place)}."
    else:
        sentence = f"Cosmetic consult for {goal}."
    if prior == "never":
        tail = "First treatment."
    elif course == "darker":
        tail = "Post treatment, darker."
    elif course == "lighter":
        tail = "Post treatment, lighter."
    elif course == "same":
        tail = "Post treatment, stationary."
    else:
        tail = "Post treatment, course not recalled."
    return f"{sentence} {tail}"
