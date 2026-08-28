"""Death tax - clear a leaver's EP two weeks after they leave the guild.

Flow
----
1. Detect leavers from ``tracked_guild.json`` who are **not** currently in ESI.
2. Queue them in ``shop.db`` (``death_tax_pending``) with ``dies_at = left_at + 14 days``.
3. If they rejoin before ``dies_at``, cancel the pending death tax.
4. Once ``dies_at`` passes and they are still out:
   - Snapshot and wipe spendable EP (via ``ep_adjustments``).
   - Release active EP reservations, clear cart / cooldowns / purchase limits.
   - Record the death in ``cemetery.db`` (the permanent "graveyard").
5. ``fetch_ep_balance`` ignores all EP earned on or before the wipe cycle so
   old points never return if the player rejoins later. New cycles still count.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import threading
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz, timedelta as _td

from config import (
    _CEMETERY_DB,
    _SHOP_DB,
    _TRACKED_GUILD_JSON,
    _USERNAME_MATCHES_JSON,
    _get_latest_api_db,
    _load_json_file,
)

DEATH_TAX_GRACE = _td(weeks=2)
DEATH_TAX_REASON = "Death tax (left guild)"
DEATH_TAX_ACTOR = "system:death-tax"

_scan_lock = threading.Lock()
_wiped_cycle_cache: dict[str, tuple[float, int]] = {}
_WIPED_CYCLE_CACHE_TTL = 30.0


def _now() -> _dt:
    return _dt.now(_tz.utc)


def _now_iso() -> str:
    return _now().isoformat()


def _parse_iso(value) -> _dt | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        dt = _dt.fromisoformat(text.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_tz.utc)
    return dt.astimezone(_tz.utc)


def _ensure_db_dirs() -> None:
    os.makedirs(os.path.dirname(_SHOP_DB) or ".", exist_ok=True)
    os.makedirs(os.path.dirname(_CEMETERY_DB) or ".", exist_ok=True)


def _ensure_pending_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS death_tax_pending (
            uuid            TEXT PRIMARY KEY,
            username        TEXT NOT NULL DEFAULT '',
            discord_id      TEXT NOT NULL DEFAULT '',
            left_at         TEXT NOT NULL,
            dies_at         TEXT NOT NULL,
            status          TEXT NOT NULL DEFAULT 'pending',
            created_at      TEXT NOT NULL,
            updated_at      TEXT NOT NULL,
            cancelled_at    TEXT,
            processed_at    TEXT,
            cancel_reason   TEXT NOT NULL DEFAULT ''
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_death_tax_pending_status "
        "ON death_tax_pending (status, dies_at)"
    )


def _ensure_cemetery_tables(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cemetery (
            uuid                 TEXT PRIMARY KEY,
            username             TEXT NOT NULL DEFAULT '',
            discord_id           TEXT NOT NULL DEFAULT '',
            left_at              TEXT NOT NULL,
            died_at              TEXT NOT NULL,
            wiped_through_cycle  INTEGER NOT NULL DEFAULT 0,
            clean_wiped          INTEGER NOT NULL DEFAULT 0,
            dirty_wiped          INTEGER NOT NULL DEFAULT 0,
            total_wiped          INTEGER NOT NULL DEFAULT 0,
            balance_snapshot     TEXT NOT NULL DEFAULT '{}',
            wipe_details         TEXT NOT NULL DEFAULT '{}'
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cemetery_died_at ON cemetery (died_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cemetery_username ON cemetery (username)"
    )


def _connect_shop() -> sqlite3.Connection:
    _ensure_db_dirs()
    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    _ensure_pending_table(conn)
    return conn


def _connect_cemetery() -> sqlite3.Connection:
    _ensure_db_dirs()
    conn = sqlite3.connect(_CEMETERY_DB, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    _ensure_cemetery_tables(conn)
    return conn


def _discord_id_for_uuid(uuid: str) -> str:
    matches = _load_json_file(_USERNAME_MATCHES_JSON) or {}
    target = (uuid or "").strip().lower()
    for did, entry in matches.items():
        if isinstance(entry, dict) and (entry.get("uuid") or "").strip().lower() == target:
            return str(did)
    return ""


def _load_current_guild_uuids() -> set[str]:
    """UUIDs currently in ESI (live API snapshot preferred)."""
    latest_db = _get_latest_api_db()
    if latest_db:
        try:
            conn = sqlite3.connect(latest_db, timeout=5)
            try:
                rows = conn.execute(
                    "SELECT uuid FROM player_stats "
                    "WHERE UPPER(COALESCE(guild_prefix, '')) = 'ESI'"
                ).fetchall()
            except sqlite3.OperationalError:
                rows = conn.execute("SELECT uuid FROM player_stats").fetchall()
            conn.close()
            out = {(r[0] or "").strip().lower() for r in rows if r and r[0]}
            if out:
                return out
        except sqlite3.Error:
            pass

    tracked = _load_json_file(_TRACKED_GUILD_JSON) or {}
    prev = ((tracked.get("previous_data") or {}).get("members") or {})
    out: set[str] = set()
    if isinstance(prev, dict):
        for rank_list in prev.values():
            if not isinstance(rank_list, list):
                continue
            for entry in rank_list:
                if not isinstance(entry, dict):
                    continue
                uid = (entry.get("uuid") or "").strip().lower()
                if uid:
                    out.add(uid)
    return out


def _collect_leave_events() -> dict[str, dict]:
    """Return {uuid_lower: {username, left_at}} for the most recent leave per uuid.

    Prefer ``event_history`` member_left events. Fall back to
    ``member_history.left`` only when the uuid is not currently in the guild
    (member_history often keeps stale ``left`` after rejoins).
    """
    tracked = _load_json_file(_TRACKED_GUILD_JSON) or {}
    current = _load_current_guild_uuids()
    leaves: dict[str, dict] = {}

    events = tracked.get("event_history") or []
    if isinstance(events, list):
        for ev in events:
            if not isinstance(ev, dict) or ev.get("type") != "member_left":
                continue
            uid = (ev.get("uuid") or "").strip().lower()
            if not uid or uid in current:
                continue
            left_at = _parse_iso(ev.get("timestamp"))
            if left_at is None:
                continue
            prev = leaves.get(uid)
            if prev is None or left_at > prev["left_at"]:
                leaves[uid] = {
                    "uuid": uid,
                    "username": (ev.get("username") or "").strip(),
                    "left_at": left_at,
                }

    history = tracked.get("member_history") or {}
    if isinstance(history, dict):
        for uid_raw, entry in history.items():
            if not isinstance(entry, dict):
                continue
            uid = (uid_raw or entry.get("uuid") or "").strip().lower()
            if not uid or uid in current:
                continue
            left_at = _parse_iso(entry.get("left"))
            if left_at is None:
                continue
            prev = leaves.get(uid)
            if prev is None or left_at > prev["left_at"]:
                leaves[uid] = {
                    "uuid": uid,
                    "username": (
                        entry.get("username")
                        or (prev or {}).get("username")
                        or ""
                    ).strip(),
                    "left_at": left_at,
                }

    return leaves


def get_cemetery_record(uuid: str) -> dict | None:
    """Return the cemetery row for *uuid*, or None."""
    uid = (uuid or "").strip().lower()
    if not uid or not os.path.isfile(_CEMETERY_DB):
        return None
    try:
        conn = _connect_cemetery()
        row = conn.execute(
            "SELECT uuid, username, discord_id, left_at, died_at, "
            "wiped_through_cycle, clean_wiped, dirty_wiped, total_wiped, "
            "balance_snapshot, wipe_details "
            "FROM cemetery WHERE LOWER(uuid) = ?",
            (uid,),
        ).fetchone()
        conn.close()
    except sqlite3.Error:
        return None
    if not row:
        return None
    snapshot = {}
    details = {}
    try:
        snapshot = json.loads(row[9] or "{}")
    except (TypeError, json.JSONDecodeError):
        pass
    try:
        details = json.loads(row[10] or "{}")
    except (TypeError, json.JSONDecodeError):
        pass
    return {
        "uuid": row[0],
        "username": row[1],
        "discord_id": row[2],
        "left_at": row[3],
        "died_at": row[4],
        "wiped_through_cycle": int(row[5] or 0),
        "clean_wiped": int(row[6] or 0),
        "dirty_wiped": int(row[7] or 0),
        "total_wiped": int(row[8] or 0),
        "balance_snapshot": snapshot,
        "wipe_details": details,
    }


def is_in_cemetery(uuid: str) -> bool:
    return get_cemetery_record(uuid) is not None


def get_wiped_through_cycle(uuid: str) -> int:
    """Highest completed cycle whose EP was wiped by the death tax (0 = none)."""
    uid = (uuid or "").strip().lower()
    if not uid:
        return 0
    import time as _time
    now = _time.time()
    cached = _wiped_cycle_cache.get(uid)
    if cached and now - cached[0] < _WIPED_CYCLE_CACHE_TTL:
        return cached[1]
    rec = get_cemetery_record(uid)
    value = int(rec.get("wiped_through_cycle") or 0) if rec else 0
    _wiped_cycle_cache[uid] = (now, value)
    return value


def _invalidate_wiped_cycle_cache(uuid: str | None = None) -> None:
    if uuid is None:
        _wiped_cycle_cache.clear()
        return
    _wiped_cycle_cache.pop((uuid or "").strip().lower(), None)


def list_cemetery(limit: int = 200, offset: int = 0) -> dict:
    """List cemetery entries, newest deaths first."""
    limit = max(1, min(int(limit or 200), 1000))
    offset = max(0, int(offset or 0))
    if not os.path.isfile(_CEMETERY_DB):
        return {"entries": [], "total": 0}
    try:
        conn = _connect_cemetery()
        total = conn.execute("SELECT COUNT(*) FROM cemetery").fetchone()[0]
        rows = conn.execute(
            "SELECT uuid, username, discord_id, left_at, died_at, "
            "wiped_through_cycle, clean_wiped, dirty_wiped, total_wiped "
            "FROM cemetery ORDER BY died_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        ).fetchall()
        conn.close()
    except sqlite3.Error as exc:
        return {"entries": [], "total": 0, "error": str(exc)}
    entries = [
        {
            "uuid": r[0],
            "username": r[1],
            "discord_id": r[2],
            "left_at": r[3],
            "died_at": r[4],
            "wiped_through_cycle": int(r[5] or 0),
            "clean_wiped": int(r[6] or 0),
            "dirty_wiped": int(r[7] or 0),
            "total_wiped": int(r[8] or 0),
        }
        for r in rows
    ]
    return {"entries": entries, "total": int(total or 0)}


def list_pending(limit: int = 200) -> list[dict]:
    """Return currently pending death-tax queues."""
    limit = max(1, min(int(limit or 200), 1000))
    try:
        conn = _connect_shop()
        rows = conn.execute(
            "SELECT uuid, username, discord_id, left_at, dies_at, status, "
            "created_at, updated_at "
            "FROM death_tax_pending WHERE status = 'pending' "
            "ORDER BY dies_at ASC LIMIT ?",
            (limit,),
        ).fetchall()
        conn.close()
    except sqlite3.Error:
        return []
    return [
        {
            "uuid": r[0],
            "username": r[1],
            "discord_id": r[2],
            "left_at": r[3],
            "dies_at": r[4],
            "status": r[5],
            "created_at": r[6],
            "updated_at": r[7],
        }
        for r in rows
    ]


def _queue_or_refresh_pending(
    conn: sqlite3.Connection,
    *,
    uuid: str,
    username: str,
    left_at: _dt,
    now_iso: str,
) -> str:
    """Insert/refresh a pending death tax. Returns action label."""
    dies_at = left_at + DEATH_TAX_GRACE
    discord_id = _discord_id_for_uuid(uuid)
    existing = conn.execute(
        "SELECT left_at, status FROM death_tax_pending WHERE uuid = ?",
        (uuid,),
    ).fetchone()

    if existing:
        status = existing[1] or ""
        if status == "processed":
            prev_left = _parse_iso(existing[0])
            if prev_left and left_at <= prev_left:
                return "skip-already-processed"
        if status == "pending":
            prev_left = _parse_iso(existing[0])
            if prev_left and left_at >= prev_left:
                conn.execute(
                    "UPDATE death_tax_pending SET username = ?, discord_id = ?, "
                    "updated_at = ? WHERE uuid = ? AND status = 'pending'",
                    (username or "", discord_id, now_iso, uuid),
                )
                return "refresh-pending"
        conn.execute(
            "UPDATE death_tax_pending SET username = ?, discord_id = ?, "
            "left_at = ?, dies_at = ?, status = 'pending', updated_at = ?, "
            "cancelled_at = NULL, processed_at = NULL, cancel_reason = '' "
            "WHERE uuid = ?",
            (
                username or "",
                discord_id,
                left_at.isoformat(),
                dies_at.isoformat(),
                now_iso,
                uuid,
            ),
        )
        return "requeue"

    conn.execute(
        "INSERT INTO death_tax_pending "
        "(uuid, username, discord_id, left_at, dies_at, status, created_at, updated_at) "
        "VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)",
        (
            uuid,
            username or "",
            discord_id,
            left_at.isoformat(),
            dies_at.isoformat(),
            now_iso,
            now_iso,
        ),
    )
    return "queued"


def _cancel_pending(
    conn: sqlite3.Connection,
    uuid: str,
    reason: str,
    now_iso: str,
) -> bool:
    cur = conn.execute(
        "UPDATE death_tax_pending SET status = 'cancelled', "
        "cancelled_at = ?, updated_at = ?, cancel_reason = ? "
        "WHERE uuid = ? AND status = 'pending'",
        (now_iso, now_iso, reason[:200], uuid),
    )
    return cur.rowcount > 0


def _wipe_shop_side_state(conn: sqlite3.Connection, uuid: str, now_iso: str) -> dict:
    """Clear reservations, cart, cooldowns, limits for *uuid*. Returns counts."""
    details: dict = {}

    try:
        cur = conn.execute(
            "UPDATE ep_reservations SET released_at = ? "
            "WHERE uuid = ? AND released_at IS NULL",
            (now_iso, uuid),
        )
        details["reservations_released"] = int(cur.rowcount or 0)
    except sqlite3.OperationalError:
        details["reservations_released"] = 0

    try:
        cur = conn.execute("DELETE FROM cart_items WHERE mc_uuid = ?", (uuid,))
        details["cart_items_cleared"] = int(cur.rowcount or 0)
    except sqlite3.OperationalError:
        details["cart_items_cleared"] = 0

    try:
        cur = conn.execute("DELETE FROM cooldowns WHERE uuid = ?", (uuid,))
        details["cooldowns_cleared"] = int(cur.rowcount or 0)
    except sqlite3.OperationalError:
        details["cooldowns_cleared"] = 0

    try:
        cur = conn.execute("DELETE FROM user_limits WHERE uuid = ?", (uuid,))
        details["limits_cleared"] = int(cur.rowcount or 0)
    except sqlite3.OperationalError:
        details["limits_cleared"] = 0

    return details


def _apply_ep_wipe_adjustments(
    conn: sqlite3.Connection,
    uuid: str,
    clean: int,
    dirty: int,
    now_iso: str,
) -> list[str]:
    """Insert negative ep_adjustments to zero the player's spendable EP."""
    from shop.ep_balance import _ensure_ep_adjustments_table

    _ensure_ep_adjustments_table(conn)
    ids: list[str] = []
    for amount, ep_type in ((-int(clean or 0), "clean"), (-int(dirty or 0), "dirty")):
        if amount == 0:
            continue
        adj_id = str(_uuid_mod.uuid4())
        conn.execute(
            "INSERT INTO ep_adjustments "
            "(id, uuid, amount, ep_type, reason, actor, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (adj_id, uuid, amount, ep_type, DEATH_TAX_REASON, DEATH_TAX_ACTOR, now_iso),
        )
        ids.append(adj_id)
    return ids


