import os
import sqlite3
import sys
import threading
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz, timedelta as _td

import requests as _requests

from config import (
    _SHOP_DB,
    _USERNAME_MATCHES_JSON, _load_json_file,
    DISCORD_API, DISCORD_TOKEN,
    RUN_AUCTION_WORKER,
)
from shop.ep_balance import (
    resolve_uuid_for_user, fetch_ep_balance, resolve_spend, InsufficientFunds,
    _ensure_ep_reservations_table,
)
from shop.items import get_item, get_item_unfiltered, _is_visible
from shop.bin import build_user_tags, PurchaseError, _get_cycle_id, _get_cycle_bounds
from shop.cycle_announcement import announce_previous_cycle_if_due
from shop.leaderboard import get_user_cycle_position


def _discord_headers():
    return {"Authorization": f"Bot {DISCORD_TOKEN}", "Content-Type": "application/json"}


def _resolve_discord_id_for_uuid(mc_uuid: str) -> str | None:
    """Reverse-lookup: MC UUID -> Discord ID via username_matches.json."""
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    for did, entry in matches.items():
        if isinstance(entry, dict) and entry.get("uuid") == mc_uuid:
            return did
    return None

import re as _re

_DISCORD_MENTION_RE = _re.compile(
    r'@(everyone|here)'
    r'|<@[!&]?\d+>'
    r'|<#\d+>'
    r'|discord\.gg/\S+'
    r'|discord(?:app)?\.com/invite/\S+',
    _re.IGNORECASE,
)

def _sanitize_dm(content: str) -> str:
    """Strip Discord mentions, role/user pings, and invite links from DM content."""
    return _DISCORD_MENTION_RE.sub('[removed]', content)

def _send_discord_dm(discord_id: str, content: str,
                     image: bytes | None = None) -> bool:
    """Open a DM channel and send a message, optionally with an image attachment."""
    import json as _json
    if not DISCORD_TOKEN or not discord_id:
        return False
    content = _sanitize_dm(content)
    try:
        ch = _requests.post(
            f"{DISCORD_API}/users/@me/channels",
            json={"recipient_id": discord_id},
            headers=_discord_headers(), timeout=10,
        )
        if not ch.ok:
            return False
        channel_id = ch.json().get("id")
        if not channel_id:
            return False
        url = f"{DISCORD_API}/channels/{channel_id}/messages"
        auth = {"Authorization": f"Bot {DISCORD_TOKEN}"}
        if image:
            # Multipart: image file + JSON payload
            msg = _requests.post(
                url,
                files={"files[0]": ("notification.png", image, "image/png")},
                data={"payload_json": _json.dumps({"content": content[:2000]})},
                headers=auth, timeout=15,
            )
        else:
            msg = _requests.post(
                url,
                json={"content": content[:2000]},
                headers=_discord_headers(), timeout=10,
            )
        return msg.ok
    except _requests.RequestException:
        return False

_DM_FOOTER = "\n-# _You can manage notification preferences in your website settings._"

def _dm_in_background(discord_id: str, content: str, low_urgency: bool = False,
                      image: bytes | None = None):
    """Fire-and-forget DM. If low_urgency=True, checks opt-out preference first."""
    if low_urgency and _is_dm_opted_out(discord_id):
        return
    full = content + _DM_FOOTER
    threading.Thread(
        target=_send_discord_dm, args=(discord_id, full, image), daemon=True,
    ).start()

def _dm_card_in_background(
    discord_id: str,
    card_type: str,
    item_name: str = "",
    amount: int = 0,
    amount_label: str = "amount",
    fields: list | None = None,
    fallback_text: str = "",
    low_urgency: bool = False,
    comment: str = "",
):
    """Render a branded card PNG and send it as a DM image.

    Falls back to plain text if card rendering fails.
    """
    if low_urgency and _is_dm_opted_out(discord_id):
        return
    try:
        import analytics as _analytics
        _analytics.record_server_event("shop", {"action": "dm_card"})
    except Exception:
        pass
    from shop.dm_cards import render_card
    png = render_card(card_type, item_name, amount, amount_label, fields, comment)
    if png:
        threading.Thread(
            target=_send_discord_dm, args=(discord_id, "", png), daemon=True,
        ).start()
    else:
        # Fallback to plain text when card rendering fails
        full = (fallback_text or "") + _DM_FOOTER
        threading.Thread(
            target=_send_discord_dm, args=(discord_id, full, None), daemon=True,
        ).start()

def _is_dm_opted_out(discord_id: str) -> bool:
    """Check if a user has opted out of low-urgency auction DMs."""
    try:
        import json as _json
        from config import _USER_DB_PATH
        conn = sqlite3.connect(_USER_DB_PATH, timeout=5)
        row = conn.execute(
            "SELECT settings FROM user_settings WHERE discord_id = ?", (discord_id,),
        ).fetchone()
        conn.close()
        if row:
            settings = _json.loads(row[0])
            return bool(settings.get("shopAuctionDmOptOut", False))
    except Exception:
        pass
    return False

def _compute_extended_hours(row, item) -> int:
    """How many hours the auction was extended (or reduced) beyond its original duration."""
    try:
        created = _dt.fromisoformat(row["created_at"])
        if created.tzinfo is None:
            created = created.replace(tzinfo=_tz.utc)
        ends = _dt.fromisoformat(row["ends_at"])
        if ends.tzinfo is None:
            ends = ends.replace(tzinfo=_tz.utc)
        dur_type = item.get("duration_type") or "fixed"
        if dur_type == "eoc_minus_2":
            cid = _get_cycle_id(created)
            _, cycle_end = _get_cycle_bounds(cid)
            original_ends = cycle_end - _td(days=2)
            if original_ends <= created:
                _, cycle_end = _get_cycle_bounds(cid + 1)
                original_ends = cycle_end - _td(days=2)
        else:
            original_ends = created + _td(hours=int(item.get("duration_hours") or 48))
            # Apply the same cycle−2d clamp that admin_start_auction uses
            cid = _get_cycle_id(created)
            _, cycle_end = _get_cycle_bounds(cid)
            max_ends = cycle_end - _td(days=2)
            if original_ends > max_ends:
                original_ends = max_ends
        diff_seconds = (ends - original_ends).total_seconds()
        return round(diff_seconds / 3600)
    except Exception:
        return 0

