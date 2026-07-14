import os
import re
import sqlite3
import sys
from datetime import datetime as _dt, timezone as _tz, timedelta as _td
from time import time as _time

from config import (
    _POINTS_DB,
    _SHOP_DB,
    _USERNAME_MATCHES_JSON,
    _get_latest_api_db,
    _load_json_file,
)
from shop.effective_points import get_user_cycle_totals

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE,
)

_CYCLE_ANCHOR = _dt(2026, 4, 21, 16, 0, 0, tzinfo=_tz.utc)
_CYCLE_DURATION = _td(weeks=2)
_POINTS_HR_RANKS = {"strategist", "chief", "owner"}
_DIRTY_REASON_PREFIXES = ("war", "guild raid", "quest")
_HR_UUID_CACHE_TTL = 120
_hr_uuid_cache = {"ts": 0.0, "uuids": set()}


def _is_dirty_reason(reason: str | None) -> bool:
    text = (reason or "").strip().lower()
    return any(text.startswith(prefix) for prefix in _DIRTY_REASON_PREFIXES)


def _get_hr_uuid_set() -> set:
    now = _time()
    cached_ts = float(_hr_uuid_cache.get("ts") or 0)
    if now - cached_ts < _HR_UUID_CACHE_TTL:
        return set(_hr_uuid_cache.get("uuids") or set())

    latest_db = _get_latest_api_db()
    if not latest_db:
        _hr_uuid_cache["ts"] = now
        _hr_uuid_cache["uuids"] = set()
        return set()

    hr_uuids = set()
    try:
        conn = sqlite3.connect(latest_db, timeout=5)
        rows = conn.execute(
            "SELECT uuid, LOWER(guild_rank) "
            "FROM player_stats WHERE UPPER(guild_prefix) = 'ESI'"
        ).fetchall()
        conn.close()
        for row in rows:
            row_uuid = (row[0] or "").strip()
            row_rank = (row[1] or "").strip()
            if row_uuid and row_rank in _POINTS_HR_RANKS:
                hr_uuids.add(row_uuid)
    except sqlite3.Error:
        pass

    _hr_uuid_cache["ts"] = now
    _hr_uuid_cache["uuids"] = set(hr_uuids)
    return hr_uuids


def _is_hr_uuid(uuid: str) -> bool:
    if not uuid:
        return False
    return uuid in _get_hr_uuid_set()


def _split_from_history(
    conn: sqlite3.Connection,
    uuid: str,
    cycle_id: int,
    total_points: int,
) -> tuple[int, int] | None:
    """Compute ``(clean, dirty)`` from the player's per-record history table.
    Returns ``None`` when the history table is missing or unreadable.
    """
    if not uuid or not _UUID_RE.match(uuid):
        return None
    player_table = "player_" + uuid.replace("-", "_")
    is_hr = _is_hr_uuid(uuid)
    try:
        rows = conn.execute(
            f'SELECT COALESCE(points_gained, 0), COALESCE(reason, \'\'), '
            f'COALESCE(is_dirty, 0) '
            f'FROM "{player_table}" WHERE cycle_id = ?',
            (cycle_id,),
        ).fetchall()
        if not rows:
            return None

        dirty = 0
        seen_total = 0
        for row in rows:
            points = int(row[0] or 0)
            reason = row[1] or ""
            is_dirty = int(row[2] or 0)
            if points <= 0:
                continue
            seen_total += points
            reason_dirty = _is_dirty_reason(reason)
            if is_hr:
                effective_dirty = reason_dirty
            else:
                effective_dirty = False if reason_dirty else (is_dirty == 1)
            if effective_dirty:
                dirty += points
        if seen_total <= 0:
            return None

        dirty = max(0, min(total_points, int(dirty)))
        return total_points - dirty, dirty
    except sqlite3.OperationalError:
        return None

def _get_cycle_id(dt=None) -> int:
    if dt is None:
        dt = _dt.now(_tz.utc)
    return int((dt - _CYCLE_ANCHOR) / _CYCLE_DURATION) + 1
def _get_cycle_bounds(cycle_id: int) -> tuple[_dt, _dt]:
    start = _CYCLE_ANCHOR + _CYCLE_DURATION * (cycle_id - 1)
    return start, start + _CYCLE_DURATION

def _previous_cycle_id(dt=None) -> int:
    return _get_cycle_id(dt) - 1

