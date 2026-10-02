"""
analytics.py - Web analytics storage.

Owns data/databases/analytics.db and the write path into it. Two kinds of
traffic land here:

  - requests       every HTTP request the gateway serves, recorded server-side
                   by main.py. Trustworthy: nothing about it comes from the
                   client beyond the headers the browser always sends.
  - events         client-reported interaction (panel views, banner clicks,
                   errors). Only ever written through /api/track, which
                   validates a server-issued token and an allow-list of event
                   kinds before anything reaches this module.

Writes are batched. Callers enqueue and return immediately; a single writer
thread drains the queue and commits in bulk, so a slow disk can never stall a
request. The queue is bounded and drops rather than blocks - a full queue means
under-reporting, never a hung site.

Privacy: the raw IP is never stored. `hash_ip` returns a salted hash whose salt
rotates daily, so unique visitors can be counted within a day but a person
cannot be followed across days.
"""

import collections
import hashlib
import hmac
import json
import os
import queue
import re
import secrets
import sqlite3
import threading
from datetime import date, timedelta
from time import time
from datetime import datetime, timezone as _tz

from config import _ANALYTICS_DB, _get_secret_key

# tunables

_RETENTION_DAYS = 30
_QUEUE_MAX = 20000
_BATCH_MAX = 500

# schema
#
# The schema is frozen here so every later piece - the beacon, the domain
# hooks, the query endpoints - can be written against it without further
# migrations. Route stats and the daily rollup are the only tables the panels
# read for anything older than today; the three raw tables are pruned hard.

