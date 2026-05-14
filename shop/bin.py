import os
import sqlite3
import sys
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz, timedelta as _td

from config import _SHOP_DB, _CLIENT_CONFIG
from shop.ep_balance import resolve_uuid_for_user, fetch_ep_balance, resolve_spend, InsufficientFunds
from shop.items import get_items, get_item, parse_duration, reload as _reload_items


_CYCLE_ANCHOR = _dt(2026, 4, 21, 16, 0, 0, tzinfo=_tz.utc)
_CYCLE_DURATION = _td(weeks=2)


def _get_cycle_id(dt=None):
    if dt is None:
        dt = _dt.now(_tz.utc)
    return int((dt - _CYCLE_ANCHOR) / _CYCLE_DURATION) + 1

def _get_cycle_bounds(cycle_id):
    start = _CYCLE_ANCHOR + _CYCLE_DURATION * (cycle_id - 1)
    return start, start + _CYCLE_DURATION

# Build a role-ID → rank-name lookup from the client config at import time.
_RANK_ROLE_MAP: dict[str, str] = {
    r["id"]: r["name"].lower()
    for r in _CLIENT_CONFIG["rankRoles"]
}

def build_user_tags(user_roles: list) -> set[str]:
    """Derive the lowercased guild-rank tag set from a user's Discord role IDs."""
    role_set = set(str(r) for r in (user_roles or []))
    tags: set[str] = set()
    for rid, name in _RANK_ROLE_MAP.items():
        if rid in role_set:
            tags.add(name)
    return tags

def is_guild_member(user_roles: list) -> bool:
    """Return True if the user holds at least one guild rank role."""
    return bool(build_user_tags(user_roles))

def _cooldown_expires_at(purchased_at_iso: str, duration) -> _dt | None:
    """Compute the expiration datetime for a cooldown.

    *duration* is the raw value from the item's ``cooldown`` field.
    Returns ``None`` if no cooldown applies, or a tz-aware UTC datetime.
    """
    parsed = parse_duration(duration)
    if parsed is None:
        return None

    purchased_at = _dt.fromisoformat(purchased_at_iso)
    if purchased_at.tzinfo is None:
        purchased_at = purchased_at.replace(tzinfo=_tz.utc)

    if parsed["type"] == "days":
        return purchased_at + _td(days=parsed["value"])

    if parsed["type"] == "end_of_cycle":
        cycle_at_purchase = _get_cycle_id(purchased_at)
        _, cycle_end = _get_cycle_bounds(cycle_at_purchase)
        return cycle_end

    if parsed["type"] == "cycles":
        cycle_at_purchase = _get_cycle_id(purchased_at)
        target_cycle = cycle_at_purchase + parsed["value"]
        target_start, _ = _get_cycle_bounds(target_cycle)
        return target_start

    return None

def check_cooldown(uuid: str, item: dict) -> dict:
    """Check whether *uuid* is on cooldown for *item*.

    Returns ``{"on_cooldown": bool, "cooldown_ends_at": str|None}``.
    """
    duration = item.get("cooldown")
    if parse_duration(duration) is None:
        return {"on_cooldown": False, "cooldown_ends_at": None}

    if not os.path.isfile(_SHOP_DB):
        return {"on_cooldown": False, "cooldown_ends_at": None}

    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        row = conn.execute(
            "SELECT last_purchased_at FROM cooldowns WHERE uuid = ? AND item_id = ?",
            (uuid, item["id"]),
        ).fetchone()
        conn.close()
    except sqlite3.Error:
        return {"on_cooldown": False, "cooldown_ends_at": None}

    if not row:
        return {"on_cooldown": False, "cooldown_ends_at": None}

    expires = _cooldown_expires_at(row[0], duration)
    if expires is None:
        return {"on_cooldown": False, "cooldown_ends_at": None}

    now = _dt.now(_tz.utc)
    if now >= expires:
        return {"on_cooldown": False, "cooldown_ends_at": None}

    return {"on_cooldown": True, "cooldown_ends_at": expires.isoformat()}

