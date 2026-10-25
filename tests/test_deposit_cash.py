import unittest

from src.claims.deposit_refund import adjusted_visit_total, cash_collected


class DepositCashTest(unittest.TestCase):
    def test_held_deposit_is_inside_the_total(self):
        self.assertEqual(cash_collected(290, 500, 0), 790)

    def test_refunded_deposit_stays_in_the_visit_total(self):
        self.assertEqual(cash_collected(310, 0, 500), 810)

    def test_a_later_save_cannot_drop_the_refunded_deposit(self):
        self.assertEqual(adjusted_visit_total(310, 310, 0, 500), 810)

    def test_a_real_fee_change_after_refund_is_kept(self):
        self.assertEqual(adjusted_visit_total(790, 290, 0, 500), 790)

    def test_no_refund_leaves_the_sent_total(self):
        self.assertEqual(adjusted_visit_total(250, 250, 0, 0), 250)
