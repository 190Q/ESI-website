#!/bin/bash
# screen-start.sh — Start all ESI services in named screen sessions.
# Each service gets its own screen so you can attach/detach individually.
#
#   screen -r esi-website-cache     # attach to cache
#   screen -r esi-website-routes    # attach to routes
#   screen -r esi-website-gateway   # attach to gateway
#   Ctrl+A D                # detach without stopping
sed -i 's/\r$//' ~/ESI-website/scripts/*.sh
chmod +x ~/ESI-website/scripts/*.sh

set -u
DIR="$HOME/ESI-website"
cd "$DIR"

show_help() {
    cat <<'EOF'
screen-start.sh — Start all ESI services in named screen sessions.
Each service gets its own screen so you can attach/detach individually.

Usage:
  ./screen-start.sh             Start all services
  ./screen-start.sh -h | --help Show this help and exit

Attach/detach:
  screen -r esi-website-cache     # attach to cache
  screen -r esi-website-routes    # attach to routes
  screen -r esi-website-gateway   # attach to gateway
  Ctrl+A D                        # detach without stopping
EOF
}

case "${1:-}" in
    -h|--help) show_help; exit 0 ;;
esac

start_screen() {
    local name="$1"
    local cmd="$2"

    # kill existing session if running
    screen -S "$name" -X quit 2>/dev/null
    sleep 0.3

    screen -dmS "$name" bash -c "cd $DIR && source $DIR/venv/bin/activate && $cmd"
    echo "  ✓ $name started"
}

echo ""
echo "  Starting ESI services in screen sessions…"
echo "  ─────────────────────────────────────"

start_screen "esi-website-cache"   "python3 $DIR/cache.py;   echo 'CRASHED — press Enter to close'; read"
sleep 2
start_screen "esi-website-routes"  "python3 $DIR/routes.py;  echo 'CRASHED — press Enter to close'; read"
sleep 1
start_screen "esi-website-gateway" "python3 $DIR/main.py;    echo 'CRASHED — press Enter to close'; read"

echo ""
echo "  Attach with:  screen -r esi-website-cache | esi-website-routes | esi-website-gateway"
echo "  Detach with:  Ctrl+A D"
echo ""
