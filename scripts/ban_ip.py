"""
ban_ip.py - Manually ban, unban, blacklist, or inspect IPs.

Flag-based replacement for the old ban-ip.sh (which used subcommands).
Exactly one action flag must be given.

Usage:
    python scripts/ban_ip.py --ban <ip> [--duration SECONDS]
    python scripts/ban_ip.py --unban <ip>
    python scripts/ban_ip.py --blacklist <ip> [--reason TEXT]
    python scripts/ban_ip.py --unblacklist <ip>
    python scripts/ban_ip.py --unblacklist-cloudflare [--apply]
    python scripts/ban_ip.py --status <ip>
    python scripts/ban_ip.py --list [--format {pretty,sql,python}]
"""

from __future__ import annotations

import argparse
import ipaddress
import os
import sys

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_PARENT = os.path.dirname(_THIS_DIR)
if _PARENT not in sys.path:
    sys.path.insert(0, _PARENT)

from config import _BASE_DIR  # noqa: E402
from ip_ban import (  # noqa: E402
    ban_ip as _ban_ip,
    unban_ip as _unban_ip,
    blacklist_ip as _blacklist_ip,
    unblacklist_ip as _unblacklist_ip,
    is_blacklisted,
    get_ban_info,
    get_blacklist,
)
from _export_bans import _load, _print_pretty, _print_sql, _print_python  # noqa: E402

_BAN_DB = os.path.join(_BASE_DIR, "logs", "ip_bans.db")

# Cloudflare edge IP ranges (same list previously hardcoded in ban-ip.sh's
# unblacklist-cloudflare action).
_CLOUDFLARE_NETS = [
    ipaddress.ip_network(n)
    for n in (
        "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
        "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
        "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
        "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
        "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
        "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32",
    )
]


def _is_cloudflare(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return any(addr in net for net in _CLOUDFLARE_NETS)


def _valid_ip(value: str) -> bool:
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--ban", metavar="IP", help="Temp-ban an IP address.")
    group.add_argument("--unban", metavar="IP", help="Remove a temp ban.")
    group.add_argument("--blacklist", metavar="IP", help="Permanently ban an IP.")
    group.add_argument(
        "--unblacklist", metavar="IP", help="Remove an IP from the permanent blacklist."
    )
    group.add_argument(
        "--unblacklist-cloudflare",
        action="store_true",
        help="Remove every Cloudflare edge IP from the blacklist (dry-run unless --apply).",
    )
    group.add_argument("--status", metavar="IP", help="Check if an IP is banned or blacklisted.")
    group.add_argument(
        "--list", action="store_true", help="Show all active bans and the blacklist."
    )

    parser.add_argument(
        "--duration",
        type=int,
        default=3600,
        metavar="SECONDS",
        help="Ban duration in seconds, used with --ban (default: 3600).",
    )
    parser.add_argument(
        "--reason",
        default=None,
        metavar="TEXT",
        help="Reason text, used with --blacklist.",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually remove matches, used with --unblacklist-cloudflare (default: dry-run).",
    )
    parser.add_argument(
        "--format",
        choices=("pretty", "sql", "python"),
        default="pretty",
        help="Output format, used with --list (default: pretty).",
    )
    args = parser.parse_args()

    if args.ban is not None:
        if not _valid_ip(args.ban):
            print(f"error: '{args.ban}' is not a valid IPv4 or IPv6 address", file=sys.stderr)
            return 1
        _ban_ip(args.ban, duration=args.duration)
        print(f"  \u2713 Banned {args.ban} for {args.duration}s")
        return 0

    if args.unban is not None:
        _unban_ip(args.unban)
        print(f"  \u2713 Unbanned {args.unban}")
        return 0

    if args.blacklist is not None:
        if not _valid_ip(args.blacklist):
            print(f"error: '{args.blacklist}' is not a valid IPv4 or IPv6 address", file=sys.stderr)
            return 1
        reason = f"Manually blacklisted: {args.reason}" if args.reason else "Manually blacklisted"
        _blacklist_ip(args.blacklist, reason=reason)
        print(f"  \u2713 Permanently blacklisted {args.blacklist} ({reason})")
        return 0

    if args.unblacklist is not None:
        _unblacklist_ip(args.unblacklist)
        print(f"  \u2713 Removed {args.unblacklist} from blacklist")
        return 0

    if args.unblacklist_cloudflare:
        matches = [e for e in get_blacklist() if _is_cloudflare(e["ip"])]
        if not matches:
            print("  No Cloudflare edge IPs found on the blacklist.")
            return 0
        print(f"  Found {len(matches)} Cloudflare edge IP(s) on the blacklist:")
        for e in matches:
            print(f"    - {e['ip']:<40}  reason={e.get('reason') or '(none)'}")
        if not args.apply:
            print()
            print("  Dry run \u2014 re-run with --apply to remove them.")
            return 0
        removed = 0
        for e in matches:
            try:
                _unblacklist_ip(e["ip"])
                removed += 1
            except Exception as exc:  # noqa: BLE001
                print(f"  ! failed to remove {e['ip']}: {exc}", file=sys.stderr)
        print()
        print(f"  \u2713 Removed {removed}/{len(matches)} Cloudflare edge IP(s) from the blacklist.")
        return 0

    if args.status is not None:
        ip = args.status
        if is_blacklisted(ip):
            print(f"  \u25cf {ip} is PERMANENTLY BLACKLISTED")
        else:
            info = get_ban_info(ip)
            if info:
                r = info["remaining"]
                m, s = divmod(r, 60)
                h, m = divmod(m, 60)
                print(f"  \u25cf {ip} is TEMP-BANNED  ({h}h {m}m {s}s remaining)")
            else:
                print(f"  \u25cb {ip} is not banned")
        return 0

    if args.list:
        blacklist, active, now = _load(_BAN_DB)
        if args.format == "pretty":
            if not os.path.exists(_BAN_DB):
                print("  No ip_bans.db found.")
                return 0
            _print_pretty(blacklist, active, now)
        elif args.format == "sql":
            _print_sql(blacklist, active)
        elif args.format == "python":
            _print_python(blacklist, active)
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
