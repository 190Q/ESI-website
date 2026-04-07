import mimetypes
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

import re as _re
import secrets
import requests
import os
import json
from flask import Flask, jsonify, abort, send_from_directory, redirect, request, session, g
from time import time
import sqlite3 as _sqlite3

_playtime_cache: dict = {}
PLAYTIME_CACHE_TTL = 300  # 5 minutes

import threading as _threading

_bulk_playtime_cache = {"data": None, "debug": None, "ts": 0}
BULK_PLAYTIME_REFRESH = 600  # 10 minutes

# rate-limit cache for activity endpoints, keyed by (ip, path)
_ACTIVITY_RATE: dict = {}
_ACTIVITY_RATE_INTERVAL = 30.0

# one lock per shared dict so threads don't stomp each other
_cache_lock          = _threading.Lock()
_playtime_cache_lock = _threading.Lock()
_bulk_playtime_lock  = _threading.Lock()
_activity_rate_lock  = _threading.Lock()
_bot_status_lock     = _threading.Lock()

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
        # don't let this grow forever
        if len(_ACTIVITY_RATE) > 10000:
            cutoff = now - 120
            stale = [k for k, v in _ACTIVITY_RATE.items() if v[0] < cutoff]
            for k in stale:
                del _ACTIVITY_RATE[k]
    return resp

RESET_SPIKE_MIN_BY_METRIC = {
    "playtime": 8,
    "wars": 15,
    "guildRaids": 25,
    "mobsKilled": 400,
    "chestsFound": 80,
    "questsDone": 20,
    "totalLevel": 20,
    "dungeons": 20,
    "raids": 15,
    "worldEvents": 20,
    "caves": 10,
}

PLAYER_BULK_METRIC_KEYS = [
    "playtime",
    "wars",
    "guildRaids",
    "mobsKilled",
    "chestsFound",
    "questsDone",
    "totalLevel",
    "contentDone",
    "dungeons",
    "raids",
    "worldEvents",
    "caves",
]

GUILD_BULK_METRIC_KEYS = [
    "playerCount",
    "wars",
    "guildRaids",
    "newMembers",
]

def _safe_number(value):
    if value is None:
        return 0
    if isinstance(value, (int, float)):
        return value
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0

def _parse_bool(value) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}

def _is_internal_bulk_request() -> bool:
    expected = (os.environ.get("ESI_INTERNAL_BULK_TOKEN") or "").strip()
    provided = (request.headers.get("X-ESI-Internal-Token") or "").strip()
    if not expected:
        return False
    try:
        return secrets.compare_digest(provided, expected)
    except Exception:
        return False

def _is_player_api_off(snapshot):
    if not snapshot:
        return False
    return all(_safe_number(snapshot.get(k, 0)) == 0 for k in [
        "playtime",
        "wars",
        "totalLevel",
        "mobsKilled",
        "chestsFound",
        "dungeons",
        "raids",
        "worldEvents",
        "caves",
        "questsDone",
    ])

def _is_reactivation_spike(prev_value, curr_value, seen_non_zero, metric_key=None, prev_snapshot=None, curr_snapshot=None):
    if prev_value is None or curr_value is None:
        return False
    prev_n = _safe_number(prev_value)
    curr_n = _safe_number(curr_value)
    if prev_n != 0 or curr_n <= 0:
        return False
    min_spike = _safe_number(RESET_SPIKE_MIN_BY_METRIC.get(metric_key, 25))
    if curr_n < min_spike:
        return False
    if seen_non_zero:
        return True
    for key in ("playtime", "wars", "totalLevel", "mobsKilled", "chestsFound", "dungeons", "raids", "worldEvents", "caves", "questsDone"):
        if key == metric_key:
            continue
        if prev_snapshot and _safe_number(prev_snapshot.get(key)) > 0:
            return True
        if curr_snapshot and _safe_number(curr_snapshot.get(key)) > 0:
            return True
    return False

app = Flask(__name__, static_folder=".", static_url_path="")

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def _load_env():
    env_path = os.path.join(_BASE_DIR, '.env')
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, _, val = line.partition('=')
                    os.environ.setdefault(key.strip(), val.strip())

_load_env()

def _require_login():
    user = session.get("user")
    if not user:
        return None, (jsonify({"error": "Authentication required"}), 401)
    return user, None

# discord role IDs used for page access checks
_ROLE_VALAENDOR  = "728858956575014964"
_ROLE_PARLIAMENT = "600185623474601995"
_ROLE_CONGRESS   = "1346436714901536858"
_ROLE_JUROR      = "954566591520063510"

_PARLIAMENT_PLUS = {_ROLE_PARLIAMENT, _ROLE_VALAENDOR}
_JUROR_PLUS      = {_ROLE_JUROR, _ROLE_CONGRESS, _ROLE_PARLIAMENT, _ROLE_VALAENDOR}

def _require_role(allowed_roles: set):
    """Checks that the user is logged in and has at least one of the given roles."""
    user, err = _require_login()
    if err:
        return None, err
    user_roles = set(user.get("roles") or [])
    if not (user_roles & allowed_roles):
        return None, (jsonify({"error": "Insufficient permissions"}), 403)
    return user, None

