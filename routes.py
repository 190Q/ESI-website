"""
routes.py - API and auth routes service.
Runs on port 5001. Handles all /api/* and /auth/* endpoints.

    python routes.py
"""

import re as _re
import base64 as _base64
import hashlib as _hashlib
import os
import json
import secrets
import subprocess
import tempfile
import threading as _threading
import collections as _collections
import functools as _functools
import sqlite3 as _sqlite3
import requests
from time import time
from datetime import timedelta
from flask import Flask, jsonify, abort, send_from_directory, redirect, request, session
from werkzeug.middleware.proxy_fix import ProxyFix

from config import (
    _BASE_DIR, _ESI_BOT_DIR, _DATA_FOLDER, _API_TRACKING_DIR,
    _ASPECTS_JSON, _INACTIVITY_JSON, _USERNAME_MATCHES_JSON,
    _TRACKED_GUILD_JSON, _GUILD_LEVELS_JSON, _GUILD_TERRITORIES_JSON,
    _EVENTS_JSON,
    _POINTS_DB, _SNIPES_DB,
    _USER_DB_PATH, _UPLOAD_DIR,
    WYNN_BASE, DISCORD_API, DISCORD_TOKEN, DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, DISCORD_REDIRECT_URI,
    GITHUB_TOKEN, GITHUB_REPO, HEADERS as API_HEADERS,
    CACHE_TTL, PLAYTIME_CACHE_TTL, BULK_PLAYTIME_REFRESH,
    CACHE_URL, ROUTES_PORT,
    _ROLE_VALAENDOR, _ROLE_PARLIAMENT, _ROLE_CONGRESS, _ROLE_JUROR, _ROLE_CITIZEN,
    _ROLE_GRAND_DUKE, _ROLE_ARCHDUKE,
    _PARLIAMENT_PLUS, _JUROR_PLUS, _CHIEF_PLUS, _CITIZEN_PLUS,
    _EVENTS_ACCESS, _EVENTS_MANAGE_ANY,
    _CLIENT_CONFIG,
    PLAYER_BULK_METRIC_KEYS, GUILD_BULK_METRIC_KEYS,
    BOT_SCREEN_SESSION, TRACKER_SCREEN_SESSION, TRACKER_SCREEN_SPECS,
    DEV_MODE,
    _safe_number, _parse_bool, _load_json_file, _save_json_file,
    _mc_username, _get_secret_key, _get_latest_api_db,
    _medals_for_client, _build_badge_catalog,
)
import ipaddress

# Flask app

app = Flask(__name__)
# trust X-Forwarded-For from the gateway / nginx
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=2, x_proto=1, x_host=1)
app.secret_key = _get_secret_key()
app.permanent_session_lifetime = timedelta(days=30)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = DISCORD_REDIRECT_URI.startswith("https://")

os.makedirs(_UPLOAD_DIR, exist_ok=True)


# cache service helpers

def _fetch_cache(path, timeout=5):
    """Fetch JSON from the cache service. Returns dict/list or None on failure."""
    try:
        resp = requests.get(f"{CACHE_URL}{path}", timeout=timeout)
        if resp.ok:
            return resp.json()
    except (requests.RequestException, ValueError):
        pass
    return None


def _fetch_cache_raw(path, timeout=5):
    """Fetch raw bytes from the cache service. Returns bytes or None."""
    try:
        resp = requests.get(f"{CACHE_URL}{path}", timeout=timeout)
        if resp.ok:
            return resp.content
    except requests.RequestException:
        pass
    return None


# rate limiting

_RATE_LIMIT_STORE: dict = {}
_rate_limit_lock = _threading.Lock()
_RATE_LIMIT_MAX_KEYS = 10000
_rate_limit_last_cleanup = 0
_RATE_LIMIT_CLEANUP_INTERVAL = 300


def _rate_limit_cleanup(now):
    global _rate_limit_last_cleanup
    if now - _rate_limit_last_cleanup < _RATE_LIMIT_CLEANUP_INTERVAL \
            and len(_RATE_LIMIT_STORE) < _RATE_LIMIT_MAX_KEYS:
        return
    _rate_limit_last_cleanup = now
    stale = [k for k, v in _RATE_LIMIT_STORE.items() if not v or now - v[-1] >= 120]
    for k in stale:
        del _RATE_LIMIT_STORE[k]


def rate_limit(calls: int, period: float = 60.0):
    """Decorator: allow at most *calls* requests per *period* seconds per IP."""
    def decorator(fn):
        @_functools.wraps(fn)
        def wrapper(*args, **kwargs):
            ip  = request.remote_addr or "unknown"
            key = (ip, request.endpoint or request.path)
            now = time()
            with _rate_limit_lock:
                _rate_limit_cleanup(now)
                bucket = _RATE_LIMIT_STORE.setdefault(key, _collections.deque())
                while bucket and now - bucket[0] >= period:
                    bucket.popleft()
                if len(bucket) >= calls:
                    retry_after = int(period - (now - bucket[0])) + 1
                    resp = jsonify({
                        "error": "Rate limit exceeded",
                        "message": f"Too many requests. Please wait {retry_after} second{'s' if retry_after != 1 else ''} and try again.",
                        "retry_after": retry_after,
                    })
                    resp.status_code = 429
                    resp.headers["Retry-After"] = str(retry_after)
                    return resp
                bucket.append(now)
            return fn(*args, **kwargs)
        return wrapper
    return decorator


# activity rate response cache

_ACTIVITY_RATE: dict = {}
_ACTIVITY_RATE_INTERVAL = 30.0
_activity_rate_lock = _threading.Lock()


def _activity_rate_response(data_fn):
    """Only actually call data_fn() if this IP hasn't hit this path in the last 30s."""
    ip  = request.remote_addr or ""
    key = (ip, request.path)
    now = time()
    with _activity_rate_lock:
        entry = _ACTIVITY_RATE.get(key)
    if entry and now - entry[0] < _ACTIVITY_RATE_INTERVAL:
        return app.response_class(entry[1], status=200, mimetype="application/json")
    resp = data_fn()
    with _activity_rate_lock:
        _ACTIVITY_RATE[key] = (now, resp.get_data())
        if len(_ACTIVITY_RATE) > 10000:
            cutoff = now - 120
            stale = [k for k, v in _ACTIVITY_RATE.items() if v[0] < cutoff]
            for k in stale:
                del _ACTIVITY_RATE[k]
    return resp


# Wynncraft API response cache

_cache: dict = {}
_cache_lock = _threading.Lock()


