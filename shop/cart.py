import os
import sqlite3
from datetime import datetime as _dt, timezone as _tz

from config import _SHOP_DB
from shop.ep_balance import resolve_uuid_for_user

_MAX_CART_ITEMS = 20


def _ensure_cart_table(conn: sqlite3.Connection) -> None:
    """Create the cart_items table if it doesn't exist (idempotent)."""
    conn.execute("""
        CREATE TABLE IF NOT EXISTS cart_items (
            mc_uuid    TEXT NOT NULL,
            item_id    TEXT NOT NULL,
            quantity   INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT NOT NULL,
            PRIMARY KEY (mc_uuid, item_id)
        )
    """)
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cart_uuid ON cart_items (mc_uuid)"
    )

def get_cart(discord_id: str) -> list[dict]:
    """Return the persisted cart for a user as a list of {item_id, quantity}.

    Returns an empty list if the user has no linked account, no DB, or
    any read error occurs.
    """
    mc_uuid, _ = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        return []

    if not os.path.isfile(_SHOP_DB):
        return []

    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        _ensure_cart_table(conn)
        conn.commit()
        rows = conn.execute(
            "SELECT item_id, quantity FROM cart_items WHERE mc_uuid = ?",
            (mc_uuid,),
        ).fetchall()
        conn.close()
        return [{"item_id": r[0], "quantity": r[1]} for r in rows]
    except sqlite3.Error:
        return []

def save_cart(discord_id: str, items: list[dict]) -> bool:
    """Atomically replace the user's persisted cart.

    *items* is a list of ``{item_id, quantity}`` dicts.
    Passing an empty list clears the cart.
    Returns True on success, False on any error.
    """
    mc_uuid, _ = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        return False

    if not os.path.isfile(_SHOP_DB):
        # If the DB doesn't exist yet, there's nothing to persist.
        return False

    # Sanitise and cap the list before touching the DB.
    clean: list[tuple[str, int]] = []
    for entry in (items or []):
        item_id = (entry.get("item_id") or "").strip()
        try:
            qty = int(entry.get("quantity", 1))
        except (TypeError, ValueError):
            continue
        if item_id and qty >= 1:
            clean.append((item_id, qty))
    clean = clean[:_MAX_CART_ITEMS]

    now_iso = _dt.now(_tz.utc).isoformat()
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        _ensure_cart_table(conn)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("BEGIN IMMEDIATE")
        conn.execute("DELETE FROM cart_items WHERE mc_uuid = ?", (mc_uuid,))
        if clean:
            conn.executemany(
                "INSERT INTO cart_items (mc_uuid, item_id, quantity, updated_at)"
                " VALUES (?, ?, ?, ?)",
                [(mc_uuid, iid, qty, now_iso) for iid, qty in clean],
            )
        conn.commit()
        conn.close()
        return True
    except sqlite3.Error:
        return False