def list_bin_items(user_roles: list, discord_id: str) -> dict:
    """Return the full bin-item listing for a logged-in user.

    Includes per-item cooldown status and the user's EP balance.
    """
    tags = build_user_tags(user_roles)
    all_items = get_items(tags=tags)
    bin_items = [i for i in all_items if i.get("type") in ("bin", "donate")]

    mc_uuid, mc_username = resolve_uuid_for_user(discord_id)
    balance = fetch_ep_balance(mc_uuid) if mc_uuid else {
        "spendable_clean": 0, "spendable_dirty": 0,
        "clean_ep": 0, "dirty_ep": 0, "total_ep": 0,
        "reserved_clean": 0, "reserved_dirty": 0,
    }

    enriched = []
    for item in bin_items:
        cd = check_cooldown(mc_uuid, item) if mc_uuid else {
            "on_cooldown": False, "cooldown_ends_at": None,
        }
        enriched.append({**item, **cd})

    # Full item order (all types) so the frontend can interleave auctions
    item_order = [i["id"] for i in all_items if "id" in i]

    current_cycle = _get_cycle_id()
    _, cycle_end = _get_cycle_bounds(current_cycle)

    return {
        "items": enriched,
        "item_order": item_order,
        "balance": balance,
        "uuid": mc_uuid,
        "username": mc_username,
        "linked": mc_uuid is not None,
        "current_cycle_id": current_cycle,
        "cycle_ends_at": cycle_end.isoformat(),
    }

def _ensure_quantity_column(conn: sqlite3.Connection) -> None:
    """Add quantity column to bin_purchases if it doesn't exist (idempotent)."""
    try:
        conn.execute("ALTER TABLE bin_purchases ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1")
    except sqlite3.OperationalError:
        pass  # already exists


class PurchaseError(Exception):
    """Non-fatal purchase rejection with an HTTP status code."""
    def __init__(self, message: str, status: int = 400):
        self.message = message
        self.status = status
        super().__init__(message)

