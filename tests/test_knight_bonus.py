import os
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from unittest import mock

from shop import admin, auction, death_tax, ep_balance, knight_bonus

RECRUIT = "abcdefab-abcd-abcd-abcd-abcdefabcdef"
OTHER_RECRUIT = "22222222-2222-2222-2222-222222222222"
RECRUITER = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
OTHER_RECRUITER = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"


class KnightRecruiterBonusTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.shop_db = os.path.join(self.tmp.name, "shop.db")
        self.recruited_db = os.path.join(self.tmp.name, "recruited_data.db")
        with closing(sqlite3.connect(self.shop_db)) as conn:
            knight_bonus._ensure_tables(conn)
            ep_balance._ensure_ep_adjustments_table(conn)
            conn.executescript(
                """
                CREATE TABLE bin_purchases (
                    uuid TEXT, status TEXT, purchased_at TEXT,
                    clean_ep_spent INTEGER, dirty_ep_spent INTEGER
                );
                CREATE TABLE donation_tickets (
                    uuid TEXT, status TEXT, dirty_ep_to_grant INTEGER,
                    resolved_at TEXT, submitted_at TEXT
                );
                """
            )
            conn.commit()
        with closing(sqlite3.connect(self.recruited_db)) as conn:
            conn.execute(
                "CREATE TABLE recruited "
                "(recruiter TEXT NOT NULL, recruited TEXT NOT NULL, timestamp TEXT NOT NULL)"
            )
            conn.commit()

        for target, name, value in (
            (knight_bonus, "_SHOP_DB", self.shop_db),
            (knight_bonus, "_RECRUITED_DB", self.recruited_db),
            (ep_balance, "_SHOP_DB", self.shop_db),
            (ep_balance, "_POINTS_DB", os.path.join(self.tmp.name, "missing.db")),
            (admin, "_log_admin_action", mock.Mock()),
            (admin, "_invalidate_users_cache", mock.Mock()),
            (auction, "_dm_card_in_background", mock.Mock()),
            (auction, "_resolve_discord_id_for_uuid", mock.Mock(return_value=None)),
            (death_tax, "get_cemetery_record", mock.Mock(return_value=None)),
            (ep_balance, "apply_ep_balance_hooks", mock.Mock()),
        ):
            patcher = mock.patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def add_recruitment(self, recruiter, recruited=RECRUIT):
        with closing(sqlite3.connect(self.recruited_db)) as conn:
            conn.execute(
                "INSERT INTO recruited VALUES (?, ?, ?)",
                (recruiter, recruited, "2026-01-01T00:00:00"),
            )
            conn.commit()

    def add_ticket(self, recruited=RECRUIT, ticket="ticket", username="Recruit"):
        with closing(sqlite3.connect(self.shop_db)) as conn:
            conn.execute(
                "INSERT INTO knight_bonus_grants "
                "(uuid, discord_id, username, amount, status, ticket_id, created_at) "
                "VALUES (?, '', ?, 250, 'pending', ?, ?)",
                (recruited, username, ticket, "2026-01-01T00:00:00+00:00"),
            )
            conn.commit()

    def rows(self, query, args=()):
        with closing(sqlite3.connect(self.shop_db)) as conn:
            return conn.execute(query, args).fetchall()

    def bulk(self, links):
        members = [
            {"user": {"id": did}, "roles": ["knight"]}
            for did in links
        ]
        with (
            mock.patch.object(knight_bonus, "_KNIGHT_TIER", 2),
            mock.patch.object(knight_bonus, "_tier_for_rank_name", return_value=2),
            mock.patch.object(knight_bonus, "_rank_tier_from_roles", return_value=2),
            mock.patch.object(knight_bonus, "_fetch_discord_members", return_value=members),
            mock.patch.object(knight_bonus, "_linked_accounts", return_value=links),
        ):
            return knight_bonus.bulk_grant_knight_bonus(send_dm=False)

    def test_approval_rewards_all_recruiters_once_and_credits_clean_balance(self):
        self.add_recruitment(RECRUITER, RECRUIT.upper())
        self.add_recruitment(RECRUITER.upper())
        self.add_recruitment(OTHER_RECRUITER)
        self.add_recruitment(RECRUITER, OTHER_RECRUIT)
        self.add_ticket()

        result = knight_bonus.resolve_knight_bonus(
            "ticket", approve=True, chief_name="Chief"
        )
        self.assertTrue(result["ok"])
        self.assertEqual(result["recruiter_bonuses_granted"], 2)
        self.assertEqual(
            set(self.rows("SELECT uuid, amount, ep_type FROM ep_adjustments")),
            {
                (RECRUIT, 250, "dirty"),
                (RECRUITER, 75, "clean"),
                (OTHER_RECRUITER, 75, "clean"),
            },
        )
        for is_high_rank in (False, True):
            with mock.patch.object(ep_balance, "_is_hr_uuid", return_value=is_high_rank):
                balance = ep_balance.fetch_ep_balance(RECRUITER)
            self.assertEqual(balance["clean_ep"], 75)
            self.assertEqual(balance["dirty_ep"], 0)

        again = knight_bonus.resolve_knight_bonus(
            "ticket", approve=True, chief_name="Chief"
        )
        self.assertIn("error", again)
        self.assertEqual(len(self.rows("SELECT * FROM knight_recruiter_bonus_grants")), 2)

    def test_prior_pair_is_skipped_but_another_recruit_can_earn_a_bonus(self):
        self.add_recruitment(RECRUITER)
        self.add_recruitment(OTHER_RECRUITER)
        self.add_recruitment(RECRUITER, OTHER_RECRUIT)
        with closing(sqlite3.connect(self.shop_db)) as conn:
            conn.execute(
                "INSERT INTO knight_recruiter_bonus_grants VALUES (?, ?, ?, ?)",
                (RECRUIT.upper(), RECRUITER.upper(), "previous", "2026-01-01"),
            )
            conn.commit()

        result = self.bulk({
            "1": (RECRUIT, "Recruit"),
            "2": (OTHER_RECRUIT, "SecondRecruit"),
        })
        self.assertEqual(result["granted"], 2)
        self.assertEqual(result["recruiter_bonuses_granted"], 2)
        self.assertEqual(
            self.rows(
                "SELECT uuid, COUNT(*) FROM ep_adjustments "
                "WHERE ep_type = 'clean' GROUP BY uuid ORDER BY uuid"
            ),
            [(RECRUITER, 1), (OTHER_RECRUITER, 1)],
        )
        repeated = self.bulk({"1": (RECRUIT, "Recruit")})
        self.assertEqual(repeated["skipped"], 1)
        self.assertEqual(len(self.rows("SELECT * FROM knight_recruiter_bonus_grants")), 3)

    def test_rejection_and_no_recruiters(self):
        self.add_recruitment(RECRUITER)
        self.add_ticket()
        result = knight_bonus.resolve_knight_bonus(
            "ticket", approve=False, chief_name="Chief"
        )
        self.assertEqual(result["status"], "rejected")
        self.assertEqual(result["recruiter_bonuses_granted"], 0)
        self.assertEqual(self.rows("SELECT * FROM ep_adjustments"), [])

        self.add_ticket(OTHER_RECRUIT, "ticket2")
        result = knight_bonus.resolve_knight_bonus(
            "ticket2", approve=True, chief_name="Chief"
        )
        self.assertEqual(result["recruiter_bonuses_granted"], 0)
        self.assertEqual(
            self.rows("SELECT uuid, amount, ep_type FROM ep_adjustments"),
            [(OTHER_RECRUIT, 250, "dirty")],
        )

    def test_unavailable_recruitment_data_leaves_ticket_pending(self):
        self.add_ticket()
        with mock.patch.object(
            knight_bonus, "_RECRUITED_DB", os.path.join(self.tmp.name, "missing.db")
        ):
            result = knight_bonus.resolve_knight_bonus(
                "ticket", approve=True, chief_name="Chief"
            )
            self.assertIn("Recruitment database unavailable", result["error"])
            self.assertEqual(
                self.rows("SELECT status FROM knight_bonus_grants"), [("pending",)]
            )
            rejected = knight_bonus.resolve_knight_bonus(
                "ticket", approve=False, chief_name="Chief"
            )
        self.assertEqual(rejected["status"], "rejected")
        self.assertEqual(self.rows("SELECT * FROM ep_adjustments"), [])
        self.assertEqual(self.rows("SELECT * FROM knight_recruiter_bonus_grants"), [])

    def test_bulk_failure_rolls_back_only_that_candidate(self):
        self.add_recruitment(RECRUITER)
        self.add_recruitment(OTHER_RECRUITER, OTHER_RECRUIT)
        with closing(sqlite3.connect(self.shop_db)) as conn:
            conn.execute(
                "CREATE TRIGGER fail_recruiter BEFORE INSERT ON ep_adjustments "
                f"WHEN NEW.uuid = '{RECRUITER}' AND NEW.ep_type = 'clean' "
                "BEGIN SELECT RAISE(ABORT, 'test failure'); END"
            )
            conn.commit()
        result = self.bulk({
            "1": (RECRUIT, "ARecruit"),
            "2": (OTHER_RECRUIT, "BRecruit"),
        })
        self.assertEqual(result["granted"], 1)
        self.assertEqual(result["errors"], 1)
        self.assertEqual(
            set(self.rows("SELECT uuid, amount, ep_type FROM ep_adjustments")),
            {(OTHER_RECRUIT, 250, "dirty"), (OTHER_RECRUITER, 75, "clean")},
        )
        self.assertEqual(
            self.rows("SELECT recruited_uuid, recruiter_uuid FROM knight_recruiter_bonus_grants"),
            [(OTHER_RECRUIT, OTHER_RECRUITER)],
        )

    def test_approval_failure_rolls_back_all_awards_and_can_be_retried(self):
        self.add_recruitment(RECRUITER)
        self.add_recruitment(OTHER_RECRUITER)
        self.add_ticket()
        with closing(sqlite3.connect(self.shop_db)) as conn:
            conn.execute(
                "CREATE TRIGGER fail_recruiter BEFORE INSERT ON ep_adjustments "
                f"WHEN NEW.uuid = '{OTHER_RECRUITER}' AND NEW.ep_type = 'clean' "
                "BEGIN SELECT RAISE(ABORT, 'test failure'); END"
            )
            conn.commit()
        result = knight_bonus.resolve_knight_bonus(
            "ticket", approve=True, chief_name="Chief"
        )
        self.assertIn("error", result)
        self.assertEqual(self.rows("SELECT status FROM knight_bonus_grants"), [("pending",)])
        self.assertEqual(self.rows("SELECT * FROM ep_adjustments"), [])
        self.assertEqual(self.rows("SELECT * FROM knight_recruiter_bonus_grants"), [])

        with closing(sqlite3.connect(self.shop_db)) as conn:
            conn.execute("DROP TRIGGER fail_recruiter")
            conn.commit()
        result = knight_bonus.resolve_knight_bonus(
            "ticket", approve=True, chief_name="Chief"
        )
        self.assertEqual(result["recruiter_bonuses_granted"], 2)
        self.assertEqual(len(self.rows("SELECT * FROM ep_adjustments")), 3)

    def test_concurrent_approvals_do_not_double_award(self):
        self.add_recruitment(RECRUITER)
        self.add_ticket()
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(
                lambda _: knight_bonus.resolve_knight_bonus(
                    "ticket", approve=True, chief_name="Chief"
                ),
                range(2),
            ))
        self.assertEqual(sum(bool(result.get("ok")) for result in results), 1)
        self.assertEqual(len(self.rows("SELECT * FROM ep_adjustments")), 2)
        self.assertEqual(len(self.rows("SELECT * FROM knight_recruiter_bonus_grants")), 1)

    def test_promotion_scanning_still_queues_a_ticket(self):
        member = {"user": {"id": "1"}, "roles": ["squire"]}
        with (
            mock.patch.object(knight_bonus, "_KNIGHT_TIER", 2),
            mock.patch.object(knight_bonus, "_ROLE_TIER_BY_ID", {"squire": 1, "knight": 2}),
            mock.patch.object(knight_bonus, "_fetch_discord_members", return_value=[member]),
            mock.patch.object(knight_bonus, "_linked_accounts", return_value={"1": (RECRUIT, "Recruit")}),
        ):
            self.assertTrue(knight_bonus.scan_knight_promotions()["baselined"])
            member["roles"] = ["knight"]
            self.assertEqual(knight_bonus.scan_knight_promotions()["created"], 1)
        self.assertEqual(self.rows("SELECT status FROM knight_bonus_grants"), [("pending",)])


if __name__ == "__main__":
    unittest.main()
