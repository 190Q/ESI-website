#!/bin/bash
# stop.sh — Stop all ESI services.
sed -i 's/\r$//' ~/ESI-website/scripts/*.sh
chmod +x ~/ESI-website/scripts/*.sh

show_help() {
    cat <<'EOF'
stop.sh — Stop all ESI services.

Usage:
  ./stop.sh             Stop all ESI services
  ./stop.sh -h | --help Show this help and exit
EOF
}

case "${1:-}" in
    -h|--help) show_help; exit 0 ;;
esac

echo "  Stopping ESI services…"

pkill -f "python3.*cache\.py"  2>/dev/null && echo "  ✓ cache stopped"   || echo "  – cache not running"
pkill -f "python3.*routes\.py" 2>/dev/null && echo "  ✓ routes stopped"  || echo "  – routes not running"
pkill -f "python3.*main\.py"   2>/dev/null && echo "  ✓ gateway stopped" || echo "  – gateway not running"

echo "  Done."
