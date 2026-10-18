# -*- coding: utf-8 -*-
"""City / district / road picker for the patient address editor."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query

from src.app.bootstrap import get_shadow_store
from src.core.tw_address import add_favorite, add_road, refresh, remove_favorite, roads_for, tree

router = APIRouter(prefix="/clinic/address", tags=["Address"])


@router.get("/tree")
def get_tree() -> dict[str, Any]:
    return tree(get_shadow_store())


@router.get("/roads")
def get_roads(city: str = Query(""), district: str = Query("")) -> dict[str, Any]:
    return roads_for(get_shadow_store(), city, district)


@router.post("/roads")
def post_road(payload: dict[str, Any]) -> dict[str, Any]:
    try:
        add_road(
            get_shadow_store(),
            str(payload.get("city") or ""),
            str(payload.get("district") or ""),
            str(payload.get("road") or ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"ok": True}


@router.post("/favorites")
def post_favorite(payload: dict[str, Any]) -> dict[str, Any]:
    rows = add_favorite(
        get_shadow_store(),
        str(payload.get("city") or ""),
        str(payload.get("district") or ""),
        str(payload.get("road") or ""),
    )
    return {"favorites": rows}


@router.post("/favorites/remove")
def post_favorite_remove(payload: dict[str, Any]) -> dict[str, Any]:
    rows = remove_favorite(
        get_shadow_store(),
        str(payload.get("city") or ""),
        str(payload.get("district") or ""),
        str(payload.get("road") or ""),
    )
    return {"favorites": rows}


@router.post("/refresh")
def post_refresh(force: bool = Query(False)) -> dict[str, Any]:
    try:
        return refresh(get_shadow_store(), force=force)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
