"""
Instantly grant the one-time Knight promotion dirty-EP bonus via CLI.

By default only current Knights are granted.
Pass --max-rank to include that rank and every rank below it.

Examples:
    # Preview current Knights only
    python scripts/grant_knight_bonus.py --dry-run

    # Grant current Knights only
    python scripts/grant_knight_bonus.py

    # Grant Count and everyone below (Count, Viscount, Knight, Squire)
    python scripts/grant_knight_bonus.py --max-rank count

    # Exclude one or more users (Minecraft name, Discord ID, or UUID)
    python scripts/grant_knight_bonus.py --exclude SomeUser --exclude 123456789012345678
    python scripts/grant_knight_bonus.py --max-rank count --exclude Alice --exclude Bob -y

    # Preview Viscount and below, no DMs on real run
    python scripts/grant_knight_bonus.py --max-rank viscount --dry-run
    python scripts/grant_knight_bonus.py --max-rank viscount --no-dm

    # List valid rank names
    python scripts/grant_knight_bonus.py --list-ranks
"""

from __future__ import annotations

import argparse
import json
import os
import sys


def _project_root() -> str:
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


ROOT = _project_root()
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from shop.knight_bonus import (  # noqa: E402
    KNIGHT_BONUS_AMOUNT,
    bulk_grant_knight_bonus,
    list_rank_names,
)


def main() -> int:
    parser = argparse.ArgumentParser(
        description=(
            f"Grant the one-time {KNIGHT_BONUS_AMOUNT} dirty EP Knight bonus. "
            "Default: current Knights only. "
            "--max-rank NAME grants that rank and all lower ranks."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument(
        "--max-rank",
        default="knight",
        metavar="RANK",
        help=(
            "Highest rank included in the grant band (default: knight). "
            "With the default, only exact Knights are granted. "
            "For any other rank (e.g. count), that rank and every rank below "
            "it are included. Use --list-ranks for valid names."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="List who would be granted without writing to the database.",
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
        help="Do not send Discord DMs for granted bonuses.",
    )
    parser.add_argument(
        "--actor",
        default="cli",
        help="Actor name stored on the grant / admin log (default: cli).",
    )
    parser.add_argument(
        "--note",
        default=None,
        help="Optional note stored on the EP adjustment.",
    )
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="USER",
        help=(
            "Exclude a user from the grant list. Repeatable. "
            "Accepts Minecraft username, Discord ID, or Minecraft UUID."
        ),
    )
    parser.add_argument(
        "--list-ranks",
        action="store_true",
        help="Print valid rank names (highest first) and exit.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print the full result payload as JSON.",
    )
    args = parser.parse_args()

    if args.list_ranks:
        ranks = list_rank_names()
        print("Valid ranks (highest → lowest):")
        for name in ranks:
            print(f"  - {name}")
        return 0

    max_rank = (args.max_rank or "knight").strip()
    if not max_rank:
        print("error: --max-rank cannot be empty", file=sys.stderr)
        return 2

    exclude = list(args.exclude or [])

    # Dry-run first when not confirmed, so the operator sees the match set.
    if not args.dry_run and not args.yes:
        preview = bulk_grant_knight_bonus(
            max_rank=max_rank,
            dry_run=True,
            actor=args.actor,
            note=args.note,
            send_dm=False,
            exclude=exclude,
        )
        if not preview.get("ok"):
            print(f"error: {preview.get('error')}", file=sys.stderr)
            return 1

        print(
            f"Would grant {KNIGHT_BONUS_AMOUNT} dirty EP to "
            f"{preview.get('matched', 0)} linked member(s) "
            f"(max-rank={preview.get('max_rank')!r}"
            f"{', excluded=' + str(preview.get('excluded', 0)) if preview.get('excluded') else ''})."
        )
        for c in preview.get("candidates") or []:
            print(f"  - {c.get('username') or c.get('uuid')}  (tier {c.get('tier')})")
        for e in preview.get("excluded_users") or []:
            print(f"  exclude: {e.get('username') or e.get('uuid')}")
        if not (preview.get("candidates") or []):
            print("  (no matching members)")
            return 0

        answer = input("Proceed with grant? [y/N] ").strip().lower()
        if answer not in {"y", "yes"}:
            print("Aborted.")
            return 0

    result = bulk_grant_knight_bonus(
        max_rank=max_rank,
        dry_run=bool(args.dry_run),
        actor=args.actor or "cli",
        note=args.note,
        send_dm=not bool(args.no_dm),
        exclude=exclude,
    )

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        if not result.get("ok"):
            print(f"error: {result.get('error')}", file=sys.stderr)
            return 1

        if result.get("dry_run"):
            print(
                f"[dry-run] matched={result.get('matched', 0)} "
                f"excluded={result.get('excluded', 0)} "
                f"max-rank={result.get('max_rank')!r} "
                f"amount={result.get('amount')}"
            )
            for c in result.get("candidates") or []:
                print(f"  would grant: {c.get('username') or c.get('uuid')}")
            for e in result.get("excluded_users") or []:
                print(f"  excluded: {e.get('username') or e.get('uuid')}")
        else:
            print(
                f"granted={result.get('granted', 0)} "
                f"skipped={result.get('skipped', 0)} "
                f"excluded={result.get('excluded', 0)} "
                f"errors={result.get('errors', 0)} "
                f"matched={result.get('matched', 0)} "
                f"max-rank={result.get('max_rank')!r} "
                f"amount={result.get('amount')}"
            )
            for g in result.get("granted_users") or []:
                print(f"  + {g.get('username') or g.get('uuid')}")
            for s in result.get("skipped_users") or []:
                print(
                    f"  skip {s.get('username') or s.get('uuid')}: "
                    f"{s.get('reason')}"
                )
            for e in result.get("excluded_users") or []:
                print(f"  excluded: {e.get('username') or e.get('uuid')}")
            for e in result.get("error_users") or []:
                print(
                    f"  error {e.get('username') or e.get('uuid')}: "
                    f"{e.get('error')}"
                )

    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
