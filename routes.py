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
    _POINTS_DB, _SNIPES_DB, _SHOP_DB,
    _USER_DB_PATH, _UPLOAD_DIR,
    WYNN_BASE, DISCORD_API, DISCORD_TOKEN, DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, DISCORD_REDIRECT_URI,
    GITHUB_TOKEN, GITHUB_REPO, HEADERS as API_HEADERS,
    CACHE_TTL, PLAYTIME_CACHE_TTL, BULK_PLAYTIME_REFRESH,
    CACHE_URL, ROUTES_PORT, _GATEWAY_SECRET,
    _ROLE_VALAENDOR, _ROLE_PARLIAMENT, _ROLE_CONGRESS, _ROLE_JUROR, _ROLE_CITIZEN,
    _ROLE_GRAND_DUKE, _ROLE_ARCHDUKE,
    _PARLIAMENT_PLUS, _JUROR_PLUS, _CHIEF_PLUS, _CITIZEN_PLUS,
    _EVENTS_ACCESS, _EVENTS_MANAGE_ANY,
    _CLIENT_CONFIG,
    _TICKET_GUILD_ID, _STAFF_ROLE_DEFS,
    PLAYER_BULK_METRIC_KEYS, GUILD_BULK_METRIC_KEYS,
    BOT_SCREEN_SESSION, TRACKER_SCREEN_SESSION, TRACKER_SCREEN_SPECS,
    DEV_MODE,
    _safe_number, _parse_bool, _load_json_file, _save_json_file,
    _mc_username, _get_secret_key, _get_latest_api_db,
    _medals_for_client, _build_badge_catalog,
    _APPLICATION_FORMS, _APPLICATIONS_JSON, _user_has_min_rank,
    _APPLICATION_DISCORD, _PARLI_SERVER_ID, _PARLI_PARLI_ROLE, _DEV_SERVER_ID,
)
from shop.state import get_shop_state as _shop_get_state, get_shop_enabled as _shop_get_enabled, get_shop_disabled_message as _shop_get_disabled_message
import ipaddress

# Flask app

app = Flask(__name__)
# trust X-Forwarded-For from the gateway / nginx
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1)
app.secret_key = _get_secret_key()
app.permanent_session_lifetime = timedelta(days=7)
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
# Always Secure in production; only allow insecure cookies in dev mode
app.config["SESSION_COOKIE_SECURE"] = not DEV_MODE

_SESSION_IDLE_TIMEOUT = 3 * 3600  # 3 hours of inactivity -> re-auth

os.makedirs(_UPLOAD_DIR, exist_ok=True)

# Security headers

@app.after_request
def _set_security_headers(response):
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

try:
    from wynnpiece.routes import bp as _wp_bp
    app.register_blueprint(_wp_bp)
except ImportError:
    pass


# Bot permission audit - runs once in a background thread at startup.
# Warns if the Discord bot has dangerous permissions it doesn't need.

# Discord permission bit flags
_PERM_ADMINISTRATOR      = 1 << 3
_PERM_MANAGE_GUILD       = 1 << 5
_PERM_BAN_MEMBERS        = 1 << 2
_PERM_KICK_MEMBERS       = 1 << 1
_PERM_MANAGE_ROLES       = 1 << 28
_PERM_MANAGE_CHANNELS    = 1 << 4
_PERM_MANAGE_WEBHOOKS    = 1 << 29
_PERM_MENTION_EVERYONE   = 1 << 17

_DANGEROUS_PERMS = [
    (_PERM_ADMINISTRATOR,    "Administrator"),
    (_PERM_MANAGE_GUILD,     "Manage Guild"),
    (_PERM_BAN_MEMBERS,      "Ban Members"),
    (_PERM_KICK_MEMBERS,     "Kick Members"),
    (_PERM_MANAGE_WEBHOOKS,  "Manage Webhooks"),
    (_PERM_MENTION_EVERYONE, "Mention Everyone"),
]