def _rank_distinct_bidders(bids: list, limit: int | None = None) -> list:
    """Return the best bid of each distinct bidder, best first.

    *bids* must already be ordered by ``amount DESC, placed_at ASC``. A bidder is
    ranked by their highest bid, and the earliest bid at that amount breaks ties.
    """
    ranked: list = []
    seen: set = set()
    for bid in bids:
        uuid = bid["uuid"]
        if uuid in seen:
            continue
        seen.add(uuid)
        ranked.append(bid)
        if limit is not None and len(ranked) >= limit:
            break
    return ranked


def _sync_auction_winners(conn: sqlite3.Connection, auction_id: str,
                          winner_count: int, now_iso: str) -> list:
    """Point ``bids.is_winning`` and ``ep_reservations`` at the current top-N bidders.

    Auctions can have several winners, so every bidder inside the top N keeps
    their EP hold - only bidders pushed outside it get released. This is the one
    place that decides who is winning, so the flag, the holds and
    ``_cleanup_orphaned_reservations`` can never disagree.

    Returns the winning bid rows, best first.
    """
    source = f"auction:{auction_id}"
    _ensure_ep_reservations_table(conn)

    bids = conn.execute(
        "SELECT bid_id, uuid, username, amount, clean_ep_used, dirty_ep_used "
        "FROM bids WHERE auction_id = ? ORDER BY amount DESC, placed_at ASC",
        (auction_id,),
    ).fetchall()
    winners = _rank_distinct_bidders(bids, winner_count)
    winner_uuids = {w["uuid"] for w in winners}

    # A winner's winning bid is their highest one, so re-point the flag wholesale
    conn.execute("UPDATE bids SET is_winning = 0 WHERE auction_id = ?", (auction_id,))
    for w in winners:
        conn.execute("UPDATE bids SET is_winning = 1 WHERE bid_id = ?", (w["bid_id"],))

    # Drop holds from anyone who is no longer inside the winning set
    held = conn.execute(
        "SELECT DISTINCT uuid FROM ep_reservations "
        "WHERE source = ? AND released_at IS NULL",
        (source,),
    ).fetchall()
    for row in held:
        if row["uuid"] not in winner_uuids:
            conn.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE uuid = ? AND source = ? AND released_at IS NULL",
                (now_iso, row["uuid"], source),
            )

    # Every winner must hold exactly their winning bid amount
    for w in winners:
        held_amount = conn.execute(
            "SELECT COALESCE(SUM(reserved_amount), 0) FROM ep_reservations "
            "WHERE uuid = ? AND source = ? AND released_at IS NULL",
            (w["uuid"], source),
        ).fetchone()[0]
        if held_amount == (w["amount"] or 0):
            continue
        conn.execute(
            "UPDATE ep_reservations SET released_at = ? "
            "WHERE uuid = ? AND source = ? AND released_at IS NULL",
            (now_iso, w["uuid"], source),
        )
        _clean_used = w["clean_ep_used"] or 0
        _dirty_used = w["dirty_ep_used"] or 0
        if _clean_used > 0:
            conn.execute(
                "INSERT INTO ep_reservations "
                "(reservation_id, uuid, username, reserved_amount, ep_type, source, created_at) "
                "VALUES (?, ?, ?, ?, 'clean', ?, ?)",
                (str(_uuid_mod.uuid4()), w["uuid"], w["username"] or "",
                 _clean_used, source, now_iso),
            )
        if _dirty_used > 0:
            conn.execute(
                "INSERT INTO ep_reservations "
                "(reservation_id, uuid, username, reserved_amount, ep_type, source, created_at) "
                "VALUES (?, ?, ?, ?, 'dirty', ?, ?)",
                (str(_uuid_mod.uuid4()), w["uuid"], w["username"] or "",
                 _dirty_used, source, now_iso),
            )

    return winners


def _own_auction_reservations(uuid: str, auction_id: str) -> tuple[int, int]:
    """Active ``(clean, dirty)`` reservation totals this bidder holds on one auction."""
    clean = dirty = 0
    if not os.path.isfile(_SHOP_DB):
        return clean, dirty
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        rows = conn.execute(
            "SELECT ep_type, COALESCE(SUM(reserved_amount), 0) FROM ep_reservations "
            "WHERE uuid = ? AND source = ? AND released_at IS NULL GROUP BY ep_type",
            (uuid, f"auction:{auction_id}"),
        ).fetchall()
        conn.close()
        for ep_type, amount in rows:
            if ep_type == "clean":
                clean = int(amount)
            elif ep_type == "dirty":
                dirty = int(amount)
    except sqlite3.Error:
        pass
    return clean, dirty


def _available_ep_for_auction(uuid: str, auction_id: str, item: dict) -> int:
    """EP a bidder can still commit to this auction at settlement time.

    ``fetch_ep_balance`` reports totals plus everything currently reserved, so the
    bidder's own hold on this auction is added back before checking whether they
    can still cover their bid. Auctions never outlive their cycle (both start and
    anti-snipe clamp to the cycle boundary), so a hold can never age into a
    different bucket between the bid and settlement.
    """
    bal = fetch_ep_balance(uuid)
    clean     = int(bal.get("clean_ep", 0) or 0)
    dirty     = int(bal.get("dirty_ep", 0) or 0)
    res_clean = int(bal.get("reserved_clean", 0) or 0)
    res_dirty = int(bal.get("reserved_dirty", 0) or 0)

    own_clean, own_dirty = _own_auction_reservations(uuid, auction_id)
    free_clean = clean - max(0, res_clean - own_clean)
    free_dirty = dirty - max(0, res_dirty - own_dirty)

    spend_order = item.get("spend_order", "clean_first")
    if not item.get("accepts_dirty_ep", False):
        spend_order = "clean_only"
    if spend_order == "clean_only":
        return free_clean
    if spend_order == "dirty_only":
        return free_dirty
    return free_clean + free_dirty


