import unittest

from src.claims.xml_export_nhi import claim_patient_name
from src.core.plain_text import plain_text, sanitize_patient_names


class PlainTextTest(unittest.TestCase):
    def test_null_is_removed(self):
        self.assertEqual(plain_text("ABC\x00"), "ABC")
        self.assertEqual(claim_patient_name("ABC\x00DEF"), "ABCDEF")

    def test_patient_payload_name_is_cleaned(self):
        payload = {"name": [{"family": "A\x00", "given": ["B\x00C"], "text": "AB\x00C"}]}
        sanitize_patient_names(payload)
        self.assertEqual(payload["name"][0]["family"], "A")
        self.assertEqual(payload["name"][0]["given"], ["BC"])
        self.assertEqual(payload["name"][0]["text"], "ABC")