def _audit_bot_permissions():
    """Check if the bot has more permissions than it needs.

    Required permissions:
      - View Channels
      - Send Messages / Send Messages in Threads
      - Create Public Threads / Create Private Threads
      - Read Message History
    The bot also needs the Server Members Intent in the developer portal.
    """
    import sys as _sys
    if not DISCORD_TOKEN or not DISCORD_GUILD_ID:
        return
    try:
        # Fetch the bot's own member record
        me_resp = requests.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        if not me_resp.ok:
            return
        bot_id = me_resp.json().get("id")
        if not bot_id:
            return

        member_resp = requests.get(
            f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members/{bot_id}",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        if not member_resp.ok:
            return
        bot_roles = set(member_resp.json().get("roles", []))

        # Fetch all guild roles to compute effective permissions
        roles_resp = requests.get(
            f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/roles",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        if not roles_resp.ok:
            return

        perms = 0
        for role in roles_resp.json():
            # @everyone role applies to all members
            if role["id"] == DISCORD_GUILD_ID or role["id"] in bot_roles:
                perms |= int(role.get("permissions", "0"))

        # Check for dangerous permissions
        found = []
        for bit, name in _DANGEROUS_PERMS:
            if perms & bit:
                found.append(name)

        if found:
            print(
                f"\n  \033[93m[SECURITY] Bot has unnecessary permissions: "
                f"{', '.join(found)}\033[0m\n"
                f"  The bot only needs: View Channels, Send Messages, "
                f"Create Threads, Read Message History.\n"
                f"  Remove excess permissions in Discord Server Settings "
                f"\u2192 Roles \u2192 ESI Bot role.\n",
                file=_sys.stderr,
            )
        else:
            print("  [SECURITY] Bot permissions look good \u2713", file=_sys.stderr)
    except Exception as exc:
        print(f"  [SECURITY] Could not audit bot permissions: {exc}", file=_sys.stderr)

_threading.Thread(target=_audit_bot_permissions, daemon=True).start()


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


def _real_ip():
    """Return the real client IP as resolved by the Gateway.

    The Gateway sets X-Real-Client-IP from CF-Connecting-IP (or falls
    back to the TCP peer).  This is more accurate than remote_addr
    which, after ProxyFix, is the Cloudflare edge IP.
    """
    return (request.headers.get("X-Real-Client-IP") or "").strip() or request.remote_addr or "unknown"


def rate_limit(calls: int, period: float = 60.0):
    """Decorator: allow at most *calls* requests per *period* seconds per IP."""
    def decorator(fn):
        @_functools.wraps(fn)
        def wrapper(*args, **kwargs):
            ip  = _real_ip()
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
    ip  = _real_ip()
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
def _verify_gateway_secret():
    """Reject requests that did not come through the Gateway.

    Every request proxied by main.py carries an X-Gateway-Secret header.
    If it is missing or wrong the request was sent directly to :5001,
    which should never happen in production.
    """
    provided = (request.headers.get("X-Gateway-Secret") or "").strip()
    if not provided or not secrets.compare_digest(provided, _GATEWAY_SECRET):
        # allow loopback without the header only in dev mode so
        # curl / test scripts still work locally
        if DEV_MODE:
            pass
        else:
            abort(403)

@app.before_request
def _before():
    session.permanent = True
    # idle timeout: if the session hasn't been touched in _SESSION_IDLE_TIMEOUT,
    # invalidate it so the user has to log in again.
    last = session.get("_last_active")
    now = time()
    if last and now - last > _SESSION_IDLE_TIMEOUT and session.get("user"):
        session.clear()
    session["_last_active"] = now


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
_inline_script_cache = {"hashes": _INLINE_SCRIPT_HASHES, "mtime": 0}

def _get_inline_script_hashes():
    """Return CSP hashes, recomputing if index.html changed on disk."""
    path = os.path.join(_BASE_DIR, "index.html")
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return _inline_script_cache["hashes"]
    if mt != _inline_script_cache["mtime"]:
        _inline_script_cache["hashes"] = _compute_inline_script_hashes()
        _inline_script_cache["mtime"] = mt
    return _inline_script_cache["hashes"]


@app.after_request
def _after(response):
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        f"script-src 'self' {_get_inline_script_hashes()}; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "img-src 'self' https://cdn.discordapp.com https://visage.surgeplay.com https://crafatar.com https://mc-heads.net data:; "
        "connect-src 'self';"
    )
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# staff roles (fetched from ticket server)

_staff_roles_cache = {"data": None, "ts": 0}
_STAFF_ROLES_TTL = 300


def _fetch_staff_roles():
    now = time()
    cached = _staff_roles_cache
    if cached["data"] is not None and now - cached["ts"] < _STAFF_ROLES_TTL:
        return cached["data"]
    try:
        members = []
        after = "0"
        while True:
            resp = requests.get(
                f"{DISCORD_API}/guilds/{_TICKET_GUILD_ID}/members",
                params={"limit": 1000, "after": after},
                headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
                timeout=10,
            )
            if not resp.ok:
                break
            batch = resp.json()
            if not batch:
                break
            members.extend(batch)
            if len(batch) < 1000:
                break
            after = batch[-1]["user"]["id"]
        result = []
        for rd in _STAFF_ROLE_DEFS:
            role_members = [
                m["user"]["id"] for m in members
                if rd["role_id"] in m.get("roles", [])
            ]
            result.append({
                "name": rd["name"],
                "color": rd["color"],
                "members": role_members,
            })
        cached["data"] = result
        cached["ts"] = now
        return result
    except Exception as exc:
        import sys
        print(f"[STAFF] Failed to fetch staff roles: {exc}", file=sys.stderr)
        return cached["data"] or []


# public config endpoint

@app.route("/api/config")
def client_config():
    cfg = dict(_CLIENT_CONFIG)
    cfg["staffRoles"] = _fetch_staff_roles()
    return jsonify(cfg)


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
    # Rotate session to prevent fixation
    session.clear()
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
    session["_last_active"] = time()
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


@app.route("/api/me/badge-progress")
@rate_limit(30)
def me_badge_progress():
    """Return the logged-in user's counts relevant to badge progression."""
    user, err = _require_login()
    if err:
        return err
    discord_id = user.get("id", "")
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    mc_username = _mc_username(discord_id, matches)
    if not mc_username:
        return jsonify({"linked": False, "counts": {}})
    latest_db = _get_latest_api_db()
    if not latest_db:
        return jsonify({"linked": True, "username": mc_username, "counts": {}})
    counts = {"wars": 0, "guild_raids": 0, "quests": 0, "recruited": 0, "events": 0}
    try:
        conn = _sqlite3.connect(latest_db, check_same_thread=False)
        ulow = mc_username.lower()
        # wars + uuid from player_stats
        row = conn.execute(
            "SELECT wars, uuid FROM player_stats WHERE LOWER(username) = ? AND UPPER(guild_prefix) = 'ESI'",
            (ulow,),
        ).fetchone()
        uuid = None
        if row:
            counts["wars"] = int(row[0] or 0)
            uuid = row[1] or None
        # guild raids
        try:
            gr = None
            if uuid:
                gr = conn.execute("SELECT total_graids FROM guild_raid_stats WHERE uuid = ?", (uuid,)).fetchone()
            if not gr:
                gr = conn.execute("SELECT total_graids FROM guild_raid_stats WHERE LOWER(username) = ?", (ulow,)).fetchone()
            if gr:
                counts["guild_raids"] = int(gr[0] or 0)
        except _sqlite3.OperationalError:
            pass
        # recruited
        if uuid:
            try:
                rec = conn.execute("SELECT COUNT(*) FROM recruited WHERE recruiter = ?", (uuid,)).fetchone()
                if rec:
                    counts["recruited"] = int(rec[0] or 0)
            except _sqlite3.OperationalError:
                pass
        # events
        try:
            ev = conn.execute("SELECT points FROM event_progress WHERE LOWER(player) = ?", (ulow,)).fetchone()
            if ev:
                counts["events"] = int(ev[0] or 0)
        except _sqlite3.OperationalError:
            pass
        # quests
        try:
            q = conn.execute("SELECT points FROM quest_progress WHERE LOWER(player) = ?", (ulow,)).fetchone()
            if q:
                counts["quests"] = int(q[0] or 0)
        except _sqlite3.OperationalError:
            pass
        conn.close()
    except Exception:
        pass
    return jsonify({"linked": True, "username": mc_username, "counts": counts})


import uuid as _uuid_mod
from shop.ep_balance import resolve_uuid_for_user, fetch_ep_balance, resolve_spend, InsufficientFunds
from shop.bin import list_bin_items, execute_bin_purchase, execute_cart_checkout, PurchaseError, is_guild_member
from shop.cart import get_cart, save_cart
from shop.auction import list_auctions, place_bid, start_auction_close_worker
from shop.donate import submit_donation, get_donation_history
from shop.orders import get_order_history
from shop.admin import (
    admin_list_all_items_unfiltered, admin_set_override,
    admin_cancel_purchase, admin_cancel_auction, admin_extend_auction,
    admin_get_logs, admin_get_reservations, admin_release_reservation,
    admin_get_queue, admin_fulfill, admin_reject, admin_get_raw_config,
    admin_write_item, admin_delete_item, admin_reorder_items,
    admin_start_auction, admin_auction_detail, admin_remove_bid,
    admin_get_changes_log, admin_get_users, admin_set_shop_enabled,
    admin_ban_user, admin_unban_user, is_shop_banned,
    is_admin_banned, admin_ban_admin, admin_unban_admin, _get_admin_banned_ids,
    admin_adjust_ep,
    get_user_notes, add_user_note, delete_user_note,
    set_user_limits,
    admin_refund_purchase, admin_reject_refund,
)


# Guild-member gate for all shop endpoints
def _shop_disabled_response():
    message = _shop_get_disabled_message()
    return (
        jsonify({
            "shop_enabled": False,
            "coming_soon": message == "Coming soon",
            "message": message,
        }),
        503,
    )

def _shop_disabled_payload(extra: dict | None = None) -> dict:
    message = _shop_get_disabled_message()
    payload = {
        "shop_enabled": False,
        "coming_soon": message == "Coming soon",
        "message": message,
    }
    if isinstance(extra, dict):
        payload.update(extra)
    return payload

def _is_shop_enabled() -> bool:
    return bool(_shop_get_enabled(default=False))

def _is_owner_user(user: dict | None) -> bool:
    owner = str(os.environ.get("OWNER") or "").strip()
    if not owner or not isinstance(user, dict):
        return False
    user_id = str(user.get("id") or "").strip()
    owner_id = owner
    if owner.startswith("<@") and owner.endswith(">"):
        owner_id = owner.strip("<@!>").strip()
    if owner_id and owner_id == user_id:
        return True
    owner_l = owner.lower()
    username = str(user.get("username") or "").strip().lower()
    nick = str(user.get("nick") or "").strip().lower()
    discriminator = str(user.get("discriminator") or "").strip()
    tag = (f"{username}#{discriminator}".lower()) if username and discriminator else ""
    return owner_l in {username, nick, tag}

def _require_guild_member(require_shop_enabled: bool = True):
    user, err = _require_login()
    if err:
        return None, err
    if not is_guild_member(user.get("roles") or []):
        return None, (jsonify({"error": "Shop is only available to guild members"}), 403)
    # Check shop ban (admins bypass)
    user_roles = set(user.get("roles") or [])
    if not (user_roles & _SHOP_ADMIN) and not _is_owner_user(user):
        mc_uuid, _ = resolve_uuid_for_user(user.get("id", ""))
        if mc_uuid and is_shop_banned(mc_uuid):
            return None, (jsonify({"error": "You have been banned from the shop"}), 403)
    if require_shop_enabled and not _is_shop_enabled():
        return None, _shop_disabled_response()
    return user, None


# EP balance endpoint (shop system)
@app.route("/api/shop/state")
@rate_limit(60)
def shop_state():
    user, err = _require_login()
    if err:
        return err
    if not is_guild_member(user.get("roles") or []):
        return jsonify({"error": "Shop is only available to guild members"}), 403
    # Check ban status but return it as a flag instead of blocking
    banned = False
    admin_banned_flag = False
    user_roles = set(user.get("roles") or [])
    if not _is_owner_user(user):
        if not (user_roles & _SHOP_ADMIN):
            mc_uuid, _ = resolve_uuid_for_user(user.get("id", ""))
            if mc_uuid and is_shop_banned(mc_uuid):
                banned = True
        if (user_roles & _SHOP_ADMIN) and is_admin_banned(user.get("id")):
            admin_banned_flag = True
    state = _shop_get_state() or {}
    enabled = bool(state.get("shop_enabled"))
    message = None if enabled else (state.get("message") or _shop_get_disabled_message())
    maintenance_view_only = bool(not enabled)
    return jsonify({
        **state,
        "shop_enabled": enabled,
        "coming_soon": False if enabled else bool(state.get("coming_soon", message == "Coming soon")),
        "message": message,
        "maintenance_view_only": maintenance_view_only,
        "shop_banned": banned,
        "admin_banned": admin_banned_flag,
    })

@app.route("/api/me/ep-balance")
@rate_limit(60)
def me_ep_balance():
    """Return the logged-in user's EP balance breakdown."""
    user, err = _require_guild_member(require_shop_enabled=False)
    if err:
        return err
    if not _is_shop_enabled():
        return jsonify(_shop_disabled_payload({"linked": False})), 200
    discord_id = user.get("id", "")
    mc_uuid, mc_username = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        return jsonify({
            "linked": False,
            "error": "No linked Minecraft account found",
        }), 200

    balance = fetch_ep_balance(mc_uuid)

    current_cycle = _points_get_cycle_id()
    _, cycle_end = _points_get_cycle_bounds(current_cycle)

    return jsonify({
        "linked":          True,
        "uuid":            mc_uuid,
        "username":        mc_username,
        **balance,
        "current_cycle_id": current_cycle,
        "cycle_ends_at":   cycle_end.isoformat(),
    })


# Shop bin endpoints

@app.route("/api/shop/bin")
@rate_limit(60)
def shop_bin_list():
    """Return all visible bin items for the logged-in user, with cooldowns and balance."""
    user, err = _require_guild_member(require_shop_enabled=False)
    if err:
        return err
    user_roles = user.get("roles") or []
    _is_admin = bool(set(user_roles) & _SHOP_ADMIN) or _is_owner_user(user)
    if not _is_shop_enabled():
        result = list_bin_items(
            user_roles=user_roles,
            discord_id=user.get("id", ""),
            is_shop_admin=_is_admin,
        )
        ro_items = []
        for item in result.get("items") or []:
            if not isinstance(item, dict):
                continue
            ro_item = dict(item)
            ro_item["active"] = False
            ro_items.append(ro_item)
        payload = {
            **result,
            "items": ro_items,
            "maintenance_view_only": True,
        }
        payload.update(_shop_disabled_payload())
        return jsonify(payload), 200
    result = list_bin_items(
        user_roles=user_roles,
        discord_id=user.get("id", ""),
        is_shop_admin=_is_admin,
    )
    return jsonify(result)


@app.route("/api/shop/bin/cart/checkout", methods=["POST"])
@rate_limit(3, 60)
def shop_bin_cart_checkout():
    """Atomic multi-item cart checkout."""
    user, err = _require_guild_member()
    if err:
        return err
    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict):
        return jsonify({"error": "Invalid request body"}), 400
    items_raw = body.get("items")
    if not isinstance(items_raw, list) or not items_raw:
        return jsonify({"error": "items must be a non-empty array"}), 400
    if len(items_raw) > 20:
        return jsonify({"error": "Cart cannot contain more than 20 distinct items"}), 400
    cart = []
    for entry in items_raw:
        if not isinstance(entry, dict):
            return jsonify({"error": "Each cart entry must be an object"}), 400
        item_id = (entry.get("item_id") or "").strip()
        if not item_id:
            return jsonify({"error": "Each cart entry must have item_id"}), 400
        try:
            qty = int(entry.get("quantity", 1))
        except (TypeError, ValueError):
            return jsonify({"error": f"quantity must be an integer for item {item_id!r}"}), 400
        if qty < 1:
            return jsonify({"error": f"quantity must be >= 1 for item {item_id!r}"}), 400
        ack = entry.get("acknowledged_spend") or {}
        vi_raw = entry.get("variant_index")
        vi = int(vi_raw) if vi_raw is not None else None
        cart.append({
            "item_id": item_id,
            "quantity": qty,
            "variant_index": vi,
            "acknowledged_spend": ack,
        })
    try:
        results = execute_cart_checkout(
            discord_id=user.get("id", ""),
            user_roles=user.get("roles") or [],
            cart_items=cart,
        )
        return jsonify({"ok": True, "items": results})
    except PurchaseError as exc:
        return jsonify({"error": exc.message}), exc.status
    except InsufficientFunds as exc:
        return jsonify({
            "error": str(exc),
            "needed": exc.needed,
            "available": exc.available,
        }), 402


@app.route("/api/shop/bin/purchase", methods=["POST"])
@rate_limit(5, 60)
def shop_bin_purchase():
    """Execute a bin purchase."""
    user, err = _require_guild_member()
    if err:
        return err
    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict):
        return jsonify({"error": "Invalid request body"}), 400
    item_id = (body.get("item_id") or "").strip()
    if not item_id:
        return jsonify({"error": "item_id is required"}), 400
    ack = body.get("acknowledged_spend") or {}
    ack_clean = int(ack.get("clean_ep", 0)) if isinstance(ack, dict) else 0
    ack_dirty = int(ack.get("dirty_ep", 0)) if isinstance(ack, dict) else 0
    try:
        result = execute_bin_purchase(
            discord_id=user.get("id", ""),
            user_roles=user.get("roles") or [],
            item_id=item_id,
            acknowledged_clean=ack_clean,
            acknowledged_dirty=ack_dirty,
        )
        return jsonify({"ok": True, **result})
    except PurchaseError as exc:
        return jsonify({"error": exc.message}), exc.status
    except InsufficientFunds as exc:
        return jsonify({
            "error": str(exc),
            "needed": exc.needed,
            "available": exc.available,
        }), 402


