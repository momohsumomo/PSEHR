"""沙盒 2 診斷路由 — 驗證雙層貼紙（cache + index）與 AI 佈局自訂。"""

from __future__ import annotations

import json
import os
from typing import Any
import httpx

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from src.app.bootstrap import get_shadow_store
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

router = APIRouter(prefix="/sandbox", tags=["Sandbox-診斷"])

_ALLOWED = frozenset(
    {
        "Patient",
        "Encounter",
        "Condition",
        "MedicationRequest",
        "Composition",
        "Observation",
        "AllergyIntolerance",
        "Media",
    }
)


@router.get("/dual-layer/{resource_type}/{resource_id}")
def inspect_dual_layer(resource_type: str, resource_id: str) -> dict[str, Any]:
    """
    沙盒 2 專用：並列顯示 resource_cache（cacheLayer）與 index（indexLayer）。
    """
    if resource_type not in _ALLOWED:
        raise HTTPException(status_code=400, detail=f"不支援的類型：{resource_type}")

    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    dual = store.get_dual_layer(resource_type, resource_id)
    if dual is None:
        raise HTTPException(status_code=404, detail=f"{resource_type}/{resource_id} 不存在")
    return dual


@router.get("/status")
def sandbox_status() -> dict[str, Any]:
    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    counts: dict[str, int] = {}
    for rt in (
        "Patient",
        "Encounter",
        "Condition",
        "MedicationRequest",
        "Composition",
        "Observation",
        "AllergyIntolerance",
    ):
        counts[rt] = len(store.list_cached_resources(rt, limit=10_000))
    return {
        "sandbox": "backend-api-v2",
        "dbPath": str(store.db_path),
        "resourceCounts": counts,
        "hint": "前端沙盒1已解耦；請用 /docs 測試 API",
    }


class LayoutGridModel(BaseModel):
    x: int
    y: int
    w: int
    h: int


class LayoutComponentModel(BaseModel):
    id: str
    type: str
    grid: LayoutGridModel
    visible: bool
    title: str | None = None


class UiLayoutModel(BaseModel):
    columns: int
    rows: int
    components: list[LayoutComponentModel]


class LayoutModifyRequest(BaseModel):
    current_layout: UiLayoutModel
    command: str
    api_key: str | None = None


@router.post("/layout/modify")
async def modify_layout(req: LayoutModifyRequest) -> dict[str, Any]:
    """
    接收當前佈局 JSON 與自訂指令，使用 Gemini API 計算變形後的 Layout JSON。
    """
    api_key = req.api_key or os.environ.get("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=400,
            detail="缺少 GEMINI_API_KEY。請設定伺服器環境變數，以開啟 AI 進階自訂功能。"
        )

    layout_str = json.dumps(req.current_layout.model_dump(), ensure_ascii=False, indent=2)
    prompt = f"""You are an expert UI Layout Designer. You are given a current grid layout schema for a medical system.
The layout is a grid of {req.current_layout.columns} columns and {req.current_layout.rows} rows.
The layout schema is:
{layout_str}

The user gave the following natural language instruction in Traditional Chinese to modify the layout:
"{req.command}"

Your task is to modify the layout grid coordinate properties (x, y, w, h) and visibility (visible) of the components to fulfill the user's request.
Rules:
- Columns (x) must be from 0 to 11.
- Rows (y) must be from 0 to 11.
- Components must stay within bounds (x + w <= 12, y + h <= 12).
- The components are:
  - "queue-panel" (掛號清單, left panel)
  - "allergy-banner" (過敏警示帶)
  - "patient-header" (病患標題列)
  - "lesion-photos" (病灶照片區)
  - "chief-complaint" (主訴 CC/PE)
  - "diagnoses" (診斷病名)
  - "current-rx" (處方開立)
  - "right-panel" (快捷與歷史, right panel)
- Return a JSON object with two fields:
  1. "layoutGrid": The entire modified layout schema object (containing columns, rows, and components).
  2. "message": A polite explanation in Traditional Chinese of the changes made.

Return ONLY the raw JSON object. Do not include markdown code block formatting (no ```json)."""

    url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent"
    headers = {"Content-Type": "application/json"}
    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json"
        }
    }

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{url}?key={api_key}", json=payload, headers=headers)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Gemini API error: {resp.text}")
            
            result_json = resp.json()
            text_response = result_json["candidates"][0]["content"]["parts"][0]["text"].strip()
            
            parsed = json.loads(text_response)
            return parsed
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"LLM layout modification failed: {str(e)}")

