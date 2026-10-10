"""
territory_history.py - the guild's held-territory total over time.

The bot's ``guild_territories.json`` only keeps the last 100 capture/loss
events, which for an active guild is barely a day and a half, and it is a
rolling window - older events are trimmed away. That is not enough to say how
many territories the guild held a week or a month ago.

So the website keeps its own record instead. Every time the guild's held total
changes we append a row ``(timestamp, total)`` to a small SQLite database.
Rows are keyed by timestamp and written with ``INSERT OR IGNORE``, so re-reading
the bot's log is idempotent: we keep accumulating history the bot has already
forgotten, and the model can compare held totals over whatever span exists
rather than over a hardcoded one.

The bot records the running total inside each event's text - a capture reads
``to_guild: "Empire of Sindria (9 -> 10)"`` and a loss reads
``from_guild: "Empire of Sindria (25 -> 24)"`` - so the total is read straight
out of the event rather than being counted up from captures and losses, which
would drift whenever a territory changes hands more than once.
"""

from __future__ import annotations

import os
import re
import sqlite3
import threading
from datetime import datetime, timedelta, timezone

try:
    from config import _TERRITORY_DB
except Exception:
    _TERRITORY_DB = os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        "data", "databases", "territory_history.db",
    )

RETENTION_DAYS = 400

GUILD_FALLBACK_NAME = "Empire of Sindria"

_TOTAL_RE = re.compile(
    r"^(?P<name>.*?)\s*\((?P<before>\d+)\s*->\s*(?P<after>\d+)\)\s*$"
)

_lock = threading.Lock()


def _connect():
    os.makedirs(os.path.dirname(_TERRITORY_DB), exist_ok=True)
    conn = sqlite3.connect(_TERRITORY_DB, timeout=10, check_same_thread=False)
    conn.execute("PRAGMA journal_mode=WAL")
    return conn


def ensure_schema():
    conn = _connect()
    try:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS territory_history (
                ts     TEXT PRIMARY KEY,
                total  INTEGER NOT NULL,
                source TEXT NOT NULL DEFAULT 'bot'
            )
            """
        )
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_territory_ts ON territory_history(ts)"
        )
        conn.commit()
    finally:
        conn.close()


def _prune(conn, now=None):
    """Drop rows older than the retention window."""
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=RETENTION_DAYS)).isoformat(timespec="microseconds")
    try:
        conn.execute("DELETE FROM territory_history WHERE ts < ?", (cutoff,))
    except sqlite3.Error:
        pass


def _norm_ts(value):
    """Canonical UTC ISO timestamp, so the same instant is never stored twice.

    The bot emits both ``...Z`` and ``...+00:00`` forms with differing
    microsecond precision; normalising makes the primary key meaningful.
    """
    if value is None:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec="microseconds")


def _held_count(event, guild_name):
    """The guild's held total as recorded on one capture/loss event."""
    for field in ("to_guild", "from_guild"):
        match = _TOTAL_RE.match(str(event.get(field) or ""))
        if match and guild_name.lower() in match.group("name").lower():
            return int(match.group("after"))
    return None


def _guild_name(raw):
    name = raw.get("guild") if isinstance(raw, dict) else None
    if isinstance(name, dict):
        name = name.get("name")
    if isinstance(name, str) and name.strip():
        return name.strip()
    return GUILD_FALLBACK_NAME


def latest():
    """The most recently recorded (timestamp, total), or None."""
    conn = _connect()
    try:
        row = conn.execute(
            "SELECT ts, total FROM territory_history ORDER BY ts DESC LIMIT 1"
        ).fetchone()
    except sqlite3.Error:
        row = None
    finally:
        conn.close()
    return (row[0], int(row[1])) if row else None


def series(limit=None):
    """Recorded history as ``[(iso_ts, total), ...]``, oldest first."""
    conn = _connect()
    try:
        if limit:
            rows = conn.execute(
                "SELECT ts, total FROM ("
                "    SELECT ts, total FROM territory_history ORDER BY ts DESC LIMIT ?"
                ") ORDER BY ts ASC",
                (int(limit),),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT ts, total FROM territory_history ORDER BY ts ASC"
            ).fetchall()
    except sqlite3.Error:
        rows = []
    finally:
        conn.close()
    return [(r[0], int(r[1])) for r in rows]


def count():
    conn = _connect()
    try:
        row = conn.execute("SELECT COUNT(*) FROM territory_history").fetchone()
    except sqlite3.Error:
        row = None
    finally:
        conn.close()
    return int(row[0]) if row else 0


def ingest(raw_territories, now=None):
    """Record any held-total changes from the bot's territory file.

    Backfills every event the bot still has, then records the live total only
    if it differs from the last row we stored - so a row is written when the
    total *changes*, not on every call.

    Returns ``{"inserted": int, "total": int|None, "rows": int}``.
    """
    if not isinstance(raw_territories, dict):
        return {"inserted": 0, "total": None, "rows": count()}

    now_dt = now or datetime.now(timezone.utc)
    guild_name = _guild_name(raw_territories)

    rows = []
    history = raw_territories.get("history")
    if isinstance(history, list):
        for event in history:
            if not isinstance(event, dict):
                continue
            ts = _norm_ts(event.get("timestamp"))
            total = _held_count(event, guild_name)
            if ts is None or total is None:
                continue
            rows.append((ts, total, "bot"))

    live = raw_territories.get("territories")
    live_total = len(live) if isinstance(live, dict) else None

    with _lock:
        previous = latest()
        if live_total is not None and (previous is None or previous[1] != live_total):
            ts = _norm_ts(now_dt)
            if ts is not None:
                rows.append((ts, live_total, "live"))

        inserted = 0
        if rows:
            conn = _connect()
            try:
                conn.executemany(
                    "INSERT OR IGNORE INTO territory_history (ts, total, source)"
                    " VALUES (?, ?, ?)",
                    sorted(rows, key=lambda r: r[0], reverse=True),
                )
                inserted = conn.total_changes
                _prune(conn, now_dt)
                conn.commit()
            except sqlite3.Error:
                inserted = 0
            finally:
                conn.close()

    return {"inserted": inserted, "total": live_total, "rows": count()}
