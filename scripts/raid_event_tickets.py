"""Calculate raid-event tickets for every participant.

The Oct 2026 raid event (``events/raid_event.py``) grants **one ticket per guild
raid** performed while the event is active, tallied once the event ends.  Every
participant receives at least one ticket.

Guild raids are read from the per-player history tables in ``esi_points.db``:
each raid is recorded with the reason ``"Guild Raid"`` and is worth 10 EP, so a
row's raid count is ``points_gained // 10`` (rows may group several raids).
Only rows inside the event window count.

Usage:
    python scripts/raid_event_tickets.py
    python scripts/raid_event_tickets.py --json
    python scripts/raid_event_tickets.py --output tickets.csv
    python scripts/raid_event_tickets.py --include-non-raiders
    python scripts/raid_event_tickets.py --start 2026-10-03T01:00:00Z --end 2026-11-03T01:00:00Z

Options:
    --start / --end       Override the event window (defaults to events/raid_event.py).
    --min-tickets N       Floor applied to every participant (default 1).
    --include-non-raiders Also give the floor to current guild members with 0 raids.
    --output PATH         Write a CSV (``-`` prints a table to stdout, the default).
    --json                Emit the full result as JSON.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
if _THIS_DIR not in sys.path:
    sys.path.insert(0, _THIS_DIR)

from _raid_event_common import (
    MIN_TICKETS,
    collect_guild_raids,
    load_roster,
    resolve_event_window,
    tickets_for_raids,
)


def build_tickets(
    start: datetime,
    end: datetime,
    min_tickets: int = MIN_TICKETS,
    include_non_raiders: bool = False,
) -> list[dict]:
    """Return ``[{username, uuid, raids, tickets}]`` sorted by tickets desc."""
    rows: list[dict] = []
    seen_uuids: set[str] = set()

    for entry in collect_guild_raids(start, end):
        uuid = entry.get("uuid")
        if uuid:
            seen_uuids.add(uuid.lower())
        rows.append({
            "username": entry.get("username") or (uuid or "?"),
            "uuid": uuid,
            "raids": int(entry.get("raids") or 0),
            "tickets": tickets_for_raids(entry.get("raids") or 0, min_tickets),
        })

    if include_non_raiders:
        for uid, info in load_roster().items():
            if uid in seen_uuids:
                continue
            rows.append({
                "username": info.get("username") or uid,
                "uuid": uid,
                "raids": 0,
                "tickets": tickets_for_raids(0, min_tickets),
            })

    rows.sort(key=lambda r: (-r["tickets"], -r["raids"], (r["username"] or "").lower()))
    return rows


def _print_table(start: datetime, end: datetime, rows: list[dict]) -> None:
    now = datetime.now(timezone.utc)
    state = "active" if start <= now < end else "closed"
    total_raids = sum(r["raids"] for r in rows)
    total_tickets = sum(r["tickets"] for r in rows)

    print(f"raid event window: {start.isoformat()} -> {end.isoformat()} ({state})")
    print(
        f"players={len(rows)} total_raids={total_raids} "
        f"total_tickets={total_tickets}"
    )
    if not rows:
        print("(no guild raids recorded in this window)")
        return

    name_w = max(len("username"), max(len(r["username"]) for r in rows))
    header = f"{'username'.ljust(name_w)}  {'raids':>6}  {'tickets':>7}"
    print(header)
    print("-" * len(header))
    for r in rows:
        print(f"{r['username'].ljust(name_w)}  {r['raids']:>6}  {r['tickets']:>7}")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--start", default=None, help="Event window start (ISO timestamp).")
    parser.add_argument("--end", default=None, help="Event window end (ISO timestamp).")
    parser.add_argument(
        "--min-tickets",
        type=int,
        default=MIN_TICKETS,
        help=f"Floor applied to every participant (default {MIN_TICKETS}).",
    )
    parser.add_argument(
        "--include-non-raiders",
        action="store_true",
        help="Also list current guild members with zero raids (they get the floor).",
    )
    parser.add_argument(
        "--output",
        "-o",
        default="-",
        help="Write CSV to this path; '-' prints a table to stdout (default).",
    )
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a table.")
    args = parser.parse_args()

    try:
        start, end = resolve_event_window(args.start, args.end)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    rows = build_tickets(
        start,
        end,
        min_tickets=max(0, args.min_tickets),
        include_non_raiders=args.include_non_raiders,
    )

    if args.json:
        print(json.dumps({
            "event_start": start.isoformat(),
            "event_end": end.isoformat(),
            "min_tickets": max(0, args.min_tickets),
            "players": rows,
            "total_raids": sum(r["raids"] for r in rows),
            "total_tickets": sum(r["tickets"] for r in rows),
        }, indent=2, ensure_ascii=False))
        return 0

    if args.output == "-":
        _print_table(start, end, rows)
        return 0

    out_path = os.path.abspath(args.output)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["username", "uuid", "raids", "tickets"])
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {out_path}")
    print(f"Total raids: {sum(r['raids'] for r in rows)}, "
          f"total tickets: {sum(r['tickets'] for r in rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
