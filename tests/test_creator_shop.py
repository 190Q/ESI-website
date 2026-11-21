import gc
import importlib
import json
import os
import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import UTC, datetime, timedelta
from unittest import mock

from shop import admin, auction, creator, items
from shop import bin as shop_bin


class CreatorShopTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(gc.collect)
        self.db = os.path.join(self.tmp.name, "shop.db")
        self.catalogue = os.path.join(self.tmp.name, "items.json")
        self.catalogue_items = [
            {"id": "own-bin", "name": "Own bin", "type": "bin", "active": True,
             "price": 10, "creator_discord_id": "owner"},
            {"id": "other-bin", "name": "Other bin", "type": "bin", "active": True,
             "price": 10, "creator_discord_id": "other"},
            {"id": "own-hidden", "name": "Hidden bin", "type": "bin", "active": True,
             "price": 10, "creator_discord_id": "owner", "visible_to_ranks": ["knight"]},
            {"id": "other-hidden", "name": "Other bin", "type": "bin", "active": True,
             "price": 10, "creator_discord_id": "other", "visible_to_top_n": 1},
            {"id": "own-auction", "name": "Own auction", "type": "auction", "active": True,
             "creator_discord_id": "owner", "visible_to_top_n": 1, "starting_bid": 1},
            {"id": "other-auction", "name": "Other auction", "type": "auction", "active": True,
             "creator_discord_id": "other", "visible_to_ranks": ["knight"], "starting_bid": 1},
        ]
        with open(self.catalogue, "w", encoding="utf-8") as f:
            json.dump(self.catalogue_items, f)
        now = datetime.now(UTC)
        with closing(sqlite3.connect(self.db)) as conn:
            conn.executescript("""
                CREATE TABLE item_overrides (item_id TEXT PRIMARY KEY, active INTEGER, stock INTEGER);
                CREATE TABLE auctions (
                    auction_id TEXT PRIMARY KEY, item_id TEXT, status TEXT,
                    current_highest_bid INTEGER, current_highest_bidder_uuid TEXT,
                    ends_at TEXT, created_at TEXT, extended INTEGER
                );
                CREATE TABLE bids (
                    bid_id TEXT PRIMARY KEY, auction_id TEXT, uuid TEXT, username TEXT,
                    amount INTEGER, clean_ep_used INTEGER, dirty_ep_used INTEGER,
                    placed_at TEXT, is_winning INTEGER
                );
                CREATE TABLE bin_purchases (
                    purchase_id TEXT, item_id TEXT, uuid TEXT, username TEXT, ep_spent INTEGER,
                    clean_ep_spent INTEGER, dirty_ep_spent INTEGER, status TEXT,
                    fulfillment_note TEXT, purchased_at TEXT, resolved_at TEXT
                );
                CREATE TABLE ep_reservations (
                    reservation_id TEXT, uuid TEXT, username TEXT, reserved_amount INTEGER,
                    ep_type TEXT, source TEXT, created_at TEXT, released_at TEXT
                );
            """)
            for aid, item_id in (("a-own", "own-auction"), ("a-other", "other-auction")):
                conn.execute(
                    "INSERT INTO auctions VALUES (?, ?, 'active', 0, NULL, ?, ?, 0)",
                    (aid, item_id, (now + timedelta(hours=5)).isoformat(), now.isoformat()),
                )
            conn.execute(
                "INSERT INTO bids VALUES ('b-other', 'a-other', 'bidder', 'Bidder', 5, 5, 0, ?, 1)",
                (now.isoformat(),),
            )
            conn.execute(
                "INSERT INTO bids VALUES ('b-own', 'a-own', 'bidder', 'Bidder', 5, 5, 0, ?, 1)",
                (now.isoformat(),),
            )
            conn.commit()
        for target, name, value in (
            (items, "_items_by_id", {}),
            (items, "_items_list", []),
            (items, "_loaded", False),
            (items, "_loaded_at", 0.0),
            (items, "_SHOP_ITEMS_JSON", self.catalogue),
            (items, "_SHOP_DB", self.db),
            (creator, "_SHOP_DB", self.db),
            (auction, "_SHOP_DB", self.db),
            (shop_bin, "_SHOP_DB", self.db),
            (admin, "_SHOP_DB", self.db),
        ):
            patcher = mock.patch.object(target, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.valid_creator = mock.patch.object(items, "_has_valid_creator", return_value=True)
        self.valid_creator.start()
        self.addCleanup(self.valid_creator.stop)
        items.reload()

    def test_creator_sees_only_their_own_restricted_items(self):
        own = items.get_items(tags={"squire"}, user_position=10, discord_id="owner")
        by_id = {item["id"]: item for item in own}
        self.assertEqual(set(by_id), {"own-bin", "other-bin", "own-hidden", "own-auction"})
        self.assertTrue(by_id["own-hidden"]["visibility_blocked"])
        self.assertTrue(by_id["own-hidden"]["is_own_item"])
        self.assertTrue(by_id["own-bin"]["is_own_item"])
        self.assertNotIn("visibility_blocked", by_id["own-bin"])

        guest = items.get_items(tags={"squire"}, user_position=10)
        self.assertEqual([item["id"] for item in guest], ["own-bin", "other-bin"])
        manager = items.get_items(tags={"squire"}, user_position=10, include_blocked=True)
        self.assertEqual(len(manager), len(self.catalogue_items))
        self.assertTrue(next(i for i in manager if i["id"] == "other-hidden")["visibility_blocked"])

    def test_invalid_creator_remains_hidden_even_from_owner_and_manager(self):
        self.valid_creator.stop()
        with mock.patch.object(items, "_has_valid_creator",
                               side_effect=lambda item: item.get("creator_discord_id") != "owner"):
            visible = items.get_items(tags={"squire"}, user_position=10,
                                      include_blocked=True, discord_id="owner")
        self.assertFalse(any(item["creator_discord_id"] == "owner" for item in visible))

    def test_bin_listing_includes_owners_restricted_item(self):
        with (
            mock.patch.object(shop_bin, "resolve_uuid_for_user", return_value=("uuid", "Name")),
            mock.patch.object(shop_bin, "get_user_cycle_position", return_value=10),
            mock.patch.object(shop_bin, "build_user_tags", return_value={"squire"}),
            mock.patch.object(shop_bin, "fetch_ep_balance", return_value={}),
        ):
            by_id = {item["id"]: item for item in shop_bin.list_bin_items(["role"], "owner")["items"]}
        self.assertTrue(by_id["own-hidden"]["visibility_blocked"])
        self.assertTrue(by_id["own-hidden"]["is_own_item"])
        self.assertNotIn("other-hidden", by_id)

    def test_restricted_auction_listing_preserves_creator_and_admin_access(self):
        with (
            mock.patch.object(auction, "resolve_uuid_for_user", return_value=("uuid", "Name")),
            mock.patch.object(auction, "get_user_cycle_position", return_value=10),
            mock.patch.object(auction, "build_user_tags", return_value={"squire"}),
            mock.patch.object(auction, "fetch_ep_balance", return_value={}),
        ):
            own = auction.list_auctions("owner", ["role"])["auctions"]
            self.assertEqual([a["auction_id"] for a in own], ["a-own"])
            self.assertTrue(own[0]["visibility_blocked"])
            self.assertTrue(own[0]["is_own_item"])
            self.assertEqual(auction.list_auctions("", ["role"])["auctions"], [])
            self.assertEqual(len(auction.list_auctions("owner", ["role"], True)["auctions"]), 2)

    def test_direct_and_cart_purchase_reject_owner_without_partial_checkout(self):
        with (
            mock.patch.object(shop_bin, "resolve_uuid_for_user", return_value=("uuid", "Name")),
            mock.patch.object(shop_bin, "get_user_cycle_position", return_value=10),
            mock.patch.object(shop_bin, "build_user_tags", return_value={"squire"}),
            mock.patch.object(admin, "get_user_limits", return_value=None),
        ):
            with self.assertRaises(shop_bin.PurchaseError) as direct:
                shop_bin.execute_bin_purchase("owner", ["manager-role"], "own-bin")
            self.assertEqual(direct.exception.status, 403)
            with self.assertRaises(shop_bin.PurchaseError) as cart:
                shop_bin.execute_cart_checkout("owner", [], [
                    {"item_id": "other-bin", "quantity": 1},
                    {"item_id": "own-bin", "quantity": 1},
                ])
            self.assertEqual(cart.exception.status, 403)
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM bin_purchases").fetchone()[0], 0)

    def test_non_owner_can_purchase_and_place_a_visible_bid(self):
        split = {"clean_to_spend": 10, "dirty_to_spend": 0}
        with (
            mock.patch.object(shop_bin, "resolve_uuid_for_user", return_value=("buyer", "Buyer")),
            mock.patch.object(shop_bin, "get_user_cycle_position", return_value=1),
            mock.patch.object(shop_bin, "build_user_tags", return_value={"knight"}),
            mock.patch.object(shop_bin, "resolve_spend", return_value=split),
            mock.patch.object(shop_bin, "_notify_creator_of_sale"),
            mock.patch.object(admin, "get_user_limits", return_value=None),
            mock.patch.object(auction, "resolve_uuid_for_user", return_value=("buyer", "Buyer")),
            mock.patch.object(auction, "get_user_cycle_position", return_value=1),
            mock.patch.object(auction, "build_user_tags", return_value={"knight"}),
            mock.patch.object(auction, "resolve_spend", return_value=split),
            mock.patch.object(auction, "_resolve_discord_id_for_uuid", return_value=None),
        ):
            result = shop_bin.execute_bin_purchase("buyer", [], "own-bin")
            self.assertEqual(result["item_id"], "own-bin")
            bid = auction.place_bid("buyer", [], "a-own", 10)
            self.assertEqual(bid["amount"], 10)

    def test_creator_bid_and_rank_restricted_bid_are_rejected(self):
        with (
            mock.patch.object(auction, "resolve_uuid_for_user", return_value=("uuid", "Name")),
            mock.patch.object(auction, "get_user_cycle_position", return_value=10),
            mock.patch.object(auction, "build_user_tags", return_value={"squire"}),
        ):
            with self.assertRaises(shop_bin.PurchaseError) as own:
                auction.place_bid("owner", [], "a-own", 5)
            self.assertEqual(own.exception.status, 403)
            with self.assertRaises(shop_bin.PurchaseError) as restricted:
                auction.place_bid("owner", [], "a-other", 10)
            self.assertEqual(restricted.exception.status, 403)
            self.assertIn("restricted", restricted.exception.message)

    def test_settlement_skips_existing_bid_from_new_creator(self):
        now = datetime.now(UTC).isoformat()
        with closing(sqlite3.connect(self.db)) as conn:
            conn.execute("DELETE FROM bids WHERE bid_id = 'b-own'")
            conn.executemany(
                "INSERT INTO bids VALUES (?, 'a-own', ?, ?, ?, ?, 0, ?, 1)",
                [("owner-bid", "OWNER-UUID", "Owner", 100, 100, now),
                 ("buyer-bid", "buyer-uuid", "Buyer", 50, 50, now)],
            )
            conn.commit()
        with (
            mock.patch.object(auction, "resolve_uuid_for_user", return_value=("owner-uuid", "Owner")),
            mock.patch.object(auction, "_available_ep_for_auction", return_value=100),
            mock.patch.object(auction, "_resolve_discord_id_for_uuid", return_value=None),
        ):
            auction._settle_auction({"auction_id": "a-own", "item_id": "own-auction"}, now)
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(conn.execute("SELECT uuid FROM bin_purchases").fetchall(), [("buyer-uuid",)])
            self.assertEqual(conn.execute("SELECT status FROM auctions WHERE auction_id = 'a-own'").fetchone()[0], "closed")

    def test_settlement_with_only_owner_bid_creates_no_purchase(self):
        now = datetime.now(UTC).isoformat()
        with closing(sqlite3.connect(self.db)) as conn:
            conn.execute("UPDATE bids SET uuid = 'OWNER-UUID' WHERE bid_id = 'b-own'")
            conn.execute(
                "INSERT INTO ep_reservations VALUES ('r', 'OWNER-UUID', 'Owner', 5, 'clean', ?, ?, NULL)",
                ("auction:a-own", now),
            )
            conn.commit()
        with (
            mock.patch.object(auction, "resolve_uuid_for_user", return_value=("owner-uuid", "Owner")),
            mock.patch.object(auction, "_resolve_discord_id_for_uuid", return_value=None),
        ):
            auction._settle_auction({"auction_id": "a-own", "item_id": "own-auction"}, now)
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(conn.execute("SELECT COUNT(*) FROM bin_purchases").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT is_winning FROM bids WHERE bid_id = 'b-own'").fetchone()[0], 0)
            self.assertEqual(conn.execute("SELECT released_at FROM ep_reservations WHERE reservation_id = 'r'").fetchone()[0], now)

    def test_multiple_winner_settlement_skips_owner(self):
        items._items_by_id["own-auction"]["winner_count"] = 2
        now = datetime.now(UTC).isoformat()
        with closing(sqlite3.connect(self.db)) as conn:
            conn.execute("DELETE FROM bids WHERE auction_id = 'a-own'")
            conn.executemany(
                "INSERT INTO bids VALUES (?, 'a-own', ?, ?, ?, ?, 0, ?, 1)",
                [("first", "first-uuid", "First", 100, 100, now),
                 ("owner", "OWNER-UUID", "Owner", 90, 90, now),
                 ("second", "second-uuid", "Second", 80, 80, now)],
            )
            conn.commit()
        with (
            mock.patch.object(auction, "resolve_uuid_for_user", return_value=("owner-uuid", "Owner")),
            mock.patch.object(auction, "_available_ep_for_auction", return_value=100),
            mock.patch.object(auction, "_resolve_discord_id_for_uuid", return_value=None),
        ):
            auction._settle_auction({"auction_id": "a-own", "item_id": "own-auction"}, now)
        with closing(sqlite3.connect(self.db)) as conn:
            self.assertEqual(
                {row[0] for row in conn.execute("SELECT uuid FROM bin_purchases")},
                {"first-uuid", "second-uuid"},
            )

    def test_creator_auction_ownership_checks_auction_and_bid(self):
        self.assertTrue(creator.owns_auction("owner", "a-own"))
        self.assertFalse(creator.owns_auction("owner", "a-other"))
        self.assertFalse(creator.owns_auction("owner", "a-own", "b-other"))
        self.assertTrue(creator.owns_auction("other", "a-other", "b-other"))
        self.assertFalse(creator.owns_auction("", "a-own"))

    def test_creator_items_include_live_auction(self):
        with mock.patch.object(creator, "_reload_items", side_effect=items.reload):
            result = creator.get_creator_items("owner")
        by_id = {item["id"]: item for item in result["items"]}
        self.assertEqual(by_id["own-auction"]["active_auction_id"], "a-own")
        self.assertNotIn("other-auction", by_id)

    def test_creator_auction_routes_enforce_ownership_and_maintenance(self):
        with mock.patch("threading.Thread.start"), mock.patch.dict("sys.modules", {"analytics": None}):
            routes = importlib.import_module("routes")
        routes.app.config["TESTING"] = True
        user = {"id": "owner", "roles": ["role"], "username": "Owner"}
        with (
            mock.patch.object(routes, "_require_login", return_value=(user, None)) as login,
            mock.patch.object(routes, "is_guild_member", return_value=True),
            mock.patch.object(routes, "resolve_uuid_for_user", return_value=("owner-uuid", "Owner")),
            mock.patch.object(routes, "is_shop_banned", return_value=False),
            mock.patch.object(routes, "_is_creator", return_value=True) as is_creator,
            mock.patch.object(routes, "_admin_maintenance_guard", return_value=None) as guard,
            mock.patch.object(routes, "_shop_get_admin_maintenance_settings", return_value={}),
            mock.patch.object(routes, "_shop_get_maintenance_settings", return_value={}),
            mock.patch.object(routes, "_admin_maintenance_settings_for_user",
                              return_value={"allow_item_edit": False}),
            mock.patch.object(routes, "_maintenance_settings_for_user", return_value={}),
            mock.patch.object(routes, "admin_auction_detail", return_value={"ok": True}) as detail,
            mock.patch.object(routes, "admin_remove_bid", return_value={"ok": True}) as remove,
            mock.patch.object(routes, "admin_cancel_auction", return_value={"ok": True}) as cancel,
            mock.patch.object(routes, "admin_extend_auction", return_value={"ok": True}) as extend,
            mock.patch.object(routes, "admin_start_auction", return_value={"ok": True}) as start,
        ):
            client = routes.app.test_client()
            settings = client.get("/api/shop/creator/my-items").get_json()
            self.assertFalse(settings["admin_maintenance_settings"]["allow_item_edit"])
            self.assertEqual(client.get("/api/shop/creator/auctions/a-own/detail").status_code, 200)
            self.assertEqual(client.get("/api/shop/creator/auctions/a-other/detail").status_code, 404)
            self.assertEqual(client.post("/api/shop/creator/auctions/a-own/bids/b-other/remove").status_code, 404)
            self.assertEqual(client.post("/api/shop/creator/auctions/a-other/close").status_code, 404)
            self.assertEqual(client.post("/api/shop/creator/auctions/a-other/extend", json={"hours": 1}).status_code, 404)
            self.assertEqual(client.post("/api/shop/creator/auctions/start", json={"item_id": "other-auction"}).status_code, 404)
            detail.assert_called_once()
            remove.assert_not_called()
            cancel.assert_not_called()
            extend.assert_not_called()
            start.assert_not_called()
            self.assertEqual(client.post("/api/shop/creator/auctions/a-own/extend", json={"hours": 1}).status_code, 200)
            self.assertEqual(client.post("/api/shop/creator/auctions/a-own/close").status_code, 200)
            self.assertEqual(client.post("/api/shop/creator/auctions/start", json={"item_id": "own-auction"}).status_code, 200)
            self.assertEqual(client.post("/api/shop/creator/auctions/a-own/bids/b-own/remove", json={"reason": "Test"}).status_code, 200)
            remove.assert_called_once_with("b-own", "Owner", "Test")
            guard.assert_called_with(user, maintenance_scope="items", maintenance_action="items_edit")
            guard.return_value = ({"error": "Maintenance"}, 403)
            self.assertEqual(client.post("/api/shop/creator/auctions/a-own/close").status_code, 403)
            guard.return_value = None
            is_creator.return_value = False
            self.assertEqual(client.get("/api/shop/creator/auctions/a-own/detail").status_code, 403)
            login.return_value = (None, ({"error": "Authentication required"}, 401))
            self.assertEqual(client.get("/api/shop/creator/auctions/a-own/detail").status_code, 401)


if __name__ == "__main__":
    unittest.main()
