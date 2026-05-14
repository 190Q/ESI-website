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
                "SELECT purchase_id, item_id, ep_spent, clean_ep_spent, "
                "       dirty_ep_spent, status, fulfillment_note, chief_note, "
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