def _process_death(uuid: str, username: str, left_at_iso: str, discord_id: str) -> dict:
    """Wipe EP + shop state and write a cemetery record."""
    from shop.ep_balance import fetch_ep_balance, _previous_cycle_id

    now_iso = _now_iso()
    # Snapshot balance BEFORE wipe adjustments (ignore cemetery gate).
    balance = fetch_ep_balance(uuid, ignore_death_tax=True)
    clean = int(balance.get("clean_ep") or 0)
    dirty = int(balance.get("dirty_ep") or 0)
    wiped_through = max(0, int(_previous_cycle_id()))

    shop_conn = _connect_shop()
    try:
        shop_conn.execute("BEGIN IMMEDIATE")
        wipe_details = _wipe_shop_side_state(shop_conn, uuid, now_iso)
        adj_ids = _apply_ep_wipe_adjustments(shop_conn, uuid, clean, dirty, now_iso)
        wipe_details["adjustment_ids"] = adj_ids
        shop_conn.execute(
            "UPDATE death_tax_pending SET status = 'processed', "
            "processed_at = ?, updated_at = ? WHERE uuid = ?",
            (now_iso, now_iso, uuid),
        )
        shop_conn.commit()
    except Exception:
        shop_conn.rollback()
        raise
    finally:
        shop_conn.close()

    cem_conn = _connect_cemetery()
    try:
        cem_conn.execute(
            "INSERT INTO cemetery "
            "(uuid, username, discord_id, left_at, died_at, wiped_through_cycle, "
            "clean_wiped, dirty_wiped, total_wiped, balance_snapshot, wipe_details) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
            "ON CONFLICT(uuid) DO UPDATE SET "
            "  username = excluded.username, "
            "  discord_id = excluded.discord_id, "
            "  left_at = excluded.left_at, "
            "  died_at = excluded.died_at, "
            "  wiped_through_cycle = MAX(cemetery.wiped_through_cycle, excluded.wiped_through_cycle), "
            "  clean_wiped = cemetery.clean_wiped + excluded.clean_wiped, "
            "  dirty_wiped = cemetery.dirty_wiped + excluded.dirty_wiped, "
            "  total_wiped = cemetery.total_wiped + excluded.total_wiped, "
            "  balance_snapshot = excluded.balance_snapshot, "
            "  wipe_details = excluded.wipe_details",
            (
                uuid,
                username or "",
                discord_id or _discord_id_for_uuid(uuid),
                left_at_iso,
                now_iso,
                wiped_through,
                clean,
                dirty,
                clean + dirty,
                json.dumps(balance, ensure_ascii=False),
                json.dumps(wipe_details, ensure_ascii=False),
            ),
        )
        cem_conn.commit()
    finally:
        cem_conn.close()

    _invalidate_wiped_cycle_cache(uuid)

    try:
        from shop.admin import _invalidate_users_cache
        _invalidate_users_cache()
    except Exception:
        pass

    print(
        f"[DEATH-TAX] {username or uuid} died — wiped {clean} clean / {dirty} dirty EP "
        f"(through cycle {wiped_through}).",
        file=sys.stderr,
    )
    return {
        "ok": True,
        "uuid": uuid,
        "username": username,
        "clean_wiped": clean,
        "dirty_wiped": dirty,
        "wiped_through_cycle": wiped_through,
        "died_at": now_iso,
    }