def cached_get(url: str) -> dict:
    now = time()
    with _cache_lock:
        entry = _cache.get(url)
    if entry:
        data, ts = entry
        if now - ts < CACHE_TTL:
            return data
    resp = requests.get(url, headers=API_HEADERS, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    with _cache_lock:
        _cache[url] = (data, now)
    return data


# user data database (settings + remember-me tokens)

_db_local = _threading.local()


def _get_db():
    conn = getattr(_db_local, "conn", None)
    if conn is None:
        conn = _sqlite3.connect(_USER_DB_PATH, timeout=10, check_same_thread=False)
        conn.execute("PRAGMA journal_mode=WAL")
        _db_local.conn = conn
    return conn


def _init_user_db():
    conn = _sqlite3.connect(_USER_DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS user_settings (
            discord_id TEXT PRIMARY KEY,
            settings   TEXT NOT NULL DEFAULT '{}',
            updated_at REAL NOT NULL
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS remember_tokens (
            token      TEXT PRIMARY KEY,
            discord_id TEXT NOT NULL,
            user_data  TEXT NOT NULL DEFAULT '{}',
            created_at REAL NOT NULL,
            expires_at REAL NOT NULL
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_remember_discord ON remember_tokens(discord_id)")
    conn.commit()
    conn.close()


_init_user_db()

_REMEMBER_COOKIE  = "esi_remember"
_REMEMBER_MAX_AGE = 30 * 24 * 3600


def _remember_create(user_data):
    token = secrets.token_urlsafe(64)
    now = time()
    conn = _get_db()
    conn.execute("DELETE FROM remember_tokens WHERE discord_id = ?", (user_data["id"],))
    conn.execute(
        "INSERT INTO remember_tokens (token, discord_id, user_data, created_at, expires_at)"
        " VALUES (?, ?, ?, ?, ?)",
        (token, user_data["id"], json.dumps(user_data), now, now + _REMEMBER_MAX_AGE),
    )
    conn.execute("DELETE FROM remember_tokens WHERE expires_at < ?", (now,))
    conn.commit()
    return token


def _remember_restore(token):
    if not token:
        return None
    now = time()
    conn = _get_db()
    row = conn.execute(
        "SELECT user_data, expires_at FROM remember_tokens WHERE token = ?", (token,)
    ).fetchone()
    if not row or now > row[1]:
        conn.execute("DELETE FROM remember_tokens WHERE token = ?", (token,))
        conn.commit()
        return None
    conn.execute(
        "UPDATE remember_tokens SET expires_at = ? WHERE token = ?",
        (now + _REMEMBER_MAX_AGE, token),
    )
    conn.commit()
    try:
        return json.loads(row[0])
    except (json.JSONDecodeError, TypeError):
        return None


def _remember_update(discord_id, user_data):
    conn = _get_db()
    conn.execute(
        "UPDATE remember_tokens SET user_data = ? WHERE discord_id = ?",
        (json.dumps(user_data), discord_id),
    )
    conn.commit()


def _remember_delete(token=None, discord_id=None):
    conn = _get_db()
    if token:
        conn.execute("DELETE FROM remember_tokens WHERE token = ?", (token,))
    if discord_id:
        conn.execute("DELETE FROM remember_tokens WHERE discord_id = ?", (discord_id,))
    conn.commit()


def _set_remember_cookie(response, token):
    response.set_cookie(
        _REMEMBER_COOKIE, token,
        max_age=_REMEMBER_MAX_AGE,
        httponly=True,
        samesite="Lax",
        secure=DISCORD_REDIRECT_URI.startswith("https://"),
    )
    return response


def _clear_remember_cookie(response):
    response.delete_cookie(_REMEMBER_COOKIE, samesite="Lax")
    return response


# auth helpers

def _require_login():
    user = session.get("user")
    if not user:
        return None, (jsonify({"error": "Authentication required"}), 401)
    return user, None


def _require_role(allowed_roles: set):
    user, err = _require_login()
    if err:
        return None, err
    user_roles = set(user.get("roles") or [])
    if not (user_roles & allowed_roles):
        return None, (jsonify({"error": "Insufficient permissions"}), 403)
    return user, None


def _is_internal_bulk_request() -> bool:
    expected = (os.environ.get("ESI_INTERNAL_BULK_TOKEN") or "").strip()
    provided = (request.headers.get("X-ESI-Internal-Token") or "").strip()
    if not expected:
        return False
    try:
        return secrets.compare_digest(provided, expected)
    except Exception:
        return False


# request hooks

@app.before_request
def _before():
    session.permanent = True


# compute inline-script hashes from index.html so CSP survives frontend rebuilds
_INLINE_SCRIPT_RE = _re.compile(
    rb"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>",
    _re.DOTALL | _re.IGNORECASE,
)


def _compute_inline_script_hashes():
    path = os.path.join(_BASE_DIR, "index.html")
    try:
        with open(path, "rb") as fh:
            html = fh.read()
    except OSError:
        return ""
    parts = []
    for match in _INLINE_SCRIPT_RE.finditer(html):
        digest = _hashlib.sha256(match.group(1)).digest()
        b64 = _base64.b64encode(digest).decode("ascii")
        parts.append(f"'sha256-{b64}'")
    return " ".join(parts)


_INLINE_SCRIPT_HASHES = _compute_inline_script_hashes()


@app.after_request
def _after(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        f"script-src 'self' {_INLINE_SCRIPT_HASHES}; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' https://cdn.discordapp.com https://visage.surgeplay.com https://crafatar.com https://mc-heads.net data:; "
        "connect-src 'self';"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# public config endpoint

@app.route("/api/config")
def client_config():
    return jsonify(_CLIENT_CONFIG)


# OAuth2 auth routes

@app.route("/auth/login")
@rate_limit(30)
def auth_login():
    from urllib.parse import urlencode as _urlencode
    state = secrets.token_urlsafe(16)
    session["oauth_state"] = state
    params = _urlencode({
        "client_id":     DISCORD_CLIENT_ID,
        "redirect_uri":  DISCORD_REDIRECT_URI,
        "response_type": "code",
        "scope":         "identify guilds.members.read",
        "state":         state,
    })
    return redirect(f"https://discord.com/oauth2/authorize?{params}")


@app.route("/auth/callback")
def auth_callback():
    import sys
    error = request.args.get("error")
    if error:
        print(f"[AUTH] Discord returned error: {error}", file=sys.stderr)
        return redirect("/?auth=error")
    code  = request.args.get("code")
    state = request.args.get("state")
    saved_state = session.pop("oauth_state", None)
    if state != saved_state:
        print(f"[AUTH] State mismatch - url_state={state!r}, session_state={saved_state!r}", file=sys.stderr)
        print(f"[AUTH]   session keys: {list(session.keys())}", file=sys.stderr)
        print(f"[AUTH]   cookies present: {list(request.cookies.keys())}", file=sys.stderr)
        return redirect("/?auth=error")
    try:
        token_resp = requests.post(
            f"{DISCORD_API}/oauth2/token",
            data={
                "client_id":     DISCORD_CLIENT_ID,
                "client_secret": DISCORD_CLIENT_SECRET,
                "grant_type":    "authorization_code",
                "code":          code,
                "redirect_uri":  DISCORD_REDIRECT_URI,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        if not token_resp.ok:
            print(f"[AUTH] Token exchange failed: {token_resp.status_code} {token_resp.text[:200]}", file=sys.stderr)
        token_resp.raise_for_status()
        tokens = token_resp.json()
        access_token = tokens["access_token"]
        user_resp = requests.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if not user_resp.ok:
            print(f"[AUTH] User fetch failed: {user_resp.status_code} {user_resp.text[:200]}", file=sys.stderr)
        user_resp.raise_for_status()
        user = user_resp.json()
    except Exception as exc:
        print(f"[AUTH] OAuth callback error: {exc}", file=sys.stderr)
        return redirect("/?auth=error")
    member_resp = requests.get(
        f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members/{user['id']}",
        headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
        timeout=10,
    )
    roles = []
    nick = None
    if member_resp.ok:
        member_data = member_resp.json()
        roles = member_data.get("roles", [])
        nick = member_data.get("nick")
    roles_resp = requests.get(
        f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/roles",
        headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
        timeout=10,
    )
    role_objects = []
    if roles_resp.ok:
        all_roles = roles_resp.json()
        role_lookup = {r["id"]: r["name"] for r in all_roles}
        role_objects = [
            {"id": rid, "name": role_lookup.get(rid, "Unknown")}
            for rid in roles
        ]
    session.permanent = True
    user_data = {
        "id":            user["id"],
        "username":      user["username"],
        "nick":          nick,
        "discriminator": user.get("discriminator", "0"),
        "avatar":        user.get("avatar"),
        "roles":         roles,
        "role_objects":  role_objects,
    }
    session["user"] = user_data
    token = _remember_create(user_data)
    resp = redirect("/?auth=success")
    _set_remember_cookie(resp, token)
    return resp


@app.route("/auth/session")
def auth_session():
    user = session.get("user")
    if user:
        return jsonify({"loggedIn": True, "user": user})
    token = request.cookies.get(_REMEMBER_COOKIE)
    cached_user = _remember_restore(token)
    if cached_user:
        session.permanent = True
        session["user"] = cached_user
        resp = jsonify({"loggedIn": True, "user": cached_user})
        _set_remember_cookie(resp, token)
        return resp
    return jsonify({"loggedIn": False})


@app.route("/auth/refresh")
@rate_limit(60)
def auth_refresh():
    user = session.get("user")
    if not user:
        token = request.cookies.get(_REMEMBER_COOKIE)
        user = _remember_restore(token)
        if user:
            session.permanent = True
            session["user"] = user
        else:
            return jsonify({"loggedIn": False})
    user_id = user.get("id", "")
    if not user_id or not DISCORD_TOKEN or not DISCORD_GUILD_ID:
        return jsonify({"loggedIn": True, "user": user})
    try:
        member_resp = requests.get(
            f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members/{user_id}",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        if member_resp.status_code == 404:
            session.pop("user", None)
            _remember_delete(discord_id=user_id)
            resp = jsonify({"loggedIn": False})
            _clear_remember_cookie(resp)
            return resp
        if not member_resp.ok:
            return jsonify({"loggedIn": True, "user": user})
        member_data = member_resp.json()
        roles = member_data.get("roles", [])
        nick = member_data.get("nick")
        user_obj = member_data.get("user", {})
        username = user_obj.get("username", user.get("username"))
        avatar = user_obj.get("avatar", user.get("avatar"))
        discriminator = user_obj.get("discriminator", user.get("discriminator", "0"))
        roles_resp = requests.get(
            f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/roles",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        role_objects = user.get("role_objects", [])
        if roles_resp.ok:
            role_lookup = {r["id"]: r["name"] for r in roles_resp.json()}
            role_objects = [
                {"id": rid, "name": role_lookup.get(rid, "Unknown")}
                for rid in roles
            ]
        updated = {
            "id":            user_id,
            "username":      username,
            "nick":          nick,
            "discriminator": discriminator,
            "avatar":        avatar,
            "roles":         roles,
            "role_objects":  role_objects,
        }
        session["user"] = updated
        _remember_update(user_id, updated)
        return jsonify({"loggedIn": True, "user": updated})
    except Exception:
        return jsonify({"loggedIn": True, "user": user})


@app.route("/auth/logout")
def auth_logout():
    session.pop("user", None)
    token = request.cookies.get(_REMEMBER_COOKIE)
    _remember_delete(token=token)
    resp = jsonify({"loggedIn": False})
    _clear_remember_cookie(resp)
    return resp


# dev-mode bypass: impersonate any Discord user without going through OAuth.
# Guarded by DEV_MODE (auto-enabled when DISCORD_REDIRECT_URI points at
# localhost via .env.local) AND a loopback-origin check as a safety net, so it
# cannot fire even if DEV_MODE is ever accidentally left enabled in prod.

def _is_loopback_request() -> bool:
    ip = (request.remote_addr or "").strip()
    if not ip:
        return False
    try:
        return ipaddress.ip_address(ip).is_loopback
    except ValueError:
        return ip in {"localhost"}


@app.route("/auth/dev-login", methods=["GET", "POST"])
@rate_limit(30)
def auth_dev_login():
    if not DEV_MODE or not _is_loopback_request():
        abort(404)
    user_id = (request.values.get("user_id") or "").strip()
    if not user_id or not user_id.isdigit():
        return jsonify({
            "error": "user_id query parameter is required (numeric Discord ID)",
        }), 400
    override_username = (request.values.get("username") or "").strip() or None

    # Try to fetch the real guild member so role-gated UI matches production.
    roles = []
    nick = None
    real_username = None
    avatar = None
    discriminator = "0"
    if DISCORD_TOKEN and DISCORD_GUILD_ID:
        try:
            member_resp = requests.get(
                f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members/{user_id}",
                headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
                timeout=10,
            )
            if member_resp.ok:
                member_data = member_resp.json()
                roles = member_data.get("roles", []) or []
                nick = member_data.get("nick")
                user_obj = member_data.get("user") or {}
                real_username = user_obj.get("username")
                avatar = user_obj.get("avatar")
                discriminator = user_obj.get("discriminator", "0")
        except requests.RequestException:
            pass

    role_objects = []
    if roles and DISCORD_TOKEN and DISCORD_GUILD_ID:
        try:
            roles_resp = requests.get(
                f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/roles",
                headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
                timeout=10,
            )
            if roles_resp.ok:
                role_lookup = {r["id"]: r["name"] for r in roles_resp.json()}
                role_objects = [
                    {"id": rid, "name": role_lookup.get(rid, "Unknown")}
                    for rid in roles
                ]
        except requests.RequestException:
            pass

    session.permanent = True
    user_data = {
        "id":            user_id,
        "username":      override_username or real_username or f"dev-user-{user_id}",
        "nick":          nick,
        "discriminator": discriminator,
        "avatar":        avatar,
        "roles":         roles,
        "role_objects":  role_objects,
    }
    session["user"] = user_data
    token = _remember_create(user_data)
    # Honour a `redirect=0` flag so callers (curl/JSON clients) can get the
    # resulting session payload instead of being bounced back to `/`.
    if request.values.get("redirect") == "0":
        resp = jsonify({"loggedIn": True, "user": user_data})
    else:
        resp = redirect("/?auth=success")
    _set_remember_cookie(resp, token)
    return resp


# player / guild API routes

# player decorations

_DECORATIONS_CACHE: dict = {}
_DECORATIONS_CACHE_LOCK = _threading.Lock()
_DECORATIONS_CACHE_TTL = 120.0


def _resolve_discord_id(username: str):
    """Reverse-lookup a Minecraft username -> Discord ID via username_matches.json."""
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    ulow = (username or "").strip().lower()
    if not ulow:
        return None
    for did, entry in matches.items():
        mc = entry.get("username") if isinstance(entry, dict) else entry
        if isinstance(mc, str) and mc.lower() == ulow:
            return did
    return None


def _fetch_discord_member_roles(discord_id: str):
    """Fetch a guild member's role IDs from Discord. Returns [] on any failure."""
    if not discord_id or not DISCORD_TOKEN or not DISCORD_GUILD_ID:
        return []
    try:
        resp = requests.get(
            f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members/{discord_id}",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        if not resp.ok:
            return []
        return resp.json().get("roles", []) or []
    except requests.RequestException:
        return []


def _pick_decorations(role_ids):
    """Given a list of Discord role IDs, return the owned medals and the
    highest-tier badge per category, in display order."""
    role_set = set(role_ids or [])
    medals = [
        m for m in _medals_for_client()
        if m["role_id"] in role_set
    ][:8]
    badges = []
    for cat in _build_badge_catalog():
        for tier in cat["tiers"]:
            if tier["role_id"] in role_set:
                badges.append(tier)
                break
    badges = badges[:4]
    return medals, badges


@app.route("/api/player/<username>/decorations")
@rate_limit(30)
def player_decorations(username: str):
    key = (username or "").strip().lower()
    if not key:
        return jsonify({"discord_id": None, "medals": [], "badges": []})
    now = time()
    with _DECORATIONS_CACHE_LOCK:
        cached = _DECORATIONS_CACHE.get(key)
    if cached and now - cached[0] < _DECORATIONS_CACHE_TTL:
        return jsonify(cached[1])
    discord_id = _resolve_discord_id(username)
    if not discord_id:
        payload = {"discord_id": None, "medals": [], "badges": []}
    else:
        roles = _fetch_discord_member_roles(discord_id)
        medals, badges = _pick_decorations(roles)
        payload = {
            "discord_id": discord_id,
            "medals":     medals,
            "badges":     badges,
        }
    with _DECORATIONS_CACHE_LOCK:
        _DECORATIONS_CACHE[key] = (now, payload)
        if len(_DECORATIONS_CACHE) > 2000:
            # drop any entries older than 2x TTL
            cutoff = now - 2 * _DECORATIONS_CACHE_TTL
            stale = [k for k, v in _DECORATIONS_CACHE.items() if v[0] < cutoff]
            for k in stale:
                del _DECORATIONS_CACHE[k]
    return jsonify(payload)


@app.route("/api/player/<username>/rank-history")
@rate_limit(10)
def player_rank_history(username: str):
    data = _load_json_file(_TRACKED_GUILD_JSON)
    member_history = data.get("member_history", {})
    ulow = username.lower()
    for entry in member_history.values():
        if (entry.get("username") or "").lower() == ulow:
            changes = entry.get("rank_changes") or []
            if changes:
                return jsonify({
                    "username": entry["username"],
                    "rank_changes": changes,
                    "joined": entry.get("joined"),
                    "left": entry.get("left"),
                })
            break
    return jsonify({"username": username, "rank_changes": []})


@app.route("/api/guild/aspects")
@rate_limit(60)
def aspects_get():
    data = _load_json_file(_ASPECTS_JSON)
    if not data:
        return jsonify({"total_aspects": 0, "members": {}})
    return jsonify(data)


# ESI points (cycle-based leaderboard from the bot's esi_points.db)

from datetime import datetime as _points_datetime, timezone as _points_timezone, timedelta as _points_timedelta

# Anchor + duration mirror utils.esi_points in the bot repo
_POINTS_CYCLE_ANCHOR = _points_datetime(2026, 4, 21, 16, 0, 0, tzinfo=_points_timezone.utc)
_POINTS_CYCLE_DURATION = _points_timedelta(weeks=2)
_POINTS_HR_RANKS = {"strategist", "chief", "owner"}
_POINTS_LE_DIVISOR = 10


def _points_get_cycle_id(dt=None):
    if dt is None:
        dt = _points_datetime.now(_points_timezone.utc)
    return int((dt - _POINTS_CYCLE_ANCHOR) / _POINTS_CYCLE_DURATION) + 1


def _points_get_cycle_bounds(cycle_id):
    start = _POINTS_CYCLE_ANCHOR + _POINTS_CYCLE_DURATION * (cycle_id - 1)
    end = start + _POINTS_CYCLE_DURATION
    return start, end


def _points_cycle_meta(cycle_id):
    start, end = _points_get_cycle_bounds(cycle_id)
    return {
        "cycle_id": cycle_id,
        "label": f"Cycle {cycle_id} ({start.strftime('%d %b')} \u2013 {end.strftime('%d %b %Y')})",
        "short_label": f"Cycle {cycle_id}",
        "start": start.isoformat(),
        "end": end.isoformat(),
    }


def _points_player_table(uuid):
    return "player_" + uuid.replace("-", "_")


def _points_guild_ranks_and_members():
    """Return (guild_ranks_by_lower_username, set_of_guild_usernames_lower) from the latest api DB."""
    db = _get_latest_api_db()
    if not db:
        return {}, set()
    try:
        conn = _sqlite3.connect(db)
        c = conn.cursor()
        c.execute("SELECT username, guild_rank FROM player_stats")
        ranks = {}
        members = set()
        for row in c.fetchall():
            uname = (row[0] or "").strip()
            if not uname:
                continue
            members.add(uname.lower())
            ranks[uname.lower()] = (row[1] or "").lower()
        conn.close()
        return ranks, members
    except Exception:
        return {}, set()


def _points_fetch_player_history(uuid):
    """Return full history records for a single player UUID (newest first)."""
    table = _points_player_table(uuid)
    try:
        conn = _sqlite3.connect(_POINTS_DB)
        c = conn.cursor()
        try:
            c.execute(
                f'SELECT record_id, username, points_gained, cycle_id, reason, timestamp '
                f'FROM "{table}" ORDER BY timestamp DESC'
            )
            rows = c.fetchall()
        except _sqlite3.OperationalError:
            rows = []
        conn.close()
    except _sqlite3.OperationalError:
        rows = []
    return [
        {
            "record_id": r[0],
            "username": r[1],
            "points_gained": r[2],
            "cycle_id": r[3],
            "reason": r[4],
            "timestamp": r[5],
        }
        for r in rows
    ]


def _points_calc_le(username, total_points, history, guild_ranks):
    """Mirror utils.esi_points LE logic: HR players exclude guild raids and wars from LE."""
    rank = guild_ranks.get((username or "").lower(), "")
    if rank in _POINTS_HR_RANKS:
        le_points = sum(
            r["points_gained"] for r in (history or [])
            if (r.get("reason") or "").lower() not in {"guild raid", "war"}
            and not (r.get("reason") or "").lower().startswith("quest")
        )
        return le_points / _POINTS_LE_DIVISOR
    return (total_points or 0) / _POINTS_LE_DIVISOR


def _points_rows_for_cycles(cycle_ids, guild_members):
    """Return list of {uuid, username, points} summed across the given cycles, restricted to guild members."""
    if not cycle_ids:
        return []
    try:
        conn = _sqlite3.connect(_POINTS_DB)
        c = conn.cursor()
        placeholders = ",".join("?" * len(cycle_ids))
        c.execute(
            f"SELECT uuid, username, SUM(points) FROM esi_points "
            f"WHERE cycle_id IN ({placeholders}) GROUP BY uuid",
            cycle_ids,
        )
        rows = c.fetchall()
        conn.close()
    except _sqlite3.OperationalError:
        return []
    out = []
    for uuid, username, pts in rows:
        if guild_members and (username or "").lower() not in guild_members:
            continue
        out.append({"uuid": uuid, "username": username, "points": int(pts or 0)})
    return out


def _points_build_leaderboard(cycle_ids, guild_ranks, guild_members, history_cache):
    """Build a ranked leaderboard for a set of cycles. history_cache is mutated as a memoization store."""
    rows = _points_rows_for_cycles(cycle_ids, guild_members)
    enriched = []
    for r in rows:
        uuid = r["uuid"]
        if uuid not in history_cache:
            history_cache[uuid] = _points_fetch_player_history(uuid)
        history = history_cache[uuid]
        cycle_history = [h for h in history if h["cycle_id"] in cycle_ids]
        le = _points_calc_le(r["username"], r["points"], cycle_history, guild_ranks)
        enriched.append({
            "uuid": uuid,
            "username": r["username"],
            "points": r["points"],
            "le": le,
            "rank": (guild_ranks.get((r["username"] or "").lower(), "") or None),
        })
    enriched.sort(key=lambda x: (x["points"], x["le"]), reverse=True)
    for i, p in enumerate(enriched, 1):
        p["position"] = i
    total_points = sum(p["points"] for p in enriched)
    total_le = sum(p["le"] for p in enriched)
    return {
        "players": enriched,
        "total_players": len(enriched),
        "total_points": total_points,
        "total_le": total_le,
    }


@app.route("/api/guild/points")
@rate_limit(60)
def guild_points():
    if not os.path.exists(_POINTS_DB):
        return jsonify({"available": False})

    current_cycle = _points_get_cycle_id()
    previous_cycle = current_cycle - 1
    guild_ranks, guild_members = _points_guild_ranks_and_members()
    history_cache = {}

    current_board = _points_build_leaderboard([current_cycle], guild_ranks, guild_members, history_cache)
    previous_board = _points_build_leaderboard([previous_cycle], guild_ranks, guild_members, history_cache)
    both_board = _points_build_leaderboard([previous_cycle, current_cycle], guild_ranks, guild_members, history_cache)

    current_meta = _points_cycle_meta(current_cycle)
    previous_meta = _points_cycle_meta(previous_cycle)

    return jsonify({
        "available": True,
        "current_cycle": {**current_meta, **current_board},
        "previous_cycle": {**previous_meta, **previous_board},
        "both": {
            "cycle_ids": [previous_cycle, current_cycle],
            "label": f"{previous_meta['short_label']} + {current_meta['short_label']}",
            "short_label": "Both Cycles",
            **both_board,
        },
    })


@app.route("/api/player/<username>/points")
@rate_limit(30)
def player_points(username: str):
    if not os.path.exists(_POINTS_DB):
        return jsonify({"available": False, "username": username})

    # resolve uuid from points DB (case-insensitive)
    try:
        conn = _sqlite3.connect(_POINTS_DB)
        c = conn.cursor()
        c.execute(
            "SELECT uuid, username FROM esi_points WHERE LOWER(username) = LOWER(?) "
            "ORDER BY cycle_id DESC LIMIT 1",
            (username,),
        )
        row = c.fetchone()
        conn.close()
    except _sqlite3.OperationalError:
        row = None

    if not row:
        return jsonify({"available": True, "username": username, "found": False})

    uuid, resolved_name = row

    current_cycle = _points_get_cycle_id()
    previous_cycle = current_cycle - 1
    guild_ranks, guild_members = _points_guild_ranks_and_members()

    # points per cycle for this player
    try:
        conn = _sqlite3.connect(_POINTS_DB)
        c = conn.cursor()
        c.execute(
            "SELECT cycle_id, points FROM esi_points WHERE uuid = ? AND cycle_id IN (?, ?)",
            (uuid, current_cycle, previous_cycle),
        )
        cycle_rows = {r[0]: int(r[1] or 0) for r in c.fetchall()}
        conn.close()
    except _sqlite3.OperationalError:
        cycle_rows = {}

    history = _points_fetch_player_history(uuid)

    # build the three leaderboards so we can stamp per-section ranks
    history_cache = {uuid: history}
    boards = {
        "current":  _points_build_leaderboard([current_cycle],                    guild_ranks, guild_members, history_cache),
        "previous": _points_build_leaderboard([previous_cycle],                   guild_ranks, guild_members, history_cache),
        "both":     _points_build_leaderboard([previous_cycle, current_cycle],    guild_ranks, guild_members, history_cache),
    }

    def _section(cycle_ids, meta, board_key):
        pts = sum(cycle_rows.get(cid, 0) for cid in cycle_ids)
        cycle_history = [h for h in history if h["cycle_id"] in cycle_ids]
        le = _points_calc_le(resolved_name, pts, cycle_history, guild_ranks)
        board = boards[board_key]
        entry = next((p for p in board["players"] if p["uuid"] == uuid), None)
        return {
            **meta,
            "points": pts,
            "le": le,
            "history": cycle_history,
            "leaderboard_position": entry["position"] if entry else None,
            "leaderboard_size": board["total_players"],
        }

    current_meta = _points_cycle_meta(current_cycle)
    previous_meta = _points_cycle_meta(previous_cycle)
    both_meta = {
        "cycle_ids": [previous_cycle, current_cycle],
        "label": f"{previous_meta['short_label']} + {current_meta['short_label']}",
        "short_label": "Both Cycles",
    }

    both_section = _section([previous_cycle, current_cycle], both_meta, "both")

    return jsonify({
        "available": True,
        "found": True,
        "username": resolved_name,
        "uuid": uuid,
        "guild_rank": guild_ranks.get((resolved_name or "").lower(), "") or None,
        "in_guild": (resolved_name or "").lower() in guild_members if guild_members else None,
        "current_cycle": _section([current_cycle], current_meta, "current"),
        "previous_cycle": _section([previous_cycle], previous_meta, "previous"),
        "both": both_section,
        # kept for backwards-compat with any older clients
        "leaderboard_position": both_section["leaderboard_position"],
        "leaderboard_size": both_section["leaderboard_size"],
    })


@app.route("/api/guild/aspects/clear", methods=["POST"])
def aspects_clear():
    user, err = _require_role(_CHIEF_PLUS)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    uuid = (body.get("uuid") or "").strip()
    if not uuid:
        return jsonify({"error": "Missing uuid"}), 400
    data = _load_json_file(_ASPECTS_JSON)
    if uuid not in data.get("members", {}):
        return jsonify({"error": "Member not found"}), 404
    data["members"][uuid]["owed"] = 0
    data["total_aspects"] = sum(m.get("owed", 0) for m in data["members"].values())
    _save_json_file(_ASPECTS_JSON, data)
    return jsonify({"ok": True, "total_aspects": data["total_aspects"]})


# playtime / metrics (via cache service)

@app.route("/api/player/<username>/playtime-history")
@rate_limit(10)
def player_playtime_history(username: str):
    ulow = username.lower()
    member = _fetch_cache(f"/cache/activity/member/{ulow}")
    if member:
        return jsonify({
            "username": member.get("username", username),
            "data":     list(member.get("data", [])),
            "dates":    list(member.get("dates", [])),
        })
    return jsonify({"username": username, "data": [], "dates": []})


@app.route("/api/guild/activity")
@rate_limit(60)
def guild_activity_bulk():
    def _make():
        raw = _fetch_cache_raw("/cache/activity")
        if raw:
            return app.response_class(raw, status=200, mimetype="application/json")
        return jsonify({"members": {}, "ready": False})
    return _activity_rate_response(_make)


@app.route("/api/player/<username>/metrics-history")
@rate_limit(10)
def player_metrics_history(username: str):
    def _make():
        member = _fetch_cache(f"/cache/activity/member/{username}")
        metrics = {}
        for key in PLAYER_BULK_METRIC_KEYS:
            if key == "playtime":
                metrics[key] = list(member.get("data", [])) if member else []
            elif key == "contentDone":
                if member and isinstance(member.get("wars"), list):
                    metrics[key] = [0] * len(member.get("wars", []))
                else:
                    metrics[key] = []
            else:
                metrics[key] = list(member.get(key, [])) if member else []
        return jsonify({
            "username":      member.get("username", username) if member else username,
            "dates":         list(member.get("metricDates", [])) if member else [],
            "metricDates":   list(member.get("metricDates", [])) if member else [],
            "playtimeDates": list(member.get("dates", [])) if member else [],
            "metrics":       metrics,
        })
    return _activity_rate_response(_make)


@app.route("/api/guild/prefix/<prefix>/metrics-history")
@rate_limit(60)
def guild_metrics_history(prefix: str):
    def _make():
        guild = _fetch_cache("/cache/activity/guild") or {}
        return jsonify({
            "prefix":      prefix.upper(),
            "dates":       list(guild.get("metricDates", [])),
            "metricDates": list(guild.get("metricDates", [])),
            "metrics": {
                key: list(guild.get(key, []))
                for key in GUILD_BULK_METRIC_KEYS
            },
        })
    return _activity_rate_response(_make)


# inactivity exemptions

@app.route("/api/inactivity")
@rate_limit(60)
def inactivity_get():
    user, err = _require_role(_PARLIAMENT_PLUS)
    if err:
        return err
    data    = _load_json_file(_INACTIVITY_JSON)
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    guild_members = set()
    _latest_db = _get_latest_api_db()
    if _latest_db:
        conn = _sqlite3.connect(_latest_db)
        for row in conn.execute("SELECT username FROM player_stats WHERE UPPER(guild_prefix) = 'ESI'").fetchall():
            guild_members.add(row[0].lower())
        conn.close()
    result = []
    for discord_id, entry in data.items():
        if discord_id.startswith("mc_"):
            username = entry.get("username") or discord_id[3:]
        else:
            username = _mc_username(discord_id, matches) or f"User#{discord_id}"
        if guild_members and username.lower() not in guild_members:
            continue
        result.append({
            "discord_id": discord_id,
            "username":   username,
            "weeks":      entry.get("weeks") or [],
            "reason":     entry.get("reason") or "",
        })
    show_all = request.args.get("all") == "1"
    if not show_all:
        result = [r for r in result if r["weeks"]]
    result.sort(key=lambda x: ("permanent" in x["weeks"], x["username"].lower()))
    return jsonify(result)


@app.route("/api/inactivity", methods=["POST"])
@rate_limit(60)
def inactivity_add():
    user, err = _require_role(_PARLIAMENT_PLUS)
    if err:
        return err
    body     = request.get_json(silent=True) or {}
    username = (body.get("username") or "").strip()
    reason   = (body.get("reason")   or "").strip()
    weeks    = body.get("weeks") or []
    if not username or not reason or not weeks:
        return jsonify({"error": "Missing required fields"}), 400
    matches    = _load_json_file(_USERNAME_MATCHES_JSON)
    discord_id = None
    for did, entry in matches.items():
        mc = entry.get("username") if isinstance(entry, dict) else entry
        if isinstance(mc, str) and mc.lower() == username.lower():
            discord_id = did
            break
    if not discord_id:
        _latest_db = _get_latest_api_db()
        if _latest_db:
            conn = _sqlite3.connect(_latest_db)
            row = conn.execute(
                "SELECT username FROM player_stats WHERE username = ? COLLATE NOCASE",
                (username,),
            ).fetchone()
            conn.close()
            if row:
                discord_id = "mc_" + row[0].lower()
                username = row[0]
        if not discord_id:
            return jsonify({"error": f"Username '{username}' not found in guild records"}), 404
    data = _load_json_file(_INACTIVITY_JSON)
    existing = data.get(discord_id, {"weeks": [], "reason": reason})
    existing_weeks = existing.get("weeks") or []
    for w in weeks:
        if w not in existing_weeks:
            existing_weeks.append(w)
    entry_data = {"weeks": existing_weeks, "reason": reason}
    if discord_id.startswith("mc_"):
        entry_data["username"] = username
    data[discord_id] = entry_data
    _save_json_file(_INACTIVITY_JSON, data)
    return jsonify({
        "discord_id": discord_id,
        "username":   username,
        "weeks":      existing_weeks,
        "reason":     reason,
    }), 201


@app.route("/api/inactivity/<discord_id>", methods=["PATCH"])
@rate_limit(60)
def inactivity_edit(discord_id):
    user, err = _require_role(_PARLIAMENT_PLUS)
    if err:
        return err
    body   = request.get_json(silent=True) or {}
    reason = (body.get("reason") or "").strip()
    weeks  = body.get("weeks") or []
    if not reason or not weeks:
        return jsonify({"error": "Missing required fields"}), 400
    data = _load_json_file(_INACTIVITY_JSON)
    if discord_id not in data:
        return jsonify({"error": "User not found"}), 404
    entry_data = {"weeks": weeks, "reason": reason}
    if discord_id.startswith("mc_"):
        entry_data["username"] = data.get(discord_id, {}).get("username", discord_id[3:])
    data[discord_id] = entry_data
    _save_json_file(_INACTIVITY_JSON, data)
    if discord_id.startswith("mc_"):
        username = entry_data["username"]
    else:
        matches  = _load_json_file(_USERNAME_MATCHES_JSON)
        username = _mc_username(discord_id, matches) or f"User#{discord_id}"
    return jsonify({"discord_id": discord_id, "username": username, "weeks": weeks, "reason": reason})


@app.route("/api/inactivity/players")
@rate_limit(60)
def inactivity_players():
    user, err = _require_role(_JUROR_PLUS)
    if err:
        return err
    _latest_db = _get_latest_api_db()
    if not _latest_db:
        return jsonify([])
    conn = _sqlite3.connect(_latest_db)
    conn.row_factory = _sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT username, uuid, guild_rank FROM player_stats"
            " WHERE UPPER(guild_prefix) = 'ESI' ORDER BY username"
        ).fetchall()
    except _sqlite3.OperationalError:
        rows = conn.execute(
            "SELECT username, NULL as uuid, NULL as guild_rank FROM player_stats"
            " WHERE UPPER(guild_prefix) = 'ESI' ORDER BY username"
        ).fetchall()
    conn.close()
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    mc_to_discord = {}
    for did, entry in matches.items():
        mc = entry.get("username") if isinstance(entry, dict) else entry
        if isinstance(mc, str):
            mc_to_discord[mc.lower()] = did
    return jsonify([{
        "username": r["username"],
        "uuid": r["uuid"],
        "guild_rank": r["guild_rank"],
        "discord_id": mc_to_discord.get(r["username"].lower()),
    } for r in rows])


@app.route("/api/inactivity/<discord_id>", methods=["DELETE"])
@rate_limit(60)
def inactivity_delete(discord_id):
    user, err = _require_role(_PARLIAMENT_PLUS)
    if err:
        return err
    data = _load_json_file(_INACTIVITY_JSON)
    if discord_id in data:
        del data[discord_id]
        _save_json_file(_INACTIVITY_JSON, data)
    return jsonify({"ok": True})


# events

_EVENT_PRIZE_TYPES   = {"esi_points", "item", "other"}
_EVENT_STATUSES      = {"upcoming", "ongoing", "completed", "cancelled"}
_EVENT_AUDIENCES     = {"public", "guild_only"}
_EVENT_DEFAULT_AUDIENCE = "public"
_EVENT_MAX_NAME      = 120
_EVENT_MAX_DESC      = 4000
_EVENT_MAX_PRIZE_VAL = 500
_EVENT_MAX_PRIZE_DSC = 500
_EVENT_MAX_LOCATION  = 200
_EVENT_MAX_PRIZES    = 15
_EVENT_MAX_POSITION  = 999


def _user_can_manage_event(user, event):
    """True if the logged-in user can edit/delete this event."""
    if not user or not event:
        return False
    user_roles = set(user.get("roles") or [])
    if user_roles & _EVENTS_MANAGE_ANY:
        return True
    created_by = (event.get("created_by") or {}).get("id")
    return bool(created_by) and str(created_by) == str(user.get("id"))


def _user_can_pin_event(user):
    """True if the user has a role allowed to pin/unpin events."""
    if not user:
        return False
    user_roles = set(user.get("roles") or [])
    return bool(user_roles & _EVENTS_MANAGE_ANY)


def _is_guild_member(user):
    """True if `user` (a session dict) is logged in with the Sindrian Citizen role.

    Returns False for unauthenticated requests, so anonymous visitors can still
    load the public events page without seeing guild-only events.
    """
    if not user:
        return False
    roles = user.get("roles") or []
    return _ROLE_CITIZEN in roles


def _can_view_event_audience(audience, user):
    """Decide whether `user` may see an event with the given audience setting."""
    audience = (audience or _EVENT_DEFAULT_AUDIENCE).strip().lower()
    if audience == "guild_only":
        return _is_guild_member(user)
    return True


def _unpin_all_events(data, except_id=None, audience=None):
    """Mark events in `data` as not pinned, except optionally one.

    If `audience` is given, only events whose `audience` matches are touched.
    This is what enforces the "one pin per audience bucket" invariant: pinning
    a public event clears the previous public pin but leaves the guild-only
    pin alone, and vice versa.
    """
    if not isinstance(data, dict):
        return
    target_audience = (audience or "").strip().lower() or None
    for evid, ev in data.items():
        if not isinstance(ev, dict):
            continue
        if evid == except_id:
            continue
        if target_audience is not None:
            ev_audience = (ev.get("audience") or _EVENT_DEFAULT_AUDIENCE).strip().lower()
            if ev_audience != target_audience:
                continue
        if ev.get("pinned") or ev.get("pinned_at"):
            ev["pinned"]    = False
            ev["pinned_at"] = 0


def _enforce_pin_invariants(ev):
    """Clear `pinned`/`pinned_at` if the event is in a terminal status.

    A completed or cancelled event has no business showing on the pinned
    banner, so we unpin it automatically wherever it might have transitioned.
    Returns True if a change was made.
    """
    if not isinstance(ev, dict):
        return False
    status = (ev.get("status") or "upcoming").strip().lower()
    if status in ("completed", "cancelled") and (ev.get("pinned") or ev.get("pinned_at")):
        ev["pinned"]    = False
        ev["pinned_at"] = 0
        return True
    return False


def _parse_event_datetime(s):
    """Parse a `datetime-local` string from the events form. Returns a naive
    datetime in local time or None on failure.
    """
    if not s or not isinstance(s, str):
        return None
    s = s.strip()
    if not s:
        return None
    try:
        return _points_datetime.fromisoformat(s)
    except ValueError:
        return None


def _auto_transition_event_status(ev, now=None):
    """Promote an event's status based on its start/end times.

    - upcoming + starts_at in the past -> ongoing
    - any active + ends_at in the past -> completed

    Cancelled and already-completed events are left alone. Returns True if
    the status was changed (caller should persist).
    """
    if not isinstance(ev, dict):
        return False
    status = (ev.get("status") or "upcoming").strip().lower()
    changed = False
    if status not in ("upcoming", "ongoing"):
        return _enforce_pin_invariants(ev)
    if now is None:
        now = _points_datetime.now()
    starts = _parse_event_datetime(ev.get("starts_at"))
    ends   = _parse_event_datetime(ev.get("ends_at"))
    new_status = status
    if new_status == "upcoming" and starts is not None and now >= starts:
        new_status = "ongoing"
    if ends is not None and now >= ends:
        new_status = "completed"
    if new_status != status:
        ev["status"]     = new_status
        ev["updated_at"] = time()
        changed = True
    # Unpin if we just landed in a terminal state
    if _enforce_pin_invariants(ev):
        changed = True
    return changed


def _auto_transition_events(data):
    """Apply `_auto_transition_event_status` to every event in `data`.

    Returns True if any event was changed.
    """
    if not isinstance(data, dict):
        return False
    now = _points_datetime.now()
    changed = False
    for ev in data.values():
        if _auto_transition_event_status(ev, now):
            changed = True
    return changed


def _event_public_view(event):
    """Return a banner-safe subset of an event for the public pinned endpoint."""
    if not isinstance(event, dict):
        return None
    return {
        "id":                  event.get("id", ""),
        "name":                event.get("name", ""),
        "description":         event.get("description", ""),
        "prizes":              event.get("prizes") or [],
        "starts_at":           event.get("starts_at", ""),
        "ends_at":             event.get("ends_at", ""),
        "location":            event.get("location", ""),
        "location_channel_id": event.get("location_channel_id", ""),
        "status":              event.get("status", "upcoming"),
        "pinned_at":           event.get("pinned_at", 0),
        "audience":            (event.get("audience") or _EVENT_DEFAULT_AUDIENCE),
    }


def _clean_prize_entry(raw):
    """Validate one prize dict. Returns (clean_dict, error_str)."""
    if not isinstance(raw, dict):
        return None, "each prize must be an object"

    # position: 1-based rank. multiple prizes may share the same position
    raw_pos = raw.get("position", 1)
    try:
        position = int(raw_pos)
    except (TypeError, ValueError):
        return None, "prize position must be an integer"
    if position < 1 or position > _EVENT_MAX_POSITION:
        return None, f"prize position must be between 1 and {_EVENT_MAX_POSITION}"

    ptype = (raw.get("type") or "other").strip().lower()
    if ptype not in _EVENT_PRIZE_TYPES:
        return None, f"invalid prize type. must be one of {sorted(_EVENT_PRIZE_TYPES)}"

    raw_value = raw.get("value", "")
    if ptype == "esi_points":
        try:
            n = float(raw_value or 0)
        except (TypeError, ValueError):
            return None, "prize value must be a number when type is 'esi_points'"
        if n < 0:
            return None, "prize value cannot be negative"
        value = int(n) if n == int(n) else n
    else:
        v = "" if raw_value is None else str(raw_value).strip()
        if len(v) > _EVENT_MAX_PRIZE_VAL:
            v = v[:_EVENT_MAX_PRIZE_VAL]
        value = v

    raw_desc = raw.get("description", "")
    desc = "" if raw_desc is None else str(raw_desc).strip()
    if len(desc) > _EVENT_MAX_PRIZE_DSC:
        desc = desc[:_EVENT_MAX_PRIZE_DSC]

    return {
        "position":    position,
        "type":        ptype,
        "value":       value,
        "description": desc,
    }, None


def _migrate_legacy_prize(event):
    """If `event` only has the old single-prize fields, populate `prizes`.

    Mutates and returns the event dict. Safe to call repeatedly.
    """
    if not isinstance(event, dict):
        return event
    prizes = event.get("prizes")
    if isinstance(prizes, list):
        return event
    legacy_type = (event.get("prize_type") or "").strip().lower()
    if not legacy_type or legacy_type == "none":
        event["prizes"] = []
        return event
    if legacy_type not in _EVENT_PRIZE_TYPES:
        legacy_type = "other"
    event["prizes"] = [{
        "position":    1,
        "type":        legacy_type,
        "value":       event.get("prize_value", "") or "",
        "description": event.get("prize_description", "") or "",
    }]
    return event


def _clean_event_payload(body, existing=None):
    """Validate + normalise an event payload. Returns (event_dict, error_str).

    `existing` is the previous version of the event on PATCH so untouched fields
    can be kept intact.
    """
    existing = existing or {}
    out = dict(existing)

    def _str(field, max_len, required=False, allow_empty=False):
        val = body.get(field, existing.get(field, ""))
        if val is None:
            val = ""
        if not isinstance(val, str):
            val = str(val)
        val = val.strip()
        if len(val) > max_len:
            val = val[:max_len]
        if required and not val and not allow_empty:
            return None, f"'{field}' is required"
        return val, None

    name, err = _str("name", _EVENT_MAX_NAME, required=True)
    if err:
        return None, err
    out["name"] = name

    description, err = _str("description", _EVENT_MAX_DESC, allow_empty=True)
    if err:
        return None, err
    out["description"] = description

    # Prizes: an array of {position, type, value, description}. Multiple prizes
    # may share a position (e.g. 1st place gets both ESI Points + an item).
    # An empty array means "no prize".
    raw_prizes = body.get("prizes", None)
    if raw_prizes is None:
        # PATCH that doesn't touch prizes: keep whatever's already stored.
        prizes = existing.get("prizes")
        if not isinstance(prizes, list):
            prizes = []
    else:
        if not isinstance(raw_prizes, list):
            return None, "'prizes' must be an array"
        if len(raw_prizes) > _EVENT_MAX_PRIZES:
            return None, f"too many prizes (max {_EVENT_MAX_PRIZES})"
        prizes = []
        for entry in raw_prizes:
            cleaned, err_msg = _clean_prize_entry(entry)
            if err_msg:
                return None, err_msg
            prizes.append(cleaned)
        # Stable sort by position so 1st place is always first in storage.
        prizes.sort(key=lambda p: p["position"])
    out["prizes"] = prizes

    # Drop the deprecated single-prize fields so storage doesn't get stale.
    for legacy in ("prize_type", "prize_value", "prize_description"):
        out.pop(legacy, None)

    location, err = _str("location", _EVENT_MAX_LOCATION, allow_empty=True)
    if err:
        return None, err
    out["location"] = location

    # Optional Discord voice-channel id that the location refers to
    raw_cid = body.get("location_channel_id", existing.get("location_channel_id"))
    if raw_cid is None or raw_cid == "":
        out["location_channel_id"] = ""
    else:
        cid = str(raw_cid).strip()
        if not cid.isdigit() or len(cid) > 30:
            return None, "Invalid location_channel_id"
        out["location_channel_id"] = cid

    # Optional datetime strings (free-form ISO 8601, validated loosely)
    for key in ("starts_at", "ends_at"):
        val = body.get(key, existing.get(key, ""))
        val = "" if val is None else str(val).strip()
        if len(val) > 64:
            val = val[:64]
        out[key] = val

    # Optional max_participants (0/empty = unlimited)
    raw_cap = body.get("max_participants", existing.get("max_participants"))
    if raw_cap in (None, "", 0):
        out["max_participants"] = 0
    else:
        try:
            cap = int(raw_cap)
        except (TypeError, ValueError):
            return None, "max_participants must be an integer"
        if cap < 0:
            return None, "max_participants cannot be negative"
        out["max_participants"] = cap

    status = (body.get("status") or existing.get("status") or "upcoming").strip().lower()
    if status not in _EVENT_STATUSES:
        return None, f"Invalid status. Must be one of {sorted(_EVENT_STATUSES)}"
    out["status"] = status

    audience = (
        body.get("audience")
        or existing.get("audience")
        or _EVENT_DEFAULT_AUDIENCE
    )
    audience = str(audience).strip().lower()
    if audience not in _EVENT_AUDIENCES:
        return None, f"Invalid audience. Must be one of {sorted(_EVENT_AUDIENCES)}"
    out["audience"] = audience

    return out, None


@app.route("/api/events", methods=["GET"])
@rate_limit(60)
def events_list():
    user, err = _require_role(_EVENTS_ACCESS)
    if err:
        return err
    data = _load_json_file(_EVENTS_JSON) or {}
    # Lazy auto-transition
    if _auto_transition_events(data):
        _save_json_file(_EVENTS_JSON, data)
    user_roles = set(user.get("roles") or [])
    can_manage_any = bool(user_roles & _EVENTS_MANAGE_ANY)
    user_id = str(user.get("id") or "")
    out = []
    can_pin = _user_can_pin_event(user)
    for ev in data.values():
        if not isinstance(ev, dict):
            continue
        created_by = (ev.get("created_by") or {}).get("id")
        can_manage = can_manage_any or (bool(created_by) and str(created_by) == user_id)
        # copy so we don't mutate storage
        view = dict(ev)
        _migrate_legacy_prize(view)
        view["can_manage"] = can_manage
        view["can_pin"]    = can_pin
        view["pinned"]     = bool(ev.get("pinned"))
        view["pinned_at"]  = ev.get("pinned_at") or 0
        out.append(view)
    def _sort_key(ev):
        status = ev.get("status") or "upcoming"
        active = status in ("upcoming", "ongoing")
        is_pinned = bool(ev.get("pinned"))
        # negate pinned_at so higher timestamps sort first within the pinned group
        pinned_rank = -float(ev.get("pinned_at") or 0)
        ts = str(ev.get("starts_at") or ev.get("created_at") or "")
        created = str(ev.get("created_at") or "")
        return (
            0 if is_pinned else 1,
            pinned_rank,
            0 if active else 1,
            ts if active else "",
            created,
        )
    out.sort(key=_sort_key)
    return jsonify(out)


@app.route("/api/events", methods=["POST"])
@rate_limit(30)
def events_create():
    user, err = _require_role(_EVENTS_ACCESS)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    event, err_msg = _clean_event_payload(body)
    if err_msg:
        return jsonify({"error": err_msg}), 400

    data = _load_json_file(_EVENTS_JSON) or {}
    if not isinstance(data, dict):
        data = {}
    if _auto_transition_events(data):
        _save_json_file(_EVENTS_JSON, data)

    # Sindrian Pride members are limited to one active (upcoming/ongoing) event at once
    user_roles = set(user.get("roles") or [])
    if not (user_roles & _EVENTS_MANAGE_ANY):
        user_id = str(user.get("id") or "")
        active_count = 0
        for ev in data.values():
            if not isinstance(ev, dict):
                continue
            creator = (ev.get("created_by") or {}).get("id")
            if str(creator or "") != user_id:
                continue
            status = (ev.get("status") or "upcoming").lower()
            if status in ("cancelled", "completed"):
                continue
            active_count += 1
        if active_count >= 1:
            return jsonify({
                "error": (
                    "You already have an active event. Cancel or wait for it "
                    "to finish before creating another."
                )
            }), 403

    now = time()
    event_id = secrets.token_urlsafe(10)
    event["id"] = event_id
    event["created_by"] = {
        "id":       str(user.get("id") or ""),
        "username": user.get("nick") or user.get("username") or "",
    }
    event["created_at"] = now
    event["updated_at"] = now
    data[event_id] = event
    _save_json_file(_EVENTS_JSON, data)
    out = dict(event)
    out["can_manage"] = True
    return jsonify(out), 201


@app.route("/api/events/<event_id>", methods=["GET"])
@rate_limit(60)
def events_get(event_id):
    user, err = _require_role(_EVENTS_ACCESS)
    if err:
        return err
    data = _load_json_file(_EVENTS_JSON) or {}
    ev = data.get(event_id)
    if not ev:
        return jsonify({"error": "Event not found"}), 404
    if _auto_transition_event_status(ev):
        data[event_id] = ev
        _save_json_file(_EVENTS_JSON, data)
    out = dict(ev)
    _migrate_legacy_prize(out)
    out["can_manage"] = _user_can_manage_event(user, ev)
    return jsonify(out)


@app.route("/api/events/<event_id>", methods=["PATCH"])
@rate_limit(30)
def events_update(event_id):
    user, err = _require_role(_EVENTS_ACCESS)
    if err:
        return err
    data = _load_json_file(_EVENTS_JSON) or {}
    ev = data.get(event_id)
    if not ev:
        return jsonify({"error": "Event not found"}), 404
    if not _user_can_manage_event(user, ev):
        return jsonify({"error": "You can only edit events you created"}), 403
    body = request.get_json(silent=True) or {}
    existing = _migrate_legacy_prize(dict(ev))
    updated, err_msg = _clean_event_payload(body, existing=existing)
    if err_msg:
        return jsonify({"error": err_msg}), 400
    # preserve immutable fields
    updated["id"]         = ev.get("id", event_id)
    updated["created_by"] = ev.get("created_by") or updated.get("created_by")
    updated["created_at"] = ev.get("created_at") or time()
    updated["updated_at"] = time()
    _enforce_pin_invariants(updated)
    data[event_id] = updated
    _save_json_file(_EVENTS_JSON, data)
    out = dict(updated)
    out["can_manage"] = True
    return jsonify(out)


@app.route("/api/events/<event_id>", methods=["DELETE"])
@rate_limit(30)
def events_delete(event_id):
    user, err = _require_role(_EVENTS_ACCESS)
    if err:
        return err
    data = _load_json_file(_EVENTS_JSON) or {}
    ev = data.get(event_id)
    if not ev:
        return jsonify({"ok": True})
    if not _user_can_manage_event(user, ev):
        return jsonify({"error": "You can only delete events you created"}), 403
    del data[event_id]
    _save_json_file(_EVENTS_JSON, data)
    return jsonify({"ok": True})


# Pin / unpin event

@app.route("/api/events/<event_id>/pin", methods=["POST"])
@rate_limit(30)
def events_pin(event_id):
    user, err = _require_role(_EVENTS_MANAGE_ANY)
    if err:
        return err
    data = _load_json_file(_EVENTS_JSON) or {}
    ev = data.get(event_id)
    if not ev:
        return jsonify({"error": "Event not found"}), 404
    # Only clear other pins that share this event's audience bucket
    new_audience = (ev.get("audience") or _EVENT_DEFAULT_AUDIENCE).strip().lower()
    _unpin_all_events(data, except_id=event_id, audience=new_audience)
    ev["pinned"]     = True
    ev["pinned_at"]  = time()
    ev["updated_at"] = time()
    data[event_id] = ev
    _save_json_file(_EVENTS_JSON, data)
    out = dict(ev)
    _migrate_legacy_prize(out)
    out["can_manage"] = _user_can_manage_event(user, ev)
    out["can_pin"]    = True
    return jsonify(out)


@app.route("/api/events/<event_id>/pin", methods=["DELETE"])
@rate_limit(30)
def events_unpin(event_id):
    user, err = _require_role(_EVENTS_MANAGE_ANY)
    if err:
        return err
    data = _load_json_file(_EVENTS_JSON) or {}
    ev = data.get(event_id)
    if not ev:
        return jsonify({"error": "Event not found"}), 404
    ev["pinned"]     = False
    ev["pinned_at"]  = 0
    ev["updated_at"] = time()
    data[event_id] = ev
    _save_json_file(_EVENTS_JSON, data)
    out = dict(ev)
    _migrate_legacy_prize(out)
    out["can_manage"] = _user_can_manage_event(user, ev)
    out["can_pin"]    = True
    return jsonify(out)


def _public_events_response(payload, max_age=60):
    """Wrap a list payload in a JSON response with ETag + Cache-Control.

    The response is marked private because the payload is filtered per-viewer
    (guild-only events are hidden from non-citizens). Browsers and our
    Service-Worker may cache it locally, but shared/CDN caches must not.
    A conditional request with a matching If-None-Match returns 304 with no
    body to short-circuit the bulk of network/serialisation cost.
    """
    resp = jsonify(payload)
    etag = _hashlib.sha1(resp.get_data()).hexdigest()
    inm = request.headers.get("If-None-Match", "")
    # Strip W/ prefix and surrounding quotes from any inbound ETag(s)
    inm_tags = {t.strip().lstrip("W/").strip('"') for t in inm.split(",") if t.strip()}
    if etag in inm_tags:
        resp = app.response_class(status=304)
    resp.headers["ETag"] = f'"{etag}"'
    resp.headers["Cache-Control"] = f"private, max-age={int(max_age)}"
    resp.headers["Vary"] = "Cookie"
    return resp


# Public endpoint: read-only listing of every event
@app.route("/api/events/public", methods=["GET"])
@rate_limit(60)
def events_list_public():
    data = _load_json_file(_EVENTS_JSON) or {}
    if _auto_transition_events(data):
        _save_json_file(_EVENTS_JSON, data)
    viewer = session.get("user")
    out = []
    for ev in (data.values() if isinstance(data, dict) else []):
        if not isinstance(ev, dict):
            continue
        # Hide guild-only events from anyone without the Sindrian Citizen role
        if not _can_view_event_audience(ev.get("audience"), viewer):
            continue
        view = dict(ev)
        _migrate_legacy_prize(view)
        public = _event_public_view(view)
        if not public:
            continue
        # extra fields useful for the general events page
        public["pinned"]   = bool(ev.get("pinned"))
        cb = ev.get("created_by") or {}
        public["created_by"] = {"username": cb.get("username") or ""}
        public["created_at"]      = ev.get("created_at") or 0
        public["max_participants"] = ev.get("max_participants") or 0
        out.append(public)

    def _sort_key(ev):
        status = (ev.get("status") or "upcoming").lower()
        order = {"ongoing": 0, "upcoming": 1, "completed": 2, "cancelled": 3}.get(status, 4)
        active = status in ("upcoming", "ongoing")
        ts = str(ev.get("starts_at") or ev.get("created_at") or "")
        created = str(ev.get("created_at") or "")
        # active events ascending by start; archived descending by creation
        return (order, ts if active else "", created if not active else "")
    out.sort(key=_sort_key)
    out_active = [e for e in out if (e.get("status") or "upcoming").lower() in ("upcoming", "ongoing")]
    out_archived = [e for e in out if (e.get("status") or "upcoming").lower() not in ("upcoming", "ongoing")]
    out_archived.sort(key=lambda e: str(e.get("created_at") or ""), reverse=True)
    return _public_events_response(out_active + out_archived, max_age=60)


# Public endpoint: returns the single currently-pinned event
@app.route("/api/events/pinned", methods=["GET"])
@rate_limit(60)
def events_pinned_public():
    data = _load_json_file(_EVENTS_JSON) or {}
    # Auto-transition first
    if _auto_transition_events(data):
        _save_json_file(_EVENTS_JSON, data)
    viewer = session.get("user")
    # Bucket pinned events by audience
    pinned_by_audience = {}
    for ev in (data.values() if isinstance(data, dict) else []):
        if not isinstance(ev, dict):
            continue
        if not ev.get("pinned"):
            continue
        # Hide cancelled / already-completed events from the public banner
        if (ev.get("status") or "upcoming") in ("cancelled", "completed"):
            continue
        # Guild-only events stay off the banner for non-citizens / anon users
        if not _can_view_event_audience(ev.get("audience"), viewer):
            continue
        view = dict(ev)
        _migrate_legacy_prize(view)
        public = _event_public_view(view)
        if not public:
            continue
        bucket = (public.get("audience") or _EVENT_DEFAULT_AUDIENCE)
        existing = pinned_by_audience.get(bucket)
        if not existing or float(public.get("pinned_at") or 0) > float(existing.get("pinned_at") or 0):
            pinned_by_audience[bucket] = public
    if _is_guild_member(viewer) and pinned_by_audience.get("guild_only"):
        out = [pinned_by_audience["guild_only"]]
    else:
        out = list(pinned_by_audience.values())
        out.sort(key=lambda e: -float(e.get("pinned_at") or 0))
    return _public_events_response(out, max_age=60)


# discord voice-channel list

_DISCORD_VOICE_CACHE = {"ts": 0.0, "data": None}
_DISCORD_VOICE_TTL   = 60.0
_discord_voice_lock  = _threading.Lock()


@app.route("/api/discord/voice-channels")
@rate_limit(30)
def discord_voice_channels():
    user, err = _require_role(_EVENTS_ACCESS)
    if err:
        return err
    if not DISCORD_TOKEN or not DISCORD_GUILD_ID:
        return jsonify([])
    now = time()
    with _discord_voice_lock:
        cached = _DISCORD_VOICE_CACHE.get("data")
        ts     = _DISCORD_VOICE_CACHE.get("ts", 0.0)
    if cached is not None and now - ts < _DISCORD_VOICE_TTL:
        return jsonify(cached)
    try:
        resp = requests.get(
            f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/channels",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        if not resp.ok:
            return jsonify(cached or []), (200 if cached else 502)
        channels = resp.json()
    except requests.RequestException:
        return jsonify(cached or []), (200 if cached else 502)
    # Discord channel types: 2 = GUILD_VOICE, 4 = GUILD_CATEGORY, 13 = GUILD_STAGE_VOICE
    # `channels` only contains what the bot itself can see
    categories = {c["id"]: c.get("name") or "" for c in channels if c.get("type") == 4}
    voice_category_id = next(
        (cid for cid, cname in categories.items() if cname.strip().lower() == "voice channels"),
        None,
    )
    out = []
    for c in channels:
        ctype = c.get("type")
        if ctype not in (2, 13):
            continue
        if voice_category_id is None or c.get("parent_id") != voice_category_id:
            continue
        out.append({
            "id":       c.get("id"),
            "name":     c.get("name") or "",
            "type":     ctype,
            "category": categories.get(c.get("parent_id") or "", ""),
            "position": c.get("position", 0),
        })
    out.sort(key=lambda x: (
        x.get("position", 0),
        (x.get("name") or "").lower(),
    ))
    with _discord_voice_lock:
        _DISCORD_VOICE_CACHE["ts"]   = now
        _DISCORD_VOICE_CACHE["data"] = out
    return jsonify(out)


_DISCORD_EVENT_URL_RE = _re.compile(
    r"https?://(?:[\w-]+\.)?discord(?:app)?\.com/events/(\d+)/(\d+)",
    _re.IGNORECASE,
)
# Invite links that carry the event id as a query parameter
_DISCORD_INVITE_EVENT_RE = _re.compile(
    r"https?://discord\.gg/[^?#\s]+\?(?:[^#\s]*&)?event=(\d+)",
    _re.IGNORECASE,
)

_DISCORD_CHANNEL_NAME_CACHE: dict = {}
_DISCORD_CHANNEL_NAME_TTL = 300.0
_discord_channel_name_lock = _threading.Lock()


def _parse_discord_event_ref(raw: str):
    """Return (guild_id, event_id) for a Discord event URL or just (None, id)
    for a bare numeric id. Returns (None, None) on failure.
    """
    s = (raw or "").strip()
    if not s:
        return None, None
    if s.isdigit():
        return None, s
    m = _DISCORD_EVENT_URL_RE.search(s)
    if m:
        return m.group(1), m.group(2)
    m = _DISCORD_INVITE_EVENT_RE.search(s)
    if m:
        return None, m.group(1)
    return None, None


def _fetch_discord_channel_name(channel_id: str):
    """Resolve a channel id to its name via the Discord API, with a small TTL
    cache. Returns the name string or '' on failure.
    """
    if not channel_id or not DISCORD_TOKEN:
        return ""
    now = time()
    with _discord_channel_name_lock:
        cached = _DISCORD_CHANNEL_NAME_CACHE.get(channel_id)
    if cached and now - cached[0] < _DISCORD_CHANNEL_NAME_TTL:
        return cached[1]
    try:
        resp = requests.get(
            f"{DISCORD_API}/channels/{channel_id}",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
    except requests.RequestException:
        return cached[1] if cached else ""
    if not resp.ok:
        return cached[1] if cached else ""
    name = (resp.json() or {}).get("name") or ""
    with _discord_channel_name_lock:
        _DISCORD_CHANNEL_NAME_CACHE[channel_id] = (now, name)
    return name


@app.route("/api/discord/scheduled-event", methods=["GET"])
@rate_limit(30)
def discord_scheduled_event():
    """Return the metadata for a Discord scheduled event so the manage-events
    form can prefill its fields. Accepts either a full event URL via ?url=
    or a numeric ID via ?event_id=.
    """
    user, err = _require_role(_EVENTS_ACCESS)
    if err:
        return err
    if not DISCORD_TOKEN or not DISCORD_GUILD_ID:
        return jsonify({"error": "Discord is not configured on this server."}), 503

    raw = (request.args.get("url") or request.args.get("event_id") or "").strip()
    if not raw:
        return jsonify({"error": "Missing url or event_id."}), 400
    parsed_guild, event_id = _parse_discord_event_ref(raw)
    if not event_id:
        return jsonify({"error": "That doesn't look like a Discord event link."}), 400
    # If the URL included a guild id, only accept events that belong to ours.
    # Skip this check when running locally in dev mode
    if not DEV_MODE and parsed_guild and str(parsed_guild) != str(DISCORD_GUILD_ID):
        return jsonify({"error": "This event isn't from the Sindrian Discord."}), 400

    # In dev mode, use the guild id parsed from the URL
    fetch_guild_id = parsed_guild if (DEV_MODE and parsed_guild) else DISCORD_GUILD_ID
    try:
        resp = requests.get(
            f"{DISCORD_API}/guilds/{fetch_guild_id}/scheduled-events/{event_id}",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
    except requests.RequestException:
        return jsonify({"error": "Could not reach Discord. Try again in a moment."}), 502
    if resp.status_code == 404:
        return jsonify({"error": "Discord couldn't find that scheduled event."}), 404
    if not resp.ok:
        return jsonify({"error": "Discord returned an error fetching the event."}), 502

    ev = resp.json() or {}

    # entity_type: 1=STAGE_INSTANCE, 2=VOICE, 3=EXTERNAL
    entity_type = ev.get("entity_type")
    channel_id = ev.get("channel_id") or ""
    channel_name = ""
    location = ""
    if entity_type == 3:
        meta = ev.get("entity_metadata") or {}
        location = (meta.get("location") or "").strip()
    elif channel_id:
        channel_name = _fetch_discord_channel_name(channel_id)
        if channel_name:
            location = "#" + channel_name

    return jsonify({
        "id":           ev.get("id") or event_id,
        "name":         ev.get("name") or "",
        "description":  ev.get("description") or "",
        "starts_at":    ev.get("scheduled_start_time") or "",
        "ends_at":      ev.get("scheduled_end_time") or "",
        "location":     location,
        "channel_id":   channel_id,
        "channel_name": channel_name,
        "entity_type":  entity_type,
    })


# guild stats

@app.route("/api/guild/stats")
@rate_limit(60)
def guild_stats():
    latest_db = _get_latest_api_db()
    if not latest_db:
        return jsonify({})
    try:
        conn = _sqlite3.connect(latest_db, check_same_thread=False)
        row = conn.execute("""
            SELECT
                SUM(mobs_killed),
                SUM(chests_found),
                SUM(completed_quests),
                SUM(raids_total),
                ROUND(SUM(playtime) / 3600.0)
            FROM player_stats
        """).fetchone()
        queue_total = 0
        try:
            queue_row = conn.execute(
                "SELECT total_count FROM queue_stats ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
            if queue_row and queue_row[0] is not None:
                queue_total = max(0, int(round(_safe_number(queue_row[0]))))
        except Exception:
            queue_total = 0
        conn.close()
        return jsonify({
            "mobsKilled":      int(row[0] or 0),
            "chestsFound":     int(row[1] or 0),
            "questsCompleted": int(row[2] or 0),
            "contentDone":     int(row[3] or 0),
            "totalPlaytime":   int(row[4] or 0),
            "queueTotal":      queue_total,
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/player/<username>")
@rate_limit(10)
def player(username: str):
    def _friendly_http_error(e):
        status = e.response.status_code if e.response is not None else 502
        if status == 404:
            abort(404, description=f'Player "{username}" was not found on Wynncraft. Check the username and try again.')
        if status == 429:
            abort(429, description="Wynncraft is rate limiting requests right now. Please wait a moment and try again.")
        if status >= 500:
            abort(502, description="Wynncraft is having trouble right now. Please try again in a moment.")
        abort(502, description="Could not fetch player data from Wynncraft. Please try again.")

    try:
        data = cached_get(f"{WYNN_BASE}/player/{username}?fullResult")
        return jsonify(data)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        if status in (404, 429) or status >= 500:
            _friendly_http_error(e)
    except (requests.Timeout, requests.RequestException):
        abort(502, description="Could not reach Wynncraft right now. Please try again.")

    try:
        data = cached_get(f"{WYNN_BASE}/player/{username}")
        resp = jsonify(data)
        resp.headers['X-Wynncraft-Fallback'] = '1'
        return resp
    except requests.HTTPError as e:
        _friendly_http_error(e)
    except requests.Timeout:
        abort(502, description="Wynncraft took too long to respond. Please try again.")
    except requests.RequestException:
        abort(502, description="Could not reach Wynncraft right now. Please try again.")


@app.route("/api/guild/prefix/<prefix>")
@rate_limit(10)
def guild_by_prefix(prefix: str):
    try:
        data = cached_get(f"{WYNN_BASE}/guild/prefix/{prefix}")
        return jsonify(data)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        abort(status, description=f"Wynncraft API error: {e}")
    except requests.RequestException as e:
        abort(502, description=f"Could not reach Wynncraft API: {e}")


@app.route("/api/guild/name/<name>")
@rate_limit(60)
def guild_by_name(name: str):
    try:
        data = cached_get(f"{WYNN_BASE}/guild/{name}")
        return jsonify(data)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        abort(status, description=f"Wynncraft API error: {e}")
    except requests.RequestException as e:
        abort(502, description=f"Could not reach Wynncraft API: {e}")


# bot info / status

@app.route("/api/bot/info")
@rate_limit(30)
def bot_info():
    if not DISCORD_TOKEN:
        return jsonify({"error": "No bot token configured"}), 503
    try:
        resp = requests.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        resp.raise_for_status()
        return jsonify(resp.json())
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        abort(status, description=f"Discord API error: {e}")
    except requests.RequestException as e:
        abort(502, description=f"Could not reach Discord API: {e}")


@app.route("/api/bot/discord")
@rate_limit(30)
def bot_discord_snapshot():
    if not DISCORD_TOKEN or not DISCORD_GUILD_ID:
        return jsonify({"error": "Not configured"}), 503
    try:
        resp = requests.get(
            f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}?with_counts=true",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        resp.raise_for_status()
        g = resp.json()
        return jsonify({
            "name":          g.get("name"),
            "icon":          g.get("icon"),
            "member_count":  g.get("approximate_member_count"),
            "online_count":  g.get("approximate_presence_count"),
            "boost_level":   g.get("premium_tier", 0),
            "boost_count":   g.get("premium_subscription_count", 0),
            "channel_count": len(g.get("channels", [])),
        })
    except requests.RequestException as e:
        abort(502, description=f"Could not reach Discord API: {e}")


@app.route("/api/guild/member-history")
@rate_limit(60)
def guild_member_history():
    data = _load_json_file(_TRACKED_GUILD_JSON)
    if not data:
        return jsonify([])
    return jsonify(data.get("event_history", []))


@app.route("/api/guild/levels")
@rate_limit(60)
def guild_levels_get():
    data = _load_json_file(_GUILD_LEVELS_JSON)
    if not data:
        return jsonify({})
    return jsonify(data)


@app.route("/api/guild/territories")
@rate_limit(60)
def guild_territories_get():
    data = _load_json_file(_GUILD_TERRITORIES_JSON)
    if not data:
        return jsonify({})
    return jsonify({
        "guild":       data.get("guild"),
        "territories": data.get("territories", {}),
        "history":     data.get("history", []),
        "last_update": data.get("last_update"),
    })


def _snipes_player_table(uuid: str) -> str:
    """Mirror ESI-Bot claim_snipe.py table naming convention."""
    return "player_" + (uuid or "").replace("-", "_")


@app.route("/api/guild/snipes")
@rate_limit(30)
def guild_snipes():
    """Return claim-snipe records, per-player aggregates, and overall stats.

    If the claim_snipes.db file does not exist or contains no snipes, returns
    ``{"available": false}`` so the frontend can hide the view entirely.
    """
    if not os.path.exists(_SNIPES_DB):
        return jsonify({"available": False})

    try:
        conn = _sqlite3.connect(_SNIPES_DB)
        conn.row_factory = _sqlite3.Row
        c = conn.cursor()

        # Bail out cleanly if the schema hasn't been initialised yet.
        c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='snipes'"
        )
        if not c.fetchone():
            conn.close()
            return jsonify({"available": False})

        c.execute(
            "SELECT snipe_id, base_damage, base_speed, points, player_uuids, timestamp "
            "FROM snipes ORDER BY timestamp DESC"
        )
        snipe_rows = c.fetchall()
        if not snipe_rows:
            conn.close()
            return jsonify({"available": False})

        # Load every per-player table once so we don't issue N*M queries.
        c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'player_%'"
        )
        player_tables = [row[0] for row in c.fetchall()]

        # participants[uuid][snipe_id] = {"username": str, "role": str}
        participants: dict = {}
        for table in player_tables:
            if not table.startswith("player_"):
                continue
            # Reverse the underscore substitution to recover the UUID.
            uuid = table[len("player_"):].replace("_", "-")
            try:
                c.execute(f'SELECT snipe_id, username, role FROM "{table}"')
                rows = c.fetchall()
            except _sqlite3.OperationalError:
                continue
            bucket = participants.setdefault(uuid, {})
            for r in rows:
                bucket[r[0]] = {
                    "username": r[1] or "",
                    "role": r[2] or "Unknown",
                }

        conn.close()
    except _sqlite3.Error as e:
        return jsonify({"available": False, "error": str(e)}), 200

    snipes_out = []
    player_stats: dict = {}
    overall_roles: dict = {}
    total_points = 0
    damage_sum = 0.0
    speed_sum = 0.0

    for row in snipe_rows:
        snipe_id = row["snipe_id"]
        try:
            uuids = json.loads(row["player_uuids"] or "[]")
            if not isinstance(uuids, list):
                uuids = []
        except (TypeError, ValueError):
            uuids = []

        snipe_players = []
        for uuid in uuids:
            info = participants.get(uuid, {}).get(snipe_id)
            if info is None:
                snipe_players.append({
                    "uuid": uuid,
                    "username": "",
                    "role": "Unknown",
                })
                continue
            snipe_players.append({
                "uuid": uuid,
                "username": info["username"],
                "role": info["role"],
            })

        base_damage = float(row["base_damage"] or 0)
        base_speed = float(row["base_speed"] or 0)
        points = int(row["points"] or 0)
        timestamp = row["timestamp"]

        snipes_out.append({
            "snipe_id": snipe_id,
            "base_damage": base_damage,
            "base_speed": base_speed,
            "points": points,
            "timestamp": timestamp,
            "players": snipe_players,
        })

        total_points += points
        damage_sum += base_damage
        speed_sum += base_speed

        for p in snipe_players:
            uuid = p["uuid"]
            if not uuid:
                continue
            role = p["role"] or "Unknown"
            overall_roles[role] = overall_roles.get(role, 0) + 1
            stat = player_stats.get(uuid)
            if stat is None:
                stat = {
                    "uuid": uuid,
                    "username": p["username"],
                    "snipe_count": 0,
                    "total_points": 0,
                    "roles": {},
                    "last_snipe": timestamp,
                    "_damage_sum": 0.0,
                    "_speed_sum": 0.0,
                }
                player_stats[uuid] = stat
            stat["snipe_count"] += 1
            stat["total_points"] += points
            stat["roles"][role] = stat["roles"].get(role, 0) + 1
            stat["_damage_sum"] += base_damage
            stat["_speed_sum"] += base_speed
            # Keep the most recent username we saw for this player.
            if p["username"] and (timestamp or "") >= (stat["last_snipe"] or ""):
                stat["username"] = p["username"]
                stat["last_snipe"] = timestamp

    players_out = []
    for stat in player_stats.values():
        count = stat["snipe_count"] or 1
        primary_role = (
            max(stat["roles"].items(), key=lambda kv: kv[1])[0]
            if stat["roles"] else "Unknown"
        )
        players_out.append({
            "uuid": stat["uuid"],
            "username": stat["username"],
            "snipe_count": stat["snipe_count"],
            "total_points": stat["total_points"],
            "roles": stat["roles"],
            "primary_role": primary_role,
            "last_snipe": stat["last_snipe"],
            "avg_damage": round(stat["_damage_sum"] / count, 2),
            "avg_speed": round(stat["_speed_sum"] / count, 3),
        })
    players_out.sort(
        key=lambda p: (-p["total_points"], -p["snipe_count"], (p["username"] or "").lower())
    )

    total_snipes = len(snipes_out)
    stats_payload = {
        "total_snipes": total_snipes,
        "total_points": total_points,
        "unique_players": len(players_out),
        "avg_damage": round(damage_sum / total_snipes, 2) if total_snipes else 0,
        "avg_speed": round(speed_sum / total_snipes, 3) if total_snipes else 0,
        "roles_distribution": overall_roles,
    }

    return jsonify({
        "available": True,
        "snipes": snipes_out,
        "players": players_out,
        "stats": stats_payload,
    })


@app.route("/api/player/<username>/snipes")
@rate_limit(30)
def player_snipes(username: str):
    """Return snipes + aggregate stats for a single player (by username).

    If the DB is missing or the player has never been recorded in a snipe,
    returns ``{"available": false}`` so the frontend can hide the view.
    """
    if not os.path.exists(_SNIPES_DB):
        return jsonify({"available": False})

    ulow = (username or "").strip().lower()
    if not ulow:
        return jsonify({"available": False})

    try:
        conn = _sqlite3.connect(_SNIPES_DB)
        conn.row_factory = _sqlite3.Row
        c = conn.cursor()

        c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='snipes'"
        )
        if not c.fetchone():
            conn.close()
            return jsonify({"available": False})

        # Find any player table that has a row with this username.
        c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'player_%'"
        )
        player_tables = [row[0] for row in c.fetchall()]

        # Collect every (snipe_id, role, display_username) for the requested user
        # across any table where they appear. Most players only show up in their
        # own table, but usernames can change so we search defensively.
        snipe_role_map: dict = {}
        resolved_username = None
        resolved_uuid = None
        for table in player_tables:
            try:
                c.execute(
                    f'SELECT snipe_id, username, role FROM "{table}" '
                    f'WHERE LOWER(username) = ?',
                    (ulow,),
                )
                rows = c.fetchall()
            except _sqlite3.OperationalError:
                continue
            if not rows:
                continue
            for r in rows:
                sid = r[0]
                if sid in snipe_role_map:
                    continue
                snipe_role_map[sid] = {
                    "username": r[1] or username,
                    "role": r[2] or "Unknown",
                }
                if not resolved_username:
                    resolved_username = r[1] or username
                if not resolved_uuid and table.startswith("player_"):
                    resolved_uuid = table[len("player_"):].replace("_", "-")

        if not snipe_role_map:
            conn.close()
            return jsonify({
                "available": True,
                "found": False,
                "username": username,
            })

        # Load the matching snipes (and every participant, for display).
        placeholders = ",".join("?" * len(snipe_role_map))
        c.execute(
            f"SELECT snipe_id, base_damage, base_speed, points, player_uuids, timestamp "
            f"FROM snipes WHERE snipe_id IN ({placeholders}) "
            f"ORDER BY timestamp DESC",
            list(snipe_role_map.keys()),
        )
        snipe_rows = c.fetchall()

        # Pre-load participant tables so we can build each snipe's roster.
        participants: dict = {}
        for table in player_tables:
            if not table.startswith("player_"):
                continue
            uuid = table[len("player_"):].replace("_", "-")
            try:
                c.execute(f'SELECT snipe_id, username, role FROM "{table}"')
                rows = c.fetchall()
            except _sqlite3.OperationalError:
                continue
            bucket = participants.setdefault(uuid, {})
            for r in rows:
                bucket[r[0]] = {
                    "username": r[1] or "",
                    "role": r[2] or "Unknown",
                }

        conn.close()
    except _sqlite3.Error as e:
        return jsonify({"available": False, "error": str(e)}), 200

    snipes_out = []
    roles_breakdown: dict = {}
    total_points = 0
    damage_sum = 0.0
    speed_sum = 0.0
    last_snipe = None

    for row in snipe_rows:
        snipe_id = row["snipe_id"]
        try:
            uuids = json.loads(row["player_uuids"] or "[]")
            if not isinstance(uuids, list):
                uuids = []
        except (TypeError, ValueError):
            uuids = []

        snipe_players = []
        for uuid in uuids:
            info = participants.get(uuid, {}).get(snipe_id)
            if info is None:
                snipe_players.append({
                    "uuid": uuid,
                    "username": "",
                    "role": "Unknown",
                })
                continue
            snipe_players.append({
                "uuid": uuid,
                "username": info["username"],
                "role": info["role"],
            })

        base_damage = float(row["base_damage"] or 0)
        base_speed = float(row["base_speed"] or 0)
        points = int(row["points"] or 0)
        timestamp = row["timestamp"]
        my_role = snipe_role_map[snipe_id]["role"]

        snipes_out.append({
            "snipe_id": snipe_id,
            "base_damage": base_damage,
            "base_speed": base_speed,
            "points": points,
            "timestamp": timestamp,
            "my_role": my_role,
            "players": snipe_players,
        })

        total_points += points
        damage_sum += base_damage
        speed_sum += base_speed
        roles_breakdown[my_role] = roles_breakdown.get(my_role, 0) + 1
        if timestamp and (last_snipe is None or timestamp > last_snipe):
            last_snipe = timestamp

    total_snipes = len(snipes_out)
    primary_role = (
        max(roles_breakdown.items(), key=lambda kv: kv[1])[0]
        if roles_breakdown else "Unknown"
    )
    stats_payload = {
        "total_snipes": total_snipes,
        "total_points": total_points,
        "primary_role": primary_role,
        "avg_damage": round(damage_sum / total_snipes, 2) if total_snipes else 0,
        "avg_speed": round(speed_sum / total_snipes, 3) if total_snipes else 0,
        "last_snipe": last_snipe,
        "roles": roles_breakdown,
    }

    return jsonify({
        "available": True,
        "found": True,
        "username": resolved_username or username,
        "uuid": resolved_uuid,
        "snipes": snipes_out,
        "stats": stats_payload,
    })


# public API routes

@app.route("/api/player/rank-history/<username>")
@rate_limit(10)
def public_rank_history(username: str):
    data = _load_json_file(_TRACKED_GUILD_JSON)
    member_history = data.get("member_history", {})
    ulow = username.lower()
    for entry in member_history.values():
        if (entry.get("username") or "").lower() == ulow:
            changes = entry.get("rank_changes") or []
            if changes:
                return jsonify({
                    "username": entry["username"],
                    "rank_changes": changes,
                    "joined": entry.get("joined"),
                })
            break
    return jsonify({"username": username, "rank_changes": []})


_playtime_cache: dict = {}
_playtime_cache_lock = _threading.Lock()


@app.route("/api/player/playtime/<username>")
@rate_limit(10)
def public_playtime(username: str):
    from datetime import datetime as _dt
    from concurrent.futures import ThreadPoolExecutor
    now = time()
    cache_key = username.lower()
    with _playtime_cache_lock:
        _pt_entry = _playtime_cache.get(cache_key)
    if _pt_entry:
        cached, ts = _pt_entry
        if now - ts < PLAYTIME_CACHE_TTL:
            return jsonify({"username": cached["username"], "data": cached["data"]})
    tracking_folder = os.path.join(_ESI_BOT_DIR, "databases", "playtime_tracking")
    if not os.path.isdir(tracking_folder):
        return jsonify({"username": username, "data": []})
    all_snapshots = []
    for day_folder_name in os.listdir(tracking_folder):
        if not day_folder_name.startswith("playtime_"):
            continue
        day_folder_path = os.path.join(tracking_folder, day_folder_name)
        if not os.path.isdir(day_folder_path):
            continue
        date_str = day_folder_name.replace("playtime_", "")
        try:
            day_dt = _dt.strptime(date_str, "%d-%m-%Y")
        except ValueError:
            continue
        for fname in os.listdir(day_folder_path):
            if fname.endswith(".db"):
                all_snapshots.append((day_dt, fname, os.path.join(day_folder_path, fname)))
    if not all_snapshots:
        return jsonify({"username": username, "data": []})
    all_snapshots.sort(key=lambda x: (x[0], x[1]))

    def read_hours(db_path):
        try:
            conn = _sqlite3.connect(db_path, check_same_thread=False)
            row = conn.execute("SELECT playtime_seconds FROM playtime WHERE username = ? COLLATE NOCASE", (username,)).fetchone()
            conn.close()
            return round(row[0] / 3600, 1) if row else 0.0
        except Exception:
            return 0.0
    day_groups = {}
    for day_dt, fname, db_path in all_snapshots:
        day_groups.setdefault(day_dt.date(), []).append((fname, db_path))
    sorted_days = sorted(day_groups.keys())[-60:]
    daily_paths = [day_groups[d][-1][1] for d in sorted_days]
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = dict(zip(daily_paths, ex.map(read_hours, daily_paths)))
    daily = [results[p] for p in daily_paths]
    return jsonify({"username": username, "data": daily})


@app.route("/api/player/metrics/<username>")
@rate_limit(30)
def public_metrics(username: str):
    ulow = username.lower()
    member = _fetch_cache(f"/cache/activity/member/{ulow}")
    metrics = {}
    for key in PLAYER_BULK_METRIC_KEYS:
        if key == "playtime":
            metrics[key] = list(member.get("data", [])) if member else []
        elif key == "contentDone":
            if member and isinstance(member.get("wars"), list):
                metrics[key] = [0] * len(member.get("wars", []))
            else:
                metrics[key] = []
        else:
            metrics[key] = list(member.get(key, [])) if member else []
    return jsonify({
        "username": member.get("username", username) if member else username,
        "metrics":  metrics,
    })


# bot status / trackers

_DURATION_UNITS_RE = _re.compile(
    r"(\d+)\s*(hours?|hrs?|h|minutes?|mins?|m|seconds?|secs?|s)\b",
    _re.IGNORECASE,
)
_DURATION_CLOCK_RE = _re.compile(r"(?<!\d)(\d{1,2}):(\d{2})(?::(\d{2}))?(?!\d)")
_bot_status_cache = {"data": None, "ts": 0}
_bot_status_lock = _threading.Lock()


def _run_capture(args, timeout=4):
    try:
        proc = subprocess.run(
            args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            text=True, timeout=timeout, check=False,
        )
        return proc.returncode, proc.stdout or "", proc.stderr or ""
    except (OSError, subprocess.SubprocessError):
        return None, "", ""


def _screen_session_pid(session_name):
    if not session_name:
        return None
    code, out, err = _run_capture(["screen", "-ls"], timeout=4)
    if code is None:
        return None
    text = (out or "") + "\n" + (err or "")
    m = _re.search(rf"^\s*(\d+)\.{_re.escape(session_name)}\s", text, _re.MULTILINE)
    if not m:
        return None
    try:
        return int(m.group(1))
    except (TypeError, ValueError):
        return None


def _screen_session_uptime_seconds(session_name):
    pid = _screen_session_pid(session_name)
    if not pid:
        return None
    code, out, _ = _run_capture(["ps", "-o", "etimes=", "-p", str(pid)], timeout=4)
    if code is None:
        return None
    m = _re.search(r"\d+", out or "")
    if not m:
        return None
    try:
        return int(m.group(0))
    except (TypeError, ValueError):
        return None


def _read_screen_hardcopy(session_name):
    if not session_name:
        return ""
    fd, tmp_path = tempfile.mkstemp(prefix="esi_screen_", suffix=".log")
    os.close(fd)
    try:
        code, _, _ = _run_capture(["screen", "-S", session_name, "-X", "hardcopy", "-h", tmp_path], timeout=5)
        if code != 0:
            return ""
        with open(tmp_path, "r", encoding="utf-8", errors="ignore") as f:
            return f.read()
    except OSError:
        return ""
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def _parse_duration_seconds(text):
    if not text:
        return None
    total = 0
    found_units = False
    for amt, unit in _DURATION_UNITS_RE.findall(text):
        try:
            n = int(amt)
        except (TypeError, ValueError):
            continue
        u = (unit or "").lower()
        if u.startswith("h"):
            total += n * 3600
        elif u.startswith("m"):
            total += n * 60
        else:
            total += n
        found_units = True
    if found_units and total > 0:
        return total
    lower = text.lower()
    if not any(hint in lower for hint in ("left", "remaining", "next", "eta", " in ")):
        return None
    m = _DURATION_CLOCK_RE.search(text)
    if not m:
        return None
    try:
        a = int(m.group(1))
        b = int(m.group(2))
        c = m.group(3)
        if c is None:
            return (a * 60) + b
        return (a * 3600) + (b * 60) + int(c)
    except (TypeError, ValueError):
        return None


def _normalize_remaining(seconds, interval):
    try:
        s = int(seconds)
    except (TypeError, ValueError):
        return None
    if s <= 0:
        return interval
    if interval <= 0:
        return s
    if s > interval:
        s = s % interval
        if s == 0:
            s = interval
    return s


def _extract_tracker_countdowns(console_text):
    lines = (console_text or "").splitlines()
    by_name = {}
    for line in reversed(lines):
        low = line.lower()
        for spec in TRACKER_SCREEN_SPECS:
            name = spec["name"]
            if name in by_name:
                continue
            if not any(k in low for k in spec["keywords"]):
                continue
            seconds = _parse_duration_seconds(line)
            if seconds is None:
                continue
            remaining = _normalize_remaining(seconds, spec["interval"])
            if remaining is None:
                continue
            by_name[name] = remaining
        if len(by_name) == len(TRACKER_SCREEN_SPECS):
            break
    return by_name


def _remaining_from_last_update(last_update_ts, interval, now_ts=None):
    if last_update_ts is None:
        return None
    try:
        interval = int(interval)
    except (TypeError, ValueError):
        return None
    if interval <= 0:
        return None
    if now_ts is None:
        now_ts = time()
    elapsed = int(max(0, now_ts - float(last_update_ts)))
    stale_after = max(interval * 20, interval + 120)
    if elapsed > stale_after:
        return None
    remaining = interval - (elapsed % interval)
    if remaining <= 0 or remaining > interval:
        remaining = interval
    return remaining


def _safe_mtime(path):
    if not path:
        return None
    try:
        if os.path.isfile(path):
            return os.path.getmtime(path)
    except OSError:
        return None
    return None


def _first_existing_mtime(paths):
    for p in paths:
        mt = _safe_mtime(p)
        if mt is not None:
            return mt
    return None


def _estimate_tracker_countdowns_from_files():
    now_ts = time()
    api_latest = _get_latest_api_db()
    playtime_db = os.path.join(_ESI_BOT_DIR, "databases", "playtime_tracking.db")
    tracked_guild_root = os.path.join(_ESI_BOT_DIR, "tracked_guild.json")
    territories_root = os.path.join(_ESI_BOT_DIR, "guild_territories.json")
    guild_mtime = _first_existing_mtime([_TRACKED_GUILD_JSON, tracked_guild_root])
    claim_mtime = _first_existing_mtime([_GUILD_TERRITORIES_JSON, territories_root])
    return {
        "API Tracker": _remaining_from_last_update(_safe_mtime(api_latest), 300, now_ts=now_ts),
        "Playtime Tracker": _remaining_from_last_update(_safe_mtime(playtime_db), 300, now_ts=now_ts),
        "Guild Tracker": _remaining_from_last_update(guild_mtime, 30, now_ts=now_ts),
        "Claim Tracker": _remaining_from_last_update(claim_mtime, 3, now_ts=now_ts),
    }


@app.route("/api/bot/status")
@rate_limit(30)
def bot_status():
    now = time()
    screen_uptime = _screen_session_uptime_seconds(BOT_SCREEN_SESSION)
    status_path = os.path.join(_BASE_DIR, "bot_status.json")
    if os.path.exists(status_path):
        try:
            with open(status_path) as f:
                data = json.load(f)
            last_hb = data.get("last_heartbeat", 0)
            if time() - last_hb > 60:
                data["online"] = False
            if screen_uptime is not None:
                data["uptime_seconds"] = int(screen_uptime)
                data["uptime_since"] = int(now - screen_uptime)
            return jsonify(data)
        except (json.JSONDecodeError, IOError):
            pass
    with _bot_status_lock:
        _bsc = (_bot_status_cache["data"], _bot_status_cache["ts"])
    if now - _bsc[1] < 60 and _bsc[0] is not None:
        cached = dict(_bsc[0])
        if screen_uptime is not None:
            cached["uptime_seconds"] = int(screen_uptime)
            cached["uptime_since"] = int(now - screen_uptime)
        return jsonify(cached)
    if DISCORD_TOKEN:
        try:
            start = time()
            resp = requests.get(
                f"{DISCORD_API}/users/@me",
                headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
                timeout=10,
            )
            latency_ms = round((time() - start) * 1000)
            if resp.ok:
                result = {
                    "online": True,
                    "latency": latency_ms,
                    "uptime_since": int(now - screen_uptime) if screen_uptime is not None else None,
                    "uptime_seconds": int(screen_uptime) if screen_uptime is not None else None,
                    "last_heartbeat": None,
                }
                with _bot_status_lock:
                    _bot_status_cache["data"] = result
                    _bot_status_cache["ts"] = now
                return jsonify(result)
        except requests.RequestException:
            pass
    offline = {
        "online": bool(screen_uptime),
        "latency": None,
        "uptime_since": int(now - screen_uptime) if screen_uptime is not None else None,
        "uptime_seconds": int(screen_uptime) if screen_uptime is not None else None,
        "last_heartbeat": None,
    }
    with _bot_status_lock:
        _bot_status_cache["data"] = offline
        _bot_status_cache["ts"] = now
    return jsonify(offline)


@app.route("/api/bot/trackers")
@rate_limit(30)
def bot_trackers():
    console_text = _read_screen_hardcopy(TRACKER_SCREEN_SESSION)
    by_name = _extract_tracker_countdowns(console_text)
    by_file = _estimate_tracker_countdowns_from_files()
    trackers = []
    screen_has_values = any(v is not None for v in by_name.values())
    file_has_values = any(v is not None for v in by_file.values())
    for spec in TRACKER_SCREEN_SPECS:
        screen_value = by_name.get(spec["name"])
        file_value = by_file.get(spec["name"])
        trackers.append({
            "name": spec["name"],
            "interval": spec["interval"],
            "remaining_seconds": screen_value if screen_value is not None else file_value,
        })
    # Activity data refresh - from cache service
    status = _fetch_cache("/cache/status") or {}
    activity_ts = status.get("cache_ts", 0)
    activity_remaining = _remaining_from_last_update(activity_ts if activity_ts else None, BULK_PLAYTIME_REFRESH)
    trackers.append({
        "name": "Activity Data Refresh",
        "interval": BULK_PLAYTIME_REFRESH,
        "remaining_seconds": activity_remaining,
    })
    source = "fallback"
    if screen_has_values:
        source = "screen"
    elif file_has_values:
        source = "file"
    elif console_text:
        source = "screen-unparsed"
    tracker_uptime = _screen_session_uptime_seconds(TRACKER_SCREEN_SESSION)
    return jsonify({
        "trackers": trackers,
        "source": source,
        "uptime_seconds": int(tracker_uptime) if tracker_uptime is not None else None,
    })


# IP ban summary (Cuck List)

_IP_BAN_DB = os.path.join(_BASE_DIR, "logs", "ip_bans.db")


def _truncate_ip_for_display(ip):
    """Return a GDPR-anonymised version of *ip* for display.

    IPv4: zero the last octet      (203.0.113.42  -> 203.0.113.0)
    IPv6: keep first 3 hextets     (2001:db8:1::1 -> 2001:db8:1::)
    Matches the truncation scheme used by access_logger for stored IPs.
    """
    if not ip:
        return "unknown"
    if ":" in ip:
        parts = ip.split(":")
        kept = [p for p in parts[:3] if p]
        return ":".join(kept) + "::" if kept else "::"
    if "." in ip:
        parts = ip.split(".")
        if len(parts) == 4:
            parts[-1] = "0"
            return ".".join(parts)
    return ip


@app.route("/api/bot/ip-bans")
@rate_limit(30)
def bot_ip_bans():
    """Return a summary of the IP ban system (Cuck List).

    All IPs are truncated (last octet / last 80 bits zeroed) before leaving
    the server, so the response is safe to display under GDPR
    legitimate-interest processing (Art. 6(1)(f)) without exposing
    identifiable personal data to the browser.
    """
    empty = {
        "available": False,
        "truncated": True,
        "total_blacklists": 0,
        "total_temp_bans": 0,
        "categories": [],
    }
    if not os.path.exists(_IP_BAN_DB):
        return jsonify(empty)

    now = time()
    try:
        conn = _sqlite3.connect(_IP_BAN_DB, timeout=5, check_same_thread=False)
        conn.row_factory = _sqlite3.Row
        try:
            temp_rows = conn.execute(
                "SELECT ip, expires_at, jail, banned_at, ban_count"
                " FROM active_bans WHERE expires_at > ?"
                " ORDER BY banned_at DESC",
                (now,),
            ).fetchall()
        except _sqlite3.OperationalError:
            temp_rows = []
        try:
            bl_rows = conn.execute(
                "SELECT ip, reason, added_at FROM blacklist ORDER BY added_at DESC"
            ).fetchall()
        except _sqlite3.OperationalError:
            bl_rows = []
        conn.close()
    except _sqlite3.Error:
        return jsonify(empty)

    def _format_temp(r):
        expires_at = r["expires_at"] or 0
        return {
            "ip": _truncate_ip_for_display(r["ip"]),
            "expires_at": expires_at,
            "remaining_seconds": max(0, int(expires_at - now)),
            "jail": r["jail"] or "unknown",
            "banned_at": r["banned_at"] or 0,
            "ban_count": r["ban_count"] or 1,
        }

    # Normalise reasons so near-duplicates (e.g. different N in
    # "Auto-blacklisted after N temporary bans", or the same error class
    # with different detail payloads) collapse into one group, while every
    # distinct prefix keeps its own category.
    _AUTO_BL_RE = _re.compile(
        r"^auto-blacklisted after \d+ temporary bans?$", _re.IGNORECASE
    )

    def _group_for(reason):
        reason = (reason or "").strip()
        if not reason:
            return "Unspecified"
        if _AUTO_BL_RE.match(reason):
            return "Auto-blacklisted"
        # Everything before the first `: ` is treated as the category.
        # This collapses e.g. `WordPress probe: /wp-admin/setup-config.php`
        # and `WordPress probe: /wp-login.php` into `WordPress probe`, and
        # `Malformed HTTP (code 400): "..."` / `...: '...'` into
        # `Malformed HTTP (code 400)`.
        idx = reason.find(": ")
        if idx > 0:
            prefix = reason[:idx].rstrip().rstrip(":").strip()
            if prefix:
                return prefix
        return reason

    def _format_bl(r):
        reason = (r["reason"] or "").strip()
        return {
            "ip": _truncate_ip_for_display(r["ip"]),
            "reason": reason,
            "added_at": r["added_at"] or 0,
            "group": _group_for(reason),
        }

    def _slugify(s):
        return _re.sub(r"[^a-z0-9]+", "_", s.lower()).strip("_") or "group"

    temp_entries = [_format_temp(r) for r in temp_rows]
    bl_entries = [_format_bl(r) for r in bl_rows]

    # Bucket blacklist entries by their normalised reason, preserving first
    # appearance order within each group.
    groups = {}
    group_order = []
    for entry in bl_entries:
        g = entry["group"]
        if g not in groups:
            groups[g] = []
            group_order.append(g)
        groups[g].append(entry)

    categories = [
        {
            "key": "blacklists_all",
            "label": "Total Blacklists",
            "count": len(bl_entries),
            "type": "blacklist",
            "entries": bl_entries,
        },
        {
            "key": "temp_bans_all",
            "label": "Total Temp Bans",
            "count": len(temp_entries),
            "type": "temp",
            "entries": temp_entries,
        },
    ]

    # One category per distinct reason, sorted by count descending so the
    # most common reasons bubble to the top.
    dynamic_categories = [
        {
            "key": "blacklists_" + _slugify(name),
            "label": name,
            "count": len(entries),
            "type": "blacklist",
            "entries": entries,
        }
        for name, entries in sorted(
            ((n, groups[n]) for n in group_order),
            key=lambda kv: (-len(kv[1]), kv[0].lower()),
        )
    ]
    categories.extend(dynamic_categories)

    return jsonify({
        "available": True,
        "truncated": True,
        "total_blacklists": len(bl_entries),
        "total_temp_bans": len(temp_entries),
        "categories": categories,
    })


@app.route("/api/bot/databases")
@rate_limit(30)
def bot_databases():
    from datetime import datetime as _dt

    db_root = os.path.join(_ESI_BOT_DIR, "databases")

    def folder_size(path):
        total = 0
        if os.path.isdir(path):
            for dirpath, _dirs, filenames in os.walk(path):
                for fname in filenames:
                    try:
                        total += os.path.getsize(os.path.join(dirpath, fname))
                    except OSError:
                        pass
        return total

    def folder_date_span(path, prefix):
        dates = []
        if os.path.isdir(path):
            for name in os.listdir(path):
                if not name.startswith(prefix):
                    continue
                date_str = name[len(prefix):]
                try:
                    dates.append(_dt.strptime(date_str, "%d-%m-%Y").date())
                except ValueError:
                    continue
        if not dates:
            return None, None, 0
        earliest = min(dates)
        latest = max(dates)
        total_days = (latest - earliest).days + 1
        return earliest.isoformat(), latest.isoformat(), total_days

    playtime_path = os.path.join(db_root, "playtime_tracking")
    api_path      = os.path.join(db_root, "api_tracking")
    playtime_size = folder_size(playtime_path)
    api_size      = folder_size(api_path)
    total_size    = folder_size(db_root)
    pt_earliest, pt_latest, pt_days = folder_date_span(playtime_path, "playtime_")
    api_earliest, api_latest, api_days_count = folder_date_span(api_path, "api_")

    return jsonify({
        "total_size": total_size,
        "folders": {
            "playtime_tracking": {
                "total_size": playtime_size,
                "earliest_date": pt_earliest,
                "latest_date": pt_latest,
                "total_days": pt_days,
            },
            "api_tracking": {
                "total_size": api_size,
                "earliest_date": api_earliest,
                "latest_date": api_latest,
                "total_days": api_days_count,
            },
        },
    })


# user settings

@app.route("/api/settings", methods=["GET"])
@rate_limit(60)
def settings_get():
    user, err = _require_login()
    if err:
        return err
    discord_id = user.get("id", "")
    conn = _get_db()
    row = conn.execute(
        "SELECT settings FROM user_settings WHERE discord_id = ?", (discord_id,)
    ).fetchone()
    if row:
        try:
            return jsonify(json.loads(row[0]))
        except json.JSONDecodeError:
            pass
    return jsonify({})


@app.route("/api/settings", methods=["PUT"])
@rate_limit(60)
def settings_put():
    user, err = _require_login()
    if err:
        return err
    discord_id = user.get("id", "")
    body = request.get_json(silent=True)
    if body is None or not isinstance(body, dict):
        return jsonify({"error": "Invalid settings"}), 400
    now = time()
    settings_str = json.dumps(body)
    conn = _get_db()
    conn.execute(
        "INSERT INTO user_settings (discord_id, settings, updated_at) VALUES (?, ?, ?)"
        " ON CONFLICT(discord_id) DO UPDATE SET settings = excluded.settings,"
        " updated_at = excluded.updated_at",
        (discord_id, settings_str, now),
    )
    conn.commit()
    return jsonify({"ok": True})


@app.route("/api/settings/default-player")
@rate_limit(60)
def settings_default_player():
    user, err = _require_login()
    if err:
        return err
    discord_id = user.get("id", "")
    if not discord_id:
        return jsonify({"username": None})
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    mc_name = _mc_username(discord_id, matches)
    return jsonify({"username": mc_name})


# file uploads

_UPLOAD_MAX_SIZE = 5 * 1024 * 1024
_UPLOAD_ALLOWED_EXT = {
    ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif",
    ".pdf", ".txt", ".log", ".json", ".csv",
}


@app.route("/api/upload", methods=["POST"])
@rate_limit(30)
def upload_file():
    user, err = _require_login()
    if err:
        return err
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f or not f.filename:
        return jsonify({"error": "Empty file"}), 400
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in _UPLOAD_ALLOWED_EXT:
        return jsonify({"error": f"File type '{ext}' is not allowed"}), 400
    data = f.read()
    if len(data) > _UPLOAD_MAX_SIZE:
        return jsonify({"error": "File too large (max 5 MB)"}), 400
    unique = secrets.token_hex(8)
    safe_name = _re.sub(r"[^\w.-]", "_", f.filename)
    filename = f"{unique}_{safe_name}"
    filepath = os.path.join(_UPLOAD_DIR, filename)
    with open(filepath, "wb") as out:
        out.write(data)
    url = f"/uploads/{filename}"
    return jsonify({"ok": True, "url": url, "filename": filename})


def _delete_upload(filename):
    try:
        path = os.path.join(_UPLOAD_DIR, os.path.basename(filename))
        if os.path.isfile(path):
            os.unlink(path)
    except OSError:
        pass


def _delete_uploads_in_text(text):
    for match in _re.finditer(r'/uploads/([^\s)"]+)', text or ""):
        _delete_upload(match.group(1))


# GitHub issue creation

_ATTACH_RELEASE_TAG = "ticket-attachments"


def _get_or_create_attach_release():
    import sys
    gh_headers = {
        "Authorization": f"token {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "ESI-Dashboard/1.0",
    }
    r = requests.get(
        f"https://api.github.com/repos/{GITHUB_REPO}/releases/tags/{_ATTACH_RELEASE_TAG}",
        headers=gh_headers, timeout=10,
    )
    if r.ok:
        return r.json().get("upload_url", "").split("{")[0]
    r = requests.post(
        f"https://api.github.com/repos/{GITHUB_REPO}/releases",
        headers=gh_headers,
        json={
            "tag_name": _ATTACH_RELEASE_TAG,
            "name": "Ticket Attachments",
            "body": "Automatically managed - hosts files attached to support tickets.",
            "draft": False,
            "prerelease": True,
        },
        timeout=10,
    )
    if r.ok:
        return r.json().get("upload_url", "").split("{")[0]
    print(f"[TICKET] Failed to create attachments release: {r.status_code} {r.text[:200]}", file=sys.stderr)
    return None


def _upload_attachments_to_github(text):
    import sys
    import mimetypes as _mt
    if not GITHUB_TOKEN or not text:
        return text
    matches = list(_re.finditer(r'/uploads/([^\s)"]+)', text))
    if not matches:
        return text
    upload_base = _get_or_create_attach_release()
    if not upload_base:
        return text
    for match in matches:
        filename = match.group(1)
        clean_name = filename.split("?")[0]
        local_path = os.path.join(_UPLOAD_DIR, clean_name)
        if not os.path.isfile(local_path):
            continue
        content_type = _mt.guess_type(clean_name)[0] or "application/octet-stream"
        try:
            with open(local_path, "rb") as fh:
                file_data = fh.read()
            resp = requests.post(
                f"{upload_base}?name={clean_name}",
                headers={
                    "Authorization": f"token {GITHUB_TOKEN}",
                    "Content-Type": content_type,
                    "User-Agent": "ESI-Dashboard/1.0",
                },
                data=file_data,
                timeout=30,
            )
            if resp.ok:
                dl_url = resp.json().get("browser_download_url", "")
                if dl_url:
                    text = text.replace(match.group(0), dl_url)
            else:
                print(f"[TICKET] Release asset upload failed for {clean_name}: "
                      f"{resp.status_code} {resp.text[:200]}", file=sys.stderr)
        except Exception as exc:
            print(f"[TICKET] Failed to upload {clean_name}: {exc}", file=sys.stderr)
    return text


_ticket_rate: dict = {}
_ticket_rate_lock = _threading.Lock()
_TICKET_COOLDOWN  = 60.0


@app.route("/api/ticket", methods=["POST"])
@rate_limit(30)
def create_ticket():
    import sys
    user, err = _require_login()
    if err:
        return err
    uid = user.get("id", "")
    now = time()
    with _ticket_rate_lock:
        last = _ticket_rate.get(uid, 0)
        if now - last < _TICKET_COOLDOWN:
            return jsonify({"error": "Please wait before submitting another ticket."}), 429
        _ticket_rate[uid] = now
    body = request.get_json(silent=True) or {}
    title = (body.get("title") or "").strip()
    desc  = (body.get("body") or "").strip()
    VALID_LABELS = {"bug", "enhancement", "question", "documentation", "help wanted"}
    labels = [l for l in (body.get("labels") or []) if l in VALID_LABELS]
    if not title:
        return jsonify({"error": "Title is required"}), 400
    if not isinstance(labels, list):
        labels = []
    discord_name = user.get("nick") or user.get("username") or "Unknown"
    discord_id   = user.get("id", "")
    attribution  = f"*Submitted via ESI Dashboard by **{discord_name}** (`{discord_id}`)*"
    if not GITHUB_TOKEN:
        return jsonify({"error": "GitHub integration not configured"}), 503
    desc = _upload_attachments_to_github(desc)
    issue_body = f"{desc}\n\n---\n{attribution}" if desc else f"---\n{attribution}"
    try:
        resp = requests.post(
            f"https://api.github.com/repos/{GITHUB_REPO}/issues",
            headers={
                "Authorization": f"token {GITHUB_TOKEN}",
                "Accept": "application/vnd.github.v3+json",
                "User-Agent": "ESI-Dashboard/1.0",
            },
            json={"title": title, "body": issue_body, "labels": labels},
            timeout=10,
        )
        if not resp.ok:
            print(f"[TICKET] GitHub API error: {resp.status_code}", file=sys.stderr)
            return jsonify({"error": "Failed to create issue on GitHub"}), 502
        data = resp.json()
        _delete_uploads_in_text(desc)
        return jsonify({"ok": True, "issue_url": data.get("html_url"), "issue_number": data.get("number")})
    except requests.RequestException as e:
        print(f"[TICKET] GitHub request failed: {e}", file=sys.stderr)
        return jsonify({"error": "Failed to reach GitHub"}), 502


# error handlers

@app.errorhandler(404)
def not_found(e):
    msg = getattr(e, "description", None) or "Not found."
    return jsonify({"error": "Not found", "message": msg}), 404

@app.errorhandler(429)
def too_many_requests(e):
    msg = getattr(e, "description", None) or "Too many requests. Please try again shortly."
    return jsonify({"error": "Too many requests", "message": msg}), 429

@app.errorhandler(502)
def bad_gateway(e):
    msg = getattr(e, "description", None) or "Could not reach an upstream service."
    return jsonify({"error": "Bad gateway", "message": msg}), 502


# startup

if __name__ == "__main__":
    print()
    print("  ESI Routes Service")
    print("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
    print(f"  Listening on 127.0.0.1:{ROUTES_PORT}")
    print("  Press Ctrl+C to stop")
    print()
    app.run(host="127.0.0.1", port=ROUTES_PORT, debug=False, threaded=True)
