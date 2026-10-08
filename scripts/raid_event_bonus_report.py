"""Report raid-event participation and the live bonus EP players receive.

While the Oct 2026 raid event is active (``events/raid_event.py``) it applies a
temporary EP bonus:

* ``ep_balance_hooks`` add the bonus to ``clean_ep`` / ``total_ep`` /
  ``spendable_clean`` on every balance lookup, so the EP is spendable
  *immediately* - before the event is over.
* ``leaderboard_row_hooks`` add the same bonus to leaderboard rows.

This script cross-checks that against the live code:

1. Lists everyone who raided inside the event window (participants) with their
   raid, ticket and per-raid bonus totals.
2. Measures the bonus EP each player is *actually* granted, by diffing
   ``fetch_ep_balance`` with the event hooks enabled vs. disabled.
3. Confirms the bonus lands in ``spendable_clean`` and that ``resolve_spend``
   accepts spending it (i.e. the EP really is live).
4. Runs a direct self-test of the registered hooks.

Usage:
    python scripts/raid_event_bonus_report.py
    python scripts/raid_event_bonus_report.py --json
    python scripts/raid_event_bonus_report.py --all-members
    python scripts/raid_event_bonus_report.py --start 2026-10-03T01:00:00Z

Options:
    --start / --end   Override the event window (defaults to events/raid_event.py).
    --all-members     Also measure every current guild member, flagging anyone
                      who receives the bonus without raiding.
    --min-tickets N   Ticket floor used when listing participants (default 1).
    --bonus-per-raid N
                      EP per raid used for the ``total`` column (default: the
                      event's own bonus amount, currently 10).
    --no-spend-check  Skip the live ``resolve_spend`` spendability check.
    --json            Emit the full report as JSON.

Columns:
    applied     Bonus the live hook actually adds to the player's balance.
    total       ``raids * --bonus-per-raid`` - what a per-raid payout would pay.
    spendable   Live ``spendable_clean`` (real clean EP plus the applied bonus).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_THIS_DIR)
for _path in (_THIS_DIR, _ROOT):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import events
import events.raid_event as raid_event
from events import apply_ep_balance_hooks, apply_leaderboard_row_hooks
from shop.ep_balance import (
    InsufficientFunds,
    fetch_ep_balance,
    resolve_spend,
)

from _raid_event_common import (
    MIN_TICKETS,
    collect_guild_raids,
    load_roster,
    resolve_event_window,
    tickets_for_raids,
)

_BALANCE_KEYS = ("clean_ep", "total_ep", "spendable_clean")


def _balance_without_hooks(uuid: str) -> dict:
    """Fetch a balance with the registered event hooks temporarily removed."""
    saved = list(events.EP_BALANCE_HOOKS)
    events.EP_BALANCE_HOOKS.clear()
    try:
        return fetch_ep_balance(uuid)
    finally:
        events.EP_BALANCE_HOOKS[:] = saved


def _measure_bonus(uuid: str) -> dict:
    """Return the bonus EP the live hooks add to each balance field."""
    live = fetch_ep_balance(uuid)
    base = _balance_without_hooks(uuid)
    return {
        "live": {k: int(live.get(k) or 0) for k in _BALANCE_KEYS},
        "base": {k: int(base.get(k) or 0) for k in _BALANCE_KEYS},
        "bonus": {k: int(live.get(k) or 0) - int(base.get(k) or 0) for k in _BALANCE_KEYS},
    }


def _can_spend(uuid: str, amount: int) -> tuple[bool, str | None]:
    if amount <= 0:
        return True, None
    try:
        resolve_spend(uuid, amount, "clean_first")
        return True, None
    except InsufficientFunds as exc:
        return False, str(exc)
    except Exception as exc:
        return False, str(exc)


def _self_test() -> dict:
    """Exercise the registered hooks directly on synthetic data."""
    probe = {k: 0 for k in _BALANCE_KEYS + ("dirty_ep", "reserved_clean", "reserved_dirty", "spendable_dirty")}
    apply_ep_balance_hooks(probe, "", False)
    row = {"username": "__probe__", "points": 10, "clean_ep": 10, "rank": None}
    apply_leaderboard_row_hooks(row)
    return {
        "event_active": bool(raid_event._is_event_active()),
        "ep_balance_hooks": len(events.EP_BALANCE_HOOKS),
        "leaderboard_row_hooks": len(events.LEADERBOARD_ROW_HOOKS),
        "probe_balance_spendable_clean": int(probe["spendable_clean"]),
        "probe_leaderboard_points_added": int(row["points"]) - 10,
    }


def build_report(args) -> dict:
    start, end = resolve_event_window(args.start, args.end)
    now = datetime.now(timezone.utc)
    active = bool(raid_event._is_event_active(now))

    per_raid_bonus = args.bonus_per_raid
    if per_raid_bonus is None:
        per_raid_bonus = int(raid_event._bonus_for_rank(False))

    participants = collect_guild_raids(start, end)
    participant_uuids = {
        (p.get("uuid") or "").lower() for p in participants if p.get("uuid")
    }

    roster = load_roster()

    targets: list[dict] = []
    for p in participants:
        targets.append({
            "username": p.get("username") or (p.get("uuid") or "?"),
            "uuid": p.get("uuid"),
            "raids": int(p.get("raids") or 0),
            "participant": True,
        })
    if args.all_members:
        for uid, info in roster.items():
            if uid in participant_uuids:
                continue
            targets.append({
                "username": info.get("username") or uid,
                "uuid": uid,
                "raids": 0,
                "participant": False,
            })

    rows: list[dict] = []
    for index, target in enumerate(targets, 1):
        uuid = (target.get("uuid") or "").strip().lower()
        rank = (roster.get(uuid) or {}).get("rank", "")
        is_hr = raid_event._is_high_rank_row({"rank": rank})
        expected = int(raid_event._bonus_for_rank(is_hr)) if active else 0

        row = {
            "username": target["username"],
            "uuid": uuid or None,
            "rank": rank or None,
            "is_high_rank": bool(is_hr),
            "participant": bool(target["participant"]),
            "raids": int(target["raids"]),
            "tickets": tickets_for_raids(target["raids"], max(0, args.min_tickets)),
            "expected_bonus": expected,
            "total_bonus": int(target["raids"]) * per_raid_bonus,
            "bonus": {k: 0 for k in _BALANCE_KEYS},
            "spendable_clean_live": 0,
            "spendable_clean_base": 0,
            "can_spend_bonus": None,
            "status": "no-uuid",
        }

        if uuid:
            print(f"  [{index}/{len(targets)}] measuring {target['username']}", file=sys.stderr)
            try:
                measured = _measure_bonus(uuid)
            except Exception as exc:  # pragma: no cover - defensive
                row["status"] = f"error: {exc}"
                rows.append(row)
                continue

            row["bonus"] = measured["bonus"]
            row["spendable_clean_live"] = measured["live"]["spendable_clean"]
            row["spendable_clean_base"] = measured["base"]["spendable_clean"]

            bonus_spendable = measured["bonus"]["spendable_clean"]
            if expected > 0 and bonus_spendable == expected:
                row["status"] = "ok"
            elif expected > 0 and bonus_spendable == 0:
                row["status"] = "MISSING"
            elif expected > 0:
                row["status"] = "PARTIAL"
            elif bonus_spendable > 0:
                row["status"] = "UNEXPECTED"
            else:
                row["status"] = "none"

            if not args.no_spend_check and expected > 0:
                row["can_spend_bonus"] = _can_spend(uuid, expected)[0]
                if row["status"] == "ok" and row["can_spend_bonus"] is False:
                    row["status"] = "NOT-SPENDABLE"

        rows.append(row)

    rows.sort(key=lambda r: (
        not r["participant"],
        -r["raids"],
        (r["username"] or "").lower(),
    ))

    problems = [
        r for r in rows
        if r["status"] in {"MISSING", "PARTIAL", "UNEXPECTED", "NOT-SPENDABLE"}
        or (not r["participant"] and r["bonus"]["spendable_clean"] > 0)
    ]

    return {
        "event_start": start.isoformat(),
        "event_end": end.isoformat(),
        "event_active": active,
        "bonus_per_raid": per_raid_bonus,
        "applied_total": sum(r["bonus"]["spendable_clean"] for r in rows),
        "per_raid_total": sum(r["total_bonus"] for r in rows),
        "self_test": _self_test(),
        "participant_count": sum(1 for r in rows if r["participant"]),
        "scanned_count": len(rows),
        "rows": rows,
        "problems": problems,
    }


def _print_report(report: dict) -> None:
    st = report["self_test"]
    print("raid event bonus report")
    print(f"  window      : {report['event_start']} -> {report['event_end']}")
    print(f"  active now  : {report['event_active']}")
    print(f"  hooks       : ep_balance={st['ep_balance_hooks']} "
          f"leaderboard={st['leaderboard_row_hooks']}")
    print(f"  hook probe  : balance +{st['probe_balance_spendable_clean']} spendable_clean, "
          f"leaderboard +{st['probe_leaderboard_points_added']} points")
    print(f"  participants: {report['participant_count']} "
          f"(scanned {report['scanned_count']})")
    print(f"  bonus totals: applied={report['applied_total']} "
          f"per-raid={report['per_raid_total']} "
          f"({report['bonus_per_raid']} EP/raid)")
    print()

    rows = report["rows"]
    if not rows:
        print("(no participants found in this window)")
        return

    name_w = max(len("username"), max(len(r["username"] or "") for r in rows))
    header = (
        f"{'username'.ljust(name_w)}  {'rank':<10}  {'raids':>5}  {'tick':>4}  "
        f"{'applied':>7}  {'total':>6}  {'spendable':>9}  status"
    )
    print(header)
    print("-" * len(header))
    for r in rows:
        print(
            f"{(r['username'] or '').ljust(name_w)}  "
            f"{(r['rank'] or '-'):<10}  "
            f"{r['raids']:>5}  {r['tickets']:>4}  "
            f"{r['bonus']['spendable_clean']:>7}  "
            f"{r['total_bonus']:>6}  "
            f"{r['spendable_clean_live']:>9}  "
            f"{r['status']}"
        )

    print()
    print("  applied   = bonus the live hook adds to each balance lookup")
    print(f"  total     = raids x {report['bonus_per_raid']} EP "
          f"(what a per-raid bonus would pay)")
    print("  spendable = live spendable_clean (real clean EP + applied bonus)")
    print()

    mismatched = [
        r for r in rows
        if r["participant"] and r["bonus"]["spendable_clean"] != r["total_bonus"]
    ]
    if mismatched:
        applied_values = {
            r["bonus"]["spendable_clean"] for r in rows if r["participant"]
        }
        flat_desc = (
            f"a flat {next(iter(applied_values))} EP per player"
            if len(applied_values) == 1 else "a per-player amount"
        )
        print(f"NOTE: the live hook pays {flat_desc}, not "
              f"{report['bonus_per_raid']} EP per raid - see the 'applied' vs "
              f"'total' columns ({len(mismatched)} participant(s) differ).")
    if not report["event_active"]:
        print("NOTE: the event window is not active, so the bonus hooks are inert.")
    problems = report["problems"]
    if problems:
        print(f"ATTENTION: {len(problems)} row(s) need a look:")
        for r in problems:
            extra = ""
            if not r["participant"] and r["bonus"]["spendable_clean"] > 0:
                extra = " (gets bonus without any guild raid)"
            print(f"  - {r['username']}: bonus={r['bonus']['spendable_clean']} "
                  f"expected={r['expected_bonus']} status={r['status']}{extra}")
    else:
        print("OK: every participant receives the bonus in spendable_clean "
              "and can spend it live.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--start", default=None, help="Event window start (ISO timestamp).")
    parser.add_argument("--end", default=None, help="Event window end (ISO timestamp).")
    parser.add_argument(
        "--all-members",
        action="store_true",
        help="Also measure every current guild member (flags bonus without raids).",
    )
    parser.add_argument(
        "--min-tickets",
        type=int,
        default=MIN_TICKETS,
        help=f"Ticket floor used when listing participants (default {MIN_TICKETS}).",
    )
    parser.add_argument(
        "--bonus-per-raid",
        type=int,
        default=None,
        help="EP per raid used for the 'total' column "
             "(default: the event's own bonus amount).",
    )
    parser.add_argument(
        "--no-spend-check",
        action="store_true",
        help="Skip the live resolve_spend spendability check.",
    )
    parser.add_argument("--json", action="store_true", help="Emit the report as JSON.")
    args = parser.parse_args()

    try:
        report = build_report(args)
    except (ValueError, FileNotFoundError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        _print_report(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
