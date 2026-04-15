#!/bin/bash
# reload.sh — Restart one or all ESI services.
#
# Usage:
#   ./reload.sh              # reload all 3
#   ./reload.sh routes       # reload only routes
#   ./reload.sh cache        # reload only cache
#   ./reload.sh gateway      # reload only gateway
#   ./reload.sh routes cache # reload routes + cache

set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"

reload_cache() {
    echo "  Reloading cache…"
    pkill -f "python3.*cache\.py" 2>/dev/null
    sleep 0.5
    nohup python3 "$DIR/cache.py" >> "$DIR/logs/cache.log" 2>&1 &
    echo "  ✓ cache restarted (PID $!)"
}

reload_routes() {
    echo "  Reloading routes…"
    pkill -f "python3.*routes\.py" 2>/dev/null
    sleep 0.5
    nohup python3 "$DIR/routes.py" >> "$DIR/logs/routes.log" 2>&1 &
    echo "  ✓ routes restarted (PID $!)"
}

reload_gateway() {
    echo "  Reloading gateway…"
    pkill -f "python3.*main\.py" 2>/dev/null
    sleep 0.5
    nohup python3 "$DIR/main.py" >> "$DIR/logs/gateway.log" 2>&1 &
    echo "  ✓ gateway restarted (PID $!)"
}

mkdir -p "$DIR/logs"

if [ $# -eq 0 ]; then
    echo "  Reloading all ESI services…"
    echo "  ─────────────────────────────────────"
    reload_cache
    sleep 1
    reload_routes
    sleep 1
    reload_gateway
else
    for svc in "$@"; do
        case "$svc" in
            cache)   reload_cache   ;;
            routes)  reload_routes  ;;
            gateway) reload_gateway ;;
            *)       echo "  Unknown service: $svc (use: cache, routes, gateway)" ;;
        esac
    done
fi

echo "  Done."
