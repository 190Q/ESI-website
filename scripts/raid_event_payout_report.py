"""Report what every participant should receive from the raid event.

Run this after the event window closes. The event bonus is applied at read time
by ``events/raid_event.py`` and is never written to a database, so every balance
loses it the moment the window ends. This report rebuilds the payout from the
guild raids recorded inside the window instead.

Columns:
    raids    guild raids recorded inside the event window
    bonus    clean EP owed for those raids (raids x --ep-per-raid)
    tickets  raffle tickets earned by those raids
    total    base EP (raids x 10) plus the bonus
    paid     clean EP actually granted for this batch (only with --paid)
    diff     paid minus bonus, so anything not matching the rule stands out

HR ranks (strategist, chief, owner) never earn clean EP from guild raids, so
they take --high-rank-ep-per-raid when it is given.

Usage:
    python scripts/raid_event_payout_report.py
    python scripts/raid_event_payout_report.py --json
    python scripts/raid_event_payout_report.py --output payout.csv
    python scripts/raid_event_payout_report.py --balances --paid
    python scripts/raid_event_payout_report.py --start 2026-10-03T01:00:00Z --end 2026-11-03T01:00:00Z

Options:
    --start / --end             Override the event window (defaults to events/raid_event.py).
    --ep-per-raid N             Clean EP owed per raid (default 5).
    --high-rank-ep-per-raid N   Clean EP per raid for HR ranks (default: same as --ep-per-raid).
    --raids-per-ticket N        Guild raids needed per ticket (default 5; 0 = one per raid).
    --max-tickets N             Most tickets one participant can earn (default 100; 0 = no cap).
    --min-tickets N             Ticket floor applied to every participant (default 1).
    --include-non-raiders       Also list current guild members with zero raids.
    --balances                  Also read each participant's live EP balance.
    --paid                      Also read what the payout ledger granted for this batch.
    --batch LABEL               Payout batch to read with --paid (default: the window).
    --output PATH               Write CSV to this path; '-' prints a table to stdout (default).
    --json                      Emit the full result as JSON.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
from datetime import datetime, timezone

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_THIS_DIR)
for _path in (_THIS_DIR, _ROOT):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from _raid_event_common import (
    EP_PER_RAID,
    MAX_TICKETS,
    MIN_TICKETS,
    RAID_EP,
    RAIDS_PER_TICKET,
    build_payout,
    payout_batch_label,
    resolve_event_window,
)

_CSV_FIELDS = ["username", "uuid", "rank", "raids", "bonus_ep", "tickets", "total_ep"]
_BALANCE_FIELDS = ["clean_ep", "dirty_ep", "spendable_clean"]
_PAID_FIELDS = ["paid_ep", "paid_diff"]


def attach_balances(rows: list[dict]) -> None:
    """Add each participant's live EP balance in place (one lookup per player)."""
    from shop.ep_balance import fetch_ep_balance

    for index, row in enumerate(rows, 1):
        uuid = (row.get("uuid") or "").strip()
        if not uuid:
            continue
        print(f"  [{index}/{len(rows)}] reading balance for {row['username']}", file=sys.stderr)
        try:
            balance = fetch_ep_balance(uuid)
        except Exception as exc:
            row["balance_error"] = str(exc)
            continue
        for field in _BALANCE_FIELDS:
            row[field] = int(balance.get(field) or 0)


def attach_paid(rows: list[dict], batch: str) -> list[dict]:
    """Add the ledger's granted amount per participant, returning unlisted grants."""
    from shop.raid_event_payout import granted_by_uuid

    granted = granted_by_uuid(batch)
    for row in rows:
        uuid = (row.get("uuid") or "").strip().lower()
        paid = int(granted.pop(uuid, 0)) if uuid else 0
        row["paid_ep"] = paid
        row["paid_diff"] = paid - int(row.get("bonus_ep") or 0)
    return [
        {"uuid": uuid, "amount": amount}
        for uuid, amount in sorted(granted.items())
    ]