def _load_json_file(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        import sys
        print(f"[ERROR] Malformed JSON in {path}: {e}", file=sys.stderr)
        return {}
    except OSError as e:
        import sys
        print(f"[ERROR] Cannot read {path}: {e}", file=sys.stderr)
        return {}

def _save_json_file(path, data):
    """Write JSON atomically: write to a temp file then rename over the target.
    If the process is killed mid-write the original file is never touched.
    """
    import tempfile as _tempfile
    dir_ = os.path.dirname(os.path.abspath(path))
    fd, tmp = _tempfile.mkstemp(dir=dir_, suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4)
        os.replace(tmp, path)  # atomic on same filesystem
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise

def _mc_username(discord_id, matches):
    """Look up the Minecraft username tied to a Discord ID."""
    entry = matches.get(str(discord_id))
    if entry is None:
        return None
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        return entry.get("username")
    return None

# flask session key saved to a file so it survives server restarts
def _get_secret_key():
    key = os.environ.get("FLASK_SECRET_KEY")
    if key:
        return key
    key_path = os.path.join(_BASE_DIR, '.flask_secret')
    if os.path.exists(key_path):
        with open(key_path) as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    with open(key_path, 'w') as f:
        f.write(key)
    return key
app.secret_key = _get_secret_key()

from datetime import timedelta
app.permanent_session_lifetime = timedelta(days=30)

WYNN_BASE          = "https://api.wynncraft.com/v3"
DISCORD_API        = "https://discord.com/api/v10"
DISCORD_TOKEN      = os.environ.get("DISCORD_TOKEN", "")
DISCORD_CLIENT_ID  = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_GUILD_ID   = os.environ.get("DISCORD_GUILD_ID", "")
DISCORD_REDIRECT_URI = os.environ.get(
    "DISCORD_REDIRECT_URI", "http://localhost:5000/auth/callback"
)

# session cookie security
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
app.config["SESSION_COOKIE_SECURE"] = DISCORD_REDIRECT_URI.startswith("https://")
HEADERS = {"User-Agent": "ESI-Dashboard/1.0"}

_cache: dict = {}
CACHE_TTL = 120

def cached_get(url: str) -> dict:
    now = time()
    with _cache_lock:
        entry = _cache.get(url)
    if entry:
        data, ts = entry
        if now - ts < CACHE_TTL:
            return data
    resp = requests.get(url, headers=HEADERS, timeout=10)
    resp.raise_for_status()
    data = resp.json()
    with _cache_lock:
        _cache[url] = (data, now)
    return data

def _cors(response):
    response.headers["Access-Control-Allow-Origin"]  = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

@app.after_request
def after_request(response):
    return _cors(response)

# block direct access to sensitive files in the static root
_BLOCKED_STATIC_RE = _re.compile(
    r'^/[^/]*\.(json|db|py|pyc|env|cfg|ini|log)$',
    _re.IGNORECASE,
)

@app.before_request
def _gate_requests():
    path = request.path
    if _BLOCKED_STATIC_RE.match(path):
        abort(403)
    if path.startswith('/.'):
        abort(403)
@app.route("/")
def index():
    return send_from_directory(".", "index.html")


# oauth2, send user off to discord
@app.route("/auth/login")
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


# oauth2 callback, discord sends us back here with a code
@app.route("/auth/callback")
def auth_callback():
    error = request.args.get("error")
    if error:
        return redirect("/?auth=error")

    code  = request.args.get("code")
    state = request.args.get("state")

    # CSRF check
    if state != session.pop("oauth_state", None):
        return redirect("/?auth=error")

    try:
        # swap the code for an access token (server-to-server, secret never touches the browser)
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
            import sys
            print(f"[AUTH] Token exchange failed: {token_resp.status_code} {token_resp.text[:200]}", file=sys.stderr)
        token_resp.raise_for_status()
        tokens = token_resp.json()
        access_token = tokens["access_token"]

        # grab their discord profile
        user_resp = requests.get(
            f"{DISCORD_API}/users/@me",
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10,
        )
        if not user_resp.ok:
            import sys
            print(f"[AUTH] User fetch failed: {user_resp.status_code} {user_resp.text[:200]}", file=sys.stderr)
        user_resp.raise_for_status()
        user = user_resp.json()
    except Exception as exc:
        import sys
        print(f"[AUTH] OAuth callback error: {exc}", file=sys.stderr)
        return redirect("/?auth=error")

    # use the bot token to get their guild member info (has their roles)
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

    # grab the full role list so we can map IDs to names
    roles_resp = requests.get(
        f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/roles",
        headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
        timeout=10,
    )

    role_objects = []
    if roles_resp.ok:
        all_roles = roles_resp.json()
        role_lookup = {r["id"]: r["name"] for r in all_roles}
        # only keep roles the user actually has
        role_objects = [
            {"id": rid, "name": role_lookup.get(rid, "Unknown")}
            for rid in roles
        ]

    session.permanent = True
    session["user"] = {
        "id":            user["id"],
        "username":      user["username"],
        "nick":          nick,
        "discriminator": user.get("discriminator", "0"),
        "avatar":        user.get("avatar"),
        "roles":         roles,
        "role_objects":  role_objects,
    }
    return redirect("/?auth=success")


# session check - frontend polls this to know if we're logged in
@app.route("/auth/session")
def auth_session():
    user = session.get("user")
    if not user:
        return jsonify({"loggedIn": False})
    return jsonify({"loggedIn": True, "user": user})


# dev-only mock login (skips oauth, just give it a user ID)
@app.route("/auth/mock-login", methods=["POST"])
def auth_mock_login():
    data = request.get_json(silent=True) or {}
    user_id = (data.get("id") or "").strip()
    if not user_id:
        return jsonify({"error": "No user ID provided"}), 400

    username = user_id
    discriminator = "0"
    avatar = None
    nick = None
    roles = []
    role_objects = []

    if DISCORD_TOKEN and DISCORD_GUILD_ID:
        try:
            member_resp = requests.get(
                f"{DISCORD_API}/guilds/{DISCORD_GUILD_ID}/members/{user_id}",
                headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
                timeout=10,
            )
            if member_resp.ok:
                member_data = member_resp.json()
                roles = member_data.get("roles", [])
                nick = member_data.get("nick")
                user_obj = member_data.get("user", {})
                username = user_obj.get("username", user_id)
                discriminator = user_obj.get("discriminator", "0")
                avatar = user_obj.get("avatar")

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
        except Exception:
            pass

    session.permanent = True
    user = {
        "id":            user_id,
        "username":      username,
        "nick":          nick,
        "discriminator": discriminator,
        "avatar":        avatar,
        "roles":         roles,
        "role_objects":  role_objects,
    }
    session["user"] = user
    return jsonify({"ok": True, "user": user})


# re-pull roles/name/avatar from discord
@app.route("/auth/refresh")
def auth_refresh():
    user = session.get("user")
    if not user:
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
        return jsonify({"loggedIn": True, "user": updated})
    except Exception:
        return jsonify({"loggedIn": True, "user": user})


# logout
@app.route("/auth/logout")
def auth_logout():
    session.pop("user", None)
    return jsonify({"loggedIn": False})


bot_root                = os.path.dirname(_BASE_DIR)
_ESI_BOT_DIR            = os.path.join(bot_root, "ESI-Bot")
_ASPECTS_JSON           = os.path.join(_ESI_BOT_DIR, "aspects_data.json")
_INACTIVITY_JSON        = os.path.join(_ESI_BOT_DIR, "inactivity_exemptions.json")
_USERNAME_MATCHES_JSON  = os.path.join(_ESI_BOT_DIR, "username_matches.json")
_TRACKED_GUILD_JSON     = os.path.join(_ESI_BOT_DIR, "tracked_guild.json")
_API_TRACKING_DIR       = os.path.join(_ESI_BOT_DIR, "databases", "api_tracking")

def _get_latest_api_db():
    """Find the newest .db file in the api_tracking folder, or None."""
    from datetime import datetime as _dt
    if not os.path.isdir(_API_TRACKING_DIR):
        return None
    latest_db, latest_dt = None, None
    for name in os.listdir(_API_TRACKING_DIR):
        if not name.startswith("api_"):
            continue
        day_path = os.path.join(_API_TRACKING_DIR, name)
        if not os.path.isdir(day_path):
            continue
        try:
            day_dt = _dt.strptime(name[4:], "%d-%m-%Y")
        except ValueError:
            continue
        files = sorted(f for f in os.listdir(day_path) if f.endswith(".db"))
        if files and (latest_dt is None or day_dt > latest_dt):
            latest_dt = day_dt
            latest_db = os.path.join(day_path, files[-1])
    return latest_db

# ---- rank history (from tracked_guild.json) ----

@app.route("/api/player/<username>/rank-history")
def player_rank_history(username: str):
    """Rank changes pulled from tracked_guild.json."""
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


# ---- aspects ----

@app.route("/api/guild/aspects")
def aspects_get():
    data = _load_json_file(_ASPECTS_JSON)
    if not data:
        return jsonify({"total_aspects": 0, "members": {}})
    return jsonify(data)

@app.route("/api/guild/aspects/clear", methods=["POST"])
def aspects_clear():
    user, err = _require_role(_PARLIAMENT_PLUS)
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


# ---- playtime/metrics from sqlite snapshots ----

@app.route("/api/player/<username>/playtime-history")
def player_playtime_history(username: str):
    from datetime import datetime as _dt
    from concurrent.futures import ThreadPoolExecutor

    now = time()
    cache_key = username.lower()
    with _playtime_cache_lock:
        _pt_entry = _playtime_cache.get(cache_key)
    if _pt_entry:
        data, ts = _pt_entry
        if now - ts < PLAYTIME_CACHE_TTL:
            return jsonify(data)

    tracking_folder = os.path.join(_ESI_BOT_DIR, "databases", "playtime_tracking")

    if not os.path.isdir(tracking_folder):
        return jsonify({"username": username, "data": []})

    # gather every snapshot
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
            if not fname.endswith(".db"):
                continue
            all_snapshots.append((day_dt, fname, os.path.join(day_folder_path, fname)))

    if not all_snapshots:
        return jsonify({"username": username, "data": []})

    all_snapshots.sort(key=lambda x: (x[0], x[1]))

    def read_hours(db_path):
        try:
            conn = _sqlite3.connect(db_path, check_same_thread=False)
            row  = conn.execute(
                "SELECT playtime_seconds FROM playtime WHERE username = ? COLLATE NOCASE",
                (username,)
            ).fetchone()
            conn.close()
            return round(row[0] / 3600, 1) if row else 0.0
        except Exception:
            return 0.0

    # group by day, only keep the last snapshot per day
    day_groups = {}
    for day_dt, fname, db_path in all_snapshots:
        day_key = day_dt.date()
        day_groups.setdefault(day_key, []).append((fname, db_path))

    sorted_days = sorted(day_groups.keys())[-60:]

    # only read the last file per day
    daily_paths = [day_groups[d][-1][1] for d in sorted_days]
    recent_days = sorted_days[-7:]
    recent_set  = set(recent_days)

    # read them in parallel
    all_needed_paths = list(dict.fromkeys(daily_paths))  # deduplicated, ordered
    with ThreadPoolExecutor(max_workers=8) as ex:
        results = dict(zip(all_needed_paths, ex.map(read_hours, all_needed_paths)))

    daily  = [results[p] for p in daily_paths]
    result = {"username": username, "data": daily, "dates": [d.isoformat() for d in sorted_days]}
    with _playtime_cache_lock:
        _playtime_cache[cache_key] = (result, now)
    return jsonify(result)


def _compute_bulk_playtime():
    """Crunches playtime + stat deltas for every guild member and caches the result."""
    from datetime import datetime as _dt
    from concurrent.futures import ThreadPoolExecutor
    import glob as _glob

    _latest_db = _get_latest_api_db()
    if not _latest_db:
        # if there is nothing to work with, just write an empty cache so clients stop retrying
        _bulk_playtime_cache["data"] = {
            "members": {},
            "guild": {"dates": [], "metricDates": [], "playerCount": [], "wars": [], "guildRaids": [], "newMembers": []},
        }
        _bulk_playtime_cache["ts"] = time()
        return
    conn = _sqlite3.connect(_latest_db)
    usernames = [
        row[0] for row in conn.execute(
            "SELECT username FROM player_stats WHERE UPPER(guild_prefix) = 'ESI' ORDER BY username"
        ).fetchall()
    ]
    conn.close()
    if not usernames:
        # if there are no guild members in the db, still write empty cache
        _bulk_playtime_cache["data"] = {
            "members": {},
            "guild": {"dates": [], "metricDates": [], "playerCount": [], "wars": [], "guildRaids": [], "newMembers": []},
        }
        _bulk_playtime_cache["ts"] = time()
        return

    # playtime tracking
    tracking_folder = os.path.join(_ESI_BOT_DIR, "databases", "playtime_tracking")
    all_snapshots = []
    if os.path.isdir(tracking_folder):
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
                if not fname.endswith(".db"):
                    continue
                all_snapshots.append((day_dt, fname, os.path.join(day_folder_path, fname)))

    dates = []
    all_results = []
    if all_snapshots:
        all_snapshots.sort(key=lambda x: (x[0], x[1]))

        day_groups = {}
        for day_dt, fname, db_path in all_snapshots:
            day_key = day_dt.date()
            day_groups.setdefault(day_key, []).append((fname, db_path))

        sorted_days = sorted(day_groups.keys())[-60:]
        daily_paths = [day_groups[d][-1][1] for d in sorted_days]
        username_set = {u.lower() for u in usernames}

        def read_all_hours(db_path):
            try:
                conn = _sqlite3.connect(db_path, check_same_thread=False)
                rows = conn.execute(
                    "SELECT username, playtime_seconds FROM playtime"
                ).fetchall()
                conn.close()
                return {
                    row[0].lower(): round(row[1] / 3600, 1)
                    for row in rows if row[0].lower() in username_set
                }
            except Exception:
                return {}

        with ThreadPoolExecutor(max_workers=8) as ex:
            all_results = list(zip(daily_paths, ex.map(read_all_hours, daily_paths)))

        dates = [d.isoformat() for d in sorted_days]

    members = {}
    for username in usernames:
        ulow = username.lower()
        data = [result.get(ulow, 0.0) for _, result in all_results]
        members[ulow] = {"username": username, "data": data, "dates": dates}

    # stat deltas from api_tracking snapshots
    _STAT_COLS = [
        ("wars",             "wars"),
        ("mobs_killed",      "mobsKilled"),
        ("chests_found",     "chestsFound"),
        ("total_level",      "totalLevel"),
        ("completed_quests", "questsDone"),
        ("dungeons_total",   "dungeons"),
        ("raids_total",      "raids"),
        ("world_events",     "worldEvents"),
        ("caves",            "caves"),
    ]
    api_folder = os.path.join(_ESI_BOT_DIR, "databases", "api_tracking")
    api_snapshots = []
    metric_dates = []
    debug_members = {}
    debug_guild_intervals = []
    invalid_transitions = set()
    api_days = []
    if os.path.isdir(api_folder):
        for name in os.listdir(api_folder):
            if not name.startswith("api_"):
                continue
            path = os.path.join(api_folder, name)
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
        api_days = api_days[-61:]  # 61 snapshots → 60 deltas
        metric_dates = [day_dt.date().isoformat() for day_dt, _ in api_days[1:]]

        cols_sql = ", ".join(c[0] for c in _STAT_COLS)
        metric_keys = [c[1] for c in _STAT_COLS] + ["guildRaids"]

        def read_api_day(db_path):
            try:
                conn = _sqlite3.connect(db_path, check_same_thread=False)
                stats = {}
                for row in conn.execute(
                    f"SELECT username, guild_prefix, {cols_sql} FROM player_stats"
                    " WHERE UPPER(guild_prefix) = 'ESI'"
                ).fetchall():
                    ulow = row[0].lower()
                    entry = {"guildPrefix": (row[1] or "").upper()}
                    for i in range(len(_STAT_COLS)):
                        entry[_STAT_COLS[i][1]] = row[i + 2] or 0
                    stats[ulow] = entry
                try:
                    for row in conn.execute(
                        "SELECT username, total_graids FROM guild_raid_stats"
                    ).fetchall():
                        ulow = row[0].lower()
                        if ulow not in stats:
                            stats[ulow] = {"guildPrefix": ""}
                        stats[ulow]["guildRaids"] = row[1] or 0
                except Exception:
                    pass
                conn.close()
                return stats
            except Exception:
                return {}

        with ThreadPoolExecutor(max_workers=8) as ex:
            api_snapshots = list(ex.map(read_api_day, [d[1] for d in api_days]))

        # if there's a gap bigger than 1 day between snapshots, the bot/API was probably
        # down - skip those transitions so we don't get bogus deltas
        from datetime import timedelta as _td
        for i in range(1, len(api_days)):
            prev_dt, cur_dt = api_days[i - 1][0], api_days[i][0]
            if (cur_dt - prev_dt) > _td(days=1):
                invalid_transitions.add(i)

        debug_guild_intervals = [
            {
                "timestamp": api_days[i][0].isoformat(),
                "db": os.path.basename(api_days[i][1]),
                "day": api_days[i][0].date().isoformat(),
                "guildRaidsRawDelta": 0,
                "guildRaidsAppliedDelta": 0,
                "warsRawDelta": 0,
                "warsAppliedDelta": 0,
                "skippedMissing": 0,
                "skippedApiGap": 0,
                "skippedApiOff": 0,
                "skippedReactivation": 0,
                "reactivationUsers": [],
            }
            for i in range(1, len(api_days))
        ]

        # per-member daily deltas, with filtering for reactivation spikes
        for ulow in members:
            user_debug_intervals = []
            seen_non_zero = {}
            first_user = api_snapshots[0].get(ulow, {}) if api_snapshots else {}
            for mk in metric_keys:
                first_val = first_user.get(mk)
                seen_non_zero[mk] = first_val is not None and _safe_number(first_val) > 0

            for mk in metric_keys:
                deltas = []
                metric_seen_non_zero = seen_non_zero.get(mk, False)

                for i in range(1, len(api_snapshots)):
                    prev_snap = api_snapshots[i - 1]
                    cur_snap = api_snapshots[i]
                    prev_user = prev_snap.get(ulow)
                    curr_user = cur_snap.get(ulow)
                    prev_value = prev_user.get(mk) if prev_user else None
                    curr_value = curr_user.get(mk) if curr_user else None

                    raw_delta = None
                    if prev_value is not None and curr_value is not None:
                        raw_delta = _safe_number(curr_value) - _safe_number(prev_value)

                    applied = 0
                    reason = None
                    if i in invalid_transitions:
                        reason = "api_gap"
                    elif not prev_user or not curr_user or prev_value is None or curr_value is None:
                        reason = "missing_snapshot"
                    elif _is_player_api_off(prev_user) or _is_player_api_off(curr_user):
                        reason = "api_off_interval"
                    elif _is_reactivation_spike(
                        prev_value,
                        curr_value,
                        metric_seen_non_zero,
                        metric_key=mk,
                        prev_snapshot=prev_user,
                        curr_snapshot=curr_user,
                    ):
                        reason = "reactivation_spike"
                    else:
                        applied = raw_delta if raw_delta is not None and raw_delta > 0 else 0
                        if applied <= 0:
                            reason = "non_positive_or_unavailable"

                    if curr_value is not None and _safe_number(curr_value) > 0:
                        metric_seen_non_zero = True

                    if mk in ("wars", "guildRaids") and i - 1 < len(debug_guild_intervals):
                        gdbg = debug_guild_intervals[i - 1]
                        if mk == "wars":
                            if raw_delta is not None and raw_delta > 0:
                                gdbg["warsRawDelta"] += int(round(raw_delta))
                            if applied > 0:
                                gdbg["warsAppliedDelta"] += int(round(applied))
                        else:
                            if raw_delta is not None and raw_delta > 0:
                                gdbg["guildRaidsRawDelta"] += int(round(raw_delta))
                            if applied > 0:
                                gdbg["guildRaidsAppliedDelta"] += int(round(applied))
                            if reason == "missing_snapshot":
                                gdbg["skippedMissing"] += 1
                            elif reason == "api_gap":
                                gdbg["skippedApiGap"] += 1
                            elif reason == "api_off_interval":
                                gdbg["skippedApiOff"] += 1
                            elif reason == "reactivation_spike":
                                gdbg["skippedReactivation"] += 1
                                if raw_delta is not None and raw_delta > 0 and len(gdbg["reactivationUsers"]) < 20:
                                    gdbg["reactivationUsers"].append({
                                        "username": members[ulow]["username"],
                                        "rawDelta": int(round(raw_delta)),
                                        "prev": int(round(_safe_number(prev_value))),
                                        "curr": int(round(_safe_number(curr_value))),
                                    })

                    if mk == "guildRaids":
                        if (
                            raw_delta not in (None, 0)
                            or reason in ("missing_snapshot", "api_gap", "api_off_interval", "reactivation_spike")
                        ):
                            user_debug_intervals.append({
                                "timestamp": api_days[i][0].isoformat() if i < len(api_days) else None,
                                "db": os.path.basename(api_days[i][1]) if i < len(api_days) else None,
                                "day": api_days[i][0].date().isoformat() if i < len(api_days) else None,
                                "metric": "guildRaids",
                                "prev": None if prev_value is None else int(round(_safe_number(prev_value))),
                                "curr": None if curr_value is None else int(round(_safe_number(curr_value))),
                                "rawDelta": None if raw_delta is None else int(round(raw_delta)),
                                "appliedDelta": int(round(applied)),
                                "reason": reason or "applied",
                            })

                    deltas.append(int(round(applied)) if applied > 0 else 0)

                seen_non_zero[mk] = metric_seen_non_zero
                members[ulow][mk] = deltas

            members[ulow]["metricDates"] = metric_dates
            if user_debug_intervals:
                debug_members[ulow] = {
                    "username": members[ulow]["username"],
                    "guildRaids": user_debug_intervals[-300:],
                }

    # guild-wide totals
    num_pt_days = len(dates)
    sample_mk = next((m.get("wars", []) for m in members.values() if m.get("wars")), [])
    num_mk_days = len(sample_mk)

    # count members with any playtime each day
    player_count = [0] * num_pt_days
    for m in members.values():
        for i, v in enumerate(m.get("data", [])):
            if v > 0 and i < num_pt_days:
                player_count[i] += 1

    # sum deltas across ALL members in each snapshot
    guild_wars = [0] * num_mk_days
    guild_raids = [0] * num_mk_days
    tracked_guild_prefix = "ESI"
    debug_guild_intervals = []
    if api_snapshots and num_mk_days:
        guild_seen_non_zero = {}
        first_snap = api_snapshots[0]
        for ulow, snap in first_snap.items():
            if (snap.get("guildPrefix") or "").upper() != tracked_guild_prefix:
                continue
            guild_seen_non_zero[ulow] = {
                "wars": _safe_number(snap.get("wars")) > 0,
                "guildRaids": snap.get("guildRaids") is not None and _safe_number(snap.get("guildRaids")) > 0,
            }

        for i in range(1, len(api_snapshots)):
            day_idx = i - 1
            if day_idx >= num_mk_days:
                break
            prev_snap = api_snapshots[i - 1]
            cur_snap = api_snapshots[i]
            day_ts = api_days[i][0] if i < len(api_days) else None
            day_db = api_days[i][1] if i < len(api_days) else None

            interval_debug = {
                "timestamp": day_ts.isoformat() if day_ts else None,
                "db": os.path.basename(day_db) if day_db else None,
                "day": day_ts.date().isoformat() if day_ts else None,
                "guildRaidsRawDelta": 0,
                "guildRaidsAppliedDelta": 0,
                "warsRawDelta": 0,
                "warsAppliedDelta": 0,
                "skippedMissing": 0,
                "skippedApiGap": 0,
                "skippedApiOff": 0,
                "skippedReactivation": 0,
                "reactivationUsers": [],
            }

            if i in invalid_transitions:
                interval_debug["skippedApiGap"] = len(set(prev_snap.keys()) & set(cur_snap.keys()))
                debug_guild_intervals.append(interval_debug)
                continue

            for ulow in (set(prev_snap.keys()) & set(cur_snap.keys())):
                prev_user = prev_snap.get(ulow) or {}
                cur_user = cur_snap.get(ulow) or {}

                if (prev_user.get("guildPrefix") or "").upper() != tracked_guild_prefix:
                    continue
                if (cur_user.get("guildPrefix") or "").upper() != tracked_guild_prefix:
                    continue

                state = guild_seen_non_zero.setdefault(ulow, {
                    "wars": _safe_number(prev_user.get("wars")) > 0,
                    "guildRaids": prev_user.get("guildRaids") is not None and _safe_number(prev_user.get("guildRaids")) > 0,
                })

                if _is_player_api_off(prev_user) or _is_player_api_off(cur_user):
                    interval_debug["skippedApiOff"] += 1
                    if _safe_number(cur_user.get("wars")) > 0:
                        state["wars"] = True
                    if cur_user.get("guildRaids") is not None and _safe_number(cur_user.get("guildRaids")) > 0:
                        state["guildRaids"] = True
                    continue

                prev_wars = prev_user.get("wars")
                curr_wars = cur_user.get("wars")
                raw_wars = None if prev_wars is None or curr_wars is None else _safe_number(curr_wars) - _safe_number(prev_wars)
                if raw_wars is None:
                    interval_debug["skippedMissing"] += 1
                else:
                    if raw_wars > 0:
                        interval_debug["warsRawDelta"] += int(round(raw_wars))
                    if _is_reactivation_spike(
                        prev_wars,
                        curr_wars,
                        state.get("wars", False),
                        metric_key="wars",
                        prev_snapshot=prev_user,
                        curr_snapshot=cur_user,
                    ):
                        interval_debug["skippedReactivation"] += 1
                    else:
                        applied_wars = raw_wars if raw_wars > 0 else 0
                        if applied_wars > 0:
                            guild_wars[day_idx] += int(round(applied_wars))
                            interval_debug["warsAppliedDelta"] += int(round(applied_wars))

                prev_graids = prev_user.get("guildRaids")
                curr_graids = cur_user.get("guildRaids")
                raw_graids = None if prev_graids is None or curr_graids is None else _safe_number(curr_graids) - _safe_number(prev_graids)
                if raw_graids is None:
                    interval_debug["skippedMissing"] += 1
                else:
                    if raw_graids > 0:
                        interval_debug["guildRaidsRawDelta"] += int(round(raw_graids))
                    if _is_reactivation_spike(
                        prev_graids,
                        curr_graids,
                        state.get("guildRaids", False),
                        metric_key="guildRaids",
                        prev_snapshot=prev_user,
                        curr_snapshot=cur_user,
                    ):
                        interval_debug["skippedReactivation"] += 1
                        if raw_graids > 0 and len(interval_debug["reactivationUsers"]) < 20:
                            interval_debug["reactivationUsers"].append({
                                "username": ulow,
                                "rawDelta": int(round(raw_graids)),
                                "prev": int(round(_safe_number(prev_graids))),
                                "curr": int(round(_safe_number(curr_graids))),
                            })
                    else:
                        applied_graids = raw_graids if raw_graids > 0 else 0
                        if applied_graids > 0:
                            guild_raids[day_idx] += int(round(applied_graids))
                            interval_debug["guildRaidsAppliedDelta"] += int(round(applied_graids))

                if _safe_number(cur_user.get("wars")) > 0:
                    state["wars"] = True
                if cur_user.get("guildRaids") is not None and _safe_number(cur_user.get("guildRaids")) > 0:
                    state["guildRaids"] = True

            debug_guild_intervals.append(interval_debug)

    guild_raids = [max(0, (int(v) // 4)) for v in guild_raids]

    # new members = first time a username is seen in a snapshot
    new_members = [0] * num_mk_days
    if os.path.isdir(os.path.join(_ESI_BOT_DIR, "databases", "api_tracking")):
        try:
            seen = set(api_snapshots[0].keys()) if api_snapshots else set()
            for idx in range(1, len(api_snapshots)):
                new_today = 0
                for ulow in api_snapshots[idx]:
                    if ulow not in seen:
                        new_today += 1
                        seen.add(ulow)
                if idx - 1 < num_mk_days:
                    new_members[idx - 1] = new_today
        except Exception:
            pass

    guild_data = {
        "dates": dates,
        "metricDates": metric_dates,
        "playerCount": player_count,
        "wars":        guild_wars,
        "guildRaids":  guild_raids,
        "newMembers":  new_members,
    }

    # swap in the new data all at once
    with _bulk_playtime_lock:
        _bulk_playtime_cache["data"] = {"members": members, "guild": guild_data}
        _bulk_playtime_cache["debug"] = {
            "rules": {"resetSpikeThresholds": RESET_SPIKE_MIN_BY_METRIC},
            "members": debug_members,
            "guild": {
                "intervals": [
                    row for row in debug_guild_intervals
                    if (
                        row.get("guildRaidsRawDelta", 0) > 0
                        or row.get("guildRaidsAppliedDelta", 0) > 0
                        or row.get("skippedMissing", 0) > 0
                        or row.get("skippedApiGap", 0) > 0
                        or row.get("skippedApiOff", 0) > 0
                        or row.get("skippedReactivation", 0) > 0
                    )
                ],
                "dailyGuildRaids": [
                    {"date": metric_dates[i], "value": int(guild_raids[i])}
                    for i in range(min(len(metric_dates), len(guild_raids)))
                ],
            },
        }
        _bulk_playtime_cache["ts"] = time()


def _bulk_playtime_loop():
    """Background thread that re-crunches bulk playtime every 10 min."""
    while True:
        _threading.Event().wait(BULK_PLAYTIME_REFRESH)
        try:
            _compute_bulk_playtime()
            print("Bulk playtime cache refreshed")
        except Exception as e:
            print(f"Bulk playtime refresh failed: {e}")


@app.route("/api/guild/activity")
def guild_activity_bulk():
    """Public bulk playtime endpoint — rate-limited, no session required."""
    def _make():
        with _bulk_playtime_lock:
            _data = _bulk_playtime_cache["data"]
        if _data:
            return jsonify(_data)
        return jsonify({"members": {}, "ready": False})
    return _activity_rate_response(_make)

@app.route("/api/player/<username>/metrics-history")
def player_metrics_history(username: str):
    def _make():
        ulow = username.lower()
        with _bulk_playtime_lock:
            bulk = _bulk_playtime_cache.get("data") or {}
        member = (bulk.get("members") or {}).get(ulow)
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
            "username":    member.get("username", username) if member else username,
            "dates":       list(member.get("metricDates", [])) if member else [],
            "metricDates": list(member.get("metricDates", [])) if member else [],
            "playtimeDates": list(member.get("dates", [])) if member else [],
            "metrics":     metrics,
        })
    return _activity_rate_response(_make)

@app.route("/api/guild/prefix/<prefix>/metrics-history")
def guild_metrics_history(prefix: str):
    def _make():
        with _bulk_playtime_lock:
            bulk = _bulk_playtime_cache.get("data") or {}
        guild = bulk.get("guild") or {}
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


# ---- inactivity exemptions ----
# stored in inactivity_exemptions.json

@app.route("/api/inactivity")
def inactivity_get():
    user, err = _require_role(_PARLIAMENT_PLUS)
    if err:
        return err
    import glob as _glob
    data    = _load_json_file(_INACTIVITY_JSON)
    matches = _load_json_file(_USERNAME_MATCHES_JSON)

    # only show members who are in the guild
    guild_members = set()
    _latest_db = _get_latest_api_db()
    if _latest_db:
        conn = _sqlite3.connect(_latest_db)
        for row in conn.execute("SELECT username FROM player_stats WHERE UPPER(guild_prefix) = 'ESI'").fetchall():
            guild_members.add(row[0].lower())
        conn.close()

    result  = []
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
    # try to find their discord ID from the Minecraft username
    matches    = _load_json_file(_USERNAME_MATCHES_JSON)
    discord_id = None
    for did, entry in matches.items():
        mc = entry.get("username") if isinstance(entry, dict) else entry
        if isinstance(mc, str) and mc.lower() == username.lower():
            discord_id = did
            break
    if not discord_id:
        # no discord match, check if they at least exist in player_stats
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
                username = row[0]  # use DB-cased name
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
def inactivity_players():
    """All guild members from the player_stats DB."""
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
        # older dbs might not have these columns
        rows = conn.execute(
            "SELECT username, NULL as uuid, NULL as guild_rank FROM player_stats"
            " WHERE UPPER(guild_prefix) = 'ESI' ORDER BY username"
        ).fetchall()
    conn.close()
    # reverse map: Minecraft username to discord id
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
def inactivity_delete(discord_id):
    user, err = _require_role(_PARLIAMENT_PLUS)
    if err:
        return err
    data = _load_json_file(_INACTIVITY_JSON)
    if discord_id in data:
        del data[discord_id]
        _save_json_file(_INACTIVITY_JSON, data)
    return jsonify({"ok": True})


# ---- guild stats ----

@app.route("/api/guild/stats")
def guild_stats():
    """Sum key stats across all members using the latest api_tracking snapshot."""
    import glob as _glob
    api_folder = os.path.join(_ESI_BOT_DIR, "databases", "api_tracking")
    if not os.path.isdir(api_folder):
        return jsonify({})

    # find the newest snapshot
    latest_db = None
    latest_dt  = None
    for name in os.listdir(api_folder):
        if not name.startswith("api_"):
            continue
        path = os.path.join(api_folder, name)
        if not os.path.isdir(path):
            continue
        try:
            from datetime import datetime as _dt
            day_dt = _dt.strptime(name[4:], "%d-%m-%Y")
        except ValueError:
            continue
        files = sorted(f for f in os.listdir(path) if f.endswith(".db"))
        if files and (latest_dt is None or day_dt > latest_dt):
            latest_dt = day_dt
            latest_db = os.path.join(path, files[-1])

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
def player(username: str):
    """Full Wynncraft player data. Tries ?fullResult first, falls back without it."""
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
        # non-fatal error from ?fullResult, try without it
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
def guild_by_prefix(prefix: str):
    """Guild data by tag/prefix (e.g. ESI)."""
    try:
        data = cached_get(f"{WYNN_BASE}/guild/prefix/{prefix}")
        return jsonify(data)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        abort(status, description=f"Wynncraft API error: {e}")
    except requests.RequestException as e:
        abort(502, description=f"Could not reach Wynncraft API: {e}")


@app.route("/api/guild/name/<name>")
def guild_by_name(name: str):
    """Guild data by full name (e.g. Empire of Sindria)."""
    try:
        data = cached_get(f"{WYNN_BASE}/guild/{name}")
        return jsonify(data)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        abort(status, description=f"Wynncraft API error: {e}")
    except requests.RequestException as e:
        abort(502, description=f"Could not reach Wynncraft API: {e}")


@app.route("/api/bot/info")
def bot_info():
    """Bot user profile from the Discord API."""
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


@app.route("/api/bot/health")
def bot_health():
    """Memory/CPU/command stats from bot_status.json."""
    status_path = os.path.join(_BASE_DIR, "bot_status.json")
    if os.path.exists(status_path):
        try:
            with open(status_path) as f:
                data = json.load(f)
            return jsonify({
        "memory_used":  data.get("memory_used"),
                "memory_total": data.get("memory_total"),
                "cpu_percent":  data.get("cpu_percent"),
                "commands_today": data.get("commands_today", 0),
                "commands_total": data.get("commands_total", 0),
                "ping_history":   data.get("ping_history", []),
            })
        except (json.JSONDecodeError, IOError):
            pass
    return jsonify({
        "memory_used": None, "memory_total": None, "cpu_percent": None,
        "commands_today": 0, "commands_total": 0, "ping_history": [],
    })


@app.route("/api/bot/discord")
def bot_discord_snapshot():
    """Discord guild member/channel counts."""
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
            "name":              g.get("name"),
            "icon":              g.get("icon"),
            "member_count":      g.get("approximate_member_count"),
            "online_count":      g.get("approximate_presence_count"),
            "boost_level":       g.get("premium_tier", 0),
            "boost_count":       g.get("premium_subscription_count", 0),
            "channel_count":     len(g.get("channels", [])),
        })
    except requests.RequestException as e:
        abort(502, description=f"Could not reach Discord API: {e}")

