"""Shared helpers for the raid-event reporting scripts.

Imported by ``raid_event_tickets.py`` and ``raid_event_bonus_report.py``.

Guild-raid activity is read from the per-player history tables in
``esi_points.db`` (``player_<uuid>``).  Every guild raid is recorded with the
reason ``"Guild Raid"`` and is worth :data:`RAID_EP` EP, so the raid count for a
history row is ``points_gained // RAID_EP`` (rows may group several raids).
"""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime, timezone
from typing import Any

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_THIS_DIR)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from config import _POINTS_DB, _get_latest_api_db

RAID_EP = 10
MIN_TICKETS = 1

_GUILD_RAID_PREFIX = "guild raid"


def parse_iso(value: Any) -> datetime | None:
    """Parse an ISO timestamp into an aware UTC datetime (or ``None``)."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def default_event_window() -> tuple[datetime, datetime]:
    """Return ``(EVENT_START, EVENT_END)`` from ``events/raid_event.py``."""
    from events.raid_event import EVENT_END, EVENT_START

    return EVENT_START, EVENT_END


def resolve_event_window(
    start: str | None, end: str | None
) -> tuple[datetime, datetime]:
    """Return the event window, applying optional ``--start`` / ``--end`` overrides."""
    window_start, window_end = default_event_window()
    if start:
        parsed = parse_iso(start)
        if parsed is None:
            raise ValueError(f"invalid --start value: {start!r}")
        window_start = parsed
    if end:
        parsed = parse_iso(end)
        if parsed is None:
            raise ValueError(f"invalid --end value: {end!r}")
        window_end = parsed
    return window_start, window_end


def uuid_from_table(table: str) -> str | None:
    """Recover the player UUID from a ``player_<uuid_with_underscores>`` table name."""
    raw = table[len("player_"):] if table.startswith("player_") else table
    parts = raw.split("_")
    if [len(p) for p in parts] == [8, 4, 4, 4, 12]:
        return "-".join(parts)
    return None


def _player_tables(conn: sqlite3.Connection) -> list[str]:
    return [
        row[0]
        for row in conn.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name LIKE 'player_%'"
        )
    ]


def collect_guild_raids(
    start: datetime,
    end: datetime,
    db_path: str | None = None,
) -> list[dict]:
    """Return one entry per player with guild raids inside ``[start, end)``.

    Each entry is ``{"uuid", "username", "raids", "ep"}`` where ``username`` is
    the most recent name seen on a raid row and ``raids`` is the number of guild
    raids (``ep // RAID_EP`` per row, summed).
    """
    db_path = db_path or _POINTS_DB
    if not os.path.isfile(db_path):
        raise FileNotFoundError(f"points database not found: {db_path}")

    out: dict[str, dict] = {}
    conn = sqlite3.connect(db_path, timeout=10)
    try:
        for table in _player_tables(conn):
            try:
                rows = conn.execute(
                    f'SELECT username, COALESCE(points_gained, 0), timestamp '
                    f'FROM "{table}" WHERE LOWER(COALESCE(reason, \'\')) LIKE ?',
                    (_GUILD_RAID_PREFIX + "%",),
                ).fetchall()
            except sqlite3.Error:
                continue

            uuid = uuid_from_table(table)
            key = (uuid or table).lower()
            for username, points, timestamp in rows:
                when = parse_iso(timestamp)
                if when is None or when < start or when >= end:
                    continue
                points = int(points or 0)
                if points <= 0:
                    continue
                entry = out.get(key)
                if entry is None:
                    entry = {
                        "uuid": uuid,
                        "username": "",
                        "raids": 0,
                        "ep": 0,
                        "_latest": None,
                    }
                    out[key] = entry
                entry["raids"] += points // RAID_EP
                entry["ep"] += points
                if entry["_latest"] is None or when > entry["_latest"]:
                    entry["_latest"] = when
                    entry["username"] = (username or "").strip()
    finally:
        conn.close()

    for entry in out.values():
        entry.pop("_latest", None)
    return list(out.values())


def tickets_for_raids(raids: int, min_tickets: int = MIN_TICKETS) -> int:
    """One ticket per guild raid, floored at ``min_tickets``."""
    return max(int(min_tickets or 0), int(raids or 0))


def load_roster() -> dict[str, dict]:
    """Return ``{uuid_lower: {"username", "rank"}}`` for current ESI members."""
    db = _get_latest_api_db()
    if not db:
        return {}
    out: dict[str, dict] = {}
    try:
        conn = sqlite3.connect(db, timeout=10)
        rows = conn.execute(
            "SELECT uuid, username, LOWER(COALESCE(guild_rank, '')) "
            "FROM player_stats "
            "WHERE UPPER(COALESCE(guild_prefix, '')) = 'ESI'"
        ).fetchall()
        conn.close()
    except sqlite3.Error:
        return out

    for uuid, username, rank in rows:
        uid = (uuid or "").strip().lower()
        if not uid:
            continue
        out[uid] = {
            "username": (username or "").strip(),
            "rank": (rank or "").strip(),
        }
    return out
