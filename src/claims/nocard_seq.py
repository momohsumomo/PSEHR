"""Pair a no-card visit with the claim sequence code.

The 20-digit treatment id comes from the bureau. This module only chooses the
4-character sequence that monthly d29 and daily M13 expect beside it.
H000 stays unused: this clinic's register settings lock that code.
"""

from __future__ import annotations

NOCARD_MODES = frozenset({"noCard", "childNoCard", "pregnantNoCard", "badCard", "paper"})

_BAD_CARD = "\u5361\u7247\u4e0d\u826f"

# Equipment reasons already shown on the register form.
_BY_REASON = {
    "\u8b80\u5361\u8a2d\u5099\u6545\u969c": "A000",
    "\u8b80\u5361\u6a5f\u6545\u969c": "A000",
    _BAD_CARD: "B000",
    "\u7db2\u8def\u8a2d\u5099\u6545\u969c": "C000",
    "\u504f\u9060\u5340\u7121\u6cd5\u4e0a\u7db2": "C000",
    "\u5c45\u5bb6\u85cd\u7259\u7db2\u8def\u7570\u5e38": "C000",
    "\u5b89\u5168\u6a21\u7d44\u6545\u969c": "D000",
    "\u9662\u6240\u96fb\u8166\u6545\u969c": "D000",
    "\u91ab\u7642\u7cfb\u7d71\u7576\u6a5f": "D000",
    "\u5065\u4fdd\u5c40\u7576\u6a5f": "E000",
    "\u505c\u96fb": "F000",
}


def claim_seq_for(mode: str, reason: str) -> str:
    """4-character claim sequence. Empty when this visit is not a no-card path."""
    kind = (mode or "").strip()
    text = (reason or "").strip()
    if kind == "badCard" or text == _BAD_CARD:
        return "B000"
    if kind not in NOCARD_MODES:
        return ""
    return _BY_REASON.get(text, "G000")


def pair_nocard(
    *,
    mode: str,
    reason: str,
    treat_seq: str,
    treatment_number: str,
) -> tuple[str, str]:
    """Fill the stored reason and sequence after a real 20-digit id exists."""
    kind = (mode or "").strip()
    text = (reason or "").strip()
    seq = (treat_seq or "").strip()
    number = (treatment_number or "").strip()
    if kind == "badCard" and not text:
        text = _BAD_CARD
    if kind in NOCARD_MODES and len(number) == 20 and not seq:
        seq = claim_seq_for(kind, text)
    return text, seq
