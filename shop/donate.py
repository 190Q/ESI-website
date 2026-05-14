import os
import sqlite3
import sys
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz, timedelta as _td

from config import _SHOP_DB, _DONATION_LE_TO_EP_RATE, _DONATION_MAX_EP_PER_CYCLE
from shop.ep_balance import resolve_uuid_for_user
from shop.bin import PurchaseError

# Reuse cycle helpers from bin (same anchor / duration)
from shop.bin import _get_cycle_id, _get_cycle_bounds


def submit_donation(discord_id: str, le_amount: int) -> dict:
    """Create a pending donation ticket. Returns the ticket record.

    Raises ``PurchaseError`` on validation failure.
    """
    now = _dt.now(_tz.utc)
    now_iso = now.isoformat()

    if not isinstance(le_amount, int) or le_amount <= 0:
        raise PurchaseError("le_amount must be a positive integer", 400)

    mc_uuid, mc_username = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        raise PurchaseError("No linked Minecraft account", 400)

    dirty_ep = le_amount * _DONATION_LE_TO_EP_RATE

    if not os.path.isfile(_SHOP_DB):
        raise PurchaseError("Shop database unavailable", 503)

    # per-cycle cap check
    if _DONATION_MAX_EP_PER_CYCLE is not None:
        current_cycle = _get_cycle_id(now)
        cycle_start, cycle_end = _get_cycle_bounds(current_cycle)

        try:
            conn = sqlite3.connect(_SHOP_DB, timeout=5)
            row = conn.execute(
                "SELECT COALESCE(SUM(dirty_ep_to_grant), 0) "
                "FROM donation_tickets "
                "WHERE uuid = ? AND status IN ('pending', 'confirmed') "
                "  AND submitted_at >= ? AND submitted_at < ?",
                (mc_uuid, cycle_start.isoformat(), cycle_end.isoformat()),
            ).fetchone()
            conn.close()
            already_this_cycle = int(row[0]) if row else 0
        except sqlite3.Error as exc:
            print(f"[DONATE] Failed to check cycle cap: {exc}", file=sys.stderr)
            already_this_cycle = 0

        if already_this_cycle + dirty_ep > _DONATION_MAX_EP_PER_CYCLE:
            remaining = max(0, _DONATION_MAX_EP_PER_CYCLE - already_this_cycle)
            remaining_le = remaining // _DONATION_LE_TO_EP_RATE
            raise PurchaseError(
                f"Donation would exceed the cycle cap of {_DONATION_MAX_EP_PER_CYCLE} dirty EP. "
                f"You can still donate up to {remaining_le} LE ({remaining} EP) this cycle.",
                409,
            )

    # only one pending donation at a time
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        pending = conn.execute(
            "SELECT 1 FROM donation_tickets "
            "WHERE uuid = ? AND status = 'pending' LIMIT 1",
            (mc_uuid,),
        ).fetchone()
        conn.close()
        if pending:
            raise PurchaseError(
                "You already have a pending donation. Wait for it to be "
                "confirmed or rejected before submitting another.",
                409,
            )
    except PurchaseError:
        raise
    except sqlite3.Error as exc:
        print(f"[DONATE] Pending check failed: {exc}", file=sys.stderr)

    # insert ticket
    ticket_id = str(_uuid_mod.uuid4())
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "INSERT INTO donation_tickets "
            "(ticket_id, uuid, username, le_amount, dirty_ep_to_grant, "
            " status, submitted_at) "
            "VALUES (?, ?, ?, ?, ?, 'pending', ?)",
            (ticket_id, mc_uuid, mc_username or "", le_amount, dirty_ep, now_iso),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[DONATE] Insert failed: {exc}", file=sys.stderr)
        raise PurchaseError("Failed to create donation ticket", 500)

    return {
        "ticket_id":        ticket_id,
        "le_amount":        le_amount,
        "dirty_ep_to_grant": dirty_ep,
        "status":           "pending",
        "submitted_at":     now_iso,
    }

def get_donation_history(discord_id: str) -> dict:
    """Return the logged-in user's donation tickets (newest first)."""
    mc_uuid, mc_username = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        return {"linked": False, "tickets": []}

    tickets = []
    if os.path.isfile(_SHOP_DB):
        try:
            conn = sqlite3.connect(_SHOP_DB, timeout=5)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT ticket_id, le_amount, dirty_ep_to_grant, status, "
                "       chief_note, submitted_at, resolved_at "
                "FROM donation_tickets WHERE uuid = ? "
                "ORDER BY submitted_at DESC",
                (mc_uuid,),
            ).fetchall()
            conn.close()
            tickets = [dict(r) for r in rows]
        except sqlite3.Error as exc:
            print(f"[DONATE] History query failed: {exc}", file=sys.stderr)

    return {
        "linked":   True,
        "uuid":     mc_uuid,
        "username": mc_username,
        "tickets":  tickets,
    }