def list_auctions(discord_id: str, user_roles: list | None = None,
                  is_shop_admin: bool = False) -> dict:
    """Return active + recently-closed auctions, enriched for the logged-in user.

    If *is_shop_admin* is True, all auctions are returned but restricted
    ones are tagged with ``visibility_blocked=True``.
    """
    mc_uuid, mc_username = resolve_uuid_for_user(discord_id) if discord_id else (None, None)
    user_position = get_user_cycle_position(mc_uuid) if mc_uuid else None
    tags = build_user_tags(user_roles or []) if user_roles else None
    if not tags:
        tags = None
    now = _dt.now(_tz.utc)
    now_iso = now.isoformat()
    cutoff = (now - _td(hours=48)).isoformat()

    auctions = []
    if os.path.isfile(_SHOP_DB):
        try:
            conn = sqlite3.connect(_SHOP_DB, timeout=5)
            conn.row_factory = sqlite3.Row
            rows = conn.execute(
                "SELECT * FROM auctions "
                "WHERE status = 'active' "
                "   OR (status = 'closed' AND ends_at >= ?) "
                "ORDER BY ends_at ASC",
                (cutoff,),
            ).fetchall()

            for row in rows:
                aid = row["auction_id"]

                # user's active bid on this auction
                user_bid = None
                if mc_uuid:
                    ub = conn.execute(
                        "SELECT bid_id, amount, is_winning "
                        "FROM bids WHERE auction_id = ? AND uuid = ? "
                        "ORDER BY amount DESC LIMIT 1",
                        (aid, mc_uuid),
                    ).fetchone()
                    if ub:
                        user_bid = {
                            "bid_id": ub["bid_id"],
                            "amount": ub["amount"],
                            "is_winning": bool(ub["is_winning"]),
                        }

                # item metadata
                item = get_item_unfiltered(row["item_id"])
                if not item:
                    continue
                from shop.items import _has_valid_creator
                if not _has_valid_creator(item):
                    continue

                ends_at = _dt.fromisoformat(row["ends_at"])
                if ends_at.tzinfo is None:
                    ends_at = ends_at.replace(tzinfo=_tz.utc)
                remaining = max(0, (ends_at - now).total_seconds())

                ext_hours = _compute_extended_hours(row, item)
                # check visibility (rank + top-N)
                visible_to_user = _is_visible(item, tags, user_position)

                # For non-admins, skip auctions they can't see
                if not visible_to_user and not is_shop_admin:
                    continue

                entry = {
                    "auction_id":       aid,
                    "item_id":          row["item_id"],
                    "item_name":        item.get("name", ""),
                    "item_image":       (item.get("images") or [""])[0],
                    "item_description": item.get("description", ""),
                    "current_highest_bid": row["current_highest_bid"],
                    "current_highest_bidder_uuid": row["current_highest_bidder_uuid"],
                    "status":           row["status"],
                    "ends_at":          row["ends_at"],
                    "created_at":       row["created_at"],
                    "extended":         ext_hours != 0,
                    "extended_hours":   ext_hours,
                    "time_remaining_s": int(remaining),
                    "min_increment":    item.get("min_increment", 1),
                    "starting_bid":     item.get("starting_bid", 0),
                    "anti_snipe_seconds": item.get("anti_snipe_seconds", 0),
                    "spend_order":      item.get("spend_order", "clean_first"),
                    "accepts_dirty_ep": bool(item.get("accepts_dirty_ep", False)),
                    "item_category":    item.get("category") or [],
                    "item_images":      item.get("images") or [],
                    "active":           item.get("active", True),
                    "auto_start":       bool(item.get("auto_start", False)),
                    "winner_count":     item.get("winner_count", 1) or 1,
                    "user_bid":         user_bid,
                    "visible_to_user":  visible_to_user,
                }
                if not visible_to_user:
                    entry["visibility_blocked"] = True
                auctions.append(entry)
            conn.close()
        except sqlite3.Error as exc:
            print(f"[AUCTION] Failed to list auctions: {exc}", file=sys.stderr)

    balance = fetch_ep_balance(mc_uuid) if mc_uuid else {
        "spendable_clean": 0, "spendable_dirty": 0,
        "clean_ep": 0, "dirty_ep": 0, "total_ep": 0,
        "reserved_clean": 0, "reserved_dirty": 0,
    }

    return {
        "auctions": auctions,
        "balance": balance,
        "uuid": mc_uuid,
        "username": mc_username,
        "linked": mc_uuid is not None,
    }

