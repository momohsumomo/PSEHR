"""LLM 核對 diff（只判定可否發布，不改價）。"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from hub import config

logger = logging.getLogger("hub.llm")


def verify_diff_with_llm(diff: dict[str, Any], gate: dict[str, Any]) -> dict[str, Any]:
    """
    回傳 {ok: bool, verdict: approve|reject|uncertain, reason: str, raw?: ...}
    無 API key → ok=False, verdict=skipped_no_key
    """
    if not config.LLM_API_KEY:
        return {
            "ok": False,
            "verdict": "skipped_no_key",
            "reason": "未設定 HUB_LLM_API_KEY / OPENAI_API_KEY；有實質出入時不可自動發布",
        }

    summary = diff.get("summary") or {}
    samples = diff.get("samples") or {}
    prompt = {
        "task": "你是健保藥價更新審核助手。根據 diff 摘要判斷是否可自動發布給診所。",
        "rules": [
            "不可建議修改任何價格數字",
            "若像正常月更（少量增刪改、無離奇暴漲）→ approve",
            "若像抓錯檔、大量消失、價格離奇 → reject",
            "不確定 → uncertain",
            "只用 JSON 回答：{\"verdict\":\"approve|reject|uncertain\",\"reason\":\"...\"}",
        ],
        "gate": gate,
        "summary": summary,
        "samples": {
            "priceChangeSample": samples.get("priceChangeSample", [])[:15],
            "addedSample": [
                {"nhiCode": x.get("nhiCode"), "price": x.get("price"), "nameZh": x.get("nameZh")}
                for x in (samples.get("addedSample") or [])[:10]
            ],
            "removedSample": [
                {"nhiCode": x.get("nhiCode"), "price": x.get("price"), "nameZh": x.get("nameZh")}
                for x in (samples.get("removedSample") or [])[:10]
            ],
        },
    }

    try:
        with httpx.Client(timeout=90.0) as client:
            r = client.post(
                f"{config.LLM_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {config.LLM_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": config.LLM_MODEL,
                    "temperature": 0,
                    "messages": [
                        {"role": "system", "content": "你只輸出一個 JSON 物件，不要 Markdown。"},
                        {"role": "user", "content": json.dumps(prompt, ensure_ascii=False)},
                    ],
                },
            )
            r.raise_for_status()
            content = r.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        logger.exception("LLM call failed")
        return {"ok": False, "verdict": "error", "reason": f"LLM 呼叫失敗：{exc}"}

    text = (content or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.startswith("json"):
            text = text[4:].strip()
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        return {
            "ok": False,
            "verdict": "uncertain",
            "reason": f"LLM 回傳非 JSON：{text[:300]}",
            "raw": text,
        }

    verdict = str(parsed.get("verdict") or "uncertain").lower()
    reason = str(parsed.get("reason") or "")
    ok = verdict == "approve"
    return {"ok": ok, "verdict": verdict, "reason": reason, "raw": parsed}