# Shop cart persistence endpoints
@app.route("/api/shop/cart")
@rate_limit(60)
def shop_cart_get():
    """Return the logged-in user's persisted cart as [{item_id, quantity}]."""
    user, err = _require_guild_member(require_shop_enabled=False)
    if err:
        return err
    if not _is_shop_enabled():
        # Shop admins can still view their cart (read-only)
        user_roles = set(user.get("roles") or [])
        if (user_roles & _SHOP_ADMIN) or _is_owner_user(user):
            items = get_cart(user.get("id", ""))
            return jsonify({"ok": True, "items": items, "read_only": True})
        return jsonify(_shop_disabled_payload({
            "ok": True,
            "items": [],
        })), 200
    items = get_cart(user.get("id", ""))
    return jsonify({"ok": True, "items": items})


@app.route("/api/shop/cart", methods=["PUT"])
@rate_limit(30, 60)
def shop_cart_save():
    """Atomically replace the logged-in user's persisted cart."""
    user, err = _require_guild_member()
    if err:
        return err
    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict):
        return jsonify({"error": "Invalid request body"}), 400
    items_raw = body.get("items")
    if not isinstance(items_raw, list):
        return jsonify({"error": "items must be an array"}), 400
    items = []
    for entry in items_raw:
        if not isinstance(entry, dict):
            continue
        item_id = (entry.get("item_id") or "").strip()
        try:
            qty = int(entry.get("quantity", 1))
        except (TypeError, ValueError):
            continue
        vi_raw = entry.get("variant_index")
        vi = int(vi_raw) if vi_raw is not None else None
        if item_id and qty >= 1:
            items.append({"item_id": item_id, "quantity": qty, "variant_index": vi})
    ok = save_cart(user.get("id", ""), items)
    return jsonify({"ok": ok})


# Shop auction endpoints

@app.route("/api/shop/auctions")
@rate_limit(60)
def shop_auction_list():
    """Return active + recently-closed auctions with user bid status."""
    user, err = _require_guild_member(require_shop_enabled=False)
    if err:
        return err
    user_roles = user.get("roles") or []
    _is_admin = bool(set(user_roles) & _SHOP_ADMIN) or _is_owner_user(user)
    if not _is_shop_enabled():
        result = list_auctions(discord_id=user.get("id", ""),
                               user_roles=user_roles,
                               is_shop_admin=_is_admin)
        ro_auctions = []
        for auction in result.get("auctions") or []:
            if not isinstance(auction, dict):
                continue
            ro_auction = dict(auction)
            ro_auction["active"] = False
            ro_auctions.append(ro_auction)
        payload = {
            **result,
            "auctions": ro_auctions,
            "maintenance_view_only": True,
        }
        payload.update(_shop_disabled_payload())
        return jsonify(payload), 200
    return jsonify(list_auctions(discord_id=user.get("id", ""),
                                user_roles=user_roles,
                                is_shop_admin=_is_admin))


@app.route("/api/shop/auctions/bid", methods=["POST"])
@rate_limit(10, 60)
def shop_auction_bid():
    """Place a bid on an active auction."""
    user, err = _require_guild_member()
    if err:
        return err
    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict):
        return jsonify({"error": "Invalid request body"}), 400
    auction_id = (body.get("auction_id") or "").strip()
    if not auction_id:
        return jsonify({"error": "auction_id is required"}), 400
    try:
        amount = int(body.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "amount must be an integer"}), 400
    if amount <= 0:
        return jsonify({"error": "amount must be positive"}), 400
    if amount > 999999:
        return jsonify({"error": "amount cannot exceed 999,999"}), 400
    try:
        result = place_bid(
            discord_id=user.get("id", ""),
            user_roles=user.get("roles") or [],
            auction_id=auction_id,
            amount=amount,
        )
        return jsonify({"ok": True, **result})
    except PurchaseError as exc:
        return jsonify({"error": exc.message}), exc.status
    except InsufficientFunds as exc:
        return jsonify({
            "error": str(exc),
            "needed": exc.needed,
            "available": exc.available,
        }), 402


# Shop donation endpoints

@app.route("/api/shop/donate", methods=["POST"])
@rate_limit(10, 60)
def shop_donate():
    """Submit an LE donation ticket."""
    user, err = _require_guild_member()
    if err:
        return err
    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict):
        return jsonify({"error": "Invalid request body"}), 400
    try:
        le_amount = int(body.get("le_amount", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "le_amount must be an integer"}), 400
    if le_amount <= 0:
        return jsonify({"error": "le_amount must be positive"}), 400
    if le_amount > 6400:
        return jsonify({"error": "le_amount cannot exceed 6,400 LE"}), 400
    try:
        result = submit_donation(
            discord_id=user.get("id", ""),
            le_amount=le_amount,
        )
        return jsonify({"ok": True, **result})
    except PurchaseError as exc:
        return jsonify({"error": exc.message}), exc.status


@app.route("/api/shop/donations")
@rate_limit(30)
def shop_donation_history():
    """Return the logged-in user's donation history."""
    user, err = _require_guild_member(require_shop_enabled=False)
    if err:
        return err
    if not _is_shop_enabled():
        return jsonify(_shop_disabled_payload({
            "linked": False,
            "tickets": [],
        })), 200
    return jsonify(get_donation_history(discord_id=user.get("id", "")))


@app.route("/api/shop/orders")
@rate_limit(30)
def shop_orders():
    """Return the logged-in user's full order history."""
    user, err = _require_guild_member(require_shop_enabled=False)
    if err:
        return err
    if not _is_shop_enabled():
        # Shop admins can still view their orders (read-only)
        user_roles = set(user.get("roles") or [])
        if (user_roles & _SHOP_ADMIN) or _is_owner_user(user):
            result = get_order_history(discord_id=user.get("id", ""))
            result["read_only"] = True
            return jsonify(result)
        return jsonify(_shop_disabled_payload({
            "linked": False,
            "purchases": [],
            "bids": [],
            "donations": [],
        })), 200
    return jsonify(get_order_history(discord_id=user.get("id", "")))


@app.route("/api/shop/orders/refund", methods=["POST"])
@rate_limit(3, 600)
def shop_request_refund():
    """Request a refund for a fulfilled purchase (one at a time)."""
    user, err = _require_guild_member()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    purchase_id = (body.get("purchase_id") or "").strip()
    reason = (body.get("reason") or "").strip()[:100]
    if not purchase_id:
        return jsonify({"error": "purchase_id is required"}), 400
    if not reason:
        return jsonify({"error": "Reason is required"}), 400
    from shop.orders import request_refund
    result = request_refund(user.get("id", ""), purchase_id, reason)
    return jsonify(result), 200 if result.get("ok") else 400


# Shop admin endpoints
_SHOP_ADMIN = _CHIEF_PLUS | _PARLIAMENT_PLUS  # read access
def _require_shop_admin(require_shop_enabled: bool = True):
    """Returns (user, is_parliament, err).

    is_parliament=True  -> Parliament+ : full write (create/edit/delete items,
                            cancel/extend auctions, remove bids).
    is_parliament=False -> Chief+ only : limited write (stock, toggle, start
                            auction, open manage modal, queue fulfill/reject).
    """
    user, err = _require_login()
    if err:
        return None, False, err
    if _is_owner_user(user):
        # OWNER always has full shop-admin capabilities, including while disabled.
        return user, True, None
    user_roles = set(user.get("roles") or [])
    if not (user_roles & _SHOP_ADMIN):
        return None, False, (jsonify({"error": "Insufficient permissions"}), 403)
    # Admin-panel ban check
    if is_admin_banned(user.get("id")):
        return None, False, (jsonify({"error": "You have been banned from the manage shop"}), 403)
    is_parliament = bool(user_roles & _PARLIAMENT_PLUS)
    if require_shop_enabled and not _is_shop_enabled():
        return None, False, _shop_disabled_response()
    return user, is_parliament, None

@app.route("/api/admin/shop/state")
@rate_limit(30)
def admin_shop_state():
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    state = _shop_get_state() or {}
    enabled = bool(state.get("shop_enabled"))
    message = None if enabled else (state.get("message") or _shop_get_disabled_message())
    user_roles = set(user.get("roles") or [])
    return jsonify({
        **state,
        "shop_enabled": enabled,
        "coming_soon": False if enabled else bool(state.get("coming_soon", message == "Coming soon")),
        "message": message,
        "can_toggle": _is_owner_user(user),
        "is_parliament": _is_owner_user(user) or bool(user_roles & _PARLIAMENT_PLUS),
    })

@app.route("/api/admin/shop/state", methods=["POST"])
@rate_limit(10)
def admin_shop_state_update():
    user, err = _require_login()
    if err:
        return err
    if not _is_owner_user(user):
        return jsonify({"error": "Only OWNER can change shop state"}), 403
    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict) or "shop_enabled" not in body:
        return jsonify({"error": "shop_enabled is required"}), 400
    enabled = _parse_bool(body.get("shop_enabled"))
    actor = user.get("nick") or user.get("username", "")
    result = admin_set_shop_enabled(enabled, actor=actor)
    return jsonify(result), 200 if result.get("ok") else 400

@app.route("/api/admin/shop/items")
@rate_limit(30)
def admin_shop_items():
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    return jsonify(admin_list_all_items_unfiltered())


@app.route("/api/admin/shop/items/upload-image", methods=["POST"])
@rate_limit(10)
def admin_shop_upload_image():
    """Upload an image for a shop item. Returns the served URL."""
    user, is_admin, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_admin:
        return jsonify({"error": "Admin access required"}), 403
    if "file" not in request.files:
        return jsonify({"error": "No file provided"}), 400
    f = request.files["file"]
    if not f or not f.filename:
        return jsonify({"error": "No file selected"}), 400
    _ALLOWED_EXT  = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
    _ALLOWED_FMT  = {"PNG", "JPEG", "GIF", "WEBP"}
    ext = os.path.splitext(f.filename)[1].lower()
    if ext not in _ALLOWED_EXT:
        return jsonify({"error": "Unsupported type. Use PNG, JPG, GIF or WebP."}), 400
    f.seek(0, 2); size = f.tell(); f.seek(0)
    if size > 2 * 1024 * 1024:
        return jsonify({"error": "Image must be smaller than 2 MB"}), 400
    # Validate actual file content via Pillow magic-byte check
    try:
        from PIL import Image as _PIL_Image
        img = _PIL_Image.open(f)
        img.verify()          # raises if the header is corrupt or not a real image
        if img.format not in _ALLOWED_FMT:
            return jsonify({"error": f"File content is {img.format}, not a supported image type."}), 400
    except Exception:
        return jsonify({"error": "File does not appear to be a valid image."}), 400
    finally:
        f.seek(0)             # reset after Pillow reads the stream
    import uuid as _uid_local
    filename = _uid_local.uuid4().hex + ext
    save_dir = os.path.join(_BASE_DIR, "images", "shop")
    os.makedirs(save_dir, exist_ok=True)
    f.save(os.path.join(save_dir, filename))
    return jsonify({"ok": True, "url": "/images/shop/" + filename})