def process_death_tax(now: _dt | None = None) -> dict:
    """Scan leavers, queue/cancel pending taxes, and process due deaths.

    Safe to call repeatedly from the background worker.
    """
    if not _scan_lock.acquire(blocking=False):
        return {"ok": True, "skipped": "locked"}
    try:
        now = now or _now()
        now_iso = now.isoformat()
        leaves = _collect_leave_events()
        current = _load_current_guild_uuids()

        queued = refreshed = cancelled = processed = 0
        errors: list[str] = []

        shop_conn = _connect_shop()
        try:
            for uid, info in leaves.items():
                try:
                    action = _queue_or_refresh_pending(
                        shop_conn,
                        uuid=uid,
                        username=info.get("username") or "",
                        left_at=info["left_at"],
                        now_iso=now_iso,
                    )
                    if action == "queued":
                        queued += 1
                    elif action == "refresh-pending":
                        refreshed += 1
                    elif action == "requeue":
                        queued += 1
                except sqlite3.Error as exc:
                    errors.append(f"queue {uid}: {exc}")

            pending_rows = shop_conn.execute(
                "SELECT uuid, username FROM death_tax_pending WHERE status = 'pending'"
            ).fetchall()
            for uid, uname in pending_rows:
                if (uid or "").lower() in current:
                    if _cancel_pending(shop_conn, uid, "rejoined guild", now_iso):
                        cancelled += 1
                        print(
                            f"[DEATH-TAX] Cancelled pending tax for {uname or uid} (rejoined).",
                            file=sys.stderr,
                        )

            shop_conn.commit()

            due = shop_conn.execute(
                "SELECT uuid, username, discord_id, left_at, dies_at "
                "FROM death_tax_pending WHERE status = 'pending' AND dies_at <= ?",
                (now_iso,),
            ).fetchall()
        finally:
            shop_conn.close()

        for uid, uname, did, left_at, _dies_at in due:
            if (uid or "").lower() in current:
                try:
                    conn = _connect_shop()
                    _cancel_pending(conn, uid, "rejoined guild", now_iso)
                    conn.commit()
                    conn.close()
                    cancelled += 1
                except sqlite3.Error as exc:
                    errors.append(f"cancel {uid}: {exc}")
                continue
            try:
                _process_death(uid, uname or "", left_at or "", did or "")
                processed += 1
            except Exception as exc:
                errors.append(f"process {uid}: {exc}")
                print(
                    f"[DEATH-TAX] Failed to process {uname or uid}: {exc}",
                    file=sys.stderr,
                )

        result = {
            "ok": True,
            "queued": queued,
            "refreshed": refreshed,
            "cancelled": cancelled,
            "processed": processed,
            "pending_leaves_seen": len(leaves),
        }
        if errors:
            result["errors"] = errors
        if queued or cancelled or processed:
            print(
                f"[DEATH-TAX] scan: queued={queued} cancelled={cancelled} "
                f"processed={processed} leaves={len(leaves)}",
                file=sys.stderr,
            )
        return result
    finally:
        _scan_lock.release()