def place_bid(
    discord_id: str,
    user_roles: list,
    auction_id: str,
    amount: int,
) -> dict:
    """Validate and place a bid. Returns the new bid record.

    Manages EP reservations atomically with the bid insertion in shop.db.
    """
    now = _dt.now(_tz.utc)
    now_iso = now.isoformat()

    mc_uuid, mc_username = resolve_uuid_for_user(discord_id)
    if not mc_uuid:
        raise PurchaseError("No linked Minecraft account", 400)

    if not os.path.isfile(_SHOP_DB):
        raise PurchaseError("Shop database unavailable", 503)

    # read auction state
    shop_conn = sqlite3.connect(_SHOP_DB, timeout=10)
    shop_conn.row_factory = sqlite3.Row
    try:
        shop_conn.execute("PRAGMA journal_mode=WAL")
        shop_conn.execute("PRAGMA foreign_keys=ON")
        shop_conn.execute("BEGIN IMMEDIATE")

        arow = shop_conn.execute(
            "SELECT * FROM auctions WHERE auction_id = ?", (auction_id,),
        ).fetchone()
        if not arow:
            shop_conn.rollback()
            raise PurchaseError("Auction not found", 404)
        if arow["status"] != "active":
            shop_conn.rollback()
            raise PurchaseError("Auction is not active", 409)

        ends_at = _dt.fromisoformat(arow["ends_at"])
        if ends_at.tzinfo is None:
            ends_at = ends_at.replace(tzinfo=_tz.utc)
        if now >= ends_at:
            shop_conn.rollback()
            raise PurchaseError("Auction has ended", 409)

        item = get_item_unfiltered(arow["item_id"])
        if not item:
            shop_conn.rollback()
            raise PurchaseError("Auction item no longer exists", 400)
        from shop.items import _has_valid_creator
        if not _has_valid_creator(item):
            shop_conn.rollback()
            raise PurchaseError("This auction item is currently unavailable", 400)
        if not item.get("active", True):
            shop_conn.rollback()
            raise PurchaseError("This auction is currently paused", 409)

        # top-N visibility check (enforce on bids)
        top_n = item.get("visible_to_top_n")
        if top_n is not None and isinstance(top_n, int) and top_n > 0:
            _bid_pos = get_user_cycle_position(mc_uuid)
            if _bid_pos is None or _bid_pos > top_n:
                shop_conn.rollback()
                raise PurchaseError(
                    "This auction is restricted to top players from the previous cycle", 403
                )

        min_increment = item.get("min_increment", 1)
        current_high = arow["current_highest_bid"]
        current_bidder = arow["current_highest_bidder_uuid"]

        # validate bid amount
        if current_high == 0:
            min_required = item.get("starting_bid", 0) or 0
        else:
            min_required = current_high + min_increment

        if amount < min_required:
            shop_conn.rollback()
            raise PurchaseError(
                f"Bid must be at least {min_required} EP "
                f"(current high: {current_high}, increment: {min_increment})",
                400,
            )

        if current_bidder == mc_uuid:
            shop_conn.rollback()
            raise PurchaseError("You are already the highest bidder", 409)

        # dirty EP eligibility
        spend_order = item.get("spend_order", "clean_first")
        if not item.get("accepts_dirty_ep", False):
            spend_order = "clean_only"

        # resolve EP split
        split = resolve_spend(mc_uuid, amount, spend_order)
        clean_used = split["clean_to_spend"]
        dirty_used = split["dirty_to_spend"]

        # manage EP reservations in shop.db
        _ensure_ep_reservations_table(shop_conn)

        # Who held a winning slot before this bid, so we can tell anyone who
        # drops out of the winning set that their EP was released.
        _prev_holders = {
            r[0] for r in shop_conn.execute(
                "SELECT DISTINCT uuid FROM ep_reservations "
                "WHERE source = ? AND released_at IS NULL",
                (f"auction:{auction_id}",),
            ).fetchall()
        }

        # Release any prior reservation from this user on this auction
        shop_conn.execute(
            "UPDATE ep_reservations SET released_at = ? "
            "WHERE uuid = ? AND source = ? AND released_at IS NULL",
            (now_iso, mc_uuid, f"auction:{auction_id}"),
        )

        # Create new reservations (one per EP type if non-zero)
        if clean_used > 0:
            shop_conn.execute(
                "INSERT INTO ep_reservations "
                "(reservation_id, uuid, username, reserved_amount, ep_type, source, created_at) "
                "VALUES (?, ?, ?, ?, 'clean', ?, ?)",
                (str(_uuid_mod.uuid4()), mc_uuid, mc_username or "", clean_used,
                 f"auction:{auction_id}", now_iso),
            )
        if dirty_used > 0:
            shop_conn.execute(
                "INSERT INTO ep_reservations "
                "(reservation_id, uuid, username, reserved_amount, ep_type, source, created_at) "
                "VALUES (?, ?, ?, ?, 'dirty', ?, ?)",
                (str(_uuid_mod.uuid4()), mc_uuid, mc_username or "", dirty_used,
                 f"auction:{auction_id}", now_iso),
            )

        # insert bid row (the winning flag is set by _sync_auction_winners below)
        bid_id = str(_uuid_mod.uuid4())

        shop_conn.execute(
            "INSERT INTO bids "
            "(bid_id, auction_id, uuid, username, amount, clean_ep_used, dirty_ep_used, "
            " placed_at, is_winning) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
            (bid_id, auction_id, mc_uuid, mc_username or "", amount,
             clean_used, dirty_used, now_iso),
        )

        winner_count = item.get("winner_count", 1) or 1
        winners = _sync_auction_winners(shop_conn, auction_id, winner_count, now_iso)
        displaced_uuid = current_bidder if (current_bidder and current_bidder != mc_uuid) else None
        displaced_still_winning = bool(
            displaced_uuid and any(w["uuid"] == displaced_uuid for w in winners)
        )
        dropped_uuids = _prev_holders - {w["uuid"] for w in winners}

        # update auction state
        shop_conn.execute(
            "UPDATE auctions SET current_highest_bid = ?, current_highest_bidder_uuid = ? "
            "WHERE auction_id = ?",
            (amount, mc_uuid, auction_id),
        )

        # anti-snipe extension (hard cap: cycle_end - 2 hours)
        anti_snipe = item.get("anti_snipe_seconds", 0) or 0
        extended = False
        if anti_snipe > 0:
            snipe_threshold = ends_at - _td(seconds=anti_snipe)
            if now >= snipe_threshold:
                new_ends = now + _td(seconds=anti_snipe)
                # Hard cap: never let anti-snipe push the end past cycle_end - 2h
                cid = _get_cycle_id(now)
                _, cycle_end = _get_cycle_bounds(cid)
                max_ends = cycle_end - _td(hours=2)
                if new_ends > max_ends:
                    new_ends = max_ends
                if new_ends > ends_at:
                    shop_conn.execute(
                        "UPDATE auctions SET ends_at = ?, extended = 1 WHERE auction_id = ?",
                        (new_ends.isoformat(), auction_id),
                    )
                    extended = True

        shop_conn.commit()
    except PurchaseError:
        raise
    except InsufficientFunds:
        shop_conn.rollback()
        raise
    except Exception as exc:
        shop_conn.rollback()
        print(f"[AUCTION] Bid transaction failed: {exc}", file=sys.stderr)
        raise PurchaseError("Internal error processing bid", 500)
    finally:
        shop_conn.close()

    item_name = item.get("name", arow["item_id"])

    # Gather context for card fields
    _remaining = max(0, (ends_at - _dt.now(_tz.utc)).total_seconds())
    _ends_str = f"{int(_remaining // 3600)}h {int((_remaining % 3600) // 60)}m"
    try:
        _ctx_conn = sqlite3.connect(_SHOP_DB, timeout=5)
        _bidder_count = _ctx_conn.execute(
            "SELECT COUNT(DISTINCT uuid) FROM bids WHERE auction_id = ?", (auction_id,),
        ).fetchone()[0]
        _best_bid_by_uuid = {
            r[0]: r[1] for r in _ctx_conn.execute(
                "SELECT uuid, MAX(amount) FROM bids WHERE auction_id = ? GROUP BY uuid",
                (auction_id,),
            ).fetchall()
        }
        _ctx_conn.close()
    except sqlite3.Error:
        _bidder_count = 0
        _best_bid_by_uuid = {}

    # DM: Bid confirmed (receipt)
    bidder_did = _resolve_discord_id_for_uuid(mc_uuid)
    if bidder_did:
        if winner_count > 1:
            _status_txt = f"Leading of {winner_count}"
            _receipt_text = (
                f"Bid of {amount:,} EP on {item_name} placed. "
                f"You lead {winner_count} winning positions."
            )
        else:
            _status_txt = "Highest Bidder"
            _receipt_text = f"Bid of {amount:,} EP on {item_name} placed. You are the highest bidder."
        _dm_card_in_background(
            bidder_did, "bid_placed", item_name, amount,
            fields=[
                ("BIDDERS", f"{_bidder_count} active"),
                ("ENDS IN", _ends_str),
                ("YOUR RANK", "#1"),
                ("STATUS", _status_txt),
            ],
            fallback_text=_receipt_text,
            low_urgency=True,
        )

    if displaced_uuid and displaced_still_winning:
        displaced_did = _resolve_discord_id_for_uuid(displaced_uuid)
        if displaced_did:
            _displaced_amount = current_high  # their bid was the previous high
            _dm_card_in_background(
                displaced_did, "still_winning", item_name, _displaced_amount,
                fields=[
                    ("YOUR BID", f"{_displaced_amount:,} EP"),
                    ("NEW HIGH", f"{amount:,} EP"),
                    ("STATUS", f"Still winning ({winner_count})"),
                    ("ENDS IN", _ends_str),
                ],
                fallback_text=(
                    f"You were outbid for first place on {item_name}, but you are still "
                    f"inside the winning set ({winner_count} winners). Your EP stays reserved."
                ),
            )

    # Everyone pushed out of the winning set has just had their EP released
    for uuid in dropped_uuids:
        dropped_did = _resolve_discord_id_for_uuid(uuid)
        if not dropped_did:
            continue
        _dropped_amount = _best_bid_by_uuid.get(uuid, 0)
        _dm_card_in_background(
            dropped_did, "outbid", item_name, amount,
            fields=[
                ("YOUR BID", f"{_dropped_amount:,} EP"),
                ("NEW HIGH", f"{amount:,} EP"),
                ("DEFICIT", f"{max(0, amount - _dropped_amount):,} EP"),
                ("ENDS IN", _ends_str),
            ],
            fallback_text=f"You were outbid on {item_name}. New high: {amount:,} EP.",
        )

    # DM: Anti-snipe extension notification to all active bidders
    if extended:
        try:
            notify_conn = sqlite3.connect(_SHOP_DB, timeout=5)
            bidder_uuids = notify_conn.execute(
                "SELECT DISTINCT uuid FROM bids WHERE auction_id = ?",
                (auction_id,),
            ).fetchall()
            notify_conn.close()
            for row in bidder_uuids:
                if row[0] == mc_uuid:
                    continue
                did = _resolve_discord_id_for_uuid(row[0])
                if did:
                    _dm_card_in_background(
                        did, "snipe_extension", item_name, amount,
                        fields=[
                            ("NEW HIGH", f"{amount:,} EP"),
                            ("REASON", "Last-minute bid"),
                        ],
                        fallback_text=f"Auction for {item_name} extended. New high: {amount:,} EP.",
                        low_urgency=True,
                    )
        except sqlite3.Error:
            pass

    return {
        "bid_id":       bid_id,
        "auction_id":   auction_id,
        "amount":       amount,
        "clean_ep_used": clean_used,
        "dirty_ep_used": dirty_used,
        "extended":     extended,
        "placed_at":    now_iso,
    }