_GUILD_LEVELS_JSON      = os.path.join(_ESI_BOT_DIR, "guild_levels.json")
_GUILD_TERRITORIES_JSON = os.path.join(_ESI_BOT_DIR, "guild_territories.json")

@app.route("/api/guild/member-history")
def guild_member_history():
    data = _load_json_file(_TRACKED_GUILD_JSON)
    if not data:
        return jsonify([])
    return jsonify(data.get("event_history", []))

@app.route("/api/guild/levels")
def guild_levels_get():
    data = _load_json_file(_GUILD_LEVELS_JSON)
    if not data:
        return jsonify({})
    return jsonify(data)

@app.route("/api/guild/territories")
def guild_territories_get():
    """Public territories endpoint"""
    data = _load_json_file(_GUILD_TERRITORIES_JSON)
    if not data:
        return jsonify({})
    return jsonify({
        "guild":       data.get("guild"),
        "territories": data.get("territories", {}),
        "history":     data.get("history", []),
        "last_update": data.get("last_update"),
    })

# ---- public API routes (accessible without the dashboard) ----

@app.route("/api/player/rank-history/<username>")
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

@app.route("/api/player/playtime/<username>")
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
def public_metrics(username: str):
    ulow = username.lower()
    with _bulk_playtime_lock:
        bulk = _bulk_playtime_cache.get("data") or {}
    member = (bulk.get("members") or {}).get(ulow)
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


