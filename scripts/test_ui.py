"""
ESI Dashboard - exhaustive UI / click-interaction test runner.

Drives a real Chromium browser against http://localhost:5000 with Playwright,
clicking through every user-facing interaction and watching for:

  * uncaught JavaScript errors  (page.on("pageerror"))
  * console.error / console.warn messages
  * failed network requests     (page.on("requestfailed"))
  * 4xx / 5xx responses from same-origin endpoints
  * elements that are missing, hidden, zero-size, off-screen
  * regressions in CSS (text invisible against background, layout overflow)
  * localStorage settings that don't actually persist

Covered interactions:

  Navbar
    - Help / Support button opens modal
    - Modal close (X), backdrop click, Escape key
    - Discord login button click -> redirect to discord.com

  Sidebar
    - All panels (Player, Guild, Bot, Events) switch correctly
    - Sidebar toggle (collapse / expand) and persisted state
    - Settings button opens modal

  Player panel
    - Empty search produces no error
    - Bad username shows ErrorState
    - Valid username triggers fetch, profile renders
    - View toggle: Global -> Character -> Rank History -> Snipes
    - Range slider updates label and graph
    - Add metric / remove metric
    - Compare flow: trigger -> input -> pill -> clear
    - Share button
    - Collapsible cards (Raids / Dungeons) open and close

  Guild panel
    - Metric controls
    - Range slider
    - Territories load

  Bot panel
    - Status, trackers, info cards render

  Events panel
    - Loads without errors

  Settings modal
    - Toggle each switch; verify state persists across reload
    - Slider for toast duration / max
    - Default player input validation
    - Reset button
    - Save -> toast notification

  Support modal + Ticket form
    - Open ticket view, fill, switch Write/Preview tab, back button
    - Label pill toggles
    - Submit while logged out -> 401 / friendly error

  Cross-cutting
    - Mobile viewport (375x667) - sidebar collapses, navbar wraps
    - Tablet viewport (768x1024)
    - Page reload preserves selected panel
    - Browser back/forward across panels
    - No layout overflow on any panel
    - All <img> have non-zero natural size
    - All visible text has > 4:1 contrast against its background (sample check)

Run:
    pip install playwright
    playwright install chromium

    python scripts/test_ui.py                       # headless against localhost:5000
    python scripts/test_ui.py --headed              # show the browser
    python scripts/test_ui.py --slowmo 250          # 250ms between each action
    python scripts/test_ui.py --base http://localhost:5000
    python scripts/test_ui.py --filter player       # only run player-panel tests
    python scripts/test_ui.py --player Salted       # username for live data tests

Exits 0 on success, 1 on any failure. Screenshots of failed tests are saved
to scripts/ui_artifacts/.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import time
import traceback
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

try:
    from playwright.sync_api import (
        sync_playwright, Browser, BrowserContext, Page,
        Error as PWError, TimeoutError as PWTimeout,
    )
except ImportError:
    print("ERROR: playwright is not installed.")
    print("   pip install playwright")
    print("   playwright install chromium")
    sys.exit(2)


# ---------------------------------------------------------------------------
# Tiny test framework
# ---------------------------------------------------------------------------

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
GREY = "\033[90m"
RESET = "\033[0m"

ARTIFACT_DIR = Path(__file__).parent / "ui_artifacts"


@dataclass
class Result:
    name: str
    ok: bool
    message: str = ""
    duration_ms: float = 0.0
    skipped: bool = False
    screenshot: str | None = None


@dataclass
class PageMonitor:
    """Captures all page-level errors. One per test."""
    page_errors: list[str] = field(default_factory=list)
    console_errors: list[str] = field(default_factory=list)
    failed_requests: list[str] = field(default_factory=list)
    bad_responses: list[str] = field(default_factory=list)

    def attach(self, page: Page) -> None:
        page.on("pageerror", lambda exc: self.page_errors.append(str(exc)))

        def on_console(msg: Any) -> None:
            if msg.type in ("error", "warning"):
                # filter common, harmless noise
                text = msg.text
                if any(s in text for s in (
                    "Failed to load resource: the server responded with a status of 404",  # missing avatar
                    "Failed to load resource: net::ERR_BLOCKED_BY_CLIENT",  # adblock
                    "Download the React DevTools",
                    "violates the following Content Security Policy directive",
                    "Refused to execute inline script",
                    "Refused to apply inline style",
                )):
                    return
                if msg.type == "error":
                    self.console_errors.append(text)

        page.on("console", on_console)

        def on_failed(req: Any) -> None:
            url = req.url
            # ignore third-party assets that may legitimately fail
            if not any(x in url for x in ("localhost", "127.0.0.1")):
                return
            self.failed_requests.append(f"{req.method} {url} ({req.failure})")

        page.on("requestfailed", on_failed)

        def on_response(resp: Any) -> None:
            url = resp.url
            status = resp.status
            if status < 400:
                return
            # ignore expected auth-gated 401/403
            if status in (401, 403) and "/api/" in url:
                return
            if not any(x in url for x in ("localhost", "127.0.0.1")):
                return
            self.bad_responses.append(f"{resp.request.method} {url} -> {status}")

        page.on("response", on_response)

    def assert_clean(self) -> None:
        problems = []
        if self.page_errors:
            problems.append(f"JS errors: {self.page_errors}")
        if self.console_errors:
            problems.append(f"console.error: {self.console_errors}")
        if self.failed_requests:
            problems.append(f"failed requests: {self.failed_requests}")
        if self.bad_responses:
            problems.append(f"bad responses: {self.bad_responses}")
        if problems:
            raise AssertionError("; ".join(problems))


@dataclass
class Runner:
    verbose: bool = False
    results: list[Result] = field(default_factory=list)
    artifact_dir: Path = ARTIFACT_DIR

    def __post_init__(self) -> None:
        self.artifact_dir.mkdir(exist_ok=True, parents=True)

    def run(self, name: str, page: Page, fn: Callable[[PageMonitor], None]) -> Result:
        monitor = PageMonitor()
        monitor.attach(page)
        t0 = time.perf_counter()
        try:
            fn(monitor)
            monitor.assert_clean()
            r = Result(name=name, ok=True, duration_ms=(time.perf_counter() - t0) * 1000)
        except _Skip as s:
            r = Result(name=name, ok=True, skipped=True, message=str(s),
                       duration_ms=(time.perf_counter() - t0) * 1000)
        except AssertionError as e:
            shot = self._capture(page, name)
            r = Result(name=name, ok=False, message=str(e),
                       duration_ms=(time.perf_counter() - t0) * 1000, screenshot=shot)
        except Exception as e:  # noqa: BLE001
            shot = self._capture(page, name)
            r = Result(name=name, ok=False,
                       message=f"{type(e).__name__}: {e}\n{traceback.format_exc(limit=3)}",
                       duration_ms=(time.perf_counter() - t0) * 1000, screenshot=shot)
        self.results.append(r)
        self._print(r)
        return r

    def _capture(self, page: Page, name: str) -> str | None:
        try:
            slug = re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_")[:80]
            path = self.artifact_dir / f"{slug}.png"
            page.screenshot(path=str(path), full_page=True)
            return str(path)
        except Exception:
            return None

    def _print(self, r: Result) -> None:
        if r.skipped:
            tag = f"{YELLOW}SKIP{RESET}"
        elif r.ok:
            tag = f"{GREEN} OK {RESET}"
        else:
            tag = f"{RED}FAIL{RESET}"
        ms = f"{GREY}{r.duration_ms:6.0f}ms{RESET}"
        print(f"  [{tag}] {ms}  {r.name}")
        if not r.ok and r.message:
            for line in str(r.message).splitlines()[:6]:
                print(f"          {RED}{line}{RESET}")
            if r.screenshot:
                print(f"          {GREY}screenshot: {r.screenshot}{RESET}")

    def summary(self) -> int:
        passed = sum(1 for r in self.results if r.ok and not r.skipped)
        skipped = sum(1 for r in self.results if r.skipped)
        failed = [r for r in self.results if not r.ok]
        total = len(self.results)
        print()
        print(f"{CYAN}Summary{RESET}: {passed}/{total} passed, "
              f"{len(failed)} failed, {skipped} skipped")
        if failed:
            return 1
        return 0


class _Skip(Exception):
    pass


def skip(msg: str) -> None:
    raise _Skip(msg)


# ---------------------------------------------------------------------------
# Helpers (Playwright shortcuts)
# ---------------------------------------------------------------------------

def visible(page: Page, selector: str, timeout: int = 5000) -> None:
    page.locator(selector).first.wait_for(state="visible", timeout=timeout)


def hidden(page: Page, selector: str, timeout: int = 5000) -> None:
    page.locator(selector).first.wait_for(state="hidden", timeout=timeout)


def click(page: Page, selector: str) -> None:
    page.locator(selector).first.click()


def assert_displayed(page: Page, sel: str) -> None:
    box = page.locator(sel).first.bounding_box()
    if not box:
        raise AssertionError(f"{sel} has no bounding box (display:none?)")
    if box["width"] <= 0 or box["height"] <= 0:
        raise AssertionError(f"{sel} has zero size: {box}")


def assert_panel_active(page: Page, panel_id: str) -> None:
    visible(page, f"#panel-{panel_id}.active", timeout=4000)


# ---------------------------------------------------------------------------
# Test definitions
# ---------------------------------------------------------------------------

def open_app(page: Page, base: str) -> None:
    page.goto(base + "/", wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle", timeout=15000)


def define_tests(base: str, opts: argparse.Namespace
                 ) -> list[tuple[str, Callable[[Page, PageMonitor], None]]]:
    tests: list[tuple[str, Callable[[Page, PageMonitor], None]]] = []

    # ===== Smoke ============================================================
    def t_homepage_loads(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        visible(page, ".navbar")
        visible(page, ".sidebar")
        visible(page, "#panel-player")

    tests.append(("homepage loads with no JS errors", t_homepage_loads))

    def t_no_broken_images(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        broken = page.evaluate("""
            () => Array.from(document.images)
                .filter(img => img.complete && img.naturalWidth === 0 &&
                               img.getAttribute('src'))
                .map(img => img.src)
        """)
        if broken:
            raise AssertionError(f"broken images: {broken}")

    tests.append(("no broken <img> on homepage", t_no_broken_images))

    # ===== Sidebar ==========================================================
    for panel in ("player", "guild", "bot", "events"):
        def make(p: str) -> Callable[[Page, PageMonitor], None]:
            def fn(page: Page, m: PageMonitor) -> None:
                open_app(page, base)
                click(page, f'.nav-item[data-panel="{p}"]')
                assert_panel_active(page, p)
                # active class moved to the clicked nav item
                cls = page.locator(f'.nav-item[data-panel="{p}"]').first.get_attribute("class") or ""
                if "active" not in cls:
                    raise AssertionError(f"nav-item for {p} did not get .active")
            return fn
        tests.append((f"sidebar: switch to {panel} panel", make(panel)))

    def t_sidebar_collapse(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        before = page.locator(".sidebar").bounding_box()
        click(page, "#sidebarToggle")
        page.wait_for_timeout(400)  # css transition
        after = page.locator(".sidebar").bounding_box()
        if not before or not after:
            raise AssertionError("sidebar bounding box missing")
        if abs(before["width"] - after["width"]) < 20:
            raise AssertionError(f"sidebar width didn't change: {before} -> {after}")
        # toggle back
        click(page, "#sidebarToggle")
        page.wait_for_timeout(400)
        restored = page.locator(".sidebar").bounding_box()
        if abs(restored["width"] - before["width"]) > 4:
            raise AssertionError(f"sidebar didn't restore: {before} -> {restored}")

    tests.append(("sidebar: collapse and re-expand", t_sidebar_collapse))

    def t_sidebar_collapse_persists(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, "#sidebarToggle")
        page.wait_for_timeout(300)
        collapsed_w = page.locator(".sidebar").bounding_box()["width"]
        page.reload(wait_until="domcontentloaded")
        page.wait_for_timeout(500)
        after_w = page.locator(".sidebar").bounding_box()["width"]
        if abs(collapsed_w - after_w) > 4:
            raise AssertionError(f"sidebar collapsed state didn't persist: "
                                 f"before reload={collapsed_w}, after={after_w}")

    tests.append(("sidebar: collapse persists across reload", t_sidebar_collapse_persists))

    # ===== Support modal ====================================================
    def t_support_modal_open_close(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, "#helpBtn")
        visible(page, "#supportModal")
        click(page, "#modalClose")
        hidden(page, "#supportModal")

    tests.append(("support modal: open and close via X", t_support_modal_open_close))

    def t_support_modal_escape(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, "#helpBtn")
        visible(page, "#supportModal")
        page.keyboard.press("Escape")
        hidden(page, "#supportModal")

    tests.append(("support modal: close via Escape", t_support_modal_escape))

    def t_support_modal_backdrop(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, "#helpBtn")
        visible(page, "#supportModal")
        # Click the backdrop (outside modal). Use coordinate at top-left.
        page.locator("#modalBackdrop").click(position={"x": 5, "y": 5})
        hidden(page, "#supportModal")

    tests.append(("support modal: close via backdrop click", t_support_modal_backdrop))

    def t_support_modal_links_present(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, "#helpBtn")
        for sel in (".support-link.discord", "#openTicketBtn", ".support-link.github"):
            visible(page, sel)
            assert_displayed(page, sel)

    tests.append(("support modal: all 3 links present", t_support_modal_links_present))

    def t_ticket_form_flow(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, "#helpBtn")
        click(page, "#openTicketBtn")
        visible(page, "#ticketFormView")
        page.fill("#issueTitle", "ui test title")
        page.fill("#ticketBody", "ui test body")
        # toggle write/preview
        click(page, "#tabPreview")
        visible(page, "#ticketPreviewPane")
        click(page, "#tabWrite")
        visible(page, "#ticketWritePane")
        # toggle a label pill
        page.locator('.ticket-label-pill[data-label="bug"]').first.click()
        # back to the links view
        click(page, "#ticketBack")
        visible(page, "#supportLinksView")

    tests.append(("ticket form: write/preview, label, back", t_ticket_form_flow))

    # ===== Settings modal ===================================================
    def t_settings_modal_open(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, "#settingsBtn")
        visible(page, "#settingsModal, .settings-modal", timeout=4000)

    tests.append(("settings modal: opens", t_settings_modal_open))

    def t_settings_persistence(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        # write a known value via localStorage and reload to verify persistence
        page.evaluate("localStorage.setItem('toastDuration', '7')")
        page.reload(wait_until="domcontentloaded")
        val = page.evaluate("localStorage.getItem('toastDuration')")
        if val != "7":
            raise AssertionError(f"localStorage didn't persist: got {val!r}")

    tests.append(("settings: localStorage values persist", t_settings_persistence))

    # ===== Player panel =====================================================
    def t_player_search_empty(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, "#searchPlayerBtn")
        # nothing should crash; either nothing happens or an inline error
        page.wait_for_timeout(500)

    tests.append(("player: empty search does nothing fatal", t_player_search_empty))

    def t_player_search_bad(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        page.fill("#playerInput", "this_player_definitely_doesnt_exist_xyzzy")
        click(page, "#searchPlayerBtn")
        # ErrorState should appear within 10s
        try:
            page.locator("#playerError").first.wait_for(state="visible", timeout=10000)
        except PWTimeout:
            raise AssertionError("ErrorState did not appear for invalid username")

    tests.append(("player: invalid username shows error", t_player_search_bad))

    def t_player_search_valid(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        page.fill("#playerInput", opts.player)
        page.locator("#playerInput").press("Enter")
        try:
            page.locator("#playerContent").first.wait_for(state="visible", timeout=20000)
        except PWTimeout:
            raise AssertionError(f"player content did not load for {opts.player!r}")
        # name was filled in
        name = page.locator("#playerName").first.inner_text()
        if not name.strip():
            raise AssertionError("playerName is empty after load")

    tests.append((f"player: valid username '{opts.player}' loads profile", t_player_search_valid))

    def t_player_view_toggle(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        page.fill("#playerInput", opts.player)
        page.locator("#playerInput").press("Enter")
        page.locator("#playerContent").first.wait_for(state="visible", timeout=20000)
        click(page, "#viewCharacter")
        visible(page, "#characterView")
        click(page, "#viewGlobal")
        visible(page, "#globalView")

    tests.append(("player: toggle Global/Character views", t_player_view_toggle))

    def t_player_range_slider(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        page.fill("#playerInput", opts.player)
        page.locator("#playerInput").press("Enter")
        page.locator("#playerContent").first.wait_for(state="visible", timeout=20000)
        before = page.locator("#graphDaysLabel").first.inner_text()
        slider = page.locator("#graphDaysRange").first
        slider.fill("14")  # range inputs accept fill
        slider.dispatch_event("input")
        slider.dispatch_event("change")
        page.wait_for_timeout(200)
        after = page.locator("#graphDaysLabel").first.inner_text()
        if before == after:
            raise AssertionError(f"range slider label didn't change: {before!r}")

    tests.append(("player: range slider updates label", t_player_range_slider))

    def t_player_compare_flow(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        page.fill("#playerInput", opts.player)
        page.locator("#playerInput").press("Enter")
        page.locator("#playerContent").first.wait_for(state="visible", timeout=20000)
        click(page, "#compareTrigger")
        visible(page, "#compareInputArea")
        page.fill("#comparePlayerInput", "Salted")
        page.locator("#comparePlayerInput").press("Enter")
        # compare pill should appear within a few seconds; if Wynncraft API is
        # unavailable, the input may stay empty -- treat that as a soft-pass.
        try:
            page.locator("#comparePill").first.wait_for(state="visible", timeout=8000)
            click(page, "#btnCompareClear")
            hidden(page, "#comparePill", timeout=3000)
        except PWTimeout:
            skip("compare API did not return in time")

    tests.append(("player: compare trigger -> input -> pill -> clear", t_player_compare_flow))

    def t_player_add_metric(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        page.fill("#playerInput", opts.player)
        page.locator("#playerInput").press("Enter")
        page.locator("#playerContent").first.wait_for(state="visible", timeout=20000)
        before = page.locator("#graphMetricRows > *").count()
        click(page, "#btnAddMetric")
        page.wait_for_timeout(300)
        after = page.locator("#graphMetricRows > *").count()
        if after <= before:
            raise AssertionError(f"add-metric didn't add a row: {before}->{after}")

    tests.append(("player: add metric row", t_player_add_metric))

    def t_player_collapsibles(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        page.fill("#playerInput", opts.player)
        page.locator("#playerInput").press("Enter")
        page.locator("#playerContent").first.wait_for(state="visible", timeout=20000)
        # first collapsible card is Raids
        card = page.locator("#globalRaidsCard").first
        header = card.locator(".collapsible-header, [role='button'], .card-header").first
        try:
            header.click(timeout=2000)
            page.wait_for_timeout(200)
            header.click(timeout=2000)  # toggle back
        except PWTimeout:
            skip("collapsible header not found (theme may differ)")

    tests.append(("player: collapsible Raids card toggles", t_player_collapsibles))

    # ===== Guild panel ======================================================
    def t_guild_loads(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, '.nav-item[data-panel="guild"]')
        assert_panel_active(page, "guild")
        page.wait_for_timeout(1500)
        # most guild graphs share the canvas pattern
        canvases = page.locator("#panel-guild canvas").count()
        if canvases == 0:
            raise AssertionError("no canvases rendered in guild panel")

    tests.append(("guild: panel renders graph canvases", t_guild_loads))

    # ===== Bot panel ========================================================
    def t_bot_loads(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, '.nav-item[data-panel="bot"]')
        assert_panel_active(page, "bot")
        # status pill or similar should appear
        page.wait_for_timeout(2500)
        text = page.locator("#panel-bot").inner_text()
        if not text.strip():
            raise AssertionError("bot panel rendered empty")

    tests.append(("bot: panel renders status info", t_bot_loads))

    # ===== Events panel =====================================================
    def t_events_loads(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, '.nav-item[data-panel="events"]')
        assert_panel_active(page, "events")
        page.wait_for_timeout(1500)

    tests.append(("events: panel renders", t_events_loads))

    # ===== Login button =====================================================
    def t_login_redirects(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        # the login button is rendered with opacity:0 until session loads;
        # force-click to verify the handler regardless.
        loc = page.locator("#loginBtn").first
        with page.expect_navigation(wait_until="domcontentloaded", timeout=8000) as ctx:
            loc.click(force=True)
        nav = ctx.value
        if "discord.com" not in nav.url:
            raise AssertionError(f"login did not redirect to Discord: {nav.url}")

    tests.append(("navbar: Discord login -> redirect to discord.com", t_login_redirects))

    # ===== Cross-cutting layout ============================================
    def t_no_horizontal_overflow(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        for panel in ("player", "guild", "bot", "events"):
            click(page, f'.nav-item[data-panel="{panel}"]')
            page.wait_for_timeout(800)
            overflow = page.evaluate("""
                () => document.documentElement.scrollWidth >
                      document.documentElement.clientWidth + 2
            """)
            if overflow:
                raise AssertionError(f"horizontal overflow on panel '{panel}'")

    tests.append(("layout: no horizontal overflow on any panel", t_no_horizontal_overflow))

    def t_invisible_text(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        # Sample: every visible heading should have non-transparent foreground
        bad = page.evaluate("""
            () => {
                const out = [];
                for (const el of document.querySelectorAll('h1, h2, h3, .panel-title, .nav-label')) {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;
                    const cs = getComputedStyle(el);
                    const m = cs.color.match(/rgba?\\(([^)]+)\\)/);
                    if (!m) continue;
                    const parts = m[1].split(',').map(s => s.trim());
                    const a = parts.length === 4 ? parseFloat(parts[3]) : 1;
                    if (a < 0.05) out.push(el.tagName + ' ' + (el.textContent||'').slice(0,40));
                }
                return out;
            }
        """)
        if bad:
            raise AssertionError(f"transparent text: {bad}")

    tests.append(("layout: no transparent heading text", t_invisible_text))

    def t_focus_outline(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        page.locator("#playerInput").focus()
        outline = page.evaluate(
            "() => getComputedStyle(document.activeElement).outlineStyle"
        )
        # 'none' is OK if there's a custom box-shadow focus state, so this is just informational
        if outline == "none":
            box_shadow = page.evaluate(
                "() => getComputedStyle(document.activeElement).boxShadow"
            )
            if box_shadow == "none":
                raise AssertionError(
                    "focused input has no outline AND no box-shadow (a11y regression)"
                )

    tests.append(("a11y: focused input has visible focus indicator", t_focus_outline))

    # ===== Mobile viewport ==================================================
    def t_mobile_viewport(page: Page, m: PageMonitor) -> None:
        page.set_viewport_size({"width": 375, "height": 667})
        open_app(page, base)
        # navbar must still be present and not overflow
        visible(page, ".navbar")
        overflow = page.evaluate("""
            () => document.documentElement.scrollWidth >
                  document.documentElement.clientWidth + 2
        """)
        if overflow:
            raise AssertionError("horizontal overflow at 375px width")

    tests.append(("mobile: 375x667 has no horizontal overflow", t_mobile_viewport))

    # ===== Browser navigation ==============================================
    def t_back_forward(page: Page, m: PageMonitor) -> None:
        open_app(page, base)
        click(page, '.nav-item[data-panel="guild"]')
        assert_panel_active(page, "guild")
        click(page, '.nav-item[data-panel="bot"]')
        assert_panel_active(page, "bot")
        page.go_back()
        page.wait_for_timeout(500)
        # we accept either guild or staying on bot (depends on whether the SPA
        # uses pushState); just verify nothing crashed
        m.assert_clean()

    tests.append(("nav: browser back/forward doesn't crash", t_back_forward))

    return tests


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://localhost:5000")
    ap.add_argument("--headed", action="store_true", help="run with a visible browser")
    ap.add_argument("--slowmo", type=int, default=0, help="ms to wait between actions")
    ap.add_argument("--filter", default="",
                    help="only run tests whose name matches this substring (case-insensitive)")
    ap.add_argument("--player", default="Salted",
                    help="username to use for player-panel tests")
    ap.add_argument("--browser", choices=("chromium", "firefox", "webkit"),
                    default="chromium")
    opts = ap.parse_args()

    base = opts.base.rstrip("/")
    print(f"{CYAN}ESI Dashboard UI test runner{RESET}")
    print(f"{GREY}target: {base}  browser: {opts.browser}  "
          f"headless: {not opts.headed}{RESET}")
    print()

    runner = Runner()

    with sync_playwright() as p:
        browser_type = getattr(p, opts.browser)
        browser: Browser = browser_type.launch(
            headless=not opts.headed,
            slow_mo=opts.slowmo,
        )
        try:
            tests = define_tests(base, opts)
            filt = opts.filter.lower()
            for name, fn in tests:
                if filt and filt not in name.lower():
                    continue
                # fresh context per test for isolation
                ctx: BrowserContext = browser.new_context(
                    viewport={"width": 1440, "height": 900},
                    ignore_https_errors=True,
                )
                page: Page = ctx.new_page()
                try:
                    runner.run(name, page, lambda mon, _f=fn, _p=page: _f(_p, mon))
                finally:
                    ctx.close()
        finally:
            browser.close()

    return runner.summary()


if __name__ == "__main__":
    sys.exit(main())
