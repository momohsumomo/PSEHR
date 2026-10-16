from fastapi import APIRouter, HTTPException
from typing import List
from src.app.bootstrap import get_shadow_store

router = APIRouter(prefix="/fhir/staff", tags=["Staff"])

@router.get("")
def get_staff() -> List[dict]:
    store = get_shadow_store()
    return store.get_staff_list()

@router.post("")
def save_staff(payload: dict) -> dict:
    # 欄位基本檢核
    if not payload.get("id") or not payload.get("name") or not payload.get("role") or not payload.get("pin"):
        raise HTTPException(status_code=400, detail="欄位必填：員工編號、姓名、職稱、PIN碼")
    
    # PIN碼限制 4-6 位數字
    pin = str(payload.get("pin")).strip()
    if not pin.isdigit() or not (4 <= len(pin) <= 6):
        raise HTTPException(status_code=400, detail="PIN 碼必須為 4 至 6 碼數字")

    store = get_shadow_store()
    # PIN碼唯一性檢驗，防止不同員工身分混淆
    existing_staff = store.get_staff_list()
    for s in existing_staff:
        if s["pin"] == pin and s["id"] != payload.get("id"):
            raise HTTPException(status_code=400, detail="PIN 碼已存在，請使用其他 PIN 碼")

    store.save_staff(payload)
    return {"status": "success"}

@router.delete("/{staff_id}")
def delete_staff(staff_id: str) -> dict:
    store = get_shadow_store()
    store.delete_staff(staff_id)
    return {"status": "success"}
