import unittest

from src.core.icd_crosswalk import browse_codes, browse_headings, map_code, search_codes, search_icd10_book


class IcdCrosswalkTests(unittest.TestCase):
    def test_ankle_ulcer_uses_unspecified_billable(self):
        got = map_code("707.13")
        self.assertEqual(got.icd10, "L97.309")
        self.assertEqual(got.nhi_icd10, "L97309")
        self.assertNotIn("707.13", got.chief_note)
        self.assertIn("\u672a\u8a18\u5de6\u53f3", got.chief_note)
        self.assertIn("\u672a\u8a18\u6df1\u5ea6", got.chief_note)
        self.assertNotIn("\u672a\u518d\u7d30\u5206", got.chief_note)
        self.assertNotIn("L97.2", got.icd10)

    def test_contact_dermatitis_stays_unspecified_cause(self):
        got = map_code("692.9")
        self.assertEqual(got.icd10, "L25.9")
        self.assertNotIn(got.icd10[:4], ("L23.", "L24."))
        self.assertNotIn("692.9", got.chief_note)
        self.assertIn("\u672a\u5206\u904e\u654f\u6216\u523a\u6fc0", got.chief_note)
        self.assertNotIn("\u672a\u518d\u7d30\u5206", got.chief_note)

    def test_solar_dermatitis_does_not_become_drug(self):
        got = map_code("692.72", text="\u65e5\u5149\u6027\u76ae\u819a\u708e")
        self.assertEqual(got.icd10, "L56.8")
        self.assertNotIn(got.icd10, ("L56.0", "L56.1", "L56.2"))
        self.assertNotIn("692.72", got.chief_note)
        self.assertIn("\u65e5\u5149\u6027\u76ae\u819a\u708e", got.chief_note)
        self.assertNotIn("\u672a\u518d\u7d30\u5206", got.chief_note)

    def test_real_icd10_is_unchanged(self):
        got = map_code("L30.9")
        self.assertEqual(got.input_kind, "icd10")
        self.assertEqual(got.icd10, "L30.9")
        self.assertEqual(got.chief_note, "")

    def test_no_map_still_returns_a_billable_code(self):
        got = map_code("707.20")
        self.assertEqual(got.icd10, "L89.90")
        self.assertTrue(got.review)
        self.assertIn("707.20", got.chief_note)
        self.assertNotIn("right", got.title.lower())
        self.assertNotIn("stage 1", got.title.lower())


    def test_combination_keeps_the_disease_as_primary(self):
        got = map_code("115.01")
        self.assertEqual(got.icd10, "B39.4")
        self.assertEqual([row["icd10"] for row in got.secondary], ["G02"])

    def test_search_chinese_name_returns_a_billable_code(self):
        hits = search_codes("\u6bdb\u56ca")
        self.assertTrue(hits)
        top = hits[0]
        self.assertIn("704", top["icd9"].replace(".", ""))
        self.assertTrue(top["icd10"])
        self.assertIn("\u6bdb\u56ca", top["name"])

    def test_search_combination_keeps_both_codes(self):
        hits = search_codes("115.01")
        match = next(hit for hit in hits if hit["icd9"].replace(".", "") == "11501")
        self.assertEqual(match["icd10"], "B39.4")
        self.assertEqual([row["icd10"] for row in match["secondary"]], ["G02"])

    def test_skin_chapter_lists_groups_then_codes(self):
        groups = browse_headings(680, 709)
        dermatitis = next(row for row in groups if row["code"] == "692")
        self.assertGreater(dermatitis["count"], 1)
        self.assertIn("\u75b9", dermatitis["name"])
        self.assertIn("dermatitis", dermatitis["nameEn"].lower())
        cholera = next(row for row in browse_headings(1, 139) if row["code"] == "001")
        self.assertIn("\u970d\u4e82", cholera["name"])
        self.assertIn("cholera", cholera["nameEn"].lower())
        solar = next(row for row in browse_codes("692") if row["icd9"] == "692.72")
        self.assertIn("\u76ae\u819a\u708e", solar["name"])
        self.assertIn("solar", solar["nameEn"].lower())

    def test_failed_lookup_does_not_become_cholera(self):
        for code in ("323.0", "358.0", "427.81"):
            got = map_code(code)
            self.assertNotEqual(got.icd10, "A00.0", code)

    def test_full_book_finds_sword_and_knife(self):
        sword = [hit["nhiIcd10"] for hit in search_icd10_book("W261")]
        self.assertIn("W261XXA", sword)
        knife = [hit["nhiIcd10"] for hit in search_icd10_book("knife")]
        self.assertTrue(any(code.startswith("W260") for code in knife))
        self.assertFalse(any(code.startswith("W261") for code in knife))
        knife_zh = [hit["nhiIcd10"] for hit in search_icd10_book("\u5200")]
        self.assertIn("W260XXA", knife_zh)


if __name__ == "__main__":
    unittest.main()
