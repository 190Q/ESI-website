import json
import os
import sqlite3
import sys
import threading
import time as _time
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz, timedelta as _td

from config import _SHOP_DB, _POINTS_DB, _SHOP_ITEMS_JSON, _USERNAME_MATCHES_JSON, _load_json_file as _cfg_load_json
from shop.items import get_items, reload as _reload_items
from shop.auction import _resolve_discord_id_for_uuid, _dm_in_background


_now = lambda: _dt.now(_tz.utc)
_now_iso = lambda: _now().isoformat()


def _ensure_admin_log_table(conn: sqlite3.Connection) -> None:
    """Create shop_admin_log if it doesn't exist yet (idempotent)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS shop_admin_log (
            id        INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT    NOT NULL,
            actor     TEXT    NOT NULL,
            action    TEXT    NOT NULL,
            target_id TEXT,
            details   TEXT
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sal_timestamp ON shop_admin_log (timestamp)"
    )

def _log_admin_action(
    actor: str,
    action: str,
    target_id: str | None = None,
    details: dict | None = None,
) -> None:
    """Insert a row into shop_admin_log. Silently ignores errors."""
    if not os.path.isfile(_SHOP_DB):
        return
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_admin_log_table(conn)
        conn.execute(
            "INSERT INTO shop_admin_log (timestamp, actor, action, target_id, details)"
            " VALUES (?, ?, ?, ?, ?)",
            (_now_iso(), actor, action, target_id,
             json.dumps(details, ensure_ascii=False) if details else None),
        )
        conn.commit()
        conn.close()
    except Exception:  # pragma: no cover
        pass

_USERS_CACHE_TTL: float    = 60.0   # seconds
_users_cache_lock          = threading.Lock()
_users_cache: dict         = {"data": None, "ts": 0.0}


def _invalidate_users_cache() -> None:
    """Force the next admin_get_users() call to recompute."""
    with _users_cache_lock:
        _users_cache["ts"] = 0.0


def _clear_item_cooldowns(item_id: str) -> None:
    """Delete all cooldown records for item_id.

    Called when the item's cooldown config changes so no user is retroactively
    locked out (added cooldown) or carries a stale lock (removed cooldown).
    """
    if not os.path.isfile(_SHOP_DB):
        return
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("DELETE FROM cooldowns WHERE item_id = ?", (item_id,))
        conn.commit()
        conn.close()
    except sqlite3.Error:
        pass


def _evict_item_from_carts(item_id: str) -> None:
    """Remove item_id from every saved cart so users can't check out stale data."""
    if not os.path.isfile(_SHOP_DB):
        return
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("DELETE FROM cart_items WHERE item_id = ?", (item_id,))
        conn.commit()
        conn.close()
    except sqlite3.Error:
        pass


def admin_list_items() -> list:
    """Return ALL items (including inactive), merged with overrides."""
    _reload_items()
    return get_items(tags=None) or []   # tags=None -> no visibility filter

def admin_list_all_items_unfiltered() -> list:
    """Return every item regardless of visibility, with overrides applied."""
    _reload_items()
    from shop.items import _load_json, _load_overrides, _merge
    items = _load_json()
    overrides = _load_overrides()
    return _merge(items, overrides)

def admin_set_override(item_id: str, active: bool | None, stock: int | None,
                       updated_by: str) -> dict:
    """Create or update an item override. Returns the new override state."""
    now_iso = _now_iso()
    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute(
        "INSERT INTO item_overrides (item_id, active, stock, updated_by, updated_at) "
        "VALUES (?, ?, ?, ?, ?) "
        "ON CONFLICT(item_id) DO UPDATE SET "
        "  active = COALESCE(excluded.active, item_overrides.active), "
        "  stock = COALESCE(excluded.stock, item_overrides.stock), "
        "  updated_by = excluded.updated_by, "
        "  updated_at = excluded.updated_at",
        (item_id, active, stock, updated_by, now_iso),
    )
    conn.commit()
    conn.close()
    _evict_item_from_carts(item_id)
    _reload_items()
    if active is not None:
        _log_admin_action(
            updated_by,
            "item_activated" if active else "item_deactivated",
            item_id,
            {"item_id": item_id},
        )
    if stock is not None:
        _log_admin_action(
            updated_by, "stock_updated", item_id,
            {"item_id": item_id, "new_stock": stock},
        )
    return {"item_id": item_id, "active": active, "stock": stock,
            "updated_by": updated_by, "updated_at": now_iso}

def _restore_stock(conn, item_id: str, quantity: int, now_iso: str) -> None:
    """Increment item stock in item_overrides by *quantity* (rejection refund)."""
    row = conn.execute(
        "SELECT stock FROM item_overrides WHERE item_id = ?", (item_id,)
    ).fetchone()
    if row is not None and row[0] is not None:
        conn.execute(
            "UPDATE item_overrides SET stock = stock + ?, "
            "updated_by = 'system:reject', updated_at = ? "
            "WHERE item_id = ?",
            (quantity, now_iso, item_id),
        )

def admin_cancel_purchase(purchase_id: str, reason: str, chief_name: str) -> dict:
    """Reject a bin purchase. EP refund is automatic (status='rejected' excluded from balance)."""
    now_iso = _now_iso()
    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    row = conn.execute(
        "SELECT * FROM bin_purchases WHERE purchase_id = ?", (purchase_id,),
    ).fetchone()
    if not row:
        conn.close()
        return {"error": "Purchase not found"}
    if row["status"] == "rejected":
        conn.close()
        return {"error": "Purchase already rejected"}

    conn.execute(
        "UPDATE bin_purchases SET status = 'rejected', chief_note = ?, resolved_at = ? "
        "WHERE purchase_id = ?",
        (reason, now_iso, purchase_id),
    )
    try:
        qty = row["quantity"] or 1
    except (IndexError, KeyError):
        qty = 1
    _restore_stock(conn, row["item_id"], qty, now_iso)
    conn.commit()
    conn.close()
    _reload_items()

    # notify user via Discord DM
    did = _resolve_discord_id_for_uuid(row["uuid"])
    if did:
        _dm_in_background(did,
            f"Your purchase of **{row['item_id']}** has been cancelled by {chief_name}.\n"
            f"Reason: _{reason}_\n"
            f"Your {row['ep_spent']} EP has been refunded.")

    _log_admin_action(
        chief_name, "purchase_rejected", purchase_id,
        {"purchase_id": purchase_id, "item_id": row["item_id"], "reason": reason},
    )
    _invalidate_users_cache()
    return {"ok": True, "purchase_id": purchase_id, "status": "rejected"}