def _ensure_ep_reservations_table(conn: sqlite3.Connection) -> None:
    """Create the ep_reservations table in shop.db if it doesn't exist (idempotent)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ep_reservations (
            reservation_id  TEXT PRIMARY KEY,
            uuid            TEXT NOT NULL,
            username        TEXT NOT NULL,
            reserved_amount INTEGER NOT NULL,
            ep_type         TEXT NOT NULL,
            source          TEXT NOT NULL,
            created_at      TEXT NOT NULL,
            released_at     TEXT
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ep_res_uuid "
        "ON ep_reservations (uuid)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ep_res_source "
        "ON ep_reservations (source)"
    )

def _ensure_ep_adjustments_table(conn: sqlite3.Connection) -> None:
    """Create ep_adjustments table for manual admin EP grants/deductions."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS ep_adjustments (
            id         TEXT PRIMARY KEY,
            uuid       TEXT NOT NULL,
            amount     INTEGER NOT NULL,
            ep_type    TEXT NOT NULL,
            reason     TEXT NOT NULL DEFAULT '',
            actor      TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_ep_adj_uuid "
        "ON ep_adjustments (uuid)"
    )


def _mc_uuid(discord_id: str) -> str | None:
    """Look up the Minecraft UUID tied to a Discord ID via username_matches.json."""
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    entry = matches.get(str(discord_id))
    if entry is None:
        return None
    if isinstance(entry, dict):
        return entry.get("uuid")
    return None

def _mc_username_from_matches(discord_id: str) -> str | None:
    """Look up the Minecraft username tied to a Discord ID."""
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    entry = matches.get(str(discord_id))
    if entry is None:
        return None
    if isinstance(entry, str):
        return entry
    if isinstance(entry, dict):
        return entry.get("username")
    return None

def resolve_uuid_for_user(discord_id: str) -> tuple[str | None, str | None]:
    """Return ``(mc_uuid, mc_username)`` for a Discord user.

    Falls back to querying esi_points.db by username if the matches file
    has a username but no uuid.
    """
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    entry = matches.get(str(discord_id))
    if entry is None:
        return None, None

    if isinstance(entry, str):
        mc_username = entry
        mc_uuid = None
    elif isinstance(entry, dict):
        mc_username = entry.get("username")
        mc_uuid = entry.get("uuid")
    else:
        return None, None

    # If we have a uuid already, return it
    if mc_uuid:
        return mc_uuid, mc_username

    # Fallback: resolve uuid from esi_points by username
    if mc_username and os.path.isfile(_POINTS_DB):
        try:
            conn = sqlite3.connect(_POINTS_DB, timeout=5)
            row = conn.execute(
                "SELECT uuid FROM esi_points WHERE LOWER(username) = LOWER(?) LIMIT 1",
                (mc_username,),
            ).fetchone()
            conn.close()
            if row:
                return row[0], mc_username
        except sqlite3.Error:
            pass

    return None, mc_username

