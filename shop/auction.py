import os
import sqlite3
import sys
import threading
import uuid as _uuid_mod
from datetime import datetime as _dt, timezone as _tz, timedelta as _td

import requests as _requests

from config import (
    _SHOP_DB, _POINTS_DB,
    _USERNAME_MATCHES_JSON, _load_json_file,
    DISCORD_API, DISCORD_TOKEN,
)
from shop.ep_balance import (
    resolve_uuid_for_user, fetch_ep_balance, resolve_spend, InsufficientFunds,
)
from shop.items import get_item, get_item_unfiltered
from shop.bin import build_user_tags, PurchaseError, _get_cycle_id, _get_cycle_bounds


def _discord_headers():
    return {"Authorization": f"Bot {DISCORD_TOKEN}", "Content-Type": "application/json"}


def _resolve_discord_id_for_uuid(mc_uuid: str) -> str | None:
    """Reverse-lookup: MC UUID → Discord ID via username_matches.json."""
    matches = _load_json_file(_USERNAME_MATCHES_JSON)
    for did, entry in matches.items():
        if isinstance(entry, dict) and entry.get("uuid") == mc_uuid:
            return did
    return None

def _send_discord_dm(discord_id: str, content: str) -> bool:
    """Open a DM channel and send a message. Returns True on success."""
    if not DISCORD_TOKEN or not discord_id:
        return False
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
        msg = _requests.post(
            f"{DISCORD_API}/channels/{channel_id}/messages",
            json={"content": content[:2000]},
            headers=_discord_headers(), timeout=10,
        )
        return msg.ok
    except _requests.RequestException:
        return False

_DM_FOOTER = "\n-# _You can manage notification preferences in your website settings._"

