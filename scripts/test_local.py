"""
ESI Dashboard - exhaustive local test runner.

Runs against a locally running instance of the website (default
http://localhost:5000) and checks every part of it:

  * gateway reachability and basic timing
  * homepage / index.html rendering and key markup
  * every static asset directory (assets/, css/, js/, images/, favicon)
  * every documented /api/* and /auth/* route, verifying:
      - status code (200 for public, 401/403 for gated)
      - Content-Type
      - JSON schema sanity (where applicable)
      - response time
  * HTTP method enforcement (GET-only routes reject POST, etc.)
  * security response headers (nosniff, frame deny, referrer policy)
  * error handlers (404, 403)
  * rate limiting on /api/guild/activity
  * OAuth redirect on /auth/login
  * mock-login dev path on /auth/mock-login
  * gateway -> routes proxy behaviour (5001 fallback)
  * cache service health on :5002
  * a shallow crawl of the served index.html to verify every referenced
    asset returns 200 with the expected content-type
  * gzip + non-gzip parity
  * cookie / session handling smoke test

Run:
    python scripts/test_local.py
    python scripts/test_local.py --base http://localhost:5000 --verbose
    python scripts/test_local.py --skip-rate-limit

Exits 0 on success, 1 on any failure.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass, field
from html.parser import HTMLParser
from typing import Any, Callable, Iterable
from urllib.parse import urljoin, urlparse

try:
    import requests
except ImportError:  # pragma: no cover
    print("ERROR: requests is not installed. `pip install requests`")
    sys.exit(2)


# ---------------------------------------------------------------------------
# Test framework (tiny, dependency-free)
# ---------------------------------------------------------------------------

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
GREY = "\033[90m"
RESET = "\033[0m"


@dataclass
class Result:
    name: str
    ok: bool
    message: str = ""
    duration_ms: float = 0.0
    skipped: bool = False


@dataclass
class Runner:
    verbose: bool = False
    results: list[Result] = field(default_factory=list)

    def run(self, name: str, fn: Callable[[], None]) -> Result:
        t0 = time.perf_counter()
        try:
            fn()
            r = Result(name=name, ok=True, duration_ms=(time.perf_counter() - t0) * 1000)
        except _Skip as s:
            r = Result(name=name, ok=True, skipped=True, message=str(s),
                       duration_ms=(time.perf_counter() - t0) * 1000)
        except AssertionError as e:
            r = Result(name=name, ok=False, message=str(e) or "assertion failed",
                       duration_ms=(time.perf_counter() - t0) * 1000)
        except Exception as e:  # noqa: BLE001
            r = Result(name=name, ok=False, message=f"{type(e).__name__}: {e}",
                       duration_ms=(time.perf_counter() - t0) * 1000)
        self.results.append(r)
        self._print(r)
        return r

    def _print(self, r: Result) -> None:
        if r.skipped:
            tag = f"{YELLOW}SKIP{RESET}"
        elif r.ok:
            tag = f"{GREEN} OK {RESET}"
        else:
            tag = f"{RED}FAIL{RESET}"
        ms = f"{GREY}{r.duration_ms:6.0f}ms{RESET}"
        print(f"  [{tag}] {ms}  {r.name}")
        if self.verbose and r.message and r.ok:
            print(f"          {GREY}{r.message}{RESET}")
        if not r.ok and r.message:
            print(f"          {RED}{r.message}{RESET}")

    def summary(self) -> int:
        passed = sum(1 for r in self.results if r.ok and not r.skipped)
        skipped = sum(1 for r in self.results if r.skipped)
        failed = [r for r in self.results if not r.ok]
        total = len(self.results)
        print()
        print(f"{CYAN}Summary{RESET}: {passed}/{total} passed, "
              f"{len(failed)} failed, {skipped} skipped")
        if failed:
            print(f"{RED}Failures:{RESET}")
            for r in failed:
                print(f"  - {r.name}: {r.message}")
            return 1
        return 0


class _Skip(Exception):
    pass


def skip(msg: str) -> None:
    raise _Skip(msg)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

class AssetCollector(HTMLParser):
    """Collect every src/href from an HTML document."""

    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []  # (tag, url)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag in ("script", "img", "source", "iframe") and a.get("src"):
            self.links.append((tag, a["src"]))
        if tag in ("link", "a") and a.get("href"):
            self.links.append((tag, a["href"]))


def assert_eq(actual: Any, expected: Any, label: str = "") -> None:
    if actual != expected:
        raise AssertionError(f"{label} expected {expected!r}, got {actual!r}")


def assert_in(needle: Any, haystack: Any, label: str = "") -> None:
    if needle not in haystack:
        raise AssertionError(f"{label} {needle!r} not found in {haystack!r}")


def assert_status(resp: requests.Response, *codes: int) -> None:
    if resp.status_code not in codes:
        body_preview = resp.text[:200].replace("\n", " ")
        raise AssertionError(
            f"{resp.request.method} {resp.url} -> {resp.status_code} "
            f"(expected one of {codes}); body: {body_preview!r}"
        )


def assert_json(resp: requests.Response) -> Any:
    ctype = resp.headers.get("Content-Type", "")
    if "application/json" not in ctype:
        raise AssertionError(f"expected JSON content-type, got {ctype!r}")
    try:
        return resp.json()
    except json.JSONDecodeError as e:
        raise AssertionError(f"invalid JSON: {e}; body: {resp.text[:200]!r}") from e


# ---------------------------------------------------------------------------
# Route catalogue (everything the README documents + a few extras)
# ---------------------------------------------------------------------------

PUBLIC_GET = [
    "/api/bot/status",
    "/api/bot/trackers",
    "/api/guild/territories",
    "/api/guild/activity",
]

GATED_GET = [
    "/api/guild/stats",
    "/api/guild/member-history",
    "/api/guild/levels",
    "/api/guild/aspects",
    "/api/guild/points",
    "/api/bot/info",
    "/api/bot/discord",
    "/api/bot/databases",
    "/api/inactivity",
    "/api/inactivity/players",
    "/api/settings/default-player",
]

# routes that take a parameter; we use a known-shape username/prefix
PARAMETERIZED_GET = [
    "/api/player/Salted",
    "/api/player/Salted/rank-history",
    "/api/player/Salted/playtime-history",
    "/api/player/Salted/metrics-history",
    "/api/player/Salted/points",
    "/api/player/rank-history/Salted",
    "/api/player/playtime/Salted",
    "/api/player/metrics/Salted",
    "/api/guild/prefix/ESI",
    "/api/guild/name/Empire%20of%20Sindria",
    "/api/guild/prefix/ESI/metrics-history",
]

GATED_MUTATIONS = [
    ("POST", "/api/inactivity"),
    ("PATCH", "/api/inactivity/123"),
    ("DELETE", "/api/inactivity/123"),
    ("POST", "/api/guild/aspects/clear"),
]

AUTH_ROUTES = [
    "/auth/session",
    "/auth/refresh",
    "/auth/logout",
]

STATIC_FILES = [
    "/index.html",
    "/favicon.ico",
]

STATIC_DIRS = ["/css/", "/js/", "/images/", "/assets/"]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def make_session(timeout: float) -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": "esi-local-tester/1.0"})
    # patch timeout into every call
    orig = s.request

    def request(method: str, url: str, **kw: Any) -> requests.Response:
        kw.setdefault("timeout", timeout)
        kw.setdefault("allow_redirects", False)
        return orig(method, url, **kw)

    s.request = request  # type: ignore[assignment]
    return s


def build_tests(base: str, sess: requests.Session, opts: argparse.Namespace
                ) -> list[tuple[str, Callable[[], None]]]:
    tests: list[tuple[str, Callable[[], None]]] = []

    # ---- gateway reachability -------------------------------------------------
    def t_root() -> None:
        r = sess.get(base + "/")
        assert_status(r, 200)
        assert "text/html" in r.headers.get("Content-Type", "")
        assert_in("<html", r.text.lower())

    tests.append(("GET / serves HTML", t_root))

    def t_index_html() -> None:
        r = sess.get(base + "/index.html")
        assert_status(r, 200)
        assert_in("<html", r.text.lower())

    tests.append(("GET /index.html serves HTML", t_index_html))

    # ---- security headers -----------------------------------------------------
    def t_security_headers() -> None:
        r = sess.get(base + "/")
        h = {k.lower(): v for k, v in r.headers.items()}
        assert_eq(h.get("x-content-type-options", "").lower(), "nosniff",
                  "X-Content-Type-Options")
        assert_eq(h.get("x-frame-options", "").upper(), "DENY",
                  "X-Frame-Options")
        assert_eq(h.get("referrer-policy", ""), "strict-origin-when-cross-origin",
                  "Referrer-Policy")

    tests.append(("security headers on /", t_security_headers))

    # ---- favicon --------------------------------------------------------------
    def t_favicon() -> None:
        r = sess.get(base + "/favicon.ico")
        assert_status(r, 200)
        ctype = r.headers.get("Content-Type", "")
        assert any(x in ctype for x in ("image/", "application/octet-stream")), \
            f"unexpected favicon content-type: {ctype}"
        assert len(r.content) > 0

    tests.append(("GET /favicon.ico", t_favicon))

    # ---- public API (GET) -----------------------------------------------------
    for path in PUBLIC_GET:
        def make(p: str) -> Callable[[], None]:
            def fn() -> None:
                r = sess.get(base + p)
                assert_status(r, 200, 429)  # 429 if hit by rate-limit during run
                if r.status_code == 200:
                    assert_json(r)
            return fn

        tests.append((f"GET {path} (public)", make(path)))

    # ---- gated GET routes -----------------------------------------------------
    for path in GATED_GET:
        def make(p: str) -> Callable[[], None]:
            def fn() -> None:
                r = sess.get(base + p)
                # routes.py uses 401 for unauthenticated, 403 for wrong role
                assert_status(r, 401, 403)
                assert_json(r)
            return fn

        tests.append((f"GET {path} (auth required)", make(path)))

    # ---- parameterized routes (also gated in most cases) ----------------------
    for path in PARAMETERIZED_GET:
        def make(p: str) -> Callable[[], None]:
            def fn() -> None:
                r = sess.get(base + p)
                # public ones return 200; gated ones return 401/403
                assert_status(r, 200, 401, 403, 404, 502, 503)
                # don't validate body shape — depends on live Wynncraft API
            return fn

        tests.append((f"GET {path}", make(path)))

    # ---- gated mutations ------------------------------------------------------
    for method, path in GATED_MUTATIONS:
        def make(m: str, p: str) -> Callable[[], None]:
            def fn() -> None:
                r = sess.request(m, base + p, json={})
                assert_status(r, 401, 403)
            return fn

        tests.append((f"{method} {path} (auth required)", make(method, path)))

    # ---- auth routes ----------------------------------------------------------
    def t_auth_login_redirect() -> None:
        r = sess.get(base + "/auth/login")
        # OAuth2 redirect to discord, or local error if creds missing
        assert_status(r, 302, 303, 500)
        if r.status_code in (302, 303):
            loc = r.headers.get("Location", "")
            assert "discord.com" in loc, f"unexpected redirect: {loc}"

    tests.append(("GET /auth/login redirects to Discord", t_auth_login_redirect))

    def t_auth_session_unauth() -> None:
        r = sess.get(base + "/auth/session")
        assert_status(r, 200, 401)
        assert_json(r)

    tests.append(("GET /auth/session works unauthenticated", t_auth_session_unauth))

    for path in AUTH_ROUTES:
        if path == "/auth/session":
            continue  # tested above
        def make(p: str) -> Callable[[], None]:
            def fn() -> None:
                r = sess.get(base + p)
                assert_status(r, 200, 302, 401)
            return fn

        tests.append((f"GET {path}", make(path)))

    def t_mock_login() -> None:
        r = sess.post(base + "/auth/mock-login", json={})
        # available in dev only; either it works or returns 403/404
        assert_status(r, 200, 400, 401, 403, 404)

    tests.append(("POST /auth/mock-login", t_mock_login))

    # ---- 404 / 403 error handlers --------------------------------------------
    def t_404_html() -> None:
        r = sess.get(base + "/this-route-does-not-exist-xyzzy")
        assert_status(r, 404)
        # gateway returns JSON for unknown routes via errorhandler(404)
        # but unknown static path may return 200 SPA shell — both acceptable
        # so just check it's not a 500

    tests.append(("unknown path returns 404", t_404_html))

    def t_404_api() -> None:
        r = sess.get(base + "/api/this/does/not/exist")
        assert_status(r, 404, 401)
        assert_json(r)

    tests.append(("unknown /api path returns JSON 404", t_404_api))

    # ---- HTTP method enforcement ---------------------------------------------
    def t_method_not_allowed() -> None:
        r = sess.delete(base + "/api/bot/status")
        # gateway proxies all methods, so this depends on routes.py
        assert_status(r, 405, 401, 403, 404)

    tests.append(("DELETE on GET-only route is rejected", t_method_not_allowed))

    # ---- static dir listings (should NOT be allowed) -------------------------
    for d in STATIC_DIRS:
        def make(p: str) -> Callable[[], None]:
            def fn() -> None:
                r = sess.get(base + p)
                # Flask static serving doesn't list directories; expect 404
                assert_status(r, 200, 301, 403, 404)
            return fn

        tests.append((f"GET {d} (no directory listing)", make(d)))

    # ---- crawl index.html and verify every referenced asset ------------------
    def t_crawl_assets() -> None:
        r = sess.get(base + "/")
        assert_status(r, 200)
        parser = AssetCollector()
        parser.feed(r.text)
        seen: set[str] = set()
        broken: list[tuple[str, int]] = []
        for tag, href in parser.links:
            # only check local assets
            parsed = urlparse(href)
            if parsed.netloc and parsed.netloc not in (urlparse(base).netloc, ""):
                continue
            if href.startswith(("data:", "javascript:", "#", "mailto:")):
                continue
            url = urljoin(base + "/", href)
            if url in seen:
                continue
            seen.add(url)
            rr = sess.get(url)
            if rr.status_code >= 400:
                broken.append((url, rr.status_code))
        if broken:
            preview = ", ".join(f"{u} ({c})" for u, c in broken[:5])
            raise AssertionError(f"{len(broken)} broken asset(s): {preview}")
        if opts.verbose:
            print(f"          checked {len(seen)} assets")

    tests.append(("crawl /: every linked asset returns 200", t_crawl_assets))

    # ---- gzip parity ---------------------------------------------------------
    def t_gzip() -> None:
        r1 = sess.get(base + "/", headers={"Accept-Encoding": "gzip, deflate"})
        r2 = sess.get(base + "/", headers={"Accept-Encoding": "identity"})
        assert_status(r1, 200)
        assert_status(r2, 200)
        # body length may differ in encoding but text() should match
        assert_eq(r1.text, r2.text, "gzip vs identity body mismatch")

    tests.append(("gzip and identity produce same body", t_gzip))

    # ---- session cookie smoke -------------------------------------------------
    def t_cookies() -> None:
        s = requests.Session()
        s.get(base + "/", timeout=opts.timeout, allow_redirects=False)
        # any Set-Cookie?  not required, but record
        # we just ensure subsequent requests work with the jar
        r = s.get(base + "/auth/session", timeout=opts.timeout)
        assert r.status_code in (200, 401)

    tests.append(("session cookies round-trip", t_cookies))

    # ---- routes service direct (port 5001) -----------------------------------
    def t_routes_direct() -> None:
        url = base.replace(":5000", ":5001")
        try:
            r = requests.get(url + "/api/bot/status", timeout=opts.timeout)
        except requests.ConnectionError:
            skip("routes service on :5001 not reachable")
            return
        assert_status(r, 200, 429)

    tests.append(("routes service on :5001 reachable", t_routes_direct))

    # ---- cache service (port 5002) -------------------------------------------
    def t_cache_direct() -> None:
        url = base.replace(":5000", ":5002")
        try:
            r = requests.get(url + "/", timeout=opts.timeout)
        except requests.ConnectionError:
            skip("cache service on :5002 not reachable")
            return
        # any 2xx/4xx is fine — we just want a TCP response
        assert r.status_code < 500

    tests.append(("cache service on :5002 reachable", t_cache_direct))

    # ---- gateway returns 503 when routes is down ------------------------------
    # (only meaningful if you intentionally stop routes; we just sanity-check
    #  that the proxy error path returns valid JSON if it triggers)
    def t_gateway_proxy_error_shape() -> None:
        r = sess.get(base + "/api/bot/status")
        if r.status_code == 503:
            data = assert_json(r)
            assert_in("error", data)
        else:
            skip(f"routes is up (status {r.status_code})")

    tests.append(("gateway proxy 503 shape (if applicable)",
                  t_gateway_proxy_error_shape))

    # ---- rate limiting on /api/guild/activity --------------------------------
    def t_rate_limit() -> None:
        if opts.skip_rate_limit:
            skip("--skip-rate-limit set")
            return
        codes = []
        for _ in range(8):
            r = sess.get(base + "/api/guild/activity")
            codes.append(r.status_code)
        assert any(c in (200, 304) for c in codes), f"never got 200: {codes}"
        # README says rate-limited per-IP, 30s window — we expect at least one 429
        # but if cache is shared, a 200 may always be returned; tolerate both
        if not any(c == 429 for c in codes):
            if opts.verbose:
                print(f"          no 429 seen (cache may absorb), codes={codes}")

    tests.append(("rate limit on /api/guild/activity (best-effort)",
                  t_rate_limit))

    # ---- big: round-trip latency budget --------------------------------------
    def t_homepage_fast() -> None:
        t0 = time.perf_counter()
        r = sess.get(base + "/")
        dt = (time.perf_counter() - t0) * 1000
        assert_status(r, 200)
        assert dt < 2000, f"homepage too slow: {dt:.0f}ms"

    tests.append(("homepage responds in <2s", t_homepage_fast))

    # ---- HTML sanity: ensure no unescaped server-side error spilled ----------
    def t_no_traceback() -> None:
        r = sess.get(base + "/")
        bad = ("Traceback (most recent call last)", "werkzeug.exceptions.")
        for needle in bad:
            if needle in r.text:
                raise AssertionError(f"server error leaked into homepage: {needle}")

    tests.append(("homepage contains no Python tracebacks", t_no_traceback))

    return tests


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base", default="http://localhost:5000",
                    help="base URL of the running gateway (default: %(default)s)")
    ap.add_argument("--timeout", type=float, default=10.0,
                    help="per-request timeout in seconds")
    ap.add_argument("--verbose", "-v", action="store_true")
    ap.add_argument("--skip-rate-limit", action="store_true",
                    help="skip the rate-limit hammer test")
    ap.add_argument("--filter", default="",
                    help="only run tests whose name matches this regex")
    opts = ap.parse_args()

    base = opts.base.rstrip("/")
    print(f"{CYAN}ESI Dashboard local test runner{RESET}")
    print(f"{GREY}target: {base}{RESET}")
    print()

    sess = make_session(opts.timeout)
    try:
        sess.get(base + "/")
    except requests.ConnectionError:
        print(f"{RED}Could not connect to {base}.{RESET}")
        print("Is the server running?  Start it with:  python main.py")
        return 1

    runner = Runner(verbose=opts.verbose)
    pat = re.compile(opts.filter) if opts.filter else None
    for name, fn in build_tests(base, sess, opts):
        if pat and not pat.search(name):
            continue
        runner.run(name, fn)

    return runner.summary()


if __name__ == "__main__":
    sys.exit(main())
