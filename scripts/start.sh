#!/bin/bash
# start.sh — Start all ESI services in the foreground.
# Each runs as a background job; Ctrl+C kills them all.

set -u
DIR="$(cd "$(dirname "$0")/.." && pwd)"

cleanup() {
    echo ""
    echo "  Stopping all services…"
    kill $PID_CACHE $PID_ROUTES $PID_GATEWAY 2>/dev/null
    wait $PID_CACHE $PID_ROUTES $PID_GATEWAY 2>/dev/null
    echo "  All stopped."
}
trap cleanup EXIT INT TERM

echo ""
echo "  Starting ESI services…"
echo "  ─────────────────────────────────────"

python3 "$DIR/cache.py" &
PID_CACHE=$!
sleep 1

python3 "$DIR/routes.py" &
PID_ROUTES=$!
sleep 1

python3 "$DIR/main.py" &
PID_GATEWAY=$!

echo ""
echo "  PIDs:  cache=$PID_CACHE  routes=$PID_ROUTES  gateway=$PID_GATEWAY"
echo "  Press Ctrl+C to stop all"
echo ""

wait