_CLOSE_WORKER_INTERVAL = 60  # seconds
_REMINDER_HOURS = 6  # hours before close to send reminder
_last_known_cycle_id: int | None = None  # tracks the cycle for auto-start detection
_DM_NOTIFICATION_ENDING_SOON = "ending_soon"

def _ensure_dm_notifications_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS auction_dm_notifications (
            auction_id         TEXT NOT NULL,
            recipient_uuid     TEXT NOT NULL,
            notification_type  TEXT NOT NULL,
            sent_at            TEXT NOT NULL,
            PRIMARY KEY (auction_id, recipient_uuid, notification_type)
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_adn_sent_at "
        "ON auction_dm_notifications (sent_at)"
    )

def _claim_dm_notification_once(
    conn: sqlite3.Connection,
    auction_id: str,
    recipient_uuid: str,
    notification_type: str,
    sent_at_iso: str,
) -> bool:
    before = conn.total_changes
    conn.execute(
        "INSERT OR IGNORE INTO auction_dm_notifications "
        "(auction_id, recipient_uuid, notification_type, sent_at) "
        "VALUES (?, ?, ?, ?)",
        (auction_id, recipient_uuid, notification_type, sent_at_iso),
    )
    inserted = conn.total_changes > before
    if inserted:
        conn.commit()
    return inserted

def _send_ending_soon_reminders():
    """DM all bidders on auctions ending within _REMINDER_HOURS."""
    now = _dt.now(_tz.utc)
    threshold = (now + _td(hours=_REMINDER_HOURS)).isoformat()
    now_iso = now.isoformat()

    if not os.path.isfile(_SHOP_DB):
        return

    conn = None
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        _ensure_dm_notifications_table(conn)
        soon = conn.execute(
            "SELECT * FROM auctions WHERE status = 'active' AND ends_at <= ? AND ends_at > ?",
            (threshold, now_iso),
        ).fetchall()
        for arow in soon:
            aid = arow["auction_id"]
            item = get_item_unfiltered(arow["item_id"]) or {}
            item_name = item.get("name", arow["item_id"])
            ends_at = _dt.fromisoformat(arow["ends_at"])
            if ends_at.tzinfo is None:
                ends_at = ends_at.replace(tzinfo=_tz.utc)
            remaining_h = max(0, int((ends_at - now).total_seconds() / 3600))
            bidders = conn.execute(
                "SELECT DISTINCT uuid FROM bids WHERE auction_id = ?", (aid,),
            ).fetchall()
            for b in bidders:
                bidder_uuid = b["uuid"]
                did = _resolve_discord_id_for_uuid(bidder_uuid)
                if not did:
                    continue
                claimed = _claim_dm_notification_once(
                    conn,
                    aid,
                    bidder_uuid,
                    _DM_NOTIFICATION_ENDING_SOON,
                    now_iso,
                )
                if not claimed:
                    continue
                _dm_card_in_background(
                    did, "ending_soon", item_name, arow["current_highest_bid"],
                    fields=[
                        ("TIME LEFT", f"~{remaining_h}h"),
                        ("HIGHEST BID", f"{arow['current_highest_bid']:,} EP"),
                    ],
                    fallback_text=f"Auction for {item_name} ends in ~{remaining_h}h. High: {arow['current_highest_bid']:,} EP.",
                    low_urgency=True,
                )
    except sqlite3.Error as exc:
        print(f"[AUCTION] Ending-soon reminder error: {exc}", file=sys.stderr)
    finally:
        if conn is not None:
            conn.close()

