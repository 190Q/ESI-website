#!/bin/bash
# ban-ip.sh — Manually ban, unban, blacklist, or inspect IPs.
#
# Usage:
#   ./scripts/ban-ip.sh ban <ip> [duration]      Temp-ban an IP (default 1 hour)
#   ./scripts/ban-ip.sh unban <ip>               Remove a temp ban
#   ./scripts/ban-ip.sh blacklist <ip> [reason]  Permanently ban an IP
#   ./scripts/ban-ip.sh unblacklist <ip>         Remove from permanent blacklist
#   ./scripts/ban-ip.sh unblacklist-cloudflare [--apply]
#                                                Remove Cloudflare edge IPs from blacklist
#                                                (dry-run unless --apply is passed)
#   ./scripts/ban-ip.sh status <ip>              Check if an IP is banned
#   ./scripts/ban-ip.sh list [format]            Show all active bans + blacklist
#                                                  format: pretty (default) | sql | python
sed -i 's/\r$//' ~/ESI-website/scripts/*.sh
chmod +x ~/ESI-website/scripts/*.sh

set -u
DIR="$HOME/ESI-website"
cd "$DIR"

show_help() {
    cat <<'EOF'
ban-ip.sh — Manually ban, unban, blacklist, or inspect IPs.

Usage:
  ./scripts/ban-ip.sh ban <ip> [duration]      Temp-ban an IP (default 1 hour)
  ./scripts/ban-ip.sh unban <ip>               Remove a temp ban
  ./scripts/ban-ip.sh blacklist <ip> [reason]  Permanently ban an IP
  ./scripts/ban-ip.sh unblacklist <ip>         Remove from permanent blacklist
  ./scripts/ban-ip.sh unblacklist-cloudflare [--apply]
                                               Remove every Cloudflare edge IP
                                               from the blacklist (dry-run unless
                                               --apply is passed)
  ./scripts/ban-ip.sh status <ip>              Check if an IP is banned
  ./scripts/ban-ip.sh list [format]            Show all active bans + blacklist
                                                 format: pretty (default) | sql | python
  ./scripts/ban-ip.sh -h | --help              Show this help and exit
EOF
}

case "${1:-}" in
    -h|--help) show_help; exit 0 ;;
esac

if [ $# -lt 1 ]; then
    echo "Usage: $0 {ban|unban|blacklist|unblacklist|unblacklist-cloudflare|status|list} [ip] [args...]"
    echo "Run '$0 --help' for more information."
    exit 1
fi

ACTION="$1"
shift

case "$ACTION" in
    ban)
        IP="${1:?Missing IP address}"
        DURATION="${2:-3600}"
        python3 -c "
import sys; sys.path.insert(0, '$DIR')
from ip_ban import ban_ip
ban_ip('$IP', duration=$DURATION)
print('  ✓ Banned $IP for ${DURATION}s')
"
        ;;

    unban)
        IP="${1:?Missing IP address}"
        python3 -c "
import sys; sys.path.insert(0, '$DIR')
from ip_ban import unban_ip
unban_ip('$IP')
print('  ✓ Unbanned $IP')
"
        ;;

    blacklist)
        IP="${1:?Missing IP address}"
        if [ $# -ge 2 ] && [ -n "$2" ]; then
            REASON="Manually blacklisted: $2"
        else
            REASON="Manually blacklisted"
        fi
        # Validate IP format (IPv4 or IPv6) before touching the blacklist.
        if ! python3 -c "import ipaddress,sys; ipaddress.ip_address('$IP')" 2>/dev/null; then
            echo "  ✗ '$IP' is not a valid IPv4 or IPv6 address" >&2
            exit 1
        fi
        python3 -c "
import sys; sys.path.insert(0, '$DIR')
from ip_ban import blacklist_ip
blacklist_ip('$IP', reason='$REASON')
print('  ✓ Permanently blacklisted $IP ($REASON)')
"
        ;;

    unblacklist)
        IP="${1:?Missing IP address}"
        python3 -c "
import sys; sys.path.insert(0, '$DIR')
from ip_ban import unblacklist_ip
unblacklist_ip('$IP')
print('  ✓ Removed $IP from blacklist')
"
        ;;

    unblacklist-cloudflare)
        APPLY=0
        if [ "${1:-}" = "--apply" ]; then APPLY=1; fi
        APPLY=$APPLY python3 - "$DIR" <<'PY'
import ipaddress, os, sys
sys.path.insert(0, sys.argv[1])
from ip_ban import get_blacklist, unblacklist_ip

NETS = [ipaddress.ip_network(n) for n in (
    "173.245.48.0/20","103.21.244.0/22","103.22.200.0/22","103.31.4.0/22",
    "141.101.64.0/18","108.162.192.0/18","190.93.240.0/20","188.114.96.0/20",
    "197.234.240.0/22","198.41.128.0/17","162.158.0.0/15","104.16.0.0/13",
    "104.24.0.0/14","172.64.0.0/13","131.0.72.0/22",
    "2400:cb00::/32","2606:4700::/32","2803:f800::/32","2405:b500::/32",
    "2405:8100::/32","2a06:98c0::/29","2c0f:f248::/32",
)]

def is_cf(ip):
    try: a = ipaddress.ip_address(ip)
    except ValueError: return False
    return any(a in n for n in NETS)

apply = os.environ.get("APPLY") == "1"
matches = [e for e in get_blacklist() if is_cf(e["ip"])]
if not matches:
    print("  No Cloudflare edge IPs found on the blacklist.")
    sys.exit(0)
print(f"  Found {len(matches)} Cloudflare edge IP(s) on the blacklist:")
for e in matches:
    print(f"    - {e['ip']:<40}  reason={e.get('reason') or '(none)'}")
if not apply:
    print()
    print("  Dry run — re-run with --apply to remove them.")
    sys.exit(0)
removed = 0
for e in matches:
    try:
        unblacklist_ip(e["ip"])
        removed += 1
    except Exception as exc:
        print(f"  ! failed to remove {e['ip']}: {exc}", file=sys.stderr)
print()
print(f"  ✓ Removed {removed}/{len(matches)} Cloudflare edge IP(s) from the blacklist.")
PY
        ;;

    status)
        IP="${1:?Missing IP address}"
        python3 -c "
import sys; sys.path.insert(0, '$DIR')
from ip_ban import is_banned, is_blacklisted, get_ban_info
bl = is_blacklisted('$IP')
info = get_ban_info('$IP')
if bl:
    print('  ● $IP is PERMANENTLY BLACKLISTED')
elif info:
    r = info['remaining']
    m, s = divmod(r, 60)
    h, m = divmod(m, 60)
    print(f'  ● $IP is TEMP-BANNED  ({h}h {m}m {s}s remaining)')
else:
    print('  ○ $IP is not banned')
"
        ;;

    list)
        FORMAT="${1:-pretty}"
        case "$FORMAT" in
            pretty|sql|python) ;;
            *)
                echo "  Unknown list format: $FORMAT (use: pretty, sql, python)"
                exit 1
                ;;
        esac
        python3 "$DIR/scripts/_export_bans.py" "$DIR/logs/ip_bans.db" "$FORMAT"
        ;;

    *)
        echo "Unknown action: $ACTION"
        echo "Usage: $0 {ban|unban|blacklist|unblacklist|unblacklist-cloudflare|status|list} [ip] [args...]"
        exit 1
        ;;
esac
