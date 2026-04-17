#!/bin/bash
# screen-reload.sh — Restart one or all ESI services in their screen sessions.
#
# Usage:
#   ./screen-reload.sh              # reload all 3
#   ./screen-reload.sh routes       # reload only routes (gateway stays up!)
#   ./screen-reload.sh cache        # reload only cache
#   ./screen-reload.sh gateway      # reload only gateway
#   ./screen-reload.sh routes cache # reload routes + cache
sed -i 's/\r$//' ~/ESI-website/scripts/*.sh
chmod +x ~/ESI-website/scripts/*.sh

set -u
DIR="$HOME/ESI-website"
cd "$DIR"

reload_screen() {
    local name="$1"
    local cmd="$2"

    screen -S "$name" -X quit 2>/dev/null
    sleep 0.5
    screen -dmS "$name" bash -c "cd $DIR && source $DIR/venv/bin/activate && $cmd"
    echo "  ✓ $name reloaded"
}

reload_cache() {
    reload_screen "esi-website-cache" "python3 $DIR/cache.py; echo 'CRASHED — press Enter to close'; read"
}

reload_routes() {
    reload_screen "esi-website-routes" "python3 $DIR/routes.py; echo 'CRASHED — press Enter to close'; read"
}

reload_gateway() {
    reload_screen "esi-website-gateway" "python3 $DIR/main.py; echo 'CRASHED — press Enter to close'; read"
}

if [ $# -eq 0 ]; then
    echo "  Reloading all ESI screen sessions…"
    echo "  ─────────────────────────────────────"
    reload_cache
    sleep 2
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
