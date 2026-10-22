import json
import tempfile
import unittest
from pathlib import Path

from src.infrastructure.sqlite_shadow_store import (
    SqliteShadowStore,
    _birthday_forms,
    patient_lookup_sql,
)


class PatientLookupTests(unittest.TestCase):
    def test_dotted_dates_are_the_same_day(self):
        forms = set(_birthday_forms("1020101"))
        for text in ("102.1.1", "102.01.01", "102.01.1", "102.1.01", "102/1/01", "102/01/1"):
            self.assertIn(text, forms)
        found = [patient_lookup_sql(text) for text in ("102.1.1", "102.01.01", "102.01.1", "102.1.01")]
        for sql, params in found:
            self.assertIn("birthday_roc", sql)
            self.assertNotIn("id_no", sql)
            self.assertNotIn("medical_no", sql)
            self.assertIn("102.01.1", params)
            self.assertIn("102.1.01", params)
        self.assertEqual(found[0][1], found[1][1])

    def test_digits_are_chart_only(self):
        sql, params = patient_lookup_sql("103396")
        self.assertIn("medical_no", sql)
        self.assertNotIn("id_no", sql)
        self.assertNotIn("phone", sql)
        self.assertNotIn("birthday", sql)
        self.assertEqual(params, ["103396"])

    def test_id_phone_and_name_stay_on_their_column(self):
        sql, _params = patient_lookup_sql("A123456789")
        self.assertIn("id_no", sql)
        self.assertNotIn("medical_no", sql)
        sql, _params = patient_lookup_sql("0912-345-678")
        self.assertIn("phone", sql)
        self.assertNotIn("medical_no", sql)
        self.assertNotIn("id_no", sql)
        sql, params = patient_lookup_sql("\u738b\u5c0f\u660e")
        self.assertIn("family_name LIKE", sql)
        self.assertNotIn("id_no", sql)
        self.assertIn("\u738b\u5c0f\u660e%", params)
        self.assertIn("\u738b", params)

    def test_invalid_dotted_date_does_not_scan(self):
        sql, params = patient_lookup_sql("102.13.40")
        self.assertEqual((sql, params), (" AND 0", []))

    def test_search_uses_the_matching_column(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = SqliteShadowStore(Path(tmp) / "t.db")
            store.initialize()
            with store._connect() as conn:
                self._put(conn, "chart", "103396", "A111111111", "0800101", "\u738b", "\u5c0f\u660e")
                self._put(conn, "idhit", "888888", "A103396789", "102.01.1", "\u674e", "\u56db")
                self._put(conn, "day", "777777", "B222222222", "1020101", "\u9673", "\u4e94")
                chart_sql, chart_params = patient_lookup_sql("103396")
                plan = " ".join(
                    str(row[3])
                    for row in conn.execute(
                        "EXPLAIN QUERY PLAN SELECT resource_id FROM patient_index pi WHERE 1=1" + chart_sql,
                        chart_params,
                    )
                )
                self.assertIn("idx_patient_index_medical_no", plan)
                birth_sql, birth_params = patient_lookup_sql("102.1.1")
                birth_plan = " ".join(
                    str(row[3])
                    for row in conn.execute(
                        "EXPLAIN QUERY PLAN SELECT resource_id FROM patient_index pi WHERE 1=1" + birth_sql,
                        birth_params,
                    )
                )
                self.assertIn("idx_patient_birthday_roc", birth_plan)

            charts = store.search_patients({"q": "103396", "_count": "20"})
            self.assertEqual([row["id"] for row in charts], ["chart"])
            days = {row["id"] for row in store.search_patients({"q": "102.1.01", "_count": "20"})}
            self.assertEqual(days, {"idhit", "day"})
            names = {row["id"] for row in store.search_patients({"q": "\u738b\u5c0f\u660e", "_count": "20"})}
            self.assertEqual(names, {"chart"})
            ids = [row["id"] for row in store.search_patients({"q": "A103396789", "_count": "20"})]
            self.assertEqual(ids, ["idhit"])
            held = getattr(store._local, "conn", None)
            if held is not None:
                held.close()
                store._local.conn = None

    def _put(self, conn, resource_id, medical_no, id_no, birthday, family, given):
        conn.execute(
            """
            INSERT INTO patient_index (
                resource_id, family_name, given_name, id_no, medical_no, birthday_roc, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
            """,
            (resource_id, family, given, id_no, medical_no, birthday),
        )
        conn.execute(
            """
            INSERT INTO resource_cache (resource_type, resource_id, payload_json)
            VALUES ('Patient', ?, ?)
            """,
            (resource_id, json.dumps({"id": resource_id})),
        )


if __name__ == "__main__":
    unittest.main()