def fetch_ep_balance(uuid: str, points_cycle_id: int | None = None) -> dict:
    """Compute the full EP balance for a player UUID.
    By default, earned EP is accumulated from all completed cycles (up to and
    including the previous cycle).  Pass points_cycle_id explicitly to cap
    which cycles are included.

    Returns a dict with keys: clean_ep, dirty_ep, total_ep,
    reserved_clean, reserved_dirty, spendable_clean, spendable_dirty.
    """
    if points_cycle_id is None:
        points_cycle_id = _previous_cycle_id()

    clean_ep = 0
    dirty_ep = 0
    if os.path.isfile(_POINTS_DB):
        try:
            conn = sqlite3.connect(_POINTS_DB, timeout=5)
            if points_cycle_id > 0:
                normalized_prev_cycle = get_user_cycle_totals(uuid, points_cycle_id)
                saw_previous_cycle_row = False
                try:
                    rows = conn.execute(
                        "SELECT cycle_id, COALESCE(points, 0), "
                        "COALESCE(clean_ep, 0), COALESCE(dirty_ep, 0) "
                        "FROM esi_points WHERE uuid = ? AND cycle_id <= ?",
                        (uuid, points_cycle_id),
                    ).fetchall()
                except sqlite3.OperationalError:
                    rows = conn.execute(
                        "SELECT cycle_id, COALESCE(points, 0), "
                        "COALESCE(clean_ep, 0), COALESCE(dirty_ep, 0) "
                        "FROM esi_points WHERE uuid = ?",
                        (uuid,),
                    ).fetchall()

                for cycle_id, pts, c, d in rows:
                    cycle_id = int(cycle_id or 0)
                    pts, c, d = int(pts), int(c), int(d)
                    override_applied = False
                    if cycle_id == points_cycle_id:
                        saw_previous_cycle_row = True
                        if normalized_prev_cycle is not None:
                            pts = int(normalized_prev_cycle.get("points") or 0)
                            c = int(normalized_prev_cycle.get("clean_ep") or 0)
                            d = int(normalized_prev_cycle.get("dirty_ep") or 0)
                            override_applied = True
                    should_try_history = (pts > 0) and (
                        (cycle_id == points_cycle_id) or (c == 0 and d == 0)
                    )
                    if override_applied:
                        should_try_history = False
                    if should_try_history:
                        split = _split_from_history(conn, uuid, cycle_id, pts)
                        if split is not None:
                            c, d = split
                        elif c == 0 and d == 0:
                            c, d = pts, 0

                    if cycle_id == points_cycle_id:
                        # Previous (most-recent completed) cycle: clean stays clean
                        clean_ep += c
                        dirty_ep += d
                    else:
                        # Older cycles: all clean EP ages into dirty
                        dirty_ep += c + d

                if (
                    points_cycle_id > 0
                    and normalized_prev_cycle is not None
                    and not saw_previous_cycle_row
                ):
                    clean_ep += int(normalized_prev_cycle.get("clean_ep") or 0)
                    dirty_ep += int(normalized_prev_cycle.get("dirty_ep") or 0)
            conn.close()
        except sqlite3.Error as exc:
            print(f"[EP] Failed to read esi_points: {exc}", file=sys.stderr)

    # Current cycle boundary for age-aware clean/dirty bucket accounting
    active_cycle_id = int(points_cycle_id) + 1
    active_cycle_start_iso = None
    if active_cycle_id > 0:
        active_cycle_start, _ = _get_cycle_bounds(active_cycle_id)
        active_cycle_start_iso = active_cycle_start.isoformat()

    # 2. Active reservations + shop spending from shop.db
    reserved_clean = 0
    reserved_dirty = 0
    spent_clean_current = 0
    spent_clean_aged = 0
    spent_dirty = 0
    donated_dirty = 0
    adj_clean_current = 0
    adj_clean_aged = 0
    adj_dirty = 0
    if os.path.isfile(_SHOP_DB):
        try:
            conn = sqlite3.connect(_SHOP_DB, timeout=5)
            _ensure_ep_reservations_table(conn)
            _ensure_ep_adjustments_table(conn)

            # Reservations (auction bid holds)
            if active_cycle_start_iso:
                row = conn.execute(
                    "SELECT "
                    "COALESCE(SUM(CASE WHEN ep_type = 'clean' "
                    "AND created_at >= ? THEN reserved_amount ELSE 0 END), 0), "
                    "COALESCE(SUM(CASE WHEN ep_type = 'clean' "
                    "AND created_at < ? THEN reserved_amount ELSE 0 END), 0), "
                    "COALESCE(SUM(CASE WHEN ep_type = 'dirty' "
                    "THEN reserved_amount ELSE 0 END), 0) "
                    "FROM ep_reservations "
                    "WHERE uuid = ? AND released_at IS NULL",
                    (active_cycle_start_iso, active_cycle_start_iso, uuid),
                ).fetchone()
                if row:
                    reserved_clean = int(row[0])
                    reserved_clean_aged = int(row[1])
                    reserved_dirty = int(row[2]) + reserved_clean_aged
            else:
                rows = conn.execute(
                    "SELECT ep_type, COALESCE(SUM(reserved_amount), 0) "
                    "FROM ep_reservations "
                    "WHERE uuid = ? AND released_at IS NULL "
                    "GROUP BY ep_type",
                    (uuid,),
                ).fetchall()
                for ep_type, amount in rows:
                    if ep_type == "clean":
                        reserved_clean = int(amount)
                    elif ep_type == "dirty":
                        reserved_dirty = int(amount)

            # Spending (pending + fulfilled bin purchases)
            if active_cycle_start_iso:
                row = conn.execute(
                    "SELECT "
                    "COALESCE(SUM(CASE WHEN purchased_at >= ? "
                    "THEN clean_ep_spent ELSE 0 END), 0), "
                    "COALESCE(SUM(CASE WHEN purchased_at < ? "
                    "THEN clean_ep_spent ELSE 0 END), 0), "
                    "COALESCE(SUM(dirty_ep_spent), 0) "
                    "FROM bin_purchases "
                    "WHERE uuid = ? AND status IN ('pending', 'fulfilled')",
                    (active_cycle_start_iso, active_cycle_start_iso, uuid),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT "
                    "COALESCE(SUM(clean_ep_spent), 0), "
                    "0, "
                    "COALESCE(SUM(dirty_ep_spent), 0) "
                    "FROM bin_purchases "
                    "WHERE uuid = ? AND status IN ('pending', 'fulfilled')",
                    (uuid,),
                ).fetchone()
            if row:
                spent_clean_current = int(row[0])
                spent_clean_aged = int(row[1])
                spent_dirty = int(row[2])

            # Confirmed donation tickets add to dirty balance
            don_row = conn.execute(
                "SELECT COALESCE(SUM(dirty_ep_to_grant), 0) "
                "FROM donation_tickets "
                "WHERE uuid = ? AND status = 'confirmed'",
                (uuid,),
            ).fetchone()
            if don_row:
                donated_dirty = int(don_row[0])

            # Manual admin EP adjustments
            if active_cycle_start_iso:
                row = conn.execute(
                    "SELECT "
                    "COALESCE(SUM(CASE WHEN ep_type = 'clean' "
                    "AND created_at >= ? THEN amount ELSE 0 END), 0), "
                    "COALESCE(SUM(CASE WHEN ep_type = 'clean' "
                    "AND created_at < ? THEN amount ELSE 0 END), 0), "
                    "COALESCE(SUM(CASE WHEN ep_type = 'dirty' "
                    "THEN amount ELSE 0 END), 0) "
                    "FROM ep_adjustments WHERE uuid = ?",
                    (active_cycle_start_iso, active_cycle_start_iso, uuid),
                ).fetchone()
                if row:
                    adj_clean_current = int(row[0])
                    adj_clean_aged = int(row[1])
                    adj_dirty = int(row[2]) + adj_clean_aged
            else:
                adj_rows = conn.execute(
                    "SELECT ep_type, COALESCE(SUM(amount), 0) "
                    "FROM ep_adjustments WHERE uuid = ? GROUP BY ep_type",
                    (uuid,),
                ).fetchall()
                for ep_type, amount in adj_rows:
                    if ep_type == "clean":
                        adj_clean_current = int(amount)
                    elif ep_type == "dirty":
                        adj_dirty = int(amount)

            conn.close()
        except sqlite3.Error as exc:
            print(f"[EP] Failed to read shop.db: {exc}", file=sys.stderr)

    # 4. Assemble final balances
    effective_clean = clean_ep - spent_clean_current + adj_clean_current
    effective_dirty = dirty_ep - spent_dirty - spent_clean_aged + donated_dirty + adj_dirty

    if effective_clean < 0:
        effective_dirty += effective_clean
        effective_clean = 0
    elif effective_dirty < 0:
        effective_clean += effective_dirty
        effective_dirty = 0
    effective_clean = max(effective_clean, 0)
    effective_dirty = max(effective_dirty, 0)

    spendable_clean = effective_clean - reserved_clean
    spendable_dirty = effective_dirty - reserved_dirty

    return {
        "clean_ep":        effective_clean,
        "dirty_ep":        effective_dirty,
        "total_ep":        effective_clean + effective_dirty,
        "reserved_clean":  reserved_clean,
        "reserved_dirty":  reserved_dirty,
        "spendable_clean": max(spendable_clean, 0),
        "spendable_dirty": max(spendable_dirty, 0),
    }