def execute_cart_checkout(
    discord_id: str,
    user_roles: list,
    cart_items: list,  # [{item_id, quantity, acknowledged_clean, acknowledged_dirty}]
) -> list:
    """Validate and atomically process a multi-item cart checkout.

    Returns a list of per-line result dicts on success.
    Raises ``PurchaseError`` or ``InsufficientFunds`` on any failure.
    """
    now = _dt.now(_tz.utc)
    now_iso = now.isoformat()

    # resolve user
    mc_uuid, mc_username = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        raise PurchaseError("No linked Minecraft account", 400)

    if not cart_items:
        raise PurchaseError("Cart is empty", 400)

    # check for duplicate item_ids
    seen_ids: set = set()
    for entry in cart_items:
        iid = entry.get("item_id", "")
        if iid in seen_ids:
            raise PurchaseError(f"Duplicate item_id in cart: {iid}", 400)
        seen_ids.add(iid)

    tags = build_user_tags(user_roles)

    # validate every item and build resolved line list
    lines = []  # [{item, qty, price_per_unit, spend_order, ack_clean, ack_dirty}]
    for entry in cart_items:
        item_id = (entry.get("item_id") or "").strip()
        qty = int(entry.get("quantity", 1))
        ack = entry.get("acknowledged_spend") or {}
        ack_clean = int(ack.get("clean_ep", 0)) if isinstance(ack, dict) else 0
        ack_dirty = int(ack.get("dirty_ep", 0)) if isinstance(ack, dict) else 0

        if qty < 1:
            raise PurchaseError(f"Invalid quantity for {item_id!r}: must be >= 1", 400)

        item = get_item(item_id, tags=tags)
        if item is None:
            raise PurchaseError(f"Item {item_id!r} not found or not visible to your rank", 404)
        if item.get("type") != "bin":
            raise PurchaseError(f"Item {item_id!r} is not a bin item", 400)
        if not item.get("active", False):
            raise PurchaseError(f"Item {item_id!r} is currently not available", 400)

        price = item.get("price")
        if not isinstance(price, (int, float)) or price <= 0:
            raise PurchaseError(f"Item {item_id!r} has no valid price", 400)
        price = int(price)

        # multi-quantity check
        if qty > 1:
            if not item.get("allow_multi_quantity", False):
                raise PurchaseError(
                    f"Item {item_id!r} does not support multi-quantity purchase", 400
                )
            max_q = item.get("max_quantity") or 1
            if qty > max_q:
                raise PurchaseError(
                    f"Item {item_id!r}: quantity {qty} exceeds max_quantity {max_q}", 400
                )

        # cooldown check; items with cooldowns cannot be in a multi-qty cart
        cd = check_cooldown(mc_uuid, item)
        if cd["on_cooldown"]:
            raise PurchaseError(
                f"Item {item_id!r}: you are on cooldown until {cd['cooldown_ends_at']}",
                409,
            )

        spend_order = item.get("spend_order", "clean_first")
        if not item.get("accepts_dirty_ep", False) and spend_order not in ("clean_only", "clean_first"):
            spend_order = "clean_only"

        lines.append({
            "item": item,
            "item_id": item_id,
            "qty": qty,
            "price_per_unit": price,
            "line_total": price * qty,
            "spend_order": spend_order,
            "ack_clean": ack_clean,
            "ack_dirty": ack_dirty,
        })

    # compute global EP total and resolve spend
    _order_priority = ["clean_only", "dirty_only", "clean_first", "dirty_first"]
    global_order = sorted(
        {ln["spend_order"] for ln in lines},
        key=lambda o: _order_priority.index(o) if o in _order_priority else 99,
    )[0]

    cart_total = sum(ln["line_total"] for ln in lines)
    split = resolve_spend(mc_uuid, cart_total, global_order)
    server_clean = split["clean_to_spend"]
    server_dirty = split["dirty_to_spend"]

    # anti-tamper: verify summed acknowledged spend
    total_ack_clean = sum(ln["ack_clean"] for ln in lines)
    total_ack_dirty = sum(ln["ack_dirty"] for ln in lines)
    if (total_ack_clean or total_ack_dirty) and (
        total_ack_clean != server_clean or total_ack_dirty != server_dirty
    ):
        raise PurchaseError(
            f"Spend mismatch: server computed {server_clean} clean + {server_dirty} dirty, "
            f"but client sent {total_ack_clean} clean + {total_ack_dirty} dirty",
            409,
        )

    if not os.path.isfile(_SHOP_DB):
        raise PurchaseError("Shop database unavailable", 503)

    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    results = []
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _ensure_quantity_column(conn)
        conn.execute("BEGIN IMMEDIATE")

        # stock check for all items (atomic, inside the write lock)
        live_stocks: dict = {}  # item_id → live_stock (None if unlimited)
        for ln in lines:
            item_id = ln["item_id"]
            json_stock = ln["item"].get("stock")
            if json_stock is not None:
                row = conn.execute(
                    "SELECT stock FROM item_overrides WHERE item_id = ?", (item_id,),
                ).fetchone()
                live_stock = row[0] if (row and row[0] is not None) else json_stock
                if live_stock < ln["qty"]:
                    conn.rollback()
                    avail = max(0, live_stock)
                    raise PurchaseError(
                        f"Item {item_id!r} has insufficient stock: need {ln['qty']}, available {avail}",
                        409,
                    )
                live_stocks[item_id] = live_stock
            else:
                live_stocks[item_id] = None

        # allocate EP across lines proportionally for per-row accounting
        remaining_clean = server_clean
        remaining_dirty = server_dirty

        for i, ln in enumerate(lines):
            is_last = (i == len(lines) - 1)
            if is_last:
                line_clean = remaining_clean
                line_dirty = remaining_dirty
            else:
                frac = ln["line_total"] / cart_total if cart_total else 0
                line_clean = round(server_clean * frac)
                line_dirty = round(server_dirty * frac)
                remaining_clean -= line_clean
                remaining_dirty -= line_dirty
            ln["line_clean"] = line_clean
            ln["line_dirty"] = line_dirty

        # insert purchase rows + decrement stock + record cooldowns
        for ln in lines:
            item = ln["item"]
            item_id = ln["item_id"]
            qty = ln["qty"]
            status = "pending"
            purchase_id = str(_uuid_mod.uuid4())

            # stock decrement
            live_stock = live_stocks[item_id]
            if live_stock is not None:
                new_stock = live_stock - qty
                conn.execute(
                    "INSERT INTO item_overrides (item_id, stock, updated_by, updated_at) "
                    "VALUES (?, ?, 'system:cart', ?) "
                    "ON CONFLICT(item_id) DO UPDATE SET "
                    "  stock = ?, updated_by = 'system:cart', updated_at = ?",
                    (item_id, new_stock, now_iso, new_stock, now_iso),
                )

            # insert purchase row
            conn.execute(
                "INSERT INTO bin_purchases "
                "(purchase_id, item_id, uuid, username, ep_spent, clean_ep_spent, "
                " dirty_ep_spent, status, fulfillment_note, purchased_at, resolved_at, quantity) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    purchase_id, item_id, mc_uuid, mc_username or "",
                    ln["line_total"], ln["line_clean"], ln["line_dirty"],
                    status, item.get("fulfillment_note"),
                    now_iso, None,
                    qty,
                ),
            )

            # cooldown (only applicable when qty == 1 — enforced earlier by allow_multi_quantity)
            if parse_duration(item.get("cooldown")) is not None:
                conn.execute(
                    "INSERT INTO cooldowns (uuid, item_id, last_purchased_at) "
                    "VALUES (?, ?, ?) "
                    "ON CONFLICT(uuid, item_id) DO UPDATE SET last_purchased_at = ?",
                    (mc_uuid, item_id, now_iso, now_iso),
                )

            results.append({
                "purchase_id":      purchase_id,
                "item_id":          item_id,
                "item_name":        item.get("name", ""),
                "quantity":         qty,
                "ep_spent":         ln["line_total"],
                "clean_ep_spent":   ln["line_clean"],
                "dirty_ep_spent":   ln["line_dirty"],
                "status":           status,
                "fulfillment_note": item.get("fulfillment_note"),
                "purchased_at":     now_iso,
            })

        conn.commit()
    except PurchaseError:
        raise
    except InsufficientFunds:
        raise
    except Exception as exc:
        conn.rollback()
        print(f"[SHOP] Cart transaction failed: {exc}", file=sys.stderr)
        raise PurchaseError("Internal error processing cart", 500)
    finally:
        conn.close()

    _reload_items()
    return results


