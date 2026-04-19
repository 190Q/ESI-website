#!/bin/bash
# screen-stop.sh — Stop all ESI screen sessions.
sed -i 's/\r$//' ~/ESI-website/scripts/*.sh
chmod +x ~/ESI-website/scripts/*.sh

show_help() {
    cat <<'EOF'
screen-stop.sh — Stop all ESI screen sessions.

Usage:
  ./screen-stop.sh             Stop all ESI screen sessions
  ./screen-stop.sh -h | --help Show this help and exit
EOF
}

case "${1:-}" in
    -h|--help) show_help; exit 0 ;;
esac

echo "  Stopping ESI screen sessions…"

for name in esi-website-cache esi-website-routes esi-website-gateway; do
    screen -S "$name" -X quit 2>/dev/null && echo "  ✓ $name stopped" || echo "  – $name not running"
done

echo "  Done."