def admin_cancel_auction(auction_id: str, chief_name: str) -> dict:
    """Cancel an active auction, release all reservations, notify bidders."""
    now_iso = _now_iso()
    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("BEGIN IMMEDIATE")

    arow = conn.execute(
        "SELECT * FROM auctions WHERE auction_id = ?", (auction_id,),
    ).fetchone()
    if not arow:
        conn.rollback(); conn.close()
        return {"error": "Auction not found"}
    if arow["status"] != "active":
        conn.rollback(); conn.close()
        return {"error": "Auction is not active"}

    conn.execute(
        "UPDATE auctions SET status = 'cancelled' WHERE auction_id = ?",
        (auction_id,),
    )

    # get all bidder UUIDs for notification
    bidders = conn.execute(
        "SELECT DISTINCT uuid FROM bids WHERE auction_id = ?", (auction_id,),
    ).fetchall()

    conn.commit()
    conn.close()

    # release EP reservations
    source = f"auction:{auction_id}"
    if os.path.isfile(_SHOP_DB):
        try:
            shop = sqlite3.connect(_SHOP_DB, timeout=10)
            shop.execute("PRAGMA journal_mode=WAL")
            shop.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE source = ? AND released_at IS NULL",
                (now_iso, source),
            )
            shop.commit()
            shop.close()
        except sqlite3.Error as exc:
            print(f"[ADMIN] Failed to release reservations: {exc}", file=sys.stderr)

    _log_admin_action(
        chief_name, "auction_cancelled", auction_id,
        {"auction_id": auction_id, "item_id": arow["item_id"]},
    )

    # notify bidders
    item_name = arow["item_id"]
    for b in bidders:
        did = _resolve_discord_id_for_uuid(b["uuid"])
        if did:
            _dm_in_background(did,
                f"The auction for **{item_name}** has been cancelled by {chief_name}. "
                f"Your reserved EP has been released.")

    return {"ok": True, "auction_id": auction_id, "status": "cancelled"}

def admin_auction_detail(auction_id: str) -> dict:
    """Return auction info + bid stats + item metadata for the admin manage modal."""
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        arow = conn.execute(
            "SELECT * FROM auctions WHERE auction_id = ?", (auction_id,),
        ).fetchone()
        if not arow:
            conn.close()
            return {"error": "Auction not found"}

        bid_count = conn.execute(
            "SELECT COUNT(*) FROM bids WHERE auction_id = ?", (auction_id,),
        ).fetchone()[0]
        bidder_count = conn.execute(
            "SELECT COUNT(DISTINCT uuid) FROM bids WHERE auction_id = ?", (auction_id,),
        ).fetchone()[0]
        recent = conn.execute(
            "SELECT bid_id, username, amount, placed_at, is_winning FROM bids "
            "WHERE auction_id = ? ORDER BY placed_at DESC LIMIT 5",
            (auction_id,),
        ).fetchall()
        conn.close()

        from shop.items import get_item_unfiltered
        from shop.auction import _compute_extended_hours
        item = get_item_unfiltered(arow["item_id"]) or {}

        return {
            "ok": True,
            "auction_id": arow["auction_id"],
            "item_id": arow["item_id"],
            "status": arow["status"],
            "current_highest_bid": arow["current_highest_bid"],
            "ends_at": arow["ends_at"],
            "created_at": arow["created_at"],
            "extended": _compute_extended_hours(arow, item) != 0,
            "extended_hours": _compute_extended_hours(arow, item),
            "bid_count": bid_count,
            "bidder_count": bidder_count,
            "min_increment": item.get("min_increment", 1),
            "anti_snipe_seconds": item.get("anti_snipe_seconds", 0) or 0,
            "recent_bids": [
                {"bid_id": r["bid_id"], "username": r["username"], "amount": r["amount"],
                 "placed_at": r["placed_at"], "is_winning": bool(r["is_winning"])}
                for r in recent
            ],
        }
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}

def admin_remove_bid(bid_id: str, chief_name: str, reason: str | None = None) -> dict:
    """Remove a bid from an active auction, release its EP reservation, notify the user."""
    now_iso = _now_iso()
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}

    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("BEGIN IMMEDIATE")

    bid = conn.execute("SELECT * FROM bids WHERE bid_id = ?", (bid_id,)).fetchone()
    if not bid:
        conn.rollback(); conn.close()
        return {"error": "Bid not found"}

    auction_id = bid["auction_id"]
    bidder_uuid = bid["uuid"]
    bid_amount = bid["amount"]
    was_winning = bool(bid["is_winning"])

    # Delete the bid
    conn.execute("DELETE FROM bids WHERE bid_id = ?", (bid_id,))

    # If it was the winning bid, recalculate the new highest
    if was_winning:
        new_top = conn.execute(
            "SELECT bid_id, uuid, amount FROM bids "
            "WHERE auction_id = ? ORDER BY amount DESC LIMIT 1",
            (auction_id,),
        ).fetchone()
        if new_top:
            conn.execute(
                "UPDATE bids SET is_winning = 1 WHERE bid_id = ?",
                (new_top["bid_id"],),
            )
            conn.execute(
                "UPDATE auctions SET current_highest_bid = ?, current_highest_bidder_uuid = ? "
                "WHERE auction_id = ?",
                (new_top["amount"], new_top["uuid"], auction_id),
            )
        else:
            conn.execute(
                "UPDATE auctions SET current_highest_bid = 0, current_highest_bidder_uuid = NULL "
                "WHERE auction_id = ?",
                (auction_id,),
            )

    conn.commit()
    conn.close()

    # Release EP reservation for this bidder on this auction
    source = f"auction:{auction_id}"
    if os.path.isfile(_SHOP_DB):
        try:
            shop = sqlite3.connect(_SHOP_DB, timeout=10)
            shop.execute("PRAGMA journal_mode=WAL")
            shop.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE uuid = ? AND source = ? AND released_at IS NULL",
                (now_iso, bidder_uuid, source),
            )
            shop.commit()
            shop.close()
        except sqlite3.Error as exc:
            print(f"[ADMIN] Failed to release bid reservation: {exc}", file=sys.stderr)

    # Notify the user
    did = _resolve_discord_id_for_uuid(bidder_uuid)
    if did:
        msg = (f"Your bid of **{bid_amount} EP** has been removed by {chief_name}. "
               f"Your reserved EP has been released.")
        if reason:
            msg += f"\nReason: _{reason}_"
        _dm_in_background(did, msg)

    _log_admin_action(
        chief_name, "bid_removed", bid_id,
        {"bid_id": bid_id, "auction_id": auction_id,
         "amount": bid_amount, "reason": reason or None},
    )
    return {"ok": True, "bid_id": bid_id, "auction_id": auction_id}


