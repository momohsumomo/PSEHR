import unittest

from src.core.intake_form import compose_kiosk_note


class IntakeFormTests(unittest.TestCase):
    def test_fingers_replace_the_whole_hand_in_doctor_wording(self):
        text = compose_kiosk_note(
            sites=["face-r", "hand-l", "finger-l-index", "finger-l-middle"],
            symptoms=["itch", "red"],
            days="2",
            severity="6",
            seen_other_doctor=True,
        )
        self.assertEqual(
            text,
            "Itching and erythema on the R cheek, L index finger and L middle finger, for 2 days. Severity 6/10. Seen by another doctor.",
        )
        self.assertNotIn("L hand", text)

    def test_unrecalled_duration_stays_in_chart_language(self):
        text = compose_kiosk_note(
            sites=["shin-l"],
            symptoms=["peel"],
            days="forgot",
            severity="3",
            seen_other_doctor=False,
        )
        self.assertIn("Scaling on the L shin", text)
        self.assertIn("duration not recalled", text)
        self.assertIn("Severity 3/10", text)
        self.assertIn("Not seen by another doctor.", text)
        self.assertNotIn("\u4e0d\u8a18\u5f97", text)

    def test_long_duration_words(self):
        text = compose_kiosk_note(
            sites=["scalp"],
            symptoms=["itch"],
            days="months",
            severity="8",
            seen_other_doctor=True,
        )
        self.assertIn("for several months", text)
        self.assertIn("Severity 8/10", text)

    def test_both_sides_of_the_trunk_drop_the_side(self):
        text = compose_kiosk_note(
            sites=["chest-r", "chest-l", "abdomen-l"],
            symptoms=["itch"],
            days="1",
            severity="2",
            seen_other_doctor=False,
        )
        self.assertIn("chest", text)
        self.assertIn("L abdomen", text)
        self.assertNotIn("R chest", text)
        self.assertNotIn("L chest", text)

    def test_many_face_spots_become_whole_face(self):
        text = compose_kiosk_note(
            sites=["forehead-r", "forehead-l", "face-r", "face-l", "nose", "chin"],
            symptoms=["acne"],
            days="7",
            severity="4",
            seen_other_doctor=False,
        )
        self.assertIn("whole face", text)
        self.assertNotIn("cheek", text)

    def test_one_side_of_the_face_stays_sided(self):
        text = compose_kiosk_note(
            sites=["face-l", "eyelid-l"],
            symptoms=["red"],
            days="2",
            severity="3",
            seen_other_doctor=False,
        )
        self.assertIn("left face", text)
        self.assertNotIn("cheek", text)

    def test_both_cheeks_use_the_chart_phrase(self):
        from src.core.intake_form import compose_cosmetic_note

        text = compose_cosmetic_note(sites=["face-r", "face-l"], concerns=["spot"], prior="never")
        self.assertEqual(text, "Cosmetic consult for spot removal on both cheeks. First treatment.")

    def test_cosmetic_follow_up_uses_chart_course_words(self):
        from src.core.intake_form import compose_cosmetic_note

        text = compose_cosmetic_note(
            sites=["face-r"],
            concerns=["spot", "nevus"],
            prior="before",
            course="darker",
        )
        self.assertEqual(
            text,
            "Cosmetic consult for spot removal and nevus removal on the R cheek. Post treatment, darker.",
        )

    def test_open_anatomy_zones_keep_their_names(self):
        text = compose_kiosk_note(
            sites=["body_arm_right", "face_forehead", "hand_left_dorsal_dorsum"],
            symptoms=["itch"],
            days="3",
            severity="5",
            seen_other_doctor=False,
        )
        self.assertIn("R arm", text)
        self.assertIn("forehead", text)
        self.assertIn("L dorsum of hand", text)

    def test_all_new_face_zones_read_as_the_whole_face(self):
        text = compose_kiosk_note(
            sites=[
                "face_forehead",
                "face_nose_glabella",
                "face_left_cheek",
                "face_right_cheek",
                "face_perioral",
                "face_chin",
                "face_forehead_right",
                "face_forehead_left",
                "face_eye_right",
                "face_eye_left",
                "face_glabella",
                "face_nose",
                "face_upper_lip",
                "face_lower_lip",
            ],
            symptoms=["acne"],
            days="7",
            severity="4",
            seen_other_doctor=False,
        )
        self.assertIn("whole face", text)
        self.assertNotIn("glabella", text)
