"""
config.py — Shared configuration, constants, and utility functions.
Imported by main.py, routes.py, and cache.py.
"""

import os
import sys
import json
import secrets

from dotenv import load_dotenv

# paths

_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
# Load production / default values first
load_dotenv(os.path.join(_BASE_DIR, ".env"))
# then optionally override with local-only settings (e.g. localhost redirect
# URI, a dev Discord app, etc). Create a `.env.local` file next to `.env` to
# switch this project into local-testing mode without touching `.env`.
# `.env.local` is gitignored so it never lands on the production server.
load_dotenv(os.path.join(_BASE_DIR, ".env.local"), override=True)

_ESI_BOT_DIR = (
    os.environ.get("ESI_BOT_DIR")
    or os.path.join(os.path.dirname(_BASE_DIR), "ESI-Bot")
)
_DATA_FOLDER            = os.path.join(_ESI_BOT_DIR, "data")
_ASPECTS_JSON           = os.path.join(_DATA_FOLDER, "aspects.json")
_INACTIVITY_JSON        = os.path.join(_DATA_FOLDER, "inactivity_exemptions.json")
_USERNAME_MATCHES_JSON  = os.path.join(_DATA_FOLDER, "username_matches.json")
_TRACKED_GUILD_JSON     = os.path.join(_DATA_FOLDER, "tracked_guild.json")
_GUILD_LEVELS_JSON      = os.path.join(_DATA_FOLDER, "guild_levels.json")
_GUILD_TERRITORIES_JSON = os.path.join(_DATA_FOLDER, "guild_territories.json")
_API_TRACKING_DIR       = os.path.join(_ESI_BOT_DIR, "databases", "api_tracking")
_POINTS_DB              = os.path.join(_ESI_BOT_DIR, "databases", "esi_points.db")

_USER_DB_PATH = os.path.join(_BASE_DIR, "user_data.db")
_UPLOAD_DIR   = os.path.join(_BASE_DIR, "uploads")

# API URLs and tokens

WYNN_BASE             = "https://api.wynncraft.com/v3"
DISCORD_API           = "https://discord.com/api/v10"
DISCORD_TOKEN         = os.environ.get("DISCORD_TOKEN", "")
DISCORD_CLIENT_ID     = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_GUILD_ID      = os.environ.get("DISCORD_GUILD_ID", "")
DISCORD_REDIRECT_URI  = os.environ.get("DISCORD_REDIRECT_URI", "")
GITHUB_TOKEN          = os.environ.get("GITHUB_TOKEN", "")
GITHUB_REPO           = os.environ.get("GITHUB_REPO", "190Q/ESI-website")
HEADERS               = {"User-Agent": "ESI-Dashboard/1.0"}

# cache TTLs

CACHE_TTL              = 120
PLAYTIME_CACHE_TTL     = 300
BULK_PLAYTIME_REFRESH  = 600

# service ports

GATEWAY_PORT = 5000
ROUTES_PORT  = 5001
CACHE_PORT   = 5002
ROUTES_URL   = f"http://127.0.0.1:{ROUTES_PORT}"
CACHE_URL    = f"http://127.0.0.1:{CACHE_PORT}"

# discord role IDs

_ROLE_VALAENDOR  = "728858956575014964"
_ROLE_PARLIAMENT = "600185623474601995"
_ROLE_CONGRESS   = "1346436714901536858"
_ROLE_JUROR      = "954566591520063510"
_ROLE_CITIZEN    = "554889169705500672"

_ROLE_GRAND_DUKE = "1396112289832243282"
_ROLE_ARCHDUKE   = "554514823191199747"

_PARLIAMENT_PLUS = {_ROLE_PARLIAMENT, _ROLE_VALAENDOR}
_JUROR_PLUS      = {_ROLE_JUROR, _ROLE_CONGRESS, _ROLE_PARLIAMENT, _ROLE_VALAENDOR}
_CHIEF_PLUS      = {_ROLE_GRAND_DUKE, _ROLE_ARCHDUKE}
_CITIZEN_PLUS    = {_ROLE_CITIZEN}

# client config (exposed via /api/config)