def admin_extend_auction(auction_id: str, extra_hours: int,
                         actor: str = "unknown") -> dict:
    """Extend (or reduce if negative) an active auction's end time."""
    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    arow = conn.execute(
        "SELECT * FROM auctions WHERE auction_id = ?", (auction_id,),
    ).fetchone()
    if not arow:
        conn.close()
        return {"error": "Auction not found"}
    if arow["status"] != "active":
        conn.close()
        return {"error": "Auction is not active"}

    old_ends = _dt.fromisoformat(arow["ends_at"])
    if old_ends.tzinfo is None:
        old_ends = old_ends.replace(tzinfo=_tz.utc)
    new_ends = old_ends + _td(hours=extra_hours)

    # Enforce min 2h remaining from now
    now = _now()
    min_ends = now + _td(hours=2)
    if new_ends < min_ends:
        conn.close()
        return {"error": "Cannot adjust: auction must have at least 2 hours remaining"}

    # Determine extended flag from whether the new end differs from original
    from shop.items import get_item_unfiltered
    item = get_item_unfiltered(arow["item_id"]) or {}
    # Temporarily build a fake row with new ends_at to compute extended_hours
    fake_row = {"created_at": arow["created_at"], "ends_at": new_ends.isoformat()}
    from shop.auction import _compute_extended_hours
    new_ext_hours = _compute_extended_hours(fake_row, item)
    extended = 1 if new_ext_hours != 0 else 0

    conn.execute(
        "UPDATE auctions SET ends_at = ?, extended = ? WHERE auction_id = ?",
        (new_ends.isoformat(), extended, auction_id),
    )
    conn.commit()
    conn.close()
    _log_admin_action(
        actor, "auction_extended", auction_id,
        {"auction_id": auction_id, "extra_hours": extra_hours,
         "new_ends_at": new_ends.isoformat()},
    )
    return {"ok": True, "auction_id": auction_id, "new_ends_at": new_ends.isoformat()}

def _ensure_log_indexes(conn: sqlite3.Connection) -> None:
    """Idempotently create performance indexes for the log queries."""
    stmts = [
        "CREATE INDEX IF NOT EXISTS idx_bin_purchases_purchased_at "
        "ON bin_purchases (purchased_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_bin_purchases_username "
        "ON bin_purchases (username)",
        "CREATE INDEX IF NOT EXISTS idx_bin_purchases_item_id "
        "ON bin_purchases (item_id)",
        "CREATE INDEX IF NOT EXISTS idx_bids_placed_at "
        "ON bids (placed_at DESC)",
        "CREATE INDEX IF NOT EXISTS idx_bids_username "
        "ON bids (username)",
    ]
    for s in stmts:
        try:
            conn.execute(s)
        except sqlite3.OperationalError:
            pass

def admin_get_logs(page: int = 1, per_page: int = 50,
                   username: str | None = None, item_id: str | None = None,
                   status: str | None = None, entry_type: str | None = None,
                   date_from: str | None = None, date_to: str | None = None) -> dict:
    """Paginated view of bin_purchases + bids + donation_tickets.  Uses LIMIT
    N+1 to avoid COUNT(*) scans; returns ``has_more`` instead of totals."""
    offset = (page - 1) * per_page
    fetch  = per_page + 1
    purchases: list  = []
    bids:      list  = []
    donations: list  = []
    has_more_p = False
    has_more_b = False
    has_more_d = False

    is_active_filter   = (status == "active")
    # statuses that only exist on purchases (not bids or donations)
    is_purchase_only_status = status == "fulfilled"
    # statuses that never appear on bids
    is_not_bid_status = status in ("pending", "fulfilled", "rejected", "confirmed")
    want_purchases = not entry_type or entry_type == "purchase"
    want_bids      = not entry_type or entry_type == "bid"
    want_donations = not entry_type or entry_type == "donation"

    if os.path.isfile(_SHOP_DB):
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row
        _ensure_log_indexes(conn)

        # purchases (skip when type!=purchase or status=active)
        if want_purchases and not is_active_filter:
            pw = ["1=1"]
            pp: list = []
            if username:
                pw.append("username LIKE ?"); pp.append(f"%{username}%")
            if item_id:
                pw.append("item_id = ?"); pp.append(item_id)
            if status:
                pw.append("status = ?"); pp.append(status)
            if date_from:
                pw.append("purchased_at >= ?"); pp.append(date_from)
            if date_to:
                pw.append("purchased_at <= ?"); pp.append(date_to)

            where = " AND ".join(pw)
            raw = conn.execute(
                f"SELECT * FROM bin_purchases WHERE {where}"
                f" ORDER BY purchased_at DESC LIMIT ? OFFSET ?",
                pp + [fetch, offset],
            ).fetchall()
            has_more_p = len(raw) > per_page
            purchases  = [dict(r) for r in raw[:per_page]]

        # bids (skip when type!=bid, status=active applies as filter, skip on non-bid statuses)
        if want_bids and not is_not_bid_status:
            bw = ["1=1"]
            bp: list = []
            if username:
                bw.append("b.username LIKE ?"); bp.append(f"%{username}%")
            if item_id:
                bw.append("a.item_id = ?"); bp.append(item_id)
            if is_active_filter:
                bw.append("a.status = 'active'")
            if date_from:
                bw.append("b.placed_at >= ?"); bp.append(date_from)
            if date_to:
                bw.append("b.placed_at <= ?"); bp.append(date_to)

            bwhere = " AND ".join(bw)
            raw = conn.execute(
                f"SELECT b.*, a.item_id, a.status AS auction_status "
                f"FROM bids b LEFT JOIN auctions a ON a.auction_id = b.auction_id "
                f"WHERE {bwhere} ORDER BY b.placed_at DESC LIMIT ? OFFSET ?",
                bp + [fetch, offset],
            ).fetchall()
            has_more_b = len(raw) > per_page
            bids       = [dict(r) for r in raw[:per_page]]

        # donations (skip when type!=donation, skip on bid-only or purchase-only statuses)
        if want_donations and not is_active_filter and not is_purchase_only_status:
            dw = ["1=1"]
            dp: list = []
            if username:
                dw.append("username LIKE ?"); dp.append(f"%{username}%")
            if status:
                dw.append("status = ?"); dp.append(status)
            if date_from:
                dw.append("submitted_at >= ?"); dp.append(date_from)
            if date_to:
                dw.append("submitted_at <= ?"); dp.append(date_to)

            dwhere = " AND ".join(dw)
            raw = conn.execute(
                f"SELECT * FROM donation_tickets WHERE {dwhere}"
                f" ORDER BY submitted_at DESC LIMIT ? OFFSET ?",
                dp + [fetch, offset],
            ).fetchall()
            has_more_d = len(raw) > per_page
            donations  = [dict(r) for r in raw[:per_page]]

        conn.close()

    return {
        "purchases": purchases,
        "bids":      bids,
        "donations": donations,
        "has_more":  has_more_p or has_more_b or has_more_d,
        "page":      page,
        "per_page":  per_page,
    }

def admin_get_reservations() -> list:
    """Return all active (unreleased) EP reservations."""
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT * FROM ep_reservations WHERE released_at IS NULL "
            "ORDER BY created_at DESC"
        ).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except sqlite3.Error:
        return []

