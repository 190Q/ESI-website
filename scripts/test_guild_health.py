"""
scripts/test_guild_health.py - print the guild health model against live data.

Runs the real model over the real inputs (same assembly the /api/guild/health
endpoint uses) and prints every signal with its value, baseline, percentile and
weight, so the numbers can be checked against the Guild Stats graphs before
anyone trusts the panel.

Run:
    python scripts/test_guild_health.py
    python scripts/test_guild_health.py --json
    python scripts/test_guild_health.py --dimension activity
    python scripts/test_guild_health.py --watchlist-only
"""

from __future__ import annotations

import argparse
import json
import os
import sys

_BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BASE_DIR not in sys.path:
    sys.path.insert(0, _BASE_DIR)

GREEN = "\033[32m"
RED = "\033[31m"
YELLOW = "\033[33m"
CYAN = "\033[36m"
GREY = "\033[90m"
BOLD = "\033[1m"
RESET = "\033[0m"


def _colour_for(score):
    if score is None:
        return GREY
    if score >= 80:
        return GREEN
    if score >= 65:
        return GREEN
    if score >= 50:
        return YELLOW
    return RED


def _arrow(trend):
    if trend is None:
        return " "
    if trend >= 3:
        return "^"
    if trend <= -3:
        return "v"
    return "-"


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--json", action="store_true", help="dump the raw report as JSON")
    parser.add_argument("--dimension", default="", help="only show one dimension")
    parser.add_argument("--watchlist-only", action="store_true")
    parser.add_argument("--show-weights", action="store_true",
                        help="print the dimension and risk weights")
    opts = parser.parse_args()

    try:
        import guild_health
        import routes
    except Exception as exc:
        print(f"{RED}Could not import the model: {exc}{RESET}")
        return 2

    print(f"{CYAN}Guild health model - live data{RESET}")
    print(f"{GREY}assembling inputs from the cache service, esi_points.db, "
          f"tracked_guild.json, aspects.json and guild_territories.json{RESET}")
    print()

    inputs = routes._guild_health_inputs()
    report = guild_health.build_report(inputs)

    if opts.json:
        print(json.dumps(report, indent=2, default=str))
        return 0

    if not report.get("available"):
        print(f"{RED}No index could be built.{RESET}")
        print(f"  confidence: {report.get('confidence')}")
        return 1

    print(f"{BOLD}DATA SOURCES{RESET}")
    for src in report.get("data_sources") or []:
        if not src.get("available"):
            line = f"  {src['label']:<20} {RED}no data{RESET}"
        else:
            lag = src["lag_days"]
            sc = GREEN if lag <= 2 else (YELLOW if src.get("usable") else RED)
            line = (f"  {src['label']:<20} last {src['end']}  {sc}{lag}d behind{RESET}"
                    f"  {GREY}{'usable' if src.get('usable') else 'NOT SCORED'}{RESET}")
        print(line)
    print()

    idx = report["index"]
    conf = report["confidence"]
    col = _colour_for(idx["score"])
    print(f"{BOLD}INDEX{RESET}  {col}{idx['score']}/100{RESET}  {idx['band']}"
          f"  {_arrow(idx['trend'])} {idx['trend'] if idx['trend'] is not None else '-'} pts")
    print(f"{GREY}  roster {report['roster']} \u00b7 history {report['history_days']} days \u00b7 "
          f"confidence {conf['label']} ({conf['score']}%) \u00b7 "
          f"{conf['scored_dimensions']}/{conf['total_dimensions']} dimensions scored{RESET}")
    for note in conf.get("notes") or []:
        print(f"{YELLOW}  note: {note}{RESET}")
    print()

    if not opts.watchlist_only:
        for dim in report["dimensions"]:
            if opts.dimension and dim["key"] != opts.dimension:
                continue
            dcol = _colour_for(dim["score"])
            score = dim["score"] if dim["score"] is not None else "--"
            print(f"{BOLD}{dim['label']}{RESET}  {dcol}{score}{RESET}  "
                  f"{_arrow(dim['trend'])} {dim['trend'] if dim['trend'] is not None else '-'}"
                  f"  {GREY}({dim['scored_signals']}/{len(dim['signals'])} signals, "
                  f"weight {int(dim['weight'] * 100)}%){RESET}")
            for sig in dim["signals"]:
                scol = _colour_for(sig["score"])
                s_score = f"{sig['score']:>5.1f}" if sig["score"] is not None else "    -"
                s_trend = f"{_arrow(sig['trend'])}{abs(sig['trend']):>5.1f}" if sig["trend"] is not None else "     -"
                print(f"   {sig['label'][:42]:<42} "
                      f"now {sig['value_display']:>12}  base {sig['baseline_display']:>12}  "
                      f"{scol}{s_score}{RESET}  {s_trend}  "
                      f"{GREY}w{int(sig['weight'] * 100):>3}%  {sig['method']:<10}"
                      f"{('(' + str(sig['samples']) + ')') if sig['method'] == 'percentile' else ''}{RESET}")
            print()

    ex = report["excluded"]
    print(f"{BOLD}MEMBER WATCHLIST{RESET}  {len(report['watchlist'])} flagged \u00b7 "
          f"{ex['inactive']} excluded (inactive) \u00b7 "
          f"{ex['new_members']} excluded (new)")
    if ex.get("suppressed_reason"):
        print(f"{YELLOW}  suppressed: {ex['suppressed_reason']}{RESET}")
    elif not report["watchlist"]:
        print(f"{GREY}  nobody is showing a declining trend{RESET}")
    for w in report["watchlist"]:
        wcol = RED if w["band"] == "high" else YELLOW
        seen = (str(w.get("days_since_active")) + "d ago") if w.get("days_since_active") is not None else "never"
        print(f"  {wcol}{w['risk']:>5.1f}{RESET}  {w['username'][:20]:<20} "
              f"{GREY}{str(w.get('rank') or '-'):<12} "
              f"{str(w.get('tenure_days') or '?'):>5}d  last seen {seen:<12}"
              f"  {w['signals']}{RESET}")

    if opts.show_weights:
        print()
        print(f"{BOLD}WEIGHTS{RESET}")
        print(f"  dimensions: {report['weights']['dimensions']}")
        print(f"  member risk: {report['weights']['risk']}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