class InsufficientFunds(Exception):
    """Raised when the player cannot afford the requested spend."""

    def __init__(self, needed: int, available: int, message: str | None = None):
        self.needed = needed
        self.available = available
        super().__init__(
            message or f"Insufficient EP: need {needed}, have {available} spendable"
        )

def resolve_spend(
    uuid: str,
    amount: int,
    spend_order: str,
) -> dict:
    """Determine how to split *amount* EP between clean and dirty.

    Parameters
    ----------
    uuid : str
        The player's Minecraft UUID.
    amount : int
        Total EP to spend.
    spend_order : str
        One of ``"clean_first"``, ``"dirty_first"``,
        ``"clean_only"``, ``"dirty_only"``.

    Returns
    -------
    dict
        ``{"clean_to_spend": int, "dirty_to_spend": int}``

    Raises
    ------
    InsufficientFunds
        If the player does not have enough spendable EP.
    ValueError
        If *spend_order* is not recognised.
    """
    if amount <= 0:
        return {"clean_to_spend": 0, "dirty_to_spend": 0}

    balance = fetch_ep_balance(uuid)
    sc = balance["spendable_clean"]
    sd = balance["spendable_dirty"]

    if spend_order == "clean_only":
        if sc < amount:
            raise InsufficientFunds(amount, sc, "Not enough clean EP")
        return {"clean_to_spend": amount, "dirty_to_spend": 0}

    if spend_order == "dirty_only":
        if sd < amount:
            raise InsufficientFunds(amount, sd, "Not enough dirty EP")
        return {"clean_to_spend": 0, "dirty_to_spend": amount}

    if spend_order == "clean_first":
        from_clean = min(sc, amount)
        remainder = amount - from_clean
        from_dirty = min(sd, remainder)
        if from_clean + from_dirty < amount:
            raise InsufficientFunds(amount, sc + sd)
        return {"clean_to_spend": from_clean, "dirty_to_spend": from_dirty}

    if spend_order == "dirty_first":
        from_dirty = min(sd, amount)
        remainder = amount - from_dirty
        from_clean = min(sc, remainder)
        if from_clean + from_dirty < amount:
            raise InsufficientFunds(amount, sc + sd)
        return {"clean_to_spend": from_clean, "dirty_to_spend": from_dirty}

    raise ValueError(f"Unknown spend_order: {spend_order!r}")
