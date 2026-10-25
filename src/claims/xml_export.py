"""申報 XML 輸出（過渡格式；正式署方 schema 後續以策略替換）。"""

from __future__ import annotations

from src.claims.engine import ClaimsSummary

# 過渡機構碼；正式應入院所設定
DEFAULT_INSTITUTION_CODE = "3521013662"


def render_claims_xml(
    summary: ClaimsSummary,
    *,
    institution_code: str = DEFAULT_INSTITUTION_CODE,
    submit_type: str = "songhe",
) -> str:
    """submit_type: songhe=送核；bubao=補報（過渡標記，正式 schema 再對署方欄位）。"""
    kind = "bubao" if submit_type == "bubao" else "songhe"
    kind_label = "補報" if kind == "bubao" else "送核"
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        (
            f'<ClaimData YearMonth="{summary.yearMonthRoc}" format="wundadi-claims-v0" '
            f'submitType="{kind}" submitTypeLabel="{kind_label}">'
        ),
        f"  <InstitutionCode>{institution_code}</InstitutionCode>",
        f"  <SubmitType>{kind}</SubmitType>",
        f"  <TotalEncounters>{summary.finishedEncounters}</TotalEncounters>",
        f"  <TotalConsultationPoints>{summary.totalConsultationPoints:.2f}</TotalConsultationPoints>",
        f"  <TotalDrugPoints>{summary.totalDrugPoints:.2f}</TotalDrugPoints>",
        f"  <TotalPoints>{summary.totalPoints:.2f}</TotalPoints>",
        "  <Details>",
    ]
    for r in summary.records:
        lines.append("    <Record>")
        lines.append(f"      <EncounterId>{_esc(r.encounterId)}</EncounterId>")
        lines.append(f"      <QueueNumber>{r.queueNumber if r.queueNumber is not None else ''}</QueueNumber>")
        lines.append(f"      <PatientID>{_esc(r.patientId)}</PatientID>")
        lines.append(f"      <Name>{_esc(r.patientName)}</Name>")
        lines.append(f"      <Diagnoses>{_esc(r.diagnoses)}</Diagnoses>")
        lines.append(f"      <DoctorId>{_esc(r.doctorId)}</DoctorId>")
        lines.append(f"      <DoctorName>{_esc(r.doctorName)}</DoctorName>")
        lines.append(f"      <Pharmacist>{_esc(r.pharmacist)}</Pharmacist>")
        lines.append(f"      <ConsultationPoints>{r.consultationPoints:.2f}</ConsultationPoints>")
        lines.append(f"      <DrugPoints>{r.drugPoints:.2f}</DrugPoints>")
        lines.append(f"      <Points>{r.totalPoints:.2f}</Points>")
        lines.append("      <Medications>")
        for m in r.medications:
            up = "" if m.unitPrice is None else f"{m.unitPrice:.4f}"
            lines.append(
                "        <Medication "
                f'nhiCode="{_esc(m.nhiCode)}" '
                f'days="{m.daysSupply}" '
                f'qty="{m.quantity}" '
                f'unitPrice="{up}" '
                f'points="{m.linePoints:.2f}" '
                f'priceSource="{m.priceSource}">'
                f"{_esc(m.drugText)}</Medication>"
            )
        lines.append("      </Medications>")
        lines.append("    </Record>")
    lines.append("  </Details>")
    lines.append("</ClaimData>")
    return "\n".join(lines)


def _esc(s: str) -> str:
    from src.core.plain_text import plain_text

    return (
        plain_text(str(s))
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
