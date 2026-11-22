import tempfile
import unittest
from pathlib import Path

from src.core.fhir_urls import ID_NHI_ORG
from src.infrastructure.sqlite_shadow_store import CLINIC_PROFILE_KEY, SqliteShadowStore


class ClinicOrganizationTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.store = SqliteShadowStore(Path(self.tmp.name) / "t.db")
        self.store.initialize()

    def tearDown(self):
        conn = getattr(self.store._local, "conn", None)
        if conn is not None:
            conn.close()
        self.tmp.cleanup()

    def _visit(self, rid, **extra):
        payload = {"resourceType": "Encounter", "id": rid, "status": "planned",
                   "subject": {"reference": "Patient/p1"}, "period": {"start": "2026-11-01T09:00:00"}}
        payload.update(extra)
        self.store.cache_resource("Encounter", rid, payload)
        return self.store.get_cached_resource("Encounter", rid)

    def test_no_clinic_code_leaves_visit_alone(self):
        self.assertNotIn("serviceProvider", self._visit("e0"))

    def test_profile_save_writes_organization_and_visits_point_at_it(self):
        self.store.set_json_setting(CLINIC_PROFILE_KEY, {"profile": {"clinicCode": "0000000001", "clinicName": "C"}})
        org = self.store.get_cached_resource("Organization", "org-0000000001")
        self.assertEqual(org["identifier"], [{"system": ID_NHI_ORG, "value": "0000000001"}])
        self.assertEqual(org["name"], "C")
        self.assertEqual(self._visit("e1")["serviceProvider"], {"reference": "Organization/org-0000000001"})
        kept = self._visit("e2", serviceProvider={"reference": "Organization/other"})
        self.assertEqual(kept["serviceProvider"], {"reference": "Organization/other"})


if __name__ == "__main__":
    unittest.main()
