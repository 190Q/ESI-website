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

show_help() {
    cat <<'EOF'
screen-reload.sh — Restart one or all ESI services in their screen sessions.

Usage:
  ./screen-reload.sh              # reload all 3
  ./screen-reload.sh routes       # reload only routes (gateway stays up!)
  ./screen-reload.sh cache        # reload only cache
  ./screen-reload.sh gateway      # reload only gateway
  ./screen-reload.sh routes cache # reload routes + cache
  ./screen-reload.sh -h | --help  Show this help and exit
EOF
}

case "${1:-}" in
    -h|--help) show_help; exit 0 ;;
esac

reload_screen() {
    local name="$1"
    local cmd="$2"
    local logfile="$DIR/logs/${name}.log"

    screen -S "$name" -X quit 2>/dev/null
    sleep 0.5
    : > "$logfile"
    echo "  ✓ $name reloading…" >> "$logfile"
    screen -dmS "$name" bash -c "exec > >(tee -a $logfile) 2>&1; cd $DIR && source $DIR/venv/bin/activate && $cmd; echo 'CRASHED — press Enter to close'; read"
    echo "  ✓ $name reloaded"
}

reload_cache() {
    reload_screen "esi-website-cache" "python3 $DIR/cache.py"
}

reload_routes() {
    reload_screen "esi-website-routes" "python3 $DIR/routes.py"
}

reload_gateway() {
    reload_screen "esi-website-gateway" "python3 $DIR/main.py"
}

# Lock down secret files
for f in "$DIR/.env" "$DIR/.env.local" "$DIR/.flask_secret" "$DIR/ip_whitelist.txt"; do
    [ -f "$f" ] && chmod 600 "$f"
done

mkdir -p "$DIR/logs"

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
