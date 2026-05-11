#!/bin/bash
# screen-start.sh — Start all ESI services in named screen sessions.
# Each service gets its own screen so you can attach/detach individually.
#
#   screen -r esi-website-cache     # attach to cache
#   screen -r esi-website-routes    # attach to routes
#   screen -r esi-website-gateway   # attach to gateway
#   screen -r esi-website-logs      # attach to log monitor
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
  screen -r esi-website-logs      # attach to log monitor
  Ctrl+A D                        # detach without stopping
EOF
}

case "${1:-}" in
    -h|--help) show_help; exit 0 ;;
esac

start_screen() {
    local name="$1"
    local cmd="$2"
    local logfile="$DIR/logs/${name}.log"

    # kill existing session if running
    screen -S "$name" -X quit 2>/dev/null
    sleep 0.3

    : > "$logfile"
    screen -dmS "$name" bash -c "exec > >(tee -a $logfile) 2>&1; cd $DIR && source $DIR/venv/bin/activate && $cmd; echo 'CRASHED — press Enter to close'; read"
    echo "  ✓ $name started"
}

# Lock down secret files
for f in "$DIR/.env" "$DIR/.env.local" "$DIR/.flask_secret" "$DIR/ip_whitelist.txt"; do
    [ -f "$f" ] && chmod 600 "$f"
done

mkdir -p "$DIR/logs"

echo ""
echo "  Starting ESI services in screen sessions…"
echo "  ─────────────────────────────────────"

start_screen "esi-website-cache"   "python3 $DIR/cache.py"
sleep 2
start_screen "esi-website-routes"  "python3 $DIR/routes.py"
sleep 1
start_screen "esi-website-gateway" "python3 $DIR/main.py"

echo ""
echo "  Attach:   screen -r esi-website-cache | esi-website-routes | esi-website-gateway"
echo "  Re-open:  screen -r esi-website-logs"
echo "  Detach:   Ctrl+A D"
echo ""

# Kill old logs screen, fix line endings, start new one and attach
screen -S "esi-website-logs" -X quit >/dev/null 2>&1
tr -d '\r' < "$DIR/scripts/screen-logs.sh" > "$DIR/scripts/.screen-logs.sh.tmp" \
    && mv "$DIR/scripts/.screen-logs.sh.tmp" "$DIR/scripts/screen-logs.sh"
chmod +x "$DIR/scripts/screen-logs.sh"
sleep 1
screen -S "esi-website-logs" "$DIR/scripts/screen-logs.sh"