def _rule_text(
    ep_per_raid: int,
    high_rank_ep_per_raid: int,
    raids_per_ticket: int,
    max_tickets: int,
) -> str:
    hr_note = "" if high_rank_ep_per_raid == ep_per_raid else f" ({high_rank_ep_per_raid} for HR ranks)"
    rate = max(1, int(raids_per_ticket or 0))
    per = "1 ticket per raid" if rate == 1 else f"1 ticket per {rate} raids"
    cap = int(max_tickets or 0)
    cap_text = "no ticket cap" if cap <= 0 else f"max {cap} tickets"
    return f"{ep_per_raid} clean EP per raid{hr_note}, {per}, {cap_text}"


def _print_table(
    start: datetime,
    end: datetime,
    rows: list[dict],
    ep_per_raid: int,
    high_rank_ep_per_raid: int,
    raids_per_ticket: int,
    max_tickets: int,
    show_balances: bool,
    show_paid: bool,
    batch: str,
    unlisted: list[dict],
) -> None:
    now = datetime.now(timezone.utc)
    state = "active" if start <= now < end else "closed"
    total_raids = sum(r["raids"] for r in rows)
    total_bonus = sum(r["bonus_ep"] for r in rows)
    total_tickets = sum(r["tickets"] for r in rows)
    total_ep = sum(r["total_ep"] for r in rows)

    print(f"raid event window: {start.isoformat()} -> {end.isoformat()} ({state})")
    print("rule: " + _rule_text(ep_per_raid, high_rank_ep_per_raid, raids_per_ticket, max_tickets))
    summary = (
        f"players={len(rows)} total_raids={total_raids} bonus_ep={total_bonus} "
        f"total_tickets={total_tickets} total_ep={total_ep}"
    )
    if show_paid:
        summary += f" paid_ep={sum(int(r.get('paid_ep') or 0) for r in rows)}"
    print(summary)
    if show_paid:
        print(f"payout batch: {batch}")
    if not rows:
        print("(no guild raids recorded in this window)")
        return

    name_w = max(len("username"), max(len(r["username"]) for r in rows))
    rank_w = max(len("rank"), max(len(r["rank"] or "-") for r in rows))
    header = (
        f"{'username'.ljust(name_w)}  {'rank'.ljust(rank_w)}  {'raids':>6}  "
        f"{'bonus':>6}  {'tick':>5}  {'total':>6}"
    )
    if show_paid:
        header += f"  {'paid':>6}  {'diff':>6}"
    if show_balances:
        header += f"  {'clean':>7}  {'dirty':>7}  {'spend':>7}"
    print(header)
    print("-" * len(header))

    for r in rows:
        line = (
            f"{r['username'].ljust(name_w)}  {(r['rank'] or '-').ljust(rank_w)}  "
            f"{r['raids']:>6}  {r['bonus_ep']:>6}  {r['tickets']:>5}  {r['total_ep']:>6}"
        )
        if show_paid:
            line += f"  {int(r.get('paid_ep') or 0):>6}  {int(r.get('paid_diff') or 0):>6}"
        if show_balances:
            line += (
                f"  {r.get('clean_ep', 0):>7}  {r.get('dirty_ep', 0):>7}  "
                f"{r.get('spendable_clean', 0):>7}"
            )
        print(line)

    if show_paid and unlisted:
        print()
        print(f"granted in this batch but not in the window ({len(unlisted)}):")
        for entry in unlisted:
            print(f"  {entry['uuid']}: {entry['amount']} EP")

    print()
    print("  bonus = clean EP owed for the event's raids, recomputed from history")
    print(f"  total = raids x {RAID_EP} base EP plus the bonus")
    print("  the live event hook only ever added its bonus while the window was open,")
    print("  and never wrote it to a database, so nothing of it remains in balances now")
    if show_paid:
        print("  paid/diff = clean EP granted for this batch by scripts/grant_raid_event_payout.py")
    if show_balances:
        print("  clean/dirty/spend = live EP balance as the shop sees it")
    if state == "active":
        print("NOTE: the window is still open, so live balances also carry the hook's flat bonus.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--start", default=None, help="Event window start (ISO timestamp).")
    parser.add_argument("--end", default=None, help="Event window end (ISO timestamp).")
    parser.add_argument(
        "--ep-per-raid",
        type=int,
        default=EP_PER_RAID,
        help=f"Clean EP owed per raid (default {EP_PER_RAID}).",
    )
    parser.add_argument(
        "--high-rank-ep-per-raid",
        type=int,
        default=None,
        help="Clean EP per raid for HR ranks (default: same as --ep-per-raid).",
    )
    parser.add_argument(
        "--raids-per-ticket",
        type=int,
        default=RAIDS_PER_TICKET,
        help=f"Guild raids needed per ticket (default {RAIDS_PER_TICKET}; 0 = one per raid).",
    )
    parser.add_argument(
        "--max-tickets",
        type=int,
        default=MAX_TICKETS,
        help=f"Most tickets one participant can earn (default {MAX_TICKETS}; 0 = no cap).",
    )
    parser.add_argument(
        "--min-tickets",
        type=int,
        default=MIN_TICKETS,
        help=f"Ticket floor applied to every participant (default {MIN_TICKETS}).",
    )
    parser.add_argument(
        "--include-non-raiders",
        action="store_true",
        help="Also list current guild members with zero raids (they get the floor).",
    )
    parser.add_argument(
        "--balances",
        action="store_true",
        help="Also read each participant's live EP balance (slow).",
    )
    parser.add_argument(
        "--paid",
        action="store_true",
        help="Also read what the payout ledger granted for this batch.",
    )
    parser.add_argument(
        "--batch",
        default=None,
        help="Payout batch to read with --paid (default: the event window).",
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

    ep_per_raid = args.ep_per_raid
    high_rank_ep_per_raid = (
        ep_per_raid if args.high_rank_ep_per_raid is None else args.high_rank_ep_per_raid
    )
    batch = (args.batch or "").strip() or payout_batch_label(start, end)

    rows = build_payout(
        start,
        end,
        ep_per_raid=ep_per_raid,
        high_rank_ep_per_raid=high_rank_ep_per_raid,
        min_tickets=max(0, args.min_tickets),
        include_non_raiders=args.include_non_raiders,
        raids_per_ticket=args.raids_per_ticket,
        max_tickets=args.max_tickets,
    )

    if args.balances:
        attach_balances(rows)

    unlisted: list[dict] = []
    if args.paid:
        unlisted = attach_paid(rows, batch)

    if args.json:
        print(json.dumps({
            "event_start": start.isoformat(),
            "event_end": end.isoformat(),
            "event_active": start <= datetime.now(timezone.utc) < end,
            "ep_per_raid": ep_per_raid,
            "high_rank_ep_per_raid": high_rank_ep_per_raid,
            "raids_per_ticket": args.raids_per_ticket,
            "max_tickets": args.max_tickets,
            "min_tickets": max(0, args.min_tickets),
            "batch": batch if args.paid else None,
            "players": rows,
            "unlisted_payouts": unlisted,
            "total_raids": sum(r["raids"] for r in rows),
            "total_bonus_ep": sum(r["bonus_ep"] for r in rows),
            "total_tickets": sum(r["tickets"] for r in rows),
            "total_ep": sum(r["total_ep"] for r in rows),
            "total_paid_ep": sum(int(r.get("paid_ep") or 0) for r in rows),
        }, indent=2, ensure_ascii=False))
        return 0

    if args.output == "-":
        _print_table(
            start,
            end,
            rows,
            ep_per_raid,
            high_rank_ep_per_raid,
            args.raids_per_ticket,
            args.max_tickets,
            args.balances,
            args.paid,
            batch,
            unlisted,
        )
        return 0

    fields = list(_CSV_FIELDS)
    if args.paid:
        fields += _PAID_FIELDS
    if args.balances:
        fields += _BALANCE_FIELDS
    out_path = os.path.abspath(args.output)
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    print(f"Wrote {len(rows)} rows to {out_path}")
    print(f"Total raids: {sum(r['raids'] for r in rows)}, "
          f"bonus EP: {sum(r['bonus_ep'] for r in rows)}, "
          f"tickets: {sum(r['tickets'] for r in rows)}")
    if args.paid:
        print(f"Batch {batch}: paid EP {sum(int(r.get('paid_ep') or 0) for r in rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
