"""
_gdpr_common.py - Shared helpers for the GDPR admin scripts.

All GDPR scripts in this folder import from this module. They operate
directly on user_data.db and do not require the web server to be running.
"""

import os
import sys
import json
import sqlite3
from time import time
from datetime import datetime, timezone

# Make the parent folder importable so we can reuse config.py for paths.
_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_THIS_DIR)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

try:
    from config import _USER_DB_PATH, _BASE_DIR  # noqa: E402
except Exception:  # fallback if config isn't importable for some reason
    _BASE_DIR = _PARENT
    _USER_DB_PATH = os.path.join(_BASE_DIR, "user_data.db")

EXPORT_DIR = os.path.join(_BASE_DIR, "gdpr_exports")


def connect_user_db() -> sqlite3.Connection:
    """Open the user-data DB with sane defaults."""
    if not os.path.exists(_USER_DB_PATH):
        print(f"[ERROR] user_data.db not found at {_USER_DB_PATH}", file=sys.stderr)
        sys.exit(2)
    conn = sqlite3.connect(_USER_DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def ensure_restricted_table(conn: sqlite3.Connection) -> None:
    """Lazy-create the table used for Art. 18 restriction flags."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS gdpr_restricted (
            discord_id TEXT PRIMARY KEY,
            reason     TEXT,
            restricted_at REAL NOT NULL
        )
        """
    )
    conn.commit()


def fetch_user_settings(conn, discord_id: str):
    row = conn.execute(
        "SELECT discord_id, settings, updated_at FROM user_settings WHERE discord_id = ?",
        (discord_id,),
    ).fetchone()
    if not row:
        return None
    try:
        settings = json.loads(row["settings"])
    except (json.JSONDecodeError, TypeError):
        settings = row["settings"]
    return {
        "discord_id": row["discord_id"],
        "settings": settings,
        "updated_at": row["updated_at"],
        "updated_at_iso": _iso(row["updated_at"]),
    }


def fetch_remember_tokens(conn, discord_id: str):
    rows = conn.execute(
        """
        SELECT token, discord_id, user_data, created_at, expires_at
        FROM remember_tokens
        WHERE discord_id = ?
        """,
        (discord_id,),
    ).fetchall()
    tokens = []
    for row in rows:
        try:
            user_data = json.loads(row["user_data"])
        except (json.JSONDecodeError, TypeError):
            user_data = row["user_data"]
        tokens.append(
            {
                # Show only the last 6 characters of the token so the export
                # is still useful but doesn't re-expose the raw credential.
                "token_suffix": (row["token"] or "")[-6:],
                "discord_id": row["discord_id"],
                "user_data": user_data,
                "created_at": row["created_at"],
                "created_at_iso": _iso(row["created_at"]),
                "expires_at": row["expires_at"],
                "expires_at_iso": _iso(row["expires_at"]),
            }
        )
    return tokens


def fetch_restriction(conn, discord_id: str):
    try:
        row = conn.execute(
            "SELECT discord_id, reason, restricted_at FROM gdpr_restricted WHERE discord_id = ?",
            (discord_id,),
        ).fetchone()
    except sqlite3.OperationalError:
        # Table doesn't exist yet — user isn't restricted.
        return None
    if not row:
        return None
    return {
        "discord_id": row["discord_id"],
        "reason": row["reason"],
        "restricted_at": row["restricted_at"],
        "restricted_at_iso": _iso(row["restricted_at"]),
    }


def _iso(ts):
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(float(ts), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def now_ts() -> float:
    return time()


def confirm(prompt: str, assume_yes: bool) -> bool:
    """Simple y/n confirmation; returns True if user confirms."""
    if assume_yes:
        return True
    try:
        ans = input(f"{prompt} [y/N]: ").strip().lower()
    except EOFError:
        return False
    return ans in ("y", "yes")


def require_discord_id(value: str) -> str:
    """Validate that the value looks like a Discord snowflake ID."""
    value = (value or "").strip()
    if not value.isdigit() or not (15 <= len(value) <= 22):
        print(
            f"[ERROR] {value!r} does not look like a Discord ID "
            "(expected 15–22 digit snowflake).",
            file=sys.stderr,
        )
        sys.exit(2)
    return value


def ensure_export_dir() -> str:
    os.makedirs(EXPORT_DIR, exist_ok=True)
    return EXPORT_DIR
