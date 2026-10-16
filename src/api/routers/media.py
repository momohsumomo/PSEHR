"""FHIR Media 查詢 + 病灶照列表。"""

from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from src.app.bootstrap import get_fhir_repository, get_shadow_store
from src.infrastructure.sqlite_shadow_store import SqliteShadowStore

router = APIRouter(prefix="/fhir", tags=["Media"])


def _store() -> SqliteShadowStore:
    store = get_shadow_store()
    assert isinstance(store, SqliteShadowStore)
    return store


@router.get("/Media")
def list_media(
    patient: str | None = Query(None),
    encounter: str | None = Query(None),
) -> dict[str, Any]:
    entries = _store().list_media(patient_id=patient, encounter_id=encounter)
    return {
        "resourceType": "Bundle",
        "type": "searchset",
        "total": len(entries),
        "entry": entries,
    }


@router.get("/Media/look-folder")
def list_look_folder(medicalNo: str = Query("")) -> dict[str, Any]:
    from src.core.look_images import list_look_files, look_root

    root = look_root()
    files = list_look_files(medicalNo)
    return {
        "root": str(root),
        "reachable": root.is_dir(),
        "total": len(files),
        "entry": files,
    }


@router.post("/Media/look-file")
async def save_look_file(
    medicalNo: str = Query(""),
    file: UploadFile = File(...),
) -> dict[str, str]:
    from src.core.look_images import write_look_image

    ext = os.path.splitext(file.filename or "")[1] or ".JPG"
    data = await file.read()
    try:
        saved = write_look_image(medicalNo, data, ext)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileExistsError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return saved


@router.post("/Media/look-file/replace")
async def replace_look_file_route(
    rel: str = Query(""),
    file: UploadFile = File(...),
) -> dict[str, str]:
    from src.core.look_images import replace_look_file

    data = await file.read()
    try:
        return replace_look_file(rel, data)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (FileNotFoundError, OSError):
        raise HTTPException(status_code=404, detail="相片不在 LOOK 資料夾") from None


@router.post("/Media/look-file/remove")
def remove_look_file_route(rel: str = Query("")) -> dict[str, bool]:
    from src.core.look_images import retire_look_file

    try:
        retire_look_file(rel)
    except (FileNotFoundError, OSError, ValueError):
        raise HTTPException(status_code=404, detail="相片不在 LOOK 資料夾") from None
    return {"ok": True}


@router.get("/Media/look-file")
def get_look_file(rel: str = Query("")) -> FileResponse:
    from src.core.look_images import resolve_look_file

    try:
        path = resolve_look_file(rel)
    except (FileNotFoundError, OSError, ValueError):
        raise HTTPException(status_code=404, detail="相片不在 LOOK 資料夾") from None
    return FileResponse(path)


@router.get("/Media/{media_id}")
def get_media(media_id: str, includeData: bool = Query(True)) -> dict[str, Any]:
    repo = get_fhir_repository()
    resource = repo.read_resource("Media", media_id)
    if resource is None:
        raise HTTPException(status_code=404, detail=f"Media/{media_id} not found")
    if not includeData:
        slim = dict(resource)
        content = slim.get("content")
        if isinstance(content, dict):
            slim["content"] = {
                "contentType": content.get("contentType"),
                "data": "[omitted]" if content.get("data") else None,
            }
        resource = slim
    dual = _store().get_dual_layer("Media", media_id)
    if dual:
        return {"resource": resource, "indexMeta": dual.get("indexLayer")}
    return resource