def admin_release_reservation(reservation_id: str, chief_name: str) -> dict:
    """Manually release a stuck EP reservation."""
    now_iso = _now_iso()
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        row = conn.execute(
            "SELECT * FROM ep_reservations WHERE reservation_id = ?",
            (reservation_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Reservation not found"}
        conn.execute(
            "UPDATE ep_reservations SET released_at = ? WHERE reservation_id = ?",
            (now_iso, reservation_id),
        )
        conn.commit()
        conn.close()
        return {"ok": True, "reservation_id": reservation_id, "released_at": now_iso}
    except sqlite3.Error as exc:
        return {"error": str(exc)}

def admin_get_queue() -> dict:
    """Return pending manual bin_purchases + pending donation_tickets."""
    pending_purchases = []
    pending_donations = []

    if os.path.isfile(_SHOP_DB):
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row

        rows = conn.execute(
            "SELECT * FROM bin_purchases "
            "WHERE status = 'pending' "
            "ORDER BY purchased_at ASC"
        ).fetchall()
        pending_purchases = [dict(r) for r in rows]

        rows = conn.execute(
            "SELECT * FROM donation_tickets "
            "WHERE status = 'pending' "
            "ORDER BY submitted_at ASC"
        ).fetchall()
        pending_donations = [dict(r) for r in rows]

        conn.close()

    return {
        "purchases": pending_purchases,
        "donations": pending_donations,
    }

def admin_fulfill(ticket_type: str, ticket_id: str, chief_note: str | None,
                  chief_name: str) -> dict:
    """Mark a purchase or donation as fulfilled."""
    now_iso = _now_iso()
    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")

    if ticket_type == "purchase":
        conn.execute(
            "UPDATE bin_purchases SET status = 'fulfilled', chief_note = ?, resolved_at = ? "
            "WHERE purchase_id = ? AND status = 'pending'",
            (chief_note, now_iso, ticket_id),
        )
    elif ticket_type == "donation":
        conn.execute(
            "UPDATE donation_tickets SET status = 'confirmed', chief_note = ?, resolved_at = ? "
            "WHERE ticket_id = ? AND status = 'pending'",
            (chief_note, now_iso, ticket_id),
        )
    else:
        conn.close()
        return {"error": "Invalid ticket_type"}

    if conn.total_changes == 0:
        conn.close()
        return {"error": "Ticket not found or not pending"}

    conn.commit()
    conn.close()
    if ticket_type == "purchase":
        _log_admin_action(
            chief_name, "purchase_fulfilled", ticket_id,
            {"purchase_id": ticket_id, "note": chief_note},
        )
    else:
        _log_admin_action(
            chief_name, "donation_confirmed", ticket_id,
            {"ticket_id": ticket_id, "note": chief_note},
        )
    _invalidate_users_cache()
    return {"ok": True, "ticket_id": ticket_id, "status": "fulfilled", "resolved_at": now_iso}

def admin_reject(ticket_type: str, ticket_id: str, reason: str,
                 chief_name: str) -> dict:
    """Reject a purchase or donation with mandatory reason."""
    if not reason:
        return {"error": "Reason is required"}
    now_iso = _now_iso()
    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")

    uuid = None
    ep_info = ""

    if ticket_type == "purchase":
        row = conn.execute(
            "SELECT * FROM bin_purchases WHERE purchase_id = ? AND status = 'pending'",
            (ticket_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Purchase not found or not pending"}
        uuid = row["uuid"]
        ep_info = f"{row['ep_spent']} EP"
        conn.execute(
            "UPDATE bin_purchases SET status = 'rejected', chief_note = ?, resolved_at = ? "
            "WHERE purchase_id = ?",
            (reason, now_iso, ticket_id),
        )
        try:
            qty = row["quantity"] or 1
        except (IndexError, KeyError):
            qty = 1
        _restore_stock(conn, row["item_id"], qty, now_iso)
    elif ticket_type == "donation":
        row = conn.execute(
            "SELECT * FROM donation_tickets WHERE ticket_id = ? AND status = 'pending'",
            (ticket_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Donation not found or not pending"}
        uuid = row["uuid"]
        ep_info = f"{row['le_amount']} LE"
        conn.execute(
            "UPDATE donation_tickets SET status = 'rejected', chief_note = ?, resolved_at = ? "
            "WHERE ticket_id = ?",
            (reason, now_iso, ticket_id),
        )
    else:
        conn.close()
        return {"error": "Invalid ticket_type"}

    conn.commit()
    conn.close()
    if ticket_type == "purchase":
        _reload_items()

    # DM the user
    if uuid:
        did = _resolve_discord_id_for_uuid(uuid)
        if did:
            label = "purchase" if ticket_type == "purchase" else "donation"
            _dm_in_background(did,
                f"Your {label} ({ep_info}) has been rejected by {chief_name}.\n"
                f"Reason: _{reason}_")

    if ticket_type == "purchase":
        _log_admin_action(
            chief_name, "purchase_rejected", ticket_id,
            {"purchase_id": ticket_id, "item_id": row["item_id"], "reason": reason},
        )
    else:
        _log_admin_action(
            chief_name, "donation_rejected", ticket_id,
            {"ticket_id": ticket_id, "reason": reason},
        )
    _invalidate_users_cache()
    return {"ok": True, "ticket_id": ticket_id, "status": "rejected", "resolved_at": now_iso}

# Item catalogue write operations
_json_write_lock = threading.Lock()


def _atomic_write_json(path: str, data) -> None:
    """Write JSON to *path* atomically via write-to-temp-then-rename.

    On Windows ``os.replace`` is atomic within the same volume, so a
    crash mid-write leaves either the old file or the new file intact,
    never a truncated one.
    """
    import tempfile
    dir_name = os.path.dirname(path) or "."
    fd, tmp_path = tempfile.mkstemp(suffix=".tmp", dir=dir_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=4, ensure_ascii=False)
        os.replace(tmp_path, path)
    except BaseException:
        # Clean up the temp file if the rename didn't happen
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise


def _coerce_int(v):
    """Return int if v is non-empty, else None."""
    if v in (None, "", "null"):
        return None
    try:
        return int(v)
    except (TypeError, ValueError):
        return None

def _cap_int(v, cap: int):
    """Coerce to non-negative int, capped at *cap*. Returns None if blank."""
    i = _coerce_int(v)
    return None if i is None else min(abs(i), cap)

def _sanitize_str(v, maxlen: int):
    """Strip and truncate a string field. Returns None if blank."""
    s = (v or "").strip()[:maxlen]
    return s or None

def _sanitize_digits(v, maxlen: int = 20) -> str | None:
    """Return only the digit characters of *v*, capped to *maxlen*."""
    s = ''.join(c for c in str(v or "") if c.isdigit())[:maxlen]
    return s or None

def _coerce_bool(v, default=True) -> bool:
    if isinstance(v, bool):
        return v
    if isinstance(v, str):
        return v.strip().lower() not in ("false", "0", "no", "off")
    if v is None:
        return default
    return bool(v)

def _parse_categories(raw) -> list | None:
    """Parse a category field into a list of trimmed, non-empty strings.

    Accepts a comma/semicolon-separated string or a list.  Returns ``None``
    if there are no categories.
    """
    if isinstance(raw, str):
        parts = [s.strip()[:25] for s in raw.replace(";", ",").split(",") if s.strip()]
    elif isinstance(raw, list):
        parts = [str(s).strip()[:25] for s in raw if str(s).strip()]
    else:
        return None
    # Deduplicate while preserving order
    seen: set = set()
    out: list = []
    for p in parts:
        key = p.lower()
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out or None

def _parse_images(raw) -> list | None:
    """Parse an images field into an ordered list of URL strings, max 3."""
    if isinstance(raw, list):
        parts = [str(s).strip() for s in raw if str(s).strip()][:3]
    elif isinstance(raw, str):
        parts = [s.strip() for s in raw.split(",") if s.strip()][:3]
    else:
        return None
    return parts or None

def _build_item(fields: dict) -> dict:
    """Build a canonical item dict from raw form fields."""
    import re as _re
    item_type = (fields.get("type") or "bin").strip().lower()
    if item_type not in ("bin", "auction", "donate"):
        item_type = "bin"

    # visible_to_ranks
    vtr = fields.get("visible_to_ranks")
    if isinstance(vtr, str):
        vtr = [s.strip().lower() for s in vtr.replace(";", ",").split(",") if s.strip()]
    elif isinstance(vtr, list):
        vtr = [str(s).strip().lower() for s in vtr if str(s).strip()]
    else:
        vtr = None
    if not vtr:
        vtr = None

    # Normalise accepts_dirty_ep / spend_order so they're always consistent
    _raw_accepts_dirty = _coerce_bool(fields.get("accepts_dirty_ep"), True)
    _raw_spend_order   = (fields.get("spend_order") or "clean_first").strip()
    if not _raw_accepts_dirty and _raw_spend_order in ("dirty_only", "dirty_first"):
        _raw_spend_order = "clean_only"   # force-correct
    if _raw_spend_order == "dirty_only" and not _raw_accepts_dirty:
        _raw_accepts_dirty = True          # dirty_only implies accepts dirty
    if _raw_spend_order == "clean_only":
        _raw_accepts_dirty = False         # clean_only implies no dirty EP

    item = {
        "id":                    (fields.get("id") or "").strip(),
        "type":                  item_type,
        "name":                  _sanitize_str(fields.get("name"), 45) or "",
        "description":           _sanitize_str(fields.get("description"), 500),
        "images":                _parse_images(fields.get("images")),
        "category":              _parse_categories(fields.get("category")),
        "accepts_dirty_ep":      _raw_accepts_dirty,
        "spend_order":           _raw_spend_order,
        "price":                 _cap_int(fields.get("price"), 999_999),
        "stock":                 _cap_int(fields.get("stock"), 999_999),
        "cooldown":              (fields.get("cooldown") or "").strip() or None,
        "starting_bid":          _cap_int(fields.get("starting_bid"), 999_999),
        "min_increment":         _cap_int(fields.get("min_increment"), 999_999),
        "duration_hours":        _cap_int(fields.get("duration_hours"), 9_999),
        "duration_type":         (fields.get("duration_type") or "fixed"),
        "anti_snipe_seconds":    _cap_int(fields.get("anti_snipe_seconds"), 9_999),
        "winner_count":          _cap_int(fields.get("winner_count"), 99),
        "max_quantity":          _cap_int(fields.get("max_quantity"), 99),
        "active":                _coerce_bool(fields.get("active"), True),
        "visible_to_ranks":      vtr,
    }

    if item_type == "donate":
        # Donate items have no price, stock, cooldown, or auction fields
        item["price"]              = None
        item["stock"]              = None
        item["cooldown"]           = None
        item["max_quantity"]       = None
        item["duration_type"]      = None
        item["starting_bid"]       = None
        item["min_increment"]      = None
        item["duration_hours"]     = None
        item["anti_snipe_seconds"] = None
        item["winner_count"]       = None
    elif item_type == "bin":
        item["price"]         = item["price"] if item["price"] is not None else 0
        item["duration_type"] = None
        item["starting_bid"]     = None
        item["min_increment"]    = None
        item["duration_hours"]   = None
        item["anti_snipe_seconds"] = None
        item["winner_count"]     = None
    else:
        item["price"]            = None
        item["stock"]            = None
        item["max_quantity"]     = None
        item["cooldown"]         = None
        dur_type = item["duration_type"]
        item["starting_bid"]     = item["starting_bid"] or 1
        item["min_increment"]    = item["min_increment"] or 1
        item["duration_hours"]   = None if dur_type == "eoc_minus_2" else (item["duration_hours"] or 48)
        item["winner_count"]     = item["winner_count"] or 1

    return item

def admin_write_item(item_id: str | None, fields: dict, is_new: bool,
                     actor: str = "unknown") -> dict:
    """Create (is_new=True) or fully update (is_new=False) an item in shop_items.json.

    Returns ``{"ok": True, "item": {...}}`` or ``{"error": "..."}"""
    import re as _re

    if not (fields.get("name") or "").strip():
        return {"error": "Name is required"}

    # Reject fractional prices — price must be a whole number
    _item_type_for_check = (fields.get("type") or "bin").strip().lower()
    if _item_type_for_check == "bin":
        _price_raw = fields.get("price")
        if _price_raw not in (None, "", "null"):
            try:
                _pf = float(str(_price_raw).strip())
                if _pf != int(_pf):
                    return {"error": "Price must be a whole number (no decimal places)"}
            except (TypeError, ValueError):
                pass  # _coerce_int will handle other invalid values

    # Reject inconsistent accepts_dirty_ep / spend_order combinations
    _so_raw     = (fields.get("spend_order") or "").strip()
    _dirty_raw  = fields.get("accepts_dirty_ep")
    _accepts    = _coerce_bool(_dirty_raw, True)
    if not _accepts and _so_raw in ("dirty_only", "dirty_first"):
        return {"error": f"Spend order '{_so_raw}' requires Accepts Dirty EP to be Yes"}
    if _so_raw == "dirty_only" and not _accepts:
        return {"error": "Spend order 'dirty_only' requires Accepts Dirty EP to be Yes"}
    if _so_raw == "clean_only" and _accepts and _dirty_raw not in (None, ""):
        return {"error": "Spend order 'clean_only' requires Accepts Dirty EP to be No"}

    with _json_write_lock:
        from shop.items import _load_json
        items = _load_json()

        if is_new:
            new_id = (fields.get("id") or "").strip().lower()
            if not new_id:
                return {"error": "Item id is required"}
            if not _re.match(r'^[a-z0-9][a-z0-9\-]*$', new_id):
                return {"error": "Item id must be lowercase letters, numbers, and hyphens"}
            if any(i.get("id") == new_id for i in items):
                return {"error": f"An item with id '{new_id}' already exists"}
            fields["id"] = new_id
            item = _build_item(fields)
            items.append(item)
        else:
            idx = next((i for i, it in enumerate(items) if it.get("id") == item_id), None)
            if idx is None:
                return {"error": f"Item '{item_id}' not found in catalogue"}
            old_type     = items[idx].get("type")      # capture before overwrite
            old_cooldown = items[idx].get("cooldown")  # capture before overwrite
            fields["id"] = item_id
            item = _build_item(fields)
            items[idx] = item

        try:
            _atomic_write_json(_SHOP_ITEMS_JSON, items)
        except OSError as exc:
            return {"error": f"Failed to write catalogue: {exc}"}

    _reload_items()
    if not is_new:
        _evict_item_from_carts(item["id"])
        if old_cooldown != item.get("cooldown"):
            _clear_item_cooldowns(item["id"])
        # If type changed away from 'auction', cancel any live auctions for it
        if old_type == "auction" and item.get("type") != "auction":
            if os.path.isfile(_SHOP_DB):
                try:
                    conn = sqlite3.connect(_SHOP_DB, timeout=5)
                    conn.row_factory = sqlite3.Row
                    active = conn.execute(
                        "SELECT auction_id FROM auctions "
                        "WHERE item_id = ? AND status = 'active'",
                        (item["id"],),
                    ).fetchall()
                    conn.close()
                    for row in active:
                        admin_cancel_auction(
                            row["auction_id"],
                            f"system:type-change:{actor}",
                        )
                except sqlite3.Error as exc:
                    print(
                        f"[ADMIN] Failed to cancel auctions after type change "
                        f"for {item['id']}: {exc}",
                        file=sys.stderr,
                    )
    _log_admin_action(
        actor,
        "item_created" if is_new else "item_edited",
        item["id"],
        {"item_id": item["id"], "name": item.get("name"), "type": item.get("type")},
    )
    return {"ok": True, "item": item}

def admin_delete_item(item_id: str, actor: str = "unknown") -> dict:
    """Remove an item from shop_items.json. Returns ``{"ok": True}`` or ``{"error": "..."}"""
    with _json_write_lock:
        from shop.items import _load_json
        items = _load_json()
        new_items = [i for i in items if i.get("id") != item_id]
        if len(new_items) == len(items):
            return {"error": f"Item '{item_id}' not found in catalogue"}
        try:
            _atomic_write_json(_SHOP_ITEMS_JSON, new_items)
        except OSError as exc:
            return {"error": f"Failed to write catalogue: {exc}"}
    _reload_items()

    # Cancel any active auctions for this item
    if os.path.isfile(_SHOP_DB):
        try:
            conn = sqlite3.connect(_SHOP_DB, timeout=5)
            conn.row_factory = sqlite3.Row
            active = conn.execute(
                "SELECT auction_id FROM auctions WHERE item_id = ? AND status = 'active'",
                (item_id,),
            ).fetchall()
            conn.close()
            for row in active:
                admin_cancel_auction(row["auction_id"], "system:item-deleted")
        except sqlite3.Error as exc:
            print(f"[ADMIN] Failed to cancel auctions for deleted item {item_id}: {exc}",
                  file=sys.stderr)

    _evict_item_from_carts(item_id)
    _log_admin_action(actor, "item_deleted", item_id, {"item_id": item_id})
    return {"ok": True}

def admin_reorder_items(ordered_ids: list, actor: str = "unknown") -> dict:
    """Rewrite shop_items.json so items appear in the order given by *ordered_ids*.

    IDs not present in *ordered_ids* are appended at the end (preserving
    their original relative order).  Returns ``{"ok": True}`` or ``{"error": ...}``.
    """
    if not isinstance(ordered_ids, list) or not ordered_ids:
        return {"error": "ordered_ids must be a non-empty list"}

    with _json_write_lock:
        from shop.items import _load_json
        items = _load_json()
        by_id = {it["id"]: it for it in items if "id" in it}

        reordered = []
        seen: set = set()
        for oid in ordered_ids:
            oid = str(oid).strip()
            if oid in by_id and oid not in seen:
                reordered.append(by_id[oid])
                seen.add(oid)
        # append any items not mentioned
        for it in items:
            if it.get("id") not in seen:
                reordered.append(it)

        try:
            _atomic_write_json(_SHOP_ITEMS_JSON, reordered)
        except OSError as exc:
            return {"error": f"Failed to write catalogue: {exc}"}

    _reload_items()
    _log_admin_action(
        actor, "items_reordered", None,
        {"count": len(ordered_ids)},
    )
    return {"ok": True}

def admin_start_auction(item_id: str, starter_name: str) -> dict:
    """Create a new active auction instance for an auction-type item."""
    # Use unfiltered lookup
    all_items = admin_list_all_items_unfiltered()
    item = next((it for it in all_items if it.get("id") == item_id), None)
    if not item:
        return {"error": f"Item '{item_id}' not found in catalogue"}
    if item.get("type") != "auction":
        return {"error": f"Item '{item_id}' is not an auction-type item"}
    if not item.get("active", False):
        return {"error": f"Item '{item_id}' is inactive"}

    now = _now()
    now_iso = now.isoformat()

    # Reject if an active auction already exists for this item
    if os.path.isfile(_SHOP_DB):
        try:
            chk = sqlite3.connect(_SHOP_DB, timeout=5)
            row = chk.execute(
                "SELECT auction_id FROM auctions WHERE item_id = ? AND status = 'active'",
                (item_id,),
            ).fetchone()
            chk.close()
            if row:
                return {"error": f"An active auction for '{item_id}' already exists"}
        except sqlite3.Error as exc:
            return {"error": f"Database error: {exc}"}

    # Compute ends_at
    dur_type = item.get("duration_type") or "fixed"
    if dur_type == "eoc_minus_2":
        from shop.bin import _get_cycle_id, _get_cycle_bounds
        cid = _get_cycle_id(now)
        _, cycle_end = _get_cycle_bounds(cid)
        ends_at = cycle_end - _td(days=2)
        if ends_at <= now:
            _, cycle_end = _get_cycle_bounds(cid + 1)
            ends_at = cycle_end - _td(days=2)
    else:
        ends_at = now + _td(hours=int(item.get("duration_hours") or 48))

    # Hard cap: never exceed cycle_end − 2 days
    from shop.bin import _get_cycle_id, _get_cycle_bounds
    cid = _get_cycle_id(now)
    _, cycle_end = _get_cycle_bounds(cid)
    max_ends = cycle_end - _td(days=2)
    if ends_at > max_ends:
        ends_at = max_ends
    if ends_at <= now:
        return {"error": "Cannot start auction: end of cycle − 2 days has already passed"}

    auction_id = str(_uuid_mod.uuid4())

    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}

    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "INSERT INTO auctions "
            "(auction_id, item_id, status, current_highest_bid, "
            " current_highest_bidder_uuid, ends_at, created_at, extended) "
            "VALUES (?, ?, 'active', 0, NULL, ?, ?, 0)",
            (auction_id, item_id, ends_at.isoformat(), now_iso),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Failed to create auction: {exc}"}

    _log_admin_action(
        starter_name, "auction_started", auction_id,
        {"auction_id": auction_id, "item_id": item_id, "ends_at": ends_at.isoformat()},
    )
    return {
        "ok": True,
        "auction_id": auction_id,
        "item_id": item_id,
        "ends_at": ends_at.isoformat(),
        "started_by": starter_name,
    }

def _ensure_changes_log_indexes(conn: sqlite3.Connection) -> None:
    """Idempotently create performance indexes for admin_get_changes_log."""
    for s in [
        "CREATE INDEX IF NOT EXISTS idx_sal_actor     ON shop_admin_log (actor)",
        "CREATE INDEX IF NOT EXISTS idx_sal_action    ON shop_admin_log (action)",
        "CREATE INDEX IF NOT EXISTS idx_sal_target_id ON shop_admin_log (target_id)",
    ]:
        try:
            conn.execute(s)
        except sqlite3.OperationalError:
            pass

def admin_get_changes_log(
    page: int = 1, per_page: int = 50,
    actor: str | None = None,
    action: str | None = None,
    target_id: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
) -> dict:
    """Paginated view of admin action log.  Uses LIMIT N+1 to avoid
    COUNT(*) scans; returns ``has_more`` instead of a total count."""
    offset = (page - 1) * per_page
    fetch  = per_page + 1
    if not os.path.isfile(_SHOP_DB):
        return {"rows": [], "has_more": False, "page": page, "per_page": per_page}
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_admin_log_table(conn)
        _ensure_changes_log_indexes(conn)
        conn.row_factory = sqlite3.Row

        w = ["1=1"]
        p: list = []
        if actor:
            w.append("actor LIKE ?")
            p.append(f"%{actor}%")
        if action:
            w.append("action = ?")
            p.append(action)
        if target_id:
            w.append("target_id = ?")
            p.append(target_id)
        if date_from:
            w.append("timestamp >= ?")
            p.append(date_from)
        if date_to:
            w.append("timestamp <= ?")
            p.append(date_to)

        where = " AND ".join(w)
        raw = conn.execute(
            f"SELECT id, timestamp, actor, action, target_id, details "
            f"FROM shop_admin_log WHERE {where} "
            f"ORDER BY timestamp DESC LIMIT ? OFFSET ?",
            p + [fetch, offset],
        ).fetchall()
        conn.close()

        has_more = len(raw) > per_page
        result = []
        for r in raw[:per_page]:
            details = None
            if r["details"]:
                try:
                    details = json.loads(r["details"])
                except (json.JSONDecodeError, TypeError):
                    details = {}
            result.append({
                "id":        r["id"],
                "timestamp": r["timestamp"],
                "actor":     r["actor"],
                "action":    r["action"],
                "target_id": r["target_id"],
                "details":   details,
            })
        return {"rows": result, "has_more": has_more, "page": page, "per_page": per_page}
    except sqlite3.Error as exc:
        return {"rows": [], "has_more": False, "page": page, "per_page": per_page,
                "error": str(exc)}

def admin_get_users() -> list:
    """Return aggregated per-user shop activity, served from a 60-second cache."""
    now = _time.monotonic()
    with _users_cache_lock:
        if _users_cache["data"] is not None and (now - _users_cache["ts"]) < _USERS_CACHE_TTL:
            return _users_cache["data"]
    result = _admin_get_users_uncached()
    with _users_cache_lock:
        _users_cache["data"] = result
        _users_cache["ts"]   = _time.monotonic()
    return result


def _admin_get_users_uncached() -> list:
    """Heavy computation: aggregate per-user shop activity from raw DB rows."""
    if not os.path.isfile(_SHOP_DB):
        return []
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.row_factory = sqlite3.Row

        # Aggregate purchases per user
        p_rows = conn.execute("""
            SELECT uuid, username,
                   MIN(purchased_at) AS first_seen,
                   MAX(purchased_at) AS last_p,
                   SUM(ep_spent) AS ep_total,
                   SUM(clean_ep_spent) AS ep_clean,
                   SUM(dirty_ep_spent) AS ep_dirty,
                   COUNT(*) AS orders,
                   SUM(CASE WHEN status='fulfilled' THEN 1 ELSE 0 END) AS fulfilled,
                   SUM(CASE WHEN status='rejected'  THEN 1 ELSE 0 END) AS rejected,
                   SUM(CASE WHEN status='pending'   THEN 1 ELSE 0 END) AS pending_count
            FROM bin_purchases GROUP BY uuid
        """).fetchall()

        # Aggregate bids per user
        b_rows = conn.execute("""
            SELECT b.uuid, b.username,
                   MIN(b.placed_at) AS first_seen,
                   MAX(b.placed_at) AS last_b,
                   COUNT(*) AS total_bids,
                   SUM(CASE WHEN a.status='active' THEN 1 ELSE 0 END) AS active_bids,
                   COUNT(DISTINCT CASE WHEN b.is_winning=1 AND a.status='closed'
                         THEN b.auction_id END) AS winning_bids
            FROM bids b LEFT JOIN auctions a ON a.auction_id = b.auction_id
            GROUP BY b.uuid
        """).fetchall()

        # Aggregate donations per user
        d_rows = conn.execute("""
            SELECT uuid, username,
                   MIN(submitted_at) AS first_seen,
                   MAX(submitted_at) AS last_d,
                   COUNT(*) AS donations
            FROM donation_tickets GROUP BY uuid
        """).fetchall()

        # Recent activity — last 5 per user, all types combined
        act_rows = conn.execute("""
            SELECT uuid, 'purchase' AS type, item_id AS item,
                   ep_spent AS ep, status, purchased_at AS date
            FROM bin_purchases
            UNION ALL
            SELECT b.uuid, 'bid', COALESCE(a.item_id,'') AS item,
                   b.amount AS ep,
                   CASE WHEN a.status='active' THEN 'active'
                        WHEN b.is_winning=1 AND a.status='closed' THEN 'won'
                        ELSE 'outbid' END AS status,
                   b.placed_at AS date
            FROM bids b LEFT JOIN auctions a ON a.auction_id = b.auction_id
            UNION ALL
            SELECT uuid, 'donation', '' AS item,
                   dirty_ep_to_grant AS ep, status, submitted_at AS date
            FROM donation_tickets
            ORDER BY date DESC
        """).fetchall()

        # Cart contents per user
        cart_rows = conn.execute(
            "SELECT mc_uuid, item_id, quantity FROM cart_items"
        ).fetchall()

        # Reserved EP split by type (winning bids on active auctions)
        res_ep_rows = conn.execute("""
            SELECT b.uuid,
                   COALESCE(SUM(b.clean_ep_used), 0) AS reserved_clean,
                   COALESCE(SUM(b.dirty_ep_used), 0) AS reserved_dirty
            FROM bids b
            JOIN auctions a ON a.auction_id = b.auction_id
            WHERE a.status = 'active' AND b.is_winning = 1
            GROUP BY b.uuid
        """).fetchall()

        # Spent EP from fulfilled/pending purchases
        spent_ep_rows = conn.execute("""
            SELECT uuid,
                   COALESCE(SUM(clean_ep_spent), 0) AS spent_clean,
                   COALESCE(SUM(dirty_ep_spent), 0) AS spent_dirty
            FROM bin_purchases
            WHERE status IN ('pending', 'fulfilled')
            GROUP BY uuid
        """).fetchall()

        # Confirmed donation dirty EP grants
        donated_rows_ep = conn.execute("""
            SELECT uuid, COALESCE(SUM(dirty_ep_to_grant), 0) AS donated_dirty
            FROM donation_tickets WHERE status = 'confirmed'
            GROUP BY uuid
        """).fetchall()

        conn.close()
    except sqlite3.Error:
        return []

    # Build reverse UUID -> Discord ID + username maps from username_matches.json
    try:
        matches = _cfg_load_json(_USERNAME_MATCHES_JSON) or {}
        uuid_to_discord: dict  = {}
        uuid_to_username: dict = {}
        for did, entry in matches.items():
            if isinstance(entry, dict):
                u = entry.get("uuid")
                if u:
                    uuid_to_discord[u]  = did
                    uname = entry.get("username")
                    if uname:
                        uuid_to_username[u] = uname
    except Exception:
        uuid_to_discord  = {}
        uuid_to_username = {}

    # Build balance lookup tables
    res_ep_map: dict  = {r["uuid"]: {"rc": r["reserved_clean"] or 0,
                                     "rd": r["reserved_dirty"]  or 0}
                         for r in res_ep_rows}
    spent_map: dict   = {r["uuid"]: {"sc": r["spent_clean"]  or 0,
                                     "sd": r["spent_dirty"]   or 0}
                         for r in spent_ep_rows}
    donated_map: dict = {r["uuid"]: r["donated_dirty"] or 0 for r in donated_rows_ep}

    # Raw EP totals from _POINTS_DB
    raw_ep_by_uuid: dict = {}
    if os.path.isfile(_POINTS_DB):
        try:
            pts = sqlite3.connect(_POINTS_DB, timeout=5)
            pts.row_factory = sqlite3.Row
            for r in pts.execute("""
                SELECT uuid,
                       COALESCE(SUM(clean_ep), 0) AS raw_clean,
                       COALESCE(SUM(dirty_ep), 0) AS raw_dirty
                FROM esi_points GROUP BY uuid
            """).fetchall():
                raw_ep_by_uuid[r["uuid"]] = {
                    "rc": r["raw_clean"] or 0,
                    "rd": r["raw_dirty"] or 0,
                }
            pts.close()
        except sqlite3.Error:
            pass

    def _make_balance(uuid: str) -> dict:
        raw     = raw_ep_by_uuid.get(uuid, {"rc": 0, "rd": 0})
        spent   = spent_map.get(uuid, {"sc": 0, "sd": 0})
        donated = donated_map.get(uuid, 0)
        res     = res_ep_map.get(uuid, {"rc": 0, "rd": 0})
        ct = max(0, raw["rc"] - spent["sc"])
        dt = max(0, raw["rd"] - spent["sd"] + donated)
        cr = min(res["rc"], ct)
        dr = min(res["rd"], dt)
        return {
            "clean_total":    ct,
            "clean_reserved": cr,
            "clean_free":     ct - cr,
            "dirty_total":    dt,
            "dirty_reserved": dr,
            "dirty_free":     dt - dr,
            "total":          ct + dt,
            "free":           (ct - cr) + (dt - dr),
        }

    # Enrich cart with item catalogue data
    try:
        from shop.items import _load_json as _shop_items_json, _load_overrides, _merge as _merge_items
        _items_map = {it["id"]: it for it in _merge_items(_shop_items_json(), _load_overrides()) if "id" in it}
    except Exception:
        _items_map = {}

    def _ep_type_label(item: dict) -> str:
        if not item.get("accepts_dirty_ep", True): return "clean"
        so = item.get("spend_order", "clean_first")
        if so == "dirty_only": return "dirty"
        if so == "clean_only": return "clean"
        return "mixed"

    cart_by_uuid: dict = {}
    for r in cart_rows:
        it = _items_map.get(r["item_id"], {})
        cart_by_uuid.setdefault(r["mc_uuid"], []).append({
            "item_id":    r["item_id"],
            "item_name":  it.get("name", r["item_id"]),
            "type":       it.get("type", "bin"),
            "quantity":   r["quantity"] or 1,
            "price_each": it.get("price") or 0,
            "ep_type":    _ep_type_label(it),
        })

    # Merge aggregates into per-uuid user dicts
    users: dict = {}

    def _get(uuid, username):
        if uuid not in users:
            users[uuid] = {
                "uuid":        uuid,
                "username":    username,
                "discord_id":  uuid_to_discord.get(uuid),
                "ep_total":    0, "ep_clean": 0, "ep_dirty": 0,
                "balance":     _make_balance(uuid),
                "orders":      0, "fulfilled": 0, "rejected": 0, "pending_count": 0,
                "bids":        0, "active_bids": 0, "winning_bids": 0,
                "donations":   0,
                "first_seen":  None,
                "last_activity": None,
                "cart":        cart_by_uuid.get(uuid, []),
            }
        return users[uuid]

    def _mindate(a, b):
        if a is None: return b
        if b is None: return a
        return a if a < b else b

    def _maxdate(a, b):
        if a is None: return b
        if b is None: return a
        return a if a > b else b

    for r in p_rows:
        u = _get(r["uuid"], r["username"])
        u["ep_total"]      += r["ep_total"]      or 0
        u["ep_clean"]      += r["ep_clean"]      or 0
        u["ep_dirty"]      += r["ep_dirty"]      or 0
        u["orders"]        += r["orders"]        or 0
        u["fulfilled"]     += r["fulfilled"]     or 0
        u["rejected"]      += r["rejected"]      or 0
        u["pending_count"] += r["pending_count"] or 0
        u["first_seen"]    = _mindate(u["first_seen"],   r["first_seen"])
        u["last_activity"] = _maxdate(u["last_activity"], r["last_p"])

    for r in b_rows:
        u = _get(r["uuid"], r["username"])
        u["bids"]         += r["total_bids"]   or 0
        u["active_bids"]  += r["active_bids"]  or 0
        u["winning_bids"] += r["winning_bids"] or 0
        u["first_seen"]    = _mindate(u["first_seen"],   r["first_seen"])
        u["last_activity"] = _maxdate(u["last_activity"], r["last_b"])

    for r in d_rows:
        u = _get(r["uuid"], r["username"])
        u["donations"]    += r["donations"] or 0
        u["first_seen"]    = _mindate(u["first_seen"],   r["first_seen"])
        u["last_activity"] = _maxdate(u["last_activity"], r["last_d"])

    # Surface cart-only users (have a saved cart but no purchases/bids/donations yet)
    for mc_uuid in cart_by_uuid:
        if mc_uuid not in users:
            username = uuid_to_username.get(mc_uuid, mc_uuid[:8] + "\u2026")
            _get(mc_uuid, username)

    # Attach recent activity
    recent_by_uuid: dict = {}
    for r in act_rows:
        uid = r["uuid"]
        lst = recent_by_uuid.setdefault(uid, [])
        if len(lst) < 5:
            lst.append({
                "type":   r["type"],
                "item":   r["item"]   or "",
                "ep":     r["ep"]     or 0,
                "status": r["status"] or "",
                "date":   r["date"]   or "",
            })

    for u in users.values():
        u["recent"] = recent_by_uuid.get(u["uuid"], [])

    return list(users.values())


def admin_get_raw_config() -> list | dict:
    """Return the raw shop_items.json content."""
    if not os.path.isfile(_SHOP_ITEMS_JSON):
        return []
    try:
        with open(_SHOP_ITEMS_JSON, encoding="utf-8") as fh:
            return json.load(fh)
    except (json.JSONDecodeError, OSError):
        return []
