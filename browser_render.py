"""
browser_render.py - One shared headless Chromium per process.

og_cards and dm_cards both render HTML to PNG. They used to start their own
Playwright sync instance, and Playwright refuses to run two sync instances in
the same thread, so whichever one initialised second failed with "Sync API
inside the asyncio loop". Launching per render also spawned a whole browser
tree for every card and left orphaned Chromium and driver processes behind,
which is what exhausted the server.

Everything now goes through one browser, one page at a time, and a failed
render drops the browser so the next call starts a fresh one.
"""

import sys
import threading

PAGE_TIMEOUT_MS = 15000

_lock = threading.Lock()
_pw_instance = None
_pw_browser = None


def _teardown_locked() -> None:
    """Drop the shared browser and stop its Playwright driver process."""
    global _pw_instance, _pw_browser
    browser, instance = _pw_browser, _pw_instance
    _pw_browser = None
    _pw_instance = None
    if browser is not None:
        try:
            browser.close()
        except Exception:
            pass
    if instance is not None:
        try:
            instance.stop()
        except Exception:
            pass


def teardown() -> None:
    """Close the shared browser, if one is running."""
    with _lock:
        _teardown_locked()


def _browser_locked():
    """Return the shared browser, launching it on first use."""
    global _pw_instance, _pw_browser
    if _pw_browser is not None and _pw_browser.is_connected():
        return _pw_browser
    _teardown_locked()
    from playwright.sync_api import sync_playwright  # noqa: lazy
    _pw_instance = sync_playwright().start()
    try:
        _pw_browser = _pw_instance.chromium.launch(headless=True)
    except Exception:
        _teardown_locked()
        raise
    return _pw_browser


def screenshot_html(
    html: str,
    *,
    width: int,
    height: int,
    selector: str,
    omit_background: bool = False,
    wait_expression: str | None = None,
) -> bytes | None:
    """Screenshot the first element matching *selector*. None on any failure."""
    try:
        with _lock:
            browser = _browser_locked()
            page = browser.new_page(viewport={"width": width, "height": height})
            try:
                page.set_default_timeout(PAGE_TIMEOUT_MS)
                page.set_content(html, wait_until="load")
                if wait_expression:
                    try:
                        page.evaluate(wait_expression)
                    except Exception:
                        pass
                element = page.query_selector(selector)
                if element is None:
                    return None
                return element.screenshot(type="png", omit_background=omit_background)
            finally:
                try:
                    page.close()
                except Exception:
                    pass
    except Exception as exc:
        print(f"[RENDER] Failed: {exc}", file=sys.stderr)
        teardown()
        return None
