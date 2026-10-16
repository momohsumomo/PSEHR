"""健保申報組檔模組（組檔唯一出口；格式細節可再換策略）。"""

from __future__ import annotations

from src.claims.engine import ClaimsSummary, build_claims_summary, clinic_dept_code, clinic_dispense_code
from src.claims.xml_export import render_claims_xml
from src.claims.xml_export_nhi import render_nhi_outpatient_xml, render_nhi_outpatient_zip

__all__ = [
    "ClaimsSummary",
    "build_claims_summary",
    "clinic_dept_code",
    "clinic_dispense_code",
    "render_claims_xml",
    "render_nhi_outpatient_xml",
    "render_nhi_outpatient_zip",
]
