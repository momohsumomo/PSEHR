"""食藥署管制分級對健保碼：不連網的單元測試。"""

from __future__ import annotations

import unittest

from hub.control_join import (
    apply_control_classes,
    fda_lic_serial6,
    normalize_control_class,
    permit_serial6,
)
from hub.diff import diff_snapshots
from hub.gates import evaluate_gates
from hub.normalize import normalize_record


class ControlJoinTests(unittest.TestCase):
    def test_serial_from_permit_and_fda_url(self) -> None:
        self.assertEqual(permit_serial6("衛署藥製字第057964號"), "057964")
        self.assertEqual(fda_lic_serial6("https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01057964"), "057964")
        self.assertEqual(fda_lic_serial6("51058994"), "058994")

    def test_normalize_class(self) -> None:
        self.assertEqual(normalize_control_class("第四級管制藥品"), "4")
        self.assertEqual(normalize_control_class("2"), "2")
        self.assertEqual(normalize_control_class("取消管制藥品註記"), "")
        self.assertEqual(normalize_control_class(""), "")

    def test_sales_code_wins_and_license_name_join(self) -> None:
        rows = {
            "A|": {
                "nhiCode": "AC11111100",
                "nameEn": "Coyue F.C. Tablets 10mg",
                "nameZh": "樂果膜衣錠10毫克",
                "fdaLicId": "01057964",
                "controlClass": "",
            },
            "B|": {
                "nhiCode": "BC22222200",
                "nameEn": "Dummy",
                "nameZh": "測試藥",
                "fdaLicId": "01060152",
                "controlClass": "",
            },
        }
        licenses = [
            {
                "許可證字號": "衛署藥製字第057964號",
                "中文品名": "樂果膜衣錠10毫克",
                "英文品名": "Coyue F.C. Tablets 10mg",
                "管制藥品分類級別": "",
            },
            {
                "許可證字號": "衛部藥製字第060152號",
                "中文品名": "思有得持續性藥效膠囊33毫克",
                "英文品名": "Methydur Sustained Release Capsules 33mg",
                "管制藥品分類級別": "第三級管制藥品",
            },
        ]
        sales = [{"健保藥品代碼": "AC11111100", "管制級別": "1", "藥品名稱": "阿片酊"}]
        stats = apply_control_classes(rows, licenses=licenses, sales=sales)
        self.assertEqual(rows["A|"]["controlClass"], "1")
        self.assertEqual(rows["B|"]["controlClass"], "3")
        self.assertEqual(stats["matchedSales"], 1)
        self.assertEqual(stats["matchedLicense"], 1)
        self.assertEqual(stats["controlledByNhiCode"]["AC11111100"], "1")
        self.assertEqual(stats["controlledByNhiCode"]["BC22222200"], "3")

    def test_ambiguous_same_serial_without_name_not_guessed(self) -> None:
        rows = {
            "X|": {
                "nhiCode": "ZZ00000000",
                "nameEn": "UNKNOWN",
                "nameZh": "未知",
                "fdaLicId": "01000094",
                "controlClass": "",
            }
        }
        licenses = [
            {
                "許可證字號": "衛署藥製字第000094號",
                "中文品名": "甲藥",
                "英文品名": "AAA",
                "管制藥品分類級別": "第四級管制藥品",
            },
            {
                "許可證字號": "衛部藥輸字第000094號",
                "中文品名": "乙藥",
                "英文品名": "BBB",
                "管制藥品分類級別": "第二級管制藥品",
            },
        ]
        stats = apply_control_classes(rows, licenses=licenses, sales=[])
        self.assertEqual(rows["X|"]["controlClass"], "")
        self.assertGreaterEqual(stats["ambiguousSkipped"], 1)

    def test_normalize_keeps_fda_lic_id(self) -> None:
        row = normalize_record(
            {
                "Q1_ID": "AC57964100",
                "NAME": "Coyue",
                "EXPR1": "樂果",
                "START_DATE": "1070501",
                "END_DATE": "1080331",
                "PRICE": "1",
                "FDA_URL": "https://lmspiq.fda.gov.tw/web/DRPIQ/DRPIQ1000Result?licId=01057964",
            }
        )
        assert row is not None
        self.assertEqual(row["fdaLicId"], "01057964")
        self.assertEqual(row["controlClass"], "")

    def test_control_fill_is_auto_gate(self) -> None:
        prev = {"A|": {"nhiCode": "A", "price": 10, "controlClass": ""}}
        curr = {"A|": {"nhiCode": "A", "price": 10, "controlClass": "4"}}
        diff = diff_snapshots(prev, curr)
        self.assertTrue(diff["summary"]["material"])
        self.assertEqual(diff["summary"]["controlFilled"], 1)
        self.assertFalse(diff["summary"]["priceMaterial"])
        gate = evaluate_gates(diff["summary"], has_previous=True)
        self.assertEqual(gate["decision"], "auto")
        self.assertIn("TFDA_CONTROL_OVERLAY", gate["reasons"])


if __name__ == "__main__":
    unittest.main()
