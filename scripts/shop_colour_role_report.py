"""
shop_colour_role_report.py - Cross-reference "Shop Colour" role holders with
custom-role-colour purchases for the current and previous EP cycle.

What it does:
  1. Finds every Discord guild role whose name contains "Shop Colour" and
     collects the members currently holding one of those roles.
  2. Reads the shop purchase ledger (``bin_purchases`` in ``shop.db``) and
     collects everyone who bought the ``custom-role-colour`` item during the
     current cycle and the previous cycle.
  3. Prints every role holder annotated with whether they bought it the
     previous cycle and/or this cycle, so you can see who still owes a
     renewal before the role is stripped.

Buyers are matched to Discord members through the uuid -> Discord ID mapping
in ``username_matches.json`` (with a Minecraft-username fallback).

Usage:
    python scripts/shop_colour_role_report.py
    python scripts/shop_colour_role_report.py --cycle 13
    python scripts/shop_colour_role_report.py --json
    python scripts/shop_colour_role_report.py --role-needle "custom role"

The Discord API is used for roles + members. Both can be supplied from disk
instead (handy for offline testing) with ``--roles-file`` / ``--members-file``
using the raw JSON shapes returned by:
    GET /guilds/{guild_id}/roles
    GET /guilds/{guild_id}/members?limit=1000
"""

from __future__ import annotations

import argparse
import json
import os
import sqlite3
import sys
from datetime import datetime as _dt, timezone as _tz

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_THIS_DIR)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

import requests

from config import (
    DISCORD_API,
    DISCORD_GUILD_ID,
    DISCORD_TOKEN,
    _SHOP_DB,
    _USERNAME_MATCHES_JSON,
)
from shop.bin import _get_cycle_bounds, _get_cycle_id

_ITEM_ID = "custom-role-colour"
_ROLE_NEEDLE = "shop colour"

_NOT_PURCHASED_STATUSES = {"rejected", "refunded", "cancelled", "refund_pending"}

_MEMBERS_PAGE = 1000


def _discord_get(path: str):
    """GET a Discord API path, returning the decoded JSON body."""
    if not DISCORD_TOKEN:
        raise SystemExit("DISCORD_TOKEN is not configured (check .env / .env.local).")
    resp = requests.get(
        f"{DISCORD_API}{path}",
        headers={"Authorization": f"Bot {DISCORD_TOKEN}"},
        timeout=20,
    )
    if resp.status_code == 403:
        raise SystemExit(
            "Discord returned 403. The bot needs the privileged GUILD_MEMBERS "
            "intent enabled to list guild members."
        )
    if not resp.ok:
        raise SystemExit(f"Discord returned {resp.status_code} for {path}: {resp.text[:200]}")
    return resp.json()


def _load_roles(roles_file: str | None) -> list[dict]:
    if roles_file:
        with open(roles_file, encoding="utf-8") as fh:
            return json.load(fh)
    if not DISCORD_GUILD_ID:
        raise SystemExit("DISCORD_GUILD_ID is not configured (check .env / .env.local).")
    return _discord_get(f"/guilds/{DISCORD_GUILD_ID}/roles")


def _load_members(members_file: str | None) -> list[dict]:
    """Return every guild member, paginating the Discord API as needed."""
    if members_file:
        with open(members_file, encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict):
            return data.get("members") or []
        return data
    if not DISCORD_GUILD_ID:
        raise SystemExit("DISCORD_GUILD_ID is not configured (check .env / .env.local).")

    members: list[dict] = []
    after = None
    while True:
        query = f"?limit={_MEMBERS_PAGE}"
        if after:
            query += f"&after={after}"
        batch = _discord_get(f"/guilds/{DISCORD_GUILD_ID}/members{query}")
        if not isinstance(batch, list) or not batch:
            break
        members.extend(batch)
        if len(batch) < _MEMBERS_PAGE:
            break
        after = (batch[-1].get("user") or {}).get("id")
        if not after:
            break
    return members


def _shop_colour_roles(roles: list[dict], needle: str) -> dict[str, str]:
    """Map role_id -> role_name for every role whose name contains *needle*."""
    needle = needle.strip().lower()
    out: dict[str, str] = {}
    for role in roles or []:
        name = str(role.get("name") or "")
        if needle and needle in name.lower():
            out[str(role.get("id"))] = name
    return out


