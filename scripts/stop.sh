#!/bin/bash
# stop.sh — Stop all ESI services.

echo "  Stopping ESI services…"

pkill -f "python3.*cache\.py"  2>/dev/null && echo "  ✓ cache stopped"   || echo "  – cache not running"
pkill -f "python3.*routes\.py" 2>/dev/null && echo "  ✓ routes stopped"  || echo "  – routes not running"
pkill -f "python3.*main\.py"   2>/dev/null && echo "  ✓ gateway stopped" || echo "  – gateway not running"

echo "  Done."