def _close_expired_auctions():
    """Find auctions past their ends_at, close them, settle winners."""
    now = _dt.now(_tz.utc)
    now_iso = now.isoformat()

    if not os.path.isfile(_SHOP_DB):
        return

    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        expired = conn.execute(
            "SELECT * FROM auctions WHERE status = 'active' AND ends_at <= ?",
            (now_iso,),
        ).fetchall()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[AUCTION] Failed to query expired auctions: {exc}", file=sys.stderr)
        return

    for auction in expired:
        try:
            _settle_auction(auction, now_iso)
        except Exception as exc:
            print(
                f"[AUCTION] Failed to settle auction {auction['auction_id']}: {exc}",
                file=sys.stderr,
            )

def _cancel_orphaned_auction(auction_id: str, item_id: str, now_iso: str) -> None:
    """Cancel an auction whose item no longer exists, release all EP, DM bidders."""
    print(f"[AUCTION] Orphaned auction {auction_id} (item '{item_id}' removed) — cancelling.",
          file=sys.stderr)
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("BEGIN IMMEDIATE")

        live = conn.execute(
            "SELECT status FROM auctions WHERE auction_id = ?", (auction_id,)
        ).fetchone()
        if not live or live["status"] != "active":
            conn.rollback(); conn.close()
            return

        bidders = conn.execute(
            "SELECT DISTINCT uuid FROM bids WHERE auction_id = ?", (auction_id,)
        ).fetchall()

        conn.execute(
            "UPDATE auctions SET status = 'cancelled' WHERE auction_id = ?",
            (auction_id,)
        )
        conn.commit()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[AUCTION] Failed to cancel orphan {auction_id}: {exc}", file=sys.stderr)
        return

    # Release EP reservations
    source = f"auction:{auction_id}"
    if os.path.isfile(_SHOP_DB):
        try:
            release_conn = sqlite3.connect(_SHOP_DB, timeout=10)
            release_conn.execute("PRAGMA journal_mode=WAL")
            release_conn.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE source = ? AND released_at IS NULL",
                (now_iso, source),
            )
            release_conn.commit()
            release_conn.close()
        except sqlite3.Error as exc:
            print(f"[AUCTION] Failed to release EP for orphan {auction_id}: {exc}",
                  file=sys.stderr)

    # DM all bidders
    for b in bidders:
        did = _resolve_discord_id_for_uuid(b["uuid"])
        if did:
            _dm_card_in_background(
                did, "auction_cancelled", item_id, 0,
                fields=[
                    ("REASON", "Item removed"),
                    ("REFUNDED", "Yes"),
                    ("STATUS", "Void"),
                ],
                fallback_text=f"Auction for {item_id} cancelled (item removed). Your EP has been released.",
            )

    # Write to the admin changes log so admins can see it in the UI
    try:
        from shop.admin import _log_admin_action
        _log_admin_action(
            "system:orphan-cleanup", "auction_cancelled", auction_id,
            {"auction_id": auction_id, "item_id": item_id,
             "reason": "item removed from catalogue"},
        )
    except Exception:
        pass


def _cleanup_orphaned_auctions() -> None:
    """Scan all active auctions and cancel any whose item no longer exists."""
    if not os.path.isfile(_SHOP_DB):
        return
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        active = conn.execute(
            "SELECT auction_id, item_id FROM auctions WHERE status = 'active'"
        ).fetchall()
        conn.close()
    except sqlite3.Error as exc:
        print(f"[AUCTION] Orphan scan failed: {exc}", file=sys.stderr)
        return

    now_iso = _dt.now(_tz.utc).isoformat()
    for row in active:
        if get_item_unfiltered(row["item_id"]) is None:
            try:
                _cancel_orphaned_auction(row["auction_id"], row["item_id"], now_iso)
            except Exception as exc:
                print(f"[AUCTION] Orphan cancel error {row['auction_id']}: {exc}",
                      file=sys.stderr)