def _load_identity_maps() -> tuple[dict[str, str], dict[str, dict], dict[str, str]]:
    """Build lookup maps from ``username_matches.json``.

    Returns ``(uuid_to_discord, discord_to_profile, username_to_discord)``.
    """
    try:
        with open(_USERNAME_MATCHES_JSON, encoding="utf-8") as fh:
            matches = json.load(fh) or {}
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[WARN] Could not read {_USERNAME_MATCHES_JSON}: {exc}", file=sys.stderr)
        matches = {}

    uuid_to_discord: dict[str, str] = {}
    discord_to_profile: dict[str, dict] = {}
    username_to_discord: dict[str, str] = {}
    for discord_id, entry in matches.items():
        did = str(discord_id).strip()
        if not did.isdigit() or not isinstance(entry, dict):
            continue
        uuid = str(entry.get("uuid") or "").strip().lower()
        username = str(entry.get("username") or "").strip()
        discord_to_profile[did] = {"uuid": uuid, "username": username}
        if uuid:
            uuid_to_discord[uuid] = did
        if username:
            username_to_discord[username.lower()] = did
    return uuid_to_discord, discord_to_profile, username_to_discord


def _parse_iso(value: str):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = _dt.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=_tz.utc)
    return parsed.astimezone(_tz.utc)


def _fetch_cycle_buyers(conn: sqlite3.Connection, item_id: str, cycle_id: int) -> dict:
    """Return who bought *item_id* during *cycle_id*.

    Result: ``{"uuids": set, "usernames": set, "rows": [ {uuid, username, at} ]}``.
    """
    start, end = _get_cycle_bounds(cycle_id)
    empty = {"uuids": set(), "usernames": set(), "rows": []}
    if not os.path.isfile(_SHOP_DB):
        return empty

    rows = conn.execute(
        "SELECT uuid, username, status, purchased_at FROM bin_purchases "
        "WHERE item_id = ?",
        (item_id,),
    ).fetchall()

    uuids: set[str] = set()
    usernames: set[str] = set()
    picked: list[dict] = []
    for uuid, username, status, purchased_at in rows:
        if str(status or "").strip().lower() in _NOT_PURCHASED_STATUSES:
            continue
        at = _parse_iso(purchased_at)
        if at is None or not (start <= at < end):
            continue
        uid = str(uuid or "").strip().lower()
        uname = str(username or "").strip()
        if uid:
            uuids.add(uid)
        if uname:
            usernames.add(uname.lower())
        picked.append({"uuid": uid, "username": uname, "purchased_at": purchased_at})

    picked.sort(key=lambda r: r["purchased_at"] or "")
    return {"uuids": uuids, "usernames": usernames, "rows": picked}


def _bought(buyers: dict, profile: dict | None, role_name: str) -> bool:
    """True if the profile (or the role-name suffix) matches a buyer."""
    uuid = (profile or {}).get("uuid", "")
    if uuid and uuid in buyers["uuids"]:
        return True
    candidates = []
    if profile and profile.get("username"):
        candidates.append(profile["username"].lower())
    # Roles are named "Shop Colour <name>"; that suffix is a useful fallback.
    suffix = role_name.split(" ", 2)[-1].strip().lower() if role_name else ""
    if suffix:
        candidates.append(suffix)
    return any(c in buyers["usernames"] for c in candidates)


def _collect_report(args) -> dict:
    current_cycle = args.cycle if args.cycle is not None else _get_cycle_id()
    prev_cycle = current_cycle - 1

    roles = _load_roles(args.roles_file)
    members = _load_members(args.members_file)
    colour_roles = _shop_colour_roles(roles, args.role_needle)

    _uuid_to_discord, discord_to_profile, _username_to_discord = _load_identity_maps()

    # role_id -> members holding it
    holders: list[dict] = []
    seen_discord_ids: set[str] = set()
    for member in members:
        member_roles = {str(r) for r in (member.get("roles") or [])}
        matched_role_ids = [rid for rid in colour_roles if rid in member_roles]
        if not matched_role_ids:
            continue
        user = member.get("user") or {}
        discord_id = str(user.get("id") or "").strip()
        if not discord_id or discord_id in seen_discord_ids:
            continue
        seen_discord_ids.add(discord_id)
        holders.append({
            "discord_id": discord_id,
            "discord_name": member.get("nick") or user.get("global_name")
            or user.get("username") or "",
            "roles": sorted(colour_roles[rid] for rid in matched_role_ids),
            "profile": discord_to_profile.get(discord_id),
        })

    conn = sqlite3.connect(_SHOP_DB, timeout=10) if os.path.isfile(_SHOP_DB) else None
    try:
        prev_buyers = (
            _fetch_cycle_buyers(conn, args.item_id, prev_cycle) if conn
            else {"uuids": set(), "usernames": set(), "rows": []}
        )
        this_buyers = (
            _fetch_cycle_buyers(conn, args.item_id, current_cycle) if conn
            else {"uuids": set(), "usernames": set(), "rows": []}
        )
    finally:
        if conn:
            conn.close()

    for holder in holders:
        primary_role = holder["roles"][0] if holder["roles"] else ""
        holder["bought_prev"] = _bought(prev_buyers, holder["profile"], primary_role)
        holder["bought_this"] = _bought(this_buyers, holder["profile"], primary_role)
        holder["linked"] = bool(holder["profile"] and holder["profile"].get("uuid"))

    holders.sort(key=lambda h: (h["discord_name"] or "").lower())

    holder_ids = {h["discord_id"] for h in holders}
    unroled: list[dict] = []
    for label, buyers, flag in (
        (f"cycle {prev_cycle}", prev_buyers, "bought_prev"),
        (f"cycle {current_cycle}", this_buyers, "bought_this"),
    ):
        for row in buyers["rows"]:
            uid = row["uuid"]
            did = _uuid_to_discord.get(uid)
            if did and did in holder_ids:
                continue
            unroled.append({
                "cycle": label,
                "uuid": uid,
                "username": row["username"],
                "discord_id": did,
                "purchased_at": row["purchased_at"],
            })

    return {
        "current_cycle": current_cycle,
        "previous_cycle": prev_cycle,
        "current_cycle_bounds": [d.isoformat() for d in _get_cycle_bounds(current_cycle)],
        "previous_cycle_bounds": [d.isoformat() for d in _get_cycle_bounds(prev_cycle)],
        "role_needle": args.role_needle,
        "item_id": args.item_id,
        "matched_roles": colour_roles,
        "holders": holders,
        "buyers_without_role": unroled,
        "buyer_counts": {
            "previous": len(prev_buyers["uuids"]),
            "current": len(this_buyers["uuids"]),
        },
    }


