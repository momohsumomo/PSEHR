# -*- coding: utf-8 -*-
import os
from pathlib import Path

from src.claims.ic_daily_upload import render_ic_daily_xml
from src.claims.ic_sign_lookup import fill_signs, unsigned_normal


def test_render_includes_safety_signature_when_present():
    xml = render_ic_daily_xml(
        [
            {
                "h01": "A",
                "mb1": {"M13": "0001", "M14": "AB" * 128, "M15": "1" * 20},
                "orders": [{"D02": "1", "D03": "001", "D11": "CD" * 20}],
            }
        ]
    )
    assert "<M14>" in xml
    assert "<D11>" in xml


def test_fill_signs_from_previous_upload_xml(tmp_path: Path, monkeypatch):
    day = tmp_path / "14" / "Upload"
    day.mkdir(parents=True)
    sign = "AB" * 128
    rx = "CD" * 20
    treat = "T" * 20
    xml = (
        "<?xml version=\"1.0\" encoding=\"Big5\"?>"
        "<RECS><REC><MB1>"
        f"<M14>{sign}</M14><M15>{treat}</M15>"
        "</MB1><MB2><D03>001</D03><D11>"
        f"{rx}</D11></MB2></REC></RECS>"
    )
    (day / "UP.Xml").write_bytes(xml.encode("cp950"))
    monkeypatch.setenv("IC20_XML_ROOT", str(tmp_path))
    rec = {"h01": "A", "mb1": {"M15": treat}, "orders": [{"D03": "001"}]}
    fill_signs([rec], "2026-10-13")
    assert rec["mb1"]["M14"] == sign
    assert rec["orders"][0]["D11"] == rx
    assert unsigned_normal([rec]) == 0
    os.environ.pop("IC20_XML_ROOT", None)