def _settle_auction(auction: sqlite3.Row, now_iso: str):
    """Close a single auction: mark winners, release losers, deduct EP."""
    aid = auction["auction_id"]
    item_id = auction["item_id"]
    item = get_item_unfiltered(item_id)
    if item is None:
        # Item was removed after this auction expired; cancel cleanly instead
        _cancel_orphaned_auction(aid, item_id, now_iso)
        return
    winner_count = item.get("winner_count", 1) or 1

    shop_conn = sqlite3.connect(_SHOP_DB, timeout=10)
    shop_conn.row_factory = sqlite3.Row
    try:
        shop_conn.execute("PRAGMA journal_mode=WAL")
        shop_conn.execute("BEGIN IMMEDIATE")

        # Re-check status inside the lock
        live = shop_conn.execute(
            "SELECT status FROM auctions WHERE auction_id = ?", (aid,),
        ).fetchone()
        if not live or live["status"] != "active":
            shop_conn.rollback()
            return

        # Get all bids ordered by amount desc
        all_bids = shop_conn.execute(
            "SELECT * FROM bids WHERE auction_id = ? ORDER BY amount DESC, placed_at ASC",
            (aid,),
        ).fetchall()

        ranked_bidders = _rank_distinct_bidders(all_bids)

        winners: list = []
        disqualified_uuids: set = set()
        for cand in ranked_bidders:
            if len(winners) >= winner_count:
                break
            need = cand["amount"]
            have = _available_ep_for_auction(cand["uuid"], aid, item)
            if have >= need:
                winners.append(cand)
            else:
                disqualified_uuids.add(cand["uuid"])
                print(
                    f"[AUCTION] {aid}: bidder {cand['username']} has insufficient EP "
                    f"(need {need}, available {have}) - disqualified at settlement.",
                    file=sys.stderr,
                )

        winner_uuids = {w["uuid"] for w in winners}
        loser_uuids  = {b["uuid"] for b in all_bids
                        if b["uuid"] not in winner_uuids
                        and b["uuid"] not in disqualified_uuids}

        # Mark winning bids
        for w in winners:
            shop_conn.execute(
                "UPDATE bids SET is_winning = 1 WHERE bid_id = ?", (w["bid_id"],),
            )

        # Mark all non-winning bids (covers disqualified candidates too)
        if winners:
            shop_conn.execute(
                "UPDATE bids SET is_winning = 0 WHERE auction_id = ? AND bid_id NOT IN ("
                + ",".join("?" * len(winners))
                + ")",
                (aid, *(w["bid_id"] for w in winners)),
            )
        else:
            shop_conn.execute(
                "UPDATE bids SET is_winning = 0 WHERE auction_id = ?", (aid,)
            )

        # Insert bin_purchases records for winners (pending for chief review)
        for w in winners:
            shop_conn.execute(
                "INSERT INTO bin_purchases "
                "(purchase_id, item_id, uuid, username, ep_spent, clean_ep_spent, "
                " dirty_ep_spent, status, fulfillment_note, purchased_at, resolved_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)",
                (
                    str(_uuid_mod.uuid4()), item_id, w["uuid"], w["username"],
                    w["amount"], w["clean_ep_used"], w["dirty_ep_used"],
                    item.get("fulfillment_note"), now_iso, None,
                ),
            )

        # Close the auction
        shop_conn.execute(
            "UPDATE auctions SET status = 'closed' WHERE auction_id = ?", (aid,),
        )

        shop_conn.commit()
    except Exception:
        shop_conn.rollback()
        raise
    finally:
        shop_conn.close()

    # Release EP reservations in shop.db
    source = f"auction:{aid}"
    if os.path.isfile(_SHOP_DB):
        try:
            release_conn = sqlite3.connect(_SHOP_DB, timeout=10)
            release_conn.execute("PRAGMA journal_mode=WAL")
            # Release ALL reservations for this auction (winners + losers).
            # Winners' EP is now accounted for via the bin_purchases row.
            release_conn.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE source = ? AND released_at IS NULL",
                (now_iso, source),
            )
            release_conn.commit()
            release_conn.close()
        except sqlite3.Error as exc:
            print(f"[AUCTION] Failed to release reservations for {aid}: {exc}", file=sys.stderr)

    # Discord DM notifications
    item_name = item.get("name", item_id)
    bid_counts_by_uuid: dict[str, int] = {}
    bidder_rank_by_uuid: dict[str, int] = {}
    for bid in all_bids:
        bidder_uuid = bid["uuid"]
        bid_counts_by_uuid[bidder_uuid] = bid_counts_by_uuid.get(bidder_uuid, 0) + 1
        if bidder_uuid not in bidder_rank_by_uuid:
            bidder_rank_by_uuid[bidder_uuid] = len(bidder_rank_by_uuid) + 1

    if winners:
        highest_winning_bid = max((w["amount"] for w in winners), default=0)
        primary_winner_name = winners[0]["username"] or "Unknown"
        if len(winners) > 1:
            winner_display_name = f"{primary_winner_name} +{len(winners) - 1}"
        else:
            winner_display_name = primary_winner_name
        # DM: Auction won
        for w in winners:
            did = _resolve_discord_id_for_uuid(w["uuid"])
            if did:
                won_fields = [
                    ("FINAL PRICE", f"{w['amount']:,} EP"),
                    ("STATUS", "Pending"),
                ]
                if item.get("fulfillment_note"):
                    won_fields.append(("NEXT STEP", item["fulfillment_note"][:40]))
                _dm_card_in_background(
                    did, "auction_won", item_name, w["amount"],
                    fields=won_fields,
                    fallback_text=f"You won the auction for {item_name} with {w['amount']:,} EP.",
                )

        # DM: Auction lost
        for uuid in loser_uuids:
            did = _resolve_discord_id_for_uuid(uuid)
            if did:
                _user_bid_count = bid_counts_by_uuid.get(uuid, 0)
                _user_position = bidder_rank_by_uuid.get(uuid)
                _dm_card_in_background(
                    did,
                    "auction_lost",
                    item_name,
                    highest_winning_bid,
                    amount_label="highest bid",
                    fields=[
                        ("YOUR BIDS", str(_user_bid_count)),
                        ("POSITION", f"#{_user_position}" if _user_position else "N/A"),
                        ("WINNER", winner_display_name),
                    ],
                    fallback_text=(
                        f"Auction for {item_name} ended. "
                        f"Highest bid: {highest_winning_bid:,} EP. "
                        f"Winner: {winner_display_name}."
                    ),
                )

        # DM: Disqualified due to insufficient EP at settlement
        for uuid in disqualified_uuids:
            did = _resolve_discord_id_for_uuid(uuid)
            if did:
                _dm_card_in_background(
                    did, "disqualified", item_name, 0,
                    fields=[
                        ("REASON", "Insufficient EP"),
                        ("REFUNDED", "Yes"),
                    ],
                    fallback_text=f"Your winning bid on {item_name} was disqualified (insufficient EP). EP released.",
                )
    else:
        # DM: Auction closed with no winner — notify all bidders (if any)
        all_bidder_uuids = {b["uuid"] for b in all_bids}
        for uuid in all_bidder_uuids:
            did = _resolve_discord_id_for_uuid(uuid)
            if did:
                _dm_card_in_background(
                    did, "no_winner", item_name, 0,
                    fields=[
                        ("REFUNDED", "Yes"),
                        ("STATUS", "Closed"),
                    ],
                    fallback_text=f"Auction for {item_name} closed with no winner. EP released.",
                )

def _cleanup_orphaned_reservations() -> None:
    """Release auction EP reservations that have no matching active winning bid.

    Covers three crash-window scenarios:
      1. Process died after INSERT into ep_reservations but before the bid row
         was committed in shop.db  -> reservation exists, no bid row at all.
      2. Process died after the new winner's bid committed but before the
         previous winner's reservation was released  -> old reservation survives.
      3. Auction settled/cancelled but the bulk reservation release failed
         (rare, already handled by settle/cancel, but this acts as a safety net).
    """
    if not os.path.isfile(_SHOP_DB):
        return
    now_iso = _dt.now(_tz.utc).isoformat()

    to_release: list = []
    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        _ensure_ep_reservations_table(conn)
        stuck = conn.execute(
            "SELECT reservation_id, uuid, source FROM ep_reservations "
            "WHERE released_at IS NULL AND source LIKE 'auction:%'"
        ).fetchall()

        for r in stuck:
            source = r["source"]
            if not source.startswith("auction:"):
                continue
            auction_id = source[len("auction:"):]
            has_valid_bid = conn.execute(
                "SELECT 1 FROM bids b "
                "JOIN auctions a ON a.auction_id = b.auction_id "
                "WHERE b.auction_id = ? AND b.uuid = ? "
                "  AND b.is_winning = 1 AND a.status = 'active' LIMIT 1",
                (auction_id, r["uuid"]),
            ).fetchone()
            if has_valid_bid is None:
                to_release.append(r["reservation_id"])
        conn.close()
    except sqlite3.Error as exc:
        print(f"[AUCTION] Orphan-reservation scan failed: {exc}", file=sys.stderr)
        return

    if not to_release:
        return

    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            "UPDATE ep_reservations SET released_at = ? WHERE reservation_id IN ("
            + ",".join("?" * len(to_release)) + ")",
            [now_iso] + to_release,
        )
        conn.commit()
        conn.close()
        print(
            f"[AUCTION] Released {len(to_release)} orphaned EP reservation(s).",
            file=sys.stderr,
        )
    except sqlite3.Error as exc:
        print(f"[AUCTION] Failed to release orphaned reservations: {exc}", file=sys.stderr)