_bot_status_cache = {"data": None, "ts": 0}

@app.route("/api/bot/status")
def bot_status():
    """Bot online/offline status, latency, uptime."""
    # check the status file the bot writes first
    status_path = os.path.join(_BASE_DIR, "bot_status.json")
    if os.path.exists(status_path):
        try:
            with open(status_path) as f:
                data = json.load(f)
            last_hb = data.get("last_heartbeat", 0)
            if time() - last_hb > 60:
                data["online"] = False
            return jsonify(data)
        except (json.JSONDecodeError, IOError):
            pass

    # no status file, fall back to pinging discord (cached 60s)
    now = time()
    with _bot_status_lock:
        _bsc = (_bot_status_cache["data"], _bot_status_cache["ts"])
    if now - _bsc[1] < 60 and _bsc[0] is not None:
        return jsonify(_bsc[0])

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
                result = {"online": True, "latency": latency_ms,
                          "uptime_since": None, "last_heartbeat": None}
                with _bot_status_lock:
                    _bot_status_cache["data"] = result
                    _bot_status_cache["ts"] = now
                return jsonify(result)
        except requests.RequestException:
            pass

    offline = {"online": False, "latency": None,
               "uptime_since": None, "last_heartbeat": None}
    with _bot_status_lock:
        _bot_status_cache["data"] = offline
        _bot_status_cache["ts"] = now
    return jsonify(offline)


