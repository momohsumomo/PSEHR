"""病灶 Media → FHIR Media（皮膚科 v0.2）。"""

from __future__ import annotations

from typing import Any

from src.core.nhi_media_validators import NhiMediaIntake

NHI_MEDIA_EXTENSION_URL = (
    "https://nhidcc.nhi.gov.tw/fhir/StructureDefinition/lesion-media"
)
SYSTEM_SNOMED = "http://snomed.info/sct"


def nhi_media_to_fhir(
    intake: NhiMediaIntake,
    *,
    patient_id: str,
    encounter_id: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "resourceType": "Media",
        "status": "completed",
        "type": {
            "coding": [
                {
                    "system": "http://terminology.hl7.org/CodeSystem/media-type",
                    "code": "image",
                    "display": "Image",
                }
            ]
        },
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "createdDateTime": intake.captured_iso(),
        "content": {
            "contentType": intake.contentType.replace("/jpg", "/jpeg"),
            "data": intake.imageBase64,
        },
        "extension": [
            {
                "url": NHI_MEDIA_EXTENSION_URL,
                "extension": [
                    {"url": "siteLabel", "valueString": intake.siteLabel},
                    *(
                        [{"url": "bodySiteCode", "valueCode": intake.bodySiteCode}]
                        if intake.bodySiteCode
                        else []
                    ),
                    *(
                        [{"url": "note", "valueString": intake.note}]
                        if intake.note
                        else []
                    ),
                ],
            }
        ],
    }
    if intake.bodySiteCode:
        payload["bodySite"] = {
            "coding": [{"system": SYSTEM_SNOMED, "code": intake.bodySiteCode}],
            "text": intake.siteLabel,
        }
    else:
        payload["bodySite"] = {"text": intake.siteLabel}
    return payload


def extract_media_stickers(media: dict[str, Any]) -> dict[str, str | None]:
    result: dict[str, str | None] = {
        "mediaId": media.get("id"),
        "siteLabel": None,
        "bodySiteCode": None,
        "contentType": None,
        "capturedDateTime": media.get("createdDateTime"),
        "encounterId": None,
        "patientId": None,
        "hasImageData": False,
    }
    subj = media.get("subject") or {}
    if subj.get("reference"):
        result["patientId"] = str(subj["reference"]).split("/")[-1]
    enc = media.get("encounter") or {}
    if enc.get("reference"):
        result["encounterId"] = str(enc["reference"]).split("/")[-1]
    content = media.get("content") or {}
    if isinstance(content, dict):
        result["contentType"] = content.get("contentType")
        result["hasImageData"] = bool(content.get("data"))
    bs = media.get("bodySite") or {}
    result["siteLabel"] = bs.get("text")
    for c in bs.get("coding") or []:
        if c.get("code"):
            result["bodySiteCode"] = str(c["code"])
            break
    for ext in media.get("extension") or []:
        if ext.get("url") != NHI_MEDIA_EXTENSION_URL:
            continue
        for sub in ext.get("extension") or []:
            if sub.get("url") == "siteLabel":
                result["siteLabel"] = sub.get("valueString") or result["siteLabel"]
            if sub.get("url") == "bodySiteCode":
                result["bodySiteCode"] = sub.get("valueCode")
    return result
