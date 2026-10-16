"""台灣健保碼 + 國際術語（ICD-10 / SNOMED / RxNorm）雙層貼紙解析。"""

from __future__ import annotations

from typing import Any

# 常用 CodeSystem URI（沙盒 2 驗收對照用）
SYSTEM_ICD10 = "http://hl7.org/fhir/sid/icd-10"
SYSTEM_SNOMED = "http://snomed.info/sct"
SYSTEM_RXNORM = "http://www.nlm.nih.gov/research/umls/rxnorm"
SYSTEM_NHI_MEDICATION = "https://nhidcc.nhi.gov.tw/medication"
SYSTEM_TW_ICD10CM = "https://nhidcc.nhi.gov.tw/icd10cm"


def _system_matches(system: str | None, *fragments: str) -> bool:
    if not system:
        return False
    s = system.lower()
    return any(f.lower() in s for f in fragments)


def extract_terminology_stickers(codeable: dict[str, Any] | None) -> dict[str, str | None]:
    """從 FHIR CodeableConcept 抽出各層貼紙（最後一筆同系統覆寫）。"""
    result: dict[str, str | None] = {
        "icd10Code": None,
        "snomedCode": None,
        "nhiIcd10Code": None,
        "nhiMedCode": None,
        "rxnormCode": None,
        "summaryText": None,
    }
    if not codeable:
        return result
    result["summaryText"] = codeable.get("text")
    for c in codeable.get("coding") or []:
        if not isinstance(c, dict):
            continue
        code = c.get("code")
        if not code:
            continue
        system = c.get("system", "")
        if _system_matches(system, "icd-10", "icd10"):
            if _system_matches(system, "nhidcc", "nhi"):
                result["nhiIcd10Code"] = str(code)
            else:
                result["icd10Code"] = str(code)
        elif _system_matches(system, "snomed"):
            result["snomedCode"] = str(code)
        elif _system_matches(system, "rxnorm"):
            result["rxnormCode"] = str(code)
        elif _system_matches(system, "nhidcc", "nhi") and _system_matches(system, "medication"):
            result["nhiMedCode"] = str(code)
    return result


def build_condition_codeable(
    *,
    summary_text: str | None = None,
    icd10_code: str | None = None,
    snomed_code: str | None = None,
    nhi_icd10_code: str | None = None,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """組裝 Condition.code，合併既有 coding 與明確貼紙欄位。"""
    base = dict(existing or {})
    coding: list[dict[str, Any]] = list(base.get("coding") or [])
    text = summary_text or base.get("text")

    def _upsert(system: str, code: str, display: str | None = None) -> None:
        nonlocal coding
        coding = [c for c in coding if c.get("system") != system]
        entry: dict[str, Any] = {"system": system, "code": code}
        if display:
            entry["display"] = display
        coding.append(entry)

    if icd10_code:
        _upsert(SYSTEM_ICD10, icd10_code)
    if snomed_code:
        _upsert(SYSTEM_SNOMED, snomed_code)
    if nhi_icd10_code:
        _upsert(SYSTEM_TW_ICD10CM, nhi_icd10_code)

    out: dict[str, Any] = {"coding": coding}
    if text:
        out["text"] = text
    return out


def build_medication_codeable(
    *,
    summary_text: str | None = None,
    nhi_code: str | None = None,
    rxnorm_code: str | None = None,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    base = dict(existing or {})
    coding: list[dict[str, Any]] = list(base.get("coding") or [])
    text = summary_text or base.get("text")

    def _upsert(system: str, code: str) -> None:
        nonlocal coding
        coding = [c for c in coding if c.get("system") != system]
        coding.append({"system": system, "code": code})

    if nhi_code:
        _upsert(SYSTEM_NHI_MEDICATION, nhi_code)
    if rxnorm_code:
        _upsert(SYSTEM_RXNORM, rxnorm_code)

    out: dict[str, Any] = {"coding": coding}
    if text:
        out["text"] = text
    return out


def build_allergy_codeable(
    *,
    summary_text: str | None = None,
    snomed_code: str | None = None,
    existing: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """組裝 AllergyIntolerance.code（過敏原大類 SNOMED）。"""
    base = dict(existing or {})
    coding: list[dict[str, Any]] = list(base.get("coding") or [])
    text = summary_text or base.get("text")

    def _upsert(system: str, code: str, display: str | None = None) -> None:
        nonlocal coding
        coding = [c for c in coding if c.get("system") != system]
        entry: dict[str, Any] = {"system": system, "code": code}
        if display:
            entry["display"] = display
        coding.append(entry)

    if snomed_code:
        _upsert(SYSTEM_SNOMED, snomed_code)

    out: dict[str, Any] = {"coding": coding}
    if text:
        out["text"] = text
    return out


def build_rxnorm_codeable(
    *,
    rxnorm_code: str,
    display: str | None = None,
) -> dict[str, Any]:
    return {
        "coding": [{"system": SYSTEM_RXNORM, "code": rxnorm_code, **({"display": display} if display else {})}],
        "text": display or rxnorm_code,
    }


def extract_allergy_stickers(payload: dict[str, Any]) -> dict[str, str | None]:
    """從 AllergyIntolerance 抽出 Terminology 貼紙。"""
    result: dict[str, str | None] = {
        "snomedCode": None,
        "rxnormSubstance": None,
        "snomedManifestation": None,
        "summaryText": None,
        "verificationStatus": None,
        "criticality": payload.get("criticality"),
    }
    stickers = extract_terminology_stickers(payload.get("code"))
    result["snomedCode"] = stickers["snomedCode"]
    result["summaryText"] = stickers["summaryText"]

    vs = payload.get("verificationStatus") or {}
    for c in vs.get("coding") or []:
        if c.get("code"):
            result["verificationStatus"] = str(c["code"])
            break

    reactions = payload.get("reaction") or []
    if reactions and isinstance(reactions[0], dict):
        rxn = reactions[0]
        sub = rxn.get("substance") or {}
        sub_stickers = extract_terminology_stickers(sub)
        result["rxnormSubstance"] = sub_stickers["rxnormCode"]
        manifests = rxn.get("manifestation") or []
        if manifests and isinstance(manifests[0], dict):
            man_stickers = extract_terminology_stickers(manifests[0])
            result["snomedManifestation"] = man_stickers["snomedCode"]
    return result