def _dm_in_background(discord_id: str, content: str, low_urgency: bool = False):
    """Fire-and-forget DM. If low_urgency=True, checks opt-out preference first."""
    if low_urgency and _is_dm_opted_out(discord_id):
        return
    full = content + _DM_FOOTER
    threading.Thread(
        target=_send_discord_dm, args=(discord_id, full), daemon=True,
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

def list_auctions(discord_id: str) -> dict:
    """Return active + recently-closed auctions, enriched for the logged-in user."""
    mc_uuid, mc_username = resolve_uuid_for_user(discord_id)
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
                        "SELECT bid_id, amount, is_winning, autobid_ceiling "
                        "FROM bids WHERE auction_id = ? AND uuid = ? "
                        "ORDER BY amount DESC LIMIT 1",
                        (aid, mc_uuid),
                    ).fetchone()
                    if ub:
                        user_bid = {
                            "bid_id": ub["bid_id"],
                            "amount": ub["amount"],
                            "is_winning": bool(ub["is_winning"]),
                            "autobid_ceiling": ub["autobid_ceiling"],
                        }

                # item metadata
                item = get_item_unfiltered(row["item_id"])
                if not item:
                    continue

                ends_at = _dt.fromisoformat(row["ends_at"])
                if ends_at.tzinfo is None:
                    ends_at = ends_at.replace(tzinfo=_tz.utc)
                remaining = max(0, (ends_at - now).total_seconds())

                ext_hours = _compute_extended_hours(row, item)
                auctions.append({
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
                    "max_autobid":      bool(item.get("max_autobid", False)),
                    "item_category":    item.get("category") or [],
                    "item_images":      item.get("images") or [],
                    "active":           item.get("active", True),
                    "user_bid":         user_bid,
                })
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
    autobid_ceiling: int | None = None,
) -> dict:
    """Validate and place a bid. Returns the new bid record.

    Manages EP reservations in esi_points.db atomically with
    the bid insertion in shop.db.
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
        if not item.get("active", True):
            shop_conn.rollback()
            raise PurchaseError("This auction is currently paused", 409)

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
            # Allow updating autobid ceiling on existing bid
            if autobid_ceiling is not None:
                # Ceiling must be at least current_high + increment
                _ab_min = current_high + min_increment
                if autobid_ceiling < _ab_min:
                    shop_conn.rollback()
                    raise PurchaseError(
                        f"Autobid ceiling must be at least {_ab_min} EP (current bid + increment)",
                        400,
                    )
                # Validate ceiling against available EP
                user_bal = fetch_ep_balance(mc_uuid)
                _so = item.get("spend_order", "clean_first")
                if not item.get("accepts_dirty_ep", False):
                    _so = "clean_only"
                if _so == "clean_only":
                    _max_ep = user_bal.get("spendable_clean", 0)
                elif _so == "dirty_only":
                    _max_ep = user_bal.get("spendable_dirty", 0)
                else:
                    _max_ep = user_bal.get("spendable_clean", 0) + user_bal.get("spendable_dirty", 0)
                if autobid_ceiling > _max_ep:
                    shop_conn.rollback()
                    raise PurchaseError(
                        f"Autobid ceiling ({autobid_ceiling} EP) exceeds your available EP ({_max_ep} EP)",
                        400,
                    )
                shop_conn.execute(
                    "UPDATE bids SET autobid_ceiling = ? "
                    "WHERE auction_id = ? AND uuid = ? AND is_winning = 1",
                    (autobid_ceiling, auction_id, mc_uuid),
                )
                shop_conn.commit()
                shop_conn.close()
                item_name = item.get("name", arow["item_id"])
                bidder_did = _resolve_discord_id_for_uuid(mc_uuid)
                if bidder_did:
                    _dm_in_background(
                        bidder_did,
                        f"\u2705 Your autobid limit on **{item_name}** has been updated to **{autobid_ceiling} EP**.",
                        low_urgency=True,
                    )
                return {
                    "ok": True,
                    "bid_id": None,
                    "auction_id": auction_id,
                    "amount": current_high,
                    "clean_ep_used": 0,
                    "dirty_ep_used": 0,
                    "is_autobid": True,
                    "extended": False,
                    "placed_at": now_iso,
                    "autobid_resolved": False,
                    "final_amount": current_high,
                    "ceiling_updated": True,
                }
            shop_conn.rollback()
            raise PurchaseError("You are already the highest bidder", 409)

        # dirty EP eligibility
        spend_order = item.get("spend_order", "clean_first")
        if not item.get("accepts_dirty_ep", False):
            spend_order = "clean_only"

        # Validate autobid ceiling
        if autobid_ceiling is not None:
            if autobid_ceiling < min_required:
                shop_conn.rollback()
                raise PurchaseError(
                    f"Autobid ceiling must be at least {min_required} EP (current bid + increment)",
                    400,
                )
            user_bal = fetch_ep_balance(mc_uuid)
            if spend_order == "clean_only":
                max_ep = user_bal.get("spendable_clean", 0)
            elif spend_order == "dirty_only":
                max_ep = user_bal.get("spendable_dirty", 0)
            else:
                max_ep = user_bal.get("spendable_clean", 0) + user_bal.get("spendable_dirty", 0)
            if autobid_ceiling > max_ep:
                shop_conn.rollback()
                raise PurchaseError(
                    f"Autobid ceiling ({autobid_ceiling} EP) exceeds your available EP ({max_ep} EP)",
                    400,
                )

        # resolve EP split (this checks sufficiency accounting for reservations)
        split = resolve_spend(mc_uuid, amount, spend_order)
        clean_used = split["clean_to_spend"]
        dirty_used = split["dirty_to_spend"]

        # manage EP reservations in esi_points.db
        if not os.path.isfile(_POINTS_DB):
            shop_conn.rollback()
            raise PurchaseError("Points database unavailable", 503)

        pts_conn = sqlite3.connect(_POINTS_DB, timeout=10)
        try:
            pts_conn.execute("PRAGMA journal_mode=WAL")
            pts_conn.execute("BEGIN IMMEDIATE")

            # Release any prior reservation from this user on this auction
            pts_conn.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE uuid = ? AND source = ? AND released_at IS NULL",
                (now_iso, mc_uuid, f"auction:{auction_id}"),
            )

            # Create new reservations (one per EP type if non-zero)
            if clean_used > 0:
                pts_conn.execute(
                    "INSERT INTO ep_reservations "
                    "(reservation_id, uuid, username, reserved_amount, ep_type, source, created_at) "
                    "VALUES (?, ?, ?, ?, 'clean', ?, ?)",
                    (str(_uuid_mod.uuid4()), mc_uuid, mc_username or "", clean_used,
                     f"auction:{auction_id}", now_iso),
                )
            if dirty_used > 0:
                pts_conn.execute(
                    "INSERT INTO ep_reservations "
                    "(reservation_id, uuid, username, reserved_amount, ep_type, source, created_at) "
                    "VALUES (?, ?, ?, ?, 'dirty', ?, ?)",
                    (str(_uuid_mod.uuid4()), mc_uuid, mc_username or "", dirty_used,
                     f"auction:{auction_id}", now_iso),
                )

            pts_conn.commit()
        except Exception:
            pts_conn.rollback()
            shop_conn.rollback()
            raise
        finally:
            pts_conn.close()

        # release the displaced bidder's reservation
        if current_bidder and current_bidder != mc_uuid:
            try:
                pts_release = sqlite3.connect(_POINTS_DB, timeout=5)
                pts_release.execute(
                    "UPDATE ep_reservations SET released_at = ? "
                    "WHERE uuid = ? AND source = ? AND released_at IS NULL",
                    (now_iso, current_bidder, f"auction:{auction_id}"),
                )
                pts_release.commit()
                pts_release.close()
            except sqlite3.Error as exc:
                print(f"[AUCTION] Failed to release prior reservation: {exc}", file=sys.stderr)

        # insert bid row
        bid_id = str(_uuid_mod.uuid4())
        is_autobid = 1 if autobid_ceiling is not None else 0

        shop_conn.execute(
            "INSERT INTO bids "
            "(bid_id, auction_id, uuid, username, amount, clean_ep_used, dirty_ep_used, "
            " is_autobid, autobid_ceiling, placed_at, is_winning) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)",
            (bid_id, auction_id, mc_uuid, mc_username or "", amount,
             clean_used, dirty_used, is_autobid, autobid_ceiling, now_iso),
        )

        # Un-mark the previous highest bidder's winning flag
        if current_bidder:
            shop_conn.execute(
                "UPDATE bids SET is_winning = 0 "
                "WHERE auction_id = ? AND uuid = ? AND is_winning = 1",
                (auction_id, current_bidder),
            )

        # update auction state
        shop_conn.execute(
            "UPDATE auctions SET current_highest_bid = ?, current_highest_bidder_uuid = ? "
            "WHERE auction_id = ?",
            (amount, mc_uuid, auction_id),
        )

        # anti-snipe extension (capped at cycle_end - 2 days)
        anti_snipe = item.get("anti_snipe_seconds", 0) or 0
        extended = False
        if anti_snipe > 0:
            snipe_threshold = ends_at - _td(seconds=anti_snipe)
            if now >= snipe_threshold:
                new_ends = now + _td(seconds=anti_snipe)
                # Hard cap: never exceed cycle_end - 2 days
                cid = _get_cycle_id(now)
                _, cycle_end = _get_cycle_bounds(cid)
                max_ends = cycle_end - _td(days=2)
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

    # Autobid chain resolution (fire-and-forget, after main commit)
    autobid_result = _resolve_autobid_chain(
        auction_id, mc_uuid, amount, autobid_ceiling,
        current_bidder, min_increment, spend_order, item_name,
    )
    final_amount = autobid_result.get("final_amount", amount) if autobid_result else amount
    final_winner = autobid_result.get("final_winner", mc_uuid) if autobid_result else mc_uuid

    # DM: Bid confirmed (receipt)
    bidder_did = _resolve_discord_id_for_uuid(mc_uuid)
    if bidder_did:
        _dm_in_background(
            bidder_did,
            f"✅ Your bid of **{amount} EP** on **{item_name}** has been placed! "
            + (f"You are currently the highest bidder." if final_winner == mc_uuid
               else f"An autobidder has outbid you. The current high is **{final_amount} EP**."),
            low_urgency=True,
        )

    # DM: Outbid notification to displaced bidder (only if no autobid took over)
    if current_bidder and current_bidder != mc_uuid and not autobid_result:
        displaced_did = _resolve_discord_id_for_uuid(current_bidder)
        if displaced_did:
            _dm_in_background(
                displaced_did,
                f"⚠️ You have been outbid on **{item_name}**! "
                f"The new highest bid is **{amount} EP**. "
                f"Visit the shop to place a higher bid.",
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
                    _dm_in_background(
                        did,
                        f"⏰ The auction for **{item_name}** has been extended due to a last-minute bid. "
                        f"The new highest bid is **{final_amount} EP**. Check the shop for the updated end time.",
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
        "is_autobid":   bool(is_autobid),
        "extended":     extended,
        "placed_at":    now_iso,
        "autobid_resolved": autobid_result is not None,
        "final_amount":     final_amount,
    }

def _resolve_autobid_chain(
    auction_id: str,
    initial_bidder_uuid: str,
    initial_amount: int,
    initial_ceiling: int | None,
    displaced_uuid: str | None,
    min_increment: int,
    spend_order: str,
    item_name: str,
) -> dict | None:
    """After a bid, check if the displaced bidder has an autobid ceiling and
    resolve the chain. Returns None if no autobid happened, or a dict with
    final_amount and final_winner."""
    if not displaced_uuid:
        return None

    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=10)
        conn.row_factory = sqlite3.Row
    except sqlite3.Error:
        return None

    try:
        # Get the displaced bidder's most recent bid with autobid_ceiling
        displaced_bid = conn.execute(
            "SELECT autobid_ceiling, uuid, username FROM bids "
            "WHERE auction_id = ? AND uuid = ? ORDER BY amount DESC LIMIT 1",
            (auction_id, displaced_uuid),
        ).fetchone()

        if not displaced_bid or not displaced_bid["autobid_ceiling"]:
            conn.close()
            return None

        displaced_ceiling = displaced_bid["autobid_ceiling"]
        initial_ceiling = initial_ceiling or 0

        current_high = initial_amount
        current_winner = initial_bidder_uuid
        current_winner_ceiling = initial_ceiling

        challenger_uuid = displaced_uuid
        challenger_username = displaced_bid["username"]
        challenger_ceiling = displaced_ceiling

        dm_queue = []  # [(discord_id, message, low_urgency)]
        now_iso = _dt.now(_tz.utc).isoformat()

        conn.execute("BEGIN IMMEDIATE")

        # Resolution loop — max 100 iterations as safety
        for _ in range(100):
            counter_amount = current_high + min_increment

            # Can the challenger auto-bid?
            if challenger_ceiling < counter_amount:
                # Challenger's ceiling exhausted — notify them
                did = _resolve_discord_id_for_uuid(challenger_uuid)
                if did:
                    dm_queue.append((did,
                        f"\u26a0\ufe0f Your autobid limit of **{challenger_ceiling} EP** on "
                        f"**{item_name}** has been reached. The current highest bid is "
                        f"**{current_high} EP**. Visit the shop to bid manually.",
                        False,  # high urgency
                    ))
                break

            # Place the counter-bid
            try:
                split = resolve_spend(challenger_uuid, counter_amount, spend_order)
            except (InsufficientFunds, Exception):
                # Can't afford — treat as ceiling exhausted
                did = _resolve_discord_id_for_uuid(challenger_uuid)
                if did:
                    dm_queue.append((did,
                        f"\u26a0\ufe0f Your autobid on **{item_name}** could not be placed "
                        f"(insufficient EP). Your limit was **{challenger_ceiling} EP**.",
                        False,
                    ))
                break

            # Release old reservation for challenger
            pts = sqlite3.connect(_POINTS_DB, timeout=10)
            pts.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE uuid = ? AND source = ? AND released_at IS NULL",
                (now_iso, challenger_uuid, f"auction:{auction_id}"),
            )
            # Create new reservation
            if split["clean_to_spend"] > 0:
                pts.execute(
                    "INSERT INTO ep_reservations "
                    "(reservation_id, uuid, username, reserved_amount, ep_type, source, created_at) "
                    "VALUES (?, ?, ?, ?, 'clean', ?, ?)",
                    (str(_uuid_mod.uuid4()), challenger_uuid, challenger_username,
                     split["clean_to_spend"], f"auction:{auction_id}", now_iso),
                )
            if split["dirty_to_spend"] > 0:
                pts.execute(
                    "INSERT INTO ep_reservations "
                    "(reservation_id, uuid, username, reserved_amount, ep_type, source, created_at) "
                    "VALUES (?, ?, ?, ?, 'dirty', ?, ?)",
                    (str(_uuid_mod.uuid4()), challenger_uuid, challenger_username,
                     split["dirty_to_spend"], f"auction:{auction_id}", now_iso),
                )
            # Release old winner's reservation
            pts.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE uuid = ? AND source = ? AND released_at IS NULL",
                (now_iso, current_winner, f"auction:{auction_id}"),
            )
            pts.commit()
            pts.close()

            # Insert bid row
            new_bid_id = str(_uuid_mod.uuid4())
            conn.execute(
                "INSERT INTO bids "
                "(bid_id, auction_id, uuid, username, amount, clean_ep_used, dirty_ep_used, "
                " is_autobid, autobid_ceiling, placed_at, is_winning) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 1)",
                (new_bid_id, auction_id, challenger_uuid, challenger_username,
                 counter_amount, split["clean_to_spend"], split["dirty_to_spend"],
                 challenger_ceiling, now_iso),
            )
            # Un-mark previous winner
            conn.execute(
                "UPDATE bids SET is_winning = 0 "
                "WHERE auction_id = ? AND uuid = ? AND is_winning = 1 AND bid_id != ?",
                (auction_id, current_winner, new_bid_id),
            )
            # Update auction
            conn.execute(
                "UPDATE auctions SET current_highest_bid = ?, current_highest_bidder_uuid = ? "
                "WHERE auction_id = ?",
                (counter_amount, challenger_uuid, auction_id),
            )

            # DM: autobid placed
            did = _resolve_discord_id_for_uuid(challenger_uuid)
            if did:
                dm_queue.append((did,
                    f"\u2705 Your autobid placed a bid of **{counter_amount} EP** on "
                    f"**{item_name}** (limit: {challenger_ceiling} EP).",
                    True,  # low urgency
                ))

            # Swap roles for next iteration
            prev_winner = current_winner
            current_high = counter_amount
            current_winner = challenger_uuid
            current_winner_ceiling = challenger_ceiling
            challenger_uuid = prev_winner
            # Get the prev_winner's ceiling
            pw_bid = conn.execute(
                "SELECT autobid_ceiling, username FROM bids "
                "WHERE auction_id = ? AND uuid = ? ORDER BY amount DESC LIMIT 1",
                (auction_id, challenger_uuid),
            ).fetchone()
            challenger_username = pw_bid["username"] if pw_bid else ""
            challenger_ceiling = (pw_bid["autobid_ceiling"] or 0) if pw_bid else 0

            if challenger_ceiling <= 0:
                # Other side has no autobid — done
                break

        conn.commit()
        conn.close()

        # Fire all queued DMs
        for did, msg, low in dm_queue:
            _dm_in_background(did, msg, low_urgency=low)

        if current_high > initial_amount:
            return {"final_amount": current_high, "final_winner": current_winner}
        return None

    except Exception as exc:
        try:
            conn.rollback()
        except Exception:
            pass
        conn.close()
        print(f"[AUCTION] Autobid chain error: {exc}", file=sys.stderr)
        return None


_CLOSE_WORKER_INTERVAL = 60  # seconds
_REMINDER_HOURS = 6  # hours before close to send reminder
_reminded_auctions: set = set()  # in-memory tracker for ending-soon reminders

def _send_ending_soon_reminders():
    """DM all bidders on auctions ending within _REMINDER_HOURS."""
    now = _dt.now(_tz.utc)
    threshold = (now + _td(hours=_REMINDER_HOURS)).isoformat()
    now_iso = now.isoformat()

    if not os.path.isfile(_SHOP_DB):
        return

    try:
        conn = sqlite3.connect(_SHOP_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        soon = conn.execute(
            "SELECT * FROM auctions WHERE status = 'active' AND ends_at <= ? AND ends_at > ?",
            (threshold, now_iso),
        ).fetchall()
        for arow in soon:
            aid = arow["auction_id"]
            if aid in _reminded_auctions:
                continue
            _reminded_auctions.add(aid)
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
                did = _resolve_discord_id_for_uuid(b["uuid"])
                if did:
                    _dm_in_background(
                        did,
                        f"⏳ The auction for **{item_name}** is ending in ~**{remaining_h}h**! "
                        f"Current highest bid: **{arow['current_highest_bid']} EP**. "
                        f"Visit the shop if you want to place a final bid.",
                        low_urgency=True,
                    )
        conn.close()
    except sqlite3.Error as exc:
        print(f"[AUCTION] Ending-soon reminder error: {exc}", file=sys.stderr)

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
        _reminded_auctions.discard(auction["auction_id"])  # cleanup
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
    if os.path.isfile(_POINTS_DB):
        try:
            pts = sqlite3.connect(_POINTS_DB, timeout=10)
            pts.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE source = ? AND released_at IS NULL",
                (now_iso, source),
            )
            pts.commit()
            pts.close()
        except sqlite3.Error as exc:
            print(f"[AUCTION] Failed to release EP for orphan {auction_id}: {exc}",
                  file=sys.stderr)

    # DM all bidders
    for b in bidders:
        did = _resolve_discord_id_for_uuid(b["uuid"])
        if did:
            _dm_in_background(
                did,
                f"The auction for **{item_id}** has been cancelled because the item "
                f"was removed from the shop. Your reserved EP has been released."
            )


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

        # Determine candidates (top winner_count distinct UUIDs)
        candidates = []
        seen_uuids: set = set()
        for bid in all_bids:
            if bid["uuid"] not in seen_uuids and len(candidates) < winner_count:
                candidates.append(bid)
                seen_uuids.add(bid["uuid"])

        # Re-validate each candidate's EP balance at settlement time
        winners: list = []
        disqualified_uuids: set = set()
        for w in candidates:
            bal     = fetch_ep_balance(w["uuid"])
            have    = (bal.get("clean_ep", 0) or 0) + (bal.get("dirty_ep", 0) or 0)
            need    = w["amount"]
            if have >= need:
                winners.append(w)
            else:
                disqualified_uuids.add(w["uuid"])
                print(
                    f"[AUCTION] {aid}: winner {w['username']} has insufficient EP "
                    f"(need {need}, have {have}) — disqualified at settlement.",
                    file=sys.stderr,
                )

        winner_uuids = {w["uuid"] for w in winners}
        loser_uuids  = {b["uuid"] for b in all_bids
                        if b["uuid"] not in winner_uuids}

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

        # Insert bin_purchases-equivalent records for winners (EP deduction)
        for w in winners:
            shop_conn.execute(
                "INSERT INTO bin_purchases "
                "(purchase_id, item_id, uuid, username, ep_spent, clean_ep_spent, "
                " dirty_ep_spent, status, fulfillment_note, purchased_at, resolved_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'fulfilled', ?, ?, ?)",
                (
                    str(_uuid_mod.uuid4()), item_id, w["uuid"], w["username"],
                    w["amount"], w["clean_ep_used"], w["dirty_ep_used"],
                    item.get("fulfillment_note"), now_iso, now_iso,
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

    # Release EP reservations in esi_points.db
    source = f"auction:{aid}"
    if os.path.isfile(_POINTS_DB):
        try:
            pts = sqlite3.connect(_POINTS_DB, timeout=10)
            # Release ALL reservations for this auction (winners + losers).
            # Winners' EP is now accounted for via the bin_purchases row.
            pts.execute(
                "UPDATE ep_reservations SET released_at = ? "
                "WHERE source = ? AND released_at IS NULL",
                (now_iso, source),
            )
            pts.commit()
            pts.close()
        except sqlite3.Error as exc:
            print(f"[AUCTION] Failed to release reservations for {aid}: {exc}", file=sys.stderr)

    # Discord DM notifications
    item_name = item.get("name", item_id)

    if winners:
        # DM: Auction won
        for w in winners:
            did = _resolve_discord_id_for_uuid(w["uuid"])
            if did:
                msg = (f"🎉 Congratulations! You won the auction for **{item_name}** "
                       f"with a bid of **{w['amount']} EP**!")
                if item.get("fulfillment_note"):
                    msg += f"\n\n**What happens next:** _{item['fulfillment_note']}_"
                _dm_in_background(did, msg)

        # DM: Auction lost
        for uuid in loser_uuids:
            did = _resolve_discord_id_for_uuid(uuid)
            if did:
                _dm_in_background(
                    did,
                    f"The auction for **{item_name}** has closed and your bid was not the winning bid. "
                    f"Your reserved EP has been released.",
                )

        # DM: Disqualified due to insufficient EP at settlement
        for uuid in disqualified_uuids:
            did = _resolve_discord_id_for_uuid(uuid)
            if did:
                _dm_in_background(
                    did,
                    f"Your winning bid on **{item_name}** could not be settled because your "
                    f"available EP was insufficient at the time of settlement. "
                    f"Your reserved EP has been released.",
                )
    else:
        # DM: Auction closed with no winner — notify all bidders (if any)
        all_bidder_uuids = {b["uuid"] for b in all_bids}
        for uuid in all_bidder_uuids:
            did = _resolve_discord_id_for_uuid(uuid)
            if did:
                _dm_in_background(
                    did,
                    f"The auction for **{item_name}** has closed with no winner. "
                    f"Your reserved EP has been released.",
                )

def auction_close_loop():
    """Background loop that settles expired auctions and sends reminders."""
    while True:
        threading.Event().wait(_CLOSE_WORKER_INTERVAL)
        try:
            _cleanup_orphaned_auctions()
        except Exception as exc:
            print(f"[AUCTION] Orphan cleanup error: {exc}", file=sys.stderr)
        try:
            _send_ending_soon_reminders()
        except Exception as exc:
            print(f"[AUCTION] Reminder worker error: {exc}", file=sys.stderr)
        try:
            _close_expired_auctions()
        except Exception as exc:
            print(f"[AUCTION] Close worker error: {exc}", file=sys.stderr)

def start_auction_close_worker():
    """Start the background auction-close daemon thread."""
    threading.Thread(target=auction_close_loop, daemon=True).start()