@app.route("/api/bot/databases")
def bot_databases():
    """Folder sizes under ESI-Bot/databases/."""
    from datetime import datetime as _dt, date as _date

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
        """Earliest/latest date and total days from date-named subfolders."""
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

    playtime_size  = folder_size(playtime_path)
    api_size       = folder_size(api_path)
    total_size     = folder_size(db_root)

    pt_earliest, pt_latest, pt_days = folder_date_span(playtime_path, "playtime_")
    api_earliest, api_latest, api_days = folder_date_span(api_path, "api_")

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
                "total_days": api_days,
            },
        },
    })


@app.route("/api/settings/default-player")
def settings_default_player():
    """Return the MC username for the logged-in user from username_matches.json."""
    user, err = _require_login()
    if err:
        return err
    discord_id = user.get("id", "")
    if not discord_id:
        return jsonify({"username": None})
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    mc_name = _mc_username(discord_id, matches)
    return jsonify({"username": mc_name})


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


if __name__ == "__main__":
    print()
    print("  ESI Dashboard Server")
    print("  ─────────────────────────────────────")
    print("  Computing activity cache\u2026", end="", flush=True)
    try:
        import glob as _diag_glob
        _diag_db = _get_latest_api_db()
        if not _diag_db:
            print(f" skipped \u2014 no api_tracking snapshots found in {_API_TRACKING_DIR}")
        else:
            _compute_bulk_playtime()
            _cd  = _bulk_playtime_cache.get("data") or {}
            _nm  = len(_cd.get("members") or {})
            _nd  = len((_cd.get("guild") or {}).get("dates") or [])
            _dbf = os.path.basename(_diag_db)
            if _nm == 0:
                print(f" done \u2014 0 members (player_stats empty in {_dbf})")
                print("  \u26a0  Activity data unavailable until player_stats is populated.")
            else:
                print(f" done ({_nm} members, {_nd} playtime days)")
    except Exception as _e:
        print(f" failed: {_e}")
    _threading.Thread(target=_bulk_playtime_loop, daemon=True).start()
    print("  http://localhost:5000")
    print("  Press Ctrl+C to stop")
    print()
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
