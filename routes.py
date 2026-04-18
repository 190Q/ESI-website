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
    _POINTS_DB,
    _USER_DB_PATH, _UPLOAD_DIR,
    WYNN_BASE, DISCORD_API, DISCORD_TOKEN, DISCORD_CLIENT_ID,
    DISCORD_CLIENT_SECRET, DISCORD_GUILD_ID, DISCORD_REDIRECT_URI,
    GITHUB_TOKEN, GITHUB_REPO, HEADERS as API_HEADERS,
    CACHE_TTL, PLAYTIME_CACHE_TTL, BULK_PLAYTIME_REFRESH,
    CACHE_URL, ROUTES_PORT,
    _ROLE_VALAENDOR, _ROLE_PARLIAMENT, _ROLE_CONGRESS, _ROLE_JUROR, _ROLE_CITIZEN,
    _ROLE_GRAND_DUKE, _ROLE_ARCHDUKE,
    _PARLIAMENT_PLUS, _JUROR_PLUS, _CHIEF_PLUS, _CITIZEN_PLUS,
    _CLIENT_CONFIG,
    PLAYER_BULK_METRIC_KEYS, GUILD_BULK_METRIC_KEYS,
    BOT_SCREEN_SESSION, TRACKER_SCREEN_SESSION, TRACKER_SCREEN_SPECS,
    _safe_number, _parse_bool, _load_json_file, _save_json_file,
    _mc_username, _get_secret_key, _get_latest_api_db,
)

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


# player / guild API routes

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
        conn.close()
        return jsonify({
            "mobsKilled":      int(row[0] or 0),
            "chestsFound":     int(row[1] or 0),
            "questsCompleted": int(row[2] or 0),
            "contentDone":     int(row[3] or 0),
            "totalPlaytime":   int(row[4] or 0),
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