def _auto_start_auctions():
    """Start auctions for items with auto_start=True when a new cycle begins."""
    global _last_known_cycle_id
    current_cycle = _get_cycle_id()

    if _last_known_cycle_id is None:
        # First run
        _last_known_cycle_id = current_cycle
        return

    if current_cycle == _last_known_cycle_id:
        return  # still in the same cycle

    # Cycle changed
    _last_known_cycle_id = current_cycle
    print(f"[AUCTION] New cycle {current_cycle} detected, checking auto-start items.",
          file=sys.stderr)

    try:
        from shop.admin import admin_list_all_items_unfiltered, admin_start_auction
        all_items = admin_list_all_items_unfiltered()
        for item in all_items:
            if (item.get("type") != "auction"
                    or not item.get("auto_start")
                    or not item.get("active", False)):
                continue
            result = admin_start_auction(item["id"], "system:auto-start")
            if result.get("ok"):
                print(f"[AUCTION] Auto-started auction for '{item['id']}' "
                      f"(auction {result['auction_id']}).", file=sys.stderr)
            else:
                # Already active or too close to cycle end — not an error
                print(f"[AUCTION] Auto-start skipped for '{item['id']}': "
                      f"{result.get('error', 'unknown')}", file=sys.stderr)
    except Exception as exc:
        print(f"[AUCTION] Auto-start error: {exc}", file=sys.stderr)


def _check_item_schedules():
    """Auto-activate/deactivate items based on activate_at / deactivate_at."""
    try:
        from shop.admin import admin_list_all_items_unfiltered, admin_set_override
        from datetime import datetime as _sched_dt, timezone as _sched_tz
        now = _sched_dt.now(_sched_tz.utc)
        all_items = admin_list_all_items_unfiltered()
        for item in all_items:
            item_id = item.get("id")
            if not item_id:
                continue
            # Auto-activate: item is inactive and activate_at is in the past
            act_at = item.get("activate_at")
            if act_at and item.get("active") is False:
                try:
                    act_dt = _sched_dt.fromisoformat(act_at.replace("Z", "+00:00"))
                    if now >= act_dt:
                        admin_set_override(item_id, active=True, stock=None,
                                           updated_by="system:schedule")
                        print(f"[SCHEDULE] Auto-activated '{item_id}'.",
                              file=sys.stderr)
                except (ValueError, TypeError):
                    pass
            # Auto-deactivate: item is active and deactivate_at is in the past
            deact_at = item.get("deactivate_at")
            if deact_at and item.get("active") is not False:
                try:
                    deact_dt = _sched_dt.fromisoformat(deact_at.replace("Z", "+00:00"))
                    if now >= deact_dt:
                        admin_set_override(item_id, active=False, stock=None,
                                           updated_by="system:schedule")
                        print(f"[SCHEDULE] Auto-deactivated '{item_id}'.",
                              file=sys.stderr)
                except (ValueError, TypeError):
                    pass
    except Exception as exc:
        print(f"[SCHEDULE] Item schedule check error: {exc}", file=sys.stderr)


def auction_close_loop():
    """Background loop that settles expired auctions and sends reminders."""
    while True:
        threading.Event().wait(_CLOSE_WORKER_INTERVAL)
        try:
            _check_item_schedules()
        except Exception as exc:
            print(f"[SCHEDULE] Schedule worker error: {exc}", file=sys.stderr)
        try:
            _auto_start_auctions()
        except Exception as exc:
            print(f"[AUCTION] Auto-start worker error: {exc}", file=sys.stderr)
        try:
            _cycle_result = announce_previous_cycle_if_due()
            if not _cycle_result.get("ok"):
                print(
                    f"[CYCLE] Announcement failed: {_cycle_result.get('error', 'unknown error')}",
                    file=sys.stderr,
                )
        except Exception as exc:
            print(f"[CYCLE] Announcement worker error: {exc}", file=sys.stderr)
        try:
            _cleanup_orphaned_auctions()
        except Exception as exc:
            print(f"[AUCTION] Orphan cleanup error: {exc}", file=sys.stderr)
        try:
            _cleanup_orphaned_reservations()
        except Exception as exc:
            print(f"[AUCTION] Orphan reservation cleanup error: {exc}", file=sys.stderr)
        try:
            _send_ending_soon_reminders()
        except Exception as exc:
            print(f"[AUCTION] Reminder worker error: {exc}", file=sys.stderr)
        try:
            _close_expired_auctions()
        except Exception as exc:
            print(f"[AUCTION] Close worker error: {exc}", file=sys.stderr)
        try:
            from shop.knight_bonus import scan_knight_promotions
            scan_knight_promotions()
        except Exception as exc:
            print(f"[KNIGHT-BONUS] Worker error: {exc}", file=sys.stderr)
        try:
            from shop.death_tax import process_death_tax
            process_death_tax()
        except Exception as exc:
            print(f"[DEATH-TAX] Worker error: {exc}", file=sys.stderr)

_auction_worker_started = False

def start_auction_close_worker() -> bool:
    """Start the background auction-close daemon thread.

    The worker must run on exactly one deployment so auction DMs are sent once.
    It is skipped when RUN_AUCTION_WORKER is False (DEV_MODE / local testing)
    and is idempotent within a process. Returns True if a worker thread was
    started by this call.
    """
    global _auction_worker_started
    if not RUN_AUCTION_WORKER:
        print("[AUCTION] Close worker disabled (DEV_MODE or ESI_RUN_AUCTION_WORKER=0); "
              "the production instance owns auction notifications.", file=sys.stderr)
        return False
    if _auction_worker_started:
        print("[AUCTION] Close worker already started in this process; skipping.",
              file=sys.stderr)
        return False
    _auction_worker_started = True
    threading.Thread(target=auction_close_loop, daemon=True).start()
    return True
