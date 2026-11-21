import json
import unittest
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

try:
    from playwright.sync_api import Error as PlaywrightError
    from playwright.sync_api import sync_playwright
except ImportError:
    sync_playwright = None


ROOT = Path(__file__).resolve().parent.parent


@unittest.skipUnless(sync_playwright, "Playwright is not installed")
class CreatorShopBrowserTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.playwright = sync_playwright().start()
        if not Path(cls.playwright.chromium.executable_path).is_file():
            cls.playwright.stop()
            raise unittest.SkipTest("Playwright Chromium is not installed")
        try:
            cls.browser = cls.playwright.chromium.launch()
        except PlaywrightError as exc:
            cls.playwright.stop()
            raise unittest.SkipTest(f"Playwright Chromium cannot start: {exc}") from exc

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()

    def setUp(self):
        now = datetime.now(UTC)
        self.end = (now + timedelta(hours=12)).isoformat()
        self.start = (now - timedelta(hours=1)).isoformat()
        self.calls = []
        self.admin_settings = {}
        self.shop_enabled = True
        self.cart = [{"item_id": "normal-bin", "quantity": 1}]
        self.bids = [{"bid_id": "b1", "username": "Bidder", "amount": 15,
                      "placed_at": self.start, "is_winning": True}]
        self.creator_items = [
            {"id": "live", "name": "Live auction", "type": "auction", "active": True,
             "active_auction_id": "a1"},
            {"id": "new", "name": "New auction", "type": "auction", "active": True},
        ]
        self.bin_items = [
            {"id": "own-bin", "name": "Own item", "type": "bin", "price": 10,
             "active": True, "is_own_item": True, "visibility_blocked": True},
            {"id": "normal-bin", "name": "Other item", "type": "bin", "price": 10,
             "active": True},
        ]
        self.auctions = [
            {"auction_id": "a1", "item_id": "live", "item_name": "Own auction",
             "status": "active", "active": True, "is_own_item": True,
             "visibility_blocked": True, "ends_at": self.end, "starting_bid": 1,
             "min_increment": 1, "current_highest_bid": 15},
            {"auction_id": "a2", "item_id": "restricted", "item_name": "Restricted auction",
             "status": "active", "active": True, "visibility_blocked": True,
             "ends_at": self.end, "starting_bid": 1, "min_increment": 1,
             "current_highest_bid": 15},
        ]
        self.page = self.browser.new_page(viewport={"width": 1200, "height": 850})
        self.addCleanup(self.page.close)
        self.errors = []
        self.page.on("pageerror", lambda error: self.errors.append(str(error)))
        self.page.route("**/*", self._route)
        self.page.goto("http://shop.test/")
        for css in ("shop.css", "shop-admin.css", "creator-studio.css"):
            self.page.add_style_tag(path=ROOT / "css" / css)
        self.page.add_script_tag(content="""
            window.state = {loggedIn: true};
            window.isGuildMember = function () { return true; };
            window.isShopBanned = function () { return false; };
            window.hasCreatorAccess = function () { return true; };
            window.hasShopAdmin = function () { return true; };
            window.hasParliamentPlus = function () { return true; };
            window.showToast = function () {};
        """)
        for script in ("shop.js", "shop-admin.js", "creator-studio.js"):
            self.page.add_script_tag(path=ROOT / "js" / script)

    def _route(self, route):
        request = route.request
        path = urlparse(request.url).path
        self.calls.append((request.method, path))
        if path == "/":
            route.fulfill(content_type="text/html", body=(
                "<html><body><section id='panel-shop'></section>"
                "<section id='panel-shop-admin'></section>"
                "<section id='panel-creator-studio'></section></body></html>"
            ))
            return
        access = {"logged_in": True, "is_guild_member": True, "can_interact": True}
        balance = {"spendable_clean": 100, "spendable_dirty": 0, "total_ep": 100}
        if path == "/api/shop/creator/my-items":
            data = {"items": self.creator_items, "requests": [],
                    "admin_maintenance_settings": self.admin_settings}
        elif path in ("/api/shop/creator/auctions/a1/detail", "/api/admin/shop/auctions/a1/detail"):
            data = {"ok": True, "auction_id": "a1", "item_id": "live",
                    "status": "active", "created_at": self.start, "ends_at": self.end,
                    "current_highest_bid": 15, "bid_count": len(self.bids),
                    "bidder_count": len(self.bids), "recent_bids": self.bids}
        elif path == "/api/shop/creator/auctions/a1/bids/b1/remove":
            self.bids = []
            data = {"ok": True}
        elif path == "/api/shop/creator/auctions/a1/extend":
            data = {"ok": True, "new_ends_at": self.end, "new_extended_hours": 1}
        elif path == "/api/shop/creator/auctions/a1/close":
            self.creator_items[0].pop("active_auction_id", None)
            data = {"ok": True}
        elif path == "/api/shop/creator/auctions/start":
            self.creator_items[1]["active_auction_id"] = "a2"
            data = {"ok": True}
        elif path == "/api/admin/shop/state":
            data = {"shop_enabled": True, "is_parliament": True}
        elif path == "/api/admin/shop/items":
            data = [{"id": "live", "name": "Live auction", "type": "auction", "active": True}]
        elif path == "/api/admin/shop/bids/b1/remove":
            self.bids = []
            data = {"ok": True}
        elif path == "/api/admin/shop/auctions/a1/extend":
            data = {"ok": True, "new_ends_at": self.end, "new_extended_hours": 1}
        elif path == "/api/shop/state":
            data = {**access, "shop_enabled": self.shop_enabled,
                    "maintenance_settings": {"shop_visible": True, "show_items": True}}
        elif path == "/api/shop/bin":
            data = {**access, "shop_enabled": self.shop_enabled, "items": self.bin_items,
                    "item_order": ["own-bin", "normal-bin", "live", "restricted"],
                    "balance": balance}
        elif path == "/api/shop/auctions":
            data = {**access, "shop_enabled": self.shop_enabled, "auctions": self.auctions,
                    "uuid": "viewer", "balance": balance}
        elif path == "/api/shop/cart":
            if request.method == "PUT":
                self.cart = request.post_data_json["items"]
            data = {"ok": True, "items": self.cart}
        else:
            data = {"ok": True}
        route.fulfill(content_type="application/json", body=json.dumps(data))

    def test_creator_can_manage_and_start_auctions(self):
        page = self.page
        page.locator("#panel-shop-admin").evaluate("""el => {
            el.innerHTML = '<div style="display:none"><input id="amHoursInput">' +
                '<button id="amInc"></button><button id="amApply"></button>' +
                '<button id="amCancel"></button><button id="saOverlayClose"></button>' +
                '<textarea id="amRemoveReason"></textarea><button id="amRemoveConfirm"></button></div>';
        }""")
        page.locator("#panel-creator-studio").evaluate("(el) => el.classList.add('active')")
        page.locator("[data-cs-manage-auction='a1']").click()
        page.get_by_text("Bidder", exact=True).wait_for()
        page.locator("[data-remove-bid='b1']").click()
        page.locator("#csOverlay #amRemoveReason").fill("Test reason")
        page.locator("#csOverlay #amRemoveConfirm").click()
        page.get_by_text("No bids yet.", exact=True).wait_for()
        page.locator("#csModal #amInc").click()
        page.locator("#csModal #amApply").click()
        page.wait_for_function("document.querySelector('#csModal #amHoursInput').value === '1'")
        page.locator("#csModal #amCancel").click()
        page.locator("#csModal #amCancelConfirm").click()
        page.locator("[data-cs-start-auction='live']").wait_for()
        page.locator("[data-cs-start-auction='new']").click()
        page.locator("#csStartConfirm").click()
        page.locator("[data-cs-manage-auction='a2']").wait_for()
        self.assertIn(("POST", "/api/shop/creator/auctions/a1/bids/b1/remove"), self.calls)
        self.assertIn(("POST", "/api/shop/creator/auctions/a1/extend"), self.calls)
        self.assertIn(("POST", "/api/shop/creator/auctions/a1/close"), self.calls)
        self.assertIn(("POST", "/api/shop/creator/auctions/start"), self.calls)
        self.assertEqual(self.errors, [])

    def test_manager_auction_controls_keep_using_manager_endpoints(self):
        page = self.page
        page.locator("#panel-shop-admin").evaluate("(el) => el.classList.add('active')")
        page.locator("[data-manage-auction='a1']").click()
        page.locator("#saModal [data-remove-bid='b1']").click()
        page.locator("#saOverlay #amRemoveConfirm").click()
        page.get_by_text("No bids yet.", exact=True).wait_for()
        page.locator("#saModal #amInc").click()
        page.locator("#saModal #amApply").click()
        page.wait_for_function("document.querySelector('#saModal #amHoursInput').value === '1'")
        self.assertIn(("POST", "/api/admin/shop/bids/b1/remove"), self.calls)
        self.assertIn(("POST", "/api/admin/shop/auctions/a1/extend"), self.calls)
        self.assertEqual(self.errors, [])

    def test_read_only_modal_and_mobile_layout(self):
        page = self.page
        self.admin_settings = {"allow_item_edit": False}
        page.set_viewport_size({"width": 390, "height": 844})
        page.locator("#panel-creator-studio").evaluate("(el) => el.classList.add('active')")
        manage = page.locator("[data-cs-manage-auction='a1']")
        manage.wait_for()
        bounds = manage.bounding_box()
        self.assertGreaterEqual(bounds["x"], 0)
        self.assertLessEqual(bounds["x"] + bounds["width"], 390)
        self.assertEqual(page.locator("[data-cs-start-auction]").count(), 0)
        manage.click()
        page.get_by_text("Bidder", exact=True).wait_for()
        self.assertEqual(page.locator("#amCancel, #amInc, [data-remove-bid]").count(), 0)
        self.assertEqual(self.errors, [])

    def test_own_and_restricted_items_and_existing_cart(self):
        page = self.page
        page.locator("#panel-shop").evaluate("(el) => el.classList.add('active')")
        page.locator(".shop-card[data-item-id='own-bin']").click()
        self.assertTrue(page.locator("#shopDetailAdd").is_disabled())
        self.assertEqual(page.locator("#shopDetailAdd").inner_text(), "Your Item")
        page.locator("#shopModal .modal-close").click()
        page.locator(".shop-card[data-auction-id='a1']").click()
        self.assertEqual(page.locator("#shopModal button:disabled").inner_text(), "Your Item")
        page.locator("#shopModal .modal-close").click()
        page.locator(".shop-card[data-auction-id='a2']").click()
        self.assertEqual(page.locator("#shopModal button:disabled").inner_text(), "Restricted")
        page.locator("#shopModal .modal-close").click()
        page.wait_for_function("document.querySelector('#shopCartBadge').textContent === '1'")
        page.locator("#shopCartBtn").click()
        self.assertIn("Other item", page.locator("#shopModal").inner_text())
        self.bin_items[1]["is_own_item"] = True
        page.evaluate("window.dispatchEvent(new CustomEvent('shop:items-updated'))")
        page.get_by_text("Your cart is empty.", exact=True).wait_for()
        page.wait_for_function("document.querySelector('#shopCartBadge').textContent === '0'")
        page.wait_for_timeout(1800)
        self.assertEqual(self.cart, [], self.calls)
        self.assertEqual(self.errors, [])

    def test_owned_saved_items_are_removed_without_writing_during_maintenance(self):
        self.shop_enabled = False
        self.cart = [{"item_id": "own-bin", "quantity": 1}]
        page = self.page
        page.locator("#panel-shop").evaluate("(el) => el.classList.add('active')")
        page.locator(".shop-card[data-item-id='own-bin']").wait_for()
        page.wait_for_timeout(900)
        self.assertEqual(page.locator("#shopCartBadge").inner_text(), "0")
        self.assertNotIn(("PUT", "/api/shop/cart"), self.calls)
        self.assertEqual(self.errors, [])


if __name__ == "__main__":
    unittest.main()