@app.route("/api/admin/shop/items", methods=["POST"])
@rate_limit(20)
def admin_shop_create_item():
    """Create a new item in the JSON catalogue."""
    user, is_admin, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_admin:
        return jsonify({"error": "Admin access required"}), 403
    fields = request.get_json(silent=True)
    if not isinstance(fields, dict):
        return jsonify({"error": "Invalid request body"}), 400
    chief_name = user.get("nick") or user.get("username", "")
    result = admin_write_item(None, fields, is_new=True, actor=chief_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/items/<item_id>", methods=["PUT"])
@rate_limit(20)
def admin_shop_update_item(item_id):
    """Fully update an existing item in the JSON catalogue."""
    user, is_admin, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_admin:
        return jsonify({"error": "Admin access required"}), 403
    fields = request.get_json(silent=True)
    if not isinstance(fields, dict):
        return jsonify({"error": "Invalid request body"}), 400
    chief_name = user.get("nick") or user.get("username", "")
    result = admin_write_item(item_id, fields, is_new=False, actor=chief_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/items/reorder", methods=["POST"])
@rate_limit(10)
def admin_shop_reorder_items():
    """Reorder items in the JSON catalogue."""
    user, is_admin, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_admin:
        return jsonify({"error": "Admin access required"}), 403
    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict):
        return jsonify({"error": "Invalid request body"}), 400
    ordered_ids = body.get("ordered_ids")
    if not isinstance(ordered_ids, list) or not ordered_ids:
        return jsonify({"error": "ordered_ids must be a non-empty array"}), 400
    chief_name = user.get("nick") or user.get("username", "")
    result = admin_reorder_items(ordered_ids, actor=chief_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/items/<item_id>", methods=["DELETE"])
@rate_limit(10)
def admin_shop_delete_item_route(item_id):
    """Remove an item from the JSON catalogue."""
    user, is_admin, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_admin:
        return jsonify({"error": "Admin access required"}), 403
    chief_name = user.get("nick") or user.get("username", "")
    result = admin_delete_item(item_id, actor=chief_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/items/<item_id>/override", methods=["POST"])
@rate_limit(20)
def admin_shop_item_override(item_id):
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    body = request.get_json(silent=True) or {}
    active = body.get("active")
    stock = body.get("stock")
    # Distinguish "stock not sent" from "stock explicitly set to null (unlimited)"
    clear_stock = "stock" in body and stock is None
    if active is not None:
        active = bool(active)
    if stock is not None:
        try:
            stock = int(stock)
        except (TypeError, ValueError):
            return jsonify({"error": "stock must be an integer"}), 400
        if stock < 0:
            return jsonify({"error": "stock cannot be negative"}), 400
        if stock > 99999:
            return jsonify({"error": "stock cannot exceed 99,999"}), 400
    chief_name = user.get("nick") or user.get("username", "")
    return jsonify(admin_set_override(item_id, active, stock, chief_name,
                                      clear_stock=clear_stock))


@app.route("/api/admin/shop/purchases/<purchase_id>/cancel", methods=["POST"])
@rate_limit(10)
def admin_shop_cancel_purchase(purchase_id):
    user, is_parliament, err = _require_shop_admin()
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    body = request.get_json(silent=True) or {}
    reason = (body.get("reason") or "").strip()
    if not reason:
        return jsonify({"error": "Reason is required"}), 400
    chief_name = user.get("nick") or user.get("username", "")
    result = admin_cancel_purchase(purchase_id, reason, chief_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/auctions/start", methods=["POST"])
@rate_limit(10)
def admin_shop_start_auction_route():
    """Start a new auction instance for an auction-type item."""
    user, is_parliament, err = _require_shop_admin()
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    body = request.get_json(silent=True) or {}
    item_id = (body.get("item_id") or "").strip()
    if not item_id:
        return jsonify({"error": "item_id is required"}), 400
    starter_name = user.get("nick") or user.get("username", "")
    result = admin_start_auction(item_id, starter_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/auctions/<auction_id>/detail")
@rate_limit(30)
def admin_shop_auction_detail(auction_id):
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    result = admin_auction_detail(auction_id)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/bids/<bid_id>/remove", methods=["POST"])
@rate_limit(10)
def admin_shop_remove_bid(bid_id):
    user, is_parliament, err = _require_shop_admin()
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    chief_name = user.get("nick") or user.get("username", "")
    body = request.get_json(silent=True) or {}
    reason = (body.get("reason") or "").strip()[:50] or None
    result = admin_remove_bid(bid_id, chief_name, reason)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/auctions/<auction_id>/close", methods=["POST"])
@rate_limit(10)
def admin_shop_close_auction(auction_id):
    user, is_parliament, err = _require_shop_admin()
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    chief_name = user.get("nick") or user.get("username", "")
    result = admin_cancel_auction(auction_id, chief_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/auctions/<auction_id>/extend", methods=["POST"])
@rate_limit(10)
def admin_shop_extend_auction(auction_id):
    user, is_parliament, err = _require_shop_admin()
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    body = request.get_json(silent=True) or {}
    try:
        hours = int(body.get("hours", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "hours must be an integer"}), 400
    if hours == 0:
        return jsonify({"error": "hours must be non-zero"}), 400
    actor = user.get("nick") or user.get("username", "")
    result = admin_extend_auction(auction_id, hours, actor=actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/logs")
@rate_limit(30)
def admin_shop_logs():
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(200, max(1, int(request.args.get("per_page", 50))))
    return jsonify(admin_get_logs(
        page=page, per_page=per_page,
        username=request.args.get("username"),
        item_id=request.args.get("item_id"),
        status=request.args.get("status"),
        entry_type=request.args.get("type"),
        date_from=request.args.get("date_from"),
        date_to=request.args.get("date_to"),
    ))


@app.route("/api/admin/shop/reservations")
@rate_limit(30)
def admin_shop_reservations():
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    return jsonify(admin_get_reservations())


@app.route("/api/admin/shop/reservations/<reservation_id>/release", methods=["POST"])
@rate_limit(10)
def admin_shop_release_reservation(reservation_id):
    user, is_parliament, err = _require_shop_admin()
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    chief_name = user.get("nick") or user.get("username", "")
    result = admin_release_reservation(reservation_id, chief_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/queue")
@rate_limit(30)
def admin_shop_queue():
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    return jsonify(admin_get_queue())


@app.route("/api/admin/shop/queue/fulfill", methods=["POST"])
@rate_limit(20)
def admin_shop_fulfill():
    user, _, err = _require_shop_admin()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    ticket_type = (body.get("type") or "").strip()
    ticket_id = (body.get("ticket_id") or "").strip()
    if not ticket_type or not ticket_id:
        return jsonify({"error": "type and ticket_id are required"}), 400
    chief_name = user.get("nick") or user.get("username", "")
    note = (body.get("note") or "").strip()[:50] or None
    result = admin_fulfill(ticket_type, ticket_id, note, chief_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/queue/reject", methods=["POST"])
@rate_limit(20)
def admin_shop_reject():
    user, _, err = _require_shop_admin()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    ticket_type = (body.get("type") or "").strip()
    ticket_id = (body.get("ticket_id") or "").strip()
    reason = (body.get("reason") or "").strip()[:50]
    if not ticket_type or not ticket_id:
        return jsonify({"error": "type and ticket_id are required"}), 400
    if not reason:
        return jsonify({"error": "Reason is required"}), 400
    chief_name = user.get("nick") or user.get("username", "")
    result = admin_reject(ticket_type, ticket_id, reason, chief_name)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/changes")
@rate_limit(30)
def admin_shop_changes():
    """Paginated admin action log."""
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    page = max(1, int(request.args.get("page", 1)))
    per_page = min(200, max(1, int(request.args.get("per_page", 50))))
    return jsonify(admin_get_changes_log(
        page=page, per_page=per_page,
        actor=request.args.get("actor"),
        action=request.args.get("action"),
        target_id=request.args.get("target_id"),
        date_from=request.args.get("date_from"),
        date_to=request.args.get("date_to"),
    ))


# Cached map of shop admin discord_ids -> rank_level
_shop_admin_map_cache = {"data": {}, "ts": 0}
_SHOP_ADMIN_MAP_TTL = 300

def _get_shop_admin_map() -> dict:
    """Return {discord_id: rank_level} for all known shop admins (cached 5 min).

    Uses the Discord guild roles endpoint (one call) to get all roles,
    then checks each linked user's member record. Only members with
    Chief+ or Parliament+ roles are included.
    """
    now = time()
    if _shop_admin_map_cache["data"] and now - _shop_admin_map_cache["ts"] < _SHOP_ADMIN_MAP_TTL:
        return _shop_admin_map_cache["data"]
    result = {}
    # Include the OWNER
    owner_id = str(os.environ.get("OWNER") or "").strip()
    if owner_id.startswith("<@") and owner_id.endswith(">"):
        owner_id = owner_id.strip("<@!>").strip()
    if owner_id.isdigit():
        result[owner_id] = 3
    # Bulk-fetch guild members and pick out admins
    try:
        after = "0"
        while True:
            resp = requests.get(
                f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members",
                params={"limit": 1000, "after": after},
                headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
                timeout=10,
            )
            if not resp.ok:
                break
            batch = resp.json()
            if not batch:
                break
            for m in batch:
                did = m.get("user", {}).get("id")
                if not did or did in result:
                    continue
                roles = set(m.get("roles", []))
                lvl = _rank_level(roles)
                if lvl > 0:
                    result[did] = lvl
            if len(batch) < 1000:
                break
            after = batch[-1]["user"]["id"]
    except Exception:
        pass
    _shop_admin_map_cache["data"] = result
    _shop_admin_map_cache["ts"] = now
    return result

@app.route("/api/admin/shop/users")
@rate_limit(10)
def admin_shop_users():
    """Aggregated per-user shop activity (60-second cache; pass ?refresh=true to bypass)."""
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if request.args.get("refresh") == "true":
        from shop.admin import _invalidate_users_cache
        _invalidate_users_cache()
    users = admin_get_users()
    admin_map = _get_shop_admin_map()
    admin_banned_ids = _get_admin_banned_ids()
    for u in users:
        did = u.get("discord_id")
        u["rank_level"] = admin_map.get(did, 0) if did else 0
        u["admin_banned"] = bool(did and did in admin_banned_ids)
    is_owner = _is_owner_user(user)
    actor_level = 3 if is_owner else _rank_level(set(user.get("roles") or []))
    return jsonify({"users": users, "actor_rank_level": actor_level})


def _rank_level(roles: set) -> int:
    """Return a numeric rank level for hierarchy comparison.

    3 = OWNER (checked separately), 2 = Parliament+, 1 = Chief+, 0 = regular.
    """
    if roles & _PARLIAMENT_PLUS:
        return 2
    if roles & _CHIEF_PLUS:
        return 1
    return 0

def _fetch_target_roles(target_uuid: str) -> set | None:
    """Resolve a MC UUID to a set of Discord role IDs, or None if unresolvable."""
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    if not isinstance(matches, dict):
        return None
    target_discord_id = None
    for did, entry in matches.items():
        if isinstance(entry, dict) and entry.get("uuid") == target_uuid:
            target_discord_id = did
            break
    if not target_discord_id:
        return None
    try:
        resp = requests.get(
            f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members/{target_discord_id}",
            headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
            timeout=10,
        )
        if resp.ok:
            return set(resp.json().get("roles", []))
    except Exception:
        pass
    return None

@app.route("/api/admin/shop/users/<uuid>/ban", methods=["POST"])
@rate_limit(10)
def admin_shop_ban_user(uuid):
    """Ban a user from the shop (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    # Hierarchy check: cannot ban someone at same or higher rank
    is_owner = _is_owner_user(user)
    actor_level = 3 if is_owner else _rank_level(set(user.get("roles") or []))
    target_roles = _fetch_target_roles(uuid)
    if target_roles is not None:
        target_level = _rank_level(target_roles)
        if target_level >= actor_level:
            return jsonify({"error": "Cannot ban a user at your rank or above"}), 403
    body = request.get_json(silent=True) or {}
    reason = (body.get("reason") or "").strip()[:200]
    if not reason:
        return jsonify({"error": "Reason is required"}), 400
    actor = user.get("nick") or user.get("username", "")
    result = admin_ban_user(uuid, reason, actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/users/<uuid>/unban", methods=["POST"])
@rate_limit(10)
def admin_shop_unban_user(uuid):
    """Unban a user from the shop (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    actor = user.get("nick") or user.get("username", "")
    result = admin_unban_user(uuid, actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/users/<discord_id>/admin-ban", methods=["POST"])
@rate_limit(10)
def admin_shop_admin_ban(discord_id):
    """Ban a shop admin from the manage shop panel (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    # Target must be a shop admin
    admin_map = _get_shop_admin_map()
    target_level = admin_map.get(discord_id, 0)
    if target_level == 0:
        return jsonify({"error": "Target is not a shop admin"}), 400
    # Hierarchy check
    is_owner = _is_owner_user(user)
    actor_level = 3 if is_owner else _rank_level(set(user.get("roles") or []))
    if target_level >= actor_level:
        return jsonify({"error": "Cannot ban a user at your rank or above"}), 403
    body = request.get_json(silent=True) or {}
    reason = (body.get("reason") or "").strip()[:200]
    if not reason:
        return jsonify({"error": "Reason is required"}), 400
    # Resolve username from users data
    users = admin_get_users()
    target_username = discord_id
    for u in users:
        if u.get("discord_id") == discord_id:
            target_username = u.get("username") or discord_id
            break
    actor = user.get("nick") or user.get("username", "")
    result = admin_ban_admin(discord_id, target_username, reason, actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/users/<discord_id>/admin-unban", methods=["POST"])
@rate_limit(10)
def admin_shop_admin_unban(discord_id):
    """Unban a shop admin from the manage shop panel (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    actor = user.get("nick") or user.get("username", "")
    result = admin_unban_admin(discord_id, actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/users/<uuid>/notes")
@rate_limit(30)
def admin_shop_user_notes(uuid):
    """Get all notes for a user (Chief+ can view)."""
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    return jsonify({"notes": get_user_notes(uuid)})


@app.route("/api/admin/shop/users/<uuid>/notes", methods=["POST"])
@rate_limit(20)
def admin_shop_add_note(uuid):
    """Add a note to a user (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    body = request.get_json(silent=True) or {}
    note = (body.get("note") or "").strip()[:200]
    if not note:
        return jsonify({"error": "Note cannot be empty"}), 400
    actor = user.get("nick") or user.get("username", "")
    result = add_user_note(uuid, note, actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/users/<uuid>/notes/<note_id>", methods=["DELETE"])
@rate_limit(20)
def admin_shop_delete_note(uuid, note_id):
    """Delete a note (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    result = delete_user_note(note_id)
    return jsonify(result), 200 if result.get("ok") else 404


@app.route("/api/admin/shop/queue/refund", methods=["POST"])
@rate_limit(10)
def admin_shop_refund():
    """Approve a refund request (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    body = request.get_json(silent=True) or {}
    purchase_id = (body.get("purchase_id") or "").strip()
    if not purchase_id:
        return jsonify({"error": "purchase_id is required"}), 400
    reason = (body.get("reason") or "").strip()[:50]
    actor = user.get("nick") or user.get("username", "")
    result = admin_refund_purchase(purchase_id, reason, actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/queue/refund/reject", methods=["POST"])
@rate_limit(10)
def admin_shop_reject_refund():
    """Reject a refund request (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    body = request.get_json(silent=True) or {}
    purchase_id = (body.get("purchase_id") or "").strip()
    if not purchase_id:
        return jsonify({"error": "purchase_id is required"}), 400
    actor = user.get("nick") or user.get("username", "")
    result = admin_reject_refund(purchase_id, actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/users/<uuid>/limits", methods=["POST"])
@rate_limit(20)
def admin_shop_set_limits(uuid):
    """Set purchase limits for a user (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    body = request.get_json(silent=True) or {}
    max_ep = body.get("max_ep_per_cycle")
    max_p  = body.get("max_purchases_per_cycle")
    # Convert to int or None
    try:
        max_ep = int(max_ep) if max_ep not in (None, "", "null") else None
    except (TypeError, ValueError):
        max_ep = None
    try:
        max_p = int(max_p) if max_p not in (None, "", "null") else None
    except (TypeError, ValueError):
        max_p = None
    actor = user.get("nick") or user.get("username", "")
    result = set_user_limits(uuid, max_ep, max_p, actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/users/<uuid>/ep-adjust", methods=["POST"])
@rate_limit(10)
def admin_shop_ep_adjust(uuid):
    """Manually adjust a user's EP balance (Parliament+ only)."""
    user, is_parliament, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    if not is_parliament:
        return jsonify({"error": "Parliament rank required"}), 403
    body = request.get_json(silent=True) or {}
    try:
        amount = int(body.get("amount", 0))
    except (TypeError, ValueError):
        return jsonify({"error": "amount must be an integer"}), 400
    if amount == 0:
        return jsonify({"error": "Amount must be non-zero"}), 400
    ep_type = (body.get("ep_type") or "").strip().lower()
    if ep_type not in ("clean", "dirty"):
        return jsonify({"error": "ep_type must be 'clean' or 'dirty'"}), 400
    reason = (body.get("reason") or "").strip()[:200]
    if not reason:
        return jsonify({"error": "Reason is required"}), 400
    actor = user.get("nick") or user.get("username", "")
    result = admin_adjust_ep(uuid, amount, ep_type, reason, actor)
    return jsonify(result), 200 if result.get("ok") else 400


@app.route("/api/admin/shop/config")
@rate_limit(10)
def admin_shop_config():
    user, _, err = _require_shop_admin(require_shop_enabled=False)
    if err:
        return err
    return jsonify(admin_get_raw_config())


_APPLICATIONS_LOCK = _threading.Lock()


@app.route("/api/applications", methods=["POST"])
@rate_limit(2, 600)
def submit_application():
    """Submit a guild application (rank, echelon role)."""
    user, err = _require_login()
    if err:
        return err
    body = request.get_json(silent=True)
    if not body or not isinstance(body, dict):
        return jsonify({"error": "Invalid request"}), 400
    form_type = (body.get("type") or "").strip()
    if form_type not in _APPLICATION_FORMS:
        return jsonify({"error": "Unknown application type"}), 400
    form = _APPLICATION_FORMS[form_type]
    # rank check
    user_roles = set(user.get("roles") or [])
    if not _user_has_min_rank(list(user_roles), form["requireRank"]):
        return jsonify({"error": "You do not meet the rank requirement for this application."}), 403
    # validate answers
    answers = body.get("answers")
    if not isinstance(answers, list) or len(answers) != len(form["questions"]):
        return jsonify({"error": "Please answer all questions."}), 400
    for a in answers:
        if not isinstance(a, str) or not a.strip():
            return jsonify({"error": "Please answer all questions."}), 400
    answers = [a.strip()[:2000] for a in answers]  # cap length
    discord_id = user.get("id", "")
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    mc_username = _mc_username(discord_id, matches)
    now_iso = _points_datetime.now(_points_timezone.utc).isoformat()
    with _APPLICATIONS_LOCK:
        data = _load_json_file(_APPLICATIONS_JSON)
        if not isinstance(data, dict) or "applications" not in data:
            data = {"applications": []}
        # prevent duplicate pending applications of the same type
        for existing in data["applications"]:
            if (existing.get("discord_id") == discord_id
                    and existing.get("type") == form_type
                    and existing.get("status") == "pending"):
                return jsonify({"error": "You already have a pending application for this."}), 409
        entry = {
            "id": str(_uuid_mod.uuid4()),
            "type": form_type,
            "title": form["title"],
            "discord_id": discord_id,
            "username": user.get("nick") or user.get("username", ""),
            "mc_username": mc_username,
            "questions": form["questions"],
            "answers": answers,
            "submitted_at": now_iso,
            "status": "pending",
        }
        data["applications"].append(entry)
        _save_json_file(_APPLICATIONS_JSON, data)
    # post to Discord in the background so the response is fast
    _post_application_discord(entry)
    return jsonify({"ok": True, "id": entry["id"]})


# Discord application posting
def _format_application_message(entry):
    """Format an application as a Discord message (bold Q, quoted A)."""
    username = entry.get("username", "Unknown")
    discord_id = entry.get("discord_id", "")
    mc = entry.get("mc_username") or "Not linked"
    title = entry.get("title", entry.get("type", ""))
    questions = entry.get("questions", [])
    answers = entry.get("answers", [])
    lines = [f"# {title}", f"Submitted by `{mc}` (<@{discord_id}>)", ""]
    for i, (q, a) in enumerate(zip(questions, answers)):
        lines.append(f"**{i + 1}. {q}**")
        for al in a.split("\n"):
            lines.append(f"> {al}")
        lines.append("")
    text = "\n".join(lines).strip()
    return text[:2000] if len(text) > 2000 else text


def _discord_poll_object(question_text, hours, multiselect=False):
    return {
        "question": {"text": question_text[:300]},
        "answers": [
            {"poll_media": {"text": "Yes"}},
            {"poll_media": {"text": "No"}},
        ],
        "duration": hours,
        "allow_multiselect": multiselect,
    }


def _discord_headers():
    return {"Authorization": f"Bot {DISCORD_TOKEN}", "Content-Type": "application/json"}


def _post_application_discord(entry):
    """Fire-and-forget: post the application to Discord in a background thread."""
    def _worker():
        try:
            _do_post_application_discord(entry)
        except Exception as exc:
            import sys
            print(f"[APP] Discord post failed for {entry.get('type')}: {exc}", file=sys.stderr)
    _threading.Thread(target=_worker, daemon=True).start()


def _do_post_application_discord(entry):
    form_type = entry["type"]
    dc = _APPLICATION_DISCORD.get(form_type)
    if not dc or not DISCORD_TOKEN:
        return

    channel = dc["dev_channel"] if DEV_MODE else dc["channel"]
    headers = _discord_headers()
    content = _format_application_message(entry)
    username = entry.get("username", "Unknown")
    mc_username = entry.get("mc_username", "Unknown")
    title = entry.get("title", form_type)
    poll_q = f"{mc_username} {title.replace(' Application', '')}"
    poll_hours = dc.get("poll_hours", 24)
    ping_role = dc.get("ping_role")
    use_thread = dc.get("use_thread", False)

    if use_thread:
        _post_grand_duke(entry, dc, channel, headers, content, poll_q, poll_hours)
        return

    # Standard flow: message + poll
    msg_content = content
    allowed = {}
    if ping_role:
        msg_content = f"<@&{ping_role}>\n\n{content}"
        allowed = {"allowed_mentions": {"roles": [ping_role]}}

    resp = requests.post(
        f"{DISCORD_API}/channels/{channel}/messages",
        json={"content": msg_content, **allowed},
        headers=headers, timeout=15,
    )
    if not resp.ok:
        return

    # poll as a follow-up message
    requests.post(
        f"{DISCORD_API}/channels/{channel}/messages",
        json={"poll": _discord_poll_object(poll_q, poll_hours)},
        headers=headers, timeout=15,
    )


def _post_grand_duke(entry, dc, channel, headers, content, poll_q, poll_hours):
    discord_id = entry.get("discord_id", "")
    username = entry.get("username", "Unknown")

    # check if applicant has Parliament role in the parli server
    check_server = _DEV_SERVER_ID if DEV_MODE else _PARLI_SERVER_ID
    has_parli = False
    try:
        r = requests.get(
            f"{DISCORD_API}/guilds/{check_server}/members/{discord_id}",
            headers=headers, timeout=10,
        )
        if r.ok:
            has_parli = _PARLI_PARLI_ROLE in (r.json().get("roles") or [])
    except requests.RequestException:
        pass

    if has_parli:
        # private thread → post app inside → poll → ping individuals
        tr = requests.post(
            f"{DISCORD_API}/channels/{channel}/threads",
            json={"name": f"Grand Duke Application - {username}"[:100],
                  "type": 12, "auto_archive_duration": 1440},
            headers=headers, timeout=15,
        )
    else:
        # post app in channel → public thread from it
        mr = requests.post(
            f"{DISCORD_API}/channels/{channel}/messages",
            json={"content": content},
            headers=headers, timeout=15,
        )
        if not mr.ok:
            return
        msg_id = mr.json().get("id")
        tr = requests.post(
            f"{DISCORD_API}/channels/{channel}/messages/{msg_id}/threads",
            json={"name": f"Grand Duke Application - {username}"[:100],
                  "auto_archive_duration": 1440},
            headers=headers, timeout=15,
        )

    if not tr.ok:
        return
    thread_id = tr.json().get("id")

    # if private thread, the app text goes inside
    if has_parli:
        requests.post(
            f"{DISCORD_API}/channels/{thread_id}/messages",
            json={"content": content},
            headers=headers, timeout=15,
        )

    # poll inside the thread
    requests.post(
        f"{DISCORD_API}/channels/{thread_id}/messages",
        json={"poll": _discord_poll_object(poll_q, poll_hours)},
        headers=headers, timeout=15,
    )

    # pings
    if has_parli:
        # ping every Parliament member individually (except the applicant)
        try:
            members = []
            after = "0"
            while True:
                r = requests.get(
                    f"{DISCORD_API}/guilds/{check_server}/members",
                    params={"limit": 1000, "after": after},
                    headers=headers, timeout=10,
                )
                if not r.ok:
                    break
                batch = r.json()
                if not batch:
                    break
                members.extend(batch)
                if len(batch) < 1000:
                    break
                after = batch[-1]["user"]["id"]
            parli_ids = [
                m["user"]["id"] for m in members
                if _PARLI_PARLI_ROLE in m.get("roles", []) and m["user"]["id"] != discord_id
            ]
            if parli_ids:
                ping = " ".join(f"<@{uid}>" for uid in parli_ids)
                # split into 2000-char chunks without breaking mentions
                while ping:
                    chunk = ping[:2000]
                    if len(ping) > 2000:
                        cut = chunk.rfind(" ")
                        if cut > 0:
                            chunk = chunk[:cut]
                    requests.post(
                        f"{DISCORD_API}/channels/{thread_id}/messages",
                        json={"content": chunk,
                              "allowed_mentions": {"users": [uid for uid in parli_ids[:100]]}},
                        headers=headers, timeout=15,
                    )
                    ping = ping[len(chunk):].strip()
        except requests.RequestException:
            pass
    else:
        # ping Parliament role
        requests.post(
            f"{DISCORD_API}/channels/{thread_id}/messages",
            json={"content": f"<@&{_PARLI_PARLI_ROLE}>",
                  "allowed_mentions": {"roles": [_PARLI_PARLI_ROLE]}},
            headers=headers, timeout=15,
        )


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


import re as _re_mod
_UUID_RE = _re_mod.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', _re_mod.IGNORECASE)

def _points_player_table(uuid):
    """Build a safe table name from a player UUID.

    Validates the UUID format to prevent SQL injection via table-name
    interpolation.  Raises ValueError if the UUID doesn't match the
    expected hex-and-dashes pattern.
    """
    if not uuid or not _UUID_RE.match(uuid):
        raise ValueError(f"Invalid UUID for table name: {uuid!r}")
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


def _points_is_dirty_reason(reason):
    """Mirror utils.esi_points.is_dirty_reason: True if the EP reason is dirty for HR."""
    r = (reason or "").strip().lower()
    return r in {"guild raid", "war"} or r.startswith("quest")


def _points_fetch_player_history(uuid):
    """Return full history records for a single player UUID (newest first)."""
    table = _points_player_table(uuid)
    try:
        conn = _sqlite3.connect(_POINTS_DB)
        c = conn.cursor()
        try:
            c.execute(
                f'SELECT record_id, username, points_gained, cycle_id, reason, timestamp, '
                f'COALESCE(is_dirty, 0) '
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
            "is_dirty": r[6],
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
    """Return list of {uuid, username, points, clean_ep, dirty_ep} summed across the given cycles, restricted to guild members."""
    if not cycle_ids:
        return []
    try:
        conn = _sqlite3.connect(_POINTS_DB)
        c = conn.cursor()
        placeholders = ",".join("?" * len(cycle_ids))
        c.execute(
            f"SELECT uuid, username, SUM(points), SUM(clean_ep), SUM(dirty_ep) "
            f"FROM esi_points WHERE cycle_id IN ({placeholders}) GROUP BY uuid",
            cycle_ids,
        )
        rows = c.fetchall()
        conn.close()
    except _sqlite3.OperationalError:
        return []
    out = []
    for uuid, username, pts, clean, dirty in rows:
        if guild_members and (username or "").lower() not in guild_members:
            continue
        out.append({"uuid": uuid, "username": username, "points": int(pts or 0),
                     "clean_ep": int(clean or 0), "dirty_ep": int(dirty or 0)})
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
        clean = r.get("clean_ep", 0)
        dirty = r.get("dirty_ep", 0)
        # Fallback: if persisted values are both 0 but points > 0, compute from history
        if clean == 0 and dirty == 0 and r["points"] > 0:
            rank = guild_ranks.get((r["username"] or "").lower(), "")
            if rank in _POINTS_HR_RANKS:
                dirty = sum(h["points_gained"] for h in cycle_history if _points_is_dirty_reason(h.get("reason")))
                clean = r["points"] - dirty
            else:
                clean = r["points"]
        enriched.append({
            "uuid": uuid,
            "username": r["username"],
            "points": r["points"],
            "clean_ep": clean,
            "dirty_ep": dirty,
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
            "SELECT cycle_id, points, clean_ep, dirty_ep FROM esi_points WHERE uuid = ? AND cycle_id IN (?, ?)",
            (uuid, current_cycle, previous_cycle),
        )
        cycle_rows = {r[0]: {"points": int(r[1] or 0), "clean_ep": int(r[2] or 0), "dirty_ep": int(r[3] or 0)} for r in c.fetchall()}
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
        pts = sum(cycle_rows.get(cid, {}).get("points", 0) for cid in cycle_ids)
        clean = sum(cycle_rows.get(cid, {}).get("clean_ep", 0) for cid in cycle_ids)
        dirty = sum(cycle_rows.get(cid, {}).get("dirty_ep", 0) for cid in cycle_ids)
        # Fallback: if persisted values are both 0 but points > 0, compute from history
        cycle_history = [h for h in history if h["cycle_id"] in cycle_ids]
        if clean == 0 and dirty == 0 and pts > 0:
            rank = guild_ranks.get((resolved_name or "").lower(), "")
            if rank in _POINTS_HR_RANKS:
                dirty = sum(h["points_gained"] for h in cycle_history if _points_is_dirty_reason(h.get("reason")))
                clean = pts - dirty
            else:
                clean = pts
        le = _points_calc_le(resolved_name, pts, cycle_history, guild_ranks)
        board = boards[board_key]
        entry = next((p for p in board["players"] if p["uuid"] == uuid), None)
        return {
            **meta,
            "points": pts,
            "clean_ep": clean,
            "dirty_ep": dirty,
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
_EVENT_MAX_DESC      = 1000
_EVENT_MAX_PRIZE_VAL = 40
_EVENT_MAX_PRIZE_DSC = 150
_EVENT_MAX_LOCATION  = 30
_EVENT_MAX_PRIZES    = 5
_EVENT_PARTICIPATION_POSITION = 0
_EVENT_MAX_ESI_POINTS_VALUE   = 10000
_EVENT_MAX_PARTICIPANTS = 99


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


def _derived_event_status(ev, now=None):
    """Return the timestamp-derived status of an event.

    - starts_at unset             -> 'upcoming' (display fallback)
    - starts_at in the future     -> 'upcoming'
    - starts_at in the past, no ends_at or ends_at in the future -> 'ongoing'
    - ends_at in the past         -> 'completed'
    """
    if now is None:
        now = _points_datetime.now()
    starts = _parse_event_datetime(ev.get("starts_at"))
    ends   = _parse_event_datetime(ev.get("ends_at"))
    if ends is not None and now >= ends:
        return "completed"
    if starts is not None and now >= starts:
        return "ongoing"
    return "upcoming"


def _auto_transition_event_status(ev, now=None):
    """Reconcile an event's status with its timestamps.

    If the event's status is forced (status_forced=True) we leave it alone,
    only enforcing pin invariants. Otherwise we recompute the status from
    starts_at / ends_at and persist it.

    Returns True if anything was changed (caller should persist).
    """
    if not isinstance(ev, dict):
        return False
    forced = bool(ev.get("status_forced"))
    status = (ev.get("status") or "upcoming").strip().lower()
    changed = False
    if forced:
        # Forced statuses never auto-transition
        return _enforce_pin_invariants(ev)
    derived = _derived_event_status(ev, now=now)
    if derived != status:
        ev["status"]     = derived
        ev["updated_at"] = time()
        changed = True
    if _enforce_pin_invariants(ev):
        changed = True
    return changed


# Ranking used to detect downgrades on un-timed events
_STATUS_RANK = {"upcoming": 0, "ongoing": 1, "completed": 2, "cancelled": 2}


def _allowed_manual_statuses(ev, user, now=None):
    """Return the set of statuses a user is allowed to manually move `ev` to.

    Implements the per-scenario rules:
        - Scenario 1 (starts_at only):  Completed / Cancelled
        - Scenario 2 (starts + ends):   Cancelled
        - Scenario 3 (no timestamps):   Any non-downgrade transition
    Event Managers / Parliament members are unrestricted (every status).
    """
    if not user:
        return set()
    user_roles = set(user.get("roles") or [])
    if user_roles & _EVENTS_MANAGE_ANY:
        return {"upcoming", "ongoing", "completed", "cancelled"}
    starts = _parse_event_datetime(ev.get("starts_at"))
    ends   = _parse_event_datetime(ev.get("ends_at"))
    current = (ev.get("status") or "upcoming").strip().lower()
    # Terminal states are immutable for non-managers regardless of scenario
    if current in ("completed", "cancelled"):
        return set()
    if starts is not None and ends is not None:
        return {"cancelled"}
    if starts is not None:
        return {"completed", "cancelled"}
    # Scenario 3: no timestamps - allow any forward transition only
    cur_rank = _STATUS_RANK.get(current, 0)
    return {s for s, rank in _STATUS_RANK.items() if rank >= cur_rank and s != current}


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
        "passive":             bool(event.get("passive")),
    }


def _clean_prize_entry(raw):
    """Validate one prize dict. Returns (clean_dict, error_str)."""
    if not isinstance(raw, dict):
        return None, "each prize must be an object"

    # position: 0 is the participation prize, 1..N are normal placements
    raw_pos = raw.get("position", 1)
    try:
        position = int(raw_pos)
    except (TypeError, ValueError):
        return None, "prize position must be an integer"
    if position < 0 or position > _EVENT_MAX_PRIZES:
        return None, (
            f"prize position must be between 0 (participation) and "
            f"{_EVENT_MAX_PRIZES}"
        )

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
        if n > _EVENT_MAX_ESI_POINTS_VALUE:
            return None, (
                f"prize value cannot exceed {_EVENT_MAX_ESI_POINTS_VALUE} "
                f"ESI Points"
            )
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
        prizes.sort(key=lambda p: (p["position"] == 0, p["position"]))
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
        if cap > _EVENT_MAX_PARTICIPANTS:
            return None, f"max_participants cannot exceed {_EVENT_MAX_PARTICIPANTS}"
        out["max_participants"] = cap

    out["status"] = (existing.get("status") or "upcoming").strip().lower()
    out["status_forced"] = bool(existing.get("status_forced"))

    audience = (
        body.get("audience")
        or existing.get("audience")
        or _EVENT_DEFAULT_AUDIENCE
    )
    audience = str(audience).strip().lower()
    if audience not in _EVENT_AUDIENCES:
        return None, f"Invalid audience. Must be one of {sorted(_EVENT_AUDIENCES)}"
    out["audience"] = audience

    # Optional `passive` flag: a passive ongoing event won't trigger the breathing-dot sidebar indicator
    raw_passive = body.get("passive", existing.get("passive", False))
    out["passive"] = bool(raw_passive)

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
        view["can_manage"]    = can_manage
        view["can_pin"]       = can_pin
        view["pinned"]        = bool(ev.get("pinned"))
        view["pinned_at"]     = ev.get("pinned_at") or 0
        view["status_forced"] = bool(ev.get("status_forced"))
        view["allowed_status_transitions"] = sorted(
            _allowed_manual_statuses(ev, user)
        )
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
    event["created_at"]    = now
    event["updated_at"]    = now
    event["status"]        = "upcoming"
    event["status_forced"] = False
    event.setdefault("passive", False)
    _auto_transition_event_status(event)
    data[event_id] = event
    _save_json_file(_EVENTS_JSON, data)
    out = dict(event)
    out["can_manage"]    = True
    out["status_forced"] = bool(event.get("status_forced"))
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
    user_roles = set(user.get("roles") or [])
    if _auto_transition_event_status(ev):
        data[event_id] = ev
    current_status = (ev.get("status") or "upcoming").strip().lower()
    if current_status in ("completed", "cancelled") and not (user_roles & _EVENTS_MANAGE_ANY):
        return jsonify({
            "error": "This event is closed and can only be edited by an Event Manager or Parliament.",
        }), 403
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
    if not updated.get("status_forced"):
        _auto_transition_event_status(updated)
    _enforce_pin_invariants(updated)
    data[event_id] = updated
    _save_json_file(_EVENTS_JSON, data)
    out = dict(updated)
    out["can_manage"]    = True
    out["status_forced"] = bool(updated.get("status_forced"))
    return jsonify(out)


@app.route("/api/events/<event_id>/status", methods=["PATCH"])
@rate_limit(30)
def events_set_status(event_id):
    """Manually move an event into a different lifecycle status.

    Sets `status_forced=True` so the auto-transition pass leaves the new
    value alone. Allowed transitions are gated by `_allowed_manual_statuses`.

    A special target of `"auto"` clears the forced flag and resumes
    auto-derived status from starts_at / ends_at.
    """
    user, err = _require_role(_EVENTS_ACCESS)
    if err:
        return err
    data = _load_json_file(_EVENTS_JSON) or {}
    ev = data.get(event_id)
    if not ev:
        return jsonify({"error": "Event not found"}), 404
    if not _user_can_manage_event(user, ev):
        return jsonify({"error": "You can only edit events you created"}), 403
    if _auto_transition_event_status(ev):
        data[event_id] = ev
    body = request.get_json(silent=True) or {}
    target = (body.get("status") or "").strip().lower()
    user_roles = set(user.get("roles") or [])
    if target == "auto":
        if not ev.get("status_forced"):
            out = dict(ev)
            _migrate_legacy_prize(out)
            out["can_manage"]    = True
            out["status_forced"] = False
            return jsonify(out)
        current = (ev.get("status") or "upcoming").strip().lower()
        if current in ("completed", "cancelled") and not (user_roles & _EVENTS_MANAGE_ANY):
            return jsonify({
                "error": "This event is closed and can only be reopened by an Event Manager or Parliament.",
            }), 403
        ev["status_forced"] = False
        _auto_transition_event_status(ev)
        ev["updated_at"]    = time()
        _enforce_pin_invariants(ev)
        data[event_id] = ev
        _save_json_file(_EVENTS_JSON, data)
        out = dict(ev)
        _migrate_legacy_prize(out)
        out["can_manage"]    = True
        out["status_forced"] = bool(ev.get("status_forced"))
        return jsonify(out)
    if target not in _EVENT_STATUSES:
        return jsonify({"error": f"Invalid status. Must be one of {sorted(_EVENT_STATUSES)}"}), 400
    current = (ev.get("status") or "upcoming").strip().lower()
    if target == current:
        out = dict(ev)
        _migrate_legacy_prize(out)
        out["can_manage"]    = True
        out["status_forced"] = bool(ev.get("status_forced"))
        return jsonify(out)
    allowed = _allowed_manual_statuses(ev, user)
    if target not in allowed:
        return jsonify({
            "error": "That status change isn't allowed for this event.",
        }), 403
    ev["status"]        = target
    ev["status_forced"] = True
    ev["updated_at"]    = time()
    _enforce_pin_invariants(ev)
    data[event_id] = ev
    _save_json_file(_EVENTS_JSON, data)
    out = dict(ev)
    _migrate_legacy_prize(out)
    out["can_manage"]    = True
    out["status_forced"] = bool(ev.get("status_forced"))
    return jsonify(out)


@app.route("/api/events/<event_id>", methods=["DELETE"])
@rate_limit(30)
def events_delete(event_id):
    user, err = _require_role(_EVENTS_MANAGE_ANY)
    if err:
        return err
    data = _load_json_file(_EVENTS_JSON) or {}
    ev = data.get(event_id)
    if not ev:
        return jsonify({"ok": True})
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
    # Completed / cancelled events cannot be pinned
    current_status = (ev.get("status") or "upcoming").strip().lower()
    if current_status in ("completed", "cancelled"):
        return jsonify({
            "error": "Completed or cancelled events cannot be pinned.",
        }), 400
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


# Statistics view (per-member rollup + queue/joins/leaves history)

def _statistics_esi_points_by_user():
    """Sum total ESI points per username (lower-cased) across all cycles."""
    if not os.path.exists(_POINTS_DB):
        return {}
    try:
        conn = _sqlite3.connect(_POINTS_DB)
        rows = conn.execute(
            "SELECT username, SUM(points) FROM esi_points GROUP BY uuid"
        ).fetchall()
        conn.close()
    except _sqlite3.OperationalError:
        return {}
    out = {}
    for username, pts in rows:
        if not username:
            continue
        out[username.lower()] = int(pts or 0)
    return out


def _statistics_queue_history(days=60):
    """Sample queue_stats from up to *days* most recent api_tracking dbs (last snapshot per day)."""
    from datetime import datetime as _dt
    if not os.path.isdir(_API_TRACKING_DIR):
        return []
    api_days = []
    for name in os.listdir(_API_TRACKING_DIR):
        if not name.startswith("api_"):
            continue
        path = os.path.join(_API_TRACKING_DIR, name)
        if not os.path.isdir(path):
            continue
        try:
            day_dt = _dt.strptime(name[4:], "%d-%m-%Y")
        except ValueError:
            continue
        files = sorted(f for f in os.listdir(path) if f.endswith(".db"))
        if files:
            api_days.append((day_dt, os.path.join(path, files[-1])))
    api_days.sort(key=lambda x: x[0])
    api_days = api_days[-days:]
    history = []
    for day_dt, db_path in api_days:
        try:
            c = _sqlite3.connect(db_path, check_same_thread=False)
            row = c.execute(
                "SELECT total_count, timestamp FROM queue_stats ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
            c.close()
        except Exception:
            continue
        if not row:
            continue
        history.append({
            "date":      day_dt.date().isoformat(),
            "total":     int(row[0] or 0),
            "timestamp": row[1],
        })
    return history


def _load_snipes_by_uuid():
    """Aggregate claim_snipes.db rows into per-uuid totals.

    Returns a dict ``{uuid: {"snipe_count": int, "total_points": int,
    "roles": {role: count}}}``. Empty when the snipes DB is missing or empty
    so callers can safely treat it as a default.
    """
    if not os.path.exists(_SNIPES_DB):
        return {}
    try:
        conn = _sqlite3.connect(_SNIPES_DB)
        conn.row_factory = _sqlite3.Row
        c = conn.cursor()

        c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='snipes'"
        )
        if not c.fetchone():
            conn.close()
            return {}

        snipe_points_by_id = {}
        for r in c.execute("SELECT snipe_id, points FROM snipes").fetchall():
            snipe_points_by_id[r["snipe_id"]] = int(r["points"] or 0)

        c.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'player_%'"
        )
        tables = [row[0] for row in c.fetchall()]

        result: dict = {}
        for table in tables:
            if not table.startswith("player_"):
                continue
            uuid = table[len("player_"):].replace("_", "-")
            try:
                rows = c.execute(
                    f'SELECT snipe_id, role FROM "{table}"'
                ).fetchall()
            except _sqlite3.OperationalError:
                continue
            entry = result.setdefault(uuid, {
                "snipe_count": 0,
                "total_points": 0,
                "roles": {},
            })
            for r in rows:
                role = r[1] or "Unknown"
                entry["snipe_count"] += 1
                entry["total_points"] += snipe_points_by_id.get(r[0], 0)
                entry["roles"][role] = entry["roles"].get(role, 0) + 1

        conn.close()
        return result
    except _sqlite3.Error:
        return {}


@app.route("/api/guild/statistics")
@rate_limit(20)
def guild_statistics():
    """Aggregated guild statistics for the Statistics view.

    Returns per-member stats (filtered by guild_prefix=ESI), queue history,
    and join/leave events with tenure information.
    """
    latest_db = _get_latest_api_db()
    if not latest_db:
        resp = jsonify({"available": False, "reason": "no api db"})
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return resp

    try:
        conn = _sqlite3.connect(latest_db, check_same_thread=False)

        member_rows = conn.execute("""
            SELECT username, uuid, guild_rank, playtime, wars, total_level,
                   mobs_killed, chests_found, dungeons_total, raids_total,
                   world_events, loot_runs, caves, completed_quests,
                   pvp_kills, pvp_deaths
              FROM player_stats
             WHERE UPPER(guild_prefix) = 'ESI'
        """).fetchall()

        # Guild raid totals - keyed by uuid (and lowercase username as fallback)
        graid_by_uuid = {}
        graid_by_user = {}
        try:
            for row in conn.execute(
                "SELECT username, uuid, total_graids FROM guild_raid_stats"
            ).fetchall():
                if row[1]:
                    graid_by_uuid[row[1]] = int(row[2] or 0)
                if row[0]:
                    graid_by_user[row[0].lower()] = int(row[2] or 0)
        except _sqlite3.OperationalError:
            pass

        # Recruited counts by recruiter UUID
        recruited_counts = {}
        try:
            for r in conn.execute(
                "SELECT recruiter, COUNT(*) FROM recruited GROUP BY recruiter"
            ).fetchall():
                if r[0]:
                    recruited_counts[r[0]] = int(r[1] or 0)
        except _sqlite3.OperationalError:
            pass

        event_points = {}
        try:
            for r in conn.execute("SELECT player, points FROM event_progress").fetchall():
                if r[0]:
                    event_points[r[0].lower()] = int(r[1] or 0)
        except _sqlite3.OperationalError:
            pass

        quest_points = {}
        try:
            for r in conn.execute("SELECT player, points FROM quest_progress").fetchall():
                if r[0]:
                    quest_points[r[0].lower()] = int(r[1] or 0)
        except _sqlite3.OperationalError:
            pass

        queue_now = {"total": 0, "timestamp": None}
        try:
            qrow = conn.execute(
                "SELECT total_count, timestamp FROM queue_stats ORDER BY rowid DESC LIMIT 1"
            ).fetchone()
            if qrow:
                queue_now = {
                    "total":     max(0, int(qrow[0] or 0)),
                    "timestamp": qrow[1],
                }
        except _sqlite3.OperationalError:
            pass

        conn.close()
    except Exception as exc:
        resp = jsonify({"available": False, "error": str(exc)})
        resp.status_code = 500
        resp.headers["X-Content-Type-Options"] = "nosniff"
        resp.headers["X-Frame-Options"] = "DENY"
        resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return resp

    esi_points_by_user = _statistics_esi_points_by_user()

    # The current guild member list comes straight from the latest api_tracking
    tracked = _load_json_file(_TRACKED_GUILD_JSON) or {}
    member_history = tracked.get("member_history", {}) or {}
    joined_by_uuid = {}
    joined_by_username = {}

    prev_members = ((tracked.get("previous_data") or {}).get("members") or {})
    if isinstance(prev_members, dict):
        for rank_list in prev_members.values():
            if not isinstance(rank_list, list):
                continue
            for entry in rank_list:
                if not isinstance(entry, dict):
                    continue
                joined = entry.get("joined")
                if not joined:
                    continue
                uuid = entry.get("uuid")
                username = (entry.get("username") or "").lower()
                if uuid:
                    joined_by_uuid[uuid] = joined
                if username:
                    joined_by_username[username] = joined

    # member_history acts as a fallback for anyone missing from the snapshot above
    for entry in member_history.values():
        if not isinstance(entry, dict):
            continue
        if entry.get("left"):
            continue
        joined = entry.get("joined")
        if not joined:
            continue
        uuid = entry.get("uuid")
        username = (entry.get("username") or "").lower()
        if uuid and uuid not in joined_by_uuid:
            joined_by_uuid[uuid] = joined
        if username and username not in joined_by_username:
            joined_by_username[username] = joined

    snipes_by_uuid = _load_snipes_by_uuid()

    members = []
    for r in member_rows:
        username = r[0] or ""
        uuid = r[1] or ""
        ulow = username.lower()
        snipe_entry = snipes_by_uuid.get(uuid) or {}
        members.append({
            "username":         username,
            "uuid":             uuid,
            "rank":             ((r[2] or "").lower() or None),
            "joined":           joined_by_uuid.get(uuid) or joined_by_username.get(ulow),
            "playtime_hours":   round((r[3] or 0) / 3600.0, 1),
            "wars":             int(r[4] or 0),
            "total_level":      int(r[5] or 0),
            "mobs_killed":      int(r[6] or 0),
            "chests_found":     int(r[7] or 0),
            "dungeons_total":   int(r[8] or 0),
            "raids_total":      int(r[9] or 0),
            "world_events":     int(r[10] or 0),
            "loot_runs":        int(r[11] or 0),
            "caves":            int(r[12] or 0),
            "completed_quests": int(r[13] or 0),
            "pvp_kills":        int(r[14] or 0),
            "pvp_deaths":       int(r[15] or 0),
            "guild_raids":      int(graid_by_uuid.get(uuid, graid_by_user.get(ulow, 0)) or 0),
            "recruited":        int(recruited_counts.get(uuid, 0)),
            "event_points":     int(event_points.get(ulow, 0)),
            "quest_points":     int(quest_points.get(ulow, 0)),
            "esi_points":       int(esi_points_by_user.get(ulow, 0)),
            "snipe_count":      int(snipe_entry.get("snipe_count", 0)),
            "snipe_points":     int(snipe_entry.get("total_points", 0)),
            "snipe_roles":      dict(snipe_entry.get("roles", {})),
        })

    # joins/leaves history - unbounded by what's stored in event_history
    events = tracked.get("event_history", []) or []
    from datetime import datetime as _dt

    def _parse_iso(value):
        if not value:
            return None
        try:
            return _dt.fromisoformat(str(value).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            return None

    joins = []
    leaves = []
    for ev in events:
        etype = ev.get("type")
        if etype == "member_joined":
            joins.append({
                "username":  ev.get("username"),
                "uuid":      ev.get("uuid"),
                "rank":      ev.get("rank"),
                "timestamp": ev.get("timestamp"),
            })
        elif etype == "member_left":
            uuid = ev.get("uuid")
            tenure_seconds = None
            mh = member_history.get(uuid) if uuid else None
            mh_joined = mh.get("joined") if isinstance(mh, dict) else None
            ts_left = _parse_iso(ev.get("timestamp"))
            ts_joined = _parse_iso(mh_joined)
            if ts_left and ts_joined:
                try:
                    tenure_seconds = max(0, int((ts_left - ts_joined).total_seconds()))
                except (TypeError, ValueError):
                    tenure_seconds = None
            leaves.append({
                "username":       ev.get("username"),
                "uuid":           uuid,
                "rank":           ev.get("rank"),
                "timestamp":      ev.get("timestamp"),
                "tenure_seconds": tenure_seconds,
                "contributed":    ev.get("contributed"),
            })

    queue_history = _statistics_queue_history(60)

    payload = {
        "available":     True,
        "members":       members,
        "queue":         {"current": queue_now, "history": queue_history},
        "joins":         joins,
        "leaves":        leaves,
        "member_count":  len(members),
    }
    resp = jsonify(payload)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return resp


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

# Whitelist + validation rules. Anything not listed here is dropped.
_SETTINGS_STRING_ENUMS = {
    "defaultGraphMetric": {
        "playtime", "wars", "guildRaids", "mobsKilled", "chestsFound",
        "questsDone", "totalLevel", "contentDone", "dungeons", "raids",
        "worldEvents", "caves",
    },
    "guildDefaultMetric": {
        "playerCount", "wars", "guildRaids", "newMembers", "totalMembers",
    },
    "checkerType":   {"first", "second"},
    # "acive" preserved for back-compat with the existing typoed option value
    "checkerTab":    {"inactive", "active", "acive", "exempt"},
    "promotionsTab": {"recruiter", "captain"},
}

_SETTINGS_INT_RANGES = {
    "defaultGraphRange": (2, 60),
    "guildDefaultRange": (2, 60),
    "checkerHours":      (0, 10),
    "toastDuration":     (1, 15),
    "toastMax":          (1, 6),
}

_SETTINGS_BOOLS = {
    "toastsEnabled", "showEventsNavBadge", "showPinnedBanner",
    "shopAuctionDmOptOut",
}

_SETTINGS_STRING_MAXLEN = {
    "defaultPlayer": 16,  # Minecraft/Wynncraft username max length
}

_USERNAME_RE = _re.compile(r"^[A-Za-z0-9_]{0,16}$")

_SETTINGS_MAX_BODY_BYTES = 8 * 1024  # 8 KB - more than enough for the whitelist


def _sanitize_settings(body):
    """Return a new dict containing only known, validated settings."""
    clean = {}
    for key, val in body.items():
        if not isinstance(key, str):
            continue
        if key in _SETTINGS_STRING_ENUMS:
            if isinstance(val, str) and val in _SETTINGS_STRING_ENUMS[key]:
                clean[key] = val
        elif key in _SETTINGS_INT_RANGES:
            if isinstance(val, bool):
                continue  # bool is an int subclass, reject explicitly
            try:
                num = int(val)
            except (TypeError, ValueError):
                continue
            lo, hi = _SETTINGS_INT_RANGES[key]
            clean[key] = max(lo, min(hi, num))
        elif key in _SETTINGS_BOOLS:
            if isinstance(val, bool):
                clean[key] = val
        elif key in _SETTINGS_STRING_MAXLEN:
            if not isinstance(val, str):
                continue
            trimmed = val.strip()[: _SETTINGS_STRING_MAXLEN[key]]
            if key == "defaultPlayer":
                if trimmed == "" or _USERNAME_RE.match(trimmed):
                    clean[key] = trimmed
            else:
                clean[key] = trimmed
        # unknown keys are silently dropped
    return clean


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
    if request.content_length is not None and request.content_length > _SETTINGS_MAX_BODY_BYTES:
        return jsonify({"error": "Settings payload too large"}), 413
    body = request.get_json(silent=True)
    if body is None or not isinstance(body, dict):
        return jsonify({"error": "Invalid settings"}), 400
    clean = _sanitize_settings(body)
    now = time()
    settings_str = json.dumps(clean)
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
    start_auction_close_worker()
    print()
    print("  ESI Routes Service")
    print("  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500")
    print(f"  Listening on 127.0.0.1:{ROUTES_PORT}")
    print("  Auction close worker running (60s interval)")
    print("  Press Ctrl+C to stop")
    print()
    app.run(host="127.0.0.1", port=ROUTES_PORT, debug=False, threaded=True)
