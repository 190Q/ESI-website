"""Grant the raid event payout as clean EP that ages like normal EP.

The event bonus in ``events/raid_event.py`` is applied at read time and never
written anywhere, so it disappears when the window closes. This script pays the
same amount for real: one clean ``ep_adjustments`` row per participant, sized
from the guild raids recorded inside the window.

Clean EP granted here behaves like any other EP. It stays clean while the cycle
it lands in is the current one, then ages into dirty EP after that.

Every run is recorded in the ``raid_event_payouts`` ledger under a batch label
(default: the event window), so re-running the same batch skips anyone already
paid and ``--revert`` can undo the whole batch exactly.

Examples:
    # Preview who would be paid, then confirm
    python scripts/grant_raid_event_payout.py

    # Preview only
    python scripts/grant_raid_event_payout.py --dry-run

    # Unattended grant, no DMs
    python scripts/grant_raid_event_payout.py --yes --no-dm

    # Different rule, and skip one member
    python scripts/grant_raid_event_payout.py --ep-per-raid 10 --exclude SomeUser

    # Show the ledger, then undo the batch
    python scripts/grant_raid_event_payout.py --list
    python scripts/grant_raid_event_payout.py --revert
"""

from __future__ import annotations

import argparse
import json
import os
import sys

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_THIS_DIR)
for _path in (_THIS_DIR, _ROOT):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from _raid_event_common import (
    EP_PER_RAID,
    build_payout,
    payout_batch_label,
    resolve_event_window,
)
from shop.raid_event_payout import (
    PAYOUT_REASON,
    grant_payouts,
    list_payouts,
    revert_payouts,
)


def _print_ledger(batch: str) -> None:
    rows = list_payouts(batch)
    if not rows:
        print(f"no payouts recorded for batch {batch}")
        return

    name_w = max(len("username"), max(len(r.get("username") or "") for r in rows))
    print(f"payout ledger for batch {batch} ({len(rows)} rows)")
    header = f"{'username'.ljust(name_w)}  {'raids':>6}  {'amount':>7}  {'created_at':<32}  status"
    print(header)
    print("-" * len(header))
    for r in rows:
        status = "reverted" if r.get("reverted_at") else "granted"
        print(
            f"{(r.get('username') or '').ljust(name_w)}  {int(r.get('raids') or 0):>6}  "
            f"{int(r.get('amount') or 0):>7}  {str(r.get('created_at') or ''):<32}  {status}"
        )
    active = [r for r in rows if not r.get("reverted_at")]
    print(
        f"granted={len(active)} reverted={len(rows) - len(active)} "
        f"amount={sum(int(r.get('amount') or 0) for r in active)}"
    )


