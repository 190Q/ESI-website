"""Switch temporary events on or off without touching their code.

Every module in ``events/`` registers temporary hooks (EP bonuses, leaderboard
bonuses, ...).  This script flips them in ``data/event_toggles.json``: a
switched-off module keeps its file but registers no hooks, so the site behaves
as if the event did not exist.  Deleting the file, or a missing entry, means
enabled.

Usage:
    python scripts/events_toggle.py                      # list every event
    python scripts/events_toggle.py --disable raid_event
    python scripts/events_toggle.py --enable raid_event
    python scripts/events_toggle.py --disable all
    python scripts/events_toggle.py --json

Options:
    --enable NAME    Switch one event on (or "all").
    --disable NAME   Switch one event off (or "all").
    --json           Print the config path, what changed, and every event state.

The running site reads the config at startup, so reload it afterwards
(``./reload.sh`` or restart the services) for a change to take effect.
"""

from __future__ import annotations

import argparse
import json
import os
import sys

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_THIS_DIR)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from config import _EVENT_TOGGLES_JSON
from events import is_event_enabled, list_event_modules, set_event_enabled


def _event_state() -> list[dict]:
    return [
        {"name": name, "enabled": is_event_enabled(name)}
        for name in list_event_modules()
    ]


def _resolve_targets(value: str, names: list[str]) -> list[str]:
    """Return the module names *value* points at (empty when it is unknown)."""
    wanted = (value or "").strip()
    if not wanted:
        return []
    if wanted.lower() == "all":
        return list(names)
    return [wanted] if wanted in names else []


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    switch = parser.add_mutually_exclusive_group()
    switch.add_argument(
        "--enable",
        metavar="NAME",
        default=None,
        help='Event module to switch on, or "all".',
    )
    switch.add_argument(
        "--disable",
        metavar="NAME",
        default=None,
        help='Event module to switch off, or "all".',
    )
    parser.add_argument("--json", action="store_true", help="Print the full state as JSON.")
    args = parser.parse_args()

    names = list_event_modules()
    if not names:
        print("error: no event modules found in events/", file=sys.stderr)
        return 1

    changed: list[str] = []
    for value, enabled in ((args.enable, True), (args.disable, False)):
        if value is None:
            continue
        targets = _resolve_targets(value, names)
        if not targets:
            print(
                f"error: unknown event {value!r}. Known events: {', '.join(names)}",
                file=sys.stderr,
            )
            return 2
        for name in targets:
            set_event_enabled(name, enabled)
            changed.append(name)

    state = _event_state()
    if args.json:
        print(json.dumps({
            "config": _EVENT_TOGGLES_JSON,
            "changed": changed,
            "events": state,
        }, indent=2, ensure_ascii=False))
        return 0

    for entry in state:
        mark = "on " if entry["enabled"] else "off"
        print(f"  [{mark}] {entry['name']}")
    print()
    print(f"config: {_EVENT_TOGGLES_JSON}")
    if changed:
        print(f"changed: {', '.join(changed)}")
        print("reload the site for the change to take effect")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
