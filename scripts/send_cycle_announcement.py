"""
Send an EP cycle-end announcement using DEV targets.

Usage:
    python scripts/send_cycle_announcement.py --cycle 8
    python scripts/send_cycle_announcement.py --cycle 8 --dry-run
    python scripts/send_cycle_announcement.py --cycle 8 --record --respect-sent
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

from shop.cycle_announcement import send_cycle_end_announcement  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--cycle",
        type=int,
        required=True,
        help="Completed cycle ID to announce (the script announces this ended cycle).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Build the message and print it without posting to Discord.",
    )
    parser.add_argument(
        "--record",
        action="store_true",
        help="Record this cycle as announced in shop.db after a successful post.",
    )
    parser.add_argument(
        "--respect-sent",
        action="store_true",
        help="Skip sending when this cycle is already recorded as announced.",
    )
    args = parser.parse_args()


    result = send_cycle_end_announcement(
        ended_cycle_id=args.cycle,
        respect_sent=bool(args.respect_sent),
        record_sent=bool(args.record),
        dry_run=bool(args.dry_run),
        target_environment="dev",
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
