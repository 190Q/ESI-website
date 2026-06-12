import json
import os
import sqlite3
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz
from config import _GUILD_INFO_DB


def _now_iso() -> str:
    return _dt.now(_tz.utc).isoformat()

def _gen_id() -> str:
    return _uuid_mod.uuid4().hex

def _ensure_schema(conn: sqlite3.Connection) -> None:
    """Create the guild-info tables + indexes if they don't exist (idempotent)."""
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS guild_info_requests (
            id                TEXT PRIMARY KEY,
            action            TEXT NOT NULL,
            thread_id         TEXT,
            title             TEXT,
            body              TEXT,
            requested_by_id   TEXT NOT NULL,
            requested_by_name TEXT,
            status            TEXT NOT NULL DEFAULT 'pending',
            created_at        TEXT NOT NULL,
            resolved_at       TEXT,
            resolved_by       TEXT,
            deny_reason       TEXT,
            result_thread_id  TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_gir_status "
        "ON guild_info_requests (status, created_at)"
    )
    _req_cols = {row["name"] for row in conn.execute("PRAGMA table_info(guild_info_requests)")}
    if "prev_title" not in _req_cols:
        conn.execute("ALTER TABLE guild_info_requests ADD COLUMN prev_title TEXT")
    if "prev_body" not in _req_cols:
        conn.execute("ALTER TABLE guild_info_requests ADD COLUMN prev_body TEXT")
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS guild_info_log (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            actor     TEXT NOT NULL,
            action    TEXT NOT NULL,
            target_id TEXT,
            details   TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_gil_timestamp ON guild_info_log (timestamp)"
    )
    # Privilege-escalation gate: a privileged-role user must be approved before they may use the page
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS guild_info_approved_privileges (
            discord_id TEXT PRIMARY KEY,
            approved   INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL,
            updated_by TEXT
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS guild_info_privilege_requests (
            id          TEXT PRIMARY KEY,
            discord_id  TEXT NOT NULL,
            username    TEXT NOT NULL DEFAULT '',
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  TEXT NOT NULL,
            resolved_at TEXT,
            resolved_by TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_gipr_status "
        "ON guild_info_privilege_requests (status, created_at)"
    )

def _connect() -> sqlite3.Connection:
    """Open the guild-info DB (WAL), ensuring the parent dir + schema exist."""
    os.makedirs(os.path.dirname(_GUILD_INFO_DB), exist_ok=True)
    conn = sqlite3.connect(_GUILD_INFO_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    _ensure_schema(conn)
    return conn

def log_action(actor: str, action: str, target_id: str | None = None,
               details: dict | None = None) -> None:
    """Insert a row into guild_info_log. Silently ignores errors."""
    try:
        conn = _connect()
        conn.execute(
            "INSERT INTO guild_info_log (timestamp, actor, action, target_id, details)"
            " VALUES (?, ?, ?, ?, ?)",
            (_now_iso(), actor, action, target_id,
             json.dumps(details, ensure_ascii=False) if details else None),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass

def create_request(action: str, *, thread_id: str | None = None,
                    title: str | None = None, body: str | None = None,
                    prev_title: str | None = None, prev_body: str | None = None,
                    requested_by_id: str, requested_by_name: str | None = None) -> dict:
    """Insert a pending request and return it as a dict."""
    rid = _gen_id()
    conn = _connect()
    conn.execute(
        "INSERT INTO guild_info_requests "
        "(id, action, thread_id, title, body, prev_title, prev_body, "
        " requested_by_id, requested_by_name, status, created_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)",
        (rid, action, thread_id, title, body, prev_title, prev_body,
         requested_by_id, requested_by_name, _now_iso()),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM guild_info_requests WHERE id = ?", (rid,)
    ).fetchone()
    conn.close()
    return dict(row)

def get_request(request_id: str) -> dict | None:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM guild_info_requests WHERE id = ?", (request_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None

def get_pending_requests() -> list:
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM guild_info_requests WHERE status = 'pending' "
        "ORDER BY created_at ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_pending_requests_for_thread(thread_id: str) -> list:
    """Pending requests targeting a single post (thread), oldest first."""
    if not thread_id:
        return []
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM guild_info_requests "
        "WHERE thread_id = ? AND status = 'pending' ORDER BY created_at ASC",
        (str(thread_id),),
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_pending_thread_ids() -> set:
    """Set of thread ids that currently have at least one pending request."""
    conn = _connect()
    rows = conn.execute(
        "SELECT DISTINCT thread_id FROM guild_info_requests "
        "WHERE status = 'pending' AND thread_id IS NOT NULL"
    ).fetchall()
    conn.close()
    return {str(r["thread_id"]) for r in rows}

def cancel_pending_requests_for_thread(thread_id: str, resolved_by: str,
                                       exclude_id: str | None = None) -> list:
    """Mark a thread's pending requests 'cancelled' (e.g. after the post is gone).

    Optionally skips ``exclude_id`` (the request that triggered the deletion).
    Returns the cancelled rows (id + action) so the caller can log them.
    """
    if not thread_id:
        return []
    conn = _connect()
    if exclude_id:
        rows = conn.execute(
            "SELECT id, action FROM guild_info_requests "
            "WHERE thread_id = ? AND status = 'pending' AND id != ?",
            (str(thread_id), exclude_id),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT id, action FROM guild_info_requests "
            "WHERE thread_id = ? AND status = 'pending'",
            (str(thread_id),),
        ).fetchall()
    cancelled = [dict(r) for r in rows]
    if cancelled:
        ids = [r["id"] for r in cancelled]
        qmarks = ",".join("?" for _ in ids)
        conn.execute(
            f"UPDATE guild_info_requests SET status = 'cancelled', "
            f"resolved_at = ?, resolved_by = ? WHERE id IN ({qmarks})",
            (_now_iso(), resolved_by, *ids),
        )
        conn.commit()
    conn.close()
    return cancelled

def resolve_request(request_id: str, status: str, resolved_by: str, *,
                    deny_reason: str | None = None,
                    result_thread_id: str | None = None) -> None:
    """Mark a request resolved (approved / denied / failed)."""
    conn = _connect()
    conn.execute(
        "UPDATE guild_info_requests SET status = ?, resolved_at = ?, resolved_by = ?, "
        "deny_reason = ?, result_thread_id = COALESCE(?, result_thread_id) "
        "WHERE id = ?",
        (status, _now_iso(), resolved_by, deny_reason, result_thread_id, request_id),
    )
    conn.commit()
    conn.close()

def get_logs(page: int = 1, per_page: int = 50) -> dict:
    """Paginated audit log (newest first). Uses LIMIT N+1 -> ``has_more``."""
    page = max(1, int(page or 1))
    per_page = max(1, min(200, int(per_page or 50)))
    offset = (page - 1) * per_page
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM guild_info_log ORDER BY id DESC LIMIT ? OFFSET ?",
        (per_page + 1, offset),
    ).fetchall()
    conn.close()
    has_more = len(rows) > per_page
    entries = [dict(r) for r in rows[:per_page]]
    return {"entries": entries, "has_more": has_more, "page": page}

# Privilege-escalation gate
def is_privilege_approved(discord_id: str) -> bool:
    """True if the user has been approved to use the Guild Info page."""
    if not discord_id:
        return False
    conn = _connect()
    row = conn.execute(
        "SELECT approved FROM guild_info_approved_privileges WHERE discord_id = ?",
        (discord_id,),
    ).fetchone()
    conn.close()
    return bool(row and int(row["approved"]) == 1)

def ensure_privilege_request(discord_id: str, username: str | None = None) -> dict | None:
    """Create a pending privilege request if none is pending. Returns it, or None."""
    if not discord_id:
        return None
    conn = _connect()
    existing = conn.execute(
        "SELECT id FROM guild_info_privilege_requests "
        "WHERE discord_id = ? AND status = 'pending'",
        (discord_id,),
    ).fetchone()
    if existing:
        conn.close()
        return None
    rid = _gen_id()
    conn.execute(
        "INSERT INTO guild_info_privilege_requests "
        "(id, discord_id, username, status, created_at) "
        "VALUES (?, ?, ?, 'pending', ?)",
        (rid, discord_id, username or "", _now_iso()),
    )
    conn.commit()
    row = conn.execute(
        "SELECT * FROM guild_info_privilege_requests WHERE id = ?", (rid,)
    ).fetchone()
    conn.close()
    return dict(row)

def get_privilege_request(request_id: str) -> dict | None:
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM guild_info_privilege_requests WHERE id = ?", (request_id,)
    ).fetchone()
    conn.close()
    return dict(row) if row else None

def get_pending_privilege_request_for_user(discord_id: str) -> dict | None:
    if not discord_id:
        return None
    conn = _connect()
    row = conn.execute(
        "SELECT * FROM guild_info_privilege_requests "
        "WHERE discord_id = ? AND status = 'pending' "
        "ORDER BY created_at DESC LIMIT 1",
        (discord_id,),
    ).fetchone()
    conn.close()
    return dict(row) if row else None

def get_pending_privilege_requests() -> list:
    conn = _connect()
    rows = conn.execute(
        "SELECT * FROM guild_info_privilege_requests WHERE status = 'pending' "
        "ORDER BY created_at ASC"
    ).fetchall()
    conn.close()
    return [dict(r) for r in rows]

def resolve_privilege_request(request_id: str, status: str, resolved_by: str) -> None:
    """Mark a privilege request resolved (approved / denied)."""
    conn = _connect()
    conn.execute(
        "UPDATE guild_info_privilege_requests SET status = ?, resolved_at = ?, "
        "resolved_by = ? WHERE id = ?",
        (status, _now_iso(), resolved_by, request_id),
    )
    conn.commit()
    conn.close()

def set_privilege_approved(discord_id: str, approved_by: str) -> None:
    """Persist that a user is approved to use the Guild Info page."""
    conn = _connect()
    conn.execute(
        "INSERT INTO guild_info_approved_privileges "
        "(discord_id, approved, updated_at, updated_by) VALUES (?, 1, ?, ?) "
        "ON CONFLICT(discord_id) DO UPDATE SET "
        "approved = 1, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
        (discord_id, _now_iso(), approved_by),
    )
    conn.commit()
    conn.close()