def _confirm(prompt: str) -> bool:
    """Ask for a y/n answer. An unavailable stdin (panel runs) means no."""
    try:
        answer = input(f"{prompt} [y/N] ").strip().lower()
    except EOFError:
        print("no stdin available to confirm; re-run with --yes to skip the prompt")
        return False
    return answer in {"y", "yes"}


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
        help=f"Clean EP granted per raid (default {EP_PER_RAID}).",
    )
    parser.add_argument(
        "--high-rank-ep-per-raid",
        type=int,
        default=None,
        help="Clean EP per raid for HR ranks (default: same as --ep-per-raid).",
    )
    parser.add_argument(
        "--batch",
        default=None,
        help="Payout batch label (default: raid_event:<start>:<end>).",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="USER",
        help="Skip a user (Minecraft name or UUID). Repeatable.",
    )
    parser.add_argument(
        "--actor",
        default="cli",
        help="Actor stored on the grant and the admin log (default: cli).",
    )
    parser.add_argument(
        "--note",
        default=None,
        help=f"Reason stored on the EP adjustment (default: {PAYOUT_REASON}).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show who would be paid without writing anything.",
    )
    parser.add_argument(
        "--yes",
        "-y",
        action="store_true",
        help="Skip the interactive confirmation prompt.",
    )
    parser.add_argument(
        "--no-dm",
        action="store_true",
        help="Do not DM granted players.",
    )
    parser.add_argument(
        "--revert",
        action="store_true",
        help="Delete this batch's EP adjustments and mark it reverted.",
    )
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print the payout ledger for this batch and exit.",
    )
    parser.add_argument("--json", action="store_true", help="Print the result payload as JSON.")
    args = parser.parse_args()

    try:
        start, end = resolve_event_window(args.start, args.end)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    batch = (args.batch or "").strip() or payout_batch_label(start, end)

    if args.list:
        _print_ledger(batch)
        return 0

    if args.revert:
        if not args.yes:
            preview = revert_payouts(batch, actor=args.actor, dry_run=True)
            if not preview.get("ok"):
                print(f"error: {preview.get('error')}", file=sys.stderr)
                return 1
            count = preview.get("would_revert", 0)
            if not count:
                print(f"nothing to revert for batch {batch}")
                return 0
            print(
                f"Would remove {count} payout(s) worth {preview.get('amount')} clean EP "
                f"from batch {batch}."
            )
            if not _confirm("Revert this batch?"):
                print("Aborted.")
                return 0

        result = revert_payouts(batch, actor=args.actor)
        if args.json:
            print(json.dumps(result, indent=2, ensure_ascii=False))
            return 0 if result.get("ok") else 1
        if not result.get("ok"):
            print(f"error: {result.get('error')}", file=sys.stderr)
            return 1
        print(
            f"reverted={result.get('reverted')} amount={result.get('amount')} "
            f"batch={result.get('batch')}"
        )
        return 0

    ep_per_raid = args.ep_per_raid
    high_rank_ep_per_raid = (
        ep_per_raid if args.high_rank_ep_per_raid is None else args.high_rank_ep_per_raid
    )

    rows = build_payout(
        start,
        end,
        ep_per_raid=ep_per_raid,
        high_rank_ep_per_raid=high_rank_ep_per_raid,
    )

    if not args.dry_run and not args.yes:
        preview = grant_payouts(
            rows,
            batch=batch,
            actor=args.actor,
            note=args.note,
            exclude=args.exclude,
            dry_run=True,
        )
        if not preview.get("ok"):
            print(f"error: {preview.get('error')}", file=sys.stderr)
            return 1
        candidates = preview.get("candidates") or []
        if not candidates:
            print(f"nothing to grant for batch {batch}")
            return 0
        print(
            f"Would grant {preview.get('amount')} clean EP to {len(candidates)} "
            f"member(s) from window {start.date()} to {end.date()}."
        )
        for entry in candidates:
            print(f"  - {entry['username']}: {entry['amount']} EP ({entry['raids']} raids)")
        for entry in preview.get("excluded_users") or []:
            print(f"  exclude: {entry['username']}")
        if not _confirm("Grant this payout?"):
            print("Aborted.")
            return 0

    result = grant_payouts(
        rows,
        batch=batch,
        actor=args.actor,
        note=args.note,
        exclude=args.exclude,
        dry_run=bool(args.dry_run),
        send_dm=not bool(args.no_dm),
    )

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return 0 if result.get("ok") else 1

    if not result.get("ok"):
        print(f"error: {result.get('error')}", file=sys.stderr)
        return 1

    if result.get("dry_run"):
        print(
            f"[dry-run] batch={result.get('batch')} "
            f"candidates={len(result.get('candidates') or [])} "
            f"amount={result.get('amount')} "
            f"excluded={result.get('excluded')}"
        )
        for entry in result.get("candidates") or []:
            print(f"  would grant: {entry['username']} {entry['amount']} EP")
        return 0

    print(
        f"granted={result.get('granted')} skipped={result.get('skipped')} "
        f"excluded={result.get('excluded')} errors={result.get('errors')} "
        f"amount={result.get('amount')} batch={result.get('batch')}"
    )
    for entry in result.get("granted_users") or []:
        print(f"  + {entry['username']}: {entry['amount']} EP")
    for entry in result.get("skipped_users") or []:
        print(f"  skip {entry['username']}: {entry['reason']}")
    for entry in result.get("error_users") or []:
        print(f"  error {entry['username']}: {entry['error']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