def execute_bin_purchase(
    discord_id: str,
    user_roles: list,
    item_id: str,
    acknowledged_clean: int = 0,
    acknowledged_dirty: int = 0,
) -> dict:
    """Validate and execute a bin purchase. Returns the purchase record.

    All validation (visibility, stock, cooldown, funds) is done server-side.
    If *acknowledged_clean* / *acknowledged_dirty* are provided, they are
    verified against the server-computed split as an anti-tamper check.
    Raises ``PurchaseError`` on any validation failure.
    Raises ``InsufficientFunds`` if the user can't afford it.
    """
    now = _dt.now(_tz.utc)
    now_iso = now.isoformat()

    # resolve user
    mc_uuid, mc_username = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        raise PurchaseError("No linked Minecraft account", 400)

    # resolve item (with visibility check)
    tags = build_user_tags(user_roles)
    item = get_item(item_id, tags=tags)
    if item is None:
        raise PurchaseError("Item not found or not visible to your rank", 404)
    if item.get("type") != "bin":
        raise PurchaseError("Item is not a bin item", 400)
    if not item.get("active", False):
        raise PurchaseError("Item is currently not available", 400)

    price = item.get("price")
    if not isinstance(price, (int, float)) or price <= 0:
        raise PurchaseError("Item has no valid price", 400)
    price = int(price)

    # cooldown check
    cd = check_cooldown(mc_uuid, item)
    if cd["on_cooldown"]:
        raise PurchaseError(
            f"You are on cooldown for this item until {cd['cooldown_ends_at']}",
            409,
        )

    # dirty EP eligibility
    spend_order = item.get("spend_order", "clean_first")
    if not item.get("accepts_dirty_ep", False) and spend_order not in ("clean_only", "clean_first"):
        spend_order = "clean_only"

    # compute spend split (server is the sole authority)
    split = resolve_spend(mc_uuid, price, spend_order)
    server_clean = split["clean_to_spend"]
    server_dirty = split["dirty_to_spend"]

    # anti-tamper: if client sent an acknowledged split, verify it matches
    if (acknowledged_clean or acknowledged_dirty) and (
        acknowledged_clean != server_clean or acknowledged_dirty != server_dirty
    ):
        raise PurchaseError(
            f"Spend mismatch: server computed {server_clean} clean + {server_dirty} dirty, "
            f"but client sent {acknowledged_clean} clean + {acknowledged_dirty} dirty",
            409,
        )

    # stock check + decrement (atomic in a single transaction)
    purchase_id = str(_uuid_mod.uuid4())
    status = "pending"

    if not os.path.isfile(_SHOP_DB):
        raise PurchaseError("Shop database unavailable", 503)

    conn = sqlite3.connect(_SHOP_DB, timeout=10)
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        # BEGIN IMMEDIATE gives us a write-lock immediately
        conn.execute("BEGIN IMMEDIATE")

        # Check limited stock
        json_stock = item.get("stock")  # from merged item (JSON + override)
        if json_stock is not None:
            # Re-read the live override to get the true current stock
            row = conn.execute(
                "SELECT stock FROM item_overrides WHERE item_id = ?",
                (item_id,),
            ).fetchone()
            if row and row[0] is not None:
                live_stock = row[0]
            else:
                live_stock = json_stock

            if live_stock <= 0:
                conn.rollback()
                raise PurchaseError("Item is out of stock", 409)

            # Upsert decrement
            conn.execute(
                "INSERT INTO item_overrides (item_id, stock, updated_by, updated_at) "
                "VALUES (?, ?, 'system:purchase', ?) "
                "ON CONFLICT(item_id) DO UPDATE SET "
                "  stock = CASE "
                "    WHEN item_overrides.stock IS NOT NULL THEN item_overrides.stock - 1 "
                "    ELSE ? - 1 "
                "  END, "
                "  updated_by = 'system:purchase', "
                "  updated_at = ?",
                (item_id, live_stock - 1, now_iso, json_stock, now_iso),
            )

        # Insert purchase row
        conn.execute(
            "INSERT INTO bin_purchases "
            "(purchase_id, item_id, uuid, username, ep_spent, clean_ep_spent, "
            " dirty_ep_spent, status, fulfillment_note, purchased_at, resolved_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                purchase_id, item_id, mc_uuid, mc_username or "",
                price, server_clean, server_dirty,
                status,
                item.get("fulfillment_note"),
                now_iso,
                None,
            ),
        )

        # Record cooldown
        if parse_duration(item.get("cooldown")) is not None:
            conn.execute(
                "INSERT INTO cooldowns (uuid, item_id, last_purchased_at) "
                "VALUES (?, ?, ?) "
                "ON CONFLICT(uuid, item_id) DO UPDATE SET last_purchased_at = ?",
                (mc_uuid, item_id, now_iso, now_iso),
            )

        conn.commit()
    except PurchaseError:
        raise
    except Exception as exc:
        conn.rollback()
        print(f"[SHOP] Purchase transaction failed: {exc}", file=sys.stderr)
        raise PurchaseError("Internal error processing purchase", 500)
    finally:
        conn.close()

    # Reload item cache so stock changes are reflected immediately
    _reload_items()

    return {
        "purchase_id":      purchase_id,
        "item_id":          item_id,
        "item_name":        item.get("name", ""),
        "ep_spent":         price,
        "clean_ep_spent":   server_clean,
        "dirty_ep_spent":   server_dirty,
        "status":           status,
        "fulfillment_note": item.get("fulfillment_note"),
        "purchased_at":     now_iso,
    }
