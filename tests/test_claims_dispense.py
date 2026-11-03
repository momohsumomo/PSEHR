import re
import unittest

from src.claims.case_rules import dispense_code
from tests.test_claims_xml_layout import _summary, _visit
from src.claims.xml_export_nhi import render_nhi_outpatient_xml


class DispenseCodeTest(unittest.TestCase):
    def test_words_become_digits(self) -> None:
        self.assertEqual(dispense_code("\u81ea\u884c\u8abf\u5291"), "0")
        self.assertEqual(dispense_code("0 \u81ea\u884c\u8abf\u5291"), "0")
        self.assertEqual(dispense_code("\u4ea4\u4ed8\u8abf\u5291"), "1")
        self.assertEqual(dispense_code(""), "0")
        self.assertEqual(dispense_code("1"), "1")

    def test_file_never_carries_words(self) -> None:
        rec = _visit(dispense="\u81ea\u884c\u8abf\u5291", pharmacyCode="05203C", daysSupply=7)
        xml = render_nhi_outpatient_xml(_summary(rec))
        self.assertIn("<d28>0</d28>", xml)
        self.assertEqual(set(re.findall(r"<p2>(.*?)</p2>", xml)), {"0"})

    def test_no_drug_visit_files_2(self) -> None:
        rec = _visit(dispense="\u81ea\u884c\u8abf\u5291", medications=[], drugPoints=0, daysSupply=0)
        xml = render_nhi_outpatient_xml(_summary(rec))
        self.assertIn("<d28>2</d28>", xml)


if __name__ == "__main__":
    unittest.main()