_SCHEMA = (
    """
    CREATE TABLE IF NOT EXISTS requests (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ts           REAL    NOT NULL,
        ts_iso       TEXT    NOT NULL,
        method       TEXT    NOT NULL,
        path         TEXT    NOT NULL,
        route        TEXT,
        status       INTEGER,
        duration_ms  REAL,
        bytes        INTEGER,
        cache        TEXT,
        ip_hash      TEXT,
        ua_class     TEXT,
        session_hash TEXT,
        blocked      INTEGER NOT NULL DEFAULT 0,
        block_reason TEXT,
        country      TEXT,
        dnt          INTEGER NOT NULL DEFAULT 0,
        gpc          INTEGER NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_areq_ts      ON requests(ts)",
    "CREATE INDEX IF NOT EXISTS idx_areq_route   ON requests(route)",
    "CREATE INDEX IF NOT EXISTS idx_areq_status  ON requests(status)",
    "CREATE INDEX IF NOT EXISTS idx_areq_path    ON requests(path)",
    "CREATE INDEX IF NOT EXISTS idx_areq_session ON requests(session_hash)",

    """
    CREATE TABLE IF NOT EXISTS events (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ts           REAL    NOT NULL,
        ts_iso       TEXT    NOT NULL,
        kind         TEXT    NOT NULL,
        name         TEXT,
        session_hash TEXT,
        user_id      TEXT,
        path         TEXT,
        panel        TEXT,
        referrer     TEXT,
        source       TEXT,
        device       TEXT,
        os           TEXT,
        browser      TEXT,
        locale       TEXT,
        timezone     TEXT,
        props        TEXT,
        ip_hash      TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_aevt_ts      ON events(ts)",
    "CREATE INDEX IF NOT EXISTS idx_aevt_kind    ON events(kind)",
    "CREATE INDEX IF NOT EXISTS idx_aevt_name    ON events(name)",
    "CREATE INDEX IF NOT EXISTS idx_aevt_session ON events(session_hash)",

    """
    CREATE TABLE IF NOT EXISTS client_errors (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        ts           REAL    NOT NULL,
        ts_iso       TEXT    NOT NULL,
        kind         TEXT    NOT NULL,
        message      TEXT,
        source       TEXT,
        line         INTEGER,
        build        TEXT,
        path         TEXT,
        session_hash TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_aerr_ts   ON client_errors(ts)",
    "CREATE INDEX IF NOT EXISTS idx_aerr_kind ON client_errors(kind)",

    """
    CREATE TABLE IF NOT EXISTS rejected (
        ts     REAL NOT NULL,
        reason TEXT NOT NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_arj_ts ON rejected(ts)",

    """
    CREATE TABLE IF NOT EXISTS route_stats (
        hour         REAL    NOT NULL,
        route        TEXT    NOT NULL,
        method       TEXT    NOT NULL,
        status_class TEXT    NOT NULL,
        count        INTEGER NOT NULL DEFAULT 0,
        bytes        INTEGER NOT NULL DEFAULT 0,
        duration_p50 REAL,
        duration_p95 REAL,
        duration_p99 REAL,
        PRIMARY KEY (hour, route, method, status_class)
    )
    """,

    """
    CREATE TABLE IF NOT EXISTS route_registry (
        route   TEXT PRIMARY KEY,
        methods TEXT,
        area    TEXT,
        seen_at REAL
    )
    """,

    """
    CREATE TABLE IF NOT EXISTS rollup_daily (
        day    TEXT NOT NULL,
        metric TEXT NOT NULL,
        dim1   TEXT NOT NULL DEFAULT '',
        dim2   TEXT NOT NULL DEFAULT '',
        value  REAL NOT NULL DEFAULT 0,
        PRIMARY KEY (day, metric, dim1, dim2)
    )
    """,
)

_INSERT_SQL = {
    "requests": (
        "INSERT INTO requests (ts, ts_iso, method, path, route, status,"
        " duration_ms, bytes, cache, ip_hash, ua_class, session_hash,"
        " blocked, block_reason, country, dnt, gpc)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ),
    "events": (
        "INSERT INTO events (ts, ts_iso, kind, name, session_hash, user_id,"
        " path, panel, referrer, source, device, os, browser, locale,"
        " timezone, props, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
    ),
    "client_errors": (
        "INSERT INTO client_errors (ts, ts_iso, kind, message, source, line,"
        " build, path, session_hash) VALUES (?,?,?,?,?,?,?,?,?)"
    ),
    "rejected": "INSERT INTO rejected (ts, reason) VALUES (?,?)",
}

# connection handling
#
# Same shape as access_logger: one connection per thread, WAL so the writer
# thread and the panel's readers do not block each other.

_db_local = threading.local()


_ADDED_COLUMNS = (
    ("requests", "country", "TEXT"),
    ("requests", "dnt", "INTEGER NOT NULL DEFAULT 0"),
    ("requests", "gpc", "INTEGER NOT NULL DEFAULT 0"),
)


def _ensure_schema(conn):
    for statement in _SCHEMA:
        conn.execute(statement)
    for table, column, ddl in _ADDED_COLUMNS:
        try:
            existing = {row[1] for row in conn.execute("PRAGMA table_info(" + table + ")")}
        except sqlite3.Error:
            continue
        if column in existing:
            continue
        try:
            conn.execute("ALTER TABLE " + table + " ADD COLUMN " + column + " " + ddl)
        except sqlite3.Error:
            pass
    conn.commit()


def _init():
    os.makedirs(os.path.dirname(_ANALYTICS_DB), exist_ok=True)
    conn = sqlite3.connect(_ANALYTICS_DB, timeout=10)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_schema(conn)
    finally:
        conn.close()


_init()


def _get_db():
    conn = getattr(_db_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(_ANALYTICS_DB, timeout=10, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_schema(conn)
        _db_local.conn = conn
    return conn


# write queue

_QUEUE = queue.Queue(maxsize=_QUEUE_MAX)
_drop_lock = threading.Lock()
_dropped = 0
_writer_lock = threading.Lock()
_writer_started = False


def _enqueue(table, values):
    """Queue one row. Never blocks and never raises."""
    _ensure_writer()
    try:
        _QUEUE.put_nowait((table, values))
    except queue.Full:
        global _dropped
        with _drop_lock:
            _dropped += 1


def _writer_loop():
    while True:
        try:
            first = _QUEUE.get(timeout=1.0)
        except queue.Empty:
            continue
        items = [first]
        while len(items) < _BATCH_MAX:
            try:
                items.append(_QUEUE.get_nowait())
            except queue.Empty:
                break
        grouped = {}
        for table, values in items:
            grouped.setdefault(table, []).append(values)
        try:
            conn = _get_db()
            for table, rows in grouped.items():
                conn.executemany(_INSERT_SQL[table], rows)
            conn.commit()
        except sqlite3.Error:
            # Under-reporting beats taking the site down.
            pass


def _ensure_writer():
    global _writer_started
    if _writer_started:
        return
    with _writer_lock:
        if _writer_started:
            return
        threading.Thread(target=_writer_loop, daemon=True, name="analytics-writer").start()
        _writer_started = True


# ip hashing

_salt_cache = {}
_salt_lock = threading.Lock()


def _daily_salt():
    """A salt that changes at midnight, so hashes cannot be joined across days.

    Derived from the site secret rather than being the secret itself, so the
    value really does change at midnight instead of staying constant.
    """
    today = date.today().isoformat()
    with _salt_lock:
        if _salt_cache.get("day") != today:
            _salt_cache["day"] = today
            _salt_cache["salt"] = hashlib.sha256(
                (_get_secret_key() + "|analytics-salt|" + today).encode("utf-8")
            ).hexdigest()
        return _salt_cache["salt"]


def hash_ip(ip):
    """One-way daily hash of an IP, or None when there is nothing to hash."""
    if not ip or ip == "unknown":
        return None
    digest = hashlib.sha256()
    digest.update(_daily_salt().encode("utf-8"))
    digest.update(b"|")
    digest.update(str(ip).encode("utf-8"))
    return digest.hexdigest()[:32]


def hash_session(cookie_value):
    """One-way daily hash of an analytics session id."""
    if not cookie_value:
        return None
    digest = hashlib.sha256()
    digest.update(_daily_salt().encode("utf-8"))
    digest.update(b"|s|")
    digest.update(str(cookie_value).encode("utf-8"))
    return digest.hexdigest()[:32]


def _sign(payload):
    """HMAC over *payload* with the site secret. Used for cookies and tokens."""
    digest = hmac.new(
        _get_secret_key().encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
    )
    return digest.hexdigest()[:32]


# analytics session cookie
#
# The Flask session cookie cannot be used for this. routes.py rewrites
# `_last_active` on every request, so its signed value changes every time and
# hashing it would make every single request look like a new session. This is
# a separate, server-issued cookie holding an opaque id that stays put for the
# life of a visit. Only the id is hashed for storage, never the cookie itself.

SESSION_COOKIE = "esi_sid"
_SESSION_IDLE_SECONDS = 30 * 60
_SESSION_REFRESH_SECONDS = 10 * 60
_SID_RE = re.compile(r"^[0-9a-f]{32}$")


def issue_session_cookie(sid=None, issued=None):
    """Return (sid, signed cookie value) for a new or refreshed session."""
    sid = sid or secrets.token_hex(16)
    issued = int(issued if issued is not None else time())
    payload = sid + "." + str(issued)
    return sid, payload + "." + _sign("sid|" + payload)


def parse_session_cookie(value):
    """Return (sid, issued) for a genuine cookie, or None.

    A forged or malformed cookie is treated as no cookie at all, so a client
    cannot mint itself unlimited session ids to inflate the session counts.
    """
    if not value or not isinstance(value, str) or len(value) > 128:
        return None
    parts = value.split(".")
    if len(parts) != 3:
        return None
    sid, issued_raw, signature = parts
    if not _SID_RE.match(sid) or not issued_raw.isdigit():
        return None
    payload = sid + "." + issued_raw
    if not hmac.compare_digest(signature, _sign("sid|" + payload)):
        return None
    issued = int(issued_raw)
    now = time()
    if issued > now + 300 or now - issued > _SESSION_IDLE_SECONDS * 2:
        return None
    return sid, issued


def ensure_session_cookie(cookie_value):
    """Return (sid, replacement_cookie_or_None) for one request.

    The id is kept across refreshes so a visit stays one session; only the
    signature and issue time are rewritten, which is what slides the idle
    window forward.
    """
    parsed = parse_session_cookie(cookie_value)
    if parsed is None:
        return issue_session_cookie()
    sid, issued = parsed
    if time() - issued < _SESSION_REFRESH_SECONDS:
        return sid, None
    return issue_session_cookie(sid=sid)


def set_session_cookie(response, value, secure=True):
    """Attach the analytics session cookie to a response."""
    response.set_cookie(
        SESSION_COOKIE, value,
        max_age=_SESSION_IDLE_SECONDS,
        httponly=True,
        samesite="Lax",
        secure=secure,
        path="/",
    )
    return response


# beacon tokens
#
# Every /api/track request carries one of these. It proves the caller loaded a
# real page first and binds the batch to the session that loaded it, so the
# endpoint cannot be used as anonymous storage. Short-lived, and re-issued by
# the shim as needed.

TRACK_TOKEN_TTL = 30 * 60


def issue_track_token(session_hash, ttl=TRACK_TOKEN_TTL):
    """Mint a signed, short-lived token bound to *session_hash*."""
    expires = int(time()) + int(ttl)
    payload = (session_hash or "-") + "." + str(expires)
    return str(expires) + "." + _sign("track|" + payload)


def verify_track_token(token, session_hash):
    """True when *token* is ours, unexpired and bound to this session."""
    if not token or not isinstance(token, str) or len(token) > 128:
        return False
    parts = token.split(".")
    if len(parts) != 2:
        return False
    expires_raw, signature = parts
    if not expires_raw.isdigit():
        return False
    payload = (session_hash or "-") + "." + expires_raw
    if not hmac.compare_digest(signature, _sign("track|" + payload)):
        return False
    now = time()
    return now <= int(expires_raw) <= now + 86400


# user agent classification
#
# Coarse on purpose. The full UA string is attacker-controlled and unbounded;
# a small enum is enough for the device and browser cards and keeps the table
# narrow.

_BOT_MARKERS = (
    ("googlebot", "googlebot"),
    ("bingbot", "bingbot"),
    ("duckduckbot", "duckduckbot"),
    ("ahrefsbot", "ahrefsbot"),
    ("semrushbot", "semrushbot"),
    ("discordbot", "discordbot"),
    ("yandexbot", "yandexbot"),
    ("petalbot", "petalbot"),
    ("facebookexternalhit", "facebook"),
    ("twitterbot", "twitterbot"),
    ("applebot", "applebot"),
    ("curl/", "curl"),
    ("wget/", "wget"),
    ("python-requests", "python-requests"),
    ("python-urllib", "python-urllib"),
    ("go-http-client", "go-http-client"),
    ("okhttp", "okhttp"),
    ("scrapy", "scrapy"),
    ("headlesschrome", "headless"),
)

_BROWSER_MARKERS = (
    ("edg/", "edge"),
    ("opr/", "opera"),
    ("chrome/", "chrome"),
    ("firefox/", "firefox"),
    ("safari/", "safari"),
    ("msie", "ie"),
)


def classify_ua(user_agent):
    """Return 'bot:<name>', 'browser:<name>', or 'other'."""
    if not user_agent:
        return "other"
    ua = user_agent.lower()
    for marker, name in _BOT_MARKERS:
        if marker in ua:
            return "bot:" + name
    for marker, name in _BOT_MARKERS:
        if marker.rstrip("/") in ua:
            return "bot:" + name
    for marker, name in _BROWSER_MARKERS:
        if marker in ua:
            return "browser:" + name
    return "other"


# route normalisation
#
# Route cardinality has to stay bounded or the traffic cards become a list of
# one-row paths. Usernames and ids are collapsed to placeholders before the row
# is written, so `/api/player/190Q` and `/api/player/Sindria` share a route.

_PREFIX_REWRITES = (
    (re.compile(r"^/api/player/[^/]+"), "/api/player/:name"),
    (re.compile(r"^/api/guild/[^/]+"), "/api/guild/:name"),
    (re.compile(r"^/player/[^/]+"), "/player/:name"),
    (re.compile(r"^/guild/(?!info)[^/]+"), "/guild/:name"),
    (re.compile(r"^/events/[^/]+"), "/events/:id"),
    (re.compile(r"^/api/wynnpiece/page/[^/]+"), "/api/wynnpiece/page/:slug"),
    (re.compile(r"^/api/wynnpiece/file/[^/]+"), "/api/wynnpiece/file/:name"),
    (re.compile(r"^/panel/api/services/[^/]+"), "/panel/api/services/:key"),
    (re.compile(r"^/panel/api/scripts/[^/]+"), "/panel/api/scripts/:key"),
    (re.compile(r"^/uploads/[^/]+"), "/uploads/:file"),
    (re.compile(r"^/panel/[^/]+/[^/]+"), "/panel/:section/:page"),
)

_NUMERIC_SEGMENT = re.compile(r"^[0-9]+$")
_UUID_SEGMENT = re.compile(
    r"^[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}-?[0-9a-fA-F]{12}$"
)
_LONG_HEX_SEGMENT = re.compile(r"^[0-9a-fA-F]{16,}$")


def normalise_route(path):
    """Collapse a request path into a stable, low-cardinality route."""
    if not path:
        return "/"
    route = path
    for pattern, replacement in _PREFIX_REWRITES:
        rewritten = pattern.sub(replacement, route)
        if rewritten != route:
            route = rewritten
            break
    parts = []
    for segment in route.split("/"):
        if _NUMERIC_SEGMENT.match(segment):
            parts.append(":n")
        elif _UUID_SEGMENT.match(segment) or _LONG_HEX_SEGMENT.match(segment):
            parts.append(":uuid")
        else:
            parts.append(segment)
    return "/".join(parts)


_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
_WHITESPACE_RE = re.compile(r"\s+")


def _clean_text(value, max_length):
    """Strip control characters, collapse whitespace, truncate."""
    if value is None:
        return None
    text = _CONTROL_RE.sub("", str(value))
    text = _WHITESPACE_RE.sub(" ", text).strip()
    if not text:
        return None
    return text[:max_length]


_CARDINALITY_CAP = 200
_CARDINALITY_MAX_KEYS = 400
_CARDINALITY = {}
_CARDINALITY_LOCK = threading.Lock()


def _capped_text(value, max_length, cap=_CARDINALITY_CAP):
    text = _clean_text(value, max_length)
    if not text:
        return None
    text = text.lower()
    day = date.today().isoformat()
    with _CARDINALITY_LOCK:
        if len(_CARDINALITY) > _CARDINALITY_MAX_KEYS:
            _CARDINALITY.clear()
        bucket = _CARDINALITY.setdefault((day, max_length), set())
        if text in bucket:
            return text
        if len(bucket) >= cap:
            return "other"
        bucket.add(text)
        return text


# event allow-list

_BANNER_ACTIONS = ("impression", "visible", "collapse", "expand", "click")
_EVENT_ACTIONS = ("view", "click", "pin", "unpin", "share",
                   "create", "edit", "delete", "status")
_SHOP_ACTIONS = (
    "view", "product_view", "filter", "search", "cart_add", "cart_remove",
    "cart_clear", "qty_change", "checkout_start", "checkout_done",
    "checkout_abandon", "balance", "dm_card", "disabled_view",
)
_SEARCH_SCOPES = ("site", "player", "guild", "shop", "events", "wynnpiece")
_PAGE_SOURCES = ("direct", "internal", "external", "search", "social")

EVENT_KINDS = {
    "page_view": {
        "source": ("enum", _PAGE_SOURCES),
        "entry": ("enum", _PAGE_SOURCES),
        "viewport": ("str", 16),
        "screen": ("str", 16),
        "memory": ("int", (0, 1024)),
        "cores": ("int", (0, 256)),
        "connection": ("enum", (
            "slow-2g", "2g", "3g", "4g", "5g",
            "wifi", "ethernet", "unknown", "other",
        )),
        "reduced_motion": ("bool", None),
        "banner_enabled": ("bool", None),
        "utm_campaign": ("text", (40, _CARDINALITY_CAP)),
        "utm_source": ("str", 24),
        "utm_medium": ("str", 24),
        "build": ("str", 24),
    },
    "panel_view": {
        "section": ("enum", ("website", "bots", "tools", "analytics", "other")),
        "panel": ("str", 40),
        "tab": ("str", 40),
    },
    "panel_switch": {
        "from": ("str", 40),
        "to": ("str", 40),
    },
    "nav_click": {
        "target": ("str", 64),
        "area": ("enum", ("header", "sidebar", "footer", "inline", "other")),
    },
    "deep_link": {
        "target": ("str", 120),
        "ok": ("bool", None),
    },
    "theme": {
        "theme": ("str", 32),
    },
    "font": {
        "font": ("str", 32),
    },
    "banner": {
        "action": ("enum", _BANNER_ACTIONS),
        "banner": ("str", 40),
        "ms": ("int", (0, 3600000)),
        "slot": ("int", (1, 10)),
        "panel": ("str", 24),
        "audience": ("enum", ("public", "guild_only")),
        "status": ("enum", ("upcoming", "ongoing", "completed", "cancelled")),
    },
    "event": {
        "action": ("enum", _EVENT_ACTIONS),
        "event": ("str", 64),
        "ms": ("int", (0, 3600000)),
    },
    "depth": {
        "scroll": ("int", (0, 100)),
        "hidden_ms": ("int", (0, 86400000)),
        "active_ms": ("int", (0, 86400000)),
        "idle_ms": ("int", (0, 86400000)),
    },
    "ui": {
        "action": ("enum", (
            "account_modal_opened", "settings_saved", "settings_reset",
        )),
    },
    "feed": {
        "action": ("enum", ("fetch", "changed")),
        "items": ("int", (0, 100)),
    },
    "search": {
        "q": ("text", (80, _CARDINALITY_CAP)),
        "scope": ("enum", _SEARCH_SCOPES),
        "results": ("int", (0, 100000)),
    },
    "lookup": {
        "type": ("enum", ("player", "guild")),
        "ok": ("bool", None),
    },
    "shop": {
        "action": ("enum", _SHOP_ACTIONS),
        "item": ("str", 64),
        "step": ("int", (0, 20)),
        "filter": ("str", 24),
        "q": ("text", (80, _CARDINALITY_CAP)),
    },
    "graph": {
        "action": ("enum", ("view", "range", "hover")),
        "graph": ("str", 32),
        "range": ("str", 16),
    },
    "feature": {
        "action": ("enum", ("view", "open", "expand", "run")),
        "name": ("str", 40),
    },
    "net": {
        "action": ("enum", ("failed", "retry", "gave_up")),
        "url": ("str", 120),
        "status": ("int", (0, 599)),
        "ms": ("int", (0, 600000)),
        "build": ("str", 24),
    },
    "toast": {
        "level": ("enum", ("info", "success", "warn", "error")),
        "label": ("text", (80, _CARDINALITY_CAP)),
    },
    "download": {
        "file": ("str", 120),
        "kind": ("enum", ("pdf", "csv", "json", "image", "archive", "other")),
    },
    "link": {
        "target": ("str", 120),
        "external": ("bool", None),
    },
}

CLIENT_FIELDS = {
    "device": ("enum", ("desktop", "mobile", "tablet", "bot", "other")),
    "os": ("str", 24),
    "browser": ("str", 24),
    "platform": ("str", 24),
    "locale": ("str", 24),
    "timezone": ("str", 48),
}

ERROR_KINDS = ("error", "rejection", "failed_request", "broken_asset", "csp")


def _apply_spec(spec, raw):
    """Validate one value against one spec. Returns (value, error_or_None)."""
    vtype, arg = spec
    if vtype == "str":
        if not isinstance(raw, str):
            return None, "type"
        return _clean_text(raw, arg), None
    if vtype == "text":
        if not isinstance(raw, str):
            return None, "type"
        return _capped_text(raw, arg[0], arg[1]), None
    if vtype == "enum":
        if not isinstance(raw, str) or raw not in arg:
            return None, "enum"
        return raw, None
    if vtype == "int":
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            return None, "type"
        if raw != raw or raw in (float("inf"), float("-inf")):
            return None, "type"
        return max(arg[0], min(arg[1], int(raw))), None
    if vtype == "bool":
        if not isinstance(raw, bool):
            return None, "type"
        return raw, None
    return None, "spec"


def _clean_mapping(spec, payload, prefix):
    """Return (clean_dict, None) or (None, reason).

    Properties not named in the spec are dropped rather than stored, so extra
    keys cost nothing but are never persisted.
    """
    if payload is None:
        payload = {}
    if not isinstance(payload, dict):
        return None, prefix + ":not_object"
    if len(payload) > len(spec) * 2 + 8:
        return None, prefix + ":too_many_keys"
    clean = {}
    for key, key_spec in spec.items():
        if key not in payload:
            continue
        value, error = _apply_spec(key_spec, payload[key])
        if error:
            return None, prefix + ":" + key + ":" + error
        if value is None:
            continue
        clean[key] = value
    return clean, None


def clean_event_props(kind, props):
    """Validate a beacon event's properties. Returns (props, None) or (None, reason)."""
    spec = EVENT_KINDS.get(kind)
    if spec is None:
        return None, "kind:unknown"
    return _clean_mapping(spec, props, "props")


def clean_client(payload):
    """Validate the per-batch environment block."""
    return _clean_mapping(CLIENT_FIELDS, payload, "client")


def is_known_kind(kind):
    return isinstance(kind, str) and kind in EVENT_KINDS


_SESSION_DAILY_EVENTS = 3000
_BUDGET = {}
_BUDGET_LOCK = threading.Lock()

_SESSION_RATE = {}
_SESSION_RATE_LOCK = threading.Lock()
_SESSION_RATE_MAX_KEYS = 20000


def session_budget_ok(session_hash, count=1):
    """False once a session has spent its daily event allowance."""
    if not session_hash:
        return True
    day = date.today().isoformat()
    key = (day, session_hash)
    with _BUDGET_LOCK:
        if len(_BUDGET) > 50000:
            for stale in [k for k in _BUDGET if k[0] != day]:
                del _BUDGET[stale]
        used = _BUDGET.get(key, 0)
        if used + count > _SESSION_DAILY_EVENTS:
            return False
        _BUDGET[key] = used + count
        return True


def session_rate_ok(session_hash, calls, period):
    """Per-session sliding window, mirroring the per-IP limiter."""
    if not session_hash:
        return True
    now = time()
    with _SESSION_RATE_LOCK:
        if len(_SESSION_RATE) > _SESSION_RATE_MAX_KEYS:
            _SESSION_RATE.clear()
        bucket = _SESSION_RATE.setdefault(session_hash, collections.deque())
        while bucket and now - bucket[0] >= period:
            bucket.popleft()
        if len(bucket) >= calls:
            return False
        bucket.append(now)
        return True


# public write API


def record_request(method, path, status, duration_ms=None, response_bytes=None,
                   cache=None, ip=None, user_agent=None, session_cookie=None,
                   route=None, blocked=False, block_reason=None, country=None,
                   dnt=False, gpc=False):
    """Record one served request. Called from the gateway's after_request hook."""
    now = time()
    _enqueue("requests", (
        now,
        datetime.now(_tz.utc).isoformat(),
        (method or "GET").upper(),
        path or "/",
        route if route is not None else normalise_route(path),
        int(status) if status is not None else None,
        round(duration_ms, 2) if duration_ms is not None else None,
        int(response_bytes) if response_bytes else None,
        cache,
        hash_ip(ip),
        classify_ua(user_agent),
        hash_session(session_cookie),
        1 if blocked else 0,
        block_reason,
        _clean_text(country, 2),
        1 if dnt else 0,
        1 if gpc else 0,
    ))


def record_rejected(reason):
    """Count a rejected write - a bad beacon, a rate limit, an unknown event."""
    _enqueue("rejected", (time(), (reason or "unknown")[:120]))


def record_event(kind, name=None, session_hash=None, user_id=None, path=None,
                 panel=None, referrer=None, source=None, device=None, os_name=None,
                 browser=None, locale=None, tz_name=None, props=None, ip=None):
    """Record one validated client event.

    Every argument must already have passed clean_event_props / clean_client.
    Nothing here reads the client payload directly.
    """
    _enqueue("events", (
        time(),
        datetime.now(_tz.utc).isoformat(),
        kind,
        _clean_text(name, 64),
        session_hash,
        _clean_text(user_id, 32),
        _clean_text(path, 200),
        _clean_text(panel, 40),
        _capped_text(referrer, 120),
        _clean_text(source, 40),
        _clean_text(device, 16),
        _clean_text(os_name, 24),
        _clean_text(browser, 24),
        _clean_text(locale, 24),
        _clean_text(tz_name, 48),
        json.dumps(props, separators=(",", ":")) if props else None,
        hash_ip(ip),
    ))


def record_server_event(kind, props=None, name=None, path=None, panel=None,
                        session_cookie=None, user_id=None, ip=None,
                        referrer=None, source=None):
    """Record an event the server observed directly.

    Server-side hooks cannot be forged by a client, so they skip the beacon's
    token and rate limits. The properties still go through the same validator,
    so what lands in the table is shaped identically to a beacon event.
    """
    clean, reason = clean_event_props(kind, props)
    if reason:
        record_rejected("server:" + reason)
        return False
    parsed = parse_session_cookie(session_cookie)
    record_event(
        kind=kind,
        name=name,
        session_hash=hash_session(parsed[0]) if parsed else None,
        user_id=user_id,
        path=path,
        panel=panel,
        referrer=referrer,
        source=source,
        props=clean,
        ip=ip,
    )
    return True


def record_client_error(kind, message=None, source=None, line=None, build=None,
                        path=None, session_hash=None):
    """Record one client-side error. Returns False for an unknown kind."""
    if kind not in ERROR_KINDS:
        return False
    if isinstance(line, bool) or not isinstance(line, (int, float)):
        line = None
    elif line != line:
        line = None
    else:
        line = max(0, min(1000000, int(line)))
    _enqueue("client_errors", (
        time(),
        datetime.now(_tz.utc).isoformat(),
        kind,
        _clean_text(message, 300),
        _clean_text(source, 200),
        line,
        _clean_text(build, 40),
        _clean_text(path, 200),
        session_hash,
    ))
    return True


# route registry
#
# Each service publishes its own Flask url_map at startup, so the panel's
# "never called" list is derived from what the app actually declares rather
# than being hand-maintained. Routes are stored in the same normalised form the
# request log uses, which is what makes the two comparable.

_AREA_NAMES = {
    "player": "Player", "guild": "Guild", "shop": "Shop", "events": "Events",
    "wynnpiece": "WynnPiece", "bot": "Bot", "inactivity": "Inactivity",
    "promotions": "Promotions", "auth": "Auth", "admin": "Admin",
    "discord": "Discord", "me": "Account", "settings": "Settings",
    "upload": "Uploads", "uploads": "Uploads", "creator": "Creator",
    "guild-info": "Guild Info", "metrics": "Metrics", "activity": "Activity",
}


def _route_area(route):
    """A short, bounded label for which part of the site a route belongs to."""
    parts = [p for p in (route or "").split("/") if p]
    for part in parts:
        if part in _AREA_NAMES:
            return _AREA_NAMES[part]
    if not parts:
        return "Root"
    return parts[0].replace("-", " ").title()[:40]


def write_route_registry(entries):
    """Publish a service's route list. Idempotent, returns the row count."""
    now = time()
    rows = [
        (route, methods, _route_area(route), now)
        for route, methods in (entries or [])
        if route
    ]
    if not rows:
        return 0
    conn = _get_db()
    try:
        conn.executemany(
            "INSERT INTO route_registry (route, methods, area, seen_at)"
            " VALUES (?,?,?,?)"
            " ON CONFLICT(route) DO UPDATE SET methods=excluded.methods,"
            " area=excluded.area, seen_at=excluded.seen_at",
            rows,
        )
        marks = ",".join("?" * len(rows))
        conn.execute(
            "DELETE FROM route_registry WHERE route NOT IN (" + marks + ")",
            [row[0] for row in rows],
        )
        conn.commit()
    except sqlite3.Error:
        return 0
    return len(rows)


def known_routes():
    """The registered routes as [(route, area)]. Empty when none published."""
    conn = _get_db()
    try:
        return [(r[0], r[1] or "") for r in conn.execute(
            "SELECT route, area FROM route_registry ORDER BY route"
        )]
    except sqlite3.Error:
        return []


# daily rollup
#
# The raw tables are pruned at 30 days, so anything the panels want to show
# beyond that has to be summarised first. One row per (day, metric, dimension),
# carrying no identifier of any kind.


def rollup_daily(day=None):
    """Aggregate one UTC day into rollup_daily. Idempotent, returns rows written."""
    if day is None:
        day = (datetime.now(_tz.utc).date() - timedelta(days=1)).isoformat()
    try:
        start = datetime.fromisoformat(day + "T00:00:00+00:00").timestamp()
    except ValueError:
        return 0
    end = start + 86400

    rows = []
    conn = _get_db()
    try:
        for row in conn.execute(
                "SELECT route, COUNT(*) FROM requests"
                " WHERE ts >= ? AND ts < ? AND route IS NOT NULL GROUP BY route",
                (start, end)):
            rows.append((day, "requests", row[0] or "", "", row[1]))
        for row in conn.execute(
                "SELECT status, COUNT(*) FROM requests"
                " WHERE ts >= ? AND ts < ? AND status IS NOT NULL GROUP BY status",
                (start, end)):
            rows.append((day, "status", str(row[0]), "", row[1]))
        for metric, column in (("visitors", "ip_hash"), ("sessions", "session_hash")):
            count = conn.execute(
                "SELECT COUNT(DISTINCT " + column + ") FROM requests"
                " WHERE ts >= ? AND ts < ? AND " + column + " IS NOT NULL",
                (start, end)).fetchone()[0] or 0
            rows.append((day, metric, "", "", count))
        members = conn.execute(
            "SELECT COUNT(DISTINCT user_id) FROM events"
            " WHERE ts >= ? AND ts < ? AND user_id IS NOT NULL",
            (start, end)).fetchone()[0] or 0
        rows.append((day, "active_members", "", "", members))
        for row in conn.execute(
                "SELECT kind, COUNT(*) FROM events WHERE ts >= ? AND ts < ? GROUP BY kind",
                (start, end)):
            rows.append((day, "events", row[0] or "", "", row[1]))
        for row in conn.execute(
                "SELECT COALESCE(block_reason, 'unspecified'), COUNT(*) FROM requests"
                " WHERE ts >= ? AND ts < ? AND blocked = 1 GROUP BY 1",
                (start, end)):
            rows.append((day, "blocked", row[0], "", row[1]))
        conn.execute("DELETE FROM rollup_daily WHERE day = ?", (day,))
        conn.executemany(
            "INSERT INTO rollup_daily (day, metric, dim1, dim2, value) VALUES (?,?,?,?,?)",
            rows)
        conn.commit()
    except sqlite3.Error:
        return 0
    return len(rows)


def rollup_recent(limit=45):
    """Roll up any complete UTC day that has raw rows but no rollup yet."""
    today = datetime.now(_tz.utc).date().isoformat()
    conn = _get_db()
    try:
        days = [row[0] for row in conn.execute(
            "SELECT DISTINCT date(ts, 'unixepoch') FROM requests"
            " ORDER BY 1 DESC LIMIT ?", (limit,)) if row[0]]
        done = {row[0] for row in conn.execute("SELECT DISTINCT day FROM rollup_daily")}
    except sqlite3.Error:
        return 0
    written = 0
    for day in days:
        if day >= today or day in done:
            continue
        if rollup_daily(day):
            written += 1
    return written


# retention

def cleanup_old_analytics():
    """Drop raw rows past the retention window. Aggregates are kept."""
    cutoff = time() - (_RETENTION_DAYS * 86400)
    conn = _get_db()
    try:
        for table in ("requests", "events", "client_errors", "rejected"):
            conn.execute("DELETE FROM " + table + " WHERE ts < ?", (cutoff,))
        conn.commit()
    except sqlite3.Error:
        pass


# introspection, for the panel's Health tab

def stats():
    with _drop_lock:
        dropped = _dropped
    return {
        "queue_depth": _QUEUE.qsize(),
        "queue_max": _QUEUE_MAX,
        "dropped": dropped,
        "retention_days": _RETENTION_DAYS,
        "db_path": _ANALYTICS_DB,
    }