def _print_report(report: dict) -> None:
    cur, prev = report["current_cycle"], report["previous_cycle"]
    cur_start, cur_end = report["current_cycle_bounds"]
    prev_start, prev_end = report["previous_cycle_bounds"]

    print(f"Shop Colour role report  (item: {report['item_id']})")
    print(f"  Current cycle : {cur}  {cur_start} -> {cur_end}")
    print(f"  Previous cycle: {prev}  {prev_start} -> {prev_end}")
    print(f"  Matched roles : {len(report['matched_roles'])} "
          f"(names containing {report['role_needle']!r})")
    print(f"  Buyers        : prev={report['buyer_counts']['previous']} "
          f"this={report['buyer_counts']['current']}")
    print()

    holders = report["holders"]
    if not holders:
        print("No members currently hold a matching role.")
        return

    rows = []
    for h in holders:
        name = (h["profile"] or {}).get("username") or h["discord_name"] or "?"
        if not h["linked"]:
            name += " (unlinked)"
        rows.append([
            name,
            h["discord_id"],
            ", ".join(h["roles"]),
            "yes" if h["bought_prev"] else "no",
            "yes" if h["bought_this"] else "no",
        ])

    headers = ["User", "Discord ID", "Role", f"Cycle {prev}", f"Cycle {cur}"]
    widths = [len(x) for x in headers]
    for row in rows:
        for i, cell in enumerate(row):
            widths[i] = max(widths[i], len(cell))

    def _line(cells):
        return "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(cells)).rstrip()

    print(_line(headers))
    print("  ".join("-" * w for w in widths))
    for row in rows:
        print(_line(row))

    print()
    print(f"Users holding a Shop Colour role: {len(rows)}")
    missing = [r for r in rows if r[4] == "no"]
    print(f"  - did NOT buy this cycle (cycle {cur}): {len(missing)}")
    for r in missing:
        print(f"      {r[0]}  [{r[2]}]")

    unroled = report["buyers_without_role"]
    if unroled:
        print()
        print("Bought the item but do NOT currently hold a Shop Colour role:")
        for row in unroled:
            who = row["username"] or row["uuid"] or "?"
            did = row["discord_id"] or "unlinked"
            print(f"  - {who}  (discord {did})  {row['cycle']}  {row['purchased_at']}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cycle", type=int, default=None,
                        help="Current cycle id (default: the live cycle).")
    parser.add_argument("--item-id", default=_ITEM_ID,
                        help=f"Shop item id to check (default: {_ITEM_ID}).")
    parser.add_argument("--role-needle", default=_ROLE_NEEDLE,
                        help=f"Role-name substring to match (default: {_ROLE_NEEDLE!r}).")
    parser.add_argument("--roles-file", default=None,
                        help="Read roles from a JSON file instead of the Discord API.")
    parser.add_argument("--members-file", default=None,
                        help="Read members from a JSON file instead of the Discord API.")
    parser.add_argument("--json", action="store_true",
                        help="Emit the raw report as JSON.")
    args = parser.parse_args()

    report = _collect_report(args)
    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        _print_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
