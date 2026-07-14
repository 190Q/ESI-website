import os
import sqlite3
import sys
import threading

from config import _SHOP_DB, _POINTS_DB
from shop.effective_points import get_cycle_leaderboard_rows

_lock = threading.Lock()

def _ensure_table(conn: sqlite3.Connection) -> None:
    """Create cycle_leaderboard if it doesn't exist (idempotent)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cycle_leaderboard (
            cycle_id  INTEGER NOT NULL,
            uuid      TEXT    NOT NULL,
            username  TEXT    NOT NULL DEFAULT '',
            position  INTEGER NOT NULL,
            points    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (cycle_id, uuid)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cl_cycle "
        "ON cycle_leaderboard (cycle_id)"
    )

def _cycle_is_populated(conn: sqlite3.Connection, cycle_id: int) -> bool:
    """Return True if we already have rows for *cycle_id*."""
    row = conn.execute(
        "SELECT 1 FROM cycle_leaderboard WHERE cycle_id = ? LIMIT 1",
        (cycle_id,),
    ).fetchone()
    return row is not None

def _populate_cycle(conn: sqlite3.Connection, cycle_id: int) -> None:
    """Compute the leaderboard for *cycle_id* from esi_points.db and
    insert it into cycle_leaderboard.

    If esi_points.db is unavailable or the cycle has no data, this is
    a no-op (the table simply won't have rows for that cycle).
    """
    effective_rows = get_cycle_leaderboard_rows(cycle_id)
    if effective_rows is not None:
        if not effective_rows:
            return
        for idx, row in enumerate(effective_rows, start=1):
            uuid = (row.get("uuid") or "").strip()
            if not uuid:
                continue
            username = (row.get("username") or "").strip()
            total = int(row.get("points") or 0)
            position = int(row.get("position") or idx)
            conn.execute(
                "INSERT OR IGNORE INTO cycle_leaderboard "
                "(cycle_id, uuid, username, position, points) "
                "VALUES (?, ?, ?, ?, ?)",
                (cycle_id, uuid, username, position, total),
            )
        conn.commit()
        return

    if not os.path.isfile(_POINTS_DB):
        return

    try:
        pts_conn = sqlite3.connect(_POINTS_DB, timeout=5)
        rows = pts_conn.execute(
            "SELECT uuid, MAX(username) AS username, SUM(points) AS total "
            "FROM esi_points WHERE cycle_id = ? GROUP BY uuid "
            "ORDER BY total DESC",
            (cycle_id,),
        ).fetchall()
        pts_conn.close()
    except sqlite3.Error as exc:
        print(f"[LEADERBOARD] Failed to read esi_points for cycle {cycle_id}: {exc}",
              file=sys.stderr)
        return

    if not rows:
        return

    for pos, (uuid, username, total) in enumerate(rows, start=1):
        if not uuid:
            continue
        conn.execute(
            "INSERT OR IGNORE INTO cycle_leaderboard "
            "(cycle_id, uuid, username, position, points) "
            "VALUES (?, ?, ?, ?, ?)",
            (cycle_id, uuid, username or "", pos, int(total or 0)),
        )
    conn.commit()

def _ensure_cycle(conn: sqlite3.Connection, cycle_id: int) -> None:
    """Make sure *cycle_id* is populated (lazy-load if not)."""
    _ensure_table(conn)
    if not _cycle_is_populated(conn, cycle_id):
        _populate_cycle(conn, cycle_id)

def get_user_cycle_position(
    uuid: str,
    cycle_id: int | None = None,
) -> int | None:
    """Return the 1-indexed leaderboard position for *uuid* in the given
    cycle, or ``None`` if the player has no position.

    By default queries the **previous** cycle (the one whose EP is
    currently spendable in the shop).
    """
    if not uuid:
        return None
    if not os.path.isfile(_SHOP_DB):
        return None

    if cycle_id is None:
        from shop.bin import _get_cycle_id
        cycle_id = _get_cycle_id() - 1
    if cycle_id <= 0:
        return None

    with _lock:
        try:
            conn = sqlite3.connect(_SHOP_DB, timeout=5)
            conn.execute("PRAGMA journal_mode=WAL")
            _ensure_cycle(conn, cycle_id)
            row = conn.execute(
                "SELECT position FROM cycle_leaderboard "
                "WHERE cycle_id = ? AND uuid = ?",
                (cycle_id, uuid),
            ).fetchone()
            conn.close()
            return row[0] if row else None
        except sqlite3.Error as exc:
            print(f"[LEADERBOARD] DB error: {exc}", file=sys.stderr)
            return None
