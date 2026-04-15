#!/bin/bash
# ban-ip.sh — Manually ban, unban, blacklist, or inspect IPs.
#
# Usage:
#   ./scripts/ban-ip.sh ban <ip> [duration]      Temp-ban an IP (default 1 hour)
#   ./scripts/ban-ip.sh unban <ip>               Remove a temp ban
#   ./scripts/ban-ip.sh blacklist <ip> [reason]  Permanently ban an IP
#   ./scripts/ban-ip.sh unblacklist <ip>         Remove from permanent blacklist
#   ./scripts/ban-ip.sh status <ip>              Check if an IP is banned
#   ./scripts/ban-ip.sh list                     Show all active bans + blacklist

set -u
DIR="$HOME/ESI-website"
cd "$DIR"

if [ $# -lt 1 ]; then
    echo "Usage: $0 {ban|unban|blacklist|unblacklist|status|list} [ip] [args...]"
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
        REASON="${2:-Manually blacklisted}"
        python3 -c "
import sys; sys.path.insert(0, '$DIR')
from ip_ban import blacklist_ip
blacklist_ip('$IP', reason='$REASON')
print('  ✓ Permanently blacklisted $IP')
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
        python3 -c "
import sys; sys.path.insert(0, '$DIR')
from ip_ban import get_all_bans, get_blacklist

bl = get_blacklist()
bans = get_all_bans()

if not bl and not bans:
    print('  No active bans or blacklisted IPs.')
    sys.exit(0)

if bl:
    print(f'  Blacklisted ({len(bl)}):')
    for e in bl:
        reason = e['reason'] or '–'
        print(f'    ● {e[\"ip\"]:>15}  {reason}')

if bans:
    print(f'  Temp-banned ({len(bans)}):')
    for e in sorted(bans, key=lambda x: x['remaining']):
        r = e['remaining']
        m, s = divmod(r, 60)
        h, m = divmod(m, 60)
        print(f'    ○ {e[\"ip\"]:>15}  {h}h {m}m {s}s left')
"
        ;;

    *)
        echo "Unknown action: $ACTION"
        echo "Usage: $0 {ban|unban|blacklist|unblacklist|status|list} [ip] [args...]"
        exit 1
        ;;
esac