_CLIENT_CONFIG = {
    "roles": {
        "valaendor":  _ROLE_VALAENDOR,
        "parliament": _ROLE_PARLIAMENT,
        "congress":   _ROLE_CONGRESS,
        "juror":      _ROLE_JUROR,
        "citizen":    _ROLE_CITIZEN,
    },
    "permissions": {
        "parliamentPlus": list(_PARLIAMENT_PLUS),
        "jurorPlus":      list(_JUROR_PLUS),
    },
    "staffRoles": [
        {"name": "Bot Owner",    "color": "#ec00ad", "members": ["967867229410574340"]},
        {"name": "Developer",    "color": "#0896d3", "members": ["454260696172068879"]},
        {"name": "User Support", "color": "#4933c5", "members": ["516954338225160195"]},
    ],
    "rankRoles": [
        {"id": "554506531949772812",  "name": "Emperor",    "color": "#5c11ad"},
        {"id": "554514823191199747",  "name": "Archduke",   "color": "#b5fff6"},
        {"id": "1396112289832243282", "name": "Grand Duke", "color": "#74cac0"},
        {"id": "591765870272053261",  "name": "Duke",       "color": "#35deac"},
        {"id": "1391424890938195998", "name": "Count",      "color": "#3ac770"},
        {"id": "591769392828776449",  "name": "Viscount",   "color": "#59e365"},
        {"id": "688438690137243892",  "name": "Knight",     "color": "#93e688"},
        {"id": "681030746651230351",  "name": "Squire",     "color": "#c7edc0"},
    ],
    "echelonRoles": [
        {"id": _ROLE_PARLIAMENT, "name": "Parliament", "color": "#afb3d1"},
        {"id": _ROLE_CONGRESS,   "name": "Congress",   "color": "#7289da"},
        {"id": _ROLE_JUROR,      "name": "Juror",      "color": "#ffc332"},
    ],
    "citizenRole": {"id": _ROLE_CITIZEN, "name": "Sindrian Citizen", "color": "#4acf5e"},
}

# metric keys

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
    "playtime", "wars", "guildRaids", "mobsKilled", "chestsFound",
    "questsDone", "totalLevel", "contentDone", "dungeons", "raids",
    "worldEvents", "caves",
]

GUILD_BULK_METRIC_KEYS = [
    "playerCount", "wars", "guildRaids", "newMembers", "totalMembers",
]

# bot / tracker screen session config

BOT_SCREEN_SESSION = (os.environ.get("ESI_BOT_SCREEN_NAME") or "esi-bot").strip()
TRACKER_SCREEN_SESSION = (os.environ.get("ESI_TRACKERS_SCREEN_NAME") or "esi-bot-trackers").strip()

TRACKER_SCREEN_SPECS = [
    {"name": "API Tracker",      "interval": 300, "keywords": ("api tracker", "api_tracking")},
    {"name": "Playtime Tracker", "interval": 300, "keywords": ("playtime tracker", "playtime_tracking")},
    {"name": "Guild Tracker",    "interval": 30,  "keywords": ("guild tracker", "guild_tracking")},
    {"name": "Claim Tracker",    "interval": 3,   "keywords": ("claim tracker", "claim_tracking")},
]

# utility functions

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


def _load_json_file(path):
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        print(f"[ERROR] Malformed JSON in {path}: {e}", file=sys.stderr)
        return {}
    except OSError as e:
        print(f"[ERROR] Cannot read {path}: {e}", file=sys.stderr)
        return {}


def _save_json_file(path, data):
    """Write JSON atomically: write to a temp file then rename over the target."""
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


def _get_secret_key():
    """Flask session key — saved to a file so it survives server restarts."""
    key = os.environ.get("FLASK_SECRET_KEY")
    if key:
        return key
    key_path = os.path.join(_BASE_DIR, ".flask_secret")
    if os.path.exists(key_path):
        with open(key_path) as f:
            return f.read().strip()
    key = secrets.token_hex(32)
    fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(key)
    return key


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


def _is_player_api_off(snapshot):
    if not snapshot:
        return False
    return all(_safe_number(snapshot.get(k, 0)) == 0 for k in [
        "playtime", "wars", "totalLevel", "mobsKilled",
        "chestsFound", "dungeons", "raids", "worldEvents",
        "caves", "questsDone",
    ])


def _is_reactivation_spike(prev_value, curr_value, seen_non_zero,
                            metric_key=None, prev_snapshot=None, curr_snapshot=None):
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
    for key in ("playtime", "wars", "totalLevel", "mobsKilled",
                "chestsFound", "dungeons", "raids", "worldEvents",
                "caves", "questsDone"):
        if key == metric_key:
            continue
        if prev_snapshot and _safe_number(prev_snapshot.get(key)) > 0:
            return True
        if curr_snapshot and _safe_number(curr_snapshot.get(key)) > 0:
            return True
    return False
