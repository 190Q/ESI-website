"""Calculate raid raffle tickets from guild-raid activity.

1 ticket per 5 guild raids, capped at 100 tickets per player.

Usage:
    python scripts/raffle_tickets.py
    python scripts/raffle_tickets.py --min-raids 10
    python scripts/raffle_tickets.py --output raffle.csv
    python scripts/raffle_tickets.py --dry-run
"""

from __future__ import annotations
import argparse
import csv
import json
import os
import sys
from typing import Any

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from config import CACHE_URL, _POINTS_DB

RAIDS_PER_TICKET = 5
MAX_TICKETS = 100


def _fetch_cache_activity() -> dict[str, Any] | None:
    """Try to read live activity metrics from the cache service."""
    try:
        import requests

        resp = requests.get(f"{CACHE_URL}/cache/activity", timeout=10)
        if resp.ok:
            return resp.json() or {}
    except Exception:
        pass
    return None


def _fetch_raid_counts_from_points_db() -> dict[str, int]:
    """Fallback: sum guild-raid EP from history tables and convert to raid count.

    Each guild raid is worth 10 EP in the points system, so raids = ep // 10.
    """
    counts: dict[str, int] = {}
    if not os.path.isfile(_POINTS_DB):
        return counts

    import sqlite3

    try:
        conn = sqlite3.connect(_POINTS_DB, timeout=5)
        conn.row_factory = sqlite3.Row
        tables = [
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'player_%'"
            ).fetchall()
        ]
        for table in tables:
            try:
                rows = conn.execute(
                    f'SELECT username, SUM(points_gained) AS ep '
                    f'FROM "{table}" '
                    f'WHERE LOWER(reason) LIKE "guild raid%"'
                ).fetchall()
            except sqlite3.Error:
                continue
            for row in rows:
                username = (row["username"] or "").strip()
                ep = int(row["ep"] or 0)
                if username and ep > 0:
                    counts[username] = counts.get(username, 0) + ep // 10
        conn.close()
    except sqlite3.Error:
        pass
    return counts


def _activity_raid_counts(activity: dict[str, Any] | None) -> dict[str, int]:
    """Extract per-player guild-raid totals from the activity cache payload."""
    counts: dict[str, int] = {}
    if not isinstance(activity, dict):
        return counts
    members = activity.get("members")
    if not isinstance(members, dict):
        return counts
    for key, entry in members.items():
        if not isinstance(entry, dict):
            continue
        username = (entry.get("username") or key or "").strip()
        if not username:
            continue
        graids = entry.get("guildRaids")
        if isinstance(graids, list):
            total = sum(int(g or 0) for g in graids)
        else:
            total = int(graids or 0)
        if total > 0:
            counts[username] = counts.get(username, 0) + total
    return counts


def calculate_tickets(raid_counts: dict[str, int]) -> list[dict[str, Any]]:
    """Return sorted list of {username, raids, tickets} capped at MAX_TICKETS."""
    results = []
    for username, raids in raid_counts.items():
        tickets = min(raids // RAIDS_PER_TICKET, MAX_TICKETS)
        if tickets > 0:
            results.append({"username": username, "raids": raids, "tickets": tickets})
    results.sort(key=lambda r: (-r["tickets"], r["username"].lower()))
    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Calculate raffle tickets from guild-raid activity."
    )
    parser.add_argument(
        "--min-raids",
        type=int,
        default=RAIDS_PER_TICKET,
        help=f"Minimum raids required to receive any ticket (default {RAIDS_PER_TICKET}).",
    )
    parser.add_argument(
        "--output",
        "-o",
        default="-",
        help="Write CSV to this path; '-' prints to stdout.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print as JSON instead of CSV.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read data and print counts, but do not write any file.",
    )
    args = parser.parse_args()

    activity = _fetch_cache_activity()
    raid_counts = _activity_raid_counts(activity)
    if not raid_counts:
        raid_counts = _fetch_raid_counts_from_points_db()

    min_raids = max(1, args.min_raids)
    filtered = {u: c for u, c in raid_counts.items() if c >= min_raids}
    results = calculate_tickets(filtered)

    total_tickets = sum(r["tickets"] for r in results)
    total_raids = sum(r["raids"] for r in results)

    if args.dry_run or args.output == "-":
        if args.json:
            payload = {
                "raids_per_ticket": RAIDS_PER_TICKET,
                "max_tickets": MAX_TICKETS,
                "min_raids": min_raids,
                "total_raids": total_raids,
                "total_tickets": total_tickets,
                "players": results,
            }
            print(json.dumps(payload, indent=2, ensure_ascii=False))
        else:
            print(f"raids_per_ticket={RAIDS_PER_TICKET} max_tickets={MAX_TICKETS}")
            print(
                f"players={len(results)} total_raids={total_raids} "
                f"total_tickets={total_tickets}"
            )
            for r in results:
                print(f"{r['username']}: raids={r['raids']} tickets={r['tickets']}")
        return 0

    out_path = os.path.abspath(args.output)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["username", "raids", "tickets"])
        writer.writeheader()
        writer.writerows(results)
    print(f"Wrote {len(results)} rows to {out_path}")
    print(f"Total raids: {total_raids}, total tickets: {total_tickets}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
