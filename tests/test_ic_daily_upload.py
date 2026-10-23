# -*- coding: utf-8 -*-
from src.claims.ic_daily_upload import render_ic_daily_xml


def test_daily_fee_is_first_band_per_person_minus_copay():
    from src.claims.ic_daily_upload import daily_medical_fee
    from src.claims.yisheng_rules import flat_consult_points

    assert flat_consult_points("0800101", "2026-10-23") == 397
    assert flat_consult_points("0400101", "2026-10-23") == 424
    assert flat_consult_points("1140101", "2026-10-23") == 484
    assert daily_medical_fee(397, 0, 0, 50) == 347
    assert daily_medical_fee(397, 55, 39, 50) == 441


def test_daily_xml_is_format_2_and_omits_empty_signature():
    xml = render_ic_daily_xml(
        [
            {
                "h01": "A",
                "mb1": {
                    "M01": "123456789012",
                    "M02": "000012345678",
                    "M03": "A123456789",
                    "M04": "0800101",
                    "M05": "3521013662",
                    "M06": "A100000001",
                    "M07": "01",
                    "M11": "1151013090000",
                    "M12": "1",
                    "M13": "0006",
                    "M15": "12345678901234567890",
                    "M20": "3",
                    "M23": "0",
                    "M24": "1",
                    "M35": "L209",
                    "M44": "452",
                    "M45": "50",
                    "M51": "4",
                    "M56": "11",
                },
                "orders": [
                    {
                        "D01": "1151013090000",
                        "D02": "1",
                        "D03": "001",
                        "D04": "A",
                        "D05": "0",
                        "D06": "AC12345678",
                        "D08": "BID",
                        "D09": "3",
                        "D10": "6.0",
                        "D14": "PO",
                    }
                ],
            }
        ]
    )
    raw = xml.encode("cp950")
    text = raw.decode("cp950")
    assert 'encoding="Big5"' in text
    assert "<H00>1</H00>" in text
    assert "<H01>A</H01>" in text
    assert "<M15>12345678901234567890</M15>" in text
    assert "<MB2>" in text
    assert "<D08>BID</D08>" in text
    assert "<M14>" not in text
    assert "<D11>" not in text
    assert "<M16>" not in text


def test_repeat_diagnosis_stays_and_card_again_fields_are_written():
    from src.claims.ic_daily_upload import _dx

    class _Store:
        def list_conditions(self, encounter_id):
            return [
                {"indexMeta": {"icd10Code": "L70.0"}},
                {"indexMeta": {"icd10Code": "L70.0"}},
                {"indexMeta": {"icd10Code": "D21.9"}},
            ]

    assert _dx(_Store(), "enc") == ["L700", "L700", "D219"]
    xml = render_ic_daily_xml(
        [
            {
                "h01": "A",
                "mb1": {
                    "M12": "2",
                    "M15": "12345678901234567890",
                    "M49": "1151006171900",
                    "M52": "12345678901234567890",
                },
                "orders": [
                    {
                        "D02": "R",
                        "D05": "4",
                        "D06": "09002C",
                        "D12": "3500000000",
                    }
                ],
            }
        ]
    )
    assert "<M49>1151006171900</M49>" in xml
    assert "<M52>12345678901234567890</M52>" in xml
    assert "<D12>3500000000</D12>" in xml


def test_orders_follow_the_prescription_not_a_rewritten_code():
    from src.claims.ic_daily_upload import _orders

    meds = [
        {
            "indexMeta": {
                "nhiCode": "51006C",
                "lineSort": 2,
                "quantity": 1,
                "daysSupply": 1,
                "useage": "st",
                "useType": "1",
            },
            "resource": {},
        },
        {
            "indexMeta": {
                "nhiCode": "AC45249321",
                "lineSort": 1,
                "quantity": 1,
                "daysSupply": 3,
                "useage": "bid",
                "useType": "1",
                "unitPrice": 10,
            },
            "resource": {},
        },
        {
            "indexMeta": {
                "nhiCode": "BC25159343",
                "lineSort": 3,
                "quantity": 1,
                "daysSupply": 14,
                "useage": "qd",
                "useType": "T",
            },
            "resource": {},
        },
        {
            "indexMeta": {
                "nhiCode": "01036C",
                "lineSort": 4,
                "quantity": 1,
                "daysSupply": 1,
            },
            "resource": {},
        },
        {
            "indexMeta": {
                "nhiCode": "09002C",
                "lineSort": 5,
                "quantity": 1,
                "daysSupply": 1,
                "payMark": "\u4ea4",
            },
            "resource": {},
        },
    ]
    casts = {
        "01036C": "\u865b\u64ec",
        "09002C": "\u6aa2\u67e5",
        "51006C": "\u6cbb\u7642",
    }
    orders, *_rest = _orders(meds, "1151013083040", "0", {}, {}, casts)
    assert [row["D06"] for row in orders] == [
        "AC45249321",
        "BC25159343",
        "01036C",
        "09002C",
        "51006C",
    ]
    assert [row["D03"] for row in orders] == ["1", "2", "3", "4", "5"]
    drug = orders[0]
    gel = orders[1]
    virtual = orders[2]
    lab = orders[3]
    treat = orders[4]
    assert drug["D02"] == "1"
    assert drug["D08"] == "bid"
    assert drug["D14"] == "PO"
    assert gel["D14"] == "TOPI"
    assert gel["D04"] == "B"
    assert virtual["D02"] == "G"
    assert virtual["D10"] == "0.0"
    assert "D05" not in virtual
    assert lab["D02"] == "R"
    assert lab["D05"] == "4"
    assert treat["D02"] == "2"
    assert all(row["D02"] != "9" for row in orders)


def test_w_sequence_uploads_as_normal_and_keeps_sam_and_card():
    from src.claims.ic_daily_upload import _assess, _compose

    class _Store:
        def list_medication_requests(self, encounter_id):
            return []

        def list_conditions(self, encounter_id):
            return []

    common = dict(
        institution="3521013662",
        id_no="A123456789",
        birthday="0800101",
        doctor_raw="A100000001",
        staff_by_id={},
        staff_by_name={},
    )
    reg = {
        "treatSeq": "W001",
        "samId": "123456789012",
        "hcId": "000012345678",
        "treatmentNumber": "12345678901234567890",
        "caseNo": "04",
    }
    assert _assess(reg=reg, treat_seq="W001", **common) == []
    rec, _note = _compose(
        reg=reg,
        treat_seq="W001",
        iso_day="2026-10-22",
        slot="",
        fee_copay=0,
        card_fallback="",
        store=_Store(),
        encounter_id="enc",
        usages={},
        routes={},
        **common,
    )
    assert rec["h01"] == "A"
    assert rec["mb1"]["M13"] == "W001"
    assert rec["mb1"]["M07"] == "01"
    assert rec["mb1"]["M01"] == "123456789012"
    assert rec["mb1"]["M02"] == "000012345678"

    bad = dict(reg, treatSeq="A000")
    bad_rec, _note = _compose(
        reg=bad,
        treat_seq="A000",
        iso_day="2026-10-22",
        slot="",
        fee_copay=0,
        card_fallback="",
        store=_Store(),
        encounter_id="enc",
        usages={},
        routes={},
        **common,
    )
    assert rec["mb1"]["M44"] == "397"
    assert bad_rec["h01"] == "B"
    assert "M01" not in bad_rec["mb1"]
    assert "M02" not in bad_rec["mb1"]
