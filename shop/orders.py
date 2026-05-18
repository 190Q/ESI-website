import os
import sqlite3
import sys

from config import _SHOP_DB
from shop.ep_balance import resolve_uuid_for_user


def get_order_history(discord_id: str) -> dict:
    """Return the logged-in user's full order history (newest first)."""
    mc_uuid, mc_username = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        return {"linked": False, "purchases": [], "bids": [], "donations": []}

    purchases = []
    bids = []
    donations = []

    if os.path.isfile(_SHOP_DB):
        try:
            conn = sqlite3.connect(_SHOP_DB, timeout=5)
            conn.row_factory = sqlite3.Row

            # Bin purchases
            rows = conn.execute(
                "SELECT purchase_id, item_id, quantity, ep_spent, "
                "       clean_ep_spent, dirty_ep_spent, status, "
                "       fulfillment_note, chief_note, "
                "       purchased_at, resolved_at "
                "FROM bin_purchases WHERE uuid = ? "
                "ORDER BY purchased_at DESC",
                (mc_uuid,),
            ).fetchall()
            purchases = [dict(r) for r in rows]

            # Auction bids
            rows = conn.execute(
                "SELECT b.bid_id, b.auction_id, b.amount, b.clean_ep_used, "
                "       b.dirty_ep_used, b.is_winning, b.placed_at, "
                "       a.item_id, a.status AS auction_status "
                "FROM bids b "
                "LEFT JOIN auctions a ON a.auction_id = b.auction_id "
                "WHERE b.uuid = ? "
                "ORDER BY b.placed_at DESC",
                (mc_uuid,),
            ).fetchall()
            bids = [dict(r) for r in rows]

            # Donations
            rows = conn.execute(
                "SELECT ticket_id, le_amount, dirty_ep_to_grant, status, "
                "       chief_note, submitted_at, resolved_at "
                "FROM donation_tickets WHERE uuid = ? "
                "ORDER BY submitted_at DESC",
                (mc_uuid,),
            ).fetchall()
            donations = [dict(r) for r in rows]

            conn.close()
        except sqlite3.Error as exc:
            print(f"[ORDERS] History query failed: {exc}", file=sys.stderr)

    return {
        "linked":    True,
        "uuid":      mc_uuid,
        "username":  mc_username,
        "purchases": purchases,
        "bids":      bids,
        "donations": donations,
    }

def request_refund(discord_id: str, purchase_id: str, reason: str) -> dict:
    """User requests a refund for a fulfilled purchase. Sets status to refund_pending."""
    mc_uuid, _ = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        return {"error": "No linked Minecraft account"}
    if not purchase_id:
        return {"error": "purchase_id is required"}
    reason = (reason or "").strip()[:100]
    if not reason:
        return {"error": "Reason is required"}
    if not os.path.isfile(_SHOP_DB):
        return {"error": "Shop database unavailable"}
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        # Verify ownership and status
        row = conn.execute(
            "SELECT status, uuid FROM bin_purchases WHERE purchase_id = ?",
            (purchase_id,),
        ).fetchone()
        if not row:
            conn.close()
            return {"error": "Purchase not found"}
        if row["uuid"] != mc_uuid:
            conn.close()
            return {"error": "This purchase does not belong to you"}
        if row["status"] != "fulfilled":
            conn.close()
            return {"error": "Only fulfilled purchases can be refunded (current: " + row["status"] + ")"}
        # Check no existing pending refund for this user
        existing = conn.execute(
            "SELECT 1 FROM bin_purchases WHERE uuid = ? AND status = 'refund_pending'",
            (mc_uuid,),
        ).fetchone()
        if existing:
            conn.close()
            return {"error": "You already have a pending refund request"}
        conn.execute(
            "UPDATE bin_purchases SET status = 'refund_pending', chief_note = ? WHERE purchase_id = ?",
            (reason, purchase_id),
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        return {"error": f"Database error: {exc}"}
    return {"ok": True, "purchase_id": purchase_id}
